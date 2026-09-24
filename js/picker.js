// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// picker.js -- Jalali date+time picker dialog (ESM)

import { state, toFa, uid, escapeHtml } from './core.js';
import { getNow } from './time.js';
import {
    JALALI_MONTHS,
    gregorianToJalali,
    jalaliToGregorian,
    jalaliMonthLength
} from './jalali.js';
import { faShort, updateDueChips, hasSessionAt, allSessions } from './sessions.js';
import { t as i18nT } from './i18n.js';

// ═══════════════════════════════════════════════════════════════════════════
// Internal state
// ═══════════════════════════════════════════════════════════════════════════

let conflictArmed = false;

// ═══════════════════════════════════════════════════════════════════════════
// Open / close
// ═══════════════════════════════════════════════════════════════════════════

export function openPicker(mode, onConfirm) {
    state.pickerMode = mode;
    state.pickerCallback = typeof onConfirm === 'function' ? onConfirm : null;
    const lastAdd = state.addDraftSessions.length ? state.addDraftSessions[state.addDraftSessions.length - 1].at : null;
    const draft = mode === 'add' ? lastAdd : null;

    let base;
    if (draft) {
        base = new Date(draft);
    } else {
        base = new Date(getNow());
        base.setSeconds(0, 0);
        base.setMinutes(Math.floor(base.getMinutes() / 5) * 5 + 5);
    }

    const j = gregorianToJalali(base.getFullYear(), base.getMonth() + 1, base.getDate());
    state.pickerJy = j.jy;
    state.pickerJm = j.jm;
    state.pickerDay = j.jd;
    document.getElementById('pickerHour').value = String(base.getHours()).padStart(2, '0');
    document.getElementById('pickerMinute').value = String(Math.floor(base.getMinutes() / 5) * 5).padStart(2, '0');
    document.getElementById('pickerError').textContent = '';
    document.getElementById('pickerRemove').style.display = mode === 'add' ? '' : 'none';
    renderPicker();
    document.getElementById('pickerOverlay').style.display = 'flex';
}

export function closePicker() {
    document.getElementById('pickerOverlay').style.display = 'none';
}

// ═══════════════════════════════════════════════════════════════════════════
// Navigation
// ═══════════════════════════════════════════════════════════════════════════

export function shiftPickerMonth(delta) {
    state.pickerJm += delta;
    if (state.pickerJm < 1) { state.pickerJm = 12; state.pickerJy -= 1; }
    if (state.pickerJm > 12) { state.pickerJm = 1; state.pickerJy += 1; }
    const maxDay = jalaliMonthLength(state.pickerJy, state.pickerJm);
    if (state.pickerDay && state.pickerDay > maxDay) state.pickerDay = null;
    renderPicker();
}

// ═══════════════════════════════════════════════════════════════════════════
// Render
// ═══════════════════════════════════════════════════════════════════════════

export function renderPicker() {
    conflictArmed = false;
    const now = getNow();
    const tj = gregorianToJalali(now.getFullYear(), now.getMonth() + 1, now.getDate());

    document.getElementById('pickerMonthLabel').textContent =
        JALALI_MONTHS[state.pickerJm - 1] + ' ' + toFa(state.pickerJy);

    const g = jalaliToGregorian(state.pickerJy, state.pickerJm, 1);
    const firstWeekday = new Date(g.gy, g.gm - 1, g.gd).getDay();
    const leading = (firstWeekday + 1) % 7;
    const monthLen = jalaliMonthLength(state.pickerJy, state.pickerJm);

    let html = '';
    for (let i = 0; i < leading; i++) html += '<span class="picker-day empty"></span>';
    for (let d = 1; d <= monthLen; d++) {
        const isPast = state.pickerJy < tj.jy ||
            (state.pickerJy === tj.jy && state.pickerJm < tj.jm) ||
            (state.pickerJy === tj.jy && state.pickerJm === tj.jm && d < tj.jd);
        const isToday = state.pickerJy === tj.jy && state.pickerJm === tj.jm && d === tj.jd;
        const cls = 'picker-day' + (isToday ? ' today' : '') + (state.pickerDay === d ? ' selected' : '');
        html += `<button class="${cls}" data-day="${d}" ${isPast ? 'disabled' : ''} aria-label="${toFa(d)} ${JALALI_MONTHS[state.pickerJm - 1]}">${toFa(d)}</button>`;
    }
    document.getElementById('pickerDays').innerHTML = html;
}

// ═══════════════════════════════════════════════════════════════════════════
// Confirm / remove
// ═══════════════════════════════════════════════════════════════════════════

export function confirmPicker() {
    const err = document.getElementById('pickerError');
    if (!state.pickerDay) {
        err.textContent = i18nT('picker.errorNoDay');
        return;
    }
    const g = jalaliToGregorian(state.pickerJy, state.pickerJm, state.pickerDay);
    const h = parseInt(document.getElementById('pickerHour').value, 10);
    const mi = parseInt(document.getElementById('pickerMinute').value, 10);
    const picked = new Date(g.gy, g.gm - 1, g.gd, h, mi, 0, 0);
    if (picked.getTime() <= getNow().getTime()) {
        err.textContent = i18nT('picker.errorPast');
        return;
    }
    const hit = findConflict(picked.getTime());
    if (hit && !conflictArmed) {
        conflictArmed = true;
        err.textContent = i18nT('picker.errorConflict', { owner: hit.owner, date: faShort(hit.at) });
        return;
    }
    const iso = picked.toISOString();
    if (state.pickerCallback) {
        const cb = state.pickerCallback;
        state.pickerCallback = null;
        closePicker();
        cb(iso);
    } else {
        if (hasSessionAt(state.addDraftSessions, iso)) {
            err.textContent = i18nT('picker.errorDuplicate');
            return;
        }
        state.addDraftSessions.push({ id: uid(), at: iso });
        updateDueChips();
        closePicker();
    }
}

export function removePickerDue() {
    state.addDraftSessions = [];
    updateDueChips();
    closePicker();
}

// ═══════════════════════════════════════════════════════════════════════════
// Conflict check
// ═══════════════════════════════════════════════════════════════════════════

export function findConflict(ms) {
    const now = getNow().getTime();
    const list = allSessions(true);
    for (const s of list) {
        const v = new Date(s.at).getTime();
        if (isNaN(v) || v < now) continue;
        if (Math.abs(v - ms) < 30 * 60 * 1000) return s;
    }
    return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Presets
// ═══════════════════════════════════════════════════════════════════════════

export function applyPreset(name) {
    const now = getNow();
    let base;
    if (name === 'evening') {
        base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 18, 0, 0, 0);
        if (base.getTime() <= now.getTime()) base.setDate(base.getDate() + 1);
    } else if (name === 'tomorrow') {
        base = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0, 0);
    } else {
        base = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7, 9, 0, 0, 0);
    }
    const j = gregorianToJalali(base.getFullYear(), base.getMonth() + 1, base.getDate());
    state.pickerJy = j.jy;
    state.pickerJm = j.jm;
    state.pickerDay = j.jd;
    document.getElementById('pickerHour').value = String(base.getHours()).padStart(2, '0');
    document.getElementById('pickerMinute').value = '00';
    renderPicker();
}

// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ گام ۱۵: SHIM‌ها حذف شدند
// ═══════════════════════════════════════════════════════════════════════════