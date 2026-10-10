// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/media-format.test.js — تست تشخیص فرمت خروجی (تصمیم AVIF)

import { describe, it, expect } from 'vitest';

import { isWebPSupported, isAvifSupported, AVIF_QUALITY, WEBP_QUALITY, dataUrlToBlob } from '../js/media.js';

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

describe('dataUrlToBlob 10.11/BUG-02', () => {
    it('base64 را بدون fetch به Blob با type درست تبدیل می‌کند', () => {
        const blob = dataUrlToBlob('data:image/png;base64,iVBORw0KGgo=');
        expect(blob).toBeInstanceOf(Blob);
        expect(blob.type).toBe('image/png');
        expect(blob.size).toBe(8);
    });

    it('data:URL غیر-base64 را decode می‌کند', () => {
        const blob = dataUrlToBlob('data:text/plain,hello%20world');
        expect(blob.type).toBe('text/plain');
        expect(blob.size).toBe(11);
    });

    it('ورودی نامعتبر throw می‌دهد', () => {
        expect(() => dataUrlToBlob('https://example.com/x.png')).toThrow();
        expect(() => dataUrlToBlob('not-a-data-url')).toThrow();
        expect(() => dataUrlToBlob(null)).toThrow();
    });
});
