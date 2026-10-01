// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/api.test.js — تست‌های کلاینت مشترک (8.2-A)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../js/i18n.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, t: (key) => key };
});

import { state } from '../js/core.js';
import { apiFetch, apiErrorMessage, getApiEndpoint } from '../js/api.js';

beforeEach(() => {
    state.sync.authToken = null;
    state.sync.endpoint = null;
    vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('apiFetch', () => {
    it('بدون توکن، بدون fetch خطای NO_AUTH می‌دهد', async () => {
        const res = await apiFetch('/api/connections');
        expect(res.ok).toBe(false);
        expect(res.error.code).toBe('NO_AUTH');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('پاسخ موفق را باز می‌کند', async () => {
        state.sync.authToken = 'tok123';
        fetch.mockResolvedValue({
            ok: true,
            json: async () => ({ ok: true, data: { connections: [] } }),
        });
        const res = await apiFetch('/api/connections');
        expect(res.ok).toBe(true);
        expect(res.data).toEqual({ connections: [] });
        const [, opts] = fetch.mock.calls[0];
        expect(opts.headers.Authorization).toBe('Bearer tok123');
    });

    it('خطای سرور را با code برمی‌گرداند', async () => {
        state.sync.authToken = 'tok123';
        fetch.mockResolvedValue({
            ok: false,
            status: 404,
            json: async () => ({ ok: false, error: { code: 'NOT_FOUND', message: 'پیدا نشد' } }),
        });
        const res = await apiFetch('/api/x');
        expect(res.ok).toBe(false);
        expect(res.error.code).toBe('NOT_FOUND');
        expect(res.error.message).toBe('پیدا نشد');
    });

    it('قطعی شبکه → NETWORK_ERROR', async () => {
        state.sync.authToken = 'tok123';
        fetch.mockRejectedValue(new TypeError('down'));
        const res = await apiFetch('/api/x');
        expect(res.ok).toBe(false);
        expect(res.error.code).toBe('NETWORK_ERROR');
    });

    it('body به‌صورت JSON فرستاده می‌شود', async () => {
        state.sync.authToken = 'tok123';
        fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true, data: {} }) });
        await apiFetch('/api/messages', { method: 'POST', body: { a: 1 } });
        const [, opts] = fetch.mock.calls[0];
        expect(opts.method).toBe('POST');
        expect(JSON.parse(opts.body)).toEqual({ a: 1 });
    });
});

describe('apiErrorMessage', () => {
    it('NO_AUTH و NETWORK_ERROR نگاشت می‌شوند', () => {
        expect(apiErrorMessage({ code: 'NO_AUTH' })).toBe('errors.unauthorized');
        expect(apiErrorMessage({ code: 'NETWORK_ERROR' })).toBe('errors.network');
    });

    it('پیام سرور برمی‌گردد وگرنه fallback', () => {
        expect(apiErrorMessage({ code: 'X', message: 'سرور گفت' })).toBe('سرور گفت');
        expect(apiErrorMessage(null)).toBe('errors.serverError');
    });
});

describe('getApiEndpoint', () => {
    it('پیش‌فرض Worker برمی‌گردد', () => {
        expect(getApiEndpoint()).toContain('workers.dev');
    });
});
