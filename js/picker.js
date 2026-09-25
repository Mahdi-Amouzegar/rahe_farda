// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// picker.js -- date+time picker dialog (Jalali + Gregorian) (ESM)
//
// ⚠️ فاز ۴D.5: تقویم دو-حالته
//   - در fa: تقویم جلالی (به‌عنوان قبل)
//   - در en: تقویم میلادی (Gregorian) — یکشنبه اول هفته (طبق تصمیم D-1)
//   - حالت از `state.pickerCalendar` خونده می‌شه (نه از getLang())
//     چون اگر کاربر وسط picker زبان رو عوض کنه، picker با تقویم قبلی می‌مونه
//
// ⚠️ تغییرات نسبت به نسخه‌ی قبل:
//   - import جدید: getLang, formatNumber, formatYear, getMonthName, gregorianMonthLength
//   - openPicker: locale-aware (پیش‌فرض بر اساس getLang())
//   - shiftPickerMonth: locale-aware
//   - renderPicker: locale-aware + renderWeekdays
//   - confirmPicker: locale-aware (تبدیل به ISO در هر دو تقویم)
//   - applyPreset: locale-aware

import { state, uid, escapeHtml } from './core.js';
import { getNow } from './time.js';
import {
    JALALI_MONTHS,
    getMonthName,
    gregorianToJalali,
    jalaliToGregorian,
    jalaliMonthLength,
    gregorianMonthLength
} from './jalali.js';
import { faShort, updateDueChips, hasSessionAt, allSessions } from './sessions.js';
import { formatNumber, formatYear, getLang, t as i18nT } from './i18n.js';

// ═══════════════════════════════════════════════════════════════════════════
// Internal state
// ═══════════════════════════════════════════════════════════════════════════

let conflictArmed = false;

// ═══════════════════════════════════════════════════════════════════════════
// Weekdays helpers
// ═══════════════════════════════════════════════════════════════════════════
//
// ⚠️ ترتیب روزهای هفته:
//   - jalali  : شنبه اول (fa)
//   - gregorian: یکشنبه اول (en) — طبق تصمیم D-1

const WEEKDAYS_JALALI = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'];
const WEEKDAYS_GREGORIAN = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * رندر روزهای هفته در یک container.
 *
 * ⚠️ این تابع از `calendar.weekdays.*` در localeها استفاده می‌کنه.
 *
 * @param {HTMLElement|null} container
 * @param {'jalali'|'gregorian'} calendar
 */
function renderWeekdays(container, calendar) {
    if (!container) return;
    const keys = calendar === 'gregorian' ? WEEKDAYS_GREGORIAN : WEEKDAYS_JALALI;
    container.innerHTML = keys.map(k =>
        `<span>${i18nT(`calendar.weekdays.${k}`)}</span>`
    ).join('');
}

// ═══════════════════════════════════════════════════════════════════════════
// Open / close
// ═══════════════════════════════════════════════════════════════════════════

export function openPicker(mode, onConfirm) {
    state.pickerMode = mode;
    state.pickerCallback = typeof onConfirm === 'function' ? onConfirm : null;

    // ─── تعیین نوع تقویم بر اساس زبان فعلی (یک بار) ───
    // ⚠️ این تصمیم در openPicker گرفته می‌شه، نه در renderPicker.
    //    چون اگر کاربر وسط picker زبان رو عوض کنه، نمی‌خوایم تقویم ناگهان عوض بشه.
    const lang = getLang();
    state.pickerCalendar = lang === 'en' ? 'gregorian' : 'jalali';

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

    // ─── مقداردهی state بر اساس تقویم ───
    if (state.pickerCalendar === 'gregorian') {
        state.pickerGy = base.getFullYear();
        state.pickerGm = base.getMonth() + 1; // ۱-۱۲
        state.pickerDay = base.getDate();
    } else {
        const j = gregorianToJalali(base.getFullYear(), base.getMonth() + 1, base.getDate());
        state.pickerJy = j.jy;
        state.pickerJm = j.jm;
        state.pickerDay = j.jd;
    }

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
    if (state.pickerCalendar === 'gregorian') {
        // ─── میلادی ───
        state.pickerGm += delta;
        if (state.pickerGm < 1) { state.pickerGm = 12; state.pickerGy -= 1; }
        if (state.pickerGm > 12) { state.pickerGm = 1; state.pickerGy += 1; }

        const maxDay = gregorianMonthLength(state.pickerGy, state.pickerGm);
        if (state.pickerDay && state.pickerDay > maxDay) state.pickerDay = null;
    } else {
        // ─── جلالی ───
        state.pickerJm += delta;
        if (state.pickerJm < 1) { state.pickerJm = 12; state.pickerJy -= 1; }
        if (state.pickerJm > 12) { state.pickerJm = 1; state.pickerJy += 1; }

        const maxDay = jalaliMonthLength(state.pickerJy, state.pickerJm);
        if (state.pickerDay && state.pickerDay > maxDay) state.pickerDay = null;
    }
    renderPicker();
}

// ═══════════════════════════════════════════════════════════════════════════
// Render
// ═══════════════════════════════════════════════════════════════════════════

export function renderPicker() {
    conflictArmed = false;

    // ─── رندر روزهای هفته ───
    const weekdaysEl = document.getElementById('pickerWeekdays');
    renderWeekdays(weekdaysEl, state.pickerCalendar);

    if (state.pickerCalendar === 'gregorian') {
        renderGregorian();
    } else {
        renderJalali();
    }
}

/**
 * رندر تقویم جلالی.
 */
function renderJalali() {
    const now = getNow();
    const tj = gregorianToJalali(now.getFullYear(), now.getMonth() + 1, now.getDate());

    // ─── عنوان ماه + سال ───
    document.getElementById('pickerMonthLabel').textContent =
        JALALI_MONTHS[state.pickerJm - 1] + ' ' + formatYear(state.pickerJy);

    // ─── محاسبه‌ی روز اول هفته ───
    // ⚠️ در جلالی، شنبه اول هفته است (getDay=6 → 0).
    const g = jalaliToGregorian(state.pickerJy, state.pickerJm, 1);
    const firstWeekday = new Date(g.gy, g.gm - 1, g.gd).getDay();
    const leading = (firstWeekday + 1) % 7;
    const monthLen = jalaliMonthLength(state.pickerJy, state.pickerJm);

    // ─── رندر روزها ───
    let html = '';
    for (let i = 0; i < leading; i++) html += '<span class="picker-day empty"></span>';
    for (let d = 1; d <= monthLen; d++) {
        const isPast = state.pickerJy < tj.jy ||
            (state.pickerJy === tj.jy && state.pickerJm < tj.jm) ||
            (state.pickerJy === tj.jy && state.pickerJm === tj.jm && d < tj.jd);
        const isToday = state.pickerJy === tj.jy && state.pickerJm === tj.jm && d === tj.jd;
        const cls = 'picker-day' + (isToday ? ' today' : '') + (state.pickerDay === d ? ' selected' : '');
        const monthName = JALALI_MONTHS[state.pickerJm - 1];
        html += `<button class="${cls}" data-day="${d}" ${isPast ? 'disabled' : ''} aria-label="${formatNumber(d)} ${monthName}">${formatNumber(d)}</button>`;
    }
    document.getElementById('pickerDays').innerHTML = html;
}

/**
 * رندر تقویم میلادی.
 */
function renderGregorian() {
    const now = getNow();
    const tg = { gy: now.getFullYear(), gm: now.getMonth() + 1, gd: now.getDate() };

    // ─── عنوان ماه + سال ───
    document.getElementById('pickerMonthLabel').textContent =
        getMonthName('en', state.pickerGm, 'gregorian') + ' ' + formatYear(state.pickerGy);

    // ─── محاسبه‌ی روز اول هفته ───
    // ⚠️ در میلادی (en)، یکشنبه اول هفته است (getDay=0 → 0).
    const firstWeekday = new Date(state.pickerGy, state.pickerGm - 1, 1).getDay();
    const leading = firstWeekday; // 0=Sunday → leading=0
    const monthLen = gregorianMonthLength(state.pickerGy, state.pickerGm);

    // ─── رندر روزها ───
    let html = '';
    for (let i = 0; i < leading; i++) html += '<span class="picker-day empty"></span>';
    for (let d = 1; d <= monthLen; d++) {
        const isPast = state.pickerGy < tg.gy ||
            (state.pickerGy === tg.gy && state.pickerGm < tg.gm) ||
            (state.pickerGy === tg.gy && state.pickerGm === tg.gm && d < tg.gd);
        const isToday = state.pickerGy === tg.gy && state.pickerGm === tg.gm && d === tg.gd;
        const cls = 'picker-day' + (isToday ? ' today' : '') + (state.pickerDay === d ? ' selected' : '');
        const monthName = getMonthName('en', state.pickerGm, 'gregorian');
        html += `<button class="${cls}" data-day="${d}" ${isPast ? 'disabled' : ''} aria-label="${monthName} ${d}">${d}</button>`;
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

    // ─── ساخت Date از state بر اساس تقویم ───
    let picked;
    if (state.pickerCalendar === 'gregorian') {
        const h = parseInt(document.getElementById('pickerHour').value, 10);
        const mi = parseInt(document.getElementById('pickerMinute').value, 10);
        picked = new Date(state.pickerGy, state.pickerGm - 1, state.pickerDay, h, mi, 0, 0);
    } else {
        const g = jalaliToGregorian(state.pickerJy, state.pickerJm, state.pickerDay);
        const h = parseInt(document.getElementById('pickerHour').value, 10);
        const mi = parseInt(document.getElementById('pickerMinute').value, 10);
        picked = new Date(g.gy, g.gm - 1, g.gd, h, mi, 0, 0);
    }

    if (picked.getTime() <= getNow().getTime()) {
        err.textContent = i18nT('picker.errorPast');
        return;
    }

    // ─── بررسی تداخل ───
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

    // ─── مقداردهی state بر اساس تقویم فعلی ───
    if (state.pickerCalendar === 'gregorian') {
        state.pickerGy = base.getFullYear();
        state.pickerGm = base.getMonth() + 1;
        state.pickerDay = base.getDate();
    } else {
        const j = gregorianToJalali(base.getFullYear(), base.getMonth() + 1, base.getDate());
        state.pickerJy = j.jy;
        state.pickerJm = j.jm;
        state.pickerDay = j.jd;
    }

    document.getElementById('pickerHour').value = String(base.getHours()).padStart(2, '0');
    document.getElementById('pickerMinute').value = '00';
    renderPicker();
}

// ═══════════════════════════════════════════════════════════════════════════
// پایان picker.js
// ═══════════════════════════════════════════════════════════════════════════