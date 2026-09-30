// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/navigation/header.js -- اسلات‌های هدر Shell (Phase 8 — T4)
//
// ⚠️ قرارداد UI-SHELL §۲.۱: حداکثر ۵ اسلات
//    fa: ☰ | لوگو/زمینه | سینک | 🔔 | 👤 (موبایل: همان ساختار فشرده)
//    - زمینه = نام فضای فعال (به‌روزرسانی با WORKSPACE_CHANGED + تعویض زبان)
//    - 🔔 → فضای اعلان‌ها (بج از setNotifBadge؛ داده‌ی واقعی در 8-2/8-3)
//    - 👤 → مودال حساب (منطق موجود در app.js)
//    - چرخ‌دنده حذف شده؛ تنظیمات فقط در دراور
// ═══════════════════════════════════════════════════════════════════════════

import { events, EV } from '../events.js';
import { t as i18nT } from '../i18n.js';
import { setBadge } from '../ui/badge.js';
import { getActiveWorkspace } from './workspace.js';

const CONTEXT_KEYS = {
    tasks: 'nav.tasks',
    messages: 'nav.messages',
    groups: 'nav.groups',
    search: 'nav.search',
    notifications: 'nav.notifications',
};

function tr(key, fallback) {
    const v = i18nT(key);
    return v !== key ? v : fallback;
}

function contextEl() {
    return document.getElementById('headerContext');
}

function notifBadge() {
    return document.getElementById('notifBellBadge');
}

/**
 * به‌روزرسانی متن زمینه‌ی هدر (نام فضای فعال).
 */
export function refreshHeaderContext() {
    const el = contextEl();
    if (!el) return;
    const ws = getActiveWorkspace();
    el.textContent = tr(CONTEXT_KEYS[ws] || 'nav.tasks', '');
}

/**
 * ست کردن بج اعلان‌های هدر.
 */
export function setNotifBadge(count) {
    setBadge(notifBadge(), count);
}

/**
 * راه‌اندازی هدر (idempotent).
 *
 * @param {Object} opts
 * @param {() => void} opts.onDrawer - باز کردن دراور
 * @param {() => void} opts.onBell - رفتن به فضای اعلان‌ها
 * @param {() => void} opts.onAccount - باز کردن مودال حساب
 */
export function initHeader(opts) {
    const o = opts || {};
    const drawerBtn = document.getElementById('drawerBtn');
    if (drawerBtn && !drawerBtn.dataset.bound) {
        drawerBtn.dataset.bound = '1';
        drawerBtn.addEventListener('click', (e) => {
            if (typeof o.onDrawer === 'function') o.onDrawer(e.currentTarget);
        });
    }
    const bell = document.getElementById('notifBell');
    if (bell && !bell.dataset.bound) {
        bell.dataset.bound = '1';
        bell.addEventListener('click', () => {
            if (typeof o.onBell === 'function') o.onBell();
        });
    }
    const account = document.getElementById('accountBtn');
    if (account && !account.dataset.bound) {
        account.dataset.bound = '1';
        account.addEventListener('click', () => {
            if (typeof o.onAccount === 'function') o.onAccount();
        });
    }
    if (!initHeader._subscribed) {
        initHeader._subscribed = true;
        events.on(EV.WORKSPACE_CHANGED, () => refreshHeaderContext());
    }
    refreshHeaderContext();
}
