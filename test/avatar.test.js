// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/avatar.test.js — تست resolver و رندر آواتار (تصمیم F)

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../js/i18n.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, t: (key) => key };
});

const apiCalls = [];
vi.mock('../js/api.js', async () => ({
    apiFetch: vi.fn(async (path) => {
        apiCalls.push(path);
        if (path === '/api/media/m1') {
            return { ok: true, data: { downloadUrl: 'https://cdn.example/x.png' } };
        }
        return { ok: false, error: { code: 'NOT_FOUND', message: 'x' } };
    }),
    apiErrorMessage: (e) => (e && e.message) || 'err',
}));

import {
    resolveAvatar,
    avatarNode,
    clearAvatarCache,
    __resetAvatarCacheForTest,
} from '../js/ui/avatar.js';

beforeEach(() => {
    __resetAvatarCacheForTest();
    apiCalls.length = 0;
    document.body.innerHTML = '';
});

describe('avatar resolver', () => {
    it('https مستقیم برمی‌گردد بدون fetch', async () => {
        const url = await resolveAvatar('https://t.me/i/photo.jpg');
        expect(url).toBe('https://t.me/i/photo.jpg');
        expect(apiCalls.length).toBe(0);
    });

    it('خالی و نامعتبر → null', async () => {
        expect(await resolveAvatar(null)).toBeNull();
        expect(await resolveAvatar('')).toBeNull();
        expect(await resolveAvatar('ftp://x/y')).toBeNull();
        expect(apiCalls.length).toBe(0);
    });

    it('media: resolve می‌شود و کش می‌شود', async () => {
        const url = await resolveAvatar('media:m1');
        expect(url).toBe('https://cdn.example/x.png');
        expect(apiCalls.length).toBe(1);
        await resolveAvatar('media:m1');
        expect(apiCalls.length).toBe(1);
    });

    it('media ناموجود → null', async () => {
        expect(await resolveAvatar('media:nope')).toBeNull();
    });
});

describe('avatar node', () => {
    it('بدون ref حرف اول را نشان می‌دهد', () => {
        const n = avatarNode(null, 'سارا');
        expect(n.textContent).toBe('س');
        expect(n.querySelector('img')).toBeNull();
    });

    it('با ref معتبر، img جایگزین می‌شود', async () => {
        const n = avatarNode('https://t.me/i/photo.jpg', 'سارا');
        document.body.appendChild(n);
        await new Promise((r) => setTimeout(r, 10));
        expect(n.querySelector('img')).not.toBeNull();
    });

    it('img خراب → fallback حرف برمی‌گردد', async () => {
        const n = avatarNode('https://t.me/i/photo.jpg', 'سارا');
        document.body.appendChild(n);
        await new Promise((r) => setTimeout(r, 10));
        const img = n.querySelector('img');
        img.dispatchEvent(new Event('error'));
        expect(n.textContent).toBe('س');
    });
});
