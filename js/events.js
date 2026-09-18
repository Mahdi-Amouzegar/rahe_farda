// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// events.js -- EventEmitter سبک برای حذف وابستگی دوطرفه بین ماژول‌ها (ESM)
//
// این ماژول جایگزین الگوی registerCallbacks / _callbacks در ماژول‌های
// store.js, map.js, detail.js, location-ui.js, app.js می‌شود.
//
// قواعد نام‌گذاری رویدادها: domain:action
// مثال‌ها:
//   task:saved            — بعد از هر ذخیره‌سازی موفق
//   task:deleted          — بعد از انتقال به سطل زباله
//   task:restored         — بعد از بازگردانی از سطل زباله
//   map:ready             — بعد از آماده شدن نقشه
//   map:destroyed         — بعد از تخریب نقشه
//   map:markers-refreshed — بعد از رفرش مارکرها
//   detail:opened         — بعد از باز شدن صفحه جزئیات
//   detail:closed         — بعد از بستن صفحه جزئیات
//   location:updated      — بعد از تغییر لیست مکان‌های ذخیره‌شده
//   ui:render-requested   — درخواست رندر از هر ماژول
//   ui:snackbar           — نمایش snackbar با undo
//   modal:confirm         — درخواست confirm modal
//
// ⚠️ فاز ۵ گام ۵ (PWA + Sync Queue):
//   - net:*   — رویدادهای شبکه (آنلاین/آفلاین)
//   - sync:*  — رویدادهای صف sync
//   - pwa:*   — رویدادهای PWA (badge)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @typedef {(...args: any[]) => void} Listener
 */

/**
 * EventEmitter سبک با پشتیبانی از on/off/once/emit.
 *
 * ویژگی‌ها:
 *  - on() یک تابع off برمی‌گرداند (convenient unsubscribe)
 *  - emit() خطای یک listener را نمی‌بلعد اما بقیه را متوقف نمی‌کند
 *  - clear() برای cleanup در تست‌ها یا hot-reload
 *  - listenerCount() برای دیباگ
 */
export class EventEmitter {
    constructor() {
        /** @type {Map<string, Set<Listener>>} */
        this._listeners = new Map();
        /** @type {Map<string, Set<Listener>>} */
        this._onceListeners = new Map();
    }

    /**
     * ثبت یک listener برای رویداد.
     * @param {string} event
     * @param {Listener} listener
     * @returns {() => void} تابع unsubscribe
     */
    on(event, listener) {
        if (typeof listener !== 'function') {
            throw new TypeError(`EventEmitter.on: listener must be a function for event "${event}"`);
        }
        const key = String(event);
        let set = this._listeners.get(key);
        if (!set) {
            set = new Set();
            this._listeners.set(key, set);
        }
        set.add(listener);
        return () => this.off(key, listener);
    }

    /**
     * ثبت listener که فقط یک بار اجرا می‌شود.
     * @param {string} event
     * @param {Listener} listener
     * @returns {() => void} تابع unsubscribe
     */
    once(event, listener) {
        if (typeof listener !== 'function') {
            throw new TypeError(`EventEmitter.once: listener must be a function for event "${event}"`);
        }
        const key = String(event);
        let set = this._onceListeners.get(key);
        if (!set) {
            set = new Set();
            this._onceListeners.set(key, set);
        }
        set.add(listener);
        return () => {
            const s = this._onceListeners.get(key);
            if (s) s.delete(listener);
        };
    }

    /**
     * حذف یک listener مشخص.
     * @param {string} event
     * @param {Listener} listener
     * @returns {boolean} آیا listener پیدا و حذف شد؟
     */
    off(event, listener) {
        const key = String(event);
        let removed = false;
        const set = this._listeners.get(key);
        if (set && set.delete(listener)) removed = true;
        const onceSet = this._onceListeners.get(key);
        if (onceSet && onceSet.delete(listener)) removed = true;
        return removed;
    }

    /**
     * انتشار رویداد با آرگومان‌های دلخواه.
     *
     * نکته: اگر یک listener خطا بدهد، خطا log می‌شود اما بقیه listenerها
     * همچنان اجرا می‌شوند. این تصمیم برای پایداری UI گرفته شده — یک
     * listener معیوب نباید کل زنجیره را متوقف کند.
     *
     * @param {string} event
     * @param {...any} args
     * @returns {number} تعداد listenerهایی که اجرا شدند
     */
    emit(event, ...args) {
        const key = String(event);
        let count = 0;

        // on() listeners
        const set = this._listeners.get(key);
        if (set && set.size > 0) {
            // کپی از set برای جلوگیری از mutation در حین iteration
            const snapshot = Array.from(set);
            for (const listener of snapshot) {
                try {
                    listener(...args);
                    count++;
                } catch (err) {
                    // eslint-disable-next-line no-console
                    console.error(`EventEmitter: listener for "${key}" threw:`, err);
                }
            }
        }

        // once() listeners
        const onceSet = this._onceListeners.get(key);
        if (onceSet && onceSet.size > 0) {
            const snapshot = Array.from(onceSet);
            for (const listener of snapshot) {
                onceSet.delete(listener);
                try {
                    listener(...args);
                    count++;
                } catch (err) {
                    // eslint-disable-next-line no-console
                    console.error(`EventEmitter: once listener for "${key}" threw:`, err);
                }
            }
        }

        return count;
    }

    /**
     * حذف همه‌ی listenerهای یک رویداد (یا همه‌ی رویدادها اگر event داده نشود).
     * @param {string} [event]
     */
    clear(event) {
        if (event === undefined) {
            this._listeners.clear();
            this._onceListeners.clear();
            return;
        }
        const key = String(event);
        this._listeners.delete(key);
        this._onceListeners.delete(key);
    }

    /**
     * تعداد listenerهای یک رویداد (فقط برای دیباگ/تست).
     * @param {string} event
     * @returns {number}
     */
    listenerCount(event) {
        const key = String(event);
        const set = this._listeners.get(key);
        const onceSet = this._onceListeners.get(key);
        return (set ? set.size : 0) + (onceSet ? onceSet.size : 0);
    }

    /**
     * آیا رویدادی listener دارد؟
     * @param {string} event
     * @returns {boolean}
     */
    hasListeners(event) {
        return this.listenerCount(event) > 0;
    }

    /**
     * لیست همه‌ی رویدادهای ثبت‌شده (فقط برای دیباگ/تست).
     * @returns {string[]}
     */
    eventNames() {
        const names = new Set([
            ...this._listeners.keys(),
            ...this._onceListeners.keys()
        ]);
        return Array.from(names);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// نمونه‌ی global — تنها نقطه‌ی اشتراک بین ماژول‌ها
// ═══════════════════════════════════════════════════════════════════════════
//
// از آنجایی که ESM یک singleton در سطح ماژول دارد، همه‌ی ماژول‌هایی که
// این فایل را import می‌کنند، همین نمونه را می‌بینند. پس نیازی به
// window.__events یا الگوهای مشابه نیست.

export const events = new EventEmitter();

// ═══════════════════════════════════════════════════════════════════════════
// نام‌های رویداد — به صورت const برای جلوگیری از typo
// ═══════════════════════════════════════════════════════════════════════════

export const EV = {
    // ─── Store ───
    TASK_SAVED: 'task:saved',
    TASK_DELETED: 'task:deleted',
    TASK_RESTORED: 'task:restored',
    TRASH_EMPTIED: 'trash:emptied',
    TRASH_PURGED: 'trash:purged',
    STORAGE_ERROR: 'storage:error',

    // ─── Map ───
    MAP_READY: 'map:ready',
    MAP_DESTROYED: 'map:destroyed',
    MAP_MARKERS_REFRESHED: 'map:markers-refreshed',
    MAP_LOCATION_PICKED: 'map:location-picked',
    MAP_HINT: 'map:hint',

    // ─── Detail ───
    DETAIL_OPENED: 'detail:opened',
    DETAIL_CLOSED: 'detail:closed',

    // ─── Location UI ───
    LOCATION_UPDATED: 'location:updated',
    LOCATION_PENDING_CHANGED: 'location:pending-changed',

    // ─── UI ───
    UI_RENDER_REQUESTED: 'ui:render-requested',
    UI_SNACKBAR: 'ui:snackbar',
    UI_HIDE_SNACKBAR: 'ui:hide-snackbar',
    UI_OPEN_DETAIL: 'ui:open-detail',
    UI_SWITCH_TAB: 'ui:switch-tab',

    // ─── Modals ───
    MODAL_CONFIRM: 'modal:confirm',
    MODAL_INFO: 'modal:info',

    // ─── Route ───
    ROUTE_SHOW: 'route:show',
    ROUTE_CLEAR: 'route:clear',

    // ─── Notifications ───
    NOTIF_CHIME: 'notif:chime',

    // ═══════════════════════════════════════════════════════════════════════
    // ⚠️ فاز ۵ گام ۵: رویدادهای شبکه (net)
    // ═══════════════════════════════════════════════════════════════════════
    //
    // NET_ONLINE   — دستگاه آنلاین شد (از navigator.onLine یا probe)
    // NET_OFFLINE  — دستگاه آفلاین شد (از navigator.onLine)
    // NET_CHANGE   — هر تغییر وضعیت شبکه (شامل init)
    //
    // payload:
    //   { online: boolean, source: 'init'|'browser-event'|'probe',
    //     effectiveType: string|null }
    NET_ONLINE: 'net:online',
    NET_OFFLINE: 'net:offline',
    NET_CHANGE: 'net:change',

    // ═══════════════════════════════════════════════════════════════════════
    // ⚠️ فاز ۵ گام ۵: رویدادهای صف sync
    // ═══════════════════════════════════════════════════════════════════════
    //
    // SYNC_ENQUEUED       — یک op جدید به صف اضافه شد
    //   payload: { op: {...} }
    //
    // SYNC_QUEUE_CHANGED  — صف تغییر کرد (افزودن/حذف/پاک‌سازی)
    //   payload: { size: number }
    //
    // SYNC_FLUSHED        — flush موفق (حداقل یک op پردازش شد)
    //   payload: { processed: number, remaining: number }
    //
    // SYNC_ERROR          — خطا در flush
    //   payload: { failed: number, lastError: string }
    //
    // SYNC_AUTH_EXPIRED   — توکن منقضی (فاز ۶ — Cloudflare)
    //   payload: {}
    SYNC_ENQUEUED: 'sync:enqueued',
    SYNC_QUEUE_CHANGED: 'sync:queue-changed',
    SYNC_FLUSHED: 'sync:flushed',
    SYNC_ERROR: 'sync:error',
    SYNC_AUTH_EXPIRED: 'sync:auth-expired',

    // ═══════════════════════════════════════════════════════════════════════
    // ⚠️ فاز ۵ گام ۴: رویدادهای PWA
    // ═══════════════════════════════════════════════════════════════════════
    //
    // PWA_BADGE_UPDATED  — badge به‌روزرسانی شد
    //   payload: { count: number }
    //
    // PWA_BADGE_CLEARED  — badge پاک شد
    //   payload: {}
    PWA_BADGE_UPDATED: 'pwa:badge-updated',
    PWA_BADGE_CLEARED: 'pwa:badge-cleared'
};

// ═══════════════════════════════════════════════════════════════════════════
// نام‌های callback — برای سازگاری با کد فعلی
// ═══════════════════════════════════════════════════════════════════════════
//
// نگاشت نام callback قبلی → نام رویداد جدید:
export const CALLBACK_TO_EVENT = {
    // از store.js
    render: EV.UI_RENDER_REQUESTED,
    updateDueChips: 'ui:update-due-chips',
    renderPlanKids: 'ui:render-plan-kids',
    updateLocChip: EV.LOCATION_PENDING_CHANGED,
    openDetail: EV.UI_OPEN_DETAIL,
    showUndoFor: EV.UI_SNACKBAR,
    showConfirmModal: EV.MODAL_CONFIRM,
    renderTrash: 'ui:render-trash',
    getMap: 'map:get-instance',
    getMapReady: 'map:get-ready',
    getPickMarker: 'map:get-pick-marker',
    setPickMarker: 'map:set-pick-marker',

    // از map.js
    showRouteTo: EV.ROUTE_SHOW,
    saveLocationFromPopup: 'location:save-from-popup',
    refreshSavedLocationUI: EV.LOCATION_UPDATED,
    locationLabelFor: 'location:label-for',
    showMobilePickBanner: 'location:show-mobile-banner',
    hideMobilePickBanner: 'location:hide-mobile-banner',
    isRelocateLocationActive: 'location:is-relocate-active',
    clearMapRoute: EV.ROUTE_CLEAR,
    hasActiveRoute: 'route:has-active',
    getActiveRouteDestination: 'route:get-destination',

    // از detail.js
    showMobilePickBannerDetail: 'location:show-mobile-banner',
    hideMobilePickBannerDetail: 'location:hide-mobile-banner',

    // ⚠️ فاز ۵ گام ۵: نگاشت‌های جدید (برای آینده)
    // — این‌ها فعلاً استفاده نمی‌شوند اما در فاز ۶ ممکن است لازم شوند
    flushSyncQueue: 'sync:flush-requested',
    getSyncQueue: 'sync:get-queue',
    getNetStatus: 'net:get-status'
};

// ═══════════════════════════════════════════════════════════════════════════
// bridgeCallbacks — آداپتور موقت (بدون تغییر، سازگاری حفظ شده)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * اتصال یک آبجکت callback-map به EventEmitter.
 *
 * این تابع یک آبجکت با کلیدهای نام callback (مثل render, openDetail)
 * دریافت می‌کند و برای هر کلید، یک listener روی رویداد متناظر ثبت می‌کند.
 *
 * @param {Record<string, Function>} callbacks
 * @returns {() => void} تابع cleanup که همه‌ی listenerها را حذف می‌کند
 */
export function bridgeCallbacks(callbacks) {
    const cleanups = [];
    if (!callbacks || typeof callbacks !== 'object') {
        return () => {};
    }
    for (const [name, fn] of Object.entries(callbacks)) {
        if (typeof fn !== 'function') continue;
        const eventName = CALLBACK_TO_EVENT[name];
        if (!eventName) continue;
        cleanups.push(events.on(eventName, fn));
    }
    return () => {
        for (const cleanup of cleanups) {
            try { cleanup(); } catch { /* silent */ }
        }
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ گام ۱۵: SHIM‌ها حذف شدند
// ═══════════════════════════════════════════════════════════════════════════