// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// core.js -- shared state + tiny helpers (ESM)

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════
export const STORAGE_KEY = 'spaceTodoTasks';
export const MAX_LENGTH = 200;
export const PREFS_KEY = 'spaceTodoPrefs';

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
        theme: 'auto',
        lang: 'fa'
    },
    selectedDay: null,
    calJy: 0,
    calJm: 1,
    pickerMode: 'add',
    pickerJy: 0,
    pickerJm: 1,
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

export const toFa = n => Number(n).toLocaleString('fa-IR');

export function faDate(iso) {
    try {
        const d = new Date(iso);
        if (isNaN(d)) return '';
        return d.toLocaleDateString('fa-IR', { year: 'numeric', month: 'long', day: 'numeric' }) +
            '، ساعت ' + d.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
    } catch {
        return '';
    }
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

// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ گام ۱۵: SHIM‌ها حذف شدند
// ═══════════════════════════════════════════════════════════════════════════