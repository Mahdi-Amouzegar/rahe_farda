// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/nav-icon.test.js — جدا کردن ایموجیِ ابتدای برچسب منو (10.32)

import { describe, it, expect } from 'vitest';
import { splitLeadingEmoji } from '../js/navigation/nav-icon.js';

describe('splitLeadingEmoji', () => {
    it('ایموجی ابتدای متن جدا می‌شود', () => {
        expect(splitLeadingEmoji('📋 وظایف من')).toEqual({ icon: '📋', text: 'وظایف من' });
        expect(splitLeadingEmoji('👤 حساب من')).toEqual({ icon: '👤', text: 'حساب من' });
        expect(splitLeadingEmoji('🔐 ورود / ساخت حساب')).toEqual({ icon: '🔐', text: 'ورود / ساخت حساب' });
    });

    it('ایموجی با variation selector', () => {
        expect(splitLeadingEmoji('⚙️ تنظیمات')).toEqual({ icon: '⚙️', text: 'تنظیمات' });
    });

    it('متن بدون ایموجی دست‌نخورده می‌ماند', () => {
        expect(splitLeadingEmoji('Groups')).toEqual({ icon: '', text: 'Groups' });
        expect(splitLeadingEmoji('＋ گفتگوی تازه')).toEqual({ icon: '', text: '＋ گفتگوی تازه' });
    });

    it('اگر متن فقط ایموجی باشد، به‌عنوان متن برمی‌گردد (برچسب خالی نشود)', () => {
        expect(splitLeadingEmoji('📋')).toEqual({ icon: '', text: '📋' });
    });

    it('ورودی خالی → بدون خطا', () => {
        expect(splitLeadingEmoji('')).toEqual({ icon: '', text: '' });
        expect(splitLeadingEmoji(null)).toEqual({ icon: '', text: '' });
        expect(splitLeadingEmoji(undefined)).toEqual({ icon: '', text: '' });
    });
});
