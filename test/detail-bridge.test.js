// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/detail-bridge.test.js -- پل جزئیات تسک خودیِ مشترک

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../js/i18n.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, t: (key) => key, formatDateTime: (iso) => 'T:' + iso };
});

const apiCalls = [];
vi.mock('../js/api.js', async () => ({
    apiFetch: vi.fn(async (path, opts) => {
        apiCalls.push({ path, opts });
        if (path === '/api/dm/tasks' && opts && opts.method === 'POST') {
            return { ok: true, data: { task: { id: 'd9' } } };
        }
        if (path.startsWith('/api/dm/tasks/') && opts && opts.method === 'PATCH') {
            return { ok: true, data: { updated: true, revision: 2 } };
        }
        return { ok: false, error: { code: 'NOT_FOUND', message: 'x' } };
    }),
    apiErrorMessage: (e) => (e && e.message) || 'err',
}));

const detailCalls = [];
vi.mock('../js/detail.js', async () => ({
    openDetail: vi.fn(async (id) => {
        detailCalls.push(id);
    }),
    closeDetail: vi.fn(() => {}),
}));

import { state } from '../js/core.js';
import { findTask, saveTask, saveTasks } from '../js/store.js';
import {
    setDetailBridge,
    clearDetailBridge,
    isDetailBridgeReadOnly,
    getSharedItem,
    __resetSharedForTest,
} from '../js/tasks/source.js';
import { __resetDestinationForTest, setDestination } from '../js/tasks/destination.js';
import { openSharedDetail } from '../js/tasks/composer.js';

const mine = {
    id: 'd2',
    text: 'از من',
    kind: 'task',
    _shared: { mine: true, dest: { type: 'peer', peerId: 'u2' }, remoteId: 'd2', senderName: null },
};
const other = {
    id: 'd1',
    text: 'از سارا',
    kind: 'task',
    _shared: { mine: false, dest: { type: 'peer', peerId: 'u2' }, remoteId: 'd1', senderName: 'سارا' },
};

function seedBridge(item) {
    __resetSharedForTest();
    __resetDestinationForTest();
    state.tasks = [];
    state.currentDetailId = null;
    clearDetailBridge();
    apiCalls.length = 0;
    detailCalls.length = 0;
    setDestination({ type: 'peer', peerId: 'u2', name: 'سارا' });
    // تزریق مستقیم آیتم به فروشگاه مشترک
    return item;
}

describe('detail bridge — findTask', () => {
    it('بدون جزئیات باز، پل غیرفعال است', async () => {
        seedBridge(mine);
        const { __setSharedItemsForTest } = await import('../js/tasks/source.js');
        __setSharedItemsForTest([mine]);
        expect(findTask('d2')).toBeNull();
    });

    it('با پل و جزئیات باز، findTask همان آبجکت را می‌دهد', async () => {
        seedBridge(mine);
        const { __setSharedItemsForTest } = await import('../js/tasks/source.js');
        __setSharedItemsForTest([mine]);
        state.currentDetailId = 'd2';
        expect(setDetailBridge(mine)).toBe(true);
        const found = findTask('d2');
        expect(found).not.toBeNull();
        expect(found.task).toBe(mine);
        state.currentDetailId = null;
    });

    it('پل برای آیتم دیگران فقط با readOnly ست می‌شود (10.25)', async () => {
        seedBridge(other);
        state.currentDetailId = 'd1';
        // بدون readOnly → رد
        expect(setDetailBridge(other)).toBe(false);
        expect(findTask('d1')).toBeNull();
        // با readOnly → پل فعال، ولی قفل‌شده
        expect(setDetailBridge(other, { readOnly: true })).toBe(true);
        expect(isDetailBridgeReadOnly()).toBe(true);
        const found = findTask('d1');
        expect(found).not.toBeNull();
        expect(found.task).toBe(other);
        clearDetailBridge();
        state.currentDetailId = null;
    });
});

describe('detail bridge — زیرکار برنامه (10.25)', () => {
    const plan = {
        id: 'g5',
        text: 'سفر',
        kind: 'plan',
        _shared: { mine: false, dest: { type: 'group', groupId: 'gr1' }, remoteId: 'g5', senderName: 'رضا' },
        children: [
            { id: 'c1', text: 'رزرو هتل', kind: 'task', sessions: [] },
            { id: 'c2', text: 'خرید بلیت', kind: 'task', sessions: [] },
        ],
    };

    it('جزئیات زیرکارِ برنامه‌ی دیگران باز می‌شود (readOnly) و همان زیرکار برمی‌گردد', async () => {
        seedBridge(plan);
        const { __setSharedItemsForTest } = await import('../js/tasks/source.js');
        __setSharedItemsForTest([plan]);
        state.currentDetailId = null;
        expect(await openSharedDetail('c1')).toBe(true);
        expect(detailCalls).toEqual(['c1']);
        state.currentDetailId = 'c1';
        const found = findTask('c1');
        expect(found).not.toBeNull();
        expect(found.task).toBe(plan.children[0]);
        expect(isDetailBridgeReadOnly()).toBe(true);
        clearDetailBridge();
        state.currentDetailId = null;
    });

    it('getSharedRole برای زیرکار هم نقش می‌دهد (دابل‌کلیک)', async () => {
        seedBridge(plan);
        const { __setSharedItemsForTest, getSharedRole } = await import('../js/tasks/source.js');
        __setSharedItemsForTest([plan]);
        expect(getSharedRole('c2')).toEqual({ mine: false });
        expect(getSharedRole('nope')).toBeNull();
    });
});

describe('detail bridge — save routing', () => {
    it('saveTask روی پل مشترک به PATCH ریموت می‌رود، نه IDB محلی', async () => {
        seedBridge(mine);
        const { __setSharedItemsForTest } = await import('../js/tasks/source.js');
        __setSharedItemsForTest([mine]);
        state.currentDetailId = 'd2';
        setDetailBridge(mine);
        mine.text = 'ویرایش‌شده';
        await saveTask(mine);
        const patches = apiCalls.filter(
            (c) => c.path === '/api/dm/tasks/d2' && c.opts && c.opts.method === 'PATCH'
        );
        expect(patches.length).toBe(1);
        expect(patches[0].opts.body.payload.text).toBe('ویرایش‌شده');
        expect(state.tasks).toEqual([]);
        state.currentDetailId = null;
    });

    it('پل فقط‌خواندنی هیچ PATCHی نمی‌فرستد (10.25)', async () => {
        seedBridge(other);
        const { __setSharedItemsForTest } = await import('../js/tasks/source.js');
        __setSharedItemsForTest([other]);
        state.currentDetailId = 'd1';
        setDetailBridge(other, { readOnly: true });
        await saveTasks();
        await new Promise((r) => setTimeout(r, 20));
        const patches = apiCalls.filter(
            (c) => c.opts && c.opts.method === 'PATCH'
        );
        expect(patches.length).toBe(0);
        clearDetailBridge();
        state.currentDetailId = null;
    });
});

describe('detail bridge — openSharedDetail', () => {    it('خودی: پل ست + openDetail صدا زده می‌شود', async () => {
        seedBridge(mine);
        const { __setSharedItemsForTest } = await import('../js/tasks/source.js');
        __setSharedItemsForTest([mine]);
        state.currentDetailId = 'd2';
        expect(await openSharedDetail('d2')).toBe(true);
        expect(detailCalls).toEqual(['d2']);
        state.currentDetailId = null;
    });

    it('دیگران: باز می‌شود ولی فقط‌خواندنی (10.25)', async () => {
        seedBridge(other);
        const { __setSharedItemsForTest } = await import('../js/tasks/source.js');
        __setSharedItemsForTest([other]);
        state.currentDetailId = null;
        expect(await openSharedDetail('d1')).toBe(true);
        expect(detailCalls).toEqual(['d1']);
        expect(isDetailBridgeReadOnly()).toBe(true);
        clearDetailBridge();
        state.currentDetailId = null;
    });

    it('آیتم ناموجود → false', async () => {
        seedBridge(other);
        const { __setSharedItemsForTest } = await import('../js/tasks/source.js');
        __setSharedItemsForTest([other]);
        expect(await openSharedDetail('nope')).toBe(false);
        expect(detailCalls).toEqual([]);
    });
});

describe('detail bridge — bulk save (مسیر واقعی جزئیات)', () => {
    it('saveTasks گروهی هم پل را به PATCH ریموت می‌برد', async () => {
        seedBridge(mine);
        const { __setSharedItemsForTest } = await import('../js/tasks/source.js');
        __setSharedItemsForTest([mine]);
        state.currentDetailId = 'd2';
        expect(setDetailBridge(mine)).toBe(true);
        mine.text = 'از جزئیات';
        await saveTasks();
        // صبر برای persist آتش‌وبگذار
        await new Promise((r) => setTimeout(r, 20));
        const patches = apiCalls.filter(
            (c) => c.path === '/api/dm/tasks/d2' && c.opts && c.opts.method === 'PATCH'
        );
        expect(patches.length).toBe(1);
        expect(patches[0].opts.body.payload.text).toBe('از جزئیات');
        state.currentDetailId = null;
    });
});
