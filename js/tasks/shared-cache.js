// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/tasks/shared-cache.js -- کش ماندگار لیست مقصدهای مشترک (نشست ۱۰.۴۰)
//
// ⚠️ مسئله:
//   `_sharedCache` در `source.js` فقط درون‌حافظه بود. با رفرش صفحه — یا حتی
//   قطع شبکه و باز کردن دوباره‌ی همان گفتگو/گروه — لیست خالی می‌شد، در حالی
//   که کاربر انتظار دارد آخرین برداشتِ خودش از سرور را ببیند.
//
// ⚠️ چرا localStorage و نه IndexedDB؟
//   - IDB مشترک (`spaceTodoDB`) نسخه‌ی ۴ دارد و سه ماژول هم‌زمان بازش می‌کنند؛
//     افزودن store تازه یعنی bump نسخه و ریسک upgrade هم‌زمان در بوت.
//   - payload مشترک بایت عکس ندارد (stripPhotoBytesForSync) و با سقف حجم
//     زیر چند صد کیلوبایت می‌ماند؛ localStorage کافی و بی‌ریسک است.
//
// ⚠️ ایزولاسیون کاربر: کلید شامل userId است تا داده‌ی یک حساب روی مرورگر
//    مشترک به حساب بعدی لو نرود.
// ═══════════════════════════════════════════════════════════════════════════

const PREFIX = 'rahefardaSharedCache:';
const MAX_ITEMS = 300;
const MAX_CHARS = 1_800_000; // ~۱.۸ مگابایت سقف کل نقشه

let _userId = 'anon';

/**
 * تعیین کاربر جاری برای کلید کش (قبل از هر خواندن/نوشتن صدا زده شود).
 * @param {string|null} userId
 */
export function setSharedCacheUser(userId) {
    _userId = userId ? String(userId) : 'anon';
}

function storeKey() {
    return PREFIX + _userId;
}

function readMap() {
    try {
        const raw = localStorage.getItem(storeKey());
        const obj = raw ? JSON.parse(raw) : null;
        return obj && typeof obj === 'object' ? obj : {};
    } catch {
        return {};
    }
}

function writeMap(map) {
    try {
        let json = JSON.stringify(map);
        if (json.length > MAX_CHARS) {
            // سقف حجم: قدیمی‌ترین مقصدها را بریز
            const keys = Object.keys(map);
            while (json.length > MAX_CHARS && keys.length > 1) {
                delete map[keys.shift()];
                json = JSON.stringify(map);
            }
        }
        localStorage.setItem(storeKey(), json);
        return true;
    } catch {
        return false; // private mode / سهمیه پر
    }
}

/**
 * کپی قابل‌ذخیره از یک آیتم: بایت عکس (dataUrl) و Blob حذف می‌شوند.
 * ارجاع سروری (`serverMediaId` / `mediaIds`) می‌ماند تا نمایش lazy کار کند.
 */
function stripForCache(item) {
    try {
        return JSON.parse(JSON.stringify(item, (key, value) => {
            if (key === 'dataUrl' || key === 'blob' || key === 'objectUrl') return undefined;
            return value;
        }));
    } catch {
        return null;
    }
}

/**
 * ذخیره‌ی لیست یک مقصد.
 * @param {string|null} destKey مثل `peer:<id>` / `group:<id>`
 * @param {object[]} items
 */
export function saveSharedItems(destKey, items) {
    if (!destKey) return false;
    const list = (Array.isArray(items) ? items : [])
        .slice(-MAX_ITEMS)
        .map(stripForCache)
        .filter(Boolean);
    const map = readMap();
    map[destKey] = { items: list, at: Date.now() };
    return writeMap(map);
}

/**
 * خواندن لیست ذخیره‌شده‌ی یک مقصد (بدون کش درون‌حافظه — همیشه از دیسک).
 * @param {string|null} destKey
 * @returns {object[]}
 */
export function loadSharedItems(destKey) {
    if (!destKey) return [];
    const entry = readMap()[destKey];
    return entry && Array.isArray(entry.items) ? entry.items : [];
}

/**
 * حذف لیست یک مقصد (مثلاً بعد از خروج از گروه).
 */
export function clearSharedItems(destKey) {
    if (!destKey) return;
    const map = readMap();
    if (!(destKey in map)) return;
    delete map[destKey];
    writeMap(map);
}

/**
 * پاک کردن کل کش این کاربر.
 */
export function clearAllSharedItems() {
    try {
        localStorage.removeItem(storeKey());
    } catch { /* silent */ }
}

// ⚠️ فقط برای تست
export function __resetSharedCacheForTest() {
    _userId = 'anon';
    clearAllSharedItems();
}
