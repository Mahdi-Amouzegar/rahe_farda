// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// detail.js -- detail page (ESM) — فاز ۴ گام ۴
//
// ⚠️ فاز ۴C (i18n):
//   - همه‌ی متن‌های hardcoded به i18n منتقل شدند
//   - formatDate از i18n برای تاریخ‌های locale-aware
//   - WEEK_ORDER به کلیدهای recur.dayOfWeek.X تبدیل شد
//
// ⚠️ این نسخه:
//   - _callbacks و registerDetailCallbacks با EventEmitter جایگزین شد
//   - رفتار صفحه جزئیات (ویرایش، جلسات، عکس، timer، smart suggest) بدون تغییر است
// ═══════════════════════════════════════════════════════════════════════════

import { state, uid, escapeHtml, debounce, showConfirmModal, trapFocus, MAX_LENGTH } from './core.js';
import { getNow } from './time.js';
import { findTask, saveTasks, enqueueDirtyTasks, moveToTrashById, sanitizeUrl } from './store.js';
import { faShort, hasSessionAt, parseDateText, validatePlanRange, activeSessionId, isSessionInactive, promoteFutureSession, anchorSessionId, isAnchorSession } from './sessions.js';
import {
    processImageFile,
    validateImageFile,
    formatBytes,
    dataUrlToBlob,
    MAX_PHOTOS_PER_TASK,
} from './media.js';
import {
    getUploadStatus,
    cancelUpload,
    retryFailedUploads,
    enqueueUpload,
} from './media-upload.js';
import {
    getCachedPhoto,
    putCachedPhoto,
    deleteCachedPhoto,
    fetchPhotoBlob,
    classifyPhotoForDisplay,
    isDeadPhotoRef,
    clampZoom,
    extForContentType,
} from './media-cache.js';
import { isOnline } from './net.js';
import {
    ensureMapVisible,
    switchToTab,
    mapHint,
    flyToTask,
    refreshMarkers,
    removePickMarker
} from './map.js';
import { openPicker } from './picker.js';
import { events, EV, CALLBACK_TO_EVENT } from './events.js';
import { isDetailBridgeReadOnly, getDetailBridgeRoot } from './tasks/source.js';
import { formatDate, formatNumber, getLang, t as i18nT } from './i18n.js';

// ═══════════════════════════════════════════════════════════════════════════
// حالت «فقط خواندنی» (10.25)
// ═══════════════════════════════════════════════════════════════════════════
//
// وقتی مخاطب/عضو گروه روی «جزئیات» وظیفه‌ای می‌زند که خودش نفرستاده، صفحه
// باید **دیده** شود ولی هیچ‌چیز ویرایش نشود: متن‌ها readOnly، selectها
// disabled، دکمه‌های افزودن/حذف/جابه‌جایی پنهان. پیش‌نمایش و دانلود عکس
// دست‌نخورده می‌ماند (فقط حذف/افزودن عکس پنهان است).
//
// ⚠️ فلگ در لحظه‌ی openDetail از پل مشترک خوانده می‌شود (نه از خود تسک)، چون
// زیرکارِ برنامه `_shared` ندارد و وضعیت فقط روی والد است.
let _readOnly = false;

/**
 * آیا صفحه‌ی جزئیاتِ باز، فقط‌خواندنی است؟ (برای تست/دیگر ماژول‌ها)
 * @returns {boolean}
 */
export function isDetailReadOnly() {
    return _readOnly;
}

/**
 * اعمال/برداشتن قفل ویرایش روی DOM جزئیات.
 * (export فقط برای تست — فراخوان اصلی openDetail است)
 * @param {boolean} ro
 */
export function applyDetailReadOnly(ro) {
    const pageEl = document.getElementById('detailPage');
    if (!pageEl) return;
    pageEl.classList.toggle('readonly', ro);

    // متن‌ها: readOnly (قابل انتخاب و کپی، غیرقابل تغییر)
    ['fTitle', 'fDesc', 'fPhone', 'fAddr', 'fUrl'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if ('readOnly' in el) el.readOnly = ro;
        el.setAttribute('aria-readonly', ro ? 'true' : 'false');
    });
    // انتخاب‌گرها/چک‌باکس: disabled (readOnly ندارند)
    ['fPriority', 'fRecur', 'fRecurN', 'fPin'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = ro;
    });

    // دکمه‌های تغییردهنده — در حالت خواندنی پنهان
    ['addSessionBtn', 'detailPlanStartBtn', 'detailPlanEndBtn',
        'detailLocChange', 'detailLocRemove', 'detailDelete', 'timerToggle'
    ].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.hidden = ro;
    });
    // پاک‌کردن تاریخ‌های برنامه حالت خودش را دارد؛ در خواندنی همیشه پنهان
    const planClear = document.getElementById('detailPlanDatesClear');
    if (planClear) {
        if (ro) planClear.hidden = true;
        else planClear.hidden = !(getDetailTask() && (getDetailTask().startAt || getDetailTask().endAt));
    }
    // نوار «افزودن عکس» (پیش‌نمایش/دانلود عکس‌ها می‌ماند)
    const photoActions = document.querySelector('#detailPage .photo-actions');
    if (photoActions) photoActions.hidden = ro;

    const banner = document.getElementById('detailReadonlyBanner');
    if (banner) banner.hidden = !ro;
    const badge = document.getElementById('detailReadonlyBadge');
    if (badge) badge.hidden = !ro;
    // متن بنر: نام فرستنده اگر معلوم باشد (DM/گروه)
    const bannerText = document.getElementById('detailReadonlyText');
    if (bannerText && ro) {
        let sender = null;
        try {
            const root = getDetailBridgeRoot();
            sender = root && root._shared ? root._shared.senderName : null;
        } catch { /* silent */ }
        bannerText.textContent = sender
            ? i18nT('detail.readOnly.from', { name: sender })
            : i18nT('detail.readOnly.hint');
    }

    // چیپ پیشنهاد تاریخ روی عنوان/توضیح در خواندنی معنا ندارد
    if (ro) hideDetailSmart();

    // برچسب «ویرایش‌پذیر» در بخش اصلی برای آیتم دیگران گمراه‌کننده است.
    // در حالت خواندنی `data-i18n` برداشته می‌شود تا سوییچ زبان متن را برنگرداند.
    const basicStatus = pageEl.querySelector('[data-detail-section="basic"] .detail-section-status');
    if (basicStatus) {
        if (ro) {
            basicStatus.removeAttribute('data-i18n');
            basicStatus.textContent = i18nT('detail.readOnly.badge');
        } else {
            basicStatus.setAttribute('data-i18n', 'detail.sections.basic.status');
            basicStatus.textContent = i18nT('detail.sections.basic.status');
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ فاز ۴D.4b-fix-2: Photo Snackbar
// ═══════════════════════════════════════════════════════════════════════════
//
// snackbar اختصاصی برای پیام‌های مهم عکس (خطاهای پردازش، رد شدن به‌خاطر limit).
//
// ⚠️ چرا snackbar جدید؟
//   - snackbar موجود در ui.js دکمه‌ی «Undo» دارد — برای عکس نامناسب است
//   - پیام‌های عکس نیاز به دکمه‌ی «بستن» و زمان نمایش بیشتر دارند
//   - کاربر باید نام فایل‌های رد‌شده را ببیند

let _photoSnackTimer = null;

/**
 * نمایش یک snackbar برای پیام‌های عکس.
 *
 * ⚠️ این snackbar در پایین صفحه ظاهر می‌شود، مستقل از اسکرول کاربر.
 *
 * @param {string} message — پیام اصلی
 * @param {string[]} [details] — جزئیات (نام فایل‌ها، دلایل)
 * @param {number} [durationMs] — مدت نمایش (پیش‌فرض: ۸ ثانیه)
 */
function showPhotoSnackbar(message, details, durationMs = 8000) {
    const bar = document.getElementById('photoSnackbar');
    if (!bar) return;

    const msgEl = document.getElementById('photoSnackbarMsg');
    const detailsEl = document.getElementById('photoSnackbarDetails');
    const closeBtn = document.getElementById('photoSnackbarClose');

    if (msgEl) msgEl.textContent = message;

    if (detailsEl) {
        if (Array.isArray(details) && details.length > 0) {
            detailsEl.innerHTML = details
                .map(d => `<div class="photo-snackbar-detail">• ${escapeHtml(d)}</div>`)
                .join('');
            detailsEl.hidden = false;
        } else {
            detailsEl.innerHTML = '';
            detailsEl.hidden = true;
        }
    }

    // ─── نمایش ───
    bar.classList.add('show');
    clearTimeout(_photoSnackTimer);
    _photoSnackTimer = setTimeout(() => {
        bar.classList.remove('show');
    }, durationMs);

    // ─── دکمه بستن ───
    if (closeBtn) {
        closeBtn.onclick = () => {
            clearTimeout(_photoSnackTimer);
            bar.classList.remove('show');
        };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Backward-compat: registerDetailCallbacks (پل موقت)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @deprecated از events.on استفاده کنید.
 * @param {Record<string, Function>} cbs
 */
export function registerDetailCallbacks(cbs) {
    if (!cbs || typeof cbs !== 'object') return;
    for (const [name, fn] of Object.entries(cbs)) {
        if (typeof fn !== 'function') continue;
        const eventName = CALLBACK_TO_EVENT[name];
        if (!eventName) continue;
        events.on(eventName, fn);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// call()
// ═══════════════════════════════════════════════════════════════════════════

function call(name, ...args) {
    const eventName = CALLBACK_TO_EVENT[name];
    if (!eventName) {
        // eslint-disable-next-line no-console
        console.warn(`detail.call: unknown callback "${name}"`);
        return;
    }
    events.emit(eventName, ...args);
}

// ═══════════════════════════════════════════════════════════════════════════
// Local state
// ═══════════════════════════════════════════════════════════════════════════

let timerTick = null;
let saveHintTimer = null;
let lightboxTrapCleanup = null;

// smart suggest state (مخصوص صفحه‌ی جزئیات)
let detailSmartTimer = null;
let detailSmartDismissedFor = { fTitle: '', fDesc: '' };
let detailSmartTargetId = null;

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

export function getDetailTask() {
    const found = findTask(state.currentDetailId);
    return found ? found.task : null;
}

function flashSaved(msg) {
    const hint = document.getElementById('saveHint');
    if (!hint) return;
    hint.textContent = msg || i18nT('detail.saveHint');
    hint.classList.add('show');
    clearTimeout(saveHintTimer);
    saveHintTimer = setTimeout(() => hint.classList.remove('show'), 1500);
}

function formatDateShort(iso) {
    if (!iso) return '';
    try {
        const d = new Date(iso);
        if (isNaN(d)) return '';
        return formatDate(d, { day: 'numeric', month: 'long', year: 'numeric' });
    } catch {
        return '';
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Lightbox
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// Lightbox — زوم/پن/دانلود (ایده arasanad: زوم واقعی + پن با اسکرول)
// ═══════════════════════════════════════════════════════════════════════════

const LB_MIN_ZOOM = 1;
const LB_MAX_ZOOM = 3;

let _lbZoom = LB_MIN_ZOOM;
let _lbBase = { w: 0, h: 0 };
let _lbPhotoId = null;
let _lbUiWired = false;
let _lbDrag = null;
let _lbDragMoved = false;
/** تا این زمان (ms)، کلیکِ بستن نادیده گرفته می‌شود — ضد کلیکِ بعد از درگ */
let _lbSuppressCloseUntil = 0;

function lightboxEls() {
    return {
        lb: document.getElementById('lightbox'),
        viewport: document.getElementById('lightboxViewport'),
        img: document.getElementById('lightboxImg'),
    };
}

/**
 * اعمال زوم (عرض/ارتفاع واقعی تا اسکرول درست محاسبه شود — نه transform).
 */
function setLightboxZoom(scale, silent) {
    const { img, viewport } = lightboxEls();
    if (!img || !viewport) return;
    const clamped = clampZoom(scale, LB_MIN_ZOOM, LB_MAX_ZOOM);
    if (clamped > LB_MIN_ZOOM && _lbZoom === LB_MIN_ZOOM) {
        try {
            const r = img.getBoundingClientRect();
            _lbBase = { w: Math.max(1, r.width), h: Math.max(1, r.height) };
        } catch { /* silent */ }
    }
    _lbZoom = clamped;
    if (clamped === LB_MIN_ZOOM) {
        img.style.width = '';
        img.style.height = '';
        img.style.maxWidth = '';
        img.style.maxHeight = '';
        try { viewport.scrollTo(0, 0); } catch { /* silent */ }
    } else {
        img.style.maxWidth = 'none';
        img.style.maxHeight = 'none';
        img.style.width = Math.round(_lbBase.w * clamped) + 'px';
        img.style.height = Math.round(_lbBase.h * clamped) + 'px';
        requestAnimationFrame(() => {
            try {
                viewport.scrollLeft = (viewport.scrollWidth - viewport.clientWidth) / 2;
                viewport.scrollTop = (viewport.scrollHeight - viewport.clientHeight) / 2;
            } catch { /* silent */ }
        });
    }
    viewport.classList.toggle('zoomed', clamped > LB_MIN_ZOOM);
    if (!silent) {
        const resetBtn = document.getElementById('lightboxZoomReset');
        if (resetBtn) {
            resetBtn.textContent = formatNumber(Math.round(clamped * 100)) + (getLang() === 'fa' ? '٪' : '%');
        }
    }
}

function ensureLightboxUI() {
    if (_lbUiWired) return;
    const { lb, viewport, img } = lightboxEls();
    if (!lb || !viewport || !img) return;
    _lbUiWired = true;

    img.addEventListener('click', e => {
        e.stopPropagation();
        if (_lbDragMoved) { _lbDragMoved = false; return; }
        setLightboxZoom(_lbZoom === LB_MIN_ZOOM ? 2 : LB_MIN_ZOOM);
    });
    viewport.addEventListener('click', e => {
        // کلیکِ بعد از درگ (هر هدفی) نباید ببندد
        if (_lbDragMoved) { _lbDragMoved = false; return; }
        if (Date.now() < _lbSuppressCloseUntil) return;
        if (e.target === viewport) closeLightbox();
    });
    lb.addEventListener('click', e => {
        if (Date.now() < _lbSuppressCloseUntil) return;
        if (e.target === lb) closeLightbox();
    });
    viewport.addEventListener('wheel', e => {
        e.preventDefault();
        setLightboxZoom(_lbZoom + (e.deltaY < 0 ? 0.25 : -0.25));
    }, { passive: false });
    viewport.addEventListener('pointerdown', e => {
        if (_lbZoom <= LB_MIN_ZOOM) return;
        e.preventDefault();
        _lbDrag = { x: e.clientX, y: e.clientY, sx: viewport.scrollLeft, sy: viewport.scrollTop, pid: e.pointerId };
        _lbDragMoved = false;
        viewport.classList.add('dragging');
        try { viewport.setPointerCapture(e.pointerId); } catch { /* silent */ }
    });
    viewport.addEventListener('pointermove', e => {
        if (!_lbDrag) return;
        const dx = e.clientX - _lbDrag.x;
        const dy = e.clientY - _lbDrag.y;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
            _lbDragMoved = true;
            _lbSuppressCloseUntil = Date.now() + 350;
        }
        viewport.scrollLeft = _lbDrag.sx - dx;
        viewport.scrollTop = _lbDrag.sy - dy;
    });
    const endDrag = (e) => {
        // رها کردن capture قبل از click تا کلیک به عکس برگردد (نه viewport)
        try {
            const pid = (_lbDrag && _lbDrag.pid !== undefined) ? _lbDrag.pid : (e && e.pointerId);
            if (pid !== undefined && viewport.hasPointerCapture && viewport.hasPointerCapture(pid)) {
                viewport.releasePointerCapture(pid);
            }
        } catch { /* silent */ }
        _lbDrag = null;
        try { viewport.classList.remove('dragging'); } catch { /* silent */ }
    };
    viewport.addEventListener('pointerup', endDrag);
    viewport.addEventListener('pointercancel', endDrag);
    const onBtn = (id, fn) => {
        const b = document.getElementById(id);
        if (b) b.addEventListener('click', e => { e.stopPropagation(); fn(); });
    };
    onBtn('lightboxZoomIn', () => setLightboxZoom(_lbZoom + 0.5));
    onBtn('lightboxZoomOut', () => setLightboxZoom(_lbZoom - 0.5));
    onBtn('lightboxZoomReset', () => setLightboxZoom(LB_MIN_ZOOM));
    onBtn('lightboxDownload', () => { downloadLightboxPhoto().catch(() => {}); });
    onBtn('lightboxClose', () => closeLightbox());
}

/**
 * دانلود عکس باز در لایتباکس (کش → dataUrl تسک → fetch سرور).
 */
async function downloadLightboxPhoto() {
    const photoId = _lbPhotoId;
    let blob = null;
    let contentType = '';
    if (photoId) {
        try {
            const hit = await getCachedPhoto(photoId);
            if (hit && hit.blob) { blob = hit.blob; contentType = hit.contentType || blob.type || ''; }
        } catch { /* silent */ }
    }
    if (!blob) {
        const t = getDetailTask();
        const p = t && Array.isArray(t.photos)
            ? t.photos.find(x => x && String(x.id) === String(photoId))
            : null;
        if (p && typeof p.dataUrl === 'string' && p.dataUrl.startsWith('data:')) {
            try {
                blob = dataUrlToBlob(p.dataUrl);
                contentType = p.contentType || blob.type || '';
            } catch { /* silent */ }
        } else if (p && p.serverMediaId && state.sync.enabled && state.sync.authToken && isOnline()) {
            try {
                const b = await fetchPhotoBlob(state.sync.endpoint, state.sync.authToken, p.serverMediaId);
                blob = b;
                contentType = b.type || p.contentType || '';
                try { await putCachedPhoto(p.id, b, contentType, p.serverMediaId); } catch { /* silent */ }
            } catch { /* silent */ }
        }
    }
    if (!blob) {
        flashSaved(i18nT('detail.photo.downloadFailed'));
        return;
    }
    const ext = extForContentType(contentType || blob.type);
    const url = URL.createObjectURL(blob);
    try {
        const a = document.createElement('a');
        a.href = url;
        a.download = 'rahe-farda-' + String(photoId || 'photo').slice(0, 8) + '.' + ext;
        document.body.appendChild(a);
        a.click();
        a.remove();
    } finally {
        setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* silent */ } }, 5000);
    }
}

function openLightbox(src, opts) {
    const lb = document.getElementById('lightbox');
    const img = document.getElementById('lightboxImg');
    if (!lb || !img) return;

    const previousFocus = document.activeElement;

    _lbPhotoId = (opts && opts.photoId) || null;
    if (opts && opts.alt) {
        try { img.alt = String(opts.alt); } catch { /* silent */ }
    }
    img.src = src;
    lb.hidden = false;
    ensureLightboxUI();
    setLightboxZoom(LB_MIN_ZOOM, true);

    if (lightboxTrapCleanup) {
        try { lightboxTrapCleanup(); } catch { /* silent */ }
        lightboxTrapCleanup = null;
    }

    try {
        lightboxTrapCleanup = trapFocus(lb);
    } catch {
        lightboxTrapCleanup = null;
    }

    const onKey = e => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            closeLightbox();
        }
    };
    document.addEventListener('keydown', onKey, true);

    lb._escHandler = onKey;
    lb._previousFocus = previousFocus;

    setTimeout(() => {
        lb.focus?.({ preventScroll: true });
    }, 30);
}

function closeLightbox() {
    const lb = document.getElementById('lightbox');
    const img = document.getElementById('lightboxImg');
    if (!lb || !img) return;

    if (lightboxTrapCleanup) {
        try { lightboxTrapCleanup(); } catch { /* silent */ }
        lightboxTrapCleanup = null;
    }

    if (lb._escHandler) {
        document.removeEventListener('keydown', lb._escHandler, true);
        lb._escHandler = null;
    }

    lb.hidden = true;
    img.removeAttribute('src');
    setLightboxZoom(LB_MIN_ZOOM, true);
    _lbPhotoId = null;

    const prev = lb._previousFocus;
    lb._previousFocus = null;
    if (prev && document.body.contains(prev) && typeof prev.focus === 'function') {
        setTimeout(() => prev.focus({ preventScroll: true }), 30);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Smart suggest تاریخ
// ═══════════════════════════════════════════════════════════════════════════

function hideDetailSmart() {
    const chip = document.getElementById('detailSmartChip');
    if (chip) chip.hidden = true;
    detailSmartTargetId = null;
}

function resetDetailSmart() {
    detailSmartDismissedFor = { fTitle: '', fDesc: '' };
    hideDetailSmart();
    clearTimeout(detailSmartTimer);
    detailSmartTimer = null;
}

function maybeSuggestDueInDetail(value, targetId) {
    const v = (value || '').trim();
    hideDetailSmart();

    if (!v || v === detailSmartDismissedFor[targetId]) return;

    // ⚠️ فاز ۴E: locale-aware parser (fa → parseFaDateTime، en → parseEnDateTime)
    const iso = parseDateText(v, getNow());
    if (!iso) return;

    const task = getDetailTask();
    if (!task) return;
    if (hasSessionAt(task.sessions, iso)) return;

    detailSmartTargetId = targetId;
    const sourceKey = targetId === 'fDesc'
        ? 'detail.smartSuggest.fromDesc'
        : 'detail.smartSuggest.fromTitle';
    const textEl = document.getElementById('detailSmartChipText');
    if (textEl) textEl.textContent = i18nT(sourceKey, { date: faShort(iso) });
    const chip = document.getElementById('detailSmartChip');
    if (chip) chip.hidden = false;

    const acceptBtn = document.getElementById('detailSmartAccept');
    const dismissBtn = document.getElementById('detailSmartDismiss');

    if (acceptBtn) {
        acceptBtn.onclick = () => {
            const t = getDetailTask();
            if (!t) { hideDetailSmart(); return; }
            if (hasSessionAt(t.sessions, iso)) { hideDetailSmart(); return; }
            t.sessions.push({ id: uid(), at: iso, regAt: new Date().toISOString() });
            saveTasks();
            renderDetailSessions();
            call('render');
            const focusTarget = document.getElementById(detailSmartTargetId || 'fTitle');
            hideDetailSmart();
            if (focusTarget) focusTarget.focus();
            flashSaved(i18nT('detail.smartSuggest.added'));
        };
    }
    if (dismissBtn) {
        dismissBtn.onclick = () => {
            detailSmartDismissedFor[targetId] = v;
            hideDetailSmart();
        };
    }
}

function attachDetailSmartSuggest(el, targetId) {
    if (!el) return;
    el.addEventListener('input', () => {
        clearTimeout(detailSmartTimer);
        detailSmartTimer = setTimeout(() => maybeSuggestDueInDetail(el.value, targetId), 400);
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// Plan dates
// ═══════════════════════════════════════════════════════════════════════════

function renderPlanDates() {
    const task = getDetailTask();
    if (!task) return;
    const section = document.querySelector('.detail-section[data-detail-section="plan-dates"]');
    if (!section) return;

    if (task.kind !== 'plan') {
        section.hidden = true;
        return;
    }
    section.hidden = false;

    const line = document.getElementById('detailPlanDatesLine');
    const startBtn = document.getElementById('detailPlanStartBtn');
    const endBtn = document.getElementById('detailPlanEndBtn');
    const clearBtn = document.getElementById('detailPlanDatesClear');

    if (startBtn) {
        startBtn.textContent = task.startAt
            ? i18nT('detail.planDates.startWithDate', { date: formatDateShort(task.startAt) })
            : i18nT('detail.sections.planDates.startButton');
    }
    if (endBtn) {
        endBtn.textContent = task.endAt
            ? i18nT('detail.planDates.endWithDate', { date: formatDateShort(task.endAt) })
            : i18nT('detail.sections.planDates.endButton');
    }

    if (line) {
        const parts = [];
        const fromLabel = i18nT('detail.sections.planDates.from');
        const toLabel = i18nT('detail.sections.planDates.to');
        if (task.startAt && task.endAt) parts.push(`${fromLabel} ${formatDateShort(task.startAt)} ${toLabel} ${formatDateShort(task.endAt)}`);
        else if (task.startAt) parts.push(`${fromLabel} ${formatDateShort(task.startAt)}`);
        else if (task.endAt) parts.push(`${toLabel} ${formatDateShort(task.endAt)}`);
        line.textContent = parts.length ? parts.join(' ') : '';
        line.hidden = parts.length === 0;
    }

    if (clearBtn) {
        clearBtn.hidden = !(task.startAt || task.endAt);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Open / Close
// ═══════════════════════════════════════════════════════════════════════════

export function openDetail(id) {
    const pageEl = document.getElementById('detailPage');
    if (pageEl) pageEl.classList.toggle('professional-mode', state.prefs.proMode === true);
    const wasAlreadyOpen = pageEl && !pageEl.hidden;
    const prevScroll = wasAlreadyOpen ? pageEl.scrollTop : 0;

    state.currentDetailId = id;
    const task = getDetailTask();
    if (!task) return;

    // ⚠️ 10.25: آیتم دیگران → صفحه باز می‌شود ولی فقط‌خواندنی.
    _readOnly = isDetailBridgeReadOnly();

    resetDetailSmart();

    document.getElementById('detailTitle').textContent = (task.kind === 'plan' ? '📁 ' : '') + task.text;
    document.getElementById('fTitle').value = task.text;
    document.getElementById('fLocField').hidden = false;
    const locAccordion = document.querySelector('.detail-accordion.location');
    if (locAccordion) locAccordion.hidden = false;
    document.getElementById('fDesc').value = task.description || '';
    document.getElementById('fPhone').value = task.phone || '';
    document.getElementById('fAddr').value = task.address || '';
    document.getElementById('fUrl').value = task.url || '';
    document.getElementById('fPriority').value = task.priority || 'medium';
    document.getElementById('fPin').checked = Boolean(task.pinned);
    document.getElementById('fRecur').value = task.recur || 'none';
    document.getElementById('fRecurN').value = task.recurN || (task.recur === 'hourly' ? 8 : 2);
    renderRecurRows();
    renderPlanDates();
    document.getElementById('fPhoneError').textContent = '';
    updateUrlLink();
    updateCallBtn();
    renderDetailSessions();
    call('refreshSavedLocationUI');
    // ⚠️ 10.31: این catch قبلاً فقط warn می‌کرد و شبکه‌ی عکس خالی می‌ماند؛
    // یک ReferenceError واقعی همین‌جا بلعیده شده بود. حالا خطا در کنسول
    // با سطح error می‌رود و جای خالی، پیام قابل‌دیدن می‌گیرد.
    renderDetailPhotos().catch(err => {
        console.error('[detail] renderDetailPhotos failed:', err);
        const grid = document.getElementById('photoGrid');
        if (grid && String(state.currentDetailId) === String(id)) {
            // با DOM API و textContent — طبق گارد امنیتی §۱۰
            grid.textContent = '';
            const note = document.createElement('div');
            note.className = 'session-empty';
            note.textContent = i18nT('detail.photo.renderFailed');
            grid.appendChild(note);
        }
    });
    renderTimer();
    clearInterval(timerTick);
    timerTick = setInterval(() => { if (getDetailTask()) renderTimer(); }, 60000);
    // ⚠️ 10.25: قفل/بازکردن ویرایش باید بعد از پر شدن همه‌ی فیلدها باشد،
    // وگرنه مقداردهی‌ها روی کنترل‌های disabled می‌نشینند (مقدار می‌گیرند، ولی
    // منطق renderPlanDates/renderTimer هم باید اول اجرا شده باشد).
    applyDetailReadOnly(_readOnly);
    pageEl.hidden = false;
    if (window.matchMedia('(max-width: 900px)').matches) {
        document.body.style.overflow = 'hidden';
    }
    if (!wasAlreadyOpen) {
        document.getElementById('detailBack').focus();
    } else {
        pageEl.scrollTop = prevScroll;
        requestAnimationFrame(() => { pageEl.scrollTop = prevScroll; });
    }
    events.emit(EV.DETAIL_OPENED, { id });
}

export function closeDetail() {
    if (typeof debouncedSaveTitle !== 'undefined') debouncedSaveTitle.flush();
    if (typeof debouncedSaveDesc !== 'undefined') debouncedSaveDesc.flush();
    if (typeof debouncedSavePhone !== 'undefined') debouncedSavePhone.flush();
    if (typeof debouncedSaveAddr !== 'undefined') debouncedSaveAddr.flush();
    if (typeof debouncedSaveUrl !== 'undefined') debouncedSaveUrl.flush();

    const closedId = state.currentDetailId;
    state.currentDetailId = null;
    _readOnly = false;
    const pageEl = document.getElementById('detailPage');
    if (pageEl) pageEl.classList.remove('readonly');
    clearInterval(timerTick);
    document.getElementById('detailPage').hidden = true;
    document.body.style.overflow = '';
    call('hideMobilePickBanner');
    call('render');
    events.emit(EV.DETAIL_CLOSED, { id: closedId });
}

function enterLocationPickMode(taskId, mode) {
    ensureMapVisible();
    switchToTab('map');

    if (mode === 'change') {
        state.relocateTaskId = taskId;
        state.relocateSess = null;
        state.pendingReturnDetail = state.currentDetailId;

        if (window.matchMedia('(max-width: 900px)').matches) {
            const pageEl = document.getElementById('detailPage');
            if (pageEl) pageEl.hidden = true;
            document.body.style.overflow = '';
        }

        mapHint(i18nT('map.hint.clickForRelocate'));
        call('showMobilePickBanner', i18nT('location.pickBanner'));
    } else if (mode === 'show') {
        flyToTask(taskId);
    } else if (mode === 'route') {
        call('showRouteTo', taskId);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// URL / Phone
// ═══════════════════════════════════════════════════════════════════════════

function updateUrlLink() {
    const link = document.getElementById('fUrlOpen');
    const copy = document.getElementById('fUrlCopy');
    const task = getDetailTask();
    const safe = task ? sanitizeUrl(task.url || '') : '';
    if (!safe) {
        link.hidden = true;
        link.removeAttribute('href');
        copy.hidden = true;
        return;
    }
    link.href = safe;
    link.hidden = false;
    copy.hidden = false;
}

function updateCallBtn() {
    const btn = document.getElementById('fPhoneCall');
    const task = getDetailTask();
    const raw = task ? (task.phone || '').trim() : '';
    if (!raw) {
        btn.hidden = true;
        btn.removeAttribute('href');
        return;
    }
    btn.href = 'tel:' + raw.replace(/[\s()-]/g, '');
    btn.hidden = false;
}

// ═══════════════════════════════════════════════════════════════════════════
// Sessions
// ═══════════════════════════════════════════════════════════════════════════

export function renderDetailSessions() {
    const task = getDetailTask();
    if (!task) return;
    const list = [...(task.sessions || [])].sort((a, b) => new Date(a.at) - new Date(b.at));
    const countEl = document.getElementById('sessCount');
    if (countEl) countEl.textContent = list.length > 0 ? `(${formatNumber(list.length)})` : '';
    const el = document.getElementById('sessList');
    if (!el) return;
    if (list.length === 0) {
        el.innerHTML = `<div class="session-empty">${i18nT('detail.sessions.empty')}</div>`;
        return;
    }
    const now = getNow().getTime();
    // ⚠️ 10.26: در یک دوره فقط «جلسه‌ی فعال» (نزدیک‌ترین سررسید پیش‌رو) کنترل
    // دارد. ردیف‌های گذشته/مصرف‌شده غیرفعال‌اند: نه انتخاب یادآور، نه 📍، نه ✕.
    // (برای تسک غیرتکراری رفتار قبلی حفظ می‌شود تا حذف تاریخ اشتباه ممکن بماند.)
    const isRecur = !!(task.recur && task.recur !== 'none');
    const activeId = activeSessionId(task);
    // ⚠️ 10.27: سررسید لنگر (شروع دوره) هرگز ✕ نمی‌گیرد — حتی وقتی با حذف
    // سررسیدهای بعدی «فعال» شده باشد. حذفش دوره را بی‌ریشه می‌کند.
    const anchorId = isRecur ? anchorSessionId(task) : null;
    el.innerHTML = list.map((s, i) => {
        const inactive = isSessionInactive(s, now);
        const active = !inactive && (!isRecur || String(s.id) === String(activeId));
        const canEdit = !_readOnly && (!isRecur || active);
        const canDelete = canEdit && String(s.id) !== String(anchorId);
        const sessionLoc = s.location || task.location;
        const weatherLabel = i18nT('taskItem.weather.buttonAria');
        const weatherBtn = active && sessionLoc
            ? `<button type="button" class="weather-icon-btn" data-weather-task="${escapeHtml(String(task.id))}" data-weather-session="${escapeHtml(String(s.id))}" aria-label="${weatherLabel}" title="${weatherLabel}">🌡️</button>`
            : '';
        const pastLabel = s.doneAt
            ? ` ${i18nT('detail.session.done')}`
            : (inactive ? ` ${i18nT('detail.session.past')}` : '');
        const remindAria = i18nT('detail.session.remindAria');
        const locAria = i18nT('detail.session.locationAria');
        const delAria = i18nT('detail.session.removeAria', { n: formatNumber(i + 1) });
        // ⚠️ 10.25: در حالت فقط‌خواندنی، انتخاب یادآور قفل و دکمه‌های
        // مکان/حذف پنهان‌اند (کاربر فقط تاریخ‌ها را می‌بیند).
        const remindSelect = canEdit ? `<select class="sess-remind" data-sess-rem="${escapeHtml(String(s.id))}" aria-label="${remindAria}">
                <option value=""${s.remindMin == null ? ' selected' : ''}>${i18nT('detail.session.remindDefault')}</option>
                <option value="5"${s.remindMin === 5 ? ' selected' : ''}>${i18nT('detail.session.remind5')}</option>
                <option value="15"${s.remindMin === 15 ? ' selected' : ''}>${i18nT('detail.session.remind15')}</option>
                <option value="30"${s.remindMin === 30 ? ' selected' : ''}>${i18nT('detail.session.remind30')}</option>
                <option value="60"${s.remindMin === 60 ? ' selected' : ''}>${i18nT('detail.session.remind60')}</option>
                <option value="180"${s.remindMin === 180 ? ' selected' : ''}>${i18nT('detail.session.remind180')}</option>
                <option value="1440"${s.remindMin === 1440 ? ' selected' : ''}>${i18nT('detail.session.remind1440')}</option>
                <option value="0"${s.remindMin === 0 ? ' selected' : ''}>${i18nT('detail.session.remindOff')}</option>
            </select>` : '';
        const locBtn = canEdit
            ? `<button class="btn-icon btn-detail ${s.location ? 'has-loc' : ''}" data-sess-loc="${escapeHtml(String(s.id))}" aria-label="${locAria}">📍</button>`
            : '';
        const delBtn = canDelete
            ? `<button class="btn-icon btn-delete" data-sess="${escapeHtml(String(s.id))}" aria-label="${delAria}">✕</button>`
            : '';
        const cls = ['session-item'];
        if (inactive) cls.push('inactive');
        if (inactive && new Date(s.at).getTime() < now) cls.push('past');
        if (s.doneAt) cls.push('done');
        if (active) cls.push('active');
        return `<div class="${cls.join(' ')}">
            <span class="session-num">${formatNumber(i + 1)}</span>
            <span class="session-date">📅 ${faShort(s.at)}${pastLabel} ${weatherBtn}</span>
            ${remindSelect}
            ${locBtn}
            ${delBtn}
        </div>`;
    }).join('');
}

// ═══════════════════════════════════════════════════════════════════════════
// Photos
// ═══════════════════════════════════════════════════════════════════════════

/** نگاشت photoId → objectURL (revoke فقط برای عکس‌های حذف‌شده از لیست) */
const _photoObjUrls = new Map();

function prunePhotoObjectUrls(keepIds) {
    for (const [id, u] of _photoObjUrls) {
        if (!keepIds.has(id)) {
            try { URL.revokeObjectURL(u); } catch { /* silent */ }
            _photoObjUrls.delete(id);
        }
    }
}

/**
 * منبع نمایش یک عکس: کش محلی، وگرنه بایت همراه تسک.
 * دانلود lazy جداگانه انجام می‌شود (fetchMissingPhotos).
 */
async function resolvePhotoSrc(p) {
    try {
        const hit = await getCachedPhoto(p.id);
        if (hit && hit.blob) {
            let u = _photoObjUrls.get(String(p.id));
            if (!u) {
                u = URL.createObjectURL(hit.blob);
                _photoObjUrls.set(String(p.id), u);
            }
            return u;
        }
    } catch { /* silent */ }
    if (typeof p.dataUrl === 'string' && p.dataUrl.startsWith('data:image')) return p.dataUrl;
    return null;
}

/**
 * دانلود عکس‌های کش‌نشده (فقط جدیدها) و ذخیره در کش.
 */
async function fetchMissingPhotos(photos) {
    const endpoint = state.sync.endpoint;
    const token = state.sync.authToken;
    if (!endpoint || !token) return;
    const jobs = photos
        .filter(p => p && p.serverMediaId)
        .map(async p => {
            const blob = await fetchPhotoBlob(endpoint, token, p.serverMediaId);
            await putCachedPhoto(p.id, blob, blob.type || p.contentType, p.serverMediaId);
        });
    const results = await Promise.allSettled(jobs);
    if (results.length > 0 && results.every(r => r.status === 'rejected')) {
        throw new Error('all photo fetches failed');
    }
}

/**
 * رندر شبکه‌ی عکس‌های جزئیات.
 *
 * ⚠️ 10.31: export شد تا تست بتواند مسیر واقعی رندر را اجرا کند. قبلاً فقط
 * از داخل `openDetail` صدا زده می‌شد و هیچ تستی آن را اجرا نمی‌کرد؛ به همین
 * دلیل یک ارجاع به شناسه‌ی import‌نشده (`isDeadPhotoRef`) فقط در کنسول
 * کاربر دیده شد و شبکه‌ی عکس‌ها خالی ماند.
 */
export async function renderDetailPhotos() {
    const task = getDetailTask();
    if (!task) return;
    const list = task.photos || [];
    const countEl = document.getElementById('photoCount');

    // ⚠️ فاز ۴D.4b-fix: غیرفعال کردن دکمه‌ها وقتی به سقف رسیده‌ایم
    const isFull = list.length >= MAX_PHOTOS_PER_TASK;
    const photoActions = document.querySelector('.photo-actions');
    if (photoActions) {
        photoActions.classList.toggle('photo-actions--full', isFull);
        const uploadBtns = photoActions.querySelectorAll('.photo-upload-btn');
        uploadBtns.forEach(btn => {
            if (isFull) {
                btn.setAttribute('aria-disabled', 'true');
                btn.classList.add('photo-upload-btn--disabled');
            } else {
                btn.removeAttribute('aria-disabled');
                btn.classList.remove('photo-upload-btn--disabled');
            }
        });
    }

    // ⚠️ فاز ۴D.4b-fix: پیام همیشه‌موجود وقتی به سقف رسیده‌ایم
    const limitHint = document.getElementById('photoLimitHint');
    if (limitHint) {
        if (isFull) {
            limitHint.textContent = i18nT('detail.photo.limitReachedHint', {
                max: formatNumber(MAX_PHOTOS_PER_TASK)
            });
            limitHint.hidden = false;
        } else {
            limitHint.textContent = '';
            limitHint.hidden = true;
        }
    }

    const grid = document.getElementById('photoGrid');
    if (!grid) return;

    if (list.length === 0) {
        // ⚠️ 10.41: شمارنده باید پاک شود. قبلاً این شاخه زودهنگام return می‌کرد
        // و عددِ وظیفه‌ی قبلی («۳ / ۸») روی سرتیتر وظیفه‌ی بی‌عکس می‌ماند.
        if (countEl) countEl.textContent = '';
        grid.innerHTML = `<div class="session-empty">${i18nT('detail.photo.empty')}</div>`;
        return;
    }

    const statuses = await Promise.all(
        list.map(async p => {
            if (!state.sync.enabled) return null;
            try {
                return await getUploadStatus(p.id);
            } catch {
                return null;
            }
        })
    );

    // ─── ترمیم: عکس dataUrlدارِ بدون رکورد آپلود را دوباره enqueue کن ───
    // (بستن جزئیات/کرش قبل از save نباید آپلود را برای همیشه بکشد.)
    healMissingPhotoUploads(task, list, statuses);

    const altText = i18nT('detail.photo.alt');
    const delAria = i18nT('detail.photo.deleteAria');
    const sizeLabelPrefix = i18nT('detail.photo.sizePrefix');

    // ─── resolve منابع نمایش: کش → dataUrl → lazy fetch ───
    const onlineNow = isOnline();
    const authedNow = Boolean(state.sync.enabled && state.sync.authToken);
    const infos = await Promise.all(list.map(async (p, idx) => {
        let src = null;
        try {
            src = await resolvePhotoSrc(p);
        } catch {
            src = (p && typeof p.dataUrl === 'string' && p.dataUrl.startsWith('data:image')) ? p.dataUrl : null;
        }
        const upload = statuses[idx];
        const uploading = !!upload && (upload.status === 'pending' || upload.status === 'uploading');
        return { p, upload, src, dead: !src && isDeadPhotoRef(p, uploading) };
    }));
    // ارجاع مرده (نه بایت، نه ارجاع سروری، نه در حال آپلود) مخفی می‌شود
    const visible = infos.filter(x => !x.dead);

    if (countEl) {
        countEl.textContent = visible.length
            ? `(${formatNumber(visible.length)} / ${formatNumber(MAX_PHOTOS_PER_TASK)})`
            : '';
    }

    prunePhotoObjectUrls(new Set(visible.map(x => String(x.p && x.p.id))));
    grid.innerHTML = visible.map(({ p, upload, src }) => {
        const sizeLabel = p.sizeBytes ? formatBytes(p.sizeBytes) : '';
        const title = sizeLabel ? `${sizeLabelPrefix}: ${sizeLabel}` : '';

        const uploadState = upload ? upload.status : null;
        const uploadBadge = renderUploadBadge(uploadState, p.id);
        // ⚠️ 10.25: در فقط‌خواندنی، دکمه‌ی حذف عکس رندر نمی‌شود (افزودن هم با
        // پنهان‌شدن نوار .photo-actions). پیش‌نمایش/دانلود دست‌نخورده است.
        const delBtn = _readOnly ? '' : `<button data-photo-del="${escapeHtml(String(p.id))}" aria-label="${delAria}">✕</button>`;
        if (!src) {
            return `
        <div class="photo-thumb photo-thumb--loading">
            <span class="photo-loading" aria-label="${altText}">⏳</span>
            ${uploadBadge}
            ${delBtn}
        </div>`;
        }
        return `
        <div class="photo-thumb photo-thumb--${uploadState || 'local'}">
            <img src="${src}" data-photo-view="${escapeHtml(String(p.id))}" alt="${altText}" loading="lazy" title="${escapeHtml(title)}">
            ${uploadBadge}
            ${delBtn}
        </div>`;
    }).join('');

    // ─── lazy: فقط عکس‌های جدید (کش‌نشده) که ارجاع سروری دارند ───
    const taskId = task.id;
    const missing = visible
        .filter(({ p, src }) => !src
            && classifyPhotoForDisplay(p, { cached: false, online: onlineNow, authed: authedNow }) === 'fetch')
        .map(({ p }) => p);
    if (missing.length > 0) {
        fetchMissingPhotos(missing).then(() => {
            if (String(state.currentDetailId) === String(taskId)) renderDetailPhotos().catch(() => {});
        }).catch(() => {});
    }
}

/**
 * ترمیم صف آپلود: عکس dataUrlدارِ بدون رکورد آپلود را enqueue کن.
 * (بستن جزئیات قبل از save نباید آپلود را برای همیشه بکشد.)
 * فقط وقتی رکوردی نیست — failedها با دکمه‌ی تلاش مجدد دستی برمی‌گردند.
 */
function healMissingPhotoUploads(task, list, statuses) {
    try {
        if (!state.sync.enabled || !state.sync.authToken || !isOnline()) return;
        const dest = task._shared && task._shared.dest;
        if (dest && (!task._shared.mine || (dest.type !== 'group' && dest.type !== 'peer'))) return;
        list.forEach((p, idx) => {
            if (!p || statuses[idx]) return;
            if (typeof p.dataUrl !== 'string' || !p.dataUrl.startsWith('data:')) return;
            if (typeof p.contentType !== 'string' || typeof p.sizeBytes !== 'number') return;
            const uploaded = Array.isArray(task.mediaIds) && task.mediaIds.some(id => String(id) === String(p.id));
            if (uploaded || p.serverMediaId) return;
            let blob = null;
            try { blob = dataUrlToBlob(p.dataUrl); } catch { return; }
            enqueueUpload({
                mediaId: p.id,
                taskId: dest ? (dest.type === 'peer' ? task.id : null) : task.id,
                groupId: dest && dest.type === 'group' ? dest.groupId : null,
                contentType: p.contentType,
                sizeBytes: p.sizeBytes,
                blob,
            }).catch(() => {});
        });
    } catch { /* silent */ }
}

/**
 * تلاش مجدد تکی برای یک عکس (دکمه‌ی ❗).
 */
async function retryPhotoUpload(task, photoId) {
    const p = (task.photos || []).find(x => x && String(x.id) === String(photoId));
    if (!p || typeof p.dataUrl !== 'string' || !p.dataUrl.startsWith('data:')) return false;
    let blob = null;
    try { blob = dataUrlToBlob(p.dataUrl); } catch { return false; }
    const dest = task._shared && task._shared.dest;
    try {
        await enqueueUpload({
            mediaId: p.id,
            taskId: dest ? (dest.type === 'peer' ? task.id : null) : task.id,
            groupId: dest && dest.type === 'group' ? dest.groupId : null,
            contentType: p.contentType || blob.type,
            sizeBytes: p.sizeBytes || blob.size,
            blob,
        });
        return true;
    } catch {
        return false;
    }
}

/**
 * رندر badge وضعیت آپلود.
 *
 * @param {string|null} status — 'pending' | 'uploading' | 'uploaded' | 'failed' | null
 * @param {string} [photoId] — برای دکمه‌ی تلاش مجدد در حالت failed
 * @returns {string} HTML
 */
function renderUploadBadge(status, photoId) {
    if (!status) return '';

    switch (status) {
        case 'pending': {
            const label = i18nT('detail.photo.badge.pending');
            return `<span class="photo-upload-badge photo-upload-badge--pending" title="${label}" aria-label="${label}">⏳</span>`;
        }
        case 'uploading': {
            const label = i18nT('detail.photo.badge.uploading');
            return `<span class="photo-upload-badge photo-upload-badge--uploading" title="${label}" aria-label="${label}">⬆</span>`;
        }
        case 'uploaded': {
            const label = i18nT('detail.photo.badge.uploaded');
            return `<span class="photo-upload-badge photo-upload-badge--uploaded" title="${label}" aria-label="${label}">✓</span>`;
        }
        case 'failed': {
            // ⚠️ ❗ قرمز (نه ✕) تا با دکمه‌ی حذف عکس اشتباه نشود — کلیک = تلاش مجدد
            const label = i18nT('detail.photo.badge.failed');
            const retry = photoId ? ` data-photo-retry="${escapeHtml(String(photoId))}"` : '';
            return `<button type="button" class="photo-upload-badge photo-upload-badge--failed" title="${label}" aria-label="${label}"${retry}>❗</button>`;
        }
        default:
            return '';
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Timer
// ═══════════════════════════════════════════════════════════════════════════

function currentSpent(task) {
    let s = Number(task.timeSpent) || 0;
    if (task.timerStartedAt) {
        s += (Date.now() - new Date(task.timerStartedAt).getTime()) / 1000;
    }
    return Math.max(0, Math.floor(s));
}

function faDuration(sec) {
    sec = Math.floor(sec);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return i18nT('detail.timer.duration.hoursMinutes', { h: formatNumber(h), m: formatNumber(m) });
    if (m > 0) return i18nT('detail.timer.duration.minutes', { m: formatNumber(m) });
    return i18nT('detail.timer.duration.seconds', { s: formatNumber(s) });
}

function renderTimer() {
    const task = getDetailTask();
    if (!task) return;
    const labelEl = document.getElementById('timerLabel');
    if (labelEl) labelEl.textContent = faDuration(currentSpent(task));
    const toggleEl = document.getElementById('timerToggle');
    if (toggleEl) toggleEl.textContent = task.timerStartedAt
        ? i18nT('detail.timer.paused')
        : i18nT('detail.timer.started');
}

function toggleTimer() {
    if (_readOnly) return;
    const task = getDetailTask();
    if (!task) return;
    if (task.timerStartedAt) {
        task.timeSpent = currentSpent(task);
        task.timerStartedAt = null;
    } else {
        task.timerStartedAt = new Date().toISOString();
    }
    saveTasks();
    renderTimer();
    flashSaved();
}

// ═══════════════════════════════════════════════════════════════════════════
// Recur
// ═══════════════════════════════════════════════════════════════════════════

// ⚠️ فاز ۴D.5: ترتیب روزهای هفته locale-aware
//   - در fa: شنبه اول (کد: 6)
//   - در en: یکشنبه اول (کد: 0)
//
// ⚠️ کد روز (0-6) در JS: 0=یکشنبه، 1=دوشنبه، ...، 6=شنبه
//    در getDay() مرورگر: همیشه 0=Sunday است، مستقل از locale.
const WEEK_ORDER_JALALI = [
    ['recur.dayOfWeek.sat', 6],
    ['recur.dayOfWeek.sun', 0],
    ['recur.dayOfWeek.mon', 1],
    ['recur.dayOfWeek.tue', 2],
    ['recur.dayOfWeek.wed', 3],
    ['recur.dayOfWeek.thu', 4],
    ['recur.dayOfWeek.fri', 5],
];

const WEEK_ORDER_GREGORIAN = [
    ['recur.dayOfWeek.sun', 0],
    ['recur.dayOfWeek.mon', 1],
    ['recur.dayOfWeek.tue', 2],
    ['recur.dayOfWeek.wed', 3],
    ['recur.dayOfWeek.thu', 4],
    ['recur.dayOfWeek.fri', 5],
    ['recur.dayOfWeek.sat', 6],
];

/**
 * گرفتن ترتیب روزهای هفته بر اساس زبان.
 * @returns {Array<[string, number]>}
 */
function getWeekOrder() {
    return getLang() === 'en' ? WEEK_ORDER_GREGORIAN : WEEK_ORDER_JALALI;
}

function renderRecurRows() {
    const task = getDetailTask();
    if (!task) return;
    const r = task.recur;
    const nRow = document.getElementById('fRecurNRow');
    if (nRow) nRow.hidden = !(r === 'custom' || r === 'hourly');
    const weekRow = document.getElementById('fRecurWeekRow');
    if (weekRow) weekRow.hidden = r !== 'weeklyDays';
    const monthRow = document.getElementById('fRecurMonthRow');
    if (monthRow) monthRow.hidden = r !== 'monthlyDays';

    const nLabel = document.querySelector('#fRecurNRow .field-label');
    if (nLabel) {
        nLabel.textContent = r === 'hourly'
            ? i18nT('tasks.series.everyNHours')
            : i18nT('detail.sections.recurrence.everyNDays');
    }

    const nInp = document.getElementById('fRecurN');
    if (nInp) nInp.max = r === 'hourly' ? 168 : 365;

    const wc = document.getElementById('fRecurWeekChips');
    if (wc) {
        // ⚠️ فاز ۴D.5: ترتیب روزها بر اساس زبان
        const weekOrder = getWeekOrder();
        wc.innerHTML = weekOrder.map(([key, v]) =>
            `<button type="button" class="day-chip${(task.recurDays || []).includes(v) ? ' on' : ''}" data-wday="${v}">${i18nT(key)}</button>`
        ).join('');
    }

    const mc = document.getElementById('fRecurMonthChips');
    if (mc) {
        let mhtml = '';
        for (let d = 1; d <= 31; d++) mhtml += `<button type="button" class="day-chip${(task.recurDays || []).includes(d) ? ' on' : ''}" data-mday="${d}">${formatNumber(d)}</button>`;
        mc.innerHTML = mhtml;
    }
}

function toggleRecurDay(v) {
    const task = getDetailTask();
    if (!task) return;
    task.recurDays = task.recurDays || [];
    const i = task.recurDays.indexOf(v);
    if (i >= 0) task.recurDays.splice(i, 1);
    else task.recurDays.push(v);
    saveTasks();
    call('render');
    renderRecurRows();
    flashSaved();
}

// ═══════════════════════════════════════════════════════════════════════════
// Debounced saves
// ═══════════════════════════════════════════════════════════════════════════

const debouncedSaveTitle = debounce(() => {
    if (_readOnly) return;
    const task = getDetailTask();
    if (!task) return;
    task.text = document.getElementById('fTitle').value.trim().replace(/\s+/g, ' ').slice(0, MAX_LENGTH);
    document.getElementById('detailTitle').textContent = task.text || i18nT('tasks.new');
    saveTasks();
    call('render');
    flashSaved();
}, 300);

const debouncedSaveDesc = debounce(() => {
    if (_readOnly) return;
    const task = getDetailTask();
    if (!task) return;
    task.description = document.getElementById('fDesc').value.slice(0, 1000);
    saveTasks();
    flashSaved();
}, 500);

const debouncedSavePhone = debounce(() => {
    if (_readOnly) return;
    const task = getDetailTask();
    if (!task) return;
    task.phone = document.getElementById('fPhone').value.trim().slice(0, 20);
    saveTasks();
    flashSaved();
}, 300);

const debouncedSaveAddr = debounce(() => {
    if (_readOnly) return;
    const task = getDetailTask();
    if (!task) return;
    task.address = document.getElementById('fAddr').value.slice(0, 500);
    saveTasks();
    flashSaved();
}, 500);

const debouncedSaveUrl = debounce(() => {
    if (_readOnly) return;
    const task = getDetailTask();
    if (!task) return;
    task.url = sanitizeUrl(document.getElementById('fUrl').value);
    updateUrlLink();
    saveTasks();
    flashSaved();
}, 300);

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === 'string') {
                resolve(reader.result);
            } else {
                reject(new Error(i18nT('detail.photo.blobError')));
            }
        };
        reader.onerror = () => reject(new Error(i18nT('detail.photo.blobReadError')));
        reader.readAsDataURL(blob);
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// Bind inputs
// ═══════════════════════════════════════════════════════════════════════════

export function bindDetailInputs() {
    document.getElementById('fTitle').addEventListener('input', e => {
        const v = e.target.value.trim().replace(/\s+/g, ' ');
        if (!v) {
            flashSaved(i18nT('detail.saveError'));
            return;
        }
        debouncedSaveTitle();
    });
    document.getElementById('fDesc').addEventListener('input', () => {
        debouncedSaveDesc();
    });
    document.getElementById('fPhone').addEventListener('input', e => {
        const v = e.target.value.trim();
        const err = document.getElementById('fPhoneError');
        if (v && !/^[0-9+\-\s()]{5,20}$/.test(v)) {
            err.textContent = i18nT('detail.phone.invalid');
            return;
        }
        err.textContent = '';
        updateCallBtn();
        debouncedSavePhone();
    });
    document.getElementById('fAddr').addEventListener('input', () => {
        debouncedSaveAddr();
    });
    document.getElementById('fUrl').addEventListener('input', () => {
        debouncedSaveUrl();
    });

    attachDetailSmartSuggest(document.getElementById('fTitle'), 'fTitle');
    attachDetailSmartSuggest(document.getElementById('fDesc'), 'fDesc');

    document.getElementById('addSessionBtn').addEventListener('click', () => {
        if (_readOnly) return;
        openPicker('session', iso => {
            const task = getDetailTask();
            if (!task) return;
            if (hasSessionAt(task.sessions, iso)) {
                flashSaved(i18nT('picker.errorDuplicate'));
                return;
            }
            task.sessions.push({ id: uid(), at: iso, regAt: new Date().toISOString() });
            saveTasks();
            renderDetailSessions();
            call('render');
            flashSaved();
        });
    });
    document.getElementById('sessList').addEventListener('click', e => {
        if (_readOnly) return;
        const locBtn = e.target.closest('[data-sess-loc]');
        if (locBtn) {
            state.relocateSess = { taskId: state.currentDetailId, sessId: locBtn.dataset.sessLoc };
            state.relocateTaskId = null;
            state.pendingReturnDetail = state.currentDetailId;
            ensureMapVisible();
            switchToTab('map');
            if (window.matchMedia('(max-width: 900px)').matches) {
                const pageEl = document.getElementById('detailPage');
                if (pageEl) pageEl.hidden = true;
                document.body.style.overflow = '';
            }
            mapHint(i18nT('map.hint.clickForSession'));
            call('showMobilePickBanner', i18nT('location.pickBannerSession'));
            return;
        }
        const btn = e.target.closest('[data-sess]');
        if (!btn) return;
        const task = getDetailTask();
        if (!task) return;
        // ⚠️ 10.27: نگهبان دوم — سررسید لنگر دوره حتی با DOM کهنه/کیبورد حذف نمی‌شود.
        const target = (task.sessions || []).find(s => String(s.id) === btn.dataset.sess);
        if (target && isAnchorSession(task, target)) return;
        task.sessions = task.sessions.filter(s => String(s.id) !== btn.dataset.sess);
        // ⚠️ 10.26: اگر جلسه‌ی فعال حذف شد و جلسه‌ی قبلی‌اش هنوز تاریخش بعد از
        // «حالا» است، همان فعال می‌شود (مهر doneAt برداشته می‌شود) تا due-line
        // لیست هم به همان تاریخ برگردد.
        promoteFutureSession(task);
        saveTasks();
        renderDetailSessions();
        call('render');
        flashSaved(i18nT('detail.session.removed'));
    });
    document.getElementById('sessList').addEventListener('change', e => {
        if (_readOnly) return;
        const sel = e.target.closest('[data-sess-rem]');
        if (!sel) return;
        const task = getDetailTask();
        if (!task) return;
        const s = (task.sessions || []).find(x => String(x.id) === String(sel.dataset.sessRem));
        if (!s) return;
        s.reminded = false;
        s.remindedDue = false;
        if (sel.value === '') s.remindMin = null;
        else s.remindMin = Math.max(0, parseInt(sel.value, 10) || 0);
        saveTasks();
        flashSaved();
    });
    document.getElementById('detailLocShow').addEventListener('click', () => {
        const t = getDetailTask();
        if (!t || !t.location) return;
        enterLocationPickMode(t.id, 'show');
    });
    document.getElementById('detailLocChange').addEventListener('click', () => {
        if (_readOnly) return;
        const t = getDetailTask();
        if (!t) return;
        enterLocationPickMode(t.id, 'change');
    });
    document.getElementById('detailLocRemove').addEventListener('click', () => {
        if (_readOnly) return;
        const t = getDetailTask();
        if (!t) return;
        t.location = null;
        saveTasks();
        call('refreshSavedLocationUI');
        call('render');
        refreshMarkers();
        flashSaved(i18nT('detail.location.removed'));
    });
    document.getElementById('fPriority').addEventListener('change', e => {
        if (_readOnly) return;
        const task = getDetailTask();
        if (!task) return;
        task.priority = ['high', 'medium', 'low'].includes(e.target.value) ? e.target.value : 'medium';
        saveTasks();
        call('render');
        refreshMarkers();
        flashSaved();
    });
    document.getElementById('fUrlCopy').addEventListener('click', async () => {
        const task = getDetailTask();
        if (!task) return;
        const full = sanitizeUrl(task.url || '');
        if (!full) return;
        let ok = false;
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(full);
                ok = true;
            }
        } catch { /* fallback */ }
        if (!ok) {
            try {
                const ta = document.createElement('textarea');
                ta.value = full;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                ok = document.execCommand('copy');
                ta.remove();
            } catch { /* نادیده */ }
        }
        flashSaved(ok ? i18nT('detail.url.copied') : i18nT('detail.url.copyFailed'));
    });
    document.getElementById('fPin').addEventListener('change', e => {
        if (_readOnly) return;
        const task = getDetailTask();
        if (!task) return;
        task.pinned = e.target.checked;
        saveTasks();
        call('render');
        flashSaved();
    });
    document.getElementById('fRecurWeekChips').addEventListener('click', e => {
        if (_readOnly) return;
        const b = e.target.closest('[data-wday]');
        if (b) toggleRecurDay(parseInt(b.dataset.wday, 10));
    });
    document.getElementById('fRecurMonthChips').addEventListener('click', e => {
        if (_readOnly) return;
        const b = e.target.closest('[data-mday]');
        if (b) toggleRecurDay(parseInt(b.dataset.mday, 10));
    });
    document.getElementById('fRecur').addEventListener('change', e => {
        if (_readOnly) return;
        const task = getDetailTask();
        if (!task) return;
        const v = e.target.value;
        task.recur = ['daily', 'weekly', 'monthly', 'custom', 'hourly', 'weeklyDays', 'monthlyDays'].includes(v) ? v : 'none';
        let warn = '';
        if (task.recur !== 'none' && (task.sessions || []).length > 1) {
            task.sessions.sort((a, b) => new Date(a.at) - new Date(b.at));
            task.sessions = [task.sessions[0]];
            renderDetailSessions();
            warn = i18nT('detail.warn.sessionsCollapsed');
        }
        if (task.recur === 'hourly' && !((task.recurN >= 1 && task.recurN <= 168) || (task.recurMin >= 1 && task.recurMin <= 59))) task.recurN = 8;
        if (task.recur === 'custom') {
            const n = parseInt(document.getElementById('fRecurN').value, 10);
            if (n >= 1 && n <= 365) task.recurN = n;
            else {
                task.recur = 'none';
                e.target.value = 'none';
                warn = i18nT('detail.warn.invalidRecurN');
            }
        }
        if ((task.recur === 'weeklyDays' || task.recur === 'monthlyDays') && !(task.recurDays || []).length) {
            warn += (warn ? ' — ' : '') + i18nT('detail.warn.noRecurDay');
        }
        saveTasks();
        call('render');
        renderRecurRows();
        flashSaved(warn || undefined);
    });
    document.getElementById('fRecurN').addEventListener('change', e => {
        if (_readOnly) return;
        const task = getDetailTask();
        if (!task) return;
        const maxN = task.recur === 'hourly' ? 168 : 365;
        const n = parseInt(e.target.value, 10);
        if ((task.recur === 'custom' || task.recur === 'hourly') && n >= 1 && n <= maxN) {
            task.recurN = n;
            saveTasks();
            call('render');
            flashSaved();
        } else {
            flashSaved(i18nT('detail.warn.rangeError', { max: formatNumber(maxN) }));
        }
    });
    document.getElementById('detailLocRoute').addEventListener('click', () => {
        const t = getDetailTask();
        if (!t || !t.location) return;
        enterLocationPickMode(t.id, 'route');
    });

    // ─── Plan dates handlers ───
    const planStartBtn = document.getElementById('detailPlanStartBtn');
    if (planStartBtn) {
        planStartBtn.addEventListener('click', () => {
            const t = getDetailTask();
            if (!t || t.kind !== 'plan') return;
            openPicker('tpldate', iso => {
                // ⚠️ فاز ۱۱ آیتم ۷: رد با پیام (به‌جای پاک‌سازی خاموش پایان)
                if (!validatePlanRange(iso, t.endAt).ok) {
                    flashSaved(i18nT('detail.planDates.rangeInvalid'));
                    return;
                }
                t.startAt = iso;
                saveTasks();
                renderPlanDates();
                call('render');
                flashSaved(i18nT('detail.planDates.startSet'));
            });
        });
    }
    const planEndBtn = document.getElementById('detailPlanEndBtn');
    if (planEndBtn) {
        planEndBtn.addEventListener('click', () => {
            const t = getDetailTask();
            if (!t || t.kind !== 'plan') return;
            openPicker('tpldate', iso => {
                // ⚠️ فاز ۱۱ آیتم ۷: جهت دوم — پایانِ کمتر از شروع رد می‌شود
                if (!validatePlanRange(t.startAt, iso).ok) {
                    flashSaved(i18nT('detail.planDates.rangeInvalid'));
                    return;
                }
                t.endAt = iso;
                saveTasks();
                renderPlanDates();
                call('render');
                flashSaved(i18nT('detail.planDates.endSet'));
            });
        });
    }
    const planDatesClear = document.getElementById('detailPlanDatesClear');
    if (planDatesClear) {
        planDatesClear.addEventListener('click', () => {
            const t = getDetailTask();
            if (!t || t.kind !== 'plan') return;
            t.startAt = null;
            t.endAt = null;
            saveTasks();
            renderPlanDates();
            call('render');
            flashSaved(i18nT('detail.planDates.cleared'));
        });
    }

    const photoInput = document.getElementById('photoInput');
    photoInput.addEventListener('change', async () => {
        if (_readOnly) { photoInput.value = ''; return; }
        const task = getDetailTask();
        if (!task) { photoInput.value = ''; return; }

        task.photos = task.photos || [];

        const originalCount = photoInput.files ? photoInput.files.length : 0;

        const remaining = MAX_PHOTOS_PER_TASK - task.photos.length;
        if (remaining <= 0) {
            photoInput.value = '';
            flashSaved(i18nT('detail.photo.limitReached', { n: formatNumber(MAX_PHOTOS_PER_TASK) }));
            return;
        }

        const files = [...photoInput.files].slice(0, remaining);
        const ignoredByLimit = originalCount - files.length;
        photoInput.value = '';

        if (!files.length) {
            flashSaved(i18nT('detail.photo.noFile'));
            return;
        }

        let successCount = 0;
        let failureCount = 0;
        /** @type {Array<{ name: string, reason: string }>} */
        const errors = [];

        flashSaved(i18nT('detail.photo.processing'));

        for (const file of files) {
            const validation = validateImageFile(file);
            if (!validation.ok) {
                failureCount++;
                // ⚠️ فاز ۴D.4b-fix-2: ذخیره‌ی نام فایل + دلیل
                errors.push({ name: file.name || '—', reason: validation.reason });
                continue;
            }

            try {
                const result = await processImageFile(file);
                const dataUrl = await blobToDataUrl(result.blob);

                const photoId = uid();
                task.photos.push({
                    id: photoId,
                    dataUrl,
                    addedAt: new Date().toISOString(),
                    contentType: result.contentType,
                    sizeBytes: result.sizeBytes,
                    width: result.width,
                    height: result.height,
                });
                // ⚠️ بایت هم در کش محلی می‌ماند تا بعد از آپلود (حذف dataUrl از تسک) نمایش بماند
                putCachedPhoto(photoId, result.blob, result.contentType).catch(() => {});

                successCount++;
            } catch (err) {
                failureCount++;
                errors.push({
                    name: file.name || '—',
                    reason: err instanceof Error ? err.message : i18nT('detail.photo.processingError'),
                });
            }
        }

        if (successCount > 0) {
            // ⚠️ 10.11/BUG-01: await تا commit واقعی IDB + ساخت op سینک انجام شود؛
            // وگرنه رفرش سریع بعد از پیش‌نمایش = از دست رفتن عکس (موفقیت فقط بعد از durability).
            await saveTasks();
            await enqueueDirtyTasks().catch(() => {});
            await renderDetailPhotos();
            call('render');
        }

        // ⚠️ فاز ۴D.4b-fix-2: پیام از طریق snackbar نمایش داده می‌شود
        //    (نه flashSaved که به پایین صفحه می‌رود و کاربر نمی‌بیند)

        const hasProblem = failureCount > 0 || ignoredByLimit > 0;

        if (hasProblem) {
            // ─── ساخت پیام اصلی ───
            const parts = [];
            if (successCount > 0) {
                parts.push(i18nT('detail.photo.addedShort', { n: formatNumber(successCount) }));
            }
            if (ignoredByLimit > 0) {
                parts.push(i18nT('detail.photo.ignoredByLimit', {
                    n: formatNumber(ignoredByLimit),
                    max: formatNumber(MAX_PHOTOS_PER_TASK)
                }));
            }
            if (failureCount > 0) {
                parts.push(i18nT('detail.photo.failedProcess', { n: formatNumber(failureCount) }));
            }

            const mainMessage = parts.join(' — ');

            // ─── ساخت جزئیات (نام فایل‌ها + دلیل) ───
            // ⚠️ حداکثر ۵ مورد نمایش می‌دهیم تا snackbar خیلی بزرگ نشود
            const detailLines = [];
            const MAX_DETAILS = 5;
            for (let i = 0; i < Math.min(errors.length, MAX_DETAILS); i++) {
                const e = errors[i];
                detailLines.push(`${e.name}: ${e.reason}`);
            }
            if (errors.length > MAX_DETAILS) {
                detailLines.push(
                    i18nT('detail.photo.moreErrors', { n: formatNumber(errors.length - MAX_DETAILS) })
                );
            }

            showPhotoSnackbar(mainMessage, detailLines, 10000);
        } else if (successCount > 0) {
            // ─── فقط موفقیت ───
            showPhotoSnackbar(
                i18nT('detail.photo.addedShort', { n: formatNumber(successCount) }),
                [],
                3000
            );
        } else if (files.length === 0) {
            // ─── هیچ فایلی برای پردازش نبود ───
            flashSaved(i18nT('detail.photo.noFile'));
        }
    });
    
    document.getElementById('photoGrid').addEventListener('click', async e => {
        if (_readOnly) {
            // ⚠️ 10.25: فقط پیش‌نمایش؛ حذف/تلاش مجدد آپلود در خواندنی معنا ندارد.
            const img = e.target.closest('[data-photo-view]');
            if (img) openLightbox(img.src, { photoId: img.getAttribute('data-photo-view'), alt: img.alt });
            return;
        }
        const retry = e.target.closest('[data-photo-retry]');
        if (retry) {
            const task = getDetailTask();
            if (task) {
                await retryPhotoUpload(task, retry.dataset.photoRetry);
                await renderDetailPhotos().catch(err => console.warn('[detail] renderDetailPhotos failed:', err));
            }
            return;
        }
        const del = e.target.closest('[data-photo-del]');
        if (del) {
            const task = getDetailTask();
            if (!task) return;
            const photoId = del.dataset.photoDel;

            try {
                await cancelUpload(photoId);
            } catch {
                // silent
            }

            task.photos = (task.photos || []).filter(p => String(p.id) !== String(photoId));
            task.mediaIds = (task.mediaIds || []).filter(id => String(id) !== String(photoId));
            deleteCachedPhoto(photoId);

            // ⚠️ 10.11/BUG-01: همان race حذف — await تا حذف durable شود.
            await saveTasks();
            await enqueueDirtyTasks().catch(() => {});
            await renderDetailPhotos().catch(err => console.warn('[detail] renderDetailPhotos failed:', err));
            call('render');
            flashSaved(i18nT('detail.photo.deleted'));
            return;
        }
        const img = e.target.closest('[data-photo-view]');
        if (img) {
            openLightbox(img.src, { photoId: img.getAttribute('data-photo-view'), alt: img.alt });
        }
    });
    document.getElementById('lightbox').addEventListener('click', () => {
        if (Date.now() < _lbSuppressCloseUntil) return;
        closeLightbox();
    });
    document.getElementById('timerToggle').addEventListener('click', toggleTimer);
    document.getElementById('detailBack').addEventListener('click', closeDetail);
    document.getElementById('detailDelete').addEventListener('click', async () => {
        if (_readOnly) return;
        const task = getDetailTask();
        if (!task) return;
        const ok = await showConfirmModal({
            title: i18nT('detail.deleteConfirmTitle'),
            message: i18nT('detail.deleteConfirmMessage', { text: task.text }),
            confirmText: i18nT('detail.deleteConfirmOk'),
            cancelText: i18nT('detail.deleteConfirmCancel'),
            danger: true
        });
        if (!ok) return;
        // تسک خودیِ مشترک: حذف از API مقصد (بدون سطل/undo محلی)
        if (task._shared && task._shared.mine) {
            const { deleteSharedTask } = await import('./tasks/source.js');
            closeDetail();
            await deleteSharedTask(task.id);
            const { refreshSharedList } = await import('./tasks/source.js');
            await refreshSharedList();
            call('render');
            return;
        }
        const id = task.id;
        closeDetail();
        moveToTrashById(id);
        call('render');
        call('showUndoFor', [id]);
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// Stage E: event listeners برای وضعیت آپلود Media
// ═══════════════════════════════════════════════════════════════════════════

events.on('media:upload-complete', ({ mediaId, taskId }) => {
    if (String(state.currentDetailId) === String(taskId)) {
        renderDetailPhotos().catch(() => {});
        return;
    }
    // آپلود گروهی (taskId تهی): اگر عکس متعلق به جزئیات باز است، رندر
    try {
        const t = getDetailTask();
        if (t && Array.isArray(t.photos) && t.photos.some(p => p && String(p.id) === String(mediaId))) {
            renderDetailPhotos().catch(() => {});
        }
    } catch { /* silent */ }
});

events.on('media:upload-failed', ({ taskId }) => {
    if (String(state.currentDetailId) === String(taskId)) {
        renderDetailPhotos().catch(() => {});
    }
});

events.on('media:upload-enqueued', ({ taskId }) => {
    if (String(state.currentDetailId) === String(taskId)) {
        renderDetailPhotos().catch(() => {});
    }
});