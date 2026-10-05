// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/navigation/header.js -- اسلات‌های هدر Shell (تک‌صفحه)
//
// ⚠️ قرارداد: حداکثر ۳ اسلات (☰ | لوگو/زمینه | 👤)
//    - زمینه = نام فضای فعال یا نام مقصد مشترک (مخاطب/گروه)
//    - 👤 → مودال حساب (منطق موجود در app.js)
//    - زنگ اعلان‌ها حذف شد — اعلان فقط عدد کنار نام در دراور + toast زنده
// ═══════════════════════════════════════════════════════════════════════════

import { events, EV } from '../events.js';
import { t as i18nT } from '../i18n.js';
import { getActiveWorkspace } from './workspace.js';

const CONTEXT_KEYS = {
    tasks: 'nav.tasks',
    search: 'nav.search',
};

function tr(key, fallback) {
    const v = i18nT(key);
    return v !== key ? v : fallback;
}

function contextEl() {
    return document.getElementById('headerContext');
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
 * راه‌اندازی هدر (idempotent).
 *
 * @param {Object} opts
 * @param {() => void} opts.onDrawer - باز کردن دراور
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
