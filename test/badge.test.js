// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/badge.test.js — تست‌های بج شمارش (T2)

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../js/i18n.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, t: (key) => key };
});

import { setBadge, clearBadge } from '../js/ui/badge.js';
import { formatNumber } from '../js/i18n.js';

beforeEach(() => {
    document.body.innerHTML = '';
});

describe('badge', () => {
    it('صفر یعنی پنهان', () => {
        const el = document.createElement('span');
        document.body.appendChild(el);
        setBadge(el, 0);
        expect(el.hidden).toBe(true);
        expect(el.textContent).toBe('');
    });

    it('عدد مثبت با formatNumber نمایش داده می‌شود', () => {
        const el = document.createElement('span');
        document.body.appendChild(el);
        setBadge(el, 5);
        expect(el.hidden).toBe(false);
        expect(el.textContent).toBe(formatNumber(5));
        expect(el.getAttribute('data-count')).toBe('5');
    });

    it('clearBadge پنهان می‌کند', () => {
        const el = document.createElement('span');
        document.body.appendChild(el);
        setBadge(el, 3);
        clearBadge(el);
        expect(el.hidden).toBe(true);
    });

    it('المان null خطا نمی‌دهد', () => {
        expect(() => setBadge(null, 5)).not.toThrow();
        expect(() => clearBadge(null)).not.toThrow();
    });
});
