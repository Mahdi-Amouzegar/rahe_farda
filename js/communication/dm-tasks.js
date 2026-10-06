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
        // کرسر بر مبنای updated_at است (مرتب‌سازی سرور) — نام فیلد برای سازگاری می‌ماند
        nextCursor = { createdAt: last.updatedAt || last.updated_at || last.createdAt || last.created_at, id: last.id };
    }
    return { ok: true, tasks, nextCursor, hasMore: tasks.length >= PAGE_LIMIT };
}

/**
 * ساخت تسک DM (payload = آبجکت کامل تسک یا فقط عنوان).
 */
export async function createDmTask(peerId, titleOrTask) {
    const payload = titleOrTask && typeof titleOrTask === 'object' && !Array.isArray(titleOrTask)
        ? titleOrTask
        : { title: titleOrTask };
    return apiFetch('/api/dm/tasks', {
        method: 'POST',
        body: { peerId, kind: 'task', payload },
    });
}

/**
 * ویرایش تسک خودی (payload کامل یا فقط عنوان).
 */
export async function updateDmTask(taskId, titleOrTask) {
    const payload = titleOrTask && typeof titleOrTask === 'object' && !Array.isArray(titleOrTask)
        ? titleOrTask
        : { title: titleOrTask };
    return apiFetch('/api/dm/tasks/' + encodeURIComponent(taskId), {
        method: 'PATCH',
        body: { payload },
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
 *
 * ⚠️ singleflight + کش کوتاه (۵ ثانیه): بوت/تیک زنده چند caller همزمان دارند
 *    (لیست + بج + هدر) — بدون این، هر باز شدن صفحه N درخواست تکراری می‌زد.
 *    با ثبت خواندن (markDmRead) کش باطل می‌شود تا عدد تازه بیاید.
 */
let _unreadInflight = null;
let _unreadCached = null;
let _unreadCachedAt = 0;
const UNREAD_TTL_MS = 5000;

export async function getDmUnread() {
    const now = Date.now();
    if (_unreadCached && (now - _unreadCachedAt) < UNREAD_TTL_MS) return _unreadCached;
    if (_unreadInflight) return _unreadInflight;
    _unreadInflight = (async () => {
        try {
            const res = await apiFetch('/api/dm/unread');
            if (!res.ok) return res;
            const unread = (res.data && res.data.unread) || { total: 0, byPeer: [] };
            _unreadCached = { ok: true, unread };
            _unreadCachedAt = Date.now();
            return _unreadCached;
        } finally {
            _unreadInflight = null;
        }
    })();
    return _unreadInflight;
}

function invalidateDmUnreadCache() {
    _unreadCached = null;
    _unreadCachedAt = 0;
}

/**
 * ثبت خواندن گفتگو با یک مخاطب.
 */
export async function markDmRead(peerId, at) {
    const body = { peerId };
    if (at) body.at = at;
    const res = await apiFetch('/api/dm/read', { method: 'POST', body });
    if (res && res.ok) invalidateDmUnreadCache();
    return res;
}

// ⚠️ فقط برای تست
export function __resetDmUnreadForTest() {
    _unreadInflight = null;
    _unreadCached = null;
    _unreadCachedAt = 0;
}
