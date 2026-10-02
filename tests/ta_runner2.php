<?php
/**
 * 幂等/并发/隔离 验收 runner v3
 * 硬校验前置：实际连接库 = class_manager_ta_test；HTTP 测试服务环境端点匹配 run_id；
 * 登录后身份核对（info.php 只读）；全部前置通过前不执行任何业务写请求。
 * 断言式：ok() 计数；前置失败 exit(9)；业务失败结束 exit(1)。
 */
$FAILS = 0;
$RUN_ID = getenv('TA_RUN_ID') ?: '';

// ================= 前置硬校验 =================
if (!preg_match('/^[A-Za-z0-9_\-]{6,40}$/', $RUN_ID)) {
    echo "GUARD FAIL | TA_RUN_ID 缺失或格式无效\n";
    exit(9);
}

$BASE = 'http://127.0.0.1:8080';
$LASTHEADERS = [];
$COOKIE = '';

function http($path, $post = null, $cookie = null) {
    global $BASE, $LASTHEADERS, $COOKIE;
    $LASTHEADERS = [];
    $useCookie = ($cookie === null) ? $COOKIE : $cookie;
    $hdr = "Content-Type: application/x-www-form-urlencoded\r\n" . ($useCookie !== '' ? "Cookie: $useCookie\r\n" : '');
    $ctx = stream_context_create(['http' => [
        'method' => $post !== null ? 'POST' : 'GET',
        'header' => $hdr,
        'content' => $post !== null ? http_build_query($post) : '',
        'ignore_errors' => true, 'timeout' => 40,
    ]]);
    $raw = @file_get_contents($BASE . $path, false, $ctx);
    $LASTHEADERS = $http_response_header ?? [];
    if ($raw === false) {
        throw new RuntimeException('测试HTTP请求失败: ' . $path);
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        throw new RuntimeException('测试接口未返回有效JSON: ' . $path);
    }
    return $data;
}
function db() {
    return new PDO(
        'mysql:host=' . getenv('DB_HOST') . ';dbname=' . getenv('DB_NAME') . ';charset=utf8mb4',
        getenv('DB_USER'), getenv('DB_PASS'),
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
}
// 期望失败场景用：捕获异常转结果对象
function httpErr($path, $post, $cookie = null) {
    try { return http($path, $post, $cookie); }
    catch (Throwable $e) { return ['code' => -1, 'msg' => $e->getMessage()]; }
}
// 登录：响应成功→提取Cookie→非空→只读身份接口核对
function login($u, $p, $expectUser) {
    global $COOKIE, $LASTHEADERS;
    $COOKIE = '';
    $res = http('/api/admin/login.php', ['username' => $u, 'password' => $p, 'whiteboard' => '0']);
    if (($res['code'] ?? -1) !== 0) {
        throw new RuntimeException('登录失败(' . $u . '): ' . ($res['msg'] ?? '?'));
    }
    $ck = '';
    foreach ($LASTHEADERS as $h) {
        if (preg_match('/Set-Cookie:\s*(PHPSESSID=[^;]+)/', $h, $m)) { $ck = $m[1]; break; }
    }
    if ($ck === '') {
        throw new RuntimeException('登录响应未携带会话Cookie');
    }
    $COOKIE = $ck;
    $info = http('/api/admin/info.php');
    $uname = $info['data']['username'] ?? '';
    if ($uname !== $expectUser) {
        throw new RuntimeException('身份核对失败: 期望 ' . $expectUser . ' 实际 ' . $uname);
    }
    echo "IDENTITY OK | $expectUser (id=" . ($info['data']['id'] ?? '?') . ")\n";
    return $ck;
}

function ok($cond, $name) {
    global $FAILS;
    echo ($cond ? 'PASS' : 'FAIL') . " | $name\n";
    if (!$cond) $FAILS++;
}
function stuState($id) {
    return db()->query("SELECT score, version FROM students WHERE id = " . (int)$id)->fetch(PDO::FETCH_ASSOC);
}
function runChild($code) {
    $spec = [['pipe','r'],['pipe','w'],['pipe','w']];
    return proc_open('php -r ' . escapeshellarg($code), $spec, $pipes);
}

// ================= 前置1：实际连接库 =================
try {
    $pdo = db();
    $dbName = $pdo->query('SELECT DATABASE()')->fetchColumn();
} catch (Throwable $e) {
    echo "GUARD FAIL | 数据库连接失败: " . $e->getMessage() . "\n";
    exit(9);
}
if ($dbName !== 'class_manager_ta_test') {
    echo "GUARD FAIL | DB=" . $dbName . " (must be class_manager_ta_test)\n";
    exit(9);
}
echo "GUARD OK | 数据库 = $dbName\n";

// ================= 前置2：HTTP 测试服务环境端点 =================
try {
    $env = http('/__test_env');
} catch (Throwable $e) {
    echo "GUARD FAIL | 环境端点不可访问: " . $e->getMessage() . "\n";
    exit(9);
}
if (($env['test_mode'] ?? false) !== true) { echo "GUARD FAIL | test_mode != true\n"; exit(9); }
if (($env['database'] ?? '') !== 'class_manager_ta_test') { echo "GUARD FAIL | 测试服务实际库: " . ($env['database'] ?? '') . "\n"; exit(9); }
echo "run_id hex (runner): len=" . strlen($RUN_ID) . " hex=" . bin2hex($RUN_ID) . "
";
echo "run_id hex (endpoint): len=" . strlen(($env["run_id"] ?? "")) . " hex=" . bin2hex($env["run_id"] ?? "") . "
";
if (trim($env["run_id"] ?? "") !== $RUN_ID) {
    echo "GUARD FAIL | run_id mismatch (expect " . $RUN_ID . " got " . ($env["run_id"] ?? "") . ")
";
    exit(9);
}
echo "GUARD OK | 测试服务环境 (run_id=$RUN_ID)\n";

// ================= 前置3：双管理员登录 + 身份核对 =================
try {
    $ckA = login('ta_test', 'ta-test', 'ta_test');
    $ckB = login('ta_test2', 'ta-test2', 'ta_test2');
} catch (Throwable $e) {
    echo "GUARD FAIL | " . $e->getMessage() . "\n";
    exit(9);
}

// ================= 业务场景 =================
$SID = (int)db()->query("SELECT id FROM students WHERE name = 'T撤甲'")->fetchColumn();
$before = stuState($SID);
echo "FIXTURE | 学生 $SID 初始分 " . $before['score'] . " v" . $before['version'] . "\n";
$baseLogCount = (int)db()->query("SELECT COUNT(*) FROM score_log WHERE student_id = $SID")->fetchColumn();

// ---- S1 同键顺序重发：分数只动一次、日志一份、结果一致 ----
$k1 = $RUN_ID . '-seq';
$r1 = http('/api/admin/score/batch_update.php', ['student_ids[]' => $SID, 'change_value' => 2, 'type' => 'reward', 'reason' => 'v3-seq', 'source' => '', 'op_key' => $k1], $ckA);
$r2 = http('/api/admin/score/batch_update.php', ['student_ids[]' => $SID, 'change_value' => 2, 'type' => 'reward', 'reason' => 'v3-seq', 'source' => '', 'op_key' => $k1], $ckA);
$st1 = stuState($SID);
$n1 = (int)db()->query("SELECT COUNT(*) FROM score_log WHERE student_id = $SID AND reason = 'v3-seq'")->fetchColumn();
ok($r1['code'] === 0 && (int)$r1['data']['success'] === 1, 'S1 首次执行成功');
ok(($r2['data']['replayed'] ?? false) === true, 'S1 第二次返回重放结果');
ok($r1['data']['log_ids'] === $r2['data']['log_ids'], 'S1 两次返回同一日志ID');
ok((int)$st1['score'] === (int)$before['score'] + 2 && $n1 === 1, 'S1 分数只变一次、日志一份');

// ---- S2 同键并发重发：真正重叠执行（两个并行子进程） ----
$k2 = $RUN_ID . '-par';
$ckA2 = login('ta_test', 'ta-test', 'ta_test');
$inc = '/tmp/ta/child_inc.php';
$child = <<<'CHILD'
<?php
$config=json_decode(file_get_contents($argv[1]),true);
$deadline=microtime(true)+10;
touch($argv[2].'.ready');
while(!file_exists('/tmp/ta/start.flag') && microtime(true)<$deadline) usleep(10000);
if(!file_exists('/tmp/ta/start.flag'))exit(3);
$ctx=stream_context_create(['http'=>['method'=>'POST','header'=>"Content-Type: application/x-www-form-urlencoded\r\nCookie: ".$config['cookie']."\r\n",'content'=>http_build_query($config['post']),'ignore_errors'=>true,'timeout'=>20]]);
$raw=file_get_contents('http://127.0.0.1:8080/api/admin/score/batch_update.php',false,$ctx);
$data=json_decode($raw,true);
if(!is_array($data))exit(4);
file_put_contents($argv[2],json_encode($data));
CHILD;
file_put_contents($inc,$child);
@unlink('/tmp/ta/start.flag');
$processes=[];
foreach(['a'=>$ckA,'b'=>$ckA2] as $label=>$cookie){
 $out='/tmp/ta/par_'.$label.'.json';@unlink($out);@unlink($out.'.ready');
 $config='/tmp/ta/config_'.$label.'.json';
 file_put_contents($config,json_encode(['cookie'=>$cookie,'post'=>['student_ids'=>[$SID],'change_value'=>3,'type'=>'reward','reason'=>'v3-par','source'=>'','op_key'=>$k2]]));chmod($config,0600);
 $processes[]=proc_open([PHP_BINARY,$inc,$config,$out],[['file','/dev/null','r'],['file','/tmp/ta/child_'.$label.'.stdout','w'],['file','/tmp/ta/child_'.$label.'.stderr','w']],$pipes);
}
$deadline=microtime(true)+10;
while((!file_exists('/tmp/ta/par_a.json.ready')||!file_exists('/tmp/ta/par_b.json.ready'))&&microtime(true)<$deadline)usleep(10000);
touch('/tmp/ta/start.flag');
foreach($processes as $proc){$exit=proc_close($proc);ok($exit===0,'S2 子进程正常退出');}
$a=json_decode((string)@file_get_contents('/tmp/ta/par_a.json'),true)?:['code'=>-1];
$b=json_decode((string)@file_get_contents('/tmp/ta/par_b.json'),true)?:['code'=>-1];
@unlink('/tmp/ta/config_a.json');@unlink('/tmp/ta/config_b.json');
$st2 = stuState($SID);
$n2 = (int)db()->query("SELECT COUNT(*) FROM score_log WHERE student_id = $SID AND reason = 'v3-par'")->fetchColumn();
ok($a['code'] === 0 && $b['code'] === 0, 'S2 并发两请求均正常返回（无错误响应）');
ok(!empty($a['data']['log_ids']) && ($a['data']['log_ids'] ?? []) === ($b['data']['log_ids'] ?? []), 'S2 两请求返回同一日志（重放一致）');
ok($n2 === 1 && (int)$st2['score'] === (int)$st1['score'] + 3, 'S2 分数只变一次、日志一份');

// ---- S3 同键不同参数：明确拒绝，不修改分数 ----
$k3 = $RUN_ID . '-diff';
http('/api/admin/score/batch_update.php', ['student_ids[]' => $SID, 'change_value' => 1, 'type' => 'reward', 'reason' => 'v3-diff-a', 'source' => '', 'op_key' => $k3], $ckA);
$r3 = httpErr('/api/admin/score/batch_update.php', ['student_ids[]' => $SID, 'change_value' => 9, 'type' => 'reward', 'reason' => 'v3-diff-b', 'source' => '', 'op_key' => $k3], $ckA);
$n3 = (int)db()->query("SELECT COUNT(*) FROM score_log WHERE reason LIKE 'v3-diff-%'")->fetchColumn();
ok($r3['code'] !== 0 && strpos($r3['msg'], '不同参数') !== false, 'S3 同键不同参数被拒: ' . substr($r3['msg'], 0, 40));
ok($n3 === 1, 'S3 未产生新日志');

// ---- S4 不同管理员相同键：隔离拒绝 ----
$k4 = $RUN_ID . '-iso';
// 固定流程：A 创建 → B 同键重发被隔离拒绝 → A 重发返回原结果
$r4a = http('/api/admin/score/batch_update.php', ['student_ids[]' => $SID, 'change_value' => 1, 'type' => 'reward', 'reason' => 'v3-iso', 'source' => '', 'op_key' => $k4], $ckA);
$r4b = httpErr('/api/admin/score/batch_update.php', ['student_ids[]' => $SID, 'change_value' => 1, 'type' => 'reward', 'reason' => 'v3-iso', 'source' => '', 'op_key' => $k4], $ckB);
$r4c = http('/api/admin/score/batch_update.php', ['student_ids[]' => $SID, 'change_value' => 1, 'type' => 'reward', 'reason' => 'v3-iso', 'source' => '', 'op_key' => $k4], $ckA);
ok($r4a['code'] === 0 && (int)$r4a['data']['success'] === 1, 'S4 A首次执行成功');
ok($r4b['code'] !== 0 && strpos($r4b['msg'], '无权访问') !== false, 'S4 他人操作被隔离拒绝: ' . substr($r4b['msg'], 0, 40));
ok(($r4c['data']['replayed'] ?? false) === true && $r4c['data']['log_ids'] === $r4a['data']['log_ids'], 'S4 A重发返回原结果');

// ---- S5 只读查询三态：查询前后分数/日志不变 ----
$k5 = $RUN_ID . '-res';
$pre = stuState($SID); $preLogs = (int)db()->query("SELECT COUNT(*) FROM score_log WHERE student_id = $SID")->fetchColumn();
$q0 = http('/api/admin/score/op_result.php', ['op_key' => $k5]);
ok(($q0['data']['status'] ?? '') === 'not_found', 'S5 未提交前查询=not_found（不代表失败）');
$resCreate = http('/api/admin/score/batch_update.php', ['student_ids[]' => $SID, 'change_value' => 1, 'type' => 'reward', 'reason' => 'v3-res', 'source' => '', 'op_key' => $k5], $ckA);
$q1 = http('/api/admin/score/op_result.php', ['op_key' => $k5], $ckA);
ok(($q1['data']['status'] ?? '') === 'completed' && (int)($q1['data']['success'] ?? 0) === 1, 'S5 完成后查询返回首次结果');
$post = stuState($SID); $postLogs = (int)db()->query("SELECT COUNT(*) FROM score_log WHERE student_id = $SID")->fetchColumn();
ok($pre['score'] === $post['score'] - 1 && $preLogs === $postLogs - 1, 'S5 查询前后：分数与日志只因该次操作变化一次');
$q2 = http('/api/admin/score/op_result.php', ['op_key' => $k5], $ckB);
ok(($q2['data']['status'] ?? '') === 'not_found', 'S5 他人查询按 not_found 隔离');

// ---- S7 归组重试幂等：同日志集合返回原分组 ----
$logId = (int)($resCreate['data']['log_ids'][0] ?? 0);
$g1 = http('/api/admin/score/batch_store.php', ['log_ids[]' => $logId, 'content' => 'v3-归组'], $ckA);
$g2 = http('/api/admin/score/batch_store.php', ['log_ids[]' => $logId, 'content' => 'v3-归组'], $ckA);
ok($g1['code'] === 0, 'S7 首次归组成功');
ok(($g2['data']['existed'] ?? false) === true && (int)$g2['data']['id'] === (int)$g1['data']['id'], 'S7 重试返回原分组（existed）');
$nGroups = (int)db()->query("SELECT COUNT(*) FROM batch_operations WHERE log_ids = '" . $logId . "'")->fetchColumn();
ok($nGroups === 1, 'S7 分组仅一份');

// ---- S8 重复撤销：首次恢复，二次拒绝且不改分 ----
$bid = (int)($g1['data']['id'] ?? 0);
$scoreBeforeUndo = stuState($SID);
$u1 = http('/api/admin/score/batch_undo.php', ['batch_id' => $bid], $ckA);
$scoreAfterUndo = stuState($SID);
$u2 = http('/api/admin/score/batch_undo.php', ['batch_id' => $bid], $ckA);
$final = stuState($SID);
ok($u1['code'] === 0, 'S8 首次撤销成功: ' . substr($u1['msg'] ?? '', 0, 60));
ok($u2['code'] !== 0, 'S8 重复撤销被拒: ' . substr($u2['msg'] ?? '', 0, 60));
$expectedAfter = (int)$scoreBeforeUndo['score'] - 1;
ok((int)$final["score"] === $expectedAfter, sprintf("S8 score=%d (before %d)", $expectedAfter, $scoreBeforeUndo["score"] ?? 0));
ok((int)$final['score'] === (int)$scoreAfterUndo['score'], 'S8 二次拒绝后分数不变');
$replayAfterUndo = http('/api/admin/score/batch_update.php', ['student_ids[]' => $SID, 'change_value' => 1, 'type' => 'reward', 'reason' => 'v3-res', 'source' => '', 'op_key' => $k5], $ckA);
ok(($replayAfterUndo['data']['replayed'] ?? false) === true, 'S9 撤销后原键返回历史结果');
ok((int)stuState($SID)['score'] === (int)$final['score'] && (int)db()->query('SELECT COUNT(*) FROM score_log WHERE id = ' . $logId)->fetchColumn() === 0, 'S9 撤销后重发不重新加分或创建日志');

// ================= 全失败明细（不存在学生 → no_effect + failed_detail） =================
$rNoeff = http('/api/admin/score/batch_update.php', ['student_ids[]' => 999999, 'change_value' => -1, 'type' => 'punish', 'reason' => 'v3-noeff', 'source' => '', 'op_key' => $RUN_ID . '-noeff']);
ok($rNoeff['code'] === 0 && (int)($rNoeff['data']['success'] ?? -1) === 0 && count($rNoeff['data']['failed_detail'] ?? []) === 1, '全失败返回 no_effect + failed_detail 明细');

echo "================\nRESULT: " . ($FAILS === 0 ? 'ALL PASS' : "$FAILS FAILURES") . "\n";
echo "---- 最终数据库状态 ----\n";
foreach ([
    'students' => "SELECT id, name, score, version FROM students ORDER BY id",
    'score_log(测试事由)' => "SELECT id, student_id, change_value, reason FROM score_log WHERE reason LIKE 'v3-%' ORDER BY id",
    'app_op_dedup' => "SELECT op_key, operator_id, status FROM app_op_dedup ORDER BY op_key",
    'batch_operations(测试)' => "SELECT id, content, log_ids FROM batch_operations WHERE content LIKE 'v3-%'",
] as $n => $q) {
    echo "[$n]\n";
    foreach (db()->query($q) as $r) echo json_encode($r, JSON_UNESCAPED_UNICODE) . "\n";
}
exit($FAILS === 0 ? 0 : 1);
