// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/personal-order.test.js — 10.35: ترتیب پنج‌سطحی «وظایف من»
//
// قاعده‌ی کاربر:
//   ۰) تیک‌نخورده + سررسید آینده (نزدیک‌ترین اول)
//   ۱) تیک‌نخورده + بی‌سررسید (الفبا)
//   ۲) تیک‌نخورده + سررسید گذشته (تازه‌منقضی‌شده اول)
//   ۳) تیک‌خورده + سررسیددار (نزدیک‌ترین به اکنون اول)
//   ۴) تیک‌خورده + بی‌سررسید (الفبا)
// ⚠️ فقط فضای شخصی — DM/گروه نباید این ترتیب را بگیرند.

import { describe, it, expect } from 'vitest';
import {
    sortPersonalTasks,
    comparePersonalTasks,
    personalOrderKey,
    dueTimestamps,
    isTaskDone,
    shouldUsePersonalOrder,
    BUCKET_UPCOMING,
    BUCKET_NO_DUE,
    BUCKET_OVERDUE,
    BUCKET_DONE_DUE,
    BUCKET_DONE_NO_DUE,
} from '../js/tasks/personal-order.js';

const NOW = Date.UTC(2026, 9, 24, 8, 0, 0);
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

/** وظیفه‌ی ساده؛ `due` آرایه‌ی مهر زمانی (ms) یا ISO است. */
function task(text, opts = {}) {
    const t = {
        id: opts.id || text,
        text,
        completed: Boolean(opts.completed),
        sessions: (opts.due || []).map((at, i) => ({
            id: `${text}-${i}`,
            at: typeof at === 'number' ? new Date(at).toISOString() : at,
            ...(opts.doneAt ? { doneAt: opts.doneAt } : {}),
        })),
    };
    if (opts.kind) {
        t.kind = opts.kind;
        t.children = opts.children || [];
    }
    return t;
}

const order = (list) => sortPersonalTasks(list, NOW).map(t => t.text);

describe('personal-order — سطل‌ها', () => {
    it('سررسید آینده: نزدیک‌ترین تاریخ اول', () => {
        const soon = task('دو هفته بعد', { due: [NOW + 14 * DAY] });
        const later = task('فردا', { due: [NOW + 1 * DAY] });
        expect(order([soon, later])).toEqual(['فردا', 'دو هفته بعد']);
        expect(personalOrderKey(soon, NOW).bucket).toBe(BUCKET_UPCOMING);
    });

    it('سررسید یکسان → ترتیب نام', () => {
        const a = task('ب', { due: [NOW + 2 * DAY] });
        const b = task('الف', { due: [NOW + 2 * DAY] });
        expect(order([a, b])).toEqual(['الف', 'ب']);
    });

    it('بی‌سررسیدها بعد از سررسیددارهای آینده و به ترتیب نام', () => {
        const noDue = task('آ', {});
        const due = task('ی', { due: [NOW + 3 * DAY] });
        expect(order([noDue, due])).toEqual(['ی', 'آ']);
        expect(personalOrderKey(noDue, NOW).bucket).toBe(BUCKET_NO_DUE);
    });

    it('سررسید گذشته: تازه‌منقضی‌شده اول، سپس قدیمی‌تر', () => {
        const old = task('سه روز پیش', { due: [NOW - 3 * DAY] });
        const fresh = task('یک ساعت پیش', { due: [NOW - 1 * HOUR] });
        expect(order([old, fresh])).toEqual(['یک ساعت پیش', 'سه روز پیش']);
        expect(personalOrderKey(old, NOW).bucket).toBe(BUCKET_OVERDUE);
    });

    it('گذشته‌های هم‌زمان → ترتیب نام', () => {
        const a = task('ب', { due: [NOW - DAY] });
        const b = task('الف', { due: [NOW - DAY] });
        expect(order([a, b])).toEqual(['الف', 'ب']);
    });

    it('تیک‌خورده‌ی سررسیددار بعد از گذشته‌های تیک‌نخورده', () => {
        const done = task('انجام‌شده', { completed: true, due: [NOW - 2 * DAY] });
        const late = task('عقب‌افتاده', { due: [NOW - 5 * DAY] });
        expect(order([done, late])).toEqual(['عقب‌افتاده', 'انجام‌شده']);
        expect(personalOrderKey(done, NOW).bucket).toBe(BUCKET_DONE_DUE);
    });

    it('تیک‌خورده‌ی سررسیددار: نزدیک‌ترین به اکنون اول', () => {
        const far = task('دو هفته پیش', { completed: true, due: [NOW - 14 * DAY] });
        const near = task('دیروز', { completed: true, due: [NOW - DAY] });
        expect(order([far, near])).toEqual(['دیروز', 'دو هفته پیش']);
    });

    it('تیک‌خورده‌ی بی‌سررسید آخر از همه، به ترتیب نام', () => {
        const b = task('ب', { completed: true });
        const a = task('الف', { completed: true });
        const anyDue = task('سررسیددار', { due: [NOW - 1 * HOUR] });
        expect(order([b, a, anyDue])).toEqual(['سررسیددار', 'الف', 'ب']);
        expect(personalOrderKey(a, NOW).bucket).toBe(BUCKET_DONE_NO_DUE);
    });

    it('ترتیب کامل هر پنج سطل در یک لیست', () => {
        const list = [
            task('۵ تیک‌خورده بی‌سررسید', { completed: true }),
            task('۴ تیک‌خورده دیروز', { completed: true, due: [NOW - DAY] }),
            task('۳ عقب‌افتاده دیروز', { due: [NOW - DAY] }),
            task('۲ بی‌سررسید', {}),
            task('۱ فردا', { due: [NOW + DAY] }),
            task('۱.۵ پس‌فردا', { due: [NOW + 2 * DAY] }),
        ];
        expect(order(list)).toEqual([
            '۱ فردا',
            '۱.۵ پس‌فردا',
            '۲ بی‌سررسید',
            '۳ عقب‌افتاده دیروز',
            '۴ تیک‌خورده دیروز',
            '۵ تیک‌خورده بی‌سررسید',
        ]);
    });
});

describe('personal-order — برنامه و جلسه‌ی مصرف‌شده', () => {
    it('سررسید برنامه از زیرکارهای غیربایگانی خوانده می‌شود', () => {
        const plan = task('برنامه', {
            kind: 'plan',
            children: [
                { id: 'c1', text: 'زیرکار ۱', completed: false, sessions: [{ id: 's1', at: new Date(NOW + DAY).toISOString() }] },
                { id: 'c2', text: 'زیرکار ۲', completed: true, sessions: [{ id: 's2', at: new Date(NOW + 5 * DAY).toISOString() }] },
                { id: 'c3', text: 'بایگانی', archived: true, completed: false, sessions: [{ id: 's3', at: new Date(NOW - DAY).toISOString() }] },
            ],
        });
        expect(dueTimestamps(plan).sort((a, b) => a - b)).toEqual([NOW + DAY, NOW + 5 * DAY]);
        expect(personalOrderKey(plan, NOW).bucket).toBe(BUCKET_UPCOMING);
        expect(personalOrderKey(plan, NOW).primary).toBe(NOW + DAY);
    });

    it('برنامه وقتی همه‌ی زیرکارها تیک خورده‌اند «انجام‌شده» است', () => {
        const donePlan = task('برنامه تمام', {
            kind: 'plan',
            children: [
                { id: 'c1', text: 'الف', completed: true },
                { id: 'c2', text: 'ب', completed: true },
            ],
        });
        const openPlan = task('برنامه باز', {
            kind: 'plan',
            children: [
                { id: 'c1', text: 'الف', completed: true },
                { id: 'c2', text: 'ب', completed: false },
            ],
        });
        const emptyPlan = task('برنامه خالی', { kind: 'plan', children: [] });
        expect(isTaskDone(donePlan)).toBe(true);
        expect(isTaskDone(openPlan)).toBe(false);
        expect(isTaskDone(emptyPlan)).toBe(false);
        expect(personalOrderKey(donePlan, NOW).bucket).toBe(BUCKET_DONE_NO_DUE);
    });

    it('جلسه‌ی مصرف‌شده (doneAt) سررسید حساب نمی‌شود', () => {
        const t = task('دوره‌ای', { due: [NOW - DAY], doneAt: new Date(NOW - DAY).toISOString() });
        expect(dueTimestamps(t)).toEqual([]);
        expect(personalOrderKey(t, NOW).bucket).toBe(BUCKET_NO_DUE);
    });
});

describe('personal-order — قراردادها', () => {
    it('آرایه‌ی ورودی دست‌نخورده می‌ماند', () => {
        const a = task('ب', { due: [NOW + 2 * DAY] });
        const b = task('الف', { due: [NOW + DAY] });
        const input = [a, b];
        sortPersonalTasks(input, NOW);
        expect(input).toEqual([a, b]);
    });

    it('ورودی غیرآرایه → آرایه‌ی خالی', () => {
        expect(sortPersonalTasks(null, NOW)).toEqual([]);
        expect(sortPersonalTasks(undefined, NOW)).toEqual([]);
    });

    it('comparePersonalTasks با کلید یکسان صفر می‌دهد', () => {
        const a = task('یکسان', { due: [NOW + DAY] });
        const b = task('یکسان', { due: [NOW + DAY] });
        expect(comparePersonalTasks(a, b, NOW)).toBe(0);
    });

    it('فقط حالت «هوشمند» و فقط فضای شخصی', () => {
        expect(shouldUsePersonalOrder({ sort: 'smart', local: true })).toBe(true);
        expect(shouldUsePersonalOrder({ sort: 'smart', local: false })).toBe(false);
        expect(shouldUsePersonalOrder({ sort: 'due', local: true })).toBe(false);
        expect(shouldUsePersonalOrder({ sort: 'newest', local: true })).toBe(false);
        expect(shouldUsePersonalOrder(null)).toBe(false);
    });
});
