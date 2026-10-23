// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/tasks/group-sender.js -- تصمیم خالص «ستون آواتار فرستنده» در لیست (10.32)
//
// ⚠️ نیاز کاربر: در گروه، وقتی چند نفر پیام می‌فرستند، باید در یک نگاه معلوم
// باشد هر کارت را چه کسی فرستاده. راه‌حل: هر کارتِ مخاطب یک ستون آواتار
// می‌گیرد (sticky) تا با اسکرول کارت‌های بلند هم آواتار دیده شود.
//
// ⚠️ فقط گروه: در DM فقط یک مخاطب هست، پس ستون آواتار فقط عرض می‌گیرد.
// ⚠️ فقط پیام دیگران: کارت‌های خودی نوار راست دارند و نیازی به آواتار ندارند.
// این ماژول pure است (بدون DOM) تا unit-test پذیر بماند.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * آیا برای این آیتم ستون آواتار فرستنده رندر شود؟
 *
 * @param {{local: boolean, mine: boolean, destType: string|null}} ctx
 * @returns {boolean}
 */
export function shouldShowSenderAvatar(ctx) {
    if (!ctx) return false;
    if (ctx.local) return false;          // نمای شخصی — فرستنده‌ی بیرونی ندارد
    if (ctx.mine) return false;           // پیام خودم — سمت راست است
    return ctx.destType === 'group';      // فقط گروه (نه DM)
}

/**
 * حرف اول نام برای fallback آواتار.
 * اگر نام خالی باشد «؟» برمی‌گردد تا کادر خالی نماند.
 *
 * @param {string|null|undefined} name
 * @returns {string}
 */
export function senderInitial(name) {
    const t = String(name == null ? '' : name).trim();
    if (!t) return '?';
    // ⚠️ codePoint تا ایموجی/حروف غیر-BMP نصفه نشوند
    const cp = t.codePointAt(0);
    return cp === undefined ? '?' : String.fromCodePoint(cp);
}
