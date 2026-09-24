// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// weather.js -- پیش‌بینی هوا با Open-Meteo

import { state, toFa } from './core.js';
import { nearestUpcoming, faShort } from './sessions.js';
import { findTask } from './store.js';
import { t as i18nT } from './i18n.js';

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
// Open-Meteo تا ۱۶ روز پیش‌بینی می‌دهد، اما برای اطمینان از اینکه endDate
// از محدوده خارج نشود، یک روز کمتر در نظر می‌گیریم.
const MAX_FORECAST_DAYS = 16;
const MAX_FORECAST_DAYS_SAFE = MAX_FORECAST_DAYS - 1;
const CACHE_TTL_MS = 30 * 60 * 1000; // ۳۰ دقیقه (کش داده کامل هوا)

// ─── کش پایدار آیکن (localStorage) ───
// این کش برای آیکن‌های کوچک استفاده می‌شود و از fetch تکراری در refresh
// صفحه جلوگیری می‌کند. کلید = lat|lng|date (چون آیکن روزانه است).
const ICON_CACHE_KEY = 'spaceTodoWeatherIcons';
const ICON_CACHE_TTL_MS = 3 * 60 * 60 * 1000; // ۳ ساعت
const ICON_CACHE_MAX = 100;

// کد وضعیت WMO → آیکن + برچسب فارسی
// کد وضعیت WMO → آیکن + کلید ترجمه
// ⚠️ labelKey به i18n کلید می‌دهد. متن نهایی از weather.wmo.* خوانده می‌شود.
const WMO_MAP = {
    0:  { icon: '☀️', labelKey: 'weather.wmo.clear' },
    1:  { icon: '🌤️', labelKey: 'weather.wmo.mainlyClear' },
    2:  { icon: '⛅', labelKey: 'weather.wmo.partlyCloudy' },
    3:  { icon: '☁️', labelKey: 'weather.wmo.overcast' },
    45: { icon: '🌫️', labelKey: 'weather.wmo.fog' },
    48: { icon: '🌫️', labelKey: 'weather.wmo.freezingFog' },
    51: { icon: '🌦️', labelKey: 'weather.wmo.lightDrizzle' },
    53: { icon: '🌦️', labelKey: 'weather.wmo.drizzle' },
    55: { icon: '🌦️', labelKey: 'weather.wmo.heavyDrizzle' },
    56: { icon: '🌧️', labelKey: 'weather.wmo.lightFreezingDrizzle' },
    57: { icon: '🌧️', labelKey: 'weather.wmo.freezingDrizzle' },
    61: { icon: '🌧️', labelKey: 'weather.wmo.lightRain' },
    63: { icon: '🌧️', labelKey: 'weather.wmo.rain' },
    65: { icon: '🌧️', labelKey: 'weather.wmo.heavyRain' },
    66: { icon: '🌧️', labelKey: 'weather.wmo.lightFreezingRain' },
    67: { icon: '🌧️', labelKey: 'weather.wmo.heavyFreezingRain' },
    71: { icon: '❄️', labelKey: 'weather.wmo.lightSnow' },
    73: { icon: '❄️', labelKey: 'weather.wmo.snow' },
    75: { icon: '❄️', labelKey: 'weather.wmo.heavySnow' },
    77: { icon: '❄️', labelKey: 'weather.wmo.snowGrains' },
    80: { icon: '🌧️', labelKey: 'weather.wmo.lightShowers' },
    81: { icon: '🌧️', labelKey: 'weather.wmo.showers' },
    82: { icon: '🌧️', labelKey: 'weather.wmo.violentShowers' },
    85: { icon: '🌨️', labelKey: 'weather.wmo.lightSnowShowers' },
    86: { icon: '🌨️', labelKey: 'weather.wmo.heavySnowShowers' },
    95: { icon: '⛈️', labelKey: 'weather.wmo.thunderstorm' },
    96: { icon: '⛈️', labelKey: 'weather.wmo.thunderstormLightHail' },
    99: { icon: '⛈️', labelKey: 'weather.wmo.thunderstormHeavyHail' }
};

// کش داده کامل هوا: کلید = `lat,lng,start,end` → مقدار = { data, fetchedAt }
const weatherCache = new Map();
const MAX_CACHE_SIZE = 100;

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function toDateString(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Icon Persistent Cache (localStorage)
// ═══════════════════════════════════════════════════════════════════════════

function loadIconCache() {
    try {
        const raw = localStorage.getItem(ICON_CACHE_KEY);
        if (!raw) return {};
        const data = JSON.parse(raw);
        if (!data || typeof data !== 'object') return {};
        const now = Date.now();
        // پاک‌سازی ورودی‌های منقضی
        const cleaned = {};
        for (const [k, v] of Object.entries(data)) {
            if (v && typeof v.t === 'number' && (now - v.t) < ICON_CACHE_TTL_MS) {
                cleaned[k] = v;
            }
        }
        return cleaned;
    } catch {
        return {};
    }
}

function saveIconCache(cache) {
    try {
        // محدود کردن به N ورودی جدیدتر
        const entries = Object.entries(cache)
            .sort((a, b) => (b[1].t || 0) - (a[1].t || 0))
            .slice(0, ICON_CACHE_MAX);
        localStorage.setItem(ICON_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch { /* storage full یا private mode — silent fail */ }
}

function iconCacheKey(lat, lng, date) {
    return `${lat.toFixed(3)}|${lng.toFixed(3)}|${date}`;
}

function getCachedIcon(lat, lng, date) {
    const cache = loadIconCache();
    const entry = cache[iconCacheKey(lat, lng, date)];
    if (!entry) return null;
    if ((Date.now() - entry.t) > ICON_CACHE_TTL_MS) return null;
    return entry.i || null;
}

function setCachedIcon(lat, lng, date, icon) {
    const cache = loadIconCache();
    cache[iconCacheKey(lat, lng, date)] = { i: icon, t: Date.now() };
    saveIconCache(cache);
}

// ═══════════════════════════════════════════════════════════════════════════
// Eligibility
// ═══════════════════════════════════════════════════════════════════════════

/**
 * بررسی می‌کند که آیا یک وظیفه واجد شرط نمایش هوا است.
 * شرط: وظیفه مکان دارد AND نزدیک‌ترین سررسید آینده در بازه مجاز است.
 * @param {object} task
 * @returns {boolean}
 */
export function isWeatherEligible(task) {
    if (!task || !task.location) return false;
    const next = nearestUpcoming(task);
    if (!next) return false;
    const due = new Date(next.at).getTime();
    if (!Number.isFinite(due)) return false;
    const now = Date.now();
    const daysAhead = (due - now) / 86400000;
    return daysAhead >= 0 && daysAhead <= MAX_FORECAST_DAYS;
}

/**
 * نزدیک‌ترین سررسید واجد شرط را برمی‌گرداند.
 * @param {object} task
 * @returns {{ at: string, location: object } | null}
 */
export function getWeatherSession(task) {
    if (!isWeatherEligible(task)) return null;
    const next = nearestUpcoming(task);
    if (!next) return null;
    return { at: next.at, location: task.location };
}

// ═══════════════════════════════════════════════════════════════════════════
// Weather Cache (in-memory، داده کامل)
// ═══════════════════════════════════════════════════════════════════════════

function cacheKey(lat, lng, startStr, endStr) {
    return `${lat.toFixed(4)},${lng.toFixed(4)},${startStr},${endStr}`;
}

function getFromCache(key) {
    const entry = weatherCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
        weatherCache.delete(key);
        return null;
    }
    return entry.data;
}

function setCache(key, data) {
    if (weatherCache.size >= MAX_CACHE_SIZE) {
        const firstKey = weatherCache.keys().next().value;
        weatherCache.delete(firstKey);
    }
    weatherCache.set(key, { data, fetchedAt: Date.now() });
}

// ═══════════════════════════════════════════════════════════════════════════
// Fetch weather
// ═══════════════════════════════════════════════════════════════════════════

/**
 * محاسبه‌ی بازه‌ی هوشمند برای یک تاریخ سررسید.
 *
 * بازه = [target-1, target+3] با کلمپ به [today, today+MAX_SAFE]
 * کلمپ بالا به MAX_FORECAST_DAYS_SAFE انجام می‌شود تا از خطای API جلوگیری شود.
 *
 * @param {string} isoDate
 * @returns {{ startStr: string, endStr: string } | null}
 */
export function computeDateRange(isoDate) {
    const target = new Date(isoDate);
    if (isNaN(target)) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // سقف مجاز API (کمی محافظه‌کارانه‌تر از ۱۶)
    const maxDate = new Date(today);
    maxDate.setDate(maxDate.getDate() + MAX_FORECAST_DAYS_SAFE);

    const startDate = new Date(target);
    startDate.setHours(0, 0, 0, 0);
    startDate.setDate(startDate.getDate() - 1);
    if (startDate < today) startDate.setTime(today.getTime());

    const endDate = new Date(target);
    endDate.setHours(0, 0, 0, 0);
    endDate.setDate(endDate.getDate() + 3);
    if (endDate > maxDate) endDate.setTime(maxDate.getTime());

    if (startDate > endDate) return null;

    return {
        startStr: toDateString(startDate),
        endStr: toDateString(endDate)
    };
}

/**
 * پیش‌بینی هوا را برای مکان و بازه‌ی مشخص دریافت می‌کند.
 * @param {{ lat: number, lng: number }} location
 * @param {string} isoDate - تاریخ سررسید
 * @returns {Promise<object | null>}
 */
export async function fetchWeather(location, isoDate) {
    if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lng)) return null;

    const range = computeDateRange(isoDate);
    if (!range) return null;

    const { startStr, endStr } = range;
    const key = cacheKey(location.lat, location.lng, startStr, endStr);
    const cached = getFromCache(key);
    if (cached) return cached;

    const params = new URLSearchParams({
        latitude: String(location.lat),
        longitude: String(location.lng),
        timezone: 'auto',
        start_date: startStr,
        end_date: endStr,
        hourly: [
            'temperature_2m',
            'apparent_temperature',
            'relative_humidity_2m',
            'precipitation_probability',
            'precipitation',
            'wind_speed_10m',
            'weather_code'
        ].join(','),
        daily: [
            'temperature_2m_max',
            'temperature_2m_min',
            'precipitation_sum',
            'precipitation_probability_max',
            'wind_speed_10m_max',
            'weather_code'
        ].join(',')
    });

    try {
        const response = await fetch(`${OPEN_METEO_URL}?${params}`);
        if (!response.ok) {
            if (response.status === 429) throw new Error('rate-limited');
            throw new Error('request-failed');
        }
        const data = await response.json();
        if (data.error) throw new Error('api-error');

        setCache(key, data);
        return data;
    } catch (err) {
        if (err && err.message === 'rate-limited') {
            console.warn('Open-Meteo rate limit hit');
        }
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Extract helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * پیدا کردن ایندکس روز مشخص در آرایه‌ی daily
 * @param {object} weatherData
 * @param {string} isoDate
 * @returns {number} - ایندکس یا -1
 */
export function findDayIndex(weatherData, isoDate) {
    if (!weatherData || !weatherData.daily || !Array.isArray(weatherData.daily.time)) return -1;
    const target = new Date(isoDate);
    if (isNaN(target)) return -1;
    const targetStr = toDateString(target);
    return weatherData.daily.time.indexOf(targetStr);
}

/**
 * استخراج داده‌ی روز مشخص (بر اساس ایندکس در آرایه‌ی daily)
 * @param {object} weatherData
 * @param {number} dayIndex
 * @returns {object | null}
 */
export function extractDailyByIndex(weatherData, dayIndex) {
    if (!weatherData || !weatherData.daily) return null;
    const d = weatherData.daily;
    if (!Array.isArray(d.time) || dayIndex < 0 || dayIndex >= d.time.length) return null;
    const code = d.weather_code?.[dayIndex];
    const labelKey = WMO_MAP[code]?.labelKey;
    return {
        date: d.time[dayIndex],
        tempMax: d.temperature_2m_max?.[dayIndex],
        tempMin: d.temperature_2m_min?.[dayIndex],
        precipitationSum: d.precipitation_sum?.[dayIndex],
        precipitationProbMax: d.precipitation_probability_max?.[dayIndex],
        windSpeedMax: d.wind_speed_10m_max?.[dayIndex],
        weatherCode: code,
        icon: WMO_MAP[code]?.icon || '🌡️',
        label: labelKey ? i18nT(labelKey) : i18nT('weather.wmo.unknown')
    };
}

/**
 * استخراج داده‌ی نزدیک‌ترین ساعت به زمان مشخص
 * @param {object} weatherData
 * @param {string} isoDate
 * @returns {object | null}
 */
export function extractHourlyAt(weatherData, isoDate) {
    if (!weatherData || !weatherData.hourly || !weatherData.hourly.time) return null;
    const target = new Date(isoDate);
    if (isNaN(target)) return null;

    const times = weatherData.hourly.time;
    let bestIdx = -1;
    let bestDiff = Infinity;
    for (let i = 0; i < times.length; i++) {
        const t = new Date(times[i]);
        const diff = Math.abs(t.getTime() - target.getTime());
        if (diff < bestDiff) {
            bestDiff = diff;
            bestIdx = i;
        }
    }
    if (bestIdx < 0) return null;

    const h = weatherData.hourly;
    const code = h.weather_code?.[bestIdx];
    const labelKey = WMO_MAP[code]?.labelKey;
    return {
        time: h.time[bestIdx],
        temperature: h.temperature_2m?.[bestIdx],
        apparent: h.apparent_temperature?.[bestIdx],
        humidity: h.relative_humidity_2m?.[bestIdx],
        precipitationProb: h.precipitation_probability?.[bestIdx],
        precipitation: h.precipitation?.[bestIdx],
        windSpeed: h.wind_speed_10m?.[bestIdx],
        weatherCode: code,
        icon: WMO_MAP[code]?.icon || '🌡️',
        label: labelKey ? i18nT(labelKey) : i18nT('weather.wmo.unknown')
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// Quick icon (برای نمایش در task list)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * آیکن سریع برای نمایش روی کارت وظیفه.
 *
 * جریان کش (سه لایه):
 *  1. localStorage (persistent, TTL 3 ساعت) — چک اول
 *  2. weatherCache در حافظه (TTL 30 دقیقه) — از fetchWeather
 *  3. fetch از Open-Meteo
 *
 * @param {object} task
 * @returns {Promise<string | null>} - آیکن (مثل '☀️') یا null در صورت عدم امکان
 */
export async function getWeatherIcon(task) {
    const session = getWeatherSession(task);
    if (!session) return null;

    const date = toDateString(new Date(session.at));
    const loc = session.location;

    // Layer 1: localStorage
    const persistentCached = getCachedIcon(loc.lat, loc.lng, date);
    if (persistentCached) return persistentCached;

    // Layer 2 & 3: fetchWeather (با کش in-memory)
    const data = await fetchWeather(loc, session.at);
    if (!data) return null;
    const dayIdx = findDayIndex(data, session.at);
    if (dayIdx < 0) return null;
    const daily = extractDailyByIndex(data, dayIdx);
    if (!daily) return null;

    // ذخیره در localStorage برای دفعات بعد
    setCachedIcon(loc.lat, loc.lng, date, daily.icon);
    return daily.icon;
}

/**
 * پاک‌سازی کش پایدار آیکن‌ها.
 * مفید برای دیباگ یا وقتی کاربر می‌خواهد داده‌ها را ریست کند.
 */
export function clearIconCache() {
    try {
        localStorage.removeItem(ICON_CACHE_KEY);
    } catch { /* silent */ }
}