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
import { findTask, saveTask } from '../js/store.js';
import {
    setDetailBridge,
    clearDetailBridge,
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

    it('پل برای آیتم دیگران ست نمی‌شود', async () => {
        seedBridge(other);
        state.currentDetailId = 'd1';
        expect(setDetailBridge(other)).toBe(false);
        expect(findTask('d1')).toBeNull();
        state.currentDetailId = null;
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
});

describe('detail bridge — openSharedDetail', () => {
    it('خودی: پل ست + openDetail صدا زده می‌شود', async () => {
        seedBridge(mine);
        const { __setSharedItemsForTest } = await import('../js/tasks/source.js');
        __setSharedItemsForTest([mine]);
        state.currentDetailId = 'd2';
        expect(await openSharedDetail('d2')).toBe(true);
        expect(detailCalls).toEqual(['d2']);
        state.currentDetailId = null;
    });

    it('دیگران: باز نمی‌شود', async () => {
        seedBridge(other);
        const { __setSharedItemsForTest } = await import('../js/tasks/source.js');
        __setSharedItemsForTest([other]);
        state.currentDetailId = null;
        expect(await openSharedDetail('d1')).toBe(false);
        expect(detailCalls).toEqual([]);
    });
});
