// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// sessions.js -- session (due-date) domain logic (ESM)

import { state, toFa, escapeHtml } from './core.js';
import { getNow } from './time.js';

// ═══════════════════════════════════════════════════════════════════════════
// Formatting
// ═══════════════════════════════════════════════════════════════════════════

export function faShort(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString('fa-IR', { day: 'numeric', month: 'long' }) + '، ساعت ' +
        d.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
}

// ═══════════════════════════════════════════════════════════════════════════
// Due chips (فرم افزودن)
// ═══════════════════════════════════════════════════════════════════════════

export function updateDueChips() {
    const wrap = document.getElementById('dueChips');
    if (!wrap) return;
    if (state.addDraftSessions.length === 0) {
        wrap.innerHTML = '';
        wrap.style.display = 'none';
        return;
    }
    wrap.style.display = 'flex';
    const sorted = [...state.addDraftSessions].sort((a, b) => new Date(a.at) - new Date(b.at));
    wrap.innerHTML = sorted.map(s =>
        `<span class="due-chip">📅 ${faShort(s.at)}<button type="button" data-dchip="${escapeHtml(String(s.id))}" aria-label="حذف این سررسید">✕</button></span>`
    ).join('');
}

// ═══════════════════════════════════════════════════════════════════════════
// Nearest / summary
// ═══════════════════════════════════════════════════════════════════════════

export function nearestUpcoming(task) {
    const now = getNow().getTime();
    return (task.sessions || [])
        .filter(s => new Date(s.at).getTime() >= now)
        .sort((a, b) => new Date(a.at) - new Date(b.at))[0] || null;
}

export function sessionSummaryHtml(task) {
    const sessions = task.sessions || [];
    if (sessions.length === 0) return '';
    if (task.completed) {
        return `<span class="due-line past-all">📅 ${toFa(sessions.length)} جلسه</span>`;
    }
    const n = nearestUpcoming(task);
    if (n) {
        const now = getNow();
        const due = new Date(n.at);
        const startOf = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        const diffDays = Math.round((startOf(due) - startOf(now)) / 86400000);
        const extra = diffDays === 0 ? ' (امروز)' : diffDays === 1 ? ' (فردا)' : ` (${toFa(diffDays)} روز مانده)`;
        const count = sessions.length > 1 ? ` <span class="sess-count">${toFa(sessions.length)} جلسه</span>` : '';
        // آیکن هوا اگر وظیفه یا برنامه مکان داشته باشد (بر اساس task.location، نه session.location)
        const weatherBtn = task.location
            ? `<button type="button" class="weather-icon-btn" data-weather-task="${escapeHtml(String(task.id))}" aria-label="پیش‌بینی هوا" title="پیش‌بینی هوا">🌡️</button>`
            : '';
        return `<span class="due-line">📅 جلسه بعد: ${faShort(n.at)}${extra}${n.location ? ' 📍' : ''}${weatherBtn}</span>${count}`;
    }
    const past = [...sessions].sort((a, b) => new Date(b.at) - new Date(a.at))[0];
    return `<span class="due-line overdue">⚠ سررسید گذشته: ${faShort(past.at)}</span>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Badge / day helpers
// ═══════════════════════════════════════════════════════════════════════════

export function recurBadge(t, cls) {
    if (!t.recur || t.recur === 'none') return '';
    let suffix = '';
    if (t.recur === 'custom' && t.recurN > 1) suffix = ` ${toFa(t.recurN)} روز`;
    else if (t.recur === 'hourly' && t.recurN >= 1) suffix = ` هر ${toFa(t.recurN)} ساعت`;
    else if (t.recur === 'weeklyDays') suffix = ' روزهای هفته';
    else if (t.recur === 'monthlyDays') suffix = ' روزهای ماه';
    return `<span class="${cls || ''}" title="تکرارشونده${suffix}">🔁</span>`;
}

export function dayKey(d) {
    d = new Date(d);
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}

export function hasSessionOn(task, key) {
    return (task.sessions || []).some(s => {
        const t = new Date(s.at).getTime();
        return !isNaN(t) && dayKey(new Date(s.at)) === key;
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// Minute helpers
// ═══════════════════════════════════════════════════════════════════════════

export function sameMinute(a, b) {
    const da = new Date(a);
    const db = new Date(b);
    return !isNaN(da) && !isNaN(db) &&
        da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() &&
        da.getDate() === db.getDate() && da.getHours() === db.getHours() && da.getMinutes() === db.getMinutes();
}

export function hasSessionAt(list, iso) {
    return (list || []).some(s => sameMinute(s.at, iso));
}

// ═══════════════════════════════════════════════════════════════════════════
// Task matching / visible children
// ═══════════════════════════════════════════════════════════════════════════

export function taskMatches(t, q) {
    if (!q) return true;
    return t.text.includes(q) || (t.description || '').includes(q);
}

export function visibleChildren(g) {
    const q = state.searchQuery.trim();
    let kids = g.children || [];
    if (state.currentFilter === 'archived') kids = kids.filter(c => c.archived);
    else kids = kids.filter(c => !c.archived);
    if (q && !taskMatches(g, q)) kids = kids.filter(c => taskMatches(c, q));
    if (state.selectedDay) kids = kids.filter(c => hasSessionOn(c, state.selectedDay));
    if (state.currentFilter === 'hasloc') kids = kids.filter(c => c.location);
    else if (state.currentFilter === 'hasdue') kids = kids.filter(c => (c.sessions || []).length);
    return [...kids.filter(c => c.pinned), ...kids.filter(c => !c.pinned)];
}

// ═══════════════════════════════════════════════════════════════════════════
// allSessions (با cache)
// ═══════════════════════════════════════════════════════════════════════════

let _allSessionsCache = null;
let _allSessionsCacheVersion = -1;

export function allSessions(onlyOpen) {
    if (_allSessionsCacheVersion !== state.taskIndexVersion) {
        _allSessionsCache = null;
        _allSessionsCacheVersion = state.taskIndexVersion;
    }
    if (!_allSessionsCache) {
        _allSessionsCache = { open: null, all: null };
    }
    const key = onlyOpen ? 'open' : 'all';
    if (_allSessionsCache[key]) return _allSessionsCache[key];

    const out = [];
    const push = (t, owner) => {
        if (t.archived) return;
        (t.sessions || []).forEach(s => {
            if (onlyOpen && t.completed) return;
            out.push({
                at: s.at,
                id: s.id,
                owner,
                taskId: t.id,
                priority: t.priority,
                reminded: Boolean(s.reminded),
                remindedDue: Boolean(s.remindedDue),
                remindMin: s.remindMin != null ? s.remindMin : null
            });
        });
    };
    state.tasks.forEach(t => {
        if (t.kind === 'plan') {
            push(t, t.text);
            (t.children || []).forEach(c => { if (!c.archived) push(c, t.text + ' / ' + c.text); });
        } else push(t, t.text);
    });
    _allSessionsCache[key] = out;
    return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// Persian datetime parser
// ═══════════════════════════════════════════════════════════════════════════

const FA_DIGITS = {
    '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
    '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9'
};

export function faToEn(s) {
    return String(s).replace(/[۰-۹٠-٩]/g, d => FA_DIGITS[d] || d);
}

const WEEKDAYS_FA = {
    'یکشنبه': 0, 'دوشنبه': 1, 'سه‌شنبه': 2, 'سه شنبه': 2,
    'چهارشنبه': 3, 'پنجشنبه': 4, 'شنبه': 6, 'جمعه': 5
};

export function parseFaDateTime(text, now) {
    if (!text) return null;
    const t = faToEn(text);
    const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
    const has = (...ws) => ws.some(w => t.includes(w));
    let day = null;
    let explicitDay = false;
    let m;

    if (has('پس‌فردا', 'پس فردا')) { day = addDays(d0, 2); explicitDay = true; }
    else if (has('فردا')) { day = addDays(d0, 1); explicitDay = true; }
    else if (has('امروز')) { day = d0; explicitDay = true; }
    else if (has('هفته بعد', 'هفته آینده', 'هفته‌ی بعد')) { day = addDays(d0, 7); explicitDay = true; }
    else if ((m = t.match(/(\d{1,2})\s*روز\s*(دیگه|دیگر|بعد)/))) {
        const n = parseInt(m[1], 10);
        if (n < 1 || n > 365) return null;
        day = addDays(d0, n);
        explicitDay = true;
    } else {
        for (const name of Object.keys(WEEKDAYS_FA)) {
            if (t.includes(name)) {
                let diff = (WEEKDAYS_FA[name] - d0.getDay() + 7) % 7;
                if (diff === 0) diff = 7;
                day = addDays(d0, diff);
                explicitDay = true;
                break;
            }
        }
    }

    let h = null;
    let mi = 0;
    if ((m = t.match(/ساعت\s*(\d{1,2})(?:\s*[:：]\s*(\d{1,2}))?/))) {
        h = parseInt(m[1], 10);
        mi = m[2] ? parseInt(m[2], 10) : 0;
        if (h > 23 || mi > 59) return null;
        if (has('صبح')) { if (h === 12) h = 0; }
        else if (has('ظهر')) { if (h < 12) h += 12; if (h === 24) h = 12; }
        else if (has('عصر', 'غروب', 'شب')) { if (h < 12) h += 12; }
        else if (h >= 1 && h <= 6) h += 12;
    }

    if (!day && h === null) return null;
    if (!day) day = d0;
    if (h === null) h = 9;

    let dt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, mi, 0, 0);
    if (dt.getTime() <= now.getTime()) {
        if (explicitDay) return null;
        dt = new Date(dt.getTime() + 24 * 3600 * 1000);
        if (dt.getTime() <= now.getTime()) return null;
    }
    return dt.toISOString();
}

// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ گام ۱۵: SHIM‌ها حذف شدند
// ═══════════════════════════════════════════════════════════════════════════