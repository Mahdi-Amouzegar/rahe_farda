// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/group-avatar.test.js — آواتار گروه: انتخاب/حذف (10.32)
//
// ⚠️ نکته‌ی کلیدی: آپلود باید با `groupId` انجام شود، وگرنه مدیا شخصی می‌شود
// و فقط آپلودکننده اجازه‌ی خواندنش را دارد → بقیه‌ی اعضا حرف اول نام را
// می‌بینند. این تست همان قرارداد را قفل می‌کند.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const apiCalls = [];
vi.mock('../js/api.js', async () => ({
    apiFetch: vi.fn(async (path, opts) => {
        apiCalls.push({ path, opts });
        return { ok: true, data: {} };
    }),
    apiErrorMessage: () => 'err',
}));

// ⚠️ importOriginal: core.js از i18n.js چند export دیگر هم می‌گیرد
// (`formatBytes`، `formatDateTime`) — mock کاملِ ماژول آن‌ها را undefined می‌کرد.
vi.mock('../js/i18n.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, t: (k) => k };
});

const enqueueCalls = [];
vi.mock('../js/media-upload.js', async () => ({
    enqueueUpload: vi.fn(async (params) => {
        enqueueCalls.push(params);
        return { mediaId: 'm1', status: 'pending' };
    }),
    getUploadStatus: vi.fn(async () => ({ status: 'uploaded', serverMediaId: 'srv-9' })),
}));

vi.mock('../js/media.js', async () => ({
    processImageFile: vi.fn(async () => ({ blob: { size: 1234, type: 'image/jpeg' }, contentType: 'image/jpeg' })),
}));

vi.mock('../js/auth.js', async () => ({
    isLoggedIn: () => true,
    getCurrentUser: () => ({ id: 'u1' }),
    setStoredUserAvatar: () => {},
}));

import { changeGroupAvatar, removeGroupAvatar } from '../js/ui/avatar-settings.js';

function pickFileAndDispatch() {
    const input = document.body.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    const file = { name: 'a.jpg', size: 1234, type: 'image/jpeg' };
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
}

beforeEach(() => {
    apiCalls.length = 0;
    enqueueCalls.length = 0;
    document.body.innerHTML = '';
});

describe('changeGroupAvatar', () => {
    it('مدیا را با groupId آپلود می‌کند و گروه را با media:<id> وصله می‌کند', async () => {
        const p = changeGroupAvatar('g1');
        pickFileAndDispatch();
        expect(await p).toBe(true);

        // ⚠️ قرارداد حیاتی: groupId باید به صف آپلود برسد
        expect(enqueueCalls).toHaveLength(1);
        expect(enqueueCalls[0].groupId).toBe('g1');

        const patch = apiCalls.find(c => c.opts && c.opts.method === 'PATCH');
        expect(patch).toBeTruthy();
        expect(patch.path).toBe('/api/groups/g1');
        expect(patch.opts.body).toEqual({ avatarUrl: 'media:srv-9' });
    });

    it('اگر کاربر فایلی انتخاب نکند، هیچ درخواستی نمی‌زند', async () => {
        const p = changeGroupAvatar('g1');
        const input = document.body.querySelector('input[type="file"]');
        Object.defineProperty(input, 'files', { value: [], configurable: true });
        input.dispatchEvent(new Event('change'));

        expect(await p).toBe(false);
        expect(enqueueCalls).toHaveLength(0);
        expect(apiCalls).toHaveLength(0);
    });

    it('بدون groupId → false (بدون آپلود)', async () => {
        expect(await changeGroupAvatar('')).toBe(false);
        expect(enqueueCalls).toHaveLength(0);
    });
});

describe('removeGroupAvatar', () => {
    it('avatarUrl را null می‌کند', async () => {
        expect(await removeGroupAvatar('g1')).toBe(true);
        const patch = apiCalls.find(c => c.opts && c.opts.method === 'PATCH');
        expect(patch.path).toBe('/api/groups/g1');
        expect(patch.opts.body).toEqual({ avatarUrl: null });
    });
});
