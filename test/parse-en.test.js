// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/parse-en.test.js — تست‌های parseEnDateTime و parseDateText (Phase 4E)
//
// ⚠️ نکات:
//   - از `now` قطعی استفاده می‌کنیم تا تست‌ها پایدار باشن.
//   - `now` در local timezone اجرا می‌شه (به همین دلیل از getTime برای مقایسه استفاده می‌کنیم).
//   - خروجی parseEnDateTime یک ISO string (UTC) است.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseEnDateTime, parseDateText, parseFaDateTime } from '../js/sessions.js';
import { state } from '../js/core.js';

// ═══════════════════════════════════════════════════════════════════════════
// Mock i18n.getLang
// ═══════════════════════════════════════════════════════════════════════════
//
// ⚠️ برای تست `parseDateText`، باید زبان رو کنترل کنیم.
//    از vi.mock استفاده می‌کنیم و `getLang` رو stub می‌کنیم.
//
// ⚠️ ولی `sessions.js` از `getLang` استفاده می‌کنه که در `i18n.js` تعریف شده.
//    به‌جای mock کردن کل i18n، از یک متغیر سراسری استفاده می‌کنیم.

let mockLang = 'en';
vi.mock('../js/i18n.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        getLang: () => mockLang,
    };
});

// ═══════════════════════════════════════════════════════════════════════════
// now قطعی برای تست‌ها
// ═══════════════════════════════════════════════════════════════════════════
//
// ⚠️ ۱۵ ژوئن ۲۰۲۴، ۱۰ صبح (local timezone)
//    در UTC+3:30 تهران → 06:30 UTC

const NOW = new Date(2024, 5, 15, 10, 0, 0);

// helper: تبدیل ISO به "local readable" برای دیباگ
function localStr(iso) {
    if (!iso) return 'null';
    return new Date(iso).toLocaleString('en-US');
}

beforeEach(() => {
    mockLang = 'en';
});

// ═══════════════════════════════════════════════════════════════════════════
// parseEnDateTime — روزهای نسبی
// ═══════════════════════════════════════════════════════════════════════════

describe('parseEnDateTime — روزهای نسبی', () => {
    it('today → امروز ۹ صبح', () => {
        // ⚠️ ساعت ۱۰ صبح است، پس ۹ صبح گذشته → null
        expect(parseEnDateTime('today', NOW)).toBeNull();
    });

    it('tomorrow → فردا ۹ صبح', () => {
        const r = parseEnDateTime('tomorrow', NOW);
        expect(r).not.toBeNull();
        const d = new Date(r);
        expect(d.getDate()).toBe(16);
        expect(d.getHours()).toBe(9);
    });

    it('day after tomorrow → پس‌فردا ۹ صبح', () => {
        const r = parseEnDateTime('day after tomorrow', NOW);
        expect(r).not.toBeNull();
        const d = new Date(r);
        expect(d.getDate()).toBe(17);
        expect(d.getHours()).toBe(9);
    });

    it('tonight → امروز ۲۱', () => {
        const r = parseEnDateTime('tonight', NOW);
        expect(r).not.toBeNull();
        const d = new Date(r);
        expect(d.getDate()).toBe(15);
        expect(d.getHours()).toBe(21);
    });

    it('next week → +۷ روز', () => {
        const r = parseEnDateTime('next week', NOW);
        expect(r).not.toBeNull();
        const d = new Date(r);
        expect(d.getDate()).toBe(22);
    });

    it('next month → +۳۰ روز', () => {
        const r = parseEnDateTime('next month', NOW);
        expect(r).not.toBeNull();
        const d = new Date(r);
        expect(d.getDate()).toBe(15); // ۱۵ ژوئیه
        expect(d.getMonth()).toBe(6); // ژوئیه
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// parseEnDateTime — الگوی عددی
// ═══════════════════════════════════════════════════════════════════════════

describe('parseEnDateTime — الگوی عددی', () => {
    it('in 3 days → +۳ روز', () => {
        const r = parseEnDateTime('in 3 days', NOW);
        expect(r).not.toBeNull();
        const d = new Date(r);
        expect(d.getDate()).toBe(18);
    });

    it('in 2 weeks → +۱۴ روز', () => {
        const r = parseEnDateTime('in 2 weeks', NOW);
        expect(r).not.toBeNull();
        const d = new Date(r);
        expect(d.getDate()).toBe(29);
    });

    it('3 days from now → +۳ روز', () => {
        const r = parseEnDateTime('3 days from now', NOW);
        expect(r).not.toBeNull();
        const d = new Date(r);
        expect(d.getDate()).toBe(18);
    });

    it('in 1000 days → null (خارج از محدوده)', () => {
        expect(parseEnDateTime('in 1000 days', NOW)).toBeNull();
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// parseEnDateTime — روزهای هفته
// ═══════════════════════════════════════════════════════════════════════════

describe('parseEnDateTime — روزهای هفته', () => {
    // ⚠️ ۱۵ ژوئن ۲۰۲۴ = شنبه (Saturday)

    it('Monday → دوشنبه‌ی بعد (۱۷ ژوئن)', () => {
        const r = parseEnDateTime('Monday', NOW);
        expect(r).not.toBeNull();
        const d = new Date(r);
        expect(d.getDay()).toBe(1); // Monday
        expect(d.getDate()).toBe(17);
    });

    it('Mon → همان دوشنبه', () => {
        const r = parseEnDateTime('Mon', NOW);
        expect(r).not.toBeNull();
        const d = new Date(r);
        expect(d.getDay()).toBe(1);
    });

    it('next Monday → دوشنبه‌ی بعد', () => {
        const r = parseEnDateTime('next Monday', NOW);
        expect(r).not.toBeNull();
        const d = new Date(r);
        expect(d.getDay()).toBe(1);
    });

    it('Saturday → شنبه‌ی بعد (۲۲ ژوئن)', () => {
        const r = parseEnDateTime('Saturday', NOW);
        expect(r).not.toBeNull();
        const d = new Date(r);
        expect(d.getDay()).toBe(6); // Saturday
        expect(d.getDate()).toBe(22);
    });

    it('case-insensitive: MONDAY', () => {
        const r = parseEnDateTime('MONDAY', NOW);
        expect(r).not.toBeNull();
        const d = new Date(r);
        expect(d.getDay()).toBe(1);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// parseEnDateTime — ساعت
// ═══════════════════════════════════════════════════════════════════════════

describe('parseEnDateTime — ساعت', () => {
    it('tomorrow at 8am → فردا ۸ صبح', () => {
        const r = parseEnDateTime('tomorrow at 8am', NOW);
        expect(r).not.toBeNull();
        const d = new Date(r);
        expect(d.getDate()).toBe(16);
        expect(d.getHours()).toBe(8);
    });

    it('tomorrow at 2:30 pm → فردا ۱۴:۳۰', () => {
        const r = parseEnDateTime('tomorrow at 2:30 pm', NOW);
        expect(r).not.toBeNull();
        const d = new Date(r);
        expect(d.getDate()).toBe(16);
        expect(d.getHours()).toBe(14);
        expect(d.getMinutes()).toBe(30);
    });

    it('tomorrow 21:00 → فردا ۲۱:۰۰', () => {
        const r = parseEnDateTime('tomorrow 21:00', NOW);
        expect(r).not.toBeNull();
        const d = new Date(r);
        expect(d.getHours()).toBe(21);
    });

    it('21:00 (تنها) → امروز ۲۱', () => {
        const r = parseEnDateTime('21:00', NOW);
        expect(r).not.toBeNull();
        const d = new Date(r);
        expect(d.getHours()).toBe(21);
    });

    it('at 25 → null (ساعت نامعتبر)', () => {
        expect(parseEnDateTime('tomorrow at 25', NOW)).toBeNull();
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// parseEnDateTime — بخش‌های روز
// ═══════════════════════════════════════════════════════════════════════════

describe('parseEnDateTime — بخش‌های روز', () => {
    it('evening → امروز ۱۸', () => {
        const r = parseEnDateTime('evening', NOW);
        expect(r).not.toBeNull();
        const d = new Date(r);
        expect(d.getHours()).toBe(18);
    });

    it('afternoon → امروز ۱۴ (نه ۱۲ از noon)', () => {
        const r = parseEnDateTime('afternoon', NOW);
        expect(r).not.toBeNull();
        const d = new Date(r);
        expect(d.getHours()).toBe(14);
    });

    it('noon → امروز ۱۲', () => {
        const r = parseEnDateTime('noon', NOW);
        expect(r).not.toBeNull();
        const d = new Date(r);
        expect(d.getHours()).toBe(12);
    });

    it('night → امروز ۲۱', () => {
        const r = parseEnDateTime('night', NOW);
        expect(r).not.toBeNull();
        const d = new Date(r);
        expect(d.getHours()).toBe(21);
    });

    it('midnight → ۰۰:۰۰ (اول روز بعد یا آخر امروز)', () => {
        const r = parseEnDateTime('midnight', NOW);
        expect(r).not.toBeNull();
        const d = new Date(r);
        expect(d.getHours()).toBe(0);
    });

    it('tomorrow morning → فردا ۹', () => {
        const r = parseEnDateTime('tomorrow morning', NOW);
        expect(r).not.toBeNull();
        const d = new Date(r);
        expect(d.getDate()).toBe(16);
        expect(d.getHours()).toBe(9);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// parseEnDateTime — ورودی نامعتبر
// ═══════════════════════════════════════════════════════════════════════════

describe('parseEnDateTime — ورودی نامعتبر', () => {
    it('متن نامعتبر → null', () => {
        expect(parseEnDateTime('hello world', NOW)).toBeNull();
        expect(parseEnDateTime('', NOW)).toBeNull();
        expect(parseEnDateTime(null, NOW)).toBeNull();
        expect(parseEnDateTime(undefined, NOW)).toBeNull();
    });

    it('today (ساعت ۱۰ صبح است) → null', () => {
        expect(parseEnDateTime('today', NOW)).toBeNull();
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// parseDateText — dispatcher
// ═══════════════════════════════════════════════════════════════════════════

describe('parseDateText — dispatcher locale-aware', () => {
    it('در en → parseEnDateTime', () => {
        mockLang = 'en';
        const r = parseDateText('tomorrow', NOW);
        expect(r).not.toBeNull();
        expect(new Date(r).getDate()).toBe(16);
    });

    it('در fa → parseFaDateTime', () => {
        mockLang = 'fa';
        const r = parseDateText('فردا', NOW);
        expect(r).not.toBeNull();
        expect(new Date(r).getDate()).toBe(16);
    });

    it('در en با متن فارسی → null', () => {
        mockLang = 'en';
        expect(parseDateText('فردا', NOW)).toBeNull();
    });

    it('در fa با متن انگلیسی → null', () => {
        mockLang = 'fa';
        expect(parseDateText('tomorrow', NOW)).toBeNull();
    });
});