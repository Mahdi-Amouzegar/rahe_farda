// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/media-format.test.js — تست تشخیص فرمت خروجی (تصمیم AVIF)

import { describe, it, expect } from 'vitest';

import { isWebPSupported, isAvifSupported, AVIF_QUALITY, WEBP_QUALITY } from '../js/media.js';

describe('media format', () => {
    it('در jsdom (بدون canvas واقعی) هر دو false برمی‌گردند، نه throw', () => {
        expect(() => isWebPSupported()).not.toThrow();
        expect(() => isAvifSupported()).not.toThrow();
        expect(isWebPSupported()).toBe(false);
        expect(isAvifSupported()).toBe(false);
    });

    it('ثابت‌های کیفیت معتبرند', () => {
        expect(AVIF_QUALITY).toBeGreaterThan(0);
        expect(AVIF_QUALITY).toBeLessThanOrEqual(1);
        expect(WEBP_QUALITY).toBeGreaterThan(0);
        expect(WEBP_QUALITY).toBeLessThanOrEqual(1);
    });
});
