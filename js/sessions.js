// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// sessions.js -- session (due-date) domain logic (ESM)

import { state, toFa, escapeHtml, uid } from './core.js';
import { getNow } from './time.js';
import { formatDate, formatNumber, getLang, t as i18nT } from './i18n.js';

// ═══════════════════════════════════════════════════════════════════════════
// Formatting
// ═══════════════════════════════════════════════════════════════════════════

/**
 * فرمت کوتاه تاریخ + ساعت بر اساس زبان فعلی.
 *
 * ⚠️ نام تابع `faShort` برای backward compat داخلی حفظ شده،
 *    ولی حالا از i18n.formatDate استفاده می‌کند.
 *
 * ⚠️ fa: «۱۵ دی، ساعت ۱۴:۳۰» (تقویم جلالی)
 * ⚠️ en: «January 5, 2:30 PM» (تقویم میلادی)
 *
 * @param {string} iso
 * @returns {string}
 */
export function faShort(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';

    const dateStr = formatDate(d, { day: 'numeric', month: 'long' });

    let timeStr = '';
    try {
        timeStr = new Intl.DateTimeFormat(
            getLang() === 'en' ? 'en-US' : 'fa-IR',
            { hour: '2-digit', minute: '2-digit' }
        ).format(d);
    } catch {
        timeStr = '';
    }

    if (getLang() === 'en') {
        return `${dateStr} at ${timeStr}`;
    }
    return `${dateStr}، ساعت ${timeStr}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Due chips (فرم افزودن)
// ═══════════════════════════════════════════════════════════════════════════

export function updateDueChips() {
    const wrap = document.getElementById('dueChips');
    if (!wrap) return;
    if (state.addDraftSessions.length === 0) {
        wrap.innerHTML = '';
        wrap.hidden = true;
        return;
    }
    wrap.hidden = false;
    const sorted = [...state.addDraftSessions].sort((a, b) => new Date(a.at) - new Date(b.at));
    wrap.innerHTML = sorted.map(s =>
        `<span class="due-chip">📅 ${faShort(s.at)}<button type="button" data-dchip="${escapeHtml(String(s.id))}" aria-label="حذف این سررسید">✕</button></span>`
    ).join('');
}

// ═══════════════════════════════════════════════════════════════════════════
// Nearest / summary
// ═══════════════════════════════════════════════════════════════════════════

/**
 * آیا این جلسه «مصرف‌شده» است؟ (10.24)
 *
 * ⚠️ با تیک زدن یک دوره، جلسه‌ی جاری (نزدیک‌ترین آینده) با `doneAt` علامت
 * می‌خورد و از فهرست «آینده» بیرون می‌رود — ولی به‌عنوان تاریخچه در
 * `sessions` می‌ماند (نقطه‌ی تقویم، شمارش). بدون این، due-line بعد از تیک
 * همان جلسه‌ی قبلی را نشان می‌داد و تا رفرش/گذشتن زمان تکان نمی‌خورد.
 *
 * @param {object} s
 * @returns {boolean}
 */
export function isSessionDone(s) {
    return !!(s && s.doneAt);
}

export function nearestUpcoming(task) {
    const now = getNow().getTime();
    return (task.sessions || [])
        .filter(s => !isSessionDone(s) && new Date(s.at).getTime() >= now)
        .sort((a, b) => new Date(a.at) - new Date(b.at))[0] || null;
}

/**
 * شناسه‌ی جلسه‌ی «فعال» یک آیتم (10.26).
 *
 * ⚠️ جلسه‌ی فعال = نزدیک‌ترین جلسه‌ی آینده‌ی مصرف‌نشده. در صفحه‌ی جزئیات فقط
 * همین ردیف کنترل دارد (یادآور/مکان/حذف)؛ بقیه غیرفعال‌اند.
 *
 * @param {object} task
 * @returns {string|null}
 */
export function activeSessionId(task) {
    const n = nearestUpcoming(task);
    return n ? String(n.id) : null;
}

/**
 * آیا این جلسه «غیرفعال» است؟ (گذشته یا مصرف‌شده با تیک دوره)
 *
 * @param {object} s
 * @param {number} [nowMs]
 * @returns {boolean}
 */
export function isSessionInactive(s, nowMs) {
    if (!s) return true;
    if (isSessionDone(s)) return true;
    const now = Number.isFinite(nowMs) ? nowMs : getNow().getTime();
    const v = new Date(s.at).getTime();
    if (!Number.isFinite(v)) return true;
    return v < now;
}

/**
 * ارتقای جلسه‌ی قبلی به «فعال» بعد از حذف جلسه‌ی فعال (10.26).
 *
 * ⚠️ سناریوی گزارش‌شده: در یک دوره، جلسه‌ی فعال (آخرین سررسید پیش‌رو) را با ✕
 * حذف می‌کنیم. اگر جلسه‌ی قبلی‌اش هنوز تاریخش بعد از «حالا» باشد، باید دوباره
 * فعال شود و due-line لیست هم همان را نشان بدهد — نه «سررسید گذشته».
 *
 * جلسه‌ی قبلی ممکن است با تیک دوره `doneAt` خورده باشد؛ مهرش برداشته می‌شود و
 * فلگ‌های یادآور صفر می‌شوند تا هشدار سررسید برای تاریخ جدید هم شلیک کند.
 *
 * @param {object} task
 * @param {number} [nowMs] — برای تست
 * @returns {boolean} آیا جلسه‌ای ارتقا یافت؟
 */
export function promoteFutureSession(task, nowMs) {
    if (!task) return false;
    // اگر هنوز جلسه‌ی آینده‌ی مصرف‌نشده هست، کاری لازم نیست.
    if (nearestUpcoming(task)) return false;
    const now = Number.isFinite(nowMs) ? nowMs : getNow().getTime();
    const cand = (task.sessions || [])
        .filter(s => s && Number.isFinite(new Date(s.at).getTime()) && new Date(s.at).getTime() > now)
        .sort((a, b) => new Date(b.at) - new Date(a.at))[0];
    if (!cand) return false;
    delete cand.doneAt;
    cand.reminded = false;
    cand.remindedDue = false;
    cand.remindedDueSoon = false;
    return true;
}

/**
 * اثر انگشت «فاز» due-line یک آیتم (10.21/BUG-20) — محض و ارزان.
 *
 * ⚠️ چرا لازم است: `sessionSummaryHtml` به زمان وابسته است (نزدیک‌ترین جلسه‌ی
 * آینده → «فردا/امروز/N روز دیگر»، و وقتی همه‌ی جلسات گذشته‌اند → «سررسید
 * گذشته»). امضای رندر قبلاً فقط id/متن/جلسات را می‌دید، پس با گذشتن زمان
 * هیچ رندری تحریک نمی‌شد و due-line تا رفرش دستی کهنه می‌ماند.
 *
 * این تابع خروجی کوتاهی می‌دهد که با هر تغییرِ قابل‌مشاهده عوض می‌شود:
 *   ''            → بدون جلسه (due-line ای رندر نمی‌شود)
 *   'c<n>'        → تکمیل‌شده (فقط شمارش)
 *   'u<at>#<d>'   → نزدیک‌ترین جلسه‌ی آینده + فاصله‌ی روز (امروز/فردا/n روز)
 *   'o<at>'       → همه گذشته (سررسید گذشته، آخرین جلسه)
 *   'd<n>'        → همه‌ی جلسه‌ها مصرف‌شده‌اند ولی تسک باز است (10.24)
 *
 * ⚠️ 10.24: جلسه‌های مصرف‌شده (`doneAt`) مثل «گذشته» رفتار می‌کنند —
 * وگرنه بعد از تیک یک دوره، فاز عوض نمی‌شد و due-line کهنه می‌ماند.
 *
 * @param {object} task
 * @param {number} [nowMs] — برای تست؛ پیش‌فرض ساعت تصحیح‌شده‌ی getNow()
 * @returns {string}
 */
export function dueLinePhase(task, nowMs) {
    const sessions = (task && task.sessions) || [];
    if (!Array.isArray(sessions) || sessions.length === 0) return '';
    if (task.completed) return 'c' + sessions.length;
    const now = Number.isFinite(nowMs) ? new Date(nowMs) : getNow();
    const nowVal = now.getTime();
    let nearest = null;
    let latest = null;
    let pending = 0;
    for (const s of sessions) {
        if (!s || isSessionDone(s)) continue;
        const v = new Date(s.at).getTime();
        if (!Number.isFinite(v)) continue;
        pending++;
        if (v >= nowVal) {
            if (nearest === null || v < nearest) nearest = v;
        }
        if (latest === null || v > latest) latest = v;
    }
    if (nearest !== null) {
        const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        const diffDays = Math.round((startOf(new Date(nearest)) - startOf(now)) / 86400000);
        return 'u' + nearest + '#' + diffDays;
    }
    if (pending === 0) return 'd' + sessions.length;
    return 'o' + latest;
}

/**
 * هشدار سررسید چند دقیقه قبل است (همان پنجره‌ی شاخه due در notify.js).
 */
export const NEAR_DUE_MIN = 5;

/**
 * مهلت جبران هشدار سررسید بعد از گذشتن زمان (تب بسته/throttle/رفرش دیر).
 */
export const DUE_CATCH_UP_MS = 15 * 60 * 1000;

/**
 * آیا هشدار سررسید باید شلیک کند؟ (10.11 — خالص و تست‌پذیر)
 *
 * قبلاً شرط `now < v` داشت: در خود لحظه سررسید هیچ‌وقت شلیک نمی‌شد و اگر
 * تیک حلقه دقیق در پنجره ۲دقیقه‌ای قبلش نمی‌افتاد، هشدار برای همیشه می‌پرید.
 * حالا: از ۵ دقیقه قبل تا ۱۵ دقیقه بعد از سررسید.
 */
export function isDueFireable(nowMs, atMs, remindedDue) {
    if (remindedDue) return false;
    if (!Number.isFinite(atMs)) return false;
    return nowMs >= atMs - NEAR_DUE_MIN * 60 * 1000 && nowMs - atMs <= DUE_CATCH_UP_MS;
}

// ═══════════════════════════════════════════════════════════════════════════
// Recurrence (قانون دوره → جلسه‌ی بعدی)
// ═══════════════════════════════════════════════════════════════════════════
//
// ⚠️ 10.24: این بلوک از `store.js` به `sessions.js` منتقل شد تا مسیر مشترک
// (DM/گروه در `tasks/source.js`) هم بتواند بدون چرخه‌ی import از آن استفاده
// کند. `store.js` همچنان `advanceRecur` را re-export می‌کند (سازگاری).

function daysInMonth(gy, gm) {
    return new Date(gy, gm + 1, 0).getDate();
}

function addInterval(date, recur, n, m) {
    const d = new Date(date.getTime());
    if (recur === 'daily') d.setDate(d.getDate() + 1);
    else if (recur === 'weekly') d.setDate(d.getDate() + 7);
    else if (recur === 'monthly') {
        const day = d.getDate();
        d.setDate(1);
        d.setMonth(d.getMonth() + 1);
        d.setDate(Math.min(day, daysInMonth(d.getFullYear(), d.getMonth())));
    }
    else if (recur === 'custom' && n >= 1) d.setDate(d.getDate() + n);
    else if (recur === 'hourly' && (n >= 1 || (m || 0) >= 1)) d.setTime(d.getTime() + (n * 3600 + (m || 0) * 60) * 1000);
    return d;
}

function nextWeekday(base, days) {
    const set = (days || []).filter(d => d >= 0 && d <= 6);
    if (!set.length) return null;
    for (let i = 1; i <= 7; i++) {
        const d = new Date(base.getTime());
        d.setDate(d.getDate() + i);
        if (set.includes(d.getDay())) {
            d.setHours(base.getHours(), base.getMinutes(), 0, 0);
            return d;
        }
    }
    return null;
}

function nextMonthday(base, days) {
    const set = [...new Set((days || []).filter(d => d >= 1 && d <= 31))].sort((a, b) => a - b);
    if (!set.length) return null;
    for (let m = 0; m < 13; m++) {
        const y = base.getFullYear();
        const mo = base.getMonth() + m;
        for (const dd of set) {
            if (dd > daysInMonth(y, mo)) continue;
            const c = new Date(y, mo, dd, base.getHours(), base.getMinutes(), 0, 0);
            if (c.getTime() > base.getTime()) return c;
        }
    }
    return null;
}

/**
 * ساخت جلسه‌ی بعدی از قانون دوره (مثلاً روزانه → فردا همان ساعت).
 *
 * ⚠️ 10.13: پایه همیشه آخرین سررسید ثبت‌شده است — حتی گذشته.
 * (پیش‌تر با Math.max(..., Date.now()) محاسبه می‌شد و در تمدید
 *  دیرهنگام، سررسید بعدی از «لحظه تمدید» حساب می‌شد.)
 *
 * @param {object} task — باید recur/recurN/recurMin/recurDays/sessions داشته باشد
 * @returns {boolean} آیا جلسه‌ی تازه اضافه شد؟
 */
export function advanceRecur(task) {
    const r = task.recur;
    const n = r === 'custom'
        ? ((task.recurN >= 1 && task.recurN <= 365) ? task.recurN : 0)
        : r === 'hourly'
            ? ((task.recurN >= 0 && task.recurN <= 168) ? task.recurN : 0)
            : 0;
    const m = r === 'hourly'
        ? ((task.recurMin >= 0 && task.recurMin <= 59) ? task.recurMin : 0)
        : 0;
    if ((r === 'custom' || r === 'hourly') && !n && !m) return false;
    const list = task.sessions || [];
    let base = null;
    for (const s of list) {
        const v = new Date(s.at).getTime();
        if (!isNaN(v) && (base === null || v > base)) base = v;
    }
    if (base === null) base = Date.now();
    const b = new Date(base);
    let next = null;
    if (r === 'weeklyDays') next = nextWeekday(b, task.recurDays);
    else if (r === 'monthlyDays') next = nextMonthday(b, task.recurDays);
    else next = addInterval(b, r, n, m);
    if (!next || next.getTime() <= base) return false;
    task.sessions.push({ id: uid(), at: next.toISOString(), reminded: false, remindMin: null, location: null, regAt: new Date().toISOString() });
    return true;
}

/**
 * «تیک یک دوره» = مصرف جلسه‌ی جاری + ساخت جلسه‌ی بعدی (10.24).
 *
 * ⚠️ مسئله‌ی گزارش‌شده (T-09): قبلاً `toggleTask` فقط `advanceRecur` را صدا
 * می‌زد و جلسه‌ی جاری در آرایه می‌ماند. چون جلسه در آینده بود،
 * `nearestUpcoming` همچنان همان را برمی‌گرداند و due-line تا لحظه‌ی گذشتن
 * زمان (یا رفرش با rollforward) تکان نمی‌خورد — حتی بعد از رفرش، چون جلسه
 * هنوز «آینده» بود.
 *
 * حالا جلسه‌ی جاری با `doneAt` مهر می‌خورد (تاریخچه حفظ می‌شود: نقطه‌ی
 * تقویم و شمارش) و از «آینده» بیرون می‌رود؛ پس due-line بلافاصله به جلسه‌ی
 * بعدی می‌رود. برای تسک بدون جلسه‌ی آینده (همه گذشته)، چیزی مهر نمی‌خورد و
 * همان rollforward معمول کافی است.
 *
 * @param {object} task
 * @param {string} [nowIso] — برای تست
 * @returns {boolean} آیا جلسه‌ی بعدی ساخته شد؟
 */
export function advanceRecurOnTick(task, nowIso) {
    if (!task || !task.recur || task.recur === 'none') return false;
    const consumed = nearestUpcoming(task);
    if (!advanceRecur(task)) return false;
    if (consumed) {
        const s = (task.sessions || []).find(x => x && String(x.id) === String(consumed.id));
        if (s) s.doneAt = nowIso || new Date().toISOString();
    }
    return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// Plan range (فاز ۱۱ آیتم ۷: اعتبارسنجی دوسویه شروع/پایان)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * آیا ترکیب (شروع، پایان) معتبر است؟ هر دو nullable (بازه‌ی باز).
 * نامعتبر فقط وقتی که هر دو موجود و پایان < شروع باشد — مستقل از ترتیب ورود.
 *
 * @param {string|null} startIso
 * @param {string|null} endIso
 * @returns {{ok: boolean, error?: string}} — error کلید لوکال است
 */
export function validatePlanRange(startIso, endIso) {
    if (!startIso || !endIso) return { ok: true };
    const s = new Date(startIso).getTime();
    const e = new Date(endIso).getTime();
    if (!Number.isFinite(s) || !Number.isFinite(e)) return { ok: true };
    if (e < s) return { ok: false, error: 'detail.planDates.rangeInvalid' };
    return { ok: true };
}

/**
 * ساخت HTML دکمه‌ی هوا با اسلات آیکن.
 *
 * این تابع فقط وقتی دکمه را برمی‌گرداند که:
 *  - task.location وجود داشته باشد
 *  - نزدیک‌ترین سررسید در بازه ۱۶ روز آینده باشد
 *
 * اسلات `data-weather-icon-for` توسط `hydrateWeatherIcons` در `ui.js`
 * پر می‌شود (به صورت غیرهمزمان).
 *
 * @param {object} task
 * @returns {string} HTML یا ''
 */
function weatherButtonHtml(task) {
    if (!task || !task.location) return '';
    const next = nearestUpcoming(task);
    if (!next) return '';
    const due = new Date(next.at).getTime();
    if (!Number.isFinite(due)) return '';
    const daysAhead = (due - Date.now()) / 86400000;
    if (daysAhead < 0 || daysAhead > 16) return '';
    const key = `${escapeHtml(String(task.id))}|${escapeHtml(next.at)}`;
    const label = i18nT('taskItem.weather.buttonAria');
    return `<button type="button" class="weather-icon-btn" data-weather-task="${escapeHtml(String(task.id))}" aria-label="${label}" title="${label}"><span class="weather-icon-emoji" data-weather-icon-for="${key}" aria-hidden="true">…</span><span aria-hidden="true">🌡️</span></button>`;
}

export function sessionSummaryHtml(task) {
    const sessions = task.sessions || [];
    if (sessions.length === 0) return '';
    if (task.completed) {
        return `<span class="due-line past-all">📅 ${i18nT('sessions.summary.count', { n: formatNumber(sessions.length) })}</span>`;
    }
    const n = nearestUpcoming(task);
    if (n) {
        const now = getNow();
        const due = new Date(n.at);
        const startOf = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        const diffDays = Math.round((startOf(due) - startOf(now)) / 86400000);
        let extra = '';
        if (diffDays === 0) extra = ' ' + i18nT('sessions.summary.today');
        else if (diffDays === 1) extra = ' ' + i18nT('sessions.summary.tomorrow');
        else extra = ' ' + i18nT('sessions.summary.daysLeft', { n: formatNumber(diffDays) });
        const count = sessions.length > 1
            ? ` <span class="sess-count">${i18nT('sessions.summary.count', { n: formatNumber(sessions.length) })}</span>`
            : '';
        const wBtn = weatherButtonHtml(task);
        return `<span class="due-line">${i18nT('sessions.summary.nextSession', { date: faShort(n.at) })}${extra}${n.location ? ' 📍' : ''}${wBtn}</span>${count}`;
    }
    const past = [...sessions.filter(s => !isSessionDone(s))].sort((a, b) => new Date(b.at) - new Date(a.at))[0];
    // ⚠️ 10.24: ممکن است همه‌ی جلسه‌ها مصرف شده باشند ولی تسک باز مانده باشد
    // (مثلاً قانون نامعتبر → جلسه‌ی بعدی ساخته نشد). نمایش «سررسید گذشته» با
    // تاریخ جلسه‌ی مصرف‌شده گمراه‌کننده است؛ فقط شمارش نشان داده می‌شود.
    if (!past) {
        return `<span class="due-line past-all">📅 ${i18nT('sessions.summary.count', { n: formatNumber(sessions.length) })}</span>`;
    }
    return `<span class="due-line overdue">${i18nT('sessions.summary.overdue', { date: faShort(past.at) })}</span>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Badge / day helpers
// ═══════════════════════════════════════════════════════════════════════════

export function recurBadge(task, cls) {
    if (!task.recur || task.recur === 'none') return '';
    let suffix = '';
    if (task.recur === 'custom' && task.recurN > 1) {
        suffix = ' ' + i18nT('recur.everyNDays', { n: formatNumber(task.recurN) });
    } else if (task.recur === 'hourly' && (task.recurN >= 1 || task.recurMin >= 1)) {
        suffix = task.recurMin >= 1
            ? (task.recurN >= 1
                ? ' ' + i18nT('recur.everyHAndM', { h: formatNumber(task.recurN), m: formatNumber(task.recurMin) })
                : ' ' + i18nT('recur.everyMinutes', { m: formatNumber(task.recurMin) }))
            : ' ' + i18nT('recur.everyNHours', { n: formatNumber(task.recurN) });
    } else if (task.recur === 'weeklyDays') {
        suffix = ' ' + i18nT('recur.weeklyDays');
    } else if (task.recur === 'monthlyDays') {
        suffix = ' ' + i18nT('recur.monthlyDays');
    }
    return `<span class="${cls || ''}" title="${i18nT('recur.badgeTitle')}${suffix}">🔁</span>`;
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

/**
 * نرمال‌سازی متن فارسی برای جستجو.
 *  - تبدیل اعداد فارسی/عربی به انگلیسی
 *  - تبدیل ی/ک عربی به فارسی
 *  - حذف فاصله‌های اضافی
 *  - lowercase برای انگلیسی
 *
 * @param {string} s
 * @returns {string}
 */
export function normalizeForSearch(s) {
    if (!s) return '';
    let out = String(s);
    // اعداد فارسی/عربی → انگلیسی
    out = out.replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
    out = out.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
    // ی و ک عربی → فارسی
    out = out.replace(/ي/g, 'ی').replace(/ك/g, 'ک');
    // حذف اعراب (فتحه، کسره، ...)
    out = out.replace(/[\u064B-\u065F\u0670]/g, '');
    // حذف ZWNJ (نیم‌فاصله) — برای جستجوی «می‌روم» با «میروم»
    out = out.replace(/\u200C/g, '');
    // فاصله‌های اضافی
    out = out.replace(/\s+/g, ' ').trim();
    // lowercase (برای انگلیسی)
    out = out.toLowerCase();
    return out;
}

/**
 * جستجوی معنایی در یک task.
 *
 * فیلدهای جستجو:
 *   - text (عنوان)
 *   - description (توضیح)
 *   - phone (تلفن)
 *   - address (آدرس)
 *   - url (آدرس اینترنتی)
 *
 * ⚠️ برای plan، فیلدهای فرزندان هم جداگانه چک می‌شوند
 * (در getFiltered در ui.js).
 *
 * @param {object} t
 * @param {string} q
 * @returns {boolean}
 */
export function taskMatches(t, q) {
    if (!q) return true;
    if (!t) return false;
    const needle = normalizeForSearch(q);
    if (!needle) return true;

    const fields = [
        t.text,
        t.description,
        t.phone,
        t.address,
        t.url
    ];

    for (const f of fields) {
        if (f && normalizeForSearch(f).includes(needle)) return true;
    }

    // جستجو در عنوان فرزندان (برای plan)
    if (t.kind === 'plan' && Array.isArray(t.children)) {
        for (const c of t.children) {
            if (!c) continue;
            const cFields = [c.text, c.description, c.phone, c.address, c.url];
            for (const f of cFields) {
                if (f && normalizeForSearch(f).includes(needle)) return true;
            }
        }
    }

    return false;
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
//
// ⚠️ نکته: این cache به state.taskIndexVersion وابسته است که در store.js
// هنگام هر saveTasks() و moveToTrashById() increment می‌شود. پس cache
// به‌طور خودکار باطل می‌شود وقتی state.tasks تغییر کند.
//
// این طراحی امن‌تر از قبل است چون:
//  - هر ذخیره‌سازی → version++
//  - هر بازگشت از سطل زباله → version++
//  - هر حذف → version++
//  - اگر مستقیم state.tasks mutate شود (بدون saveTasks) → cache کهنه می‌ماند
//    (که در کد فعلی این اتفاق نمی‌افتد چون همه تغییرات از طریق saveTasks می‌آید)
//
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
            // ⚠️ 10.24: جلسه‌ی مصرف‌شده (تیک‌خورده) دیگر «آینده» نیست —
            // نه یادآور می‌گیرد، نه در انتخابگر جلسه پیشنهاد می‌شود.
            if (onlyOpen && isSessionDone(s)) return;
            out.push({
                at: s.at,
                id: s.id,
                owner,
                taskId: t.id,
                priority: t.priority,
                reminded: Boolean(s.reminded),
                remindedDue: Boolean(s.remindedDue),
                remindedDueSoon: Boolean(s.remindedDueSoon),
                remindMin: s.remindMin != null ? s.remindMin : null,
                doneAt: s.doneAt || null,
                regAt: s.regAt != null ? s.regAt : t.createdAt
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

    // ⚠️ ترتیب مهم است:
    //   ۱. پس‌فردا (شامل «فردا» است)
    //   ۲. فردا شب (شامل «فردا» و «شب» است)
    //   ۳. امشب (شامل «شب» است)
    //   ۴. فردا
    //   ۵. امروز
    //   ۶. شب تنها
    //   ۷. هفته بعد
    if (has('پس‌فردا', 'پس فردا')) { day = addDays(d0, 2); explicitDay = true; }
    else if (has('فردا شب', 'فردا شب')) { day = addDays(d0, 1); explicitDay = true; }
    else if (has('امشب')) { day = d0; explicitDay = true; }
    else if (has('فردا')) { day = addDays(d0, 1); explicitDay = true; }
    else if (has('امروز')) { day = d0; explicitDay = true; }
    else if (has('شب')) { day = d0; explicitDay = true; }
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
    if (h === null) {
        // ⚠️ پیش‌فرض ساعت بر اساس کلمه‌ی روز
        if (has('امشب')) h = 21;
        else if (has('صبح')) h = 9;
        else if (has('ظهر')) h = 12;
        else if (has('عصر')) h = 17;
        else if (has('غروب')) h = 19;
        else if (has('شب')) h = 21;
        else h = 9;
    }

    let dt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, mi, 0, 0);
    if (dt.getTime() <= now.getTime()) {
        if (explicitDay) return null;
        dt = new Date(dt.getTime() + 24 * 3600 * 1000);
        if (dt.getTime() <= now.getTime()) return null;
    }
    return dt.toISOString();
}

// ═══════════════════════════════════════════════════════════════════════════
// English datetime parser (Phase 4E)
// ═══════════════════════════════════════════════════════════════════════════
//
// ⚠️ تفاوت‌های اصلی با fa:
//   ۱. در en، ترتیب کلمات متغیر است:
//        "tomorrow at 8am"  → tomorrow, then time
//        "at 8am tomorrow"  → time, then tomorrow
//        "8am tomorrow"     → time (without "at"), then tomorrow
//   ۲. ساعت در en می‌تواند با am/pm بیاد (نه فقط عدد)
//   ۳. بخش‌های روز (morning, afternoon, ...) می‌توانند standalone باشند:
//        "tomorrow morning"  → tomorrow at 9am (پیش‌فرض morning)
//   ۴. modifiers: next/this + weekday
//   ۵. case-insensitive

/**
 * نگاشت روزهای هفته در انگلیسی.
 * ⚠️ مقدار = getDay() مرورگر (0=Sunday, 1=Monday, ..., 6=Saturday)
 */
const WEEKDAYS_EN = {
    'sunday': 0, 'sun': 0,
    'monday': 1, 'mon': 1,
    'tuesday': 2, 'tue': 2, 'tues': 2,
    'wednesday': 3, 'wed': 3,
    'thursday': 4, 'thu': 4, 'thur': 4, 'thurs': 4,
    'friday': 5, 'fri': 5,
    'saturday': 6, 'sat': 6,
};

/**
 * بخش‌های روز با ساعت پیش‌فرض.
 */
const DAY_PARTS_EN = {
    'morning': 9,
    'noon': 12,
    'afternoon': 14,
    'evening': 18,
    'night': 21,
    'midnight': 0,
};

/**
 * پارس متن تاریخ/ساعت در انگلیسی.
 *
 * ⚠️ فرمت‌های پشتیبانی‌شده:
 *   - today, tomorrow, tonight, day after tomorrow
 *   - next week, next month
 *   - in X days/weeks/hours
 *   - X days/weeks from now
 *   - Monday, Tue, Wed, ... (هفته‌ی بعد)
 *   - next Monday, this Monday
 *   - at 8, at 8:30, 8am, 8pm, 2:30 pm
 *   - morning, afternoon, evening, night, midnight
 *   - ترکیب: "tomorrow at 8am", "next Monday at 14:00", "in 3 days at 9am"
 *
 * ⚠️ case-insensitive.
 *
 * @param {string} text
 * @param {Date} now
 * @returns {string|null} ISO یا null
 */
export function parseEnDateTime(text, now) {
    if (!text || typeof text !== 'string') return null;

    // ⚠️ lowercase برای case-insensitive
    const t = text.toLowerCase().trim();
    const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
    const has = (...ws) => ws.some(w => t.includes(w));
    let day = null;
    let explicitDay = false;
    let m;

    // ═══════════════════════════════════════════════════════════════════════
    // ۱. روزهای نسبی
    // ═══════════════════════════════════════════════════════════════════════
    if (has('day after tomorrow')) {
        day = addDays(d0, 2);
        explicitDay = true;
    }
    else if (has('tomorrow')) {
        day = addDays(d0, 1);
        explicitDay = true;
    }
    else if (has('tonight')) {
        day = d0;
        explicitDay = true;
    }
    else if (has('today')) {
        day = d0;
        explicitDay = true;
    }
    else if (has('next week')) {
        day = addDays(d0, 7);
        explicitDay = true;
    }
    else if (has('next month')) {
        // ⚠️ ماه بعد = +۳۰ روز (تقریب)
        day = addDays(d0, 30);
        explicitDay = true;
    }
    // ─── in X days/weeks/hours ───
    else if ((m = t.match(/\bin\s+(\d{1,3})\s+(day|days|week|weeks|hour|hours)\b/))) {
        const n = parseInt(m[1], 10);
        const unit = m[2];
        if (unit.startsWith('day')) {
            if (n < 1 || n > 365) return null;
            day = addDays(d0, n);
        } else if (unit.startsWith('week')) {
            if (n < 1 || n > 52) return null;
            day = addDays(d0, n * 7);
        } else if (unit.startsWith('hour')) {
            // ⚠️ ساعت‌های آینده — روز رو محاسبه می‌کنیم
            if (n < 1 || n > 168) return null;
            day = d0;
        }
        explicitDay = true;
    }
    // ─── X days/weeks from now ───
    else if ((m = t.match(/\b(\d{1,3})\s+(day|days|week|weeks)\s+from\s+now\b/))) {
        const n = parseInt(m[1], 10);
        const unit = m[2];
        if (unit.startsWith('day')) {
            if (n < 1 || n > 365) return null;
            day = addDays(d0, n);
        } else if (unit.startsWith('week')) {
            if (n < 1 || n > 52) return null;
            day = addDays(d0, n * 7);
        }
        explicitDay = true;
    }
    // ─── next/this + weekday ───
    else if ((m = t.match(/\b(next|this)\s+(sunday|sun|monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat)\b/))) {
        const modifier = m[1]; // 'next' or 'this'
        const dayName = m[2];
        const targetDay = WEEKDAYS_EN[dayName];
        if (targetDay === undefined) return null;

        let diff = (targetDay - d0.getDay() + 7) % 7;
        if (modifier === 'next') {
            // ⚠️ "next Monday" = هفته‌ی بعد (حتی اگر امروز Monday باشه)
            if (diff === 0) diff = 7;
            // در "next"، همیشه به هفته‌ی بعد می‌ره (نه همین هفته)
            // پس اگر امروز Monday و می‌گه "next Monday"، ۷ روز بعد
        } else {
            // "this Monday" = همین هفته (اگر امروز گذشته، هفته‌ی بعد)
            if (diff === 0) diff = 7;
        }
        day = addDays(d0, diff);
        explicitDay = true;
    }
    // ─── weekday تنها (next occurrence) ───
    else {
        for (const name of Object.keys(WEEKDAYS_EN)) {
            // ⚠️ از word boundary استفاده می‌کنیم تا "sun" در "sunday" تکرار نشه
            const regex = new RegExp(`\\b${name}\\b`, 'i');
            if (regex.test(t)) {
                const targetDay = WEEKDAYS_EN[name];
                let diff = (targetDay - d0.getDay() + 7) % 7;
                if (diff === 0) diff = 7; // اگر امروز همون روزه، هفته‌ی بعد
                day = addDays(d0, diff);
                explicitDay = true;
                break;
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ۲. ساعت
    // ═══════════════════════════════════════════════════════════════════════
    let h = null;
    let mi = 0;

    // ─── "at X:Y" یا "at X" ───
    if ((m = t.match(/\bat\s+(\d{1,2})(?:\s*[:：]\s*(\d{1,2}))?\s*(am|pm)?\b/))) {
        h = parseInt(m[1], 10);
        mi = m[2] ? parseInt(m[2], 10) : 0;
        const ampm = m[3];

        if (h > 23 || mi > 59) return null;

        if (ampm === 'pm' && h < 12) h += 12;
        else if (ampm === 'am' && h === 12) h = 0;
        else if (h >= 1 && h <= 6 && !ampm) h += 12; // پیش‌فرض: عصر (مثل fa)
    }
    // ─── "X:Y am/pm" یا "Xam" یا "Xpm" ───
    else if ((m = t.match(/\b(\d{1,2})(?:\s*[:：]\s*(\d{1,2}))?\s*(am|pm)\b/))) {
        h = parseInt(m[1], 10);
        mi = m[2] ? parseInt(m[2], 10) : 0;
        const ampm = m[3];

        if (h > 23 || mi > 59) return null;
        if (ampm === 'pm' && h < 12) h += 12;
        else if (ampm === 'am' && h === 12) h = 0;
    }
    // ─── "H:MM" بدون at و بدون am/pm ───
    //
    // ⚠️ چرا این الگو لازم است؟
    //    - کاربر می‌تونه بنویسه "tonight 21:00" یا "tomorrow 14:30"
    //    - این الگو در هیچ‌کدام از دو شرط قبلی نمی‌گیره
    //    - ولی در fa، این الگو کار می‌کنه (`ساعت ۱۴:۳۰`)
    else if ((m = t.match(/\b(\d{1,2})\s*[:：]\s*(\d{1,2})\b/))) {
        h = parseInt(m[1], 10);
        mi = parseInt(m[2], 10);
        if (h > 23 || mi > 59) return null;
        // ⚠️ بدون am/pm، فرض می‌کنیم 24h است (مثل fa)
        //    ولی اگر h بین 1-6 باشه، احتمالاً عصر است (مثل fa)
        if (h >= 1 && h <= 6) h += 12;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ۳. بخش‌های روز (اگر ساعت صریح نبود)
    // ═══════════════════════════════════════════════════════════════════════
    //
    // ⚠️ از `includes` استفاده می‌کنیم (نه regex با `\b`) چون:
    //    - `tonight` شامل `night` است ولی `\bnight\b` نمی‌گیره
    //      (چون `n` قبلی `o` است و word boundary نیست)
    //    - `includes` این مشکل رو نداره
    //
    // ⚠️ ترتیب مهم است — از خاص‌ترین به عام‌ترین:
    //    `midnight` قبل از `night` (چون `midnight` شامل `night` است)
    if (h === null) {
        // ⚠️ ترتیب مهم — از خاص‌ترین به عام‌ترین:
        //    - `midnight` شامل `night` است
        //    - `afternoon` شامل `noon` است
        //    پس این‌ها باید قبل از کوتاه‌ترها چک بشن
        if (t.includes('midnight')) h = 0;
        else if (t.includes('afternoon')) h = 14;
        else if (t.includes('morning')) h = 9;
        else if (t.includes('noon')) h = 12;
        else if (t.includes('evening')) h = 18;
        else if (t.includes('night')) h = 21;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ۴. اگر هیچ‌کدام پیدا نشد
    // ═══════════════════════════════════════════════════════════════════════
    if (!day && h === null) return null;
    if (!day) day = d0;
    if (h === null) h = 9; // پیش‌فرض صبح

    let dt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, mi, 0, 0);
    if (dt.getTime() <= now.getTime()) {
        if (explicitDay) return null;
        dt = new Date(dt.getTime() + 24 * 3600 * 1000);
        if (dt.getTime() <= now.getTime()) return null;
    }
    return dt.toISOString();
}

// ═══════════════════════════════════════════════════════════════════════════
// parseDateText — dispatcher locale-aware
// ═══════════════════════════════════════════════════════════════════════════

/**
 * پارس متن تاریخ/ساعت بر اساس زبان فعلی.
 *
 * ⚠️ این تابع dispatcher است — زبان رو از i18n می‌گیره و
 *    به parser مناسب پاس می‌ده.
 *
 * ⚠️ در fa → parseFaDateTime
 * ⚠️ در en → parseEnDateTime
 *
 * @param {string} text
 * @param {Date} now
 * @returns {string|null} ISO یا null
 */
export function parseDateText(text, now) {
    const lang = getLang();
    if (lang === 'en') {
        return parseEnDateTime(text, now);
    }
    return parseFaDateTime(text, now);
}

// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ گام ۱۵: SHIM‌ها حذف شدند
// ═══════════════════════════════════════════════════════════════════════════