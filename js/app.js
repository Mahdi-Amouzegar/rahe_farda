// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// app.js -- event wiring + boot (ESM entry point)

import {
    state,
    toFa,
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
    clearBtn
} from './core.js';
import { getNow, syncServerTime } from './time.js';
import {
    faShort,
    parseFaDateTime,
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
    registerCallbacks as registerStoreCallbacks
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
    registerMapCallbacks,
    startLiveTracking,
    stopLiveTracking,
    isLiveTrackingActive
} from './map.js';
import {
    startReminderLoop,
    ensureNotifPerm,
    fireNotification
} from './notify.js';
import {
    openDetail,
    closeDetail,
    bindDetailInputs,
    registerDetailCallbacks
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
    showUndoFor
} from './ui.js';
import {
    refreshSavedLocationUI,
    updateLocChip,
    locationLabelFor,
    saveLocationFromPopup,
    showMobileBanner,
    hideMobileBanner,
    isRelocateActive,
    registerLocationCallbacks
} from './location-ui.js';
import {
    showRouteTo,
    clearMapRoute,
    hasActiveRoute,
    getActiveRouteDestination
} from './route-ui.js';
import { initMapSearch } from './map-search.js';
import { bindWeatherModal } from './weather-modal.js';

// ═══════════════════════════════════════════════════════════════════════════
// State داخلی ماژول (جایگزین window.__dueHome)
// ═══════════════════════════════════════════════════════════════════════════
const _dueHome = { p: null, n: null };

// ═══════════════════════════════════════════════════════════════════════════
// Register callbacks (به جای shim‌های window.X)
// ═══════════════════════════════════════════════════════════════════════════

registerStoreCallbacks({
    render,
    updateDueChips,
    renderPlanKids,
    updateLocChip,
    openDetail,
    showUndoFor,
    showConfirmModal,
    renderTrash,
    getMap,
    getMapReady,
    getPickMarker,
    setPickMarker,
});

registerMapCallbacks({
    render,
    openDetail,
    showRouteTo,
    saveLocationFromPopup,
    updateLocChip,
    refreshSavedLocationUI,
    locationLabelFor,
    showMobilePickBanner: showMobileBanner,
    hideMobilePickBanner: hideMobileBanner,
    isRelocateLocationActive: isRelocateActive,
    clearMapRoute,
    hasActiveRoute,
    getActiveRouteDestination,
});

registerDetailCallbacks({
    render,
    refreshSavedLocationUI,
    showUndoFor,
    showMobilePickBanner: showMobileBanner,
    hideMobilePickBanner: hideMobileBanner,
    showRouteTo,
});

registerLocationCallbacks({
    render,
});

// ═══════════════════════════════════════════════════════════════════════════
// Event wiring
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
    mapHint('روی نقشه کلیک کنید تا محل وظیفه جدید انتخاب شود');
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

function setKind(kind) {
    state.pendingKind = kind;
    state.prefs.pendingKind = kind;
    savePrefs();
    input.placeholder = kind === 'plan'
        ? 'نام برنامه (مثلاً سفر به تهران)...'
        : kind === 'series'
            ? 'نام دوره (مثلاً جلسات فیزیوتراپی)...'
            : 'کار جدید را بنویسید...';
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
    if (addB) addB.textContent = isPlan ? 'افزودن برنامه' : isSeries ? 'افزودن دوره' : 'افزودن کار';
    updateDueRow();
    syncDisclosure();
}

function renderPlanDatesForm() {
    const startBtn = document.getElementById('planStartBtn');
    const endBtn = document.getElementById('planEndBtn');
    const line = document.getElementById('planDatesLine');
    if (startBtn) startBtn.textContent = state.planDraftStart ? `📅 شروع: ${fmtDateFa(state.planDraftStart)}` : '📅 تاریخ شروع';
    if (endBtn) endBtn.textContent = state.planDraftEnd ? `📅 پایان: ${fmtDateFa(state.planDraftEnd)}` : '📅 تاریخ پایان';
    if (line) {
        const parts = [];
        if (state.planDraftStart) parts.push('از ' + fmtDateFa(state.planDraftStart));
        if (state.planDraftEnd) parts.push('تا ' + fmtDateFa(state.planDraftEnd));
        line.textContent = parts.join(' ');
        line.style.display = parts.length ? '' : 'none';
    }
}

function fmtDateFa(iso) {
    try {
        return new Date(iso).toLocaleDateString('fa-IR', { day: 'numeric', month: 'long' });
    } catch { return ''; }
}

function updateDueRow() {
    const isDates = state.pendingKind === 'series' && state.seriesType === 'dates';
    const dueB = document.getElementById('dueBtn');
    if (dueB) dueB.style.display = (state.pendingKind === 'series' && !isDates) ? 'none' : '';
    const sad = document.getElementById('seriesAddDate');
    if (sad) sad.style.display = isDates ? '' : 'none';
    const dc = document.getElementById('dueChips');
    const slot = document.getElementById('dueChipsSlot');
    if (dc && slot) {
        if (isDates) {
            slot.appendChild(dc);
        } else if (_dueHome.p && dc.parentElement !== _dueHome.p) {
            _dueHome.p.insertBefore(dc, _dueHome.n);
        }
    }
}

function syncDisclosure() {
    const md = document.getElementById('moreDetails');
    if (md) md.open = state.prefs.proMode === true;
}

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
(function renderSeriesMonth() {
    const mc = document.getElementById('seriesMonthChips');
    if (!mc) return;
    let h = '';
    for (let d = 1; d <= 31; d++) h += `<button type="button" class="day-chip" data-smday="${d}">${toFa(d)}</button>`;
    mc.innerHTML = h;
})();
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
    box.innerHTML = state.planDraftKids.map((k, i) => `<span class="due-chip">📝 ${escapeHtml(k)}<button type="button" data-plankid="${i}" aria-label="حذف">✕</button></span>`).join('');
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
function renderTplDates() {
    const el = document.getElementById('tplDatesLine');
    const draft = getTplDraft();
    if (!el) return;
    if (!draft) {
        el.textContent = '';
        return;
    }
    const fmt = iso => {
        try {
            return new Date(iso).toLocaleDateString('fa-IR', { day: 'numeric', month: 'long' });
        } catch {
            return '';
        }
    };
    const parts = [];
    if (draft.startAt) parts.push('از ' + fmt(draft.startAt));
    if (draft.endAt) parts.push('تا ' + fmt(draft.endAt));
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

/* ---------- دکمه‌های هدر: راهنما و تنظیمات ---------- */

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

document.getElementById('heroDescToggle').addEventListener('click', async () => {
    await showInfoModal({
        title: 'راه فردا',
        paragraphs: [
            'وظایف و قرارهای روزانه را با یادآور، نقشه و تقویم شمسی مدیریت کن — <strong>بدون حساب کاربری</strong>، حتی آفلاین.',
            '<strong>📝 کار:</strong> یک وظیفه ساده با تاریخ یا محل.',
            '<strong>📂 برنامه:</strong> مجموعه‌ای از زیرکارها (مثلاً سفر، خانه‌تکانی).',
            '<strong>📅 دوره:</strong> یک وظیفه تکرارشونده (روزانه، هفتگی، ماهانه یا سفارشی).',
            'برای شروع، عنوان را در فیلد بالا بنویس و دکمه <strong>افزودن کار</strong> را بزن.'
        ],
        buttonText: 'شروع می‌کنم'
    });
    if (window.matchMedia('(min-width: 901px)').matches) {
        const ti = document.getElementById('taskInput');
        if (ti) ti.focus({ preventScroll: true });
    }
});

document.getElementById('privacyBtn').addEventListener('click', async () => {
    await showInfoModal({
        title: '🔒 حریم خصوصی شما',
        paragraphs: [
            '<strong>همه اطلاعات شما</strong> (وظایف، تاریخ‌ها، محل‌ها و تصاویر) فقط در همین دستگاه و مرورگر خودتان ذخیره می‌شود و به هیچ سروری ارسال نمی‌شود.',
            '<strong>نقشه</strong> فقط تصویر اینترنتی است و چیزی از شما آپلود نمی‌کند. سرویس‌های نقشه (OpenStreetMap، Esri) فقط tile تصویری دریافت می‌کنند، نه اطلاعات وظایف شما.',
            '<strong>همگام‌سازی زمان</strong> با سرورهای عمومی (timeapi.io، worldclockapi.com) فقط برای اصلاح ساعت دستگاه است و هیچ اطلاعاتی ارسال نمی‌کند.',
            '<strong>پیش‌بینی هوا</strong> از Open-Meteo دریافت می‌شود و فقط مختصات مکان و تاریخ درخواست را می‌فرستد. هیچ اطلاعاتی از وظایف شما ارسال نمی‌شود.',
            '<strong>نام مکان</strong> با Nominatim (OpenStreetMap) دریافت می‌شود؛ فقط مختصات ارسال می‌شود و نام شهر برگردانده می‌شود.',
            '<strong>پشتیبان‌گیری:</strong> چون داده‌ها فقط روی دستگاه شماست، توصیه می‌شود از قابلیت Export (به‌زودی) یا پشتیبان‌گیری از مرورگر خود استفاده کنید.',
            'برای پاک کردن کامل داده‌ها، از سطل زباله استفاده کنید یا داده‌های سایت را از تنظیمات مرورگر حذف کنید.'
        ],
        buttonText: 'فهمیدم'
    });
    if (window.matchMedia('(min-width: 901px)').matches) {
        const ti = document.getElementById('taskInput');
        if (ti) ti.focus({ preventScroll: true });
    }
});

/* ---------- Theme (حالت نمایش) و Lang (زبان) ---------- */

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
    const icons = { auto: '🖥', dark: '🌙', light: '☀️' };
    const titles = { auto: 'حالت نمایش: خودکار', dark: 'حالت نمایش: تاریک', light: 'حالت نمایش: روشن' };
    btn.textContent = `${icons[state.prefs.theme] || icons.auto} ${state.prefs.theme === 'dark' ? 'تاریک' : state.prefs.theme === 'light' ? 'روشن' : 'خودکار'}`;
    btn.title = titles[state.prefs.theme] || titles.auto;
}

function updateLangBtn() {
    const btn = document.getElementById('langBtn');
    if (!btn) return;
    btn.textContent = state.prefs.lang === 'en' ? '🌐 EN' : '🌐 FA';
    btn.title = state.prefs.lang === 'en' ? 'Switch to Persian' : 'تغییر زبان به انگلیسی';
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
        langGroup.querySelectorAll('[data-lang]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.lang === state.prefs.lang);
        });
    }
}

function applyDisplaySettings() {
  applyTheme(state.prefs.theme);
  const dir = state.prefs.lang === 'en' ? 'ltr' : 'rtl';
  document.documentElement.setAttribute('data-lang', state.prefs.lang);
  document.documentElement.setAttribute('lang', state.prefs.lang);
  document.documentElement.setAttribute('dir', dir);
  document.querySelector('.app-shell')?.setAttribute('dir', dir);
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
    langBtnEl.addEventListener('click', () => {
        state.prefs.lang = state.prefs.lang === 'en' ? 'fa' : 'en';
        savePrefs();
        applyDisplaySettings();
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
    _welcomeLangGroup.addEventListener('click', e => {
        const btn = e.target.closest('[data-lang]');
        if (!btn) return;
        state.prefs.lang = btn.dataset.lang;
        savePrefs();
        applyDisplaySettings();
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

/* ---------- پایان بخش Theme/Lang ---------- */

document.getElementById('mapToggle').addEventListener('click', () => {
    state.prefs.mapVisible = !state.prefs.mapVisible;
    savePrefs();
    applyMapVisibility();
    if (state.prefs.mapVisible) initMap();
});

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
    const snd = document.getElementById('setSoundOn');
    if (snd) {
        snd.checked = state.prefs.soundOn !== false;
        snd.addEventListener('change', () => { state.prefs.soundOn = snd.checked; savePrefs(); });
    }
  initSystemPermissions();
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
    setPermissionStatus('permissionNotifStatus', notification === 'granted' ? 'فعال است' : notification === 'denied' ? 'مسدود شده' : notification === 'default' ? 'فعال نیست' : 'پشتیبانی نمی‌شود');
    const location = await queryPermission('geolocation');
    setPermissionStatus('permissionLocationStatus', location ? (location.state === 'granted' ? 'فعال است' : location.state === 'denied' ? 'مسدود شده' : 'فعال نیست') : 'برای بررسی تست کنید');
    const microphone = await queryPermission('microphone');
    setPermissionStatus('permissionMicStatus', microphone ? (microphone.state === 'granted' ? 'فعال است' : microphone.state === 'denied' ? 'مسدود شده' : 'فعال نیست') : 'برای بررسی تست کنید');
}

async function requestLocationPermission() {
    if (!navigator.geolocation) return setPermissionStatus('permissionLocationStatus', 'پشتیبانی نمی‌شود');
    navigator.geolocation.getCurrentPosition(() => setPermissionStatus('permissionLocationStatus', 'فعال است'), error => setPermissionStatus('permissionLocationStatus', error.code === 1 ? 'مسدود شده' : 'فعال نیست'), { timeout: 8000, maximumAge: 0 });
}

async function requestMicrophonePermission() {
    if (!navigator.mediaDevices?.getUserMedia) return setPermissionStatus('permissionMicStatus', 'پشتیبانی نمی‌شود');
    try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.getTracks().forEach(track => track.stop()); setPermissionStatus('permissionMicStatus', 'فعال است'); }
    catch (error) { setPermissionStatus('permissionMicStatus', error.name === 'NotAllowedError' ? 'مسدود شده' : 'فعال نیست'); }
}

function initSystemPermissions() {
    inspectSystemPermissions();
    document.getElementById('permissionNotifBtn')?.addEventListener('click', async () => { await ensureNotifPerm(); inspectSystemPermissions(); });
    document.getElementById('permissionNotifTestBtn')?.addEventListener('click', async () => { if (await ensureNotifPerm()) fireNotification('اعلان آزمایشی', 'مجوز اعلان فعال است.'); inspectSystemPermissions(); });
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

// PWA: نصب به‌عنوان اپلیکیشن
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
        title: 'خالی کردن سطل زباله',
        message: 'همه موارد سطل زباله برای همیشه حذف شوند؟ این عمل قابل بازگشت نیست.',
        confirmText: 'خالی کن',
        cancelText: 'انصراف',
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
            title: 'حذف همیشگی',
            message: 'این مورد برای همیشه حذف شود؟ این عمل قابل بازگشت نیست.',
            confirmText: 'حذف کن',
            cancelText: 'انصراف',
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

// مدیریت متمرکز Escape
document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;

    if (settingsModal && !settingsModal.hidden) { toggleSettings(false); return; }

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
            mapHint('مکانی برای این مورد ثبت نشده است');
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
        else if (!getMapReady()) mapHint('نقشه در دسترس نیست (آفلاین؟)');
        else {
            state.relocateTaskId = id;
            switchToTab('map');
            document.getElementById('panelMap').scrollIntoView({ behavior: 'smooth' });
            mapHint('روی نقشه کلیک کنید تا محل ثبت شود');
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

// ورود صوتی: مستقل از mobile و محدود به ورودی‌های متنی آزاد
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
        rec.lang = state.prefs.lang === 'en' ? 'en-US' : 'fa-IR';
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

// میان‌برهای کیبورد
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

// مرتب‌سازی دستی با درگ
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

// ═══════════════════════════════════════════════════════════════════════════
// پیشنهاد هوشمند تاریخ
// ═══════════════════════════════════════════════════════════════════════════

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

    const iso = parseFaDateTime(v, getNow());
    if (!iso) return;

    if (state.addDraftSessions.some(s => Math.abs(new Date(s.at).getTime() - new Date(iso).getTime()) < 60000)) return;

    smartTargetId = targetId;
    const sourceLabel = targetId === 'descInput' ? 'توضیح' : 'عنوان';
    document.getElementById('smartChipText').textContent = `📅 پیشنهاد از ${sourceLabel}: ${faShort(iso)}`;
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

// پر کردن انتخاب‌های ساعت و دقیقه
(function initTimeSelects() {
    const hourSel = document.getElementById('pickerHour');
    const minSel = document.getElementById('pickerMinute');
    for (let h = 0; h < 24; h++) {
        const o = document.createElement('option');
        o.value = String(h).padStart(2, '0');
        o.textContent = toFa(h);
        hourSel.appendChild(o);
    }
    for (let m = 0; m < 60; m += 5) {
        const o = document.createElement('option');
        o.value = String(m).padStart(2, '0');
        o.textContent = toFa(m);
        minSel.appendChild(o);
    }
})();

// تاریخ امروز شمسی در هدر + سال کپی‌رایت فوتر
try {
    document.getElementById('todayLine').textContent =
        'امروز: ' + new Date().toLocaleDateString('fa-IR', { weekday: 'long', day: 'numeric', month: 'long' });
    document.getElementById('copyYear').textContent =
        new Date().toLocaleDateString('fa-IR', { year: 'numeric' });
} catch { /* نادیده */ }

// ═══════════════════════════════════════════════════════════════════════════
// Boot
// ═══════════════════════════════════════════════════════════════════════════

bindDetailInputs();
loadPrefs();
(function initDueHome() {
    const dc = document.getElementById('dueChips');
    if (dc) {
        _dueHome.p = dc.parentElement;
        _dueHome.n = dc.nextElementSibling;
    }
})();
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
initSettings();
applyMapVisibility();
applyDisplaySettings();
applyProMode();

attachSmartSuggest(input, 'taskInput');
attachSmartSuggest(document.getElementById('descInput'), 'descInput');

loadTasks().then(async () => {
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
});

// ═══════════════════════════════════════════════════════════════════════════
// Debug-only global (در build نهایی حذف می‌شود)
// ═══════════════════════════════════════════════════════════════════════════
if (import.meta.env.DEV) {
    window.TodoApp = {
        getState: () => state,
        findTask,
        saveTasks,
        render
    };
}