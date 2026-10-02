// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/group-queue.test.js — تست‌های صف آفلاین گروه (8.3-C)

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../js/i18n.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, t: (key) => key };
});

const netState = { online: true };
vi.mock('../js/net.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, isOnline: () => netState.online, getDeviceId: () => 'dev-test' };
});

const apiCalls = [];
let syncBehavior = 'accept';
vi.mock('../js/api.js', async () => ({
    apiFetch: vi.fn(async (path, opts) => {
        apiCalls.push({ path, opts });
        if (syncBehavior === 'transport-fail') {
            return { ok: false, error: { code: 'NETWORK_ERROR', message: 'x', status: null } };
        }
        const ops = (opts && opts.body && opts.body.ops) || [];
        if (syncBehavior === 'reject') {
            return {
                ok: true,
                data: {
                    accepted: [],
                    rejected: ops.map((o) => ({ opId: o.id, reason: 'forbidden' })),
                    changes: [],
                    newChangeSeq: 3,
                },
            };
        }
        return {
            ok: true,
            data: {
                accepted: ops.map((o) => ({ opId: o.id, changeSeq: 5 })),
                rejected: [],
                changes: [],
                newChangeSeq: 5,
            },
        };
    }),
    apiErrorMessage: (e) => (e && e.message) || 'err',
}));

import {
    enqueueGroupOp,
    flushGroup,
    flushAllGroups,
    getPendingCount,
    getGroupCursor,
    initGroupQueue,
    __resetGroupQueueForTest,
} from '../js/communication/group-queue.js';
import { events, EV } from '../js/events.js';

beforeEach(() => {
    __resetGroupQueueForTest();
    apiCalls.length = 0;
    netState.online = true;
    syncBehavior = 'accept';
    localStorage.clear();
    initGroupQueue();
});

describe('group-queue — enqueue (8.3-C)', () => {
    it('op با groupId و clientId ساخته می‌شود', async () => {
        const entry = await enqueueGroupOp('g1', 'save', 't1', { kind: 'task', payload: { title: 'x' } });
        expect(entry).not.toBeNull();
        expect(entry.groupId).toBe('g1');
        expect(entry.status).toBe('pending');
        expect(await getPendingCount('g1')).toBe(1);
        expect(await getPendingCount('g2')).toBe(0);
    });

    it('ورودی نامعتبر رد می‌شود', async () => {
        expect(await enqueueGroupOp('', 'save', 't1', null)).toBeNull();
        expect(await enqueueGroupOp('g1', 'nope', 't1', null)).toBeNull();
    });
});

describe('group-queue — flush (8.3-C)', () => {
    it('آنلاین: ارسال + حذف + cursor', async () => {
        await enqueueGroupOp('g1', 'save', 't1', { kind: 'task', payload: { title: 'x' } });
        const res = await flushGroup('g1');
        expect(res.ok).toBe(true);
        expect(res.flushed).toBe(1);
        expect(await getPendingCount('g1')).toBe(0);
        expect(getGroupCursor('g1')).toBe(5);
        const call = apiCalls.find((c) => c.path === '/api/groups/g1/sync');
        expect(call).toBeTruthy();
        expect(call.opts.body.ops[0]).toMatchObject({ type: 'save', entityId: 't1', entityType: 'group_task' });
    });

    it('آفلاین: pending می‌ماند', async () => {
        netState.online = false;
        await enqueueGroupOp('g1', 'save', 't1', { kind: 'task', payload: {} });
        const res = await flushGroup('g1');
        expect(res.ok).toBe(false);
        expect(await getPendingCount('g1')).toBe(1);
        expect(apiCalls.length).toBe(0);
    });

    it('خطای transport: می‌ماند + retryCount', async () => {
        await enqueueGroupOp('g1', 'save', 't1', { kind: 'task', payload: {} });
        syncBehavior = 'transport-fail';
        const res = await flushGroup('g1');
        expect(res.ok).toBe(false);
        expect(await getPendingCount('g1')).toBe(1);
    });

    it('rejected سرور (دائمی) حذف می‌شود — بدون حلقه‌ی مسموم', async () => {
        await enqueueGroupOp('g1', 'save', 't1', { kind: 'task', payload: {} });
        syncBehavior = 'reject';
        const res = await flushGroup('g1');
        expect(res.ok).toBe(true);
        expect(await getPendingCount('g1')).toBe(0);
    });

    it('NET_ONLINE همه‌ی گروه‌های pending را flush می‌کند', async () => {
        await enqueueGroupOp('g1', 'save', 't1', null);
        await enqueueGroupOp('g2', 'delete', 't9', null);
        netState.online = false;
        await flushAllGroups();
        expect(await getPendingCount('g1')).toBe(1);
        netState.online = true;
        events.emit(EV.NET_ONLINE);
        await new Promise((r) => setTimeout(r, 900));
        expect(await getPendingCount('g1')).toBe(0);
        expect(await getPendingCount('g2')).toBe(0);
    });
});
