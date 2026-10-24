// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/media-format.test.js — تست تشخیص فرمت خروجی (تصمیم AVIF)

import { describe, it, expect } from 'vitest';

import {
    isWebPSupported,
    isAvifSupported,
    AVIF_QUALITY,
    WEBP_QUALITY,
    dataUrlToBlob,
    isDirectDisplayable,
    isServerAllowedContentType,
    shouldKeepOriginalFile,
    computeCenterSquare,
    AVATAR_SIZE,
} from '../js/media.js';

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

describe('keep-original (re-encode بزرگ‌تر از ورودی)', () => {
    it('خروجی بزرگ‌تر + ورودی مجازِ سرور → اصلی می‌ماند', () => {
        expect(shouldKeepOriginalFile('image/jpeg', 297 * 1024, 461 * 1024)).toBe(true);
        expect(shouldKeepOriginalFile('image/webp', 100, 100)).toBe(true);
    });

    // ⚠️ BUG-39: سرور فقط avif/webp/jpeg را می‌پذیرد. نگه‌داشتن PNG باعث
    // ۴۰۰ روی POST /api/media/upload می‌شد و کاربر پیام «آپلود ناموفق» می‌دید.
    it('PNG/GIF/BMP مجاز نیستند → همیشه تبدیل می‌شوند (BUG-39)', () => {
        expect(isServerAllowedContentType('image/png')).toBe(false);
        expect(isServerAllowedContentType('image/gif')).toBe(false);
        expect(isServerAllowedContentType('image/bmp')).toBe(false);
        expect(shouldKeepOriginalFile('image/png', 100, 100)).toBe(false);
        expect(shouldKeepOriginalFile('image/gif', 100, 200)).toBe(false);
        expect(shouldKeepOriginalFile('image/bmp', 100, 200)).toBe(false);
    });

    it('image/jpg و image/pjpeg هم مجاز نیستند (مقایسه دقیق، نه startsWith)', () => {
        expect(isServerAllowedContentType('image/jpg')).toBe(false);
        expect(isServerAllowedContentType('image/pjpeg')).toBe(false);
        expect(shouldKeepOriginalFile('image/jpg', 100, 500)).toBe(false);
        expect(shouldKeepOriginalFile('image/pjpeg', 100, 500)).toBe(false);
    });

    it('سه MIME مجاز سرور پذیرفته می‌شوند', () => {
        expect(isServerAllowedContentType('image/avif')).toBe(true);
        expect(isServerAllowedContentType('image/webp')).toBe(true);
        expect(isServerAllowedContentType('image/jpeg')).toBe(true);
    });

    it('خروجی کوچک‌تر → تبدیل نگه داشته می‌شود', () => {
        expect(shouldKeepOriginalFile('image/jpeg', 381 * 1024, 332 * 1024)).toBe(false);
    });
    it('heic قابل‌نمایش مستقیم نیست → همیشه تبدیل', () => {
        expect(isDirectDisplayable('image/heic')).toBe(false);
        expect(shouldKeepOriginalFile('image/heic', 100, 500)).toBe(false);
    });
    it('ورودی نامعتبر → false', () => {
        expect(shouldKeepOriginalFile('', 100, 500)).toBe(false);
        expect(shouldKeepOriginalFile('image/jpeg', NaN, 500)).toBe(false);
    });
});

describe('computeCenterSquare — برش مربع آواتار (10.34)', () => {
    it('۳۲×۱۶ → مربع ۱۶ از مرکز، ۸ از هر طرف عرض بریده می‌شود', () => {
        expect(computeCenterSquare(32, 16)).toEqual({ side: 16, sx: 8, sy: 0 });
    });

    it('۱۶×۳۲ (عمودی) → مربع ۱۶ از مرکز، ۸ از بالا و پایین', () => {
        expect(computeCenterSquare(16, 32)).toEqual({ side: 16, sx: 0, sy: 8 });
    });

    it('تصویر مربعی → برشی لازم نیست', () => {
        expect(computeCenterSquare(500, 500)).toEqual({ side: 500, sx: 0, sy: 0 });
    });

    it('پانوراما → ضلع = ارتفاع، برش افقی مساوی', () => {
        expect(computeCenterSquare(4000, 1000)).toEqual({ side: 1000, sx: 1500, sy: 0 });
    });

    it('فرد بودن اختلاف → گرد کردن به پایین (بدون بیرون‌زدگی)', () => {
        const sq = computeCenterSquare(33, 16);
        expect(sq).toEqual({ side: 16, sx: 9, sy: 0 });
        expect(sq.sx + sq.side).toBeLessThanOrEqual(33);
    });

    it('ورودی نامعتبر → صفر', () => {
        expect(computeCenterSquare(0, 0)).toEqual({ side: 0, sx: 0, sy: 0 });
        expect(computeCenterSquare(NaN, 10)).toEqual({ side: 0, sx: 0, sy: 0 });
        expect(computeCenterSquare(-5, 10)).toEqual({ side: 0, sx: 0, sy: 0 });
    });

    it('ابعاد آواتار ۲۵۶ است', () => {
        expect(AVATAR_SIZE).toBe(256);
    });
});
