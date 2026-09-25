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
import { findTask, saveTasks, moveToTrashById, sanitizeUrl } from './store.js';
import { faShort, hasSessionAt, parseFaDateTime } from './sessions.js';
import {
    processImageFile,
    validateImageFile,
    formatBytes,
    MAX_PHOTOS_PER_TASK,
} from './media.js';
import {
    getUploadStatus,
    cancelUpload,
    retryFailedUploads,
} from './media-upload.js';
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
import { formatDate, formatNumber, getLang, t as i18nT } from './i18n.js';

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
            detailsEl.style.display = '';
        } else {
            detailsEl.innerHTML = '';
            detailsEl.style.display = 'none';
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

function openLightbox(src) {
    const lb = document.getElementById('lightbox');
    const img = document.getElementById('lightboxImg');
    if (!lb || !img) return;

    const previousFocus = document.activeElement;

    img.src = src;
    lb.style.display = 'flex';

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

    lb.style.display = 'none';
    img.removeAttribute('src');

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
    if (chip) chip.style.display = 'none';
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

    const iso = parseFaDateTime(v, getNow());
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
    if (chip) chip.style.display = 'flex';

    const acceptBtn = document.getElementById('detailSmartAccept');
    const dismissBtn = document.getElementById('detailSmartDismiss');

    if (acceptBtn) {
        acceptBtn.onclick = () => {
            const t = getDetailTask();
            if (!t) { hideDetailSmart(); return; }
            if (hasSessionAt(t.sessions, iso)) { hideDetailSmart(); return; }
            t.sessions.push({ id: uid(), at: iso });
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
        section.style.display = 'none';
        return;
    }
    section.style.display = '';

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
        line.style.display = parts.length ? '' : 'none';
    }

    if (clearBtn) {
        clearBtn.style.display = (task.startAt || task.endAt) ? '' : 'none';
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Open / Close
// ═══════════════════════════════════════════════════════════════════════════

export function openDetail(id) {
    const pageEl = document.getElementById('detailPage');
    if (pageEl) pageEl.classList.toggle('professional-mode', state.prefs.proMode === true);
    const wasAlreadyOpen = pageEl && pageEl.style.display === 'block';
    const prevScroll = wasAlreadyOpen ? pageEl.scrollTop : 0;

    state.currentDetailId = id;
    const task = getDetailTask();
    if (!task) return;

    resetDetailSmart();

    document.getElementById('detailTitle').textContent = (task.kind === 'plan' ? '📁 ' : '') + task.text;
    document.getElementById('fTitle').value = task.text;
    document.getElementById('fLocField').style.display = '';
    const locAccordion = document.querySelector('.detail-accordion.location');
    if (locAccordion) locAccordion.style.display = '';
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
        renderDetailPhotos().catch(err => console.warn('[detail] renderDetailPhotos failed:', err));
    renderTimer();
    clearInterval(timerTick);
    timerTick = setInterval(() => { if (getDetailTask()) renderTimer(); }, 60000);
    pageEl.style.display = 'block';
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
    clearInterval(timerTick);
    document.getElementById('detailPage').style.display = 'none';
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
            if (pageEl) pageEl.style.display = 'none';
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
        link.style.display = 'none';
        link.removeAttribute('href');
        copy.style.display = 'none';
        return;
    }
    link.href = safe;
    link.style.display = '';
    copy.style.display = '';
}

function updateCallBtn() {
    const btn = document.getElementById('fPhoneCall');
    const task = getDetailTask();
    const raw = task ? (task.phone || '').trim() : '';
    if (!raw) {
        btn.style.display = 'none';
        btn.removeAttribute('href');
        return;
    }
    btn.href = 'tel:' + raw.replace(/[\s()-]/g, '');
    btn.style.display = '';
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
    el.innerHTML = list.map((s, i) => {
        const past = new Date(s.at).getTime() < now;
        const sessionLoc = s.location || task.location;
        const weatherLabel = i18nT('taskItem.weather.buttonAria');
        const weatherBtn = !past && sessionLoc
            ? `<button type="button" class="weather-icon-btn" data-weather-task="${escapeHtml(String(task.id))}" data-weather-session="${escapeHtml(String(s.id))}" aria-label="${weatherLabel}" title="${weatherLabel}">🌡️</button>`
            : '';
        const pastLabel = past ? ` ${i18nT('detail.session.past')}` : '';
        const remindAria = i18nT('detail.session.remindAria');
        const locAria = i18nT('detail.session.locationAria');
        const delAria = i18nT('detail.session.removeAria', { n: formatNumber(i + 1) });
        return `<div class="session-item ${past ? 'past' : ''}">
            <span class="session-num">${formatNumber(i + 1)}</span>
            <span class="session-date">📅 ${faShort(s.at)}${pastLabel} ${weatherBtn}</span>
            <select class="sess-remind" data-sess-rem="${escapeHtml(String(s.id))}" aria-label="${remindAria}">
                <option value=""${s.remindMin == null ? ' selected' : ''}>${i18nT('detail.session.remindDefault')}</option>
                <option value="5"${s.remindMin === 5 ? ' selected' : ''}>${i18nT('detail.session.remind5')}</option>
                <option value="15"${s.remindMin === 15 ? ' selected' : ''}>${i18nT('detail.session.remind15')}</option>
                <option value="30"${s.remindMin === 30 ? ' selected' : ''}>${i18nT('detail.session.remind30')}</option>
                <option value="60"${s.remindMin === 60 ? ' selected' : ''}>${i18nT('detail.session.remind60')}</option>
                <option value="180"${s.remindMin === 180 ? ' selected' : ''}>${i18nT('detail.session.remind180')}</option>
                <option value="1440"${s.remindMin === 1440 ? ' selected' : ''}>${i18nT('detail.session.remind1440')}</option>
                <option value="0"${s.remindMin === 0 ? ' selected' : ''}>${i18nT('detail.session.remindOff')}</option>
            </select>
            <button class="btn-icon btn-detail ${s.location ? 'has-loc' : ''}" data-sess-loc="${escapeHtml(String(s.id))}" aria-label="${locAria}">📍</button>
            <button class="btn-icon btn-delete" data-sess="${escapeHtml(String(s.id))}" aria-label="${delAria}">✕</button>
        </div>`;
    }).join('');
}

// ═══════════════════════════════════════════════════════════════════════════
// Photos
// ═══════════════════════════════════════════════════════════════════════════

async function renderDetailPhotos() {
    const task = getDetailTask();
    if (!task) return;
    const list = task.photos || [];
    const countEl = document.getElementById('photoCount');
    if (countEl) {
        countEl.textContent = list.length
            ? `(${formatNumber(list.length)} / ${formatNumber(MAX_PHOTOS_PER_TASK)})`
            : '';
    }

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
            limitHint.style.display = '';
        } else {
            limitHint.textContent = '';
            limitHint.style.display = 'none';
        }
    }

    const grid = document.getElementById('photoGrid');
    if (!grid) return;

    if (list.length === 0) {
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

    const altText = i18nT('detail.photo.alt');
    const delAria = i18nT('detail.photo.deleteAria');
    const sizeLabelPrefix = i18nT('detail.photo.sizePrefix');

    grid.innerHTML = list.map((p, idx) => {
        const upload = statuses[idx];
        const sizeLabel = p.sizeBytes ? formatBytes(p.sizeBytes) : '';
        const title = sizeLabel ? `${sizeLabelPrefix}: ${sizeLabel}` : '';

        const uploadState = upload ? upload.status : null;
        const uploadBadge = renderUploadBadge(uploadState);

        return `
        <div class="photo-thumb photo-thumb--${uploadState || 'local'}">
            <img src="${p.dataUrl}" data-photo-view="${escapeHtml(String(p.id))}" alt="${altText}" loading="lazy" title="${escapeHtml(title)}">
            ${uploadBadge}
            <button data-photo-del="${escapeHtml(String(p.id))}" aria-label="${delAria}">✕</button>
        </div>`;
    }).join('');
}

/**
 * رندر badge وضعیت آپلود.
 *
 * @param {string|null} status — 'pending' | 'uploading' | 'uploaded' | 'failed' | null
 * @returns {string} HTML
 */
function renderUploadBadge(status) {
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
            const label = i18nT('detail.photo.badge.failed');
            return `<span class="photo-upload-badge photo-upload-badge--failed" title="${label}" aria-label="${label}">⚠</span>`;
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

const WEEK_ORDER = [
    ['recur.dayOfWeek.sat', 6],
    ['recur.dayOfWeek.sun', 0],
    ['recur.dayOfWeek.mon', 1],
    ['recur.dayOfWeek.tue', 2],
    ['recur.dayOfWeek.wed', 3],
    ['recur.dayOfWeek.thu', 4],
    ['recur.dayOfWeek.fri', 5],
];

function renderRecurRows() {
    const task = getDetailTask();
    if (!task) return;
    const r = task.recur;
    const nRow = document.getElementById('fRecurNRow');
    if (nRow) nRow.style.display = (r === 'custom' || r === 'hourly') ? '' : 'none';
    const weekRow = document.getElementById('fRecurWeekRow');
    if (weekRow) weekRow.style.display = r === 'weeklyDays' ? '' : 'none';
    const monthRow = document.getElementById('fRecurMonthRow');
    if (monthRow) monthRow.style.display = r === 'monthlyDays' ? '' : 'none';

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
        wc.innerHTML = WEEK_ORDER.map(([key, v]) =>
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
    const task = getDetailTask();
    if (!task) return;
    task.text = document.getElementById('fTitle').value.trim().replace(/\s+/g, ' ').slice(0, MAX_LENGTH);
    document.getElementById('detailTitle').textContent = task.text || i18nT('tasks.new');
    saveTasks();
    call('render');
    flashSaved();
}, 300);

const debouncedSaveDesc = debounce(() => {
    const task = getDetailTask();
    if (!task) return;
    task.description = document.getElementById('fDesc').value.slice(0, 1000);
    saveTasks();
    flashSaved();
}, 500);

const debouncedSavePhone = debounce(() => {
    const task = getDetailTask();
    if (!task) return;
    task.phone = document.getElementById('fPhone').value.trim().slice(0, 20);
    saveTasks();
    flashSaved();
}, 300);

const debouncedSaveAddr = debounce(() => {
    const task = getDetailTask();
    if (!task) return;
    task.address = document.getElementById('fAddr').value.slice(0, 500);
    saveTasks();
    flashSaved();
}, 500);

const debouncedSaveUrl = debounce(() => {
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
        openPicker('session', iso => {
            const task = getDetailTask();
            if (!task) return;
            if (hasSessionAt(task.sessions, iso)) {
                flashSaved(i18nT('picker.errorDuplicate'));
                return;
            }
            task.sessions.push({ id: uid(), at: iso });
            saveTasks();
            renderDetailSessions();
            call('render');
            flashSaved();
        });
    });
    document.getElementById('sessList').addEventListener('click', e => {
        const locBtn = e.target.closest('[data-sess-loc]');
        if (locBtn) {
            state.relocateSess = { taskId: state.currentDetailId, sessId: locBtn.dataset.sessLoc };
            state.relocateTaskId = null;
            state.pendingReturnDetail = state.currentDetailId;
            ensureMapVisible();
            switchToTab('map');
            if (window.matchMedia('(max-width: 900px)').matches) {
                const pageEl = document.getElementById('detailPage');
                if (pageEl) pageEl.style.display = 'none';
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
        task.sessions = task.sessions.filter(s => String(s.id) !== btn.dataset.sess);
        saveTasks();
        renderDetailSessions();
        call('render');
        flashSaved(i18nT('detail.session.removed'));
    });
    document.getElementById('sessList').addEventListener('change', e => {
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
        const t = getDetailTask();
        if (!t) return;
        enterLocationPickMode(t.id, 'change');
    });
    document.getElementById('detailLocRemove').addEventListener('click', () => {
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
        const task = getDetailTask();
        if (!task) return;
        task.pinned = e.target.checked;
        saveTasks();
        call('render');
        flashSaved();
    });
    document.getElementById('fRecurWeekChips').addEventListener('click', e => {
        const b = e.target.closest('[data-wday]');
        if (b) toggleRecurDay(parseInt(b.dataset.wday, 10));
    });
    document.getElementById('fRecurMonthChips').addEventListener('click', e => {
        const b = e.target.closest('[data-mday]');
        if (b) toggleRecurDay(parseInt(b.dataset.mday, 10));
    });
    document.getElementById('fRecur').addEventListener('change', e => {
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
        if (task.recur === 'hourly' && !(task.recurN >= 1 && task.recurN <= 168)) task.recurN = 8;
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
                t.startAt = iso;
                if (t.endAt && new Date(t.endAt) < new Date(iso)) t.endAt = null;
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

                task.photos.push({
                    id: uid(),
                    dataUrl,
                    addedAt: new Date().toISOString(),
                    contentType: result.contentType,
                    sizeBytes: result.sizeBytes,
                    width: result.width,
                    height: result.height,
                });

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
            saveTasks();
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

            saveTasks();
            await renderDetailPhotos().catch(err => console.warn('[detail] renderDetailPhotos failed:', err));
            call('render');
            flashSaved(i18nT('detail.photo.deleted'));
            return;
        }
        const img = e.target.closest('[data-photo-view]');
        if (img) {
            openLightbox(img.src);
        }
    });
    document.getElementById('lightbox').addEventListener('click', () => {
        closeLightbox();
    });
    document.getElementById('timerToggle').addEventListener('click', toggleTimer);
    document.getElementById('detailBack').addEventListener('click', closeDetail);
    document.getElementById('detailDelete').addEventListener('click', async () => {
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

events.on('media:upload-complete', ({ taskId }) => {
    if (String(state.currentDetailId) === String(taskId)) {
        renderDetailPhotos().catch(() => {});
    }
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