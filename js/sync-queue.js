// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// sync-queue.js -- صف sync آفلاین + پایه‌ریزی Cloudflare (ESM)
//
// ⚠️ اصل معماری: Offline-First
//   - پیش‌فرض: هیچ درخواست شبکه‌ای انجام نمی‌شود.
//   - صف ops فقط در localStorage می‌ماند تا کاربر در تنظیمات
//     گزینه‌ی «همگام‌سازی ابری» را فعال کند.
//   - در فاز ۶، Cloudflare Worker + D1 + Telegram Login به همین
//     صف وصل می‌شود و هر op را به سرور می‌فرستد.
//
// ⚠️ پایه‌ریزی فاز ۶:
//   - setSyncHandler() برای تعریف handler دلخواه (Cloudflare)
//   - state.sync.authToken / userId / endpoint / enabled
//   - deviceId از net.js برای conflict resolution
//   - ساختار op سازگار با D1 schema
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

/** کلید localStorage برای صف */
const QUEUE_KEY = 'spaceTodoSyncQueue';

/** حداکثر تعداد op در صف (جلوگیری از پر شدن localStorage) */
const MAX_QUEUE_SIZE = 500;

/** حداقل فاصله بین دو flush خودکار (ms) */
const FLUSH_MIN_INTERVAL_MS = 5000;

/** Base delay برای exponential backoff (ms) */
const RETRY_BASE_DELAY_MS = 2000;

/** حداکثر delay برای retry (ms) — سقف ۵ دقیقه */
const RETRY_MAX_DELAY_MS = 5 * 60 * 1000;

/** حداکثر تعداد retry برای هر op قبل از drop */
const MAX_RETRIES_PER_OP = 8;

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

/** @type {number} */
let _currentRetryDelay = RETRY_BASE_DELAY_MS;

/**
 * handler پیش‌فرض — هیچ کاری نمی‌کند (ops فقط در صف می‌مانند).
 *
 * ⚠️ در فاز ۶، این handler با cloudflareSyncHandler عوض می‌شود:
 *
 *   async function cloudflareSyncHandler(op) {
 *       if (!state.sync.authToken) throw new Error('not-authenticated');
 *       const res = await fetch(state.sync.endpoint, {
 *           method: 'POST',
 *           headers: {
 *               'Content-Type': 'application/json',
 *               'Authorization': `Bearer ${state.sync.authToken}`,
 *           },
 *           body: JSON.stringify(op),
 *       });
 *       if (!res.ok) {
 *           if (res.status === 401) {
 *               events.emit('sync:auth-expired');
 *               throw new Error('auth-expired');
 *           }
 *           if (res.status === 429) throw new Error('rate-limited');
 *           throw new Error('sync-failed');
 *       }
 *       return await res.json();
 *   }
 *
 * @type {(op: object) => Promise<{ ok: boolean }>}
 */
let _syncHandler = async () => ({ ok: true });

// ═══════════════════════════════════════════════════════════════════════════
// Public API — read
// ═══════════════════════════════════════════════════════════════════════════

/**
 * snapshot از صف فعلی.
 * @returns {object[]}
 */
export function getQueue() {
    return state.sync.queue ? state.sync.queue.slice() : [];
}

/**
 * تعداد opهای در انتظار.
 * @returns {number}
 */
export function getQueueSize() {
    return state.sync.queue ? state.sync.queue.length : 0;
}

/**
 * آیا صف خالی است؟
 * @returns {boolean}
 */
export function isQueueEmpty() {
    return getQueueSize() === 0;
}

/**
 * تعریف handler سفارشی (برای فاز ۶).
 *
 * @param {((op: object) => Promise<{ ok: boolean }>)|null} fn
 *   اگر null باشد، handler به حالت پیش‌فرض (no-op) برمی‌گردد.
 */
export function setSyncHandler(fn) {
    if (typeof fn === 'function') {
        _syncHandler = fn;
    } else {
        _syncHandler = async () => ({ ok: true });
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Persistence
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ذخیره‌ی صف در localStorage.
 * ⚠️ در private mode ممکن است شکست بخورد — silent مدیریت می‌شود.
 */
function _persist() {
    try {
        const snapshot = state.sync.queue || [];
        if (snapshot.length === 0) {
            localStorage.removeItem(QUEUE_KEY);
        } else {
            localStorage.setItem(QUEUE_KEY, JSON.stringify(snapshot));
        }
    } catch (err) {
        // localStorage پر است یا private mode
        console.warn('sync-queue: persist failed', err);
    }
}

/**
 * بارگذاری صف از localStorage.
 * این تابع در initSyncQueue صدا زده می‌شود.
 */
function _loadFromStorage() {
    try {
        const raw = localStorage.getItem(QUEUE_KEY);
        if (!raw) {
            state.sync.queue = [];
            return;
        }
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            state.sync.queue = [];
            return;
        }
        // اعتبارسنجی سبک هر op
        state.sync.queue = parsed.filter(op => {
            return op
                && typeof op === 'object'
                && typeof op.id === 'string'
                && typeof op.type === 'string'
                && typeof op.timestamp === 'string';
        });
    } catch (err) {
        console.warn('sync-queue: load failed', err);
        state.sync.queue = [];
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Enqueue / Dequeue
// ═══════════════════════════════════════════════════════════════════════════

/**
 * افزودن یک op به صف.
 *
 * ⚠️ این تابع هرگز شبکه‌ای درخواست نمی‌زند — فقط در حافظه و localStorage
 *    ذخیره می‌کند. flush فقط اگر state.sync.enabled باشد انجام می‌شود.
 *
 * @param {object} op
 * @param {string} op.type         — 'save' | 'delete' | 'trash-add' | 'trash-delete'
 * @param {string} op.entityId     — id موجودیت
 * @param {object|null} [op.data]  — داده (برای save)
 * @param {string|null} [op.parentId]
 * @param {'task'|'child'} [op.entityType]
 * @returns {object} op نهایی (با id و timestamp)
 */
export function enqueue(op) {
    if (!op || typeof op.type !== 'string') {
        console.warn('sync-queue: invalid op', op);
        return null;
    }
    if (typeof op.entityId !== 'string' && typeof op.entityId !== 'number') {
        console.warn('sync-queue: op.entityId required', op);
        return null;
    }

    const entry = {
        id: uid(),
        type: op.type,
        entityId: String(op.entityId),
        entityType: op.entityType === 'child' ? 'child' : 'task',
        data: op.data || null,
        parentId: op.parentId ? String(op.parentId) : null,
        timestamp: new Date().toISOString(),
        deviceId: getDeviceId(),
        schemaVersion: SCHEMA_VERSION,
        retries: 0,
        lastError: null,
    };

    state.sync.queue = state.sync.queue || [];
    state.sync.queue.push(entry);

    // اگر صف از حد گذشت، قدیمی‌ترین‌ها را حذف کن
    if (state.sync.queue.length > MAX_QUEUE_SIZE) {
        const excess = state.sync.queue.length - MAX_QUEUE_SIZE;
        state.sync.queue.splice(0, excess);
    }

    _persist();

    events.emit(EV.SYNC_ENQUEUED, { op: entry });
    events.emit(EV.SYNC_QUEUE_CHANGED, {
        size: state.sync.queue.length,
    });

    // flush خودکار فقط اگر sync ابری فعال است
    if (state.sync.enabled && isOnline()) {
        scheduleFlush();
    }

    return entry;
}

/**
 * حذف چند op از صف (بعد از موفقیت).
 * @param {string[]} ids
 */
export function dequeue(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return;
    const set = new Set(ids.map(String));
    state.sync.queue = (state.sync.queue || []).filter(op => !set.has(String(op.id)));
    _persist();
    events.emit(EV.SYNC_QUEUE_CHANGED, {
        size: state.sync.queue.length,
    });
}

/**
 * پاک‌سازی کل صف.
 * معمولاً بعد از import کامل یا logout.
 */
export function clearQueue() {
    state.sync.queue = [];
    try {
        localStorage.removeItem(QUEUE_KEY);
    } catch { /* silent */ }
    events.emit(EV.SYNC_QUEUE_CHANGED, { size: 0 });
}

// ═══════════════════════════════════════════════════════════════════════════
// Flush — تلاش برای sync
// ═══════════════════════════════════════════════════════════════════════════

/**
 * زمان‌بندی flush خودکار (با محافظ loop).
 */
function scheduleFlush() {
    if (_flushScheduled) return;
    _flushScheduled = true;
    setTimeout(() => {
        _flushScheduled = false;
        flushQueue().catch(() => {});
    }, 500);
}

/**
 * تلاش برای flush صف.
 *
 * ⚠️ این تابع:
 *   - اگر sync ابری غیرفعال باشد، فوراً return می‌کند (no-op).
 *   - اگر آفلاین باشد، فوراً return می‌کند.
 *   - اگر flush در حال اجرا باشد، فوراً return می‌کند (محافظ loop).
 *   - برای هر op، handler را صدا می‌زند.
 *   - در صورت موفقیت: op از صف حذف می‌شود.
 *   - در صورت خطا: retries++، backoff زمان‌بندی می‌شود.
 *
 * @returns {Promise<{ ok: boolean, processed: number, failed: number }>}
 */
export async function flushQueue() {
    // ⚠️ گارد اصلی: sync ابری باید فعال باشد
    if (state.sync.enabled !== true) {
        return { ok: false, processed: 0, failed: 0 };
    }
    // گارد: آفلاین
    if (!isOnline()) {
        return { ok: false, processed: 0, failed: 0 };
    }
    // گارد loop
    if (_flushing) {
        return { ok: false, processed: 0, failed: 0 };
    }
    // گارد: صف خالی
    const queue = state.sync.queue || [];
    if (queue.length === 0) {
        return { ok: true, processed: 0, failed: 0 };
    }
    // گارد: فاصله‌ی حداقل بین flushها
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
        // snapshot بگیر تا اگر در حین flush op اضافه شد، از دست نرود
        const snapshot = queue.slice();

        for (const op of snapshot) {
            // اگر در حین loop آفلاین شدیم، متوقف شو
            if (!isOnline()) break;

            try {
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
                failedOps.push(op);

                // اگر از حد retry گذشت، drop کن (جلوگیری از صف ابدی)
                if (op.retries >= MAX_RETRIES_PER_OP) {
                    console.warn('sync-queue: dropping op after max retries', op);
                    succeededIds.push(op.id); // به عنوان "حذف شده" ثبت می‌شود
                }
            }
        }
    } finally {
        _flushing = false;
        state.sync.inFlight = false;
    }

    // اعمال نتایج
    if (succeededIds.length > 0) {
        dequeue(succeededIds);
    }

    state.sync.lastFlushAt = new Date().toISOString();

    // مدیریت retry
    if (failedOps.length > 0) {
        state.sync.lastError = failedOps[0].lastError;
        state.sync.retries = (state.sync.retries || 0) + 1;
        events.emit(EV.SYNC_ERROR, {
            failed: failedOps.length,
            lastError: state.sync.lastError,
        });
        _scheduleRetry();
    } else {
        // موفق → reset backoff
        state.sync.lastError = null;
        _currentRetryDelay = RETRY_BASE_DELAY_MS;
        clearTimeout(_retryTimer);
        _retryTimer = null;
        events.emit(EV.SYNC_FLUSHED, {
            processed,
            remaining: getQueueSize(),
        });
    }

    return {
        ok: failedOps.length === 0,
        processed,
        failed: failedOps.length,
    };
}

/**
 * زمان‌بندی retry با exponential backoff.
 */
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
// Enable / Disable (فاز ۶ — آپشن تنظیمات)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * فعال‌سازی sync ابری.
 * در فاز ۶، این تابع از دکمه‌ی تنظیمات صدا زده می‌شود.
 *
 * @param {object} config
 * @param {string} config.endpoint   — Cloudflare Worker URL
 * @param {string} config.authToken  — Telegram Login token
 * @param {string} [config.userId]   — Telegram user ID
 */
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

    // تلاش اولیه برای flush
    if (isOnline()) {
        scheduleFlush();
    }
    return true;
}

/**
 * غیرفعال‌سازی sync ابری.
 * صف حفظ می‌شود (تا اگر دوباره فعال شد، ops از دست نروند).
 */
export function disableCloudSync() {
    state.sync.enabled = false;
    state.sync.authToken = null;
    state.sync.userId = null;
    clearTimeout(_retryTimer);
    _retryTimer = null;
    events.emit('sync:disabled', {});
}

// ═══════════════════════════════════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════════════════════════════════

/**
 * راه‌اندازی صف sync.
 *
 * این تابع:
 *   - صف را از localStorage بارگذاری می‌کند
 *   - به net:online گوش می‌دهد تا flush خودکار بزند
 *   - اگر state.sync.enabled بود، اولین flush را زمان‌بندی می‌کند
 *
 * ⚠️ idempotent است.
 */
export function initSyncQueue() {
    if (_started) return;
    _started = true;

    // مقداردهی اولیه‌ی state.sync (اگر core.js نداده باشد)
    state.sync = state.sync || {};
    state.sync.queue = state.sync.queue || [];
    state.sync.inFlight = false;
    state.sync.retries = state.sync.retries || 0;
    state.sync.lastFlushAt = null;
    state.sync.lastError = null;
    state.sync.enabled = state.sync.enabled === true;
    state.sync.deviceId = getDeviceId();

    // بارگذاری از localStorage
    _loadFromStorage();

    // emit اولیه برای UI
    events.emit(EV.SYNC_QUEUE_CHANGED, { size: getQueueSize() });

    // گوش دادن به آنلاین شدن
    events.on(EV.NET_ONLINE, () => {
        if (state.sync.enabled && getQueueSize() > 0) {
            scheduleFlush();
        }
    });

    // ⚠️ گوش دادن به هر تغییر جدید در صف
    // (این listener فقط صف را persist می‌کند — loop محافظت‌شده)
    let _persistScheduled = false;
    events.on(EV.SYNC_ENQUEUED, () => {
        if (_persistScheduled) return;
        _persistScheduled = true;
        queueMicrotask(() => {
            _persistScheduled = false;
            _persist();
        });
    });

    // اگر sync فعال بود، اولین flush را با تأخیر بزن
    if (state.sync.enabled && isOnline() && getQueueSize() > 0) {
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
// Backward-compat — adapter برای store.js فعلی
// ═══════════════════════════════════════════════════════════════════════════
//
// ⚠️ این adapter موقتی است. در فاز ۵ گام ۵ (اتصال store.js) حذف می‌شود
// و store.js مستقیماً enqueue را صدا می‌زند.
//
// store.js فعلی از این الگو استفاده می‌کند:
//   enqueueChange({ type: 'save', id, data, parentId })
//
// اما sync-queue از این الگو استفاده می‌کند:
//   enqueue({ type: 'save', entityId, data, parentId, entityType })
//
// adapter این تبدیل را انجام می‌دهد.

/**
 * تبدیل entry قدیمی store.js به op جدید sync-queue.
 * @param {object} oldEntry
 * @returns {object|null}
 */
export function adaptStoreEntry(oldEntry) {
    if (!oldEntry || typeof oldEntry !== 'object') return null;
    const { type, id, data, parentId } = oldEntry;
    if (!type || id === undefined) return null;
    return {
        type,
        entityId: String(id),
        entityType: parentId ? 'child' : 'task',
        data: data || null,
        parentId: parentId ? String(parentId) : null,
    };
}