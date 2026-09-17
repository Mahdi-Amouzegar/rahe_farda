// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// map-search.js -- جستجوی مکان با Nominatim (OpenStreetMap)

import { state } from './core.js';
import {
    mapHint,
    getMap,
    getMapReady,
    switchToTab,
    showPickMarker,
    removePickMarker
} from './map.js';
import { refreshSavedLocationUI } from './location-ui.js';

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const MIN_QUERY_LENGTH = 3;
const DEBOUNCE_MS = 500;
const MAX_RESULTS = 8;

// TTL برای کش نتایج جستجو — ۵ دقیقه
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_SIZE = 50;

// User-Agent معتبر طبق Usage Policy Nominatim
const USER_AGENT = 'RaheFarda/1.3 (https://github.com/Mahdi-Amouzegar/rahe_farda)';

// ═══════════════════════════════════════════════════════════════════════════
// Local state
// ═══════════════════════════════════════════════════════════════════════════

let debounceTimer = null;
let currentController = null;

// کش نتایج: کلید = query، مقدار = { results, fetchedAt }
const resultsCache = new Map();

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

// ═══════════════════════════════════════════════════════════════════════════
// Cache (با TTL)
// ═══════════════════════════════════════════════════════════════════════════

function getCached(query) {
    const entry = resultsCache.get(query);
    if (!entry) return null;
    if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
        resultsCache.delete(query);
        return null;
    }
    return entry.results;
}

function setCached(query, results) {
    if (resultsCache.size >= MAX_CACHE_SIZE) {
        const firstKey = resultsCache.keys().next().value;
        resultsCache.delete(firstKey);
    }
    resultsCache.set(query, { results, fetchedAt: Date.now() });
}

// ═══════════════════════════════════════════════════════════════════════════
// Nominatim fetch
// ═══════════════════════════════════════════════════════════════════════════

async function fetchPlaces(query, signal) {
    const cached = getCached(query);
    if (cached) return cached;

    const params = new URLSearchParams({
        q: query,
        format: 'json',
        addressdetails: '1',
        limit: String(MAX_RESULTS),
        'accept-language': state.prefs.lang === 'en' ? 'en' : 'fa'
    });

    const response = await fetch(`${NOMINATIM_URL}?${params}`, {
        signal,
        headers: {
            'Accept': 'application/json',
            'User-Agent': USER_AGENT
        }
    });

    if (!response.ok) {
        if (response.status === 403) throw new Error('blocked');
        if (response.status === 429) throw new Error('rate-limited');
        throw new Error('request-failed');
    }

    const data = await response.json();
    if (!Array.isArray(data)) return [];

    const results = data.map(item => ({
        id: item.place_id,
        name: item.name || item.display_name.split(',')[0] || 'مکان',
        displayName: item.display_name,
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon)
    })).filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lng));

    setCached(query, results);
    return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// DOM references
// ═══════════════════════════════════════════════════════════════════════════

let inputEl = null;
let clearBtnEl = null;
let resultsEl = null;

// ═══════════════════════════════════════════════════════════════════════════
// UI rendering
// ═══════════════════════════════════════════════════════════════════════════

function showLoading() {
    if (!resultsEl) return;
    resultsEl.innerHTML = '<div class="map-search-loading">در حال جستجو...</div>';
    resultsEl.style.display = '';
}

function showEmpty() {
    if (!resultsEl) return;
    resultsEl.innerHTML = '<div class="map-search-empty">مکانی یافت نشد</div>';
    resultsEl.style.display = '';
}

function showError(msg) {
    if (!resultsEl) return;
    resultsEl.innerHTML = `<div class="map-search-empty">${escapeHtml(msg)}</div>`;
    resultsEl.style.display = '';
}

function hideResults() {
    if (resultsEl) resultsEl.style.display = 'none';
    if (clearBtnEl) clearBtnEl.style.display = inputEl && inputEl.value ? '' : 'none';
}

function renderResults(results) {
    if (!resultsEl) return;
    if (!results.length) {
        showEmpty();
        return;
    }
    resultsEl.innerHTML = results.map((r, i) => {
        const title = r.name;
        const sub = r.displayName.length > 90 ? r.displayName.slice(0, 90) + '…' : r.displayName;
        return `<button type="button" class="map-search-item" data-search-idx="${i}" role="option">
            <span class="map-search-item-title">${escapeHtml(title)}</span>
            <span class="map-search-item-sub">${escapeHtml(sub)}</span>
        </button>`;
    }).join('');
    resultsEl.style.display = '';
    resultsEl._results = results;
}

// ═══════════════════════════════════════════════════════════════════════════
// Select a place
// ═══════════════════════════════════════════════════════════════════════════

async function selectPlace(place) {
    const map = getMap();
    if (!map || !getMapReady()) {
        mapHint('نقشه آماده نیست');
        return;
    }

    // پرواز به مکان
    map.flyTo([place.lat, place.lng], 15, { duration: 1.2 });

    // بستن نتایج
    hideResults();

    // ذخیره در pendingLoc — فقط مختصات (بدون name)
    // cityNames بعداً به صورت غیرهمزمان اضافه می‌شود
    state.pendingLoc = {
        lat: place.lat,
        lng: place.lng
    };
    showPickMarker();

    // نمایش locChip در فرم افزودن
    if (typeof refreshSavedLocationUI === 'function') refreshSavedLocationUI();

    // به‌روزرسانی input جستجو با نام
    if (inputEl) inputEl.value = place.name;

    // switch به تب وظایف
    switchToTab('tasks');

    // اسکرول به فرم افزودن و فوکوس
    setTimeout(() => {
        const inp = document.getElementById('taskInput');
        if (!inp) return;
        inp.scrollIntoView({ behavior: 'smooth', block: 'center' });
        inp.focus({ preventScroll: true });
    }, 60);

    mapHint('📍 محل انتخاب شد — عنوان وظیفه را بنویسید');

    // دریافت نام شهر برای cityNames (بدون نمایش در loc-chip)
    // ⚠️ reverse-geocode به صورت dynamic import می‌ماند تا chunk جداگانه بسازد
    (async () => {
        try {
            const { reverseGeocodeBilingual } = await import('./reverse-geocode.js');
            const names = await reverseGeocodeBilingual(place.lat, place.lng);
            if (state.pendingLoc &&
                state.pendingLoc.lat === place.lat &&
                state.pendingLoc.lng === place.lng) {
                if (names.fa || names.en) {
                    const cn = {};
                    if (names.fa) cn.fa = names.fa;
                    if (names.en) cn.en = names.en;
                    state.pendingLoc = { ...state.pendingLoc, cityNames: cn };
                }
            }
        } catch { /* silent */ }
    })();
}

// ═══════════════════════════════════════════════════════════════════════════
// Search flow
// ═══════════════════════════════════════════════════════════════════════════

async function performSearch(query) {
    if (currentController) {
        currentController.abort();
        currentController = null;
    }

    currentController = new AbortController();
    const localController = currentController;

    showLoading();

    try {
        const results = await fetchPlaces(query, localController.signal);
        if (localController.signal.aborted) return;
        renderResults(results);
    } catch (err) {
        if (err.name === 'AbortError') return;
        if (err.message === 'blocked') {
            showError('دسترسی به سرویس جستجو محدود شده است');
        } else if (err.message === 'rate-limited') {
            showError('تعداد درخواست‌ها زیاد است؛ کمی صبر کنید');
        } else {
            showError('جستجو ناموفق بود (اینترنت؟)');
        }
    } finally {
        if (currentController === localController) currentController = null;
    }
}

function onInput() {
    if (!inputEl) return;

    const query = inputEl.value.trim();

    if (clearBtnEl) clearBtnEl.style.display = query ? '' : 'none';

    clearTimeout(debounceTimer);

    if (query.length < MIN_QUERY_LENGTH) {
        hideResults();
        return;
    }

    debounceTimer = setTimeout(() => {
        performSearch(query);
    }, DEBOUNCE_MS);
}

function clearSearch() {
    if (inputEl) inputEl.value = '';
    if (clearBtnEl) clearBtnEl.style.display = 'none';
    hideResults();
    if (inputEl) inputEl.focus();
}

// ═══════════════════════════════════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════════════════════════════════

export function initMapSearch() {
    inputEl = document.getElementById('mapSearchInput');
    clearBtnEl = document.getElementById('mapSearchClear');
    resultsEl = document.getElementById('mapSearchResults');

    if (!inputEl || !resultsEl) return;

    inputEl.addEventListener('input', onInput);

    inputEl.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            hideResults();
            inputEl.blur();
        }
    });

    clearBtnEl?.addEventListener('click', clearSearch);

    resultsEl.addEventListener('click', e => {
        const btn = e.target.closest('[data-search-idx]');
        if (!btn) return;
        const idx = parseInt(btn.dataset.searchIdx, 10);
        const results = resultsEl._results || [];
        const place = results[idx];
        if (place) selectPlace(place);
    });

    document.addEventListener('click', e => {
        if (!resultsEl || resultsEl.style.display === 'none') return;
        if (e.target.closest('.map-search')) return;
        hideResults();
    });
}