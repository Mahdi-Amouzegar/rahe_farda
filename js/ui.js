// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// ui.js -- main list render + filters (ESM)

import {
    state,
    toFa,
    escapeHtml,
    MAX_LENGTH,
    PRIORITY_LABELS,
    faDate,
    trapFocus
} from './core.js';
import { getNow } from './time.js';
import {
    faShort,
    nearestUpcoming,
    recurBadge,
    dayKey,
    hasSessionOn,
    allSessions,
    sessionSummaryHtml,
    taskMatches,
    visibleChildren
} from './sessions.js';
import {
    findTask,
    saveTasks,
    planStats,
    planIsDone,
    planDueKey,
    restoreTrash,
    PLAN_TEMPLATES
} from './store.js';
import {
    JALALI_MONTHS,
    gregorianToJalali,
    jalaliToGregorian,
    jalaliMonthLength
} from './jalali.js';
import { scheduleMarkerRefresh } from './map.js';

// ═══════════════════════════════════════════════════════════════════════════
// Local state
// ═══════════════════════════════════════════════════════════════════════════

let tplDraft = null;
let _tplTrapCleanup = null;
let _trashTrapCleanup = null;
let _calTrapCleanup = null;
let snackTimer = null;

// ═══════════════════════════════════════════════════════════════════════════
// ویرایش
// ═══════════════════════════════════════════════════════════════════════════

export function startEdit(id) {
    state.editingId = id;
    render();
    const taskList = document.getElementById('taskList');
    const editInput = taskList ? taskList.querySelector('.task-edit-input') : null;
    if (editInput) {
        editInput.focus();
        editInput.setSelectionRange(editInput.value.length, editInput.value.length);
    }
}

export function commitEdit(id, value) {
    const text = value.trim().replace(/\s+/g, ' ');
    const found = findTask(id);
    const task = found ? found.task : null;
    if (task) {
        if (text) task.text = text.slice(0, MAX_LENGTH);
        saveTasks();
    }
    state.editingId = null;
    render();
}

export function cancelEdit() {
    state.editingId = null;
    render();
}

// ═══════════════════════════════════════════════════════════════════════════
// فیلتر و جستجو
// ═══════════════════════════════════════════════════════════════════════════

export function getFiltered() {
    const q = state.searchQuery.trim();
    const base = t => {
        if (t.kind === 'plan') {
            if (state.currentFilter === 'archived') {
                return t.archived || (t.children || []).some(c => c.archived);
            }
            if (t.archived) return false;
            if (q) {
                if (taskMatches(t, q)) return true;
                return (t.children || []).some(c => taskMatches(c, q));
            }
            if (state.currentFilter === 'hasloc') {
                return Boolean(t.location) || (t.children || []).some(c => c.location && !c.archived);
            }
            if (state.currentFilter === 'hasdue') {
                return (t.sessions || []).length > 0 || (t.children || []).some(c => (c.sessions || []).length && !c.archived);
            }
            if (state.currentFilter === 'completed') return planIsDone(t);
            if (state.currentFilter === 'active') return !planIsDone(t);
            return true;
        }
        if (state.currentFilter === 'archived') return Boolean(t.archived);
        if (t.archived) return false;
        if (q) return taskMatches(t, q);
        if (state.currentFilter === 'hasloc') return Boolean(t.location);
        if (state.currentFilter === 'hasdue') return (t.sessions || []).length > 0;
        if (state.currentFilter === 'active') return !t.completed;
        if (state.currentFilter === 'completed') return t.completed;
        return true;
    };
    let list = state.tasks.filter(t => {
        if (!base(t)) return false;
        if (!state.selectedDay) return true;
        if (t.kind === 'plan') {
            return hasSessionOn(t, state.selectedDay) || (t.children || []).some(c => hasSessionOn(c, state.selectedDay));
        }
        return hasSessionOn(t, state.selectedDay);
    });
    if (state.currentSort === 'due') {
        const key = t => {
            if (t.kind === 'plan') return planDueKey(t);
            const u = nearestUpcoming(t);
            return u ? new Date(u.at).getTime() : Infinity;
        };
        list = [...list].sort((a, b) => key(a) - key(b));
    } else if (state.currentSort === 'oldest') {
        list = [...list].reverse();
    } else if (state.currentSort === 'alpha') {
        list = [...list].sort((a, b) => a.text.localeCompare(b.text, 'fa'));
    }
    return [...list.filter(t => t.pinned), ...list.filter(t => !t.pinned)];
}

// ═══════════════════════════════════════════════════════════════════════════
// آمار هفتگی
// ═══════════════════════════════════════════════════════════════════════════

export function renderStats(total, done) {
    const box = document.getElementById('statsBox');
    if (!box) return;
    const now = getNow();
    const days = [];
    for (let i = 6; i >= 0; i--) days.push(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i));
    const key = d => d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    const counts = days.map(() => 0);
    const bump = iso => {
        if (!iso) return;
        const d = new Date(iso);
        if (isNaN(d)) return;
        const idx = days.findIndex(x => key(x) === key(d));
        if (idx >= 0) counts[idx]++;
    };
    state.tasks.forEach(t => {
        if (t.archived) return;
        if (t.kind === 'plan') (t.children || []).forEach(c => { if (c.completed && !c.archived) bump(c.completedAt); });
        else if (t.completed) bump(t.completedAt);
    });
    const max = Math.max(1, ...counts);
    const rate = total > 0 ? Math.round((done / total) * 100) : 0;
    box.innerHTML = `<div class="stats-title">📊 ۷ روز گذشته · نرخ تکمیل ${toFa(rate)}٪</div><div class="bars">` +
        days.map((d, i) => {
            let wd = '';
            try {
                wd = d.toLocaleDateString('fa-IR', { weekday: 'narrow' });
            } catch { /* نادیده */ }
            const h = Math.max(3, Math.round((counts[i] / max) * 100));
            return `<div class="bar-col" title="${toFa(counts[i])} انجام‌شده"><div class="bar${counts[i] === 0 ? ' empty' : ''}" style="height: ${h}%;"></div><span>${wd}</span></div>`;
        }).join('') + `</div>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Template Modal
// ════════════════════════���══════════════════════════════════════════════════

export function renderTemplateList() {
    const el = document.getElementById('tplList');
    if (!el) return;
    el.innerHTML = `<div class="tpl-list">` + PLAN_TEMPLATES.map(x =>
        `<button type="button" class="tpl-opt" data-tpl="${x.id}"><b>${escapeHtml(x.title)}</b><span>${toFa(x.children.length)} کار آماده</span></button>`
    ).join('') + `</div>`;
}

function planDateRange(t) {
    const fmt = iso => {
        try {
            return new Date(iso).toLocaleDateString('fa-IR', { day: 'numeric', month: 'long' });
        } catch {
            return '';
        }
    };
    if (t.startAt && t.endAt) return `از ${fmt(t.startAt)} تا ${fmt(t.endAt)}`;
    if (t.startAt) return `از ${fmt(t.startAt)}`;
    if (t.endAt) return `تا ${fmt(t.endAt)}`;
    return '';
}

export function renderTplKids() {
    const el = document.getElementById('tplKids');
    if (!el || !tplDraft) return;
    el.innerHTML = tplDraft.kids.length ? tplDraft.kids.map((k, i) =>
        `<div class="session-item"><span class="session-num">${toFa(i + 1)}</span>` +
        `<span class="session-date">${escapeHtml(k)}</span>` +
        `<button class="btn-icon btn-delete" data-tplkid="${i}" aria-label="حذف کار">✕</button></div>`
    ).join('') : '<div class="session-empty">همه کارها را حذف کردید؛ کار جدید اضافه کنید.</div>';
}

export function getTplDraft() { return tplDraft; }
export function setTplDraft(d) { tplDraft = d; }

export function openTemplateModal() {
    tplDraft = null;
    renderTemplateList();
    document.getElementById('tplList').style.display = '';
    document.getElementById('tplConfig').style.display = 'none';
    document.getElementById('tplKidAdd').style.display = 'none';
    document.getElementById('tplBack').style.display = 'none';
    document.getElementById('tplCreate').style.display = 'none';
    const modal = document.getElementById('templateModal');
    modal.style.display = 'flex';
    if (_tplTrapCleanup) _tplTrapCleanup();
    _tplTrapCleanup = trapFocus(modal);
    const first = modal.querySelector('.tpl-opt, button');
    if (first) setTimeout(() => first.focus(), 60);
}

export function closeTemplateModal() {
    if (_tplTrapCleanup) { _tplTrapCleanup(); _tplTrapCleanup = null; }
    tplDraft = null;
    document.getElementById('tplKidAdd').style.display = 'none';
    document.getElementById('tplBack').style.display = 'none';
    document.getElementById('tplCreate').style.display = 'none';
    document.getElementById('templateModal').style.display = 'none';
}

// ═══════════════════════════════════════════════════════════════════════════
// سطل زباله
// ═══════════════════════════════════════════════════════════════════════════

export function renderTrash() {
    const el = document.getElementById('trashList');
    if (!el) return;
    if (!state.trash.length) {
        el.innerHTML = '<div class="session-empty">سطل زباله خالی است.</div>';
        return;
    }
    const sorted = [...state.trash].sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
    el.innerHTML = sorted.map(x => {
        let dstr = '';
        try {
            dstr = new Date(x.deletedAt).toLocaleDateString('fa-IR', { day: 'numeric', month: 'long' });
        } catch { /* نادیده */ }
        return `<div class="session-item">
            <span class="session-num">${x.kind === 'plan' ? '📁' : '📝'}</span>
            <span class="session-date">${escapeHtml(x.text)} <small>(${dstr})</small></span>
            <button class="btn-icon btn-edit" data-tact="restore" data-tid="${escapeHtml(String(x.id))}" aria-label="بازگردانی">↩</button>
            <button class="btn-icon btn-delete" data-tact="purge" data-tid="${escapeHtml(String(x.id))}" aria-label="حذف همیشگی">✕</button>
        </div>`;
    }).join('');
}

export function openTrash() {
    renderTrash();
    const page = document.getElementById('trashPage');
    page.style.display = 'block';
    document.body.style.overflow = 'hidden';
    if (_trashTrapCleanup) _trashTrapCleanup();
    _trashTrapCleanup = trapFocus(page);
    const back = document.getElementById('trashBack');
    if (back) setTimeout(() => back.focus(), 60);
}

export function closeTrash() {
    if (_trashTrapCleanup) { _trashTrapCleanup(); _trashTrapCleanup = null; }
    document.getElementById('trashPage').style.display = 'none';
    document.body.style.overflow = '';
    render();
}

// ═══════════════════════════════════════════════════════════════════════════
// تقویم ماهانه جلسات
// ═══════════════════════════════════════════════════════════════════════════

export function shiftCalMonth(delta) {
    state.calJm += delta;
    if (state.calJm < 1) { state.calJm = 12; state.calJy -= 1; }
    if (state.calJm > 12) { state.calJm = 1; state.calJy += 1; }
    renderCalendar();
}

export function setSelectedDay(key) {
    state.selectedDay = (state.selectedDay === key) ? null : key;
    render();
    renderCalendar();
}

export function renderCalendar() {
    document.getElementById('calLabel').textContent = JALALI_MONTHS[state.calJm - 1] + ' ' + toFa(state.calJy);
    const g = jalaliToGregorian(state.calJy, state.calJm, 1);
    const leading = (new Date(g.gy, g.gm - 1, g.gd).getDay() + 1) % 7;
    const monthLen = jalaliMonthLength(state.calJy, state.calJm);
    const now = getNow();
    const tj = gregorianToJalali(now.getFullYear(), now.getMonth() + 1, now.getDate());
    const byDay = {};
    allSessions(false).forEach(s => {
        const d = new Date(s.at);
        if (isNaN(d)) return;
        const k = dayKey(d);
        (byDay[k] = byDay[k] || []).push(s);
    });
    let html = '';
    for (let i = 0; i < leading; i++) html += '<span class="picker-day empty"></span>';
    for (let d = 1; d <= monthLen; d++) {
        const gg = jalaliToGregorian(state.calJy, state.calJm, d);
        const k = gg.gy + '-' + gg.gm + '-' + gg.gd;
        const list = byDay[k] || [];
        const isToday = state.calJy === tj.jy && state.calJm === tj.jm && d === tj.jd;
        const cls = 'picker-day cal-day' + (isToday ? ' today' : '') + (state.selectedDay === k ? ' selected' : '');
        const dots = list.slice(0, 3).map(s => `<span class="dot d-${s.priority || 'low'}"></span>`).join('');
        const more = list.length > 3 ? `<span class="dot-more">${toFa(list.length - 3)}+</span>` : '';
        html += `<button class="${cls}" data-calday="${k}" aria-label="${toFa(d)} ${JALALI_MONTHS[state.calJm - 1]}${list.length ? '، ' + toFa(list.length) + ' جلسه' : ''}">${toFa(d)}<span class="cal-dots">${dots}${more}</span></button>`;
    }
    document.getElementById('calDays').innerHTML = html;
}

export function openCal() {
    let base;
    if (state.selectedDay) {
        const [y, m, d] = state.selectedDay.split('-').map(Number);
        base = gregorianToJalali(y, m, d);
    } else {
        const n = getNow();
        base = gregorianToJalali(n.getFullYear(), n.getMonth() + 1, n.getDate());
    }
    state.calJy = base.jy;
    state.calJm = base.jm;
    renderCalendar();
    const overlay = document.getElementById('calOverlay');
    overlay.style.display = 'flex';
    if (_calTrapCleanup) _calTrapCleanup();
    _calTrapCleanup = trapFocus(overlay);
    const close = document.getElementById('calClose');
    if (close) setTimeout(() => close.focus(), 60);
}

export function closeCal() {
    if (_calTrapCleanup) { _calTrapCleanup(); _calTrapCleanup = null; }
    document.getElementById('calOverlay').style.display = 'none';
}

// ═══════════════════════════════════════════════════════════════════════════
// HTML سازها
// ═══════════════════════════════════════════════════════════════════════════

function operationMenu(items, label = 'عملیات') {
    return `<div class="operation-menu">
        <button type="button" class="operation-trigger" data-action="toggle-menu" aria-label="${label}" aria-expanded="false">⋯ <span>عملیات</span></button>
        <div class="operation-list" role="menu" hidden>
            ${items.map(item => `<button type="button" role="menuitem" class="operation-item ${item.className || ''}" data-action="${item.action}" aria-label="${item.label}">${item.icon ? `<span aria-hidden="true">${item.icon}</span>` : ''}<span>${item.label}</span></button>`).join('')}
        </div>
    </div>`;
}

function childHtml(c) {
    if (String(c.id) === String(state.editingId)) {
        return `<div class="child-item" data-id="${escapeHtml(String(c.id))}">
            <div class="edit-wrap">
                <input type="text" class="task-edit-input" value="${escapeHtml(c.text)}" maxlength="${MAX_LENGTH}" aria-label="ویرایش زیرکار">
                <button class="btn-icon btn-ok" data-action="edit-ok" aria-label="تأیید ویرایش">✓</button>
                <button class="btn-icon btn-cancel" data-action="edit-cancel" aria-label="انصراف">✕</button>
            </div>
        </div>`;
    }
    const n = nearestUpcoming(c);
    return `<div class="child-item ${c.completed ? 'completed' : ''} ${String(c.id) === String(state.justAddedId) ? 'just-added' : ''}" data-id="${escapeHtml(String(c.id))}">
        <button class="task-checkbox ${c.completed ? 'checked' : ''}" data-action="toggle"
            aria-label="${c.completed ? 'برگرداندن به انجام نشده' : 'علامت‌گذاری به عنوان انجام شده'}"
            aria-pressed="${c.completed}"></button>
        <span class="child-text" data-action="edit" title="برای ویرایش دو بار کلیک کنید">${escapeHtml(c.text)}</span>
        ${n ? `<span class="child-due">📅 ${faShort(n.at)}</span>` : ''}
        ${(c.location || (c.sessions || []).some(s => s.location)) ? '<span class="child-due">📍</span>' : ''}
        ${(c.photos || []).length ? '<span class="child-due">📷</span>' : ''}
        ${recurBadge(c, 'child-due')}
        <span class="child-actions">
            ${operationMenu(state.currentFilter === 'archived'
                ? [
                    { action: 'unarchive', label: 'بازگردانی از بایگانی', icon: '↩' },
                    { action: 'delete', label: 'حذف زیرکار', icon: '✕', className: 'danger' }
                ]
                : [
                    { action: 'pick-loc', label: c.location ? 'نمایش محل روی نقشه' : 'ثبت محل روی نقشه', icon: '📍' },
                    { action: 'detail', label: 'جزئیات زیرکار', icon: '📋' },
                    { action: 'archive', label: 'بایگانی زیرکار', icon: '📦' },
                    { action: 'delete', label: 'حذف زیرکار', icon: '✕', className: 'danger' }
                ], 'عملیات زیرکار')}
        </span>
    </div>`;
}

function planHtml(task) {
    const st = planStats(task);
    const q = state.searchQuery.trim();
    const open = state.expandedPlans.has(String(task.id)) || (q !== '' && !taskMatches(task, q));
    const kids = visibleChildren(task);
    const drafts = state.childDrafts[task.id] || [];
    const pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
    return `<div class="task-item plan-item prio-${task.priority}"${state.currentSort === 'manual' ? ' draggable="true"' : ''} data-id="${escapeHtml(String(task.id))}">
        <div class="plan-head">
            <button class="plan-caret" data-action="expand" aria-label="باز و بسته کردن برنامه">${open ? '▾' : '◂'}</button>
            <div class="plan-head-main">
                <div class="task-text">📁 ${escapeHtml(task.text)}</div>
                <div class="task-meta">
                    <span class="priority-badge p-${task.priority}">${PRIORITY_LABELS[task.priority]}</span>${recurBadge(task)}
                    <span>زیرکار: ${toFa(st.done)} از ${toFa(st.total)}</span>
                    ${(task.startAt || task.endAt) ? `<span>📅 ${planDateRange(task)}</span>` : ''}
                    ${(task.photos || []).length ? `<span title="${toFa(task.photos.length)} عکس">📷</span>` : ''}
                    <div class="mini-progress"><div class="mini-progress-fill" style="width: ${pct}%;"></div></div>
                    ${st.total > 0 && st.done < st.total ? '<button class="mini-link" data-action="check-all" aria-label="انجام شدن همه زیرکارها">✓ همه انجام شد</button>' : ''}
                </div>
                ${(task.sessions && task.sessions.length) ? sessionSummaryHtml(task) : ''}
            </div>
<div class="task-actions">
            ${operationMenu(state.currentFilter === 'archived'
                ? [
                    { action: 'unarchive', label: 'بازگردانی از بایگانی', icon: '↩' },
                    { action: 'delete', label: 'حذف برنامه', icon: '✕', className: 'danger' }
                ]
                : [
                    { action: 'pin', label: task.pinned ? 'برداشتن سنجاق' : 'سنجاق به بالا', icon: '📌' },
                    { action: 'detail', label: 'جزئیات برنامه', icon: '📋' },
                    { action: 'archive', label: 'بایگانی برنامه', icon: '📦' },
                    { action: 'delete', label: 'حذف برنامه', icon: '✕', className: 'danger' }
                ], 'عملیات برنامه')}
        </div>
        </div>
        ${open ? `<div class="plan-body">
            ${kids.length ? kids.map(c => childHtml(c)).join('') : '<div class="session-empty">هنوز زیرکاری ثبت نشده است.</div>'}
            ${drafts.length ? `<div class="due-chips" style="display: flex; margin: 0;">${drafts.map(s => `<span class="due-chip">📅 ${faShort(s.at)}<button type="button" data-cdchip="${escapeHtml(String(s.id))}" data-gid="${escapeHtml(String(task.id))}" aria-label="حذف">✕</button></span>`).join('')}</div>` : ''}
            <div class="child-add">
                <input type="text" class="child-input" placeholder="زیرکار جدید..." maxlength="${MAX_LENGTH}" aria-label="عنوان زیرکار جدید">
                <select class="child-prio" aria-label="اولویت زیرکار">
                    <option value="low">کم</option>
                    <option value="medium" selected>متوسط</option>
                    <option value="high">زیاد</option>
                </select>
                <button class="btn-icon btn-detail" data-action="child-date" aria-label="تعیین سررسید زیرکار">📅</button>
                <button class="btn-add btn-child-add" data-action="child-add">افزودن</button>
            </div>
        </div>` : ''}
    </div>`;
}

function taskTypeIcon(task) {
    return (task.kind === 'series' || task.recur !== 'none') ? '🔁' : '📝';
}

// ═══════════════════════════════════════════════════════════════════════════
// Snackbar / Undo
// ══════════════════════════════���════════════════════════════════════════════

function buildTrashMessage(ids) {
    if (!ids || ids.length === 0) return 'به سطل زباله منتقل شد';
    if (ids.length === 1) {
        const found = findTask(ids[0]);
        if (!found) {
            const inTrash = (Array.isArray(state.trash) && state.trash)
                ? state.trash.find(x => String(x.id) === String(ids[0]))
                : null;
            if (inTrash) {
                const kindLabel = inTrash.kind === 'plan' ? 'برنامه' : (inTrash.kind === 'series' ? 'دوره' : 'کار');
                return `${kindLabel} «${inTrash.text}» به سطل زباله منتقل شد.`;
            }
            return 'به سطل زباله منتقل شد';
        }
        const task = found.task;
        const kindLabel = task.kind === 'plan' ? 'برنامه' : (task.kind === 'series' ? 'دوره' : 'کار');
        return `${kindLabel} «${task.text}» به سطل زباله منتقل شد.`;
    }
    return `${toFa(ids.length)} مورد به سطل زباله منتقل شد.`;
}

export function showUndoFor(ids, label) {
    const bar = document.getElementById('snackbar');
    if (!bar) return;
    const msg = label || buildTrashMessage(ids);
    document.getElementById('snackMsg').textContent = msg;
    bar.classList.add('show');
    clearTimeout(snackTimer);
    snackTimer = setTimeout(hideSnackbar, 6000);
    document.getElementById('snackUndo').onclick = () => {
        [...ids].reverse().forEach(restoreTrash);
        hideSnackbar();
    };
}

export function hideSnackbar() {
    clearTimeout(snackTimer);
    const bar = document.getElementById('snackbar');
    if (bar) bar.classList.remove('show');
}

// ═══════════════════════════════════════════════════════════════════════════
// رندر اصلی
// ═══════════════════════════════════════════════════════════════════════════

export function render() {
    scheduleMarkerRefresh();
    const live = state.tasks.filter(t => !t.archived);
    const filtered = getFiltered();
    const total = live.length;
    const done = live.filter(t => t.kind === 'plan' ? planIsDone(t) : t.completed).length;
    const pct = total === 0 ? 0 : Math.round((done / total) * 100);

    const totalCountEl = document.getElementById('totalCount');
    const doneCountEl = document.getElementById('doneCount');
    const remainCountEl = document.getElementById('remainCount');
    const progressFill = document.getElementById('progressFill');
    const progressPct = document.getElementById('progressPct');
    const progressBar = document.getElementById('progressBar');
    const taskList = document.getElementById('taskList');

    if (totalCountEl) totalCountEl.textContent = toFa(total);
    if (doneCountEl) doneCountEl.textContent = toFa(done);
    if (remainCountEl) remainCountEl.textContent = toFa(total - done);
    renderStats(total, done);
    const activeCount = total - done;

    const tb = document.getElementById('trashCount');
    if (tb) tb.textContent = state.trash.length ? ` (${toFa(state.trash.length)})` : '';

    const chip = document.getElementById('dayChip');
    if (chip) {
        if (state.selectedDay) {
            const [gy, gm, gd] = state.selectedDay.split('-').map(Number);
            chip.style.display = '';
            chip.innerHTML = `📅 ${new Date(gy, gm - 1, gd).toLocaleDateString('fa-IR', { day: 'numeric', month: 'long' })} <b>✕</b>`;
        } else chip.style.display = 'none';
    }

    let archivedCount = 0;
    let locCount = 0;
    let dueCount = 0;
    state.tasks.forEach(t => {
        if (t.archived) { archivedCount++; return; }
        if (t.location) locCount++;
        if ((t.sessions || []).length) dueCount++;
        if (t.kind === 'plan') (t.children || []).forEach(c => {
            if (c.archived) { archivedCount++; return; }
            if (c.location) locCount++;
            if ((c.sessions || []).length) dueCount++;
        });
    });

    const FILTER_LABELS = { all: 'همه', active: 'انجام نشده', completed: 'انجام شده', archived: '📦 بایگانی', hasloc: '📍 محل‌دار', hasdue: '📅 سررسیددار' };
    const COUNTS = { all: total, active: activeCount, completed: done, archived: archivedCount, hasloc: locCount, hasdue: dueCount };
    document.querySelectorAll('.filter-btn').forEach(b => {
        const f = b.dataset.filter;
        if (!f || !(f in COUNTS)) return;
        b.textContent = FILTER_LABELS[f] + ` (${toFa(COUNTS[f])})`;
    });

    if (progressFill) progressFill.style.width = pct + '%';
    if (progressPct) progressPct.textContent = toFa(pct) + '٪';
    if (progressBar) progressBar.setAttribute('aria-valuenow', pct);

    const doneActionsEl = document.getElementById('doneActions');
    if (doneActionsEl) doneActionsEl.style.display = done > 0 ? 'flex' : 'none';

    if (filtered.length === 0) {
        let msg;
        if (state.searchQuery) {
            msg = 'نتیجه‌ای برای جستجو یافت نشد';
        } else if (state.currentFilter === 'completed') {
            msg = 'هنوز وظیفه انجام شده‌ای ندارید';
        } else if (state.currentFilter === 'active') {
            msg = 'همه وظایف انجام شده‌اند!';
        } else {
            msg = 'لیست وظایف خالی است';
        }
        taskList.innerHTML = `
            <div class="empty-state">
                <div class="icon">✦</div>
                <p>${msg}</p>
                ${state.tasks.length === 0 && !state.searchQuery ? '<p class="empty-hint">برای شروع عنوان را بنویسید و «افزودن» را بزنید — با 📅 تاریخ و با 📍 محل هم می‌توانید اضافه کنید.</p>' : ''}
            </div>`;
        state.justAddedId = null;
        return;
    }

    taskList.innerHTML = filtered.map(task => {
        if (task.kind === 'plan') return planHtml(task);
        if (String(task.id) === String(state.editingId)) {
            return `
            <div class="task-item ${task.completed ? 'completed' : ''}" data-id="${escapeHtml(String(task.id))}">
                <div class="task-content">
                    <div class="edit-wrap">
                        <input type="text" class="task-edit-input" value="${escapeHtml(task.text)}" maxlength="${MAX_LENGTH}" aria-label="ویرایش وظیفه">
                        <button class="btn-icon btn-ok" data-action="edit-ok" aria-label="تأیید ویرایش">✓</button>
                        <button class="btn-icon btn-cancel" data-action="edit-cancel" aria-label="انصراف از ویرایش">✕</button>
                    </div>
                </div>
            </div>`;
        }
        return `
        <div class="task-item prio-${task.priority} ${task.completed ? 'completed' : ''} ${task.id === state.justAddedId ? 'just-added' : ''}"${state.currentSort === 'manual' ? ' draggable="true"' : ''} data-id="${escapeHtml(String(task.id))}">
            <button class="task-checkbox ${task.completed ? 'checked' : ''}" data-action="toggle"
                aria-label="${task.completed ? 'برگرداندن به انجام نشده' : 'علامت‌گذاری به عنوان انجام شده'}"
                aria-pressed="${task.completed}"></button>
            <div class="task-content">
                <div class="task-text" data-action="edit" title="برای ویرایش دو بار کلیک کنید"><span class="task-type-icon" aria-hidden="true">${taskTypeIcon(task)}</span> ${escapeHtml(task.text)}</div>
                <div class="task-meta">
                    <span class="priority-badge p-${task.priority}">${PRIORITY_LABELS[task.priority]}</span>${recurBadge(task)}
                    <span class="created-date">${faDate(task.createdAt)}</span>
                    ${(task.photos || []).length ? `<span title="${toFa(task.photos.length)} عکس">📷</span>` : ''}
                    ${task.location ? '<button class="mini-link" data-action="locate" aria-label="نمایش محل روی نقشه">📍 نقشه</button>' : ''}
                </div>
                ${sessionSummaryHtml(task)}
            </div>
            <div class="task-actions">
                ${operationMenu(state.currentFilter === 'archived'
                    ? [
                        { action: 'unarchive', label: 'بازگردانی از بایگانی', icon: '↩' },
                        { action: 'delete', label: 'حذف وظیفه', icon: '✕', className: 'danger' }
                    ]
                    : [
                        { action: 'pin', label: task.pinned ? 'برداشتن سنجاق' : 'سنجاق به بالا', icon: '📌' },
                        { action: 'detail', label: 'جزئیات و اطلاعات بیشتر', icon: '📋' },
                        { action: 'edit-btn', label: 'ویرایش نام وظیفه', icon: '✎' },
                        { action: 'archive', label: 'بایگانی وظیفه', icon: '📦' },
                        { action: 'delete', label: 'حذف وظیفه', icon: '✕', className: 'danger' }
                    ], 'عملیات وظیفه')}
            </div>
        </div>`;
    }).join('');

    state.justAddedId = null;
}

// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ گام ۱۵: SHIM‌ها حذف شدند
// ═══════════════════════════════════════════════════════════════════════════
