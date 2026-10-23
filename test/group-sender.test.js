// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/group-sender.test.js — تصمیم ستون آواتار فرستنده در لیست (10.32)

import { describe, it, expect } from 'vitest';
import { shouldShowSenderAvatar, senderInitial } from '../js/tasks/group-sender.js';

describe('shouldShowSenderAvatar', () => {
    it('گروه + پیام مخاطب → ستون آواتار دارد', () => {
        expect(shouldShowSenderAvatar({ local: false, mine: false, destType: 'group' })).toBe(true);
    });

    it('پیام خودم در گروه → آواتار ندارد', () => {
        expect(shouldShowSenderAvatar({ local: false, mine: true, destType: 'group' })).toBe(false);
    });

    it('DM → آواتار ندارد (فقط یک مخاطب)', () => {
        expect(shouldShowSenderAvatar({ local: false, mine: false, destType: 'peer' })).toBe(false);
    });

    it('نمای شخصی → آواتار ندارد', () => {
        expect(shouldShowSenderAvatar({ local: true, mine: false, destType: null })).toBe(false);
    });

    it('ورودی ناقص → false (بدون خطا)', () => {
        expect(shouldShowSenderAvatar(null)).toBe(false);
        expect(shouldShowSenderAvatar({})).toBe(false);
    });
});

describe('senderInitial', () => {
    it('حرف اول نام را برمی‌گرداند', () => {
        expect(senderInitial('فرامرز آموزگار')).toBe('ف');
        expect(senderInitial('Sara')).toBe('S');
    });

    it('نام خالی/فاصله → ؟', () => {
        expect(senderInitial('')).toBe('?');
        expect(senderInitial('   ')).toBe('?');
        expect(senderInitial(null)).toBe('?');
        expect(senderInitial(undefined)).toBe('?');
    });

    it('ایموجی را نصفه نمی‌کند', () => {
        expect(senderInitial('🎯 هدف')).toBe('🎯');
    });
});
