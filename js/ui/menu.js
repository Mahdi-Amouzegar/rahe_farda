// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/ui/menu.js -- کامپوننت منوی overflow (⋯) — Phase 8 (T2)
//
// ⚠️ قرارداد UI-SHELL §۷ و §۱۰:
//   - همه‌ی منوهای ⋯ (تسک، پیام، گفتگو، گروه) از همین کامپوننت استفاده می‌کنند
//   - هیچ innerHTML — فقط DOM API و textContent (محتوای کاربر هرگز HTML نمی‌شود)
//   - یک منو در هر لحظه؛ بستن با کلیک بیرون / Escape ؛ ناوبری کیبورد
//   - آیتم نامجاز رندر نمی‌شود (نه disabled) — caller فیلتر می‌کند
// ═══════════════════════════════════════════════════════════════════════════

import { trapFocus } from '../core.js';

let openMenuCleanup = null;

/**
 * بستن منوی باز (اگر هست).
 */
export function closeMenu() {
    if (openMenuCleanup) {
        openMenuCleanup();
        openMenuCleanup = null;
    }
}

/**
 * باز کردن منو کنار یک anchor.
 *
 * @param {Object} options
 * @param {Element} options.anchor - عنصری که منو کنارش باز می‌شود
 * @param {Array<{id:string,label:string,icon?:string,danger?:boolean}>} options.items
 * @param {(id:string) => void} options.onSelect
 * @param {string} [options.label] - aria-label منو
 * @returns {() => void} تابع بستن
 */
export function openMenu({ anchor, items, onSelect, label }) {
    closeMenu();
    if (!anchor || !Array.isArray(items) || items.length === 0) return () => {};

    const menu = document.createElement('div');
    menu.className = 'menu-pop';
    menu.setAttribute('role', 'menu');
    if (label) menu.setAttribute('aria-label', label);

    const buttons = [];
    for (const item of items) {
        if (!item || typeof item.id !== 'string') continue;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'menu-item' + (item.danger ? ' menu-item--danger' : '');
        btn.setAttribute('role', 'menuitem');
        btn.dataset.menuId = item.id;
        if (item.icon) {
            const icon = document.createElement('span');
            icon.className = 'menu-item-icon';
            icon.setAttribute('aria-hidden', 'true');
            icon.textContent = item.icon;
            btn.appendChild(icon);
        }
        const text = document.createElement('span');
        text.className = 'menu-item-label';
        text.textContent = String(item.label ?? item.id);
        btn.appendChild(text);
        btn.addEventListener('click', () => {
            const id = item.id;
            closeMenu();
            if (typeof onSelect === 'function') onSelect(id);
        });
        menu.appendChild(btn);
        buttons.push(btn);
    }

    if (buttons.length === 0) return () => {};

    // ─── موقعیت: کنار anchor، داخل viewport ───
    menu.style.position = 'fixed';
    menu.style.zIndex = '500';
    document.body.appendChild(menu);
    try {
        const rect = anchor.getBoundingClientRect();
        const mw = menu.offsetWidth || 0;
        const mh = menu.offsetHeight || 0;
        const rtl = document.documentElement.getAttribute('dir') === 'rtl';
        let x = rtl ? rect.left - mw : rect.right;
        let y = rect.bottom + 4;
        const vw = window.innerWidth || 1024;
        const vh = window.innerHeight || 768;
        if (x + mw > vw) x = Math.max(8, vw - mw - 8);
        if (x < 8) x = 8;
        if (y + mh > vh) y = Math.max(8, rect.top - mh - 4);
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
    } catch { /* jsdom یا خطا — همان (0,0) */ }

    const untrap = trapFocus(menu);

    const onPointerDown = (e) => {
        if (!menu.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) {
            closeMenu();
        }
    };
    const onKeyDown = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            closeMenu();
            if (anchor && typeof anchor.focus === 'function') anchor.focus();
            return;
        }
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        const idx = buttons.indexOf(document.activeElement);
        e.preventDefault();
        if (e.key === 'ArrowDown') {
            (buttons[idx + 1] || buttons[0]).focus();
        } else {
            (buttons[idx - 1] || buttons[buttons.length - 1]).focus();
        }
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);

    openMenuCleanup = () => {
        document.removeEventListener('pointerdown', onPointerDown, true);
        document.removeEventListener('keydown', onKeyDown, true);
        try { untrap(); } catch { /* silent */ }
        if (menu.parentNode) menu.parentNode.removeChild(menu);
        if (openMenuCleanup) openMenuCleanup = null;
    };

    const first = buttons[0];
    if (first && typeof first.focus === 'function') first.focus();

    return () => closeMenu();
}

/**
 * آیا منویی باز است؟
 */
export function isMenuOpen() {
    return openMenuCleanup !== null;
}
