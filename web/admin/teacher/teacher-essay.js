/**
 * 教师端 · 作文批改模块（真实手机页面，替代 iframe 旧页）
 * 数据源（全部复用现有业务接口，零后端改动）：
 *  - 待批列表  api/admin/essay/grader.php?action=pending_list
 *  - 已批列表  api/admin/essay/list.php (action=submissions, 分页/keyword)
 *  - 详情     api/admin/essay/list.php?action=detail&id=
 *  - 删存档   grader.php?action=delete_pending (POST id)
 *  - 页序     grader.php?action=page_reorder (POST image_id,direction)
 *  - 仅存档   grader.php?action=archive (POST student_id,essay_id,title,images)
 *  - 上传识别 api/admin/essay/ocr.php (multipart image)
 *  - 批改任务 grader.php?action=job_create / job_status
 *  - 发分     api/admin/essay/reward.php (POST submission_id,reward_score,reason)
 *  - 学生     essay/list.php?action=students&class_id=
 *  - 命题     essay/list.php?action=essays
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
        mode: 'pending',        // pending | done
        classId: 0,
        className: '全部班级',
        keyword: '',
        multi: false,
        selected: {},           // submission_id -> row
        pending: [],
        pendingLoaded: false,
        loadingPending: false,
        loadingDone: false,
        done: [],
        donePage: 1,
        doneTotalPages: 1,
        doneLoaded: false,
        loading: false
    };

    TE.essay = {
        init: init,
        onShow: onShow,
        booted: function () { return booted; }
    };

    // ==================== 列表骨架 ====================
    function init(root) {
        if (!root) return;
        root.innerHTML =
            '<div class="ta-filterbar">' +
                '<div class="ta-seg" role="tablist">' +
                    '<button type="button" class="active" data-mode="pending">待批改</button>' +
                    '<button type="button" data-mode="done">已批改</button>' +
                '</div>' +
                '<div class="ta-filterbar-r">' +
                    '<button type="button" class="ta-chip" id="taEaClass"><i class="ri-filter-3-line"></i><span>全部班级</span></button>' +
                    '<button type="button" class="ta-chip" id="taEaMulti"><i class="ri-checkbox-multiple-line"></i><span>多选</span></button>' +
                    '<button type="button" class="ta-chip accent" data-task="camera" data-title="拍照批改"><i class="ri-camera-line"></i><span>拍照</span></button>' +
                '</div>' +
            '</div>' +
            '<div class="ta-searchbar" id="taEaSearchWrap" hidden>' +
                '<i class="ri-search-line"></i>' +
                '<input type="search" id="taEaSearch" placeholder="搜索学生或标题" autocomplete="off">' +
            '</div>' +
            '<div class="ta-list" id="taEaList"></div>' +
            '<div class="ta-loadmore" id="taEaMore" hidden><button type="button" class="ta-btn-mini">加载更多</button></div>' +
            '<div class="ta-batchbar" id="taEaBatch" hidden>' +
                '<button type="button" class="ta-btn-mini" id="taEaAll">全选</button>' +
                '<span class="ta-batch-count">已选 <b id="taEaCount">0</b> 篇</span>' +
                '<button type="button" class="ta-btn-primary" id="taEaGrade"><i class="ri-magic-line"></i>开始批改</button>' +
            '</div>';

        $$('.ta-seg button', root).forEach(function (b) {
            b.addEventListener('click', function () {
                if (state.mode === b.dataset.mode) return;
                state.mode = b.dataset.mode;
                $$('.ta-seg button', root).forEach(function (x) { x.classList.toggle('active', x === b); });
                $('#taEaSearchWrap', root).hidden = state.mode !== 'done';
                renderList();
                if (state.mode === 'pending') loadPending(true); else loadDone(true);
            });
        });
        $('#taEaClass', root).addEventListener('click', openClassSheet);
        $('#taEaMulti', root).addEventListener('click', toggleMulti);
        $('#taEaAll', root).addEventListener('click', toggleAll);
        $('#taEaGrade', root).addEventListener('click', startBatchGrade);
        $('#taEaMore', root).addEventListener('click', function () { loadDone(false); });
        var search = $('#taEaSearch', root);
        var debTimer = 0;
        search.addEventListener('input', function () {
            clearTimeout(debTimer);
            debTimer = setTimeout(function () {
                state.keyword = search.value.trim();
                loadDone(true);
            }, 450);
        });

        booted = true;
        loadPending(true);
    }

    function onShow() {
        if (state.mode === 'pending') loadPending(true);
        else loadDone(true);
    }

    // ==================== 数据加载 ====================
    function loadPending(force) {
        if (state.loadingPending) return;
        state.loadingPending = true;
        var listEl = $('#taEaList');
        if (force || !state.pendingLoaded) listEl.innerHTML = '<div class="ta-skelblock"><span class="ta-spin"></span>正在载入待批列表…</div>';
        TA.request('../../api/admin/essay/grader.php?action=pending_list').then(function (res) {
            state.loadingPending = false;
            if (res.code !== 0 || !res.data) throw new Error(res.msg || '加载失败');
            var all = res.data.list || [];
            state.pending = state.classId > 0
                ? all.filter(function (r) { return String(r.class_name || '') !== '' && isClassMatch(r); })
                : all;
            state.pendingLoaded = true;
            updatePendBadge();
            if (state.mode === 'pending') renderList();
        }).catch(function (e) {
            state.loadingPending = false;
            listEl.innerHTML = '<div class="ta-empty"><i class="ri-wifi-off-line"></i><span>' + esc(e.message || '加载失败') + '</span><button type="button" class="ta-btn-mini" onclick="TE.essayRetry()">重试</button></div>';
        });
    }

    TE.essayRetry = function () { loadPending(true); };

    function isClassMatch(row) {
        return String(row.class_name || '') === state.className;
    }

    function loadDone(reset) {
        if (state.loadingDone) return;
        state.loadingDone = true;
        if (reset) { state.donePage = 1; }
        var listEl = $('#taEaList');
        if (reset) listEl.innerHTML = '<div class="ta-skelblock"><span class="ta-spin"></span>正在载入批改记录…</div>';
        var qs = '?page=' + state.donePage + '&page_size=15' +
            (state.keyword ? '&keyword=' + encodeURIComponent(state.keyword) : '');
        TA.request('../../api/admin/essay/list.php' + qs).then(function (res) {
            state.loadingDone = false;
            if (res.code !== 0 || !res.data) throw new Error(res.msg || '加载失败');
            var rows = res.data.list || [];
            state.doneTotalPages = res.data.total_pages || 1;
            state.done = reset ? rows : state.done.concat(rows);
            state.doneLoaded = true;
            if (state.mode === 'done') renderList();
        }).catch(function (e) {
            state.loadingDone = false;
            listEl.innerHTML = '<div class="ta-empty"><i class="ri-wifi-off-line"></i><span>' + esc(e.message || '加载失败') + '</span></div>';
        });
    }

    function updatePendBadge() {
        TE.essayPendingCount = state.pending.length;
    }

    // ==================== 列表渲染 ====================
    function renderList() {
        var listEl = $('#taEaList');
        var moreEl = $('#taEaMore');
        var batchEl = $('#taEaBatch');
        if (!listEl) return;
        var html = '';

        if (state.mode === 'pending') {
            if (!state.pending.length) {
                listEl.innerHTML = '<div class="ta-empty"><i class="ri-checkbox-circle-line"></i><span>没有待批改的作文<br>拍照上传后点「仅存档」即可进入这里</span></div>';
                batchEl.hidden = true;
                return;
            }
            html = state.pending.map(function (r) {
                var checked = !!state.selected[r.id];
                return '<button type="button" class="ta-essay-card' + (checked ? ' checked' : '') + '" data-eid="' + r.id + '">' +
                    (state.multi ? '<span class="ta-check ' + (checked ? 'on' : '') + '"><i class="ri-check-line"></i></span>' : '') +
                    (r.cover_image_url
                        ? '<img class="ta-essay-cover" loading="lazy" src="' + esc(TA.img(r.cover_image_url)) + '" alt="">'
                        : '<span class="ta-essay-cover ph"><i class="ri-file-text-line"></i></span>') +
                    '<span class="ta-essay-main">' +
                        '<span class="ta-essay-title">' + esc(r.title || r.essay_title || '未命名作文') + '</span>' +
                        '<span class="ta-essay-meta">' + esc(r.student_name || ('学生#' + r.student_id)) +
                            (r.class_name ? ' · ' + esc(r.class_name) : '') + ' · ' + (r.page_count || 1) + '页</span>' +
                        '<span class="ta-essay-sub">' + esc(TA.fmtTime(r.created_at)) +
                            ((r.ocr_chars || 0) > 0 ? ' · 已识别' : ' · 未识别') + '</span>' +
                    '</span>' +
                    '<i class="ri-arrow-right-s-line ta-stat-chev"></i>' +
                    '</button>';
            }).join('');
            batchEl.hidden = !state.multi;
            moreEl.hidden = true;
        } else {
            if (!state.done.length) {
                listEl.innerHTML = '<div class="ta-empty"><i class="ri-inbox-line"></i><span>暂无批改记录</span></div>';
                moreEl.hidden = true;
                return;
            }
            html = state.done.map(function (r) {
                var statusBadge = r.is_rewarded
                    ? '<span class="ta-badge ok">已发分 +' + (r.total_reward_score || 0) + '</span>'
                    : (r.teacher_review_status === 'reviewed' ? '<span class="ta-badge info">已复核</span>' : '<span class="ta-badge">已批改</span>');
                return '<button type="button" class="ta-essay-card" data-eid="' + r.id + '">' +
                    '<span class="ta-essay-main">' +
                        '<span class="ta-essay-title">' + esc(r.title_display || r.title || '无题') + '</span>' +
                        '<span class="ta-essay-meta">' + esc(r.student_name || '') +
                            (r.essay_topic ? ' · ' + esc(r.essay_topic) : '') + '</span>' +
                        '<span class="ta-essay-sub">' + esc(TA.fmtTime(r.created_at)) + '</span>' +
                    '</span>' +
                    '<span class="ta-essay-score">' +
                        (r.final_score !== null && r.final_score !== undefined && r.final_score !== '' ? '<b>' + esc(r.final_score) + '</b><i>分</i>' : (r.ai_score !== null && r.ai_score !== undefined ? '<b class="ai">' + esc(r.ai_score) + '</b><i>AI分</i>' : '')) +
                        statusBadge +
                    '</span>' +
                    '</button>';
            }).join('');
            batchEl.hidden = true;
            moreEl.hidden = state.donePage >= state.doneTotalPages;
        }
        listEl.innerHTML = html;

        $$('.ta-essay-card', listEl).forEach(function (card) {
            card.addEventListener('click', function () {
                var id = card.dataset.eid;
                if (state.mode === 'pending' && state.multi) {
                    var row = null;
                    state.pending.forEach(function (r) { if (String(r.id) === String(id)) row = r; });
                    if (state.selected[id]) delete state.selected[id];
                    else if (row) state.selected[id] = row;
                    card.classList.toggle('checked', !!state.selected[id]);
                    updateBatchCount();
                    return;
                }
                TA.openTask('essay-detail', { id: id, from: state.mode }, state.mode === 'pending' ? '待批作文' : '作文详情');
            });
        });
        updateBatchCount();
    }

    function updateBatchCount() {
        var el = $('#taEaCount');
        if (el) el.textContent = Object.keys(state.selected).length;
    }

    function toggleMulti() {
        state.multi = !state.multi;
        if (!state.multi) state.selected = {};
        var btn = $('#taEaMulti');
        btn.classList.toggle('active', state.multi);
        renderList();
    }

    function toggleAll() {
        if (Object.keys(state.selected).length >= state.pending.length) {
            state.selected = {};
        } else {
            state.pending.forEach(function (r) { state.selected[r.id] = r; });
        }
        renderList();
    }

    // ==================== 班级筛选 ====================
    function openClassSheet() {
        TA.request('../../api/admin/class/list.php').then(function (res) {
            if (res.code !== 0 || !res.data) return;
            var classes = [{ id: 0, name: '全部班级', student_count: 0 }].concat(res.data.list || []);
            var html = '<div class="ta-pick-list">' + classes.map(function (c) {
                var active = String(state.classId) === String(c.id);
                return '<button type="button" class="ta-pick-item' + (active ? ' active' : '') + '" data-cid="' + c.id + '" data-cname="' + esc(c.name) + '">' +
                    '<span>' + esc(c.name) + '</span>' +
                    (c.student_count ? '<i class="ta-pick-sub">' + c.student_count + '人</i>' : '') +
                    (active ? '<i class="ri-check-line"></i>' : '') +
                    '</button>';
            }).join('') + '</div>';
            TA.openSheet('选择班级', html, function (body) {
                $$('.ta-pick-item', body).forEach(function (b) {
                    b.addEventListener('click', function () {
                        state.classId = Number(b.dataset.cid);
                        state.className = b.dataset.cname;
                        var label = $('#taEaClass span');
                        if (label) label.textContent = state.className;
                        TA.closeSheet();
                        if (state.mode === 'pending') loadPending(true); else loadDone(true);
                    });
                });
            });
        }).catch(function () { TA.toast('班级列表加载失败'); });
    }

    // ==================== 学生选择面板 ====================
    function openStudentSheet(onPick, confirmName) {
        var picked = { id: 0, name: '' };
        var confirmHtml = confirmName
            ? '<button type="button" class="ta-pick-item active" data-confirm="1"><i class="ri-check-line"></i><span>确认采用识别结果：「' + esc(confirmName) + '」</span></button>'
            : '';
        var wrap = document.createElement('div');
        wrap.innerHTML =
            confirmHtml +
            '<div class="ta-pick-search"><i class="ri-search-line"></i><input type="search" placeholder="搜索学生姓名" autocomplete="off"></div>' +
            '<div class="ta-pick-classes">班级：<span id="taSpClass">全部</span></div>' +
            '<div class="ta-pick-list" id="taSpList"><div class="ta-skelblock"><span class="ta-spin"></span>载入中…</div></div>';
        var classId = 0, classesLoaded = false;

        function loadStudents() {
            var box = $('#taSpList', wrap);
            var kw = $('input', wrap).value.trim();
            TA.request('../../api/admin/essay/list.php?action=students' + (classId ? '&class_id=' + classId : '')).then(function (res) {
                if (res.code !== 0 || !res.data) throw 0;
                var list = res.data.list || [];
                if (kw) {
                    list = list.filter(function (s) {
                        return (s.show_name || s.name || '').indexOf(kw) >= 0;
                    });
                }
                if (!list.length) { box.innerHTML = '<div class="ta-empty"><span>没有匹配的学生</span></div>'; return; }
                box.innerHTML = list.map(function (s) {
                    var nm = s.show_name || s.name;
                    return '<button type="button" class="ta-pick-item" data-sid="' + s.id + '" data-sname="' + esc(nm) + '">' +
                        '<span class="ta-avatar-mini">' + esc((nm || '?').charAt(0)) + '</span>' +
                        '<span>' + esc(nm) + '</span>' +
                        (picked.id === s.id ? '<i class="ri-check-line"></i>' : '') +
                        '</button>';
                }).join('');
                $$('.ta-pick-item', box).forEach(function (b) {
                    b.addEventListener('click', function () {
                        picked = { id: Number(b.dataset.sid), name: b.dataset.sname };
                        TA.closeSheet();
                        onPick(picked);
                    });
                });
            }).catch(function () { box.innerHTML = '<div class="ta-empty"><span>加载失败</span></div>'; });
        }

        TA.request('../../api/admin/class/list.php').then(function (res) {
            if (res.code !== 0 || !res.data) return;
            classesLoaded = true;
            var bar = $('.ta-pick-classes', wrap);
            bar.innerHTML = '班级：' + [{ id: 0, name: '全部' }].concat(res.data.list || []).map(function (c) {
                return '<button type="button" class="ta-chip' + (classId === c.id ? ' active' : '') + '" data-cid="' + c.id + '">' + esc(c.name) + '</button>';
            }).join(' ');
            $$('.ta-chip', bar).forEach(function (chip) {
                chip.addEventListener('click', function () {
                    classId = Number(chip.dataset.cid);
                    $$('.ta-chip', bar).forEach(function (x) { x.classList.toggle('active', x === chip); });
                    loadStudents();
                });
            });
        }).catch(function () {});

        $('input', wrap).addEventListener('input', function () {
            clearTimeout(wrap._deb);
            wrap._deb = setTimeout(loadStudents, 350);
        });
        if (confirmName) {
            var cfm = wrap.querySelector('[data-confirm]');
            if (cfm) cfm.addEventListener('click', function () {
                TA.closeSheet();
                var m = (TE.studentCache || []).find(function (s) { return (s.show_name || s.name || '') === confirmName; });
                onPick(m ? { id: m.id, name: m.show_name || m.name } : { id: 0, name: confirmName });
            });
        }
        loadStudents();
        TA.openSheet('选择学生', wrap);
    }

    // ==================== 批改任务 ====================
    function openModelSheet(onPick) {
        TA.request('../../api/admin/essay/grader.php?action=models').then(function (res) {
            var list = [];
            if (res.code === 0 && res.data) {
                list = res.data.list || res.data.models || [];
            }
            if (!list.length) {
                // 模型目录不可用时退回引擎默认
                onPick('');
                return;
            }
            var html = '<div class="ta-pick-list">' + list.map(function (m, i) {
                var id = m.id || m.key || m.model || m.name || '';
                var label = m.label || m.name || m.title || id;
                return '<button type="button" class="ta-pick-item' + (i === 0 ? ' active' : '') + '" data-model="' + esc(id) + '">' +
                    '<span>' + esc(label) + '</span>' + (i === 0 ? '<i class="ri-check-line"></i>' : '') + '</button>';
            }).join('') + '</div>';
            TA.openSheet('选择批改模型', html, function (body) {
                $$('.ta-pick-item', body).forEach(function (b) {
                    b.addEventListener('click', function () {
                        TA.closeSheet();
                        onPick(b.dataset.model);
                    });
                });
            });
        }).catch(function () { onPick(''); });
    }

    function createJob(ids, model, onDone, onFail) {
        TA.request('../../api/admin/essay/grader.php?action=job_create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ submission_ids: ids, grade_model: model, mode: 'grade' })
        }).then(function (res) {
            if (res.code !== 0) {
                TA.toast(res.msg || '任务创建失败');
                if (onFail) onFail();
                return;
            }
            var job = res.data || {};
            var jobId = job.job_id || job.id || job.jobId || 0;
            if (!jobId) {
                TA.toast('已提交批改任务');
                if (onDone) onDone();
                return;
            }
            pollJob(jobId, onDone);
        }).catch(function () {
            TA.toast('网络异常，任务未创建');
            if (onFail) onFail();
        });
    }

    function pollJob(jobId, onDone) {
        var headR = $('#taTaskHeadRight');
        var ticks = 0;
        var timer = setInterval(function () {
            ticks++;
            TA.request('../../api/admin/essay/grader.php?action=job_status&job_id=' + jobId).then(function (res) {
                if (res.code !== 0 || !res.data) return;
                var d = res.data;
                var done = d.status === 'completed' || d.status === 'done' || d.status === 'success' ||
                    (typeof d.progress === 'number' && d.progress >= 100);
                var text = '批改中 ' + (typeof d.progress === 'number' ? d.progress + '%' : (d.done || '?') + '/' + (d.total || '?'));
                if (headR) headR.innerHTML = '<span class="ta-jobbadge"><span class="ta-spin"></span>' + esc(text) + '</span>';
                if (done || ticks > 150) {
                    clearInterval(timer);
                    if (headR) headR.innerHTML = '';
                    TA.toast(done ? '批改完成' : '批改任务仍在后台进行，可稍后刷新查看');
                    if (onDone) onDone();
                }
            }).catch(function () {});
        }, 4000);
    }

    function startBatchGrade() {
        var ids = Object.keys(state.selected).map(Number);
        if (!ids.length) { TA.toast('请先勾选要批改的作文'); return; }
        TA.confirm('对选中的 ' + ids.length + ' 篇作文开始 AI 批改？批改完成后可在「已批改」中查看。').then(function (yes) {
            if (!yes) return;
            openModelSheet(function (model) {
                TA.toast('已提交 ' + ids.length + ' 篇批改任务');
                createJob(ids, model, function () {
                    state.selected = {};
                    state.multi = false;
                    var btn = $('#taEaMulti');
                    if (btn) btn.classList.remove('active');
                    state.pending = [];
                    loadPending(true);
                });
            });
        });
    }

    // ==================== 作文详情任务页 ====================
    TE.tasks['essay-detail'] = function (bodyEl, params, entry) {
        bodyEl.innerHTML = '<div class="ta-skelblock" style="margin-top:32px;"><span class="ta-spin"></span>正在载入作文详情…</div>';
        TA.request('../../api/admin/essay/list.php?action=detail&id=' + encodeURIComponent(params.id)).then(function (res) {
            if (res.code !== 0 || !res.data) throw new Error(res.msg || '详情加载失败');
            var d = res.data;
            var pending = d.status === 'pending';
            var imgs = d.images || [];

            var imgStrip = imgs.length
                ? '<div class="ta-imgstrip">' + imgs.map(function (im, i) {
                    return '<div class="ta-imgcell">' +
                        '<img loading="lazy" src="' + esc(TA.img(im.image_url)) + '" data-iurl="' + esc(TA.img(im.image_url)) + '" alt="第' + (im.page_no || i + 1) + '页">' +
                        '<span class="ta-imgno">P' + (im.page_no || i + 1) + '</span>' +
                        (pending
                            ? '<span class="ta-imgtools">' +
                              '<button type="button" data-act="up" data-iid="' + im.id + '" title="上移"><i class="ri-arrow-up-line"></i></button>' +
                              '<button type="button" data-act="down" data-iid="' + im.id + '" title="下移"><i class="ri-arrow-down-line"></i></button>' +
                              '</span>'
                            : '') +
                        '</div>';
                }).join('') + '</div>'
                : '<div class="ta-empty"><span>没有原卷图片</span></div>';

            var ocrText = imgs.map(function (im) { return (im.ocr_text || '').trim(); }).filter(Boolean).join('\n');
            var feedback = (d.ai_feedback_md || '').trim();

            bodyEl.innerHTML =
                '<div class="ta-d-sec">' +
                    '<div class="ta-d-title">' + esc(d.title_display || d.title || '无题') + '</div>' +
                    '<div class="ta-d-meta">' + esc(d.student_name || '') +
                        (d.essay_topic ? ' · ' + esc(d.essay_topic) : '') +
                        ' · ' + esc(TA.fmtTime(d.created_at)) + '</div>' +
                    '<div class="ta-d-badges">' +
                        (pending ? '<span class="ta-badge warn">待批改</span>' : '') +
                        (!pending && d.final_score !== null && d.final_score !== undefined && d.final_score !== '' ? '<span class="ta-badge ok">终评 ' + esc(d.final_score) + ' 分</span>' : '') +
                        (!pending && d.ai_score !== null && d.ai_score !== undefined && d.ai_score !== '' ? '<span class="ta-badge info">AI ' + esc(d.ai_score) + ' 分 · ' + esc(d.ai_grade || '') + '</span>' : '') +
                        (!pending && d.ai_rate !== null && d.ai_rate !== undefined && d.ai_rate !== '' ? '<span class="ta-badge">AI率 ' + esc(d.ai_rate) + '%</span>' : '') +
                        (!pending && d.is_rewarded ? '<span class="ta-badge ok">已发分 +' + esc(d.total_reward_score || 0) + '</span>' : '') +
                    '</div>' +
                '</div>' +
                '<div class="ta-d-sec"><div class="ta-d-cap"><i class="ri-image-line"></i>原卷 ' + imgs.length + ' 页</div>' + imgStrip + '</div>' +
                (ocrText ? '<div class="ta-d-sec"><div class="ta-d-cap"><i class="ri-text"></i>识别正文' +
                    (pending && imgs.length ? '<button type="button" class="ta-btn-mini" id="taDdEditOcr" style="margin-left:auto;">修正</button>' : '') +
                    '</div><div class="ta-d-text" id="taDdOcrText">' + esc(ocrText) + '</div></div>' : '') +
                (feedback ? '<div class="ta-d-sec"><div class="ta-d-cap"><i class="ri-quill-pen-line"></i>批改建议</div><div class="ta-d-text md">' + esc(feedback) + '</div></div>' : '') +
                (!pending && d.teacher_review_note ? '<div class="ta-d-sec"><div class="ta-d-cap"><i class="ri-user-voice-line"></i>教师复核</div><div class="ta-d-text">' + esc(d.teacher_review_note) + '</div></div>' : '') +
                '<div style="height:76px;"></div>' +
                '<div class="ta-d-actions">' +
                    (pending
                        ? '<button type="button" class="ta-btn-danger" id="taDdDel">删除存档</button>' +
                          '<button type="button" class="ta-btn-primary" id="taDdGrade"><i class="ri-magic-line"></i>开始批改</button>'
                        : (!d.is_rewarded
                            ? '<button type="button" class="ta-btn-danger" id="taDdReview"><i class="ri-user-voice-line"></i>复核</button>' +
                              '<button type="button" class="ta-btn-primary" id="taDdReward"><i class="ri-hand-coin-line"></i>确认发分</button>'
                            : '<button type="button" class="ta-btn-primary" disabled><i class="ri-check-line"></i>已发分</button>')) +
                '</div>';

        // 图片点击放大
        $$('.ta-imgcell img', bodyEl).forEach(function (img) {
            img.addEventListener('click', function () { openImageViewer(img.src); });
        });
        // 页序调整
        $$('.ta-imgtools button', bodyEl).forEach(function (b) {
            b.addEventListener('click', function (ev) {
                ev.stopPropagation();
                TA.request('../../api/admin/essay/grader.php?action=page_reorder', {
                    method: 'POST',
                    body: TA.toForm({ image_id: b.dataset.iid, direction: b.dataset.act })
                }).then(function (res) {
                    if (res.code !== 0) { TA.toast(res.msg || '调整失败'); return; }
                    TE.tasks['essay-detail'](bodyEl, params, entry);
                    loadPending(true);
                }).catch(function () { TA.toast('网络异常'); });
            });
        });
        // 删除存档
        var del = $('#taDdDel', bodyEl);
        if (del) del.addEventListener('click', function () {
            TA.confirm('删除这篇待批存档？原卷图片将一并删除，不可恢复。').then(function (yes) {
                if (!yes) return;
                TA.request('../../api/admin/essay/grader.php?action=delete_pending', {
                    method: 'POST',
                    body: TA.toForm({ id: params.id })
                }).then(function (res) {
                    if (res.code !== 0) { TA.toast(res.msg || '删除失败'); return; }
                    TA.toast('存档已删除');
                    loadPending(true);
                    TA.closeTask();
                }).catch(function () { TA.toast('网络异常'); });
            });
        });
        // 单篇开始批改
        var grade = $('#taDdGrade', bodyEl);
        if (grade) grade.addEventListener('click', function () {
            openModelSheet(function (model) {
                createJob([Number(params.id)], model, function () {
                    TA.toast('批改完成，正在刷新');
                    loadPending(true);
                    loadDone(true);
                    TA.closeTask();
                });
            });
        });
        // 修正识别正文（仅待批）
        var editOcr = $('#taDdEditOcr', bodyEl);
        if (editOcr) editOcr.addEventListener('click', function () {
            var cur = 0;
            var wrap = document.createElement('div');
            wrap.innerHTML =
                '<div class="ta-ocr-pages">' + imgs.map(function (im, i) {
                    return '<button type="button" class="ta-chip' + (i === 0 ? ' active' : '') + '" data-pi="' + i + '">第' + (im.page_no || i + 1) + '页</button>';
                }).join('') + '</div>' +
                '<textarea class="ta-input" id="taOcrEdit" style="min-height:180px;line-height:1.6;">' + esc((imgs[0].ocr_text || '').trim()) + '</textarea>' +
                '<div class="ta-pick-cap">保存将按页序重建识别正文与字数（仅待批改状态可修改）</div>' +
                '<button type="button" class="ta-btn-primary wide" id="taOcrSave">保存修正（当前页）</button>';
            wrap.querySelectorAll('.ta-ocr-pages .ta-chip').forEach(function (chip) {
                chip.addEventListener('click', function () {
                    cur = Number(chip.dataset.pi);
                    wrap.querySelectorAll('.ta-ocr-pages .ta-chip').forEach(function (x) { x.classList.toggle('active', x === chip); });
                    wrap.querySelector('#taOcrEdit').value = (imgs[cur].ocr_text || '').trim();
                });
            });
            wrap.querySelector('#taOcrSave').addEventListener('click', async function () {
                var text = wrap.querySelector('#taOcrEdit').value.trim();
                var btn = wrap.querySelector('#taOcrSave');
                btn.disabled = true;
                try {
                    var res = await TA.request('../../api/admin/essay/save_ocr.php', {
                        method: 'POST',
                        body: TA.toForm({ image_id: imgs[cur].id, ocr_text: text })
                    });
                    if (res.code !== 0) {
                        btn.disabled = false;
                        TA.toast(res.msg || '保存失败');
                        return;
                    }
                    TA.closeSheet();
                    TE.tasks['essay-detail'](bodyEl, params, entry);
                } catch (e) {
                    btn.disabled = false;
                    TA.toast('网络异常');
                }
            });
            TA.openSheet('修正识别正文', wrap);
        });
        // 教师复核（AI率/抄袭率修正 + 留痕理由）
        var reviewBtn = $('#taDdReview', bodyEl);
        if (reviewBtn) reviewBtn.addEventListener('click', function () {
            var wrap = document.createElement('div');
            wrap.innerHTML =
                '<div class="ta-rw-row"><span>AI 疑似度 %</span><input type="number" class="ta-input" id="taRvAi" style="width:110px;margin:0;" value="' + esc(d.ai_rate || 0) + '" min="0" max="100"></div>' +
                '<div class="ta-rw-row"><span>抄袭疑似度 %</span><input type="number" class="ta-input" id="taRvPlag" style="width:110px;margin:0;" value="' + esc(d.plagiarism_rate || 0) + '" min="0" max="100"></div>' +
                '<input type="text" class="ta-input" id="taRvNote" placeholder="复核理由（必填，永久留痕）">' +
                '<button type="button" class="ta-btn-primary wide" id="taRvOk">提交复核</button>';
            wrap.querySelector('#taRvOk').addEventListener('click', async function () {
                try {
                    var res = await TA.request('../../api/admin/essay/list.php?action=teacher_review', {
                        method: 'POST',
                        body: TA.toForm({
                            submission_id: params.id,
                            ai_rate: wrap.querySelector('#taRvAi').value,
                            plagiarism_rate: wrap.querySelector('#taRvPlag').value,
                            note: wrap.querySelector('#taRvNote').value
                        })
                    });
                    if (res.code !== 0) { TA.toast(res.msg || '复核提交失败'); return; }
                    TA.closeSheet();
                    TE.tasks['essay-detail'](bodyEl, params, entry);
                } catch (e) { TA.toast('网络异常'); }
            });
            TA.openSheet('教师复核', wrap);
        });
        // 发分
        var reward = $('#taDdReward', bodyEl);
        if (reward) reward.addEventListener('click', function () {
            var defScore = Number(d.total_reward_score || d.quality_reward_score || 3) || 3;
            openRewardSheet(defScore, function (score, reason) {
                TA.request('../../api/admin/essay/reward.php', {
                    method: 'POST',
                    body: TA.toForm({ submission_id: params.id, reward_score: score, reason: reason })
                }).then(function (res) {
                    if (res.code !== 0) { TA.toast(res.msg || '发分失败'); return; }
                    TA.toast('发分成功');
                    loadDone(true);
                    TE.tasks['essay-detail'](bodyEl, params, entry);
                }).catch(function () { TA.toast('网络异常'); });
            }, Number(d.base_reward_score || 0));
        });
        }).catch(function (e) {
            bodyEl.innerHTML = '<div class="ta-empty"><i class="ri-error-warning-line"></i><span>' + esc(e.message || '详情加载失败') + '</span></div>';
        });
    };

    function openRewardSheet(defScore, onOk, baseScore) {
        var score = defScore;
        var wrap = document.createElement('div');
        wrap.innerHTML =
            '<div class="ta-rw-sum">' +
                '<span>基础分（批改时已发放）：<b>' + (baseScore || 0) + '</b> 分</span>' +
                '<span>本次追加：质量优秀奖励分（1~50）</span>' +
            '</div>' +
            '<div class="ta-rw-row"><span>质量奖励分值</span>' +
                '<span class="ta-stepper"><button type="button" data-d="-1">−</button><b id="taRwVal">' + score + '</b><button type="button" data-d="1">＋</button></span></div>' +
            '<div class="ta-rw-reasons">' + ['书写工整', '立意突出', '进步明显', '质量优秀'].map(function (r) {
                return '<button type="button" class="ta-chip" data-r="' + r + '">' + r + '</button>';
            }).join('') + '</div>' +
            '<input type="text" class="ta-input" id="taRwReason" placeholder="发分原因（可编辑）">' +
            '<button type="button" class="ta-btn-primary wide" id="taRwOk">确认发分</button>';
        var valEl = $('#taRwVal', wrap);
        $$('.ta-stepper button', wrap).forEach(function (b) {
            b.addEventListener('click', function () {
                score = Math.max(0, score + Number(b.dataset.d));
                valEl.textContent = score;
            });
        });
        var reasonEl = $('#taRwReason', wrap);
        $$('.ta-rw-reasons .ta-chip', wrap).forEach(function (c) {
            c.addEventListener('click', function () {
                reasonEl.value = c.dataset.r;
                $$('.ta-rw-reasons .ta-chip', wrap).forEach(function (x) { x.classList.toggle('active', x === c); });
            });
        });
        $('#taRwOk', wrap).addEventListener('click', function () {
            var reason = reasonEl.value.trim() || '作文奖励';
            TA.closeSheet();
            onOk(score, reason);
        });
        TA.openSheet('确认发分', wrap);
    }

    function openImageViewer(src) {
        var wrap = document.createElement('div');
        wrap.className = 'ta-imgviewer';
        wrap.innerHTML = '<img src="' + esc(src) + '" alt="">';
        wrap.addEventListener('click', function () { wrap.remove(); });
        document.body.appendChild(wrap);
    }

    // ==================== 拍照上传任务页 ====================
    TE.tasks['camera'] = function (bodyEl, params, entry) {
    var photos = [];      // {uid, gid, file, blobUrl, status, progress, url, ocr}
    var meta = {};        // gid -> {student, needsConfirm, title, archivedSubId}
    var nextGid = 1;
    var uploading = false;
    var archiving = false;
    var jobFailed = false;
    var batchMode = 'notebook', arranging = false, splitApplied = false;
    var currentUpload = 0, viewPage = 0, perPage = 24, pauseReason = "";

    function gidMeta(gid) {
        if (!meta[gid]) meta[gid] = { student: null, needsConfirm: true, title: '', archivedSubId: 0 };
        return meta[gid];
    }

    function loadStudentCache() {
        if (TE.studentCache && TE.studentCache.length) return Promise.resolve();
        return TA.request('../../api/admin/essay/list.php?action=students').then(function (res) {
            if (res.code === 0 && res.data) TE.studentCache = res.data.list || [];
        }).catch(function () {});
    }

    // 分组 = 按 photos 顺序对 gid 去重；组元数据持久在 meta，重渲染不丢
    function buildGroups() {
        var order = [];
        photos.forEach(function (p) {
            if (order.indexOf(p.gid) < 0) order.push(p.gid);
        });
        return order.map(function (gid) {
            var m = gidMeta(gid);
            var g = {
                gid: gid,
                student: m.student,
                needsConfirm: m.needsConfirm,
                title: m.title,
                archivedSubId: m.archivedSubId,
                detectedName: '',
                matchState: 'none',
                photos: photos.filter(function (p) { return p.gid === gid; })
            };
            var first = g.photos[0];
            if (first && first.ocr && first.ocr.detected_student_name) {
                g.detectedName = first.ocr.detected_student_name;
                if (!g.student) {
                    var m2 = (TE.studentCache || []).filter(function (s) {
                        return (s.show_name || s.name || '') === g.detectedName;
                    });
                    if (m2.length === 1) {
                        g.student = { id: m2[0].id, name: m2[0].show_name || m2[0].name };
                        g.matchState = 'unique';
                        if (m.needsConfirm === true && m.confirmedOnce !== true) {
                            g.needsConfirm = (first.ocr.confidence !== undefined && Number(first.ocr.confidence) < (Number(first.ocr.confidence) <= 1 ? 0.6 : 60));
                        }
                    } else if (m2.length > 1) {
                        g.matchState = 'multi';
                    }
                }
            }
            return g;
        });
    }

    function photoIndex(uid) {
        return photos.findIndex(function (p) { return String(p.uid) === String(uid); });
    }

    function render() {
        var groups = buildGroups(), locked = uploading || arranging || archiving;
        var maxPage=Math.max(0,Math.ceil(photos.length/perPage)-1);viewPage=Math.min(viewPage,maxPage);
        var visible=photos.slice(viewPage*perPage,(viewPage+1)*perPage);
        var uidSet={};visible.forEach(function(p){uidSet[p.uid]=true;});
        var shownGroups=groups.filter(function(g){return g.photos.some(function(p){return uidSet[p.uid];});});
        bodyEl.querySelector('#taCamGrid').innerHTML = shownGroups.map(function(g) {
            var gi=groups.indexOf(g);
            var archived = !!g.archivedSubId;
            var label = archived ? '已存档' : (!g.student ? '待确认学生' : (g.needsConfirm ? '需确认识别姓名' : g.student.name));
            return '<section class="ta-gcard"><div class="ta-ghead"><strong class="ta-gtitle">' +
                (!splitApplied && batchMode === 'notebook' ? '待分篇照片' : '第 ' + (gi+1) + ' 篇') + ' · ' + g.photos.length + ' 页</strong>' +
                '<span class="ta-badge ' + (g.student && !g.needsConfirm ? 'ok' : 'warn') + '">' + esc(label) + '</span></div>' +
                '<div class="ta-gphotos">' + g.photos.filter(function(p){return uidSet[p.uid];}).map(function(p) {
                    var idx=photoIndex(p.uid), done=p.status==='done';
                    var state=done?'识别完成':p.status==='uploading'?(p.progress===100?'上传完成，正在识别文字…':'上传中 '+p.progress+'%'):p.status==='error'?'识别失败':'待识别';
                    var imageSrc=done && p.url ? TA.img(p.url) : (p.editSource || p.blobUrl);
                    return '<article class="ta-photo-cell" data-uid="'+p.uid+'"><button type="button" class="ta-ph-preview" data-act="view" aria-label="放大第'+(idx+1)+'张照片"><img src="'+esc(imageSrc)+'" style="transform:rotate('+(p.rotation||0)+'deg)" loading="lazy" alt="第'+(idx+1)+'张完整作文照片"><span>第 '+(idx+1)+' 张 · 点图放大</span></button>'+
                        '<div class="ta-ph-state '+(p.status==='error'?'err':'')+'">'+esc(state)+'</div>'+
                        (p.error?'<div class="ta-ph-error">'+esc(p.error)+'</div>':'')+
                        (p.notice?'<div class="ta-ph-notice">'+esc(p.notice)+'</div>':'')+
                        '<div class="ta-ph-tools">'+
                        [['rot','旋转'],['more','更多'],['prev','前移'],['next','后移'],['split','从此页分篇'],['del','移除']].map(function(a){return '<button type="button" data-act="'+a[0]+'"'+(locked||archived?' disabled':'')+'>'+a[1]+'</button>';}).join('')+
                        (p.status==='error'?'<button type="button" data-act="retry"'+(locked?' disabled':'')+'>重试此页</button>':'')+'</div></article>';
                }).join('')+'</div>'+
                '<div class="ta-gfooter"><button type="button" class="ta-btn-mini" data-gmerge="'+g.gid+'"'+(gi===0||locked||archived?' disabled':'')+'>并入上篇</button>'+
                '<button type="button" class="ta-btn-mini" data-gtitle="'+g.gid+'"'+(locked||archived?' disabled':'')+'>设置题目</button></div>'+
                '<button type="button" class="ta-cam-field" data-gstudent="'+g.gid+'"'+(locked||archived?' disabled':'')+'><span class="lbl">学生</span><span class="val">'+esc(g.student?g.student.name:(g.detectedName?'识别到 '+g.detectedName+' · 点击确认':'点击选择学生'))+'</span></button></section>';
        }).join('');
        var doneN=photos.filter(function(p){return p.status==='done';}).length;
        var errors=photos.filter(function(p){return p.status==='error';}).length;
        bodyEl.querySelector('#taCamMeta').textContent = !photos.length ? '先选择照片，点图放大检查方向；封面与正文连续排列。识别后确认每篇学生。' :
            (uploading?'正在处理第 '+currentUpload+'/'+photos.length+' 张。上传完成后还需等待文字识别，请勿重复点击。':arranging?'正在检查照片方向…':
            '已识别 '+doneN+'/'+photos.length+' 张'+(errors?' · '+errors+' 张失败，原因显示在照片下方':'')+(splitApplied?' · 共 '+groups.length+' 篇，请核对学生与页序':' · 识别完成后自动分篇，也可点击「从此页分篇」'));
        bodyEl.querySelector('#taCamUpload').textContent=uploading?'识别中 '+currentUpload+'/'+photos.length:doneN===photos.length&&photos.length?'全部已识别':errors?'重试未成功照片'+uploadLabel():'上传识别'+uploadLabel();
        setCamBusy(locked);
        ['taCamMode','taCamOrient','taCamRotateAll'].forEach(function(id){bodyEl.querySelector('#'+id).disabled=locked||!!archivedSubCount();});
        bodyEl.querySelectorAll('.ta-cam-src input').forEach(function(el){el.disabled=locked;});
        var pager=bodyEl.querySelector('#taCamPager');
        pager.innerHTML=photos.length?'<button type="button" data-page="-1"'+(viewPage===0?' disabled':'')+'>上一页</button><span>第 '+(viewPage+1)+'/'+(maxPage+1)+' 页 · '+photos.length+' 张</span><button type="button" data-page="1"'+(viewPage===maxPage?' disabled':'')+'>下一页</button>':'';
        pager.querySelectorAll('[data-page]').forEach(function(b){b.onclick=function(){viewPage+=Number(b.dataset.page);render();bodyEl.scrollTop=0;window.scrollTo(0,0);};});
        if(pauseReason)bodyEl.querySelector('#taCamMeta').textContent=pauseReason+'；队列已暂停，成功照片保留，恢复后点击上传识别继续。';
        bindGrid();
    }

    function uploadLabel() {
        var n = photos.filter(function (p) { return p.status === 'local' || p.status === 'error'; }).length;
        return n ? '（' + n + ' 张待传）' : '';
    }

    function splitAt(idx) {
        if(idx<0 || idx>=photos.length) return;
        var old=photos[idx].gid;
        if(gidMeta(old).archivedSubId) return;
        if(idx===0 || photos[idx-1].gid!==old) { photos[idx].manualStart=true; splitApplied=true; render(); return; }
        var fresh=nextGid++;
        for(var i=idx;i<photos.length && photos[i].gid===old;i++) photos[i].gid=fresh;
        photos[idx].manualStart=true; splitApplied=true; render();
    }

    function bindGrid() {
        bodyEl.querySelectorAll('.ta-photo-cell').forEach(function(cell){
            cell.querySelectorAll('[data-act]').forEach(function(b){b.addEventListener('click',async function(){
                var idx=photoIndex(cell.dataset.uid),p=photos[idx]; if(!p)return;
                var act=b.dataset.act;
                if(act==='view'){openPhotoViewer(p.uid);return;}
                if(act==='more'){
                    var wrap=document.createElement('div');wrap.innerHTML='<div class="ta-cam-more">'+[['prev','前移一页'],['next','后移一页'],['split','从此页另起一篇'],['del','移除此页']].map(function(a){return '<button type="button" class="ta-chip" data-more="'+a[0]+'">'+a[1]+'</button>';}).join('')+'</div>';
                    wrap.querySelectorAll('[data-more]').forEach(function(x){x.onclick=function(){TA.closeSheet();cell.querySelector('[data-act="'+x.dataset.more+'"]').click();};});TA.openSheet('第 '+(idx+1)+' 张照片',wrap);return;
                }
                if(uploading||arranging||archiving||gidMeta(p.gid).archivedSubId)return;
                if(act==='retry'){await uploadAll(p.uid);return;}
                if(act==='rot'){arranging=true;render();await rotatePhoto(p,90);arranging=false;render();return;}
                if(act==='split'){splitAt(idx);return;}
                if(act==='del'){URL.revokeObjectURL(p.blobUrl);photos.splice(idx,1);render();return;}
                var j=idx+(act==='prev'?-1:1);if(j<0||j>=photos.length||gidMeta(photos[j].gid).archivedSubId)return;
                var other=photos[j];if(other.gid!==p.gid){p.gid=other.gid;p.manualStart=false;p.manualContinue=true;}
                photos[j]=p;photos[idx]=other;splitApplied=true;render();
            });});
        });
        bodyEl.querySelectorAll('[data-gmerge]').forEach(function(b){b.addEventListener('click',function(){
            if(uploading||arranging||archiving)return;
            var groups=buildGroups(),idx=groups.findIndex(function(g){return g.gid===Number(b.dataset.gmerge);});
            if(idx<=0||groups[idx].archivedSubId||groups[idx-1].archivedSubId)return;
            groups[idx].photos.forEach(function(p){p.gid=groups[idx-1].gid;p.manualStart=false;p.manualContinue=true;});
            delete meta[groups[idx].gid];splitApplied=true;render();
        });});
        bodyEl.querySelectorAll('[data-gstudent]').forEach(function(b){b.addEventListener('click',function(){
            var gid=Number(b.dataset.gstudent);
            openStudentSheet(function(picked){var m=gidMeta(gid);m.student=picked;m.needsConfirm=false;m.confirmedOnce=true;render();},'');
        });});
        bodyEl.querySelectorAll('[data-gtitle]').forEach(function(b){b.addEventListener('click',function(){
            var gid=Number(b.dataset.gtitle);openTitleSheet(function(title){gidMeta(gid).title=title;render();});
        });});
    }

    function openPhotoViewer(uid) {
        var idx=photoIndex(uid),p=photos[idx];if(!p)return;
        var wrap=document.createElement('div');wrap.className='ta-cam-viewer';
        wrap.innerHTML='<div class="ta-cam-viewhead"><button type="button" data-close>关闭</button><span data-caption></span></div><div class="ta-cam-viewbody"><img alt="作文照片"></div><div class="ta-cam-viewactions"><button type="button" data-nav="-1">上一张</button>'+[90,180,270].map(function(d){return '<button type="button" data-deg="'+d+'">'+(d===270?'左转':d===180?'180°':'右转')+'</button>';}).join('')+'<button type="button" data-nav="1">下一张</button></div>';
        function show(){p=photos[idx];var img=wrap.querySelector('img');img.src=p.status==='done'&&p.url?TA.img(p.url):p.editSource||p.blobUrl;img.style.transform='rotate('+(p.rotation||0)+'deg)';img.style.maxWidth=(p.rotation%180?'75%':'100%');img.style.maxHeight=(p.rotation%180?'75%':'100%');wrap.querySelector('[data-caption]').textContent='第 '+(idx+1)+'/'+photos.length+' 张 · 点击旋转即时预览';}
        wrap.querySelector('[data-close]').onclick=function(){wrap.remove();};
        wrap.querySelectorAll('[data-nav]').forEach(function(b){b.onclick=function(){idx=Math.max(0,Math.min(photos.length-1,idx+Number(b.dataset.nav)));show();};});
        wrap.querySelectorAll('[data-deg]').forEach(function(b){b.onclick=function(){if(uploading||arranging||archiving||gidMeta(p.gid).archivedSubId){TA.toast('当前正在处理或已存档，不能旋转');return;}rotatePhoto(p,Number(b.dataset.deg));show();render();};});show();document.body.appendChild(wrap);
    }

    function imageCanvas(p,maxEdge,applyRotation) {
        return new Promise(function(resolve,reject){var img=new Image();img.onload=function(){
            var scale=Math.min(1,(maxEdge||Infinity)/Math.max(img.naturalWidth,img.naturalHeight));
            var w=Math.max(1,Math.round(img.naturalWidth*scale)),h=Math.max(1,Math.round(img.naturalHeight*scale)),deg=applyRotation?(p.rotation||0):0;
            var cv=document.createElement('canvas'),quarter=deg%180!==0;cv.width=quarter?h:w;cv.height=quarter?w:h;
            var ctx=cv.getContext('2d');ctx.translate(cv.width/2,cv.height/2);ctx.rotate(deg*Math.PI/180);ctx.drawImage(img,-w/2,-h/2,w,h);resolve(cv);
        };img.onerror=function(){reject(new Error('无法读取照片，请改选 JPG/PNG 照片'));};img.src=p.status==='done'&&p.url?TA.img(p.url):p.editSource||p.blobUrl;});
    }
    function invalidate(p){p.status='local';p.url='';p.ocr=null;p.error='';p.prepared=false;}
    function rotatePhoto(p,degrees){
        if(p.status==='done'&&p.url){p.editSource=TA.img(p.url);p.rotation=0;}
        p.rotation=((p.rotation||0)+degrees)%360;invalidate(p);p.notice='方向已调整，上传时按此方向处理';return Promise.resolve(true);
    }
    async function preparePhoto(p){
        if(p.prepared)return;
        var cv=await imageCanvas(p,2400,true),blob=await new Promise(function(resolve){cv.toBlob(resolve,'image/jpeg',0.9);});
        if(!blob)throw new Error('照片转换失败，请重新选择');
        p.file=new File([blob],p.file.name.replace(/\.[^.]+$/,'')+'.jpg',{type:'image/jpeg',lastModified:p.file.lastModified});p.prepared=true;
    }

    function addFiles(files) {
        if(uploading||arranging||archiving)return;
        var gid=photos.length&&!gidMeta(photos[photos.length-1].gid).archivedSubId?photos[photos.length-1].gid:nextGid++;
        var rejected=0;
        Array.prototype.slice.call(files).forEach(function(f){
            if(!/^image\//.test(f.type)&&! /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name)){rejected++;return;}
            photos.push({uid:Date.now()+'_'+Math.random().toString(36).slice(2,9),gid:batchMode==='single_sheet'?nextGid++:gid,file:f,blobUrl:URL.createObjectURL(f),status:'local',progress:0,url:'',ocr:null,error:'',manualStart:batchMode==='single_sheet'});
        });if(rejected)TA.toast(rejected+' 个非照片文件未加入');if(batchMode==='single_sheet')splitApplied=true;render();
    }

    function uploadOne(p,idx) {
        p.status='uploading';p.progress=0;p.error='';render();
        return new Promise(function(resolve){
            var xhr=new XMLHttpRequest(),settled=false;
            function finish(error,data){if(settled)return;settled=true;
                if(error){p.status='error';p.error=error;}else{p.status='done';p.url=data.image_url;p.ocr=data;p.rotation=0;p.editSource='';
                    p.notice=data.rotation_applied?'识别时自动旋转 '+data.rotation_applied+'°（已显示扶正图）':data.orientation_confidence==='low'?'方向不确定，请点图检查':'方向检查完成';}
                render();resolve();
            }
            xhr.open('POST','../../api/admin/essay/ocr.php');xhr.timeout=240000;
            xhr.upload.addEventListener('progress',function(e){if(e.lengthComputable){p.progress=Math.round(e.loaded/e.total*100);var el=bodyEl.querySelector('[data-uid="'+p.uid+'"] .ta-ph-state');if(el)el.textContent=p.progress===100?'上传完成，正在识别文字…':'上传中 '+p.progress+'%';}});
            xhr.onload=function(){
                var data;try{data=JSON.parse(xhr.responseText.replace(/^\uFEFF/,''));}catch(e){if(xhr.status===503){pauseReason='识别服务暂时不可用（HTTP 503）';p.pause=true;}finish('识别服务返回异常（HTTP '+xhr.status+'），请重试此页');return;}
                if(xhr.status>=200&&xhr.status<300&&Number(data.code)===0&&data.data&&data.data.image_url)finish(null,data.data);
                else {if(xhr.status===503||Number(data.code)===503){pauseReason=data.msg||data.message||'识别服务暂时维护中';p.pause=true;}finish(data.msg||data.message||(xhr.status===401?'登录已失效，请重新登录':'识别失败（HTTP '+xhr.status+'）'));}
            };
            xhr.onerror=function(){finish('网络连接中断，成功页已保留；请仅重试此页');};
            xhr.ontimeout=function(){finish('识别等待超时，可能仍在服务器处理；稍后仅重试此页（服务器支持缓存）');};
            xhr.onabort=function(){finish('上传已中断，请重试此页');};
            var fd=new FormData();fd.append('image',p.file);fd.append('page_no',idx+1);fd.append('page_role','auto');fd.append('batch_mode',batchMode);
            if(idx>0&&photos[idx-1].ocr)fd.append('previous_tail',String(photos[idx-1].ocr.content||'').slice(-160));
            try{xhr.send(fd);}catch(e){finish('无法发送照片：'+e.message);}
        });
    }

    function applySplits() {
        var current=null,lastName='';
        photos.forEach(function(p,i){
            if(gidMeta(p.gid).archivedSubId){current=null;return;}
            var name=p.ocr&&p.ocr.detected_student_name||'';
            var starts=p.ocr&&(p.ocr.starts_new_essay===true||p.ocr.starts_new_essay===1||p.ocr.starts_new_essay==='true');
            var newName=name&&lastName&&name!==lastName;
            if(current===null || (i>0 && (p.manualStart || (!p.manualContinue && (batchMode==='single_sheet'||starts||newName)))))current=p.gid!==current?p.gid:nextGid++;
            p.gid=current;if(name)lastName=name;
        });splitApplied=true;
    }

    async function uploadAll(onlyUid) {
        if(typeof onlyUid!=='string')onlyUid='';
        if(uploading||arranging||archiving)return;
        if(!photos.length){TA.toast('请先拍摄或选择照片');return;}
        uploading=true;pauseReason='';
        try{
            for(var i=0;i<photos.length;i++){
                var p=photos[i];if(p.status==='done'||gidMeta(p.gid).archivedSubId||(onlyUid&&p.uid!==onlyUid))continue;
                currentUpload=i+1;render();
                p.pause=false;try{await preparePhoto(p);await uploadOne(p,i);if(p.pause)break;}catch(e){p.status='error';p.error=e.message;render();}
            }
            await loadStudentCache();applySplits();
        }finally{uploading=false;currentUpload=0;render();}
        var errors=photos.filter(function(p){return p.status==='error';}).length;
        TA.toast(errors?'识别结束，'+errors+' 张未成功，查看照片下的原因后重试':'全部照片已识别，请核对分篇与学生');
    }

    async function orientAll() {
        if(uploading||arranging||archiving||!photos.length)return;
        arranging=true;render();var uncertain=0;
        try{for(var i=0;i<photos.length;i++){
            var p=photos[i];if(i<viewPage*perPage||i>=(viewPage+1)*perPage||p.status==='done'||gidMeta(p.gid).archivedSubId)continue;
            try{var cv=await imageCanvas(p,1200,true),res=await TA.request('../../api/admin/essay/detect_rotation.php',{method:'POST',body:TA.toForm({image:cv.toDataURL('image/jpeg',0.8)})});
                var data=res.data||{},deg=Number(data.rotation_degrees);
                if(Number(res.code)===0&&data.confidence==='high'&&[0,90,180,270].indexOf(deg)>=0){if(deg)await rotatePhoto(p,deg);else p.notice='方向检查通过';}
                else{uncertain++;p.notice=res.msg||'方向无法可靠判断，请点图放大并手动旋转';if(Number(res.code)!==0){TA.toast(p.notice+'，方向检查已停止');break;}}
            }catch(e){uncertain++;p.notice='方向服务暂不可用，请手动旋转';}render();
        }}finally{arranging=false;render();}
        TA.toast(uncertain?uncertain+' 张方向不确定，请手动检查':'方向检查完成（未调用批改模型）');
    }

    async function doArchive(thenGrade) {
        if (archiving || uploading || arranging) return;
        var groups = buildGroups();
        var todo = groups.filter(function (g) { return !g.archivedSubId; });
        if (!photos.length || !todo.length) {
            if (archivedSubCount()) {
                if (thenGrade) startGradeFor(allArchivedSubIds(), function(){loadPending(true);TA.closeTask();});
                else {loadPending(true);TA.closeTask();}
            } else TA.toast('请先选择作文照片');
            return;
        }
        if (photos.some(function (p) { return p.status !== 'done' && !gidMeta(p.gid).archivedSubId; })) {
            TA.toast('还有照片未上传，请先点「上传识别」'); return;
        }
        var bad = todo.filter(function (g) { return !g.student || g.needsConfirm; });
        if (bad.length) {
            var gi = groups.indexOf(bad[0]);
            TA.toast('第 ' + (gi + 1) + ' 篇学生' + (!bad[0].student ? '未确认' : '为低置信结果，需手动确认后才能存档'));
            return;
        }
        var yes = await TA.confirm('将 ' + todo.length + ' 篇作文分别存档到对应学生名下' + (thenGrade ? '，并对已存档篇目开始批改？' : '？'));
        if (!yes) return;
        archiving = true;
        setCamBusy(true);
        var failMsgs = [];
        for (var k = 0; k < todo.length; k++) {
            var g = todo[k];
            var m = gidMeta(g.gid);
            var t = m.title || (g.photos[0].ocr && g.photos[0].ocr.title) || '';
            try {
                var res = await TA.request('../../api/admin/essay/grader.php?action=archive', {
                    method: 'POST',
                    body: TA.toForm({
                        student_id: g.student.id,
                        essay_id: 0,
                        title: t,
                        images: JSON.stringify(g.photos.map(function (p) { return { image_url: p.url }; }))
                    })
                });
                if (res.code === 0 && res.data && res.data.submission_id) {
                    m.archivedSubId = Number(res.data.submission_id);
                } else {
                    failMsgs.push('「' + g.student.name + '」：' + (res.msg || '存档失败'));
                }
            } catch (e) {
                failMsgs.push('「' + g.student.name + '」：网络异常');
            }
        }
        archiving = false;
        var done = todo.length - failMsgs.length;
        if (done) TA.toast('已存档 ' + done + '/' + todo.length + ' 篇');
        var remaining = buildGroups().filter(function (g) { return !g.archivedSubId; }).length;
        render();
        if (failMsgs.length) {
            setCamBusy(false);
            TA.openSheet('存档结果', '<div class="ta-pick-cap okline">成功 ' + done + ' 篇（已保留）</div>' +
                '<div class="ta-pick-cap errline">失败 ' + failMsgs.length + ' 篇（仅失败篇可重试，成功篇不会重复存档）</div>' +
                '<div class="ta-d-text">' + failMsgs.map(esc).join('<br>') + '</div>');
            return;
        }
        if (remaining > 0) { setCamBusy(false); return; }
        if (thenGrade) {
            startGradeFor(allArchivedSubIds(), function () {
                loadPending(true);
                TA.closeTask();
            });
        } else {
            loadPending(true);
            TA.closeTask();
        }
    }

    function archivedSubCount() {
        return Object.keys(meta).filter(function (k) { return meta[k].archivedSubId; }).length;
    }
    function allArchivedSubIds() {
        return Object.keys(meta).map(function (k) { return meta[k]; })
            .filter(function (m) { return m.archivedSubId; })
            .map(function (m) { return m.archivedSubId; });
    }

    function startGradeFor(subIds, onDone) {
        openModelSheet(function (model) {
            createJob(subIds, model, onDone, function () {
                jobFailed = true;
                setCamBusy(false);
                var gBtn = document.querySelector('#taCamGrade');
                if (gBtn) { gBtn.disabled = false; gBtn.innerHTML = '<i class="ri-refresh-line"></i>重试批改'; }
                TA.toast('存档已完成，批改任务创建失败，可点「重试批改」');
            });
        });
    }

    function setCamBusy(busy) {
        ['taCamUpload', 'taCamSave', 'taCamGrade'].forEach(function (id) {
            var b = document.querySelector('#' + id);
            if (b) b.disabled = busy;
        });
    }

    function openTitleSheet(onOk) {
        var wrap = document.createElement('div');
        wrap.innerHTML = '<input type="text" class="ta-input" placeholder="作文题目">' +
            '<div class="ta-pick-cap">或从命题任务选择</div><div class="ta-pick-list" id="taCtTopics"></div>' +
            '<button type="button" class="ta-btn-primary wide" id="taCtOk">确定</button>';
        TA.request('../../api/admin/essay/list.php?action=essays').then(function (res) {
            var box = wrap.querySelector('#taCtTopics');
            if (res.code !== 0 || !res.data) { box.innerHTML = '<div class="ta-empty"><span>命题加载失败</span></div>'; return; }
            var list = res.data.list || res.data || [];
            if (!list.length) { box.innerHTML = '<div class="ta-empty"><span>暂无命题任务</span></div>'; return; }
            box.innerHTML = list.map(function (t) {
                return '<button type="button" class="ta-pick-item" data-tt="' + esc(t.title || t.topic || '') + '"><span>' + esc(t.title || t.topic || '') + '</span></button>';
            }).join('');
            box.querySelectorAll('.ta-pick-item').forEach(function (b) {
                b.addEventListener('click', function () {
                    wrap.querySelector('input').value = b.dataset.tt;
                });
            });
        }).catch(function () {});
        wrap.querySelector('#taCtOk').addEventListener('click', function () {
            TA.closeSheet();
            onOk(wrap.querySelector('input').value.trim());
        });
        TA.openSheet('作文题目', wrap);
    }

    bodyEl.classList.add('ta-camera-task');
    bodyEl.innerHTML='<div class="ta-cam-src"><label class="ta-cam-btn primary">拍照<input type="file" accept="image/*" capture="environment" hidden></label><label class="ta-cam-btn">相册多选<input type="file" accept="image/*" multiple hidden></label></div>'+
        '<div class="ta-cam-options"><label>照片形式<select class="ta-input" id="taCamMode"><option value="notebook">作文本：封面＋正文，自动分篇</option><option value="single_sheet">整张作文：每张一篇</option></select></label><div class="ta-cam-direction"><button type="button" class="ta-chip" id="taCamOrient">检查本页方向</button><button type="button" class="ta-chip" id="taCamRotateAll">全部旋转90°</button></div><p>缩略图分页浏览，点图放大并连续切换。旋转即时预览，上传时才处理图片；识别过程会自动检查方向，无需全班先重复检查。</p></div>'+
        '<div class="ta-cam-pager" id="taCamPager"></div><div class="ta-cam-meta" id="taCamMeta" role="status" aria-live="polite"></div><div class="ta-photo-grid" id="taCamGrid"></div>'+
        '<div class="ta-d-actions stack"><button type="button" class="ta-btn-primary wide" id="taCamUpload">上传识别</button><span class="ta-d-row"><button type="button" class="ta-btn-danger2" id="taCamSave">仅存档</button><button type="button" class="ta-btn-primary" id="taCamGrade">存档并批改</button></span></div>';
    bodyEl.querySelectorAll('.ta-cam-src input').forEach(function(input){input.addEventListener('change',function(){addFiles(input.files);input.value='';});});
    bodyEl.querySelector('#taCamMode').onchange=function(){batchMode=this.value;
        if(batchMode==='single_sheet'){photos.forEach(function(p){p.gid=nextGid++;p.manualStart=true;p.manualContinue=false;});splitApplied=true;}
        else{var gid=nextGid++;photos.forEach(function(p){p.gid=gid;p.manualStart=false;p.manualContinue=false;});splitApplied=false;applySplits();}
        render();
    };
    bodyEl.querySelector('#taCamOrient').onclick=orientAll;
    bodyEl.querySelector('#taCamRotateAll').onclick=async function(){if(uploading||arranging||archiving)return;arranging=true;render();try{for(var i=0;i<photos.length;i++)if(!gidMeta(photos[i].gid).archivedSubId)await rotatePhoto(photos[i],90);}finally{arranging=false;render();}};
    bodyEl.querySelector('#taCamUpload').onclick=function(){uploadAll();};
    bodyEl.querySelector('#taCamSave').onclick=function(){doArchive(false);};
    bodyEl.querySelector('#taCamGrade').onclick=function(){if(jobFailed&&archivedSubCount()){jobFailed=false;startGradeFor(allArchivedSubIds(),function(){loadPending(true);TA.closeTask();});return;}doArchive(true);};

    render();
    loadStudentCache();

    entry.onBack = async function () {
        var viewer=document.querySelector('.ta-cam-viewer');
        if(viewer){viewer.remove();return false;}
        if(uploading || arranging || archiving){TA.toast('正在处理照片，请等待完成后返回');return false;}
        var unarchived = photos.length && buildGroups().some(function (g) { return !g.archivedSubId; });
        if (!unarchived) return true;
        var yes = await TA.confirm('仍有未存档的作文照片，返回将放弃。确定返回吗？');
        return yes;
    };
    entry.onClose = function () {
        bodyEl.classList.remove('ta-camera-task');
        document.querySelectorAll('.ta-cam-viewer').forEach(function(el){el.remove();});
        photos.forEach(function (p) { try { URL.revokeObjectURL(p.blobUrl); } catch (e) {} });
    };
};
})();
