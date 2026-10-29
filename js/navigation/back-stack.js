// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/navigation/back-stack.js -- مدیریت مرکزی دکمه‌ی برگشت (اندروید/TWA + مرورگر)
//
// ⚠️ 10.43: چرا این ماژول وجود دارد
//   در نسخه‌ی نصب‌شده (TWA) دکمه‌ی برگشت اندروید کل برنامه را می‌بست، حتی وقتی
//   دراور/جزئیات/تنظیمات باز بود. دلیل: برنامه **هیچ ورودی تاریخچه‌ای** جز صفحه‌ی
//   اول ندارد و TWA دکمه‌ی برگشت را به همان تاریخچه‌ی وب می‌سپارد؛ نبودِ ورودی
//   یعنی «کاری برای برگشت نیست» ⇒ بستن اکتیویتی.
//
//   راه‌حل، بدون هیچ تغییر بومی (بدون rebuild کردن APK):
//   ۱. همیشه **یک** ورودی نگهبان در تاریخچه نگه می‌داریم (`armGuard`). پس دکمه‌ی
//      برگشت همیشه یک pop دارد و به `popstate` تبدیل می‌شود، نه به خروج.
//   ۲. در `popstate` بالاترین لایه‌ی باز را می‌بندیم و نگهبان را دوباره می‌گذاریم
//      (پس فشار بعدی هم مهار می‌شود). لایه‌ها در یک فهرست **مرتب** ثبت می‌شوند؛
//      هیچ صفحه‌ای هندلر جداگانه ندارد.
//   ۳. در ریشه (هیچ لایه‌ای باز نیست) اولین برگشت فقط پیام می‌دهد و نگهبان را
//      برنمی‌گرداند؛ در این پنجره‌ی ۲ ثانیه‌ای، برگشت دوم طبیعی از برنامه خارج
//      می‌شود. اگر ۲ ثانیه بگذرد، نگهبان دوباره گذاشته می‌شود.
//
// ⚠️ قرارداد:
//   - هرگز `history.back()` را خودمان صدا نمی‌زنیم؛ پس هیچ pop قابل‌سرکوبی نیست
//     و نیازی به شمارنده‌ی suppression نیست.
//   - ورودی نگهبان با `pushState` روی همان URL ساخته می‌شود (بدون reload و بدون
//     تغییر مسیر) — با مسیریابی فعلی (که وجود ندارد) تضاد ندارد.
//   - `history.replaceState` های موجود (auth/pwa/groups) ورودی اضافه نمی‌کنند،
//     پس عمق تاریخچه را به‌هم نمی‌زنند.
//   - لایه‌ها از پایین به بالا مرتب می‌شوند؛ «بالاترین لایه‌ی باز» آخرین موردِ
//     باز در فهرست است.
// ═══════════════════════════════════════════════════════════════════════════

/** پنجره‌ی «دوباره برگشت بزن تا خارج شوی» (ms) */
export const EXIT_WINDOW_MS = 2000;

const GUARD_KEY = 'rfBackGuard';

/** @type {Array<{id: string, isOpen: () => boolean, close: () => void}>} */
let _layers = [];
let _message = () => '';
let _showToast = null;

/** آیا ورودی نگهبان همین حالا در تاریخچه هست؟ */
let _guard = false;
/** زمان اولین برگشت در ریشه (0 = پنجره باز نیست) */
let _armedAt = 0;
let _armTimer = null;
let _started = false;

// ─── تاریخچه ────────────────────────────────────────────────────────────────

function hasHistory() {
    try {
        return typeof window !== 'undefined'
            && window.history
            && typeof window.history.pushState === 'function';
    } catch {
        return false;
    }
}

/**
 * گذاشتن ورودی نگهبان (idempotent).
 * @returns {boolean} true اگر ورودی همین حالا موجود است
 */
export function armGuard() {
    if (_guard) return true;
    if (!hasHistory()) return false;
    try {
        window.history.pushState({ [GUARD_KEY]: true, at: Date.now() }, '');
        _guard = true;
        return true;
    } catch (err) {
        console.warn('[back] pushState failed:', err);
        return false;
    }
}

/**
 * آیا ورودی نگهبان فعال است؟ (برای تست/تشخیص)
 */
export function isGuardActive() {
    return _guard;
}

function clearArmTimer() {
    if (_armTimer) {
        clearTimeout(_armTimer);
        _armTimer = null;
    }
}

function disarmRootExit() {
    _armedAt = 0;
    clearArmTimer();
}

/**
 * اگر کاربر بعد از پیام «دوباره برگشت بزن» کاری کرد (لمس/کلیک/کلید)، نگهبان
 * دوباره گذاشته می‌شود تا آن کار با یک برگشت بسته شود، نه با خروج از برنامه.
 */
function rearmOnInteraction(event) {
    if (!_armedAt) return;
    // ⚠️ خود «برگشت» را به‌عنوان تعامل حساب نکن؛ وگرنه پنجره‌ی خروج هرگز
    // بسته نمی‌شود (فایرفاکس/بعضی WebViewها کلید GoBack می‌فرستند).
    const key = event && typeof event.key === 'string' ? event.key : '';
    if (key === 'BrowserBack' || key === 'GoBack' || key === 'Back') return;
    disarmRootExit();
    armGuard();
}

// ─── لایه‌ها ────────────────────────────────────────────────────────────────

/**
 * ثبت فهرست لایه‌ها (از پایین به بالا).
 * @param {Array<{id: string, isOpen: () => boolean, close: () => void}>} layers
 */
export function setBackLayers(layers) {
    _layers = Array.isArray(layers)
        ? layers.filter((l) => l && typeof l.id === 'string'
            && typeof l.isOpen === 'function'
            && typeof l.close === 'function')
        : [];
    return _layers.length;
}

/**
 * آیا این لایه باز است؟ (خطای isOpen = بسته)
 */
export function isLayerOpen(layer) {
    if (!layer || typeof layer.isOpen !== 'function') return false;
    try {
        return Boolean(layer.isOpen());
    } catch (err) {
        console.error('[back] isOpen failed:', layer.id, err);
        return false;
    }
}

/**
 * بالاترین لایه‌ی باز (یا null).
 */
export function findTopLayer() {
    for (let i = _layers.length - 1; i >= 0; i -= 1) {
        if (isLayerOpen(_layers[i])) return _layers[i];
    }
    return null;
}

/**
 * بستن بالاترین لایه‌ی باز.
 * @returns {string|null} شناسه‌ی لایه‌ی بسته‌شده
 */
export function closeTopLayer() {
    const layer = findTopLayer();
    if (!layer) return null;
    try {
        layer.close();
    } catch (err) {
        console.error('[back] close failed:', layer.id, err);
    }
    return layer.id;
}

// ─── هسته ───────────────────────────────────────────────────────────────────

/**
 * منطق مرکزی برگشت — جدا از رویداد تا مستقیم تست شود.
 *
 * @returns {'layer'|'root'|'exit'} نتیجه:
 *   layer = یک لایه بسته شد
 *   root  = در ریشه بودیم؛ پیام خروج داده شد (برگشت دوم خارج می‌کند)
 *   exit  = برگشت دوم در پنجره‌ی ۲ ثانیه — بگذار خارج شود
 */
export function handleBack() {
    // هر pop یعنی ورودی نگهبان مصرف شده است.
    _guard = false;

    const closedId = closeTopLayer();
    if (closedId) {
        armGuard();
        disarmRootExit();
        return 'layer';
    }

    const now = Date.now();
    if (_armedAt && (now - _armedAt) <= EXIT_WINDOW_MS) {
        // ⚠️ عمداً نگهبان را برنمی‌گردانیم: برگشت بعدی باید برنامه را ببندد.
        disarmRootExit();
        return 'exit';
    }

    _armedAt = now;
    try {
        if (typeof _showToast === 'function') _showToast(_message());
    } catch (err) {
        console.warn('[back] toast failed:', err);
    }
    clearArmTimer();
    _armTimer = setTimeout(() => {
        _armTimer = null;
        _armedAt = 0;
        armGuard();
    }, EXIT_WINDOW_MS);
    return 'root';
}

function onPopState() {
    handleBack();
}

// ─── راه‌اندازی ─────────────────────────────────────────────────────────────

/**
 * راه‌اندازی (idempotent). باید **قبل از** باز شدن هر پنجره/ویزارد صدا زده شود.
 *
 * @param {Object} options
 * @param {Array} [options.layers] — فهرست لایه‌ها (پایین → بالا)
 * @param {() => string} [options.message] — متن پیام «دوباره برگشت بزن»
 * @param {(text: string) => void} [options.showToast] — نمایش پیام غیرمزاحم
 */
export function initBackStack(options) {
    const opts = options || {};
    if (Array.isArray(opts.layers)) setBackLayers(opts.layers);
    if (typeof opts.message === 'function') _message = opts.message;
    if (typeof opts.showToast === 'function') _showToast = opts.showToast;

    if (_started) {
        armGuard();
        return;
    }
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    _started = true;
    window.addEventListener('popstate', onPopState);
    document.addEventListener('pointerdown', rearmOnInteraction, true);
    document.addEventListener('keydown', rearmOnInteraction, true);
    armGuard();
}

/**
 * آیا راه‌اندازی شده است؟
 */
export function isBackStackReady() {
    return _started;
}

// ⚠️ فقط برای تست
export function __resetBackStackForTest() {
    clearArmTimer();
    _layers = [];
    _message = () => '';
    _showToast = null;
    _guard = false;
    _armedAt = 0;
    _started = false;
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('popstate', onPopState);
    }
    if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('pointerdown', rearmOnInteraction, true);
        document.removeEventListener('keydown', rearmOnInteraction, true);
    }
}

export function __getBackStackStateForTest() {
    return {
        guard: _guard,
        armedAt: _armedAt,
        started: _started,
        layerCount: _layers.length,
        topLayer: (findTopLayer() || {}).id || null,
    };
}
