/**
 * 教师端 · 课堂速记模块（真实手机页面）
 * 数据源（全部复用现有接口）：score/classroom_list.php（含今日统计与防重标记）、
 * score/batch_update.php（服务端事务+FOR UPDATE+防重复加分）、score/batch_store.php（撤销分组）、
 * score/batch_history.php + batch_undo.php（最近记录与撤销）、class/list.php（班级）
 */
(function () {
    'use strict';

    var TE = window.TE = window.TE || {};
    var TA = window.TA;
    if (!TA) return;

    function $(s, r) { return (r || document).querySelector(s); }
    function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
    function esc(s) { return TA.escapeHtml(s); }

    // 预设评价项目（沿用桌面端课堂速记现有配置）
    var PIECES = [
        { type: 'reward', score: 2, reason: '个人主动举手发言', label: '个人举手发言', icon: 'ri-user-voice-line' },
        { type: 'reward', score: 2, reason: '代表小组发言', label: '代表小组发言', icon: 'ri-team-line' },
        { type: 'reward', score: 2, reason: '参与集体展示', label: '参与集体展示', icon: 'ri-group-line' },
        { type: 'punish', score: -2, reason: '上课违纪提醒两次未改', label: '违纪提醒两次未改', icon: 'ri-alarm-warning-line' }
    ];

    var state = {
        classId: 0, className: '', classes: [],
        keyword: '', list: [], selected: {},
        pieceIdx: 0, customMode: false, customReason: '', customScore: 2,
        running: false, taskEntry: null
    };

    // ---- 待确认操作持久化（按管理员隔离；结果明确前参数不可变） ----
    function adminId() {
        var id = (document.body && document.body.dataset.adminId) || ''; return /^[1-9][0-9]*$/.test(id) ? id : ''; 
    }
    function pendKey() { return 'cm_pending_' + adminId(); }
    function grpKey() { return 'cm_group_' + adminId(); }
    function loadPending() {
        if (!adminId()) return null;
        try { return JSON.parse(localStorage.getItem(pendKey()) || 'null'); } catch (e) { return null; }
    }
    function savePending(p) {
        try { localStorage.setItem(pendKey(), JSON.stringify(p)); } catch (e) {}
    }
    function clearPending() {
        try { localStorage.removeItem(pendKey()); } catch (e) {}
    }
    function loadGroupPending() {
        if (!adminId()) return null;
        try { return JSON.parse(localStorage.getItem(grpKey()) || 'null'); } catch (e) { return null; }
    }
    function saveGroupPending(g) {
        try { localStorage.setItem(grpKey(), JSON.stringify(g)); } catch (e) {}
    }
    function clearGroupPending() {
        try { localStorage.removeItem(grpKey()); } catch (e) {}
    }

    // 待确认面板：先查询（op_result 只读），按状态给动作；绝不在未确认时当新操作提交
    async function finishConfirmed(d, pend) {
        var p = pend.piece;

                // 撤销分组（失败可单独重试，不影响已生效记录）
                var groupErr = '';
                if (d.log_ids && d.log_ids.length) {
                    try {
                        var g = await TA.request('../../api/admin/score/batch_store.php', {
                            method: 'POST',
                            body: d.log_ids.map(function (id) { return 'log_ids[]=' + encodeURIComponent(id); }).join('&') +
                                '&content=' + encodeURIComponent('课堂速记：' + p.reason + '（' + d.log_ids.length + '人 ' + (p.score > 0 ? '+' : '') + p.score + '分）')
                        });
                        if (g.code !== 0) groupErr = g.msg || '服务器返回异常';
                    } catch (e) { groupErr = '网络异常'; }
                    if (groupErr) {
                        saveGroupPending({ logIds: d.log_ids, content: '课堂速记：' + p.reason + '（' + d.log_ids.length + '人 ' + (p.score > 0 ? '+' : '') + p.score + '分）' });
                    } else {
                        clearGroupPending();
                    }
                }
                state.running = false;
                TA.closeSheet();
                clearPending(); // 结果已确认
                // 明示选择清空，避免同批学生重复记录
                state.selected = {};
                renderList();
                loadList();
                loadRecent();
                renderPend();
                showResult(d, p, groupErr);
            
    }

    function openPendingSheet() {
        var pend = loadPending();
        if (!pend) { renderPend(); return; }
        var wrap = document.createElement('div');
        wrap.innerHTML = '<div class="ta-d-text" id="taPendMsg">正在查询提交结果（操作键 ' + esc(pend.opKey) + '）…</div>' +
            '<div class="ta-rw-quick" id="taPendActs"></div>';
        TA.openSheet('课堂记录待确认', wrap, function () { queryPending(pend, wrap); });
    }

    function queryPending(pend, wrap) {
        var msgEl = wrap.querySelector('#taPendMsg');
        var actsEl = wrap.querySelector('#taPendActs');
        if (msgEl) msgEl.textContent = '正在查询提交结果（操作键 ' + pend.opKey + '）…';
        if (actsEl) actsEl.innerHTML = '';
        TA.request('../../api/admin/score/op_result.php?op_key=' + encodeURIComponent(pend.opKey)).then(function (res) {
            if (res.code !== 0 || !res.data) {
                if (msgEl) msgEl.textContent = '查询失败：' + (res.msg || '网络异常');
                if (actsEl) {
                    actsEl.innerHTML = '<button type="button" class="ta-btn-mini" id="taPendRequery">再查一次</button>';
                    $('#taPendRequery', actsEl).addEventListener('click', function () { queryPending(pend, wrap); });
                }
                return;
            }
            var st = res.data.status;
            if (st === 'completed') {
                clearPending();
                TA.closeSheet();
                finishConfirmed(res.data, pend);
                return;
            }
            if (st === 'processing') {
                if (msgEl) msgEl.textContent = '服务器正在处理该记录，请稍后再查。';
                if (actsEl) {
                    actsEl.innerHTML = '<button type="button" class="ta-btn-mini" id="taPendRequery">再查一次</button>';
                    $('#taPendRequery', actsEl).addEventListener('click', function () { queryPending(pend, wrap); });
                }
                return;
            }
            // not_found：请求未到达服务器。可凭原键原参数继续提交（服务端幂等，不会重复记分）
            if (msgEl) msgEl.textContent = '暂未查到提交结果（不代表失败）。可继续提交：使用原操作键与原参数，不会重复记分。';
            if (actsEl) {
                actsEl.innerHTML = '<button type="button" class="ta-btn-primary wide" id="taPendResend"><i class="ri-send-plane-line"></i>继续提交（原键）</button>';
                $('#taPendResend', actsEl).addEventListener('click', async function () {
                    var btn = $('#taPendResend', actsEl);
                    btn.disabled = true;
                    btn.innerHTML = '<span class="ta-spin"></span>正在提交…';
                    try {
                        var res2 = await TA.request('../../api/admin/score/batch_update.php', {
                            method: 'POST',
                            body: pend.body
                        });
                        var d2 = res2.data || {};
                        if (res2.code !== 0) {
                            btn.disabled = false;
                            btn.textContent = res2.msg || '提交失败，请再试';
                            return;
                        }
                        if (d2.replayed) {
                            clearPending();
                            TA.closeSheet();
                            finishConfirmed(d2, pend);
                            return;
                        }
                        clearPending();
                        TA.closeSheet();
                        await finishConfirmed(d2, pend);
                    } catch (e2) {
                        btn.disabled = false;
                        btn.textContent = '仍无法确认，请稍后再查';
                    }
                });
            }
        }).catch(function () {
            if (msgEl) msgEl.textContent = '查询失败：网络异常。已保留该待确认操作，可稍后处理。';
            var actsEl = wrap.querySelector('#taPendActs');
            if (actsEl) {
                actsEl.innerHTML = '<button type="button" class="ta-btn-mini" id="taPendRequery">再查一次</button>';
                $('#taPendRequery', actsEl).addEventListener('click', function () { queryPending(pend, wrap); });
            }
        });
    }

    // 固定入口渲染：待确认记录 / 待归组记录
    function renderPend() {
        var bar = $('#taCmPend');
        if (!bar) return;
        var pend = loadPending();
        var grp = loadGroupPending();
        var html = '';
        if (pend) {
            html += '<button type="button" class="ta-recent-item" id="taCmPendEntry" style="border-color: var(--c-amber);">' +
                '<span class="ta-recent-c"><i class="ri-error-warning-line" style="color:var(--c-amber);"></i> 有 1 笔课堂记录待确认</span>' +
                '<span class="ta-recent-m">' + esc(pend.reason || '') + ' · ' + (pend.studentIds || []).length + '人 · ' + esc(pend.createdAt || '') + '</span></button>';
        }
        if (grp) {
            html += '<button type="button" class="ta-recent-item" id="taCmGrpEntry" style="border-color: var(--c-primary);">' +
                '<span class="ta-recent-c"><i class="ri-links-line" style="color:var(--c-primary);"></i> 有记录待归组（撤销入口缺失）</span>' +
                '<span class="ta-recent-m">日志 ' + (grp.logIds || []).length + ' 条 · 点击仅重试归组（不改分）</span></button>';
        }
        bar.innerHTML = html;
        var pe = $('#taCmPendEntry', bar);
        if (pe) pe.addEventListener('click', openPendingSheet);
        var ge = $('#taCmGrpEntry', bar);
        if (ge) ge.addEventListener('click', retryGroupPending);
    }

    function retryGroupPending() {
        var g = loadGroupPending();
        if (!g) { renderPend(); return; }
        TA.request('../../api/admin/score/batch_store.php', {
            method: 'POST',
            body: (g.logIds || []).map(function (id) { return 'log_ids[]=' + encodeURIComponent(id); }).join('&') +
                '&content=' + encodeURIComponent(g.content)
        }).then(function (res) {
            if (res.code !== 0) { TA.toast(res.msg || '归组仍失败，请稍后再试'); return; }
            clearGroupPending();
            TA.toast(res.data && res.data.existed ? '该组此前已创建，无需重复' : '归组成功，已可一键撤销');
            loadRecent();
            renderPend();
        }).catch(function () { TA.toast('网络异常，归组未确认，稍后可再试'); });
    }

    function currentPiece() {
        if (!state.customMode) return PIECES[state.pieceIdx];
        return { type: state.customScore > 0 ? 'reward' : 'punish', score: state.customScore, reason: state.customReason || '课堂主动精彩发言' };
    }

    // ==================== 任务页 ====================
    TE.tasks['classroom'] = function (bodyEl, params, entry) {
        state.taskEntry = entry;
        bodyEl.innerHTML =
            '<div class="ta-classbar" id="taCmClasses"></div>' +
            '<div class="ta-searchbar"><i class="ri-search-line"></i><input type="search" id="taCmSearch" placeholder="搜索学生姓名" autocomplete="off"></div>' +
            '<div id="taCmPend"></div>' +
            '<div class="ta-piecebar" id="taCmPieces"></div>' +
            '<div class="ta-list" id="taCmList"></div>' +
            '<div class="ta-recentbar" id="taCmRecent"></div>' +
            '<div class="ta-batchbar" id="taCmBatch">' +
                '<button type="button" class="ta-btn-mini" id="taCmClear">取消</button>' +
                '<span class="ta-batch-count">已选 <b id="taCmCount">0</b> 人 · <span id="taCmPieceLabel"></span></span>' +
                '<button type="button" class="ta-btn-primary" id="taCmGo"><i class="ri-flashlight-line"></i>记录</button>' +
            '</div>';

        loadClasses();
        loadList();
        loadRecent();
        renderPieces();
        bindBar();
        renderPend();

        var search = $('#taCmSearch', bodyEl);
        var deb = 0;
        search.addEventListener('input', function () {
            clearTimeout(deb);
            deb = setTimeout(function () {
                state.keyword = search.value.trim();
                renderList();
            }, 350);
        });
    };

    function bindBar() {
        $('#taCmClear').addEventListener('click', function () {
            state.selected = {};
            renderList();
        });
        $('#taCmGo').addEventListener('click', openConfirm);
    }

    // ==================== 数据加载 ====================
    function loadClasses() {
        TA.request('../../api/admin/class/list.php').then(function (res) {
            if (res.code !== 0 || !res.data) return;
            state.classes = res.data.list || [];
            if (!state.classId && state.classes.length) state.classId = state.classes[0].id;
            var bar = $('#taCmClasses');
            bar.innerHTML = state.classes.map(function (cl) {
                return '<button type="button" class="ta-chip' + (String(state.classId) === String(cl.id) ? ' active' : '') + '" data-cid="' + cl.id + '">' +
                    esc(cl.name) + '<i>' + (cl.student_count || 0) + '</i></button>';
            }).join('');
            $$('.ta-chip', bar).forEach(function (chip) {
                chip.addEventListener('click', function () {
                    state.classId = Number(chip.dataset.cid);
                    $$('.ta-chip', bar).forEach(function (x) { x.classList.toggle('active', x === chip); });
                    state.selected = {};
                    loadList();
                });
            });
        }).catch(function () {});
    }

    function loadList() {
        var listEl = $('#taCmList');
        if (!listEl) return;
        listEl.innerHTML = '<div class="ta-skelblock"><span class="ta-spin"></span>正在载入学生…</div>';
        TA.request('../../api/admin/score/classroom_list.php?class_id=' + state.classId).then(function (res) {
            if (res.code !== 0 || !res.data) throw new Error(res.msg || '加载失败');
            state.list = res.data.students || [];
            if (res.data.class_name) state.className = res.data.class_name;
            // 选择保留：仅保留仍存在的学生
            var ids = {};
            state.list.forEach(function (s) { ids[s.id] = 1; });
            Object.keys(state.selected).forEach(function (k) { if (!ids[k]) delete state.selected[k]; });
            renderList();
        }).catch(function (e) {
            listEl.innerHTML = '<div class="ta-empty"><i class="ri-wifi-off-line"></i><span>' + esc(e.message || '加载失败') + '</span></div>';
        });
    }

    // ==================== 渲染 ====================
    function renderPieces() {
        var bar = $('#taCmPieces');
        var cur = currentPiece();
        bar.innerHTML = PIECES.map(function (p, i) {
            var active = !state.customMode && state.pieceIdx === i;
            return '<button type="button" class="ta-piece-chip' + (active ? ' active' : '') + (p.score < 0 ? ' bad' : '') + '" data-pi="' + i + '">' +
                '<i class="' + p.icon + '"></i>' + esc(p.label) + '<b>' + (p.score > 0 ? '+' : '') + p.score + '</b></button>';
        }).join('') +
        '<button type="button" class="ta-piece-chip' + (state.customMode ? ' active' : '') + '" data-custom="1"><i class="ri-edit-line"></i>自定义</button>';
        if (state.customMode) {
            bar.innerHTML += '<div class="ta-cam-fields" style="margin-top:8px;">' +
                '<input type="text" class="ta-input" id="taCmCustomReason" placeholder="自定义事由" value="' + esc(state.customReason) + '">' +
                '<div class="ta-rw-row"><span>分值（负数=扣分）</span><span class="ta-stepper">' +
                '<button type="button" id="taCmCsM">−</button><b id="taCmCsV">' + state.customScore + '</b><button type="button" id="taCmCsP">＋</button></span></div></div>';
            $('#taCmCustomReason', bar).addEventListener('input', function () {
                state.customReason = this.value.trim();
                updatePieceLabel();
            });
            $('#taCmCsM', bar).addEventListener('click', function () {
                state.customScore = Math.max(-10, state.customScore - 1);
                $('#taCmCsV', bar).textContent = state.customScore;
                updatePieceLabel();
            });
            $('#taCmCsP', bar).addEventListener('click', function () {
                state.customScore = Math.min(10, state.customScore + 1);
                $('#taCmCsV', bar).textContent = state.customScore;
                updatePieceLabel();
            });
        }
        $$('.ta-piece-chip[data-pi]', bar).forEach(function (chip) {
            chip.addEventListener('click', function () {
                state.pieceIdx = Number(chip.dataset.pi);
                state.customMode = false;
                renderPieces();
                updatePieceLabel();
            });
        });
        var customChip = $('.ta-piece-chip[data-custom]', bar);
        if (customChip) customChip.addEventListener('click', function () {
            state.customMode = true;
            renderPieces();
            updatePieceLabel();
        });
        updatePieceLabel();
    }

    function updatePieceLabel() {
        var p = currentPiece();
        var el = $('#taCmPieceLabel');
        if (el) el.textContent = p.reason + ' ' + (p.score > 0 ? '+' : '') + p.score;
        if (!state.customMode && $('#taCmCustomReason')) { /* 自定义面板关闭 */ }
    }

    function renderList() {
        var listEl = $('#taCmList');
        if (!listEl) return;
        var kw = state.keyword;
        var rows = state.list.filter(function (s) {
            if (!kw) return true;
            return ((s.show_name || s.name || '').indexOf(kw) >= 0);
        });
        if (!rows.length) {
            listEl.innerHTML = '<div class="ta-empty"><i class="ri-team-line"></i><span>没有匹配的学生</span></div>';
            return;
        }
        listEl.innerHTML = rows.map(function (s) {
            var nm = s.show_name || s.name;
            var checked = !!state.selected[s.id];
            var today = (s.today_speak_score || 0) > 0 ? '<span class="ta-badge ok">今日 +' + s.today_speak_score + '</span>' : '';
            var capped = s.is_speak_capped ? '<span class="ta-badge warn">已满+2</span>' : '';
            var punish = (s.today_punish_score || 0) < 0 ? '<span class="ta-badge post">' + s.today_punish_score + '</span>' : '';
            return '<button type="button" class="ta-score-row' + (checked ? ' checked' : '') + '" data-sid="' + s.id + '">' +
                '<span class="ta-check ' + (checked ? 'on' : '') + '"><i class="ri-check-line"></i></span>' +
                '<span class="ta-avatar-mini">' + esc((nm || '?').charAt(0)) + '</span>' +
                '<span class="ta-score-main"><span class="ta-essay-title">' + esc(nm) + '</span>' +
                    (s.position ? '<span class="ta-badge post">' + esc(s.position) + '</span>' : '') + today + capped + punish +
                '</span>' +
                '<span class="ta-score-num">' + esc(s.score) + '<i>分</i></span>' +
                '</button>';
        }).join('');
        var countEl = $('#taCmCount');
        if (countEl) countEl.textContent = Object.keys(state.selected).length;

        $$('.ta-score-row', listEl).forEach(function (row) {
            row.addEventListener('click', function () {
                var id = Number(row.dataset.sid);
                if (state.selected[id]) delete state.selected[id];
                else {
                    var hit = null;
                    state.list.forEach(function (s) { if (s.id === id) hit = s; });
                    if (hit) state.selected[id] = hit;
                }
                renderList();
            });
        });
    }

    // ==================== 执行 ====================
    function openConfirm() {
        if (!adminId()) { TA.toast('身份信息缺失，请重新登录'); return; }
        if (loadPending()) { openPendingSheet(); return; }
        if (loadGroupPending()) { TA.toast('请先处理待归组记录'); retryGroupPending(); return; }
        var ids = Object.keys(state.selected).map(Number);
        if (!ids.length) { TA.toast('请先选择学生'); return; }
        var p = currentPiece();
        if (!p.reason) { TA.toast('请填写自定义事由'); return; }
        var capped = ids.filter(function (id) { return state.selected[id].is_speak_capped; });
        var names = ids.map(function (id) { return esc(state.selected[id].show_name || state.selected[id].name); });
        var wrap = document.createElement('div');
        wrap.innerHTML =
            '<div class="ta-rw-sum"><span>将对 <b>' + ids.length + '</b> 名学生记录</span>' +
                '<span class="ta-pick-sub">' + names.slice(0, 6).join('、') + (ids.length > 6 ? ' 等' : '') + '</span>' +
                '<span>事由「' + esc(p.reason) + '」 ' + (p.score > 0 ? '+' : '') + p.score + ' 分/人</span></div>' +
            (capped.length && p.score > 0
                ? '<div class="ta-pick-cap warnline">其中 ' + capped.length + ' 人今日已满 +2：' +
                  capped.map(function (id) { return esc(state.selected[id].show_name || state.selected[id].name); }).join('、') + '</div>' +
                  '<div class="ta-rw-quick">' +
                    '<button type="button" class="ta-chip active" data-mode="skip">排除已满学生</button>' +
                    '<button type="button" class="ta-chip" data-mode="all">全部照记</button></div>'
                : '') +
            '<button type="button" class="ta-btn-primary wide" id="taCmExec"><i class="ri-check-line"></i>执行记录</button>' +
            '<div class="ta-rw-progress" id="taCmProg" hidden></div>';

        var skipDup = capped.length > 0; // 默认排除（与桌面端防重一致）
        $$('.ta-rw-quick .ta-chip', wrap).forEach(function (chip) {
            chip.addEventListener('click', function () {
                skipDup = chip.dataset.mode === 'skip';
                $$('.ta-rw-quick .ta-chip', wrap).forEach(function (x) { x.classList.toggle('active', x === chip); });
            });
        });

        wrap.querySelector('#taCmExec').addEventListener('click', async function () {
            if (state.running) return;
            state.running = true;
            // 幂等键：同一逻辑操作唯一；响应丢失后凭此键查询/重发，服务端不会重复记分
            var opKey = 'cm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
            var pend = {
                opKey: opKey,
                studentIds: ids,
                piece: { type: p.type, score: p.score, reason: p.reason },
                skipDup: !!skipDup,
                createdAt: (new Date()).toLocaleString('zh-CN', { hour12: false }),
                status: '待提交',
                body: ''
            };
            var buildBody = function () {
                return ids.map(function (id) { return 'student_ids[]=' + encodeURIComponent(id); }).join('&') +
                    '&change_value=' + encodeURIComponent(p.score) +
                    '&type=' + encodeURIComponent(p.type) +
                    '&reason=' + encodeURIComponent(p.reason) +
                    '&source=classroom' +
                    (skipDup ? '&skip_duplicates=1' : '') +
                    '&op_key=' + encodeURIComponent(opKey);
            };
            pend.body = buildBody(); // 原参数固化：查询/重发一律用它，不原地修改
            pend.status = '提交中';
            savePending(pend);
            var btn = wrap.querySelector('#taCmExec');
            btn.disabled = true;
            btn.innerHTML = '<span class="ta-spin"></span>正在记录…';
            var prog = wrap.querySelector('#taCmProg');
            prog.hidden = false;
            prog.textContent = '正在提交 ' + ids.length + ' 人…';
            var finishOk = function(d) { return finishConfirmed(d, pend); };
            try {
                var res = await TA.request('../../api/admin/score/batch_update.php', {
                    method: 'POST',
                    body: buildBody()
                });
                if (res.code !== 0) {
                    TA.closeSheet();
                    TA.toast(res.msg || '记录失败');
                    state.running = false;
                    return;
                }
                await finishOk(res.data || {});
            } catch (e) {
                // 结果未知：持久保存待确认操作（含原键原参数），打开查询面板。
                // 查询/重发均用同一键同一参数；服务端幂等保证不会重复记分
                pend.status = '结果待确认';
                savePending(pend);
                state.running = false;
                prog.hidden = true;
                renderPend();
                openPendingSheet();
            }
        });
        TA.openSheet('确认课堂速记', wrap);
    }

    function showResult(d, p, groupErr) {
        var html = d.no_effect
            ? '<div class="ta-pick-cap errline">没有可处理的记录</div>'
            : '<div class="ta-pick-cap okline">记录成功 ' + (d.success || 0) + ' 人（' + p.reason + ' ' + (p.score > 0 ? '+' : '') + p.score + '）</div>';
        if ((d.skipped || 0) > 0) {
            html += '<div class="ta-pick-cap warnline">已自动排除今日已满 ' + d.skipped + ' 人' +
                ((d.skipped_names || []).length ? '：' + esc((d.skipped_names || []).join('、')) : '') + '</div>';
        }
        if ((d.failed_detail || []).length) {
            html += '<div class="ta-pick-cap errline">失败 ' + d.failed_detail.length + ' 人</div><div class="ta-d-text">' +
                d.failed_detail.map(function (f) { return esc((f.show_name || '#' + f.student_id) + '：' + f.reason); }).join('<br>') + '</div>';
        }
        if (groupErr) {
            html += '<div class="ta-pick-cap errline">撤销分组创建失败（' + esc(groupErr) + '）</div>' +
                '<button type="button" class="ta-btn-mini" id="taCmRetryGroup">仅重试归组</button>' +
                '<div class="ta-pick-cap">记录已生效；重试只创建撤销分组，不会重复记分</div>';
        }
        html += '<div class="ta-cam-oktip"><i class="ri-information-line"></i>已清空选择，防止同批学生重复记录</div>';
        TA.openSheet('课堂速记结果', html, function (body) {
            var retry = body.querySelector('#taCmRetryGroup');
            if (retry) retry.addEventListener('click', async function () {
                retry.disabled = true;
                retry.innerHTML = '<span class="ta-spin"></span>正在归组…';
                try {
                    var g = await TA.request('../../api/admin/score/batch_store.php', {
                        method: 'POST',
                        body: (d.log_ids || []).map(function (id) { return 'log_ids[]=' + encodeURIComponent(id); }).join('&') +
                            '&content=' + encodeURIComponent('课堂速记：' + p.reason + '（' + (d.log_ids || []).length + '人 ' + (p.score > 0 ? '+' : '') + p.score + '分）')
                    });
                    if (g.code !== 0) {
                        retry.disabled = false;
                        retry.textContent = '归组仍失败：' + (g.msg || '请再试');
                        return;
                    }
                    clearGroupPending();
                    TA.toast('归组成功，已可一键撤销');
                    loadRecent();
                    renderPend();
                    retry.textContent = '归组成功';
                } catch (e) {
                    retry.disabled = false;
                    retry.textContent = '网络异常，请再试';
                }
            });
        });
    }

    // ==================== 最近记录 + 撤销 ====================
    function loadRecent() {
        var bar = $('#taCmRecent');
        if (!bar) return;
        TA.request('../../api/admin/score/batch_history.php').then(function (res) {
            if (res.code !== 0 || !res.data) return;
            var list = (res.data.list || []).filter(function (b) {
                return (b.content || '').indexOf('课堂速记') === 0;
            }).slice(0, 5);
            if (!list.length) { bar.innerHTML = ''; return; }
            bar.innerHTML = '<div class="ta-recent-head"><i class="ri-history-line"></i><span>本页最近记录</span><i class="ri-arrow-down-s-line togg"></i></div>' +
                '<div class="ta-recent-list">' + list.map(function (b) {
                    return '<button type="button" class="ta-recent-item" data-bid="' + b.id + '">' +
                        '<span class="ta-recent-c">' + esc(b.content) + '</span>' +
                        '<span class="ta-recent-m">' + esc(b.create_time || '') + ' · 点击查看/撤销</span></button>';
                }).join('') + '</div>';
        }).catch(function () {});
    }

    function openRecentSheet(batchId) {
        TA.request('../../api/admin/score/batch_history.php').then(function (res) {
            if (res.code !== 0 || !res.data) return;
            var b = (res.data.list || []).find(function (x) { return Number(x.id) === batchId; });
            if (!b) { TA.toast('该记录不存在或已撤销'); return; }
            var details = b.detail_list || [];
            var total = details.reduce(function (a, d) { return a + d.change_value; }, 0);
            var wrap = document.createElement('div');
            wrap.innerHTML = '<div class="ta-rw-sum"><span>该组 <b>' + details.length + '</b> 人，合计 ' + (total >= 0 ? '+' : '') + total + ' 分</span>' +
                '<span class="ta-pick-sub">' + esc(b.create_time || '') + '</span></div>' +
                '<div class="ta-pick-list">' + details.map(function (d) {
                    return '<div class="ta-pick-item"><span>' + esc(d.show_name) + '</span><i class="ta-pick-sub">' + (d.change_value >= 0 ? '+' : '') + d.change_value + '分 ' + esc(d.reason || '') + '</i></div>';
                }).join('') + '</div>' +
                '<button type="button" class="ta-btn-danger2 wide" id="taCmUndo" style="margin-top:12px;"><i class="ri-arrow-go-back-line"></i>撤销该组（恢复 ' + details.length + ' 人分数）</button>';
            wrap.querySelector('#taCmUndo').addEventListener('click', async function () {
                var yes = await TA.confirm('确认撤销？将恢复 ' + details.length + ' 名学生的分数。');
                if (!yes) return;
                var btn = wrap.querySelector('#taCmUndo');
                btn.disabled = true;
                btn.innerHTML = '<span class="ta-spin"></span>正在撤销…';
                try {
                    var r = await TA.request('../../api/admin/score/batch_undo.php', {
                        method: 'POST',
                        body: TA.toForm({ batch_id: batchId })
                    });
                    if (r.code !== 0) { btn.disabled = false; btn.textContent = r.msg || '撤销失败'; return; }
                    TA.toast('撤销成功，共回滚 ' + (r.data ? r.data.success : 0) + ' 条记录');
                    TA.closeSheet();
                    loadList();
                    loadRecent();
                } catch (e) {
                    btn.disabled = false;
                    btn.textContent = '网络异常，请重试';
                }
            });
            TA.openSheet('课堂速记分组详情', wrap);
        }).catch(function () { TA.toast('加载失败'); });
    }

    // 事件委托（task body 重建后仍有效）
    document.addEventListener('click', function (e) {
        var recentItem = e.target.closest('#taCmRecent [data-bid]');
        if (recentItem) { openRecentSheet(Number(recentItem.dataset.bid)); return; }
        var recentHead = e.target.closest('#taCmRecent .ta-recent-head');
        if (recentHead) {
            var box = recentHead.parentElement.querySelector('.ta-recent-list');
            if (box) box.hidden = !box.hidden;
        }
    });
})();
