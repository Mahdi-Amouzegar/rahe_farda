// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/csp-guard.js -- پاک‌سازی هندلرهای inline که CSP اجرایشان را بلاک می‌کند
//
// ─────────────────────────────────────────────────────────────────────────────
// چرا این فایل وجود دارد
// ─────────────────────────────────────────────────────────────────────────────
// CSP پروژه (`script-src 'self' https://unpkg.com https://cdnjs.cloudflare.com`
// بدون `'unsafe-inline'`) هر `on*` attribute را بلاک می‌کند و مرورگر برای **هر
// نمونه** یک خطا در کنسول می‌نویسد:
//
//   Executing inline event handler violates the following Content Security
//   Policy directive 'script-src ...'
//
// در کد پروژه هیچ `on*` attribute ای ساخته نمی‌شود؛ همه‌جا `addEventListener`
// یا انتساب تابع به property است (که CSP اجازه می‌دهد). پس هر نمونه‌ای که در
// DOM دیده شود **از بیرون** تزریق شده است:
//   - افزونه‌ی مرورگر (شایع‌ترین)
//   - اسکریپت مهمان / بوکمارک‌لت
//   - HTML دستکاری‌شده یا کش‌شده‌ی قدیمی
//   - یک کتابخانه‌ی بیرونی که HTML رشته‌ای با هندلر می‌سازد
//
// چون CSP از قبل اجرای آن هندلرها را بلاک کرده، حذفشان **هیچ رفتار زنده‌ای را
// عوض نمی‌کند**؛ فقط کنسول را تمیز می‌کند و منبع تزریق را لاگ می‌کند تا معلوم
// شود از کجا می‌آید.
//
// ⚠️ محدودیت صادقانه: اگر افزونه در «جهان جدا» (isolated world) خودش یا داخل
//    shadow root خودش تزریق کند، این ماژول آن را نمی‌بیند — و همین خودش
//    تشخیص است: یعنی تزریق بیرون از DOM ماست و از کد پروژه نیست.
//
// ⚠️ قوانین:
//    - بدون innerHTML / بدون ساخت مارک‌آپ — فقط خواندن و حذف attribute.
//    - idempotent؛ چند بار صدا زدن بی‌اثر است.
//    - MutationObserver ارزان است: attributeFilter فقط همان چند نام را می‌بیند.
//    - حذف attribute خودش یک mutation می‌سازد؛ چون بار دوم `hasAttribute` false
//      است، حلقه‌ی بی‌پایان ممکن نیست.

/**
 * فهرست نام‌های attribute ای که CSP آن‌ها را «inline event handler» می‌داند.
 * لیست کامل نیست (هر `on` + حروف)، ولی MutationObserver با همین فهرست کار
 * می‌کند و sweep اولیه با پیشوند `on` هر چیزی را می‌گیرد.
 */
const HANDLER_ATTRS = [
    'onabort', 'onanimationend', 'onanimationiteration', 'onanimationstart',
    'onauxclick', 'onbeforeinput', 'onbeforeunload', 'onblur', 'oncancel',
    'oncanplay', 'onchange', 'onclick', 'onclose', 'oncontextmenu', 'oncopy',
    'oncut', 'ondblclick', 'ondrag', 'ondragend', 'ondragenter', 'ondragleave',
    'ondragover', 'ondragstart', 'ondrop', 'ondurationchange', 'onended',
    'onerror', 'onfocus', 'onformdata', 'oninput', 'oninvalid', 'onkeydown',
    'onkeypress', 'onkeyup', 'onload', 'onloadeddata', 'onloadedmetadata',
    'onloadstart', 'onmousedown', 'onmouseenter', 'onmouseleave', 'onmousemove',
    'onmouseout', 'onmouseover', 'onmouseup', 'onoffline', 'ononline',
    'onpaste', 'onpause', 'onplay', 'onplaying', 'onpointercancel',
    'onpointerdown', 'onpointerenter', 'onpointerleave', 'onpointermove',
    'onpointerout', 'onpointerover', 'onpointerup', 'onprogress',
    'onratechange', 'onreset', 'onresize', 'onscroll', 'onscrollend',
    'onseeked', 'onseeking', 'onselect', 'onslotchange', 'onstalled',
    'onsubmit', 'onsuspend', 'ontimeupdate', 'ontoggle', 'ontouchcancel',
    'ontouchend', 'ontouchmove', 'ontouchstart', 'ontransitioncancel',
    'ontransitionend', 'ontransitionrun', 'ontransitionstart', 'onvolumechange',
    'onwaiting', 'onwheel',
];

const HANDLER_SET = new Set(HANDLER_ATTRS);

/** حداکثر تعداد لاگ جزئی — بعد از آن فقط شمارش. */
const MAX_DETAIL_LOGS = 5;

let _started = false;
let _observer = null;
/** @type {number} */
let _removed = 0;
let _logged = 0;

/**
 * توصیف کوتاه المان برای لاگ: `tag#id.class [attr]` + والد مستقیم.
 * والد مهم است: اگر تزریق از افزونه باشد، معمولاً یک wrapper ناشناس بالای آن است.
 *
 * @param {Element} el
 * @param {string} attr
 * @returns {string}
 */
function describeElement(el, attr) {
    const tag = String(el.tagName || 'node').toLowerCase();
    const id = el.id ? '#' + el.id : '';
    let cls = '';
    try {
        if (el.classList && el.classList.length > 0) {
            cls = '.' + Array.prototype.slice.call(el.classList, 0, 2).join('.');
        }
    } catch { /* classList در دسترس نیست */ }

    let parent = '';
    try {
        const p = el.parentElement;
        if (p) {
            const pTag = String(p.tagName || '').toLowerCase();
            const pId = p.id ? '#' + p.id : '';
            let pCls = '';
            if (p.classList && p.classList.length > 0) {
                pCls = '.' + Array.prototype.slice.call(p.classList, 0, 2).join('.');
            }
            parent = ' در ' + pTag + pId + pCls;
        }
    } catch { /* silent */ }

    return tag + id + cls + ' [' + attr + ']' + parent;
}

/**
 * حذف یک attribute هندلر از یک المان.
 *
 * @param {Element} el
 * @param {string} attr
 * @returns {boolean} آیا چیزی حذف شد؟
 */
function stripHandler(el, attr) {
    try {
        if (!el || !el.hasAttribute || !el.hasAttribute(attr)) return false;
        el.removeAttribute(attr);
    } catch {
        return false;
    }

    _removed++;

    if (_logged < MAX_DETAIL_LOGS) {
        _logged++;
        console.warn(
            '[csp-guard] هندلر inline حذف شد (CSP اجرایش را بلاک کرده بود):',
            describeElement(el, attr)
        );
    } else if (_logged === MAX_DETAIL_LOGS) {
        _logged++;
        console.warn('[csp-guard] نمونه‌های بیشتر لاگ نمی‌شوند — فقط شمارش می‌شود.');
    }

    return true;
}

/**
 * پاک‌سازی همه‌ی attributeهای هندلر روی یک المان (بدون querySelector).
 *
 * @param {Element} el
 * @returns {number}
 */
function stripElement(el) {
    if (!el || !el.attributes || el.attributes.length === 0) return 0;

    let count = 0;
    // از آخر به اول: حذف، ایندکس attributeهای بعدی را جابه‌جا می‌کند
    for (let i = el.attributes.length - 1; i >= 0; i--) {
        const node = el.attributes[i];
        const name = node && node.name;
        if (!name) continue;
        const lower = String(name).toLowerCase();
        // پیشوند on + حروف: هر هندلر inline، حتی آن‌هایی که در فهرست نیستند
        if (!HANDLER_SET.has(lower) && !/^on[a-z]{3,20}$/.test(lower)) continue;
        if (stripHandler(el, name)) count++;
    }
    return count;
}

/**
 * پاک‌سازی یک زیردرخت (یا کل سند).
 *
 * @param {Node} [root]
 * @returns {number}
 */
function sweep(root) {
    const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
    if (!scope || typeof scope.querySelectorAll !== 'function') return 0;

    let count = 0;

    if (scope.nodeType === 1) count += stripElement(scope);

    let nodes;
    try {
        nodes = scope.querySelectorAll('*');
    } catch {
        return count;
    }

    for (let i = 0; i < nodes.length; i++) {
        count += stripElement(nodes[i]);
    }
    return count;
}

/**
 * راه‌اندازی نگهبان. چند بار صدا زدن بی‌اثر است.
 */
export function initCspGuard() {
    if (_started) return;
    _started = true;

    // ۱) هر چیزی که تا این لحظه در DOM نشسته (HTML دستکاری‌شده، تزریق زودتر)
    try {
        const found = sweep(document);
        if (found > 0) {
            console.warn('[csp-guard] مجموع حذف‌شده در پاک‌سازی اولیه:', found);
        }
    } catch { /* silent */ }

    // ۲) هر تزریق بعدی: setAttribute یا parse شدن HTML تازه
    try {
        if (typeof MutationObserver !== 'function') return;

        _observer = new MutationObserver((records) => {
            for (let i = 0; i < records.length; i++) {
                const rec = records[i];

                if (rec.type === 'attributes') {
                    const name = rec.attributeName;
                    if (name && HANDLER_SET.has(String(name).toLowerCase())) {
                        stripHandler(rec.target, name);
                    }
                    continue;
                }

                if (rec.type === 'childList' && rec.addedNodes && rec.addedNodes.length > 0) {
                    for (let j = 0; j < rec.addedNodes.length; j++) {
                        const node = rec.addedNodes[j];
                        if (node && node.nodeType === 1) sweep(node);
                    }
                }
            }
        });

        _observer.observe(document.documentElement, {
            subtree: true,
            attributes: true,
            attributeFilter: HANDLER_ATTRS,
            childList: true,
        });
    } catch { /* MutationObserver در دسترس نیست — پاک‌سازی اولیه کافی است */ }
}

/**
 * توقف نگهبان (برای تست یا خاموش‌کردن دستی از کنسول).
 */
export function stopCspGuard() {
    if (_observer) {
        try { _observer.disconnect(); } catch { /* silent */ }
        _observer = null;
    }
    _started = false;
}

/**
 * تعداد کل هندلرهای inline که تا حالا حذف شده‌اند.
 * @returns {number}
 */
export function getCspGuardRemovedCount() {
    return _removed;
}

/**
 * ریست وضعیت ماژول — فقط برای تست.
 */
export function __resetCspGuardForTest() {
    stopCspGuard();
    _removed = 0;
    _logged = 0;
}
