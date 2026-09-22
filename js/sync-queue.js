// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// sync-queue.js -- صف sync آفلاین با IndexedDB (ESM)
//
// ⚠️ اصل معماری: Offline-First
//   - پیش‌فرض: هیچ درخواست شبکه‌ای انجام نمی‌شود.
//   - صف ops فقط در IndexedDB می‌ماند تا کاربر در تنظیمات
//     گزینه‌ی «همگام‌سازی ابری» را فعال کند.
//   - در فاز ۶، Cloudflare Worker + D1 به همین صف وصل می‌شود.
//
// ⚠️ تغییر Phase 4 (نسخه 2.0):
//   - انتقال از localStorage به IndexedDB
//   - Transactional: opها در همان transaction با taskها نوشته می‌شوند
//   - Crash recovery: opهای in-flight در boot به pending برمی‌گردند
//   - Flush زمان‌محور: هر ۳۰ ثانیه + آستانه‌ی ۱۰۰ op
//   - Retention: opهای قدیمی‌تر از ۷ روز drop می‌شوند
//
// ⚠️ ساختار IDB:
//   DB: spaceTodoDB (همان که store.js استفاده می‌کند)
//   Object Store: sync_queue (keyPath: 'id')
//   Index: status (برای query سریع)
//
// ⚠️ قاعده‌ی بدون loop:
//   - هر emit رویداد با فلگ محافظت می‌شود (inFlight، _flushing)
//   - listener روی net:online با _flushScheduled محافظت می‌شود
// ═══════════════════════════════════════════════════════════════════════════

import { state, uid, SCHEMA_VERSION } from './core.js';
import { events, EV } from './events.js';
import { isOnline, getDeviceId, probeConnection } from './net.js';

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/** نام IndexedDB (همان که store.js استفاده می‌کند) */
const IDB_NAME = 'spaceTodoDB';

/** نام object store برای صف sync */
const IDB_SYNC_QUEUE = 'sync_queue';

/** نسخه‌ی IDB (باید هم‌خوان با store.js باشد) */
const IDB_VERSION = 3;

/** حداکثر تعداد op در صف (جلوگیری از پر شدن IDB) */
const MAX_QUEUE_SIZE = 1000;

/** آستانه‌ی flush فوری — اگر صف به این تعداد رسید، فوری flush */
const FLUSH_THRESHOLD = 100;

/** فاصله‌ی flush خودکار (ms) — ۳۰ ثانیه */
const FLUSH_INTERVAL_MS = 30000;

/** حداقل فاصله بین دو flush خودکار (ms) */
const FLUSH_MIN_INTERVAL_MS = 5000;

/** Base delay برای exponential backoff (ms) */
const RETRY_BASE_DELAY_MS = 2000;

/** حداکثر delay برای retry (ms) — سقف ۵ دقیقه */
const RETRY_MAX_DELAY_MS = 5 * 60 * 1000;

/** حداکثر تعداد retry برای هر op قبل از drop */
const MAX_RETRIES_PER_OP = 8;

/** Retention: opهای قدیمی‌تر از این مقدار drop می‌شوند (ms) */
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // ۷ روز

// ═══════════════════════════════════════════════════════════════════════════
// Local state
// ═══════════════════════════════════════════════════════════════════════════

/** @type {boolean} */
let _started = false;

/** @type {boolean} — محافظ loop: آیا flush در حال اجراست؟ */
let _flushing = false;

/** @type {boolean} — محافظ loop: آیا flush زمان‌بندی شده؟ */
let _flushScheduled = false;

/** @type {number} */
let _lastFlushAt = 0;

/** @type {number|null} */
let _retryTimer = null;

/** @type {number|null} — تایمر flush خودکار */
let _autoFlushTimer = null;

/** @type {number} */
let _currentRetryDelay = RETRY_BASE_DELAY_MS;

/** @type {IDBDatabase|null} */
let _db = null;

/**
 * handler پیش‌فرض — هیچ کاری نمی‌کند.
 * در فاز ۶ با cloudflareSyncHandler عوض می‌شود.
 *
 * @type {(op: object) => Promise<{ ok: boolean }>}
 */
let _syncHandler = async () => ({ ok: true });

// ═══════════════════════════════════════════════════════════════════════════
// IndexedDB
// ═══════════════════════════════════════════════════════════════════════════

/**
 * باز کردن IDB (یا گرفتن instance موجود).
 *
 * ⚠️ این تابع idempotent است.
 */
function openDb() {
    if (_db) return Promise.resolve(_db);
    if (typeof indexedDB === 'undefined') {
        return Promise.reject(new Error('no-indexeddb'));
    }

    return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_NAME, IDB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            // Object store تسک‌ها (توسط store.js ساخته می‌شود، ولی
            // اینجا هم چک می‌کنیم که اگر نبود، بسازیم)
            if (!db.objectStoreNames.contains('tasks')) {
                db.createObjectStore('tasks', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('trash')) {
                db.createObjectStore('trash', { keyPath: 'id' });
            }
            // Object store صف sync
            if (!db.objectStoreNames.contains(IDB_SYNC_QUEUE)) {
                const store = db.createObjectStore(IDB_SYNC_QUEUE, { keyPath: 'id' });
                store.createIndex('status', 'status', { unique: false });
                store.createIndex('timestamp', 'timestamp', { unique: false });
            }
        };
        req.onsuccess = () => {
            _db = req.result;
            resolve(_db);
        };
        req.onerror = () => reject(req.error);
    });
}

/**
 * خواندن همه‌ی opها از IDB.
 */
async function readAllOps() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_SYNC_QUEUE, 'readonly');
        const req = tx.objectStore(IDB_SYNC_QUEUE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

/**
 * نوشتن یک op در IDB.
 */
async function putOp(op) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_SYNC_QUEUE, 'readwrite');
        tx.objectStore(IDB_SYNC_QUEUE).put(op);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * حذف چند op از IDB.
 */
async function deleteOps(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return;
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_SYNC_QUEUE, 'readwrite');
        const store = tx.objectStore(IDB_SYNC_QUEUE);
        for (const id of ids) {
            store.delete(id);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * پاک کردن کل صف.
 */
async function deleteAllOps() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_SYNC_QUEUE, 'readwrite');
        tx.objectStore(IDB_SYNC_QUEUE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API — read
// ═══════════════════════════════════════════════════════════════════════════

/**
 * snapshot از صف فعلی (async).
 * @returns {Promise<object[]>}
 */
export async function getQueue() {
    try {
        return await readAllOps();
    } catch (err) {
        console.warn('sync-queue: getQueue failed', err);
        return [];
    }
}

/**
 * تعداد opهای در انتظار (async).
 * @returns {Promise<number>}
 */
export async function getQueueSize() {
    try {
        const ops = await readAllOps();
        return ops.length;
    } catch {
        return 0;
    }
}

/**
 * آیا صف خالی است؟
 * @returns {Promise<boolean>}
 */
export async function isQueueEmpty() {
    const size = await getQueueSize();
    return size === 0;
}

/**
 * تعریف handler سفارشی.
 */
export function setSyncHandler(fn) {
    if (typeof fn === 'function') {
        _syncHandler = fn;
    } else {
        _syncHandler = async () => ({ ok: true });
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Enqueue / Dequeue
// ═══════════════════════════════════════════════════════════════════════════

/**
 * افزودن یک op به صف (async).
 *
 * @param {object} op
 * @returns {Promise<object|null>} op نهایی یا null اگر نامعتبر بود
 */
export async function enqueue(op) {
    if (!op || typeof op.type !== 'string') {
        console.warn('sync-queue: invalid op', op);
        return null;
    }
    if (typeof op.entityId !== 'string' && typeof op.entityId !== 'number') {
        console.warn('sync-queue: op.entityId required', op);
        return null;
    }

    const entry = {
        id: op.id || uid(),
        type: op.type,
        entityId: String(op.entityId),
        entityType: op.entityType === 'child' ? 'child' : 'task',
        data: op.data || null,
        parentId: op.parentId ? String(op.parentId) : null,
        timestamp: op.timestamp || new Date().toISOString(),
        deviceId: op.deviceId || getDeviceId(),
        schemaVersion: op.schemaVersion || SCHEMA_VERSION,
        retries: 0,
        lastError: null,
        status: 'pending', // 'pending' | 'in-flight' | 'failed'
        enqueuedAt: new Date().toISOString(),
    };

    try {
        await putOp(entry);
    } catch (err) {
        console.warn('sync-queue: enqueue failed', err);
        return null;
    }

    events.emit(EV.SYNC_ENQUEUED, { op: entry });

    // تعداد جدید را async بفرست
    getQueueSize().then(size => {
        events.emit(EV.SYNC_QUEUE_CHANGED, { size });
    }).catch(() => {});

    // اگر صف بزرگ شد، فوری flush کن
    const size = await getQueueSize();
    if (size >= FLUSH_THRESHOLD && state.sync.enabled && isOnline()) {
        scheduleFlush();
    } else if (state.sync.enabled && isOnline()) {
        scheduleFlush();
    }

    return entry;
}

/**
 * حذف چند op از صف (async).
 */
export async function dequeue(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return;
    try {
        await deleteOps(ids.map(String));
    } catch (err) {
        console.warn('sync-queue: dequeue failed', err);
        return;
    }
    const size = await getQueueSize();
    events.emit(EV.SYNC_QUEUE_CHANGED, { size });
}

/**
 * پاک‌سازی کل صف (async).
 */
export async function clearQueue() {
    try {
        await deleteAllOps();
    } catch (err) {
        console.warn('sync-queue: clearQueue failed', err);
    }
    events.emit(EV.SYNC_QUEUE_CHANGED, { size: 0 });
}

// ═══════════════════════════════════════════════════════════════════════════
// Retention
// ═══════════════════════════════════════════════════════════════════════════

/**
 * پاک‌سازی opهای قدیمی‌تر از RETENTION_MS.
 */
async function purgeOldOps() {
    try {
        const ops = await readAllOps();
        const now = Date.now();
        const toDelete = [];
        for (const op of ops) {
            const t = Date.parse(op.enqueuedAt || op.timestamp);
            if (Number.isFinite(t) && (now - t) > RETENTION_MS) {
                toDelete.push(op.id);
            }
        }
        if (toDelete.length > 0) {
            await deleteOps(toDelete);
            console.log(`sync-queue: purged ${toDelete.length} old ops`);
        }
    } catch (err) {
        console.warn('sync-queue: purgeOldOps failed', err);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Flush — تلاش برای sync
// ═══════════════════════════════════════════════════════════════════════════

function scheduleFlush() {
    if (_flushScheduled) return;
    _flushScheduled = true;
    setTimeout(() => {
        _flushScheduled = false;
        flushQueue().catch(() => {});
    }, 500);
}

/**
 * تلاش برای flush صف (async).
 *
 * @returns {Promise<{ ok: boolean, processed: number, failed: number }>}
 */
export async function flushQueue() {
    // ⚠️ گارد اصلی
    if (state.sync.enabled !== true) {
        return { ok: false, processed: 0, failed: 0 };
    }
    if (!isOnline()) {
        return { ok: false, processed: 0, failed: 0 };
    }
    if (_flushing) {
        return { ok: false, processed: 0, failed: 0 };
    }

    // خواندن صف
    let queue;
    try {
        queue = await readAllOps();
    } catch {
        return { ok: false, processed: 0, failed: 0 };
    }

    if (queue.length === 0) {
        return { ok: true, processed: 0, failed: 0 };
    }

    const now = Date.now();
    if (now - _lastFlushAt < FLUSH_MIN_INTERVAL_MS) {
        scheduleFlush();
        return { ok: false, processed: 0, failed: 0 };
    }

    _flushing = true;
    state.sync.inFlight = true;
    _lastFlushAt = now;

    const succeededIds = [];
    const failedOps = [];
    let processed = 0;

    try {
        const snapshot = queue.slice();

        for (const op of snapshot) {
            if (!isOnline()) break;

            try {
                // علامت‌گذاری به‌عنوان in-flight
                op.status = 'in-flight';
                await putOp(op);

                const result = await _syncHandler(op);
                if (result && result.ok) {
                    succeededIds.push(op.id);
                    processed++;
                } else {
                    throw new Error('handler-returned-not-ok');
                }
            } catch (err) {
                op.retries = (op.retries || 0) + 1;
                op.lastError = err && err.message ? err.message : 'unknown';
                op.status = 'pending';
                failedOps.push(op);

                if (op.retries >= MAX_RETRIES_PER_OP) {
                    console.warn('sync-queue: dropping op after max retries', op);
                    succeededIds.push(op.id); // به‌عنوان "حذف شده" ثبت می‌شود
                } else {
                    await putOp(op);
                }
            }
        }
    } finally {
        _flushing = false;
        state.sync.inFlight = false;
    }

    if (succeededIds.length > 0) {
        await dequeue(succeededIds);
    }

    state.sync.lastFlushAt = new Date().toISOString();

    if (failedOps.length > 0) {
        state.sync.lastError = failedOps[0].lastError;
        state.sync.retries = (state.sync.retries || 0) + 1;
        events.emit(EV.SYNC_ERROR, {
            failed: failedOps.length,
            lastError: state.sync.lastError,
        });
        _scheduleRetry();
    } else {
        state.sync.lastError = null;
        _currentRetryDelay = RETRY_BASE_DELAY_MS;
        clearTimeout(_retryTimer);
        _retryTimer = null;
        const remaining = await getQueueSize();
        events.emit(EV.SYNC_FLUSHED, {
            processed,
            remaining,
        });
    }

    return {
        ok: failedOps.length === 0,
        processed,
        failed: failedOps.length,
    };
}

function _scheduleRetry() {
    clearTimeout(_retryTimer);
    const delay = Math.min(_currentRetryDelay, RETRY_MAX_DELAY_MS);
    _currentRetryDelay = Math.min(_currentRetryDelay * 2, RETRY_MAX_DELAY_MS);

    _retryTimer = setTimeout(() => {
        _retryTimer = null;
        if (isOnline() && state.sync.enabled) {
            flushQueue().catch(() => {});
        }
    }, delay);
}

// ═══════════════════════════════════════════════════════════════════════════
// Enable / Disable
// ═══════════════════════════════════════════════════════════════════════════

export function enableCloudSync(config) {
    if (!config || typeof config.endpoint !== 'string') {
        console.warn('sync-queue: enableCloudSync requires endpoint');
        return false;
    }
    state.sync.endpoint = config.endpoint;
    state.sync.authToken = config.authToken || null;
    state.sync.userId = config.userId || null;
    state.sync.enabled = true;

    events.emit('sync:enabled', { endpoint: config.endpoint });

    if (isOnline()) {
        scheduleFlush();
    }
    return true;
}

export function disableCloudSync() {
    state.sync.enabled = false;
    state.sync.authToken = null;
    state.sync.userId = null;
    clearTimeout(_retryTimer);
    _retryTimer = null;
    events.emit('sync:disabled', {});
}

// ═══════════════════════════════════════════════════════════════════════════
// Crash Recovery
// ═══════════════════════════════════════════════════════════════════════════

/**
 * بازیابی opهای in-flight.
 *
 * اگر مرورگر در وسط flush بسته شود، opها با status='in-flight' در IDB می‌مانند.
 * این تابع آن‌ها را به 'pending' برمی‌گرداند تا دوباره تلاش شوند.
 */
async function recoverInFlightOps() {
    try {
        const ops = await readAllOps();
        const toRecover = ops.filter(op => op.status === 'in-flight');
        for (const op of toRecover) {
            op.status = 'pending';
            await putOp(op);
        }
        if (toRecover.length > 0) {
            console.log(`sync-queue: recovered ${toRecover.length} in-flight ops`);
        }
    } catch (err) {
        console.warn('sync-queue: recoverInFlightOps failed', err);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Auto Flush (Timer)
// ═══════════════════════════════════════════════════════════════════════════

function startAutoFlush() {
    if (_autoFlushTimer) return;
    _autoFlushTimer = setInterval(async () => {
        try {
            const size = await getQueueSize();
            if (size === 0) return;
            if (!state.sync.enabled) return;
            if (!isOnline()) return;
            // اگر در حال flush هستیم، صبر کن
            if (_flushing) return;
            // flush
            flushQueue().catch(() => {});
        } catch { /* silent */ }
    }, FLUSH_INTERVAL_MS);
}

function stopAutoFlush() {
    if (_autoFlushTimer) {
        clearInterval(_autoFlushTimer);
        _autoFlushTimer = null;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════════════════════════════════

/**
 * راه‌اندازی صف sync (async).
 *
 * این تابع:
 *   - IDB را باز می‌کند
 *   - opهای in-flight را بازیابی می‌کند
 *   - opهای خیلی قدیمی را پاک می‌کند
 *   - تایمر flush خودکار را راه می‌اندازد
 *   - به net:online گوش می‌دهد
 */
export async function initSyncQueue() {
    if (_started) return;
    _started = true;

    // مقداردهی اولیه‌ی state.sync
    state.sync = state.sync || {};
    state.sync.inFlight = false;
    state.sync.retries = state.sync.retries || 0;
    state.sync.lastFlushAt = null;
    state.sync.lastError = null;
    state.sync.enabled = state.sync.enabled === true;
    state.sync.deviceId = getDeviceId();

    // باز کردن IDB
    try {
        await openDb();
    } catch (err) {
        console.warn('sync-queue: IDB open failed', err);
        _started = false;
        return;
    }

    // بازیابی opهای in-flight
    await recoverInFlightOps();

    // پاک‌سازی opهای قدیمی
    await purgeOldOps();

    // emit اولیه برای UI
    const size = await getQueueSize();
    events.emit(EV.SYNC_QUEUE_CHANGED, { size });

    // گوش دادن به آنلاین شدن
    events.on(EV.NET_ONLINE, () => {
        if (state.sync.enabled && getQueueSize().then(s => s > 0)) {
            scheduleFlush();
        }
    });

    // گوش دادن به visibility
    if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && state.sync.enabled && isOnline()) {
                getQueueSize().then(s => {
                    if (s > 0) scheduleFlush();
                }).catch(() => {});
            }
        });
    }

    // تایمر flush خودکار
    startAutoFlush();

    // اگر sync فعال بود، اولین flush
    if (state.sync.enabled && isOnline() && size > 0) {
        setTimeout(() => {
            probeConnection({ force: true })
                .then(online => {
                    if (online) scheduleFlush();
                })
                .catch(() => {});
        }, 2000);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Backward-compat — adapter
// ═══════════════════════════════════════════════════════════════════════════

/**
 * تبدیل entry قدیمی store.js به op جدید.
 */
export function adaptStoreEntry(oldEntry) {
    if (!oldEntry || typeof oldEntry !== 'object') return null;
    const { type, id, data, parentId, timestamp } = oldEntry;
    if (!type || id === undefined) return null;
    return {
        id: oldEntry.opId || uid(),
        type,
        entityId: String(id),
        entityType: parentId ? 'child' : 'task',
        data: data || null,
        parentId: parentId ? String(parentId) : null,
        timestamp: timestamp || new Date().toISOString(),
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// پایان sync-queue.js
// ═══════════════════════════════════════════════════════════════════════════