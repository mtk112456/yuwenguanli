<?php
/**
 * 幂等 v2 验收（隔离库 + 容器内 127.0.0.1:8080）：断言式
 * 覆盖：同键顺序/并发/不同参数/不同管理员/op_result 三态/重复撤销/归组幂等
 */
// 硬校验：本套件只允许在隔离库执行，任何写操作前先确认库名
if (getenv('DB_NAME') !== 'class_manager_ta_test') {
    echo "GUARD FAIL | DB_NAME 必须为 class_manager_ta_test，当前: " . getenv('DB_NAME') . "
";
    exit(9);
}
$FAILS = 0;
function ok($cond, $name) {
    global $FAILS;
    echo ($cond ? 'PASS' : 'FAIL') . " | $name\n";
    if (!$cond) $FAILS++;
}
$BASE = 'http://127.0.0.1:8080';
function http($path, $post = null, $cookie = '') {
    $hdr = "Content-Type: application/x-www-form-urlencoded\r\nCookie: $cookie\r\n";
    $ctx = stream_context_create(['http' => [
        'method' => $post !== null ? 'POST' : 'GET',
        'header' => $hdr,
        'content' => $post !== null ? http_build_query($post) : '',
        'ignore_errors' => true, 'timeout' => 40,
    ]]);
    return json_decode(@file_get_contents($BASE . $path, false, $ctx), true) ?: ['code' => -1, 'msg' => 'HTTP_FAIL'];
}
function db() {
    return new PDO(
        'mysql:host=' . getenv('DB_HOST') . ';dbname=' . getenv('DB_NAME') . ';charset=utf8mb4',
        getenv('DB_USER'), getenv('DB_PASS'),
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
}
function login($u, $p) {
    global $BASE, $LASTHEADERS;
    $ck = '';
    http('/api/admin/login.php', ['username' => $u, 'password' => $p, 'whiteboard' => '0']);
    foreach ((array)$LASTHEADERS as $h) {
        if (preg_match('/Set-Cookie:\s*(PHPSESSID=[^;]+)/', $h, $m)) $ck = $m[1];
    }
    return $ck;
}
function sid($name) {
    return (int)db()->query("SELECT id FROM students WHERE name = '$name'")->fetchColumn();
}
function stuState($name) {
    return db()->query("SELECT score, version FROM students WHERE name = '$name'")->fetch(PDO::FETCH_ASSOC);
}

// 双管理员（夹具：T撤甲 + 第二管理员）
$ckA = login('ta_test', 'ta-test');
$pdo = db();
$pdo->exec("INSERT IGNORE INTO admin (username, password, nickname) VALUES ('ta_test2', '" . password_hash('ta-test2', PASSWORD_DEFAULT) . "', '测试二号')");
$ckB = login('ta_test2', 'ta-test2');
ok($ckA && $ckB, '双管理员登录');

$SID = sid('T撤甲');
$before = stuState('T撤甲');

// S1 同键顺序两次：分数只变一次、日志一份、结果相同
$k1 = 't2-seq-' . uniqid();
$r1 = http('/api/admin/score/batch_update.php', ['student_ids[]' => $SID, 'change_value' => 2, 'type' => 'reward', 'reason' => 'idem-v2', 'source' => '', 'op_key' => $k1], $ckA);
$r2 = http('/api/admin/score/batch_update.php', ['student_ids[]' => $SID, 'change_value' => 2, 'type' => 'reward', 'reason' => 'idem-v2', 'source' => '', 'op_key' => $k1], $ckA);
$after = stuState('T撤甲');
$logs = db()->query("SELECT COUNT(*) FROM score_log WHERE reason = 'idem-v2'")->fetchColumn();
ok($r1['code'] === 0 && $r1['data']['success'] == 1, 'S1 首次执行成功');
ok($r2['data']['replayed'] == true, 'S1 第二次返回重放结果');
ok($r1['data']['log_ids'] == $r2['data']['log_ids'], 'S1 两次返回同一日志ID');
ok((int)$after['score'] === (int)$before['score'] + 2 && $logs === 1, 'S1 分数只变一次、日志一份');

// S2 同键并发：分数只变一次，结果一致（两请求并行）
$k2 = 't2-par-' . uniqid();
$cmdA = "curl -s -m 30 -b " . escapeshellarg($ckA) . " -X POST http://127.0.0.1:8080/api/admin/score/batch_update.php --data 'student_ids%5B%5D=$SID&change_value=3&type=reward&reason=par-v2&source=&op_key=$k2'";
$cmdB = $cmdA; // 同 cookie 同键同参
file_put_contents('/tmp/ta_a.sh', $cmdA . " > /tmp/ta_a.json");
file_put_contents('/tmp/ta_b.sh', $cmdB . " > /tmp/ta_b.json");
shell_exec('nohup sh /tmp/ta_a.sh >/dev/null 2>&1 &');
usleep(120000);
shell_exec('sh /tmp/ta_b.sh');
$deadline = time() + 20;
while (!file_exists('/tmp/ta_a.json') && time() < $deadline) usleep(100000);
$a = json_decode((string)@file_get_contents('/tmp/ta_a.json'), true) ?: ['code' => -1];
$b = json_decode((string)@file_get_contents('/tmp/ta_b.json'), true) ?: ['code' => -1];
$after2 = stuState('T撤甲');
$logs2 = db()->query("SELECT COUNT(*) FROM score_log WHERE reason = 'par-v2'")->fetchColumn();
ok(($a['code'] === 0 && $b['code'] === 0), 'S2 并发两请求均正常返回');
ok($a['data']['log_ids'] == $b['data']['log_ids'], 'S2 两请求返回同一日志（重放一致）');
ok((int)$logs2 === 1 && (int)$after2['score'] === (int)$after['score'] + 3, 'S2 分数只变一次、日志一份');

// S3 同键不同参数：拒绝第二次，不产生新日志
$k3 = 't2-diff-' . uniqid();
http('/api/admin/score/batch_update.php', ['student_ids[]' => $SID, 'change_value' => 1, 'type' => 'reward', 'reason' => 'diff-a', 'source' => '', 'op_key' => $k3], $ckA);
$r3 = http('/api/admin/score/batch_update.php', ['student_ids[]' => $SID, 'change_value' => 9, 'type' => 'reward', 'reason' => 'diff-b', 'source' => '', 'op_key' => $k3], $ckA);
$logs3 = db()->query("SELECT COUNT(*) FROM score_log WHERE reason LIKE 'diff-%'")->fetchColumn();
ok($r3['code'] !== 0 && strpos($r3['msg'], '不同参数') !== false, 'S3 同键不同参数被拒');
ok($logs3 === 1, 'S3 未产生新日志');

// S4 不同管理员相同键：隔离
$k4 = 't2-iso-' . uniqid();
http('/api/admin/score/batch_update.php', ['student_ids[]' => $SID, 'change_value' => 1, 'type' => 'reward', 'reason' => 'iso-test', 'source' => '', 'op_key' => $k4], $ckA);
$r4 = http('/api/admin/score/batch_update.php', ['student_ids[]' => $SID, 'change_value' => 1, 'type' => 'reward', 'reason' => 'iso-test', 'source' => '', 'op_key' => $k4], $ckB);
ok($r4['code'] !== 0 && strpos($r4['msg'], '无权访问') !== false, 'S4 不同管理员同键被隔离拒绝');
$logs4 = db()->query("SELECT COUNT(*) FROM score_log WHERE reason = 'iso-test'")->fetchColumn();
ok($logs4 === 1, 'S4 未产生重复记分');

// S5 op_result 三态（只读）
$k5 = 't2-res-' . uniqid();
$q0 = http('/api/admin/score/op_result.php', ['op_key' => $k5], $ckA);
ok($q0['data']['status'] === 'not_found', 'S5 未提交前查询=not_found（不代表失败）');
http('/api/admin/score/batch_update.php', ['student_ids[]' => $SID, 'change_value' => 1, 'type' => 'reward', 'reason' => 'res-test', 'source' => '', 'op_key' => $k5], $ckA);
$q1 = http('/api/admin/score/op_result.php', ['op_key' => $k5], $ckA);
ok($q1['data']['status'] === 'completed' && (int)$q1['data']['success'] === 1, 'S5 完成后查询返回首次结果');
$q2 = http('/api/admin/score/op_result.php', ['op_key' => $k5], $ckB);
ok($q2['data']['status'] === 'not_found', 'S5 他人查询按 not_found 隔离');
$q3 = http('/api/admin/score/op_result.php', ['op_key' => $k5, 'x' => 1], $ckA);
ok((int)db()->query("SELECT COUNT(*) FROM score_log WHERE reason = 'res-test'")->fetchColumn() === 1, 'S5 查询不产生记分');

// S6 重复撤销：首次恢复，二次拒绝且不改分
$bid = db()->query("SELECT id FROM batch_operations ORDER BY id DESC LIMIT 1")->fetchColumn();
$u1 = http('/api/admin/score/batch_undo.php', ['batch_id' => $bid], $ckA);
$u2 = http('/api/admin/score/batch_undo.php', ['batch_id' => $bid], $ckA);
ok($u1['code'] === 0, 'S6 首次撤销成功');
ok($u2['code'] !== 0, 'S6 重复撤销被拒');
$afterUndo = stuState('T撤甲');
ok((int)$afterUndo['score'] === (int)$before['score'], 'S6 分数恢复原值');

echo "================\nRESULT: " . ($FAILS === 0 ? 'ALL PASS' : "$FAILS FAILURES") . "\n";
echo "---- 最终数据库状态 ----\n";
foreach ([
    'students(307/310)' => "SELECT id, name, score, version FROM students WHERE name LIKE 'T撤%'",
    'score_log' => "SELECT id, student_id, change_value, reason FROM score_log WHERE reason LIKE '%v2%' OR reason LIKE '%test%' ORDER BY id",
    'app_op_dedup' => "SELECT op_key, operator_id, status FROM app_op_dedup ORDER BY create_time",
] as $n => $q) {
    echo "[$n]\n";
    foreach (db()->query($q) as $r) echo json_encode($r, JSON_UNESCAPED_UNICODE) . "\n";
}
exit($FAILS === 0 ? 0 : 1);
