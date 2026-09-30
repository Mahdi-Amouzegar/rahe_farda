// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/ui/badge.js -- بج شمارش (unread / invitations) — Phase 8 (T2)
//
// ⚠️ قرارداد UI-SHELL §۲.۲: بج‌ها با formatNumber (فارسی/انگلیسی) رندر می‌شوند.
//    بدون innerHTML — فقط textContent و hidden.
// ═══════════════════════════════════════════════════════════════════════════

import { formatNumber } from '../i18n.js';

/**
 * ست کردن بج شمارش روی یک عنصر.
 *
 * @param {Element|null} el
 * @param {number} count - صفر یا منفی یعنی «پنهان»
 */
export function setBadge(el, count) {
    if (!el) return;
    const n = Number(count) || 0;
    if (n <= 0) {
        el.textContent = '';
        el.hidden = true;
        el.removeAttribute('data-count');
        return;
    }
    el.textContent = formatNumber(n);
    el.hidden = false;
    el.setAttribute('data-count', String(n));
}

/**
 * پاک کردن بج.
 *
 * @param {Element|null} el
 */
export function clearBadge(el) {
    setBadge(el, 0);
}
