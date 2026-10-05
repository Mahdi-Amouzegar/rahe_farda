// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/communication/connections.js -- چرخه‌ی اتصال و بلاک (Phase 8 — 8.2-B)
//
// ⚠️ فقط data + action (بدون رندر) — رندر در conversations.js است.
// ⚠️ همه‌ی requestها فقط از js/api.js.
// ⚠️ اثر جانبی بلاک (بک‌اند connection فعال را می‌بندد) در همین‌جا مستند و مدیریت می‌شود.
// ═══════════════════════════════════════════════════════════════════════════

import { apiFetch } from '../api.js';
import { state } from '../core.js';
import { t as i18nT } from '../i18n.js';

function myId() {
    try {
        return (state.sync && state.sync.userId) || null;
    } catch {
        return null;
    }
}

/**
 * همه‌ی کانکشن‌ها (pending + accepted).
 */
export async function listConnectionsRaw() {
    const res = await apiFetch('/api/connections');
    if (!res.ok) return res;
    return { ok: true, connections: (res.data && res.data.connections) || [] };
}

/**
 * نقشه‌ی رابطه با کاربران: accepted | pending-in | pending-out.
 * برای اینکه جستجو دکمه‌ی «درخواست» را فقط وقتی نشان بدهد که رابطه‌ای نیست
 * (وگرنه سرور 409 already-connected می‌دهد).
 */
export async function getRelationshipMap() {
    const map = new Map();
    try {
        const res = await listConnectionsRaw();
        if (!res.ok) return map;
        const me = myId();
        for (const c of res.connections || []) {
            if (!c) continue;
            const otherId = String(c.otherUserId || (c.otherUser && c.otherUser.id) || '');
            if (!otherId) continue;
            if (c.status === 'accepted') {
                map.set(otherId, 'accepted');
            } else if (c.status === 'pending' && !map.has(otherId)) {
                map.set(otherId, (!me || c.requestedBy !== me) ? 'pending-in' : 'pending-out');
            }
        }
    } catch { /* best-effort */ }
    return map;
}

/**
 * درخواست‌های ورودی (pending که دیگران فرستاده‌اند).
 */
export async function getIncomingRequests() {
    const res = await listConnectionsRaw();
    if (!res.ok) return res;
    const me = myId();
    return {
        ok: true,
        requests: res.connections.filter(
            (c) => c && c.status === 'pending' && (!me || c.requestedBy !== me)
        ),
    };
}

/**
 * درخواست‌های خروجی من (pending که خودم فرستاده‌ام).
 */
export async function getOutgoingRequests() {
    const res = await listConnectionsRaw();
    if (!res.ok) return res;
    const me = myId();
    return {
        ok: true,
        requests: res.connections.filter(
            (c) => c && c.status === 'pending' && (!me || c.requestedBy === me)
        ),
    };
}

/**
 * ارسال درخواست اتصال.
 */
export async function requestConnection(targetUserId) {
    return apiFetch('/api/connections/request', {
        method: 'POST',
        body: { targetUserId },
    });
}

/**
 * پذیرش درخواست.
 */
export async function acceptConnection(connectionId) {
    return apiFetch('/api/connections/' + encodeURIComponent(connectionId) + '/accept', {
        method: 'POST',
    });
}

/**
 * رد درخواست (hard-delete در بک‌اند).
 */
export async function rejectConnection(connectionId) {
    return apiFetch('/api/connections/' + encodeURIComponent(connectionId) + '/reject', {
        method: 'POST',
    });
}

/**
 * بستن گفتگو (connection موجود → closed).
 */
export async function closeConnection(connectionId) {
    return apiFetch('/api/connections/' + encodeURIComponent(connectionId), {
        method: 'DELETE',
    });
}

/**
 * پیدا کردن کانکشن فعال با یک کاربر (برای بلاک/بستن از داخل گفتگو).
 */
export async function findActiveConnectionWith(userId) {
    const res = await listConnectionsRaw();
    if (!res.ok) return res;
    const conn = res.connections.find(
        (c) =>
            c &&
            (c.status === 'pending' || c.status === 'accepted') &&
            (c.otherUserId === userId || (c.otherUser && c.otherUser.id === userId))
    );
    return { ok: true, connection: conn || null };
}

// ═══════════════════════════════════════════════════════════════════════════
// Blocks
// ═══════════════════════════════════════════════════════════════════════════

/**
 * لیست بلاک‌های من.
 */
export async function listBlocks() {
    const res = await apiFetch('/api/blocks');
    if (!res.ok) return res;
    return { ok: true, blocks: (res.data && res.data.blocks) || [] };
}

/**
 * پیدا کردن بلاک من روی یک کاربر (برای unblock).
 */
export async function findBlockForUserId(userId) {
    const res = await listBlocks();
    if (!res.ok) return res;
    const block = res.blocks.find(
        (b) => b && (b.blockedId === userId || (b.blockedUser && b.blockedUser.id === userId))
    );
    return { ok: true, block: block || null };
}

/**
 * بلاک کردن (بک‌اند connection فعال را هم می‌بندد).
 *
 * @returns {ok, block, connectionClosed}
 */
export async function blockUser(targetUserId) {
    return apiFetch('/api/blocks', {
        method: 'POST',
        body: { targetUserId },
    });
}

/**
 * رفع بلاک.
 */
export async function unblockUser(blockId) {
    return apiFetch('/api/blocks/' + encodeURIComponent(blockId), {
        method: 'DELETE',
    });
}

/**
 * جستجوی کاربر برای شروع گفتگو (username + گروه عمومی).
 */
export async function searchUsers(query) {
    const clean = String(query || '').trim().replace(/^@+/, '');
    const res = await apiFetch(
        '/api/search?q=' + encodeURIComponent(clean) + '&type=user'
    );
    if (!res.ok) return res;
    return { ok: true, users: (res.data && res.data.users) || [] };
}

// ═══════════════════════════════════════════════════════════════════════════
// لیست بلاک‌ها در تنظیمات (تصمیم ۲ کاربر)
// ═══════════════════════════════════════════════════════════════════════════

function blockDisplayName(b) {
    const u = (b && b.blockedUser) || {};
    return u.displayName || u.username || String((b && b.blockedId) || '').slice(0, 8);
}

/**
 * رندر لیست کاربران بلاک‌شده در تنظیمات + دکمه‌ی رفع بلاک.
 * کانتینر: #blockedList (اگر نباشد no-op).
 */
export async function renderBlockedList() {
    const box = document.getElementById('blockedList');
    if (!box) return;
    box.replaceChildren();
    const tr = (key, fallback) => {
        const v = i18nT(key);
        return v !== key ? v : fallback;
    };
    const res = await listBlocks();
    if (!res.ok) {
        const p = document.createElement('p');
        p.className = 'settings-note';
        p.textContent = tr('settings.sections.blocks.loadError', '…');
        box.appendChild(p);
        return;
    }
    if (res.blocks.length === 0) {
        const p = document.createElement('p');
        p.className = 'settings-note';
        p.textContent = tr('settings.sections.blocks.empty', '');
        box.appendChild(p);
        return;
    }
    for (const b of res.blocks) {
        const row = document.createElement('div');
        row.className = 'settings-row';
        const name = document.createElement('span');
        name.textContent = blockDisplayName(b);
        row.appendChild(name);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-small';
        btn.textContent = tr('conn.unblock', 'رفع بلاک');
        btn.addEventListener('click', async () => {
            btn.disabled = true;
            await unblockUser(b.id);
            await renderBlockedList();
        });
        row.appendChild(btn);
        box.appendChild(row);
    }
}
