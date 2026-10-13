// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/notify-scan.test.js — گیت تطبیقی اسکن پس‌زمینه یادآور (10.15)

import { describe, it, expect, vi } from 'vitest';

vi.mock('../js/i18n.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, t: (key) => key };
});

import { shouldScanShared } from '../js/notify.js';

const MIN = 60 * 1000;

describe('notify — گیت اسکن پس‌زمینه (10.15)', () => {
    it('کش خالی → همیشه اسکن (پر کردن کش)', () => {
        expect(shouldScanShared(1000, null, 0, true)).toBe(true);
    });

    it('سررسید نزدیک (≤ ۱۵ دقیقه = مهلت جبران) → اسکن فوری', () => {
        expect(shouldScanShared(1000, 15 * MIN, 1000, false)).toBe(true);
        expect(shouldScanShared(1000, 1 * MIN, 1000, false)).toBe(true);
    });

    it('سررسید دور + اسکن اخیر → صرفه‌جویی (بدون درخواست)', () => {
        expect(shouldScanShared(1000 + 5 * MIN, 30 * MIN, 1000, false)).toBe(false);
        expect(shouldScanShared(1000 + 9 * MIN, 60 * MIN, 1000, false)).toBe(false);
    });

    it('سررسید دور + ۱۰ دقیقه از آخرین اسکن گذشته → اسکن', () => {
        expect(shouldScanShared(1000 + 10 * MIN, 30 * MIN, 1000, false)).toBe(true);
    });

    it('هیچ سررسیدی آینده‌ای نیست (null) + اسکن اخیر → صرفه‌جویی', () => {
        expect(shouldScanShared(1000 + 1 * MIN, null, 1000, false)).toBe(false);
    });
});
