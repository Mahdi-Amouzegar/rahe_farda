// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// reverse-geocode.js -- تبدیل مختصات به نام شهر با Nominatim (fa + en در یک درخواست)

import { state } from './core.js';

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const NOMINATIM_REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';
const USER_AGENT = 'RaheFarda/1.3 (https://github.com/Mahdi-Amouzegar/rahe_farda)';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // ۲۴ ساعت

// صف درخواست‌ها برای رعایت Rate Limit (۱ درخواست در ثانیه)
let lastRequestTime = 0;
const MIN_INTERVAL_MS = 1100;
const queue = [];
let processing = false;

// ═══════════════════════════════════════════════════════════════════════════
// Cache
// ═══════════════════════════════════════════════════════════════════════════

const cache = new Map();
const MAX_CACHE_SIZE = 200;

function getCached(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
        cache.delete(key);
        return null;
    }
    return entry.data;
}

function setCached(key, data) {
    if (cache.size >= MAX_CACHE_SIZE) {
        const firstKey = cache.keys().next().value;
        cache.delete(firstKey);
    }
    cache.set(key, { data, fetchedAt: Date.now() });
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * استخراج نام شهر از پاسخ Nominatim.
 *
 * با accept-language: fa,en، Nominatim نام‌ها را به شکل زیر برمی‌گرداند:
 *  - address.city / address.town / address.village ...
 *  - اگر چند زبان درخواست شده باشد، ممکن است name:fa و name:en داشته باشد
 *  - در غیر این صورت name (به زبان ترجیحی) یا display_name
 *
 * اولویت: نام شهر → شهرک → روستا → شهرداری → شهرستان → استان → کشور
 */
function extractCityName(address) {
    if (!address || typeof address !== 'object') return null;
    const candidates = [
        address.city,
        address.town,
        address.village,
        address.municipality,
        address.county,
        address.state,
        address.country
    ];
    for (const c of candidates) {
        if (typeof c === 'string' && c.trim()) return c.trim();
    }
    return null;
}

/**
 * استخراج نام‌های دو زبانه از یک پاسخ Nominatim.
 * @param {object} data
 * @returns {{ fa: string|null, en: string|null }}
 */
function extractBilingualNames(data) {
    if (!data) return { fa: null, en: null };

    const address = data.address || {};

    // ۱. اگر Nominatim فیلدهای نام دو زبانه را برگردانده باشد
    //    (وقتی accept-language: fa,en باشد و داده در OSM موجود باشد)
    const faFromData = data['name:fa'] || address['city:fa'] || address['town:fa'] || address['name:fa'];
    const enFromData = data['name:en'] || address['city:en'] || address['town:en'] || address['name:en'];

    // ۲. اگر پاسخ با accept-language مشخص برگشته باشد، language field دارد
    //    Nominatim از فیلدهای داخلی استفاده می‌کند و ممکن است مفید باشد
    const langPref = data.lang || null;

    // ۳. استخراج نام پیش‌فرض بر اساس ترتیب اولویت شهری
    const defaultName = extractCityName(address);

    // ساخت خروجی
    let fa = faFromData || null;
    let en = enFromData || null;

    // اگر یکی از این‌ها موجود نیست، از defaultName استفاده کن
    if (!fa && !en && defaultName) {
        if (langPref === 'fa' || /[\u0600-\u06FF]/.test(defaultName)) {
            fa = defaultName;
        } else {
            en = defaultName;
        }
    } else if (fa && !en) {
        // اگر fa داریم ولی en نداریم، شاید همان نام، قابل استفاده برای en نیست
        // (چون فارسی است) — پس en = null
        // ولی اگر defaultName انگلیسی است، استفاده کن
        if (defaultName && !/[\u0600-\u06FF]/.test(defaultName) && defaultName !== fa) {
            en = defaultName;
        }
    } else if (en && !fa) {
        // اگر en داریم ولی fa نداریم، شاید defaultName فارسی است
        if (defaultName && /[\u0600-\u06FF]/.test(defaultName) && defaultName !== en) {
            fa = defaultName;
        }
    }

    return { fa: fa || null, en: en || null };
}

// ═══════════════════════════════════════════════════════════════════════════
// Queue (Rate Limit)
// ═══════════════════════════════════════════════════════════════════════════

function enqueue(fn) {
    return new Promise((resolve, reject) => {
        queue.push({ fn, resolve, reject });
        processQueue();
    });
}

async function processQueue() {
    if (processing) return;
    if (queue.length === 0) return;
    processing = true;
    while (queue.length > 0) {
        const now = Date.now();
        const wait = Math.max(0, MIN_INTERVAL_MS - (now - lastRequestTime));
        if (wait > 0) {
            await new Promise(r => setTimeout(r, wait));
        }
        const item = queue.shift();
        lastRequestTime = Date.now();
        try {
            const result = await item.fn();
            item.resolve(result);
        } catch (err) {
            item.reject(err);
        }
    }
    processing = false;
}

// ═══════════════════════════════════════════════════════════════════════════
// Core fetch (single request, bilingual)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * یک درخواست Nominatim برای دریافت نام دو زبانه.
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<{ fa: string|null, en: string|null } | null>}
 */
async function fetchBilingual(lat, lng) {
    const params = new URLSearchParams({
        lat: String(lat),
        lon: String(lng),
        format: 'json',
        zoom: '10',
        addressdetails: '1',
        // درخواست هر دو زبان در یک رفت‌و‌برگشت
        'accept-language': 'fa,en'
    });

    try {
        const response = await fetch(`${NOMINATIM_REVERSE_URL}?${params}`, {
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'application/json'
            }
        });
        if (!response.ok) return null;
        const data = await response.json();
        if (!data || data.error) return null;
        return extractBilingualNames(data);
    } catch {
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * تبدیل مختصات به نام شهر (به زبان مشخص).
 * @param {number} lat
 * @param {number} lng
 * @param {'fa' | 'en'} lang
 * @returns {Promise<string | null>}
 */
export function reverseGeocode(lat, lng, lang) {
    if (!Number.isFinite(+lat) || !Number.isFinite(+lng)) return Promise.resolve(null);
    const language = lang === 'en' ? 'en' : 'fa';
    const key = `${(+lat).toFixed(5)},${(+lng).toFixed(5)}`;
    const cached = getCached(key);
    if (cached) return Promise.resolve(cached[language] || null);

    return enqueue(async () => {
        const names = await fetchBilingual(lat, lng);
        if (!names) return null;
        setCached(key, names);
        return names[language] || null;
    });
}

/**
 * دریافت نام دو زبانه (فارسی + انگلیسی) در یک درخواست واحد.
 *
 * در نسخه‌ی قبلی، این تابع دو درخواست موازی می‌فرستاد. اکنون یک درخواست
 * با accept-language: fa,en می‌فرستد و هر دو نام را استخراج می‌کند.
 * این باعث کاهش ۵۰٪ در تعداد درخواست‌ها به Nominatim می‌شود.
 *
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<{ fa: string | null, en: string | null }>}
 */
export async function reverseGeocodeBilingual(lat, lng) {
    if (!Number.isFinite(+lat) || !Number.isFinite(+lng)) {
        return { fa: null, en: null };
    }
    const key = `${(+lat).toFixed(5)},${(+lng).toFixed(5)}`;
    const cached = getCached(key);
    if (cached) {
        return { fa: cached.fa || null, en: cached.en || null };
    }

    return enqueue(async () => {
        const names = await fetchBilingual(lat, lng);
        if (!names) return { fa: null, en: null };
        setCached(key, names);
        return { fa: names.fa || null, en: names.en || null };
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// Cache management (اختیاری)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * پاک کردن کش reverse-geocode.
 * مفید برای دیباگ یا وقتی کاربر می‌خواهد داده‌ها را ریست کند.
 */
export function clearReverseGeocodeCache() {
    cache.clear();
}