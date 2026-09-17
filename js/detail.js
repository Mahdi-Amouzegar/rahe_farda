// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// detail.js -- detail page (ESM)

import { state, toFa, uid, escapeHtml, debounce, showConfirmModal, MAX_LENGTH } from './core.js';
import { getNow } from './time.js';
import { findTask, saveTasks, moveToTrashById, sanitizeUrl } from './store.js';
import { faShort, hasSessionAt, parseFaDateTime } from './sessions.js';
import {
    ensureMapVisible,
    switchToTab,
    mapHint,
    flyToTask,
    refreshMarkers,
    removePickMarker
} from './map.js';
import { openPicker } from './picker.js';

// ═══════════════════════════════════════════════════════════════════════════
// Local state
// ═══════════════════════════════════════════════════════════════════════════

let timerTick = null;
let saveHintTimer = null;

// smart suggest state (مخصوص صفحه‌ی جزئیات)
let detailSmartTimer = null;
let detailSmartDismissedFor = { fTitle: '', fDesc: '' };
let detailSmartTargetId = null;

// callback registry برای توابعی که نمی‌توانیم import کنیم (circular)
const _callbacks = {
    render: null,
    refreshSavedLocationUI: null,
    showUndoFor: null,
    showMobilePickBanner: null,
    hideMobilePickBanner: null,
    showRouteTo: null,
};

export function registerDetailCallbacks(cbs) {
    Object.assign(_callbacks, cbs);
}

function call(name, ...args) {
    const fn = _callbacks[name];
    if (typeof fn === 'function') return fn(...args);
    return undefined;
}

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
    hint.textContent = msg || '✓ ذخیره شد';
    hint.classList.add('show');
    clearTimeout(saveHintTimer);
    saveHintTimer = setTimeout(() => hint.classList.remove('show'), 1500);
}

function formatDateShort(iso) {
    if (!iso) return '';
    try {
        const d = new Date(iso);
        if (isNaN(d)) return '';
        return d.toLocaleDateString('fa-IR', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch {
        return '';
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Smart suggest تاریخ (در صفحه‌ی جزئیات)
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
    const sourceLabel = targetId === 'fDesc' ? 'توضیح' : 'عنوان';
    const textEl = document.getElementById('detailSmartChipText');
    if (textEl) textEl.textContent = `📅 پیشنهاد از ${sourceLabel}: ${faShort(iso)}`;
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
            flashSaved('سررسید اضافه شد');
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

    // فقط برای برنامه نمایش داده شود
    if (task.kind !== 'plan') {
        section.style.display = 'none';
        return;
    }
    section.style.display = '';

    const line = document.getElementById('detailPlanDatesLine');
    const startBtn = document.getElementById('detailPlanStartBtn');
    const endBtn = document.getElementById('detailPlanEndBtn');
    const clearBtn = document.getElementById('detailPlanDatesClear');

    if (startBtn) startBtn.textContent = task.startAt ? `📅 شروع: ${formatDateShort(task.startAt)}` : '📅 تاریخ شروع';
    if (endBtn) endBtn.textContent = task.endAt ? `📅 پایان: ${formatDateShort(task.endAt)}` : '📅 تاریخ پایان';

    if (line) {
        const parts = [];
        if (task.startAt && task.endAt) parts.push(`از ${formatDateShort(task.startAt)} تا ${formatDateShort(task.endAt)}`);
        else if (task.startAt) parts.push(`از ${formatDateShort(task.startAt)}`);
        else if (task.endAt) parts.push(`تا ${formatDateShort(task.endAt)}`);
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

    // ریست smart suggest برای این وظیفه
    resetDetailSmart();

    document.getElementById('detailTitle').textContent = (task.kind === 'plan' ? '📁 ' : '') + task.text;
    document.getElementById('fTitle').value = task.text;
    // حالا location برای برنامه هم نمایش داده می‌شود
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
    renderDetailPhotos();
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
}

export function closeDetail() {
    if (typeof debouncedSaveTitle !== 'undefined') debouncedSaveTitle.flush();
    if (typeof debouncedSaveDesc !== 'undefined') debouncedSaveDesc.flush();
    if (typeof debouncedSavePhone !== 'undefined') debouncedSavePhone.flush();
    if (typeof debouncedSaveAddr !== 'undefined') debouncedSaveAddr.flush();
    if (typeof debouncedSaveUrl !== 'undefined') debouncedSaveUrl.flush();

    state.currentDetailId = null;
    clearInterval(timerTick);
    document.getElementById('detailPage').style.display = 'none';
    document.body.style.overflow = '';
    call('hideMobilePickBanner');
    call('render');
}

// ورود به حالت انتخاب مکان بدون بستن صفحه جزئیات
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

        mapHint('روی نقشه کلیک کنید تا محل جدید ثبت شود');
        call('showMobilePickBanner', 'روی نقشه ضربه بزنید تا محل جدید ثبت شود. برای انصراف، دکمه لغو را بزنید.');
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
    if (countEl) countEl.textContent = list.length > 0 ? `(${toFa(list.length)})` : '';
    const el = document.getElementById('sessList');
    if (!el) return;
    if (list.length === 0) {
        el.innerHTML = '<div class="session-empty">هنوز جلسه‌ای ثبت نشده است.</div>';
        return;
    }
    const now = getNow().getTime();
    el.innerHTML = list.map((s, i) => {
        const past = new Date(s.at).getTime() < now;
        const sessionLoc = s.location || task.location;
        const weatherBtn = !past && sessionLoc
            ? `<button type="button" class="weather-icon-btn" data-weather-task="${escapeHtml(String(task.id))}" data-weather-session="${escapeHtml(String(s.id))}" aria-label="پیش‌بینی هوا" title="پیش‌بینی هوا">🌡️</button>`
            : '';
        return `<div class="session-item ${past ? 'past' : ''}">
            <span class="session-num">${toFa(i + 1)}</span>
            <span class="session-date">📅 ${faShort(s.at)}${past ? ' (گذشته)' : ''} ${weatherBtn}</span>
            <select class="sess-remind" data-sess-rem="${escapeHtml(String(s.id))}" aria-label="یادآور این جلسه">
                <option value=""${s.remindMin == null ? ' selected' : ''}>⏰ پیش‌فرض</option>
                <option value="5"${s.remindMin === 5 ? ' selected' : ''}>۵ دقیقه</option>
                <option value="15"${s.remindMin === 15 ? ' selected' : ''}>۱۵ دقیقه</option>
                <option value="30"${s.remindMin === 30 ? ' selected' : ''}>۳۰ دقیقه</option>
                <option value="60"${s.remindMin === 60 ? ' selected' : ''}>۱ ساعت</option>
                <option value="180"${s.remindMin === 180 ? ' selected' : ''}>۳ ساعت</option>
                <option value="1440"${s.remindMin === 1440 ? ' selected' : ''}>۱ روز</option>
                <option value="0"${s.remindMin === 0 ? ' selected' : ''}>خاموش</option>
            </select>
            <button class="btn-icon btn-detail ${s.location ? 'has-loc' : ''}" data-sess-loc="${escapeHtml(String(s.id))}" aria-label="ثبت محل جلسه">📍</button>
            <button class="btn-icon btn-delete" data-sess="${escapeHtml(String(s.id))}" aria-label="حذف جلسه ${toFa(i + 1)}">✕</button>
        </div>`;
    }).join('');
}

// ═══════════════════════════════════════════════════════════════════════════
// Photos
// ═══════════════════════════════════════════════════════════════════════════

function downscale(dataUrl, maxDim, quality, cb) {
    const img = new Image();
    img.onload = () => {
        try {
            const r = Math.min(1, maxDim / Math.max(img.width, img.height));
            const c = document.createElement('canvas');
            c.width = Math.max(1, Math.round(img.width * r));
            c.height = Math.max(1, Math.round(img.height * r));
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            cb(c.toDataURL('image/jpeg', quality));
        } catch {
            cb(null);
        }
    };
    img.onerror = () => cb(null);
    img.src = dataUrl;
}

function renderDetailPhotos() {
    const task = getDetailTask();
    if (!task) return;
    const list = task.photos || [];
    const countEl = document.getElementById('photoCount');
    if (countEl) countEl.textContent = list.length ? `(${toFa(list.length)})` : '';
    const grid = document.getElementById('photoGrid');
    if (!grid) return;
    grid.innerHTML = list.length ? list.map(p => `
        <div class="photo-thumb">
            <img src="${p.dataUrl}" data-photo-view="${escapeHtml(String(p.id))}" alt="تصویر وظیفه" loading="lazy">
            <button data-photo-del="${escapeHtml(String(p.id))}" aria-label="حذف عکس">✕</button>
        </div>`).join('') : '<div class="session-empty">عکسی ثبت نشده است.</div>';
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
    if (h > 0) return `${toFa(h)} ساعت و ${toFa(m)} دقیقه`;
    if (m > 0) return `${toFa(m)} دقیقه`;
    return `${toFa(s)} ثانیه`;
}

function renderTimer() {
    const task = getDetailTask();
    if (!task) return;
    const labelEl = document.getElementById('timerLabel');
    if (labelEl) labelEl.textContent = faDuration(currentSpent(task));
    const toggleEl = document.getElementById('timerToggle');
    if (toggleEl) toggleEl.textContent = task.timerStartedAt ? '⏸ توقف' : '▶ شروع';
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

const WEEK_ORDER = [['شنبه', 6], ['یکشنبه', 0], ['دوشنبه', 1], ['سه‌شنبه', 2], ['چهارشنبه', 3], ['پنجشنبه', 4], ['جمعه', 5]];

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
    if (nLabel) nLabel.textContent = r === 'hourly' ? 'هر چند ساعت؟' : 'هر چند روز؟';

    const nInp = document.getElementById('fRecurN');
    if (nInp) nInp.max = r === 'hourly' ? 168 : 365;

    const wc = document.getElementById('fRecurWeekChips');
    if (wc) wc.innerHTML = WEEK_ORDER.map(([name, v]) => `<button type="button" class="day-chip${(task.recurDays || []).includes(v) ? ' on' : ''}" data-wday="${v}">${name}</button>`).join('');

    const mc = document.getElementById('fRecurMonthChips');
    if (mc) {
        let mhtml = '';
        for (let d = 1; d <= 31; d++) mhtml += `<button type="button" class="day-chip${(task.recurDays || []).includes(d) ? ' on' : ''}" data-mday="${d}">${toFa(d)}</button>`;
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
    document.getElementById('detailTitle').textContent = task.text || 'بدون عنوان';
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

// ═══════════════════════════════════════════════════════════════════════════
// Bind inputs
// ═══════════════════════════════════════════════════════════════════════════

export function bindDetailInputs() {
    document.getElementById('fTitle').addEventListener('input', e => {
        const v = e.target.value.trim().replace(/\s+/g, ' ');
        if (!v) {
            flashSaved('عنوان نمی‌تواند خالی باشد');
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
            err.textContent = 'شماره تلفن معتبر نیست';
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
                flashSaved('این سررسید قبلاً ثبت شده است.');
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
            mapHint('روی نقشه کلیک کنید تا محل جلسه ثبت شود');
            call('showMobilePickBanner', 'روی نقشه ضربه بزنید تا محل جلسه ثبت شود. برای انصراف، دکمه لغو را بزنید.');
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
        flashSaved('جلسه حذف شد');
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
        flashSaved('محل حذف شد');
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
        flashSaved(ok ? 'پیوند کپی شد ✓' : 'کپی نشد');
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
            warn = 'فقط نزدیک‌ترین سررسید نگه داشته شد؛ بقیه حذف شدند';
        }
        if (task.recur === 'hourly' && !(task.recurN >= 1 && task.recurN <= 168)) task.recurN = 8;
        if (task.recur === 'custom') {
            const n = parseInt(document.getElementById('fRecurN').value, 10);
            if (n >= 1 && n <= 365) task.recurN = n;
            else {
                task.recur = 'none';
                e.target.value = 'none';
                warn = 'عدد روزهای تکرار (۱ تا ۳۶۵) را وارد کنید';
            }
        }
        if ((task.recur === 'weeklyDays' || task.recur === 'monthlyDays') && !(task.recurDays || []).length) {
            warn += (warn ? ' — ' : '') + 'حداقل یک روز انتخاب کنید';
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
            flashSaved(`عدد بین ۱ تا ${toFa(maxN)}`);
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
                // اگر endAt قبل از startAt جدید بود، null شود
                if (t.endAt && new Date(t.endAt) < new Date(iso)) t.endAt = null;
                saveTasks();
                renderPlanDates();
                call('render');
                flashSaved('تاریخ شروع ثبت شد');
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
                flashSaved('تاریخ پایان ثبت شد');
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
            flashSaved('تاریخ‌ها حذف شدند');
        });
    }

    const photoInput = document.getElementById('photoInput');
    photoInput.addEventListener('change', () => {
        const task = getDetailTask();
        if (!task) { photoInput.value = ''; return; }
        task.photos = task.photos || [];
        const files = [...photoInput.files].slice(0, Math.max(0, 8 - task.photos.length));
        photoInput.value = '';
        if (!files.length) {
            flashSaved(task.photos.length >= 8 ? 'سقف ۸ عکس' : 'فایلی انتخاب نشد');
            return;
        }
        let pending = files.length;
        const doneOne = () => {
            if (--pending !== 0) return;
            saveTasks();
            renderDetailPhotos();
            call('render');
            flashSaved();
        };
        files.forEach(f => {
            if (!f.type.startsWith('image/')) return doneOne();
            const rd = new FileReader();
            rd.onload = () => downscale(rd.result, 1024, 0.72, url => {
                if (url) task.photos.push({ id: uid(), dataUrl: url, addedAt: new Date().toISOString() });
                doneOne();
            });
            rd.onerror = doneOne;
            rd.readAsDataURL(f);
        });
    });
    document.getElementById('photoGrid').addEventListener('click', e => {
        const del = e.target.closest('[data-photo-del]');
        if (del) {
            const task = getDetailTask();
            if (!task) return;
            task.photos = (task.photos || []).filter(p => String(p.id) !== del.dataset.photoDel);
            saveTasks();
            renderDetailPhotos();
            call('render');
            flashSaved('عکس حذف شد');
            return;
        }
        const img = e.target.closest('[data-photo-view]');
        if (img) {
            document.getElementById('lightboxImg').src = img.src;
            document.getElementById('lightbox').style.display = 'flex';
        }
    });
    document.getElementById('lightbox').addEventListener('click', () => {
        document.getElementById('lightbox').style.display = 'none';
        document.getElementById('lightboxImg').removeAttribute('src');
    });
    document.getElementById('timerToggle').addEventListener('click', toggleTimer);
    document.getElementById('detailBack').addEventListener('click', closeDetail);
    document.getElementById('detailDelete').addEventListener('click', async () => {
        const task = getDetailTask();
        if (!task) return;
        const ok = await showConfirmModal({
            title: 'حذف وظیفه',
            message: `«${task.text}» به سطل زباله منتقل شود؟`,
            confirmText: 'بله، منتقل کن',
            cancelText: 'انصراف',
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
// ⚠️ گام ۱۵: SHIM‌ها حذف شدند
// ═══════════════════════════════════════════════════════════════════════════