// 同步教师端网页源码：主站源码(admin/teacher/，唯一事实源) → 本仓库 web/ 镜像
// 用法：node sync_web.js
// 方向永远是 主站 → 仓库；要改界面请改主站源码，改完跑一次本脚本再提交
const fs = require('fs');
const path = require('path');

const SRC = 'D:/DeskBox/班级量化考核系统/班级量化考核管理系统网页前后端/admin/teacher';
const DST = path.join(__dirname, 'web', 'admin', 'teacher');

// 自动枚举主站目录全部文件，新增模块不会被清单遗漏
const FILES = fs.readdirSync(SRC).filter(f => fs.statSync(path.join(SRC, f)).isFile());

fs.mkdirSync(DST, { recursive: true });
let changed = 0;
for (const f of FILES) {
    const s = path.join(SRC, f);
    const d = path.join(DST, f);
    if (!fs.existsSync(s)) { console.error('主站缺少', f); process.exit(1); }
    if (fs.existsSync(d) && fs.readFileSync(s).equals(fs.readFileSync(d))) {
        console.log('未变化', f);
        continue;
    }
    fs.copyFileSync(s, d);
    changed++;
    console.log('已同步', f);
}

// 版本戳：记录同步时间与主站目录，便于接手者对齐版本
fs.writeFileSync(path.join(DST, 'SYNC_INFO.txt'),
    '同步时间: ' + new Date().toISOString() + '\n' +
    '唯一事实源: D:/DeskBox/班级量化考核系统/班级量化考核管理系统网页前后端/admin/teacher/\n' +
    '线上地址: https://qi.qnengs.tech/admin/teacher/index.php\n');
console.log('完成，变更文件数:', changed);
