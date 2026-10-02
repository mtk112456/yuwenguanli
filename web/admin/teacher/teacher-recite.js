/**
 * 教师端 · 背诵看板模块（真实手机页面）
 * 数据源（复用现有接口）：
 *   GET  api/admin/score/recite_board.php?class_id=&piece= → 看板数据（班级/篇目/学生/统计）
 *   POST api/admin/score/recite_board.php action=toggle → 单人通过/取消
 *   POST api/admin/score/batch_update.php → 批量加减分（背诵通过）
 *   GET  api/admin/class/list.php → 班级列表
 *   POST api/admin/score/log_delete.php → 单条撤销
 */
(function () {
    'use strict';
    var TE = window.TE = window.TE || {};
    var TA = window.TA;
    if (!TA) return;

    function $(s, r) { return (r || document).querySelector(s); }
    function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
    function esc(s) { return TA.escapeHtml(s); }

    var state = {
        classId: 0, className: '', classes: [],
        piece: '', pieces: [],
        board: null, loading: false,
        selected: {}, running: false
    };

    TE.recite = { booted: false };

    // ==================== 任务页入口 ====================
    TE.tasks['recite'] = function (bodyEl, params, entry) {
        bodyEl.innerHTML =
            '<div class="ta-classbar" id="taRcClasses"></div>' +
            '<button type="button" class="ta-piece-select" id="taRcPieceBtn">' +
                '<i class="ri-book-open-line"></i>' +
                '<span class="ta-piece-name" id="taRcPieceName">选择课文</span>' +
                '<i class="ri-arrow-down-s-line ta-piece-arrow"></i>' +
            '</button>' +
            '<div class="ta-statsbar" id="taRcStats"></div>' +
            '<div class="ta-list" id="taRcList"></div>' +
            '<div class="ta-batchbar" id="taRcBatch">' +
                '<button type="button" class="ta-btn-mini" id="taRcClear">取消</button>' +
                '<span class="ta-batch-count">已选 <b id="taRcCount">0</b> 人</span>' +
                '<button type="button" class="ta-btn-primary" id="taRcPass"><i class="ri-check-double-line"></i>标记通过</button>' +
            '</div>';

        loadClasses();
        loadBoard();
        bindBar(bodyEl);
    }

    function bindBar(bodyEl) {
        var pieceBtn = $('#taRcPieceBtn', bodyEl);
        if (pieceBtn) pieceBtn.addEventListener('click', openPieceSheet);
        $('#taRcClear').addEventListener('click', function () {
            state.selected = {};
            renderList();
        });
        $('#taRcPass').addEventListener('click', openConfirm);
    }

    function loadClasses() {
        TA.request('../../api/admin/class/list.php').then(function (res) {
            if (res.code !== 0 || !res.data) return;
            state.classes = res.data.list || [];
            if (!state.classId && state.classes.length) state.classId = state.classes[0].id;
            var bar = $('#taRcClasses');
            if (!bar) return;
            bar.innerHTML = state.classes.map(function (cl) {
                return '<button type="button" class="ta-chip' + (String(state.classId) === String(cl.id) ? ' active' : '') + '" data-cid="' + cl.id + '">' +
                    esc(cl.name) + '<i>' + (cl.student_count || 0) + '</i></button>';
            }).join('');
            $$('.ta-chip', bar).forEach(function (chip) {
                chip.addEventListener('click', function () {
                    state.classId = Number(chip.dataset.cid);
                    $$('.ta-chip', bar).forEach(function (x) { x.classList.toggle('active', x === chip); });
                    state.selected = {};
                    loadBoard();
                });
            });
        }).catch(function () {});
    }

    function loadBoard() {
        var listEl = $('#taRcList');
        if (!listEl) return;
        listEl.innerHTML = '<div class="ta-skelblock"><span class="ta-spin"></span>正在载入背诵看板…</div>';
        state.loading = true;
        var url = '../../api/admin/score/recite_board.php?class_id=' + state.classId;
        if (state.piece) url += '&piece=' + encodeURIComponent(state.piece);
        TA.request(url).then(function (res) {
            state.loading = false;
            if (res.code !== 0 || !res.data) throw new Error(res.msg || '加载失败');
            state.board = res.data;
            state.piece = res.data.cur_piece || '';
            state.pieces = res.data.pieces || [];
            renderPieceSelector();
            renderStats();
            renderList();
        }).catch(function (e) {
            state.loading = false;
            listEl.innerHTML = '<div class="ta-empty"><i class="ri-wifi-off-line"></i><span>' + esc(e.message || '加载失败') + '</span></div>';
        });
    }

    // ==================== 课文选择栏 ====================
    function renderPieceSelector() {
        var el = $('#taRcPieceName');
        if (el) el.textContent = state.piece || '选择课文';
    }

    function renderStats() {
        var b = state.board;
        if (!b) return;
        var el = $('#taRcStats');
        if (!el) return;
        el.innerHTML =
            '<span class="ta-stat-item ok"><i class="ri-check-line"></i>通过 <b>' + (b.passed_count || 0) + '</b></span>' +
            '<span class="ta-stat-item bad"><i class="ri-close-line"></i>未通过 <b>' + (b.unpassed_count || 0) + '</b></span>' +
            '<span class="ta-stat-item"><i class="ri-pie-chart-line"></i>通过率 <b>' + esc(b.passed_rate || '0%') + '</b></span>';
    }

    function openPieceSheet() {
        var wrap = document.createElement('div');
        wrap.innerHTML = '<div class="ta-pick-search"><i class="ri-search-line"></i>' +
            '<input type="search" placeholder="搜索课文" id="taPsSearch"></div>' +
            '<div class="ta-pick-list" id="taPsList"></div>';
        function renderList(kw) {
            var box = wrap.querySelector('#taPsList');
            var rows = state.pieces.filter(function (p) {
                return !kw || (p.name || '').indexOf(kw) >= 0;
            });
            if (!rows.length) { box.innerHTML = '<div class="ta-empty"><span>没有匹配的课文</span></div>'; return; }
            box.innerHTML = rows.map(function (p) {
                var active = p.name === state.piece;
                return '<button type="button" class="ta-pick-item' + (active ? ' active' : '') + '" data-piece="' + esc(p.name) + '">' +
                    '<span>' + esc(p.name) + '</span>' + (active ? '<i class="ri-check-line"></i>' : '') + '</button>';
            }).join('');
            box.querySelectorAll('.ta-pick-item').forEach(function (b) {
                b.addEventListener('click', function () {
                    state.piece = b.dataset.piece;
                    state.selected = {};
                    TA.closeSheet();
                    loadBoard();
                });
            });
        }
        renderList('');
        wrap.querySelector('#taPsSearch').addEventListener('input', function () {
            renderList(this.value.trim());
        });
        TA.openSheet('选择课文', wrap);
    }

    // ==================== 学生列表 ====================
    function renderList() {
        var listEl = $('#taRcList');
        var b = state.board;
        if (!listEl || !b) return;
        var students = b.students || [];
        if (!students.length) {
            listEl.innerHTML = '<div class="ta-empty"><i class="ri-team-line"></i><span>没有学生数据</span></div>';
            return;
        }
        listEl.innerHTML = students.map(function (s) {
            var nm = s.show_name || s.name;
            var checked = !!state.selected[s.id];
            var passed = s.is_passed === true;
            var statusBadge = passed
                ? '<span class="ta-badge ok">已通过</span>'
                : '<span class="ta-badge warn">未通过</span>';
            var todayBadge = (s.today_speak_score || 0) > 0 ? '<span class="ta-badge info">今日+' + s.today_speak_score + '</span>' : '';
            return '<button type="button" class="ta-score-row' + (checked ? ' checked' : '') + '" data-sid="' + s.id + '">' +
                '<span class="ta-check ' + (checked ? 'on' : '') + '"><i class="ri-check-line"></i></span>' +
                '<span class="ta-avatar-mini">' + esc((nm || '?').charAt(0)) + '</span>' +
                '<span class="ta-score-main"><span class="ta-essay-title">' + esc(nm) + '</span>' + statusBadge + todayBadge + '</span>' +
                '<span class="ta-score-num">' + esc(s.score) + '<i>分</i></span>' +
                '</button>';
        }).join('');
        var countEl = $('#taRcCount');
        if (countEl) countEl.textContent = Object.keys(state.selected).length;

        $$('.ta-score-row', listEl).forEach(function (row) {
            row.addEventListener('click', function () {
                var id = Number(row.dataset.sid);
                if (state.selected[id]) delete state.selected[id];
                else {
                    var hit = null;
                    students().forEach(function (s) { if (s.id === id) hit = s; });
                    if (hit) state.selected[id] = hit;
                }
                renderList();
            });
        });

        function students() { return state.board ? state.board.students || [] : []; }
    }

    function students() { return state.board ? state.board.students || [] : []; }

    // ==================== 批量标记通过 ====================
    function openConfirm() {
        var ids = Object.keys(state.selected).map(Number);
        if (!ids.length) { TA.toast('请先选择学生'); return; }
        if (state.running) return;
        var piece = state.piece;
        var score = 2;
        // 从 recite_scores 获取通过分值
        if (state.board && state.board.recite_scores) {
            var rules = state.board.recite_scores;
            score = parseInt(rules['pass'] || rules['通过'] || 2) || 2;
        }

        var names = ids.map(function (id) { return esc(state.selected[id].show_name || state.selected[id].name); });
        var wrap = document.createElement('div');
        wrap.innerHTML =
            '<div class="ta-rw-sum"><span>将标记 <b>' + ids.length + '</b> 名学生通过背诵</span>' +
                '<span class="ta-pick-sub">课文「' + esc(piece) + '」 · ' + names.slice(0, 6).join('、') + (ids.length > 6 ? ' 等' : '') + '</span></div>' +
            '<button type="button" class="ta-btn-primary wide" id="taRcExec"><i class="ri-check-double-line"></i>确认通过</button>' +
            '<div class="ta-rw-progress" id="taRcProg" hidden></div>';

        wrap.querySelector('#taRcExec').addEventListener('click', async function () {
            if (state.running) return;
            state.running = true;
            var btn = wrap.querySelector('#taRcExec');
            btn.disabled = true;
            btn.innerHTML = '<span class="ta-spin"></span>正在标记…';
            var prog = wrap.querySelector('#taRcProg');
            prog.hidden = false;

            var okCount = 0, failList = [];
            for (var i = 0; i < ids.length; i++) {
                var s = state.selected[ids[i]];
                prog.textContent = '正在标记 ' + (i + 1) + '/' + ids.length + '：' + (s.show_name || s.name);
                try {
                    var r = await TA.request('../../api/admin/score/recite_board.php', {
                        method: 'POST',
                        body: TA.toForm({
                            action: 'toggle',
                            student_id: s.id,
                            piece: piece,
                            score: score
                        })
                    });
                    if (r.code === 0) { okCount++; }
                    else { failList.push((s.show_name || s.name) + '：' + (r.msg || '失败')); }
                } catch (e) {
                    failList.push((s.show_name || s.name) + '：网络异常');
                }
            }

            state.running = false;
            TA.closeSheet();
            state.selected = {};
            renderList();
            loadBoard();

            var resultHtml = '<div class="ta-pick-cap okline">通过 ' + okCount + ' 人</div>';
            if (failList.length) {
                resultHtml += '<div class="ta-pick-cap errline">失败 ' + failList.length + ' 人</div><div class="ta-d-text">' + failList.map(esc).join('<br>') + '</div>';
            }
            TA.openSheet('标记结果', resultHtml);
        });

        TA.openSheet('批量标记通过', wrap);
    }

    // ==================== 最近操作 ====================
    function loadRecent() {
        TA.request('../../api/admin/score/batch_history.php').then(function (res) {
            if (res.code !== 0 || !res.data) return;
            var list = (res.data.list || []).filter(function (b) {
                return (b.content || '').indexOf('背诵') >= 0;
            }).slice(0, 3);
            if (!list.length) return;
            var bar = $('#taRcRecent');
            if (!bar) return;
            bar.innerHTML = '<div class="ta-recent-head"><i class="ri-history-line"></i><span>最近背诵操作</span></div>' +
                '<div class="ta-recent-list">' + list.map(function (b) {
                    return '<div class="ta-recent-item"><span class="ta-recent-c">' + esc(b.content) + '</span><span class="ta-recent-m">' + esc(b.create_time || '') + '</span></div>';
                }).join('') + '</div>';
        }).catch(function () {});
    }
})();
