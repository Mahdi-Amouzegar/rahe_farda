// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// jalali.js -- pure calendar math (Jalali + Gregorian months) (no DOM) (ESM)
//
// ⚠️ فاز ۴D.5: نام ماه‌های میلادی (GREGORIAN_MONTHS_FA/EN) اضافه شدند.
//    این فایل همچنان pure است — به i18n.js وابسته نیست.

export const JALALI_BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];

export const JALALI_MONTHS = [
    'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
    'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'
];

/**
 * نام ماه‌های میلادی به فارسی.
 *
 * ⚠️ طبق تست Intl.DateTimeFormat('fa-IR', { month: 'long' }):
 *   - May → «مه» (نه «می»)
 *   - July → «ژوئیه» (نه «جولای»)
 *
 * ⚠️ این مقادیر باید با `Intl.DateTimeFormat('fa-IR')` یکدست باشند،
 *    چون در `formatDate()` (i18n.js) از Intl استفاده می‌شود.
 */
export const GREGORIAN_MONTHS_FA = [
    'ژانویه', 'فوریه', 'مارس', 'آوریل', 'مه', 'ژوئن',
    'ژوئیه', 'اوت', 'سپتامبر', 'اکتبر', 'نوامبر', 'دسامبر'
];

/**
 * نام ماه‌های میلادی به انگلیسی.
 *
 * ⚠️ طبق استاندارد CLDR.
 */
export const GREGORIAN_MONTHS_EN = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

const jdiv = (a, b) => Math.trunc(a / b);
const jmod = (a, b) => a - Math.trunc(a / b) * b;

export function jalCal(jy) {
    const breaks = JALALI_BREAKS;
    const bl = breaks.length;
    const gy = jy + 621;
    let leapJ = -14;
    let jp = breaks[0];
    let jm, jump, leap, leapG, march, n, i;
    if (jy < jp || jy >= breaks[bl - 1]) throw new Error('Invalid Jalali year ' + jy);
    for (i = 1; i < bl; i++) {
        jm = breaks[i];
        jump = jm - jp;
        if (jy < jm) break;
        leapJ = leapJ + jdiv(jump, 33) * 8 + jdiv(jmod(jump, 33), 4);
        jp = jm;
    }
    n = jy - jp;
    leapJ = leapJ + jdiv(n, 33) * 8 + jdiv(jmod(n, 33) + 3, 4);
    if (jmod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
    leapG = jdiv(gy, 4) - jdiv((jdiv(gy, 100) + 1) * 3, 4) - 150;
    march = 20 + leapJ - leapG;
    if (jump - n < 6) n = n - jump + jdiv(jump + 4, 33) * 33;
    leap = jmod(jmod(n + 1, 33) - 1, 4);
    if (leap === -1) leap = 4;
    return { leap, gy, march };
}

export function g2d(gy, gm, gd) {
    let d = jdiv((gy + jdiv(gm - 8, 6) + 100100) * 1461, 4) +
        jdiv(153 * jmod(gm + 9, 12) + 2, 5) + gd - 34840408;
    d = d - jdiv(jdiv(gy + 100100 + jdiv(gm - 8, 6), 100) * 3, 4) + 752;
    return d;
}

export function d2g(jdn) {
    let j = 4 * jdn + 139361631;
    j = j + jdiv(jdiv(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
    const i = jdiv(jmod(j, 1461), 4) * 5 + 308;
    const gd = jdiv(jmod(i, 153), 5) + 1;
    const gm = jmod(jdiv(i, 153), 12) + 1;
    const gy = jdiv(j, 1461) - 100100 + jdiv(8 - gm, 6);
    return { gy, gm, gd };
}

export function j2d(jy, jm, jd) {
    const r = jalCal(jy);
    return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - jdiv(jm, 7) * (jm - 7) + jd - 1;
}

export function d2j(jdn) {
    const gy = d2g(jdn).gy;
    let jy = gy - 621;
    const r = jalCal(jy);
    const jdn1f = g2d(gy, 3, r.march);
    let jd, jm;
    let k = jdn - jdn1f;
    if (k >= 0) {
        if (k <= 185) {
            jm = 1 + jdiv(k, 31);
            jd = jmod(k, 31) + 1;
            return { jy, jm, jd };
        }
        k -= 186;
    } else {
        jy -= 1;
        k += 179;
        if (r.leap === 1) k += 1;
    }
    jm = 7 + jdiv(k, 30);
    jd = jmod(k, 30) + 1;
    return { jy, jm, jd };
}

export function gregorianToJalali(gy, gm, gd) {
    return d2j(g2d(gy, gm, gd));
}

export function jalaliToGregorian(jy, jm, jd) {
    return d2g(j2d(jy, jm, jd));
}

export function jalaliMonthLength(jy, jm) {
    if (jm <= 6) return 31;
    if (jm <= 11) return 30;
    return jalCal(jy).leap === 0 ? 30 : 29;
}

/**
 * گرفتن نام ماه بر اساس زبان و نوع تقویم.
 *
 * ⚠️ این تابع **خالص** است — به i18n.js وابسته نیست.
 *    زبان (`lang`) از بیرون می‌آید (معمولاً از `getLang()`).
 *
 * ⚠️ پارامترها:
 *   - lang     : 'fa' | 'en'
 *   - month    : شماره‌ی ماه (۱-۱۲)
 *   - calendar : 'jalali' | 'gregorian' (پیش‌فرض: 'jalali')
 *
 * @param {string} lang
 * @param {number} month
 * @param {string} [calendar='jalali']
 * @returns {string} نام ماه یا رشته‌ی خالی
 */
export function getMonthName(lang, month, calendar = 'jalali') {
    // ─── اعتبارسنجی ماه ───
    if (!Number.isFinite(month) || month < 1 || month > 12) {
        return '';
    }
    const idx = Math.floor(month) - 1;

    // ─── تقویم میلادی ───
    if (calendar === 'gregorian') {
        if (lang === 'en') {
            return GREGORIAN_MONTHS_EN[idx] || '';
        }
        return GREGORIAN_MONTHS_FA[idx] || '';
    }

    // ─── تقویم جلالی (پیش‌فرض) ───
    return JALALI_MONTHS[idx] || '';
}

/**
 * طول یک ماه میلادی (۲۸، ۲۹، ۳۰، یا ۳۱ روز).
 *
 * ⚠️ از `Date` مرورگر استفاده می‌کند — که خودش leap year میلادی را
 *    می‌داند (۲۹ فوریه در سال‌های کبیسه).
 *
 * @param {number} gy - سال میلادی
 * @param {number} gm - ماه میلادی (۱-۱۲)
 * @returns {number} تعداد روزهای ماه (۱-۳۱)
 */
export function gregorianMonthLength(gy, gm) {
    if (!Number.isFinite(gy) || !Number.isFinite(gm)) return 0;
    if (gm < 1 || gm > 12) return 0;

    // ⚠️ ترفند استاندارد: روز ۰ از ماه بعد = آخرین روز ماه جاری
    //    new Date(2024, 2, 0) → ۲۹ فوریه ۲۰۲۴ (سال کبیسه)
    //    new Date(2023, 2, 0) → ۲۸ فوریه ۲۰۲۳
    return new Date(Math.floor(gy), Math.floor(gm), 0).getDate();
}

// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ گام ۱۵: SHIM‌ها حذف شدند
// ═══════════════════════════════════════════════════════════════════════════