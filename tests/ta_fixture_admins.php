<?php
/**
 * 隔离库夹具：双管理员密码哈希直写（文件方式，避免内联转义）
 * 必须在隔离库建表之后运行；连接目标为 class_manager_ta_test
 */
$pdo = new PDO(
    'mysql:host=' . getenv('DB_HOST') . ';dbname=class_manager_ta_test;charset=utf8mb4',
    getenv('DB_USER'), getenv('DB_PASS'),
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
);
$pdo->exec("INSERT IGNORE INTO admin (username, password, nickname) VALUES ('ta_test', '" . password_hash('ta-test', PASSWORD_DEFAULT) . "', '测试一号')");
$pdo->exec("INSERT IGNORE INTO admin (username, password, nickname) VALUES ('ta_test2', '" . password_hash('ta-test2', PASSWORD_DEFAULT) . "', '测试二号')");
echo "FIXTURE ADMIN OK\n";
