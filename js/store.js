// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// store.js -- IndexedDB + CRUD actions (ESM) — فاز ۵ گام ۵
//
// ⚠️ این نسخه:
//   - exportTasks() و importTasks() را دارد
//   - صف تغییرات از syncQueue استفاده می‌کند (نه صف داخلی)
//   - سازگاری کامل با loadPendingChanges / getPendingChanges
// ═══════════════════════════════════════════════════════════════════════════

import {
    state,
    MAX_LENGTH,
    uid,
    escapeHtml,
    SCHEMA_VERSION,
    computeChecksum
} from './core.js';
import { sameMinute, nearestUpcoming, allSessions, hasSessionAt, visibleChildren } from './sessions.js';
import { getNow } from './time.js';
import { events, EV, CALLBACK_TO_EVENT } from './events.js';
import {
    enqueue as syncEnqueue,
    getQueue as getSyncQueue,
    clearQueue as clearSyncQueue
} from './sync-queue.js';
import {
    enqueueUpload as enqueueMediaUpload,
} from './media-upload.js';
import { formatNumber } from './i18n.js';

// ═══════════════════════════════════════════════════════════════════════════
// ثابت‌های Media (Stage D)
// ═══════════════════════════════════════════════════════════════════════════
//
// ⚠️ چرا این‌ها اینجا تعریف می‌شوند؟
//   - media.js تابع‌های پردازش را دارد، ولی ثابت‌های محدودیت اینجا لازم است
//   - جلوگیری از circular import (media.js از store.js import نمی‌کند)
//   - مقادیر باید با media.js هم‌خوانی داشته باشند

/**
 * حداکثر تعداد عکس در هر task.
 * ⚠️ باید با MEDIA_LIMITS.MAX_MEDIA_PER_TASK در Worker هم‌خوان باشد.
 */
const MAX_PHOTOS_PER_TASK = 8;

/**
 * حداکثر طول dataUrl در IndexedDB.
 *
 * ⚠️ در Stage D، عکس‌ها هنوز به ParsPack نمی‌روند.
 *    به‌جای آن، dataUrl در photos[].dataUrl ذخیره می‌شود.
 *
 * ⚠️ محاسبه: یک dataUrl base64 حدود ۱.۳۳ برابر حجم اصلی است.
 *    اگر عکس اصلی تا ۵MB باشد (ورودی)، dataUrl تا ۶.۷MB می‌شود.
 *    عدد ۱۰MB سقف امن است (کمی محافظه‌کارانه).
 *
 * ⚠️ در Stage E، photos[].dataUrl با mediaIds[] جایگزین می‌شود
 *    و این محدودیت بی‌معنی می‌شود.
 */
const MAX_PHOTO_DATAURL_LENGTH = 10 * 1024 * 1024; // 10MB

// ═══════════════════════════════════════════════════════════════════════════
// Map helpers — set by app.js during boot
// ═══════════════════════════════════════════════════════════════════════════

const _mapHelpers = {
    getMap: () => null,
    getMapReady: () => false,
    getPickMarker: () => null,
    setPickMarker: () => {}
};

export function setMapHelpers(helpers) {
    if (!helpers || typeof helpers !== 'object') return;
    if (typeof helpers.getMap === 'function') _mapHelpers.getMap = helpers.getMap;
    if (typeof helpers.getMapReady === 'function') _mapHelpers.getMapReady = helpers.getMapReady;
    if (typeof helpers.getPickMarker === 'function') _mapHelpers.getPickMarker = helpers.getPickMarker;
    if (typeof helpers.setPickMarker === 'function') _mapHelpers.setPickMarker = helpers.setPickMarker;
}

// ═══════════════════════════════════════════════════════════════════════════
// call() / invoke()
// ═══════════════════════════════════════════════════════════════════════════

function call(name, ...args) {
    const eventName = CALLBACK_TO_EVENT[name];
    if (!eventName) {
        console.warn(`store.call: unknown callback "${name}"`);
        return;
    }
    events.emit(eventName, ...args);
}

function invoke(name, ...args) {
    const eventName = CALLBACK_TO_EVENT[name];
    if (!eventName) {
        console.warn(`store.invoke: unknown callback "${name}"`);
        return undefined;
    }
    const listeners = events._listeners.get(eventName);
    if (!listeners || listeners.size === 0) return undefined;
    let result;
    for (const listener of listeners) {
        try {
            const r = listener(...args);
            if (r !== undefined) {
                result = r;
                break;
            }
        } catch (err) {
            console.error(`store.invoke: listener for "${eventName}" threw:`, err);
        }
    }
    return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// IndexedDB
// ═══════════════════════════════════════════════════════════════════════════

const IDB_NAME = 'spaceTodoDB';
const IDB_STORE = 'tasks';
const IDB_TRASH = 'trash';
/**
 * ⚠️ تاریخچه:
 *   ۱ → فقط tasks
 *   ۲ → + trash
 *   ۳ → + sync_queue
 *   ۴ → + media_uploads (Stage E)
 */
const IDB_VERSION = 4;
const useIDB = typeof indexedDB !== 'undefined';
let idbPromise = null;

function idbOpen() {
    if (!useIDB) return Promise.reject(new Error('no-indexeddb'));
    if (!idbPromise) {
        idbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(IDB_NAME, IDB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(IDB_STORE)) {
                    db.createObjectStore(IDB_STORE, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(IDB_TRASH)) {
                    db.createObjectStore(IDB_TRASH, { keyPath: 'id' });
                }
                // ⚠️ Phase 4: اضافه‌کردن sync_queue به onupgradeneeded
                // (تا اگر store.js اول باز کند، sync_queue هم ساخته شود)
                if (!db.objectStoreNames.contains('sync_queue')) {
                    const syncStore = db.createObjectStore('sync_queue', { keyPath: 'id' });
                    syncStore.createIndex('status', 'status', { unique: false });
                    syncStore.createIndex('timestamp', 'timestamp', { unique: false });
                }
                // ⚠️ Stage E: اضافه‌کردن media_uploads به onupgradeneeded
                // (تا اگر store.js اول باز کند، media_uploads هم ساخته شود)
                if (!db.objectStoreNames.contains('media_uploads')) {
                    const mediaStore = db.createObjectStore('media_uploads', { keyPath: 'mediaId' });
                    mediaStore.createIndex('status', 'status', { unique: false });
                    mediaStore.createIndex('timestamp', 'timestamp', { unique: false });
                    mediaStore.createIndex('taskId', 'taskId', { unique: false });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }
    return idbPromise;
}

function idbGetAll(storeName) {
    return idbOpen().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const rq = tx.objectStore(storeName).getAll();
        rq.onsuccess = () => resolve(rq.result || []);
        rq.onerror = () => reject(rq.error);
    }));
}

function idbPutAll(storeName, items, opts) {
    const options = opts || {};
    return idbOpen().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        if (items.length > 0 || options.allowEmptyClear) {
            store.clear();
            items.forEach(item => store.put(item));
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    }));
}

function idbPut(storeName, item) {
    return idbOpen().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(item);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    }));
}

function idbDelete(storeName, id) {
    return idbOpen().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    }));
}

// ═══════════════════════════════════════════════════════════════════════════
// Sanitization
// ═══════════════════════════════════════════════════════════════════════════

function sanitizeBilingualNames(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const out = {};
    if (typeof obj.fa === 'string' && obj.fa.trim()) out.fa = obj.fa.trim().replace(/\s+/g, ' ').slice(0, 80);
    if (typeof obj.en === 'string' && obj.en.trim()) out.en = obj.en.trim().replace(/\s+/g, ' ').slice(0, 80);
    return Object.keys(out).length ? out : null;
}

export function validLoc(v) {
    if (!v || !Number.isFinite(+v.lat) || !Number.isFinite(+v.lng) ||
        Math.abs(+v.lat) > 90 || Math.abs(+v.lng) > 180) {
        return null;
    }
    const out = { lat: +v.lat, lng: +v.lng };
    if (typeof v.name === 'string' && v.name.trim()) {
        out.name = v.name.trim().replace(/\s+/g, ' ').slice(0, 80);
    } else {
        out.name = null;
    }
    const names = sanitizeBilingualNames(v.names);
    if (names) out.names = names;
    const cityNames = sanitizeBilingualNames(v.cityNames);
    if (cityNames) out.cityNames = cityNames;
    return out;
}

export function sanitizeUrl(raw) {
    if (typeof raw !== 'string') return '';
    const v = raw.trim().slice(0, 300);
    if (!v) return '';

    if (/^[a-z][a-z0-9+.-]*:/i.test(v)) {
        try {
            const u = new URL(v);
            if (!['http:', 'https:'].includes(u.protocol)) return '';
            return u.href.slice(0, 300);
        } catch {
            return '';
        }
    }

    if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/i.test(v)) {
        try {
            const u = new URL('https://' + v);
            if (!['http:', 'https:'].includes(u.protocol)) return '';
            return u.href.slice(0, 300);
        } catch {
            return '';
        }
    }

    return '';
}

export function sanitizeTask(t) {
    const sessions = Array.isArray(t.sessions)
        ? t.sessions
            .filter(s => s && typeof s.at === 'string' && !isNaN(new Date(s.at)))
            .map(s => ({
                id: typeof s.id !== 'undefined' ? s.id : uid(),
                at: s.at,
                reminded: Boolean(s.reminded),
                remindedDue: Boolean(s.remindedDue),
                location: validLoc(s.location),
                remindMin: (s.remindMin === null || s.remindMin === undefined) ? null
                    : (Number.isFinite(+s.remindMin) && +s.remindMin >= 0 ? Math.floor(+s.remindMin) : null)
            }))
        : [];
    for (let i = sessions.length - 1; i >= 0; i--) {
        if (sessions.findIndex(x => sameMinute(x.at, sessions[i].at)) !== i) sessions.splice(i, 1);
    }
    if (sessions.length === 0 && typeof t.dueAt === 'string' && !isNaN(new Date(t.dueAt))) {
        sessions.push({ id: uid(), at: t.dueAt });
    }
    const kind = (t.kind === 'plan' || t.kind === 'group')
        ? 'plan'
        : (t.kind === 'series' ? 'series' : 'task');
    const children = kind === 'plan' && Array.isArray(t.children)
        ? t.children
            .filter(c => c && typeof c.id !== 'undefined' && typeof c.text === 'string' && c.text.trim() !== '' && c.kind !== 'plan')
            .map(c => sanitizeTask({ ...c, kind: 'task', children: undefined }))
        : [];
    return {
        id: t.id,
        text: String(t.text).slice(0, MAX_LENGTH),
        completed: Boolean(t.completed),
        priority: ['high', 'medium', 'low'].includes(t.priority) ? t.priority : 'medium',
        createdAt: typeof t.createdAt === 'string' ? t.createdAt : new Date().toISOString(),
        completedAt: (typeof t.completedAt === 'string' && !isNaN(new Date(t.completedAt))) ? t.completedAt : null,
        timeSpent: Number.isFinite(+t.timeSpent) && +t.timeSpent > 0 ? Math.floor(+t.timeSpent) : 0,
        timerStartedAt: (typeof t.timerStartedAt === 'string' && !isNaN(new Date(t.timerStartedAt))) ? t.timerStartedAt : null,
        startAt: (typeof t.startAt === 'string' && !isNaN(new Date(t.startAt))) ? t.startAt : null,
        endAt: (typeof t.endAt === 'string' && !isNaN(new Date(t.endAt))) ? t.endAt : null,
        description: typeof t.description === 'string' ? t.description.slice(0, 1000) : '',
        phone: typeof t.phone === 'string' ? t.phone.slice(0, 20) : '',
        address: typeof t.address === 'string' ? t.address.slice(0, 500) : '',
        url: sanitizeUrl(t.url),
        sessions,
        kind,
        children,
        pinned: Boolean(t.pinned),
        recur: ['daily', 'weekly', 'monthly', 'custom', 'hourly', 'weeklyDays', 'monthlyDays'].includes(t.recur) ? t.recur : 'none',
        recurN: (Number.isFinite(+t.recurN) && +t.recurN >= 1 && +t.recurN <= 365) ? Math.floor(+t.recurN) : null,
        recurDays: Array.isArray(t.recurDays) ? [...new Set(t.recurDays.map(x => Math.floor(+x)).filter(x => x >= 0 && x <= 31))].slice(0, 31) : [],
        archived: Boolean(t.archived),
        photos: Array.isArray(t.photos) ? t.photos
            .filter(p => p && typeof p.dataUrl === 'string' && p.dataUrl.startsWith('data:image') && p.dataUrl.length < MAX_PHOTO_DATAURL_LENGTH)
            .slice(0, MAX_PHOTOS_PER_TASK)
            .map(p => {
                const out = {
                    id: typeof p.id !== 'undefined' ? p.id : uid(),
                    dataUrl: p.dataUrl,
                    addedAt: typeof p.addedAt === 'string' ? p.addedAt : new Date().toISOString(),
                };
                // ⚠️ فیلدهای Stage D (اختیاری)
                if (typeof p.contentType === 'string') out.contentType = p.contentType;
                if (Number.isFinite(+p.sizeBytes)) out.sizeBytes = Math.floor(+p.sizeBytes);
                if (Number.isFinite(+p.width)) out.width = Math.floor(+p.width);
                if (Number.isFinite(+p.height)) out.height = Math.floor(+p.height);
                return out;
            })
            : [],
        /**
         * ⚠️ Stage E: mediaIds — اشاره به media_objects در D1.
         *
         * این آرایه، شناسه‌های عکس‌های آپلودشده در سرور است.
         * در Stage E، موازی با photos.dataUrl نگه داشته می‌شود.
         * در مرحله‌ی بعدی (پس از Stage E)، photos.dataUrl حذف می‌شود
         * و فقط mediaIds می‌ماند.
         *
         * ⚠️ قاعده: هر mediaId باید UUID معتبر باشد.
         * ⚠️ حداکثر MAX_PHOTOS_PER_TASK (۸).
         */
        mediaIds: Array.isArray(t.mediaIds)
            ? t.mediaIds
                .filter(id => typeof id === 'string' && id.length > 0 && id.length < 100)
                .slice(0, MAX_PHOTOS_PER_TASK)
            : [],
        location: validLoc(t.location)
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ صف تغییرات — از syncQueue استفاده می‌کند
// ═══════════════════════════════════════════════════════════════════════════

/**
 * افزودن یک تغییر به صف sync (با adapter به فرمت syncQueue).
 *
 * @param {object} entry
 */
/**
 * افزودن یک تغییر به صف sync (async).
 *
 * ⚠️ در Phase 4، این تابع async است چون syncEnqueue حالا
 *    به IndexedDB می‌نویسد.
 *
 * ⚠️ ما این تابع را await نمی‌کنیم چون caller نمی‌خواهد صبر کند.
 *    عملیات در پس‌زمینه انجام می‌شود.
 */
function enqueueChange(entry) {
    if (!entry || !entry.type) return;
    syncEnqueue({
        type: entry.type,
        entityId: String(entry.id ?? entry.entityId ?? ''),
        entityType: entry.parentId ? 'child' : 'task',
        data: entry.data || null,
        parentId: entry.parentId ? String(entry.parentId) : null
    }).catch(err => {
        console.error('enqueueChange failed:', err);
    });
}

/**
 * پاک کردن صف (برای بعد از import موفق).
 */
export function clearPendingChanges() {
    clearSyncQueue().catch(err => {
        console.warn('clearPendingChanges failed:', err);
    });
    state.pendingChanges = [];
    events.emit('sync:queue-cleared');
}

/**
 * خواندن صف (برای دیباگ).
 * @returns {object[]}
 */
export async function getPendingChanges() {
    try {
        return await getSyncQueue();
    } catch {
        return [];
    }
}

/**
 * بارگذاری صف از localStorage.
 * ⚠️ در فاز ۵ گام ۵، این کار توسط initSyncQueue() انجام می‌شود.
 * این تابع فقط برای سازگاری نگه داشته شده.
 */
/**
 * @deprecated — در Phase 4، initSyncQueue خودش IDB را بارگذاری می‌کند.
 * این تابع فقط برای backward-compat نگه داشته شده و no-op است.
 */
export function loadPendingChanges() {
    // no-op
}

// ═══════════════════════════════════════════════════════════════════════════
// Load / Save
// ═══════════════════════════════════════════════════════════════════════════

export async function loadTasks() {
    let raw = [];
    if (useIDB) {
        try {
            raw = await idbGetAll(IDB_STORE);
        } catch {
            raw = [];
        }
    }
    state.tasks = raw
        .filter(t => t && typeof t.id !== 'undefined' && typeof t.text === 'string' && t.text.trim() !== '')
        .map(sanitizeTask);
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── Transactional Outbox (Phase 4) ───
// ═══════════════════════════════════════════════════════════════════════════
//
// ⚠️ چرا این تابع؟
//   در نسخه‌ی قبلی، saveTask و enqueueChange دو تراکنش جدا بودند:
//     ۱. idbPut(task)        ← تراکنش ۱
//     ۲. syncEnqueue(op)     ← تراکنش ۲
//   اگر بین ۱ و ۲ مرورگر crash کند، task ذخیره می‌شود ولی op از دست می‌رود.
//
//   این تابع هر دو را در یک transaction انجام می‌دهد:
//     BEGIN TRANSACTION [tasks, sync_queue]
//       ۱. put(task)
//       ۲. put(op)
//     COMMIT
//
//   حالا یا هر دو ذخیره می‌شوند یا هیچ‌کدام.

/**
 * ذخیره‌ی یک task + enqueue در یک transaction (async).
 *
 * @param {object} task — task برای ذخیره
 * @param {object|null} parent — parent (اگر child باشد)
 * @returns {Promise<void>}
 */
async function saveTaskAndEnqueue(task, parent) {
    if (!task || typeof task.id === 'undefined') {
        throw new Error('saveTaskAndEnqueue: invalid task');
    }
    invalidateTaskIndex();

    const target = parent || task;

    if (!useIDB) {
        // Fallback: بدون IDB
        try {
            localStorage.setItem('spaceTodoTasks', JSON.stringify(state.tasks));
        } catch (e) {
            throw e;
        }
        await syncEnqueue({
            type: 'save',
            entityId: String(target.id),
            entityType: parent ? 'child' : 'task',
            data: target,
            parentId: parent ? String(parent.id) : null,
        });
        return;
    }

    // ─── IDB Transactional ───
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([IDB_STORE, 'sync_queue'], 'readwrite');
        const taskStore = tx.objectStore(IDB_STORE);
        const queueStore = tx.objectStore('sync_queue');

        // ۱. put task
        taskStore.put(target);

        // ۲. put op
        const op = {
            id: uid(),
            type: 'save',
            entityId: String(target.id),
            entityType: parent ? 'child' : 'task',
            data: target,
            parentId: parent ? String(parent.id) : null,
            timestamp: new Date().toISOString(),
            deviceId: state.sync?.deviceId || 'unknown',
            schemaVersion: SCHEMA_VERSION,
            retries: 0,
            lastError: null,
            status: 'pending',
            enqueuedAt: new Date().toISOString(),
        };
        queueStore.put(op);

        tx.oncomplete = () => {
            events.emit(EV.TASK_SAVED, { task, parent: parent || null });
            events.emit(EV.SYNC_ENQUEUED, { op });

            // ⚠️ Stage E: enqueue عکس‌های آپلودنشده در صف media
            // (اگر task عکس‌های جدید دارد که هنوز mediaId ندارند)
            enqueueNewPhotosForTask(target).catch(err => {
                console.warn('[store] enqueueNewPhotosForTask failed:', err);
            });

            resolve();
        };
        tx.onerror = () => {
            console.error('saveTaskAndEnqueue failed', tx.error);
            reject(tx.error);
        };
    });
}

/**
 * ⚠️ Stage E: افزودن عکس‌های جدید (که هنوز mediaId ندارند) به صف آپلود.
 *
 * این تابع:
 *   1. عکس‌های task که dataUrl دارند ولی هنوز در media_uploads نیستند را می‌گیرد
 *   2. برای هرکدام یک upload record می‌سازد
 *
 * ⚠️ این تابع async است ولی await نمی‌شود (fire-and-forget).
 *
 * ⚠️ Blob: برای ساخت Blob از dataUrl، از fetch استفاده می‌کنیم.
 *    این در همه‌ی مرورگرهای مدرن کار می‌کند.
 *
 * @param {object} task
 */
async function enqueueNewPhotosForTask(task) {
    if (!task || !Array.isArray(task.photos) || task.photos.length === 0) {
        return;
    }
    if (!state.sync.enabled || !state.sync.authToken) {
        // ─── اگر auth فعال نیست، هیچ کاری نمی‌کنیم ───
        // در این حالت، عکس‌ها فقط لوکال می‌مانند.
        return;
    }

    // ─── گرفتن mediaIdهای فعلی task ───
    const existingMediaIds = new Set(
        Array.isArray(task.mediaIds) ? task.mediaIds : []
    );

    for (const photo of task.photos) {
        // ⚠️ اگر photo.id قبلاً در mediaIds است، رد کن
        if (existingMediaIds.has(photo.id)) continue;
        if (!photo.id || !photo.dataUrl) continue;
        if (typeof photo.contentType !== 'string' || typeof photo.sizeBytes !== 'number') {
            // ⚠️ عکس‌های قدیمی (Stage D) بدون contentType/sizeBytes
            // نمی‌توانند آپلود شوند. باید دوباره پردازش شوند.
            continue;
        }

        // ─── تبدیل dataUrl به Blob ───
        let blob;
        try {
            const res = await fetch(photo.dataUrl);
            blob = await res.blob();
        } catch (err) {
            console.warn('[store] failed to convert dataUrl to blob:', err);
            continue;
        }

        // ─── enqueue در media-upload ───
        try {
            await enqueueMediaUpload({
                mediaId: photo.id,
                taskId: task.id,
                contentType: photo.contentType,
                sizeBytes: photo.sizeBytes,
                blob,
            });
        } catch (err) {
            console.warn('[store] enqueueMediaUpload failed:', err);
        }
    }
}
export function saveTask(task, parent) {
    if (!task || typeof task.id === 'undefined') {
        return Promise.reject(new Error('saveTask: invalid task'));
    }

    // ⚠️ Phase 4: استفاده از saveTaskAndEnqueue (transactional)
    const p = saveTaskAndEnqueue(task, parent);

    p.catch(err => {
        console.error('saveTask failed', err);
        events.emit(EV.STORAGE_ERROR, {
            message: 'خطا در ذخیره‌سازی محلی. ممکن است حافظه مرورگر پر شده باشد.'
        });
        if (!saveTask._warned) {
            saveTask._warned = true;
            window.dispatchEvent(new CustomEvent('rahe-storage-error', {
                detail: { message: 'خطا در ذخیره‌سازی محلی. ممکن است حافظه مرورگر پر شده باشد.' }
            }));
        }
    });
    return p;
}

export function deleteTaskFromStore(id) {
    invalidateTaskIndex();
    const p = useIDB
        ? idbDelete(IDB_STORE, id)
        : (function () {
            try {
                localStorage.setItem('spaceTodoTasks', JSON.stringify(state.tasks));
                return Promise.resolve();
            } catch (e) {
                return Promise.reject(e);
            }
        })();

    p.then(() => {
        enqueueChange({ type: 'delete', id });
    }).catch(err => {
        console.error('deleteTaskFromStore failed', err);
    });
    return p;
}

export function saveTasks() {
    const snapshot = state.tasks;
    invalidateTaskIndex();

    const p = useIDB
        ? idbPutAll(IDB_STORE, snapshot, { allowEmptyClear: true })
        : (function () {
            try {
                localStorage.setItem('spaceTodoTasks', JSON.stringify(snapshot));
                return Promise.resolve();
            } catch (e) {
                return Promise.reject(e);
            }
        })();
    p.then(() => {
        events.emit(EV.TASK_SAVED, { bulk: true });
    }).catch(() => {
        console.error('storage save failed (bulk)');
        events.emit(EV.STORAGE_ERROR, {
            message: 'خطا در ذخیره‌سازی محلی. ممکن است حافظه مرورگر پر شده باشد.'
        });
    });
    return p;
}

// ═══════════════════════════════════════════════════════════════════════════
// Export / Import
// ═══════════════════════════════════════════════════════════════════════════

export async function exportTasks(options) {
    const opts = options || {};
    const includePhotos = Boolean(opts.includePhotos);
    const includeSettings = Boolean(opts.includeSettings);

    const tasksSnapshot = state.tasks.map(t => {
        const copy = { ...t };
        if (!includePhotos) {
            copy.photos = [];
        } else {
            copy.photos = (t.photos || []).map(p => ({ ...p }));
        }
        if (Array.isArray(t.children)) {
            copy.children = t.children.map(c => {
                const childCopy = { ...c };
                if (!includePhotos) childCopy.photos = [];
                else childCopy.photos = (c.photos || []).map(p => ({ ...p }));
                return childCopy;
            });
        }
        return copy;
    });

    const trashSnapshot = state.trash.map(x => {
        const copy = { ...x };
        if (!includePhotos) {
            copy.photos = [];
        } else {
            copy.photos = (x.photos || []).map(p => ({ ...p }));
        }
        return copy;
    });

    const data = {
        tasks: tasksSnapshot,
        trash: trashSnapshot
    };

    let checksum = '';
    try {
        checksum = await computeChecksum(JSON.stringify(data));
    } catch {
        checksum = '';
    }

    const backup = {
        schemaVersion: SCHEMA_VERSION,
        appVersion: '1.4.0.2',
        exportedAt: new Date().toISOString(),
        options: {
            includePhotos,
            includeSettings
        },
        data,
        checksum
    };

    if (includeSettings) {
        backup.settings = {
            theme: state.prefs.theme,
            lang: state.prefs.lang,
            remindOn: state.prefs.remindOn,
            remindMin: state.prefs.remindMin,
            digestOn: state.prefs.digestOn,
            soundOn: state.prefs.soundOn,
            soundDefault: state.prefs.soundDefault,
            soundPreset: state.prefs.soundPreset,
            soundPresetOn: state.prefs.soundPresetOn,
            soundTtsOn: state.prefs.soundTtsOn,
            soundTtsVoice: state.prefs.soundTtsVoice,
            proMode: state.prefs.proMode,
            mapVisible: state.prefs.mapVisible
        };
    }

    return backup;
}

export function checkVersionCompatibility(backupVersion, currentVersion) {
    const bv = String(backupVersion || '0.0.0');
    const cv = String(currentVersion || SCHEMA_VERSION);

    const parseVersion = v => {
        const parts = v.split('.').map(n => parseInt(n, 10) || 0);
        while (parts.length < 3) parts.push(0);
        return parts.slice(0, 3);
    };

    const [bMajor, bMinor] = parseVersion(bv);
    const [cMajor, cMinor] = parseVersion(cv);

    if (bMajor > cMajor) {
        return {
            ok: false,
            error: `این فایل با نسخه‌ی جدیدتر (${bv}) ساخته شده است. لطفاً ابتدا اپ را به‌روزرسانی کنید.`
        };
    }

    if (bMajor === cMajor && bMinor > cMinor) {
        return {
            ok: true,
            warning: `این فایل با نسخه‌ی ${bv} ساخته شده که از نسخه‌ی فعلی (${cv}) جدیدتر است. برخی فیلدهای ناشناخته ممکن است نادیده گرفته شوند.`
        };
    }

    return { ok: true };
}

function mergeTaskFields(backupTask) {
    if (!backupTask || typeof backupTask !== 'object') return null;

    const template = sanitizeTask({
        id: backupTask.id || uid(),
        text: backupTask.text || 'بدون عنوان'
    });

    const merged = {};
    for (const field of Object.keys(template)) {
        if (field in backupTask) {
            merged[field] = backupTask[field];
        } else {
            merged[field] = template[field];
        }
    }

    return sanitizeTask(merged);
}

export async function importTasks(backup, options) {
    const opts = options || {};
    const mode = opts.mode === 'replace' ? 'replace' : 'merge';
    const importSettings = Boolean(opts.importSettings);

    if (!backup || typeof backup !== 'object') {
        return { ok: false, error: 'ساختار فایل نامعتبر است.', imported: 0, skipped: 0 };
    }
    if (!backup.data || typeof backup.data !== 'object') {
        return { ok: false, error: 'بخش داده (data) در فایل یافت نشد.', imported: 0, skipped: 0 };
    }
    if (!Array.isArray(backup.data.tasks)) {
        return { ok: false, error: 'لیست وظایف در فایل نامعتبر است.', imported: 0, skipped: 0 };
    }

    const versionCheck = checkVersionCompatibility(backup.schemaVersion, SCHEMA_VERSION);
    if (!versionCheck.ok) {
        return { ok: false, error: versionCheck.error, imported: 0, skipped: 0 };
    }

    let checksumWarning = '';
    if (backup.checksum && backup.data) {
        try {
            const computed = await computeChecksum(JSON.stringify(backup.data));
            if (computed !== backup.checksum) {
                checksumWarning = 'هشدار: checksum فایل مطابقت ندارد. ممکن است فایل دست‌کاری شده باشد.';
            }
        } catch {
            // silent
        }
    }

    const previousTasks = state.tasks.slice();
    const previousTrash = state.trash.slice();

    try {
        if (mode === 'replace') {
            state.tasks = [];
            state.trash = [];
        }

        let imported = 0;
        let skipped = 0;
        const existingIds = new Set(state.tasks.map(t => String(t.id)));

        for (const rawTask of backup.data.tasks) {
            try {
                const merged = mergeTaskFields(rawTask);
                if (!merged || !merged.id) {
                    skipped++;
                    continue;
                }
                if (mode === 'merge' && existingIds.has(String(merged.id))) {
                    state.tasks = state.tasks.filter(t => String(t.id) !== String(merged.id));
                }
                state.tasks.push(merged);
                existingIds.add(String(merged.id));
                imported++;
            } catch (err) {
                console.error('importTask failed:', err);
                skipped++;
            }
        }

        if (Array.isArray(backup.data.trash)) {
            const trashIds = new Set(state.trash.map(t => String(t.id)));
            for (const rawTrash of backup.data.trash) {
                try {
                    const merged = mergeTaskFields(rawTrash);
                    if (!merged || !merged.id) continue;
                    if (trashIds.has(String(merged.id))) continue;
                    merged.deletedAt = rawTrash.deletedAt || new Date().toISOString();
                    merged.parentId = rawTrash.parentId || null;
                    state.trash.push(merged);
                    trashIds.add(String(merged.id));
                } catch {
                    // silent
                }
            }
        }

        invalidateTaskIndex();
        if (useIDB) {
            await idbPutAll(IDB_STORE, state.tasks, { allowEmptyClear: true });
            await idbPutAll(IDB_TRASH, state.trash, { allowEmptyClear: true });
        }

        if (importSettings && backup.settings && typeof backup.settings === 'object') {
            const safeFields = [
                'theme', 'lang', 'remindOn', 'remindMin', 'digestOn',
                'soundOn', 'soundDefault', 'soundPreset', 'soundPresetOn',
                'soundTtsOn', 'soundTtsVoice', 'proMode', 'mapVisible'
            ];
            for (const field of safeFields) {
                if (field in backup.settings) {
                    state.prefs[field] = backup.settings[field];
                }
            }
            try {
                localStorage.setItem('spaceTodoPrefs', JSON.stringify(state.prefs));
            } catch { /* silent */ }
        }

        clearPendingChanges();

        call('render');
        events.emit('import:completed', { imported, skipped, mode });

        const warnings = [versionCheck.warning, checksumWarning].filter(Boolean).join(' ');
        return {
            ok: true,
            imported,
            skipped,
            warning: warnings || undefined
        };

    } catch (err) {
        state.tasks = previousTasks;
        state.trash = previousTrash;
        console.error('importTasks failed:', err);
        return {
            ok: false,
            error: 'خطا در import. تغییرات لغو شد.',
            imported: 0,
            skipped: 0
        };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Cache Invalidation
// ═══════════════════════════════════════════════════════════════════════════

export function invalidateTaskIndex() {
    state.taskIndex = null;
    state.taskIndexVersion++;
}

export function findTask(id) {
    const key = String(id);
    for (const t of state.tasks) {
        if (String(t.id) === key) return { task: t, parent: null };
        if (t.kind === 'plan' && Array.isArray(t.children)) {
            for (const c of t.children) {
                if (String(c.id) === key) return { task: c, parent: t };
            }
        }
    }
    return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Plan helpers
// ═══════════════════════════════════════════════════════════════════════════

export function planStats(g) {
    const k = visibleChildren(g);
    return { total: k.length, done: k.filter(c => c.completed).length };
}

export function planIsDone(g) {
    const s = planStats(g);
    return s.total > 0 && s.done === s.total;
}

export function planDueKey(g) {
    const now = getNow().getTime();
    let best = Infinity;
    (g.sessions || []).forEach(s => {
        const v = new Date(s.at).getTime();
        if (v >= now && v < best) best = v;
    });
    (g.children || []).forEach(c => {
        if (c.archived) return;
        const u = nearestUpcoming(c);
        if (u) {
            const v = new Date(u.at).getTime();
            if (v < best) best = v;
        }
    });
    return best;
}

// ═══════════════════════════════════════════════════════════════════════════
// Recur
// ═══════════════════════════════════════════════════════════════════════════

function daysInMonth(gy, gm) {
    return new Date(gy, gm + 1, 0).getDate();
}

function addInterval(date, recur, n) {
    const d = new Date(date.getTime());
    if (recur === 'daily') d.setDate(d.getDate() + 1);
    else if (recur === 'weekly') d.setDate(d.getDate() + 7);
    else if (recur === 'monthly') {
        const day = d.getDate();
        d.setDate(1);
        d.setMonth(d.getMonth() + 1);
        d.setDate(Math.min(day, daysInMonth(d.getFullYear(), d.getMonth())));
    }
    else if (recur === 'custom' && n >= 1) d.setDate(d.getDate() + n);
    else if (recur === 'hourly' && n >= 1) d.setTime(d.getTime() + n * 3600 * 1000);
    return d;
}

function nextWeekday(base, days) {
    const set = (days || []).filter(d => d >= 0 && d <= 6);
    if (!set.length) return null;
    for (let i = 1; i <= 7; i++) {
        const d = new Date(base.getTime());
        d.setDate(d.getDate() + i);
        if (set.includes(d.getDay())) {
            d.setHours(base.getHours(), base.getMinutes(), 0, 0);
            return d;
        }
    }
    return null;
}

function nextMonthday(base, days) {
    const set = [...new Set((days || []).filter(d => d >= 1 && d <= 31))].sort((a, b) => a - b);
    if (!set.length) return null;
    for (let m = 0; m < 13; m++) {
        const y = base.getFullYear();
        const mo = base.getMonth() + m;
        for (const dd of set) {
            if (dd > daysInMonth(y, mo)) continue;
            const c = new Date(y, mo, dd, base.getHours(), base.getMinutes(), 0, 0);
            if (c.getTime() > base.getTime()) return c;
        }
    }
    return null;
}

export function advanceRecur(task) {
    const r = task.recur;
    const n = r === 'custom'
        ? ((task.recurN >= 1 && task.recurN <= 365) ? task.recurN : 0)
        : r === 'hourly'
            ? ((task.recurN >= 1 && task.recurN <= 168) ? task.recurN : 0)
            : 0;
    if ((r === 'custom' || r === 'hourly') && !n) return false;
    const list = task.sessions || [];
    let base = Date.now();
    if (list.length) {
        base = list.reduce((m, s) => {
            const v = new Date(s.at).getTime();
            return isNaN(v) ? m : Math.max(m, v);
        }, base);
    }
    const b = new Date(base);
    let next = null;
    if (r === 'weeklyDays') next = nextWeekday(b, task.recurDays);
    else if (r === 'monthlyDays') next = nextMonthday(b, task.recurDays);
    else next = addInterval(b, r, n);
    if (!next || next.getTime() <= base) return false;
    task.sessions.push({ id: uid(), at: next.toISOString(), reminded: false, remindMin: null, location: null });
    return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// Trash
// ═══════════════════════════════════════════════════════════════════════════

export async function loadTrash() {
    if (useIDB) {
        try {
            state.trash = await idbGetAll(IDB_TRASH);
        } catch {
            state.trash = [];
        }
    }
    purgeTrash(false);
}

export function saveTrash() {
    const p = useIDB ? idbPutAll(IDB_TRASH, state.trash, { allowEmptyClear: true }) : Promise.resolve();
    p.catch(() => {});
    return p;
}

export function saveTrashItem(item) {
    if (!item || typeof item.id === 'undefined') return Promise.resolve();
    const p = useIDB ? idbPut(IDB_TRASH, item) : Promise.resolve();
    p.then(() => {
        enqueueChange({ type: 'trash-add', id: item.id, data: item });
    }).catch(() => {});
    return p;
}

export function deleteTrashItem(id) {
    const p = useIDB ? idbDelete(IDB_TRASH, id) : Promise.resolve();
    p.then(() => {
        enqueueChange({ type: 'trash-delete', id });
    }).catch(() => {});
    return p;
}

export function purgeTrash(renderAfter) {
    const cut = Date.now() - 30 * 86400000;
    const before = state.trash.length;
    const removed = [];
    state.trash = state.trash.filter(x => {
        try {
            const keep = new Date(x.deletedAt).getTime() > cut;
            if (!keep) removed.push(x.id);
            return keep;
        } catch {
            removed.push(x.id);
            return false;
        }
    });
    if (state.trash.length !== before) {
        if (useIDB) {
            removed.forEach(id => deleteTrashItem(id));
        }
        if (renderAfter !== false) call('render');
    }
}

export function moveToTrashById(id) {
    const found = findTask(id);
    if (!found) return false;
    const trashItem = {
        ...found.task,
        parentId: found.parent ? found.parent.id : null,
        deletedAt: new Date().toISOString()
    };
    if (found.parent) {
        found.parent.children = found.parent.children.filter(c => String(c.id) !== String(id));
    } else {
        state.tasks = state.tasks.filter(t => String(t.id) !== String(id));
    }
    state.trash.unshift(trashItem);
    invalidateTaskIndex();

    if (useIDB) {
        saveTrashItem(trashItem);
        deleteTaskFromStore(id);
    } else {
        saveTrash();
        saveTasks();
    }

    events.emit(EV.TASK_DELETED, { id, task: found.task, parentId: found.parent ? found.parent.id : null });
    return true;
}

export function restoreTrash(id) {
    const i = state.trash.findIndex(x => String(x.id) === String(id));
    if (i < 0) return;
    const [item] = state.trash.splice(i, 1);
    const { parentId, deletedAt, ...rest } = item;
    const g = parentId ? state.tasks.find(t => String(t.id) === String(parentId) && t.kind === 'plan') : null;
    if (g) {
        (g.children = g.children || []).unshift(rest);
    } else {
        state.tasks.unshift(rest);
    }
    invalidateTaskIndex();

    if (useIDB) {
        if (g) saveTask(rest, g);
        else saveTask(rest);
        deleteTrashItem(id);
    } else {
        saveTrash();
        saveTasks();
    }

    call('render');
    call('renderTrash');
    events.emit(EV.TASK_RESTORED, { id, task: rest });
}

// ═══════════════════════════════════════════════════════════════════════════
// CRUD
// ═══════════════════════════════════════════════════════════════════════════

export function addTask(forceKind) {
    const input = document.getElementById('taskInput');
    const prioritySelect = document.getElementById('prioritySelect');
    const text = input.value.trim().replace(/\s+/g, ' ');
    if (!text) {
        input.classList.remove('input-error');
        void input.offsetWidth;
        input.classList.add('input-error');
        input.focus();
        return;
    }
    const kind = forceKind || state.pendingKind || 'task';
    const isPlan = kind === 'plan';
    const isSeries = kind === 'series';
    let recur = 'none';
    let recurN = null;
    let recurDays = [];
    let sessions = state.addDraftSessions.map(s => ({ ...s }));
    if (isSeries) {
        const errEl = document.getElementById('seriesError');
        if (errEl) errEl.textContent = '';
        if (state.seriesType === 'dates') {
            sessions.sort((a, b) => new Date(a.at) - new Date(b.at));
        } else if (['hourly', 'daily', 'weekly', 'monthly'].includes(state.seriesType)) {
            recur = state.seriesType;
            sessions = [];
        } else if (state.seriesType === 'hourlyN') {
            const n = parseInt(document.getElementById('seriesN').value, 10);
            if (!(n >= 1 && n <= 168)) {
                if (errEl) errEl.textContent = 'عدد ساعت بین ۱ تا ۱۶۸ باشد';
                input.focus();
                return;
            }
            recur = 'hourly';
            recurN = n;
            sessions = [];
        } else if (state.seriesType === 'weeklyDays' || state.seriesType === 'monthlyDays') {
            if (!state.seriesDays.length) {
                if (errEl) errEl.textContent = 'حداقل یک روز انتخاب کنید';
                input.focus();
                return;
            }
            recur = state.seriesType;
            recurDays = [...state.seriesDays];
            sessions = [];
        }
    }
    state.justAddedId = uid();
    const newTask = {
        id: state.justAddedId,
        text: text.slice(0, MAX_LENGTH),
        completed: false,
        completedAt: null,
        priority: prioritySelect.value,
        recur,
        recurN,
        recurDays,
        description: document.getElementById('descInput').value.trim().slice(0, 1000),
        createdAt: new Date().toISOString(),
        phone: '',
        address: '',
        url: '',
        kind: isPlan ? 'plan' : (isSeries ? 'series' : 'task'),
        children: isPlan ? state.planDraftKids.map(k => blankTask(k)) : [],
        pinned: false,
        archived: false,
        timeSpent: 0,
        timerStartedAt: null,
        sessions: sessions,
        location: state.pendingLoc ? { ...state.pendingLoc } : null,
        photos: [],
        startAt: isPlan ? (state.planDraftStart || null) : null,
        endAt: isPlan ? (state.planDraftEnd || null) : null
    };
    state.tasks.unshift(newTask);
    if (isPlan) state.expandedPlans.add(String(state.justAddedId));

    saveTask(newTask);

    input.value = '';
    input.classList.remove('input-error');
    state.addDraftSessions = [];
    call('updateDueChips');
    state.planDraftKids = [];
    state.planDraftStart = null;
    state.planDraftEnd = null;
    call('renderPlanKids');
    document.getElementById('descInput').value = '';
    document.getElementById('prioritySelect').value = 'medium';
    const sErr = document.getElementById('seriesError');
    if (sErr) sErr.textContent = '';
    state.pendingLoc = null;
    const map = _mapHelpers.getMap();
    const pm = _mapHelpers.getPickMarker();
    if (pm && map && _mapHelpers.getMapReady()) {
        map.removeLayer(pm);
        _mapHelpers.setPickMarker(null);
    }
    call('updateLocChip');
    input.focus();
    call('render');
    if (kind === 'series') {
        const newId = state.justAddedId;
        state.justAddedId = null;
        call('openDetail', newId);
    }
}

export function toggleTask(id) {
    const found = findTask(id);
    if (!found) return;
    found.task.completed = !found.task.completed;
    found.task.completedAt = found.task.completed ? new Date().toISOString() : null;
    if (found.task.completed && found.task.recur && found.task.recur !== 'none' && advanceRecur(found.task)) {
        found.task.completed = false;
    }
    saveTask(found.task, found.parent);
    call('render');
}

export async function deleteTask(id, el) {
    const pre = findTask(id);
    if (!pre) return;
    if (!pre.parent && pre.task.kind === 'plan' && (pre.task.children || []).length > 0) {
        const ok = await invoke('showConfirmModal', {
            title: 'حذف برنامه',
            message: `این برنامه ${formatNumber(pre.task.children.length)} کار دارد. همه با هم به سطل زباله منتقل شوند؟`,
            confirmText: 'بله، منتقل کن',
            cancelText: 'انصراف',
            danger: true
        });
        if (!ok) return;
    }
    const remove = () => {
        invalidateTaskIndex();
        if (!moveToTrashById(id)) {
            call('render');
            return;
        }
        call('render');
        call('showUndoFor', [id]);
    };
    if (el) {
        el.classList.add('removing');
        setTimeout(remove, 220);
    } else {
        remove();
    }
}

export function archiveDone() {
    let n = 0;
    const changedParents = new Set();
    state.tasks.forEach(t => {
        if (t.kind === 'plan') {
            let planChanged = false;
            (t.children || []).forEach(c => {
                if (c.completed && !c.archived) {
                    c.archived = true;
                    n++;
                    planChanged = true;
                }
            });
            if (planChanged) changedParents.add(t);
        } else if (t.completed && !t.archived) {
            t.archived = true;
            n++;
            changedParents.add(t);
        }
    });
    if (!n) return;

    if (useIDB) {
        changedParents.forEach(t => saveTask(t));
    } else {
        saveTasks();
    }
    call('render');
}

export async function clearCompleted() {
    const ids = [];
    state.tasks.forEach(t => {
        if (t.kind === 'plan') (t.children || []).forEach(c => { if (c.completed && !c.archived) ids.push(c.id); });
        else if (t.completed && !t.archived) ids.push(t.id);
    });
    if (ids.length === 0) return;
    const ok = await invoke('showConfirmModal', {
        title: 'پاک کردن انجام‌شده‌ها',
        message: `${formatNumber(ids.length)} وظیفه انجام‌شده به سطل زباله منتقل شود؟`,
        confirmText: 'بله، منتقل کن',
        cancelText: 'انصراف',
        danger: true
    });
    if (!ok) return;
    ids.forEach(moveToTrashById);
    call('render');
    call('showUndoFor', ids);
}

// ═══════════════════════════════════════════════════════════════════════════
// Templates
// ═══════════════════════════════════════════════════════════════════════════

export const PLAN_TEMPLATES = [
    { id: 'travel', title: '✈️ سفر', children: ['بررسی تاریخ و ساعت حرکت', 'بررسی مدارک شناسایی', 'بررسی بلیت و رزرو محل اقامت', 'بررسی شارژر موبایل و کابل‌ها', 'شارژ پاوربانک', 'آماده کردن داروهای ضروری', 'آماده کردن لباس‌های مناسب مقصد و آب‌وهوا', 'آماده کردن لوازم بهداشتی', 'بررسی پول نقد و کارت‌های بانکی', 'بررسی وسایل ضروری شخصی', 'شارژ کامل موبایل', 'بررسی خانه قبل از خروج'] },
    { id: 'road-trip', title: '🚗 سفر با خودرو', children: ['بررسی روغن موتور', 'بررسی آب و مایعات خودرو', 'بررسی فشار و سلامت لاستیک‌ها', 'بررسی لاستیک زاپاس', 'بررسی ترمزها', 'بررسی چراغ‌ها و راهنماها', 'بررسی برف‌پاک‌کن و شیشه‌شوی', 'بررسی باتری', 'بررسی مدارک خودرو', 'آماده کردن جعبه ابزار', 'آماده کردن تجهیزات اضطراری', 'شارژ موبایل و پاوربانک'] },
    { id: 'moving', title: '🏠 اسباب‌کشی', children: ['تعیین تاریخ اسباب‌کشی', 'هماهنگی خودرو یا باربری', 'تهیه کارتن و لوازم بسته‌بندی', 'جمع‌آوری وسایل غیرضروری', 'بسته‌بندی اتاق‌ها', 'بسته‌بندی وسایل آشپزخانه', 'بسته‌بندی وسایل شکستنی', 'آماده کردن مدارک و وسایل ارزشمند', 'بررسی وضعیت خانه جدید', 'هماهنگی آب، برق، گاز و اینترنت', 'انتقال وسایل', 'بررسی خانه قدیمی پس از تخلیه'] },
    { id: 'cleaning', title: '🧹 خانه‌تکانی', children: ['مرتب کردن وسایل اضافی', 'دور ریختن وسایل غیرقابل استفاده', 'تمیز کردن آشپزخانه', 'تمیز کردن یخچال', 'تمیز کردن اجاق و فر', 'تمیز کردن سرویس‌های بهداشتی', 'گردگیری اتاق‌ها', 'تمیز کردن پنجره‌ها', 'جارو و شست‌وشوی کف', 'مرتب کردن کمدها', 'شست‌وشوی ملحفه‌ها و پرده‌ها', 'جمع‌آوری و مرتب کردن وسایل نهایی'] },
    { id: 'shopping', title: '🛒 خرید ماهانه', children: ['بررسی موجودی مواد غذایی', 'بررسی مواد شوینده', 'بررسی لوازم بهداشتی', 'بررسی اقلام مصرفی خانه', 'تهیه فهرست خرید', 'بررسی بودجه خرید', 'خرید اقلام ضروری', 'بررسی اقلام خریداری‌شده', 'مرتب کردن خریدها در خانه'] },
    { id: 'doctor', title: '🩺 مراجعه به پزشک', children: ['انتخاب پزشک', 'گرفتن نوبت', 'ثبت تاریخ و ساعت مراجعه', 'ثبت آدرس مطب', 'آماده کردن مدارک لازم', 'آماده کردن فهرست داروهای مصرفی', 'یادداشت سؤال‌ها و موارد مهم', 'همراه داشتن نتایج آزمایش‌ها و مدارک پزشکی مرتبط', 'تنظیم یادآور مراجعه', 'ثبت توصیه‌ها و اقدامات بعد از مراجعه'] },
    { id: 'exam', title: '📚 آمادگی برای امتحان', children: ['مشخص کردن تاریخ امتحان', 'جمع‌آوری منابع', 'مشخص کردن فصل‌های مورد مطالعه', 'برنامه‌ریزی مطالعه', 'مطالعه مباحث اصلی', 'مرور یادداشت‌ها', 'حل تمرین‌ها', 'حل نمونه سؤال', 'بررسی اشتباهات', 'مرور نهایی', 'آماده کردن وسایل روز امتحان'] },
    { id: 'party', title: '🎉 برگزاری مهمانی', children: ['تعیین تاریخ و ساعت', 'تهیه فهرست مهمانان', 'اطلاع دادن به مهمانان', 'تعیین منوی غذا', 'تهیه فهرست خرید', 'خرید مواد موردنیاز', 'آماده کردن خانه', 'آماده کردن غذا', 'آماده کردن پذیرایی', 'مرتب کردن خانه بعد از مهمانی'] }
];

export function blankTask(text) {
    return {
        id: uid(),
        text: text.slice(0, MAX_LENGTH),
        completed: false,
        completedAt: null,
        priority: 'medium',
        createdAt: new Date().toISOString(),
        description: '',
        phone: '',
        address: '',
        url: '',
        kind: 'task',
        children: [],
        pinned: false,
        recur: 'none',
        timeSpent: 0,
        timerStartedAt: null,
        sessions: [],
        location: null,
        photos: []
    };
}

export function createPlanCustom(name, kids, opts) {
    const title = String(name || '').trim().replace(/\s+/g, ' ').slice(0, MAX_LENGTH);
    if (!title) return null;
    const g = blankTask(title);
    g.kind = 'plan';
    g.children = (kids || []).filter(k => k && k.trim()).map(k => blankTask(k.trim().slice(0, MAX_LENGTH)));
    g.startAt = opts && opts.startAt ? opts.startAt : null;
    g.endAt = opts && opts.endAt ? opts.endAt : null;
    state.tasks.unshift(g);
    state.expandedPlans.add(String(g.id));
    state.justAddedId = g.id;

    saveTask(g);

    call('render');
    return g.id;
}

export function addChild(gid) {
    const g = state.tasks.find(t => String(t.id) === String(gid) && t.kind === 'plan');
    if (!g) return;
    const taskList = document.getElementById('taskList');
    const item = taskList ? taskList.querySelector(`.task-item[data-id="${gid}"]`) : null;
    const inp = item ? item.querySelector('.child-input') : null;
    const prio = item ? item.querySelector('.child-prio') : null;
    const text = inp ? inp.value.trim().replace(/\s+/g, ' ') : '';
    if (!text) {
        if (inp) {
            inp.focus();
            inp.classList.remove('input-error');
            void inp.offsetWidth;
            inp.classList.add('input-error');
        }
        return;
    }
    state.justAddedId = uid();
    g.children.unshift({
        id: state.justAddedId,
        text: text.slice(0, MAX_LENGTH),
        completed: false,
        priority: prio && ['high', 'medium', 'low'].includes(prio.value) ? prio.value : 'medium',
        createdAt: new Date().toISOString(),
        description: '',
        phone: '',
        address: '',
        url: '',
        kind: 'task',
        children: [],
        sessions: (state.childDrafts[gid] || []).map(s => ({ ...s })),
        location: null
    });
    state.childDrafts[gid] = [];

    saveTask(g);

    call('render');
    const ni = taskList ? taskList.querySelector(`.task-item[data-id="${gid}"] .child-input`) : null;
    if (ni) ni.focus();
}