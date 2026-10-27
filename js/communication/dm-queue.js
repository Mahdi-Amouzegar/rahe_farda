// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/communication/dm-queue.js -- صف آفلاین تسک‌های DM (نشست ۱۰.۴۰)
//
// ⚠️ چرا این ماژول؟
//   DM تنها مقصدی بود که «صف آفلاین» نداشت: `submitTask` مستقیم
//   `POST /api/dm/tasks` می‌زد و اگر شبکه نبود، پیام با پیام
//   «اتصال به سرور برقرار نشد» رد می‌شد و هیچ‌جا نمی‌ماند. گروه از قبل
//   `group-queue.js` را داشت.
//
// ⚠️ قرارداد:
//   - هر op = { id, peerId, type: 'create'|'update'|'delete', entityId, data, createdAt }
//   - `create` → POST /api/dm/tasks (سرور id خودش را می‌سازد؛ tempId نگاشت می‌شود)
//   - `update` → PATCH /api/dm/tasks/:id
//   - `delete` → DELETE /api/dm/tasks/:id
//   - خطای transport (NETWORK_ERROR/TIMEOUT) → op در صف می‌ماند
//   - خطای دائمی (403/404/400) → op حذف می‌شود تا حلقه‌ی بی‌پایان نشود
//
// ⚠️ رویدادها:
//   dm:queue-changed   { peerId }
//   dm:queue-flushed   { peerId, created:[{tempId,serverId,task}], deleted:[id] }
//   dm:queue-rejected  { peerId, opId, type, code }
// ═══════════════════════════════════════════════════════════════════════════

import { uid } from '../core.js';
import { events, EV } from '../events.js';
import { isOnline } from '../net.js';
import { createDmTask, updateDmTask, deleteDmTask } from './dm-tasks.js';

const IDB_NAME = 'rahe-farda-dm';
const IDB_VERSION = 1;
const IDB_STORE = 'dm_sync_queue';

let _db = null;
let _memory = null;
let _flushing = new Set();
let _started = false;

// ═══════════════════════════════════════════════════════════════════════════
// Storage (IDB + fallback حافظه)
// ═══════════════════════════════════════════════════════════════════════════

function useMemory() {
    return typeof indexedDB === 'undefined';
}

function memStore() {
    if (!_memory) _memory = new Map();
    return _memory;
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
                store.createIndex('peerId', 'peerId', { unique: false });
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

async function readAll() {
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

async function readPeerEntries(peerId) {
    const all = await readAll();
    return all.filter((e) => String(e.peerId) === String(peerId));
}

async function deleteEntries(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return;
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

// ═══════════════════════════════════════════════════════════════════════════
// Enqueue
// ═══════════════════════════════════════════════════════════════════════════

/**
 * افزودن یک op به صف DM.
 *
 * @param {string} peerId
 * @param {'create'|'update'|'delete'} type
 * @param {string} entityId — id لوکال (create) یا id سروری (update/delete)
 * @param {{kind?: string, payload?: object}|null} [data]
 * @returns {Promise<object|null>}
 */
export async function enqueueDmOp(peerId, type, entityId, data) {
    if (!peerId || !entityId) return null;
    if (type !== 'create' && type !== 'update' && type !== 'delete') return null;
    const entry = {
        id: uid(),
        peerId: String(peerId),
        type,
        entityId: String(entityId),
        data: data || null,
        createdAt: new Date().toISOString(),
        retryCount: 0,
        status: 'pending',
        lastError: null,
    };
    await putEntry(entry);
    events.emit('dm:queue-changed', { peerId: String(peerId) });
    return entry;
}

/**
 * opهای pending یک گفتگو (مرتب بر زمان ساخت).
 * @returns {Promise<object[]>}
 */
export async function getPendingDmOps(peerId) {
    try {
        const rows = await readPeerEntries(peerId);
        return rows
            .filter((e) => e.status === 'pending')
            .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    } catch {
        return [];
    }
}

/**
 * تعداد opهای pending یک گفتگو.
 */
export async function getPendingDmCount(peerId) {
    return (await getPendingDmOps(peerId)).length;
}

/**
 * آیا این id لوکال هنوز منتظر «ساخت» در سرور است؟
 *
 * ⚠️ برای media-upload: آپلود عکس با taskId تسکی که هنوز روی سرور ساخته
 * نشده، presign را با 403 رد می‌کند. تا ساخت انجام نشود، آپلود را عقب می‌اندازیم.
 */
export async function hasPendingDmCreate(entityId) {
    try {
        const all = await readAll();
        return all.some(
            (e) => e.type === 'create' && e.status === 'pending' && String(e.entityId) === String(entityId)
        );
    } catch {
        return false;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Flush
// ═══════════════════════════════════════════════════════════════════════════

function isTransportError(res) {
    if (!res) return true;
    if (res.ok) return false;
    const code = res.error && res.error.code;
    return code === 'NETWORK_ERROR' || code === 'TIMEOUT';
}

/**
 * ارسال opهای یک گفتگو به سرور.
 *
 * @returns {Promise<{ok:boolean, flushed:number, pending:number, failed:number, created:object[], deleted:string[]}>}
 */
export async function flushDmQueue(peerId) {
    const result = { ok: false, flushed: 0, pending: 0, failed: 0, created: [], deleted: [] };
    if (!peerId || !isOnline()) return result;
    if (_flushing.has(String(peerId))) return result;
    _flushing.add(String(peerId));
    try {
        const entries = await getPendingDmOps(peerId);
        if (entries.length === 0) {
            result.ok = true;
            return result;
        }

        for (const e of entries) {
            if (!isOnline()) break;
            let res = null;
            try {
                if (e.type === 'create') {
                    res = await createDmTask(peerId, (e.data && e.data.payload) || { title: '' });
                } else if (e.type === 'update') {
                    res = await updateDmTask(e.entityId, (e.data && e.data.payload) || {});
                } else {
                    res = await deleteDmTask(e.entityId);
                }
            } catch {
                res = { ok: false, error: { code: 'NETWORK_ERROR' } };
            }

            if (res && res.ok) {
                await deleteEntries([e.id]);
                result.flushed++;
                if (e.type === 'create') {
                    const task = res.data && res.data.task;
                    if (task && task.id) {
                        result.created.push({
                            tempId: e.entityId,
                            serverId: String(task.id),
                            task,
                        });
                    }
                } else if (e.type === 'delete') {
                    result.deleted.push(e.entityId);
                }
                continue;
            }

            if (isTransportError(res)) {
                e.retryCount = (e.retryCount || 0) + 1;
                e.lastError = (res && res.error && res.error.code) || 'flush-failed';
                await putEntry(e);
                result.failed++;
                break; // بقیه هم احتمالاً همین خطا را می‌دهند
            }

            // رد دائمی (blocked / first-contact limit / 404) — نگه‌داشتنش فقط حلقه می‌سازد
            await deleteEntries([e.id]);
            result.failed++;
            events.emit('dm:queue-rejected', {
                peerId: String(peerId),
                opId: e.id,
                type: e.type,
                code: (res && res.error && res.error.code) || 'rejected',
            });
        }

        result.pending = (await getPendingDmOps(peerId)).length;
        result.ok = result.failed === 0;
        if (result.created.length > 0 || result.deleted.length > 0) {
            events.emit('dm:queue-flushed', {
                peerId: String(peerId),
                created: result.created,
                deleted: result.deleted,
            });
        }
        return result;
    } finally {
        _flushing.delete(String(peerId));
    }
}

/**
 * flush همه‌ی گفتگوهایی که op pending دارند (هنگام آنلاین‌شدن).
 */
export async function flushAllDmQueues() {
    if (!isOnline()) return { ok: false, peers: 0 };
    let peers = 0;
    try {
        const all = await readAll();
        const ids = [...new Set(all.filter((e) => e.status === 'pending').map((e) => String(e.peerId)))];
        for (const pid of ids) {
            await flushDmQueue(pid);
            peers++;
        }
        return { ok: true, peers };
    } catch {
        return { ok: false, peers };
    }
}

/**
 * راه‌اندازی (idempotent): flush هنگام آنلاین‌شدن.
 */
export function initDmQueue() {
    if (_started) return;
    _started = true;
    events.on(EV.NET_ONLINE, () => {
        flushAllDmQueues().catch(() => {});
    });
}

// ⚠️ فقط برای تست
export function __resetDmQueueForTest() {
    _flushing = new Set();
    _memory = new Map();
    _started = false;
}
