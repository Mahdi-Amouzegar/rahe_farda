// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// i18n.js -- ماژول متمرکز چندزبانه (فاز ۴C)
//
// ⚠️ این ماژول مسئول:
//   - بارگذاری فایل‌های ترجمه (fa.json، en.json)
//   - ترجمه‌ی کلیدها با t(key, params)
//   - تغییر زبان با setLang(lang)
//   - اعمال ترجمه روی DOM با applyToDOM()
//   - ذخیره‌ی زبان انتخابی در localStorage (spaceTodoPrefs.lang)
//   - فرمت تاریخ بر اساس زبان (fa-IR / en-US)
//
// ⚠️ اصل طراحی (بدون backward compat):
//   - i18n.getLang() تنها منبع حافظه برای زبان است
//   - localStorage (spaceTodoPrefs.lang) منبع پایدار است
//   - state.prefs.lang حذف شده — هیچ‌جا استفاده نکن
//   - هیچ eventی emit نمی‌شود — فقط Promise
//
// ⚠️ ترتیب fallback در t():
//   ۱. زبان فعلی (مثلاً en)
//   ۲. زبان پیش‌فرض (fa)
//   ۳. خود کلید (مثل 'app.title')
//
// ⚠️ Interpolation:
//   t('tasks.count', { n: 5 })  →  «۵ کار» (اگر fa.json اینطور باشد)
//
// ⚠️ بدون وابستگی:
//   - هیچ import خارجی ندارد (نه events، نه core)
//   - کاملاً مستقل است
//
// ⚠️ Persistence:
//   - زبان در localStorage با کلید spaceTodoPrefs.lang ذخیره می‌شود
//   - فقط این ماژول مسئول نوشتن در آن است
//
// ⚠️ بارگذاری locale:
//   - از fetch() استفاده می‌کند
//   - فایل‌ها در public/js/locales/ هستند (Vite کپی می‌کند)
//   - مسیر fetch: ./js/locales/fa.json
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/** کلید localStorage برای تنظیمات */
const PREFS_KEY = 'spaceTodoPrefs';

/** زبان پیش‌فرض پروژه */
const DEFAULT_LANG = 'fa';

/** زبان‌های پشتیبانی‌شده */
const SUPPORTED_LANGS = ['fa', 'en'];

/**
 * مسیر فایل‌های ترجمه — نسبت به ریشه‌ی سایت.
 *
 * ⚠️ فایل‌ها در `public/js/locales/` هستند (نه `js/locales/`).
 *    دلیل: Vite فایل‌های `public/` را بدون تغییر به `dist/` کپی می‌کند.
 *
 * ⚠️ در dev، Vite پوشه‌ی `public/` را در ریشه سرو می‌کند → `/js/locales/fa.json`
 * ⚠️ در build، Vite `public/js/locales/*.json` را به `dist/js/locales/*.json` کپی می‌کند
 */
const LOCALES_PATH = './js/locales';

// ═══════════════════════════════════════════════════════════════════════════
// Local State
// ═══════════════════════════════════════════════════════════════════════════

/** @type {string} زبان فعلی */
let _currentLang = DEFAULT_LANG;

/** @type {Object<string, Object>} کش ترجمه‌ها: { fa: {...}, en: {...} } */
const _messages = {};

/** @type {boolean} */
let _faLoaded = false;

/** @type {boolean} */
let _enLoaded = false;

/** @type {Promise|null} */
let _loadingPromise = null;

// ═══════════════════════════════════════════════════════════════════════════
// Helpers — Locale path
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ساخت مسیر فایل locale.
 *
 * ⚠️ مسیر نسبی است. `fetch` آن را نسبت به `document.baseURI` حل می‌کند.
 *
 * @param {string} lang
 * @returns {string}
 */
function _localeUrl(lang) {
    return `${LOCALES_PATH}/${lang}.json`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers — Language validation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * بررسی معتبر بودن زبان.
 *
 * @param {unknown} lang
 * @returns {boolean}
 */
function _isSupported(lang) {
    return typeof lang === 'string' && SUPPORTED_LANGS.includes(lang);
}

/**
 * نرمال‌سازی زبان (اگر نامعتبر بود، پیش‌فرض).
 *
 * @param {unknown} lang
 * @returns {string}
 */
function _normalizeLang(lang) {
    return _isSupported(lang) ? lang : DEFAULT_LANG;
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers — Interpolation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * جایگزینی پارامترها در یک رشته.
 *
 * @param {string} template
 * @param {Object<string, unknown>|undefined} params
 * @returns {string}
 */
function _interpolate(template, params) {
    if (!params || typeof params !== 'object') return template;
    return template.replace(/\{(\w+)\}/g, (match, key) => {
        if (Object.prototype.hasOwnProperty.call(params, key)) {
            const value = params[key];
            return value === null || value === undefined ? '' : String(value);
        }
        return match;
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers — Lookup
// ═══════════════════════════════════════════════════════════════════════════

/**
 * جستجوی یک کلید در یک آبجکت تودرتو.
 *
 * @param {Object} obj
 * @param {string} key — با نقطه جدا شده
 * @returns {string|undefined}
 */
function _lookup(obj, key) {
    if (!obj || typeof obj !== 'object') return undefined;
    if (typeof key !== 'string' || key.length === 0) return undefined;

    const parts = key.split('.');
    let current = obj;

    for (const part of parts) {
        if (current === null || current === undefined) return undefined;
        if (typeof current !== 'object') return undefined;
        current = current[part];
    }

    if (typeof current === 'string') return current;
    return undefined;
}

// ═══════════════════════════════════════════════════════════════════════════
// Persistence — localStorage
// ═══════════════════════════════════════════════════════════════════════════

/**
 * خواندن زبان از localStorage.
 *
 * @returns {string}
 */
function _readLangFromStorage() {
    try {
        const raw = localStorage.getItem(PREFS_KEY);
        if (!raw) return DEFAULT_LANG;
        const prefs = JSON.parse(raw);
        if (prefs && typeof prefs === 'object' && _isSupported(prefs.lang)) {
            return prefs.lang;
        }
    } catch {
        // silent
    }
    return DEFAULT_LANG;
}

/**
 * ذخیره‌ی زبان در localStorage.
 *
 * ⚠️ فقط فیلد lang را تغییر می‌دهیم — بقیه‌ی prefs حفظ می‌شوند.
 *
 * @param {string} lang
 */
function _writeLangToStorage(lang) {
    try {
        const raw = localStorage.getItem(PREFS_KEY);
        const prefs = raw ? JSON.parse(raw) : {};
        const safePrefs = (prefs && typeof prefs === 'object') ? prefs : {};
        safePrefs.lang = lang;
        localStorage.setItem(PREFS_KEY, JSON.stringify(safePrefs));
    } catch {
        // silent
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Loading — fetch locales
// ═══════════════════════════════════════════════════════════════════════════

/**
 * بارگذاری یک فایل locale.
 *
 * @param {string} lang
 * @returns {Promise<Object>}
 */
async function _loadLocale(lang) {
    const url = _localeUrl(lang);
    try {
        // ⚠️ از cache: 'default' استفاده می‌کنیم (نه force-cache).
        //    دلیل: وقتی en.json را ویرایش می‌کنیم، کاربران باید نسخه‌ی جدید را ببینند.
        //    مرورگر با ETag/Last-Modified خودش تصمیم می‌گیرد cache کند یا نه.
        const response = await fetch(url);
        if (!response.ok) {
            console.warn(`[i18n] Failed to load ${url}: HTTP ${response.status}`);
            return {};
        }
        const data = await response.json();
        if (!data || typeof data !== 'object') {
            console.warn(`[i18n] Invalid locale file: ${url}`);
            return {};
        }
        return data;
    } catch (err) {
        console.warn(`[i18n] Error loading ${url}:`, err);
        return {};
    }
}

/**
 * بارگذاری همه‌ی localeها (fa + en).
 *
 * ⚠️ idempotent است.
 *
 * @returns {Promise<void>}
 */
async function _ensureLoaded() {
    if (_faLoaded && _enLoaded) return;
    if (_loadingPromise) return _loadingPromise;

    _loadingPromise = (async () => {
        const tasks = [];
        if (!_faLoaded) {
            tasks.push(_loadLocale('fa').then(data => {
                _messages.fa = data;
                _faLoaded = true;
            }));
        }
        if (!_enLoaded) {
            tasks.push(_loadLocale('en').then(data => {
                _messages.en = data;
                _enLoaded = true;
            }));
        }
        await Promise.all(tasks);
        _loadingPromise = null;
    })();

    return _loadingPromise;
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API — t(key, params)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ترجمه‌ی یک کلید.
 *
 * ⚠️ ترتیب fallback:
 *   ۱. زبان فعلی
 *   ۲. زبان پیش‌فرض (fa)
 *   ۳. خود کلید
 *
 * @param {string} key
 * @param {Object<string, unknown>} [params]
 * @returns {string}
 */
export function t(key, params) {
    if (typeof key !== 'string' || key.length === 0) return '';

    const currentMessages = _messages[_currentLang];
    let value = _lookup(currentMessages, key);

    if (value === undefined && _currentLang !== DEFAULT_LANG) {
        const defaultMessages = _messages[DEFAULT_LANG];
        value = _lookup(defaultMessages, key);
    }

    // ⚠️ اگر کلید پیدا نشد، خود کلید برگردانده می‌شود.
    //    این برای رشته‌های ترجمه‌نشدنی (entity_type, MEDIA_STATUSES) امن است.
    if (value === undefined) {
        return key;
    }

    return _interpolate(value, params);
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API — setLang / getLang
// ═══════════════════════════════════════════════════════════════════════════

/**
 * تنظیم زبان فعلی.
 *
 * ⚠️ این تابع:
 *   - زبان را در localStorage ذخیره می‌کند
 *   - `lang` و `dir` را روی <html> ست می‌کند
 *   - هیچ eventی emit نمی‌کند
 *
 * @param {string} lang — 'fa' یا 'en'
 * @returns {Promise<void>}
 */
export async function setLang(lang) {
    const normalized = _normalizeLang(lang);
    await _ensureLoaded();

    _currentLang = normalized;

    _writeLangToStorage(normalized);
    _applyHtmlAttributes(normalized);
}

/**
 * گرفتن زبان فعلی.
 *
 * @returns {string} 'fa' یا 'en'
 */
export function getLang() {
    return _currentLang;
}

/**
 * لیست زبان‌های پشتیبانی‌شده.
 *
 * @returns {string[]}
 */
export function getSupportedLangs() {
    return [...SUPPORTED_LANGS];
}

// ═══════════════════════════════════════════════════════════════════════════
// HTML attributes
// ═══════════════════════════════════════════════════════════════════════════

/**
 * اعمال `lang` و `dir` روی <html>.
 *
 * ⚠️ fa → rtl، en → ltr
 *
 * @param {string} lang
 */
function _applyHtmlAttributes(lang) {
    if (typeof document === 'undefined') return;
    const html = document.documentElement;
    if (!html) return;

    html.setAttribute('lang', lang);
    html.setAttribute('data-lang', lang);
    html.setAttribute('dir', lang === 'en' ? 'ltr' : 'rtl');
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API — applyToDOM
// ═══════════════════════════════════════════════════════════════════════════

/**
 * اعمال ترجمه روی همه‌ی عناصر دارای data-i18n در DOM.
 *
 * ⚠️ attributeهای پشتیبانی‌شده:
 *   - data-i18n              → textContent
 *   - data-i18n-html         → innerHTML (⚠️ فقط برای رشته‌های امن)
 *   - data-i18n-placeholder  → placeholder attribute
 *   - data-i18n-title        → title attribute
 *   - data-i18n-aria-label   → aria-label attribute
 *
 * ⚠️ اگر کلید پیدا نشد، عنصر دست‌نخورده می‌ماند.
 *
 * @param {HTMLElement|Document} [root] — پیش‌فرض: document
 */
export function applyToDOM(root) {
    if (typeof document === 'undefined') return;

    const scope = root || document;

    // ─── data-i18n (textContent) ───
    scope.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (!key) return;
        const value = t(key);
        if (value !== key) {
            el.textContent = value;
        }
    });

    // ─── data-i18n-html (innerHTML — فقط برای رشته‌های امن) ───
    scope.querySelectorAll('[data-i18n-html]').forEach(el => {
        const key = el.getAttribute('data-i18n-html');
        if (!key) return;
        const value = t(key);
        if (value !== key) {
            el.innerHTML = value;
        }
    });

    // ─── data-i18n-placeholder ───
    scope.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (!key) return;
        const value = t(key);
        if (value !== key) {
            el.setAttribute('placeholder', value);
        }
    });

    // ─── data-i18n-title ───
    scope.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        if (!key) return;
        const value = t(key);
        if (value !== key) {
            el.setAttribute('title', value);
        }
    });

    // ─── data-i18n-aria-label ───
    scope.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
        const key = el.getAttribute('data-i18n-aria-label');
        if (!key) return;
        const value = t(key);
        if (value !== key) {
            el.setAttribute('aria-label', value);
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API — init
// ═══════════════════════════════════════════════════════════════════════════

/**
 * راه‌اندازی ماژول i18n.
 *
 * این تابع:
 *   - زبان را از localStorage می‌خواند (یا پیش‌فرض)
 *   - localeها را بارگذاری می‌کند
 *   - `lang` و `dir` را روی <html> ست می‌کند
 *
 * ⚠️ idempotent است.
 *
 * @returns {Promise<void>}
 */
export async function initI18n() {
    const storedLang = _readLangFromStorage();
    _currentLang = _normalizeLang(storedLang);

    await _ensureLoaded();

    _applyHtmlAttributes(_currentLang);
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API — debug
// ═══════════════════════════════════════════════════════════════════════════

/**
 * بررسی بارگذاری یک زبان.
 *
 * @param {string} lang
 * @returns {boolean}
 */
export function isLoaded(lang) {
    const normalized = _normalizeLang(lang);
    if (normalized === 'fa') return _faLoaded;
    if (normalized === 'en') return _enLoaded;
    return false;
}

/**
 * بررسی وجود یک کلید.
 *
 * @param {string} key
 * @returns {boolean}
 */
export function hasKey(key) {
    const currentMessages = _messages[_currentLang];
    if (currentMessages && _lookup(currentMessages, key) !== undefined) return true;
    const defaultMessages = _messages[DEFAULT_LANG];
    if (defaultMessages && _lookup(defaultMessages, key) !== undefined) return true;
    return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API — Date formatting
// ═══════════════════════════════════════════════════════════════════════════

/**
 * گرفتن locale string برای Intl.
 *
 * ⚠️ fa → 'fa-IR' (تقویم جلالی)
 * ⚠️ en → 'en-US' (تقویم میلادی)
 *
 * @returns {string}
 */
export function getDateLocale() {
    return _currentLang === 'en' ? 'en-US' : 'fa-IR';
}

/**
 * فرمت تاریخ بر اساس زبان فعلی.
 *
 * @param {Date|string|number} date
 * @param {Intl.DateTimeFormatOptions} [options]
 * @returns {string}
 */
export function formatDate(date, options) {
    try {
        const d = date instanceof Date ? date : new Date(date);
        if (isNaN(d)) return '';
        const opts = options || {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        };
        return new Intl.DateTimeFormat(getDateLocale(), opts).format(d);
    } catch {
        return '';
    }
}

/**
 * فرمت تاریخ و ساعت بر اساس زبان فعلی.
 *
 * @param {Date|string|number} date
 * @returns {string}
 */
export function formatDateTime(date) {
    return formatDate(date, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// پایان i18n.js
// ═══════════════════════════════════════════════════════════════════════════