# web/ — 教师端网页源码镜像（交付用）

教师端 App 的界面源码分两层：

| 层 | 位置 | 说明 |
|---|---|---|
| 安卓壳 | 本仓库 `android/` | Capacitor 壳层，加载远程教师端页面 |
| **网页层** | 主站源码 `D:\DeskBox\班级量化考核系统\班级量化考核管理系统网页前后端\admin\teacher\` | **唯一事实源**，实时同步上线到 `https://qi.qnengs.tech/admin/teacher/index.php` |

本目录 `web/admin/teacher/` 是网页层的**交付镜像**，让仅拿到本仓库的人能看到完整界面源码。

## 同步规则

- 方向永远：**主站源码 → 本镜像**。改界面请改主站源码（保存即上线，改前备份），然后运行：
  ```
  node sync_web.js
  ```
  再提交本仓库。
- `SYNC_INFO.txt` 记录最近一次同步时间，用于对齐版本。
- 主站源码目录的 git 历史（提交记录）在 `D:\DeskBox\班级量化考核系统\班级量化考核管理系统网页前后端\.git`。

## 文件清单

- `index.php` — 入口：未登录=教师专属登录页；已登录=App 壳（四 Tab 固定导航 + 工作台 + 全部页 + 主题圆形切换）
- `teacher.css` — 五套主题变量（与 admin/css/admin.css 同源）+ 壳层样式
- `teacher.js` — 壳层逻辑：Tab 管理、iframe 适配层、真实接口工作台、Android 返回键分级、应用内更新
- `app-update.json` — 应用内更新清单（version_code 与 android/app/build.gradle 保持一致）
