<?php
/**
 * 并发场景验收 v2（隔离库 + 容器内 127.0.0.1:8080）
 * 断言式；并发角色经 proc_open 子进程执行、结果落文件；结束打印最终数据库状态。
 */
$FAILS = 0;
function ok($cond, $name) {
    global $FAILS;
    echo ($cond ? 'PASS' : 'FAIL') . " | $name\n";
    if (!$cond) $FAILS++;
}
$BASE = 'http://127.0.0.1:8080';
$COOKIE = '';
function http($path, $post = null) {
    global $BASE, $COOKIE;
    $hdr = "Content-Type: application/x-www-form-urlencoded\r\nCookie: $COOKIE\r\n";
    $ctx = stream_context_create(['http' => [
        'method' => $post !== null ? 'POST' : 'GET',
        'header' => $hdr,
        'content' => $post !== null ? http_build_query($post) : '',
        'ignore_errors' => true, 'timeout' => 40,
    ]]);
    $body = @file_get_contents($BASE . $path, false, $ctx);
    foreach ((array)(isset($http_response_header) ? $http_response_header : []) as $__h) {
        if (preg_match('/Set-Cookie:\s*(PHPSESSID=[^;]+)/', $__h, $__m)) { $GLOBALS['COOKIE'] = $__m[1]; }
    }
    return json_decode($body, true) ?: ['code' => -1, 'msg' => 'HTTP_FAIL'];
}
function db() {
    return new PDO(
        'mysql:host=' . getenv('DB_HOST') . ';dbname=' . getenv('DB_NAME') . ';charset=utf8mb4',
        getenv('DB_USER'), getenv('DB_PASS'),
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
}
function grabCookie() {
    return $GLOBALS['COOKIE'] ?? '';
}
function runChild($phpCode) { // 后台子进程（继承 env），返回 proc handle
    $spec = [['pipe','r'],['pipe','w'],['pipe','w']];
    return proc_open('php -r ' . escapeshellarg($phpCode), $spec, $pipes);
}
function waitFile($f, $sec = 30) {
    $d = time() + $sec;
    while (!file_exists($f) && time() < $d) usleep(50000);
    return file_exists($f);
}

// ---------- 公共代码（并发子角色用），COOKIE 运行时注入 ----------
$INC = "<?php\n\$BASE = 'http://127.0.0.1:8080';\n\$COOKIE = " . var_export($COOKIE, true) . ";\n"
    . 'function http($path, $post = null) {
    $hdr = "Content-Type: application/x-www-form-urlencoded\r\nCookie: " . $COOKIE . "\r\n";
    $ctx = stream_context_create(["http" => ["method" => $post !== null ? "POST" : "GET", "header" => $hdr,
        "content" => $post !== null ? http_build_query($post) : "", "ignore_errors" => true, "timeout" => 40]]);
    return json_decode(@file_get_contents($BASE . $path, false, $ctx), true) ?: ["code" => -1, "msg" => "HTTP_FAIL"];
}
function db() {
    return new PDO("mysql:host=" . getenv("DB_HOST") . ";dbname=" . getenv("DB_NAME") . ";charset=utf8mb4",
        getenv("DB_USER"), getenv("DB_PASS"), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
}
// 引擎 /v1/jobs 创建事务的逐字复刻（app.py），作为"任务创建"角色
function engineStandinCreateJob($subId, $waitMarker = null, $goMarker = null, $resultFile = null) {
    $pdo = db();
    $pdo->exec("SET SESSION innodb_lock_wait_timeout = 20");
    $pdo->beginTransaction();
    try {
        $st = $pdo->prepare("SELECT id FROM essay_submissions WHERE id = ? AND status = ? FOR UPDATE");
        $st->execute([$subId, "pending"]);
        if (!$st->fetch()) { $pdo->rollBack(); $r = ["code" => 409, "msg" => "部分作文已不在待批状态"]; }
        else {
            if ($waitMarker) {
                file_put_contents($waitMarker, date("H:i:s"));
                $d = time() + 30;
                while (!file_exists($goMarker) && time() < $d) usleep(50000);
            }
            $st = $pdo->prepare("SELECT DISTINCT i.submission_id FROM grader_job_items i JOIN grader_jobs j ON j.id = i.job_id
                                 WHERE j.status IN (\"queued\",\"running\") AND i.status IN (\"pending\",\"running\") AND i.submission_id = ?");
            $st->execute([$subId]);
            if ($st->fetch()) { $pdo->rollBack(); $r = ["code" => 409, "msg" => "busy"]; }
            else {
                $pdo->prepare("INSERT INTO grader_jobs (grade_model, ocr_model, status, total, created_by) VALUES (?,?,?,?,?)")
                    ->execute(["test-model", "", "queued", 1, "ta-test"]);
                $jobId = $pdo->lastInsertId();
                $pdo->prepare("INSERT INTO grader_job_items (job_id, submission_id) VALUES (?, ?)")->execute([$jobId, $subId]);
                $pdo->commit();
                $r = ["code" => 0, "job_id" => (int)$jobId];
            }
        }
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        $r = ["code" => 500, "msg" => $e->getMessage()];
    }
    if ($resultFile) file_put_contents($resultFile, json_encode($r));
    return $r;
}'
    . "\n";
$INC = "<?php
\$BASE = 'http://127.0.0.1:8080';
\$COOKIE = " . var_export($COOKIE, true) . ";
"
    . file_get_contents('/tmp/ta/standin_inc_body.txt');
file_put_contents('/tmp/ta/standin_inc.php', $INC);
@mkdir('/tmp/ta', 0777, true);

// ---------- 登录 ----------
$res = http('/api/admin/login.php', ['username' => 'ta_test', 'password' => 'ta-test', 'whiteboard' => '0']);
ok($res['code'] === 0, '测试服务登录');
$COOKIE = grabCookie();
ok($COOKIE !== '', '会话Cookie获取');
$pdo = db();
// 重新生成 inc（带正确 Cookie）
$INC = "<?php
\$BASE = 'http://127.0.0.1:8080';
\$COOKIE = " . var_export($COOKIE, true) . ";
"
    . file_get_contents('/tmp/ta/standin_inc_body.txt');
file_put_contents('/tmp/ta/standin_inc.php', $INC);

// ---------- S1 任务创建先取得行锁 → OCR保存被繁忙守卫拒绝 ----------
@unlink('/tmp/ta/lock_s1'); @unlink('/tmp/ta/go_s1'); @unlink('/tmp/ta/s1_result.json');
$p = runChild('require "/tmp/ta/standin_inc.php"; engineStandinCreateJob(5001, "/tmp/ta/lock_s1", "/tmp/ta/go_s1", "/tmp/ta/s1_result.json");');
ok(waitFile('/tmp/ta/lock_s1', 20), 'S1 占位角色已取得行锁');
$res = http('/api/admin/essay/save_ocr.php', ['image_id' => 6001, 'ocr_text' => 'S1不应保存成功']);
file_put_contents('/tmp/ta/go_s1', '1');
ok(waitFile('/tmp/ta/s1_result.json', 15), 'S1 占位角色完成');
$sr = json_decode(file_get_contents('/tmp/ta/s1_result.json'), true);
proc_close($p);
ok(isset($res['msg']) && strpos($res['msg'], '进行中的批改任务') !== false, 'S1 OCR保存被繁忙守卫拒绝');
ok(isset($sr['code']) && $sr['code'] === 0, 'S1 任务创建（持锁方）成功');
$t = db()->query("SELECT ocr_text FROM essay_images WHERE id = 6001")->fetchColumn();
ok($t === '第一页原始文本', 'S1 拒绝后正文未被修改');

// ---------- S2 OCR保存先完成 → 任务创建随后读到的正文=修正后内容 ----------
$pdo->exec("DELETE FROM grader_job_items WHERE submission_id = 5001");
$pdo->exec("DELETE FROM grader_jobs WHERE id NOT IN (SELECT job_id FROM grader_job_items)");
$res = http('/api/admin/essay/save_ocr.php', ['image_id' => 6001, 'ocr_text' => '第一页已修正文本']);
ok($res['code'] === 0, 'S2 无任务时OCR保存成功');
// 清掉 S1 的任务，模拟"任务尚未创建"
$pdo = db();
$jid1 = $sr['job_id'] ?? 0;
if ($jid1) { $pdo->exec("DELETE FROM grader_job_items WHERE job_id = $jid1"); $pdo->exec("DELETE FROM grader_jobs WHERE id = $jid1"); }
file_put_contents('/tmp/ta/standin_s2.php', '<?php require "/tmp/ta/standin_inc.php";
$r = engineStandinCreateJob(5001);
$row = db()->query("SELECT content, word_count FROM essay_submissions WHERE id = 5001")->fetch(PDO::FETCH_ASSOC);
file_put_contents("/tmp/ta/s2_result.json", json_encode(["r" => $r, "content" => $row]));');
shell_exec('php /tmp/ta/standin_s2.php');
waitFile('/tmp/ta/s2_result.json', 15);
$s2 = json_decode(file_get_contents('/tmp/ta/s2_result.json'), true);
ok(isset($s2['r']['code']) && $s2['r']['code'] === 0, 'S2 任务创建（保存提交后）成功');
ok(strpos((string)$s2['content']['content'], '第一页已修正文本') !== false, 'S2 任务创建读到修正后正文');
ok((int)$s2['content']['word_count'] > 0, 'S2 字数已重建');

// ---------- S3 排队中：保存/删除/移页/排序 全拒且状态不变 ----------
$textBefore = db()->query("SELECT ocr_text FROM essay_images WHERE id = 6001")->fetchColumn();
$imgCount = db()->query("SELECT COUNT(*) FROM essay_images WHERE submission_id IN (5001,5002)")->fetchColumn();
$r1 = http('/api/admin/essay/save_ocr.php', ['image_id' => 6001, 'ocr_text' => 'S3尝试修改']);
$r2 = http('/api/admin/essay/grader.php?action=delete_pending', ['id' => 5001]);
$r3 = http('/api/admin/essay/grader.php?action=page_move', ['image_id' => 6002, 'target_submission_id' => 5002]);
$r4 = http('/api/admin/essay/grader.php?action=page_reorder', ['image_id' => 6001, 'direction' => 'up']);
$jobs = $pdo->query("SELECT id FROM grader_jobs WHERE status = 'queued' ORDER BY id DESC LIMIT 1")->fetchColumn();
$pdo->exec("DELETE FROM grader_job_items WHERE job_id = $jobs");
$pdo->exec("DELETE FROM grader_jobs WHERE id = $jobs");
foreach ([$r1, $r2, $r3, $r4] as $i => $r) {
    ok($r['code'] !== 0 && strpos($r['msg'], '进行中的批改任务') !== false, 'S3.' . ($i + 1) . ' 排队中被拒: ' . substr((string)$r['msg'], 0, 44));
}
ok(db()->query("SELECT ocr_text FROM essay_images WHERE id = 6001")->fetchColumn() === $textBefore, 'S3 正文未变');
ok(db()->query("SELECT COUNT(*) FROM essay_images WHERE submission_id IN (5001,5002)")->fetchColumn() == $imgCount, 'S3 图片总数未变');

// ---------- S4 子项失败、批量任务仍运行：失败篇可修正，运行篇受保护 ----------
$pdo->exec("INSERT INTO grader_jobs (grade_model, status, total, created_by) VALUES ('test-model','running',2,'ta-test')");
$jid2 = $pdo->lastInsertId();
$pdo->exec("INSERT INTO grader_job_items (job_id, submission_id, status) VALUES ($jid2, 5001, 'failed'), ($jid2, 5002, 'running')");
$r = http('/api/admin/essay/save_ocr.php', ['image_id' => 6001, 'ocr_text' => '失败篇允许修正']);
ok($r['code'] === 0, 'S4 失败子项所在篇允许修正');
$r = http('/api/admin/essay/save_ocr.php', ['image_id' => 6003, 'ocr_text' => '运行篇不应被修改']);
ok($r['code'] !== 0 && strpos($r['msg'], '进行中的批改任务') !== false, 'S4 运行中子项所在篇被拒');
$pdo->exec("DELETE FROM grader_job_items WHERE job_id = $jid2");
$pdo->exec("DELETE FROM grader_jobs WHERE id = $jid2");

// ---------- S5 两人同时移页（同一张图 → 同一目标） ----------
$pdo->exec("DELETE FROM grader_job_items");
$pdo->exec("DELETE FROM grader_jobs");
@unlink('/tmp/ta/m1.json'); @unlink('/tmp/ta/m2.json');
$p1 = runChild('require "/tmp/ta/standin_inc.php"; file_put_contents("/tmp/ta/m1.json", json_encode(http("/api/admin/essay/grader.php?action=page_move", ["image_id" => 6002, "target_submission_id" => 5002])));');
$p2 = runChild('require "/tmp/ta/standin_inc.php"; file_put_contents("/tmp/ta/m2.json", json_encode(http("/api/admin/essay/grader.php?action=page_move", ["image_id" => 6002, "target_submission_id" => 5002])));');
waitFile('/tmp/ta/m1.json', 30); waitFile('/tmp/ta/m2.json', 30);
proc_close($p1); proc_close($p2);
$dup = db()->query("SELECT COUNT(*) FROM essay_images WHERE image_url = '/uploads/essays/t2.jpg'")->fetchColumn();
$cons1 = db()->query("SELECT GROUP_CONCAT(page_no ORDER BY page_no) FROM essay_images WHERE submission_id = 5001")->fetchColumn();
$cons2 = db()->query("SELECT GROUP_CONCAT(page_no ORDER BY page_no) FROM essay_images WHERE submission_id = 5002")->fetchColumn();
$m1 = json_decode(file_get_contents('/tmp/ta/m1.json'), true);
$m2 = json_decode(file_get_contents('/tmp/ta/m2.json'), true);
ok((int)$dup === 1, 'S5 并发移页后该图仅存一份');
ok($cons1 === '1' && $cons2 === '1,2', "S5 两侧页序连续 (5001:$cons1 / 5002:$cons2)");
ok(($m1['code'] === 0) xor ($m2['code'] === 0), 'S5 恰好一个成功一个被拒');

// ---------- S6 操作失败：事务回滚、明确报错 ----------
$pdo->exec("INSERT INTO grader_jobs (grade_model, status, total, created_by) VALUES ('test-model','queued',1,'ta-test')");
$jid3 = $pdo->lastInsertId();
$pdo->exec("INSERT INTO grader_job_items (job_id, submission_id, status) VALUES ($jid3, 5001, 'pending')");
$imgIn5001 = db()->query("SELECT id FROM essay_images WHERE submission_id = 5001")->fetchColumn();
$r = http('/api/admin/essay/grader.php?action=page_move', ['image_id' => $imgIn5001, 'target_submission_id' => 5002]);
ok($r['code'] !== 0, 'S6 busy下移页被拒(源篇排队)');
ok(db()->query("SELECT COUNT(*) FROM essay_images WHERE submission_id = 5001")->fetchColumn() == 1, 'S6 回滚后5001图片数不变');
$r = http('/api/admin/essay/grader.php?action=delete_pending', ['id' => 5001]);
ok($r['code'] !== 0 && strpos($r['msg'], '进行中的批改任务') !== false, 'S6 busy下删除被拒');
ok(db()->query("SELECT COUNT(*) FROM essay_images WHERE submission_id = 5001")->fetchColumn() == 1, 'S6 回滚后图片仍在');
ok(db()->query("SELECT status FROM essay_submissions WHERE id = 5001")->fetchColumn() === 'pending', 'S6 状态仍为pending');

echo "================\nRESULT: " . ($FAILS === 0 ? 'ALL PASS' : "$FAILS FAILURES") . "\n";
echo "---- 最终数据库状态 ----\n";
foreach ([
    'essay_submissions' => "SELECT id, student_id, status, word_count FROM essay_submissions ORDER BY id",
    'essay_images' => "SELECT id, submission_id, page_no, ocr_text FROM essay_images ORDER BY submission_id, page_no, id",
    'grader_jobs' => "SELECT id, status, total FROM grader_jobs ORDER BY id",
] as $name => $q) {
    echo "[$name]\n";
    foreach (db()->query($q) as $r) echo json_encode($r, JSON_UNESCAPED_UNICODE) . "\n";
}
exit($FAILS === 0 ? 0 : 1);
