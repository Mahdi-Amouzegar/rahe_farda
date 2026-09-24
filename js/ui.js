// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// ui.js -- main list render + filters (ESM) — فاز ۴ گام ۷
//
// ⚠️ فاز ۴C (i18n):
//   - همه‌ی متن‌های hardcoded به i18n منتقل شدند
//   - PRIORITY_LABELS حذف شد — به‌جای آن tasks.priority.* از i18n
//   - formatDate از i18n برای تاریخ‌های locale-aware
//
// ⚠️ این نسخه:
//   - render() را به renderFull + renderDiff تقسیم می‌کند
//   - از render-diff.js برای تشخیص تغییرات استفاده می‌کند
//   - برای تغییرات ساختاری (filter/sort/search/editing)، همچنان innerHTML می‌سازد
//   - برای toggle/pin/archive (تغییرات تکی)، فقط DOM را patch می‌کند
// ═══════════════════════════════════════════════════════════════════════════

import {
    state,
    toFa,
    escapeHtml,
    MAX_LENGTH,
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
import { getWeatherIcon } from './weather.js';
import {
    buildRenderSignature,
    diffTasks,
    isSafeForDiff
} from './render-diff.js';
import { formatDate, getLang, t as i18nT } from './i18n.js';

// ═══════════════════════════════════════════════════════════════════════════
// Local state
// ═══════════════════════════════════════════════════════════════════════════

let tplDraft = null;
let _tplTrapCleanup = null;
let _trashTrapCleanup = null;
let _calTrapCleanup = null;
let snackTimer = null;

// ⚠️ state diffing
let _lastRenderSignature = '';
let _lastVisibleTasks = [];

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function hasAnyLocation(t) {
    if (!t) return false;
    if (t.location) return true;
    if (Array.isArray(t.sessions) && t.sessions.some(s => s && s.location)) return true;
    return false;
}

function priorityLabel(priority) {
    const key = priority === 'high' ? 'tasks.priority.high'
              : priority === 'low' ? 'tasks.priority.low'
              : 'tasks.priority.medium';
    return i18nT(key);
}

function hydrateWeatherIcons(rootEl) {
    if (!rootEl) return;
    const slots = rootEl.querySelectorAll('[data-weather-icon-for]');
    slots.forEach(slot => {
        const key = slot.dataset.weatherIconFor;
        if (!key) return;

        if (slot.dataset.loading === '1') return;
        slot.dataset.loading = '1';

        const sepIdx = key.indexOf('|');
        if (sepIdx < 0) {
            delete slot.dataset.loading;
            return;
        }
        const taskId = key.slice(0, sepIdx);
        const at = key.slice(sepIdx + 1);

        const found = findTask(taskId);
        const task = found ? found.task : null;
        if (!task || !task.location) {
            slot.textContent = '';
            return;
        }

        const tempTask = {
            location: task.location,
            sessions: [{ at }]
        };

        getWeatherIcon(tempTask)
            .then(icon => {
                if (!icon) {
                    if (slot.isConnected) slot.textContent = '';
                    return;
                }
                if (slot.isConnected) slot.textContent = icon;
            })
            .catch(() => {
                if (slot.isConnected) slot.textContent = '';
            })
            .finally(() => {
                if (slot.isConnected) delete slot.dataset.loading;
            });
    });
}

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
    const titleText = i18nT('tasks.insight.statsTitle', { rate: toFa(rate) });
    box.innerHTML = `<div class="stats-title">${titleText}</div><div class="bars">` +
        days.map((d, i) => {
            let wd = '';
            try {
                wd = d.toLocaleDateString(
                    getLang() === 'en' ? 'en-US' : 'fa-IR',
                    { weekday: 'narrow' }
                );
            } catch { /* نادیده */ }
            const h = Math.max(3, Math.round((counts[i] / max) * 100));
            const tooltip = i18nT('tasks.insight.barTooltip', { n: toFa(counts[i]) });
            return `<div class="bar-col" title="${tooltip}"><div class="bar${counts[i] === 0 ? ' empty' : ''}" style="height: ${h}%;"></div><span>${wd}</span></div>`;
        }).join('') + `</div>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Template Modal
// ═══════════════════════════════════════════════════════════════════════════

export function renderTemplateList() {
    const el = document.getElementById('tplList');
    if (!el) return;
    el.innerHTML = `<div class="tpl-list">` + PLAN_TEMPLATES.map(x =>
        `<button type="button" class="tpl-opt" data-tpl="${x.id}"><b>${escapeHtml(x.title)}</b><span>${i18nT('template.childrenCount', { n: toFa(x.children.length) })}</span></button>`
    ).join('') + `</div>`;
}

function planDateRange(t) {
    const fmt = iso => {
        try {
            return formatDate(new Date(iso), { day: 'numeric', month: 'long' });
        } catch {
            return '';
        }
    };
    if (t.startAt && t.endAt) return `${i18nT('detail.sections.planDates.from')} ${fmt(t.startAt)} ${i18nT('detail.sections.planDates.to')} ${fmt(t.endAt)}`;
    if (t.startAt) return `${i18nT('detail.sections.planDates.from')} ${fmt(t.startAt)}`;
    if (t.endAt) return `${i18nT('detail.sections.planDates.to')} ${fmt(t.endAt)}`;
    return '';
}

export function renderTplKids() {
    const el = document.getElementById('tplKids');
    if (!el || !tplDraft) return;
    el.innerHTML = tplDraft.kids.length ? tplDraft.kids.map((k, i) =>
        `<div class="session-item"><span class="session-num">${toFa(i + 1)}</span>` +
        `<span class="session-date">${escapeHtml(k)}</span>` +
        `<button class="btn-icon btn-delete" data-tplkid="${i}" aria-label="${i18nT('template.deleteChild')}">✕</button></div>`
    ).join('') : `<div class="session-empty">${i18nT('template.emptyKids')}</div>`;
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
        el.innerHTML = `<div class="session-empty">${i18nT('trash.empty')}</div>`;
        return;
    }
    const sorted = [...state.trash].sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
    el.innerHTML = sorted.map(x => {
        let dstr = '';
        try {
            dstr = formatDate(new Date(x.deletedAt), { day: 'numeric', month: 'long' });
        } catch { /* نادیده */ }
        return `<div class="session-item">
            <span class="session-num">${x.kind === 'plan' ? '📁' : '📝'}</span>
            <span class="session-date">${escapeHtml(x.text)} <small>(${dstr})</small></span>
            <button class="btn-icon btn-edit" data-tact="restore" data-tid="${escapeHtml(String(x.id))}" aria-label="${i18nT('trash.restore')}">↩</button>
            <button class="btn-icon btn-delete" data-tact="purge" data-tid="${escapeHtml(String(x.id))}" aria-label="${i18nT('trash.purge')}">✕</button>
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
        const sessionsPart = list.length ? i18nT('calendar.daySessions', { n: toFa(list.length) }) : '';
        const ariaLabel = i18nT('calendar.dayAria', {
            day: toFa(d),
            month: JALALI_MONTHS[state.calJm - 1],
            sessions: sessionsPart
        });
        html += `<button class="${cls}" data-calday="${k}" aria-label="${ariaLabel}">${toFa(d)}<span class="cal-dots">${dots}${more}</span></button>`;
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

function operationMenu(items, label) {
    const menuLabel = label || i18nT('taskItem.operations.menuLabel');
    return `<div class="operation-menu">
        <button type="button" class="operation-trigger" data-action="toggle-menu" aria-label="${menuLabel}" aria-expanded="false">⋯ <span>${i18nT('taskItem.operations.menuLabel')}</span></button>
        <div class="operation-list" role="menu" hidden>
            ${items.map(item => `<button type="button" role="menuitem" class="operation-item ${item.className || ''}" data-action="${item.action}" aria-label="${item.label}">${item.icon ? `<span aria-hidden="true">${item.icon}</span>` : ''}<span>${item.label}</span></button>`).join('')}
        </div>
    </div>`;
}

function childWeatherButton(c) {
    if (!c || !c.location) return '';
    const n = nearestUpcoming(c);
    if (!n) return '';
    const due = new Date(n.at).getTime();
    if (!Number.isFinite(due)) return '';
    const daysAhead = (due - Date.now()) / 86400000;
    if (daysAhead < 0 || daysAhead > 16) return '';
    const key = `${escapeHtml(String(c.id))}|${escapeHtml(n.at)}`;
    const label = i18nT('taskItem.weather.buttonAria');
    return `<button type="button" class="weather-icon-btn weather-icon-btn-sm" data-weather-task="${escapeHtml(String(c.id))}" aria-label="${label}" title="${label}"><span class="weather-icon-emoji" data-weather-icon-for="${key}" aria-hidden="true">…</span><span aria-hidden="true">🌡️</span></button>`;
}

function childHtml(c) {
    if (String(c.id) === String(state.editingId)) {
        return `<div class="child-item" data-id="${escapeHtml(String(c.id))}">
            <div class="edit-wrap">
                <input type="text" class="task-edit-input" value="${escapeHtml(c.text)}" maxlength="${MAX_LENGTH}" aria-label="${i18nT('taskItem.edit.childAria')}">
                <button class="btn-icon btn-ok" data-action="edit-ok" aria-label="${i18nT('taskItem.edit.okAria')}">✓</button>
                <button class="btn-icon btn-cancel" data-action="edit-cancel" aria-label="${i18nT('common.cancel')}">✕</button>
            </div>
        </div>`;
    }

    const n = nearestUpcoming(c);
    const prioLabel = priorityLabel(c.priority);
    const hasLoc = Boolean(c.location);
    const hasPhotos = (c.photos || []).length > 0;
    const wBtn = childWeatherButton(c);
    const recur = recurBadge(c, 'child-meta-badge');

    const hasMeta = n || hasLoc || hasPhotos || recur || wBtn;

    const toggleAria = c.completed
        ? i18nT('taskItem.checkbox.markUndone')
        : i18nT('taskItem.checkbox.markDone');

    const menuItems = state.currentFilter === 'archived'
        ? [
            { action: 'unarchive', label: i18nT('taskItem.operations.unarchive'), icon: '↩' },
            { action: 'delete', label: i18nT('taskItem.operations.deleteChild'), icon: '✕', className: 'danger' }
        ]
        : [
            { action: 'pick-loc', label: c.location ? i18nT('taskItem.operations.showLoc') : i18nT('taskItem.operations.pickLoc'), icon: '📍' },
            ...(hasAnyLocation(c) ? [{ action: 'route', label: i18nT('taskItem.operations.route'), icon: '🧭' }] : []),
            { action: 'detail', label: i18nT('taskItem.operations.detailChild'), icon: '📋' },
            { action: 'archive', label: i18nT('taskItem.operations.archiveChild'), icon: '📦' },
            { action: 'delete', label: i18nT('taskItem.operations.deleteChild'), icon: '✕', className: 'danger' }
        ];

    return `<div class="child-item ${c.completed ? 'completed' : ''} ${String(c.id) === String(state.justAddedId) ? 'just-added' : ''}" data-id="${escapeHtml(String(c.id))}">
        <div class="child-main-row">
            <button class="task-checkbox ${c.completed ? 'checked' : ''}" data-action="toggle"
                aria-label="${toggleAria}"
                aria-pressed="${c.completed}"></button>
            <div class="child-text" data-action="edit" title="${i18nT('taskItem.edit.title')}">${escapeHtml(c.text)}</div>
            <div class="child-actions">
                ${operationMenu(menuItems, i18nT('taskItem.operations.childMenuLabel'))}
            </div>
        </div>
        ${hasMeta ? `<div class="child-meta-row">
            <span class="priority-badge p-${c.priority}">${prioLabel}</span>
            ${recur}
            ${n ? `<span class="child-meta-item">📅 ${faShort(n.at)}</span>` : ''}
            ${hasLoc ? `<span class="child-meta-item" title="${i18nT('location.hasLocation')}">📍</span>` : ''}
            ${hasPhotos ? `<span class="child-meta-item" title="${toFa(c.photos.length)} ${i18nT('detail.sections.photos.countAria')}">📷</span>` : ''}
            ${wBtn}
        </div>` : ''}
    </div>`;
}

function planHtml(task) {
    const st = planStats(task);
    const q = state.searchQuery.trim();
    const open = state.expandedPlans.has(String(task.id)) || (q !== '' && !taskMatches(task, q));
    const kids = visibleChildren(task);
    const drafts = state.childDrafts[task.id] || [];
    const pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
    const hasLoc = hasAnyLocation(task);

    const menuItems = state.currentFilter === 'archived'
        ? [
            { action: 'unarchive', label: i18nT('taskItem.operations.unarchive'), icon: '↩' },
            { action: 'delete', label: i18nT('taskItem.operations.deletePlan'), icon: '✕', className: 'danger' }
        ]
        : [
            { action: 'pin', label: task.pinned ? i18nT('taskItem.operations.unpin') : i18nT('taskItem.operations.pin'), icon: '📌' },
            ...(hasLoc ? [{ action: 'route', label: i18nT('taskItem.operations.route'), icon: '🧭' }] : []),
            { action: 'detail', label: i18nT('taskItem.operations.detailPlan'), icon: '📋' },
            { action: 'archive', label: i18nT('taskItem.operations.archivePlan'), icon: '📦' },
            { action: 'delete', label: i18nT('taskItem.operations.deletePlan'), icon: '✕', className: 'danger' }
        ];

    return `<div class="task-item plan-item prio-${task.priority}"${state.currentSort === 'manual' ? ' draggable="true"' : ''} data-id="${escapeHtml(String(task.id))}">
        <div class="plan-head">
            <button class="plan-caret" data-action="expand" aria-label="${i18nT('taskItem.plan.expand')}">${open ? '▾' : '◂'}</button>
            <div class="plan-head-main">
                <div class="task-text">📁 ${escapeHtml(task.text)}</div>
            </div>
            <div class="task-actions">
                ${operationMenu(menuItems, i18nT('taskItem.operations.planMenuLabel'))}
            </div>
        </div>
        <div class="task-meta plan-meta-row">
            <span class="priority-badge p-${task.priority}">${priorityLabel(task.priority)}</span>${recurBadge(task)}
            <span>${i18nT('taskItem.plan.subCount', { done: toFa(st.done), total: toFa(st.total) })}</span>
            ${(task.startAt || task.endAt) ? `<span>📅 ${planDateRange(task)}</span>` : ''}
            ${(task.photos || []).length ? `<span title="${toFa(task.photos.length)} ${i18nT('detail.sections.photos.countAria')}">📷</span>` : ''}
            ${hasLoc ? `<button class="mini-link" data-action="locate" aria-label="${i18nT('taskItem.map.showAria')}">${i18nT('taskItem.map.showButton')}</button>` : ''}
            <div class="mini-progress"><div class="mini-progress-fill" style="width: ${pct}%;"></div></div>
            ${st.total > 0 && st.done < st.total ? `<button class="mini-link" data-action="check-all" aria-label="${i18nT('taskItem.operations.checkAll')}">✓ ${i18nT('taskItem.operations.checkAll')}</button>` : ''}
        </div>
        ${(task.sessions && task.sessions.length) ? `<div class="plan-session-row">${sessionSummaryHtml(task)}</div>` : ''}
        ${open ? `<div class="plan-body">
            ${kids.length ? kids.map(c => childHtml(c)).join('') : `<div class="session-empty">${i18nT('taskItem.plan.noChildren')}</div>`}
            ${drafts.length ? `<div class="due-chips" style="display: flex; margin: 0;">${drafts.map(s => `<span class="due-chip">📅 ${faShort(s.at)}<button type="button" data-cdchip="${escapeHtml(String(s.id))}" data-gid="${escapeHtml(String(task.id))}" aria-label="${i18nT('common.delete')}">✕</button></span>`).join('')}</div>` : ''}
            <div class="child-add">
                <input type="text" class="child-input" placeholder="${i18nT('tasks.plan.newChildPlaceholder')}" maxlength="${MAX_LENGTH}" aria-label="${i18nT('tasks.plan.newChildAria')}">
                <select class="child-prio" aria-label="${i18nT('tasks.details.priorityAria')}">
                    <option value="low">${i18nT('tasks.priority.low')}</option>
                    <option value="medium" selected>${i18nT('tasks.priority.medium')}</option>
                    <option value="high">${i18nT('tasks.priority.high')}</option>
                </select>
                <button class="btn-icon btn-detail" data-action="child-date" aria-label="${i18nT('taskItem.plan.childDate')}">📅</button>
                <button class="btn-add btn-child-add" data-action="child-add">${i18nT('tasks.plan.addChild')}</button>
            </div>
        </div>` : ''}
    </div>`;
}

function taskTypeIcon(task) {
    return (task.kind === 'series' || task.recur !== 'none') ? '🔁' : '📝';
}

function taskItemHtml(task) {
    if (String(task.id) === String(state.editingId)) {
        return `
        <div class="task-item ${task.completed ? 'completed' : ''}" data-id="${escapeHtml(String(task.id))}">
            <div class="task-main-row">
                <div class="task-content">
                    <div class="edit-wrap">
                        <input type="text" class="task-edit-input" value="${escapeHtml(task.text)}" maxlength="${MAX_LENGTH}" aria-label="${i18nT('taskItem.edit.aria')}">
                        <button class="btn-icon btn-ok" data-action="edit-ok" aria-label="${i18nT('taskItem.edit.okAria')}">✓</button>
                        <button class="btn-icon btn-cancel" data-action="edit-cancel" aria-label="${i18nT('taskItem.edit.cancelAria')}">✕</button>
                    </div>
                </div>
            </div>
        </div>`;
    }

    const toggleAria = task.completed
        ? i18nT('taskItem.checkbox.markUndone')
        : i18nT('taskItem.checkbox.markDone');

    const menuItems = state.currentFilter === 'archived'
        ? [
            { action: 'unarchive', label: i18nT('taskItem.operations.unarchive'), icon: '↩' },
            { action: 'delete', label: i18nT('taskItem.operations.delete'), icon: '✕', className: 'danger' }
        ]
        : [
            { action: 'pin', label: task.pinned ? i18nT('taskItem.operations.unpin') : i18nT('taskItem.operations.pin'), icon: '📌' },
            ...(hasAnyLocation(task) ? [{ action: 'route', label: i18nT('taskItem.operations.route'), icon: '🧭' }] : []),
            { action: 'detail', label: i18nT('taskItem.operations.detail'), icon: '📋' },
            { action: 'edit-btn', label: i18nT('taskItem.operations.edit'), icon: '✎' },
            { action: 'archive', label: i18nT('taskItem.operations.archive'), icon: '📦' },
            { action: 'delete', label: i18nT('taskItem.operations.delete'), icon: '✕', className: 'danger' }
        ];

    return `
    <div class="task-item prio-${task.priority} ${task.completed ? 'completed' : ''} ${task.id === state.justAddedId ? 'just-added' : ''}"${state.currentSort === 'manual' ? ' draggable="true"' : ''} data-id="${escapeHtml(String(task.id))}">
        <div class="task-main-row">
            <button class="task-checkbox ${task.completed ? 'checked' : ''}" data-action="toggle"
                aria-label="${toggleAria}"
                aria-pressed="${task.completed}"></button>
            <div class="task-content">
                <div class="task-text" data-action="edit" title="${i18nT('taskItem.edit.title')}"><span class="task-type-icon" aria-hidden="true">${taskTypeIcon(task)}</span> ${escapeHtml(task.text)}</div>
            </div>
            <div class="task-actions">
                ${operationMenu(menuItems, i18nT('taskItem.operations.menuLabel'))}
            </div>
        </div>
        <div class="task-info-row">
            <span class="priority-badge p-${task.priority}">${priorityLabel(task.priority)}</span>
            ${recurBadge(task)}
            <span class="created-date">${faDate(task.createdAt)}</span>
            ${(task.photos || []).length ? `<span title="${toFa(task.photos.length)} ${i18nT('detail.sections.photos.countAria')}">📷</span>` : ''}
            ${task.location ? `<button class="mini-link" data-action="locate" aria-label="${i18nT('taskItem.map.showAria')}">${i18nT('taskItem.map.showButton')}</button>` : ''}
        </div>
        ${sessionSummaryHtml(task)}
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Snackbar / Undo
// ═══════════════════════════════════════════════════════════════════════════

function buildTrashMessage(ids) {
    if (!ids || ids.length === 0) return i18nT('snackbar.trashGeneric');
    if (ids.length === 1) {
        const found = findTask(ids[0]);
        if (!found) {
            const inTrash = (Array.isArray(state.trash) && state.trash)
                ? state.trash.find(x => String(x.id) === String(ids[0]))
                : null;
            if (inTrash) {
                const kindLabel = i18nT(`kind.${inTrash.kind === 'plan' ? 'plan' : inTrash.kind === 'series' ? 'series' : 'task'}`);
                return i18nT('snackbar.trashSingle', { kind: kindLabel, text: inTrash.text });
            }
            return i18nT('snackbar.trashGeneric');
        }
        const task = found.task;
        const kindLabel = i18nT(`kind.${task.kind === 'plan' ? 'plan' : task.kind === 'series' ? 'series' : 'task'}`);
        return i18nT('snackbar.trashSingle', { kind: kindLabel, text: task.text });
    }
    return i18nT('snackbar.trashMultiple', { n: toFa(ids.length) });
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
// رندر اصلی — با diffing
// ═══════════════════════════════════════════════════════════════════════════

/**
 * رندر کامل — innerHTML-based.
 */
function renderFull(filtered, total, done) {
    const taskList = document.getElementById('taskList');
    if (!taskList) return;

    if (filtered.length === 0) {
        let msg;
        if (state.searchQuery) {
            msg = i18nT('tasks.empty.noResults');
        } else if (state.currentFilter === 'completed') {
            msg = i18nT('tasks.empty.noCompleted');
        } else if (state.currentFilter === 'active') {
            msg = i18nT('tasks.empty.allDone');
        } else {
            msg = i18nT('tasks.empty.emptyList');
        }
        taskList.innerHTML = `
            <div class="empty-state">
                <div class="icon">✦</div>
                <p>${msg}</p>
                ${state.tasks.length === 0 && !state.searchQuery ? `<p class="empty-hint">${i18nT('tasks.empty.startHint')}</p>` : ''}
            </div>`;
        state.justAddedId = null;
        updateTaskListStatus('');
        return;
    }

    taskList.innerHTML = filtered.map(task => {
        if (task.kind === 'plan') return planHtml(task);
        return taskItemHtml(task);
    }).join('');

    hydrateWeatherIcons(taskList);
    updateTaskListStatus(i18nT('tasks.status.showingCount', { n: toFa(filtered.length) }));
    state.justAddedId = null;
}

/**
 * رندر diff-based — فقط DOM را patch می‌کند.
 * @returns {boolean} آیا diff موفق بود؟
 */
function renderDiff(filtered) {
    const taskList = document.getElementById('taskList');
    if (!taskList) return false;

    const ops = diffTasks(_lastVisibleTasks, filtered);

    if (!isSafeForDiff(ops)) return false;
    if (ops.length === 0) return true;

    for (const op of ops) {
        if (op.type !== 'update') continue;

        const idStr = String(op.id);
        const el = taskList.querySelector(`[data-id="${CSS.escape(idStr)}"]`);
        if (!el) return false;

        if ('text' in op.patches) {
            const textEl = el.querySelector('.task-text');
            if (textEl) {
                const icon = textEl.querySelector('.task-type-icon');
                const iconHtml = icon ? icon.outerHTML + ' ' : '';
                textEl.innerHTML = iconHtml + escapeHtml(op.patches.text);
            }
        }
        if ('completed' in op.patches) {
            el.classList.toggle('completed', op.patches.completed);
            const cb = el.querySelector('.task-checkbox');
            if (cb) {
                cb.classList.toggle('checked', op.patches.completed);
                cb.setAttribute('aria-pressed', String(op.patches.completed));
                cb.setAttribute('aria-label',
                    op.patches.completed
                        ? i18nT('taskItem.checkbox.markUndone')
                        : i18nT('taskItem.checkbox.markDone')
                );
            }
        }
        if ('priority' in op.patches) {
            el.classList.remove('prio-high', 'prio-medium', 'prio-low');
            el.classList.add(`prio-${op.patches.priority}`);
            const badge = el.querySelector('.priority-badge');
            if (badge) {
                badge.className = `priority-badge p-${op.patches.priority}`;
                badge.textContent = priorityLabel(op.patches.priority);
            }
        }
        // فیلدهای پیچیده → diff امن نیست
        if ('pinned' in op.patches) return false;
        if ('archived' in op.patches) return false;
        if ('hasLocation' in op.patches) return false;
        if ('sessionsLength' in op.patches) return false;
        if ('childrenDone' in op.patches) return false;
        if ('childrenLength' in op.patches) return false;
        if ('photosLength' in op.patches) return false;
        if ('recur' in op.patches) return false;
        if ('recurN' in op.patches) return false;
        if ('recurDays' in op.patches) return false;
    }

    return true;
}

/**
 * تابع اصلی render — تصمیم می‌گیرد renderFull یا renderDiff.
 */
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
            chip.innerHTML = `📅 ${formatDate(new Date(gy, gm - 1, gd), { day: 'numeric', month: 'long' })} <b>✕</b>`;
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

    const FILTER_KEYS = {
        all: 'tasks.filter.all',
        active: 'tasks.filter.active',
        completed: 'tasks.filter.completed',
        archived: 'tasks.filter.archived',
        hasloc: 'tasks.filter.hasloc',
        hasdue: 'tasks.filter.hasdue'
    };
    const COUNTS = { all: total, active: activeCount, completed: done, archived: archivedCount, hasloc: locCount, hasdue: dueCount };
    document.querySelectorAll('.filter-btn').forEach(b => {
        const f = b.dataset.filter;
        if (!f || !(f in COUNTS)) return;
        const label = i18nT(FILTER_KEYS[f]);
        b.textContent = `${label} (${toFa(COUNTS[f])})`;
    });

    if (progressFill) progressFill.style.width = pct + '%';
    if (progressPct) progressPct.textContent = toFa(pct) + '٪';
    if (progressBar) progressBar.setAttribute('aria-valuenow', pct);

    const doneActionsEl = document.getElementById('doneActions');
    if (doneActionsEl) doneActionsEl.style.display = done > 0 ? 'flex' : 'none';

    // ─── تصمیم renderFull vs renderDiff ───
    const visibleIds = filtered.map(t => String(t.id));
    const signature = buildRenderSignature(state, visibleIds);

    if (signature !== _lastRenderSignature) {
        renderFull(filtered, total, done);
        _lastRenderSignature = signature;
        _lastVisibleTasks = filtered.map(t => ({ ...t, children: t.children ? [...t.children] : [] }));
        return;
    }

    const diffSucceeded = renderDiff(filtered);
    if (!diffSucceeded) {
        renderFull(filtered, total, done);
        _lastVisibleTasks = filtered.map(t => ({ ...t, children: t.children ? [...t.children] : [] }));
        return;
    }

    _lastVisibleTasks = filtered.map(t => ({ ...t, children: t.children ? [...t.children] : [] }));
}

function updateTaskListStatus(msg) {
    const el = document.getElementById('taskListStatus');
    if (el) el.textContent = msg || '';
}

/**
 * ⚠️ ریست امضای رندر — برای import.
 */
export function resetRenderSignature() {
    _lastRenderSignature = '';
    _lastVisibleTasks = [];
}

// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ گام ۱۵: SHIM‌ها حذف شدند
// ═══════════════════════════════════════════════════════════════════════════