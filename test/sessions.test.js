// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/sessions.test.js — تست‌های منطق جلسات + جستجوی معنایی (فاز ۵ گام ۲)

import { describe, it, expect, beforeEach } from 'vitest';
import {
    faToEn,
    dayKey,
    hasSessionOn,
    sameMinute,
    hasSessionAt,
    taskMatches,
    normalizeForSearch,
    parseFaDateTime,
    nearestUpcoming
} from '../js/sessions.js';
import { state } from '../js/core.js';

// helper: پاک کردن state قبل از هر تست
beforeEach(() => {
    state.tasks = [];
    state.searchQuery = '';
    state.currentFilter = 'all';
    state.selectedDay = null;
});

// ═══════════════════════════════════════════════════════════════════════════
// faToEn
// ═══════════════════════════════════════════════════════════════════════════

describe('sessions — faToEn', () => {
    it('ارقام فارسی را به انگلیسی تبدیل می‌کند', () => {
        expect(faToEn('۱۲۳')).toBe('123');
        expect(faToEn('۴۵۶۷۸۹۰')).toBe('4567890');
    });

    it('ارقام عربی را به انگلیسی تبدیل می‌کند', () => {
        expect(faToEn('١٢٣')).toBe('123');
    });

    it('متن غیرعددی را دست‌نخورده برمی‌گرداند', () => {
        expect(faToEn('سلام دنیا')).toBe('سلام دنیا');
    });

    it('ترکیب فارسی و انگلیسی را درست تبدیل می‌کند', () => {
        expect(faToEn('ساعت ۱۲:۳۰')).toBe('ساعت 12:30');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// dayKey
// ═══════════════════════════════════════════════════════════════════════════

describe('sessions — dayKey', () => {
    it('کلید روز را درست می‌سازد', () => {
        const d = new Date(2024, 0, 15); // ۱۵ ژانویه ۲۰۲۴
        expect(dayKey(d)).toBe('2024-1-15');
    });

    it('برای رشته ISO هم کار می‌کند', () => {
        const d = new Date(2024, 5, 20);
        expect(dayKey(d.toISOString())).toBe('2024-6-20');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// sameMinute
// ═══════════════════════════════════════════════════════════════════════════

describe('sessions — sameMinute', () => {
    it('دو تاریخ با همان دقیقه را true برمی‌گرداند', () => {
        const a = new Date(2024, 0, 15, 10, 30, 0);
        const b = new Date(2024, 0, 15, 10, 30, 45); // ۴۵ ثانیه تفاوت
        expect(sameMinute(a, b)).toBe(true);
    });

    it('دو تاریخ با دقیقه متفاوت را false برمی‌گرداند', () => {
        const a = new Date(2024, 0, 15, 10, 30, 0);
        const b = new Date(2024, 0, 15, 10, 31, 0);
        expect(sameMinute(a, b)).toBe(false);
    });

    it('برای تاریخ نامعتبر false برمی‌گرداند', () => {
        expect(sameMinute('invalid', new Date())).toBe(false);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// hasSessionAt
// ═══════════════════════════════════════════════════════════════════════════

describe('sessions — hasSessionAt', () => {
    it('وقتی جلسه با همان دقیقه وجود دارد true برمی‌گرداند', () => {
        const list = [{ at: new Date(2024, 0, 15, 10, 0).toISOString() }];
        const test = new Date(2024, 0, 15, 10, 0, 30).toISOString();
        expect(hasSessionAt(list, test)).toBe(true);
    });

    it('وقتی جلسه با دقیقه متفاوت false برمی‌گرداند', () => {
        const list = [{ at: new Date(2024, 0, 15, 10, 0).toISOString() }];
        const test = new Date(2024, 0, 15, 10, 5).toISOString();
        expect(hasSessionAt(list, test)).toBe(false);
    });

    it('برای آرایه خالی false برمی‌گرداند', () => {
        expect(hasSessionAt([], new Date().toISOString())).toBe(false);
    });

    it('برای آرایه null امن است', () => {
        expect(hasSessionAt(null, new Date().toISOString())).toBe(false);
        expect(hasSessionAt(undefined, new Date().toISOString())).toBe(false);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// hasSessionOn
// ═══════════════════════════════════════════════════════════════════════════

describe('sessions — hasSessionOn', () => {
    it('وقتی جلسه در آن روز وجود دارد true برمی‌گرداند', () => {
        const task = { sessions: [{ at: new Date(2024, 0, 15, 10, 0).toISOString() }] };
        expect(hasSessionOn(task, '2024-1-15')).toBe(true);
    });

    it('وقتی جلسه در روز دیگری است false برمی‌گرداند', () => {
        const task = { sessions: [{ at: new Date(2024, 0, 15, 10, 0).toISOString() }] };
        expect(hasSessionOn(task, '2024-1-16')).toBe(false);
    });

    it('برای task بدون sessions false برمی‌گرداند', () => {
        expect(hasSessionOn({}, '2024-1-15')).toBe(false);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// normalizeForSearch
// ═══════════════════════════════════════════════════════════════════════════

describe('sessions — normalizeForSearch', () => {
    it('ارقام فارسی را به انگلیسی تبدیل می‌کند', () => {
        expect(normalizeForSearch('۱۲۳')).toBe('123');
        expect(normalizeForSearch('۱۴۰۳')).toBe('1403');
    });

    it('ارقام عربی را به انگلیسی تبدیل می‌کند', () => {
        expect(normalizeForSearch('١٢٣')).toBe('123');
    });

    it('ی عربی را به فارسی تبدیل می‌کند', () => {
        expect(normalizeForSearch('ايران')).toBe('ایران');
        expect(normalizeForSearch('كتاب')).toBe('کتاب');
    });

    it('نیم‌فاصله (ZWNJ) را حذف می‌کند', () => {
        expect(normalizeForSearch('می‌روم')).toBe('میروم');
        expect(normalizeForSearch('کتاب‌ها')).toBe('کتابها');
    });

    it('اعراب را حذف می‌کند', () => {
        expect(normalizeForSearch('مَدرَسِه')).toBe('مدرسه');
    });

    it('lowercase می‌کند (برای انگلیسی)', () => {
        expect(normalizeForSearch('HELLO')).toBe('hello');
        expect(normalizeForSearch('Buy Milk')).toBe('buy milk');
    });

    it('فاصله‌های اضافی را نرمال می‌کند', () => {
        expect(normalizeForSearch('سلام   دنیا')).toBe('سلام دنیا');
        expect(normalizeForSearch('  سلام  ')).toBe('سلام');
    });

    it('برای null و undefined رشته خالی برمی‌گرداند', () => {
        expect(normalizeForSearch(null)).toBe('');
        expect(normalizeForSearch(undefined)).toBe('');
    });

    it('برای اعداد (غیر رشته) کار می‌کند', () => {
        expect(normalizeForSearch(123)).toBe('123');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// taskMatches (جستجوی معنایی)
// ═══════════════════════════════════════════════════════════════════════════

describe('sessions — taskMatches (جستجوی معنایی)', () => {
    // ─── تست‌های پایه (بدون تغییر) ───
    it('متن شامل عبارت است true برمی‌گرداند', () => {
        expect(taskMatches({ text: 'خرید نان' }, 'نان')).toBe(true);
    });

    it('توضیح شامل عبارت است true برمی‌گرداند', () => {
        expect(taskMatches({ text: 'خرید', description: 'از نانوایی' }, 'نانوایی')).toBe(true);
    });

    it('عدم تطابق false برمی‌گرداند', () => {
        expect(taskMatches({ text: 'خرید نان' }, 'شیر')).toBe(false);
    });

    it('عبارت خالی همیشه true برمی‌گرداند', () => {
        expect(taskMatches({ text: 'هر چیزی' }, '')).toBe(true);
        expect(taskMatches({ text: 'هر چیزی' }, null)).toBe(true);
    });

    // ─── تست‌های فیلدهای جدید ───
    it('تلفن را جستجو می‌کند', () => {
        expect(taskMatches({ text: 'تماس', phone: '09123456789' }, '0912')).toBe(true);
        expect(taskMatches({ text: 'تماس', phone: '09123456789' }, '9999')).toBe(false);
    });

    it('آدرس را جستجو می‌کند', () => {
        expect(taskMatches({ text: 'مراجعه', address: 'تهران، خیابان ولیعصر' }, 'ولیعصر')).toBe(true);
        expect(taskMatches({ text: 'مراجعه', address: 'تهران' }, 'اصفهان')).toBe(false);
    });

    it('URL را جستجو می‌کند', () => {
        expect(taskMatches({ text: 'بازکردن', url: 'https://example.com/path' }, 'example')).toBe(true);
        expect(taskMatches({ text: 'بازکردن', url: 'https://example.com' }, 'google')).toBe(false);
    });

    // ─── نرمال‌سازی ───
    it('اعداد فارسی و انگلیسی را یکسان می‌بیند', () => {
        expect(taskMatches({ text: 'جلسه ۱۴۰۳' }, '1403')).toBe(true);
        expect(taskMatches({ text: 'جلسه 1403' }, '۱۴۰۳')).toBe(true);
    });

    it('ی و ک عربی و فارسی را یکسان می‌بیند', () => {
        expect(taskMatches({ text: 'کتاب' }, 'كتاب')).toBe(true);
        expect(taskMatches({ text: 'ايران' }, 'ایران')).toBe(true);
    });

    it('نیم‌فاصله را نادیده می‌گیرد', () => {
        expect(taskMatches({ text: 'می‌روم' }, 'میروم')).toBe(true);
        expect(taskMatches({ text: 'میروم' }, 'می‌روم')).toBe(true);
    });

    it('فاصله‌های اضافی را نرمال می‌کند', () => {
        expect(taskMatches({ text: 'سلام   دنیا' }, 'سلام دنیا')).toBe(true);
    });

    it('case-insensitive برای انگلیسی', () => {
        expect(taskMatches({ text: 'Buy Milk' }, 'buy')).toBe(true);
        expect(taskMatches({ text: 'buy milk' }, 'MILK')).toBe(true);
    });

    // ─── جستجو در فرزندان plan ───
    it('در فرزندان plan جستجو می‌کند', () => {
        const plan = {
            text: 'سفر',
            kind: 'plan',
            children: [
                { id: 'c1', text: 'رزرو بلیت', kind: 'task' },
                { id: 'c2', text: 'بسته‌بندی وسایل', kind: 'task' }
            ]
        };
        expect(taskMatches(plan, 'بلیت')).toBe(true);
        expect(taskMatches(plan, 'بسته')).toBe(true);
        expect(taskMatches(plan, 'هتل')).toBe(false);
    });

    it('در فیلدهای فرزندان (تلفن/آدرس) هم جستجو می‌کند', () => {
        const plan = {
            text: 'سفر',
            kind: 'plan',
            children: [
                { id: 'c1', text: 'تماس با هتل', phone: '02112345678', kind: 'task' }
            ]
        };
        expect(taskMatches(plan, '12345678')).toBe(true);
    });

    // ─── موارد edge ───
    it('برای null امن است', () => {
        expect(taskMatches(null, 'x')).toBe(false);
        expect(taskMatches({ text: 'سلام' }, '')).toBe(true);
    });

    it('عبارت شامل نویسه‌های خاص را مدیریت می‌کند', () => {
        expect(taskMatches({ text: 'قیمت ۱۰۰٪' }, '100')).toBe(true);
        expect(taskMatches({ text: 'task#1' }, '#1')).toBe(true);
    });

    it('چند فیلد را همزمان چک می‌کند', () => {
        const task = {
            text: 'خرید',
            description: 'از فروشگاه',
            phone: '09123456789',
            address: 'تهران',
            url: 'https://shop.com'
        };
        expect(taskMatches(task, 'فروشگاه')).toBe(true);
        expect(taskMatches(task, '0912')).toBe(true);
        expect(taskMatches(task, 'تهران')).toBe(true);
        expect(taskMatches(task, 'shop')).toBe(true);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// nearestUpcoming
// ═══════════════════════════════════════════════════════════════════════════

describe('sessions — nearestUpcoming', () => {
    it('نزدیک‌ترین جلسه آینده را برمی‌گرداند', () => {
        const now = Date.now();
        const future1 = new Date(now + 60 * 60 * 1000).toISOString(); // ۱ ساعت بعد
        const future2 = new Date(now + 2 * 60 * 60 * 1000).toISOString(); // ۲ ساعت بعد
        const past = new Date(now - 60 * 60 * 1000).toISOString(); // ۱ ساعت قبل

        const task = { sessions: [{ at: future2 }, { at: future1 }, { at: past }] };
        const n = nearestUpcoming(task);
        expect(n.at).toBe(future1);
    });

    it('اگر همه جلسات گذشته باشند null برمی‌گرداند', () => {
        const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const task = { sessions: [{ at: past }] };
        expect(nearestUpcoming(task)).toBe(null);
    });

    it('برای task بدون sessions null برمی‌گرداند', () => {
        expect(nearestUpcoming({})).toBe(null);
        expect(nearestUpcoming({ sessions: [] })).toBe(null);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// parseFaDateTime
// ═══════════════════════════════════════════════════════════════════════════

describe('sessions — parseFaDateTime', () => {
    // برای تست، از یک "now" ثابت استفاده می‌کنیم
    const now = new Date(2024, 5, 15, 10, 0, 0); // ۱۵ ژوئن ۲۰۲۴، ۱۰ صبح

    it('«فردا» را می‌فهمد', () => {
        const iso = parseFaDateTime('فردا', now);
        expect(iso).toBeTruthy();
        const d = new Date(iso);
        expect(d.getDate()).toBe(16);
    });

    it('«پس فردا» را می‌فهمد', () => {
        const iso = parseFaDateTime('پس فردا', now);
        expect(iso).toBeTruthy();
        const d = new Date(iso);
        expect(d.getDate()).toBe(17);
    });

    it('«امروز» را می‌فهمد وقتی ساعت پیش‌فرض در آینده باشد', () => {
        const morningNow = new Date(2024, 5, 15, 6, 0, 0);
        const iso = parseFaDateTime('امروز', morningNow);
        expect(iso).toBeTruthy();
        const d = new Date(iso);
        expect(d.getDate()).toBe(15);
        expect(d.getHours()).toBe(9);
    });

    it('«امروز» را null برمی‌گرداند وقتی ساعت پیش‌فرض گذشته باشد', () => {
        const iso = parseFaDateTime('امروز', now);
        expect(iso).toBe(null);
    });

    it('«امروز ساعت ۱۴» را می‌فهمد (بعد از ساعت جاری)', () => {
        const iso = parseFaDateTime('امروز ساعت ۱۴', now);
        expect(iso).toBeTruthy();
        const d = new Date(iso);
        expect(d.getDate()).toBe(15);
        expect(d.getHours()).toBe(14);
    });

    it('«ساعت ۵» را به ۱۷ تفسیر می‌کند', () => {
        const iso = parseFaDateTime('امروز ساعت ۵', now);
        expect(iso).toBeTruthy();
        const d = new Date(iso);
        expect(d.getHours()).toBe(17);
    });

    it('«فردا ساعت ۹» را می‌فهمد', () => {
        const iso = parseFaDateTime('فردا ساعت ۹', now);
        expect(iso).toBeTruthy();
        const d = new Date(iso);
        expect(d.getDate()).toBe(16);
        expect(d.getHours()).toBe(9);
    });

    it('«۳ روز دیگر» را می‌فهمد', () => {
        const iso = parseFaDateTime('۳ روز دیگر', now);
        expect(iso).toBeTruthy();
        const d = new Date(iso);
        expect(d.getDate()).toBe(18);
    });

    it('«هفته بعد» را می‌فهمد', () => {
        const iso = parseFaDateTime('هفته بعد', now);
        expect(iso).toBeTruthy();
        const d = new Date(iso);
        expect(d.getDate()).toBe(22);
    });

    it('متن نامعتبر null برمی‌گرداند', () => {
        expect(parseFaDateTime('سلام', now)).toBe(null);
        expect(parseFaDateTime('', now)).toBe(null);
        expect(parseFaDateTime(null, now)).toBe(null);
    });

    it('«ساعت ۲۵» نامعتبر است', () => {
        expect(parseFaDateTime('فردا ساعت ۲۵', now)).toBe(null);
    });
});