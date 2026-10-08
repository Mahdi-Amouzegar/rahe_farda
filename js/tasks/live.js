// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/tasks/live.js -- موتور زنده‌ی نمای مشترک (polling تنبل، بدون WebSocket)
//
//   - پیام/ویرایش/حذف تازه‌ی مخاطب در مقصد باز → تطبیق لیست + toast
//   - سطر تازه‌ی مخاطب/گروه → تازه‌سازی داده‌ی دراور (+ رندر اگر باز است و فوکوس روی input نیست)
//   - نخوانده‌های گروه هم polling می‌شوند (قبلاً فقط DM بود)
// ⚠️ تشخیص تغییر با (id → updatedAt) است، نه فقط شمارش — ویرایش/حذف هم گرفته می‌شود.
// ⚠️ تنبل (lazy tick) + دوسرعته: تب مخفی = صفر درخواست؛ دراور بسته + مقصد محلی = صفر؛
//    مقصد باز هر ۵ ثانیه فقط گیت شمارش می‌زند؛ داده‌ی دراور هر ~۶۰ ثانیه؛
//    مقصد باز فقط با تغییر شمارش fetch کامل می‌زند (+ هر ۶۰ تیک یک fetch دوره‌ای).
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

/** ضربان تند برای مقصد باز (چت فعال) — فقط گیت شمارش ارزان */
const FAST_MS = 5000;

/** دراور حداکثر هر چند تیک تند تازه شود (۱۲×۵ثانیه = ۶۰ ثانیه) */
const DRAWER_EVERY_TICKS = 12;

/** هر چند تیک، یک fetch کامل دوره‌ای (برای ویرایش/حذف بدون تغییر شمارش) */
const FULL_FETCH_EVERY_TICKS = 60;

let _timer = null;
let _tick = 0;
let _ticking = false;
let _visBound = false;
let _lastUnreadTotal = null;
let _lastRowsKey = '';
let _lastDestKey = '';
let _lastDestCount = -1;

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

/**
 * شمارش نخوانده‌ی یک مقصد (ارزان — برای گیت fetch کامل).
 * @returns {Promise<number|null>} — null یعنی نامشخص (fetch کامل بزن)
 */
export async function destUnreadCount(dest) {
    try {
        if (dest && dest.type === 'peer' && dest.peerId) {
            const u = await getDmUnread();
            if (!u.ok) return null;
            const row = (u.unread.byPeer || []).find((r) => String(r.peerId) === String(dest.peerId));
            updateDrawerBadges({ messages: u.unread.total || 0 });
            return row ? row.count || 0 : 0;
        }
        if (dest && dest.type === 'group' && dest.groupId) {
            const res = await apiFetch('/api/groups/' + encodeURIComponent(dest.groupId) + '/unread');
            if (!res.ok) return null;
            return Number((res.data && res.data.unread && res.data.unread.tasks) || 0);
        }
    } catch { /* silent */ }
    return null;
}

/**
 * تصمیم گیت fetch کامل — خالص و تست‌پذیر.
 */
export function shouldFullFetch(lastKey, lastCount, destKey, count, tickN) {
    if (destKey !== lastKey) return true;
    if (count === null || count !== lastCount) return true;
    if (tickN % FULL_FETCH_EVERY_TICKS === 0) return true;
    return false;
}

async function refreshOpenDestination(dest, opts) {
    const o = opts || {};
    const d = dest || getDestination();
    if (!d || d.type === 'local') return;
    const me = myId();
    // ─── گیت شمارش: بدون تغییر شمارش و بدون force، fetch کامل نمی‌زنیم ───
    if (!o.force) {
        try {
            const n = await destUnreadCount(d);
            const key = d.type + ':' + (d.peerId || d.groupId || '');
            if (!shouldFullFetch(_lastDestKey, _lastDestCount, key, n, _tick)) return;
            if (n !== null) {
                _lastDestKey = key;
                _lastDestCount = n;
            }
        } catch { /* در تردید، fetch کامل */ }
    }
    let fresh = null;
    try {
        if (d.type === 'peer' && d.peerId) {
            const res = await fetchPeerTasks(d.peerId, me, d.name);
            if (res.ok) fresh = res.items;
        } else if (d.type === 'group' && d.groupId) {
            const res = await fetchGroupTasks(d.groupId, me);
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
    const label = d.type === 'group' ? d.name : null;
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

function isPageHidden() {
    try {
        return typeof document !== 'undefined' && document.hidden === true;
    } catch {
        return false;
    }
}

async function isDrawerOpenSafe() {
    try {
        const { isDrawerOpen } = await import('../navigation/sidebar.js');
        return !!isDrawerOpen();
    } catch {
        return false;
    }
}

async function tick() {
    if (_ticking) return;
    if (!isLoggedIn() || !isOnline()) return;
    // ⚠️ تب مخفی = صفر درخواست (صرفه‌جویی باتری/ترافیک؛ با برگشت فوکوس تیک فوری می‌زنیم)
    if (isPageHidden()) return;
    _ticking = true;
    try {
        _tick += 1;
        const dest = getDestination();
        const drawerOpen = await isDrawerOpenSafe();
        if (!drawerOpen && (!dest || dest.type === 'local')) {
            // ⚠️ هیچ مصرف‌کننده‌ای نیست (بج‌ها و سطرها فقط دراورند) — سکوت کامل
            return;
        }
        if (drawerOpen && _tick % DRAWER_EVERY_TICKS === 0) {
            const beforeRows = drawerSnapshot();
            await refreshDrawerData().catch(() => {});
            try {
                const { rerenderDrawer } = await import('../navigation/sidebar.js');
                if (!drawerInputFocused() && drawerSnapshot() !== beforeRows) {
                    rerenderDrawer();
                }
            } catch { /* silent */ }
            if (!dest || dest.type === 'local') return;
        } else if (drawerOpen) {
            if (!dest || dest.type === 'local') return;
        }
        // مقصد مشترک باز است (دراور باز یا بسته): تطبیق با گیت شمارش
        await refreshOpenDestination(dest, {}).catch(() => {});
    } finally {
        _ticking = false;
    }
}

function onVisibleTick() {
    try {
        if (isPageHidden()) return;
        tick().catch(() => {});
    } catch { /* silent */ }
}

export function startLiveEngine() {
    if (_timer) return;
    // ⚠️ ضربان تند ۵ ثانیه‌ای: فقط گیت شمارش مقصد باز می‌زند (ارزان)؛
    //    داده‌ی دراور هر ۱۲ تیک (≈۶۰ ثانیه) تازه می‌شود.
    _timer = setInterval(() => {
        tick().catch(() => {});
    }, FAST_MS);
    if (typeof _timer.unref === 'function') {
        try { _timer.unref(); } catch { /* silent */ }
    }
    // ⚠️ تیک فوری با برگشت به صفحه (تازگی بدون polling تند)
    if (!_visBound && typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        _visBound = true;
        document.addEventListener('visibilitychange', onVisibleTick);
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            window.addEventListener('focus', onVisibleTick);
        }
    }
}

export function stopLiveEngine() {
    if (_timer) {
        clearInterval(_timer);
        _timer = null;
    }
    if (_visBound && typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        _visBound = false;
        document.removeEventListener('visibilitychange', onVisibleTick);
        if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
            window.removeEventListener('focus', onVisibleTick);
        }
    }
    _tick = 0;
    _ticking = false;
    _lastUnreadTotal = null;
    _lastRowsKey = '';
    _lastDestKey = '';
    _lastDestCount = -1;
}

// ⚠️ فقط برای تست
export function __resetLiveForTest() {
    stopLiveEngine();
}
