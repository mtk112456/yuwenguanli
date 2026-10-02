<?php
/**
 * admin/teacher/index.php — 班级成长助教 · 教师端 App 专用入口
 * 未登录：教师专属登录页（纯账号密码，不含任何白板组件）
 * 已登录：App 壳层（固定四 Tab：工作台 / 作文批改 / 量化考核 / 全部）
 * 仅新增文件，不修改任何现有后台页面；桌面后台与学生端不受影响。
 */
require_once __DIR__ . '/../../assets/version.php';
require_once __DIR__ . '/../../common.php';
require_once __DIR__ . '/../../auth.php';

header('Cache-Control: no-store');
$loggedIn = Auth::isAdminLoggedIn();
?>
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <link rel="icon" href="data:,">
    <title>班级成长助教 · 教师端</title>
    <script src="<?= auto_ver('../../assets/js/theme_loader.js') ?>"></script>
    <link rel="stylesheet" href="<?= auto_ver('../../assets/remixicon/remixicon.css') ?>">
    <link rel="stylesheet" href="<?= auto_ver('teacher.css') ?>">
</head>
<body class="ta-body <?= $loggedIn ? '' : 'ta-login' ?>" data-view="<?= $loggedIn ? 'app' : 'login' ?>" data-admin-id="<?= (int)($_SESSION['admin_id'] ?? 0) ?>">

<?php if (!$loggedIn): ?>
    <!-- ============ 教师登录视图（仅账号密码） ============ -->
    <div class="ta-login-card">
        <div class="ta-login-seal">师</div>
        <div class="ta-login-title">班级成长助教</div>
        <div class="ta-login-sub">教 师 端</div>
        <div class="ta-login-err" id="taLoginErr" role="alert" hidden></div>
        <div class="ta-field">
            <label for="taUsername">教师账号</label>
            <input type="text" id="taUsername" placeholder="请输入教师 / 管理员账号" autocomplete="username">
        </div>
        <div class="ta-field">
            <label for="taPassword">通行密码</label>
            <input type="password" id="taPassword" placeholder="请输入密码" autocomplete="current-password">
        </div>
        <button type="button" class="ta-login-btn" id="taLoginBtn">登 录</button>
        <div class="ta-login-foot">“博观而约取，厚积而薄发”</div>
    </div>

<?php else: ?>
    <!-- ============ App 壳层 ============ -->
    <header class="ta-header" id="taHeader">
        <div class="ta-header-row">
            <div class="ta-avatar" id="taAvatar">师</div>
            <div class="ta-header-text">
                <div class="ta-greeting"><span id="taGreet">你好</span>，<span id="taAdminName">老师</span></div>
                <div class="ta-date" id="taDate">正在载入…</div>
            </div>
            <button type="button" class="ta-header-btn" id="taThemeBtn" aria-label="切换主题" title="切换主题">
                <i class="ri-palette-line"></i>
            </button>
        </div>
    </header>

    <!-- 下拉刷新指示器 -->
    <div class="ta-ptr" id="taPtr" aria-hidden="true"><i class="ri-arrow-down-line"></i><span>下拉刷新</span></div>

    <main class="ta-main" id="taMain">
        <!-- Tab 1：工作台 -->
        <section class="ta-tab active" id="taTab-home" role="tabpanel" aria-label="工作台">
            <div class="ta-section">
                <div class="ta-quick-grid">
                    <button type="button" class="ta-quick-item" data-task="camera" data-title="拍照批改">
                        <span class="ta-quick-icon v2"><i class="ri-camera-fill"></i></span>
                        <span class="ta-quick-name">拍照批改</span>
                    </button>
                    <button type="button" class="ta-quick-item" data-tab="essay">
                        <span class="ta-quick-icon"><i class="ri-edit-2-fill"></i></span>
                        <span class="ta-quick-name">批量上传</span>
                    </button>
                    <button type="button" class="ta-quick-item" data-tab="score">
                        <span class="ta-quick-icon v3"><i class="ri-edit-circle-fill"></i></span>
                        <span class="ta-quick-name">量化打分</span>
                    </button>
                    <button type="button" class="ta-quick-item" data-sub="../reading.php" data-title="阅读学情">
                        <span class="ta-quick-icon v4"><i class="ri-book-3-fill"></i></span>
                        <span class="ta-quick-name">阅读学情</span>
                    </button>
                </div>
            </div>

            <div class="ta-section">
                <div class="ta-block-head">
                    <div class="ta-block-title"><i class="ri-dashboard-3-line"></i><span>班级概况</span></div>
                </div>
                <div class="ta-stats">
                    <button type="button" class="ta-stat" data-sub="../student.php" data-title="学生账号管理">
                        <span><span class="ta-stat-num" id="taStatStudents">--</span><span class="ta-stat-label">学生总数</span></span>
                        <i class="ri-arrow-right-s-line ta-stat-chev"></i>
                    </button>
                    <button type="button" class="ta-stat" data-sub="../records.php" data-title="操作台账">
                        <span><span class="ta-stat-num" id="taStatToday">--</span><span class="ta-stat-label">今日操作</span></span>
                        <i class="ri-arrow-right-s-line ta-stat-chev"></i>
                    </button>
                    <button type="button" class="ta-stat" data-sub="../records.php" data-title="操作台账">
                        <span><span class="ta-stat-num" id="taStatWeek">--</span><span class="ta-stat-label">本周变动</span></span>
                        <i class="ri-arrow-right-s-line ta-stat-chev"></i>
                    </button>
                    <button type="button" class="ta-stat" data-sub="../shop.php" data-title="积分商城">
                        <span><span class="ta-stat-num" id="taStatShop">--</span><span class="ta-stat-label">待核销兑换</span></span>
                        <i class="ri-arrow-right-s-line ta-stat-chev"></i>
                    </button>
                </div>
            </div>

            <div class="ta-section">
                <button type="button" class="ta-card ta-board-row" style="width:100%;" data-sub="../magic.php" data-title="授权白板登录">
                    <i class="ri-qr-code-line ta-board-icon"></i>
                    <span class="ta-board-text">
                        <span class="ta-board-title">授权白板登录</span>
                        <div class="ta-board-desc">教室大屏扫码确认，或生成六位数字码（45 分钟）</div>
                    </span>
                    <i class="ri-arrow-right-s-line ta-board-arrow"></i>
                </button>
            </div>

            <div class="ta-section" style="padding-bottom:16px;">
                <div class="ta-block-head">
                    <div class="ta-block-title"><i class="ri-task-line"></i><span>待处理事项</span></div>
                </div>
                <div class="ta-card ta-todo-list" id="taTodoList"></div>
            </div>
        </section>

        <!-- Tab 2：作文批改（真实手机页面） -->
        <section class="ta-tab" id="taTab-essay" role="tabpanel" aria-label="作文批改">
            <div id="taEssayApp"></div>
        </section>

        <!-- Tab 3：量化考核（真实手机页面） -->
        <section class="ta-tab" id="taTab-score" role="tabpanel" aria-label="量化考核">
            <div id="taScoreApp"></div>
        </section>

        <!-- Tab 4：全部 -->
        <section class="ta-tab" id="taTab-all" role="tabpanel" aria-label="全部功能">
            <div class="ta-section" id="taAllGroups"></div>
            <div style="height:16px;"></div>
        </section>

        <!-- 任务模式（详情/拍照/设置：隐藏底栏，统一返回栏） -->
        <section class="ta-tab" id="taTab-task" role="tabpanel" aria-label="任务">
            <div class="ta-task-head">
                <button type="button" class="ta-sub-btn" id="taTaskBack" aria-label="返回"><i class="ri-arrow-left-line"></i></button>
                <span class="ta-sub-title" id="taTaskTitle">任务</span>
                <span class="ta-task-head-r" id="taTaskHeadRight"></span>
            </div>
            <div class="ta-task-body" id="taTaskBody"></div>
        </section>

        <!-- 二级功能页（低频页 iframe 容器，同样为任务模式） -->
        <section class="ta-tab" id="taTab-sub" role="tabpanel" aria-label="功能页">
            <div class="ta-sub-head">
                <button type="button" class="ta-sub-btn" id="taSubBack" aria-label="返回"><i class="ri-arrow-left-line"></i></button>
                <span class="ta-sub-title" id="taSubTitle">功能页</span>
                <button type="button" class="ta-sub-btn" id="taSubReload" aria-label="刷新"><i class="ri-refresh-line"></i></button>
            </div>
            <div class="ta-frame-wrap ta-with-head">
                <div class="ta-frame-skeleton" id="taSkel-sub"><span class="ta-spin"></span><span>正在载入…</span></div>
                <iframe id="taFrame-sub" title="功能页"></iframe>
            </div>
        </section>
    </main>

    <!-- 通用确认弹窗 -->
    <div class="ta-dialog-mask" id="taDialogMask" hidden>
        <div class="ta-dialog" role="alertdialog" aria-modal="true">
            <div class="ta-dialog-msg" id="taDialogMsg"></div>
            <div class="ta-dialog-btns">
                <button type="button" class="ta-dialog-btn" id="taDialogCancel">取消</button>
                <button type="button" class="ta-dialog-btn primary" id="taDialogOk">确定</button>
            </div>
        </div>
    </div>

    <!-- 通用底部选择面板（学生/班级/模型/命题等） -->
    <div class="ta-sheet-mask" id="taGenMask"></div>
    <div class="ta-sheet" id="taGenSheet">
        <div class="ta-sheet-head">
            <span class="ta-sheet-title" id="taGenTitle">选择</span>
            <button type="button" class="ta-sheet-close" id="taGenClose" aria-label="关闭"><i class="ri-close-line"></i></button>
        </div>
        <div id="taGenBody"></div>
    </div>

    <!-- 固定底部导航（App 内唯一一套，永不变化） -->
    <nav class="ta-tabbar" aria-label="主导航">
        <button type="button" class="ta-tab-item active" data-tab="home" aria-label="工作台">
            <i class="ri-apps-2-fill"></i><span>工作台</span>
        </button>
        <button type="button" class="ta-tab-item" data-tab="essay" aria-label="作文批改">
            <i class="ri-edit-2-fill"></i><span>作文批改</span>
        </button>
        <button type="button" class="ta-tab-item" data-tab="score" aria-label="量化考核">
            <i class="ri-edit-circle-fill"></i><span>量化考核</span>
        </button>
        <button type="button" class="ta-tab-item" data-tab="all" aria-label="全部">
            <i class="ri-function-fill"></i><span>全部</span>
        </button>
    </nav>

    <!-- 主题切换底部抽屉 -->
    <div class="ta-sheet-mask" id="taSheetMask"></div>
    <div class="ta-sheet" id="taThemeSheet" role="dialog" aria-modal="true" aria-label="切换主题">
        <div class="ta-sheet-head">
            <span class="ta-sheet-title">切换主题</span>
            <button type="button" class="ta-sheet-close" id="taThemeClose" aria-label="关闭"><i class="ri-close-line"></i></button>
        </div>
        <div class="ta-theme-list" id="taThemeList"></div>
    </div>

    <div class="ta-toast" id="taToast"></div>
<?php endif; ?>

<script src="<?= auto_ver('teacher.js') ?>"></script>
<script src="<?= auto_ver('teacher-essay.js') ?>"></script>
<script src="<?= auto_ver('teacher-score.js') ?>"></script>
<script src="<?= auto_ver('teacher-classroom.js') ?>"></script>
</body>
</html>
