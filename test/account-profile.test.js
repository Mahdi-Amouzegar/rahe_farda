// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/account-profile.test.js — کادر پروفایل ویرایش‌پذیر «حساب من» (10.45)
//
// ⚠️ چه چیزی قفل می‌شود:
//   ۱. قواعد نام کاربری دقیقاً همان قواعد سرور (`^[a-z][a-z0-9_]{2,19}$`)
//      — خط تیره مجاز نیست (canonicalUsername آن را حذف می‌کند).
//   ۲. سه ردیف: نام / نام کاربری / آواتار.
//   ۳. ویرایش درجا → PATCH درست، و خطای سرور در همان ردیف نمایش داده می‌شود.
//   ۴. نام «قابل واگذاری» → راهنمای تماس با rahefarda_support.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const apiCalls = [];
let nextResponse = { ok: true, data: {} };

vi.mock('../js/api.js', () => ({
    apiFetch: vi.fn(async (path, opts) => {
        apiCalls.push({ path, opts });
        return nextResponse;
    }),
    apiErrorMessage: (err) => (err && err.message) || 'err',
}));

vi.mock('../js/i18n.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, t: (k) => k };
});

const stored = [];
vi.mock('../js/auth.js', () => ({
    getCurrentUser: () => ({
        id: 'u1',
        displayName: 'مهدی آموزگار',
        username: 'mahdi',
        avatarUrl: null,
    }),
    isLoggedIn: () => true,
    setStoredUserFields: (patch) => { stored.push(patch); },
}));

vi.mock('../js/ui/avatar.js', () => ({
    avatarNode: () => {
        const span = document.createElement('span');
        span.className = 'conv-avatar auth-avatar-thumb';
        return span;
    },
    clearAvatarCache: vi.fn(),
}));

vi.mock('../js/ui/avatar-settings.js', () => ({
    uploadAvatarFile: vi.fn(async () => 'media:99'),
}));

import {
    USERNAME_RE,
    normalizeUsername,
    validateUsernameInput,
    validateDisplayNameInput,
    renderAccountProfile,
} from '../js/ui/account-profile.js';

/** صبر برای تمام‌شدن زنجیره‌ی await داخل هندلرها */
async function flush() {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
}

describe('قواعد نام کاربری — آینه‌ی سرور', () => {
    it('نام‌های معتبر را می‌پذیرد', () => {
        for (const name of ['ali', 'ali_90', 'a1b', 'mahdi_amouzegar']) {
            expect(validateUsernameInput(name).ok, name).toBe(true);
        }
    });

    it('حروف بزرگ را lowercase می‌کند (همان رفتار سرور)', () => {
        const r = validateUsernameInput('  Mahdi  ');
        expect(r.ok).toBe(true);
        expect(r.value).toBe('mahdi');
    });

    it('نام‌های نامعتبر را رد می‌کند', () => {
        const bad = [
            '',
            'ab',                    // کمتر از ۳
            '1abc',                  // با عدد شروع شده
            '_abc',                  // با آندرلاین شروع شده
            'ali-90',                // ⚠️ خط تیره مجاز نیست
            'ali 90',                // فاصله
            'علی',                   // غیر ASCII
            'a'.repeat(21),          // بیشتر از ۲۰
        ];
        for (const name of bad) {
            expect(validateUsernameInput(name).ok, JSON.stringify(name)).toBe(false);
        }
    });

    it('الگوی صادرشده با قرارداد سرور یکی است', () => {
        expect(USERNAME_RE.source).toBe('^[a-z][a-z0-9_]{2,19}$');
    });

    it('normalizeUsername فاصله و حروف بزرگ را پاک می‌کند', () => {
        expect(normalizeUsername('  ALI  ')).toBe('ali');
        expect(normalizeUsername(null)).toBe('');
        expect(normalizeUsername(undefined)).toBe('');
    });

    it('نام نمایشی خالی رد می‌شود', () => {
        expect(validateDisplayNameInput('   ').ok).toBe(false);
        expect(validateDisplayNameInput('مهدی').ok).toBe(true);
    });
});

describe('رندر کادر پروفایل', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        const box = document.createElement('div');
        box.id = 'accountProfileBlock';
        box.className = 'auth-user-info';
        document.body.appendChild(box);
        apiCalls.length = 0;
        stored.length = 0;
        nextResponse = {
            ok: true,
            data: { displayName: 'مهدی آموزگار', username: 'mahdi', avatarUrl: 'media:5' },
        };
    });

    it('سه ردیف نام / نام کاربری / آواتار می‌سازد', async () => {
        await renderAccountProfile({});
        const rows = document.querySelectorAll('.auth-edit-row');
        expect(rows.length).toBe(3);
        expect(document.querySelector('[data-field="displayName"]')).toBeTruthy();
        expect(document.querySelector('[data-field="username"]')).toBeTruthy();
        expect(document.querySelector('[data-field="avatar"]')).toBeTruthy();
    });

    it('نام کاربری را با @ و LTR نشان می‌دهد', async () => {
        await renderAccountProfile({});
        const value = document.querySelector('[data-field="username"] .auth-edit-value');
        expect(value.textContent).toBe('@mahdi');
        expect(value.getAttribute('dir')).toBe('ltr');
    });

    it('ویرایش نام کاربری: ورودی بدون @ و ذخیره با PATCH درست', async () => {
        await renderAccountProfile({});
        const row = document.querySelector('[data-field="username"]');
        row.querySelector('.auth-edit-btn').click();

        const input = row.querySelector('.auth-inline-input');
        expect(input).toBeTruthy();
        expect(input.value).toBe('mahdi');

        input.value = 'new_name';
        nextResponse = { ok: true, data: { username: 'new_name' } };
        row.querySelector('.auth-save-btn').click();
        await flush();

        const patch = apiCalls.find((c) => c.opts && c.opts.method === 'PATCH');
        expect(patch).toBeTruthy();
        expect(patch.opts.body).toEqual({ username: 'new_name' });
        expect(stored.some((p) => p.username === 'new_name')).toBe(true);
    });

    it('نام کاربری نامعتبر به سرور نمی‌رود و خطا نشان می‌دهد', async () => {
        await renderAccountProfile({});
        const row = document.querySelector('[data-field="username"]');
        row.querySelector('.auth-edit-btn').click();
        const input = row.querySelector('.auth-inline-input');
        input.value = 'ab';
        row.querySelector('.auth-save-btn').click();
        await flush();

        expect(apiCalls.filter((c) => c.opts && c.opts.method === 'PATCH').length).toBe(0);
        const error = row.querySelector('.auth-edit-error');
        expect(error.hidden).toBe(false);
        expect(error.textContent.length).toBeGreaterThan(0);
    });

    it('خطای USERNAME_TAKEN از سرور در همان ردیف نمایش داده می‌شود', async () => {
        await renderAccountProfile({});
        const row = document.querySelector('[data-field="username"]');
        row.querySelector('.auth-edit-btn').click();
        row.querySelector('.auth-inline-input').value = 'taken_name';
        nextResponse = {
            ok: false,
            error: { code: 'USERNAME_TAKEN', message: 'این نام کاربری قبلاً گرفته شده است', status: 409 },
        };
        row.querySelector('.auth-save-btn').click();
        await flush();

        const error = row.querySelector('.auth-edit-error');
        expect(error.hidden).toBe(false);
        expect(error.textContent).toContain('گرفته شده');
    });

    it('نام قابل واگذاری → راهنمای rahefarda_support', async () => {
        await renderAccountProfile({});
        const row = document.querySelector('[data-field="username"]');
        row.querySelector('.auth-edit-btn').click();
        row.querySelector('.auth-inline-input').value = 'premium_name';
        nextResponse = {
            ok: false,
            error: { code: 'USERNAME_PREMIUM_REVIEW', message: 'قابل واگذاری', status: 400 },
        };
        row.querySelector('.auth-save-btn').click();
        await flush();

        const hint = row.querySelector('.auth-edit-hint');
        expect(hint.hidden).toBe(false);
        expect(hint.textContent).toContain('rahefarda_support');
    });

    it('ویرایش نام خالی را رد می‌کند', async () => {
        await renderAccountProfile({});
        const row = document.querySelector('[data-field="displayName"]');
        row.querySelector('.auth-edit-btn').click();
        row.querySelector('.auth-inline-input').value = '   ';
        row.querySelector('.auth-save-btn').click();
        await flush();

        expect(apiCalls.filter((c) => c.opts && c.opts.method === 'PATCH').length).toBe(0);
        expect(row.querySelector('.auth-edit-error').hidden).toBe(false);
    });

    it('حذف آواتار → PATCH با avatarUrl: null', async () => {
        await renderAccountProfile({});
        const row = document.querySelector('[data-field="avatar"]');
        const removeBtn = row.querySelector('.auth-remove-btn');
        expect(removeBtn.disabled).toBe(false);
        removeBtn.click();
        await flush();

        const patch = apiCalls.find((c) => c.opts && c.opts.method === 'PATCH');
        expect(patch.opts.body).toEqual({ avatarUrl: null });
    });

    it('بدون آواتار، دکمه‌ی حذف غیرفعال است', async () => {
        nextResponse = { ok: true, data: { displayName: 'x', username: null, avatarUrl: null } };
        await renderAccountProfile({});
        const row = document.querySelector('[data-field="avatar"]');
        expect(row.querySelector('.auth-remove-btn').disabled).toBe(true);
        const usernameValue = document.querySelector('[data-field="username"] .auth-edit-value');
        expect(usernameValue.textContent).toBe('—');
    });
});
