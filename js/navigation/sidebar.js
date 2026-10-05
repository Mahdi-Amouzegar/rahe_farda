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
import { avatarNode } from '../ui/avatar.js';
import { getActiveWorkspace, switchWorkspace } from './workspace.js';

let _opts = null;
let _opener = null;
let _untrap = null;
let _closeTimer = null;
const _ANIM_MS = 260;
const _badges = { messages: 0, groups: 0, notifications: 0 };
let _recentGroups = [];
let _recentConversations = [];
let _incomingRequests = [];
let _groupInvitations = [];
let _showNewConv = false;
let _showCreateGroup = false;
let _drawerTab = 'contacts';
let _searchQuery = '';
let _searchResults = { users: [], groups: [] };

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
        // ─── دکمه‌های دوقلو: تنظیمات + حساب من (یک خط) ───
        const duo = el('div', 'drawer-duo');
        const settingsTop = el('button', 'drawer-item drawer-duo-btn');
        settingsTop.type = 'button';
        settingsTop.appendChild(el('span', 'drawer-item-label', i18nT('nav.settings') !== 'nav.settings' ? i18nT('nav.settings') : '⚙ تنظیمات'));
        settingsTop.addEventListener('click', () => {
            closeDrawer();
            if (_opts && typeof _opts.onOpenSettings === 'function') _opts.onOpenSettings();
        });
        const accountTop = el('button', 'drawer-item drawer-duo-btn');
        accountTop.type = 'button';
        accountTop.appendChild(el('span', 'drawer-item-label', i18nT('nav.account') !== 'nav.account' ? i18nT('nav.account') : '👤 حساب من'));
        accountTop.addEventListener('click', () => {
            closeDrawer();
            if (_opts && typeof _opts.onOpenAccount === 'function') _opts.onOpenAccount();
        });
        duo.appendChild(settingsTop);
        duo.appendChild(accountTop);
        aside.appendChild(duo);

        aside.appendChild(navButton({ labelKey: 'nav.tasks', fallback: '📋 وظایف من', workspace: 'tasks' }));

        // ─── تب سه‌تایی: مخاطبان / گروه‌ها / جستجو ───
        const tabs = el('div', 'drawer-tabs');
        tabs.setAttribute('role', 'tablist');
        const tabDefs = [
            { id: 'contacts', label: i18nT('nav.contacts') !== 'nav.contacts' ? i18nT('nav.contacts') : 'مخاطبان' },
            { id: 'groups', label: i18nT('nav.recentGroups') !== 'nav.recentGroups' ? i18nT('nav.recentGroups') : 'گروه‌ها' },
            { id: 'search', label: i18nT('nav.search') !== 'nav.search' ? i18nT('nav.search') : '🔎 جستجو' },
        ];
        for (const td of tabDefs) {
            const tb = el('button', 'drawer-tab' + (_drawerTab === td.id ? ' active' : ''));
            tb.type = 'button';
            tb.setAttribute('role', 'tab');
            tb.dataset.dtab = td.id;
            if (_drawerTab === td.id) tb.setAttribute('aria-selected', 'true');
            tb.appendChild(el('span', null, td.label));
            tb.addEventListener('click', () => {
                _drawerTab = td.id;
                rerenderDrawer();
            });
            tabs.appendChild(tb);
        }
        aside.appendChild(tabs);

        if (_drawerTab === 'contacts') renderContactsTab(aside);
        else if (_drawerTab === 'groups') renderGroupsTab(aside);
        else renderSearchTab(aside);
    }

/**
 * تب مخاطبان: اول دکمه گفتگوی تازه، بعد درخواست‌ها، بعد لیست کامل.
 */
function renderContactsTab(aside) {
    const newConvBtn = el('button', 'drawer-item drawer-mini-btn', i18nT('conn.newConversation') !== 'conn.newConversation' ? i18nT('conn.newConversation') : '＋ گفتگوی تازه');
    newConvBtn.type = 'button';
    newConvBtn.addEventListener('click', () => {
        _showNewConv = !_showNewConv;
        rerenderDrawer();
    });
    aside.appendChild(newConvBtn);
    if (_showNewConv) {
        aside.appendChild(buildUserSearchBox());
    }

    for (const r of _incomingRequests.slice(0, 20)) {
        const row = el('div', 'drawer-item drawer-recent');
        row.appendChild(avatarNode(r.avatarUrl, r.name));
        row.appendChild(el('span', 'drawer-item-label', String(r.name || '')));
        const okBtn = el('button', 'conv-mini-btn', i18nT('conn.accept') !== 'conn.accept' ? i18nT('conn.accept') : 'قبول');
        okBtn.type = 'button';
        okBtn.addEventListener('click', async () => {
            okBtn.disabled = true;
            if (_opts && typeof _opts.onAcceptRequest === 'function') await _opts.onAcceptRequest(r.id);
            rerenderDrawer();
        });
        const noBtn = el('button', 'conv-mini-btn', i18nT('conn.reject') !== 'conn.reject' ? i18nT('conn.reject') : 'رد');
        noBtn.type = 'button';
        noBtn.addEventListener('click', async () => {
            noBtn.disabled = true;
            if (_opts && typeof _opts.onRejectRequest === 'function') await _opts.onRejectRequest(r.id);
            rerenderDrawer();
        });
        row.appendChild(okBtn);
        row.appendChild(noBtn);
        aside.appendChild(row);
    }

    for (const r of _recentConversations) {
        const row = el('div', 'drawer-item drawer-recent');
        const b = el('button', 'drawer-item-label-btn');
        b.type = 'button';
        b.appendChild(avatarNode(r.avatarUrl, r.name));
        b.appendChild(el('span', 'drawer-item-label', String(r.name || '')));
        b.addEventListener('click', () => {
            closeDrawer();
            if (_opts && typeof _opts.onOpenConversation === 'function') _opts.onOpenConversation(r.userId, r.name);
        });
        row.appendChild(b);
        const badge = el('span', 'drawer-badge');
        row.appendChild(badge);
        setBadge(badge, r.unread || 0);
        const more = el('button', 'drawer-more', '⋯');
        more.type = 'button';
        more.setAttribute('aria-label', '⋯');
        more.addEventListener('click', (e) => {
            e.stopPropagation();
            if (_opts && typeof _opts.onConversationMenu === 'function') {
                _opts.onConversationMenu(r.userId, more);
            }
        });
        row.appendChild(more);
        aside.appendChild(row);
    }
    if (_recentConversations.length === 0 && _incomingRequests.length === 0) {
        aside.appendChild(el('div', 'drawer-hint', i18nT('workspace.messagesEmpty') !== 'workspace.messagesEmpty' ? i18nT('workspace.messagesEmpty') : 'هنوز گفتگویی نیست.'));
    }
}

/**
 * باکس جستجوی کاربر (برای گفتگوی تازه).
 */
function buildUserSearchBox() {
    const wrap = el('div', 'conv-search');
    const searchInput = el('input', 'conv-input');
    searchInput.setAttribute('placeholder', i18nT('conn.searchPlaceholder') !== 'conn.searchPlaceholder' ? i18nT('conn.searchPlaceholder') : '…');
    searchInput.setAttribute('maxlength', '50');
    searchInput.setAttribute('autocomplete', 'off');
    const results = el('div', 'conv-search-results');
    wrap.appendChild(searchInput);
    wrap.appendChild(results);
    let searchTimer = null;
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(async () => {
            const q = searchInput.value.trim().replace(/^@+/, '');
            results.replaceChildren();
            if (q.length < 3) return;
            if (!_opts || typeof _opts.onSearchUsers !== 'function') return;
            let users = [];
            try {
                users = await _opts.onSearchUsers(q);
            } catch { users = []; }
            for (const u of users || []) {
                const urow = el('div', 'conv-row');
                urow.appendChild(el('span', 'conv-name', String((u && (u.displayName || u.username)) || '')));
                const req = el('button', 'conv-mini-btn', i18nT('conn.request') !== 'conn.request' ? i18nT('conn.request') : 'درخواست');
                req.type = 'button';
                req.addEventListener('click', async () => {
                    req.disabled = true;
                    if (_opts && typeof _opts.onRequestConnection === 'function') {
                        await _opts.onRequestConnection(u.id);
                    }
                    req.textContent = i18nT('conn.requestSent') !== 'conn.requestSent' ? i18nT('conn.requestSent') : 'فرستاده شد';
                });
                urow.appendChild(req);
                results.appendChild(urow);
            }
        }, 350);
    });
    return wrap;
}

/**
 * تب گروه‌ها: اول دکمه افتتاح گروه، بعد دعوت‌ها، بعد لیست کامل.
 */
function renderGroupsTab(aside) {
    const createBtn = el('button', 'drawer-item drawer-mini-btn', i18nT('grp.create') !== 'grp.create' ? i18nT('grp.create') : '＋ افتتاح گروه');
    createBtn.type = 'button';
    createBtn.addEventListener('click', () => {
        _showCreateGroup = !_showCreateGroup;
        rerenderDrawer();
    });
    aside.appendChild(createBtn);
    if (_showCreateGroup) {
        aside.appendChild(buildCreateGroupForm());
    }

    for (const inv of _groupInvitations.slice(0, 20)) {
        const row = el('div', 'drawer-item drawer-recent');
        row.appendChild(avatarNode(null, inv.name));
        row.appendChild(el('span', 'drawer-item-label', String(inv.name || '')));
        const okBtn = el('button', 'conv-mini-btn', i18nT('conn.accept') !== 'conn.accept' ? i18nT('conn.accept') : 'قبول');
        okBtn.type = 'button';
        okBtn.addEventListener('click', async () => {
            okBtn.disabled = true;
            if (_opts && typeof _opts.onRespondGroupInvitation === 'function') {
                await _opts.onRespondGroupInvitation(inv, true);
            }
            rerenderDrawer();
        });
        const noBtn = el('button', 'conv-mini-btn', i18nT('conn.reject') !== 'conn.reject' ? i18nT('conn.reject') : 'رد');
        noBtn.type = 'button';
        noBtn.addEventListener('click', async () => {
            noBtn.disabled = true;
            if (_opts && typeof _opts.onRespondGroupInvitation === 'function') {
                await _opts.onRespondGroupInvitation(inv, false);
            }
            rerenderDrawer();
        });
        row.appendChild(okBtn);
        row.appendChild(noBtn);
        aside.appendChild(row);
    }

    for (const g of _recentGroups) {
        const row = el('div', 'drawer-item drawer-recent');
        const b = el('button', 'drawer-item-label-btn');
        b.type = 'button';
        b.appendChild(avatarNode(g.avatarUrl, g.name));
        b.appendChild(el('span', 'drawer-item-label', String(g.name || '')));
        b.addEventListener('click', () => {
            closeDrawer();
            if (_opts && typeof _opts.onOpenGroup === 'function') _opts.onOpenGroup(g.id, g.name);
        });
        row.appendChild(b);
        const badge = el('span', 'drawer-badge');
        row.appendChild(badge);
        setBadge(badge, g.unread || 0);
        const more = el('button', 'drawer-more', '⋯');
        more.type = 'button';
        more.setAttribute('aria-label', '⋯');
        more.addEventListener('click', (e) => {
            e.stopPropagation();
            if (_opts && typeof _opts.onGroupMenu === 'function') {
                _opts.onGroupMenu(g.id, more);
            }
        });
        row.appendChild(more);
        aside.appendChild(row);
    }
    if (_recentGroups.length === 0 && _groupInvitations.length === 0) {
        aside.appendChild(el('div', 'drawer-hint', i18nT('workspace.groupsEmpty') !== 'workspace.groupsEmpty' ? i18nT('workspace.groupsEmpty') : 'هنوز عضو گروهی نیستی.'));
    }
}

/**
 * تب جستجو: input + نتایج کاربران و گروه‌ها (کلیک → باز شدن).
 */
function renderSearchTab(aside) {
    const wrap = el('div', 'conv-search');
    const searchInput = el('input', 'conv-input');
    searchInput.setAttribute('placeholder', i18nT('workspace.searchEmpty') !== 'workspace.searchEmpty' ? i18nT('workspace.searchEmpty') : 'نام کاربر یا گروه را بنویس.');
    searchInput.setAttribute('maxlength', '50');
    searchInput.setAttribute('autocomplete', 'off');
    searchInput.value = _searchQuery;
    const results = el('div', 'conv-search-results');
    wrap.appendChild(searchInput);
    wrap.appendChild(results);
    aside.appendChild(wrap);
    renderSearchResults(results);
    let searchTimer = null;
    searchInput.addEventListener('input', () => {
        _searchQuery = searchInput.value;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(async () => {
            const q = searchInput.value.trim().replace(/^@+/, '');
            _searchResults = { users: [], groups: [] };
            if (q.length >= 3 && _opts && typeof _opts.onSearchAll === 'function') {
                try {
                    const r = await _opts.onSearchAll(q);
                    if (r) _searchResults = { users: r.users || [], groups: r.groups || [] };
                } catch { /* silent */ }
            }
            const box = aside.querySelector('.conv-search-results');
            if (box) {
                box.replaceChildren();
                renderSearchResults(box);
            }
        }, 350);
    });
    setTimeout(() => {
        try { searchInput.focus(); } catch { /* silent */ }
    }, 60);
}

function renderSearchResults(box) {
    const users = _searchResults.users || [];
    const groups = _searchResults.groups || [];
    if (users.length === 0 && groups.length === 0) return;
    for (const u of users) {
        const row = el('button', 'conv-row');
        row.type = 'button';
        row.appendChild(avatarNode(u.avatarUrl, (u.displayName || u.username)));
        row.appendChild(el('span', 'conv-name', String(u.displayName || u.username || '')));
        row.addEventListener('click', () => {
            closeDrawer();
            if (_opts && typeof _opts.onOpenSearchUser === 'function') _opts.onOpenSearchUser(u);
        });
        box.appendChild(row);
    }
    for (const g of groups) {
        const row = el('button', 'conv-row grp-row');
        row.type = 'button';
        row.appendChild(avatarNode(g.avatarUrl, g.name || '?'));
        row.appendChild(el('span', 'conv-name', String(g.name || '')));
        row.addEventListener('click', () => {
            closeDrawer();
            if (_opts && typeof _opts.onOpenSearchGroup === 'function') _opts.onOpenSearchGroup(g);
        });
        box.appendChild(row);
    }
}

    const sep2 = el('div', 'drawer-sep');
    sep2.setAttribute('aria-hidden', 'true');
    aside.appendChild(sep2);

    applyBadges(aside);
}

/**
 * باز کردن دراور (رندر تازه در هر بازشدن + ورود نرم با کلاس open).
 * بعد از رندر، هوک onDrawerOpened (تازه‌سازی پس‌زمینه‌ی لیست‌ها) صدا زده می‌شود.
 */
export function openDrawer(opener) {
    const root = drawerRoot();
    if (!root) return;
    if (_closeTimer) {
        clearTimeout(_closeTimer);
        _closeTimer = null;
    }
    _opener = opener || document.activeElement || null;
    renderDrawer();
    root.hidden = false;
    // ⚠️ reflow اجباری تا transition از حالت بسته اجرا شود
    void root.offsetWidth;
    root.classList.add('open');
    document.body.classList.add('drawer-open');
    try {
        if (_untrap) _untrap();
        _untrap = trapFocus(drawerEl());
        const first = drawerEl().querySelector('button');
        if (first) first.focus();
    } catch { /* silent */ }
    // تازه‌سازی پس‌زمینه‌ی لیست‌ها (خودترمیمی اگر boot-preload جا مانده باشد)
    try {
        if (_opts && typeof _opts.onDrawerOpened === 'function') {
            const r = _opts.onDrawerOpened();
            if (r && typeof r.catch === 'function') r.catch(() => {});
        }
    } catch { /* silent */ }
}

/**
 * رندر دوباره‌ی دراور اگر باز است (بعد از تازه‌سازی پس‌زمینه).
 */
export function rerenderDrawer() {
    if (isDrawerOpen()) renderDrawer();
}

/**
 * بستن دراور (خروج نرم؛ hidden بعد از پایان انیمیشن ست می‌شود).
 */
export function closeDrawer() {
    const root = drawerRoot();
    if (!root || (root.hidden && !root.classList.contains('open'))) return;
    root.classList.remove('open');
    document.body.classList.remove('drawer-open');
    try {
        if (_untrap) { _untrap(); _untrap = null; }
    } catch { /* silent */ }
    if (_closeTimer) clearTimeout(_closeTimer);
    _closeTimer = setTimeout(() => {
        _closeTimer = null;
        if (!root.classList.contains('open')) root.hidden = true;
    }, _ANIM_MS);
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
 * ست کردن گفتگوهای اخیر (حداکثر ۳ — با عدد نخوانده).
 * ردیف‌ها: { userId, name, avatarUrl, unread }.
 */
export function setRecentConversations(list) {
    _recentConversations = Array.isArray(list) ? list.slice(0, 200) : [];
}

/**
 * ست کردن گروه‌های اخیر (حداکثر ۳ — با عدد نخوانده).
 * ردیف‌ها: { id, name, avatarUrl, unread }.
 */
export function setRecentGroups(list) {
    _recentGroups = Array.isArray(list) ? list.slice(0, 200) : [];
}

/**
 * ست کردن دعوت‌های گروهی: { id, groupId, name }.
 */
export function setGroupInvitations(list) {
    _groupInvitations = Array.isArray(list) ? list.slice(0, 10) : [];
}

/**
 * ست کردن درخواست‌های ورودی دوستی: { id, userId, name, avatarUrl }.
 */
export function setIncomingRequests(list) {
    _incomingRequests = Array.isArray(list) ? list.slice(0, 10) : [];
}

/**
 * فرم جمع‌وجور ساخت گروه داخل دراور (نام + عمومی/خصوصی).
 * ارسال → onCreateGroup({ name, visibility }) → { ok, group? }.
 */
function buildCreateGroupForm() {
    const form = el('div', 'conv-search');
    const input = el('input', 'conv-input');
    input.setAttribute('placeholder', i18nT('grp.createPlaceholder') !== 'grp.createPlaceholder' ? i18nT('grp.createPlaceholder') : 'نام گروه…');
    input.setAttribute('maxlength', '100');
    input.setAttribute('autocomplete', 'off');
    const visRow = el('div', 'conv-vis-row');
    const pubLabel = el('label', 'conv-vis-option');
    const pubRadio = el('input', null);
    pubRadio.type = 'radio';
    pubRadio.name = 'drawer-grp-visibility';
    pubRadio.value = 'public';
    pubLabel.appendChild(pubRadio);
    pubLabel.appendChild(document.createTextNode(i18nT('grp.visibilityPublic') !== 'grp.visibilityPublic' ? i18nT('grp.visibilityPublic') : 'عمومی'));
    const privLabel = el('label', 'conv-vis-option');
    const privRadio = el('input', null);
    privRadio.type = 'radio';
    privRadio.name = 'drawer-grp-visibility';
    privRadio.value = 'private';
    privRadio.checked = true;
    privLabel.appendChild(privRadio);
    privLabel.appendChild(document.createTextNode(i18nT('grp.visibilityPrivate') !== 'grp.visibilityPrivate' ? i18nT('grp.visibilityPrivate') : 'خصوصی'));
    visRow.appendChild(pubLabel);
    visRow.appendChild(privLabel);
    const create = el('button', 'conv-send', i18nT('grp.createGo') !== 'grp.createGo' ? i18nT('grp.createGo') : 'ساخت');
    create.type = 'button';
    const hint = el('div', 'drawer-hint');
    hint.hidden = true;
    create.addEventListener('click', async () => {
        const name = input.value.trim();
        if (!name) {
            hint.textContent = i18nT('grp.createPlaceholder') !== 'grp.createPlaceholder' ? i18nT('grp.createPlaceholder') : 'نام گروه…';
            hint.hidden = false;
            input.focus();
            return;
        }
        if (!_opts || typeof _opts.onCreateGroup !== 'function') {
            console.error('[sidebar] onCreateGroup missing');
            return;
        }
        create.disabled = true;
        hint.hidden = true;
        let res = null;
        try {
            const vis = form.querySelector('input[name="drawer-grp-visibility"]:checked');
            res = await _opts.onCreateGroup({ name, visibility: (vis && vis.value) || 'private' });
        } catch (err) {
            console.error('[sidebar] create group failed:', err);
            res = { ok: false };
        }
        create.disabled = false;
        if (res && res.ok) {
            _showCreateGroup = false;
            closeDrawer();
            const created = (res && (res.group || (res.data && res.data.group))) || null;
            if (created && typeof _opts.onOpenGroup === 'function') {
                _opts.onOpenGroup(created.id, created.name);
            } else {
                rerenderDrawer();
            }
        } else {
            console.error('[sidebar] create group rejected:', res);
            hint.textContent = i18nT('errors.serverError');
            hint.hidden = false;
        }
    });
    form.appendChild(input);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            create.click();
        }
    });
    form.appendChild(visRow);
    form.appendChild(create);
    form.appendChild(hint);
    return form;
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
    if (_closeTimer) {
        clearTimeout(_closeTimer);
        _closeTimer = null;
    }
    _badges.messages = 0;
    _badges.groups = 0;
    _badges.notifications = 0;
    _recentGroups = [];
    _recentConversations = [];
    _incomingRequests = [];
    _groupInvitations = [];
    _showNewConv = false;
    _showCreateGroup = false;
    _drawerTab = 'contacts';
    _searchQuery = '';
    _searchResults = { users: [], groups: [] };
}
