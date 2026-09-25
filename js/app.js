// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// app.js -- event wiring + boot (ESM entry point) — فاز ۶ گام ۲
//
// ⚠️ فاز ۴C (i18n):
//   - state.prefs.lang حذف شد — i18n منبع یکتای زبان است
//   - initI18n() بعد از loadPrefs() صدا زده می‌شود
//   - applyDisplaySettings() فقط تم را مدیریت می‌کند (dir/lang به i18n واگذار شد)
//   - language toggle از setLang() + applyToDOM() + resetRenderSignature() استفاده می‌کند
//   - updateFooter() برای به‌روزرسانی dynamic footer (سال + todayLine)
//   - refreshSoundPresetList() برای به‌روزرسانی لیست آهنگ‌ها در تغییر زبان
//   - بستن operation-list با کلیک بیرون
//
// ⚠️ فاز ۴D.4c:
//   - toFa → formatNumber برای اعداد locale-aware
//
// ⚠️ این نسخه:
//   - wireEvents() مستقیم برای همه listenerها
//   - DueChipsManager جایگزین _dueHome
//   - setMapHelpers (رفع circular import)
//   - Export/Import
//   - initNetworkMonitor, initSyncQueue, initHeaderStatus, initPWA
//   - initAuth, restoreSession, authModal (Telegram Redirect-based)
//   - initI18n (فاز ۴C)
// ═══════════════════════════════════════════════════════════════════════════

import {
    state,
    escapeHtml,
    uid,
    showConfirmModal,
    showInfoModal,
    trapFocus,
    MAX_LENGTH,
    input,
    addBtn,
    searchInput,
    taskList,
    clearBtn,
    downloadJSON,
    readJSONFile,
    buildBackupFilename,
    formatBytes
} from './core.js';
import { getNow, syncServerTime } from './time.js';
import {
    faShort,
    parseDateText,
    updateDueChips,
    hasSessionAt
} from './sessions.js';
import {
    loadTasks,
    saveTasks,
    loadTrash,
    saveTrash,
    findTask,
    addTask,
    addChild,
    createPlanCustom,
    PLAN_TEMPLATES,
    restoreTrash,
    toggleTask,
    deleteTask,
    clearCompleted,
    archiveDone,
    setMapHelpers,
    exportTasks,
    importTasks,
    getPendingChanges
} from './store.js';
import {
    openPicker,
    closePicker,
    shiftPickerMonth,
    renderPicker,
    confirmPicker,
    removePickerDue,
    applyPreset
} from './picker.js';
import {
    loadPrefs,
    savePrefs,
    applyMapVisibility,
    initMap,
    ensureMapVisible,
    switchToTab,
    mapHint,
    clearRoute,
    locateUser,
    toggleFullscreen,
    getMap,
    getMapReady,
    getPickMarker,
    setPickMarker,
    removePickMarker,
    flyToTask,
    startLiveTracking,
    stopLiveTracking,
    isLiveTrackingActive
} from './map.js';
import {
    startReminderLoop,
    ensureNotifPerm,
    fireNotification,
    getSoundPresets,
    getVoicesForLang,
    ttsSupported,
    testAudioReminder,
    stopTts,
    hasPersianTtsVoice
} from './notify.js';
import {
    openDetail,
    closeDetail,
    bindDetailInputs
} from './detail.js';
import {
    render,
    openCal,
    closeCal,
    shiftCalMonth,
    setSelectedDay,
    openTrash,
    closeTrash,
    renderTrash,
    openTemplateModal,
    closeTemplateModal,
    renderTemplateList,
    renderTplKids,
    getTplDraft,
    setTplDraft,
    startEdit,
    commitEdit,
    cancelEdit,
    showUndoFor,
    resetRenderSignature
} from './ui.js';
import {
    refreshSavedLocationUI,
    updateLocChip,
    locationLabelFor,
    saveLocationFromPopup,
    showMobileBanner,
    hideMobileBanner,
    isRelocateActive
} from './location-ui.js';
import {
    showRouteTo,
    clearMapRoute,
    hasActiveRoute,
    getActiveRouteDestination
} from './route-ui.js';
import { initMapSearch } from './map-search.js';
import { bindWeatherModal } from './weather-modal.js';
import { events, EV } from './events.js';

// ⚠️ فاز ۵ گام ۵ — ماژول‌های شبکه و صف
import { startNetworkMonitor } from './net.js';
import { initSyncQueue, getQueueSize as getSyncQueueSize } from './sync-queue.js';
import { initPWA, updateBadge } from './pwa.js';
import { initHeaderStatus, updateHeaderStatus } from './header-status.js';

// ⚠️ فاز ۶ گام ۲ — احراز هویت (Redirect-based)
import {
    initAuth,
    restoreSession,
    handleTelegramRedirect,
    buildTelegramLoginUrl,
    loginWithTelegram,
    logout as logoutAuth,
    getAuthState,
    getCurrentUser,
    formatExpiry,
    refreshToken,
    ttlLabel,
    ALLOWED_TTL_DAYS
} from './auth.js';

// ⚠️ فاز ۴C — چندزبانه
import {
    initI18n,
    applyToDOM,
    setLang,
    getLang,
    formatNumber,
    formatPercent,
    t,
    t as i18nT
} from './i18n.js';

// ═══════════════════════════════════════════════════════════════════════════
// DueChipsManager — جایگزین _dueHome
// ═══════════════════════════════════════════════════════════════════════════

class DueChipsManager {
    constructor() {
        this.chips = null;
        this.originalParent = null;
        this.originalNext = null;
        this.mountedAt = null;
    }

    init() {
        this.chips = document.getElementById('dueChips');
        if (!this.chips) return;
        this.originalParent = this.chips.parentElement;
        this.originalNext = this.chips.nextElementSibling;
        this.mountedAt = this.originalParent;
    }

    mountAt(parent, before = null) {
        if (!this.chips) return;
        if (!parent) {
            this.restore();
            return;
        }
        if (this.mountedAt === parent && this.chips.parentElement === parent) {
            if (before && this.chips.nextElementSibling !== before) {
                parent.insertBefore(this.chips, before);
            }
            return;
        }
        if (before) {
            parent.insertBefore(this.chips, before);
        } else {
            parent.appendChild(this.chips);
        }
        this.mountedAt = parent;
    }

    restore() {
        if (!this.chips || !this.originalParent) return;
        if (this.chips.parentElement === this.originalParent) {
            this.mountedAt = this.originalParent;
            return;
        }
        if (this.originalNext && this.originalNext.parentElement === this.originalParent) {
            this.originalParent.insertBefore(this.chips, this.originalNext);
        } else {
            this.originalParent.appendChild(this.chips);
        }
        this.mountedAt = this.originalParent;
    }

    isMountedAt(parent) {
        return this.chips && this.chips.parentElement === parent;
    }
}

const dueChipsManager = new DueChipsManager();

// ═══════════════════════════════════════════════════════════════════════════
// Auth Modal — فاز ۶ گام ۲ (Redirect-based)
// ═══════════════════════════════════════════════════════════════════════════

let _authTrapCleanup = null;

/**
 * باز کردن مودال «حساب من».
 */
function openAuthModal() {
    const modal = document.getElementById('authModal');
    if (!modal) return;

    renderAuthModal();

    modal.style.display = 'flex';
    if (_authTrapCleanup) _authTrapCleanup();
    _authTrapCleanup = trapFocus(modal);
    setTimeout(() => document.getElementById('authModalClose')?.focus(), 60);
}

/**
 * بستن مودال «حساب من».
 */
function closeAuthModal() {
    if (_authTrapCleanup) {
        _authTrapCleanup();
        _authTrapCleanup = null;
    }
    const modal = document.getElementById('authModal');
    if (modal) modal.style.display = 'none';
}

/**
 * رندر محتوای مودال بر اساس وضعیت auth.
 */
function renderAuthModal() {
    const body = document.getElementById('authModalBody');
    if (!body) return;

    const auth = getAuthState();

    if (!auth.loggedIn) {
        // ─── حالت ۱: وارد نشده ───
        body.innerHTML = `
            <p class="modal-message">
                ${i18nT('auth.login.message')}
                <br><small class="auth-hint">${i18nT('auth.login.hint')}</small>
            </p>
            <div class="auth-options">
                <button type="button" class="btn-add auth-option-btn" id="authTelegramBtn">
                    <span aria-hidden="true">📱</span>
                    <span>${i18nT('auth.login.telegramButton')}</span>
                </button>
                <button type="button" class="btn-small auth-option-btn auth-option-btn--disabled" id="authSyncCodeBtn" disabled aria-disabled="true" title="${i18nT('auth.login.syncCodeDisabledTitle')}">
                    <span aria-hidden="true">🔑</span>
                    <span>${i18nT('auth.login.syncCodeButton')}</span>
                    <small class="auth-option-soon">${i18nT('auth.login.syncCodeSoon')}</small>
                </button>
            </div>
            <p class="auth-note">
                ${i18nT('auth.login.note')}
            </p>
            <div class="auth-error" id="authError" style="display:none;" role="alert"></div>
        `;

        const tgBtn = document.getElementById('authTelegramBtn');
        if (tgBtn) {
            tgBtn.addEventListener('click', () => {
                const url = buildTelegramLoginUrl();
                window.location.href = url;
            });
        }
        return;
    }

    // ─── حالت ۲: وارد شده ───
    const user = auth.user || {};
    const displayName = user.displayName || i18nT('auth.defaultUserName');
    const username = user.telegramUsername ? `@${user.telegramUsername}` : '—';
    const expiryText = formatExpiry(auth.expiresAt);
    const currentTtl = user.tokenTtlDays || 90;
    const warning = auth.shouldWarnExpiry
        ? `<div class="auth-warning">${i18nT('auth.warning.expiringSoon', { remaining: expiryText })}</div>`
        : '';

    const ttlOptionsHtml = ALLOWED_TTL_DAYS.map(d => {
        const selected = (d === currentTtl) ? ' selected' : '';
        return `<option value="${d}"${selected}>${ttlLabel(d)}</option>`;
    }).join('');

    body.innerHTML = `
        <div class="auth-user-info">
            <div class="auth-user-row"><span>${i18nT('auth.loggedIn.nameLabel')}</span> <strong>${escapeHtml(displayName)}</strong></div>
            <div class="auth-user-row"><span>${i18nT('auth.loggedIn.usernameLabel')}</span> <strong dir="ltr">${escapeHtml(username)}</strong></div>
        </div>

        <div class="auth-ttl-block">
            <label class="auth-ttl-label" for="authTtlSelect">${i18nT('auth.loggedIn.ttlLabel')}</label>
            <div class="auth-ttl-row">
                <select id="authTtlSelect" class="sort-select" aria-label="${i18nT('auth.loggedIn.ttlLabel')}">
                    ${ttlOptionsHtml}
                </select>
                <button type="button" class="btn-small" id="authApplyTtlBtn">${i18nT('auth.loggedIn.ttlApplyButton')}</button>
            </div>
            <div class="auth-remaining">
                ${i18nT('auth.loggedIn.remainingLabel')} <strong>${escapeHtml(expiryText)}</strong>
            </div>
        </div>

        <div class="auth-user-info">
            <div class="auth-user-row"><span>${i18nT('auth.loggedIn.syncCodeLabel')}</span> <strong>${user.hasSyncCode ? i18nT('auth.loggedIn.syncCodeActive') : i18nT('auth.loggedIn.syncCodeUnavailable')}</strong></div>
        </div>

        ${warning}

        <div class="auth-actions">
            <button class="btn-clear auth-logout-btn" id="authLogoutBtn" type="button">${i18nT('auth.loggedIn.logoutButton')}</button>
            <button class="btn-small auth-disconnect-btn" id="authDisconnectBtn" type="button" title="${i18nT('auth.disconnect.title')}">${i18nT('auth.loggedIn.disconnectButton')}</button>
        </div>
    `;

    const logoutBtn = document.getElementById('authLogoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            const ok = await showConfirmModal({
                title: i18nT('auth.logout.confirmTitle'),
                message: i18nT('auth.logout.confirmMessage'),
                confirmText: i18nT('auth.logout.confirmOk'),
                cancelText: i18nT('auth.logout.confirmCancel'),
                danger: true
            });
            if (!ok) return;
            logoutAuth();
            renderAuthModal();
            updateAccountStatusText();
        });
    }

    const applyTtlBtn = document.getElementById('authApplyTtlBtn');
    const ttlSelect = document.getElementById('authTtlSelect');
    if (applyTtlBtn && ttlSelect) {
        applyTtlBtn.addEventListener('click', async () => {
            const newTtl = parseInt(ttlSelect.value, 10);
            if (!Number.isFinite(newTtl)) return;
            if (newTtl === currentTtl) {
                return;
            }
            applyTtlBtn.disabled = true;
            applyTtlBtn.textContent = '...';
            try {
                const result = await refreshToken({ tokenTtlDays: newTtl });
                if (result.ok) {
                    renderAuthModal();
                    updateAccountStatusText();
                } else {
                    alert(result.error || i18nT('errors.refreshFailed'));
                    applyTtlBtn.disabled = false;
                    applyTtlBtn.textContent = i18nT('auth.loggedIn.ttlApplyButton');
                }
            } catch (err) {
                alert(i18nT('errors.refreshFailed'));
                applyTtlBtn.disabled = false;
                applyTtlBtn.textContent = i18nT('auth.loggedIn.ttlApplyButton');
            }
        });
    }

    const disconnectBtn = document.getElementById('authDisconnectBtn');
    if (disconnectBtn) {
        disconnectBtn.addEventListener('click', async () => {
            await showInfoModal({
                title: i18nT('auth.disconnect.title'),
                paragraphs: [
                    i18nT('auth.disconnect.instructions'),
                    i18nT('auth.disconnect.step1'),
                    i18nT('auth.disconnect.step2'),
                    i18nT('auth.disconnect.step3'),
                    i18nT('auth.disconnect.step4'),
                    i18nT('auth.disconnect.step5'),
                    i18nT('auth.disconnect.step6'),
                    `<small style="color:var(--text-muted);">${i18nT('auth.disconnect.note')}</small>`
                ],
                buttonText: i18nT('auth.disconnect.buttonText')
            });
        });
    }
}

/**
 * آپدیت متن وضعیت حساب در تنظیمات.
 */
function updateAccountStatusText() {
    const el = document.getElementById('accountStatusText');
    if (!el) return;

    const auth = getAuthState();
    if (!auth.loggedIn) {
        el.textContent = t('auth.status.loggedOut');
        el.classList.remove('is-logged-in');
        el.classList.add('is-logged-out');
        return;
    }

    const user = auth.user || {};
    const name = user.displayName || t('auth.defaultUserName');
    el.textContent = t('auth.status.loggedInAs', { name });
    el.classList.remove('is-logged-out');
    el.classList.add('is-logged-in');
}

/**
 * ⚠️ فاز ۴C: به‌روزرسانی متن‌های داینامیک footer و todayLine بر اساس زبان فعلی.
 */
function updateFooter() {
    const footerEl = document.getElementById('footerCopyright');
    if (footerEl) {
        let year = '';
        try {
            year = new Date().toLocaleDateString(
                getLang() === 'en' ? 'en-US' : 'fa-IR',
                { year: 'numeric' }
            );
        } catch { /* silent */ }
        footerEl.textContent = t('app.footer.copyright', { year });
    }

    const todayEl = document.getElementById('todayLine');
    if (todayEl) {
        try {
            const dateStr = new Date().toLocaleDateString(
                getLang() === 'en' ? 'en-US' : 'fa-IR',
                { weekday: 'long', day: 'numeric', month: 'long' }
            );
            todayEl.textContent = t('header.today', { date: dateStr });
        } catch { /* silent */ }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// wireEvents
// ═══════════════════════════════════════════════════════════════════════════

function wireEvents() {
    events.on(EV.UI_RENDER_REQUESTED, render);
    events.on('ui:update-due-chips', updateDueChips);
    events.on('ui:render-plan-kids', renderPlanKids);
    events.on('ui:render-trash', renderTrash);
    events.on(EV.UI_SNACKBAR, showUndoFor);
    events.on(EV.UI_OPEN_DETAIL, openDetail);

    events.on(EV.LOCATION_UPDATED, refreshSavedLocationUI);
    events.on(EV.LOCATION_PENDING_CHANGED, updateLocChip);
    events.on('location:save-from-popup', saveLocationFromPopup);
    events.on('location:label-for', locationLabelFor);
    events.on('location:show-mobile-banner', showMobileBanner);
    events.on('location:hide-mobile-banner', hideMobileBanner);
    events.on('location:is-relocate-active', isRelocateActive);

    events.on(EV.ROUTE_SHOW, showRouteTo);
    events.on(EV.ROUTE_CLEAR, clearMapRoute);
    events.on('route:has-active', hasActiveRoute);
    events.on('route:get-destination', getActiveRouteDestination);

    events.on(EV.MODAL_CONFIRM, showConfirmModal);

    events.on('pwa:shortcut-action', ({ action }) => {
        if (action === 'new-task') setKind('task');
        else if (action === 'new-plan') setKind('plan');
        else if (action === 'new-series') setKind('series');
    });

    events.on('header-status:clicked', () => {
        // فعلاً: هیچ‌کاری — در فاز ۶ می‌تواند modal باز کند
    });

    events.on('auth:login', () => {
        updateAccountStatusText();
    });
    events.on('auth:logout', () => {
        updateAccountStatusText();
    });
    events.on('auth:token-refreshed', () => {
        updateAccountStatusText();
    });
    events.on('auth:expired', () => {
        updateAccountStatusText();
    });
    events.on('auth:error', ({ message }) => {
        console.warn('[auth]', message);
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// setKind + helpers
// ═══════════════════════════════════════════════════════════════════════════

export function setKind(kind) {
    state.pendingKind = kind;
    state.prefs.pendingKind = kind;
    savePrefs();
    input.placeholder = kind === 'plan'
        ? t('tasks.planPlaceholder')
        : kind === 'series'
            ? t('tasks.seriesPlaceholder')
            : t('tasks.newPlaceholder');
    document.querySelectorAll('.kind3-btn').forEach(x => x.classList.toggle('active', x.dataset.kind === kind));
    const isPlan = kind === 'plan';
    const isSeries = kind === 'series';

    document.getElementById('locBtn').style.display = '';

    if (!isPlan) {
        state.planDraftStart = null;
        state.planDraftEnd = null;
    }

    if (state.addDraftSessions.length && isSeries) {
        state.addDraftSessions = [];
        updateDueChips();
    }
    const sc = document.getElementById('smartChip');
    if (sc && (isSeries && state.seriesType !== 'dates')) sc.style.display = 'none';
    document.getElementById('planKidsWrap').style.display = isPlan ? '' : 'none';
    const md = document.getElementById('moreDetails');
    if (md) {
        md.style.display = isSeries ? '' : 'none';
        if (!isSeries) md.open = false;
    }
    document.getElementById('seriesRecurWrap').style.display = isSeries ? '' : 'none';
    const tb = document.getElementById('templateBtn');
    if (tb) tb.style.display = isPlan ? '' : 'none';

    const planDatesWrap = document.getElementById('planDatesWrap');
    if (planDatesWrap) planDatesWrap.style.display = isPlan ? '' : 'none';
    if (isPlan) renderPlanDatesForm();

    const addB = document.getElementById('addBtn');
    if (addB) {
        addB.textContent = isPlan
            ? t('tasks.addButton.plan')
            : isSeries
                ? t('tasks.addButton.series')
                : t('tasks.addButton.task');
    }
    updateDueRow();
    syncDisclosure();
}

function renderPlanDatesForm() {
    const startBtn = document.getElementById('planStartBtn');
    const endBtn = document.getElementById('planEndBtn');
    const line = document.getElementById('planDatesLine');
    if (startBtn) {
        startBtn.textContent = state.planDraftStart
            ? t('detail.planDates.startWithDate', { date: fmtDateFa(state.planDraftStart) })
            : t('detail.sections.planDates.startButton');
    }
    if (endBtn) {
        endBtn.textContent = state.planDraftEnd
            ? t('detail.planDates.endWithDate', { date: fmtDateFa(state.planDraftEnd) })
            : t('detail.sections.planDates.endButton');
    }
    if (line) {
        const parts = [];
        const fromLabel = t('detail.sections.planDates.from');
        const toLabel = t('detail.sections.planDates.to');
        if (state.planDraftStart) parts.push(`${fromLabel} ${fmtDateFa(state.planDraftStart)}`);
        if (state.planDraftEnd) parts.push(`${toLabel} ${fmtDateFa(state.planDraftEnd)}`);
        line.textContent = parts.join(' ');
        line.style.display = parts.length ? '' : 'none';
    }
}

/**
 * فرمت کوتاه تاریخ بر اساس زبان فعلی.
 *
 * ⚠️ فاز ۴D.5: locale-aware
 *   - در fa: تاریخ شمسی (مثلاً «۱۵ آذر»)
 *   - در en: تاریخ میلادی (مثلاً «December 5»)
 *
 * ⚠️ نام تابع `fmtDateFa` تاریخی است — ولی حالا locale-aware است.
 *
 * @param {string} iso
 * @returns {string}
 */
function fmtDateFa(iso) {
    try {
        return new Date(iso).toLocaleDateString(
            getLang() === 'en' ? 'en-US' : 'fa-IR',
            { day: 'numeric', month: 'long' }
        );
    } catch { return ''; }
}

function updateDueRow() {
    const isDates = state.pendingKind === 'series' && state.seriesType === 'dates';
    const dueB = document.getElementById('dueBtn');
    if (dueB) dueB.style.display = (state.pendingKind === 'series' && !isDates) ? 'none' : '';
    const sad = document.getElementById('seriesAddDate');
    if (sad) sad.style.display = isDates ? '' : 'none';

    if (isDates) {
        const slot = document.getElementById('dueChipsSlot');
        if (slot) dueChipsManager.mountAt(slot);
    } else {
        dueChipsManager.restore();
    }
}

function syncDisclosure() {
    const md = document.getElementById('moreDetails');
    if (md) md.open = state.prefs.proMode === true;
}

// ═══════════════════════════════════════════════════════════════════════════
// Event wiring — add task, due, loc, etc.
// ═══════════════════════════════════════════════════════════════════════════

addBtn.addEventListener('click', () => addTask(state.pendingKind));
input.addEventListener('keydown', e => { if (e.key === 'Enter') addTask(state.pendingKind); });

document.getElementById('dueBtn').addEventListener('click', () => openPicker('add'));
document.getElementById('dueChips').addEventListener('click', e => {
    const b = e.target.closest('[data-dchip]');
    if (!b) return;
    state.addDraftSessions = state.addDraftSessions.filter(s => String(s.id) !== b.dataset.dchip);
    updateDueChips();
});
document.getElementById('locBtn').addEventListener('click', () => {
    ensureMapVisible();
    switchToTab('map');
    document.getElementById('panelMap').scrollIntoView({ behavior: 'smooth' });
    mapHint(t('map.hint.clickForNew'));
});
document.getElementById('locChip').addEventListener('click', e => {
    if (!e.target.closest('[data-locclear]')) return;
    state.pendingLoc = null;
    removePickMarker();
    refreshSavedLocationUI();
});
document.getElementById('myLocBtn').addEventListener('click', () => { ensureMapVisible(); locateUser(true); });
document.getElementById('liveTrackBtn').addEventListener('click', () => {
    ensureMapVisible();
    if (isLiveTrackingActive()) {
        stopLiveTracking();
    } else {
        startLiveTracking();
    }
});
document.getElementById('fsBtn').addEventListener('click', toggleFullscreen);
document.getElementById('fsExit').addEventListener('click', toggleFullscreen);
document.getElementById('routeClearBtn').addEventListener('click', clearRoute);

document.getElementById('sortSelect').addEventListener('change', e => {
    state.currentSort = e.target.value;
    render();
});

document.querySelectorAll('.kind3-btn').forEach(b => {
    b.addEventListener('click', () => {
        setKind(b.dataset.kind);
        input.focus();
    });
});

document.querySelectorAll('[data-srecur]').forEach(b => {
    b.addEventListener('click', () => {
        state.seriesType = b.dataset.srecur;
        document.querySelectorAll('[data-srecur]').forEach(x => x.classList.toggle('on', x === b));
        document.getElementById('seriesError').textContent = '';
        state.seriesDays = [];
        document.querySelectorAll('#seriesSubWeek .on, #seriesMonthChips .on').forEach(x => x.classList.remove('on'));
        document.getElementById('seriesSubHours').style.display = state.seriesType === 'hourlyN' ? '' : 'none';
        document.getElementById('seriesSubWeek').style.display = state.seriesType === 'weeklyDays' ? '' : 'none';
        document.getElementById('seriesSubMonth').style.display = state.seriesType === 'monthlyDays' ? '' : 'none';
        updateDueRow();
        if (state.seriesType !== 'dates' && state.addDraftSessions.length) {
            state.addDraftSessions = [];
            updateDueChips();
        }
    });
});
document.querySelectorAll('[data-snh]').forEach(b => {
    b.addEventListener('click', () => {
        document.getElementById('seriesN').value = b.dataset.snh;
    });
});
document.getElementById('seriesSubWeek').addEventListener('click', e => {
    const b = e.target.closest('[data-swday]');
    if (!b) return;
    const v = parseInt(b.dataset.swday, 10);
    const i = state.seriesDays.indexOf(v);
    if (i >= 0) { state.seriesDays.splice(i, 1); b.classList.remove('on'); }
    else { state.seriesDays.push(v); b.classList.add('on'); }
});
/**
 * رندر chip-row روزهای ماه (series > monthlyDays).
 *
 * ⚠️ فاز ۴D.4c-fix: تابع قابل‌فراخوانی — در سوئیچ زبان دوباره صدا زده می‌شود.
 */
function renderSeriesMonth() {
    const mc = document.getElementById('seriesMonthChips');
    if (!mc) return;
    let h = '';
    for (let d = 1; d <= 31; d++) h += `<button type="button" class="day-chip" data-smday="${d}">${formatNumber(d)}</button>`;
    mc.innerHTML = h;
}
renderSeriesMonth();

/**
 * رندر chip-row ساعت‌ها (series > hourlyN).
 *
 * ⚠️ فاز ۴D.4c-fix: از این پس از JS ساخته می‌شود (نه HTML hardcoded)
 *    تا locale-aware باشد.
 */
function renderSeriesHours() {
    const container = document.querySelector('#seriesSubHours .chip-row');
    if (!container) return;
    const HOURS = [2, 4, 6, 8, 12, 24];
    container.innerHTML = HOURS.map(h =>
        `<button type="button" class="day-chip" data-snh="${h}">${formatNumber(h)}</button>`
    ).join('');
}
renderSeriesHours();

document.getElementById('seriesMonthChips').addEventListener('click', e => {
    const b = e.target.closest('[data-smday]');
    if (!b) return;
    const v = parseInt(b.dataset.smday, 10);
    const i = state.seriesDays.indexOf(v);
    if (i >= 0) { state.seriesDays.splice(i, 1); b.classList.remove('on'); }
    else { state.seriesDays.push(v); b.classList.add('on'); }
});

document.querySelectorAll('.mobile-tab').forEach(b => {
    b.addEventListener('click', () => switchToTab(b.dataset.tab));
});
document.getElementById('seriesAddDate').addEventListener('click', () => openPicker('add'));

// ─── Plan dates in add form ───
const planStartBtnForm = document.getElementById('planStartBtn');
if (planStartBtnForm) {
    planStartBtnForm.addEventListener('click', () => {
        openPicker('tpldate', iso => {
            state.planDraftStart = iso;
            if (state.planDraftEnd && new Date(state.planDraftEnd) < new Date(iso)) {
                state.planDraftEnd = null;
            }
            renderPlanDatesForm();
        });
    });
}
const planEndBtnForm = document.getElementById('planEndBtn');
if (planEndBtnForm) {
    planEndBtnForm.addEventListener('click', () => {
        openPicker('tpldate', iso => {
            state.planDraftEnd = iso;
            renderPlanDatesForm();
        });
    });
}
const planDatesClearForm = document.getElementById('planDatesClear');
if (planDatesClearForm) {
    planDatesClearForm.addEventListener('click', () => {
        state.planDraftStart = null;
        state.planDraftEnd = null;
        renderPlanDatesForm();
    });
}

function renderPlanKids() {
    const box = document.getElementById('planKidChips');
    if (!box) return;
    box.innerHTML = state.planDraftKids.map((k, i) => `<span class="due-chip">📝 ${escapeHtml(k)}<button type="button" data-plankid="${i}" aria-label="${t('common.delete')}">✕</button></span>`).join('');
    box.style.display = state.planDraftKids.length ? 'flex' : 'none';
}

document.getElementById('planKidAdd').addEventListener('click', () => {
    const inp = document.getElementById('planKidInput');
    const v = inp.value.trim().replace(/\s+/g, ' ');
    if (!v) { inp.focus(); return; }
    state.planDraftKids.push(v.slice(0, MAX_LENGTH));
    inp.value = '';
    renderPlanKids();
    inp.focus();
});
document.getElementById('planKidInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('planKidAdd').click();
    }
});
document.getElementById('planKidChips').addEventListener('click', e => {
    const b = e.target.closest('[data-plankid]');
    if (!b) return;
    state.planDraftKids.splice(parseInt(b.dataset.plankid, 10), 1);
    renderPlanKids();
});

document.getElementById('templateBtn').addEventListener('click', openTemplateModal);
document.getElementById('tplClose').addEventListener('click', closeTemplateModal);
document.getElementById('templateModal').addEventListener('click', e => {
    if (e.target.id === 'templateModal') closeTemplateModal();
});
document.getElementById('tplList').addEventListener('click', e => {
    const b = e.target.closest('[data-tpl]');
    if (!b) return;
    const tpl = PLAN_TEMPLATES.find(x => x.id === b.dataset.tpl);
    if (!tpl) return;
    setTplDraft({ name: tpl.title, kids: [...tpl.children], startAt: null, endAt: null });
    document.getElementById('tplName').value = tpl.title;
    renderTplDates();
    renderTplKids();
    document.getElementById('tplList').style.display = 'none';
    document.getElementById('tplConfig').style.display = '';
    document.getElementById('tplKidAdd').style.display = '';
    document.getElementById('tplBack').style.display = '';
    document.getElementById('tplCreate').style.display = '';
});
document.getElementById('tplBack').addEventListener('click', () => {
    setTplDraft(null);
    renderTemplateList();
    document.getElementById('tplList').style.display = '';
    document.getElementById('tplConfig').style.display = 'none';
    document.getElementById('tplKidAdd').style.display = 'none';
    document.getElementById('tplBack').style.display = 'none';
    document.getElementById('tplCreate').style.display = 'none';
});
document.getElementById('tplKidAdd').addEventListener('click', () => {
    const inp = document.getElementById('tplKidInput');
    const v = inp.value.trim().replace(/\s+/g, ' ');
    const draft = getTplDraft();
    if (!v || !draft) { inp.focus(); return; }
    draft.kids.push(v.slice(0, MAX_LENGTH));
    inp.value = '';
    renderTplKids();
    inp.focus();
});
document.getElementById('tplKidInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('tplKidAdd').click();
    }
});
document.getElementById('tplKids').addEventListener('click', e => {
    const b = e.target.closest('[data-tplkid]');
    const draft = getTplDraft();
    if (!b || !draft) return;
    draft.kids.splice(parseInt(b.dataset.tplkid, 10), 1);
    renderTplKids();
});
document.getElementById('tplCreate').addEventListener('click', () => {
    const draft = getTplDraft();
    if (!draft) return;
    const name = document.getElementById('tplName').value.trim();
    if (!name) {
        document.getElementById('tplName').focus();
        return;
    }
    const kids = [...draft.kids];
    const startAt = draft.startAt;
    const endAt = draft.endAt;
    closeTemplateModal();
    createPlanCustom(name, kids, { startAt, endAt });
});
/**
 * رندر خط تاریخ‌های شروع/پایان در مودال قالب.
 *
 * ⚠️ فاز ۴D.5: locale-aware
 *   - در fa: تاریخ شمسی
 *   - در en: تاریخ میلادی
 */
function renderTplDates() {
    const el = document.getElementById('tplDatesLine');
    const draft = getTplDraft();
    if (!el) return;
    if (!draft) {
        el.textContent = '';
        return;
    }

    // ⚠️ فاز ۴D.5: locale-aware (به‌جای hardcoded 'fa-IR')
    const fmt = iso => {
        try {
            return new Date(iso).toLocaleDateString(
                getLang() === 'en' ? 'en-US' : 'fa-IR',
                { day: 'numeric', month: 'long' }
            );
        } catch {
            return '';
        }
    };

    const parts = [];
    if (draft.startAt) parts.push(t('detail.sections.planDates.from') + ' ' + fmt(draft.startAt));
    if (draft.endAt) parts.push(t('detail.sections.planDates.to') + ' ' + fmt(draft.endAt));
    el.textContent = parts.length ? '📅 ' + parts.join(' ') : '';
}
document.getElementById('tplStartBtn').addEventListener('click', () => {
    const draft = getTplDraft();
    if (!draft) return;
    openPicker('tpldate', iso => {
        draft.startAt = iso;
        if (draft.endAt && new Date(draft.endAt) < new Date(iso)) draft.endAt = null;
        renderTplDates();
    });
});
document.getElementById('tplEndBtn').addEventListener('click', () => {
    const draft = getTplDraft();
    if (!draft) return;
    openPicker('tpldate', iso => {
        draft.endAt = iso;
        renderTplDates();
    });
});

/* ---------- Settings Modal ---------- */

const settingsModal = document.getElementById('settingsModal');
const settingsBtn = document.getElementById('settingsBtn');
const settingsCloseBtn = document.getElementById('settingsCloseBtn');
let settingsTrapCleanup = null;
let settingsReturnFocus = null;
function toggleSettings(force) {
    if (!settingsModal || !settingsBtn) return;
    const open = typeof force === 'boolean' ? force : settingsModal.hidden;
    settingsModal.hidden = !open;
    settingsModal.style.display = open ? 'flex' : 'none';
    settingsBtn.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('modal-open', open);
    if (open) {
        settingsReturnFocus = document.activeElement;
        settingsTrapCleanup?.();
        settingsTrapCleanup = trapFocus(settingsModal);
        setTimeout(() => settingsCloseBtn?.focus(), 60);
        updateAccountStatusText();
    } else {
        settingsTrapCleanup?.();
        settingsTrapCleanup = null;
        settingsReturnFocus?.focus?.({ preventScroll: true });
        settingsReturnFocus = null;
    }
}
settingsBtn?.addEventListener('click', () => toggleSettings());
settingsCloseBtn?.addEventListener('click', () => toggleSettings(false));
settingsModal?.addEventListener('click', event => {
    if (event.target === settingsModal) toggleSettings(false);
});

// ═══════════════════════════════════════════════════════════════════════════
// حساب من — دکمه و مودال
// ═══════════════════════════════════════════════════════════════════════════
document.getElementById('authOpenBtn')?.addEventListener('click', () => {
    toggleSettings(false);
    setTimeout(() => openAuthModal(), 100);
});
document.getElementById('authModalClose')?.addEventListener('click', closeAuthModal);
document.getElementById('authModal')?.addEventListener('click', e => {
    if (e.target.id === 'authModal') closeAuthModal();
});

document.getElementById('heroDescToggle').addEventListener('click', async () => {
    await showInfoModal({
        title: t('hero.infoTitle'),
        paragraphs: [
            t('hero.infoIntro'),
            t('hero.infoTask'),
            t('hero.infoPlan'),
            t('hero.infoSeries'),
            t('hero.infoStart')
        ],
        buttonText: t('hero.buttonText')
    });
    if (window.matchMedia('(min-width: 901px)').matches) {
        const ti = document.getElementById('taskInput');
        if (ti) ti.focus({ preventScroll: true });
    }
});

document.getElementById('privacyBtn').addEventListener('click', async () => {
    const paragraphs = [];
    for (let i = 0; i < 8; i++) {
        paragraphs.push(t(`privacy.paragraphs.${i}`));
    }
    await showInfoModal({
        title: t('privacy.title'),
        paragraphs,
        buttonText: t('privacy.buttonText')
    });
    if (window.matchMedia('(min-width: 901px)').matches) {
        const ti = document.getElementById('taskInput');
        if (ti) ti.focus({ preventScroll: true });
    }
});

/* ---------- Export / Import ---------- */

const exportModal = document.getElementById('exportModal');
const importModal = document.getElementById('importModal');
let _exportTrapCleanup = null;
let _importTrapCleanup = null;
let _importFileData = null;

function openExportModal() {
    if (!exportModal) return;
    document.getElementById('exportIncludePhotos').checked = false;
    document.getElementById('exportIncludeSettings').checked = false;
    updateExportMeta();

    exportModal.style.display = 'flex';
    if (_exportTrapCleanup) _exportTrapCleanup();
    _exportTrapCleanup = trapFocus(exportModal);
    setTimeout(() => document.getElementById('exportConfirm')?.focus(), 60);
}

function closeExportModal() {
    if (_exportTrapCleanup) { _exportTrapCleanup(); _exportTrapCleanup = null; }
    if (exportModal) exportModal.style.display = 'none';
}

function updateExportMeta() {
    const meta = document.getElementById('exportMeta');
    if (!meta) return;
    const includePhotos = document.getElementById('exportIncludePhotos')?.checked;
    const taskCount = state.tasks.length;
    const trashCount = state.trash.length;
    const baseSize = JSON.stringify({ tasks: state.tasks, trash: state.trash }).length;
    const photosSize = includePhotos
        ? state.tasks.reduce((sum, t) => sum + (t.photos || []).reduce((s, p) => s + (p.dataUrl?.length || 0), 0), 0)
        : 0;
    const estimated = baseSize + photosSize;
    meta.innerHTML = `
        <div class="export-meta-row"><span>${t('export.metaTasks')}</span> <strong>${formatNumber(taskCount)}</strong></div>
        <div class="export-meta-row"><span>${t('export.metaTrash')}</span> <strong>${formatNumber(trashCount)}</strong></div>
        <div class="export-meta-row"><span>${t('export.metaSize')}</span> <strong>${formatBytes(estimated)}</strong></div>
    `;
}

document.getElementById('exportBtn')?.addEventListener('click', openExportModal);
document.getElementById('exportCancel')?.addEventListener('click', closeExportModal);
document.getElementById('exportIncludePhotos')?.addEventListener('change', updateExportMeta);
exportModal?.addEventListener('click', e => {
    if (e.target === exportModal) closeExportModal();
});

document.getElementById('exportConfirm')?.addEventListener('click', async () => {
    try {
        const includePhotos = document.getElementById('exportIncludePhotos')?.checked || false;
        const includeSettings = document.getElementById('exportIncludeSettings')?.checked || false;

        const backup = await exportTasks({ includePhotos, includeSettings });
        const filename = buildBackupFilename();
        const ok = downloadJSON(backup, filename);
        if (ok) {
            closeExportModal();
            events.emit(EV.UI_SNACKBAR, [], t('export.success', { filename }));
        } else {
            alert(t('export.error'));
        }
    } catch (err) {
        console.error('export failed:', err);
        alert(t('export.error'));
    }
});

function openImportModal() {
    if (!importModal) return;
    _importFileData = null;
    document.getElementById('importFileName').textContent = t('import.noFileSelected');
    document.getElementById('importModeWrap').style.display = 'none';
    document.getElementById('importMeta').innerHTML = '';
    document.getElementById('importConfirm').disabled = true;
    const mergeRadio = document.querySelector('input[name="importMode"][value="merge"]');
    if (mergeRadio) mergeRadio.checked = true;
    document.getElementById('importSettingsCheck').checked = false;

    importModal.style.display = 'flex';
    if (_importTrapCleanup) _importTrapCleanup();
    _importTrapCleanup = trapFocus(importModal);
    setTimeout(() => document.getElementById('importFileInput')?.click(), 100);
}

function closeImportModal() {
    if (_importTrapCleanup) { _importTrapCleanup(); _importTrapCleanup = null; }
    if (importModal) importModal.style.display = 'none';
    _importFileData = null;
}

document.getElementById('importBtn')?.addEventListener('click', openImportModal);
document.getElementById('importCancel')?.addEventListener('click', closeImportModal);
importModal?.addEventListener('click', e => {
    if (e.target === importModal) closeImportModal();
});

document.getElementById('importFileInput')?.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const nameEl = document.getElementById('importFileName');
    const metaEl = document.getElementById('importMeta');
    if (nameEl) nameEl.textContent = `${file.name} (${formatBytes(file.size)})`;

    try {
        const data = await readJSONFile(file);
        _importFileData = data;

        if (!data || !data.data || !Array.isArray(data.data.tasks)) {
            if (metaEl) metaEl.innerHTML = `<div class="import-error">${t('import.invalidStructure')}</div>`;
            document.getElementById('importConfirm').disabled = true;
            return;
        }

        const schemaVersion = data.schemaVersion || t('import.unknown');
        const taskCount = data.data.tasks.length;
        const trashCount = Array.isArray(data.data.trash) ? data.data.trash.length : 0;
        const exportedAt = data.exportedAt
            ? new Date(data.exportedAt).toLocaleDateString(
                getLang() === 'en' ? 'en-US' : 'fa-IR',
                { day: 'numeric', month: 'long', year: 'numeric' }
            )
            : t('import.unknown');
        const hasSettings = Boolean(data.settings);
        const hasPhotos = (data.options && data.options.includePhotos);

        if (metaEl) {
            metaEl.innerHTML = `
                <div class="import-meta-row"><span>${t('import.metaVersion')}</span> <strong>${escapeHtml(schemaVersion)}</strong></div>
                <div class="import-meta-row"><span>${t('import.metaExportedAt')}</span> <strong>${escapeHtml(exportedAt)}</strong></div>
                <div class="import-meta-row"><span>${t('import.metaTasks')}</span> <strong>${formatNumber(taskCount)}</strong></div>
                <div class="import-meta-row"><span>${t('import.metaTrash')}</span> <strong>${formatNumber(trashCount)}</strong></div>
                ${hasPhotos ? `<div class="import-meta-warn">${t('import.hasPhotosWarning')}</div>` : ''}
            `;
        }

        document.getElementById('importModeWrap').style.display = '';

        const settingsWrap = document.getElementById('importSettingsWrap');
        const settingsCheck = document.getElementById('importSettingsCheck');
        if (settingsWrap) settingsWrap.style.display = hasSettings ? '' : 'none';
        if (settingsCheck) settingsCheck.checked = false;

        document.getElementById('importConfirm').disabled = false;
    } catch (err) {
        console.error('read file failed:', err);
        let msg = t('import.errorRead');
        if (err.message === 'invalid-json') msg = t('import.errorInvalidJson');
        else if (err.message === 'file-too-large') msg = t('import.errorTooLarge');
        if (metaEl) metaEl.innerHTML = `<div class="import-error">${escapeHtml(msg)}</div>`;
        document.getElementById('importConfirm').disabled = true;
    }
});

document.getElementById('importConfirm')?.addEventListener('click', async () => {
    if (!_importFileData) return;
    const mode = document.querySelector('input[name="importMode"]:checked')?.value || 'merge';
    const importSettings = document.getElementById('importSettingsCheck')?.checked || false;

    if (mode === 'replace') {
        const ok = await showConfirmModal({
            title: t('import.replaceConfirmTitle'),
            message: t('import.replaceConfirmMessage'),
            confirmText: t('import.replaceConfirmOk'),
            cancelText: t('import.replaceConfirmCancel'),
            danger: true
        });
        if (!ok) return;
    }

    try {
        const result = await importTasks(_importFileData, { mode, importSettings });
        closeImportModal();

        if (result.ok) {
            resetRenderSignature();
            render();
            renderTrash();
            if (importSettings) {
                applyDisplaySettings();
                applyMapVisibility();
                applyProMode();
            }
            const parts = [t('import.success', { n: formatNumber(result.imported) })];
            if (result.skipped > 0) parts.push(t('import.successSkipped', { n: formatNumber(result.skipped) }));
            if (result.warning) parts.push(result.warning);
            events.emit(EV.UI_SNACKBAR, [], parts.join(' — '));
        } else {
            alert(result.error || t('import.errorImport'));
        }
    } catch (err) {
        console.error('import failed:', err);
        alert(t('import.errorImport'));
    }
});

/* ---------- Theme / Lang ---------- */

function applyTheme(theme) {
    const html = document.documentElement;
    const body = document.body;
    html.classList.remove('theme-light', 'theme-dark');
    if (body) body.classList.remove('theme-light', 'theme-dark');

    let effective;
    if (theme === 'dark') {
        effective = 'dark';
        html.setAttribute('data-theme', 'dark');
    } else if (theme === 'light') {
        effective = 'light';
        html.setAttribute('data-theme', 'light');
    } else {
        html.removeAttribute('data-theme');
        effective = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
        html.setAttribute('data-theme', effective);
    }

    const cls = effective === 'light' ? 'theme-light' : 'theme-dark';
    html.classList.add(cls);
    if (body) body.classList.add(cls);

    html.style.colorScheme = effective;

    if (body) {
        if (effective === 'light') {
            body.style.backgroundColor = '#f0f3f8';
            body.style.color = '#1e293b';
        } else {
            body.style.backgroundColor = '#0a0a1a';
            body.style.color = '#e0e0ff';
        }
    }

    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
        meta.setAttribute('content', effective === 'light' ? '#f0f3f8' : '#0a0a1a');
    });
}

function updateThemeBtn() {
    const btn = document.getElementById('themeBtn');
    if (!btn) return;
    const themeKey = state.prefs.theme === 'dark' ? 'dark'
                   : state.prefs.theme === 'light' ? 'light'
                   : 'auto';
    btn.textContent = t(`theme.${themeKey}`);
    const titleKey = themeKey.charAt(0).toUpperCase() + themeKey.slice(1);
    btn.title = t(`theme.label${titleKey}`);
}

function updateLangBtn() {
    const btn = document.getElementById('langBtn');
    if (!btn) return;
    const current = getLang();
    btn.textContent = current === 'en' ? '🌐 EN' : '🌐 FA';
    btn.title = current === 'en' ? t('language.switchToFa') : t('language.switchToEn');
}

function updateWelcomeOpts() {
    const themeGroup = document.getElementById('welcomeThemeGroup');
    if (themeGroup) {
        themeGroup.querySelectorAll('[data-theme]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === state.prefs.theme);
        });
    }
    const langGroup = document.getElementById('welcomeLangGroup');
    if (langGroup) {
        const current = getLang();
        langGroup.querySelectorAll('[data-lang]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.lang === current);
        });
    }
}

/**
 * ⚠️ فاز ۴C: فقط تم را اعمال می‌کند.
 *    dir/lang/data-lang به i18n واگذار شد.
 */
function applyDisplaySettings() {
    applyTheme(state.prefs.theme);
    updateThemeBtn();
    updateLangBtn();
    updateWelcomeOpts();
}

const themeBtnEl = document.getElementById('themeBtn');
if (themeBtnEl) {
    themeBtnEl.addEventListener('click', () => {
        const cycle = { auto: 'dark', dark: 'light', light: 'auto' };
        state.prefs.theme = cycle[state.prefs.theme] || 'auto';
        savePrefs();
        applyDisplaySettings();
    });
}

const langBtnEl = document.getElementById('langBtn');
if (langBtnEl) {
    langBtnEl.addEventListener('click', async () => {
        const next = getLang() === 'en' ? 'fa' : 'en';
        await setLang(next);
        applyToDOM();
        applyDisplaySettings();
        resetRenderSignature();
        render();
        renderSeriesMonth();      // ⚠️ فاز ۴D.4c-fix
        renderSeriesHours();      // ⚠️ فاز ۴D.4c-fix
        refreshTimeSelects();     // ⚠️ فاز ۴D.4c-fix
        updateAccountStatusText();
        refreshSoundPresetList();
        updateFooter();
        // ⚠️ بستن weather modal (راه‌حل موقت — ترجمه‌ی کامل در فایل بعدی)
        const wm = document.getElementById('weatherModal');
        if (wm && wm.style.display === 'flex') wm.style.display = 'none';
    });
}

const _welcomeThemeGroup = document.getElementById('welcomeThemeGroup');
if (_welcomeThemeGroup) {
    _welcomeThemeGroup.addEventListener('click', e => {
        const btn = e.target.closest('[data-theme]');
        if (!btn) return;
        state.prefs.theme = btn.dataset.theme;
        savePrefs();
        applyDisplaySettings();
    });
}

const _welcomeLangGroup = document.getElementById('welcomeLangGroup');
if (_welcomeLangGroup) {
    _welcomeLangGroup.addEventListener('click', async e => {
        const btn = e.target.closest('[data-lang]');
        if (!btn) return;
        await setLang(btn.dataset.lang);
        applyToDOM();
        applyDisplaySettings();
        resetRenderSignature();
        render();
        renderSeriesMonth();      // ⚠️ فاز ۴D.4c-fix
        renderSeriesHours();      // ⚠️ فاز ۴D.4c-fix
        refreshTimeSelects();     // ⚠️ فاز ۴D.4c-fix
        updateAccountStatusText();
        refreshSoundPresetList();
        updateFooter();
        const wm = document.getElementById('weatherModal');
        if (wm && wm.style.display === 'flex') wm.style.display = 'none';
    });
}

const _themeMedia = window.matchMedia('(prefers-color-scheme: light)');
const _onThemeMediaChange = () => {
    if (state.prefs.theme === 'auto') applyTheme('auto');
};
if (_themeMedia.addEventListener) {
    _themeMedia.addEventListener('change', _onThemeMediaChange);
} else if (_themeMedia.addListener) {
    _themeMedia.addListener(_onThemeMediaChange);
}

document.getElementById('mapToggle').addEventListener('click', () => {
    state.prefs.mapVisible = !state.prefs.mapVisible;
    savePrefs();
    applyMapVisibility();
    if (state.prefs.mapVisible) initMap();
});

/* ---------- Bottom Action Bar ---------- */

document.querySelector('.bottom-actions')?.addEventListener('click', e => {
    const btn = e.target.closest('.bottom-action');
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === 'new-task' || action === 'new-plan' || action === 'new-series') {
        switchToTab('tasks');
        const kind = action === 'new-task' ? 'task'
                   : action === 'new-plan' ? 'plan'
                   : 'series';
        setKind(kind);
        const createZone = document.querySelector('.create-zone');
        if (createZone) {
            createZone.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        setTimeout(() => {
            const ti = document.getElementById('taskInput');
            if (ti) ti.focus({ preventScroll: true });
        }, 400);
        return;
    }

    if (action === 'open-settings') {
        toggleSettings(true);
        return;
    }
});

/* ---------- Photo Camera Input ---------- */

(function initPhotoCameraInput() {
    const photoCameraInput = document.getElementById('photoCameraInput');
    const photoInput = document.getElementById('photoInput');
    if (!photoCameraInput || !photoInput) return;

    photoCameraInput.addEventListener('change', () => {
        if (!photoCameraInput.files || photoCameraInput.files.length === 0) return;
        try {
            const dt = new DataTransfer();
            for (const f of photoCameraInput.files) dt.items.add(f);
            photoInput.files = dt.files;
            photoInput.dispatchEvent(new Event('change', { bubbles: true }));
        } catch {
            photoInput.dispatchEvent(new Event('change', { bubbles: true }));
        } finally {
            photoCameraInput.value = '';
        }
    });
})();

/* ---------- initSettings ---------- */

function initSettings() {
    const on = document.getElementById('setRemindOn');
    const mins = document.getElementById('setRemindMin');
    const dig = document.getElementById('setDigestOn');
    on.checked = state.prefs.remindOn !== false;
    mins.value = String(state.prefs.remindMin || 60);
    dig.checked = state.prefs.digestOn !== false;
    const pro = document.getElementById('setProMode');
    if (pro) {
        pro.checked = state.prefs.proMode === true;
        pro.addEventListener('change', () => {
            state.prefs.proMode = pro.checked;
            savePrefs();
            applyProMode();
            syncDisclosure();
        });
    }
    on.addEventListener('change', () => { state.prefs.remindOn = on.checked; savePrefs(); });
    mins.addEventListener('change', () => { state.prefs.remindMin = parseInt(mins.value, 10) || 60; savePrefs(); });
    dig.addEventListener('change', () => { state.prefs.digestOn = dig.checked; savePrefs(); });

    initSoundSettings();
    initSystemPermissions();
}

function refreshSoundPresetList() {
    const presetSel = document.getElementById('setSoundPreset');
    if (!presetSel) return;
    const presets = getSoundPresets();
    const current = state.prefs.soundPreset;
    presetSel.innerHTML = `<option value="">${escapeHtml(t('sound.preset.none'))}</option>` +
        presets.map(p => `<option value="${escapeHtml(p.key)}"${p.key === current ? ' selected' : ''}>${escapeHtml(p.label)}</option>`).join('');
}

function initSoundSettings() {
    const master = document.getElementById('setSoundOn');
    const modesWrap = document.getElementById('soundModesWrap');
    const syncDisabledState = () => {
        if (!modesWrap) return;
        modesWrap.classList.toggle('is-disabled', master && !master.checked);
    };
    if (master) {
        master.checked = state.prefs.soundOn !== false;
        master.addEventListener('change', () => {
            state.prefs.soundOn = master.checked;
            savePrefs();
            syncDisabledState();
        });
    }
    syncDisabledState();

    const defCb = document.getElementById('setSoundDefault');
    if (defCb) {
        defCb.checked = state.prefs.soundDefault !== false;
        defCb.addEventListener('change', () => {
            state.prefs.soundDefault = defCb.checked;
            savePrefs();
        });
    }
    const defTest = document.getElementById('testSoundDefaultBtn');
    if (defTest) {
        defTest.addEventListener('click', () => {
            const prev = state.prefs.soundDefault;
            const prevPresetOn = state.prefs.soundPresetOn;
            const prevTtsOn = state.prefs.soundTtsOn;
            const prevSoundOn = state.prefs.soundOn;
            state.prefs.soundOn = true;
            state.prefs.soundDefault = true;
            state.prefs.soundPresetOn = false;
            state.prefs.soundTtsOn = false;
            testAudioReminder();
            state.prefs.soundDefault = prev;
            state.prefs.soundPresetOn = prevPresetOn;
            state.prefs.soundTtsOn = prevTtsOn;
            state.prefs.soundOn = prevSoundOn;
        });
    }

    const presetCb = document.getElementById('setSoundPresetOn');
    const presetSel = document.getElementById('setSoundPreset');
    if (presetSel) {
        refreshSoundPresetList();
        presetSel.addEventListener('change', () => {
            state.prefs.soundPreset = presetSel.value || null;
            savePrefs();
        });
    }
    if (presetCb) {
        presetCb.checked = state.prefs.soundPresetOn === true;
        presetCb.addEventListener('change', () => {
            state.prefs.soundPresetOn = presetCb.checked;
            savePrefs();
        });
    }
    const presetTest = document.getElementById('testSoundPresetBtn');
    if (presetTest) {
        presetTest.addEventListener('click', () => {
            if (!state.prefs.soundPreset) {
                alert(t('sound.preset.selectFirst'));
                return;
            }
            const prev = state.prefs.soundDefault;
            const prevPresetOn = state.prefs.soundPresetOn;
            const prevTtsOn = state.prefs.soundTtsOn;
            const prevSoundOn = state.prefs.soundOn;
            state.prefs.soundOn = true;
            state.prefs.soundDefault = false;
            state.prefs.soundPresetOn = true;
            state.prefs.soundTtsOn = false;
            testAudioReminder();
            state.prefs.soundDefault = prev;
            state.prefs.soundPresetOn = prevPresetOn;
            state.prefs.soundTtsOn = prevTtsOn;
            state.prefs.soundOn = prevSoundOn;
        });
    }

    const ttsCb = document.getElementById('setSoundTtsOn');
    const ttsVoiceRow = document.getElementById('soundTtsVoiceRow');
    const ttsVoiceSel = document.getElementById('setSoundTtsVoice');
    const ttsSupportedNow = ttsSupported();

    function populateTtsVoices(sel) {
        if (!sel) return;
        const voices = getVoicesForLang(getLang());
        const current = state.prefs.soundTtsVoice;
        sel.innerHTML = `<option value="">${escapeHtml(t('sound.tts.defaultVoice'))}</option>` +
            voices.map(v => {
                const label = `${escapeHtml(v.name)} (${escapeHtml(v.lang)})`;
                const selected = v.name === current ? ' selected' : '';
                return `<option value="${escapeHtml(v.name)}"${selected}>${label}</option>`;
            }).join('');
    }

    function updateTtsWarning() {
        const label = document.querySelector('#setSoundTtsOn')
            ?.closest('.sound-mode')
            ?.querySelector('small');
        if (!label) return;
        if (!ttsSupportedNow) return;
        if (!hasPersianTtsVoice()) {
            label.innerHTML = t('sound.tts.noPersianVoice');
        } else {
            label.textContent = t('sound.tts.hint');
        }
    }
    if (!ttsSupportedNow) {
        if (ttsCb) {
            ttsCb.disabled = true;
            const modeEl = ttsCb.closest('.sound-mode');
            if (modeEl) {
                const small = modeEl.querySelector('small');
                if (small) small.textContent = t('sound.tts.unsupported');
            }
        }
        if (ttsVoiceSel) ttsVoiceSel.disabled = true;
    }

    if (ttsCb) {
        ttsCb.checked = state.prefs.soundTtsOn === true;
        ttsCb.addEventListener('change', () => {
            state.prefs.soundTtsOn = ttsCb.checked;
            savePrefs();
            if (!ttsCb.checked) {
                stopTts();
            }
            if (ttsCb.checked) {
                if (!state.prefs.soundTtsVoice) {
                    const voices = getVoicesForLang(getLang());
                    if (voices.length) {
                        state.prefs.soundTtsVoice = voices[0].name;
                        savePrefs();
                        populateTtsVoices(ttsVoiceSel);
                    }
                }
            }
        });
    }

    if (ttsVoiceSel) {
        populateTtsVoices(ttsVoiceSel);
        ttsVoiceSel.addEventListener('change', () => {
            state.prefs.soundTtsVoice = ttsVoiceSel.value || null;
            savePrefs();
        });
    }

    updateTtsWarning();

    if (ttsSupportedNow && typeof window.speechSynthesis !== 'undefined') {
        try {
            window.speechSynthesis.onvoiceschanged = () => {
                populateTtsVoices(ttsVoiceSel);
                updateTtsWarning();
            };
        } catch { /* silent */ }
    }

    const syncVoiceRowVisibility = () => {
        if (!ttsVoiceRow || !ttsCb) return;
        ttsVoiceRow.style.display = ttsCb.checked ? '' : 'none';
    };
    if (ttsCb) ttsCb.addEventListener('change', syncVoiceRowVisibility);
    syncVoiceRowVisibility();

    const ttsTest = document.getElementById('testSoundTtsBtn');
    if (ttsTest) {
        ttsTest.disabled = !ttsSupportedNow;
        ttsTest.addEventListener('click', () => {
            if (!ttsSupportedNow) {
                alert(t('sound.tts.unsupported'));
                return;
            }
            const prev = state.prefs.soundDefault;
            const prevPresetOn = state.prefs.soundPresetOn;
            const prevTtsOn = state.prefs.soundTtsOn;
            const prevSoundOn = state.prefs.soundOn;
            state.prefs.soundOn = true;
            state.prefs.soundDefault = false;
            state.prefs.soundPresetOn = false;
            state.prefs.soundTtsOn = true;
            testAudioReminder(t('sound.tts.testText'));
            state.prefs.soundDefault = prev;
            state.prefs.soundPresetOn = prevPresetOn;
            state.prefs.soundTtsOn = prevTtsOn;
            state.prefs.soundOn = prevSoundOn;
        });
    }
}

async function queryPermission(name) {
    try {
        return navigator.permissions?.query ? await navigator.permissions.query({ name }) : null;
    } catch { return null; }
}

function setPermissionStatus(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

async function inspectSystemPermissions() {
    const notification = typeof Notification === 'undefined' ? null : Notification.permission;
    const statusGranted = t('settings.sections.permissions.statusGranted');
    const statusDenied = t('settings.sections.permissions.statusDenied');
    const statusNotGranted = t('settings.sections.permissions.statusNotGranted');
    const statusUnsupported = t('settings.sections.permissions.statusUnsupported');
    const statusTestPrompt = t('settings.sections.permissions.statusTestPrompt');

    setPermissionStatus('permissionNotifStatus',
        notification === 'granted' ? statusGranted
        : notification === 'denied' ? statusDenied
        : notification === 'default' ? statusNotGranted
        : statusUnsupported
    );
    const location = await queryPermission('geolocation');
    setPermissionStatus('permissionLocationStatus',
        location ? (location.state === 'granted' ? statusGranted : location.state === 'denied' ? statusDenied : statusNotGranted) : statusTestPrompt
    );
    const microphone = await queryPermission('microphone');
    setPermissionStatus('permissionMicStatus',
        microphone ? (microphone.state === 'granted' ? statusGranted : microphone.state === 'denied' ? statusDenied : statusNotGranted) : statusTestPrompt
    );
}

async function requestLocationPermission() {
    if (!navigator.geolocation) return setPermissionStatus('permissionLocationStatus', t('settings.sections.permissions.statusUnsupported'));
    const statusGranted = t('settings.sections.permissions.statusGranted');
    const statusDenied = t('settings.sections.permissions.statusDenied');
    const statusNotGranted = t('settings.sections.permissions.statusNotGranted');
    navigator.geolocation.getCurrentPosition(
        () => setPermissionStatus('permissionLocationStatus', statusGranted),
        error => setPermissionStatus('permissionLocationStatus', error.code === 1 ? statusDenied : statusNotGranted),
        { timeout: 8000, maximumAge: 0 }
    );
}

async function requestMicrophonePermission() {
    if (!navigator.mediaDevices?.getUserMedia) return setPermissionStatus('permissionMicStatus', t('settings.sections.permissions.statusUnsupported'));
    const statusGranted = t('settings.sections.permissions.statusGranted');
    const statusDenied = t('settings.sections.permissions.statusDenied');
    const statusNotGranted = t('settings.sections.permissions.statusNotGranted');
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
        setPermissionStatus('permissionMicStatus', statusGranted);
    } catch (error) {
        setPermissionStatus('permissionMicStatus', error.name === 'NotAllowedError' ? statusDenied : statusNotGranted);
    }
}

function initSystemPermissions() {
    inspectSystemPermissions();
    document.getElementById('permissionNotifBtn')?.addEventListener('click', async () => { await ensureNotifPerm(); inspectSystemPermissions(); });
    document.getElementById('permissionNotifTestBtn')?.addEventListener('click', async () => { if (await ensureNotifPerm()) fireNotification(t('notifications.testNotification.title'), t('notifications.testNotification.body')); inspectSystemPermissions(); });
    document.getElementById('permissionLocationBtn')?.addEventListener('click', requestLocationPermission);
    document.getElementById('permissionLocationTestBtn')?.addEventListener('click', requestLocationPermission);
    document.getElementById('permissionMicBtn')?.addEventListener('click', requestMicrophonePermission);
    document.getElementById('permissionMicTestBtn')?.addEventListener('click', requestMicrophonePermission);
}

function applyProMode() {
    const on = state.prefs.proMode === true;
    document.body.classList.toggle('pro-mode', on);

    if (on) {
        state.tasks.forEach(t => { if (t.kind === 'plan') state.expandedPlans.add(String(t.id)); });
        render();
        return;
    }

    state.selectedDay = null;
    state.currentFilter = 'all';
    state.currentSort = 'newest';
    document.querySelectorAll('.filter-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.filter === 'all');
    });
    const sortSel = document.getElementById('sortSelect');
    if (sortSel) sortSel.value = 'newest';
    render();
}

// PWA: نصب
let deferredPrompt = null;
const installBtn = document.getElementById('installBtn');
window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    if (installBtn) installBtn.style.display = '';
});
if (installBtn) installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.style.display = 'none';
});
window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    if (installBtn) installBtn.style.display = 'none';
});
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    });
}

document.getElementById('pickerPrev').addEventListener('click', () => shiftPickerMonth(-1));
document.getElementById('pickerNext').addEventListener('click', () => shiftPickerMonth(1));
document.getElementById('pickerDays').addEventListener('click', e => {
    const dayBtn = e.target.closest('[data-day]');
    if (!dayBtn || dayBtn.disabled) return;
    state.pickerDay = parseInt(dayBtn.dataset.day, 10);
    document.getElementById('pickerError').textContent = '';
    renderPicker();
});
document.getElementById('pickerConfirm').addEventListener('click', confirmPicker);
document.getElementById('pickerRemove').addEventListener('click', removePickerDue);
document.getElementById('pickerCancel').addEventListener('click', closePicker);
document.querySelector('.picker-chips').addEventListener('click', e => {
    const b = e.target.closest('[data-preset]');
    if (!b) return;
    document.getElementById('pickerError').textContent = '';
    applyPreset(b.dataset.preset);
});
document.getElementById('calBtn').addEventListener('click', openCal);
document.getElementById('calClose').addEventListener('click', closeCal);
document.getElementById('calPrev').addEventListener('click', () => shiftCalMonth(-1));
document.getElementById('calNext').addEventListener('click', () => shiftCalMonth(1));
document.getElementById('calDays').addEventListener('click', e => {
    const b = e.target.closest('[data-calday]');
    if (!b) return;
    setSelectedDay(b.dataset.calday);
    closeCal();
    switchToTab('tasks');
});
document.getElementById('dayChip').addEventListener('click', () => setSelectedDay(null));
document.getElementById('trashBtn').addEventListener('click', openTrash);
document.getElementById('trashBack').addEventListener('click', closeTrash);
document.getElementById('trashEmpty').addEventListener('click', async () => {
    if (!state.trash.length) return;
    const ok = await showConfirmModal({
        title: t('trash.emptyConfirmTitle'),
        message: t('trash.emptyConfirmMessage'),
        confirmText: t('trash.emptyConfirmOk'),
        cancelText: t('trash.emptyConfirmCancel'),
        danger: true
    });
    if (!ok) return;
    state.trash = [];
    saveTrash();
    renderTrash();
    render();
});
document.getElementById('trashList').addEventListener('click', async e => {
    const b = e.target.closest('[data-tact]');
    if (!b) return;
    if (b.dataset.tact === 'restore') restoreTrash(b.dataset.tid);
    else if (b.dataset.tact === 'purge') {
        const ok = await showConfirmModal({
            title: t('trash.purgeConfirmTitle'),
            message: t('trash.purgeConfirmMessage'),
            confirmText: t('trash.purgeConfirmOk'),
            cancelText: t('trash.purgeConfirmCancel'),
            danger: true
        });
        if (!ok) return;
        state.trash = state.trash.filter(x => String(x.id) !== String(b.dataset.tid));
        saveTrash();
        renderTrash();
        render();
    }
});
document.getElementById('calOverlay').addEventListener('click', e => {
    if (e.target.id === 'calOverlay') closeCal();
});
document.getElementById('pickerOverlay').addEventListener('click', e => {
    if (e.target.id === 'pickerOverlay') closePicker();
});

document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;

    if (settingsModal && !settingsModal.hidden) { toggleSettings(false); return; }

    if (exportModal && exportModal.style.display === 'flex') { closeExportModal(); return; }
    if (importModal && importModal.style.display === 'flex') { closeImportModal(); return; }

    const authModal = document.getElementById('authModal');
    if (authModal && authModal.style.display === 'flex') { closeAuthModal(); return; }

    const stacked = ['confirmModal', 'infoModal', 'namePromptModal', 'nameConflictModal', 'weatherModal'];
    for (const id of stacked) {
        const el = document.getElementById(id);
        if (el && el.style.display === 'flex') return;
    }

    const saved = document.getElementById('savedLocationsModal');
    if (saved && saved.style.display === 'flex') return;

    const picker = document.getElementById('pickerOverlay');
    if (picker && picker.style.display === 'flex') { closePicker(); return; }

    const cal = document.getElementById('calOverlay');
    if (cal && cal.style.display === 'flex') { closeCal(); return; }

    const tpl = document.getElementById('templateModal');
    if (tpl && tpl.style.display === 'flex') { closeTemplateModal(); return; }

    const trash = document.getElementById('trashPage');
    if (trash && trash.style.display === 'block') { closeTrash(); return; }

    if (state.currentDetailId) { closeDetail(); return; }

    if (document.querySelector('.map-wrap.fullscreen')) toggleFullscreen();
});

let searchTimer = null;
searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
        state.searchQuery = searchInput.value;
        render();
    }, 150);
});

taskList.addEventListener('click', e => {
    if (e.target.classList.contains('task-edit-input') || e.target.classList.contains('child-input')) return;

    const cdchip = e.target.closest('[data-cdchip]');
    if (cdchip) {
        const gid = cdchip.dataset.gid;
        state.childDrafts[gid] = (state.childDrafts[gid] || []).filter(s => String(s.id) !== cdchip.dataset.cdchip);
        render();
        return;
    }

    const childEl = e.target.closest('.child-item');
    const item = e.target.closest('.task-item');
    if (!item) return;
    const scopeEl = childEl || item;
    const id = scopeEl.dataset.id;
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) {
        taskList.querySelectorAll('.operation-list:not([hidden])').forEach(openList => {
            openList.hidden = true;
            const trigger = openList.parentElement?.querySelector('.operation-trigger');
            if (trigger) trigger.setAttribute('aria-expanded', 'false');
        });
    }
    if (!actionEl && state.editingId) return;

    if (actionEl && actionEl.dataset.action === 'toggle-menu') {
        const menu = actionEl.closest('.operation-menu');
        const list = menu ? menu.querySelector('.operation-list') : null;
        if (!menu || !list) return;
        const willOpen = list.hidden;
        taskList.querySelectorAll('.operation-list:not([hidden])').forEach(openList => {
            openList.hidden = true;
            const trigger = openList.parentElement?.querySelector('.operation-trigger');
            if (trigger) trigger.setAttribute('aria-expanded', 'false');
        });
        list.hidden = !willOpen;
        actionEl.setAttribute('aria-expanded', String(willOpen));
        return;
    }

    const action = actionEl ? actionEl.dataset.action : null;

    if (action === 'toggle') toggleTask(id);
    else if (action === 'delete') deleteTask(id, scopeEl);
    else if (action === 'edit-btn') startEdit(id);
    else if (action === 'edit-ok') {
        const inp = scopeEl.querySelector('.task-edit-input');
        commitEdit(id, inp ? inp.value : '');
    }
    else if (action === 'edit-cancel') cancelEdit();
    else if (action === 'detail') openDetail(id);
    else if (action === 'locate') { ensureMapVisible(); flyToTask(id); }
    else if (action === 'route') {
        const found = findTask(id);
        if (!found) return;
        const t = found.task;
        const hasLoc = t.location || (t.sessions || []).some(s => s.location);
        if (!hasLoc) {
            mapHint(t('map.hint.noLocationForTask'));
            return;
        }
        ensureMapVisible();
        showRouteTo(id);
    }
    else if (action === 'pin') {
        const found = findTask(id);
        if (found) {
            found.task.pinned = !found.task.pinned;
            saveTasks();
            render();
        }
    }
    else if (action === 'unarchive') {
        const found = findTask(id);
        if (found) {
            found.task.archived = false;
            saveTasks();
            render();
        }
    }
    else if (action === 'archive') {
        const found = findTask(id);
        if (found) {
            found.task.archived = true;
            saveTasks();
            render();
        }
    }
    else if (action === 'pick-loc') {
        const found = findTask(id);
        if (!found) return;
        ensureMapVisible();
        if (found.task.location) flyToTask(id);
        else if (!getMapReady()) mapHint(t('map.hint.mapNotAvailable'));
        else {
            state.relocateTaskId = id;
            switchToTab('map');
            document.getElementById('panelMap').scrollIntoView({ behavior: 'smooth' });
            mapHint(t('map.hint.clickForRelocate'));
        }
    }
    else if (action === 'check-all') {
        const g = state.tasks.find(t => String(t.id) === String(id) && t.kind === 'plan');
        if (g) {
            (g.children || []).forEach(c => { c.completed = true; });
            saveTasks();
            render();
        }
    }
    else if (action === 'expand') {
        const gid = String(id);
        if (state.expandedPlans.has(gid)) state.expandedPlans.delete(gid);
        else state.expandedPlans.add(gid);
        render();
    }
    else if (action === 'child-date') {
        openPicker('child', iso => {
            const arr = state.childDrafts[id] || (state.childDrafts[id] = []);
            if (hasSessionAt(arr, iso)) {
                const ci = taskList.querySelector(`.task-item[data-id="${id}"] .child-input`);
                if (ci) {
                    ci.classList.remove('input-error');
                    void ci.offsetWidth;
                    ci.classList.add('input-error');
                }
                return;
            }
            arr.push({ id: uid(), at: iso });
            render();
            const ni = taskList.querySelector(`.task-item[data-id="${id}"] .child-input`);
            if (ni) ni.focus();
        });
    }
    else if (action === 'child-add') addChild(id);
});

taskList.addEventListener('dblclick', e => {
    const textEl = e.target.closest('[data-action="edit"]');
    if (!textEl) return;
    const scopeEl = textEl.closest('.child-item') || textEl.closest('.task-item');
    if (scopeEl) startEdit(scopeEl.dataset.id);
});

taskList.addEventListener('keydown', e => {
    if (e.target.classList.contains('child-input')) {
        if (e.key === 'Enter') {
            const item = e.target.closest('.task-item');
            if (item) addChild(item.dataset.id);
        }
        return;
    }
    const editInput = e.target.closest('.task-edit-input');
    if (!editInput) return;
    const scopeEl = editInput.closest('.child-item') || editInput.closest('.task-item');
    if (!scopeEl) return;
    if (e.key === 'Enter') commitEdit(scopeEl.dataset.id, editInput.value);
    else if (e.key === 'Escape') cancelEdit();
});

taskList.addEventListener('focusout', e => {
    const editInput = e.target.closest('.task-edit-input');
    if (!editInput) return;
    const item = editInput.closest('.task-item');
    if (item && item.contains(e.relatedTarget)) return;
    const scopeEl = editInput.closest('.child-item') || item;
    if (!scopeEl) return;
    commitEdit(scopeEl.dataset.id, editInput.value);
});

document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.currentFilter = btn.dataset.filter;
        render();
    });
});

clearBtn.addEventListener('click', clearCompleted);
document.getElementById('archiveDone').addEventListener('click', archiveDone);

// ورود صوتی
(function initMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const buttons = [...document.querySelectorAll('[data-mic-target]'), document.getElementById('micBtn')].filter(Boolean);
    if (!SR) {
        buttons.forEach(btn => { btn.hidden = true; });
        return;
    }
    let active = null;
    const appendText = (target, base, transcript) => {
        const next = [base.trim(), transcript.trim()].filter(Boolean).join(' ');
        target.value = next.slice(0, Number(target.maxLength) || MAX_LENGTH);
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.focus();
    };
    buttons.forEach(btn => btn.addEventListener('click', () => {
        const target = document.getElementById(btn.dataset.micTarget || 'taskInput');
        if (!target) return;
        if (active) { active.stop(); return; }
        const rec = new SR();
        let finalText = '';
        const base = target.value || '';
        rec.lang = getLang() === 'en' ? 'en-US' : 'fa-IR';
        rec.interimResults = true;
        rec.continuous = false;
        rec.maxAlternatives = 1;
        active = rec;
        btn.classList.add('listening');
        rec.onresult = event => {
            finalText = '';
            let interim = '';
            for (let i = event.resultIndex; i < event.results.length; i += 1) {
                const text = event.results[i][0].transcript;
                if (event.results[i].isFinal) finalText += text;
                else interim += text;
            }
            appendText(target, base, finalText || interim);
        };
        const stop = () => { if (active === rec) active = null; btn.classList.remove('listening'); };
        rec.onend = stop;
        rec.onerror = stop;
        try { rec.start(); } catch { stop(); }
    }));
})();

const anyOverlayOpen = () =>
    document.getElementById('pickerOverlay').style.display === 'flex' ||
    document.getElementById('calOverlay').style.display === 'flex' ||
    document.getElementById('trashPage').style.display === 'block' ||
    document.getElementById('lightbox').style.display === 'flex' ||
    document.getElementById('weatherModal').style.display === 'flex' ||
    Boolean(state.currentDetailId);

document.addEventListener('keydown', e => {
    if (e.key !== '/' && e.key !== 'n' && e.key !== 'N' && e.key !== 'ن') return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
    if (anyOverlayOpen()) return;
    e.preventDefault();
    switchToTab('tasks');
    if (e.key === '/') searchInput.focus();
    else {
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        input.focus();
    }
});

let dragId = null;
taskList.addEventListener('dragstart', e => {
    const item = e.target.closest('.task-item');
    if (!item || state.currentSort !== 'manual' || e.target.closest('.child-item')) {
        e.preventDefault();
        return;
    }
    dragId = item.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    try {
        e.dataTransfer.setData('text/plain', dragId);
    } catch { /* نادیده */ }
    item.classList.add('dragging');
});
taskList.addEventListener('dragover', e => {
    if (!dragId) return;
    const item = e.target.closest('.task-item');
    if (!item || item.dataset.id === dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    item.classList.add('drop-target');
});
taskList.addEventListener('dragleave', e => {
    const item = e.target.closest('.task-item');
    if (item) item.classList.remove('drop-target');
});
taskList.addEventListener('drop', e => {
    const item = e.target.closest('.task-item');
    if (!item || !dragId || item.dataset.id === dragId) return;
    e.preventDefault();
    const from = state.tasks.findIndex(t => String(t.id) === String(dragId));
    const to = state.tasks.findIndex(t => String(t.id) === String(item.dataset.id));
    if (from < 0 || to < 0) return;
    const [moved] = state.tasks.splice(from, 1);
    state.tasks.splice(to, 0, moved);
    dragId = null;
    saveTasks();
    render();
});
taskList.addEventListener('dragend', () => {
    dragId = null;
    taskList.querySelectorAll('.drop-target,.dragging').forEach(el => el.classList.remove('drop-target', 'dragging'));
});

// پیشنهاد هوشمند تاریخ
let smartTimer = null;
let smartDismissedFor = { taskInput: '', descInput: '' };
let smartTargetId = null;

const hideSmart = () => {
    const chip = document.getElementById('smartChip');
    if (chip) chip.style.display = 'none';
    smartTargetId = null;
};

function maybeSuggestDue(value, targetId) {
    const v = (value || '').trim();
    hideSmart();

    if (!v || v === smartDismissedFor[targetId]) return;

    if (state.pendingKind === 'series' && state.seriesType !== 'dates') return;

    // ⚠️ فاز ۴E: locale-aware parser (fa → parseFaDateTime، en → parseEnDateTime)
    const iso = parseDateText(v, getNow());
    if (!iso) return;

    if (state.addDraftSessions.some(s => Math.abs(new Date(s.at).getTime() - new Date(iso).getTime()) < 60000)) return;

    smartTargetId = targetId;
    const sourceKey = targetId === 'descInput' ? 'tasks.smartSuggest.fromDesc' : 'tasks.smartSuggest.fromTitle';
    document.getElementById('smartChipText').textContent = t(sourceKey, { date: faShort(iso) });
    document.getElementById('smartChip').style.display = 'flex';

    document.getElementById('smartAccept').onclick = () => {
        state.addDraftSessions.push({ id: uid(), at: iso });
        updateDueChips();
        const target = document.getElementById(smartTargetId || 'taskInput');
        hideSmart();
        if (target) target.focus();
    };
    document.getElementById('smartDismiss').onclick = () => {
        smartDismissedFor[targetId] = v;
        hideSmart();
    };
}

function attachSmartSuggest(el, targetId) {
    if (!el) return;
    el.addEventListener('input', () => {
        clearTimeout(smartTimer);
        smartTimer = setTimeout(() => maybeSuggestDue(el.value, targetId), 400);
    });
}

/**
 * پر کردن optionهای picker ساعت/دقیقه.
 *
 * ⚠️ فاز ۴D.4c-fix: تابع قابل‌فراخوانی — در سوئیچ زبان دوباره صدا زده می‌شود.
 * ⚠️ قبل از پر کردن جدید، optionهای قبلی پاک می‌شوند.
 *
 * ⚠️ مقدار انتخاب‌شده حفظ می‌شود.
 */
function refreshTimeSelects() {
    const hourSel = document.getElementById('pickerHour');
    const minSel = document.getElementById('pickerMinute');
    if (!hourSel || !minSel) return;

    const prevHour = hourSel.value;
    const prevMin = minSel.value;

    hourSel.innerHTML = '';
    minSel.innerHTML = '';

    for (let h = 0; h < 24; h++) {
        const o = document.createElement('option');
        o.value = String(h).padStart(2, '0');
        o.textContent = formatNumber(h);
        hourSel.appendChild(o);
    }
    for (let m = 0; m < 60; m += 5) {
        const o = document.createElement('option');
        o.value = String(m).padStart(2, '0');
        o.textContent = formatNumber(m);
        minSel.appendChild(o);
    }

    // ⚠️ بازیابی مقدار انتخاب‌شده (اگر وجود داشت)
    if (prevHour) hourSel.value = prevHour;
    if (prevMin) minSel.value = prevMin;
}
refreshTimeSelects();

// ═══════════════════════════════════════════════════════════════════════════
// Boot
// ═══════════════════════════════════════════════════════════════════════════

bindDetailInputs();
loadPrefs();

setMapHelpers({ getMap, getMapReady, getPickMarker, setPickMarker });

wireEvents();

// ⚠️ بستن operation-list وقتی بیرون از آن کلیک می‌شود
document.addEventListener('click', e => {
    if (e.target.closest('.operation-trigger')) return;
    document.querySelectorAll('.operation-list:not([hidden])').forEach(openList => {
        openList.hidden = true;
        const trigger = openList.parentElement?.querySelector('.operation-trigger');
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
    });
});

(function initDueChips() {
    dueChipsManager.init();
})();

// ⚠️ فاز ۵ گام ۵: راه‌اندازی شبکه، صف sync، PWA، نشانگر وضعیت
startNetworkMonitor();
initSyncQueue().catch(err => {
    console.error('[app] initSyncQueue failed:', err);
});
initHeaderStatus();
initPWA();

// ⚠️ فاز ۶ گام ۲: راه‌اندازی auth
initAuth();

setKind(state.prefs.pendingKind || 'task');
if (!state.prefs.tourSeen) {
    document.getElementById('welcomeOverlay').style.display = 'flex';
    document.getElementById('welcomeStart').addEventListener('click', () => {
        document.getElementById('welcomeOverlay').style.display = 'none';
        state.prefs.tourSeen = true;
        savePrefs();
        input.focus();
    }, { once: true });
}
if (window.matchMedia('(min-width: 901px)').matches && !state.prefs.tourSeen) {
    setTimeout(() => {
        const ti = document.getElementById('taskInput');
        if (ti) ti.focus({ preventScroll: true });
    }, 100);
}
applyMapVisibility();
applyProMode();

// ⚠️ فاز ۶ گام ۲: آپدیت وضعیت حساب در UI
updateAccountStatusText();

attachSmartSuggest(input, 'taskInput');
attachSmartSuggest(document.getElementById('descInput'), 'descInput');

// ⚠️ فاز ۴C: initI18n قبل از هر render
initI18n().then(async () => {
    applyToDOM();
    applyDisplaySettings();
    updateAccountStatusText();
    updateFooter();
    initSettings();

    // ⚠️ بعد از i18n، taskها را لود کن
    await loadTasks();
    await loadTrash();
    if (state.prefs.proMode) state.tasks.forEach(t => { if (t.kind === 'plan') state.expandedPlans.add(String(t.id)); });
    updateDueChips();
    syncDisclosure();
    render();
    renderTrash();
    initMap();
    initMapSearch();
    syncServerTime();
    startReminderLoop();
    bindWeatherModal();

    // ⚠️ پردازش callback تلگرام
    try {
        const handled = await handleTelegramRedirect();
        if (handled.handled) {
            if (handled.ok) {
                console.log('[auth] Telegram redirect handled successfully');
            } else {
                console.warn('[auth] Telegram redirect failed:', handled.error);
            }
        }
    } catch (err) {
        console.warn('[auth] handleTelegramRedirect failed:', err);
    }

    // ⚠️ بازیابی session
    try {
        const restored = await restoreSession();
        if (restored.restored) {
            console.log('[auth] session restored for user:', restored.user?.id);
        }
    } catch (err) {
        console.warn('[auth] restoreSession failed:', err);
    }

    updateBadge({ immediate: true });
    updateHeaderStatus({ immediate: true });
    updateAccountStatusText();
}).catch(err => {
    console.error('[app] initI18n failed:', err);
    applyDisplaySettings();
    initSettings();
    // ⚠️ در صورت خطا، حداقل taskها را لود کن
    loadTasks().then(() => {
        loadTrash().then(() => {
            render();
            renderTrash();
        });
    });
});

if (import.meta.env.DEV) {
    window.TodoApp = {
        getState: () => state,
        findTask,
        saveTasks,
        render,
        events,
        getPendingChanges: async () => await getPendingChanges(),
        getSyncQueueSize: async () => await getSyncQueueSize(),
    };
}