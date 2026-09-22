// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// media-upload.js -- صف آپلود Media به ParsPack
//
// این ماژول:
//   - enqueueUpload(): افزودن یک media به صف آپلود
//   - processQueue(): پردازش صف (presign → PUT → confirm)
//   - getUploadStatus(): وضعیت یک media
//   - retryFailed(): تلاش مجدد برای آپلودهای ناموفق
//
// ⚠️ طبق قاعده‌ی ۲۵.۹ (قرارداد مرکزی Sync):
//   - enqueue در sync_queue (IDB) است
//   - ولی flow آپلود متفاوت است:
//       1. POST /api/media/upload  → presigned URL
//       2. PUT <presigned>          → آپلود واقعی
//       3. POST /api/media/:id/confirm → تأیید
//   - فقط مرحله ۳ در sync_log ثبت می‌شود (در Worker)
//   - مرحله ۱ presign است (استثنا)
//
// ⚠️ چرا ماژول جدا؟
//   - sync-queue.js برای task ops است (idempotent، سریع)
//   - media-upload.js برای file upload است (کند، retryable)
//   - جدا نگه‌داشتن، هر دو را ساده‌تر می‌کند
//
// ⚠️ وابستگی‌ها:
//   - state.sync.authToken (از auth.js)
//   - state.sync.enabled (باید true باشد)
//   - isOnline() (از net.js)
//   - events (از events.js)
//   - state.sync.endpoint
//
// ⚠️ مدل داده در IDB:
//   Object Store: media_uploads (keyPath: 'mediaId')
//   Index: status (pending | uploading | uploaded | failed)
//   Index: timestamp
//
// ⚠️ Lifecycle:
//   pending → uploading → uploaded (موفق)
//   pending → uploading → failed (بعد از max retries)
//   failed → pending (retry دستی یا خودکار)
// ═══════════════════════════════════════════════════════════════════════════

import { state, uid } from './core.js';
import { events, EV } from './events.js';
import { isOnline } from './net.js';

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const IDB_NAME = 'spaceTodoDB';
const IDB_MEDIA_UPLOADS = 'media_uploads';
const IDB_VERSION = 4; // ⚠️ بالا رفت از ۳ به ۴

/** حداکثر تلاش مجدد برای هر آپلود */
const MAX_UPLOAD_RETRIES = 5;

/** تأخیر پایه برای exponential backoff (ms) */
const RETRY_BASE_DELAY_MS = 3000;

/** حداکثر تأخیر (ms) — ۵ دقیقه */
const RETRY_MAX_DELAY_MS = 5 * 60 * 1000;

/** فاصله‌ی پردازش خودکار صف (ms) — ۱۵ ثانیه */
const PROCESS_INTERVAL_MS = 15000;

/** timeout برای PUT به Storage (ms) — ۶۰ ثانیه */
const PUT_TIMEOUT_MS = 60 * 1000;

// ═══════════════════════════════════════════════════════════════════════════
// Local state
// ═══════════════════════════════════════════════════════════════════════════

/** @type {boolean} — محافظ loop: آیا processQueue در حال اجراست؟ */
let _processing = false;

/** @type {boolean} — محافظ loop: آیا timer فعال است؟ */
let _timerActive = false;

/** @type {number|null} */
let _timerId = null;

/** @type {IDBDatabase|null} */
let _db = null;

/** @type {boolean} */
let _started = false;

// ═══════════════════════════════════════════════════════════════════════════
// IndexedDB
// ═══════════════════════════════════════════════════════════════════════════

/**
 * باز کردن IDB (یا گرفتن instance موجود).
 *
 * ⚠️ این تابع idempotent است.
 * ⚠️ IDB_VERSION = 4 (بالا رفت از ۳).
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

            // ─── Object stores موجود (tasks, trash, sync_queue) ───
            if (!db.objectStoreNames.contains('tasks')) {
                db.createObjectStore('tasks', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('trash')) {
                db.createObjectStore('trash', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('sync_queue')) {
                const syncStore = db.createObjectStore('sync_queue', { keyPath: 'id' });
                syncStore.createIndex('status', 'status', { unique: false });
                syncStore.createIndex('timestamp', 'timestamp', { unique: false });
            }

            // ─── Object store جدید: media_uploads ───
            if (!db.objectStoreNames.contains(IDB_MEDIA_UPLOADS)) {
                const mediaStore = db.createObjectStore(IDB_MEDIA_UPLOADS, { keyPath: 'mediaId' });
                mediaStore.createIndex('status', 'status', { unique: false });
                mediaStore.createIndex('timestamp', 'timestamp', { unique: false });
                mediaStore.createIndex('taskId', 'taskId', { unique: false });
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
 * خواندن یک upload با mediaId.
 */
async function getUpload(mediaId) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_MEDIA_UPLOADS, 'readonly');
        const req = tx.objectStore(IDB_MEDIA_UPLOADS).get(mediaId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

/**
 * نوشتن یک upload.
 */
async function putUpload(upload) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_MEDIA_UPLOADS, 'readwrite');
        tx.objectStore(IDB_MEDIA_UPLOADS).put(upload);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * حذف یک upload.
 */
async function deleteUpload(mediaId) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_MEDIA_UPLOADS, 'readwrite');
        tx.objectStore(IDB_MEDIA_UPLOADS).delete(mediaId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * خواندن همه‌ی uploadها.
 */
async function readAllUploads() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_MEDIA_UPLOADS, 'readonly');
        const req = tx.objectStore(IDB_MEDIA_UPLOADS).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API — وضعیت
// ═══════════════════════════════════════════════════════════════════════════

/**
 * گرفتن وضعیت یک آپلود.
 *
 * @param {string} mediaId
 * @returns {Promise<object|null>}
 */
export async function getUploadStatus(mediaId) {
    try {
        return await getUpload(mediaId);
    } catch {
        return null;
    }
}

/**
 * گرفتن همه‌ی آپلودهای یک task.
 *
 * @param {string} taskId
 * @returns {Promise<object[]>}
 */
export async function getUploadsByTask(taskId) {
    try {
        const all = await readAllUploads();
        return all.filter(u => u.taskId === taskId);
    } catch {
        return [];
    }
}

/**
 * شمارش آپلودهای در انتظار (pending + uploading + failed).
 */
export async function getPendingUploadCount() {
    try {
        const all = await readAllUploads();
        return all.filter(u => u.status !== 'uploaded').length;
    } catch {
        return 0;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API — enqueue
// ═══════════════════════════════════════════════════════════════════════════

/**
 * افزودن یک media به صف آپلود.
 *
 * ⚠️ این تابع در `store.js` یا `detail.js` صدا زده می‌شود.
 *
 * @param {object} params
 * @param {string} params.mediaId — UUID از client (id در task.photos)
 * @param {string} params.taskId — UUID task
 * @param {string} params.contentType — MIME
 * @param {number} params.sizeBytes — حجم
 * @param {Blob} params.blob — خود فایل
 * @param {string} [params.groupId]
 * @param {string} [params.messageId]
 * @returns {Promise<object>} — upload record
 */
export async function enqueueUpload(params) {
    const mediaId = params.mediaId || uid();

    const upload = {
        mediaId,
        taskId: params.taskId,
        groupId: params.groupId || null,
        messageId: params.messageId || null,
        contentType: params.contentType,
        sizeBytes: params.sizeBytes,
        blob: params.blob,
        // ─── State ───
        status: 'pending', // pending | uploading | uploaded | failed
        retries: 0,
        lastError: null,
        // ─── Server-side ID (بعد از presign) ───
        serverMediaId: null,
        uploadUrl: null,
        uploadUrlExpiresAt: null,
        // ─── Timestamps ───
        timestamp: new Date().toISOString(),
        enqueuedAt: new Date().toISOString(),
        uploadedAt: null,
        confirmedAt: null,
    };

    await putUpload(upload);

    events.emit('media:upload-enqueued', { mediaId, taskId: params.taskId });

    // ─── سعی کن فوراً پردازش کنی ───
    scheduleProcess();

    return upload;
}

// ═══════════════════════════════════════════════════════════════════════════
// Processing
// ═══════════════════════════════════════════════════════════════════════════

/**
 * زمان‌بندی پردازش صف.
 */
function scheduleProcess() {
    if (_timerActive) return;
    _timerActive = true;
    setTimeout(() => {
        _timerActive = false;
        processQueue().catch(err => {
            console.warn('[media-upload] processQueue failed:', err);
        });
    }, 500);
}

/**
 * پردازش صف آپلود.
 *
 * ⚠️ این تابع:
 *   1. بررسی می‌کند که auth + online باشد
 *   2. همه‌ی uploadهای pending را می‌گیرد
 *   3. برای هرکدام flow کامل را انجام می‌دهد
 *
 * @returns {Promise<{ processed: number, failed: number }>}
 */
export async function processQueue() {
    if (_processing) {
        return { processed: 0, failed: 0 };
    }

    // ─── بررسی پیش‌نیازها ───
    if (!state.sync.enabled || !state.sync.authToken) {
        return { processed: 0, failed: 0 };
    }
    if (!isOnline()) {
        return { processed: 0, failed: 0 };
    }

    _processing = true;
    let processed = 0;
    let failed = 0;

    try {
        const uploads = await readAllUploads();
        const pending = uploads.filter(u => u.status === 'pending' || u.status === 'failed');

        for (const upload of pending) {
            if (!isOnline()) break;
            if (!state.sync.enabled || !state.sync.authToken) break;

            // ─── اگر retry خیلی زیاد شده، رد کن ───
            if (upload.retries >= MAX_UPLOAD_RETRIES) {
                continue;
            }

            try {
                await processOne(upload);
                processed++;
            } catch (err) {
                failed++;
                upload.retries = (upload.retries || 0) + 1;
                upload.lastError = err instanceof Error ? err.message : 'unknown';
                upload.status = 'failed';
                await putUpload(upload);

                events.emit('media:upload-failed', {
                    mediaId: upload.mediaId,
                    taskId: upload.taskId,
                    error: upload.lastError,
                    retries: upload.retries,
                });
            }
        }
    } finally {
        _processing = false;
    }

    return { processed, failed };
}

/**
 * پردازش یک upload.
 *
 * @param {object} upload
 */
async function processOne(upload) {
    const mediaId = upload.mediaId;

    // ─── مرحله ۱: presign (اگر هنوز نگرفته‌ایم) ───
    if (!upload.serverMediaId || !upload.uploadUrl || isUrlExpired(upload.uploadUrlExpiresAt)) {
        await stepPresign(upload);
    }

    // ─── مرحله ۲: PUT به Storage ───
    await stepUpload(upload);

    // ─── مرحله ۳: confirm ───
    await stepConfirm(upload);

    // ─── موفق ───
    upload.status = 'uploaded';
    upload.confirmedAt = new Date().toISOString();
    await putUpload(upload);

    events.emit('media:upload-complete', {
        mediaId: upload.mediaId,
        taskId: upload.taskId,
        serverMediaId: upload.serverMediaId,
    });
}

/**
 * بررسی منقضی شدن presigned URL.
 */
function isUrlExpired(expiresAt) {
    if (!expiresAt) return true;
    const ms = new Date(expiresAt).getTime();
    if (!Number.isFinite(ms)) return true;
    return Date.now() >= ms - 30000; // ۳۰ ثانیه قبل از انقضا
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 1: Presign
// ═══════════════════════════════════════════════════════════════════════════

async function stepPresign(upload) {
    upload.status = 'uploading';
    await putUpload(upload);

    const endpoint = state.sync.endpoint;
    const token = state.sync.authToken;

    const response = await fetch(`${endpoint}/api/media/upload`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
            taskId: upload.taskId,
            groupId: upload.groupId,
            messageId: upload.messageId,
            contentType: upload.contentType,
            size: upload.sizeBytes,
        }),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || !data || data.ok !== true) {
        const msg = data?.error?.message || `HTTP ${response.status}`;
        throw new Error(`presign failed: ${msg}`);
    }

    // ⚠️ فیلدها بر اساس handlers/media.ts (Stage C):
    upload.serverMediaId = data.data.mediaId;
    upload.uploadUrl = data.data.uploadUrl;
    const ttlSeconds = data.data.expiresIn || 900;
    upload.uploadUrlExpiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

    await putUpload(upload);
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 2: Upload (PUT)
// ═══════════════════════════════════════════════════════════════════════════

async function stepUpload(upload) {
    if (!upload.uploadUrl) {
        throw new Error('no uploadUrl');
    }
    if (!upload.blob) {
        throw new Error('no blob');
    }

    // ─── AbortController برای timeout ───
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PUT_TIMEOUT_MS);

    try {
        const response = await fetch(upload.uploadUrl, {
            method: 'PUT',
            headers: {
                'Content-Type': upload.contentType,
            },
            body: upload.blob,
            signal: controller.signal,
        });

        if (!response.ok) {
            throw new Error(`PUT failed: HTTP ${response.status}`);
        }

        upload.uploadedAt = new Date().toISOString();
        await putUpload(upload);
    } finally {
        clearTimeout(timeoutId);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 3: Confirm
// ═══════════════════════════════════════════════════════════════════════════

async function stepConfirm(upload) {
    if (!upload.serverMediaId) {
        throw new Error('no serverMediaId');
    }

    const endpoint = state.sync.endpoint;
    const token = state.sync.authToken;

    const response = await fetch(
        `${endpoint}/api/media/${upload.serverMediaId}/confirm`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
        }
    );

    const data = await response.json().catch(() => null);

    if (!response.ok || !data || data.ok !== true) {
        const msg = data?.error?.message || `HTTP ${response.status}`;
        throw new Error(`confirm failed: ${msg}`);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Retry
// ═══════════════════════════════════════════════════════════════════════════

/**
 * تلاش مجدد برای آپلودهای ناموفق.
 *
 * @returns {Promise<{ retried: number }>}
 */
export async function retryFailedUploads() {
    const uploads = await readAllUploads();
    const failed = uploads.filter(u => u.status === 'failed' && u.retries < MAX_UPLOAD_RETRIES);

    for (const upload of failed) {
        upload.status = 'pending';
        upload.lastError = null;
        await putUpload(upload);
    }

    if (failed.length > 0) {
        scheduleProcess();
    }

    return { retried: failed.length };
}

// ═══════════════════════════════════════════════════════════════════════════
// Cleanup
// ═══════════════════════════════════════════════════════════════════════════

/**
 * حذف یک upload از صف (مثلاً اگر کاربر عکس را حذف کرد قبل از آپلود).
 */
export async function cancelUpload(mediaId) {
    try {
        await deleteUpload(mediaId);
    } catch (err) {
        console.warn('[media-upload] cancelUpload failed:', err);
    }
}

/**
 * حذف آپلودهای موفق قدیمی‌تر از N روز.
 */
async function purgeOldUploads() {
    try {
        const uploads = await readAllUploads();
        const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000; // ۷ روز
        let purged = 0;

        for (const upload of uploads) {
            if (upload.status !== 'uploaded') continue;
            const t = Date.parse(upload.confirmedAt || upload.uploadedAt || upload.timestamp);
            if (Number.isFinite(t) && t < cutoff) {
                await deleteUpload(upload.mediaId);
                purged++;
            }
        }

        if (purged > 0) {
            console.log(`[media-upload] purged ${purged} old uploads`);
        }
    } catch (err) {
        console.warn('[media-upload] purgeOldUploads failed:', err);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Auto-process timer
// ═══════════════════════════════════════════════════════════════════════════

function startAutoProcess() {
    if (_timerId) return;
    _timerId = setInterval(async () => {
        try {
            if (!state.sync.enabled) return;
            if (!isOnline()) return;
            if (_processing) return;

            const pending = await getPendingUploadCount();
            if (pending === 0) return;

            await processQueue();
        } catch {
            // silent
        }
    }, PROCESS_INTERVAL_MS);
}

function stopAutoProcess() {
    if (_timerId) {
        clearInterval(_timerId);
        _timerId = null;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════════════════════════════════

/**
 * راه‌اندازی ماژول.
 *
 * این تابع:
 *   - IDB را باز می‌کند
 *   - آپلودهای in-flight را به pending برمی‌گرداند (crash recovery)
 *   - پاک‌سازی آپلودهای قدیمی
 *   - timer پردازش خودکار
 *   - به net:online گوش می‌دهد
 *
 * ⚠️ idempotent است.
 */
export async function initMediaUpload() {
    if (_started) return;
    _started = true;

    try {
        await openDb();
    } catch (err) {
        console.warn('[media-upload] IDB open failed:', err);
        _started = false;
        return;
    }

    // ─── Crash recovery ───
    try {
        const uploads = await readAllUploads();
        let recovered = 0;
        for (const upload of uploads) {
            if (upload.status === 'uploading') {
                upload.status = 'pending';
                await putUpload(upload);
                recovered++;
            }
        }
        if (recovered > 0) {
            console.log(`[media-upload] recovered ${recovered} in-flight uploads`);
        }
    } catch (err) {
        console.warn('[media-upload] crash recovery failed:', err);
    }

    // ─── پاک‌سازی ───
    await purgeOldUploads();

    // ─── timer ───
    startAutoProcess();

    // ─── net:online ───
    events.on(EV.NET_ONLINE, () => {
        if (state.sync.enabled) {
            scheduleProcess();
        }
    });

    // ─── auth:login ───
    events.on('auth:login', () => {
        scheduleProcess();
    });

    // ─── visibilitychange ───
    if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden && state.sync.enabled && isOnline()) {
                getPendingUploadCount().then(count => {
                    if (count > 0) scheduleProcess();
                }).catch(() => {});
            }
        });
    }

    // ─── اولین پردازش ───
    if (state.sync.enabled && isOnline()) {
        setTimeout(() => scheduleProcess(), 2000);
    }
}

/**
 * توقف timer (فقط برای تست).
 */
export function stopMediaUpload() {
    stopAutoProcess();
    _started = false;
}

// ═══════════════════════════════════════════════════════════════════════════
// پایان media-upload.js
// ═══════════════════════════════════════════════════════════════════════════