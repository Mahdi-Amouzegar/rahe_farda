// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// pwa.js -- PWA Enhancements: Badge API + Shortcuts + Periodic Sync (ESM)
//
// ⚠️ این ماژول مسئول:
//   - Badge API: نمایش تعداد taskهای امروز روی آیکن PWA
//   - Shortcuts: هندل پارامترهای URL از manifest shortcuts
//   - Periodic Background Sync: ثبت periodic sync (اختیاری، فقط Chrome/Edge)
//
// ⚠️ Offline-First:
//   - Badge فقط بر اساس data محلی محاسبه می‌شود — هیچ درخواست شبکه‌ای ندارد.
//   - Periodic Sync فقط اگر مرورگر پشتیبانی کند و کاربر اجازه بدهد ثبت می‌شود.
//   - در صورت نبود پشتیبانی، silent fallback — هیچ خطایی نمایش داده نمی‌شود.
//
// ⚠️ پشتیبانی مرورگر:
//   - Badge API: Chrome 81+, Edge 81+, Safari iOS ❌ (silent fallback)
//   - Shortcuts: Chrome 96+, Edge 96+, Safari ❌ (فقط از manifest می‌آید)
//   - Periodic Sync: Chrome 80+, Edge 80+ (نیاز به نصب PWA + permission)
// ═══════════════════════════════════════════════════════════════════════════

import { state } from './core.js';
import { events, EV } from './events.js';
import { getNow } from './time.js';
import { dayKey } from './sessions.js';
import { switchToTab } from './map.js';

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/** Tag برای Periodic Background Sync */
const PERIODIC_SYNC_TAG = 'rahe-periodic-sync';

/** حداقل فاصله بین دو periodic sync (۲۴ ساعت) */
const PERIODIC_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** حداکثر عدد روی badge (بالاتر از این، "99+" نمایش داده می‌شود) */
const BADGE_MAX = 99;

// ═══════════════════════════════════════════════════════════════════════════
// Local state
// ═══════════════════════════════════════════════════════════════════════════

/** @type {boolean} */
let _started = false;

/** @type {number|null} */
let _badgeDebounceTimer = null;

/** @type {number} — آخرین تعداد badge که ست شد (برای جلوگیری از تماس تکراری) */
let _lastBadgeCount = -1;

// ═══════════════════════════════════════════════════════════════════════════
// Badge API — feature detection
// ═══════════════════════════════════════════════════════════════════════════

/**
 * آیا Badge API در این مرورگر پشتیبانی می‌شود؟
 * @returns {boolean}
 */
export function badgeSupported() {
    return typeof navigator !== 'undefined'
        && typeof navigator.setAppBadge === 'function';
}

// ═══════════════════════════════════════════════════════════════════════════
// Badge API — محاسبه تعداد
// ═══════════════════════════════════════════════════════════════════════════

/**
 * شمارش taskهای امروز که هنوز انجام نشده‌اند.
 *
 * قواعد:
 *   - فقط task/child غیر archived
 *   - فقط completed = false
 *   - باید حداقل یک session امروز داشته باشد
 *   - اگر task هیچ sessionی ندارد، شمرده نمی‌شود (چون "امروز" نیست)
 *   - برای plan، زیرکارهایش جدا شمرده می‌شوند
 *
 * @returns {number}
 */
function _countTodayTasks() {
    if (!Array.isArray(state.tasks)) return 0;
    const todayKey = dayKey(getNow());
    let count = 0;

    const checkItem = (item) => {
        if (!item || item.archived || item.completed) return false;
        const sessions = item.sessions || [];
        return sessions.some(s => {
            if (!s || !s.at) return false;
            try {
                return dayKey(new Date(s.at)) === todayKey;
            } catch {
                return false;
            }
        });
    };

    for (const t of state.tasks) {
        if (!t || t.archived) continue;
        if (t.kind === 'plan') {
            const children = t.children || [];
            for (const c of children) {
                if (checkItem(c)) count++;
            }
        } else {
            if (checkItem(t)) count++;
        }
    }

    return count;
}

// ═══════════════════════════════════════════════════════════════════════════
// Badge API — ست و پاک‌سازی
// ═══════════════════════════════════════════════════════════════════════════

/**
 * به‌روزرسانی badge با تعداد taskهای امروز.
 *
 * اگر count = 0 → badge پاک می‌شود.
 * اگر count > BADGE_MAX → "99+" (در واقع عدد BADGE_MAX ست می‌شود).
 *
 * این تابع debounced است — فراخوانی‌های سریع ادغام می‌شوند.
 *
 * @param {{ immediate?: boolean }} [options]
 */
export function updateBadge(options) {
    const opts = options || {};
    const delay = opts.immediate ? 0 : 300;

    clearTimeout(_badgeDebounceTimer);
    _badgeDebounceTimer = setTimeout(() => {
        _badgeDebounceTimer = null;
        _applyBadge();
    }, delay);
}

/**
 * اعمال واقعی badge (بدون debounce).
 * @private
 */
async function _applyBadge() {
    if (!badgeSupported()) return;

    const count = _countTodayTasks();
    const displayCount = Math.min(count, BADGE_MAX);

    // اگر عدد تغییر نکرده، دوباره تماس نزن (جلوگیری از overhead)
    if (displayCount === _lastBadgeCount) return;

    try {
        if (count === 0) {
            await navigator.clearAppBadge();
            _lastBadgeCount = 0;
            events.emit(EV.PWA_BADGE_CLEARED, {});
        } else {
            await navigator.setAppBadge(displayCount);
            _lastBadgeCount = displayCount;
            events.emit(EV.PWA_BADGE_UPDATED, { count });
        }
    } catch (err) {
        // برخی مرورگرها ممکن است به دلایل امنیتی reject کنند — silent
        console.warn('pwa: badge update failed', err && err.message);
        _lastBadgeCount = -1; // اجازه‌ی تلاش مجدد در فراخوانی بعدی
    }
}

/**
 * پاک‌سازی فوری badge.
 */
export async function clearBadge() {
    clearTimeout(_badgeDebounceTimer);
    _badgeDebounceTimer = null;
    if (!badgeSupported()) return;
    try {
        await navigator.clearAppBadge();
        _lastBadgeCount = 0;
        events.emit(EV.PWA_BADGE_CLEARED, {});
    } catch { /* silent */ }
}

// ═══════════════════════════════════════════════════════════════════════════
// Shortcuts — هندل پارامترهای URL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * هندل پارامترهای URL که از manifest shortcuts می‌آیند.
 *
 * Shortcuts در manifest.webmanifest:
 *   ./?action=new-task
 *   ./?action=new-plan
 *   ./?action=new-series
 *   ./?tab=map
 *
 * این تابع در boot صدا زده می‌شود.
 * ⚠️ بعد از اعمال، پارامترها را از URL حذف می‌کند تا reload دوباره اعمال نشوند.
 */
export function handleShortcuts() {
    if (typeof window === 'undefined') return;
    let params;
    try {
        params = new URLSearchParams(window.location.search);
    } catch {
        return;
    }

    const action = params.get('action');
    const tab = params.get('tab');
    if (!action && !tab) return;

    // اعمال با تأخیر کوتاه — تا DOM آماده باشد و setKind در app.js ثبت شده باشد
    setTimeout(() => {
        try {
            if (tab === 'map') {
                switchToTab('map');
                const mapPanel = document.getElementById('panelMap');
                if (mapPanel) {
                    mapPanel.scrollIntoView({ behavior: 'smooth' });
                }
            } else if (action === 'new-task' || action === 'new-plan' || action === 'new-series') {
                // setKind از app.js در دسترس است — اما آن را مستقیم import نمی‌کنیم
                // چون app.js entry point است و circular import می‌شود.
                // در عوض از یک event استفاده می‌کنیم.
                events.emit('pwa:shortcut-action', { action });

                // به tab وظایف برو
                switchToTab('tasks');

                // اسکرول به فرم افزودن
                const createZone = document.querySelector('.create-zone');
                if (createZone) {
                    createZone.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }

                // فوکوس روی input بعد از scroll
                setTimeout(() => {
                    const ti = document.getElementById('taskInput');
                    if (ti) ti.focus({ preventScroll: true });
                }, 400);
            }
        } catch (err) {
            console.warn('pwa: shortcut handling failed', err);
        }
    }, 100);

    // پاک‌سازی URL (بدون reload)
    try {
        const url = new URL(window.location.href);
        url.searchParams.delete('action');
        url.searchParams.delete('tab');
        const newUrl = url.pathname + (url.search ? url.search : '') + url.hash;
        window.history.replaceState({}, '', newUrl);
    } catch { /* silent */ }
}

// ═══════════════════════════════════════════════════════════════════════════
// Periodic Background Sync (اختیاری)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * آیا Periodic Background Sync پشتیبانی می‌شود؟
 * @returns {Promise<boolean>}
 */
async function _periodicSyncSupported() {
    try {
        if (!('serviceWorker' in navigator)) return false;
        const reg = await navigator.serviceWorker.ready;
        if (!('periodicSync' in reg)) return false;
        // بررسی permission
        if (!('permissions' in navigator)) return false;
        const status = await navigator.permissions.query({
            name: 'periodic-background-sync'
        });
        return status.state === 'granted';
    } catch {
        return false;
    }
}

/**
 * ثبت Periodic Background Sync.
 *
 * ⚠️ این تابع:
 *   - فقط در Chrome/Edge نصب‌شده (PWA) کار می‌کند.
 *   - silent fallback در مرورگرهای دیگر.
 *   - در فاز ۵ فقط ثبت می‌شود — SW در فاز ۶ از آن استفاده می‌کند.
 *
 * @returns {Promise<boolean>} آیا ثبت شد؟
 */
export async function registerPeriodicSync() {
    try {
        const supported = await _periodicSyncSupported();
        if (!supported) return false;

        const reg = await navigator.serviceWorker.ready;
        await reg.periodicSync.register(PERIODIC_SYNC_TAG, {
            minInterval: PERIODIC_SYNC_INTERVAL_MS
        });
        return true;
    } catch (err) {
        // silent — این API اختیاری است
        console.warn('pwa: periodic sync registration failed', err && err.message);
        return false;
    }
}

/**
 * لغو ثبت Periodic Background Sync.
 * @returns {Promise<boolean>}
 */
export async function unregisterPeriodicSync() {
    try {
        if (!('serviceWorker' in navigator)) return false;
        const reg = await navigator.serviceWorker.ready;
        if (!('periodicSync' in reg)) return false;
        await reg.periodicSync.unregister(PERIODIC_SYNC_TAG);
        return true;
    } catch {
        return false;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════════════════════════════════

/**
 * راه‌اندازی PWA Enhancements.
 *
 * این تابع:
 *   - Badge را مقداردهی اولیه می‌کند
 *   - Shortcuts را هندل می‌کند
 *   - Periodic Sync را تلاش می‌کند (اختیاری، فقط اگر PWA نصب باشد)
 *
 * ⚠️ idempotent است.
 */
export function initPWA() {
    if (_started) return;
    _started = true;

    // Badge اولیه (بعد از loadTasks و render)
    // کمی تأخیر می‌دهیم تا state.tasks پر شود
    setTimeout(() => {
        updateBadge({ immediate: true });
    }, 800);

    // Shortcuts
    handleShortcuts();

    // Periodic Sync (اختیاری، silent)
    // فقط اگر برنامه به صورت PWA نصب شده باشد
    if (window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true) {
        registerPeriodicSync().catch(() => {});
    }

    // ⚠️ Badge را بعد از هر رندر به‌روز کن
    // از یک debounce داخلی استفاده می‌کنیم تا هزینه‌ی هر render ناچیز باشد.
    events.on(EV.UI_RENDER_REQUESTED, () => {
        updateBadge();
    });
    events.on(EV.TASK_SAVED, () => {
        updateBadge();
    });
    events.on(EV.TASK_DELETED, () => {
        updateBadge();
    });
    events.on(EV.TASK_RESTORED, () => {
        updateBadge();
    });

    // ⚠️ فاز ۶: وقتی visibility صفحه عوض شد، badge را refresh کن
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            updateBadge({ immediate: true });
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// Debug helper (DEV only)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * اطلاعات دیباگ PWA (فقط برای console).
 * @returns {object}
 */
export function pwaDebugInfo() {
    return {
        badgeSupported: badgeSupported(),
        lastBadgeCount: _lastBadgeCount,
        todayCount: _countTodayTasks(),
        standalone: typeof window !== 'undefined'
            ? (window.matchMedia('(display-mode: standalone)').matches
                || window.navigator.standalone === true)
            : false,
        started: _started
    };
}