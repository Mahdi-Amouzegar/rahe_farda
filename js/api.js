// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/api.js -- کلاینت مشترک بک‌اند (Phase 8 — 8.2-A)
//
// ⚠️ قرارداد 8.2-A: این تنها مسیر جدید برای requestهای ارتباطی است.
//    ماژول‌های communication/* مستقیماً fetch نمی‌زنند.
//    (fetchهای قدیمی خارج از communication فعلاً می‌مانند — refactor آن‌ها scope نیست.)
//
// ⚠️ قرارداد پاسخ:
//    - موفق: { ok: true, data }
//    - ناموفق: { ok: false, error: { code, message, status } }
//    - apiErrorMessage() کدها را به پیام کاربرپسند (fa/en) نگاشت می‌کند.
// ═══════════════════════════════════════════════════════════════════════════

import { state } from './core.js';
import { t as i18nT } from './i18n.js';

const DEFAULT_ENDPOINT = 'https://rahe-farda-sync.mhdamouz.workers.dev';

/**
 * ⚠️ 10.21/BUG-22: بدون timeout، یک درخواست گیرکرده تا سقف مرورگر
 * (~۳۰-۶۰ ثانیه) باز می‌ماند و در کنسول `net::ERR_TIMED_OUT` می‌دهد؛
 * بدتر: درخواست‌های بعدی (پالس دراور/یادآور) روی همان اتصال‌های اشغال‌شده
 * صف می‌شوند. سقف ۱۲ ثانیه یعنی شکست سریع + تلاش بعدی در تیک بعدی.
 */
const DEFAULT_TIMEOUT_MS = 12000;

/**
 * آدرس پایه‌ی Worker.
 */
export function getApiEndpoint() {
    try {
        return state.sync.endpoint || DEFAULT_ENDPOINT;
    } catch {
        return DEFAULT_ENDPOINT;
    }
}

/**
 * توکن احراز هویت فعلی (یا null).
 */
export function getAuthToken() {
    try {
        return state.sync.authToken || null;
    } catch {
        return null;
    }
}

/**
 * فراخوانی احرازهوشده‌ی API.
 *
 * @param {string} path - مثل '/api/connections' (می‌تواند query داشته باشد)
 * @param {Object} [options]
 * @param {string} [options.method='GET']
 * @param {Object} [options.body]
 * @param {boolean} [options.auth=true] - اگر false، هدر Authorization نمی‌فرستد
 * @param {number} [options.timeoutMs] - سقف زمان (پیش‌فرض ۱۲ ثانیه)
 * @returns {Promise<{ok:true,data:any}|{ok:false,error:{code:string,message:string,status:number|null}}>}
 */
export async function apiFetch(path, options) {
    const opts = options || {};
    const method = opts.method || 'GET';
    const needAuth = opts.auth !== false;

    const token = needAuth ? getAuthToken() : null;
    if (needAuth && !token) {
        return {
            ok: false,
            error: { code: 'NO_AUTH', message: i18nT('errors.unauthorized'), status: 401 },
        };
    }

    const headers = {};
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = 'Bearer ' + token;

    // ⚠️ 10.21/BUG-22: سقف زمان برای هر درخواست (شامل خواندن بدنه).
    const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : DEFAULT_TIMEOUT_MS;
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timer = null;
    if (ctrl) {
        timer = setTimeout(() => {
            try { ctrl.abort(); } catch { /* silent */ }
        }, timeoutMs);
    }

    let response;
    try {
        response = await fetch(getApiEndpoint() + path, {
            method,
            headers,
            body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
            signal: ctrl ? ctrl.signal : undefined,
        });
    } catch (err) {
        if (timer) clearTimeout(timer);
        const aborted = !!(err && (err.name === 'AbortError' || err.code === 20));
        return {
            ok: false,
            error: {
                code: aborted ? 'TIMEOUT' : 'NETWORK_ERROR',
                message: i18nT('errors.network'),
                status: null,
            },
        };
    }

    let payload = null;
    try {
        payload = await response.json();
    } catch {
        payload = null;
    } finally {
        if (timer) clearTimeout(timer);
    }

    if (response.ok && payload && payload.ok === true) {
        return { ok: true, data: payload.data };
    }

    const code = (payload && payload.error && payload.error.code) || ('HTTP_' + response.status);
    const message = (payload && payload.error && payload.error.message) || i18nT('errors.serverError');
    return { ok: false, error: { code, message, status: response.status } };
}

/**
 * پیام کاربرپسند برای خطای API.
 *
 * @param {{code:string,message:string}} error
 * @param {string} [fallbackKey='errors.serverError']
 */
export function apiErrorMessage(error, fallbackKey) {
    if (!error) return i18nT(fallbackKey || 'errors.serverError');
    switch (error.code) {
        case 'NO_AUTH':
            return i18nT('errors.unauthorized');
        case 'NETWORK_ERROR':
            return i18nT('errors.network');
        // ⚠️ فاز ۱۲ — Username Policy (کدها از ورکر می‌آیند، متن‌ها لوکال‌اند)
        case 'USERNAME_RESERVED':
            return i18nT('errors.usernameReserved');
        case 'USERNAME_PROTECTED':
            return i18nT('errors.usernameProtected');
        case 'USERNAME_RESTRICTED':
            return i18nT('errors.usernameRestricted');
        case 'USERNAME_PREMIUM_REVIEW':
            return i18nT('errors.usernamePremiumReview');
        case 'USERNAME_TAKEN':
            return i18nT('errors.usernameTaken');
        case 'USERNAME_INVALID':
            return i18nT('errors.usernameInvalid');
        // ⚠️ فاز ۱۳ — حذف حساب
        case 'ACCOUNT_HAS_GROUPS':
            return i18nT('errors.accountHasGroups');
        default:
            // پیام سرور (فارسی) قابل نمایش است؛ اگر خالی بود fallback
            return error.message || i18nT(fallbackKey || 'errors.serverError');
    }
}
