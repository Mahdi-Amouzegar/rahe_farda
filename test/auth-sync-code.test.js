// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/auth-sync-code.test.js — فاز ۱۱ آیتم ۳/۵/۶: جریان سرتاسری کد همگام‌سازی

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../js/i18n.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, t: (key) => key };
});

import { state } from '../js/core.js';
import { events } from '../js/events.js';
import {
    loginWithSyncCode,
    generateSyncCode,
    setStoredHasSyncCode,
    logout,
} from '../js/auth.js';

beforeEach(() => {
    try { localStorage.clear(); } catch { /* silent */ }
    state.sync.authToken = null;
    state.sync.userId = null;
    state.sync.endpoint = 'https://example.test';
    vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('auth — loginWithSyncCode', () => {
    it('کد خالی → خطا بدون fetch', async () => {
        const r = await loginWithSyncCode('   ');
        expect(r.ok).toBe(false);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('کد معتبر → نشست ذخیره و auth:login', async () => {
        const user = { id: 'u1', displayName: 'علی' };
        fetch.mockResolvedValue({
            ok: true,
            json: async () => ({ ok: true, data: { token: 'tok', user, expiresAt: '2030-01-01T00:00:00.000Z' } }),
        });
        let emitted = null;
        const off = events.on('auth:login', (p) => { emitted = p; });
        const r = await loginWithSyncCode('x7k9-2mnp-8qrs');
        expect(r.ok).toBe(true);
        expect(r.user).toEqual(user);
        expect(emitted && emitted.user).toEqual(user);
        const [, opts] = fetch.mock.calls[0];
        const body = JSON.parse(opts.body);
        expect(body.code).toBe('X7K9-2MNP-8QRS');
        expect(typeof body.deviceId === 'string').toBe(true);
        off();
    });

    it('کد نامعتبر → پیام سرور برمی‌گردد', async () => {
        fetch.mockResolvedValue({
            ok: false,
            status: 401,
            json: async () => ({ ok: false, error: { code: 'INVALID_SYNC_CODE', message: 'کد نامعتبر' } }),
        });
        const r = await loginWithSyncCode('AAAA-1111-2222');
        expect(r.ok).toBe(false);
        expect(r.error).toBe('کد نامعتبر');
        expect(state.sync.authToken).toBe(null);
    });
});

describe('auth — generateSyncCode', () => {
    it('بدون ورود → unauthorized بدون fetch', async () => {
        const r = await generateSyncCode();
        expect(r.ok).toBe(false);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('با توکن → کد + ثبت پرچم محلی', async () => {
        state.sync.authToken = 'tok123';
        state.sync.userId = 'u1';
        localStorage.setItem('spaceTodoAuth', JSON.stringify({
            token: 'tok123', user: { id: 'u1', hasSyncCode: false }, expiresAt: '2030-01-01T00:00:00.000Z',
        }));
        fetch.mockResolvedValue({
            ok: true,
            json: async () => ({ ok: true, data: { code: 'X7K9-2MNP-8QRS', hint: 'X7K9', expiresAt: '2030-01-01T00:10:00.000Z' } }),
        });
        const r = await generateSyncCode();
        expect(r.ok).toBe(true);
        expect(r.code).toBe('X7K9-2MNP-8QRS');
        const [, opts] = fetch.mock.calls[0];
        expect(opts.headers.Authorization).toBe('Bearer tok123');
        const stored = JSON.parse(localStorage.getItem('spaceTodoAuth'));
        expect(stored.user.hasSyncCode).toBe(true);
    });
});

describe('auth — setStoredHasSyncCode', () => {
    it('بدون نشست، بی‌صدا رد می‌شود', () => {
        expect(() => setStoredHasSyncCode(true)).not.toThrow();
    });

    it('logout نشست را پاک می‌کند', () => {
        localStorage.setItem('spaceTodoAuth', JSON.stringify({ token: 't', user: { id: 'u1' }, expiresAt: '2030-01-01T00:00:00.000Z' }));
        state.sync.authToken = 't';
        logout({ silent: true });
        expect(localStorage.getItem('spaceTodoAuth')).toBe(null);
    });
});
