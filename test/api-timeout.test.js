// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/api-timeout.test.js — رگرسیون 10.21/BUG-22
//
// ⚠️ این فایل api.js را mock نمی‌کند (تست خودِ لایه‌ی شبکه).
// قبلاً `net::ERR_TIMED_OUT` در کنسول می‌ماند چون هیچ سقف زمانی نبود.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('apiFetch — سقف زمان (10.21/BUG-22)', () => {
    let apiFetch, state;

    beforeEach(async () => {
        vi.resetModules();
        const api = await import('../js/api.js');
        apiFetch = api.apiFetch;
        ({ state } = await import('../js/core.js'));
        state.sync.authToken = 'tok';
    });

    afterEach(() => { vi.unstubAllGlobals(); });

    it('درخواست گیرکرده با AbortError → کد TIMEOUT (نه انتظار بی‌پایان)', async () => {
        vi.stubGlobal('fetch', (url, opts) => new Promise((_, reject) => {
            if (opts && opts.signal) {
                opts.signal.addEventListener('abort', () => {
                    const err = new Error('aborted');
                    err.name = 'AbortError';
                    reject(err);
                });
            }
        }));
        const res = await apiFetch('/api/groups', { timeoutMs: 20 });
        expect(res.ok).toBe(false);
        expect(res.error.code).toBe('TIMEOUT');
    });

    it('خطای شبکه معمولی همچنان NETWORK_ERROR است', async () => {
        vi.stubGlobal('fetch', () => Promise.reject(new Error('boom')));
        const res = await apiFetch('/api/groups');
        expect(res.ok).toBe(false);
        expect(res.error.code).toBe('NETWORK_ERROR');
    });

    it('پاسخ موفق بعد از گذشت زمان، timer را پاک می‌کند (بدون خطای بعدی)', async () => {
        vi.stubGlobal('fetch', async () => ({
            ok: true,
            status: 200,
            json: async () => ({ ok: true, data: { groups: [] } }),
        }));
        const res = await apiFetch('/api/groups', { timeoutMs: 50 });
        expect(res.ok).toBe(true);
        await new Promise(r => setTimeout(r, 80));
        // اگر timer پاک نمی‌شد، abort روی پاسخ بسته اثری نداشت ولی خطای کنسول می‌داد
        expect(res.data.groups).toEqual([]);
    });
});
