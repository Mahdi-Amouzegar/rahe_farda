// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/media-storage-guard.test.js -- تشخیص آدرس ساختگی mock adapter (BUG-37)
//
// ⚠️ 10.30: وقتی Worker با `MEDIA_STORAGE` تنظیم‌نشده بالا می‌آید، presign آدرس
// `https://mock-storage.local/...` می‌دهد که وجود خارجی ندارد؛ مرورگر با CSP
// ردش می‌کند و قبلاً صف تا بی‌نهایت retry می‌کرد. این تست فقط تشخیص آدرس را
// چک می‌کند (بخش خالص ماجرا).

import { describe, it, expect, vi } from 'vitest';

vi.mock('../js/net.js', () => ({ isOnline: () => true }));

import { isMockStorageUrl } from '../js/media-upload.js';

describe('تشخیص آدرس mock storage', () => {
    it('آدرس آپلود mock را می‌شناسد', () => {
        expect(isMockStorageUrl(
            'https://mock-storage.local/upload/media%2Fx%2Fy.jpeg?sig=mock&exp=1792739127'
        )).toBe(true);
    });

    it('زیردامنه‌ی mock را هم می‌شناسد', () => {
        expect(isMockStorageUrl('https://cdn.mock-storage.local/upload/a.png')).toBe(true);
    });

    it('آدرس واقعی ParsPack را mock نمی‌داند', () => {
        expect(isMockStorageUrl('https://c610779.parspack.net/bucket/media/a.jpeg?sig=1')).toBe(false);
    });

    it('میزبان شبیه ولی متفاوت را mock نمی‌داند', () => {
        expect(isMockStorageUrl('https://mock-storage.local.evil.example/upload/a.png')).toBe(false);
    });

    it('ورودی نامعتبر/خالی → false (بدون پرتاب خطا)', () => {
        expect(isMockStorageUrl('')).toBe(false);
        expect(isMockStorageUrl(null)).toBe(false);
        expect(isMockStorageUrl('not a url')).toBe(false);
    });
});
