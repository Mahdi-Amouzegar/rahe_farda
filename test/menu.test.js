// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/menu.test.js — تست‌های کامپوننت منوی ⋯ (T2)
//
// ⚠️ i18n را مثل header-status.test.js mock می‌کنیم (fetch در jsdom نیست).

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

vi.mock('../js/i18n.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, t: (key) => key };
});

import { openMenu, closeMenu, isMenuOpen } from '../js/ui/menu.js';

const ITEMS = [
    { id: 'edit', label: 'ویرایش', icon: '✏️' },
    { id: 'share', label: 'اشتراک‌گذاری' },
    { id: 'delete', label: 'حذف', danger: true },
];

function makeAnchor() {
    const btn = document.createElement('button');
    btn.textContent = '⋯';
    document.body.appendChild(btn);
    return btn;
}

beforeEach(() => {
    document.body.innerHTML = '';
    closeMenu();
});

afterEach(() => {
    closeMenu();
    document.body.innerHTML = '';
});

describe('menu — open/close', () => {
    it('با آیتم‌ها باز می‌شود و نقش menu دارد', () => {
        const anchor = makeAnchor();
        openMenu({ anchor, items: ITEMS, onSelect: () => {} });
        expect(isMenuOpen()).toBe(true);
        const menu = document.querySelector('.menu-pop');
        expect(menu).not.toBeNull();
        expect(menu.getAttribute('role')).toBe('menu');
        expect(menu.querySelectorAll('[role="menuitem"]').length).toBe(3);
    });

    it('بدون آیتم باز نمی‌شود', () => {
        const anchor = makeAnchor();
        openMenu({ anchor, items: [], onSelect: () => {} });
        expect(isMenuOpen()).toBe(false);
        expect(document.querySelector('.menu-pop')).toBeNull();
    });

    it('فقط یک منو در هر لحظه (باز کردن دوم، اولی را می‌بندد)', () => {
        const anchor = makeAnchor();
        openMenu({ anchor, items: ITEMS, onSelect: () => {} });
        openMenu({ anchor, items: ITEMS, onSelect: () => {} });
        expect(document.querySelectorAll('.menu-pop').length).toBe(1);
    });

    it('Escape می‌بندد', () => {
        const anchor = makeAnchor();
        openMenu({ anchor, items: ITEMS, onSelect: () => {} });
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(isMenuOpen()).toBe(false);
    });

    it('کلیک بیرون می‌بندد', () => {
        const anchor = makeAnchor();
        openMenu({ anchor, items: ITEMS, onSelect: () => {} });
        const outside = document.createElement('div');
        document.body.appendChild(outside);
        outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        expect(isMenuOpen()).toBe(false);
    });
});

describe('menu — select', () => {
    it('کلیک روی آیتم، onSelect را با id صدا می‌زند و می‌بندد', () => {
        const anchor = makeAnchor();
        const seen = [];
        openMenu({ anchor, items: ITEMS, onSelect: (id) => seen.push(id) });
        const btn = document.querySelector('[data-menu-id="share"]');
        expect(btn).not.toBeNull();
        btn.click();
        expect(seen).toEqual(['share']);
        expect(isMenuOpen()).toBe(false);
    });

    it('آیتم danger کلاس خطر دارد', () => {
        const anchor = makeAnchor();
        openMenu({ anchor, items: ITEMS, onSelect: () => {} });
        const btn = document.querySelector('[data-menu-id="delete"]');
        expect(btn.className).toContain('menu-item--danger');
    });

    it('لیبل با textContent رندر می‌شود (بدون HTML)', () => {
        const anchor = makeAnchor();
        openMenu({
            anchor,
            items: [{ id: 'x', label: '<img src=x onerror=alert(1)>' }],
            onSelect: () => {},
        });
        const btn = document.querySelector('[data-menu-id="x"]');
        expect(btn.querySelector('img')).toBeNull();
        expect(btn.textContent).toContain('<img src=x onerror=alert(1)>');
    });
});

describe('menu — keyboard', () => {
    it('ArrowDown فوکوس را جلو می‌برد', () => {
        const anchor = makeAnchor();
        openMenu({ anchor, items: ITEMS, onSelect: () => {} });
        const buttons = [...document.querySelectorAll('[data-menu-id]')];
        buttons[0].focus();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        expect(document.activeElement).toBe(buttons[1]);
    });
});
