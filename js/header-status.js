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
import { t as i18nT } from './i18n.js';

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
                tooltip: i18nT('header.status.offlineWithQueue', { n: toFa(queueSize) }),
                ariaLabel: i18nT('header.status.ariaOffline', { n: toFa(queueSize) })
            };
        }
        return {
            state: 'offline',
            icon: ICONS.offline,
            tooltip: i18nT('header.status.offline'),
            ariaLabel: i18nT('header.status.offline')
        };
    }

    if (online && syncEnabled) {
        if (inFlight) {
            return {
                state: 'syncing',
                icon: ICONS.syncing,
                tooltip: i18nT('header.status.syncing'),
                ariaLabel: i18nT('header.status.syncing')
            };
        }
        if (queueSize > 0) {
            return {
                state: 'pending',
                icon: ICONS.pending,
                tooltip: i18nT('header.status.pending', { n: toFa(queueSize) }),
                ariaLabel: i18nT('header.status.ariaPending', { n: toFa(queueSize) })
            };
        }
    }

    if (online) {
        return {
            state: 'online',
            icon: ICONS.online,
            tooltip: i18nT('header.status.online'),
            ariaLabel: i18nT('header.status.ariaOnline')
        };
    }

    return {
        state: 'unknown',
        icon: ICONS.unknown,
        tooltip: i18nT('header.status.unknown'),
        ariaLabel: i18nT('header.status.unknown')
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