// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// header-status.js -- نشانگر وضعیت آنلاین/آفلاین + صف sync (ESM)
//
// ⚠️ این ماژول مسئول:
//   - نمایش نشانگر کوچک در هدر کنار todayLine
//   - نمایش وضعیت شبکه (online/offline)
//   - نمایش تعداد opهای در انتظار sync (فقط اگر > 0)
//
// ⚠️ Offline-First:
//   - فقط از state.net و state.sync.queue می‌خواند
//   - هیچ درخواست شبکه‌ای مستقیم ندارد
//
// ⚠️ Signature-based rendering:
//   - برای جلوگیری از render تکراری، امضای state را نگه می‌داریم
//   - فقط اگر امضا تغییر کرد، DOM به‌روز می‌شود
// ═══════════════════════════════════════════════════════════════════════════

import { state, toFa } from './core.js';
import { events, EV } from './events.js';

const EL_ID = 'headerStatusIndicator';
const UPDATE_DEBOUNCE_MS = 100;

const ICONS = {
    online: '◉',
    offline: '◌',
    pending: '◉',
    syncing: '◐',
    unknown: '○'
};

let _started = false;
let _updating = false;
let _debounceTimer = null;
let _el = null;
let _lastSignature = '';

/**
 * محاسبه‌ی وضعیت نمایشی بر اساس state فعلی.
 */
function _computeStatus() {
    const net = state.net || {};
    const sync = state.sync || {};

    const online = net.online === true;
    const offline = net.online === false;
    const queueSize = Array.isArray(sync.queue) ? sync.queue.length : 0;
    const inFlight = sync.inFlight === true;
    const syncEnabled = sync.enabled === true;

    if (offline) {
        if (queueSize > 0) {
            return {
                state: 'offline',
                icon: ICONS.offline,
                tooltip: `آفلاین — ${toFa(queueSize)} تغییر در انتظار`,
                ariaLabel: `آفلاین، ${toFa(queueSize)} تغییر در انتظار همگام‌سازی`
            };
        }
        return {
            state: 'offline',
            icon: ICONS.offline,
            tooltip: 'آفلاین — فقط روی همین دستگاه',
            ariaLabel: 'آفلاین'
        };
    }

    if (online && syncEnabled) {
        if (inFlight) {
            return {
                state: 'syncing',
                icon: ICONS.syncing,
                tooltip: 'در حال همگام‌سازی…',
                ariaLabel: 'در حال همگام‌سازی'
            };
        }
        if (queueSize > 0) {
            return {
                state: 'pending',
                icon: ICONS.pending,
                tooltip: `${toFa(queueSize)} تغییر در انتظار همگام‌سازی`,
                ariaLabel: `${toFa(queueSize)} تغییر در انتظار`
            };
        }
    }

    if (online) {
        return {
            state: 'online',
            icon: ICONS.online,
            tooltip: 'آنلاین',
            ariaLabel: 'آنلاین'
        };
    }

    return {
        state: 'unknown',
        icon: ICONS.unknown,
        tooltip: 'در حال بررسی…',
        ariaLabel: 'در حال بررسی اتصال'
    };
}

/**
 * اعمال وضعیت روی DOM.
 */
function _apply() {
    if (_updating) return;
    _updating = true;
    try {
        if (!_el || !_el.isConnected) return;

        const status = _computeStatus();
        const queueSize = (state.sync && Array.isArray(state.sync.queue))
            ? state.sync.queue.length
            : 0;
        const badgeText = queueSize > 0
            ? (queueSize > 99 ? '۹۹+' : toFa(queueSize))
            : '';

        const signature = `${status.state}|${status.icon}|${badgeText}|${status.tooltip}`;
        if (signature === _lastSignature && _el.isConnected) {
            if (_el.dataset.status !== status.state) {
                _el.dataset.status = status.state;
            }
            return;
        }

        _lastSignature = signature;
        _el.dataset.status = status.state;

        const badgeHtml = badgeText
            ? `<span class="status-badge">${badgeText}</span>`
            : `<span class="status-badge" hidden></span>`;

        _el.innerHTML = `<span class="status-icon" aria-hidden="true">${status.icon}</span>${badgeHtml}`;
        _el.title = status.tooltip;
        _el.setAttribute('aria-label', status.ariaLabel);
    } finally {
        _updating = false;
    }
}

function _scheduleUpdate(options) {
    const opts = options || {};
    if (opts.immediate) {
        clearTimeout(_debounceTimer);
        _debounceTimer = null;
        _apply();
        return;
    }
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => {
        _debounceTimer = null;
        _apply();
    }, UPDATE_DEBOUNCE_MS);
}

/**
 * به‌روزرسانی فوری نشانگر.
 */
export function updateHeaderStatus(options) {
    _scheduleUpdate(options);
}

/**
 * راه‌اندازی نشانگر وضعیت.
 */
export function initHeaderStatus() {
    if (_started) return;
    _started = true;

    _el = document.getElementById(EL_ID);
    if (!_el) return;

    events.on(EV.NET_CHANGE, () => _scheduleUpdate());
    events.on(EV.NET_ONLINE, () => _scheduleUpdate({ immediate: true }));
    events.on(EV.NET_OFFLINE, () => _scheduleUpdate({ immediate: true }));

    events.on(EV.SYNC_QUEUE_CHANGED, () => _scheduleUpdate());
    events.on(EV.SYNC_ENQUEUED, () => _scheduleUpdate());
    events.on(EV.SYNC_FLUSHED, () => _scheduleUpdate());
    events.on(EV.SYNC_ERROR, () => _scheduleUpdate());

    events.on(EV.TASK_SAVED, () => _scheduleUpdate());
    events.on(EV.TASK_DELETED, () => _scheduleUpdate());
    events.on(EV.TASK_RESTORED, () => _scheduleUpdate());

    _el.addEventListener('click', () => {
        events.emit('header-status:clicked', _computeStatus());
    });

    _lastSignature = '';
    _apply();
}

/**
 * توقف نشانگر.
 */
export function stopHeaderStatus() {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
    _started = false;
    _el = null;
    _lastSignature = '';
}

/**
 * اطلاعات دیباگ.
 */
export function headerStatusDebug() {
    return {
        started: _started,
        hasElement: Boolean(_el),
        lastSignature: _lastSignature,
        status: _computeStatus(),
        queueSize: (state.sync && Array.isArray(state.sync.queue)) ? state.sync.queue.length : 0,
        online: state.net ? state.net.online : null
    };
}