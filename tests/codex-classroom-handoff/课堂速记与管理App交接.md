# 课堂速记与管理 App 交接

## 1. 接手结论

本批课堂速记可靠性修复已上线，后端隔离测试 **28 条断言全部通过**；客户端离线模拟 P1–P4、身份缺失保护、三个宽度 × 五主题模块检查通过，未捕获 JS 错误。

请从“整个 App 联调与安卓真机验收”继续，不要重新陷入管理员密码、旧 runner、残留夹具的循环。不能把本次模块验收写成整个管理 App 已完成。背诵看板等后续页面仍未在本批开发。

历史聊天里多次“已上线”“全部通过”“只是测试问题”的报告互相矛盾。以本交接、当前源码、完整输出和实际核验为准，不以旧报告作证据。

## 2. 源码、部署和提交

| 项目 | 位置或记录 |
|---|---|
| 主站唯一源码 | `D:\DeskBox\班级量化考核系统\班级量化考核管理系统网页前后端` |
| Android 与交付仓库 | `D:\DeskBox\班级量化考核系统\管理app` |
| GitHub | https://github.com/mtk112456/yuwenguanli |
| 教师入口 | https://qi.qnengs.tech/admin/teacher/ |
| 服务器主站目录 | `/srv/teaching/html` |
| Web 容器 | `teaching-app-web-1`，主站挂载 `/var/www/html` |
| 数据库容器 | `teaching-app-db-1` |
| 生产库 / 隔离库 | `class_manager` / `class_manager_ta_test` |
| 主站本批提交 | `979aee0`：客户端恢复与身份保护 |
| 管理 App 本批提交 | `ff857a9`：正式 runner 修复和课堂速记镜像 |

这两个提交已经在本地仓库生成；本批没有执行 GitHub push，不要宣称远端已包含它们。网页已实际上传到服务器，上传不是靠提交推断。

主站文件 `admin/teacher/teacher-classroom.js`、服务器同路径、交付镜像 `web/admin/teacher/teacher-classroom.js` 本批上传核验的 SHA256：

`34dea90fd44239e7ef967b47dc3b52c192a69820353f675e8386f287fd720e9b`

注意 Git 的换行转换可能使后续检出文件字节改变。新一轮部署应重新计算实际文件哈希，不盲用上述值。主站另有其他未提交修改，不能一并提交、还原或部署。

## 3. 本批实际修复

### 3.1 正式后端 runner

正式文件为管理 App 仓库 `tests/ta_runner2.php`，不是 tmp 中的历史副本。

- S2 改为 `proc_open` 启动 PHP 文件，明确传入 URL、Cookie、输出路径；使用同管理员的两个独立登录会话。
- 两个子进程先就绪，再共同开始；检查退出码、有效成功响应和非空日志 ID，避免“两个空值相等”假通过。
- 保留严格断言：分数**恰好 +3**、日志**恰好 1 条**，没有放宽成“至少生效一次”。
- 预期失败调用明确传 Cookie，避免 A/B 身份串扰。
- 归组的日志 ID 来自前序接口响应，撤销的分组 ID 来自归组响应；不按 reason 搜索，也不点真实历史列表第一条。
- 增加撤销后重发原 op_key：返回历史响应，但不重新加分、不创建新日志。

### 3.2 客户端真实 bug

文件为主站 `admin/teacher/teacher-classroom.js`。

原查询完成分支调用的 `finishOk` 只在提交弹窗的局部作用域定义。刷新后从固定入口查询成功，会找不到函数；这确实是客户端 bug，不能归咎于测试。

已抽成共享 `finishConfirmed(d, pend)`，提交和查询都进入同一收尾流程；归组失败继续保留待归组入口。

同时：

- 管理员 ID 从服务端注入的 `data-admin-id` 读取，并要求有效正整数；缺失时提示重新登录、阻止提交。
- 未确认操作存在时先进入查询流程；待归组存在时先处理归组，避免新操作覆盖恢复记录。
- 不再依赖 localStorage 管理员 ID 或 `x` 兜底。

本批未修改上述后端业务接口实现，它们来自前序开发；本批对相关行为进行隔离验证。

## 4. 证据和测试范围

交接附件目录 `tests/codex-classroom-handoff/` 包含：

- `backend-verification.txt`：完整后端输出，含身份、环境前置校验、28 PASS、最终数据库状态。
- `client-verification.txt`：P1–P4、身份保护、布局点击和 JS 错误记录。
- `run_isolated.php`：本批真正成功使用的干净环境启动/夹具/runner 入口。
- `verify_classroom.cjs`：完全模拟接口的浏览器模块测试。
- `overlap_router.php` / `overlap_check.php`：测试服务器并行探针。
- `classroom-ui/`：15 张模块截图。

后端覆盖：顺序与并发同键重发、同键不同参数拒绝、管理员隔离、只读查询、归组幂等、首次/重复撤销、撤销后重发、全失败明细。

独立并行探针也通过：两个服务器 worker PID 671922、671924，两个约 600ms 执行区间重叠，证明测试服务可并行处理。探针路由已恢复，不在生产 webroot。

客户端 P1–P4：网络失败保留原操作 → 刷新恢复原键原参数 → 查询 completed 收尾且不重发计分 → 归组失败刷新后仍可仅重试归组。

布局检查为 360/390/430 宽度、五主题的课堂速记模块，使用正常 Playwright 点击。它没有挂载整个 App 壳，不证明底栏、任务返回、主题全局联动或真机行为全部正常；也不是完整视觉设计验收。

## 5. 后端复跑操作

### 5.1 先确认环境，失败立即停

1. 只读核对容器、测试服务和正式文件；测试服务必须只绑定容器内 `127.0.0.1:8080`，不能暴露到公网。
2. 请求 `/__test_env`，要求 `test_mode=true`、`database=class_manager_ta_test`，记录 run_id。
3. 比较本地正式 runner 与容器 `/tmp/ta/ta_runner2.php` 的 **SHA256**；不要把 md5 与 SHA256 比较。确认后再执行。
4. 不打印 DB 密码、会话 Cookie 或 SSH 凭据。已有 SSH 工具 `C:\Users\MTK\.zcode\workspace\default\tools\srv.js` 与上传工具 `upload_file.js` 可用，不读取其凭据内容。

### 5.2 本批成功使用的入口

服务器宿主临时文件：`/tmp/run_isolated_codex.php`。

容器入口：`/tmp/ta/run_isolated_codex.php`。

运行命令（在服务器）：

```sh
sudo -n docker exec teaching-app-web-1 php /tmp/ta/run_isolated_codex.php
```

该入口会校验当前测试服务数据库，读取其 run_id，然后调用 `ta_setup.php` 重建**隔离库**、创建100分学生夹具和两名管理员，最后调用正式 runner。

**它会删除并重建 class_manager_ta_test，不能与另一轮测试同时执行。** `ta_setup.php` 临时使用生产库连接读取表结构；其 DROP/CREATE 目标固定为隔离库。不要据此把业务请求指向生产库。

在本机通过 SSH 工具执行并保存全部输出：

```powershell
node 'C:\Users\MTK\.zcode\workspace\default\tools\srv.js' 'sudo -n docker exec teaching-app-web-1 php /tmp/ta/run_isolated_codex.php' | Tee-Object -FilePath backend-rerun.txt
```

还要确认远程 PHP 退出码为0（检查 SSH 包装器是否原样传播退出码）；`ALL PASS` 和完整28条 PASS必须同时出现，不能只看 PowerShell 管道最终状态。任何 FAIL、异常、身份错误、环境错误都算未通过，不自动解释为“测试问题”。

### 5.3 临时文件丢失时

从仓库重新上传 `tests/ta_setup.php`、`ta_runner2.php`、`ta_router.php` 至容器 `/tmp/ta/`；把交接附件 `run_isolated.php` 放到 `/tmp/ta/run_isolated_codex.php`。每个文件上传后核对 SHA256。

测试服务启动时设置 `DB_NAME=class_manager_ta_test`、唯一 `TA_RUN_ID`、`PHP_CLI_SERVER_WORKERS=4`，继承容器现有 DB 连接环境；命令为 `php -S 127.0.0.1:8080 -t /var/www/html /tmp/ta/ta_router.php`。只处理该测试进程，不重启生产 Apache/PHP 服务。确认 `/__test_env` 与实际库名后才运行入口。

本批测试结束后隔离库保留状态便于核查，生产库没有本批测试写入。下一轮必须通过入口重建，不能在旧 op_key/旧已撤销日志上累计重跑。

## 6. 浏览器模拟复跑

`verify_classroom.cjs` 当前依赖本机 Codex 缓存的 Playwright 和 Edge，主站路径也按本机配置；换机器需调整这三处。执行目录必须有 `outputs/classroom-ui/`，截图写入那里。

```powershell
New-Item -ItemType Directory -Force outputs/classroom-ui
node 'D:\DeskBox\班级量化考核系统\管理app\tests\codex-classroom-handoff\verify_classroom.cjs'
```

所有请求均路由到 `fixture.test` 模拟响应，不使用真实账号、学生或真实 API。不要为了方便移除拦截然后运行撤销测试。脚本退出码须为0，且 P1–P4、身份保护、布局检查均通过。

## 7. 下一批按顺序做什么

### 第一项：整个 App 壳联调

使用隔离环境或全部拦截写接口，实际挂载 teacher.js/index.php，而非只挂模块。

逐项验证：工作台→课堂速记→返回；任务页隐藏底栏；固定操作栏不挡末行；键盘展开时输入与确认按钮可见；切 Tab/返回保留或明确清空选择；五主题从真实设置入口切换；会话失效进入登录，未确认操作不误归属给下一管理员；待确认和待归组入口可恢复且不重复计分。

产出正常点击录像或截图、控制台错误记录。360/390/430均无横向溢出，按钮不可一字一行，不能用 evaluate 点击绕过命中问题后宣称正常。

### 第二项：安卓真机验收

网页修复不需新 APK；前序声明的原生证书处理、导航栏、断网行为修复是否生效，必须安装并核对对应 APK 版本后验证，本批没有重新验收。

检查拍照权限拒绝/授权、连续多图、EXIF方向、相册选择、键盘遮挡、系统返回键、扫码、网络中断恢复、升级安装。作文批量流程还需真机验证多学生分篇、匹配确认、部分失败重试和存档后批改。

有问题先复现、记录、修复并回归；无需重写已经通过的幂等后端。不能把未装包的网页测试写成原生验收。

### 第三项：通过后开发背诵看板

先审查现有接口与权限，再实现真实手机页面。复用现有学生、课文、背诵记录和撤销规则，不创建第二套后端。高频动作需清晰显示对象、状态、成功/失败及可恢复路径；低频页面不能只以 iframe 嵌入就宣称原生体验。

终评分人工修改仍需与现有引擎评分、发分和复核审计规则对齐，不能擅自写 final_score。其他阅读、考试、商城等页面不在本批完成范围。

## 8. 已知边界与数据保护

- 撤销后重发原键仍返回首次历史响应，已验证不重新计分；暂未增加“已撤销”状态。若要前端明确展示，需要向后兼容设计并补测试。
- localStorage 存储失败、App 卸载/清除数据等极端恢复场景未在本批验收；不要承诺任何情况下记录都不会丢。
- 生产学生301“测试”来历未确认，不能删除。
- 前序误撤销涉及孙梓涵（student157）、恢复日志2271、分组29、事故说明；不得用这些记录做测试或清理。恢复分数175/version43是此前核验记录，不应在下一轮不查库就再次断言当前分数仍固定175。
- 历史残留学生311/班级8/管理员16此前已核验清理；本批未新增生产夹具。后续若清理需核对库名、精确ID与名称，不使用 `LIKE 'ta_test%'` 泛删。
- 不通过真实学生加减分验证测试框架。隔离环境错误立即停止，不自动降级到生产。

## 9. 每批交付格式

报告包含：实际改动文件、部署前后哈希、提交/是否push、后端/模拟/整壳/真机各自结果、完整输出路径、未通过项、数据写入范围与清理记录。

把“源码通过”“已经部署”“模块测试通过”“真机通过”分别记录。失败就保留失败，禁止改弱断言凑全绿，禁止无证据归因缓存或 session 锁。
