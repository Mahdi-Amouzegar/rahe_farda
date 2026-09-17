// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// weather-modal.js -- مودال نمایش پیش‌بینی هوا با Open-Meteo

import { state, toFa, escapeHtml, trapFocus } from './core.js';
import { faShort, nearestUpcoming } from './sessions.js';
import { findTask } from './store.js';
import {
    fetchWeather,
    extractHourlyAt,
    extractDailyByIndex,
    findDayIndex,
    computeDateRange
} from './weather.js';

// ═══════════════════════════════════════════════════════════════════════════
// Local state
// ═══════════════════════════════════════════════════════════════════════════

let _weatherTrapCleanup = null;

// state مودال برای ناوبری بین روزها
let _currentTaskId = null;
let _currentSessionDate = null;
let _currentLocation = null;
let _currentWeatherData = null;
let _currentDayIndex = 0;

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function faTemp(n) {
    if (n == null || !Number.isFinite(+n)) return '—';
    return toFa(Math.round(+n)) + '°';
}

function faNum(n, unit) {
    if (n == null || !Number.isFinite(+n)) return '—';
    return toFa(Math.round(+n)) + (unit ? ' ' + unit : '');
}

/**
 * نام مکان برای نمایش در مودال هوا
 * اولویت: cityNames (نام شهر) → names (نام مکان) → name → مختصات
 */
function formatPlace(loc) {
    if (!loc) return '';
    const lang = state.prefs.lang === 'en' ? 'en' : 'fa';

    // ۱. نام شهر (cityNames) — خودکار از reverse geocode
    if (loc.cityNames) {
        const city = loc.cityNames[lang] || loc.cityNames.fa || loc.cityNames.en;
        if (city) return city;
    }

    // ۲. نام مکان ذخیره‌شده (names یا name)
    if (loc.names) {
        const preferred = loc.names[lang] || loc.names.fa || loc.names.en;
        if (preferred) return preferred;
    }
    if (typeof loc.name === 'string' && loc.name.trim()) return loc.name.trim();

    // ۳. مختصات
    return `${toFa(loc.lat)}، ${toFa(loc.lng)}`;
}

function resetModalState() {
    _currentTaskId = null;
    _currentSessionDate = null;
    _currentLocation = null;
    _currentWeatherData = null;
    _currentDayIndex = 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// Open / Close
// ═══════════════════════════════════════════════════════════════════════════

function openModal() {
    const modal = document.getElementById('weatherModal');
    if (!modal) return;
    modal.style.display = 'flex';
    if (_weatherTrapCleanup) _weatherTrapCleanup();
    _weatherTrapCleanup = trapFocus(modal);
    const closeBtn = document.getElementById('weatherModalOk');
    if (closeBtn) setTimeout(() => closeBtn.focus(), 60);
}

function closeModal() {
    if (_weatherTrapCleanup) {
        _weatherTrapCleanup();
        _weatherTrapCleanup = null;
    }
    const modal = document.getElementById('weatherModal');
    if (modal) modal.style.display = 'none';
    resetModalState();
}

function setContent(html) {
    const content = document.getElementById('weatherContent');
    if (content) content.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════════════════════
// Render
// ═══════════════════════════════════════════════════════════════════════════

function toDateStringOf(isoDate) {
    const d = new Date(isoDate);
    if (isNaN(d)) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function renderWeatherView() {
    if (!_currentWeatherData) return;

    const daily = extractDailyByIndex(_currentWeatherData, _currentDayIndex);
    const hourly = extractHourlyAt(_currentWeatherData, _currentSessionDate);

    if (!daily) {
        setContent('<div class="weather-error">داده‌ای برای این روز موجود نیست.</div>');
        return;
    }

    const task = findTask(_currentTaskId);
    const taskText = task ? task.task.text : '';
    const placeName = formatPlace(_currentLocation);

    const totalDays = _currentWeatherData.daily.time.length;
    const canPrev = _currentDayIndex > 0;
    const canNext = _currentDayIndex < totalDays - 1;

    // تاریخ روز جاری (بر اساس زبان)
    const currentDayDate = new Date(_currentWeatherData.daily.time[_currentDayIndex]);
    let dayLabel = '';
    try {
        dayLabel = currentDayDate.toLocaleDateString(
            state.prefs.lang === 'en' ? 'en-US' : 'fa-IR',
            { weekday: 'long', day: 'numeric', month: 'long' }
        );
    } catch {
        dayLabel = _currentWeatherData.daily.time[_currentDayIndex];
    }

    // آیا روز جاری همان روز سررسید است؟
    const isTargetDay = _currentWeatherData.daily.time[_currentDayIndex] ===
                        toDateStringOf(_currentSessionDate);

    const hourlyHTML = hourly ? `
        <div class="weather-grid">
            <div class="weather-item"><span>دما (ساعت سررسید)</span><strong>${faTemp(hourly.temperature)}C</strong></div>
            <div class="weather-item"><span>احساس</span><strong>${faTemp(hourly.apparent)}C</strong></div>
            <div class="weather-item"><span>رطوبت</span><strong>${faNum(hourly.humidity, '%')}</strong></div>
            <div class="weather-item"><span>باد</span><strong>${faNum(hourly.windSpeed, 'km/h')}</strong></div>
            <div class="weather-item"><span>احتمال بارش</span><strong>${faNum(hourly.precipitationProb, '%')}</strong></div>
            <div class="weather-item"><span>بارش</span><strong>${faNum(hourly.precipitation, 'mm')}</strong></div>
        </div>` : '';

    setContent(`
        <div class="weather-header">
            <div class="weather-icon-big" aria-hidden="true">${daily.icon}</div>
            <div class="weather-label">${escapeHtml(daily.label)}</div>
        </div>
        <div class="weather-place">پیش‌بینی آب و هوا برای ${escapeHtml(placeName)}</div>
        <div class="weather-task-title">📝 ${escapeHtml(taskText)}</div>

        <div class="weather-day-nav">
            <button type="button" class="weather-nav-btn" data-weather-nav="prev" ${canPrev ? '' : 'disabled'} aria-label="روز قبل">‹</button>
            <div class="weather-day-label">
                ${escapeHtml(dayLabel)}
                ${isTargetDay ? '<span class="weather-day-badge">سررسید</span>' : ''}
            </div>
            <button type="button" class="weather-nav-btn" data-weather-nav="next" ${canNext ? '' : 'disabled'} aria-label="روز بعد">›</button>
        </div>

        <div class="weather-time">📅 سررسید: ${faShort(_currentSessionDate)}</div>

        ${hourlyHTML}

        <div class="weather-daily">
            <div class="weather-daily-title">📊 خلاصه روز</div>
            <div class="weather-item"><span>حداکثر دما</span><strong>${faTemp(daily.tempMax)}C</strong></div>
            <div class="weather-item"><span>حداقل دما</span><strong>${faTemp(daily.tempMin)}C</strong></div>
            <div class="weather-item"><span>مجموع بارش</span><strong>${faNum(daily.precipitationSum, 'mm')}</strong></div>
            <div class="weather-item"><span>حداکثر باد</span><strong>${faNum(daily.windSpeedMax, 'km/h')}</strong></div>
        </div>
    `);
}

// ═══════════════════════════════════════════════════════════════════════════
// Show weather
// ═══════════════════════════════════════════════════════════════════════════

/**
 * نمایش مودال هوا برای یک وظیفه یا یک جلسه‌ی خاص.
 * @param {string} taskId
 * @param {string} [sessionId]
 */
export async function showWeatherModal(taskId, sessionId) {
    const found = findTask(taskId);
    if (!found) return;
    const task = found.task;

    // انتخاب سررسید هدف
    let targetSession = null;
    if (sessionId) {
        targetSession = (task.sessions || []).find(s => String(s.id) === String(sessionId));
    }
    if (!targetSession) {
        targetSession = nearestUpcoming(task);
    }
    if (!targetSession) {
        openModal();
        setContent('<div class="weather-error">سررسید آینده‌ای برای این وظیفه وجود ندارد.</div>');
        return;
    }

    // انتخاب مکان
    const loc = targetSession.location || task.location;
    if (!loc) {
        openModal();
        setContent('<div class="weather-error">مکانی برای این وظیفه ثبت نشده است.</div>');
        return;
    }

    // بررسی بازه‌ی زمانی
    const now = Date.now();
    const due = new Date(targetSession.at).getTime();
    const daysAhead = (due - now) / 86400000;
    if (daysAhead < 0) {
        openModal();
        setContent('<div class="weather-error">این سررسید گذشته است و پیش‌بینی هوا برای آن معنا ندارد.</div>');
        return;
    }
    if (daysAhead > 16) {
        openModal();
        setContent('<div class="weather-error">پیش‌بینی هوا فقط تا ۱۶ روز آینده در دسترس است.</div>');
        return;
    }

    // نمایش loading
    openModal();
    setContent('<div class="weather-loading">در حال دریافت پیش‌بینی هوا...</div>');

    // دریافت داده
    const data = await fetchWeather(loc, targetSession.at);
    if (!data) {
        setContent('<div class="weather-error">دریافت پیش‌بینی ناموفق بود. اتصال اینترنت را بررسی کنید.</div>');
        return;
    }

    // ذخیره در state مودال
    _currentTaskId = taskId;
    _currentSessionDate = targetSession.at;
    _currentLocation = loc;
    _currentWeatherData = data;

    const dayIdx = findDayIndex(data, targetSession.at);
    _currentDayIndex = dayIdx >= 0 ? dayIdx : 0;

    renderWeatherView();
}

// ═══════════════════════════════════════════════════════════════════════════
// Navigation
// ═══════════════════════════════════════════════════════════════════════════

function navigateDay(direction) {
    if (!_currentWeatherData) return;
    const total = _currentWeatherData.daily?.time?.length || 0;
    if (direction === 'prev' && _currentDayIndex > 0) {
        _currentDayIndex--;
        renderWeatherView();
    } else if (direction === 'next' && _currentDayIndex < total - 1) {
        _currentDayIndex++;
        renderWeatherView();
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Event binding
// ═══════════════════════════════════════════════════════════════════════════

export function bindWeatherModal() {
    const modal = document.getElementById('weatherModal');
    if (!modal) return;

    const closeBtn = document.getElementById('weatherModalOk');
    closeBtn?.addEventListener('click', closeModal);

    modal.addEventListener('click', e => {
        if (e.target === modal) closeModal();
    });

    document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        if (modal.style.display === 'flex') {
            e.preventDefault();
            e.stopPropagation();
            closeModal();
        }
    }, true);

    // listener متمرکز برای کلیک روی آیکن‌های هوا و ناوبری روز
    document.addEventListener('click', e => {
        // ناوبری روز
        const navBtn = e.target.closest('[data-weather-nav]');
        if (navBtn && !navBtn.disabled) {
            e.preventDefault();
            e.stopPropagation();
            navigateDay(navBtn.dataset.weatherNav);
            return;
        }

        // آیکن هوا
        const btn = e.target.closest('[data-weather-task]');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        const taskId = btn.dataset.weatherTask;
        const sessionId = btn.dataset.weatherSession || null;
        showWeatherModal(taskId, sessionId);
    });
}