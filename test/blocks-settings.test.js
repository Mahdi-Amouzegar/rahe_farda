// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/blocks-settings.test.js — تست لیست بلاک در تنظیمات (تصمیم ۲)

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../js/i18n.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, t: (key) => key };
});

const apiCalls = [];
vi.mock('../js/api.js', async () => ({
    apiFetch: vi.fn(async (path, opts) => {
        apiCalls.push({ path, opts });
        if (path === '/api/blocks' && !(opts && opts.method === 'POST')) {
            return {
                ok: true,
                data: {
                    blocks: [
                        { id: 'b1', blockedId: 'u9', blockedUser: { id: 'u9', username: 'spammer' } },
                    ],
                },
            };
        }
        if (path === '/api/blocks/b1' && opts && opts.method === 'DELETE') {
            return { ok: true, data: { unblocked: true } };
        }
        return { ok: true, data: {} };
    }),
    apiErrorMessage: (e) => (e && e.message) || 'err',
}));

import { renderBlockedList } from '../js/communication/connections.js';

beforeEach(() => {
    apiCalls.length = 0;
    document.body.innerHTML = '<div id="blockedList"></div>';
});

describe('blocks settings', () => {
    it('لیست بلاک‌ها رندر می‌شود', async () => {
        await renderBlockedList();
        expect(document.body.textContent).toContain('spammer');
        expect(document.querySelector('#blockedList button')).not.toBeNull();
    });

    it('رفع بلاک DELETE می‌زند و لیست تازه می‌شود', async () => {
        await renderBlockedList();
        document.querySelector('#blockedList button').click();
        await new Promise((r) => setTimeout(r, 20));
        const dels = apiCalls.filter((c) => c.path === '/api/blocks/b1');
        expect(dels.length).toBe(1);
    });

    it('بدون کانتینر خطا نمی‌دهد', async () => {
        document.body.innerHTML = '';
        await expect(renderBlockedList()).resolves.toBeUndefined();
    });
});
