// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/communication/dm-tasks.js -- کلاینت نازک تسک‌های DM (Phase 9 قدم ۲)
//
// ⚠️ قرارداد: همه‌ی requestهای DM فقط از همین‌جا (روی js/api.js).
//    هیچ fetch مستقیم در جای دیگر. بدون دست‌کاری DOM.
// ═══════════════════════════════════════════════════════════════════════════

import { apiFetch } from '../api.js';

const PAGE_LIMIT = 30;

/**
 * لیست تسک‌های گفتگو با یک مخاطب (جدیدترین اول).
 * @returns {ok, tasks?, nextCursor?}
 */
export async function listDmTasks(peerId, cursor) {
    let path = '/api/dm/tasks?peer=' + encodeURIComponent(peerId) + '&limit=' + PAGE_LIMIT;
    if (cursor) {
        if (cursor.createdAt) path += '&before=' + encodeURIComponent(cursor.createdAt);
        if (cursor.id) path += '&beforeId=' + encodeURIComponent(cursor.id);
    }
    const res = await apiFetch(path);
    if (!res.ok) return res;
    const tasks = (res.data && res.data.tasks) || [];
    let nextCursor = null;
    if (tasks.length > 0) {
        const last = tasks[tasks.length - 1];
        nextCursor = { createdAt: last.createdAt || last.created_at, id: last.id };
    }
    return { ok: true, tasks, nextCursor, hasMore: tasks.length >= PAGE_LIMIT };
}

/**
 * ساخت تسک DM.
 */
export async function createDmTask(peerId, title) {
    return apiFetch('/api/dm/tasks', {
        method: 'POST',
        body: { peerId, kind: 'task', payload: { title } },
    });
}

/**
 * ویرایش تسک خودی.
 */
export async function updateDmTask(taskId, title) {
    return apiFetch('/api/dm/tasks/' + encodeURIComponent(taskId), {
        method: 'PATCH',
        body: { payload: { title } },
    });
}

/**
 * حذف تسک خودی.
 */
export async function deleteDmTask(taskId) {
    return apiFetch('/api/dm/tasks/' + encodeURIComponent(taskId), { method: 'DELETE' });
}

/**
 * شمارش نخوانده‌ها: { total, byPeer: [{peerId, count}] }.
 */
export async function getDmUnread() {
    const res = await apiFetch('/api/dm/unread');
    if (!res.ok) return res;
    const unread = (res.data && res.data.unread) || { total: 0, byPeer: [] };
    return { ok: true, unread };
}

/**
 * ثبت خواندن گفتگو با یک مخاطب.
 */
export async function markDmRead(peerId) {
    return apiFetch('/api/dm/read', { method: 'POST', body: { peerId } });
}
