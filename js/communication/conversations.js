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
import { state } from '../core.js';
import { t as i18nT, formatDateTime } from '../i18n.js';
import { isOnline } from '../net.js';
import { openMenu } from '../ui/menu.js';
import { setBadge } from '../ui/badge.js';
import { updateDrawerBadges } from '../navigation/sidebar.js';

const PAGE_LIMIT = 30;

let _conversations = [];
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

function displayNameOf(user) {
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
    if (_conversations.length === 0) {
        sec.appendChild(el('p', null, tr('workspace.messagesEmpty', '')));
        return;
    }

    const list = el('div', 'conv-list');
    list.setAttribute('role', 'list');
    for (const c of _conversations) {
        const row = el('button', 'conv-row');
        row.type = 'button';
        row.setAttribute('role', 'listitem');
        const avatar = el('span', 'conv-avatar', (displayNameOf(c.user) || '?').trim().charAt(0) || '?');
        avatar.setAttribute('aria-hidden', 'true');
        row.appendChild(avatar);
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
 * ورود به فضای پیام‌ها (رندر لیست + بج).
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
    const res = await listConversations();
    if (!res.ok) {
        renderListState('error');
        return;
    }
    renderListState('list');
    const total = res.conversations.reduce((s, c) => s + (c.unread || 0), 0);
    updateDrawerBadges({ messages: total });
}

// ═══════════════════════════════════════════════════════════════════════════
// View — thread
// ═══════════════════════════════════════════════════════════════════════════

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
    const send = el('button', 'conv-send', tr('msg.send', '➤'));
    send.type = 'button';
    const doSend = () => sendCurrentText();
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

function messageNode(m) {
    const mine = !!m.mine;
    const wrap = el('div', 'msg' + (mine ? ' msg-mine' : ''));
    const body = el('div', 'msg-body', m.body || '');
    wrap.appendChild(body);
    const meta = el('div', 'msg-meta');
    try {
        meta.textContent = formatDateTime(m.createdAt) + (m.editedAt ? ' • ' + tr('msg.edited', 'ویرایش‌شده') : '');
    } catch {
        meta.textContent = '';
    }
    wrap.appendChild(meta);
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
    _openWith = null;
    _messages = [];
    _cursor = null;
    _hasMore = false;
    _loading = false;
}
export function __getStateForTest() {
    return { conversations: _conversations, openWith: _openWith, messages: _messages };
}
