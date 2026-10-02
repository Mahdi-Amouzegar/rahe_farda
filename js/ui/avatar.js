// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/ui/avatar.js -- resolver و رندر آواتار (تصمیم F کاربر)
//
// ⚠️ avatarUrl یکی از این‌هاست:
//   - URL مستقیم https (مثل عکس تلگرام) → همان استفاده می‌شود
//   - `media:<id>` → با GET /api/media/:id resolve می‌شود (کش حافظه‌ای)
//   - خالی → حرف اول نام (fallback همیشه هست، هیچ‌وقت تصویر شکسته نیست)
// ⚠️ بدون innerHTML.
// ═══════════════════════════════════════════════════════════════════════════

import { apiFetch } from '../api.js';

const _urlCache = new Map();

/**
 * resolve یک ref آواتار به URL نمایشی (یا null).
 */
export async function resolveAvatar(ref) {
    if (!ref || typeof ref !== 'string') return null;
    const value = ref.trim();
    if (!value) return null;
    if (_urlCache.has(value)) return _urlCache.get(value);

    let url = null;
    if (value.startsWith('media:')) {
        const mediaId = value.slice('media:'.length);
        if (mediaId) {
            try {
                const res = await apiFetch('/api/media/' + encodeURIComponent(mediaId));
                if (res.ok && res.data && typeof res.data.downloadUrl === 'string') {
                    url = res.data.downloadUrl;
                }
            } catch { /* silent — fallback به حرف اول */ }
        }
    } else if (value.startsWith('https://')) {
        url = value;
    }
    _urlCache.set(value, url);
    return url;
}

/**
 * پاک کردن کش (مثلاً بعد از تغییر آواتار خودم).
 */
export function clearAvatarCache() {
    _urlCache.clear();
}

function initialOf(name) {
    const t = String(name || '').trim();
    return t ? t.charAt(0) : '?';
}

/**
 * ساخت نود آواتار: اول حرف، بعداً (async) عکس اگر resolve شد.
 *
 * @param {string|null} ref
 * @param {string} fallbackName
 * @param {string} [className='conv-avatar']
 */
export function avatarNode(ref, fallbackName, className) {
    const span = document.createElement('span');
    span.className = className || 'conv-avatar';
    span.textContent = initialOf(fallbackName);
    span.setAttribute('aria-hidden', 'true');
    if (!ref) return span;
    resolveAvatar(ref).then((url) => {
        if (!url || !span.isConnected) return;
        const img = document.createElement('img');
        img.className = 'conv-avatar-img';
        img.alt = '';
        img.setAttribute('aria-hidden', 'true');
        img.src = url;
        img.addEventListener('error', () => {
            if (img.parentNode === span) {
                span.replaceChildren(document.createTextNode(initialOf(fallbackName)));
            }
        });
        span.replaceChildren(img);
    }).catch(() => { /* fallback می‌ماند */ });
    return span;
}

/**
 * hydrate همه‌ی [data-avatar] داخل یک ریشه.
 */
export function hydrateAvatars(root) {
    if (!root || !root.querySelectorAll) return;
    for (const node of root.querySelectorAll('[data-avatar]')) {
        const ref = node.getAttribute('data-avatar');
        const name = node.getAttribute('data-avatar-name') || '';
        if (!ref) continue;
        resolveAvatar(ref).then((url) => {
            if (!url || !node.isConnected) return;
            if (node.tagName === 'IMG') {
                node.src = url;
            } else {
                node.replaceChildren();
                const img = document.createElement('img');
                img.className = 'conv-avatar-img';
                img.alt = '';
                img.src = url;
                node.appendChild(img);
            }
        }).catch(() => {});
    }
}

// ⚠️ فقط برای تست
export function __resetAvatarCacheForTest() {
    _urlCache.clear();
}
