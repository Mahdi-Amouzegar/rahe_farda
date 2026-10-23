// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/shared-plan-toggle.test.js -- تیک زیرکار + «انجام شدن همه زیرکارها» در DM/گروه
//
// ⚠️ 10.29 (BUG-33/34): تیک زیرکار برنامه‌ی مشترک پیام «ذخیره ناموفق بود»
// می‌داد (چون id زیرکار با getSharedItem سطح‌بالا پیدا نمی‌شد) و دکمه‌ی
// «انجام شدن همه زیرکارها» در نمای مشترک بی‌اثر بود (هندلر فقط state.tasks
// شخصی را می‌دید و پشت گیت نمای مشترک return می‌شد).

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../js/i18n.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, t: (key) => key };
});

const apiCalls = [];
vi.mock('../js/api.js', async () => ({
    apiFetch: vi.fn(async (path, opts) => {
        apiCalls.push({ path, opts });
        if (path.startsWith('/api/dm/tasks/') && opts && opts.method === 'PATCH') {
            return { ok: true, data: { updated: true, revision: 2 } };
        }
        return { ok: false, error: { code: 'NOT_FOUND', message: 'x' } };
    }),
    apiErrorMessage: (e) => (e && e.message) || 'err',
}));

import {
    __resetSharedForTest,
    __setSharedItemsForTest,
    toggleSharedTask,
    updateSharedTaskText,
    completeSharedChildren,
    removeSharedChild,
} from '../js/tasks/source.js';

const PEER_DEST = { type: 'peer', peerId: 'u2' };

function child(id, completed) {
    return {
        id,
        text: 'زیرکار ' + id,
        completed: !!completed,
        completedAt: completed ? '2026-10-01T00:00:00.000Z' : null,
        priority: 'medium',
        recur: 'none',
        sessions: [],
    };
}

function planItem(opts) {
    const o = opts || {};
    return {
        id: 'p1',
        text: 'برنامه',
        completed: false,
        completedAt: null,
        priority: 'medium',
        kind: o.kind || 'plan',
        recur: 'none',
        sessions: [],
        children: [child('c1', false), child('c2', true)],
        _shared: {
            mine: o.mine !== false,
            dest: PEER_DEST,
            remoteId: 'p1',
            senderName: null,
        },
    };
}

function lastPayload() {
    const call = apiCalls[apiCalls.length - 1];
    return call.opts.body.payload;
}

beforeEach(() => {
    __resetSharedForTest();
    apiCalls.length = 0;
});

describe('تیک زیرکار برنامه‌ی مشترک (BUG-33)', () => {
    it('زیرکار خودی تیک می‌خورد و payload روی والد نوشته می‌شود', async () => {
        __setSharedItemsForTest([planItem()]);
        const res = await toggleSharedTask('c1');

        expect(res.ok).toBe(true);
        expect(apiCalls).toHaveLength(1);
        // نوشتن همیشه روی id والد (نه id زیرکار)
        expect(apiCalls[0].path).toBe('/api/dm/tasks/p1');
        expect(apiCalls[0].opts.method).toBe('PATCH');

        const payload = lastPayload();
        expect(payload.children.find((c) => c.id === 'c1').completed).toBe(true);
        expect(payload.children.find((c) => c.id === 'c1').completedAt).toBeTruthy();
        // خود برنامه تیک نمی‌خورد و مهر زیرکار دوم دست‌نخورده می‌ماند
        expect(payload.completed).toBe(false);
        expect(payload.children.find((c) => c.id === 'c2').completedAt)
            .toBe('2026-10-01T00:00:00.000Z');
        // `_shared` هرگز روی سرور نوشته نمی‌شود
        expect(payload._shared).toBeUndefined();
    });

    it('تیک دوباره، زیرکار را برمی‌گرداند و completedAt را صفر می‌کند', async () => {
        __setSharedItemsForTest([planItem()]);
        await toggleSharedTask('c2');
        const payload = lastPayload();
        expect(payload.children.find((c) => c.id === 'c2').completed).toBe(false);
        expect(payload.children.find((c) => c.id === 'c2').completedAt).toBeNull();
    });

    it('زیرکار برنامه‌ی دیگران → ok:false و بدون درخواست', async () => {
        __setSharedItemsForTest([planItem({ mine: false })]);
        const res = await toggleSharedTask('c1');
        expect(res.ok).toBe(false);
        expect(apiCalls).toHaveLength(0);
    });

    it('id ناشناس → ok:false و بدون درخواست', async () => {
        __setSharedItemsForTest([planItem()]);
        const res = await toggleSharedTask('nope');
        expect(res.ok).toBe(false);
        expect(apiCalls).toHaveLength(0);
    });

    it('تیک سطح‌بالای برنامه (نه زیرکار) رفتار قبلی را حفظ می‌کند', async () => {
        __setSharedItemsForTest([planItem()]);
        const res = await toggleSharedTask('p1');
        expect(res.ok).toBe(true);
        expect(apiCalls[0].path).toBe('/api/dm/tasks/p1');
        const payload = lastPayload();
        expect(payload.completed).toBe(true);
        expect(payload.completedAt).toBeTruthy();
    });
});

describe('ویرایش عنوان زیرکار برنامه‌ی مشترک (BUG-33 هم‌خانواده)', () => {
    it('عنوان زیرکار در والد نوشته می‌شود، نه روی id زیرکار', async () => {
        __setSharedItemsForTest([planItem()]);
        const res = await updateSharedTaskText('c1', 'زیرکار جدید');

        expect(res.ok).toBe(true);
        expect(apiCalls[0].path).toBe('/api/dm/tasks/p1');
        const payload = lastPayload();
        expect(payload.children.find((c) => c.id === 'c1').text).toBe('زیرکار جدید');
        expect(payload.text).toBe('برنامه'); // عنوان والد دست‌نخورده
    });

    it('ویرایش سطح‌بالا مثل قبل کار می‌کند', async () => {
        __setSharedItemsForTest([planItem()]);
        const res = await updateSharedTaskText('p1', 'برنامه‌ی نو');
        expect(res.ok).toBe(true);
        expect(lastPayload().text).toBe('برنامه‌ی نو');
    });
});

describe('حذف زیرکار برنامه‌ی مشترک (BUG-36)', () => {
    it('زیرکار از والد حذف می‌شود و بقیه دست‌نخورده می‌مانند', async () => {
        __setSharedItemsForTest([planItem()]);
        const res = await removeSharedChild('c1');

        expect(res.ok).toBe(true);
        expect(apiCalls[0].path).toBe('/api/dm/tasks/p1');
        const payload = lastPayload();
        expect(payload.children.map((c) => c.id)).toEqual(['c2']);
        expect(payload._shared).toBeUndefined();
    });

    it('زیرکار برنامه‌ی دیگران → ok:false و بدون درخواست', async () => {
        __setSharedItemsForTest([planItem({ mine: false })]);
        const res = await removeSharedChild('c1');
        expect(res.ok).toBe(false);
        expect(apiCalls).toHaveLength(0);
    });

    it('id سطح‌بالا (نه زیرکار) → ok:false (حذف کل برنامه از مسیر دیگری می‌رود)', async () => {
        __setSharedItemsForTest([planItem()]);
        const res = await removeSharedChild('p1');
        expect(res.ok).toBe(false);
        expect(apiCalls).toHaveLength(0);
    });
});

describe('«انجام شدن همه زیرکارها» در نمای مشترک (BUG-34)', () => {
    it('همه‌ی زیرکارها تیک می‌خورند و مهر قبلی حفظ می‌شود', async () => {
        __setSharedItemsForTest([planItem()]);
        const res = await completeSharedChildren('p1');

        expect(res.ok).toBe(true);
        expect(apiCalls[0].path).toBe('/api/dm/tasks/p1');
        const payload = lastPayload();
        expect(payload.children.every((c) => c.completed === true)).toBe(true);
        expect(payload.children.find((c) => c.id === 'c1').completedAt).toBeTruthy();
        // زیرکاری که از قبل تمام شده بود مهر خودش را نگه می‌دارد
        expect(payload.children.find((c) => c.id === 'c2').completedAt)
            .toBe('2026-10-01T00:00:00.000Z');
        // خود برنامه تیک نمی‌خورد
        expect(payload.completed).toBe(false);
    });

    it('برنامه‌ی دیگران → ok:false و بدون درخواست', async () => {
        __setSharedItemsForTest([planItem({ mine: false })]);
        const res = await completeSharedChildren('p1');
        expect(res.ok).toBe(false);
        expect(apiCalls).toHaveLength(0);
    });

    it('تسک غیربرنامه → ok:false', async () => {
        __setSharedItemsForTest([planItem({ kind: 'task' })]);
        const res = await completeSharedChildren('p1');
        expect(res.ok).toBe(false);
        expect(apiCalls).toHaveLength(0);
    });
});
