<?php
// 测试服务路由：仅在隔离测试服务（127.0.0.1:8080，容器内）启用
// 1) /__test_env 只读环境确认端点（返回 test_mode/database/run_id）
// 2) 其余请求回落到内置服务器的静态/PHP 处理（/var/www/html）
// 本文件存放于容器 /tmp/ta/，绝不进入 webroot，不向生产部署
if (($path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH)) === '/__test_env') {
    header('Content-Type: application/json; charset=utf-8');
    $dbName = 'n/a';
    try {
        $pdo = new PDO(
            'mysql:host=' . getenv('DB_HOST') . ';dbname=' . getenv('DB_NAME') . ';charset=utf8mb4',
            getenv('DB_USER'), getenv('DB_PASS'),
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
        );
        $dbName = (string)$pdo->query('SELECT DATABASE()')->fetchColumn();
    } catch (Throwable $e) {
        http_response_code(500);
        echo json_encode(['test_mode' => true, 'database' => 'ERROR: ' . $e->getMessage(), 'run_id' => getenv('TA_RUN_ID') ?: '']);
        return true;
    }
    echo json_encode([
        'test_mode' => true,
        'database'  => $dbName,
        'run_id'    => getenv('TA_RUN_ID') ?: ''
    ]);
    return true;
}
return false; // 其余请求交由内置服务器处理
