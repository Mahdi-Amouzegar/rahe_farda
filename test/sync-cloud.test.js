// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/sync-cloud.test.js — فاز ۱۳ (E.5.3): فعال‌سازی امن سینک ابری

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../js/i18n.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, t: (key) => key };
});

const netState = { online: true };
vi.mock('../js/net.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, isOnline: () => netState.online };
});

let apiResult = { ok: true, data: {} };
vi.mock('../js/api.js', async () => ({
    apiFetch: vi.fn(async () => apiResult),
    apiErrorMessage: (e) => (e && e.message) || 'err',
}));

import { state } from '../js/core.js';
import {
    enableCloudSyncFromState,
    postSingleOp,
    setCloudSyncHandler,
    loadSyncCursor,
    applySyncCursor,
} from '../js/sync-queue.js';

let _savedSync;
let _savedOnline;

beforeEach(() => {
    _savedSync = { ...state.sync };
    _savedOnline = state.net.online;
    state.sync.authToken = null;
    state.sync.userId = null;
    state.sync.endpoint = null;
    state.sync.enabled = false;
    state.sync.deviceId = 'dev-test';
    state.net.online = true;
    netState.online = true;
    apiResult = { ok: true, data: {} };
});

afterEach(() => {
    Object.assign(state.sync, _savedSync);
    state.net.online = _savedOnline;
});

describe('sync-cloud — enableCloudSyncFromState', () => {
    it('مهمان → false و enabled نمی‌شود', () => {
        expect(enableCloudSyncFromState()).toBe(false);
        expect(state.sync.enabled).toBe(false);
    });

    it('توکن بدون endpoint → false', () => {
        state.sync.authToken = 'tok';
        state.sync.userId = 'u1';
        expect(enableCloudSyncFromState()).toBe(false);
        expect(state.sync.enabled).toBe(false);
    });

    it('واردشده با endpoint → true و enabled', () => {
        state.sync.authToken = 'tok';
        state.sync.userId = 'u1';
        state.sync.endpoint = 'https://example.test';
        expect(enableCloudSyncFromState()).toBe(true);
        expect(state.sync.enabled).toBe(true);
    });
});

describe('sync-cloud — postSingleOp', () => {
    it('body درست با مهر تسک فرستاده می‌شود', async () => {
        const { apiFetch } = await import('../js/api.js');
        apiFetch.mockClear();
        const op = {
            id: 'op1', type: 'save', entityId: 't1', entityType: 'task',
            data: { id: 't1' }, parentId: null, timestamp: '2026-01-01T00:00:00.000Z',
            deviceId: 'd1', schemaVersion: '1.0.0', retries: 0, lastError: null,
        };
        const r = await postSingleOp(op);
        expect(r.ok).toBe(true);
        const [, opts] = apiFetch.mock.calls[0];
        expect(opts.method).toBe('POST');
        expect(opts.body.ops).toHaveLength(1);
        expect(opts.body.ops[0].timestamp).toBe('2026-01-01T00:00:00.000Z');
        expect(opts.body.requestFullResync).toBe(false);
    });

    it('سرور reject → ok:false (صف می‌ماند)', async () => {
        apiResult = { ok: false, error: { code: 'X' } };
        const r = await postSingleOp({ id: 'op1', type: 'save', entityId: 't1' });
        expect(r.ok).toBe(false);
    });

    it('setCloudSyncHandler خطا نمی‌دهد', () => {
        expect(() => setCloudSyncHandler()).not.toThrow();
    });
});

describe('sync-cloud — cursor سینک (10.15)', () => {
    beforeEach(() => {
        localStorage.clear();
        state.sync.userId = 'u1';
        state.sync.deviceId = 'd1';
    });
    afterEach(() => {
        localStorage.clear();
        state.sync.userId = null;
        state.sync.deviceId = null;
        apiResult = { ok: true, data: {} };
    });

    it('بدون cursor ذخیره‌شده → null', () => {
        expect(loadSyncCursor()).toBeNull();
    });

    it('newChangeSeq پاسخ موفق ذخیره و بازخوانی می‌شود', () => {
        applySyncCursor({ ok: true, data: { newChangeSeq: 42 } });
        expect(loadSyncCursor()).toBe(42);
    });

    it('پاسخ ناموفق/بدون newChangeSeq cursor را نمی‌خرابد', () => {
        applySyncCursor({ ok: true, data: { newChangeSeq: 7 } });
        applySyncCursor({ ok: false });
        applySyncCursor({ ok: true, data: {} });
        expect(loadSyncCursor()).toBe(7);
    });

    it('cursor برای هر کاربر جدا است', () => {
        applySyncCursor({ ok: true, data: { newChangeSeq: 5 } });
        state.sync.userId = 'u2';
        expect(loadSyncCursor()).toBeNull();
        state.sync.userId = 'u1';
        expect(loadSyncCursor()).toBe(5);
    });

    it('postSingleOp cursor را می‌فرستد و از پاسخ جلو می‌برد', async () => {
        applySyncCursor({ ok: true, data: { newChangeSeq: 9 } });
        const { apiFetch } = await import('../js/api.js');
        apiFetch.mockClear();
        apiResult = { ok: true, data: { newChangeSeq: 10 } };
        await postSingleOp({ id: 'op2', type: 'save', entityId: 't2', entityType: 'task', data: { id: 't2' }, parentId: null, timestamp: '2026-01-01T00:00:00.000Z', deviceId: 'd1', schemaVersion: '1.0.0', retries: 0, lastError: null });
        const [, opts] = apiFetch.mock.calls[0];
        expect(opts.body.lastChangeSeq).toBe(9);
        expect(loadSyncCursor()).toBe(10);
    });
});
