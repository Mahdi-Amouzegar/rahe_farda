// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/tasks/personal-order.js -- ترتیب نمایش «وظایف من» (10.35)
//
// ⚠️ فقط برای فضای شخصی (local). در DM/گروه هیچ‌وقت اعمال نمی‌شود — آنجا ترتیب
// طبیعی مقصد (جدیدترین اول) می‌ماند.
//
// قاعده‌ی کاربر (پنج سطل، به همین ترتیب):
//   ۰) تیک‌نخورده + سررسید آینده → نزدیک‌ترین سررسید اول
//   ۱) تیک‌نخورده + بی‌سررسید   → الفبا
//   ۲) تیک‌نخورده + سررسید گذشته → نزدیک‌ترین انقضا اول (تازه‌منقضی‌شده‌ها بالاتر)
//   ۳) تیک‌خورده + سررسیددار    → نزدیک‌ترین به «اکنون» اول
//   ۴) تیک‌خورده + بی‌سررسید    → الفبا
//
// ⚠️ «نزدیک‌ترین» در همه‌ی سطل‌ها یعنی «نزدیک‌ترین به اکنون»:
//   - در آینده (سطل ۰) یعنی کوچک‌ترین مهر زمانی → صعودی
//   - در گذشته (سطل ۲) یعنی بزرگ‌ترین مهر زمانی → نزولی
//   - سطل ۳ با فاصله‌ی مطلق از اکنون سنجیده می‌شود تا هر دو حالت یک قاعده شوند
// این ماژول pure است (بدون DOM، بدون state) تا unit-test پذیر بماند؛ «اکنون» را
// همیشه ورودی می‌گیرد.
// ═══════════════════════════════════════════════════════════════════════════

export const BUCKET_UPCOMING = 0;
export const BUCKET_NO_DUE = 1;
export const BUCKET_OVERDUE = 2;
export const BUCKET_DONE_DUE = 3;
export const BUCKET_DONE_NO_DUE = 4;

/**
 * آیا این ترتیب اعمال شود؟ فقط حالت «هوشمند» و فقط فضای شخصی.
 *
 * ⚠️ در DM/گروه عمداً اعمال نمی‌شود (درخواست صریح کاربر): ترتیب آنجا همان
 * ترتیب طبیعی مقصد است.
 *
 * @param {{sort?: string, local?: boolean}} ctx
 * @returns {boolean}
 */
export function shouldUsePersonalOrder(ctx) {
    if (!ctx) return false;
    if (ctx.sort !== 'smart') return false;
    return ctx.local === true;
}

/** آیا این آیتم «انجام‌شده» است؟ برنامه = همه‌ی زیرکارهای غیربایگانی تیک‌خورده. */
export function isTaskDone(task) {
    if (!task) return false;
    if (task.kind !== 'plan') return Boolean(task.completed);
    const kids = (task.children || []).filter(c => c && !c.archived);
    if (kids.length === 0) return false;
    return kids.every(c => c.completed);
}

/**
 * همه‌ی مهرهای زمانی سررسید یک آیتم (ms).
 *
 * ⚠️ جلسه‌ی مصرف‌شده (`doneAt`) تاریخچه است، نه سررسید — مثل `nearestUpcoming`
 * کنار گذاشته می‌شود. برای برنامه، سررسید زیرکارهای غیربایگانی هم حساب است.
 *
 * @param {object} task
 * @returns {number[]}
 */
export function dueTimestamps(task) {
    const out = [];
    const push = (t) => {
        for (const s of (t.sessions || [])) {
            if (!s || s.doneAt) continue;
            const v = new Date(s.at).getTime();
            if (Number.isFinite(v)) out.push(v);
        }
    };
    if (!task) return out;
    push(task);
    if (task.kind === 'plan') {
        for (const c of (task.children || [])) {
            if (c && !c.archived) push(c);
        }
    }
    return out;
}

function nameOf(task) {
    return String((task && task.text) || '').trim();
}

/**
 * کلید مرتب‌سازی یک آیتم: `{ bucket, primary, name }`.
 *
 * @param {object} task
 * @param {number} nowMs
 * @returns {{bucket:number, primary:number, name:string}}
 */
export function personalOrderKey(task, nowMs) {
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    const name = nameOf(task);
    const stamps = dueTimestamps(task);
    let next = Infinity;
    let past = -Infinity;
    for (const v of stamps) {
        if (v >= now) {
            if (v < next) next = v;
        } else if (v > past) {
            past = v;
        }
    }
    const hasDue = stamps.length > 0;
    const done = isTaskDone(task);

    if (!done) {
        if (hasDue && next !== Infinity) return { bucket: BUCKET_UPCOMING, primary: next, name };
        if (!hasDue) return { bucket: BUCKET_NO_DUE, primary: 0, name };
        // سررسید دارد ولی هیچ‌کدام آینده نیست → همه گذشته‌اند
        return { bucket: BUCKET_OVERDUE, primary: past, name };
    }
    if (hasDue) {
        const ref = next !== Infinity ? next : past;
        return { bucket: BUCKET_DONE_DUE, primary: Math.abs(ref - now), name };
    }
    return { bucket: BUCKET_DONE_NO_DUE, primary: 0, name };
}

function compareKeys(a, b) {
    if (a.bucket !== b.bucket) return a.bucket - b.bucket;
    let d = 0;
    if (a.bucket === BUCKET_OVERDUE) d = b.primary - a.primary;
    else if (a.bucket === BUCKET_UPCOMING || a.bucket === BUCKET_DONE_DUE) d = a.primary - b.primary;
    if (d !== 0) return d;
    return a.name.localeCompare(b.name, 'fa');
}

/**
 * مقایسه‌ی دو وظیفه بر اساس قاعده‌ی بالا.
 *
 * @param {object} a
 * @param {object} b
 * @param {number} nowMs
 * @returns {number}
 */
export function comparePersonalTasks(a, b, nowMs) {
    return compareKeys(personalOrderKey(a, nowMs), personalOrderKey(b, nowMs));
}

/**
 * نسخه‌ی مرتب‌شده‌ی لیست (بدون تغییر آرایه‌ی ورودی).
 *
 * @param {object[]} list
 * @param {number} nowMs
 * @returns {object[]}
 */
export function sortPersonalTasks(list, nowMs) {
    const arr = Array.isArray(list) ? list : [];
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    return arr
        .map((task, i) => ({ task, i, key: personalOrderKey(task, now) }))
        .sort((x, y) => compareKeys(x.key, y.key) || x.i - y.i)
        .map(x => x.task);
}
