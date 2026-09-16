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
let activeKey = 'car';
let activeLayer = null;
let controller = null;
let clearTimer = null;
let mapClickBoundTo = null;
let clearButtonBound = false;
let mapCaptureBound = false;
let summaryHidden = false; // آیا پنل route-summary پنهان است؟
let liveRouteUpdateTimer = null; // debounce برای به‌روزرسانی مسیر در حالت ردیابی آنلاین

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
    if (!task || !task.location) return;
    ensureMapVisible();
    switchToTab('map');
    const ready = await waitForMapReady();
    if (!ready) {
        mapHint('نقشه هنوز آماده نشده است؛ دوباره تلاش کنید');
        return;
    }

    clearMapRoute(); // همیشه پاکسازی کامل قبل از مسیر جدید
    mapHint('در حال دریافت موقعیت فعلی و محاسبه مسیر برای خودرو، دوچرخه و پیاده...');
    const origin = await getFreshOrigin();
    if (!origin) {
        mapHint('دسترسی به موقعیت فعلی ممکن نیست؛ مجوز موقعیت مکانی را بررسی کنید');
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
                results[profile.key] = await fetchRoute(profile, origin, task.location, localController.signal);
            } catch (err) {
                if (err && err.name === 'AbortError') throw err;
                results[profile.key] = null;
            }
            if (i < PROFILES.length - 1) await wait(1100);
        }
        if (localController.signal.aborted || !getMap() || !getMapReady()) return;
        activeRoutes = results;
        activeTask = task;
        summaryHidden = false;
        activeKey = results.car ? 'car' : (results.bike ? 'bike' : 'foot');
        if (!activeRoutes[activeKey]) throw new Error('no-route');
        drawRoute(activeKey);
        const btn = document.getElementById('routeClearBtn');
        if (btn) btn.style.display = '';
        clearTimer = setTimeout(() => clearMapRoute(), AUTO_CLEAR_MS);
        mapHint('یک شیوه را انتخاب کنید تا مسیر همان شیوه روی نقشه نمایش داده شود.', 5000);
    } catch (err) {
        if (err && err.name === 'AbortError') {
            if (getMapReady()) mapHint('محاسبه مسیر متوقف شد');
        } else if (getMapReady()) {
            mapHint('مسیریابی ناموفق بود (اینترنت؟)');
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
    if (!activeRoutes || !activeTask || !activeTask.location) return;

    const map = getMap();
    if (!map || !getMapReady()) return;

    // موقعیت فعلی کاربر را از marker زنده بگیر
    const youMarker = getYouMarker();
    if (!youMarker) return;
    const ll = youMarker.getLatLng();

    const origin = { lat: ll.lat, lng: ll.lng };
    const destination = activeTask.location;

    // ذخیره‌ی حالت فعلی (کدام profile فعال بود)
    const currentKey = activeKey;
    const currentFit = false;  // در حالت live، نقشه نباید دوباره fit شود

    // محاسبه‌ی مجدد مسیرها
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
        // silent fail — مسیر قدیمی روی نقشه می‌ماند
    } finally {
        if (controller === localController) controller = null;
    }
}

// گوش دادن به رویداد موقعیت زنده از map.js
window.addEventListener('rahe-live-position', () => {
    // debounce برای جلوگیری از محاسبه‌ی مکرر
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
            // بستن پنل: فقط UI پنهان می‌شود، مسیر روی نقشه می‌ماند
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
        // همیشه حذف کامل مسیر و پنل
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
        // توجه: کلیک روی نقشه هیچ تأثیری روی مسیر فعال ندارد.
        // کاربر باید بتواند آزادانه pan/zoom کند.
    }, true);
}

function bindMapInstance() {
    const map = getMap();
    if (map && map !== mapClickBoundTo) {
        mapClickBoundTo = map;
        // نکته: هیچ listener کلیکی روی نقشه برای مسیر ثبت نمی‌کنیم.
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
    return Boolean(activeRoutes && activeTask && activeTask.location);
}

export function getActiveRouteDestination() {
    return activeTask && activeTask.location ? activeTask.location : null;
}