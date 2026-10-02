<?php
/**
 * 隔离库构建：以真实库环境运行（读真实表结构）→ 建隔离库 class_manager_ta_test → 夹具
 * 不调用引擎、不触付费模型、不动真实业务数据（只读真实库的 SHOW CREATE TABLE）
 */
$real = new PDO(
    'mysql:host=' . getenv('DB_HOST') . ';dbname=' . getenv('DB_NAME') . ';charset=utf8mb4',
    getenv('DB_USER'), getenv('DB_PASS'),
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
);
$test = 'class_manager_ta_test';
$real->exec("DROP DATABASE IF EXISTS `$test`");
$real->exec("CREATE DATABASE `$test` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci");
$testDb = new PDO(
    "mysql:host=" . getenv('DB_HOST') . ";dbname=$test;charset=utf8mb4",
    getenv('DB_USER'), getenv('DB_PASS'),
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
);

$tables = ['admin', 'classes', 'students', 'essays', 'essay_submissions', 'essay_images',
           'grader_jobs', 'grader_job_items', 'records', 'score_log', 'batch_operations'];
foreach ($tables as $t) {
    $row = $real->query("SHOW CREATE TABLE `$t`")->fetch(PDO::FETCH_NUM);
    $ddl = preg_replace('/AUTO_INCREMENT=\d+ /', '', $row[1]);
    $testDb->exec($ddl);
}

// ---- 夹具 ----
$testDb->exec("INSERT INTO classes (id, name) VALUES (9001, 'T并发班')");
$testDb->exec("INSERT INTO students (id, class_id, name, show_name, id_card, password, score, version)
               VALUES (9001, 9001, 'T并发甲', 'T并发甲', 'TC-1', '', 100, 1)");
$hash = password_hash('ta-test', PASSWORD_DEFAULT);
$testDb->exec("INSERT INTO admin (username, password, nickname) VALUES ('ta_test', '$hash', '并发测试')");
// 作文 5001：pending，2 页（并发主对象）
$testDb->exec("INSERT INTO essay_submissions (id, essay_id, student_id, title, content, word_count, status, scene)
               VALUES (5001, 0, 9001, '并发测试作文', '', 0, 'pending', 'home')");
$testDb->exec("INSERT INTO essay_images (id, submission_id, page_no, image_url, page_type, ocr_text)
               VALUES (6001, 5001, 1, '/uploads/essays/t1.jpg', 'single', '第一页原始文本'),
                      (6002, 5001, 2, '/uploads/essays/t2.jpg', 'body', '第二页原始文本')");
// 作文 5002：pending，1 页（移页目标 / 失败子项可修正对象）
$testDb->exec("INSERT INTO essay_submissions (id, essay_id, student_id, title, content, word_count, status, scene)
               VALUES (5002, 0, 9001, '并发目标篇', '', 0, 'pending', 'home')");
$testDb->exec("INSERT INTO essay_images (id, submission_id, page_no, image_url, page_type, ocr_text)
               VALUES (6003, 5002, 1, '/uploads/essays/t3.jpg', 'single', '目标篇第一页')");

// 校验表结构能容纳后续 INSERT（缺列/无默认列会抛异常，明确报出）
foreach ([
    "SELECT COUNT(*) FROM essay_images",
    "SELECT COUNT(*) FROM essay_submissions",
    "SELECT COUNT(*) FROM admin",
] as $q) { $testDb->query($q)->fetchColumn(); }

echo "SETUP OK tables=" . count($tables) . "\n";
