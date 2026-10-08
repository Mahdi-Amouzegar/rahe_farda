// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/account-delete.test.js — فاز ۱۳ زیرگام ۱b: فلوی فرانت حذف حساب

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../js/i18n.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, t: (key, params) => (params ? key + JSON.stringify(params) : key) };
});

const apiCalls = [];
let nextResponse = { ok: true, data: {} };
vi.mock('../js/api.js', async () => ({
    apiFetch: vi.fn(async (path, opts) => {
        apiCalls.push({ path, opts });
        return nextResponse;
    }),
    apiErrorMessage: (e) => (e && e.message) || 'err',
}));

import {
    fetchDeletionPreview,
    requestAccountDeletion,
    buildDeleteConfirm,
    performLocalWipeout,
    fetchAccountSessions,
    revokeAccountSession,
    parseUserAgent,
    sessionMethodLabel,
    canRevokeSessions,
} from '../js/account-delete.js';

beforeEach(() => {
    apiCalls.length = 0;
    nextResponse = { ok: true, data: {} };
});

describe('account-delete — API calls', () => {
    it('preview از مسیر درست می‌خواند', async () => {
        nextResponse = { ok: true, data: { canDelete: true } };
        const r = await fetchDeletionPreview();
        expect(r.ok).toBe(true);
        expect(apiCalls[0].path).toBe('/api/users/me/deletion-preview');
        expect(apiCalls[0].opts).toBeUndefined();
    });

    it('حذف نهایی DELETE می‌زند', async () => {
        nextResponse = { ok: true, data: { deleted: true } };
        const r = await requestAccountDeletion();
        expect(r.ok).toBe(true);
        expect(apiCalls[0].path).toBe('/api/users/me');
        expect(apiCalls[0].opts.method).toBe('DELETE');
    });
});

describe('account-delete — buildDeleteConfirm', () => {
    it('با گروه مالک → بلاک با لیست گروه‌ها', () => {
        const c = buildDeleteConfirm({
            ownedGroups: [{ id: 'g1', name: 'سفر' }],
            personalTasks: 3,
        });
        expect(c.canDelete).toBe(false);
        expect(c.lines.some((l) => l.includes('سفر'))).toBe(true);
    });

    it('بدون گروه → تأیید با شمارش‌ها', () => {
        const c = buildDeleteConfirm({
            ownedGroups: [],
            personalTasks: 2, dmCreated: 1, groupCreated: 0, mediaObjects: 4,
        });
        expect(c.canDelete).toBe(true);
        expect(c.lines.length).toBe(2);
    });
});

describe('account-delete — performLocalWipeout', () => {
    it('ترتیب: خروج، بعد wipe، بعد رندر', async () => {
        const order = [];
        await performLocalWipeout({
            doLogout: async () => { order.push('logout'); },
            wipeStore: async () => { order.push('wipe'); },
            rerender: async () => { order.push('rerender'); },
        });
        expect(order).toEqual(['logout', 'wipe', 'rerender']);
    });

    it('خطای wipe، رندر را متوقف نمی‌کند', async () => {
        let rendered = false;
        await performLocalWipeout({
            doLogout: async () => {},
            wipeStore: async () => { throw new Error('idb down'); },
            rerender: async () => { rendered = true; },
        });
        expect(rendered).toBe(true);
    });
});

describe('account-delete — sessions API', () => {
    it('لیست نشست‌ها GET می‌زند', async () => {
        nextResponse = { ok: true, data: { sessions: [] } };
        const r = await fetchAccountSessions();
        expect(r.ok).toBe(true);
        expect(apiCalls[apiCalls.length - 1].path).toBe('/api/sessions');
    });

    it('باطل کردن DELETE می‌زند', async () => {
        nextResponse = { ok: true, data: { revoked: true } };
        const r = await revokeAccountSession('s1');
        expect(r.ok).toBe(true);
        const last = apiCalls[apiCalls.length - 1];
        expect(last.path).toBe('/api/sessions/s1');
        expect(last.opts.method).toBe('DELETE');
    });
});

describe('account-delete — parseUserAgent', () => {
    it('کروم ویندوز دسکتاپ', () => {
        const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
        expect(parseUserAgent(ua)).toEqual({ browser: 'Chrome', os: 'Windows', mobile: false });
    });

    it('سافاری آیفون موبایل', () => {
        const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
        expect(parseUserAgent(ua)).toEqual({ browser: 'Safari', os: 'iOS', mobile: true });
    });

    it('اج: اج اول (نه کروم)', () => {
        const ua = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0';
        expect(parseUserAgent(ua).browser).toBe('Edge');
    });

    it('خالی → همه null/false', () => {
        expect(parseUserAgent(null)).toEqual({ browser: null, os: null, mobile: false });
        expect(parseUserAgent('')).toEqual({ browser: null, os: null, mobile: false });
    });
});

describe('account-delete — method labels و گیت revoke', () => {
    it('برچسب روش ورود', () => {
        expect(sessionMethodLabel('telegram')).toBe('auth.sessions.methodTelegram');
        expect(sessionMethodLabel('sync-code')).toBe('auth.sessions.methodSyncCode');
        expect(sessionMethodLabel(null)).toBe('auth.sessions.methodUnknown');
        expect(sessionMethodLabel('email')).toBe('auth.sessions.methodUnknown');
    });

    it('فقط غیر کد همگام‌سازی می‌تواند revoke کند', () => {
        expect(canRevokeSessions('telegram')).toBe(true);
        expect(canRevokeSessions(null)).toBe(true);
        expect(canRevokeSessions('sync-code')).toBe(false);
    });
});
