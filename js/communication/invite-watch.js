// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/communication/invite-watch.js -- پایش سبک «درخواست دوستی / دعوت گروه / انتقال مالکیت»
//
// ⚠️ 10.37 (درخواست کاربر — آیتم ۳ و ۸):
//   قبلاً درخواست دوستی و دعوت گروه فقط با باز کردن دراور دیده می‌شد؛ کاربر
//   هدف تا آن لحظه هیچ خبری نداشت. حالا یک پایش سبک (پیش‌فرض هر ۳۰ ثانیه)
//   اجرا می‌شود و برای هر مورد **تازه** یک toast پایین صفحه نشان می‌دهد:
//     - درخواست دوستی      → v10.friendRequestToast
//     - دعوت به گروه       → v10.groupInviteToast
//     - انتقال مالکیت گروه → v10.becameOwnerToast
//
// ⚠️ قواعد:
//   - اولین اجرا «خط مبنا» است: موارد موجود toast نمی‌دهند (در دراور هستند).
//   - تب مخفی یا آفلاین یا مهمان → هیچ درخواستی زده نمی‌شود.
//   - هر مورد فقط یک بار toast می‌دهد (کلید یکتا در حافظه).
//   - همه‌ی requestها فقط از js/api.js.
// ═══════════════════════════════════════════════════════════════════════════

import { apiFetch } from '../api.js';
import { state } from '../core.js';
import { t as i18nT } from '../i18n.js';
import { isLoggedIn } from '../auth.js';
import { isOnline } from '../net.js';

/** فاصله‌ی پیش‌فرض پایش (میلی‌ثانیه) */
const POLL_MS = 30000;

/** حداکثر toast در یک دور (جلوگیری از سیل پیام) */
const MAX_TOASTS_PER_POLL = 3;

/** مدت نمایش toast */
const TOAST_MS = 7000;

let _timer = null;
let _polling = false;
let _baselined = false;
/** @type {Set<string>} کلید مواردی که یک بار toast داده‌اند */
let _seen = new Set();

function tr(key, fallback) {
    const v = i18nT(key);
    return v !== key ? v : fallback;
}

/**
 * ترجمه + جای‌گذاری پارامترها (روی fallback هم کار می‌کند).
 *
 * @param {string} key
 * @param {string} fallback
 * @param {Record<string, string>} params
 */
function trp(key, fallback, params) {
    const raw = i18nT(key);
    const text = String(raw !== key ? raw : fallback);
    return text.replace(/\{(\w+)\}/g, (m, k) => (
        params && Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : m
    ));
}

function myId() {
    try {
        return (state.sync && state.sync.userId) || null;
    } catch {
        return null;
    }
}

function pageHidden() {
    try {
        return typeof document !== 'undefined' && document.hidden === true;
    } catch {
        return false;
    }
}

async function toast(text) {
    if (!text) return;
    try {
        const { showToast } = await import('../ui.js');
        showToast(text, TOAST_MS);
    } catch { /* best-effort */ }
}

/**
 * نام نمایشی یک کاربر از رکورد `otherUser`.
 */
function nameOf(user) {
    if (!user) return '';
    return String(user.displayName || user.username || '');
}

/**
 * استخراج metadata از payload اعلان (JSON).
 */
function metaOf(payload) {
    try {
        const p = typeof payload === 'string' ? JSON.parse(payload) : payload;
        return (p && p.metadata) || {};
    } catch {
        return {};
    }
}

/**
 * یک دور پایش: موارد تازه را جمع می‌کند و برای هر کدام toast می‌دهد.
 *
 * @returns {Promise<Array<{key: string, kind: string, name: string}>>} موارد فعال
 */
async function collect() {
    const [connRes, invRes, notifRes] = await Promise.all([
        apiFetch('/api/connections').catch(() => null),
        apiFetch('/api/invitations/mine').catch(() => null),
        apiFetch('/api/notifications?unread=true&limit=10').catch(() => null),
    ]);

    const me = myId();
    const items = [];

    // ─── درخواست‌های دوستی ورودی (pending و فرستنده من نیستم) ───
    const connections = (connRes && connRes.ok && connRes.data && connRes.data.connections) || [];
    for (const c of connections) {
        if (!c || c.status !== 'pending') continue;
        if (me && String(c.requestedBy) === String(me)) continue;
        items.push({
            key: 'conn:' + String(c.id),
            kind: 'friend',
            name: nameOf(c.otherUser),
        });
    }

    // ─── دعوت‌های گروهی ───
    const invitations = (invRes && invRes.ok && invRes.data && invRes.data.invitations) || [];
    for (const inv of invitations) {
        if (!inv || !inv.id) continue;
        items.push({
            key: 'grpinv:' + String(inv.id),
            kind: 'group',
            name: String(inv.groupName || ''),
        });
    }

    // ─── انتقال مالکیت (اعلان خوانده‌نشده) ───
    const notifications = (notifRes && notifRes.ok && notifRes.data && notifRes.data.notifications) || [];
    for (const n of notifications) {
        if (!n || n.type !== 'group.ownership_transferred') continue;
        items.push({
            key: 'owner:' + String(n.id),
            kind: 'owner',
            name: String(metaOf(n.payload).groupName || ''),
        });
    }

    return items;
}

/**
 * متن toast بر اساس نوع مورد.
 */
function toastTextFor(item) {
    const params = { name: item.name || tr('tasks.unknownMember', 'یکی از اعضا') };
    if (item.kind === 'friend') {
        return trp('v10.friendRequestToast', 'درخواست دوستی از {name}', params);
    }
    if (item.kind === 'group') {
        return trp('v10.groupInviteToast', 'دعوت به گروه «{name}»', params);
    }
    if (item.kind === 'owner') {
        return trp('v10.becameOwnerToast', 'مالکیت گروه «{name}» به شما منتقل شد', params);
    }
    return '';
}

/**
 * یک دور کامل پایش.
 */
async function pollOnce() {
    if (_polling) return;
    if (!isLoggedIn() || !isOnline() || pageHidden()) return;
    _polling = true;
    try {
        const items = await collect();
        // ─── دور اول: خط مبنا (بدون toast) ───
        if (!_baselined) {
            for (const it of items) _seen.add(it.key);
            _baselined = true;
            return;
        }
        const fresh = items.filter((it) => !_seen.has(it.key));
        // کلیدهای دیده‌شده را نگه می‌داریم ولی مجموعه را کوچک نگه می‌داریم
        for (const it of items) _seen.add(it.key);
        if (_seen.size > 200) {
            _seen = new Set(items.map((it) => it.key));
        }
        let shown = 0;
        for (const it of fresh) {
            if (shown >= MAX_TOASTS_PER_POLL) break;
            await toast(toastTextFor(it));
            shown += 1;
        }
    } catch { /* best-effort */ } finally {
        _polling = false;
    }
}

/**
 * شروع پایش (idempotent). اولین دور بلافاصله اجرا می‌شود و فقط خط مبنا می‌سازد.
 */
export function startInviteWatch() {
    if (_timer) return;
    _baselined = false;
    _seen = new Set();
    // اولین دور بعد از یک مکث کوتاه تا boot کامل شود
    setTimeout(() => { pollOnce().catch(() => {}); }, 4000);
    _timer = setInterval(() => { pollOnce().catch(() => {}); }, POLL_MS);
    // برگشت به تب → بررسی فوری (بدون انتظار ۳۰ ثانیه)
    try {
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
            document.addEventListener('visibilitychange', onVisible);
        }
    } catch { /* silent */ }
}

function onVisible() {
    if (pageHidden()) return;
    pollOnce().catch(() => {});
}

/**
 * توقف پایش.
 */
export function stopInviteWatch() {
    if (_timer) {
        clearInterval(_timer);
        _timer = null;
    }
    try {
        if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
            document.removeEventListener('visibilitychange', onVisible);
        }
    } catch { /* silent */ }
    _polling = false;
    _baselined = false;
    _seen = new Set();
}

// ⚠️ فقط برای تست
export function __resetInviteWatchForTest() {
    stopInviteWatch();
}
