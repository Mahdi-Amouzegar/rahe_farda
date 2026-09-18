// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// net.js -- تشخیص آنلاین/آفلاین + رویدادهای شبکه (ESM)
//
// ⚠️ این ماژول مسئول:
//   - تشخیص اولیه‌ی وضعیت شبکه (navigator.onLine)
//   - گوش دادن به رویدادهای online/offline مرورگر
//   - تست واقعی اتصال (probe اختیاری با fetch)
//   - تولید و نگهداری deviceId یکتا (برای conflict resolution فاز ۶)
//   - انتشار رویدادهای net:* روی EventEmitter مرکزی
//
// ⚠️ پایه‌ریزی فاز ۶:
//   - deviceId اینجا تولید می‌شود و در state.net.deviceId ذخیره می‌شود
//   - در فاز ۶، Cloudflare Worker با این deviceId conflict resolution می‌کند
//   - downlink/effectiveType از Network Information API (فقط Chrome/Edge)
// ═══════════════════════════════════════════════════════════════════════════

import { state, uid } from './core.js';
import { events, EV } from './events.js';

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/** کلید localStorage برای deviceId */
const DEVICE_ID_KEY = 'spaceTodoDeviceId';

/**
 * endpoint سبک برای probe اختیاری اتصال.
 * از یک فایل استاتیک خودمان استفاده می‌کنیم تا به سرویس خارجی وابسته نباشیم.
 * در صورت نبود فایل، probe به صورت silent شکست می‌خورد.
 */
const PROBE_URL = './manifest.webmanifest';

/** timeout برای probe (ms) */
const PROBE_TIMEOUT_MS = 5000;

/** حداقل فاصله بین دو probe خودکار (ms) */
const PROBE_MIN_INTERVAL_MS = 30000;

// ═══════════════════════════════════════════════════════════════════════════
// Local state
// ═══════════════════════════════════════════════════════════════════════════

/** @type {boolean} */
let _started = false;

/** @type {number} */
let _lastProbeAt = 0;

/** @type {AbortController|null} */
let _probeController = null;

/** @type {number|null} */
let _probeTimer = null;

// ═══════════════════════════════════════════════════════════════════════════
// deviceId
// ═══════════════════════════════════════════════════════════════════════════

/**
 * دریافت یا تولید deviceId یکتا.
 * این شناسه در فاز ۶ برای conflict resolution در Cloudflare D1 استفاده می‌شود.
 *
 * @returns {string} UUID
 */
export function getOrCreateDeviceId() {
    try {
        let id = localStorage.getItem(DEVICE_ID_KEY);
        if (!id || typeof id !== 'string' || id.length < 8) {
            id = uid();
            localStorage.setItem(DEVICE_ID_KEY, id);
        }
        return id;
    } catch {
        // اگر localStorage در دسترس نبود (private mode)، یک ID موقت تولید کن
        return 'temp-' + uid();
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Network Information API (اختیاری — Chrome/Edge)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * خواندن اطلاعات شبکه از Network Information API.
 * این API در همه‌ی مرورگرها نیست — در صورت نبود، null برمی‌گرداند.
 *
 * @returns {{ effectiveType: string|null, downlink: number|null, rtt: number|null }}
 */
function readNetworkInfo() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!conn) {
        return { effectiveType: null, downlink: null, rtt: null };
    }
    return {
        effectiveType: typeof conn.effectiveType === 'string' ? conn.effectiveType : null,
        downlink: Number.isFinite(conn.downlink) ? conn.downlink : null,
        rtt: Number.isFinite(conn.rtt) ? conn.rtt : null,
    };
}

/**
 * به‌روزرسانی `state.net.effectiveType` و `state.net.downlink`.
 */
function syncNetworkInfo() {
    const info = readNetworkInfo();
    state.net.effectiveType = info.effectiveType;
    state.net.downlink = info.downlink;
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API — read
// ═══════════════════════════════════════════════════════════════════════════

/**
 * آیا دستگاه آنلاین است؟
 * این تابع به `navigator.onLine` تکیه می‌کند که ممکن است گاهی نادرست باشد.
 * برای اطمینان بیشتر از `probeConnection()` استفاده کنید.
 *
 * @returns {boolean}
 */
export function isOnline() {
    return state.net.online === true;
}

/**
 * وضعیت شبکه به صورت رشته.
 * @returns {'online'|'offline'|'unknown'}
 */
export function getNetworkType() {
    if (typeof state.net.online !== 'boolean') return 'unknown';
    return state.net.online ? 'online' : 'offline';
}

/**
 * دریافت deviceId فعلی (اگر هنوز تولید نشده، تولید می‌کند).
 * @returns {string}
 */
export function getDeviceId() {
    if (!state.net.deviceId) {
        state.net.deviceId = getOrCreateDeviceId();
    }
    return state.net.deviceId;
}

// ═══════════════════════════════════════════════════════════════════════════
// Probe — تست واقعی اتصال
// ═══════════════════════════════════════════════════════════════════════════

/**
 * تست واقعی اتصال با یک درخواست HEAD سبک به یک فایل استاتیک خودمان.
 *
 * این تابع:
 *   - در صورت موفقیت: `state.net.online` را true می‌کند
 *   - در صورت شکست: `state.net.online` را false می‌کند
 *   - رویداد `net:change` را منتشر می‌کند اگر وضعیت تغییر کرده باشد
 *
 * ⚠️ این تابع هرگز throw نمی‌کند — خطاها silent مدیریت می‌شوند.
 *
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<boolean>} وضعیت آنلاین پس از probe
 */
export async function probeConnection(options) {
    const opts = options || {};
    const force = opts.force === true;

    // اگر خیلی زودتر probe زده‌ایم و force نیست، رد کن
    const now = Date.now();
    if (!force && now - _lastProbeAt < PROBE_MIN_INTERVAL_MS) {
        return isOnline();
    }
    _lastProbeAt = now;

    // لغو probe قبلی
    if (_probeController) {
        try { _probeController.abort(); } catch { /* silent */ }
    }
    _probeController = new AbortController();
    const controller = _probeController;

    const timer = setTimeout(() => {
        try { controller.abort(); } catch { /* silent */ }
    }, PROBE_TIMEOUT_MS);

    try {
        const res = await fetch(PROBE_URL, {
            method: 'HEAD',
            cache: 'no-store',
            signal: controller.signal,
        });
        // حتی 404 هم یعنی شبکه کار می‌کند
        const online = res.ok || res.status === 404 || res.status === 405;
        clearTimeout(timer);
        _probeController = null;

        if (online !== state.net.online) {
            state.net.online = online;
            state.net.lastChangeAt = Date.now();
            syncNetworkInfo();
            events.emit(EV.NET_CHANGE, {
                online,
                source: 'probe',
                effectiveType: state.net.effectiveType,
            });
        }
        return online;
    } catch {
        clearTimeout(timer);
        _probeController = null;

        // شکست probe → احتمالاً آفلاین
        if (state.net.online !== false) {
            state.net.online = false;
            state.net.lastChangeAt = Date.now();
            events.emit(EV.NET_CHANGE, {
                online: false,
                source: 'probe',
                effectiveType: null,
            });
        }
        return false;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Monitor — شروع و توقف
// ═══════════════════════════════════════════════════════════════════════════

/** handler برای رویداد online مرورگر */
function _onOnline() {
    const wasOnline = state.net.online;
    state.net.online = true;
    state.net.lastChangeAt = Date.now();
    syncNetworkInfo();

    if (wasOnline !== true) {
        events.emit(EV.NET_ONLINE, { effectiveType: state.net.effectiveType });
        events.emit(EV.NET_CHANGE, {
            online: true,
            source: 'browser-event',
            effectiveType: state.net.effectiveType,
        });
    }

    // بعد از آنلاین شدن، یک probe تأییدی بزن (با تأخیر کوتاه)
    clearTimeout(_probeTimer);
    _probeTimer = setTimeout(() => {
        probeConnection({ force: true }).catch(() => {});
    }, 800);
}

/** handler برای رویداد offline مرورگر */
function _onOffline() {
    const wasOnline = state.net.online;
    state.net.online = false;
    state.net.lastChangeAt = Date.now();

    if (wasOnline !== false) {
        events.emit(EV.NET_OFFLINE, {});
        events.emit(EV.NET_CHANGE, {
            online: false,
            source: 'browser-event',
            effectiveType: null,
        });
    }

    clearTimeout(_probeTimer);
    _probeTimer = null;
}

/**
 * شروع monitoring شبکه.
 * این تابع:
 *   - deviceId را تضمین می‌کند
 *   - وضعیت اولیه را از navigator.onLine می‌خواند
 *   - listenerهای online/offline را ثبت می‌کند
 *   - یک probe اولیه می‌زند (اختیاری، با تأخیر)
 *
 * ⚠️ idempotent است — چند بار صدا زدن مشکلی ندارد.
 */
export function startNetworkMonitor() {
    if (_started) return;
    _started = true;

    // deviceId
    if (!state.net.deviceId) {
        state.net.deviceId = getOrCreateDeviceId();
    }

    // وضعیت اولیه
    if (typeof state.net.online !== 'boolean') {
        state.net.online = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
    }
    state.net.lastChangeAt = Date.now();
    syncNetworkInfo();

    // listenerها
    if (typeof window !== 'undefined') {
        window.addEventListener('online', _onOnline);
        window.addEventListener('offline', _onOffline);
    }

    // probe اولیه (با تأخیر تا برنامه کامل بالا بیاید)
    setTimeout(() => {
        probeConnection({ force: true }).catch(() => {});
    }, 3000);

    // emit اولیه برای UI
    events.emit(EV.NET_CHANGE, {
        online: state.net.online,
        source: 'init',
        effectiveType: state.net.effectiveType,
    });
}

/**
 * توقف monitoring و پاک‌سازی listenerها.
 * معمولاً در تست یا hot-reload لازم است.
 */
export function stopNetworkMonitor() {
    if (!_started) return;
    _started = false;

    if (typeof window !== 'undefined') {
        window.removeEventListener('online', _onOnline);
        window.removeEventListener('offline', _onOffline);
    }

    if (_probeController) {
        try { _probeController.abort(); } catch { /* silent */ }
        _probeController = null;
    }
    clearTimeout(_probeTimer);
    _probeTimer = null;
}

// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ سازگاری — dual-emit با window events (موقت)
// ═══════════════════════════════════════════════════════════════════════════
//
// برخی ماژول‌های فعلی ممکن است مستقیماً به window رویداد گوش بدهند.
// برای سازگاری، هر رویداد net:* را به صورت window event هم emit می‌کنیم.
// در فاز ۶ این dual-emit حذف می‌شود.

events.on(EV.NET_ONLINE, payload => {
    try {
        window.dispatchEvent(new CustomEvent('rahe-net-online', { detail: payload }));
    } catch { /* silent */ }
});

events.on(EV.NET_OFFLINE, payload => {
    try {
        window.dispatchEvent(new CustomEvent('rahe-net-offline', { detail: payload }));
    } catch { /* silent */ }
});