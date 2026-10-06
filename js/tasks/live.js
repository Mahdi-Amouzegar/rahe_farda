// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/tasks/live.js -- موتور زنده‌ی نمای مشترک (polling سبک، بدون WebSocket)
//
//   - پیام/ویرایش/حذف تازه‌ی مخاطب در مقصد باز → تطبیق لیست + toast
//   - سطر تازه‌ی مخاطب/گروه → تازه‌سازی داده‌ی دراور (+ رندر اگر باز است و فوکوس روی input نیست)
//   - نخوانده‌های گروه هم polling می‌شوند (قبلاً فقط DM بود)
// ⚠️ تشخیص تغییر با (id → updatedAt) است، نه فقط شمارش — ویرایش/حذف هم گرفته می‌شود.
// ═══════════════════════════════════════════════════════════════════════════

import { apiFetch } from '../api.js';
import { state } from '../core.js';
import { t as i18nT } from '../i18n.js';
import { isOnline } from '../net.js';
import { isLoggedIn } from '../auth.js';
import { getDestination } from './destination.js';
import {
    getSharedItems,
    setSharedItems,
    fetchPeerTasks,
    fetchGroupTasks,
} from './source.js';
import { getDmUnread } from '../communication/dm-tasks.js';
import { listConversations, refreshConversationBadges } from '../communication/conversations.js';
import { listGroups, refreshGroupBadges } from '../communication/groups.js';
import { updateDrawerBadges } from '../navigation/sidebar.js';

const LIVE_MS = 20000;

let _timer = null;
let _tick = 0;
let _lastUnreadTotal = null;
let _lastRowsKey = '';

function myId() {
    try {
        return (state.sync && state.sync.userId) || null;
    } catch {
        return null;
    }
}

function showLiveToast(text) {
    try {
        const bar = document.getElementById('photoSnackbar');
        const msgEl = document.getElementById('photoSnackbarMsg');
        if (!bar || !msgEl) return;
        msgEl.textContent = text;
        bar.classList.add('show');
        clearTimeout(showLiveToast._t);
        showLiveToast._t = setTimeout(() => bar.classList.remove('show'), 5000);
    } catch { /* silent */ }
}

function sig(items) {
    return (items || [])
        .map((t) => String(t.id) + '@' + String(t.updatedAt || ''))
        .sort()
        .join('|');
}

function senderOf(item, destName) {
    if (item && item._shared && item._shared.senderName) return item._shared.senderName;
    return destName || '…';
}

/**
 * diff لیست تازه با فعلی: { added, updated, removed } (فقط آیتم دیگران).
 */
export function diffSharedItems(oldItems, newItems) {
    const oldMap = new Map((oldItems || []).map((t) => [String(t.id), t]));
    const newMap = new Map((newItems || []).map((t) => [String(t.id), t]));
    const added = [];
    const updated = [];
    const removed = [];
    for (const [id, t] of newMap) {
        const mine = !!(t._shared && t._shared.mine);
        if (!oldMap.has(id)) {
            if (!mine) added.push(t);
        } else {
            const o = oldMap.get(id);
            if (!mine && String(o.updatedAt || '') !== String(t.updatedAt || '')) {
                updated.push(t);
            }
        }
    }
    for (const [id, t] of oldMap) {
        if (!newMap.has(id) && !(t._shared && t._shared.mine)) {
            removed.push(t);
        }
    }
    return { added, updated, removed };
}

async function refreshOpenDestination() {
    const dest = getDestination();
    if (!dest || dest.type === 'local') return;
    const me = myId();
    let fresh = null;
    try {
        if (dest.type === 'peer' && dest.peerId) {
            const res = await fetchPeerTasks(dest.peerId, me, dest.name);
            if (res.ok) fresh = res.items;
        } else if (dest.type === 'group' && dest.groupId) {
            const res = await fetchGroupTasks(dest.groupId, me);
            if (res.ok) fresh = res.items;
        }
    } catch { /* silent */ }
    if (!fresh) return;
    const current = getSharedItems();
    const { added, updated, removed } = diffSharedItems(current, fresh);
    if (added.length === 0 && updated.length === 0 && removed.length === 0) return;
    let detailOpen = false;
    try {
        detailOpen = !!(state && state.currentDetailId);
    } catch { /* silent */ }
    setSharedItems(fresh);
    if (!detailOpen) {
        const { render, resetRenderSignature } = await import('../ui.js');
        resetRenderSignature();
        render();
    }
    const label = dest.type === 'group' ? dest.name : null;
    for (const t of added) {
        showLiveToast(i18nT('dm.toast', { name: senderOf(t, label) }));
    }
    for (const t of updated) {
        showLiveToast(i18nT('dm.edited', { name: senderOf(t, label) }));
    }
    if (removed.length > 0) {
        showLiveToast(i18nT('dm.deleted'));
    }
}

async function refreshDrawerData() {
    // ⚠️ موازی (نه ۴ await ترتیبی): هر کدام best-effort مستقل‌اند
    await Promise.all([
        listConversations().catch(() => {}),
        listGroups().catch(() => {}),
        refreshConversationBadges().catch(() => {}),
        refreshGroupBadges().catch(() => {}),
    ]);
}

function drawerSnapshot() {
    try {
        const rows = [...document.querySelectorAll('#drawer .drawer-recent')].map((r) => {
            const b = r.querySelector('.drawer-badge');
            return (r.textContent || '') + '|' + (b && !b.hidden ? b.textContent : '');
        });
        return rows.join('~');
    } catch {
        return '';
    }
}

function drawerInputFocused() {
    try {
        const a = document.activeElement;
        return !!(a && a.closest && a.closest('#drawer') && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'));
    } catch {
        return false;
    }
}

async function tick() {
    if (!isLoggedIn() || !isOnline()) return;
    _tick += 1;
    // نخوانده‌های DM (بج + baseline)
    // نخوانده‌های DM (بج دراور) — تشخیص تازه‌ها با diff لیست است، نه شمارش
    try {
        const u = await getDmUnread();
        if (u.ok) {
            updateDrawerBadges({ messages: u.unread.total || 0 });
        }
    } catch { /* silent */ }
    // مقصد باز: تطبیق کامل لیست
    await refreshOpenDestination().catch(() => {});
    // داده‌ی دراور + رندر مشروط: فقط اگر سطرها/بج‌ها عوض شده‌اند و فوکوس روی input نیست
    const beforeRows = drawerSnapshot();
    await refreshDrawerData().catch(() => {});
    try {
        const { isDrawerOpen, rerenderDrawer } = await import('../navigation/sidebar.js');
        if (isDrawerOpen() && !drawerInputFocused()) {
            if (drawerSnapshot() !== beforeRows) {
                rerenderDrawer();
            }
        }
    } catch { /* silent */ }
}

export function startLiveEngine() {
    if (_timer) return;
    _timer = setInterval(() => {
        tick().catch(() => {});
    }, LIVE_MS);
    if (typeof _timer.unref === 'function') {
        try { _timer.unref(); } catch { /* silent */ }
    }
}

export function stopLiveEngine() {
    if (_timer) {
        clearInterval(_timer);
        _timer = null;
    }
    _tick = 0;
    _lastUnreadTotal = null;
    _lastRowsKey = '';
}

// ⚠️ فقط برای تست
export function __resetLiveForTest() {
    stopLiveEngine();
}
