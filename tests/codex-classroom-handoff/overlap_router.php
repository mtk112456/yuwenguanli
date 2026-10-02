<?php
if (parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) === '/__test_overlap') {
    if (getenv('DB_NAME') !== 'class_manager_ta_test') { http_response_code(403); return true; }
    $start = microtime(true);
    usleep(600000);
    header('Content-Type: application/json');
    echo json_encode(['pid'=>getmypid(),'start'=>$start,'end'=>microtime(true)]);
    return true;
}
require '/tmp/ta/ta_router.original.php';
