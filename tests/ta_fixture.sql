-- 隔离库夹具：临时班级 + 测试学生（幂等：IGNORE 防重复执行报错）
INSERT IGNORE INTO classes (id, name) VALUES (9001, 'T并发班');
INSERT IGNORE INTO students (id, class_id, name, show_name, id_card, password, score, version)
VALUES (9002, 9001, 'T撤甲', 'T撤甲', 'TU2-1', '', 100, 1);
