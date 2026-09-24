// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// map.js -- Leaflet map + markers + visibility prefs (ESM) — فاز ۴ گام ۳
//
// ⚠️ این نسخه:
//   - _callbacks و registerMapCallbacks را با EventEmitter جایگزین می‌کند
//   - call() برای fire-and-forget، invoke() برای getterها
//   - registerStoreCallbacks حذف شد (store.js الان setMapHelpers دارد)
//   - dual-emit موقت برای سازگاری با route-ui.js فعلی
// ═══════════════════════════════════════════════════════════════════════════

import { state, toFa, escapeHtml } from './core.js';
import { nearestUpcoming, faShort } from './sessions.js';
import { findTask, saveTasks } from './store.js';
import { events, EV, CALLBACK_TO_EVENT } from './events.js';
import { t as i18nT } from './i18n.js';

// ═══════════════════════════════════════════════════════════════════════════
// Backward-compat: registerMapCallbacks (پل موقت به EventEmitter)
// ═══════════════════════════════════════════════════════════════════════════
//
// ⚠️ این تابع در فاز ۵ (بازنویسی app.js) حذف می‌شود.
// تا آن زمان، app.js همچنان می‌تواند registerMapCallbacks را صدا بزند.

/**
 * @deprecated از events.on استفاده کنید.
 * @param {Record<string, Function>} cbs
 */
export function registerMapCallbacks(cbs) {
    if (!cbs || typeof cbs !== 'object') return;
    for (const [name, fn] of Object.entries(cbs)) {
        if (typeof fn !== 'function') continue;
        const eventName = CALLBACK_TO_EVENT[name];
        if (!eventName) continue;
        events.on(eventName, fn);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// call() و invoke()
// ═══════════════════════════════════════════════════════════════════════════

function call(name, ...args) {
    const eventName = CALLBACK_TO_EVENT[name];
    if (!eventName) {
        // eslint-disable-next-line no-console
        console.warn(`map.call: unknown callback "${name}"`);
        return;
    }
    events.emit(eventName, ...args);
}

function invoke(name, ...args) {
    const eventName = CALLBACK_TO_EVENT[name];
    if (!eventName) {
        // eslint-disable-next-line no-console
        console.warn(`map.invoke: unknown callback "${name}"`);
        return undefined;
    }
    const listeners = events._listeners.get(eventName);
    if (!listeners || listeners.size === 0) return undefined;
    let result;
    for (const listener of listeners) {
        try {
            const r = listener(...args);
            if (r !== undefined) {
                result = r;
                break;
            }
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error(`map.invoke: listener for "${eventName}" threw:`, err);
        }
    }
    return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// Internal state
// ═══════════════════════════════════════════════════════════════════════════

let map = null;
let markersLayer = null;
let pickMarker = null;
let youMarker = null;
let mapReady = false;
let mapInitializing = false;
let suppressMapClickUntil = 0;
let mapHintTimer = null;
let markerTimer = null;
let mapDomClickHandler = null;
let mapLoadHandler = null;
let mapInitTimers = [];

// Live tracking state
let liveWatchId = null;
let lastAcceptedTime = 0;
const LIVE_TRACK_MIN_INTERVAL_MS = 2500;
let liveTrackActive = false;
let liveTrackingFirstFix = true;

// ═══════════════════════════════════════════════════════════════════════════
// Public getters/setters
// ═══════════════════════════════════════════════════════════════════════════

export function getMap() { return map; }
export function getMapReady() { return mapReady; }
export function getPickMarker() { return pickMarker; }
export function setPickMarker(v) { pickMarker = v; }
export function getYouMarker() { return youMarker; }

// ═══════════════════════════════════════════════════════════════════════════
// Tiles
// ═══════════════════════════════════════════════════════════════════════════

const TILES = {
    normal: { name:'نقشه معمولی', url:'https://tile.openstreetmap.org/{z}/{x}/{y}.png', sub:'abc', max:19, attr:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },
    dark: { name:'نقشه تاریک', url:'https://tile.openstreetmap.org/{z}/{x}/{y}.png', sub:'abc', max:19, cls:'tiles-dark', attr:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },
    sat: { name:'ماهواره‌ای', url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', sub:'abc', max:19, attr:'&copy; Esri, Maxar, Earthstar Geographics' }
};

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

export function mapHint(msg, ms) {
    const el = document.getElementById('mapHint');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(mapHintTimer);
    mapHintTimer = setTimeout(() => el.classList.remove('show'), ms || 3000);
    events.emit(EV.MAP_HINT, { msg, ms });
}

// ═══════════════════════════════════════════════════════════════════════════
// Tab switching
// ═══════════════════════════════════════════════════════════════════════════

export function switchToTab(name) {
    document.querySelectorAll('.mobile-tab').forEach(b => {
        const on = b.dataset.tab === name;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const tasksPanel = document.getElementById('panelTasks');
    const mapPanel = document.getElementById('panelMap');
    if (tasksPanel) tasksPanel.classList.toggle('active', name === 'tasks');
    if (mapPanel) mapPanel.classList.toggle('active', name === 'map');
    if (name === 'map' && mapReady) setTimeout(() => map.invalidateSize(), 60);
    events.emit(EV.UI_SWITCH_TAB, name);
}

// ═══════════════════════════════════════════════════════════════════════════
// Prefs
// ═══════════════════════════════════════════════════════════════════════════

const PREFS_KEY = 'spaceTodoPrefs';

export function loadPrefs() {
    try {
        const p = JSON.parse(localStorage.getItem(PREFS_KEY));
        if (!p) return;
        if (typeof p.mapVisible === 'boolean') state.prefs.mapVisible = p.mapVisible;
        if (typeof p.remindOn === 'boolean') state.prefs.remindOn = p.remindOn;
        if ([15, 30, 60, 180, 1440].includes(+p.remindMin)) state.prefs.remindMin = +p.remindMin;
        if (typeof p.digestOn === 'boolean') state.prefs.digestOn = p.digestOn;
        if (typeof p.lastDigest === 'string') state.prefs.lastDigest = p.lastDigest;
        if (typeof p.tourSeen === 'boolean') state.prefs.tourSeen = p.tourSeen;
        if (typeof p.proMode === 'boolean') state.prefs.proMode = p.proMode;
        if (typeof p.soundOn === 'boolean') state.prefs.soundOn = p.soundOn;
        if (['task', 'series', 'plan'].includes(p.pendingKind)) state.prefs.pendingKind = p.pendingKind;
        if (['auto', 'dark', 'light'].includes(p.theme)) state.prefs.theme = p.theme;
        // ⚠️ فیلدهای صوتی جدید (فاز ۵)
        if (typeof p.soundDefault === 'boolean') state.prefs.soundDefault = p.soundDefault;
        if (typeof p.soundPreset === 'string' || p.soundPreset === null) state.prefs.soundPreset = p.soundPreset;
        if (typeof p.soundPresetOn === 'boolean') state.prefs.soundPresetOn = p.soundPresetOn;
        if (typeof p.soundTtsOn === 'boolean') state.prefs.soundTtsOn = p.soundTtsOn;
        if (typeof p.soundTtsVoice === 'string' || p.soundTtsVoice === null) state.prefs.soundTtsVoice = p.soundTtsVoice;
    } catch { /* پیش‌فرض */ }
}

export function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs)); }
    catch { /* نادیده */ }
}

// ═══════════════════════════════════════════════════════════════════════════
// Route
// ═══════════════════════════════════════════════════════════════════════════

export function clearRoute() {
    events.emit(EV.ROUTE_CLEAR);
}

// ═══════════════════════════════════════════════════════════════════════════
// Destroy
// ═══════════════════════════════════════════════════════════════════════════

export function destroyMap() {
    clearTimeout(mapHintTimer);
    clearTimeout(markerTimer);
    mapInitTimers.forEach(clearTimeout);
    mapInitTimers = [];
    clearRoute();
    stopLiveTracking();
    events.emit(EV.MAP_DESTROYED);
    // ⚠️ dual-emit موقت برای سازگاری با route-ui.js فعلی
    // در فاز ۵ (بازنویسی route-ui.js) این خط حذف می‌شود
    window.dispatchEvent(new Event('rahe-map-destroy'));
    const mapEl = document.getElementById('map');
    if (mapEl && mapDomClickHandler) mapEl.removeEventListener('click', mapDomClickHandler);
    if (mapLoadHandler) window.removeEventListener('load', mapLoadHandler);
    mapDomClickHandler = null;
    mapLoadHandler = null;
    if (map) map.remove();
    map = null;
    markersLayer = null;
    pickMarker = null;
    youMarker = null;
    mapReady = false;
    mapInitializing = false;
    if (mapEl) mapEl.replaceChildren();
    const wrap = document.querySelector('.map-wrap');
    if (wrap) wrap.classList.remove('fullscreen');
    const exit = document.getElementById('fsExit');
    if (exit) exit.style.display = 'none';
}

// ═══════════════════════════════════════════════════════════════════════════
// Visibility
// ═══════════════════════════════════════════════════════════════════════════

export function applyMapVisibility() {
    const btn = document.getElementById('mapToggle');
    if (btn) btn.textContent = state.prefs.mapVisible ? '🗺 نقشه: روشن' : '🗺 نقشه: خاموش';

    if (!state.prefs.mapVisible) {
        document.body.classList.add('map-hidden');
        destroyMap();
        return;
    }

    document.body.classList.remove('map-hidden');
    if (mapReady) requestAnimationFrame(() => map?.invalidateSize());
}

export function ensureMapVisible() {
    if (state.prefs.mapVisible) return;
    state.prefs.mapVisible = true;
    savePrefs();
    applyMapVisibility();
    initMap();
}

// ═══════════════════════════════════════════════════════════════════════════
// Icons
// ═══════════════════════════════════════════════════════════════════════════

function dotIcon(cls) {
    return L.divIcon({ className:'', html:`<span class="mk ${cls || ''}"></span>`, iconSize:[18,18], iconAnchor:[9,9], popupAnchor:[0,-10] });
}

function showMapFallback() {
    const el = document.getElementById('map');
    if (el) el.innerHTML = '<div class="map-fallback">برای نمایش نقشه به اینترنت نیاز است.<br>برنامه بدون نقشه هم کامل کار می‌کند.</div>';
}

// ═══════════════════════════════════════════════════════════════════════════
// Initial view resolution
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_CENTER = [35.69, 51.39];
const DEFAULT_ZOOM = 12;
const GEO_WAIT_MS = 5000;

async function queryGeolocationPermission() {
    if (!navigator.permissions || !navigator.permissions.query) return 'unknown';
    try {
        const status = await navigator.permissions.query({ name: 'geolocation' });
        return status.state;
    } catch {
        return 'unknown';
    }
}

function getCurrentPositionOnce(timeoutMs) {
    return new Promise(resolve => {
        if (!navigator.geolocation) return resolve(null);
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            resolve(null);
        }, timeoutMs);
        navigator.geolocation.getCurrentPosition(
            pos => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
            },
            () => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(null);
            },
            { timeout: timeoutMs, maximumAge: 120000, enableHighAccuracy: false }
        );
    });
}

async function resolveInitialView() {
    const permission = await queryGeolocationPermission();

    if (permission === 'denied') {
        return { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, user: null };
    }

    if (permission === 'granted') {
        const pos = await getCurrentPositionOnce(GEO_WAIT_MS);
        if (pos) {
            return { center: [pos.lat, pos.lng], zoom: 14, user: [pos.lat, pos.lng] };
        }
        return { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, user: null };
    }

    getCurrentPositionOnce(GEO_WAIT_MS).then(pos => {
        if (!pos) return;
        if (!mapReady || !map) return;
        const ll = [pos.lat, pos.lng];
        setYouMarker(ll);
        map.flyTo(ll, 13, { duration: 1 });
    });

    return { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, user: null };
}

// ═══════════════════════════════════════════════════════════════════════════
// You marker
// ═══════════════════════════════════════════════════════════════════════════

export function setYouMarker(ll, options) {
    if (!mapReady || !map) return;
    const opts = options || {};
    const { pan = false, zoom = null, fitBounds = null } = opts;

    if (youMarker) {
        youMarker.setLatLng(ll);
    } else {
        youMarker = L.circleMarker(ll, {
            radius: 8,
            color: '#fff',
            weight: 2,
            fillColor: '#00d4ff',
            fillOpacity: 1
        }).addTo(map).bindPopup(`<div class="pp"><div class="pp-title">${i18nT('map.popup.yourLocation')}</div></div>`);
    }

    if (Array.isArray(fitBounds) && fitBounds.length >= 2) {
        const bounds = L.latLngBounds(fitBounds);
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
        return;
    }

    if (zoom !== null) {
        map.setView(ll, zoom, { animate: true, duration: 0.8 });
    } else if (pan) {
        map.panTo(ll, { animate: true, duration: 0.6 });
    }
}

function isLatLngInView(ll, marginRatio) {
    if (!mapReady || !map) return false;
    const bounds = map.getBounds();
    if (!marginRatio) return bounds.contains(ll);
    const inner = bounds.pad(-marginRatio);
    return inner.contains(ll);
}

// ═══════════════════════════════════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════════════════════════════════

export async function initMap() {
    if (!state.prefs.mapVisible || mapReady || mapInitializing) return;
    const mapEl = document.getElementById('map');
    if (!mapEl) return;
    if (typeof L === 'undefined') {
        setTimeout(() => {
            if (typeof L === 'undefined' && !mapReady) {
                showMapFallback();
            }
        }, 9000);
        return;
    }

    mapInitializing = true;

    const initial = await resolveInitialView();

    if (!state.prefs.mapVisible || mapReady) {
        mapInitializing = false;
        return;
    }

    map = L.map('map').setView(initial.center, initial.zoom);
    map.zoomControl.setPosition('topleft');
    const layers = {};
    ['normal','dark','sat'].forEach(k => {
        const c = TILES[k];
        layers[c.name] = L.tileLayer(c.url, { maxZoom: c.max, subdomains: c.sub, attribution: c.attr, className: c.cls || '' });
    });
    layers[TILES.normal.name].addTo(map);
    L.control.layers(layers, null, { position: 'topleft' }).addTo(map);
    markersLayer = L.layerGroup().addTo(map);
    mapReady = true;
    mapInitializing = false;

    if (initial.user) setYouMarker(initial.user);

    map.on('click', onMapClick);
    map.on('moveend zoomend', () => scheduleMarkerRefresh());
    mapDomClickHandler = e => {
        const s = e.target.closest('[data-save-popup-location]');
        if (s) {
            call('saveLocationFromPopup', { lat: +s.dataset.lat, lng: +s.dataset.lng });
            return;
        }
        const r = e.target.closest('[data-pproute]');
        if (r) { call('showRouteTo', r.dataset.pproute); return; }
        const b = e.target.closest('[data-ppdetail]');
        if (!b) return;
        call('openDetail', b.dataset.ppdetail);
    };
    mapEl.addEventListener('click', mapDomClickHandler);
    refreshMarkers();
    mapInitTimers = [
        setTimeout(() => { if (mapReady && map) map.invalidateSize(); }, 350),
        setTimeout(() => { if (mapReady && map) map.invalidateSize(); }, 1500)
    ];
    mapLoadHandler = () => { if (mapReady && map) map.invalidateSize(); };
    window.addEventListener('load', mapLoadHandler);
    events.emit(EV.MAP_READY);
    // ⚠️ dual-emit موقت برای سازگاری با location-ui.js فعلی
    window.dispatchEvent(new Event('rahe-map-ready'));
}

// ═══════════════════════════════════════════════════════════════════════════
// Markers
// ═══════════════════════════════════════════════════════════════════════════

export function scheduleMarkerRefresh() {
    if (!mapReady) return;
    clearTimeout(markerTimer);
    markerTimer = setTimeout(refreshMarkers, 120);
}

export function refreshMarkers() {
    if (!mapReady) return;
    markersLayer.clearLayers();
    const displayLoc = t => t.location || (t.sessions || []).map(s => s.location).find(Boolean) || null;
    const addMarker = (t, loc) => {
        const m = L.marker([loc.lat, loc.lng], { icon: dotIcon(t.completed ? 'done' : '') });
        m.on('click', () => { suppressMapClickUntil = Date.now() + 400; });
        const n = nearestUpcoming(t);
        const dateLine = n
            ? faShort(n.at)
            : ((t.sessions && t.sessions.length)
                ? i18nT('map.popup.allPast')
                : i18nT('map.popup.noDate'));

        const snap = (loc.name && String(loc.name).trim()) || null;
        const saved = invoke('locationLabelFor', loc);
        const hasSavedName = Boolean(snap) || Boolean(
            saved &&
            (function () {
                try {
                    const coordsStr = `${toFa(loc.lat)}، ${toFa(loc.lng)}`;
                    return saved !== coordsStr;
                } catch { return false; }
            })()
        );
        const displayName = snap || (hasSavedName ? saved : null);

        let locRow;
        if (displayName) {
            locRow = `<div class="pp-loc"><span>📌</span><span>${escapeHtml(displayName)}</span></div>`;
        } else {
            const latTxt = toFa(loc.lat);
            const lngTxt = toFa(loc.lng);
                        locRow = `<div class="pp-loc pp-loc-unsaved"><span>📍</span><span class="pp-coords">${escapeHtml(latTxt)}، ${escapeHtml(lngTxt)}</span><button class="pp-save-btn" type="button" data-save-popup-location data-lat="${loc.lat}" data-lng="${loc.lng}">${i18nT('map.popup.saveName')}</button></div>`;
        }

        let cityRow = '';
        if (loc.cityNames) {
            const lang = state.prefs.lang === 'en' ? 'en' : 'fa';
            const city = loc.cityNames[lang] || loc.cityNames.fa || loc.cityNames.en;
            if (city) cityRow = `<div class="pp-city">🌆 ${escapeHtml(city)}</div>`;
        }

        m.bindPopup(`<div class="pp pp-${t.priority}"><div class="pp-title">${escapeHtml(t.text)}</div><div class="pp-date">📅 ${dateLine}</div>${cityRow}${locRow}<div class="pp-row"><button class="pp-btn" data-ppdetail="${escapeHtml(String(t.id))}">${i18nT('map.popup.showDetails')}</button><button class="pp-btn" data-pproute="${escapeHtml(String(t.id))}">${i18nT('map.popup.route')}</button></div></div>`);
        m._taskId = t.id;
        markersLayer.addLayer(m);
    };
    const pts = [];
    state.tasks.forEach(t => {
        if (t.kind === 'plan') (t.children || []).forEach(c => { const l = displayLoc(c); if (l) pts.push({ t: c, loc: l }); });
        else { const l = displayLoc(t); if (l) pts.push({ t, loc: l }); }
        if (t.kind === 'plan' && t.location) pts.push({ t, loc: t.location });
    });
    const CELL = 64;
    const cells = new Map();
    pts.forEach(it => {
        const p = map.latLngToContainerPoint([it.loc.lat, it.loc.lng]);
        const k = Math.floor(p.x / CELL) + ':' + Math.floor(p.y / CELL);
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(it);
    });
    cells.forEach(list => {
        if (list.length === 1) { addMarker(list[0].t, list[0].loc); return; }
        const lat = list.reduce((a, it) => a + it.loc.lat, 0) / list.length;
        const lng = list.reduce((a, it) => a + it.loc.lng, 0) / list.length;
        const m = L.marker([lat, lng], { icon: L.divIcon({ className: '', html: `<span class="mk-cluster">${toFa(list.length)}</span>`, iconSize: [34, 34], iconAnchor: [17, 17] }) });
        m.on('click', () => { suppressMapClickUntil = Date.now() + 400; map.flyTo([lat, lng], Math.min(map.getZoom() + 2, 19), { duration: .6 }); });
        markersLayer.addLayer(m);
    });
    events.emit(EV.MAP_MARKERS_REFRESHED);
}

// ═══════════════════════════════════════════════════════════════════════════
// Fly to task
// ═══════════════════════════════════════════════════════════════════════════

export function flyToTask(id) {
    const found = findTask(id);
    const t = found ? found.task : null;
    if (!t || !mapReady) return;
    const loc = t.location || (nearestUpcoming(t) && nearestUpcoming(t).location) || (t.sessions || []).map(s => s.location).find(Boolean);
    if (!loc) return;
    switchToTab('map');
    map.flyTo([loc.lat, loc.lng], 14, { duration: 1 });
    markersLayer.eachLayer(m => {
        if (String(m._taskId) === String(id)) setTimeout(() => m.openPopup(), 1100);
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// Format
// ═══════════════════════════════════════════════════════════════════════════

export function fmtDist(m) {
    if (m < 1000) return `${toFa(Math.round(m))} متر`;
    return `${toFa((m / 1000).toFixed(1))} کیلومتر`;
}

export function fmtDur(s) {
    const m = Math.round(s / 60);
    if (m < 60) return `${toFa(m)} دقیقه`;
    return `${toFa(Math.floor(m / 60))} ساعت و ${toFa(m % 60)} دقیقه`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Fullscreen
// ═══════════════════════════════════════════════════════════════════════════

export function toggleFullscreen() {
    const w = document.querySelector('.map-wrap');
    if (!w) return;
    const on = w.classList.toggle('fullscreen');
    const fsBtn = document.getElementById('fsBtn');
    const fsExit = document.getElementById('fsExit');
    if (fsBtn) fsBtn.textContent = on ? '✕' : '⛶';
    if (fsExit) fsExit.style.display = on ? '' : 'none';
    setTimeout(() => { if (mapReady) map.invalidateSize(); }, 80);
}

// ═══════════════════════════════════════════════════════════════════════════
// Pick marker
// ═══════════════════════════════════════════════════════════════════════════

export function showPickMarker() {
    if (!mapReady || !state.pendingLoc) return;
    if (pickMarker) pickMarker.setLatLng([state.pendingLoc.lat, state.pendingLoc.lng]);
    else pickMarker = L.marker([state.pendingLoc.lat, state.pendingLoc.lng], { icon: L.divIcon({ className: '', html: '<span class="mk-pick"></span>', iconSize: [20, 20], iconAnchor: [10, 10] }), interactive: false }).addTo(map);
}

export function removePickMarker() {
    if (pickMarker && map && mapReady) {
        map.removeLayer(pickMarker);
    }
    pickMarker = null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Map click
// ═══════════════════════════════════════════════════════════════════════════

export function onMapClick(e) {
    if (Date.now() < suppressMapClickUntil) return;
    if (invoke('isRelocateLocationActive')) return;

    const loc = { lat: +e.latlng.lat.toFixed(5), lng: +e.latlng.lng.toFixed(5) };

    if (state.relocateSess || state.relocateTaskId) {
        clearRoute();

        if (state.relocateSess) {
            const ref = state.relocateSess;
            const found = findTask(ref.taskId);
            const s = found && (found.task.sessions || []).find(x => String(x.id) === String(ref.sessId));
            const ret = state.pendingReturnDetail;
            state.relocateSess = null;
            state.pendingReturnDetail = null;
            if (s) {
                s.location = loc;
                saveTasks();
                call('render');
                refreshMarkers();
                call('refreshSavedLocationUI');
                mapHint(i18nT('map.hint.sessionLocationSaved'));
                (async () => {
                    try {
                        const { reverseGeocodeBilingual } = await import('./reverse-geocode.js');
                        const names = await reverseGeocodeBilingual(loc.lat, loc.lng);
                        if (names.fa || names.en) {
                            const cn = {};
                            if (names.fa) cn.fa = names.fa;
                            if (names.en) cn.en = names.en;
                            s.location = { ...s.location, cityNames: cn };
                            saveTasks();
                        }
                    } catch { /* silent */ }
                })();
            }
            call('hideMobilePickBanner');
            if (ret) {
                call('openDetail', ret);
            } else if (s && found) {
                flyToTask(found.task.id);
            }
            return;
        }

        const found = findTask(state.relocateTaskId);
        const ret = state.pendingReturnDetail;
        state.relocateTaskId = null;
        state.pendingReturnDetail = null;
        if (found) {
            found.task.location = loc;
            saveTasks();
            call('render');
            refreshMarkers();
            call('refreshSavedLocationUI');
            mapHint(i18nT('map.hint.newLocationSaved'));
            mapHint('محل جدید ذخیره شد ✓');
            flyToTask(found.task.id);
            (async () => {
                try {
                    const { reverseGeocodeBilingual } = await import('./reverse-geocode.js');
                    const names = await reverseGeocodeBilingual(loc.lat, loc.lng);
                    if (names.fa || names.en) {
                        const cn = {};
                        if (names.fa) cn.fa = names.fa;
                        if (names.en) cn.en = names.en;
                        found.task.location = { ...found.task.location, cityNames: cn };
                        saveTasks();
                        refreshMarkers();
                    }
                } catch { /* silent */ }
            })();
        }
        call('hideMobilePickBanner');
        if (ret) {
            call('openDetail', ret);
        }
        return;
    }

    clearRoute();
    state.pendingLoc = loc;
    showPickMarker();
    call('updateLocChip');
    switchToTab('tasks');
    mapHint(i18nT('map.hint.locationSelected'));

    (async () => {
        try {
            const { reverseGeocodeBilingual } = await import('./reverse-geocode.js');
            const names = await reverseGeocodeBilingual(loc.lat, loc.lng);
            if (state.pendingLoc &&
                state.pendingLoc.lat === loc.lat &&
                state.pendingLoc.lng === loc.lng) {
                if (names.fa || names.en) {
                    const cn = {};
                    if (names.fa) cn.fa = names.fa;
                    if (names.en) cn.en = names.en;
                    state.pendingLoc = { ...state.pendingLoc, cityNames: cn };
                }
            }
        } catch { /* silent */ }
    })();

    setTimeout(() => {
        const inp = document.getElementById('taskInput');
        if (!inp) return;
        inp.scrollIntoView({ behavior: 'smooth', block: 'center' });
        inp.focus({ preventScroll: true });
    }, 60);
}

// ═══════════════════════════════════════════════════════════════════════════
// Locate user
// ═══════════════════════════════════════════════════════════════════════════

export function locateUser(fly) {
    if (!mapReady || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(pos => {
        if (!mapReady || !map) return;
        const ll = [pos.coords.latitude, pos.coords.longitude];
        setYouMarker(ll);
        if (fly) map.flyTo(ll, 14, { duration: 1.2 });
        else map.flyTo(ll, 13, { duration: 1.5 });
        }, () => { if (fly && mapReady) mapHint(i18nT('map.hint.locationUnavailable')); }, { timeout: 8000 });
}

// ═══════════════════════════════════════════════════════════════════════════
// Live tracking
// ═══════════════════════════════════════════════════════════════════════════

export function startLiveTracking() {
    if (liveTrackActive) return;
    if (!mapReady || !navigator.geolocation) {
        mapHint(i18nT('map.liveTrackingUnavailable'));
        return;
    }

    liveTrackActive = true;
    lastAcceptedTime = 0;
    liveTrackingFirstFix = true;

    const btn = document.getElementById('liveTrackBtn');
    if (btn) {
        btn.classList.add('active');
        btn.textContent = '⏹ توقف ردیابی';
    }

    mapHint(i18nT('map.liveTrackingStart'), 4000);

    liveWatchId = navigator.geolocation.watchPosition(
        position => {
            if (!liveTrackActive || !mapReady || !map) return;

            const now = Date.now();
            if (now - lastAcceptedTime < LIVE_TRACK_MIN_INTERVAL_MS) {
                return;
            }
            lastAcceptedTime = now;

            const ll = [position.coords.latitude, position.coords.longitude];

            if (liveTrackingFirstFix) {
                liveTrackingFirstFix = false;

                if (invoke('hasActiveRoute')) {
                    const dest = invoke('getActiveRouteDestination');
                    if (dest && Number.isFinite(dest.lat) && Number.isFinite(dest.lng)) {
                        setYouMarker(ll, {
                            fitBounds: [ll, [dest.lat, dest.lng]]
                        });
                    } else {
                        setYouMarker(ll, { zoom: 15 });
                    }
                } else {
                    setYouMarker(ll, { zoom: 15 });
                }
            } else {
                if (!isLatLngInView(ll, 0.15)) {
                    setYouMarker(ll, { pan: true });
                } else {
                    setYouMarker(ll);
                }
            }

            const event = new CustomEvent('rahe-live-position', {
                detail: { lat: ll[0], lng: ll[1] }
            });
            window.dispatchEvent(event);
        },
        error => {
            if (error.code === 1) {
                mapHint(i18nT('map.liveTrackingDenied'));
                stopLiveTracking();
            }
        },
        {
            enableHighAccuracy: false,
            maximumAge: 5000,
            timeout: 15000
        }
    );
}

export function stopLiveTracking() {
    if (!liveTrackActive) return;
    liveTrackActive = false;
    liveTrackingFirstFix = true;

    if (liveWatchId !== null) {
        navigator.geolocation.clearWatch(liveWatchId);
        liveWatchId = null;
    }
    lastAcceptedTime = 0;

    const btn = document.getElementById('liveTrackBtn');
    if (btn) {
        btn.classList.remove('active');
        btn.textContent = '📡 ردیابی آنلاین';
    }

    mapHint(i18nT('map.liveTrackingStopped'));
}

export function isLiveTrackingActive() {
    return liveTrackActive;
}

// ═══════════════════════════════════════════════════════════════════════════
// Location chip
// ═══════════════════════════════════════════════════════════════════════════

export function updateLocChip() {
    events.emit(EV.LOCATION_PENDING_CHANGED);
}

// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ گام ۱۵: SHIM‌ها حذف شدند
// ═══════════════════════════════════════════════════════════════════════════