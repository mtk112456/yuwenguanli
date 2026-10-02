<?php
$env=json_decode(file_get_contents('http://127.0.0.1:8080/__test_env'),true);
if(($env['database']??'')!=='class_manager_ta_test'||($env['test_mode']??false)!==true)exit(9);
putenv('TA_RUN_ID='.$env['run_id']);
putenv('DB_NAME=class_manager');
require '/tmp/ta/ta_setup.php';
putenv('DB_NAME=class_manager_ta_test');
$pdo=new PDO('mysql:host='.getenv('DB_HOST').';dbname=class_manager_ta_test;charset=utf8mb4',getenv('DB_USER'),getenv('DB_PASS'),[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
if($pdo->query('SELECT DATABASE()')->fetchColumn()!=='class_manager_ta_test')exit(9);
$pdo->exec("INSERT INTO students(id,class_id,name,show_name,id_card,password,score,version) VALUES(9002,9001,'T撤甲','T撤甲','CODEX-9002','',100,1)");
foreach(['ta_test'=>'ta-test','ta_test2'=>'ta-test2'] as $u=>$p){
 $q=$pdo->prepare('INSERT INTO admin(username,password,nickname) VALUES(?,?,?) ON DUPLICATE KEY UPDATE password=VALUES(password)');$q->execute([$u,password_hash($p,PASSWORD_DEFAULT),$u]);
}
require '/tmp/ta/ta_runner2.php';
