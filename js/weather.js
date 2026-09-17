// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// weather.js -- پیش‌بینی هوا با Open-Meteo

import { state, toFa } from './core.js';
import { nearestUpcoming, faShort } from './sessions.js';
import { findTask } from './store.js';

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
const MAX_FORECAST_DAYS = 16;
const CACHE_TTL_MS = 30 * 60 * 1000; // ۳۰ دقیقه

// کد وضعیت WMO → آیکن + برچسب فارسی
const WMO_MAP = {
    0:  { icon: '☀️', label: 'صاف' },
    1:  { icon: '🌤️', label: 'عمدتاً صاف' },
    2:  { icon: '⛅', label: 'کمی ابری' },
    3:  { icon: '☁️', label: 'ابری' },
    45: { icon: '🌫️', label: 'مه' },
    48: { icon: '🌫️', label: 'مه یخ‌زده' },
    51: { icon: '🌦️', label: 'نم‌نم باران سبک' },
    53: { icon: '🌦️', label: 'نم‌نم باران' },
    55: { icon: '🌦️', label: 'نم‌نم باران شدید' },
    56: { icon: '🌧️', label: 'باران یخ‌زده سبک' },
    57: { icon: '🌧️', label: 'باران یخ‌زده' },
    61: { icon: '🌧️', label: 'باران سبک' },
    63: { icon: '🌧️', label: 'باران' },
    65: { icon: '🌧️', label: 'باران شدید' },
    66: { icon: '🌧️', label: 'باران یخ‌زده سبک' },
    67: { icon: '🌧️', label: 'باران یخ‌زده شدید' },
    71: { icon: '❄️', label: 'برف سبک' },
    73: { icon: '❄️', label: 'برف' },
    75: { icon: '❄️', label: 'برف شدید' },
    77: { icon: '❄️', label: 'دانه‌های برف' },
    80: { icon: '🌧️', label: 'رگبار سبک' },
    81: { icon: '🌧️', label: 'رگبار' },
    82: { icon: '🌧️', label: 'رگبار شدید' },
    85: { icon: '🌨️', label: 'رگبار برف سبک' },
    86: { icon: '🌨️', label: 'رگبار برف شدید' },
    95: { icon: '⛈️', label: 'رعد و برق' },
    96: { icon: '⛈️', label: 'رعد و برق با تگرگ سبک' },
    99: { icon: '⛈️', label: 'رعد و برق با تگرگ' }
};

// کش: کلید = `lat,lng,start,end` → مقدار = { data, fetchedAt }
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

/**
 * بررسی می‌کند که آیا یک وظیفه واجد شرط نمایش هوا است.
 * @param {object} task
 * @returns {boolean}
 */
export function isWeatherEligible(task) {
    if (!task || !task.location) return false;
    const next = nearestUpcoming(task);
    if (!next) return false;
    const due = new Date(next.at).getTime();
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
 * @param {string} isoDate
 * @returns {{ startStr: string, endStr: string } | null}
 */
export function computeDateRange(isoDate) {
    const target = new Date(isoDate);
    if (isNaN(target)) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const maxDate = new Date(today);
    maxDate.setDate(maxDate.getDate() + MAX_FORECAST_DAYS);

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
// Extract helpers (جدید)
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
    return {
        date: d.time[dayIndex],
        tempMax: d.temperature_2m_max?.[dayIndex],
        tempMin: d.temperature_2m_min?.[dayIndex],
        precipitationSum: d.precipitation_sum?.[dayIndex],
        precipitationProbMax: d.precipitation_probability_max?.[dayIndex],
        windSpeedMax: d.wind_speed_10m_max?.[dayIndex],
        weatherCode: code,
        icon: WMO_MAP[code]?.icon || '🌡️',
        label: WMO_MAP[code]?.label || 'نامشخص'
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
        label: WMO_MAP[code]?.label || 'نامشخص'
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// Extract helpers (قدیمی — برای سازگاری)
// ═══════════════════════════════════════════════════════════════════════════

export function extractHourly(weatherData, isoDate) {
    return extractHourlyAt(weatherData, isoDate);
}

export function extractDaily(weatherData) {
    return extractDailyByIndex(weatherData, 0);
}

/**
 * آیکن سریع برای نمایش روی کارت وظیفه.
 * @param {object} task
 * @returns {Promise<string | null>}
 */
export async function getWeatherIcon(task) {
    const session = getWeatherSession(task);
    if (!session) return null;
    const data = await fetchWeather(session.location, session.at);
    if (!data) return null;
    const dayIdx = findDayIndex(data, session.at);
    const daily = extractDailyByIndex(data, dayIdx >= 0 ? dayIdx : 0);
    return daily ? daily.icon : null;
}