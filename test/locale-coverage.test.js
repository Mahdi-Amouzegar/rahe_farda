// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/locale-coverage.test.js — فاز ۱۱ آیتم ۴: هر رشته در هر دو زبان واقعی
//
// ⚠️ قانون: هیچ کلیدی فقط در یک زبان نباشد؛ هیچ مقدار انگلیسی رونوشت فارسی نباشد.
// استثنا: language.switchToFa عمداً نام زبان را به خط خودش نشان می‌دهد.

import { describe, it, expect } from 'vitest';

const FA_RE = /[̀-ۿ]/u;

function walk(obj, prefix, out) {
    for (const [k, v] of Object.entries(obj || {})) {
        const p = prefix ? prefix + '.' + k : k;
        if (v && typeof v === 'object') walk(v, p, out);
        else if (typeof v === 'string') out.push([p, v]);
    }
}

describe('locale coverage fa/en', () => {
    it('کلیدها در هر دو زبان یکی‌اند', async () => {
        const fa = await import('../public/js/locales/fa.json');
        const en = await import('../public/js/locales/en.json');
        const faKeys = new Set();
        const enKeys = new Set();
        const faList = [];
        const enList = [];
        walk(fa.default || fa, '', faList);
        walk(en.default || en, '', enList);
        for (const [p] of faList) faKeys.add(p);
        for (const [p] of enList) enKeys.add(p);
        const missingInEn = [...faKeys].filter((k) => !enKeys.has(k));
        const missingInFa = [...enKeys].filter((k) => !faKeys.has(k));
        expect(missingInEn).toEqual([]);
        expect(missingInFa).toEqual([]);
    });

    it('مقادیر انگلیسی رونوشت فارسی نیستند', async () => {
        const en = await import('../public/js/locales/en.json');
        const list = [];
        walk(en.default || en, '', list);
        const allowed = new Set(['language.switchToFa']);
        const bad = list.filter(([p, v]) => FA_RE.test(v) && !allowed.has(p));
        expect(bad).toEqual([]);
    });

    it('welcome.textShort در هر دو زبان واقعی است', async () => {
        const fa = await import('../public/js/locales/fa.json');
        const en = await import('../public/js/locales/en.json');
        const faT = (fa.default || fa).welcome.textShort;
        const enT = (en.default || en).welcome.textShort;
        expect(typeof faT === 'string' && faT.length > 0).toBe(true);
        expect(typeof enT === 'string' && enT.length > 0).toBe(true);
        expect(FA_RE.test(enT)).toBe(false);
    });
});
