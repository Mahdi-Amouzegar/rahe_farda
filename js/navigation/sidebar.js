// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/navigation/sidebar.js -- دراور ناوبری (Phase 8 — T3)
//
// ⚠️ قرارداد UI-SHELL §۲.۲:
//   - دراور (اورلی)، نه ستون دائمی — در همه‌ی عرض‌ها
//   - جهت بازشدن با logical CSS (fa از راست، en از چپ) — بخش ۴ قرارداد
//   - مهمان: فقط «وظایف من» + ورود + تنظیمات محدود (بخش ۵ قرارداد)
//   - ورودکرده: جستجو + ۴ فضای ارتباطی (با بج) + حداکثر ۳ گروه اخیر + تنظیمات/حساب
//   - رندر تازه در هر بازشدن (زبان و بج همیشه به‌روز؛ بدون state کهنه)
//   - هیچ innerHTML — فقط DOM API و textContent
// ═══════════════════════════════════════════════════════════════════════════

import { trapFocus } from '../core.js';
import { t as i18nT } from '../i18n.js';
import { isLoggedIn } from '../auth.js';
import { setBadge } from '../ui/badge.js';
import { getActiveWorkspace, switchWorkspace } from './workspace.js';

let _opts = null;
let _opener = null;
let _untrap = null;
const _badges = { messages: 0, groups: 0, notifications: 0 };
let _recentGroups = [];

function drawerRoot() {
    return document.getElementById('drawerRoot');
}

function drawerEl() {
    return document.getElementById('drawer');
}

/**
 * آیا دراور باز است؟
 */
export function isDrawerOpen() {
    const root = drawerRoot();
    return !!root && !root.hidden;
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
}

function navButton({ labelKey, fallback, badgeKey, workspace }) {
    const btn = el('button', 'drawer-item');
    btn.type = 'button';
    btn.dataset.workspace = workspace;
    if (workspace === getActiveWorkspace()) {
        btn.classList.add('active');
        btn.setAttribute('aria-current', 'page');
    }
    btn.appendChild(el('span', 'drawer-item-label', i18nT(labelKey) !== labelKey ? i18nT(labelKey) : fallback));
    const badge = el('span', 'drawer-badge');
    badge.hidden = true;
    btn.appendChild(badge);
    if (badgeKey) {
        btn.dataset.badge = badgeKey;
    }
    btn.addEventListener('click', () => {
        closeDrawer();
        if (_opts && typeof _opts.onNavigate === 'function') {
            _opts.onNavigate(workspace);
        } else {
            switchWorkspace(workspace);
        }
    });
    return btn;
}

function applyBadges(scope) {
    const root = scope || drawerEl();
    if (!root) return;
    for (const btn of root.querySelectorAll('[data-badge]')) {
        const key = btn.getAttribute('data-badge');
        const badge = btn.querySelector('.drawer-badge');
        setBadge(badge, _badges[key] || 0);
    }
}

function renderDrawer() {
    const aside = drawerEl();
    if (!aside) return;
    aside.replaceChildren();

    const loggedIn = isLoggedIn();

    const title = el('div', 'drawer-title', i18nT('nav.drawerTitle') !== 'nav.drawerTitle' ? i18nT('nav.drawerTitle') : 'راه فردا');
    title.id = 'drawerTitle';
    aside.setAttribute('aria-label', title.textContent);
    aside.appendChild(title);

    if (!loggedIn) {
        // ─── حالت مهمان: فقط tasks + ورود + تنظیمات ───
        aside.appendChild(navButton({ labelKey: 'nav.tasks', fallback: '📋 وظایف من', workspace: 'tasks' }));
        const sep = el('div', 'drawer-sep');
        sep.setAttribute('aria-hidden', 'true');
        aside.appendChild(sep);
        const login = el('button', 'drawer-item drawer-login');
        login.type = 'button';
        login.appendChild(el('span', 'drawer-item-label', i18nT('nav.login') !== 'nav.login' ? i18nT('nav.login') : '🔐 ورود / ساخت حساب'));
        login.addEventListener('click', () => {
            closeDrawer();
            if (_opts && typeof _opts.onLogin === 'function') _opts.onLogin();
        });
        aside.appendChild(login);
        aside.appendChild(el('div', 'drawer-hint', i18nT('nav.loginHint') !== 'nav.loginHint' ? i18nT('nav.loginHint') : ''));
    } else {
        // ─── حالت ورودکرده ───
        const searchBtn = el('button', 'drawer-item drawer-search');
        searchBtn.type = 'button';
        searchBtn.dataset.workspace = 'search';
        searchBtn.appendChild(el('span', 'drawer-item-label', i18nT('nav.search') !== 'nav.search' ? i18nT('nav.search') : '🔎 جستجو'));
        searchBtn.addEventListener('click', () => {
            closeDrawer();
            if (_opts && typeof _opts.onNavigate === 'function') _opts.onNavigate('search');
            else switchWorkspace('search');
        });
        aside.appendChild(searchBtn);

        aside.appendChild(navButton({ labelKey: 'nav.tasks', fallback: '📋 وظایف من', workspace: 'tasks' }));
        aside.appendChild(navButton({ labelKey: 'nav.messages', fallback: '💬 پیام‌ها', workspace: 'messages', badgeKey: 'messages' }));
        aside.appendChild(navButton({ labelKey: 'nav.groups', fallback: '👥 گروه‌ها', workspace: 'groups', badgeKey: 'groups' }));
        aside.appendChild(navButton({ labelKey: 'nav.notifications', fallback: '🔔 اعلان‌ها', workspace: 'notifications', badgeKey: 'notifications' }));

        if (_recentGroups.length > 0) {
            aside.appendChild(el('div', 'drawer-section', i18nT('nav.recentGroups') !== 'nav.recentGroups' ? i18nT('nav.recentGroups') : 'گروه‌های اخیر'));
            for (const g of _recentGroups.slice(0, 3)) {
                const b = el('button', 'drawer-item drawer-recent');
                b.type = 'button';
                b.appendChild(el('span', 'drawer-item-label', '👥 ' + String(g.name || '')));
                b.addEventListener('click', () => {
                    closeDrawer();
                    if (_opts && typeof _opts.onOpenGroup === 'function') _opts.onOpenGroup(g.id);
                    else switchWorkspace('groups');
                });
                aside.appendChild(b);
            }
        }
    }

    const sep2 = el('div', 'drawer-sep');
    sep2.setAttribute('aria-hidden', 'true');
    aside.appendChild(sep2);

    const settings = el('button', 'drawer-item');
    settings.type = 'button';
    settings.appendChild(el('span', 'drawer-item-label', i18nT('nav.settings') !== 'nav.settings' ? i18nT('nav.settings') : '⚙ تنظیمات'));
    settings.addEventListener('click', () => {
        closeDrawer();
        if (_opts && typeof _opts.onOpenSettings === 'function') _opts.onOpenSettings();
    });
    aside.appendChild(settings);

    if (loggedIn) {
        const account = el('button', 'drawer-item');
        account.type = 'button';
        account.appendChild(el('span', 'drawer-item-label', i18nT('nav.account') !== 'nav.account' ? i18nT('nav.account') : '👤 حساب من'));
        account.addEventListener('click', () => {
            closeDrawer();
            if (_opts && typeof _opts.onOpenAccount === 'function') _opts.onOpenAccount();
        });
        aside.appendChild(account);
    }

    applyBadges(aside);
}

/**
 * باز کردن دراور (رندر تازه در هر بازشدن).
 */
export function openDrawer(opener) {
    const root = drawerRoot();
    if (!root) return;
    _opener = opener || document.activeElement || null;
    renderDrawer();
    root.hidden = false;
    document.body.classList.add('drawer-open');
    try {
        if (_untrap) _untrap();
        _untrap = trapFocus(drawerEl());
        const first = drawerEl().querySelector('button');
        if (first) first.focus();
    } catch { /* silent */ }
}

/**
 * بستن دراور.
 */
export function closeDrawer() {
    const root = drawerRoot();
    if (!root || root.hidden) return;
    root.hidden = true;
    document.body.classList.remove('drawer-open');
    try {
        if (_untrap) { _untrap(); _untrap = null; }
    } catch { /* silent */ }
    if (_opener && document.contains(_opener) && typeof _opener.focus === 'function') {
        try { _opener.focus(); } catch { /* silent */ }
    }
    _opener = null;
}

/**
 * به‌روزرسانی بج‌ها (در بازشدن بعدی + اگر باز است بلافاصله اعمال می‌شود).
 */
export function updateDrawerBadges({ messages, groups, notifications }) {
    if (typeof messages === 'number') _badges.messages = messages;
    if (typeof groups === 'number') _badges.groups = groups;
    if (typeof notifications === 'number') _badges.notifications = notifications;
    if (isDrawerOpen()) applyBadges();
}

/**
 * ست کردن گروه‌های اخیر (حداکثر ۳ نمایش داده می‌شود).
 */
export function setRecentGroups(list) {
    _recentGroups = Array.isArray(list) ? list.slice(0, 10) : [];
}

/**
 * راه‌اندازی (idempotent).
 */
export function initSidebar(opts) {
    _opts = opts || {};
    const root = drawerRoot();
    if (!root) return;
    const scrim = document.getElementById('drawerScrim');
    if (scrim && !scrim.dataset.bound) {
        scrim.dataset.bound = '1';
        scrim.addEventListener('click', () => closeDrawer());
    }
    if (!root.dataset.bound) {
        root.dataset.bound = '1';
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && isDrawerOpen()) closeDrawer();
        });
    }
}

// ⚠️ فقط برای تست
export function __resetSidebarForTest() {
    _opts = null;
    _opener = null;
    _untrap = null;
    _badges.messages = 0;
    _badges.groups = 0;
    _badges.notifications = 0;
    _recentGroups = [];
}
