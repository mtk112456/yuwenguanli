/**
 * 教师端 · 量化考核模块（真实手机页面，替代 iframe 旧页）
 * 数据源（全部复用现有业务接口，零后端改动）：
 *  - 班级  api/admin/class/list.php
 *  - 学生  api/admin/score/list.php?keyword=&class_id= （含乐观锁 version）
 *  - 加减分 api/admin/score/update.php (POST student_id,change_value,type,reason,source,version → log_id)
 *  - 批量归组 api/admin/score/batch_store.php (POST log_ids[],content)
 */
(function () {
    'use strict';

    var TE = window.TE = window.TE || {};
    var TA = window.TA;
    if (!TA) return;

    function $(s, r) { return (r || document).querySelector(s); }
    function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
    function esc(s) { return TA.escapeHtml(s); }

    var booted = false;
    var state = {
        classId: 0,
        keyword: '',
        classes: [],
        list: [],
        selected: {},      // student_id -> row
        running: false
    };

    TE.score = {
        init: init,
        onShow: onShow,
        booted: function () { return booted; }
    };

    function init(root) {
        if (!root) return;
        root.innerHTML =
            '<div class="ta-filterbar">' +
                '<div class="ta-classbar" id="taScClasses"></div>' +
            '</div>' +
            '<div class="ta-searchbar">' +
                '<i class="ri-search-line"></i>' +
                '<input type="search" id="taScSearch" placeholder="搜索学生姓名" autocomplete="off">' +
            '</div>' +
            '<div class="ta-list" id="taScList"></div>' +
            '<div class="ta-batchbar" id="taScBatch" hidden>' +
                '<button type="button" class="ta-btn-mini" id="taScClear">取消</button>' +
                '<span class="ta-batch-count">已选 <b id="taScCount">0</b> 人</span>' +
                '<button type="button" class="ta-btn-danger2" id="taScMinus"><i class="ri-subtract-line"></i>减分</button>' +
                '<button type="button" class="ta-btn-primary" id="taScPlus"><i class="ri-add-line"></i>加分</button>' +
            '</div>';

        loadClasses();
        loadStudents(true);

        var search = $('#taScSearch', root);
        var deb = 0;
        search.addEventListener('input', function () {
            clearTimeout(deb);
            deb = setTimeout(function () {
                state.keyword = search.value.trim();
                loadStudents(true);
            }, 400);
        });
        $('#taScClear', root).addEventListener('click', function () {
            state.selected = {};
            render();
        });
        // 最近批量分组 + 一键撤销入口
        var recentBar = document.createElement('div');
        recentBar.className = 'ta-recentbar';
        root.insertBefore(recentBar, root.querySelector('.ta-list'));
        recentBar.addEventListener('click', function (e) {
            var item = e.target.closest('[data-bid]');
            if (item) { openUndoSheet(Number(item.dataset.bid)); return; }
            var head = e.target.closest('.ta-recent-head');
            if (head) {
                var box = recentBar.querySelector('.ta-recent-list');
                var open = box && !box.hidden;
                if (box) box.hidden = open;
                head.querySelector('i.togg').className = open ? 'ri-arrow-down-s-line togg' : 'ri-arrow-up-s-line togg';
            }
        });
        loadRecent(recentBar);
        $('#taScPlus', root).addEventListener('click', function () { openConfirm(1); });
        $('#taScMinus', root).addEventListener('click', function () { openConfirm(-1); });

        booted = true;
    }

    function onShow() {
        loadStudents(true);
        var bar = document.querySelector('.ta-recentbar');
        if (bar) loadRecent(bar);
    }

    function loadRecent(bar) {
        TA.request('../../api/admin/score/batch_history.php').then(function (res) {
            if (res.code !== 0 || !res.data) return;
            var list = (res.data.list || []).slice(0, 5);
            if (!list.length) { bar.innerHTML = ''; return; }
            bar.innerHTML = '<div class="ta-recent-head"><i class="ri-history-line"></i><span>最近批量操作</span><i class="ri-arrow-down-s-line togg"></i></div>' +
                '<div class="ta-recent-list" hidden>' + list.map(function (b) {
                    var total = (b.detail_list || []).reduce(function (a, d) { return a + d.change_value; }, 0);
                    return '<button type="button" class="ta-recent-item" data-bid="' + b.id + '">' +
                        '<span class="ta-recent-c">' + esc(b.content) + '</span>' +
                        '<span class="ta-recent-m">' + (b.detail_list || []).length + '人 ' + (total >= 0 ? '+' : '') + total + '分 · ' + esc(b.create_time || '') + '</span>' +
                        '</button>';
                }).join('') + '</div>';
        }).catch(function () {});
    }

    function openUndoSheet(batchId) {
        TA.request('../../api/admin/score/batch_history.php').then(function (res) {
            if (res.code !== 0 || !res.data) return;
            var b = (res.data.list || []).find(function (x) { return Number(x.id) === batchId; });
            if (!b) { TA.toast('分组不存在或已撤销'); return; }
            var details = b.detail_list || [];
            var total = details.reduce(function (a, d) { return a + d.change_value; }, 0);
            var wrap = document.createElement('div');
            wrap.innerHTML = '<div class="ta-rw-sum"><span>该组共 <b>' + details.length + '</b> 名学生，合计 ' + (total >= 0 ? '+' : '') + total + ' 分</span>' +
                '<span class="ta-pick-sub">' + esc(b.content) + ' · ' + esc(b.create_time || '') + '</span></div>' +
                '<div class="ta-pick-list">' + details.map(function (d) {
                    return '<div class="ta-pick-item"><span>' + esc(d.show_name) + '</span><i class="ta-pick-sub">' + (d.change_value >= 0 ? '+' : '') + d.change_value + '分 ' + esc(d.reason || '') + '</i></div>';
                }).join('') + '</div>' +
                '<button type="button" class="ta-btn-danger2 wide" id="taUndoGo" style="margin-top:12px;"><i class="ri-arrow-go-back-line"></i>撤销该组（恢复 ' + details.length + ' 人分数）</button>';
            wrap.querySelector('#taUndoGo').addEventListener('click', async function () {
                var yes = await TA.confirm('确认撤销该组？将恢复 ' + details.length + ' 名学生的分数。');
                if (!yes) return;
                var btn = wrap.querySelector('#taUndoGo');
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
                    loadStudents(true);
                    var bar2 = document.querySelector('.ta-recentbar');
                    if (bar2) loadRecent(bar2);
                } catch (e) {
                    btn.disabled = false;
                    btn.textContent = '网络异常，请重试';
                }
            });
            TA.openSheet('批量分组详情', wrap);
        }).catch(function () { TA.toast('加载失败'); });
    }

    function loadClasses() {
        TA.request('../../api/admin/class/list.php').then(function (res) {
            if (res.code !== 0 || !res.data) return;
            state.classes = [{ id: 0, name: '全部' }].concat(res.data.list || []);
            var bar = $('#taScClasses');
            if (!bar) return;
            bar.innerHTML = state.classes.map(function (c) {
                return '<button type="button" class="ta-chip' + (String(state.classId) === String(c.id) ? ' active' : '') + '" data-cid="' + c.id + '">' +
                    esc(c.name) + (c.student_count ? '<i>' + c.student_count + '</i>' : '') + '</button>';
            }).join('');
            $$('.ta-chip', bar).forEach(function (chip) {
                chip.addEventListener('click', function () {
                    state.classId = Number(chip.dataset.cid);
                    $$('.ta-chip', bar).forEach(function (x) { x.classList.toggle('active', x === chip); });
                    loadStudents(true);
                });
            });
        }).catch(function () {});
    }

    function loadStudents(reset) {
        var listEl = $('#taScList');
        if (!listEl) return;
        if (reset) listEl.innerHTML = '<div class="ta-skelblock"><span class="ta-spin"></span>正在载入学生…</div>';
        var qs = (state.classId ? '&class_id=' + state.classId : '') +
            (state.keyword ? '&keyword=' + encodeURIComponent(state.keyword) : '');
        TA.request('../../api/admin/score/list.php?' + qs).then(function (res) {
            if (res.code !== 0 || !res.data) throw new Error(res.msg || '加载失败');
            state.list = res.data.list || [];
            // 清掉已不在当前列表中的选择
            var ids = {};
            state.list.forEach(function (s) { ids[s.id] = 1; });
            Object.keys(state.selected).forEach(function (k) {
                if (!ids[k]) delete state.selected[k];
            });
            render();
        }).catch(function (e) {
            listEl.innerHTML = '<div class="ta-empty"><i class="ri-wifi-off-line"></i><span>' + esc(e.message || '加载失败') + '</span></div>';
        });
    }

    function render() {
        var listEl = $('#taScList');
        var batchEl = $('#taScBatch');
        if (!listEl) return;
        if (!state.list.length) {
            listEl.innerHTML = '<div class="ta-empty"><i class="ri-team-line"></i><span>没有匹配的学生</span></div>';
            batchEl.hidden = true;
            return;
        }
        listEl.innerHTML = state.list.map(function (s) {
            var nm = s.show_name || s.name;
            var checked = !!state.selected[s.id];
            return '<button type="button" class="ta-score-row' + (checked ? ' checked' : '') + '" data-sid="' + s.id + '">' +
                '<span class="ta-check ' + (checked ? 'on' : '') + '"><i class="ri-check-line"></i></span>' +
                '<span class="ta-avatar-mini">' + esc((nm || '?').charAt(0)) + '</span>' +
                '<span class="ta-score-main">' +
                    '<span class="ta-essay-title">' + esc(nm) + '</span>' +
                    (s.position ? '<span class="ta-badge post">' + esc(s.position) + '</span>' : '') +
                '</span>' +
                '<span class="ta-score-num">' + esc(s.score) + '<i>分</i></span>' +
                '</button>';
        }).join('');
        batchEl.hidden = Object.keys(state.selected).length === 0;
        var countEl = $('#taScCount');
        if (countEl) countEl.textContent = Object.keys(state.selected).length;

        $$('.ta-score-row', listEl).forEach(function (row) {
            row.addEventListener('click', function () {
                var id = Number(row.dataset.sid);
                if (state.selected[id]) delete state.selected[id];
                else {
                    var row2 = null;
                    state.list.forEach(function (s) { if (s.id === id) row2 = s; });
                    if (row2) state.selected[id] = row2;
                }
                render();
            });
        });
    }

    // ==================== 加减分确认面板 ====================
    function openConfirm(dir) {
        var ids = Object.keys(state.selected).map(Number);
        if (!ids.length) { TA.toast('请先选择学生'); return; }
        var value = 2;
        var reason = '';
        var reasons = dir > 0
            ? ['课堂表现好', '作业完成优秀', '背诵过关', '主动发言', '值日认真']
            : ['课堂纪律', '未完成作业', '迟到', '作业质量差'];

        var wrap = document.createElement('div');
        wrap.innerHTML =
            '<div class="ta-rw-sum">将对 <b>' + ids.length + '</b> 名学生' + (dir > 0 ? '加' : '减') + '分' +
                '<span class="ta-pick-sub">' + ids.map(function (id) { return esc((state.selected[id].show_name || state.selected[id].name)); }).slice(0, 6).join('、') + (ids.length > 6 ? ' 等' : '') + '</span></div>' +
            '<div class="ta-rw-row"><span>每人分值</span>' +
                '<span class="ta-stepper"><button type="button" data-d="-1">−</button><b id="taScVal">' + value + '</b><button type="button" data-d="1">＋</button></span></div>' +
            '<div class="ta-rw-quick">' + [1, 2, 3, 5, 10].map(function (v) {
                return '<button type="button" class="ta-chip' + (v === value ? ' active' : '') + '" data-v="' + v + '">' + v + '</button>';
            }).join('') + '</div>' +
            '<div class="ta-rw-reasons">' + reasons.map(function (r) {
                return '<button type="button" class="ta-chip" data-r="' + r + '">' + r + '</button>';
            }).join('') + '</div>' +
            '<input type="text" class="ta-input" id="taScReason" placeholder="原因（必填，可自定义）">' +
            '<button type="button" class="ta-btn-primary wide" id="taScOk"><i class="ri-check-line"></i>确认' + (dir > 0 ? '加分' : '减分') + '</button>' +
            '<div class="ta-rw-progress" id="taScProg" hidden></div>';

        var valEl = $('#taScVal', wrap);
        $$('.ta-stepper button', wrap).forEach(function (b) {
            b.addEventListener('click', function () {
                value = Math.max(1, value + Number(b.dataset.d));
                valEl.textContent = value;
                $$('.ta-rw-quick .ta-chip', wrap).forEach(function (x) { x.classList.toggle('active', Number(x.dataset.v) === value); });
            });
        });
        $$('.ta-rw-quick .ta-chip', wrap).forEach(function (c) {
            c.addEventListener('click', function () {
                value = Number(c.dataset.v);
                valEl.textContent = value;
                $$('.ta-rw-quick .ta-chip', wrap).forEach(function (x) { x.classList.toggle('active', x === c); });
            });
        });
        var reasonEl = $('#taScReason', wrap);
        $$('.ta-rw-reasons .ta-chip', wrap).forEach(function (c) {
            c.addEventListener('click', function () {
                reasonEl.value = c.dataset.r;
                $$('.ta-rw-reasons .ta-chip', wrap).forEach(function (x) { x.classList.toggle('active', x === c); });
            });
        });

        $('#taScOk', wrap).addEventListener('click', async function () {
            var reason = reasonEl.value.trim();
            if (!reason) { TA.toast('请填写或选择原因'); return; }
            if (state.running) return;
            state.running = true;
            var btn = $('#taScOk', wrap);
            btn.disabled = true;
            btn.innerHTML = '<span class="ta-spin"></span>正在执行…';
            var prog = $('#taScProg', wrap);
            prog.hidden = false;

            var okIds = [], failList = [];
            for (var i = 0; i < ids.length; i++) {
                var s = state.selected[ids[i]];
                prog.textContent = '正在处理 ' + (i + 1) + '/' + ids.length + '：' + (s.show_name || s.name);
                try {
                    var res = await TA.request('../../api/admin/score/update.php', {
                        method: 'POST',
                        body: TA.toForm({
                            student_id: s.id,
                            change_value: dir * value,
                            type: 'daily',
                            reason: reason,
                            // 后端白名单只允许 空/classroom/recite，与网页端保持一致
                            source: '',
                            version: s.version
                        })
                    });
                    if (res.code === 0 && res.data) {
                        okIds.push(res.data.log_id);
                        s.score = res.data.new_score;
                        s.version = res.data.new_version;
                    } else {
                        failList.push((s.show_name || s.name) + '：' + (res.msg || '失败'));
                    }
                } catch (e) {
                    failList.push((s.show_name || s.name) + '：网络异常');
                }
            }

            // 成功记录归组为一次批量操作（供一键撤销）。
            // 注意：归组失败 ≠ 改分失败——分数已生效，仅撤销分组缺失，可单独重试归组（不会重复改分）。
            // log_ids 必须用重复键编码（toForm 不支持数组，曾导致归组只含第一条日志）。
            var groupOk = false;
            var groupErr = '';
            var groupBody = function () {
                return okIds.map(function (id) { return 'log_ids[]=' + encodeURIComponent(id); }).join('&') +
                    '&content=' + encodeURIComponent((dir > 0 ? '批量加分' : '批量减分') + ' ' + value + '分：' + reason);
            };
            if (okIds.length) {
                try {
                    var gres = await TA.request('../../api/admin/score/batch_store.php', {
                        method: 'POST',
                        body: groupBody()
                    });
                    groupOk = (gres.code === 0);
                    if (!groupOk) groupErr = gres.msg || '服务器返回异常';
                } catch (e) {
                    groupErr = '网络异常';
                }
            }

            state.running = false;
            TA.closeSheet();
            state.selected = {};
            render();

            var resultHtml = '<div class="ta-pick-cap okline">改分成功 ' + okIds.length + ' 人</div>';
            if (failList.length) {
                resultHtml += '<div class="ta-pick-cap errline">改分失败 ' + failList.length + ' 人</div>' +
                    '<div class="ta-d-text">' + failList.map(esc).join('<br>') + '</div>';
            }
            if (okIds.length && !groupOk) {
                resultHtml += '<div class="ta-pick-cap errline">撤销分组创建失败（' + esc(groupErr) + '）</div>' +
                    '<div class="ta-d-text">分数已生效，不受影响；仅「一键撤销」分组未生成。可仅重试归组，不会重复改分。</div>' +
                    '<button type="button" class="ta-btn-primary wide" id="taScRetryGroup">仅重试归组</button>';
            }
            TA.openSheet('执行结果', resultHtml, function (body) {
                var retry = $('#taScRetryGroup', body);
                if (retry) retry.addEventListener('click', async function () {
                    retry.disabled = true;
                    retry.innerHTML = '<span class="ta-spin"></span>正在归组…';
                    try {
                        var r2 = await TA.request('../../api/admin/score/batch_store.php', {
                            method: 'POST',
                            body: groupBody()
                        });
                        if (r2.code === 0) {
                            TA.toast('归组成功，已可一键撤销');
                            TA.closeSheet();
                        } else {
                            retry.disabled = false;
                            retry.textContent = '归组仍失败：' + (r2.msg || '请再试');
                        }
                    } catch (e) {
                        retry.disabled = false;
                        retry.textContent = '网络异常，请再试';
                    }
                });
            });
        });

        TA.openSheet((dir > 0 ? '批量加分' : '批量减分'), wrap);
    }
})();
