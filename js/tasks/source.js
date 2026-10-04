// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/tasks/source.js -- خواندن + نرمال‌سازی تسک‌های مقصد مشترک
//
// ⚠️ خروجی همیشه به شکل تسک محلی است (همان کارت/فیلتر/مرتب‌سازی کار می‌کند):
//   { ...payload, id, _shared: { mine, dest, remoteId, senderName } }
// ⚠️ آیتم دیگران read-only است (گیت در dispatcher اپ).
// ═══════════════════════════════════════════════════════════════════════════

import { apiFetch } from '../api.js';
import { state } from '../core.js';
import { events, EV } from '../events.js';
import { listDmTasks, updateDmTask, deleteDmTask } from '../communication/dm-tasks.js';
import { enqueueGroupOp, flushGroup } from '../communication/group-queue.js';
import { getDestination } from './destination.js';

function parsePayload(raw) {
    if (!raw) return null;
    try {
        const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return p && typeof p === 'object' ? p : null;
    } catch {
        return null;
    }
}

function baseLocalShape() {
    return {
        text: '…',
        completed: false,
        completedAt: null,
        priority: 'medium',
        recur: 'none',
        recurN: null,
        recurDays: [],
        description: '',
        kind: 'task',
        children: [],
        pinned: false,
        archived: false,
        timeSpent: 0,
        timerStartedAt: null,
        sessions: [],
        location: null,
        photos: [],
        startAt: null,
        endAt: null,
        phone: '',
        address: '',
        url: '',
    };
}

function normalizeRemote(parsed, extra) {
    const task = { ...baseLocalShape(), ...(parsed || {}) };
    // سازگاری عقب‌رو: payloadهای قدیمی فقط {title} داشتند (قدم ۱.۵/۲)
    if ((!task.text || task.text === '…') && parsed && typeof parsed.title === 'string' && parsed.title) {
        task.text = String(parsed.title).slice(0, 200);
    }
    task.id = extra.serverId;
    task.createdAt = extra.createdAt || task.createdAt || new Date().toISOString();
    task._shared = {
        mine: extra.mine,
        dest: extra.dest,
        remoteId: extra.serverId,
        senderName: extra.senderName || null,
    };
    return task;
}

/**
 * تسک‌های گفتگوی دوطرفه (چند صفحه، جدیدترین اول → برعکس برای نمایش).
 */
export async function fetchPeerTasks(peerId, myId, peerName) {
    const all = [];
    let cursor = null;
    for (let page = 0; page < 5; page++) {
        const res = await listDmTasks(peerId, cursor);
        if (!res.ok) return { ok: false, error: res.error };
        all.push(...(res.tasks || []));
        if (!res.hasMore || !res.nextCursor) break;
        cursor = res.nextCursor;
    }
    const items = all.reverse().map((t) => {
        const mine = String(t.creatorId || t.creator_id || '') === String(myId || '');
        return normalizeRemote(parsePayload(t.payload), {
            serverId: t.id,
            createdAt: t.createdAt || t.created_at,
            mine,
            dest: { type: 'peer', peerId },
            senderName: mine ? null : (peerName || null),
        });
    });
    return { ok: true, items };
}

// ═══════════════════════════════════════════════════════════════════════════
// فروشگاه نمای مشترک صفحه‌ی اصلی (تک‌صفحه)
// ═══════════════════════════════════════════════════════════════════════════

let _items = [];
let _loading = false;
let _error = null;

export function getSharedItems() {
    return _items;
}

export function isSharedLoading() {
    return _loading;
}

export function getSharedError() {
    return _error;
}

export function getSharedItem(id) {
    return _items.find((t) => String(t.id) === String(id)) || null;
}

export function getSharedRole(id) {
    const item = getSharedItem(id);
    if (!item || !item._shared) return null;
    return { mine: !!item._shared.mine };
}

function myId() {
    try {
        return (state.sync && state.sync.userId) || null;
    } catch {
        return null;
    }
}

/**
 * بارگذاری دوباره‌ی لیست مقصد جاری (local → خالی).
 */
export async function refreshSharedList() {
    const dest = getDestination();
    if (dest.type === 'local') {
        _items = [];
        _loading = false;
        _error = null;
        return { ok: true, items: [] };
    }
    _loading = true;
    _error = null;
    try {
        let res;
        if (dest.type === 'peer') {
            res = await fetchPeerTasks(dest.peerId, myId(), dest.name);
        } else if (dest.type === 'group') {
            res = await fetchGroupTasks(dest.groupId, myId());
        } else {
            res = { ok: false, error: { code: 'BAD_DESTINATION' } };
        }
        if (!res.ok) {
            _error = res.error || { code: 'LOAD_FAILED' };
            _items = [];
            return res;
        }
        _items = res.items || [];
        return { ok: true, items: _items };
    } finally {
        _loading = false;
    }
}

// ⚠️ فقط برای تست
export function __resetSharedForTest() {
    _items = [];
    _loading = false;
    _error = null;
    _detailBridge = null;
}

// ⚠️ فقط برای تست
export function __setSharedItemsForTest(items) {
    _items = Array.isArray(items) ? items : [];
}

// ═══════════════════════════════════════════════════════════════════════════
// نوشتن روی مقصد مشترک (ویرایش فقط خودی)
// ═══════════════════════════════════════════════════════════════════════════

function stripShared(item) {
    const clean = { ...item };
    delete clean._shared;
    return clean;
}

async function writeSharedTask(dest, remoteId, taskObj) {
    try {
        if (dest.type === 'peer') {
            return updateDmTask(remoteId, taskObj);
        }
        if (dest.type === 'group') {
            await enqueueGroupOp(dest.groupId, 'save', remoteId, { kind: 'task', payload: taskObj });
            let failed = 0;
            try {
                const fr = await flushGroup(dest.groupId);
                failed = (fr && fr.failed) || 0;
            } catch {
                failed = 0; // آفلاین/transport: در صف می‌ماند، خطا نیست
            }
            if (failed > 0) return { ok: false, code: 'FLUSH_FAILED' };
            return { ok: true };
        }
    } catch {
        return { ok: false };
    }
    return { ok: false };
}

/**
 * ذخیره‌ی کامل آبجکت تسک مشترک (برای saveTask پل جزئیات — بدون refresh).
 */
export async function saveSharedTask(task) {
    if (!task || !task._shared || !task._shared.mine || !task._shared.dest) {
        return { ok: false };
    }
    return writeSharedTask(task._shared.dest, task.id, stripShared(task));
}

/**
 * ویرایش عنوان تسک خودی در نمای مشترک.
 */
export async function updateSharedTaskText(remoteId, title) {
    const item = getSharedItem(remoteId);
    if (!item || !item._shared || !item._shared.mine) return { ok: false };
    const next = { ...stripShared(item), text: String(title).slice(0, 200) };
    return writeSharedTask(item._shared.dest, remoteId, next);
}

/**
 * تاگل تسک خودی در نمای مشترک.
 */
export async function toggleSharedTask(remoteId) {
    const item = getSharedItem(remoteId);
    if (!item || !item._shared || !item._shared.mine) return { ok: false };
    const completed = !item.completed;
    const next = {
        ...stripShared(item),
        completed,
        completedAt: completed ? new Date().toISOString() : null,
    };
    return writeSharedTask(item._shared.dest, remoteId, next);
}

/**
 * حذف تسک خودی در نمای مشترک.
 */
export async function deleteSharedTask(remoteId) {
    const item = getSharedItem(remoteId);
    if (!item || !item._shared || !item._shared.mine) return { ok: false };
    const dest = item._shared.dest;
    if (dest.type === 'peer') {
        return deleteDmTask(remoteId);
    }
    if (dest.type === 'group') {
        await enqueueGroupOp(dest.groupId, 'delete', remoteId, null);
        try {
            await flushGroup(dest.groupId);
        } catch { /* آفلاین */ }
        return { ok: true };
    }
    return { ok: false };
}

// ═══════════════════════════════════════════════════════════════════════════
// پل جزئیات: آیتم خودیِ مشترک زیر دست detail (خواندن/نوشتن روی همان آبجکت)
// فعال فقط وقتی state.currentDetailId با آن ست است (با بستن detail غیرفعال).
// ═══════════════════════════════════════════════════════════════════════════

let _detailBridge = null;

/**
 * ثبت پل برای باز کردن جزئیات (فقط خودی).
 */
export function setDetailBridge(item) {
    if (!item || !item._shared || !item._shared.mine) return false;
    _detailBridge = item;
    return true;
}

export function clearDetailBridge() {
    _detailBridge = null;
}

let _reconcileSubscribed = false;

function ensureReconcileSubscribed() {
    if (_reconcileSubscribed) return;
    _reconcileSubscribed = true;
    // بعد از بستن جزئیات مشترک: تطبیق با حقیقت سرور (اگر PATCH شکست خورده بود، لیست اصلاح می‌شود)
    events.on(EV.DETAIL_CLOSED, async () => {
        if (!_detailBridge) return;
        const hadBridge = _detailBridge;
        _detailBridge = null;
        if (!hadBridge || !hadBridge._shared) return;
        try {
            const dest = getDestination();
            const sameDest = dest.type !== 'local' &&
                String((dest.peerId || dest.groupId || '')) ===
                String((hadBridge._shared.dest.peerId || hadBridge._shared.dest.groupId || ''));
            if (!sameDest) return;
            await refreshSharedList();
            const { render } = await import('../ui.js');
            render();
        } catch { /* best-effort */ }
    });
}
ensureReconcileSubscribed();

/**
 * آبجکت پل اگر id همان جزئیات باز باشد، وگرنه null.
 */
export function getDetailBridgeTask(id) {
    try {
        if (!_detailBridge) return null;
        if (!state.currentDetailId) return null;
        if (String(state.currentDetailId) !== String(id)) return null;
        if (String(_detailBridge.id) !== String(id)) return null;
        return _detailBridge;
    } catch {
        return null;
    }
}

/**
 * تسک‌های گروه + نام/آواتار فرستنده از اعضا.
 */
export async function fetchGroupTasks(groupId, myId) {
    const [tres, mres] = await Promise.all([
        apiFetch('/api/groups/' + encodeURIComponent(groupId) + '/tasks'),
        apiFetch('/api/groups/' + encodeURIComponent(groupId) + '/members'),
    ]);
    if (!tres.ok) return tres;
    const members = (mres.ok && mres.data && mres.data.members) || [];
    const nameOf = (uid) => {
        const m = members.find((x) => String(x.userId) === String(uid));
        if (!m) return String(uid || '').slice(0, 8);
        return m.displayName || m.username || String(m.userId).slice(0, 8);
    };
    const avatarOf = (uid) => {
        const m = members.find((x) => String(x.userId) === String(uid));
        return (m && m.avatarUrl) || null;
    };
    const items = ((tres.data && tres.data.tasks) || []).map((t) => {
        const creator = t.creatorId || t.creator_id;
        const mine = String(creator || '') === String(myId || '');
        const task = normalizeRemote(parsePayload(t.payload), {
            serverId: t.id,
            createdAt: t.createdAt || t.created_at,
            mine,
            dest: { type: 'group', groupId },
            senderName: mine ? null : nameOf(creator),
        });
        if (!mine) task._shared.senderAvatar = avatarOf(creator);
        return task;
    });
    return { ok: true, items };
}
