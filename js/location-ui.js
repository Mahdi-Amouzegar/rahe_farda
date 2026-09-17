// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// location-ui.js -- saved locations: local IndexedDB + human-readable labels (ESM)

import { state, toFa, escapeHtml, uid, trapFocus, showConfirmModal } from './core.js';
import { findTask, saveTasks } from './store.js';
import {
    mapHint,
    ensureMapVisible,
    switchToTab,
    refreshMarkers,
    showPickMarker,
    getMap,
    getMapReady
} from './map.js';
import { openDetail } from './detail.js';

// ═══════════════════════════════════════════════════════════════════════════
// Constants & local state
// ═══════════════════════════════════════════════════════════════════════════

const DB_NAME = 'spaceTodoLocationsDB';
const STORE = 'locations';
const MAX_SAVED_LOCATIONS = 200;

let dbPromise = null;
let locations = [];
let pendingRelocateId = null;
let pendingNewLocationFromMap = false;
let mobileBannerTimer = null;
let mapRelocateBoundTo = null;
let newFromMapBoundTo = null;
let _savedLocTrapCleanup = null;

// callback registry برای توابعی که نمی‌توانیم import کنیم (circular)
const _callbacks = {
    render: null,
};

export function registerLocationCallbacks(cbs) {
    Object.assign(_callbacks, cbs);
}

function call(name, ...args) {
    const fn = _callbacks[name];
    if (typeof fn === 'function') return fn(...args);
    return undefined;
}

// ═══════════════════════════════════════════════════════════════════════════
// IndexedDB
// ═══════════════════════════════════════════════════════════════════════════

function openDb() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('no-indexeddb'));
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    db.createObjectStore(STORE, { keyPath: 'id' });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }
    return dbPromise;
}

function getAll() {
    return openDb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    }));
}

function put(item) {
    return openDb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(item);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    }));
}

function remove(id) {
    return openDb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    }));
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function normalize(loc) {
    if (!loc || !Number.isFinite(+loc.lat) || !Number.isFinite(+loc.lng)) return null;
    return { lat: +(+loc.lat).toFixed(5), lng: +(+loc.lng).toFixed(5) };
}

function same(a, b) {
    return a && b && Math.abs(+a.lat - +b.lat) < 0.000005 && Math.abs(+a.lng - +b.lng) < 0.000005;
}

function savedFor(loc) {
    const n = normalize(loc);
    return n ? (locations.find(x => same(x, n)) || null) : null;
}

function hasNameConflict(name, excludeLoc) {
    const clean = String(name || '').trim().replace(/\s+/g, ' ');
    if (!clean) return null;
    const lower = clean.toLowerCase();
    return locations.find(x => {
        if (excludeLoc && String(x.id) === String(excludeLoc.id)) return false;
        return String(x.name || '').trim().replace(/\s+/g, ' ').toLowerCase() === lower;
    }) || null;
}

function coords(loc) {
    const n = normalize(loc);
    if (!n) return '';
    const a = n.lat.toFixed(5), b = n.lng.toFixed(5);
    return `${toFa(a)}، ${toFa(b)}`;
}

/**
 * نام نمایشی مکان بر اساس زبان فعلی
 * اولویت: mکان ذخیره‌شده → نام ذخیره‌شده → مختصات
 */
function label(loc) {
    if (!loc) return '';
    const saved = savedFor(loc);
    if (saved) {
        if (saved.names) {
            const lang = state.prefs.lang === 'en' ? 'en' : 'fa';
            const preferred = saved.names[lang] || saved.names.fa || saved.names.en;
            if (preferred) return preferred;
        }
        if (saved.name) return saved.name;
    }
    // مکان ذخیره نشده → مختصات
    const n = normalize(loc);
    return n ? coords(n) : '';
}

/**
 * نمایش با آیکن مناسب — فقط مکان‌های ذخیره‌شده نام نمایش می‌دهند
 */
function displayFor(loc) {
    if (!loc) return { icon: '📍', name: '', cls: 'location-display-coords', isSaved: false };
    const n = normalize(loc);
    if (!n) return { icon: '📍', name: '', cls: 'location-display-coords', isSaved: false };

    // ⚠️ فقط اگر در لیست مکان‌های ذخیره‌شده باشد، نام نمایش داده می‌شود
    const saved = savedFor(n);
    if (saved) {
        let name = saved.name;
        if (saved.names) {
            const lang = state.prefs.lang === 'en' ? 'en' : 'fa';
            name = saved.names[lang] || saved.names.fa || saved.names.en || saved.name;
        }
        return { icon: '📌', name, cls: 'location-display-name', isSaved: true };
    }

    // مکان ذخیره نشده → فقط مختصات
    return { icon: '📍', name: coords(n), cls: 'location-display-coords', isSaved: false };
}

// ═══════════════════════════════════════════════════════════════════════════
// مودال دریافت نام
// ═══════════════════════════════════════════════════════════════════════════

function askLocationName(defaultValue) {
    return new Promise(resolve => {
        const overlay = document.getElementById('namePromptModal');
        const input = document.getElementById('namePromptInput');
        const err = document.getElementById('namePromptError');
        const title = document.getElementById('namePromptTitle');
        const confirmBtn = document.getElementById('namePromptConfirm');
        const cancelBtn = document.getElementById('namePromptCancel');
        if (!overlay || !input || !confirmBtn || !cancelBtn) {
            const v = window.prompt('نام این مکان را وارد کنید:', defaultValue || '');
            resolve(v === null ? null : String(v).trim() || null);
            return;
        }
        overlay.classList.add('picker-overlay--stacked');
        input.value = defaultValue || '';
        err.textContent = '';
        title.textContent = defaultValue ? '✏️ تغییر نام مکان' : '📌 نام این مکان';
        overlay.style.display = 'flex';

        let trapCleanup = null;
        if (typeof trapFocus === 'function') {
            trapCleanup = trapFocus(overlay);
        }
        setTimeout(() => { input.focus(); input.select(); }, 60);

        const cleanup = () => {
            overlay.style.display = 'none';
            overlay.classList.remove('picker-overlay--stacked');
            confirmBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            input.removeEventListener('keydown', onKey);
            overlay.removeEventListener('click', onOverlay);
            if (trapCleanup) {
                try { trapCleanup(); } catch { /* silent */ }
                trapCleanup = null;
            }
        };
        const finish = value => {
            try {
                cleanup();
            } finally {
                resolve(value);
            }
        };
        const submit = () => {
            const v = input.value.trim().replace(/\s+/g, ' ').slice(0, 80);
            if (!v) {
                input.classList.remove('input-error');
                void input.offsetWidth;
                input.classList.add('input-error');
                err.textContent = 'نام نمی‌تواند خالی باشد.';
                input.focus();
                return;
            }
            finish(v);
        };
        const onOk = () => submit();
        const onCancel = () => finish(null);
        const onKey = e => {
            if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); submit(); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); }
        };
        const onOverlay = e => { if (e.target === overlay) finish(null); };

        confirmBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        input.addEventListener('keydown', onKey);
        overlay.addEventListener('click', onOverlay);
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// مودال تعارض نام
// ═══════════════════════════════════════════════════════════════════════════

function askConflictResolution(name, conflict) {
    return new Promise(resolve => {
        const overlay = document.getElementById('nameConflictModal');
        const text = document.getElementById('nameConflictText');
        const replaceBtn = document.getElementById('nameConflictReplace');
        const renameBtn = document.getElementById('nameConflictPickAnother');
        const cancelBtn = document.getElementById('nameConflictCancel');
        if (!overlay || !replaceBtn || !renameBtn || !cancelBtn) {
            const ok = window.confirm(
                `نام «${name}» قبلاً برای مکان دیگری ذخیره شده است.\n` +
                `تأیید = جایگزینی نام مکان قبلی\n` +
                `لغو = انتخاب نام دیگر`
            );
            resolve(ok ? 'replace' : 'rename');
            return;
        }
        if (text) {
            text.textContent = `نام «${name}» قبلاً برای مکان دیگری (${coords(conflict)}) ذخیره شده است. ` +
                `وظایف قبلی که این نام را دارند، نام خود را حفظ می‌کنند.`;
        }
        overlay.classList.add('picker-overlay--stacked');
        overlay.style.display = 'flex';

        let trapCleanup = null;
        if (typeof trapFocus === 'function') {
            trapCleanup = trapFocus(overlay);
        }
        setTimeout(() => replaceBtn.focus(), 60);

        const cleanup = () => {
            overlay.style.display = 'none';
            overlay.classList.remove('picker-overlay--stacked');
            replaceBtn.removeEventListener('click', onReplace);
            renameBtn.removeEventListener('click', onRename);
            cancelBtn.removeEventListener('click', onCancel);
            overlay.removeEventListener('click', onOverlay);
            if (trapCleanup) {
                try { trapCleanup(); } catch { /* silent */ }
                trapCleanup = null;
            }
        };
        const finish = value => {
            try {
                cleanup();
            } finally {
                resolve(value);
            }
        };
        const onReplace = () => finish('replace');
        const onRename = () => finish('rename');
        const onCancel = () => finish(null);
        const onOverlay = e => { if (e.target === overlay) finish(null); };

        replaceBtn.addEventListener('click', onReplace);
        renameBtn.addEventListener('click', onRename);
        cancelBtn.addEventListener('click', onCancel);
        overlay.addEventListener('click', onOverlay);
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// نمایش‌ها
// ═══════════════════════════════════════════════════════════════════════════

function renderAdd() {
    const chip = document.getElementById('locChip');
    const text = document.getElementById('locChipText');
    if (!chip || !text) return;
    if (!state.pendingLoc) { chip.style.display = 'none'; return; }
    chip.style.display = '';
    const d = displayFor(state.pendingLoc);
    const html = `<span class="location-display"><span>${d.icon}</span><span class="${d.cls}">${escapeHtml(d.name)}</span></span>`;
    if (text.innerHTML !== html) text.innerHTML = html;
    let actions = chip.querySelector('.loc-chip-actions');
    if (!actions) { actions = document.createElement('span'); actions.className = 'loc-chip-actions'; chip.appendChild(actions); }
    // دکمه «ذخیره نام» یا «تغییر نام» — همیشه نمایش داده می‌شود
    const label = d.isSaved ? '✏️ تغییر نام' : '📌 ذخیره نام';
    const ah = `<button type="button" class="loc-chip-save" data-save-pending-location>${label}</button>`;
    if (actions.innerHTML !== ah) actions.innerHTML = ah;
}

function renderDetail() {
    const line = document.getElementById('detailLocLine');
    if (!line) return;
    const found = findTask(state.currentDetailId);
    const task = found ? found.task : null;
    if (!task) return;

    const showBtn = document.getElementById('detailLocShow');
    const routeBtn = document.getElementById('detailLocRoute');
    const changeBtn = document.getElementById('detailLocChange');
    const removeBtn = document.getElementById('detailLocRemove');
    const host = changeBtn ? changeBtn.parentElement : line.parentElement;
    if (!host) return;

    // حذف دکمه‌ی قدیمی (اگر وجود دارد)
    const staleSave = line.querySelector('[data-save-detail-location]') || host.querySelector('[data-save-detail-location]');
    if (staleSave) staleSave.remove();

    if (!task.location) {
        const html = `<span class="location-display"><span>📍</span><span>محلی ثبت نشده است.</span></span>`;
        if (line.innerHTML !== html) line.innerHTML = html;

        if (showBtn) showBtn.style.display = 'none';
        if (routeBtn) routeBtn.style.display = 'none';
        if (removeBtn) removeBtn.style.display = 'none';
        if (changeBtn) {
            changeBtn.textContent = '＋ ثبت محل';
            changeBtn.style.display = '';
        }
        return;
    }

    const d = displayFor(task.location);

    const html = `<span class="location-display"><span>${d.icon}</span><span class="${d.cls}">${escapeHtml(d.name)}</span></span>`;
    if (line.innerHTML !== html) line.innerHTML = html;

    if (showBtn) showBtn.style.display = '';
    if (routeBtn) routeBtn.style.display = '';
    if (removeBtn) removeBtn.style.display = '';
    if (changeBtn) {
        changeBtn.textContent = 'تغییر محل';
        changeBtn.style.display = '';
    }

    // دکمه «ذخیره نام» یا «تغییر نام» — همیشه نمایش داده می‌شود
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'location-save-btn';
    save.dataset.saveDetailLocation = '';
    save.textContent = d.isSaved ? '✏️ تغییر نام' : '📌 ذخیره نام مکان';
    save.setAttribute('aria-label', 'ذخیره یا تغییر نام این مکان');
    line.appendChild(save);
}

function ensureList() {
    const panel = document.getElementById('panelMap');
    if (!panel) return null;
    let box = document.getElementById('savedLocations');
    if (box) return box;
    box = document.createElement('div');
    box.id = 'savedLocations';
    box.className = 'saved-locations';
    box.innerHTML = `
        <button type="button" class="saved-locations-manage" id="savedLocationsManage" aria-label="مدیریت مکان‌های ذخیره‌شده">
            📌 مکان‌های ذخیره‌شده
            <span class="saved-locations-count" id="savedLocationsCount"></span>
            <span class="saved-locations-chevron" aria-hidden="true">‹</span>
        </button>
        <div class="saved-locations-list"></div>
    `;
    const note = panel.querySelector('.map-note');
    if (note) panel.insertBefore(box, note); else panel.appendChild(box);
    return box;
}

function renderList() {
    const box = ensureList();
    if (!box) return;
    const list = box.querySelector('.saved-locations-list');
    if (!list) return;
    const countEl = box.querySelector('#savedLocationsCount');
    if (countEl) countEl.textContent = locations.length ? `(${toFa(locations.length)}/${toFa(MAX_SAVED_LOCATIONS)})` : '';
    const sorted = [...locations].sort((a, b) => a.name.localeCompare(b.name, 'fa'));
    const html = sorted.length
        ? sorted.map(x => `<button type="button" class="saved-location-chip" data-saved-location="${escapeHtml(String(x.id))}" title="${escapeHtml(coords(x))}">${escapeHtml(x.name)}</button>`).join('')
        : '<span class="saved-locations-empty">هنوز مکانی ذخیره نشده است.</span>';
    if (list.innerHTML !== html) list.innerHTML = html;
}

function renderManageList() {
    const body = document.getElementById('savedLocationsBody');
    if (!body) return;
    const modalCount = document.getElementById('savedLocationsModalCount');
    if (modalCount) modalCount.textContent = locations.length ? `(${toFa(locations.length)}/${toFa(MAX_SAVED_LOCATIONS)})` : '';
    const sorted = [...locations].sort((a, b) => a.name.localeCompare(b.name, 'fa'));
    if (!sorted.length) {
        body.innerHTML = '<div class="session-empty">هنوز مکانی ذخیره نشده است.</div>';
        return;
    }
    body.innerHTML = `<div class="saved-locations-body">${sorted.map(x => `
        <div class="saved-locations-row" data-id="${escapeHtml(String(x.id))}">
            <div class="slr-info">
                <div class="slr-name">${escapeHtml(x.name)}</div>
                <div class="slr-coords">${escapeHtml(coords(x))}</div>
            </div>
            <div class="slr-actions">
                <button type="button" data-slr-rename title="تغییر نام" aria-label="تغییر نام">✏️</button>
                <button type="button" data-slr-move title="تغییر مکان روی نقشه" aria-label="تغییر مکان">📍</button>
                <button type="button" data-slr-delete class="danger" title="حذف" aria-label="حذف">🗑</button>
            </div>
        </div>
    `).join('')}</div>`;
}

/**
 * باز کردن مودال مدیریت مکان‌ها — با try/finally برای اطمینان از cleanup.
 */
function openManageModal() {
    renderManageList();
    const modal = document.getElementById('savedLocationsModal');
    if (!modal) return;

    // پاک‌سازی trap قبلی (اگر وجود دارد)
    if (_savedLocTrapCleanup) {
        try { _savedLocTrapCleanup(); } catch { /* silent */ }
        _savedLocTrapCleanup = null;
    }

    modal.style.display = 'flex';

    try {
        _savedLocTrapCleanup = trapFocus(modal);
    } catch {
        _savedLocTrapCleanup = null;
    }

    const close = document.getElementById('savedLocationsClose');
    if (close) setTimeout(() => close.focus(), 60);
}

function closeManageModal() {
    if (_savedLocTrapCleanup) {
        try { _savedLocTrapCleanup(); } catch { /* silent */ }
        _savedLocTrapCleanup = null;
    }
    const modal = document.getElementById('savedLocationsModal');
    if (modal) modal.style.display = 'none';
}

function sync() {
    renderAdd();
    renderDetail();
    renderList();
}

// ═══════════════════════════════════════════════════════════════════════════
// عملیات ذخیره / به‌روزرسانی
// ═══════════════════════════════════════════════════════════════════════════

async function reload() {
    try { locations = await getAll(); } catch { locations = []; }
    renderList();
}

function applyNameToTasksAt(loc, name, names, cityNames) {
    if (!Array.isArray(state.tasks)) return false;
    const n = normalize(loc);
    if (!n) return false;
    const touch = t => {
        if (t && t.location && same(t.location, n)) {
            t.location = { lat: t.location.lat, lng: t.location.lng, name };
            if (names) t.location.names = names;
            if (cityNames) t.location.cityNames = cityNames;
            return true;
        }
        return false;
    };
    let changed = false;
    state.tasks.forEach(t => {
        if (!t) return;
        if (touch(t)) changed = true;
        if (t.kind === 'plan') {
            (t.children || []).forEach(c => { if (touch(c)) changed = true; });
        }
        (t.sessions || []).forEach(s => {
            if (s && s.location && same(s.location, n)) {
                s.location = { lat: s.location.lat, lng: s.location.lng, name };
                if (names) s.location.names = names;
                if (cityNames) s.location.cityNames = cityNames;
                changed = true;
            }
        });
        if (t.kind === 'plan') {
            (t.children || []).forEach(c => {
                (c.sessions || []).forEach(s => {
                    if (s && s.location && same(s.location, n)) {
                        s.location = { lat: s.location.lat, lng: s.location.lng, name };
                        if (names) s.location.names = names;
                        if (cityNames) s.location.cityNames = cityNames;
                        changed = true;
                    }
                });
            });
        }
    });
    if (changed) saveTasks();
    return changed;
}

async function saveLocationWithName(loc, name) {
    const n = normalize(loc);
    if (!n) return null;
    let cleanName = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    if (!cleanName) return null;

    const conflict = hasNameConflict(cleanName, savedFor(n));
    if (conflict) {
        const resolution = await askConflictResolution(cleanName, conflict);
        if (resolution === null) return null;
        if (resolution === 'rename') {
            const newName = await askLocationName('');
            if (!newName) return null;
            cleanName = newName;
            return saveLocationWithName(n, cleanName);
        }
        if (resolution === 'replace') {
            try { await remove(conflict.id); } catch (_) { /* نادیده */ }
            await reload();
        }
    }

    const existing = savedFor(n);
    if (!existing && locations.length >= MAX_SAVED_LOCATIONS) {
        mapHint(`سقف ${toFa(MAX_SAVED_LOCATIONS)} مکان ذخیره‌شده پر شده است. یکی را حذف کنید.`, 5000);
        return null;
    }

    const item = existing || { id: uid() };
    item.name = cleanName;
    item.lat = n.lat;
    item.lng = n.lng;
    // حفظ نام دو زبانه‌ی مکان (اگر قبلاً ذخیره شده)
    if (loc.names && typeof loc.names === 'object') {
        const names = {};
        if (typeof loc.names.fa === 'string' && loc.names.fa.trim()) names.fa = loc.names.fa.trim().slice(0, 80);
        if (typeof loc.names.en === 'string' && loc.names.en.trim()) names.en = loc.names.en.trim().slice(0, 80);
        if (Object.keys(names).length) item.names = names;
    }
    // ذخیره‌ی نام شهر (cityNames) — اول از loc، اگر نبود از existing
    const cityNames = loc.cityNames || existing?.cityNames;
    if (cityNames && typeof cityNames === 'object') {
        const cn = {};
        if (typeof cityNames.fa === 'string' && cityNames.fa.trim()) cn.fa = cityNames.fa.trim().slice(0, 80);
        if (typeof cityNames.en === 'string' && cityNames.en.trim()) cn.en = cityNames.en.trim().slice(0, 80);
        if (Object.keys(cn).length) item.cityNames = cn;
    }
    item.updatedAt = new Date().toISOString();
    try {
        await put(item);
        await reload();
        applyNameToTasksAt(n, cleanName, item.names, item.cityNames);
        sync();
        refreshMarkers();
        mapHint(`مکان «${cleanName}» ذخیره شد ✓`);
        return { ok: true, item };
    } catch (error) {
        console.error('Saved location error:', error);
        return { ok: false, reason: 'save-failed' };
    }
}

async function saveLocation(loc, presetName) {
    const n = normalize(loc);
    if (!n) return null;
    const old = savedFor(n);
    const suggested = presetName != null ? presetName : (old ? old.name : '');
    const name = await askLocationName(suggested);
    if (name === null) return null;
    return saveLocationWithName(n, name);
}

export function saveLocationFromPopup(loc) {
    const n = normalize(loc);
    if (!n) return;
    askLocationName('').then(name => {
        if (!name) return;
        saveLocationWithName(n, name).then(() => {
            const map = getMap();
            if (map && typeof map.closePopup === 'function') {
                map.closePopup();
            }
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// حالت تغییر مکان
// ═══════════════════════════════════════════════════════════════════════════

function startRelocateLocation(id) {
    const item = locations.find(x => String(x.id) === String(id));
    if (!item) return;
    pendingRelocateId = String(id);
    ensureMapVisible();
    switchToTab('map');
    mapHint(`روی نقشه کلیک کنید تا مکان جدید «${item.name}» ثبت شود`);
    showMobileBanner(`روی نقشه ضربه بزنید تا مکان «${item.name}» به‌روزرسانی شود`);
}

function bindMapRelocate() {
    const map = getMap();
    if (!map) return;
    if (mapRelocateBoundTo === map) return;
    mapRelocateBoundTo = map;
    map.on('click', e => {
        if (!pendingRelocateId) return;
        const item = locations.find(x => String(x.id) === String(pendingRelocateId));
        pendingRelocateId = null;
        hideMobileBanner();
        if (!item) return;
        const loc = { lat: +e.latlng.lat.toFixed(5), lng: +e.latlng.lng.toFixed(5) };
        item.lat = loc.lat;
        item.lng = loc.lng;
        item.updatedAt = new Date().toISOString();
        put(item).then(reload).then(() => {
            sync();
            refreshMarkers();
            if (getMapReady()) {
                map.flyTo([loc.lat, loc.lng], Math.max(map.getZoom(), 15), { duration: 0.9 });
            }
            mapHint(`مکان «${item.name}» به‌روزرسانی شد ✓`);

            // دریافت نام شهر جدید (cityNames) برای مکان تغییر یافته
            (async () => {
                try {
                    const { reverseGeocodeBilingual } = await import('./reverse-geocode.js');
                    const names = await reverseGeocodeBilingual(loc.lat, loc.lng);
                    if (names.fa || names.en) {
                        const cn = {};
                        if (names.fa) cn.fa = names.fa;
                        if (names.en) cn.en = names.en;
                        item.cityNames = cn;
                        put(item).then(reload).then(sync);
                    }
                } catch { /* silent */ }
            })();
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// نوار موبایل
// ═══════════════════════════════════════════════════════════════════════════

export function showMobileBanner(text) {
    if (!window.matchMedia('(max-width: 900px)').matches) return;
    const banner = document.getElementById('mobilePickBanner');
    const textEl = document.getElementById('mobilePickBannerText');
    if (!banner) return;
    if (textEl && text) textEl.textContent = text;
    document.body.classList.add('detail-picking-location');
    banner.style.display = 'flex';
    clearTimeout(mobileBannerTimer);
}

export function hideMobileBanner() {
    const banner = document.getElementById('mobilePickBanner');
    if (banner) banner.style.display = 'none';
    document.body.classList.remove('detail-picking-location');
    clearTimeout(mobileBannerTimer);
}

// ═══════════════════════════════════════════════════════════════════════════
// انتخاب مکان ذخیره‌شده از چیپ لیست
// ═══════════════════════════════════════════════════════════════════════════

function selectLocation(item) {
    if (!item) return;
    const loc = { lat: +item.lat, lng: +item.lng, name: item.name };
    if (item.names) loc.names = item.names;
    if (item.cityNames) loc.cityNames = item.cityNames;
    ensureMapVisible();
    switchToTab('map');
    const map = getMap();
    if (map && getMapReady()) {
        map.flyTo([loc.lat, loc.lng], Math.max(map.getZoom(), 15), { duration: 0.7 });
    }

    if (state.relocateSess) {
        const ref = state.relocateSess;
        const found = findTask(ref.taskId);
        const session = found && (found.task.sessions || []).find(s => String(s.id) === String(ref.sessId));
        const ret = state.pendingReturnDetail;
        state.relocateSess = null;
        state.pendingReturnDetail = null;
        hideMobileBanner();
        if (session) {
            session.location = loc;
            saveTasks();
            call('render');
            refreshMarkers();
            if (ret) openDetail(ret);
            mapHint('محل ذخیره‌شده انتخاب شد ✓');
        }
        return;
    }

    if (state.relocateTaskId) {
        const id = state.relocateTaskId;
        const found = findTask(id);
        const ret = state.pendingReturnDetail;
        state.relocateTaskId = null;
        state.pendingReturnDetail = null;
        hideMobileBanner();
        if (found) {
            found.task.location = loc;
            saveTasks();
            call('render');
            refreshMarkers();
            if (ret) openDetail(ret);
            else switchToTab('tasks');
            mapHint('محل ذخیره‌شده انتخاب شد ✓');
        }
        return;
    }

    state.pendingLoc = loc;
    showPickMarker();
    sync();
    switchToTab('tasks');
    mapHint('محل ذخیره‌شده انتخاب شد — عنوان را بنویسید');
}

// ═══════════════════════════════════════════════════════════════════════════
// رویدادها
// ═══════════════════════════════════════════════════════════════════════════

function bind() {
    const locChip = document.getElementById('locChip');
    if (locChip) {
        locChip.addEventListener('click', e => {
            const savePending = e.target.closest('[data-save-pending-location]');
            if (!savePending) return;
            e.preventDefault();
            e.stopPropagation();
            // اگر مکان ذخیره شده، نامش را پیشنهاد بده
            const saved = savedFor(state.pendingLoc);
            const suggested = saved ? saved.name : '';
            const name = askLocationName(suggested);
            name.then(v => {
                if (!v) return;
                saveLocationWithName(state.pendingLoc, v);
            });
        });
    }

    document.addEventListener('click', e => {
        const saveDetail = e.target.closest('[data-save-detail-location]');
        if (saveDetail) {
            e.preventDefault();
            e.stopPropagation();
            const found = findTask(state.currentDetailId);
            const t = found ? found.task : null;
            if (t && t.location) {
                const saved = savedFor(t.location);
                const suggested = saved ? saved.name : '';
                const name = askLocationName(suggested);
                name.then(v => {
                    if (!v) return;
                    saveLocationWithName(t.location, v);
                });
            }
        }
    });

    const mobileCancel = document.getElementById('mobilePickBannerCancel');
    if (mobileCancel) {
        mobileCancel.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            pendingRelocateId = null;
            pendingNewLocationFromMap = false;
            hideMobileBanner();
            state.relocateSess = null;
            state.relocateTaskId = null;
            state.pendingReturnDetail = null;
            switchToTab('tasks');
        });
    }

    const mapPanel = document.getElementById('panelMap');
    if (mapPanel) {
        mapPanel.addEventListener('click', e => {
            if (e.target.closest('#savedLocationsManage')) {
                e.preventDefault();
                e.stopPropagation();
                openManageModal();
                return;
            }
            const chip = e.target.closest('[data-saved-location]');
            if (!chip || !mapPanel.contains(chip)) return;
            e.preventDefault();
            e.stopPropagation();
            selectLocation(locations.find(x => String(x.id) === String(chip.dataset.savedLocation)));
        });
    }

    const manageModal = document.getElementById('savedLocationsModal');
    if (manageModal) {
        manageModal.addEventListener('click', async e => {
            if (e.target === manageModal) { closeManageModal(); return; }
            if (e.target.closest('#savedLocationsClose')) {
                closeManageModal();
                return;
            }
            if (e.target.closest('#savedLocationsAddNew')) {
                closeManageModal();
                startNewLocationFromMap();
                return;
            }

            const row = e.target.closest('.saved-locations-row');
            if (!row) return;
            const item = locations.find(x => String(x.id) === row.dataset.id);
            if (!item) return;

            if (e.target.closest('[data-slr-rename]')) {
                const name = await askLocationName(item.name);
                if (name === null) return;
                const conflict = hasNameConflict(name, item);
                if (conflict) {
                    const resolution = await askConflictResolution(name, conflict);
                    if (resolution === null) return;
                    if (resolution === 'rename') {
                        const newName = await askLocationName('');
                        if (!newName) return;
                        const c2 = hasNameConflict(newName, item);
                        if (c2) {
                            const r2 = await askConflictResolution(newName, c2);
                            if (r2 !== 'replace') return;
                            try { await remove(c2.id); } catch (_) {}
                            await reload();
                        }
                        item.name = newName;
                    } else if (resolution === 'replace') {
                        try { await remove(conflict.id); } catch (_) {}
                        await reload();
                        item.name = name;
                    }
                } else {
                    item.name = name;
                }
                item.updatedAt = new Date().toISOString();
                await put(item);
                await reload();
                renderManageList();
                renderList();
                renderAdd();
                renderDetail();
                refreshMarkers();
                return;
            }

            if (e.target.closest('[data-slr-delete]')) {
                const ok = await showConfirmModal({
                    title: 'حذف مکان',
                    message: `مکان «${item.name}» حذف شود؟ وظایف قبلی نام و آدرس خود را نگه می‌دارند.`,
                    confirmText: 'حذف کن',
                    cancelText: 'انصراف',
                    danger: true
                });
                if (!ok) return;
                await remove(item.id);
                await reload();
                renderManageList();
                renderList();
                renderAdd();
                renderDetail();
                refreshMarkers();
                return;
            }

            if (e.target.closest('[data-slr-move]')) {
                closeManageModal();
                startRelocateLocation(item.id);
                return;
            }
        });
    }

    document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        const modal = document.getElementById('savedLocationsModal');
        if (modal && modal.style.display === 'flex') {
            e.preventDefault();
            e.stopPropagation();
            closeManageModal();
        }
    }, true);
}

// ═══════════════════════════════════════════════════════════════════════════
// شروع مکان جدید از روی نقشه
// ═══════════════════════════════════════════════════════════════════════════

function startNewLocationFromMap() {
    if (locations.length >= MAX_SAVED_LOCATIONS) {
        mapHint(`سقف ${toFa(MAX_SAVED_LOCATIONS)} مکان ذخیره‌شده پر شده است. یکی را حذف کنید.`, 5000);
        return;
    }
    pendingNewLocationFromMap = true;
    ensureMapVisible();
    switchToTab('map');
    mapHint('روی نقشه کلیک کنید تا مکان جدید انتخاب شود');
    showMobileBanner('روی نقشه ضربه بزنید تا مکان جدید انتخاب شود');
}

function bindNewLocationFromMap() {
    const map = getMap();
    if (!map) return;
    if (newFromMapBoundTo === map) return;
    newFromMapBoundTo = map;
    map.on('click', e => {
        if (!pendingNewLocationFromMap) return;
        if (pendingRelocateId) return;
        pendingNewLocationFromMap = false;
        hideMobileBanner();
        const loc = { lat: +e.latlng.lat.toFixed(5), lng: +e.latlng.lng.toFixed(5) };
        askLocationName('').then(name => {
            if (!name) return;
            // دریافت cityNames به صورت موازی
            (async () => {
                try {
                    const { reverseGeocodeBilingual } = await import('./reverse-geocode.js');
                    const names = await reverseGeocodeBilingual(loc.lat, loc.lng);
                    if (names.fa || names.en) {
                        const cn = {};
                        if (names.fa) cn.fa = names.fa;
                        if (names.en) cn.en = names.en;
                        loc.cityNames = cn;
                    }
                } catch { /* silent */ }
                saveLocationWithName(loc, name).then(() => {
                    renderManageList();
                    openManageModal();
                });
            })();
        });
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════════════════════════════════

async function init() {
    bind();
    await reload();
    sync();
    bindMapRelocate();
    bindNewLocationFromMap();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
    init();
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API (برای استفاده در app.js)
// ═══════════════════════════════════════════════════════════════════════════
export {
    sync as refreshSavedLocationUI,
    sync as updateLocChip,
    label as locationLabelFor
};

export function isRelocateActive() {
    return Boolean(pendingRelocateId);
}

// ═══════════════════════════════════════════════════════════════════════════
// listener برای map-ready (چون map بعد از init ساخته می‌شود)
// ═══════════════════════════════════════════════════════════════════════════
window.addEventListener('rahe-map-ready', () => {
    bindMapRelocate();
    bindNewLocationFromMap();
});

// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ گام ۱۵: SHIM‌ها حذف شدند
// ═══════════════════════════════════════════════════════════════════════════