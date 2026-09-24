// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// auth.js -- مدیریت احراز هویت (Telegram Login + Session) — فاز ۶ گام ۲
//
// ⚠️ این ماژول مسئول:
//   - ورود با Telegram Login (Redirect-based، نه Widget)
//   - ذخیره‌ی authToken + user در localStorage
//   - بازیابی session در boot (restoreSession)
//   - پردازش callback تلگرام بعد از بازگشت از oauth.telegram.org
//   - خروج (logout)
//   - تازه‌سازی توکن (refreshToken)
//   - انتشار رویدادهای auth:* روی EventEmitter مرکزی
//
// ⚠️ چرا Redirect-based به جای Widget؟
//   - Widget رسمی تلگرام از eval() استفاده می‌کند.
//   - CSP سختگیرانه‌ی ما unsafe-eval را ممنوع می‌کند.
//   - پس از Redirect-based Login استفاده می‌کنیم:
//       https://oauth.telegram.org/auth?bot_id=...&origin=...&return_to=...
//   - کاربر به تلگرام می‌رود، تأیید می‌کند، و با پارامترهای امضاشده
//     به سایت برمی‌گردد. ما پارامترها را می‌خوانیم و به Worker می‌فرستیم.
//
// ⚠️ اصل Offline-First (D-004):
//   - این ماژول state.sync.enabled را true نمی‌کند.
//   - فقط توکن و اطلاعات کاربر را ذخیره می‌کند.
//   - فعال‌سازی sync ابری یک دکمه‌ی جداگانه در گام ۳ است.
//
// ⚠️ امنیت:
//   - authToken هرگز در URL قرار نمی‌گیرد.
//   - فقط از طریق POST + هدر Authorization ارسال می‌شود.
//   - در localStorage با کلید spaceTodoAuth ذخیره می‌شود.
//   - پس از logout، هم localStorage و هم state.sync پاک می‌شوند.
//
// ⚠️ رویدادها:
//   auth:login              — بعد از ورود موفق
//   auth:logout             — بعد از خروج
//   auth:restored           — بعد از بازیابی session در boot
//   auth:token-refreshed    — بعد از تازه‌سازی موفق توکن
//   auth:expired            — وقتی توکن منقضی شده و refresh هم شکست خورد
//   auth:error              — هر خطای دیگری در جریان ورود/تازه‌سازی
// ═══════════════════════════════════════════════════════════════════════════

import { state, uid, toFa } from './core.js';
import { events } from './events.js';
import { getDeviceId } from './net.js';
import { t as i18nT } from './i18n.js';

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/** کلید localStorage برای ذخیره‌ی session */
const AUTH_KEY = 'spaceTodoAuth';

/** آدرس پیش‌فرض Cloudflare Worker (فاز ۶) */
const DEFAULT_ENDPOINT = 'https://rahe-farda-sync.mhdamouz.workers.dev';

/**
 * شناسه‌ی ربات تلگرام (bot_id).
 * این عدد عمومی است و بخش اول توکن را نشان می‌دهد — توکن کامل نیست.
 * در BotFather از Bot Settings → Login Widget قابل دریافت است.
 */
const TELEGRAM_BOT_ID = '8680828318';

/**
 * آدرس OAuth تلگرام برای Redirect-based Login.
 * ⚠️ به‌جای Widget (که از eval استفاده می‌کند و با CSP ما ناسازگار است)،
 *    از این روش استفاده می‌کنیم: کاربر به تلگرام می‌رود، تأیید می‌کند و
 *    با پارامترهای امضاشده برمی‌گردد.
 */
const TELEGRAM_OAUTH_URL = 'https://oauth.telegram.org/auth';

/**
 * آستانه‌ی refresh خودکار (روز).
 * اگر توکن کمتر از این مقدار اعتبار داشته باشد، در boot تلاش می‌کنیم
 * refresh کنیم.
 */
const AUTO_REFRESH_THRESHOLD_DAYS = 7;

/**
 * آستانه‌ی هشدار انقضا (روز).
 * اگر توکن کمتر از این مقدار اعتبار داشته باشد، در UI هشدار نشان می‌دهیم.
 */
const EXPIRY_WARNING_DAYS = 3;

/**
 * نام پارامترهای URL که تلگرام بعد از redirect برمی‌گرداند.
 * این‌ها باید از URL پاک شوند تا در رفرش بعدی دوباره پردازش نشوند.
 */
const TELEGRAM_CALLBACK_PARAMS = [
    'id', 'first_name', 'last_name', 'username',
    'photo_url', 'auth_date', 'hash', 'tgAuthResult'
];

// ═══════════════════════════════════════════════════════════════════════════
// Local state
// ═══════════════════════════════════════════════════════════════════════════

/** @type {boolean} */
let _started = false;

/** @type {boolean} — محافظ برای جلوگیری از refresh موازی */
let _refreshing = false;

// ═══════════════════════════════════════════════════════════════════════════
// Storage
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ذخیره‌ی session در localStorage + state.sync.
 *
 * @param {{ token: string, user: object, expiresAt: string }} session
 */
function _persistSession(session) {
    const payload = {
        token: session.token,
        user: session.user,
        expiresAt: session.expiresAt,
        savedAt: new Date().toISOString(),
    };

    try {
        localStorage.setItem(AUTH_KEY, JSON.stringify(payload));
    } catch (err) {
        console.warn('auth: persist failed', err);
    }

    // همگام‌سازی state.sync (فقط توکن و userId — نه enabled)
    state.sync.authToken = session.token;
    state.sync.userId = session.user?.id || null;
    state.sync.endpoint = state.sync.endpoint || DEFAULT_ENDPOINT;
    state.sync.deviceId = getDeviceId();
}

/**
 * خواندن session از localStorage.
 *
 * @returns {{ token: string, user: object, expiresAt: string } | null}
 */
function _readSession() {
    try {
        const raw = localStorage.getItem(AUTH_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        if (typeof parsed.token !== 'string' || parsed.token.length === 0) return null;
        if (!parsed.user || typeof parsed.user.id !== 'string') return null;
        return {
            token: parsed.token,
            user: parsed.user,
            expiresAt: parsed.expiresAt || null,
        };
    } catch {
        return null;
    }
}

/**
 * پاک کردن session از localStorage + state.sync.
 */
function _clearSession() {
    try {
        localStorage.removeItem(AUTH_KEY);
    } catch { /* silent */ }

    state.sync.authToken = null;
    state.sync.userId = null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Expiry helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * آیا توکن منقضی شده است؟
 *
 * @param {string|null} expiresAt — ISO string
 * @returns {boolean}
 */
export function isExpired(expiresAt) {
    if (!expiresAt) return false;
    const ms = new Date(expiresAt).getTime();
    if (!Number.isFinite(ms)) return false;
    return Date.now() >= ms;
}

/**
 * تعداد روز باقی‌مانده تا انقضا.
 *
 * @param {string|null} expiresAt
 * @returns {number} — روز (ممکن است منفی باشد اگر منقضی شده)
 */
export function daysUntilExpiry(expiresAt) {
    if (!expiresAt) return Infinity;
    const ms = new Date(expiresAt).getTime();
    if (!Number.isFinite(ms)) return Infinity;
    return (ms - Date.now()) / 86400000;
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API — read
// ═══════════════════════════════════════════════════════════════════════════

/**
 * وضعیت احراز هویت فعلی.
 *
 * @returns {{
 *   loggedIn: boolean,
 *   user: object|null,
 *   token: string|null,
 *   expiresAt: string|null,
 *   isExpired: boolean,
 *   daysLeft: number,
 *   needsRefresh: boolean,
 *   shouldWarnExpiry: boolean
 * }}
 */
export function getAuthState() {
    const session = _readSession();
    if (!session) {
        return {
            loggedIn: false,
            user: null,
            token: null,
            expiresAt: null,
            isExpired: false,
            daysLeft: Infinity,
            needsRefresh: false,
            shouldWarnExpiry: false,
        };
    }

    const expired = isExpired(session.expiresAt);
    const daysLeft = daysUntilExpiry(session.expiresAt);

    return {
        loggedIn: !expired,
        user: session.user,
        token: session.token,
        expiresAt: session.expiresAt,
        isExpired: expired,
        daysLeft,
        needsRefresh: !expired && daysLeft <= AUTO_REFRESH_THRESHOLD_DAYS,
        shouldWarnExpiry: !expired && daysLeft <= EXPIRY_WARNING_DAYS,
    };
}

/**
 * آیا کاربر وارد شده است؟
 *
 * @returns {boolean}
 */
export function isLoggedIn() {
    return getAuthState().loggedIn;
}

/**
 * اطلاعات کاربر فعلی.
 *
 * @returns {object|null}
 */
export function getCurrentUser() {
    return getAuthState().user;
}

// ═══════════════════════════════════════════════════════════════════════════
// Telegram Login URL (Redirect-based)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ساخت URL برای Redirect-based Telegram Login.
 *
 * کاربر با کلیک روی این URL به `oauth.telegram.org` می‌رود، تأیید می‌کند
 * و تلگرام او را با پارامترهای امضاشده به `return_to` برمی‌گرداند.
 *
 * @param {string} [returnTo] — آدرسی که تلگرام بعد از تأیید به آن redirect می‌کند.
 *                              پیش‌فرض: `location.origin + location.pathname` فعلی.
 * @returns {string} URL کامل برای باز کردن در تلگرام
 */
export function buildTelegramLoginUrl(returnTo) {
    const origin = typeof location !== 'undefined' ? location.origin : '';
    const finalReturnTo = returnTo || (typeof location !== 'undefined'
        ? (location.origin + location.pathname)
        : '');

    // ⚠️ نکته: پارامتر `logout=1` باعث می‌شود تلگرام session قبلی را پاک
    //    کند و کاربر مجبور شود دوباره شماره‌اش را وارد کند.
    //    بدون این پارامتر، تلگرام ممکن است از session قبلی استفاده کند
    //    و بدون پرسیدن شماره، دوباره کاربر را وارد کند.
    const params = new URLSearchParams({
        bot_id: TELEGRAM_BOT_ID,
        origin,
        return_to: finalReturnTo,
        request_access: 'write',
        logout: '1',
    });

    return `${TELEGRAM_OAUTH_URL}?${params.toString()}`;
}

/**
 * استخراج پارامترهای callback تلگرام از URL فعلی.
 *
 * اگر URL شامل `id`, `hash`, `auth_date` و ... باشد، آن‌ها را برمی‌گرداند.
 * در غیر این صورت `null`.
 *
 * @param {string} [url] — پیش‌فرض: `location.href`
 * @returns {object|null} — payload آماده برای `loginWithTelegram`، یا null
 */
export function parseTelegramCallbackParams(url) {
    if (typeof location === 'undefined' && !url) return null;

    const finalUrl = url || location.href;

    // ─── روش ۱: hash با فرمت tgAuthResult=<base64_json> ───
    // تلگرام در برخی پیاده‌سازی‌های Login URL، داده را در hash می‌فرستد
    // به شکل: #tgAuthResult=<base64-encoded-json>
    const hashMatch = finalUrl.match(/[#&]tgAuthResult=([A-Za-z0-9_\-+/=]+)/);
    if (hashMatch) {
        try {
            // base64url → base64 → decode
            let b64 = hashMatch[1].replace(/-/g, '+').replace(/_/g, '/');
            // padding
            while (b64.length % 4 !== 0) b64 += '=';
            // atob → bytes → utf-8
            const binary = atob(b64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            const json = new TextDecoder('utf-8').decode(bytes);
            const parsed = JSON.parse(json);

            if (!parsed || typeof parsed !== 'object') return null;
            if (!parsed.hash || !parsed.auth_date) return null;

            const id = Number(parsed.id);
            const authDate = Number(parsed.auth_date);
            if (!Number.isFinite(id) || !Number.isFinite(authDate)) return null;

            const payload = {
                id,
                auth_date: authDate,
                hash: String(parsed.hash),
            };
            if (parsed.first_name) payload.first_name = String(parsed.first_name);
            if (parsed.last_name) payload.last_name = String(parsed.last_name);
            if (parsed.username) payload.username = String(parsed.username);
            if (parsed.photo_url) payload.photo_url = String(parsed.photo_url);

            return payload;
        } catch (err) {
            console.warn('[auth] Failed to parse tgAuthResult hash:', err);
            return null;
        }
    }

    // ─── روش ۲: query string با پارامترهای تکی ───
    // (روش کلاسیک Telegram Login Widget)
    let urlObj;
    try {
        urlObj = new URL(finalUrl);
    } catch {
        return null;
    }

    const params = urlObj.searchParams;
    const id = params.get('id');
    const hash = params.get('hash');
    const authDate = params.get('auth_date');

    // حداقل‌های لازم برای اعتبارسنجی
    if (!id || !hash || !authDate) return null;

    const payload = {
        id: Number(id),
        auth_date: Number(authDate),
        hash,
    };

    if (params.get('first_name')) payload.first_name = params.get('first_name');
    if (params.get('last_name')) payload.last_name = params.get('last_name');
    if (params.get('username')) payload.username = params.get('username');
    if (params.get('photo_url')) payload.photo_url = params.get('photo_url');

    if (!Number.isFinite(payload.id) || !Number.isFinite(payload.auth_date)) {
        return null;
    }

    return payload;
}

/**
 * پاک کردن پارامترهای callback تلگرام از URL (بدون reload).
 * بعد از پردازش موفق، URL را تمیز می‌کند تا رفرش بعدی دوباره آن‌ها را نبیند.
 */
export function cleanTelegramParamsFromUrl() {
    if (typeof location === 'undefined' || typeof history === 'undefined') return;

    try {
        const url = new URL(location.href);
        let changed = false;

        // ─── پاک کردن query params ───
        for (const key of TELEGRAM_CALLBACK_PARAMS) {
            if (url.searchParams.has(key)) {
                url.searchParams.delete(key);
                changed = true;
            }
        }

        // ─── پاک کردن hash (اگر tgAuthResult دارد) ───
        let cleanHash = url.hash;
        if (cleanHash && /tgAuthResult=/.test(cleanHash)) {
            cleanHash = '';
            changed = true;
        }

        if (changed) {
            const clean = url.pathname + (url.search ? url.search : '') + cleanHash;
            history.replaceState({}, '', clean);
        }
    } catch { /* silent */ }
}

// ═══════════════════════════════════════════════════════════════════════════
// Login with Telegram
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ورود با payload امضاشده‌ی Telegram.
 *
 * @param {object} telegramPayload — داده‌ی خام از callback
 * @param {object} [options]
 * @param {string} [options.endpoint] — آدرس Worker (پیش‌فرض: DEFAULT_ENDPOINT)
 * @param {string} [options.deviceName] — نام دستگاه (مثلاً "Chrome on Windows")
 * @param {number} [options.tokenTtlDays] — مدت اعتبار توکن (۳۰/۹۰/۱۸۰/۳۶۵)
 * @returns {Promise<{ ok: boolean, user?: object, error?: string }>}
 */
export async function loginWithTelegram(telegramPayload, options) {
    const opts = options || {};
    const endpoint = opts.endpoint || state.sync.endpoint || DEFAULT_ENDPOINT;
    const deviceId = getDeviceId();
    const deviceName = opts.deviceName || _guessDeviceName();

    if (!telegramPayload || typeof telegramPayload !== 'object') {
        return { ok: false, error: i18nT('errors.payloadInvalid') };
    }
    if (!telegramPayload.hash) {
        return { ok: false, error: i18nT('errors.signatureMissing') };
    }

    try {
        const response = await fetch(`${endpoint}/api/auth/telegram`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                payload: telegramPayload,
                deviceId,
                deviceName,
                tokenTtlDays: opts.tokenTtlDays,
            }),
        });

        const data = await response.json().catch(() => null);

        if (!response.ok || !data || data.ok !== true) {
            const errMsg = data?.error?.message || i18nT('errors.serverErrorWithStatus', { status: response.status });
            events.emit('auth:error', { stage: 'telegram', message: errMsg });
            return { ok: false, error: errMsg };
        }

        const session = {
            token: data.data.token,
            user: data.data.user,
            expiresAt: data.data.expiresAt,
        };

        _persistSession(session);
        events.emit('auth:login', { user: session.user, expiresAt: session.expiresAt });

        return { ok: true, user: session.user };
    } catch (err) {
        const errMsg = err?.message === 'Failed to fetch'
            ? i18nT('errors.network')
            : i18nT('errors.loginFailed');
        events.emit('auth:error', { stage: 'telegram', message: errMsg });
        return { ok: false, error: errMsg };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Refresh Token
// ═══════════════════════════════════════════════════════════════════════════

/**
 * تازه‌سازی توکن فعلی.
 *
 * @param {object} [options]
 * @param {string} [options.endpoint]
 * @param {number} [options.tokenTtlDays] — TTL جدید (اختیاری)
 * @returns {Promise<{ ok: boolean, user?: object, error?: string }>}
 */
export async function refreshToken(options) {
    if (_refreshing) {
        // ⚠️ اگر یک refresh در حال اجراست، همین را برگردان
        return { ok: false, error: i18nT('errors.refreshInProgress') };
    }

    const session = _readSession();
    if (!session) {
        return { ok: false, error: i18nT('errors.sessionNotFound') };
    }

    const opts = options || {};
    const endpoint = opts.endpoint || state.sync.endpoint || DEFAULT_ENDPOINT;

    _refreshing = true;
    try {
        const response = await fetch(`${endpoint}/api/auth/refresh`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.token}`,
            },
            body: JSON.stringify(
                opts.tokenTtlDays !== undefined ? { tokenTtlDays: opts.tokenTtlDays } : {}
            ),
        });

        const data = await response.json().catch(() => null);

        if (response.status === 401) {
            // توکن منقضی یا نامعتبر → پاک کن
            _clearSession();
            events.emit('auth:expired', {});
            return { ok: false, error: i18nT('errors.tokenExpired') };
        }

        if (!response.ok || !data || data.ok !== true) {
            const errMsg = data?.error?.message || i18nT('errors.serverErrorWithStatus', { status: response.status });
            events.emit('auth:error', { stage: 'refresh', message: errMsg });
            return { ok: false, error: errMsg };
        }

        const newSession = {
            token: data.data.token,
            user: data.data.user,
            expiresAt: data.data.expiresAt,
        };

        _persistSession(newSession);
        events.emit('auth:token-refreshed', {
            user: newSession.user,
            expiresAt: newSession.expiresAt,
        });

        return { ok: true, user: newSession.user };
    } catch (err) {
        const errMsg = err?.message === 'Failed to fetch'
            ? i18nT('errors.network')
            : i18nT('errors.refreshFailed');
        events.emit('auth:error', { stage: 'refresh', message: errMsg });
        return { ok: false, error: errMsg };
    } finally {
        _refreshing = false;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Logout
// ═══════════════════════════════════════════════════════════════════════════

/**
 * خروج از حساب.
 *
 * ⚠️ این تابع:
 *   - session را از localStorage پاک می‌کند.
 *   - state.sync را پاک می‌کند (authToken، userId).
 *   - state.sync.enabled را false می‌کند (اگر فعال بود).
 *   - صف sync را پاک نمی‌کند (تا اگر دوباره login شد، ops از دست نروند).
 *
 * @param {object} [options]
 * @param {boolean} [options.silent] — اگر true باشد، رویداد auth:logout منتشر نمی‌شود
 */
export function logout(options) {
    const opts = options || {};
    const wasLoggedIn = Boolean(state.sync.authToken);

    _clearSession();
    state.sync.enabled = false;

    if (!opts.silent && wasLoggedIn) {
        events.emit('auth:logout', {});
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Restore Session (boot)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * بازیابی session در boot.
 *
 * این تابع:
 *   - session را از localStorage می‌خواند.
 *   - اگر منقضی شده باشد → پاک می‌کند و رویداد auth:expired منتشر می‌کند.
 *   - اگر نزدیک انقضا باشد → تلاش می‌کند refresh کند.
 *   - رویداد auth:restored را منتشر می‌کند.
 *
 * @returns {Promise<{ restored: boolean, refreshed: boolean, user: object|null }>}
 */
export async function restoreSession() {
    const session = _readSession();
    if (!session) {
        return { restored: false, refreshed: false, user: null };
    }

    // ─── اگر منقضی شده ───
    if (isExpired(session.expiresAt)) {
        _clearSession();
        events.emit('auth:expired', {});
        return { restored: false, refreshed: false, user: null };
    }

    // ─── بازیابی state.sync ───
    state.sync.authToken = session.token;
    state.sync.userId = session.user.id;
    state.sync.deviceId = getDeviceId();
    state.sync.endpoint = state.sync.endpoint || DEFAULT_ENDPOINT;

    events.emit('auth:restored', { user: session.user, expiresAt: session.expiresAt });

    // ─── اگر نزدیک انقضا است، refresh کن ───
    const daysLeft = daysUntilExpiry(session.expiresAt);
    if (daysLeft <= AUTO_REFRESH_THRESHOLD_DAYS) {
        const result = await refreshToken();
        if (result.ok) {
            return { restored: true, refreshed: true, user: result.user };
        }
        // اگر refresh شکست خورد، ولی توکن هنوز معتبر است → ادامه بده
        return { restored: true, refreshed: false, user: session.user };
    }

    return { restored: true, refreshed: false, user: session.user };
}

// ═══════════════════════════════════════════════════════════════════════════
// Handle Telegram Redirect (بعد از بازگشت از oauth.telegram.org)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * پردازش پارامترهای callback تلگرام در URL.
 *
 * این تابع در boot صدا زده می‌شود. اگر URL شامل پارامترهای امضاشده‌ی
 * تلگرام باشد:
 *   1. آن‌ها را استخراج می‌کند.
 *   2. به `loginWithTelegram` می‌فرستد.
 *   3. در صورت موفقیت، پارامترها را از URL پاک می‌کند.
 *
 * @returns {Promise<{ handled: boolean, ok: boolean, user?: object, error?: string }>}
 */
export async function handleTelegramRedirect() {
    const payload = parseTelegramCallbackParams();
    if (!payload) {
        return { handled: false, ok: false };
    }

    const result = await loginWithTelegram(payload);

    // در هر حالت (موفق یا ناموفق) پارامترها را پاک کن
    // تا رفرش بعدی دوباره پردازش نشوند
    cleanTelegramParamsFromUrl();

    if (result.ok) {
        return { handled: true, ok: true, user: result.user };
    }
    return { handled: true, ok: false, error: result.error };
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * حدس نام دستگاه از User-Agent.
 * فقط برای نمایش در UI (سرور هم UA را می‌گیرد).
 *
 * @returns {string}
 */
function _guessDeviceName() {
    if (typeof navigator === 'undefined') return 'دستگاه ناشناخته';
    const ua = navigator.userAgent || '';

    // اول سیستم‌عامل
    let os = 'دستگاه';
    if (/Windows/i.test(ua)) os = 'Windows';
    else if (/Mac OS X/i.test(ua)) os = 'macOS';
    else if (/Android/i.test(ua)) os = 'Android';
    else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
    else if (/Linux/i.test(ua)) os = 'Linux';

    // بعد مرورگر
    let browser = 'مرورگر';
    if (/Edg\//i.test(ua)) browser = 'Edge';
    else if (/Chrome\//i.test(ua)) browser = 'Chrome';
    else if (/Firefox\//i.test(ua)) browser = 'Firefox';
    else if (/Safari\//i.test(ua)) browser = 'Safari';

    return `${browser} on ${os}`;
}

/**
 * فرمت انقضا برای نمایش در UI.
 *
 * @param {string|null} expiresAt
 * @returns {string}
 */
export function formatExpiry(expiresAt) {
    if (!expiresAt) return '—';
    const days = daysUntilExpiry(expiresAt);
    if (!Number.isFinite(days)) return '—';
    if (days < 0) return i18nT('auth.expiry.expired');
    if (days < 1) {
        const hours = Math.max(1, Math.floor(days * 24));
        return i18nT('auth.expiry.lessThanHour', { n: toFa(hours) });
    }
    if (days < 30) return i18nT('auth.expiry.days', { n: toFa(Math.floor(days)) });

    // ─── برای بازه‌های بلندتر، هم ماه و هم روز را نشان بده ───
    if (days < 365) {
        const months = Math.floor(days / 30);
        const remainingDays = Math.floor(days - months * 30);
        if (remainingDays > 0) {
            return i18nT('auth.expiry.monthsAndDays', { months: toFa(months), days: toFa(remainingDays) });
        }
        return i18nT('auth.expiry.months', { n: toFa(months) });
    }

    // ─── بیش از یک سال ───
    const years = Math.floor(days / 365);
    const remainingAfterYears = days - years * 365;
    const months = Math.floor(remainingAfterYears / 30);
    if (months > 0) {
        return i18nT('auth.expiry.yearsAndMonths', { years: toFa(years), months: toFa(months) });
    }
    return i18nT('auth.expiry.years', { n: toFa(years) });
}

/**
 * برچسب فارسی برای یک TTL به روز.
 *
 * @param {number} days — ۳۰، ۹۰، ۱۸۰، ۳۶۵
 * @returns {string}
 */
export function ttlLabel(days) {
    if (days === 30) return i18nT('auth.ttl.month1');
    if (days === 90) return i18nT('auth.ttl.month3');
    if (days === 180) return i18nT('auth.ttl.month6');
    if (days === 365) return i18nT('auth.ttl.year1');
    return i18nT('auth.ttl.days', { n: toFa(days) });
}

/**
 * لیست مقادیر مجاز TTL (هماهنگ با ALLOWED_TTL_DAYS در Worker).
 */
export const ALLOWED_TTL_DAYS = [30, 90, 180, 365];

// ═══════════════════════════════════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════════════════════════════════

/**
 * راه‌اندازی ماژول auth.
 *
 * این تابع:
 *   - state.sync.deviceId را مقداردهی می‌کند.
 *   - به sync:auth-expired گوش می‌دهد (از sync-queue در گام ۳).
 *   - به net:online گوش می‌دهد تا در صورت نیاز refresh کند.
 *
 * ⚠️ idempotent است.
 */
export function initAuth() {
    if (_started) return;
    _started = true;

    state.sync.deviceId = getDeviceId();
    state.sync.endpoint = state.sync.endpoint || DEFAULT_ENDPOINT;

    // ─── گوش دادن به رویداد sync:auth-expired (از sync-queue) ───
    events.on('sync:auth-expired', () => {
        // sync-queue متوجه شد که توکن منقضی شده → ما هم پاک کن
        logout({ silent: false });
    });

    // ─── گوش دادن به آنلاین شدن برای refresh خودکار ───
    events.on('net:online', () => {
        const st = getAuthState();
        if (st.loggedIn && st.needsRefresh) {
            refreshToken().catch(() => {});
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// پایان auth.js
// ═══════════════════════════════════════════════════════════════════════════