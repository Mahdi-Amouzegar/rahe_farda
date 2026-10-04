// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/tasks/source.js -- خواندن + نرمال‌سازی تسک‌های مقصد مشترک
//
// ⚠️ خروجی همیشه به شکل تسک محلی است (همان کارت/فیلتر/مرتب‌سازی کار می‌کند):
//   { ...payload, id, _shared: { mine, dest, remoteId, senderName } }
// ⚠️ آیتم دیگران read-only است (گیت در dispatcher اپ).
// ═══════════════════════════════════════════════════════════════════════════

import { apiFetch } from '../api.js';
import { state } from '../core.js';
import { listDmTasks } from '../communication/dm-tasks.js';
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
