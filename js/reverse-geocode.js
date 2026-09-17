// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// reverse-geocode.js -- تبدیل مختصات به نام شهر با Nominatim (fa + en)

import { state } from './core.js';

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const NOMINATIM_REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';
const USER_AGENT = 'RaheFarda/1.3 (https://github.com/Mahdi-Amouzegar/rahe_farda)';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // ۲۴ ساعت

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

function extractCityName(data) {
    const a = data && data.address ? data.address : {};
    return a.city || a.town || a.village || a.municipality ||
           a.county || a.state || a.country || null;
}

// صف درخواست‌ها برای رعایت Rate Limit (۱ درخواست در ثانیه)
let lastRequestTime = 0;
const MIN_INTERVAL_MS = 1100;
const queue = [];
let processing = false;

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
// Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * تبدیل مختصات به نام شهر
 * @param {number} lat
 * @param {number} lng
 * @param {'fa' | 'en'} lang
 * @returns {Promise<string | null>}
 */
export function reverseGeocode(lat, lng, lang) {
    if (!Number.isFinite(+lat) || !Number.isFinite(+lng)) return Promise.resolve(null);
    const language = lang === 'en' ? 'en' : 'fa';
    const key = `${(+lat).toFixed(5)},${(+lng).toFixed(5)},${language}`;
    const cached = getCached(key);
    if (cached !== null) return Promise.resolve(cached);

    return enqueue(async () => {
        const params = new URLSearchParams({
            lat: String(lat),
            lon: String(lng),
            format: 'json',
            zoom: '10',
            'accept-language': language
        });

        try {
            const response = await fetch(`${NOMINATIM_REVERSE_URL}?${params}`, {
                headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' }
            });
            if (!response.ok) return null;
            const data = await response.json();
            const name = extractCityName(data);
            if (name) setCached(key, name);
            return name;
        } catch {
            return null;
        }
    });
}

/**
 * دریافت نام دو زبانه (فارسی + انگلیسی)
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<{ fa: string | null, en: string | null }>}
 */
export async function reverseGeocodeBilingual(lat, lng) {
    const [fa, en] = await Promise.all([
        reverseGeocode(lat, lng, 'fa'),
        reverseGeocode(lat, lng, 'en')
    ]);
    return { fa, en };
}