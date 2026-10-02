// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/communication/group-queue.js -- صف آفلاین تسک‌های گروه (Phase 8 — 8.3-C)
//
// ⚠️ scope قفل‌شده:
//   - یک store عمومی `group_sync_queue` با semantics per-group (رکورد: groupId…)
//   - فقط opهای تسک گروهی (save/delete روی group_task) — پیام/دعوت/عضویت مستقیم می‌مانند
//   - flush با POST /api/groups/:id/sync (پروتکل سرور بدون تغییر)
//   - مدل: server-authoritative + locally cached + queue (گروه local-first نیست)
//   - بدون conflict-resolution جدید، بدون background sync پیچیده، بدون realtime
//
// ⚠️ قوانین flush:
//   - accepted و rejectedهای سرور (forbidden/stale — هیچ‌وقت موفق نمی‌شوند) حذف می‌شوند
//   - فقط خطای transport در صف می‌ماند (failure retention) با retryCount
//   - cursor هر گروه در localStorage است (`groupSyncCursors`) و بعد از هر sync جلو می‌رود
// ═══════════════════════════════════════════════════════════════════════════

import { apiFetch } from '../api.js';
import { state, uid } from '../core.js';
import { events, EV } from '../events.js';
import { isOnline, getDeviceId } from '../net.js';

const IDB_NAME = 'rahe-farda-groups';
const IDB_VERSION = 1;
const IDB_STORE = 'group_sync_queue';
const CURSORS_KEY = 'groupSyncCursors';

let _db = null;
let _memoryFallback = null;
let _flushing = new Set();
let _started = false;

// ═══════════════════════════════════════════════════════════════════════════
// Storage (IDB + fallback حافظه برای محیط بدون IndexedDB)
// ═══════════════════════════════════════════════════════════════════════════

function useMemory() {
    if (typeof indexedDB === 'undefined') return true;
    return false;
}

function memStore() {
    if (!_memoryFallback) _memoryFallback = new Map();
    return _memoryFallback;
}

function openDb() {
    if (_db) return Promise.resolve(_db);
    if (useMemory()) return Promise.reject(new Error('no-indexeddb'));
    return new Promise((resolve, reject) => {
        let req;
        try {
            req = indexedDB.open(IDB_NAME, IDB_VERSION);
        } catch (err) {
            reject(err);
            return;
        }
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(IDB_STORE)) {
                const store = db.createObjectStore(IDB_STORE, { keyPath: 'id' });
                store.createIndex('groupId', 'groupId', { unique: false });
                store.createIndex('status', 'status', { unique: false });
            }
        };
        req.onsuccess = () => {
            _db = req.result;
            resolve(_db);
        };
        req.onerror = () => reject(req.error);
    });
}

async function putEntry(entry) {
    if (useMemory()) {
        memStore().set(entry.id, entry);
        return;
    }
    try {
        const db = await openDb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE, 'readwrite');
            tx.objectStore(IDB_STORE).put(entry);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch {
        memStore().set(entry.id, entry);
    }
}

async function readGroupEntries(groupId) {
    if (useMemory()) {
        return [...memStore().values()].filter((e) => e.groupId === groupId);
    }
    try {
        const db = await openDb();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE, 'readonly');
            const req = tx.objectStore(IDB_STORE).index('groupId').getAll(groupId);
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    } catch {
        return [...memStore().values()].filter((e) => e.groupId === groupId);
    }
}

async function deleteEntries(ids) {
    if (useMemory()) {
        for (const id of ids) memStore().delete(id);
        return;
    }
    try {
        const db = await openDb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE, 'readwrite');
            for (const id of ids) tx.objectStore(IDB_STORE).delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch {
        for (const id of ids) memStore().delete(id);
    }
}

async function readAllEntries() {
    if (useMemory()) return [...memStore().values()];
    try {
        const db = await openDb();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE, 'readonly');
            const req = tx.objectStore(IDB_STORE).getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    } catch {
        return [...memStore().values()];
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Cursor map (per group)
// ═══════════════════════════════════════════════════════════════════════════

function readCursors() {
    try {
        const raw = localStorage.getItem(CURSORS_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

export function getGroupCursor(groupId) {
    const n = Number(readCursors()[groupId]);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function setGroupCursor(groupId, seq) {
    try {
        const all = readCursors();
        const prev = Number(all[groupId]) || 0;
        if (seq > prev) {
            all[groupId] = seq;
            localStorage.setItem(CURSORS_KEY, JSON.stringify(all));
        }
    } catch { /* silent */ }
}

// ═══════════════════════════════════════════════════════════════════════════
// Enqueue
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ساخت و صف‌کردن یک op تسک گروهی.
 *
 * @param {string} groupId
 * @param {'save'|'delete'} type
 * @param {string} entityId - شناسه‌ی تسک
 * @param {Object|null} data - {kind?, payload?} برای save
 * @returns {Promise<object|null>} entry صف
 */
export async function enqueueGroupOp(groupId, type, entityId, data) {
    if (!groupId || (type !== 'save' && type !== 'delete') || !entityId) return null;
    const entry = {
        id: uid(),
        groupId,
        type,
        entityId: String(entityId),
        entityType: 'group_task',
        data: data || null,
        timestamp: new Date().toISOString(),
        deviceId: getDeviceId(),
        retryCount: 0,
        status: 'pending',
        lastError: null,
        createdAt: new Date().toISOString(),
    };
    await putEntry(entry);
    events.emit(EV.GROUP_QUEUE_CHANGED, { groupId });
    if (isOnline()) scheduleFlush(groupId);
    return entry;
}

/**
 * تعداد opهای pending یک گروه (برای نشانگر pending در UI).
 */
export async function getPendingCount(groupId) {
    try {
        const entries = await readGroupEntries(groupId);
        return entries.filter((e) => e.status === 'pending').length;
    } catch {
        return 0;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Flush
// ═══════════════════════════════════════════════════════════════════════════

let _scheduled = new Set();

function scheduleFlush(groupId) {
    if (_scheduled.has(groupId)) return;
    _scheduled.add(groupId);
    setTimeout(() => {
        _scheduled.delete(groupId);
        flushGroup(groupId).catch(() => {});
    }, 400);
}

/**
 * flush صف یک گروه: ارسال opها + به‌روزرسانی cursor.
 *
 * @returns {Promise<{ok,flushed,pending,failed,replayed}>}
 */
export async function flushGroup(groupId) {
    const result = { ok: false, flushed: 0, pending: 0, failed: 0, replayed: 0 };
    if (!groupId || !isOnline()) return result;
    if (_flushing.has(groupId)) return result;
    _flushing.add(groupId);
    try {
        const entries = (await readGroupEntries(groupId))
            .filter((e) => e.status === 'pending')
            .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
        if (entries.length === 0) {
            result.ok = true;
            return result;
        }

        const ops = entries.map((e) => ({
            id: e.id,
            type: e.type,
            entityId: e.entityId,
            entityType: 'group_task',
            data: e.data,
            timestamp: e.timestamp,
            deviceId: e.deviceId,
        }));

        const res = await apiFetch('/api/groups/' + encodeURIComponent(groupId) + '/sync', {
            method: 'POST',
            body: {
                ops,
                deviceId: getDeviceId(),
                lastChangeSeq: getGroupCursor(groupId),
                requestFullResync: false,
            },
        });

        if (!res.ok) {
            // خطای transport → همه می‌مانند + retry
            for (const e of entries) {
                e.retryCount = (e.retryCount || 0) + 1;
                e.lastError = (res.error && res.error.code) || 'flush-failed';
                await putEntry(e);
            }
            result.failed = entries.length;
            return result;
        }

        // accepted + rejected سرور (دائمی) حذف می‌شوند؛ چیزی برای retry نیست
        const doneIds = new Set([
            ...((res.data && res.data.accepted) || []).map((a) => a.opId),
            ...((res.data && res.data.rejected) || []).map((r) => r.opId),
        ]);
        const done = entries.filter((e) => doneIds.has(e.id));
        const undone = entries.filter((e) => !doneIds.has(e.id));
        await deleteEntries(done.map((e) => e.id));
        for (const e of undone) {
            e.retryCount = (e.retryCount || 0) + 1;
            e.lastError = 'not-acknowledged';
            await putEntry(e);
        }
        result.flushed = done.length;
        result.failed = undone.length;

        if (res.data && Number.isFinite(res.data.newChangeSeq)) {
            setGroupCursor(groupId, res.data.newChangeSeq);
        }
        result.ok = true;
        result.pending = (await readGroupEntries(groupId)).filter((e) => e.status === 'pending').length;
        events.emit(EV.GROUP_QUEUE_CHANGED, { groupId, flushed: result.flushed });
        return result;
    } finally {
        _flushing.delete(groupId);
    }
}

/**
 * flush همه‌ی گروه‌هایی که pending دارند (هنگام آنلاین‌شدن).
 */
export async function flushAllGroups() {
    if (!isOnline()) return { ok: false, groups: 0 };
    let groups = 0;
    try {
        const all = await readAllEntries();
        const ids = [...new Set(all.filter((e) => e.status === 'pending').map((e) => e.groupId))];
        for (const gid of ids) {
            await flushGroup(gid);
            groups++;
        }
        return { ok: true, groups };
    } catch {
        return { ok: false, groups };
    }
}

/**
 * راه‌اندازی (idempotent): flush هنگام آنلاین‌شدن.
 */
export function initGroupQueue() {
    if (_started) return;
    _started = true;
    events.on(EV.NET_ONLINE, () => {
        flushAllGroups().catch(() => {});
    });
}

// ⚠️ فقط برای تست
export function __resetGroupQueueForTest() {
    _flushing = new Set();
    _scheduled = new Set();
    _started = false;
    _memoryFallback = new Map();
}
