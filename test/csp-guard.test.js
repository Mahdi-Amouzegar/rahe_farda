// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/csp-guard.test.js — نگهبان CSP: حذف هندلرهای inline تزریق‌شده (۱۰.۴۲)

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    initCspGuard,
    stopCspGuard,
    getCspGuardRemovedCount,
    __resetCspGuardForTest,
} from '../js/csp-guard.js';

/** یک tick صبر می‌کند تا MutationObserver اجرا شود. */
function nextTick() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('csp-guard', () => {
    beforeEach(() => {
        __resetCspGuardForTest();
        document.body.innerHTML = '';
    });

    afterEach(() => {
        stopCspGuard();
        __resetCspGuardForTest();
        document.body.innerHTML = '';
    });

    it('هندلر inline موجود در DOM را در پاک‌سازی اولیه حذف می‌کند', () => {
        const btn = document.createElement('button');
        btn.id = 'legacy';
        btn.setAttribute('onclick', 'window.__pwned = true');
        document.body.appendChild(btn);

        initCspGuard();

        expect(btn.hasAttribute('onclick')).toBe(false);
        expect(getCspGuardRemovedCount()).toBe(1);
    });

    it('چند هندلر روی یک المان را با هم پاک می‌کند', () => {
        const img = document.createElement('img');
        img.setAttribute('onerror', 'this.remove()');
        img.setAttribute('onload', 'this.hidden = false');
        document.body.appendChild(img);

        initCspGuard();

        expect(img.hasAttribute('onerror')).toBe(false);
        expect(img.hasAttribute('onload')).toBe(false);
        expect(getCspGuardRemovedCount()).toBe(2);
    });

    it('هندلر تزریق‌شده بعد از init را هم می‌گیرد', async () => {
        initCspGuard();

        const div = document.createElement('div');
        document.body.appendChild(div);
        div.setAttribute('onclick', 'window.__late = true');

        await nextTick();

        expect(div.hasAttribute('onclick')).toBe(false);
        expect(getCspGuardRemovedCount()).toBe(1);
    });

    it('هندلر داخل زیردرخت تازه‌افزوده‌شده را هم می‌گیرد', async () => {
        initCspGuard();

        const wrap = document.createElement('div');
        const inner = document.createElement('span');
        inner.setAttribute('onclick', 'x()');
        wrap.appendChild(inner);
        document.body.appendChild(wrap);

        await nextTick();

        expect(inner.hasAttribute('onclick')).toBe(false);
    });

    it('attributeهای عادی را دست نمی‌زند', () => {
        const btn = document.createElement('button');
        btn.className = 'action';
        btn.setAttribute('data-action', 'save');
        btn.setAttribute('aria-label', 'ذخیره');
        btn.setAttribute('title', 'ذخیره');
        document.body.appendChild(btn);

        initCspGuard();

        expect(btn.getAttribute('data-action')).toBe('save');
        expect(btn.getAttribute('aria-label')).toBe('ذخیره');
        expect(btn.getAttribute('title')).toBe('ذخیره');
        expect(getCspGuardRemovedCount()).toBe(0);
    });

    it('property assignment (addEventListener) را دست نمی‌زند', () => {
        const btn = document.createElement('button');
        let clicks = 0;
        btn.addEventListener('click', () => { clicks++; });
        document.body.appendChild(btn);

        initCspGuard();
        btn.click();

        expect(clicks).toBe(1);
        expect(getCspGuardRemovedCount()).toBe(0);
    });

    it('بعد از stop دیگر چیزی حذف نمی‌شود', async () => {
        initCspGuard();
        stopCspGuard();

        const div = document.createElement('div');
        document.body.appendChild(div);
        div.setAttribute('onclick', 'x()');

        await nextTick();

        expect(div.hasAttribute('onclick')).toBe(true);
    });

    it('init دوباره بی‌اثر است (idempotent)', () => {
        const btn = document.createElement('button');
        btn.setAttribute('onclick', 'x()');
        document.body.appendChild(btn);

        initCspGuard();
        initCspGuard();

        expect(btn.hasAttribute('onclick')).toBe(false);
        expect(getCspGuardRemovedCount()).toBe(1);
    });
});
