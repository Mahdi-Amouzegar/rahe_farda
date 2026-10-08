// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/account-delete.js -- فلوی فرانت حذف حساب (Phase 13 زیرگام ۱)
//
// ⚠️ منطق API و تصمیم‌گیری اینجا، رندر مودال در app.js.
//    wipe محلی: logout + پاک‌سازی IDB + رندر خالی (داده‌ی حساب پاک‌شده نباید بماند).
// ═══════════════════════════════════════════════════════════════════════════

import { apiFetch } from './api.js';
import { t as i18nT } from './i18n.js';

// ═══════════════════════════════════════════════════════════════════════════
// نشست‌ها (لیست + باطل کردن — فقط ورود تلگرامی)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * خواندن نشست‌های فعال خودم.
 */
export async function fetchAccountSessions() {
    return apiFetch('/api/sessions');
}

/**
 * باطل کردن یک نشست (غیر از جاری — سرور هم گیت دارد).
 */
export async function revokeAccountSession(sessionId) {
    return apiFetch('/api/sessions/' + encodeURIComponent(sessionId), { method: 'DELETE' });
}

/**
 * تجزیه‌ی سبک user-agent → {browser, os, mobile} (خالص، تست‌پذیر).
 * ⚠️ فقط برای نمایش است؛ مرجع امنیتی نیست.
 */
export function parseUserAgent(ua) {
    const s = String(ua || '');
    let browser = null;
    if (/Edg\//i.test(s)) browser = 'Edge';
    else if (/OPR\/|Opera/i.test(s)) browser = 'Opera';
    else if (/SamsungBrowser/i.test(s)) browser = 'Samsung';
    else if (/Chrome\//i.test(s)) browser = 'Chrome';
    else if (/Firefox\//i.test(s)) browser = 'Firefox';
    else if (/Safari\//i.test(s)) browser = 'Safari';
    let os = null;
    if (/Android/i.test(s)) os = 'Android';
    else if (/iPhone|iPad|iPod/i.test(s)) os = 'iOS';
    else if (/Windows/i.test(s)) os = 'Windows';
    else if (/Mac OS X/i.test(s)) os = 'macOS';
    else if (/Linux/i.test(s)) os = 'Linux';
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(s);
    return { browser, os, mobile };
}

/**
 * برچسب روش ورود نشست.
 */
export function sessionMethodLabel(method) {
    if (method === 'telegram') return i18nT('auth.sessions.methodTelegram');
    if (method === 'sync-code') return i18nT('auth.sessions.methodSyncCode');
    return i18nT('auth.sessions.methodUnknown');
}

/**
 * آیا دکمه‌ی revoke برای این ورود نشان داده شود؟
 * فقط ورود تلگرامی (قدیمیِ بدون method هم، مثل سرور، مجاز).
 */
export function canRevokeSessions(myMethod) {
    return myMethod !== 'sync-code';
}

/**
 * خلاصه‌ی preview از سرور.
 */
export async function fetchDeletionPreview() {
    return apiFetch('/api/users/me/deletion-preview');
}

/**
 * درخواست حذف نهایی (برگشت‌ناپذیر).
 */
export async function requestAccountDeletion() {
    return apiFetch('/api/users/me', { method: 'DELETE' });
}

/**
 * متن‌های مودال تأیید از روی شمارش‌ها (خالص، تست‌پذیر).
 * @returns {{ canDelete: boolean, title: string, lines: string[] }}
 */
export function buildDeleteConfirm(data) {
    const d = data || {};
    const groups = Array.isArray(d.ownedGroups) ? d.ownedGroups : [];
    if (groups.length > 0) {
        return {
            canDelete: false,
            title: i18nT('accountDelete.blockedTitle'),
            lines: [
                i18nT('accountDelete.blockedMessage'),
                ...groups.map(g => '👥 ' + (g.name || g.id)),
            ],
        };
    }
    return {
        canDelete: true,
        title: i18nT('accountDelete.confirmTitle'),
        lines: [
            i18nT('accountDelete.confirmMessage'),
            i18nT('accountDelete.confirmCounts', {
                personal: d.personalTasks ?? 0,
                dm: d.dmCreated ?? 0,
                group: d.groupCreated ?? 0,
                media: d.mediaObjects ?? 0,
            }),
        ],
    };
}

/**
 * پاک‌سازی محلی بعد از حذف موفق در سرور.
 * deps قابل تزریق برای تست.
 */
export async function performLocalWipeout(deps) {
    const d = deps || {};
    const doLogout = d.doLogout || (async () => {
        const auth = await import('./auth.js');
        auth.logout();
    });
    const wipeStore = d.wipeStore || (async () => {
        const store = await import('./store.js');
        await store.wipeLocalAccountData();
    });
    const rerender = d.rerender || (async () => {
        const ui = await import('./ui.js');
        if (typeof ui.resetRenderSignature === 'function') ui.resetRenderSignature();
        if (typeof ui.render === 'function') ui.render();
    });
    await doLogout();
    try {
        await wipeStore();
    } catch (err) {
        console.warn('[account-delete] local wipe failed:', err);
    }
    try {
        await rerender();
    } catch (err) {
        console.warn('[account-delete] rerender failed:', err);
    }
}
