// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/navigation/nav-icon.js -- جدا کردن ایموجیِ ابتدای برچسب منو (10.32)
//
// ⚠️ نیاز کاربر: در دراور، کنار هر گزینه اول یک کادر مثل `conv-avatar` باشد و
// بعد متن. الان ایموجی داخل خود متنِ ترجمه است («📋 وظایف من») و با متن
// می‌چسبد؛ اینجا آن را جدا می‌کنیم تا در کادر جدا رندر شود.
//
// ⚠️ اگر ترجمه فقط ایموجی باشد (مثلاً «📋»)، متن را همان‌طور کامل برمی‌گردانیم
// تا برچسب خالی نشود.
// این ماژول pure است (بدون DOM) تا unit-test پذیر بماند.
// ═══════════════════════════════════════════════════════════════════════════

// ایموجی + ترکیب‌های رایج: variation selector، ZWJ، keycap
const LEADING_EMOJI = /^\s*(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|\u20E3)*)\s*/u;

/**
 * برچسب را به «آیکون» و «متن» بشکند.
 *
 * @param {string|null|undefined} label
 * @returns {{icon: string, text: string}}
 */
export function splitLeadingEmoji(label) {
    const raw = String(label == null ? '' : label);
    const m = raw.match(LEADING_EMOJI);
    if (!m) return { icon: '', text: raw.trim() };
    const rest = raw.slice(m[0].length).trim();
    if (!rest) return { icon: '', text: raw.trim() };
    return { icon: m[1], text: rest };
}
