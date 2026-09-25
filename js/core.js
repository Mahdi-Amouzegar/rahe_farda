// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// core.js -- shared state + tiny helpers (ESM) — گام ۱ فاز ۵
//
// ⚠️ این نسخه helperهای export/import را اضافه کرده است.
// ⚠️ فاز ۵ گام ۵: state.net و state.sync برای شبکه و صف sync
// ⚠️ فاز ۴D گام ۳: formatBytes و faDate به i18n منتقل شدند
// ═══════════════════════════════════════════════════════════════════════════

import {
    formatBytes as i18nFormatBytes,
    formatDateTime as i18nFormatDateTime,
} from './i18n.js';

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════
export const STORAGE_KEY = 'spaceTodoTasks';
export const MAX_LENGTH = 200;
export const PREFS_KEY = 'spaceTodoPrefs';

// ⚠️ schema version برای export/import
export const SCHEMA_VERSION = '1.0.0';

// ⚠️ نام فایل backup پیش‌فرض
export const BACKUP_FILENAME_PREFIX = 'rahe-farda-backup';

// ═══════════════════════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════════════════════
export const state = {
    tasks: [],
    currentFilter: 'all',
    currentSort: 'newest',
    searchQuery: '',
    justAddedId: null,
    editingId: null,
    addDraftSessions: [],
    pendingLoc: null,
    pendingKind: 'task',
    expandedPlans: new Set(),
    childDrafts: {},
    planDraftKids: [],
    // تاریخ شروع/پایان موقت برای فرم افزودن برنامه
    planDraftStart: null,
    planDraftEnd: null,
    seriesType: 'daily',
    seriesN: 8,
    seriesDays: [],
    prefs: {
        mapVisible: true,
        remindOn: true,
        remindMin: 60,
        digestOn: true,
        lastDigest: '',
        tourSeen: false,
        proMode: false,
        pendingKind: 'task',
        soundOn: true,
        // ⚠️ تنظیمات صدا
        soundDefault: true,
        soundPreset: null,
        soundPresetOn: false,
        soundTtsOn: false,
        soundTtsVoice: null,
        theme: 'auto'
    },
    selectedDay: null,
    calJy: 0,
    calJm: 1,
    // ⚠️ فاز ۴D.5: تقویم میلادی (تقویم جلسات)
    calGy: 0,                  // سال میلادی
    calGm: 1,                  // ماه میلادی (۱-۱۲)
    pickerMode: 'add',
    pickerJy: 0,
    pickerJm: 1,
    // ⚠️ فاز ۴D.5: تقویم میلادی (picker)
    pickerCalendar: 'jalali',  // 'jalali' | 'gregorian'
    pickerGy: 0,               // سال میلادی
    pickerGm: 1,               // ماه میلادی (۱-۱۲)
    pickerDay: null,
    pickerCallback: null,
    currentDetailId: null,
    relocateSess: null,
    relocateTaskId: null,
    pendingReturnDetail: null,
    timeOffsetMs: 0,
    taskIndexVersion: 0,
    taskIndex: null,
    trash: [],
    // ⚠️ صف تغییرات معلق (برای فاز ۶ — Cloudflare)
    pendingChanges: [],

    // ⚠️ فاز ۵ گام ۵: وضعیت شبکه (توسط net.js مقداردهی می‌شود)
    net: {
        /** @type {boolean} آیا دستگاه آنلاین است؟ */
        online: typeof navigator !== 'undefined' ? navigator.onLine !== false : true,
        /** @type {number} زمان آخرین تغییر وضعیت (ms) */
        lastChangeAt: 0,
        /** @type {string|null} نوع اتصال (4g, 3g, ...) — Chrome/Edge فقط */
        effectiveType: null,
        /** @type {number|null} سرعت دانلود (Mbps) — Chrome/Edge فقط */
        downlink: null,
        /** @type {string|null} شناسه‌ی دستگاه (برای conflict resolution فاز ۶) */
        deviceId: null
    },

    // ⚠️ فاز ۵ گام ۵ + پایه‌ریزی فاز ۶: صف sync
    sync: {
        /** @type {object[]} ops در انتظار sync */
        queue: [],
        /** @type {boolean} آیا flush در حال اجراست؟ */
        inFlight: false,
        /** @type {number} شمارش کلی retry */
        retries: 0,
        /** @type {string|null} آخرین flush موفق (ISO) */
        lastFlushAt: null,
        /** @type {string|null} آخرین خطا */
        lastError: null,

        // ⚠️ فاز ۶: Cloudflare Worker + D1 + Telegram Login
        /** @type {boolean} آیا sync ابری فعال است؟ (پیش‌فرض: خیر — Offline-First) */
        enabled: false,
        /** @type {string|null} Cloudflare Worker endpoint */
        endpoint: null,
        /** @type {string|null} Telegram auth token */
        authToken: null,
        /** @type {string|null} Telegram user ID */
        userId: null,
        /** @type {string|null} شناسه‌ی دستگاه (از state.net.deviceId) */
        deviceId: null
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// DOM references
// ═══════════════════════════════════════════════════════════════════════════
export const input = document.getElementById('taskInput');
export const prioritySelect = document.getElementById('prioritySelect');
export const addBtn = document.getElementById('addBtn');
export const searchInput = document.getElementById('searchInput');
export const taskList = document.getElementById('taskList');
export const filterBtns = document.querySelectorAll('.filter-btn');
export const clearBtn = document.getElementById('clearDone');
export const totalCountEl = document.getElementById('totalCount');
export const doneCountEl = document.getElementById('doneCount');
export const remainCountEl = document.getElementById('remainCount');
export const progressFill = document.getElementById('progressFill');
export const progressPct = document.getElementById('progressPct');
export const progressBar = document.getElementById('progressBar');

export const PRIORITY_LABELS = {
    high: 'اولویت زیاد',
    medium: 'اولویت متوسط',
    low: 'اولویت کم'
};

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * فرمت عدد به فارسی (ارقام فارسی + جداکننده فارسی).
 *
 * ⚠️ فاز ۴D: این تابع فقط برای اعداد قطعاً فارسی باقی می‌ماند
 *    (مثل ارقام تقویم شمسی). برای اعداد locale-aware از
 *    `formatNumber()` در i18n.js استفاده کن.
 *
 * ⚠️ برای اعداد بزرگ، به‌طور خودکار جداکننده اضافه می‌کند (۱۲٬۳۴۵).
 */
export const toFa = n => Number(n).toLocaleString('fa-IR');

/**
 * فرمت تاریخ + ساعت بر اساس زبان فعلی.
 *
 * ⚠️ فاز ۴D: این تابع حالا به i18n واگذار شده است.
 *    fa → «۱۵ دی ۱۴۰۳، ۱۴:۳۰» (تقویم جلالی)
 *    en → «January 5, 2025, 2:30 PM» (تقویم میلادی)
 *
 * ⚠️ برای backward-compat نگه داشته شده. نام `faDate` تاریخی است
 *    ولی حالا locale-aware است.
 */
export function faDate(iso) {
    if (!iso) return '';
    return i18nFormatDateTime(iso);
}

export function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const ESCAPE_REGEX = /[&<>"']/g;
export function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(ESCAPE_REGEX, c => ESCAPE_MAP[c]);
}

export function debounce(fn, ms) {
    let timer = null;
    const wrapped = function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            fn.apply(this, args);
        }, ms);
    };
    wrapped.cancel = () => { clearTimeout(timer); timer = null; };
    wrapped.flush = function (...args) {
        if (timer) {
            clearTimeout(timer);
            timer = null;
            fn.apply(this, args);
        }
    };
    return wrapped;
}

// ═══════════════════════════════════════════════════════════════════════════
// Export/Import helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * فرمت حجم بر اساس زبان فعلی.
 *
 * ⚠️ فاز ۴D: این تابع حالا در i18n.js پیاده شده است.
 *    اینجا فقط re-export می‌شود تا backward-compat حفظ شود.
 *
 * ⚠️ خروجی:
 *    fa → «۵ مگابایت»
 *    en → «5 MB»
 */
export const formatBytes = i18nFormatBytes;

export function downloadJSON(data, filename) {
    try {
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || `backup-${Date.now()}.json`;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            a.remove();
            URL.revokeObjectURL(url);
        }, 100);
        return true;
    } catch (err) {
        console.error('downloadJSON failed:', err);
        return false;
    }
}

export function readJSONFile(file) {
    return new Promise((resolve, reject) => {
        if (!file) {
            reject(new Error('no-file'));
            return;
        }
        const MAX_SIZE = 50 * 1024 * 1024;
        if (file.size > MAX_SIZE) {
            reject(new Error('file-too-large'));
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const text = typeof reader.result === 'string' ? reader.result : '';
                const data = JSON.parse(text);
                resolve(data);
            } catch (err) {
                reject(new Error('invalid-json'));
            }
        };
        reader.onerror = () => reject(new Error('read-error'));
        reader.readAsText(file, 'utf-8');
    });
}

export async function computeChecksum(str) {
    try {
        if (window.crypto && crypto.subtle && crypto.subtle.digest) {
            const encoder = new TextEncoder();
            const data = encoder.encode(str);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        }
    } catch {
        // fallback
    }
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return 'fallback-' + Math.abs(hash).toString(16);
}

export function buildBackupFilename() {
    try {
        const d = new Date();
        const y = d.toLocaleDateString('fa-IR', { year: 'numeric' }).replace(/[^\d]/g, '');
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return `${BACKUP_FILENAME_PREFIX}-${y}${m}${day}-${hh}${mm}.json`;
    } catch {
        return `${BACKUP_FILENAME_PREFIX}-${Date.now()}.json`;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Focus trap
// ═══════════════════════════════════════════════════════════════════════════

export function trapFocus(container) {
    if (!container) return () => {};
    const selectors = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = () => Array.from(container.querySelectorAll(selectors)).filter(el => {
        if (el.offsetParent === null) return false;
        if (el.getAttribute('aria-hidden') === 'true') return false;
        return true;
    });
    const handler = e => {
        if (e.key !== 'Tab') return;
        const list = focusables();
        if (list.length === 0) {
            e.preventDefault();
            return;
        }
        const first = list[0];
        const last = list[list.length - 1];
        const active = document.activeElement;
        if (e.shiftKey) {
            if (active === first || !container.contains(active)) {
                e.preventDefault();
                last.focus();
            }
        } else {
            if (active === last || !container.contains(active)) {
                e.preventDefault();
                first.focus();
            }
        }
    };
    container.addEventListener('keydown', handler);
    return () => container.removeEventListener('keydown', handler);
}

// ═══════════════════════════════════════════════════════════════════════════
// Modals
// ═══════════════════════════════════════════════════════════════════════════

export function showConfirmModal(options) {
    const opts = options || {};
    const overlay = document.getElementById('confirmModal');
    if (!overlay) {
        return Promise.resolve(window.confirm(opts.message || 'مطمئن هستید؟'));
    }

    const titleEl = document.getElementById('confirmModalTitle');
    const msgEl = document.getElementById('confirmModalMessage');
    const okBtn = document.getElementById('confirmModalOk');
    const cancelBtn = document.getElementById('confirmModalCancel');

    if (titleEl) titleEl.textContent = opts.title || 'تأیید';
    if (msgEl) msgEl.textContent = opts.message || '';
    if (okBtn) {
        okBtn.textContent = opts.confirmText || 'تأیید';
        okBtn.classList.toggle('danger', Boolean(opts.danger));
    }
    if (cancelBtn) cancelBtn.textContent = opts.cancelText || 'انصراف';

    const previousFocus = document.activeElement;

    return new Promise(resolve => {
        let trapCleanup = null;

        const cleanup = () => {
            overlay.style.display = 'none';
            overlay.classList.remove('picker-overlay--stacked');
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            overlay.removeEventListener('click', onOverlay);
            document.removeEventListener('keydown', onKey);
            if (trapCleanup) { trapCleanup(); trapCleanup = null; }

            if (previousFocus && document.body.contains(previousFocus) && typeof previousFocus.focus === 'function') {
                setTimeout(() => previousFocus.focus(), 30);
            }
        };

        const finish = value => {
            cleanup();
            resolve(value);
        };

        const onOk = e => { e.preventDefault(); finish(true); };
        const onCancel = e => { e.preventDefault(); finish(false); };
        const onOverlay = e => { if (e.target === overlay) finish(false); };
        const onKey = e => {
            if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        };

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        overlay.addEventListener('click', onOverlay);
        document.addEventListener('keydown', onKey);

        overlay.classList.add('picker-overlay--stacked');
        overlay.style.display = 'flex';
        trapCleanup = trapFocus(overlay);

        setTimeout(() => {
            if (opts.danger) cancelBtn.focus();
            else okBtn.focus();
        }, 60);
    });
}

export function showInfoModal(options) {
    const opts = options || {};
    const overlay = document.getElementById('infoModal');
    if (!overlay) {
        if (opts.fallbackAlert) window.alert(opts.fallbackAlert);
        return Promise.resolve();
    }

    const titleEl = document.getElementById('infoModalTitle');
    const bodyEl = document.getElementById('infoModalBody');
    const okBtn = document.getElementById('infoModalOk');

    if (titleEl) titleEl.textContent = opts.title || 'اطلاعات';
    if (bodyEl) {
        if (Array.isArray(opts.paragraphs)) {
            bodyEl.innerHTML = opts.paragraphs.map(p => `<p>${p}</p>`).join('');
        } else if (typeof opts.html === 'string') {
            bodyEl.innerHTML = opts.html;
        } else {
            bodyEl.innerHTML = '';
        }
    }
    if (okBtn) okBtn.textContent = opts.buttonText || 'فهمیدم';

    const previousFocus = document.activeElement;

    return new Promise(resolve => {
        let trapCleanup = null;

        const cleanup = () => {
            overlay.style.display = 'none';
            overlay.classList.remove('picker-overlay--stacked');
            okBtn.removeEventListener('click', onOk);
            overlay.removeEventListener('click', onOverlay);
            document.removeEventListener('keydown', onKey);
            if (trapCleanup) { trapCleanup(); trapCleanup = null; }

            if (previousFocus && document.body.contains(previousFocus) && typeof previousFocus.focus === 'function') {
                setTimeout(() => previousFocus.focus(), 30);
            }
        };

        const finish = () => {
            cleanup();
            resolve();
        };

        const onOk = e => { e.preventDefault(); finish(); };
        const onOverlay = e => { if (e.target === overlay) finish(); };
        const onKey = e => {
            if (e.key === 'Escape') { e.preventDefault(); finish(); }
        };

        okBtn.addEventListener('click', onOk);
        overlay.addEventListener('click', onOverlay);
        document.addEventListener('keydown', onKey);

        overlay.classList.add('picker-overlay--stacked');
        overlay.style.display = 'flex';
        trapCleanup = trapFocus(overlay);

        setTimeout(() => okBtn.focus(), 60);
    });
}