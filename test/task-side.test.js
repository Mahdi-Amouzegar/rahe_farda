// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/task-side.test.js — سمت نوار اولویت کارت (10.27)
//
// ⚠️ گزارش کاربر: در «وظایف من» نوار رنگی سمت چپ بود و کارت‌ها شبیه پیام
// دریافتی دیده می‌شدند. وظایف شخصی را خودمان ساخته‌ایم → نوار سمت راست.

import { describe, it, expect } from 'vitest';
import { sideClassFor } from '../js/tasks/side.js';

describe('tasks/side — sideClassFor', () => {
    it('وظایف شخصی → side-own (نوار سمت راست)', () => {
        expect(sideClassFor({ local: true, mine: false })).toBe(' side-own');
    });

    it('آیتم خودی در نمای مشترک → shared-mine', () => {
        expect(sideClassFor({ local: false, mine: true })).toBe(' shared-mine');
    });

    it('آیتم دیگران در نمای مشترک → shared-other', () => {
        expect(sideClassFor({ local: false, mine: false })).toBe(' shared-other');
    });

    it('ورودی ناقص/خالی → shared-other (پیش‌فرض محافظه‌کارانه)', () => {
        expect(sideClassFor(undefined)).toBe(' shared-other');
        expect(sideClassFor({})).toBe(' shared-other');
    });
});
