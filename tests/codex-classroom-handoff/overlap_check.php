<?php
$processes=[];
for ($i=0;$i<2;$i++) {
    $pipes=[];
    $processes[]= [proc_open([PHP_BINARY,'-r','echo file_get_contents("http://127.0.0.1:8080/__test_overlap");'],[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes),$pipes];
}
$results=[];
foreach ($processes as [$p,$pipes]) {
    fclose($pipes[0]); $raw=stream_get_contents($pipes[1]); $err=stream_get_contents($pipes[2]);
    fclose($pipes[1]);fclose($pipes[2]);$exit=proc_close($p);
    if ($exit!==0 || !($d=json_decode($raw,true))) { fwrite(STDERR,"Probe failed: $err $raw");exit(1); }
    $results[]=$d;
}
$ok=$results[0]['pid']!==$results[1]['pid'] && max(array_column($results,'start'))<min(array_column($results,'end'));
echo json_encode(['overlap'=>$ok,'requests'=>$results],JSON_PRETTY_PRINT).PHP_EOL;
exit($ok?0:1);
