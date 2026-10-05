// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/empty-hint.test.js -- راهنمای خالی دولاین + فوتر بدون جمله لوکال

import { describe, it, expect } from 'vitest';

import { splitHintLines } from '../js/ui.js';

describe('empty hint', () => {
    it('در — به دو خط با <br> می‌شکند', () => {
        const out = splitHintLines('الف — ب');
        expect(out).toBe('الف<br>ب');
    });

    it('بدون جداکننده دست‌نخورده (escapeشده) برمی‌گردد', () => {
        expect(splitHintLines('سلام')).toBe('سلام');
        expect(splitHintLines('')).toBe('');
    });

    it('محتوای خطرناک escape می‌شود ولی br سالم می‌ماند', () => {
        const out = splitHintLines('<b>الف</b> — ب');
        expect(out).toContain('&lt;b&gt;');
        expect(out).toContain('<br>');
        expect(out).not.toContain('<b>الف</b>');
    });
});

describe('footer', () => {
    it('جمله لوکال-بودن از کپی‌رایت رفته است', async () => {
        const fa = await import('../public/js/locales/fa.json');
        const en = await import('../public/js/locales/en.json');
        const faText = (fa.default || fa).app.footer.copyright;
        const enText = (en.default || en).app.footer.copyright;
        expect(faText).not.toContain('فقط روی همین دستگاه');
        expect(enText).not.toContain('only on this device');
        expect(faText).toContain('{year}');
    });
});
