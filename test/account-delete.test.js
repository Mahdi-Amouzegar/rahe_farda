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
