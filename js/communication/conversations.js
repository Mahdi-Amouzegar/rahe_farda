// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/communication/conversations.js -- لیست گفتگو + چت متنی (Phase 8 — 8.2-A)
//
// ⚠️ scope قفل‌شده‌ی 8.2-A:
//   - فقط accepted connections (بدون preview آخرین پیام — بک‌اند ندارد)
//   - unread count + نمای گفتگو + cursor pagination
//   - ارسال/ویرایش/حذف متن (kind=text) + read state
//   - آفلاین → حالت خواندنی نیست/غیرفعال (کش لوکال نداریم)
//   - task/location در 8.2-C ؛ مدیریت connection/block در 8.2-B
//
// ⚠️ همه‌ی requestها فقط از js/api.js (ممنوعیت fetch مستقیم).
// ⚠️ بدون innerHTML — فقط DOM API و textContent.
// ═══════════════════════════════════════════════════════════════════════════

import { apiFetch, apiErrorMessage } from '../api.js';
import { state, escapeHtml } from '../core.js';
import { showInfoModal } from '../core.js';
import { t as i18nT, formatDateTime } from '../i18n.js';
import { isOnline } from '../net.js';
import { isLoggedIn } from '../auth.js';
import { openMenu } from '../ui/menu.js';
import { setBadge } from '../ui/badge.js';
import { avatarNode } from '../ui/avatar.js';
import { updateDrawerBadges, setRecentConversations } from '../navigation/sidebar.js';
import { sideFor, canEdit, taskTitle } from '../tasks/list.js';
import { getDestination } from '../tasks/destination.js';
import { refreshSharedList } from '../tasks/source.js';
import {
    listDmTasks,
    createDmTask,
    updateDmTask,
    deleteDmTask,
    getDmUnread,
    markDmRead,
} from './dm-tasks.js';
import { getCurrentUser } from '../auth.js';
import {
    getIncomingRequests,
    requestConnection,
    acceptConnection,
    rejectConnection,
    closeConnection,
    findActiveConnectionWith,
    blockUser,
    unblockUser,
    findBlockForUserId,
    searchUsers,
} from './connections.js';

let _conversations = [];
let _incoming = [];
let _openWith = null;
let _loading = false;
// ─── Phase 9: thread تسک DM ───
let _dmTasks = [];
let _dmCursor = null;
let _dmHasMore = false;
let _editingTaskId = null;
let _pollTimer = null;
let _lastPollTotal = null;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
}

function tr(key, fallback) {
    const v = i18nT(key);
    return v !== key ? v : fallback;
}

export /**
 * آواتار خودم (از پروفایل session) — برای ردیف‌های خودی.
 */
function myAvatarRef() {
    try {
        const u = getCurrentUser();
        if (!u) return null;
        if (typeof u.avatarUrl === 'string' && u.avatarUrl) return u.avatarUrl;
        if (!u.profile) return null;
        const p = typeof u.profile === 'string' ? JSON.parse(u.profile) : u.profile;
        return (p && typeof p.avatarUrl === 'string' && p.avatarUrl) || null;
    } catch {
        return null;
    }
}

export function displayNameOf(user) {
    if (!user) return '…';
    return user.displayName || user.username || String(user.id || '').slice(0, 8);
}

/**
 * شناسه‌ی خودم (از session) — برای تشخیص پیام‌های خودی.
 */
function myId() {
    try {
        return (state.sync && state.sync.userId) || null;
    } catch {
        return null;
    }
}

function messagesSection() {
    return document.getElementById('ws-messages');
}

// ═══════════════════════════════════════════════════════════════════════════
// Data
// ═══════════════════════════════════════════════════════════════════════════

/**
 * لیست گفتگوها = کانکشن‌های accepted + شمارش نخوانده از cursorهای DM.
 *
 * ⚠️ قدم ۲: به‌جای N فراخوانی /api/messages، یک فراخوانی /api/dm/unread.
 */
export async function listConversations() {
    const res = await apiFetch('/api/connections');
    if (!res.ok) return { ok: false, error: res.error };
    const all = (res.data && res.data.connections) || [];
    const accepted = all.filter((c) => c && c.status === 'accepted');
    let unreadByPeer = new Map();
    try {
        const u = await getDmUnread();
        if (u.ok) {
            for (const row of u.unread.byPeer || []) {
                unreadByPeer.set(String(row.peerId), row.count || 0);
            }
        }
    } catch { /* best-effort: بدون شمارنده */ }
    const conversations = [];
    for (const c of accepted) {
        const other = c.otherUser || { id: c.otherUserId };
        const otherId = String(other.id || c.otherUserId || '');
        conversations.push({
            connectionId: c.id,
            user: {
                id: other.id || c.otherUserId,
                username: other.username || null,
                displayName: other.displayName || null,
                avatarUrl: other.avatarUrl || null,
            },
            unread: unreadByPeer.get(otherId) || 0,
        });
    }
    _conversations = conversations;
    return { ok: true, conversations };
}

// (countUnread حبابی حذف شد — قدم ۳ §۱۳.۱)

// (fetchPage حبابی حذف شد — قدم ۴؛ بکاپ دیگر thread متنی نمی‌خواند)

// (markReceivedRead حبابی حذف شد — قدم ۳ §۱۳.۱؛ خواندن DM از markDmRead است)

// ═══════════════════════════════════════════════════════════════════════════
// Badges
// ═══════════════════════════════════════════════════════════════════════════

/**
 * مجموع نخوانده‌های DM → بج دراور + ردیف‌های اخیر دراور.
 *
 * ⚠️ قدم ۲: منبع شمارنده /api/dm/unread است (نه /api/messages).
 */
export async function refreshConversationBadges() {
    try {
        const u = await getDmUnread();
        const total = u.ok ? (u.unread.total || 0) : 0;
        updateDrawerBadges({ messages: total });
        pushRecentConversations();
        return total;
    } catch {
        updateDrawerBadges({ messages: 0 });
        return 0;
    }
}

/**
 * ردیف‌های اخیر دراور (حداکثر ۳، مثل گروه‌های اخیر).
 * خود نام → باز کردن گفتگو؛ ⋯ کنار نام → منوی همان سطح.
 */
export function pushRecentConversations() {
    try {
        const rows = (_conversations || []).slice(0, 10).map((c) => ({
            userId: String((c.user && c.user.id) || ''),
            name: displayNameOf(c.user),
            avatarUrl: (c.user && c.user.avatarUrl) || null,
            unread: c.unread || 0,
        })).filter((r) => r.userId);
        rows.sort((a, b) => (b.unread || 0) - (a.unread || 0));
        setRecentConversations(rows.slice(0, 3));
    } catch { /* best-effort */ }
}

// ═══════════════════════════════════════════════════════════════════════════
// View — list
// ═══════════════════════════════════════════════════════════════════════════

function renderListState(state) {
    const sec = messagesSection();
    if (!sec) return;
    sec.replaceChildren();
    sec.appendChild(el('h2', null, tr('workspace.messagesTitle', '💬 پیام‌ها')));

    if (state === 'offline') {
        sec.appendChild(el('p', null, tr('msg.offline', 'آفلاین هستی — برای پیام‌ها وصل شو.')));
        return;
    }
    if (state === 'error') {
        sec.appendChild(el('p', null, tr('errors.serverError', 'خطا')));
        return;
    }
    if (_conversations.length === 0 && _incoming.length === 0) {
        sec.appendChild(el('p', null, tr('workspace.messagesEmpty', '')));
    }

    if (_incoming.length > 0) {
        sec.appendChild(el('div', 'conv-section', tr('conn.incoming', 'درخواست‌های ورودی')));
        for (const r of _incoming) {
            const other = r.otherUser || { id: r.otherUserId };
            const row = el('div', 'conv-row conv-request');
            row.appendChild(avatarNode(other.avatarUrl, displayNameOf(other)));
            row.appendChild(el('span', 'conv-name', displayNameOf(other)));
            const okBtn = el('button', 'conv-mini-btn', tr('conn.accept', 'قبول'));
            okBtn.type = 'button';
            okBtn.addEventListener('click', async () => {
                await acceptConnection(r.id);
                await reloadMessagesHome();
            });
            const noBtn = el('button', 'conv-mini-btn', tr('conn.reject', 'رد'));
            noBtn.type = 'button';
            noBtn.addEventListener('click', async () => {
                await rejectConnection(r.id);
                await reloadMessagesHome();
            });
            row.appendChild(okBtn);
            row.appendChild(noBtn);
            sec.appendChild(row);
        }
    }

    // ─── شروع گفتگوی تازه (جستجو + درخواست) ───
    const newBox = el('div', 'conv-new');
    const newBtn = el('button', 'conv-mini-btn', tr('conn.newConversation', '＋ گفتگوی تازه'));
    newBtn.type = 'button';
    const searchWrap = el('div', 'conv-search');
    searchWrap.hidden = true;
    const searchInput = el('input', 'conv-input');
    searchInput.setAttribute('placeholder', tr('conn.searchPlaceholder', '…'));
    searchInput.setAttribute('maxlength', '50');
    searchInput.setAttribute('autocomplete', 'off');
    const results = el('div', 'conv-search-results');
    searchWrap.appendChild(searchInput);
    searchWrap.appendChild(results);
    let searchTimer = null;
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(async () => {
            const q = searchInput.value.trim();
            results.replaceChildren();
            if (q.length < 3) return;
            const res = await searchUsers(q);
            if (!res.ok) return;
            for (const u of res.users) {
                const row = el('div', 'conv-row');
                row.appendChild(el('span', 'conv-name', displayNameOf(u)));
                const req = el('button', 'conv-mini-btn', tr('conn.request', 'درخواست'));
                req.type = 'button';
                req.addEventListener('click', async () => {
                    const r = await requestConnection(u.id);
                    req.disabled = true;
                    req.textContent = r.ok
                        ? tr('conn.requestSent', 'فرستاده شد')
                        : apiErrorMessage(r.error);
                });
                row.appendChild(req);
                results.appendChild(row);
            }
        }, 350);
    });
    newBtn.addEventListener('click', () => {
        searchWrap.hidden = !searchWrap.hidden;
        if (!searchWrap.hidden) searchInput.focus();
    });
    newBox.appendChild(newBtn);
    newBox.appendChild(searchWrap);
    sec.appendChild(newBox);

    const list = el('div', 'conv-list');
    list.setAttribute('role', 'list');
        for (const c of _conversations) {
        const row = el('button', 'conv-row');
        row.type = 'button';
        row.setAttribute('role', 'listitem');
        row.appendChild(avatarNode(c.user.avatarUrl, displayNameOf(c.user)));
        const mid = el('span', 'conv-main');
        mid.appendChild(el('span', 'conv-name', displayNameOf(c.user)));
        row.appendChild(mid);
        const badge = el('span', 'drawer-badge');
        row.appendChild(badge);
        setBadge(badge, c.unread || 0);
        row.addEventListener('click', () => openConversation(c.user.id));
        list.appendChild(row);
    }
    sec.appendChild(list);
}

/**
 * ورود به فضای پیام‌ها (رندر لیست + درخواست‌ها + بج).
 */
export async function openMessagesWorkspace() {
    _openWith = null;
    renderListState('loading');
    const sec = messagesSection();
    if (sec) sec.appendChild(el('p', null, '…'));
    if (!isOnline()) {
        renderListState('offline');
        return;
    }
    await reloadMessagesHome();
}

/**
 * بارگذاری دوباره‌ی خانه‌ی پیام‌ها (لیست + درخواست‌های ورودی + بج).
 */
export async function reloadMessagesHome() {
    const [convRes, incRes] = await Promise.all([listConversations(), getIncomingRequests()]);
    if (!convRes.ok) {
        renderListState('error');
        return;
    }
    _incoming = incRes.ok ? incRes.requests : [];
    renderListState('list');
    const total = convRes.conversations.reduce((s, c) => s + (c.unread || 0), 0);
    updateDrawerBadges({ messages: total });
    pushRecentConversations();
}

// ═══════════════════════════════════════════════════════════════════════════
// View — thread
// ═══════════════════════════════════════════════════════════════════════════

function userIdOfThread() {
    return _openWith;
}

/**
 * منوی ⋯ گفتگو: پروفایل / بلاک-رفع‌بلاک / بستن گفتگو.
 */
async function openConversationMenu(otherUserId, anchor) {
    if (!otherUserId) return;
    const blockRes = await findBlockForUserId(otherUserId);
    const blocked = blockRes.ok && !!blockRes.block;
    const items = [
        { id: 'profile', label: tr('conn.profile', 'پروفایل') },
        blocked
            ? { id: 'unblock', label: tr('conn.unblock', 'رفع بلاک') }
            : { id: 'block', label: tr('conn.block', 'بلاک'), danger: true },
        { id: 'close', label: tr('conn.closeChat', 'بستن گفتگو'), danger: true },
    ];
    openMenu({
        anchor,
        items,
        onSelect: async (id) => {
            if (id === 'profile') showUserProfile(otherUserId);
            else if (id === 'block') {
                await blockUser(otherUserId);
                _openWith = null;
                await reloadMessagesHome();
            } else if (id === 'unblock' && blocked) {
                await unblockUser(blockRes.block.id);
            } else if (id === 'close') {
                const connRes = await findActiveConnectionWith(otherUserId);
                if (connRes.ok && connRes.connection) {
                    await closeConnection(connRes.connection.id);
                }
                _openWith = null;
                await reloadMessagesHome();
            }
        },
    });
}

/**
 * پروفایل کاربر (فقط خواندنی، escapeشده).
 */
function showUserProfile(otherUserId) {
    const conv = _conversations.find((c) => c.user.id === otherUserId);
    const user = conv ? conv.user : { id: otherUserId };
    showInfoModal({
        title: tr('conn.profile', 'پروفایل'),
        paragraphs: [
            escapeHtml(displayNameOf(user)),
            user.username ? escapeHtml('@' + user.username) : null,
        ].filter(Boolean),
    });
}

/**
 * thread گفتگو روی تسک‌های DM (Phase 9 قدم ۲ — جایگزین حباب متنی).
 *
 * ساختار: سطر عنوان (برگشت + نام + ⋯) + لیست دوحالته + کامپوزر تسک.
 * ویرایش/حذف فقط تسک خودی (مثل شخصی — §۶.۲).
 */
function renderThread() {
    const sec = messagesSection();
    if (!sec) return;
    const conv = _conversations.find((c) => String(c.user.id) === String(_openWith));
    const name = conv ? displayNameOf(conv.user) : '…';
    sec.replaceChildren();

    const head = el('div', 'conv-head');
    const back = el('button', 'conv-back', tr('msg.back', '‹ بازگشت'));
    back.type = 'button';
    back.addEventListener('click', () => {
        _openWith = null;
        _editingTaskId = null;
        openMessagesWorkspace();
    });
    head.appendChild(back);
    head.appendChild(el('span', 'conv-title', name));
    const convoMenu = el('button', 'conv-menu-btn', '⋯');
    convoMenu.type = 'button';
    convoMenu.setAttribute('aria-label', tr('msg.moreAria', 'گزینه‌ها'));
    convoMenu.addEventListener('click', () => openConversationMenu(userIdOfThread(), convoMenu));
    head.appendChild(convoMenu);
    sec.appendChild(head);

    const box = el('div', 'conv-box');
    box.id = 'convBox';
    const me = myId();
    // API نزولی برمی‌گرداند → قدیمی‌تر اول
    for (const t of [..._dmTasks].reverse()) {
        box.appendChild(dmTaskNode(t, me, conv));
    }
    if (_dmTasks.length === 0) {
        box.appendChild(el('p', null, tr('dm.empty', 'تسکی نیست.')));
    }
    sec.appendChild(box);

    if (_dmHasMore) {
        const more = el('button', 'conv-more', tr('msg.loadMore', 'قدیمی‌ترها'));
        more.type = 'button';
        more.addEventListener('click', () => loadMoreDm());
        sec.appendChild(more);
    }

    const composer = el('div', 'conv-composer');
    const input = el('input', 'conv-input');
    input.id = 'dmTaskInput';
    input.setAttribute('placeholder', tr('dm.taskPlaceholder', 'تسک تازه…'));
    input.setAttribute('maxlength', '500');
    input.setAttribute('autocomplete', 'off');
    const send = el('button', 'conv-send', tr('msg.send', '➤'));
    send.type = 'button';
    const doSend = () => submitDmTask();
    send.addEventListener('click', doSend);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            doSend();
        }
    });
    if (!isOnline()) {
        input.disabled = true;
        send.disabled = true;
    }
    composer.appendChild(input);
    composer.appendChild(send);
    sec.appendChild(composer);

    box.scrollTop = box.scrollHeight;
}

/**
 * یک ردیف تسک DM: سمت خودی/مخاطب + آواتار + عنوان + ⋯ خودی.
 */
function dmTaskNode(t, me, conv) {
    const mine = sideFor(t, me) === 'self';
    const wrap = el('div', 'msg msg-task' + (mine ? ' msg-mine' : ' msg-other'));
    const otherUser = conv ? conv.user : null;
    const ref = mine ? myAvatarRef() : (otherUser && otherUser.avatarUrl) || null;
    const who = mine ? displayNameOf(null) : displayNameOf(otherUser);
    const av = avatarNode(ref, who === '…' ? '?' : who);
    av.classList.add('msg-avatar');
    wrap.appendChild(av);
    const content = el('div', 'msg-content');
    content.appendChild(el('div', 'msg-body', taskTitle(t)));
    const meta = el('div', 'msg-meta');
    try {
        const edited = t.updatedAt && t.createdAt && t.updatedAt !== t.createdAt;
        meta.textContent = formatDateTime(t.createdAt) + (edited ? ' • ' + tr('msg.edited', 'ویرایش‌شده') : '');
    } catch {
        meta.textContent = '';
    }
    content.appendChild(meta);
    wrap.appendChild(content);
    if (mine && canEdit(t, me)) {
        const more = el('button', 'msg-more', '⋯');
        more.type = 'button';
        more.setAttribute('aria-label', tr('msg.moreAria', 'گزینه‌ها'));
        more.addEventListener('click', (e) => {
            e.stopPropagation();
            openMenu({
                anchor: more,
                items: [
                    { id: 'edit', label: tr('msg.edit', 'ویرایش') },
                    { id: 'delete', label: tr('msg.delete', 'حذف'), danger: true },
                ],
                onSelect: (id) => {
                    if (id === 'edit') startDmEdit(t);
                    else if (id === 'delete') removeDmTask(t.id);
                },
            });
        });
        wrap.appendChild(more);
    }
    return wrap;
}

function startDmEdit(t) {
    const input = document.getElementById('dmTaskInput');
    if (!input) return;
    _editingTaskId = t.id;
    input.value = taskTitle(t) === '…' ? '' : taskTitle(t);
    input.focus();
}

/**
 * ارسال کامپوزر: ساخت تسک تازه یا ثبت ویرایش.
 */
export async function submitDmTask() {
    const input = document.getElementById('dmTaskInput');
    if (!input || _loading || !_openWith) return;
    const title = input.value.trim().slice(0, 500);
    if (!title) return;
    _loading = true;
    let res;
    try {
        if (_editingTaskId) {
            res = await updateDmTask(_editingTaskId, title);
        } else {
            res = await createDmTask(_openWith, title);
        }
    } finally {
        _loading = false;
    }
    if (!res.ok) {
        input.setAttribute('aria-invalid', 'true');
        input.title = apiErrorMessage(res.error);
        return;
    }
    input.value = '';
    input.removeAttribute('aria-invalid');
    input.removeAttribute('title');
    _editingTaskId = null;
    await openConversation(_openWith);
}

export async function removeDmTask(taskId) {
    const res = await deleteDmTask(taskId);
    if (!res.ok) return false;
    _dmTasks = _dmTasks.filter((t) => t.id !== taskId);
    renderThread();
    return true;
}

/**
 * باز کردن گفتگو روی تسک‌های DM + ثبت خواندن + تازه‌سازی بج.
 */
export async function openConversation(userId) {
    _openWith = userId;
    _dmTasks = [];
    _dmCursor = null;
    _dmHasMore = false;
    _editingTaskId = null;
    renderThread();
    if (!isOnline()) return;
    _loading = true;
    let res;
    try {
        res = await listDmTasks(userId, null);
    } finally {
        _loading = false;
    }
    if (!res.ok) return;
    _dmTasks = res.tasks || [];
    _dmCursor = res.nextCursor || null;
    _dmHasMore = !!res.hasMore;
    renderThread();
    try {
        await markDmRead(userId);
        await refreshConversationBadges();
    } catch { /* best-effort */ }
}

export async function loadMoreDm() {
    if (!_openWith || !_dmHasMore || _loading || !_dmCursor) return;
    _loading = true;
    let res;
    try {
        res = await listDmTasks(_openWith, _dmCursor);
    } finally {
        _loading = false;
    }
    if (!res.ok) return;
    _dmTasks = _dmTasks.concat(res.tasks || []);
    _dmCursor = res.nextCursor || null;
    _dmHasMore = !!res.hasMore;
    renderThread();
}

// ═══════════════════════════════════════════════════════════════════════════
// thread قدیمی حبابی حذف شد (قدم ۳ — §۱۳.۱؛ بکاپ قدم ۴ دیگر thread متنی نمی‌خواند).
// ═══════════════════════════════════════════════════════════════════════════

/**
 * منوی ⋯ یک مخاطب برای استفاده‌ی دراور (همان منوی سطر عنوان).
 */
export function openConversationMenuFor(otherUserId, anchor) {
    return openConversationMenu(otherUserId, anchor);
}

// ═══════════════════════════════════════════════════════════════════════════
// Toast زنده‌ی DM (Phase 9 قدم ۲ — §۱۳.۲)
//
// polling سبک /api/dm/unread (بدون WebSocket). با بیشتر شدن total نسبت به
// baseline، یک toast درون‌برنامه‌ای + تازه‌سازی بج. یادآورهای زمانی تسک‌ها
// در موتور reminder موجود می‌مانند (دست‌نخورده).
// ═══════════════════════════════════════════════════════════════════════════

const POLL_MS = 20000;
let _toastTimer = null;

function showDmToast(text) {
    try {
        const bar = document.getElementById('photoSnackbar');
        const msgEl = document.getElementById('photoSnackbarMsg');
        if (!bar || !msgEl) return;
        msgEl.textContent = text;
        bar.classList.add('show');
        clearTimeout(_toastTimer);
        _toastTimer = setTimeout(() => bar.classList.remove('show'), 5000);
    } catch { /* silent */ }
}

function nameOfPeer(peerId) {
    const conv = (_conversations || []).find((c) => String(c.user && c.user.id) === String(peerId));
    return conv ? displayNameOf(conv.user) : String(peerId).slice(0, 8);
}

async function pollDmOnce() {
    if (!isLoggedIn()) return;
    if (!isOnline()) return;
    let u;
    try {
        u = await getDmUnread();
    } catch {
        return;
    }
    if (!u.ok) return;
    const total = u.unread.total || 0;
    if (_lastPollTotal === null) {
        _lastPollTotal = total;
        updateDrawerBadges({ messages: total });
        return;
    }
    if (total > _lastPollTotal) {
        const top = (u.unread.byPeer || []).slice().sort((a, b) => (b.count || 0) - (a.count || 0))[0];
        const who = top ? nameOfPeer(top.peerId) : '…';
        showDmToast(i18nT('dm.toast', { name: who }));
        try {
            const res = await listConversations();
            if (res.ok) pushRecentConversations();
        } catch { /* best-effort */ }
        // اگر مخاطب همین گفتگو باز است، لیست صفحه را هم تازه کن
        try {
            const dest = getDestination();
            if (dest.type === 'peer' && top && String(top.peerId) === String(dest.peerId)) {
                await refreshSharedList();
                const { render } = await import('../ui.js');
                render();
            }
        } catch { /* best-effort */ }
    }
    _lastPollTotal = total;
    updateDrawerBadges({ messages: total });
}

/**
 * شروع polling (idempotent؛ بعد از boot صدا زده می‌شود).
 */
export function startDmPoll() {
    if (_pollTimer) return;
    _pollTimer = setInterval(() => {
        pollDmOnce().catch(() => {});
    }, POLL_MS);
    if (typeof _pollTimer.unref === 'function') {
        try { _pollTimer.unref(); } catch { /* silent */ }
    }
}

export function stopDmPoll() {
    if (_pollTimer) {
        clearInterval(_pollTimer);
        _pollTimer = null;
    }
    _lastPollTotal = null;
}

// ⚠️ فقط برای تست
export function __resetConversationsForTest() {
    _conversations = [];
    _incoming = [];
    _openWith = null;
    _loading = false;
    _dmTasks = [];
    _dmCursor = null;
    _dmHasMore = false;
    _editingTaskId = null;
    stopDmPoll();
}
export function __getStateForTest() {
    return { conversations: _conversations, openWith: _openWith, dmTasks: _dmTasks };
}
