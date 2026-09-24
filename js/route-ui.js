// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// route-ui.js -- three transport profiles with selectable route geometry (ESM)

import { state, escapeHtml } from './core.js';
import { findTask } from './store.js';
import {
    mapHint,
    ensureMapVisible,
    switchToTab,
    fmtDist,
    fmtDur,
    getMap,
    getMapReady,
    getYouMarker,
    setYouMarker
} from './map.js';
import { t as i18nT } from './i18n.js';

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const PROFILES = [
    { key: 'car', label: 'خودرو', icon: '🚗', color: '#00d4ff', base: 'https://routing.openstreetmap.de/routed-car/route/v1/driving/' },
    { key: 'bike', label: 'دوچرخه', icon: '🚲', color: '#58d68d', base: 'https://routing.openstreetmap.de/routed-bike/route/v1/driving/' },
    { key: 'foot', label: 'پیاده', icon: '🚶', color: '#f5b041', base: 'https://routing.openstreetmap.de/routed-foot/route/v1/driving/' }
];

const AUTO_CLEAR_MS = 5 * 60 * 1000;

// ═══════════════════════════════════════════════════════════════════════════
// Local state
// ═══════════════════════════════════════════════════════════════════════════

let activeRoutes = null;
let activeTask = null;
let activeDestination = null;  // ← NEW: مکان مقصد انتخاب‌شده (task.location یا session.location)
let activeKey = 'car';
let activeLayer = null;
let controller = null;
let clearTimer = null;
let mapClickBoundTo = null;
let clearButtonBound = false;
let mapCaptureBound = false;
let summaryHidden = false;
let liveRouteUpdateTimer = null;

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function waitForMapReady(timeoutMs = 8000) {
    if (getMap() && getMapReady()) {
        return Promise.resolve(true);
    }
    return new Promise(resolve => {
        const started = Date.now();
        const timer = setInterval(() => {
            if (getMap() && getMapReady()) {
                clearInterval(timer);
                resolve(true);
                return;
            }
            if (Date.now() - started >= timeoutMs) {
                clearInterval(timer);
                resolve(false);
            }
        }, 100);
    });
}

function getFreshOrigin() {
    return new Promise(resolve => {
        if (!navigator.geolocation) { resolve(null); return; }
        navigator.geolocation.getCurrentPosition(
            position => {
                const origin = { lat: position.coords.latitude, lng: position.coords.longitude };
                setYouMarker([origin.lat, origin.lng]);
                resolve(origin);
            },
            () => resolve(null),
            { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
        );
    });
}

/**
 * انتخاب مکان مقصد از یک وظیفه/زیرکار
 * اولویت: task.location → نزدیک‌ترین session آینده با location → اولین session با location
 */
function pickDestination(task) {
    if (!task) return null;
    if (task.location) return task.location;

    const sessionsWithLoc = (task.sessions || []).filter(s => s && s.location);
    if (sessionsWithLoc.length === 0) return null;

    const now = Date.now();
    const upcoming = sessionsWithLoc
        .filter(s => new Date(s.at).getTime() >= now)
        .sort((a, b) => new Date(a.at) - new Date(b.at))[0];
    if (upcoming) return upcoming.location;

    // اگر همه گذشته‌اند، اولین session با location را برگردان
    return sessionsWithLoc[0].location;
}

// ═══════════════════════════════════════════════════════════════════════════
// Summary DOM
// ═══════════════════════════════════════════════════════════════════════════

function ensureSummary() {
    const wrap = document.querySelector('.map-wrap');
    if (!wrap) return null;
    let el = document.getElementById('routeSummary');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'routeSummary';
    el.className = 'route-summary';
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', 'انتخاب مسیر');
    wrap.appendChild(el);
    bindRouteSummary();
    return el;
}

function removeSummary() {
    const el = document.getElementById('routeSummary');
    if (el) el.remove();
}

// ═══════════════════════════════════════════════════════════════════════════
// Route drawing
// ═══════════════════════════════════════════════════════════════════════════

function hideActiveLayer() {
    const map = getMap();
    if (activeLayer && map) {
        map.removeLayer(activeLayer);
    }
    activeLayer = null;
}

// حذف کامل مسیر و پنل
function clearMapRoute() {
    clearTimeout(clearTimer);
    clearTimer = null;
    clearTimeout(liveRouteUpdateTimer);
    liveRouteUpdateTimer = null;
    if (controller) {
        controller.abort();
        controller = null;
    }
    hideActiveLayer();
    activeRoutes = null;
    activeTask = null;
    activeDestination = null;
    activeKey = 'car';
    summaryHidden = false;
    removeSummary();
    const btn = document.getElementById('routeClearBtn');
    if (btn) btn.style.display = 'none';
}

// فقط پنل را پنهان می‌کند، مسیر روی نقشه باقی می‌ماند
function hideSummaryOnly() {
    if (!activeRoutes || summaryHidden) return;
    summaryHidden = true;
    removeSummary();
}

function drawRoute(key, fit = true, showSummary = true) {
    const map = getMap();
    if (!activeRoutes || !activeRoutes[key] || !map) return;
    const route = activeRoutes[key];
    const profile = PROFILES.find(p => p.key === key) || PROFILES[0];
    hideActiveLayer();
    activeKey = key;
    if (showSummary) {
        summaryHidden = false;
    }
    activeLayer = L.polyline(
        route.geometry.coordinates.map(c => [c[1], c[0]]),
        { color: profile.color, weight: 5, opacity: .95, lineCap: 'round', lineJoin: 'round' }
    ).addTo(map);
    if (fit) map.flyToBounds(activeLayer.getBounds().pad(.2), { duration: .8 });
    if (showSummary) {
        renderSummary();
    }
}

function renderSummary() {
    const el = ensureSummary();
    if (!el || !activeRoutes) return;
    const title = activeTask ? `🧭 مسیر تا «${escapeHtml(activeTask.text)}»` : '🧭 مسیر';
    const rows = PROFILES.map(profile => {
        const route = activeRoutes[profile.key];
        const available = !!route;
        const active = activeKey === profile.key && available;
        const distance = available ? fmtDist(route.distance) : 'محاسبه نشد';
        const duration = available ? fmtDur(route.duration) : '';
        return `<button type="button" class="route-option${active ? ' is-active' : ''}${available ? '' : ' is-disabled'}" data-route-mode="${profile.key}" ${available ? '' : 'disabled'} style="--route-color:${profile.color}" aria-pressed="${active ? 'true' : 'false'}"><span class="route-option-main"><span class="route-option-icon">${profile.icon}</span><span class="route-option-name">${profile.label}</span></span><span class="route-option-info"><span>${distance}</span>${duration ? `<span>•</span><span>${duration}</span>` : ''}</span></button>`;
    }).join('');
    el.innerHTML = `<div class="route-summary-title"><button type="button" class="route-summary-close" data-route-close aria-label="بستن" title="بستن">×</button><span class="route-summary-title-text">${title}</span></div><div class="route-options">${rows}</div>`;
    bindRouteSummary();
}

// ═══════════════════════════════════════════════════════════════════════════
// Fetch route
// ═══════════════════════════════════════════════════════════════════════════

async function fetchRoute(profile, origin, destination, signal) {
    const coords = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
    const response = await fetch(`${profile.base}${coords}?overview=full&geometries=geojson`, { signal });
    if (!response.ok) throw new Error('route-request-failed');
    const data = await response.json();
    const route = data.routes && data.routes[0];
    if (!route || !route.geometry || !route.geometry.coordinates) throw new Error('route-empty');
    return route;
}

async function showRouteTo(taskId) {
    const found = findTask(taskId);
    const task = found ? found.task : null;
    if (!task) return;

    // انتخاب مکان مقصد (task.location یا session.location)
    const destination = pickDestination(task);
    if (!destination) return;

    ensureMapVisible();
    switchToTab('map');
    const ready = await waitForMapReady();
    if (!ready) {
        mapHint(i18nT('map.hint.mapNotReady'));
        return;
    }

    clearMapRoute(); // همیشه پاکسازی کامل قبل از مسیر جدید
    mapHint(i18nT('map.hint.calculatingRoute'));
    const origin = await getFreshOrigin();
    if (!origin) {
        mapHint(i18nT('map.hint.locationUnavailable'));
        return;
    }

    controller = new AbortController();
    const localController = controller;
    const timeout = setTimeout(() => localController.abort(), 20000);
    const results = {};
    try {
        for (let i = 0; i < PROFILES.length; i++) {
            if (localController.signal.aborted) throw new DOMException('Aborted', 'AbortError');
            const profile = PROFILES[i];
            try {
                results[profile.key] = await fetchRoute(profile, origin, destination, localController.signal);
            } catch (err) {
                if (err && err.name === 'AbortError') throw err;
                results[profile.key] = null;
            }
            if (i < PROFILES.length - 1) await wait(1100);
        }
        if (localController.signal.aborted || !getMap() || !getMapReady()) return;
        activeRoutes = results;
        activeTask = task;
        activeDestination = destination;
        summaryHidden = false;
        activeKey = results.car ? 'car' : (results.bike ? 'bike' : 'foot');
        if (!activeRoutes[activeKey]) throw new Error('no-route');
        drawRoute(activeKey);
        const btn = document.getElementById('routeClearBtn');
        if (btn) btn.style.display = '';
        clearTimer = setTimeout(() => clearMapRoute(), AUTO_CLEAR_MS);
        mapHint(i18nT('map.hint.routeSelectMode'), 5000);
    } catch (err) {
        if (err && err.name === 'AbortError') {
            if (getMapReady()) mapHint(i18nT('map.hint.routeStopped'));
        } else if (getMapReady()) {
            mapHint(i18nT('map.hint.routeFailed'));
        }
    } finally {
        clearTimeout(timeout);
        if (controller === localController) controller = null;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Live route update (وقتی ردیابی آنلاین فعال است)
// ═══════════════════════════════════════════════════════════════════════════

async function updateActiveRoute() {
    // اگر مسیری فعال نیست، کاری نکن
    if (!activeRoutes || !activeTask || !activeDestination) return;

    const map = getMap();
    if (!map || !getMapReady()) return;

    // موقعیت فعلی کاربر را از marker زنده بگیر
    const youMarker = getYouMarker();
    if (!youMarker) return;
    const ll = youMarker.getLatLng();

    const origin = { lat: ll.lat, lng: ll.lng };
    const destination = activeDestination;

    const currentKey = activeKey;
    const currentFit = false;

    if (controller) {
        controller.abort();
        controller = null;
    }
    controller = new AbortController();
    const localController = controller;

    const results = {};
    try {
        for (const profile of PROFILES) {
            if (localController.signal.aborted) return;
            try {
                results[profile.key] = await fetchRoute(profile, origin, destination, localController.signal);
            } catch (err) {
                if (err && err.name === 'AbortError') return;
                results[profile.key] = null;
            }
        }

        if (localController.signal.aborted || !getMap() || !getMapReady()) return;

        activeRoutes = results;
        if (!activeRoutes[currentKey]) {
            activeKey = results.car ? 'car' : (results.bike ? 'bike' : 'foot');
        } else {
            activeKey = currentKey;
        }
        if (!activeRoutes[activeKey]) return;

        drawRoute(activeKey, currentFit, !summaryHidden);

    } catch (err) {
        if (err && err.name === 'AbortError') return;
    } finally {
        if (controller === localController) controller = null;
    }
}

// گوش دادن به رویداد موقعیت زنده از map.js
window.addEventListener('rahe-live-position', () => {
    clearTimeout(liveRouteUpdateTimer);
    liveRouteUpdateTimer = setTimeout(() => {
        updateActiveRoute();
    }, 800);
});

// ═══════════════════════════════════════════════════════════════════════════
// Binding
// ═══════════════════════════════════════════════════════════════════════════

function bindRouteSummary() {
    const el = document.getElementById('routeSummary');
    if (!el || el.dataset.bound === 'true') return;
    el.dataset.bound = 'true';
    el.addEventListener('click', event => {
        const closeButton = event.target.closest('[data-route-close]');
        if (closeButton) {
            event.preventDefault();
            event.stopPropagation();
            hideSummaryOnly();
            return;
        }
        const button = event.target.closest('[data-route-mode]');
        if (!button || button.disabled || !activeRoutes) return;
        const key = button.dataset.routeMode;
        if (activeRoutes[key]) drawRoute(key);
    });
}

function bindClearButton() {
    if (clearButtonBound) return;
    const btn = document.getElementById('routeClearBtn');
    if (!btn) return;
    clearButtonBound = true;
    btn.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        clearMapRoute();
    });
}

function bindMapLifecycle() {
    const mapEl = document.getElementById('map');
    if (!mapEl || mapCaptureBound) return;
    mapCaptureBound = true;
    mapEl.addEventListener('click', event => {
        const routeButton = event.target.closest('[data-pproute]');
        if (routeButton) {
            event.preventDefault();
            event.stopImmediatePropagation();
            showRouteTo(routeButton.dataset.pproute);
            return;
        }
    }, true);
}

function bindMapInstance() {
    const map = getMap();
    if (map && map !== mapClickBoundTo) {
        mapClickBoundTo = map;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════════════════════════════════

function init() {
    bindMapLifecycle();
    bindClearButton();
    bindMapInstance();
    window.addEventListener('rahe-map-ready', bindMapInstance);
    window.addEventListener('rahe-map-destroy', () => {
        clearTimeout(liveRouteUpdateTimer);
        liveRouteUpdateTimer = null;
        clearMapRoute();
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
    init();
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

export { showRouteTo, clearMapRoute };

// برای map.js در چرخه‌ی live tracking
export function hasActiveRoute() {
    return Boolean(activeRoutes && activeTask && activeDestination);
}

export function getActiveRouteDestination() {
    return activeDestination || null;
}