/**
 * 班级成长助教 · 教师端 App 壳层逻辑
 * - 固定四 Tab（工作台/作文批改/量化考核/全部）+ 独立二级功能容器，底栏全局唯一
 * - 工作台数据全部来自真实接口 api/admin/dashboard.php，无任何写死数字
 * - 五主题复用 ThemeManager，切换用圆形揭示（View Transitions），reduced-motion 自动降级
 * - Android 返回键分级处理：键盘 → 弹窗/抽屉 → 二级页/iframe 历史 → 回工作台 → 双击退出
 * 自包含实现，不引 admin.js（其相对路径按 admin/ 目录写死，在 teacher/ 下会错位）
 */
(function () {
    'use strict';

    var body = document.body;
    var view = body.dataset.view || 'app';

    // ===================== 公共工具 =====================
    function $(sel, root) { return (root || document).querySelector(sel); }
    function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

    function escapeHtml(v) {
        if (v === null || v === undefined) return '';
        return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function toForm(obj) {
        return Object.keys(obj).map(function (k) {
            return encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]);
        }).join('&');
    }

    var toastTimer = 0;
    function toast(msg) {
        var el = $('#taToast');
        if (!el) return;
        el.textContent = msg;
        el.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2200);
    }

    async function request(url, options) {
        options = options || {};
        var opts = Object.assign({ method: 'GET', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, options);
        var res = await fetch(url, opts);
        var text = await res.text();
        var data;
        try { data = JSON.parse(text); }
        catch (e) { throw new Error(text ? ('服务器异常(' + res.status + ')') : '网络请求失败(' + res.status + ')'); }
        if (data.code === 401) {
            location.href = './index.php';
            throw new Error('unauthorized');
        }
        return data;
    }

    var prefersReducedMotion = false;
    try { prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

    // ===================== 登录视图 =====================
    function initLogin() {
        var btn = $('#taLoginBtn');
        var userInput = $('#taUsername');
        var pwdInput = $('#taPassword');
        var errEl = $('#taLoginErr');

        function showErr(msg) {
            if (!errEl) return;
            errEl.textContent = msg || '';
            errEl.hidden = !msg;
        }

        async function doLogin() {
            var username = (userInput && userInput.value || '').trim();
            var password = (pwdInput && pwdInput.value || '').trim();
            if (!username || !password) { showErr('请输入账号和密码'); return; }
            showErr('');
            if (btn) {
                if (btn.disabled) return;
                btn.disabled = true;
                btn.textContent = '登录中…';
            }
            try {
                var res = await fetch('../../api/admin/login.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: toForm({ username: username, password: password, whiteboard: '0' })
                });
                var data = await res.json();
                if (data.code === 0) {
                    var d = data.data || {};
                    try {
                        localStorage.setItem('admin_name', d.admin_name || d.nickname || d.username || '管理员');
                        if (d.username) localStorage.setItem('admin_username', d.username);
                        if (d.nickname !== undefined) localStorage.setItem('admin_nickname', d.nickname);
                    } catch (e) {}
                    location.replace('./index.php');
                    return;
                }
                showErr(data.msg || '登录失败，请检查账号和密码');
            } catch (e) {
                showErr('请求失败，请检查网络后重试');
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = '登 录';
                }
            }
        }

        if (btn) btn.addEventListener('click', doLogin);
        [userInput, pwdInput].forEach(function (input) {
            if (input) input.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); doLogin(); }
            });
        });
    }

    // ===================== iframe 适配层 =====================
    // 隐藏 iframe 内旧网页的底栏/抽屉/汉堡按钮，保证 App 内只有一套导航
    var IFRAME_HIDE_CSS = [
        // admin.css 手机端用 body.admin-has-drawer .layout .admin-drawer-toggle (0,3,1)!important 复显汉堡，
        // 这里用更高特异性 (0,4,2) 压制；.mobile-tabbar 是 mobile.php 自带底栏，App 内一律隐藏
        '.admin-mobile-tabbar, .admin-mobile-drawer, .admin-drawer-mask,',
        '.admin-drawer-toggle, .sidebar, .switch-terminal-btn, .wb-banner,',
        '.mobile-tabbar,',
        'body.admin-has-drawer .layout .admin-drawer-toggle,',
        'html body.admin-has-drawer .layout .admin-drawer-toggle,',
        'html body.admin-has-drawer .admin-drawer-toggle,',
        'html .admin-drawer-toggle { display: none !important; }',
        'body { padding-bottom: 0 !important; }',
        'body.admin-has-drawer, body.admin-drawer-open { overflow: visible !important; }'
    ].join('\n');

    function adaptFrameNow(frame) {
        var win = frame.contentWindow;
        var doc = win && win.document;
        if (!doc || !doc.head) return false;
        var href = 'about:blank';
        try { href = String(win.location.href); } catch (e) {}
        var realPage = href !== 'about:blank' && href !== 'null' && href !== '';
        if (realPage) {
            // 幂等注入：关掉旧网页自己的导航体系
            if (!doc.getElementById('taAdapterStyle')) {
                var style = doc.createElement('style');
                style.id = 'taAdapterStyle';
                style.textContent = IFRAME_HIDE_CSS;
                doc.head.appendChild(style);
            }
            // 自愈：页面内部刷新/重渲染导致样式被移除时自动补回
            if (!doc.getElementById('taAdapterHeal')) {
                var heal = doc.createElement('script');
                heal.id = 'taAdapterHeal';
                heal.textContent = "(function(){var CSS=" + JSON.stringify(IFRAME_HIDE_CSS) + ";" +
                    "function st(){if(!document.getElementById('taAdapterStyle')){var x=document.createElement('style');x.id='taAdapterStyle';x.textContent=CSS;document.head.appendChild(x);}}" +
                    "try{new MutationObserver(st).observe(document.documentElement,{childList:true,subtree:true});}catch(e){}" +
                    "setInterval(st,1500);})();";
                doc.head.appendChild(heal);
            }
            // iframe 内被跳到旧登录页（会话过期）时，整壳回到教师端登录
            try {
                var path = win.location.pathname || '';
                if (path.endsWith('/admin/login.php')) {
                    top.location.href = './index.php';
                    return realPage;
                }
                // 旧页的"返回手机工作台"(magic.php→mobile.php 等)：App 内直接回到壳层工作台
                if (path.endsWith('/admin/mobile.php')) {
                    setTimeout(function () {
                        if (subOpen) closeSub(false);
                        switchTab('home');
                    }, 0);
                }
            } catch (e) {}
        }
        return realPage;
    }

    function bindFrame(frame, skeletonId) {
        if (!frame) return;
        var setSkel = function (gone) {
            var skel = skeletonId ? $('#' + skeletonId) : null;
            if (skel) skel.classList.toggle('gone', !!gone);
        };
        // load 事件要等全部子资源（含字体）完成，弱网下会长期推迟；
        // 轮询 500ms，DOM 就绪即注入适配层。每次 load 重新武装，覆盖长停留后再跳转的场景
        var startPoll = function () {
            var started = Date.now();
            var poll = setInterval(function () {
                var ok = false;
                try { ok = adaptFrameNow(frame); } catch (e) {}
                if (ok) {
                    setSkel(true);
                    clearInterval(poll);
                    return;
                }
                if (Date.now() - started > 30000) clearInterval(poll);
            }, 500);
        };
        frame.addEventListener('load', function () {
            // 无 src 的 iframe 会对 about:blank 触发 load；真实页面加载后再次触发
            setSkel(adaptFrameNow(frame));
            [400, 1200, 2800].forEach(function (t) {
                setTimeout(function () {
                    if (adaptFrameNow(frame)) setSkel(true);
                }, t);
            });
            startPoll();
        });
        startPoll();
    }

    function ensureFrame(tab) {
        var frame = $('#taFrame-' + tab);
        if (!frame || !frame.dataset.src) return;
        var needs = !frame.getAttribute('src');
        try {
            if (String(frame.contentWindow.location.href) === 'about:blank') needs = true;
        } catch (e) {}
        if (needs) frame.setAttribute('src', frame.dataset.src);
    }

    // 尝试关闭 iframe 里打开的弹窗/抽屉（返回键第一优先级）
    function tryCloseFrameOverlay(frame) {
        if (!frame || !frame.contentWindow) return false;
        try {
            var win = frame.contentWindow;
            var doc = win.document;
            if (!doc) return false;
            var drawer = doc.getElementById('adminMobileDrawer');
            if (drawer && drawer.classList.contains('open') && typeof win.toggleAdminDrawer === 'function') {
                win.toggleAdminDrawer(false);
                return true;
            }
            if (typeof win.closeModal === 'function') {
                var openModal = Array.prototype.slice.call(doc.querySelectorAll('.modal')).find(function (m) {
                    return win.getComputedStyle(m).display !== 'none';
                });
                if (openModal && openModal.id) {
                    win.closeModal(openModal.id);
                    return true;
                }
            }
        } catch (e) {}
        return false;
    }

    function frameCanGoBack(frame) {
        if (!frame || !frame.contentWindow) return false;
        try {
            return frame.contentWindow.history.length > 1 && frame.contentWindow.history.state !== null
                ? true
                : frame.contentWindow.history.length > 1;
        } catch (e) { return false; }
    }

    // ===================== Tab 管理 =====================
    var activeTab = 'home';
    var subOpen = false;

    function setBodyFrameMode(on) {
        body.classList.toggle('ta-frame-mode', !!on);
    }

    function switchTab(name) {
        if (!name) return;
        if (subOpen) closeSub(false);
        activeTab = name;

        $all('.ta-tab').forEach(function (sec) { sec.classList.remove('active'); });
        var sec = $('#taTab-' + name);
        if (sec) sec.classList.add('active');

        $all('.ta-tabbar .ta-tab-item').forEach(function (item) {
            item.classList.toggle('active', item.dataset.tab === name);
        });

        var isFrameTab = (name === 'essay' || name === 'score');
        setBodyFrameMode(isFrameTab);
        if (isFrameTab) ensureFrame(name);
        window.scrollTo(0, 0);
    }

    // ===================== 二级功能页 =====================
    var subStack = 0;

    function openSub(url, title) {
        var frame = $('#taFrame-sub');
        var skel = $('#taSkel-sub');
        if (!frame) return;
        $('#taSubTitle').textContent = title || '功能页';
        if (skel) skel.classList.remove('gone');
        frame.setAttribute('src', url);
        $('#taTab-sub').classList.add('active');
        $all('.ta-tab:not(#taTab-sub)').forEach(function (sec) { sec.classList.remove('active'); });
        $all('.ta-tabbar .ta-tab-item').forEach(function (item) {
            item.classList.toggle('active', item.dataset.tab === 'all');
        });
        setBodyFrameMode(true);
        subOpen = true;
        subStack++;
        window.scrollTo(0, 0);
    }

    function closeSub(animate) {
        var frame = $('#taFrame-sub');
        if (frame) {
            frame.removeAttribute('src');
            frame.contentWindow && frame.contentWindow.location.replace('about:blank');
        }
        $('#taTab-sub').classList.remove('active');
        subOpen = false;
        switchTab('all');
    }

    // ===================== 工作台数据（真实接口） =====================
    function initGreeting() {
        var now = new Date();
        var hour = now.getHours();
        var greet = '你好';
        if (hour >= 5 && hour < 9) greet = '清晨好';
        else if (hour >= 9 && hour < 12) greet = '上午好';
        else if (hour >= 12 && hour < 14) greet = '中午好';
        else if (hour >= 14 && hour < 18) greet = '下午好';
        else if (hour >= 18 && hour < 22) greet = '晚上好';
        else greet = '夜深了';
        var greetEl = $('#taGreet');
        if (greetEl) greetEl.textContent = greet;

        var weeks = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
        var dateEl = $('#taDate');
        if (dateEl) {
            dateEl.textContent = now.getFullYear() + '年' + (now.getMonth() + 1) + '月' + now.getDate() + '日 ' + weeks[now.getDay()];
        }

        try {
            var cached = localStorage.getItem('admin_name');
            if (cached) {
                var nameEl = $('#taAdminName');
                var avatarEl = $('#taAvatar');
                if (nameEl) nameEl.textContent = cached;
                if (avatarEl) avatarEl.textContent = cached.charAt(0);
            }
        } catch (e) {}
    }

    var dashboardCache = null;

    async function loadDashboard() {
        try {
            var res = await request('../../api/admin/dashboard.php');
            if (res.code !== 0 || !res.data) return;
            dashboardCache = res.data;
            var d = res.data;

            var name = d.admin_name || '管理员';
            var nameEl = $('#taAdminName');
            var avatarEl = $('#taAvatar');
            if (nameEl) nameEl.textContent = name;
            if (avatarEl) avatarEl.textContent = (name || '师').charAt(0);
            try { localStorage.setItem('admin_name', name); } catch (e) {}

            var map = {
                taStatStudents: d.total_students || 0,
                taStatToday: d.today_records || 0,
                taStatWeek: d.week_changes || 0,
                taStatShop: d.pending_shop_orders || 0
            };
            Object.keys(map).forEach(function (id) {
                var el = $('#' + id);
                if (el) el.textContent = map[id];
            });

            renderTodos(d);
            renderAllBadges(d);
        } catch (e) {
            var list = $('#taTodoList');
            if (list) {
                list.innerHTML = '<div class="ta-empty"><i class="ri-wifi-off-line"></i><span>加载失败，请下拉重试</span></div>';
            }
        }
    }

    function renderTodos(d) {
        var list = $('#taTodoList');
        if (!list) return;
        var items = [];
        if ((d.pending_shop_orders || 0) > 0) {
            items.push({
                text: '商城兑换待核销',
                count: d.pending_shop_orders,
                unit: '单',
                url: '../shop.php',
                title: '积分商城'
            });
        }
        if ((d.pending_feedback || 0) > 0) {
            items.push({
                text: '学生建议待回复',
                count: d.pending_feedback,
                unit: '条',
                url: '../feedback.php',
                title: '建议反馈'
            });
        }
        if (!items.length) {
            list.innerHTML = '<div class="ta-empty"><i class="ri-checkbox-circle-line"></i><span>太棒了，暂无待处理事项</span></div>';
            return;
        }
        list.innerHTML = items.map(function (it) {
            return '<button type="button" class="ta-todo-item" data-sub="' + it.url + '" data-title="' + escapeHtml(it.title) + '" style="width:100%;text-align:left;">' +
                '<span class="ta-todo-dot"></span>' +
                '<span class="ta-todo-text">' + escapeHtml(it.text) + '</span>' +
                '<span class="ta-todo-count">' + it.count + ' ' + it.unit + '</span>' +
                '<i class="ri-arrow-right-s-line ta-stat-chev"></i>' +
                '</button>';
        }).join('');
    }

    // ===================== 全部页 =====================
    var ALL_GROUPS = [
        {
            name: '教学与评价', icon: 'ri-book-read-line', items: [
                { name: '作文批改', icon: 'ri-edit-2-line', tab: 'essay' },
                { name: '量化考核', icon: 'ri-edit-circle-line', tab: 'score' },
                { name: '数据概览', icon: 'ri-dashboard-3-line', sub: '../index.php', title: '数据概览' },
                { name: '学情档案', icon: 'ri-brain-line', sub: '../coach.php', title: '学情分析与档案' },
                { name: '课堂速记', icon: 'ri-flashlight-line', sub: '../classroom.php', title: '课堂速记' },
                { name: '背诵看板', icon: 'ri-book-read-line', sub: '../recite.php', title: '背诵看板' },
                { name: '阅读量化', icon: 'ri-book-3-line', sub: '../reading.php', title: '阅读量化' },
                { name: '听写打分', icon: 'ri-quill-pen-line', sub: '../dictation.php', title: '听写打分' },
                { name: '考试管理', icon: 'ri-line-chart-line', sub: '../exam.php', title: '考试管理' },
                { name: '光荣榜', icon: 'ri-trophy-line', sub: '../rank.php', title: '光荣榜' },
                { name: '积分商城', icon: 'ri-gift-line', sub: '../shop.php', title: '积分商城', badge: 'shop' }
            ]
        },
        {
            name: '班级日常', icon: 'ri-team-line', items: [
                { name: '座位管理', icon: 'ri-layout-grid-line', sub: '../seat.php', title: '座位管理' },
                { name: '值日安排', icon: 'ri-calendar-check-line', sub: '../duty.php', title: '值日安排' },
                { name: '随机点名', icon: 'ri-dice-line', sub: '../rollcall.php', title: '随机点名' },
                { name: '学生账号', icon: 'ri-user-star-line', sub: '../student.php', title: '学生账号管理' },
                { name: '建议反馈', icon: 'ri-chat-smile-2-line', sub: '../feedback.php', title: '建议反馈', badge: 'feedback' }
            ]
        },
        {
            name: '记录与设置', icon: 'ri-settings-3-line', items: [
                { name: '操作台账', icon: 'ri-file-list-3-line', sub: '../records.php', title: '操作台账' },
                { name: '登录记录', icon: 'ri-history-line', sub: '../logins.php', title: '登录记录' },
                { name: '系统设置', icon: 'ri-settings-3-line', sub: '../system.php', title: '系统设置' },
                { name: '主题切换', icon: 'ri-palette-line', action: 'theme' },
                { name: '检查更新', icon: 'ri-download-cloud-2-line', action: 'update' },
                { name: '退出登录', icon: 'ri-logout-box-r-line', action: 'logout', danger: true }
            ]
        },
        {
            name: '手机工具', icon: 'ri-smartphone-line', items: [
                { name: '授权白板', icon: 'ri-qr-code-line', sub: '../magic.php', title: '授权白板登录' },
                { name: '拍照批改', icon: 'ri-camera-line', sub: '../essay.php?action=camera', title: '拍照批改' }
            ]
        }
    ];

    function renderAllPage() {
        var wrap = $('#taAllGroups');
        if (!wrap) return;
        wrap.innerHTML = ALL_GROUPS.map(function (group) {
            var items = group.items.map(function (it) {
                var attrs = it.tab
                    ? 'data-tab="' + it.tab + '"'
                    : (it.sub ? 'data-sub="' + it.sub + '" data-title="' + escapeHtml(it.title || it.name) + '"' : 'data-action="' + it.action + '"');
                return '<button type="button" class="ta-all-item' + (it.danger ? ' danger' : '') + '" ' + attrs + '>' +
                    '<span class="ta-all-badge" data-badge="' + (it.badge || '') + '">0</span>' +
                    '<span class="ta-all-icon"><i class="' + it.icon + '"></i></span>' +
                    '<span class="ta-all-name">' + escapeHtml(it.name) + '</span>' +
                    '</button>';
            }).join('');
            return '<div class="ta-all-group-title"><i class="' + group.icon + '"></i>' + escapeHtml(group.name) + '</div>' +
                '<div class="ta-all-grid">' + items + '</div>';
        }).join('');
    }

    function renderAllBadges(d) {
        var counts = { shop: d.pending_shop_orders || 0, feedback: d.pending_feedback || 0 };
        $all('.ta-all-badge').forEach(function (badge) {
            var key = badge.dataset.badge;
            if (!key || !(key in counts)) return;
            if (counts[key] > 0) {
                badge.textContent = counts[key] > 99 ? '99+' : String(counts[key]);
                badge.classList.add('show');
            } else {
                badge.classList.remove('show');
            }
        });
    }

    // ===================== 主题（五套 + 圆形揭示） =====================
    var THEME_SWATCH = {
        ink_blue: { primary: '#1e3a5f', glyph: '墨' },
        bamboo_green: { primary: '#15803d', glyph: '竹' },
        imperial_purple: { primary: '#5a1e36', glyph: '紫' },
        warm_paper: { primary: '#4c3523', glyph: '笺' },
        misty_cyan: { primary: '#0f766e', glyph: '青' }
    };

    function buildThemeSheet() {
        var list = $('#taThemeList');
        if (!list || !window.ThemeManager) return;
        var current = ThemeManager.getCurrentTheme();
        list.innerHTML = ThemeManager.getThemes().map(function (t) {
            var sw = THEME_SWATCH[t.id] || { primary: t.primary, glyph: '雅' };
            return '<button type="button" class="ta-theme-item' + (t.id === current ? ' active' : '') + '" data-theme-id="' + t.id + '">' +
                '<span class="ta-theme-swatch" style="background:' + sw.primary + ';">' + sw.glyph + '</span>' +
                '<span class="ta-theme-meta"><span class="ta-theme-name">' + escapeHtml(t.name) + '</span>' +
                '<div class="ta-theme-desc">' + escapeHtml(t.badge || '') + '</div></span>' +
                '<i class="ri-check-line ta-theme-check"></i>' +
                '</button>';
        }).join('');
    }

    function syncThemeEverywhere(themeId) {
        // 已加载的 iframe 同步换肤
        $all('iframe').forEach(function (frame) {
            try {
                var tm = frame.contentWindow && frame.contentWindow.ThemeManager;
                if (tm) tm.setTheme(themeId, false);
            } catch (e) {}
        });
        // 系统状态栏与底部导航栏跟随主题主色
        try {
            var themeObj = window.ThemeManager && ThemeManager.getThemeObj(themeId);
            if (themeObj) {
                if (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.StatusBar) {
                    Capacitor.Plugins.StatusBar.setBackgroundColor({ color: themeObj.primary });
                }
                if (window.TeacherNative && typeof window.TeacherNative.setNavigationBarColor === 'function') {
                    window.TeacherNative.setNavigationBarColor(themeObj.primary);
                }
            }
        } catch (e) {}
    }

    function applyTheme(themeId, originEl) {
        if (!window.ThemeManager) return;
        var current = ThemeManager.getCurrentTheme();
        var apply = function () {
            ThemeManager.setTheme(themeId, true); // 同步保存到服务器
            buildThemeSheet();
            syncThemeEverywhere(themeId);
        };
        if (prefersReducedMotion || !document.startViewTransition || current === themeId) {
            apply();
            return;
        }
        var x = window.innerWidth / 2, y = window.innerHeight / 2;
        if (originEl) {
            var r = originEl.getBoundingClientRect();
            x = r.left + r.width / 2;
            y = r.top + r.height / 2;
        }
        var maxR = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
        var vt = document.startViewTransition(apply);
        vt.ready.then(function () {
            document.documentElement.animate(
                { clipPath: ['circle(0px at ' + x + 'px ' + y + 'px)', 'circle(' + maxR + 'px at ' + x + 'px ' + y + 'px)'] },
                { duration: 460, easing: 'ease-in-out', pseudoElement: '::view-transition-new(root)' }
            );
        }).catch(function () {});
    }

    // ===================== 主题/更新检查 =====================
    function syncServerTheme() {
        request('../../api/admin/system/settings.php').then(function (res) {
            if (res.code === 0 && res.data && res.data.theme_id && window.ThemeManager) {
                var serverTheme = res.data.theme_id;
                if (serverTheme !== ThemeManager.getCurrentTheme()) {
                    ThemeManager.setTheme(serverTheme, false);
                    buildThemeSheet();
                    syncThemeEverywhere(serverTheme);
                }
            }
        }).catch(function () {});
    }

    async function checkUpdate(force) {
        var localCode = window.APP_VERSION_CODE || 0;
        try {
            var res = await fetch('app-update.json?v=' + Date.now(), { cache: 'no-store' });
            var info = await res.json();
            if (!info || !(info.version_code > localCode)) {
                if (force) toast('已是最新版本 v' + (window.APP_VERSION_NAME || localCode));
                return;
            }
            var ok = window.confirm('发现新版本 v' + info.version_name + '，现在下载更新吗？');
            if (ok) {
                if (window.TeacherNative && typeof window.TeacherNative.downloadAndInstallApk === 'function') {
                    window.TeacherNative.downloadAndInstallApk(info.apk_url, info.version_name);
                } else {
                    location.href = info.apk_url;
                }
            }
        } catch (e) {
            if (force) toast('检查更新失败，请稍后重试');
        }
    }

    // ===================== 退出登录 =====================
    async function doLogout() {
        if (!window.confirm('确定退出教师端登录吗？')) return;
        var ok = false;
        var msg = '服务器返回异常';
        try {
            var res = await fetch('../../api/admin/logout.php');
            var data = await res.json();
            // code 0 = 退出成功；401 = 服务器本就无登录态，同样视为可安全离开
            ok = (data.code === 0) || (data.code === 401);
            if (!ok && data.msg) msg = data.msg;
        } catch (e) {
            msg = '网络异常，退出请求未完成';
        }
        if (!ok) {
            toast('退出失败：' + msg + '，请重试');
            return;
        }
        try {
            localStorage.removeItem('admin_name');
            localStorage.removeItem('admin_nickname');
            localStorage.removeItem('admin_username');
        } catch (e) {}
        location.href = './index.php';
    }

    // ===================== 全局点击分发（事件委托） =====================
    function bindGlobalClick() {
        document.addEventListener('click', function (e) {
            var el = e.target.closest('[data-tab],[data-sub],[data-action]');
            if (!el) return;

            if (el.dataset.tab) {
                switchTab(el.dataset.tab);
                return;
            }
            if (el.dataset.sub) {
                openSub(el.dataset.sub, el.dataset.title);
                return;
            }
            switch (el.dataset.action) {
                case 'theme':
                    buildThemeSheet();
                    openSheet();
                    break;
                case 'update':
                    checkUpdate(true);
                    break;
                case 'logout':
                    doLogout();
                    break;
            }
        });
    }

    // ===================== 主题抽屉开关 =====================
    function openSheet() {
        var mask = $('#taSheetMask'), sheet = $('#taThemeSheet');
        if (mask) mask.classList.add('show');
        if (sheet) sheet.classList.add('show');
    }
    function closeSheet() {
        var mask = $('#taSheetMask'), sheet = $('#taThemeSheet');
        if (mask) mask.classList.remove('show');
        if (sheet) sheet.classList.remove('show');
    }
    function isSheetOpen() {
        var sheet = $('#taThemeSheet');
        return !!(sheet && sheet.classList.contains('show'));
    }
    function bindSheet() {
        var mask = $('#taSheetMask');
        var closeBtn = $('#taThemeClose');
        var themeBtn = $('#taThemeBtn');
        if (themeBtn) themeBtn.addEventListener('click', function () {
            buildThemeSheet();
            openSheet();
        });
        if (mask) mask.addEventListener('click', closeSheet);
        if (closeBtn) closeBtn.addEventListener('click', closeSheet);
        var list = $('#taThemeList');
        if (list) list.addEventListener('click', function (e) {
            var item = e.target.closest('.ta-theme-item');
            if (!item) return;
            applyTheme(item.dataset.themeId, item);
            setTimeout(closeSheet, prefersReducedMotion ? 0 : 320);
        });
    }

    // ===================== 下拉刷新（工作台） =====================
    function bindPullRefresh() {
        var main = $('#taMain');
        var ptr = $('#taPtr');
        if (!main || !ptr) return;
        var startY = 0, pulling = false;

        main.addEventListener('touchstart', function (e) {
            if (activeTab !== 'home' || subOpen) { pulling = false; return; }
            if (window.scrollY <= 2) {
                startY = e.touches[0].pageY;
                pulling = true;
            }
        }, { passive: true });

        main.addEventListener('touchmove', function (e) {
            if (!pulling) return;
            var diff = e.touches[0].pageY - startY;
            if (diff > 18 && window.scrollY <= 2) {
                var dist = Math.min(diff * 0.45, 54);
                ptr.style.top = (dist - 46) + 'px';
                if (dist >= 46) {
                    ptr.classList.add('ready');
                    ptr.querySelector('span').textContent = '松开刷新';
                } else {
                    ptr.classList.remove('ready');
                    ptr.querySelector('span').textContent = '下拉刷新';
                }
            } else {
                ptr.style.top = '-46px';
            }
        }, { passive: true });

        main.addEventListener('touchend', function () {
            if (!pulling) return;
            pulling = false;
            var ready = ptr.classList.contains('ready');
            ptr.classList.remove('ready');
            if (ready) {
                ptr.querySelector('span').textContent = '正在刷新…';
                loadDashboard().then(function () {
                    ptr.style.top = '-46px';
                    toast('已刷新');
                });
            } else {
                ptr.style.top = '-46px';
            }
        }, { passive: true });
    }

    // ===================== Android 返回键分级处理 =====================
    function bindBackButton() {
        var App = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.App;
        if (!App || !App.addListener) return;
        App.addListener('backButton', function () {
            // 1. 收起软键盘
            var active = document.activeElement;
            if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) {
                active.blur();
                return;
            }
            // 2. 关主题抽屉
            if (isSheetOpen()) { closeSheet(); return; }
            // 3. 关闭 iframe 内弹窗/抽屉
            var activeFrame = subOpen ? $('#taFrame-sub') : ((activeTab === 'essay' || activeTab === 'score') ? $('#taFrame-' + activeTab) : null);
            if (activeFrame && tryCloseFrameOverlay(activeFrame)) return;
            // 4. 二级页 → 返回全部；iframe 有历史 → 后退
            if (subOpen) { closeSub(); return; }
            if (activeFrame && frameCanGoBack(activeFrame)) {
                try { activeFrame.contentWindow.history.back(); } catch (e) {}
                return;
            }
            // 5. 业务 Tab → 回工作台
            if (activeTab !== 'home') { switchTab('home'); return; }
            // 6. 工作台双击退出
            if (!bindBackButton._last) {
                bindBackButton._last = Date.now();
                toast('再按一次退出');
                setTimeout(function () { bindBackButton._last = 0; }, 1800);
            } else {
                App.exitApp();
            }
        });
    }

    // ===================== 启动 =====================
    document.addEventListener('DOMContentLoaded', function () {
        if (view === 'login') {
            initLogin();
            return;
        }

        initGreeting();
        renderAllPage();
        bindGlobalClick();
        bindSheet();
        bindPullRefresh();

        bindFrame($('#taFrame-essay'), 'taSkel-essay');
        bindFrame($('#taFrame-score'), 'taSkel-score');
        bindFrame($('#taFrame-sub'), 'taSkel-sub');

        var subBack = $('#taSubBack');
        if (subBack) subBack.addEventListener('click', function () { closeSub(); });
        var subReload = $('#taSubReload');
        if (subReload) subReload.addEventListener('click', function () {
            var frame = $('#taFrame-sub');
            if (frame && frame.getAttribute('src')) {
                var skel = $('#taSkel-sub');
                if (skel) skel.classList.remove('gone');
                frame.contentWindow.location.reload();
            }
        });

        loadDashboard();
        syncServerTheme();
        bindBackButton();

        // 网络恢复：只静默刷新工作台统计，绝不整页刷新（防止打断正在编辑的作文/选片）
        window.addEventListener('online', function () {
            toast('网络已恢复');
            loadDashboard();
        });

        // 同步 Android 底部系统导航栏为主题主色
        try {
            if (window.TeacherNative && typeof window.TeacherNative.setNavigationBarColor === 'function' && window.ThemeManager) {
                window.TeacherNative.setNavigationBarColor(ThemeManager.getThemeObj().primary);
            }
        } catch (e) {}

        if (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.StatusBar) {
            try {
                var themeObj = window.ThemeManager && ThemeManager.getThemeObj();
                if (themeObj) Capacitor.Plugins.StatusBar.setBackgroundColor({ color: themeObj.primary });
            } catch (e) {}
        }
    });
})();
