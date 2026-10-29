// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/back-stack.test.js — تست‌های لایه‌ی مرکزی دکمه‌ی برگشت (۱۰.۴۳)
//
// ⚠️ چرا این تست‌ها مهم‌اند: تنها راه جلوگیری از «بسته‌شدن کل برنامه در TWA»
//    وجود همیشگی یک ورودی نگهبان در تاریخچه است. اگر `handleBack` در ریشه
//    نگهبان را دوباره نگذارد، برگشت دوم کاربر را به بیرون پرت می‌کند — همان
//    باگی که این ماژول برای رفعش نوشته شد.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
    EXIT_WINDOW_MS,
    armGuard,
    isGuardActive,
    setBackLayers,
    isLayerOpen,
    findTopLayer,
    closeTopLayer,
    handleBack,
    initBackStack,
    isBackStackReady,
    __resetBackStackForTest,
    __getBackStackStateForTest,
} from '../js/navigation/back-stack.js';

function makeLayer(id, open, close) {
    return {
        id,
        isOpen: () => (typeof open === 'function' ? open() : open),
        close: close || (() => {}),
    };
}

beforeEach(() => {
    __resetBackStackForTest();
});

afterEach(() => {
    __resetBackStackForTest();
    vi.useRealTimers();
});

// ─── ثبت لایه‌ها ────────────────────────────────────────────────────────────

describe('setBackLayers', () => {
    it('ورودی‌های ناقص را دور می‌ریزد', () => {
        const n = setBackLayers([
            makeLayer('ok', true),
            null,
            { id: 'no-isOpen', close: () => {} },
            { id: 'no-close', isOpen: () => true },
            { isOpen: () => true, close: () => {} },
            makeLayer('ok2', false),
        ]);
        expect(n).toBe(2);
        expect(__getBackStackStateForTest().layerCount).toBe(2);
    });

    it('ورودی غیرآرایه = فهرست خالی (بدون خطا)', () => {
        expect(setBackLayers(null)).toBe(0);
        expect(setBackLayers('x')).toBe(0);
    });
});

// ─── انتخاب بالاترین لایه ───────────────────────────────────────────────────

describe('findTopLayer / closeTopLayer', () => {
    it('آخرین لایه‌ی باز را برمی‌گرداند (نه اولین)', () => {
        setBackLayers([
            makeLayer('page', true),
            makeLayer('modal', true),
            makeLayer('lightbox', false),
        ]);
        expect(findTopLayer().id).toBe('modal');
    });

    it('هیچ لایه‌ی بازی نیست ⇒ null', () => {
        setBackLayers([makeLayer('a', false), makeLayer('b', false)]);
        expect(findTopLayer()).toBeNull();
        expect(closeTopLayer()).toBeNull();
    });

    it('close فقط روی لایه‌ی بالایی صدا زده می‌شود', () => {
        const closePage = vi.fn();
        const closeModal = vi.fn();
        setBackLayers([
            makeLayer('page', true, closePage),
            makeLayer('modal', true, closeModal),
        ]);
        expect(closeTopLayer()).toBe('modal');
        expect(closeModal).toHaveBeenCalledTimes(1);
        expect(closePage).not.toHaveBeenCalled();
    });

    it('isOpen که خطا می‌دهد = بسته حساب می‌شود', () => {
        const broken = {
            id: 'broken',
            isOpen: () => { throw new Error('boom'); },
            close: () => {},
        };
        const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
        setBackLayers([makeLayer('ok', true), broken]);
        expect(isLayerOpen(broken)).toBe(false);
        expect(findTopLayer().id).toBe('ok');
        warn.mockRestore();
    });

    it('close که خطا می‌دهد کل فرایند را نمی‌شکند', () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        setBackLayers([
            makeLayer('bad', true, () => { throw new Error('nope'); }),
        ]);
        expect(closeTopLayer()).toBe('bad');
        err.mockRestore();
    });
});

// ─── هسته: handleBack ───────────────────────────────────────────────────────

describe('handleBack — بستن لایه', () => {
    it('لایه‌ی باز را می‌بندد، پیام نمی‌دهد و نگهبان را دوباره می‌گذارد', () => {
        const toast = vi.fn();
        const closeDrawer = vi.fn();
        let open = true;
        setBackLayers([
            makeLayer('drawer', () => open, () => { open = false; closeDrawer(); }),
        ]);
        initBackStack({ showToast: toast, message: () => 'خروج؟' });

        expect(isGuardActive()).toBe(true);
        expect(handleBack()).toBe('layer');

        expect(closeDrawer).toHaveBeenCalledTimes(1);
        expect(toast).not.toHaveBeenCalled();
        // ⚠️ حیاتی: بدون این، برگشت بعدی از برنامه خارج می‌شود.
        expect(isGuardActive()).toBe(true);
    });

    it('دو لایه‌ی باز ⇒ دو برگشت، به ترتیب از بالا به پایین', () => {
        const order = [];
        let page = true;
        let modal = true;
        setBackLayers([
            makeLayer('page', () => page, () => { page = false; order.push('page'); }),
            makeLayer('modal', () => modal, () => { modal = false; order.push('modal'); }),
        ]);
        initBackStack({ showToast: () => {} });

        expect(handleBack()).toBe('layer');
        expect(handleBack()).toBe('layer');
        expect(order).toEqual(['modal', 'page']);
        // بعد از بستن هر دو، برگشت سوم در ریشه است.
        expect(handleBack()).toBe('root');
    });

    it('لایه‌ای که خودش را نمی‌بندد (isOpen هنوز true) باعث حلقه نمی‌شود', () => {
        setBackLayers([makeLayer('stuck', true, () => {})]);
        initBackStack({ showToast: () => {} });
        // هر بار 'layer' برمی‌گرداند ولی برنامه خارج نمی‌شود و کرش هم نمی‌کند.
        expect(handleBack()).toBe('layer');
        expect(handleBack()).toBe('layer');
    });
});

describe('handleBack — ریشه و خروج دو مرحله‌ای', () => {
    it('برگشت اول در ریشه: پیام می‌دهد و خارج نمی‌شود', () => {
        const toast = vi.fn();
        setBackLayers([]);
        initBackStack({ showToast: toast, message: () => 'برای خروج، دوباره برگشت بزنید' });

        expect(handleBack()).toBe('root');
        expect(toast).toHaveBeenCalledWith('برای خروج، دوباره برگشت بزنید');
        // ⚠️ عمداً نگهبان برنمی‌گردد تا برگشت دوم طبیعی خارج شود.
        expect(isGuardActive()).toBe(false);
    });

    it('برگشت دوم داخل پنجره‌ی ۲ ثانیه ⇒ exit', () => {
        vi.useFakeTimers();
        setBackLayers([]);
        initBackStack({ showToast: () => {} });

        expect(handleBack()).toBe('root');
        vi.advanceTimersByTime(EXIT_WINDOW_MS - 100);
        expect(handleBack()).toBe('exit');
    });

    it('برگشت دوم بعد از ۲ ثانیه ⇒ دوباره پیام، نه خروج', () => {
        vi.useFakeTimers();
        const toast = vi.fn();
        setBackLayers([]);
        initBackStack({ showToast: toast });

        expect(handleBack()).toBe('root');
        vi.advanceTimersByTime(EXIT_WINDOW_MS + 1);
        expect(toast).toHaveBeenCalledTimes(1);
        // تایمر پنجره منقضی شده و نگهبان برگشته است.
        expect(isGuardActive()).toBe(true);
        expect(handleBack()).toBe('root');
        expect(toast).toHaveBeenCalledTimes(2);
    });

    it('بستن یک لایه، پنجره‌ی خروج را باطل می‌کند', () => {
        vi.useFakeTimers();
        let open = false;
        setBackLayers([makeLayer('modal', () => open, () => { open = false; })]);
        initBackStack({ showToast: () => {} });

        expect(handleBack()).toBe('root');
        // کاربر کاری کرد و یک مودال باز شد؛ حالا برگشت باید مودال را ببندد.
        open = true;
        expect(handleBack()).toBe('layer');
        open = false;
        expect(handleBack()).toBe('root');
    });

    it('تعامل کاربر بعد از پیام، نگهبان را برمی‌گرداند', () => {
        vi.useFakeTimers();
        setBackLayers([]);
        initBackStack({ showToast: () => {} });

        expect(handleBack()).toBe('root');
        expect(isGuardActive()).toBe(false);

        document.dispatchEvent(new Event('pointerdown'));
        expect(isGuardActive()).toBe(true);
    });

    it('کلید GoBack/Back به‌عنوان تعامل حساب نمی‌شود', () => {
        vi.useFakeTimers();
        setBackLayers([]);
        initBackStack({ showToast: () => {} });

        expect(handleBack()).toBe('root');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'GoBack' }));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'BrowserBack' }));
        expect(isGuardActive()).toBe(false);
    });
});

// ─── راه‌اندازی و popstate ──────────────────────────────────────────────────

describe('initBackStack', () => {
    it('idempotent است و نگهبان را می‌گذارد', () => {
        setBackLayers([]);
        initBackStack({ showToast: () => {} });
        expect(isBackStackReady()).toBe(true);
        const depth = window.history.length;

        initBackStack({ showToast: () => {} });
        initBackStack({ showToast: () => {} });
        expect(isBackStackReady()).toBe(true);
        // راه‌اندازی دوباره ورودی تاریخچه‌ی اضافه نمی‌سازد.
        expect(window.history.length).toBe(depth);
    });

    it('popstate همان منطق مرکزی را اجرا می‌کند', () => {
        const closeModal = vi.fn();
        let open = true;
        setBackLayers([makeLayer('modal', () => open, () => { open = false; closeModal(); })]);
        initBackStack({ showToast: () => {} });

        window.dispatchEvent(new PopStateEvent('popstate'));
        expect(closeModal).toHaveBeenCalledTimes(1);
        expect(isGuardActive()).toBe(true);
    });

    it('بعد از __reset دیگر به popstate گوش نمی‌دهد', () => {
        const closeModal = vi.fn();
        setBackLayers([makeLayer('modal', true, closeModal)]);
        initBackStack({ showToast: () => {} });
        __resetBackStackForTest();

        window.dispatchEvent(new PopStateEvent('popstate'));
        expect(closeModal).not.toHaveBeenCalled();
        expect(isBackStackReady()).toBe(false);
    });

    it('armGuard idempotent است (یک ورودی، نه چندتا)', () => {
        const depth = window.history.length;
        expect(armGuard()).toBe(true);
        expect(armGuard()).toBe(true);
        expect(armGuard()).toBe(true);
        expect(window.history.length).toBe(depth + 1);
    });
});
