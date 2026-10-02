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
import { state, escapeHtml, uid } from '../core.js';
import { showInfoModal } from '../core.js';
import { sanitizeTask, saveTask } from '../store.js';
import { t as i18nT, formatDateTime } from '../i18n.js';
import { isOnline } from '../net.js';
import { openMenu } from '../ui/menu.js';
import { setBadge } from '../ui/badge.js';
import { avatarNode } from '../ui/avatar.js';
import { updateDrawerBadges } from '../navigation/sidebar.js';
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

const PAGE_LIMIT = 30;

let _conversations = [];
let _incoming = [];
let _openWith = null;
let _messages = [];
let _cursor = null;
let _hasMore = false;
let _loading = false;

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
 * آواتار خودم (از پروفایل session) — برای حباب‌های خودی.
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

function isMine(m, otherUserId) {
    const me = myId();
    if (me) return m.senderId === me;
    return m.senderId !== otherUserId;
}

function messagesSection() {
    return document.getElementById('ws-messages');
}

// ═══════════════════════════════════════════════════════════════════════════
// Data
// ═══════════════════════════════════════════════════════════════════════════

/**
 * لیست گفتگوها = کانکشن‌های accepted + شمارش نخوانده.
 */
export async function listConversations() {
    const res = await apiFetch('/api/connections');
    if (!res.ok) return { ok: false, error: res.error };
    const all = (res.data && res.data.connections) || [];
    const accepted = all.filter((c) => c && c.status === 'accepted');
    const conversations = [];
    for (const c of accepted) {
        const other = c.otherUser || { id: c.otherUserId };
        const unread = await countUnread(other.id);
        conversations.push({
            connectionId: c.id,
            user: {
                id: other.id || c.otherUserId,
                username: other.username || null,
                displayName: other.displayName || null,
                avatarUrl: other.avatarUrl || null,
            },
            unread,
        });
    }
    _conversations = conversations;
    return { ok: true, conversations };
}

async function countUnread(otherUserId) {
    try {
        const res = await apiFetch(
            '/api/messages?with=' + encodeURIComponent(otherUserId) + '&limit=50'
        );
        if (!res.ok) return 0;
        return ((res.data && res.data.messages) || []).filter(
            (m) => m && !m.readAt && !isMine(m, otherUserId)
        ).length;
    } catch {
        return 0;
    }
}

async function fetchPage(otherUserId, cursor) {
    let path = '/api/messages?with=' + encodeURIComponent(otherUserId) + '&limit=' + PAGE_LIMIT;
    if (cursor) path += '&before=' + encodeURIComponent(cursor);
    return apiFetch(path);
}

async function markReceivedRead(messages) {
    for (const m of messages) {
        if (!m || !m.id) continue;
        try {
            await apiFetch('/api/messages/' + encodeURIComponent(m.id) + '/read', { method: 'PATCH' });
        } catch { /* best-effort */ }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Badges
// ═══════════════════════════════════════════════════════════════════════════

/**
 * مجموع نخوانده‌ها → بج دراور.
 */
export async function refreshConversationBadges() {
    const res = await listConversations();
    if (!res.ok) {
        updateDrawerBadges({ messages: 0 });
        return 0;
    }
    const total = res.conversations.reduce((s, c) => s + (c.unread || 0), 0);
    updateDrawerBadges({ messages: total });
    return total;
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

function renderThread() {
    const sec = messagesSection();
    if (!sec) return;
    const conv = _conversations.find((c) => c.user.id === _openWith);
    const name = conv ? displayNameOf(conv.user) : '…';
    sec.replaceChildren();

    const head = el('div', 'conv-head');
    const back = el('button', 'conv-back', tr('msg.back', '‹ بازگشت'));
    back.type = 'button';
    back.addEventListener('click', () => {
        _openWith = null;
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
    // پیام‌ها قدیمی‌تر اول (API نزولی برمی‌گرداند)
    for (const m of [..._messages].reverse()) {
        box.appendChild(messageNode(m));
    }
    sec.appendChild(box);

    if (_hasMore) {
        const more = el('button', 'conv-more', tr('msg.loadMore', 'پیام‌های قدیمی‌تر'));
        more.type = 'button';
        more.addEventListener('click', () => loadMoreConversation());
        sec.appendChild(more);
    }

    const composer = el('div', 'conv-composer');
    const input = el('input', 'conv-input');
    input.id = 'convInput';
    input.setAttribute('placeholder', tr('msg.placeholder', '…'));
    input.setAttribute('maxlength', '2000');
    input.setAttribute('autocomplete', 'off');
    const locBtn = el('button', 'conv-loc', '📍');
    locBtn.type = 'button';
    locBtn.setAttribute('aria-label', tr('loc.sendCurrent', 'ارسال موقعیت فعلی'));
    locBtn.title = tr('loc.sendCurrent', 'ارسال موقعیت فعلی');
    const send = el('button', 'conv-send', tr('msg.send', '➤'));
    send.type = 'button';
    const doSend = () => sendCurrentText();
    send.addEventListener('click', doSend);
    locBtn.addEventListener('click', () => sendCurrentLocation(locBtn));
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            doSend();
        }
    });
    if (!isOnline()) {
        input.disabled = true;
        send.disabled = true;
        locBtn.disabled = true;
    }
    composer.appendChild(input);
    composer.appendChild(locBtn);
    composer.appendChild(send);
    sec.appendChild(composer);

    box.scrollTop = box.scrollHeight;
    initLocationPreviews(box);
}

function messageNode(m) {
    const mine = !!m.mine;
    const wrap = el('div', 'msg' + (mine ? ' msg-mine' : ''));
    // آواتار فرستنده (تصمیم F): مخاطب از کانکشن، خودم از session
    const conv = _conversations.find((c) => c.user.id === _openWith);
    const ref = mine ? myAvatarRef() : (conv && conv.user.avatarUrl) || null;
    const who = mine
        ? displayNameOf(null)
        : displayNameOf(conv ? conv.user : null);
    const av = avatarNode(ref, who === '…' ? '?' : who);
    av.classList.add('msg-avatar');
    wrap.appendChild(av);
    const content = el('div', 'msg-content');
    content.appendChild(messageBodyNode(m));
    const meta = el('div', 'msg-meta');
    try {
        meta.textContent = formatDateTime(m.createdAt) + (m.editedAt ? ' • ' + tr('msg.edited', 'ویرایش‌شده') : '');
    } catch {
        meta.textContent = '';
    }
    content.appendChild(meta);
    wrap.appendChild(content);
    if (mine && m.kind === 'text') {
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
                    if (id === 'edit') startEditMessage(m.id, m.body);
                    else if (id === 'delete') deleteMessage(m.id);
                },
            });
        });
        wrap.appendChild(more);
    }
    return wrap;
}

/**
 * بدنه‌ی پیام (حباب متن / کارت تسک / کارت مکان) — بدون اکشن.
 * ⚠️ برای reuse در تایم‌لاین گروه export شده (8.3-A).
 */
export function messageBodyNode(m) {
    if (m.kind === 'task') return taskCardNode(m);
    if (m.kind === 'location') return locationCardNode(m);
    return el('div', 'msg-body', (m && m.body) || '');
}

function parseTaskMeta(m) {
    try {
        const meta = typeof m.metadata === 'string' ? JSON.parse(m.metadata) : m.metadata;
        if (!meta || typeof meta !== 'object') return null;
        const snap = typeof meta.snapshot === 'string' ? JSON.parse(meta.snapshot) : meta.snapshot;
        if (!snap || typeof snap !== 'object') return null;
        return { snapshot: snap, sourceTaskId: meta.source_task_id || null };
    } catch {
        return null;
    }
}

function taskCardNode(m) {
    const card = el('div', 'msg-task-card');
    const parsed = parseTaskMeta(m);
    if (!parsed) {
        card.appendChild(el('div', 'msg-body', m.body || ''));
        card.appendChild(el('div', 'msg-meta', tr('plan.invalidSnapshot', 'این تسک قابل افزودن نیست.')));
        return card;
    }
    const snap = parsed.snapshot;
    const title = String(snap.text || snap.title || m.body || '').slice(0, 200) || '…';
    card.appendChild(el('div', 'msg-task-title', '📋 ' + title));
    if (snap.dueAt || snap.at) {
        try {
            card.appendChild(el('div', 'msg-task-sub', formatDateTime(snap.dueAt || snap.at)));
        } catch { /* silent */ }
    }
    const add = el('button', 'msg-task-add', tr('plan.add', 'افزودن به برنامه'));
    add.type = 'button';
    add.addEventListener('click', () => addSharedTaskToPlan(parsed.snapshot, add));
    card.appendChild(add);
    return card;
}

async function addSharedTaskToPlan(snapshot, btn) {
    try {
        const clean = sanitizeTask({
            id: uid(),
            text: String((snapshot && (snapshot.text || snapshot.title)) || '').slice(0, 200),
            kind: 'task',
            completed: false,
            dueAt: snapshot && typeof snapshot.dueAt === 'string' ? snapshot.dueAt : null,
        });
        if (!clean.text || clean.text.trim() === '') {
            showInfoModal({ title: tr('plan.add', 'افزودن به برنامه'), paragraphs: [tr('plan.invalidSnapshot', 'x')] });
            return;
        }
        await saveTask(clean);
        if (btn) {
            btn.disabled = true;
            btn.textContent = tr('plan.added', 'به برنامه اضافه شد.');
        }
        showInfoModal({ title: tr('plan.add', 'افزودن به برنامه'), paragraphs: [tr('plan.added', 'ok')] });
    } catch {
        showInfoModal({ title: tr('plan.add', 'افزودن به برنامه'), paragraphs: [tr('plan.invalidSnapshot', 'x')] });
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 8.2-C: پیام مکان (preview + مودال)
// ═══════════════════════════════════════════════════════════════════════════

let _previewMaps = [];

function cleanupPreviewMaps() {
    for (const mm of _previewMaps) {
        try {
            if (mm && typeof mm.remove === 'function') mm.remove();
        } catch { /* silent */ }
    }
    _previewMaps = [];
}

function parseLocationMeta(m) {
    try {
        const meta = typeof m.metadata === 'string' ? JSON.parse(m.metadata) : m.metadata;
        if (!meta || typeof meta !== 'object') return null;
        const lat = Number(meta.lat);
        const lng = Number(meta.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
        return { lat, lng, name: typeof meta.name === 'string' ? meta.name : '' };
    } catch {
        return null;
    }
}

function locationCardNode(m) {
    const card = el('div', 'msg-loc-card');
    const loc = parseLocationMeta(m);
    const label = (loc && loc.name) || m.body || '';
    if (label) card.appendChild(el('div', 'msg-loc-name', '📍 ' + label));
    if (loc) {
        const preview = el('div', 'loc-preview');
        preview.dataset.lat = String(loc.lat);
        preview.dataset.lng = String(loc.lng);
        card.appendChild(preview);
        const route = el('button', 'msg-loc-route', tr('loc.route', 'نمایش مسیر'));
        route.type = 'button';
        route.addEventListener('click', () => openMapModal(loc));
        card.appendChild(route);
    } else {
        card.appendChild(el('div', 'msg-body', m.body || ''));
    }
    return card;
}

/**
 * ساخت previewهای نقشه بعد از رندر (بدون L → فقط placeholder می‌ماند).
 */
export function initLocationPreviews(box) {
    cleanupPreviewMaps();
    if (typeof window === 'undefined' || typeof window.L === 'undefined') return;
    const L = window.L;
    for (const pv of box.querySelectorAll('.loc-preview')) {
        const lat = Number(pv.dataset.lat);
        const lng = Number(pv.dataset.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        try {
            const mm = L.map(pv, {
                zoomControl: false,
                dragging: false,
                scrollWheelZoom: false,
                doubleClickZoom: false,
                boxZoom: false,
                keyboard: false,
                attributionControl: false,
            }).setView([lat, lng], 14);
            L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(mm);
            L.marker([lat, lng]).addTo(mm);
            _previewMaps.push(mm);
        } catch { /* silent */ }
    }
}

/**
 * مودال نقشه‌ی تعاملی برای یک مکان.
 */
export function openMapModal(loc) {
    closeMapModal();
    const overlay = el('div', 'picker-overlay loc-modal-overlay');
    overlay.id = 'locModalOverlay';
    const box = el('div', 'picker loc-modal-box');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.appendChild(el('div', 'picker-title', tr('loc.mapTitle', 'نقشه')));
    const mapDiv = el('div', 'loc-modal-map');
    box.appendChild(mapDiv);
    const close = el('button', 'btn-clear', tr('msg.back', '‹ بازگشت'));
    close.type = 'button';
    close.addEventListener('click', () => closeMapModal());
    box.appendChild(close);
    overlay.appendChild(box);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeMapModal();
    });
    document.body.appendChild(overlay);
    if (typeof window !== 'undefined' && typeof window.L !== 'undefined' && loc) {
        try {
            const mm = window.L.map(mapDiv).setView([loc.lat, loc.lng], 15);
            window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(mm);
            window.L.marker([loc.lat, loc.lng]).addTo(mm);
            _previewMaps.push(mm);
            setTimeout(() => {
                try { mm.invalidateSize(); } catch { /* silent */ }
            }, 60);
        } catch { /* silent */ }
    }
}

export function closeMapModal() {
    const old = document.getElementById('locModalOverlay');
    if (old && old.parentNode) old.parentNode.removeChild(old);
}

/**
 * ارسال موقعیت فعلی (geolocation) به‌عنوان پیام مکان.
 */
export async function sendCurrentLocation(btn) {
    if (!navigator.geolocation) {
        if (btn) btn.title = tr('loc.unavailable', 'موقعیت در دسترس نیست.');
        return;
    }
    if (btn) {
        btn.disabled = true;
        btn.title = tr('loc.locating', 'در حال مکان‌یابی…');
    }
    const pos = await new Promise((resolve) => {
        try {
            navigator.geolocation.getCurrentPosition(
                (p) => resolve(p),
                () => resolve(null),
                { timeout: 10000, maximumAge: 60000 }
            );
        } catch {
            resolve(null);
        }
    });
    if (btn) {
        btn.disabled = false;
        btn.title = tr('loc.sendCurrent', 'ارسال موقعیت فعلی');
    }
    if (!pos || !pos.coords) return;
    const { latitude, longitude } = pos.coords;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    _loading = true;
    const res = await apiFetch('/api/messages', {
        method: 'POST',
        body: {
            recipientId: _openWith,
            body: latitude.toFixed(5) + ',' + longitude.toFixed(5),
            kind: 'location',
            metadata: { lat: latitude, lng: longitude },
        },
    });
    _loading = false;
    if (!res.ok) return;
    await openConversation(_openWith);
}

export async function openConversation(userId) {
    _openWith = userId;
    _messages = [];
    _cursor = null;
    _hasMore = false;
    renderThread();
    if (!isOnline()) return;
    _loading = true;
    const res = await fetchPage(userId, null);
    _loading = false;
    if (!res.ok) return;
    _messages = ((res.data && res.data.messages) || []).map((m) => ({
        ...m,
        mine: isMine(m, userId),
    }));
    _cursor = res.data.nextCursor || null;
    _hasMore = !!res.data.hasMore;
    renderThread();
    const received = _messages.filter((m) => !m.mine && !m.readAt);
    if (received.length > 0) {
        await markReceivedRead(received);
        refreshConversationBadges();
    }
}

export async function loadMoreConversation() {
    if (!_openWith || !_hasMore || _loading || !_cursor) return;
    _loading = true;
    const res = await fetchPage(_openWith, _cursor);
    _loading = false;
    if (!res.ok) return;
    const more = ((res.data && res.data.messages) || []).map((m) => ({
        ...m,
        mine: isMine(m, _openWith),
    }));
    _messages = _messages.concat(more);
    _cursor = res.data.nextCursor || null;
    _hasMore = !!res.data.hasMore;
    renderThread();
}

export async function sendCurrentText() {
    const input = document.getElementById('convInput');
    if (!input || _loading || !_openWith) return;
    const body = input.value.trim();
    if (!body) return;
    // حالت ویرایش؟ (startEditMessage ست می‌کند)
    if (input.dataset.editingId) {
        await submitEdit(input.dataset.editingId, body);
        delete input.dataset.editingId;
        return;
    }
    _loading = true;
    const res = await apiFetch('/api/messages', {
        method: 'POST',
        body: { recipientId: _openWith, body, kind: 'text' },
    });
    _loading = false;
    if (!res.ok) {
        // ⚠️ خطا را در همان کامپوزر نشان بده (بدون alert)
        input.setAttribute('aria-invalid', 'true');
        input.title = apiErrorMessage(res.error);
        return;
    }
    input.value = '';
    await openConversation(_openWith);
}

export async function deleteMessage(messageId) {
    const res = await apiFetch('/api/messages/' + encodeURIComponent(messageId), { method: 'DELETE' });
    if (!res.ok) return false;
    _messages = _messages.filter((m) => m.id !== messageId);
    renderThread();
    return true;
}

async function startEditMessage(messageId, oldBody) {
    const input = document.getElementById('convInput');
    if (!input) return;
    input.value = oldBody || '';
    input.dataset.editingId = messageId;
    input.focus();
}

export async function submitEdit(messageId, body) {
    const res = await apiFetch('/api/messages/' + encodeURIComponent(messageId), {
        method: 'PATCH',
        body: { body },
    });
    if (!res.ok) return res;
    await openConversation(_openWith);
    return res;
}

// ⚠️ فقط برای تست
export function __resetConversationsForTest() {
    _conversations = [];
    _incoming = [];
    _openWith = null;
    _messages = [];
    _cursor = null;
    _hasMore = false;
    _loading = false;
}
export function __getStateForTest() {
    return { conversations: _conversations, openWith: _openWith, messages: _messages };
}
