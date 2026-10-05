// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/communication/conversations.js -- لایه‌ی داده‌ی مخاطبان (تک‌صفحه)
//
//   - لیست گفتگوها (accepted + نخوانده) برای دراور
//   - درخواست‌های ورودی برای دراور
//   - منوی ⋯ مخاطب (پروفایل/بلاک/بستن)
//   - toast زنده + polling نخوانده‌ها
//   - displayNameOf مشترک (search/groups هم استفاده می‌کنند)
// ⚠️ نمای لیست/گفتگوی قدیمی حذف شد — صفحه اصلی تنها میزبان است.
// ⚠️ همه‌ی requestها فقط از js/api.js (ممنوعیت fetch مستقیم).
// ⚠️ بدون innerHTML — فقط DOM API و textContent.
// ═══════════════════════════════════════════════════════════════════════════

import { apiFetch } from '../api.js';
import { state, escapeHtml } from '../core.js';
import { showInfoModal } from '../core.js';
import { t as i18nT } from '../i18n.js';
import { isOnline } from '../net.js';
import { isLoggedIn } from '../auth.js';
import { openMenu } from '../ui/menu.js';
import { updateDrawerBadges, setRecentConversations } from '../navigation/sidebar.js';
import { getDestination } from '../tasks/destination.js';
import { refreshSharedList } from '../tasks/source.js';
import { getDmUnread } from './dm-tasks.js';
import {
    getIncomingRequests,
    closeConnection,
    findActiveConnectionWith,
    blockUser,
    unblockUser,
    findBlockForUserId,
} from './connections.js';

let _conversations = [];
let _loading = false;
let _pollTimer = null;
let _lastPollTotal = null;

function tr(key, fallback) {
    const v = i18nT(key);
    return v !== key ? v : fallback;
}

export function displayNameOf(user) {
    if (!user) return '…';
    return user.displayName || user.username || String(user.id || '').slice(0, 8);
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
    // ⚠️ موازی: لیست کانکشن‌ها و شمارنده‌ها مستقل‌اند
    const [res, u] = await Promise.all([
        apiFetch('/api/connections'),
        getDmUnread().catch(() => ({ ok: false })),
    ]);
    if (!res.ok) return { ok: false, error: res.error };
    const all = (res.data && res.data.connections) || [];
    const accepted = all.filter((c) => c && c.status === 'accepted');
    const unreadByPeer = new Map();
    try {
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
// ─── درخواست‌های ورودی دوستی (برای زیربخش مخاطبان دراور) ───
// (نمای لیست/گفتگوی قدیمی حذف شد — تک‌صفحه)

import { setIncomingRequests } from '../navigation/sidebar.js';

/**
 * بارگذاری درخواست‌های ورودی + ست در دراور.
 */
export async function refreshIncomingRequests() {
    try {
        const res = await getIncomingRequests();
        const rows = ((res.ok && res.requests) || []).map((r) => {
            const other = r.otherUser || { id: r.otherUserId };
            return {
                id: r.id,
                userId: String(other.id || r.otherUserId || ''),
                name: displayNameOf(other),
                avatarUrl: other.avatarUrl || null,
            };
        }).filter((r) => r.userId);
        setIncomingRequests(rows);
        return rows;
    } catch {
        return [];
    }
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
                await listConversations();
                await refreshConversationBadges();
            } else if (id === 'unblock' && blocked) {
                await unblockUser(blockRes.block.id);
                await listConversations();
                await refreshConversationBadges();
            } else if (id === 'close') {
                const connRes = await findActiveConnectionWith(otherUserId);
                if (connRes.ok && connRes.connection) {
                    await closeConnection(connRes.connection.id);
                }
                await listConversations();
                await refreshConversationBadges();
            }
        },
    });
}

/**
 * پروفایل کاربر (فقط خواندنی، escapeشده).
 */
function showUserProfile(otherUserId) {
    const conv = _conversations.find((c) => String(c.user.id) === String(otherUserId));
    const user = conv ? conv.user : { id: otherUserId };
    showInfoModal({
        title: tr('conn.profile', 'پروفایل'),
        paragraphs: [
            escapeHtml(displayNameOf(user)),
            user.username ? escapeHtml('@' + user.username) : null,
        ].filter(Boolean),
    });
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
        // اگر مخاطب همین گفتگو باز است و جزئیات باز نیست، لیست صفحه را هم تازه کن
        try {
            const dest = getDestination();
            if (dest.type === 'peer' && top && String(top.peerId) === String(dest.peerId)) {
                let detailOpen = false;
                try {
                    detailOpen = !!(state && state.currentDetailId);
                } catch { /* silent */ }
                if (!detailOpen) {
                    await refreshSharedList();
                    const { render } = await import('../ui.js');
                    render();
                }
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
    _loading = false;
    stopDmPoll();
}
export function __getStateForTest() {
    return { conversations: _conversations };
}
