// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/connections.test.js — تست‌های چرخه‌ی اتصال و بلاک (8.2-B)

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../js/i18n.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, t: (key) => key };
});

const apiCalls = [];
vi.mock('../js/api.js', async () => ({
    apiFetch: vi.fn(async (path, opts) => {
        apiCalls.push({ path, opts });
        if (path === '/api/connections') {
            return {
                ok: true,
                data: {
                    connections: [
                        { id: 'c1', status: 'accepted', requestedBy: 'u1', otherUserId: 'u2' },
                        { id: 'c2', status: 'pending', requestedBy: 'u9', otherUserId: 'u9' },
                        { id: 'c3', status: 'pending', requestedBy: 'u1', otherUserId: 'u8' },
                    ],
                },
            };
        }
        if (path === '/api/blocks') {
            if (opts && opts.method === 'POST') {
                return { ok: true, data: { block: { id: 'b1' }, connectionClosed: true } };
            }
            return { ok: true, data: { blocks: [{ id: 'b7', blockedId: 'u5' }] } };
        }
        return { ok: true, data: {} };
    }),
    apiErrorMessage: (e) => (e && e.message) || 'err',
}));

import { state } from '../js/core.js';
import {
    getIncomingRequests,
    getOutgoingRequests,
    requestConnection,
    acceptConnection,
    rejectConnection,
    closeConnection,
    findActiveConnectionWith,
    listBlocks,
    blockUser,
    unblockUser,
    findBlockForUserId,
    searchUsers,
} from '../js/communication/connections.js';

beforeEach(() => {
    apiCalls.length = 0;
    state.sync.userId = 'u1';
});

describe('connections — requests', () => {
    it('ورودی/خروجی از هم جدا می‌شوند', async () => {
        const inc = await getIncomingRequests();
        const out = await getOutgoingRequests();
        expect(inc.requests.map((r) => r.id)).toEqual(['c2']);
        expect(out.requests.map((r) => r.id)).toEqual(['c3']);
    });

    it('request/accept/reject/close مسیر درست را صدا می‌زنند', async () => {
        await requestConnection('u9');
        await acceptConnection('c2');
        await rejectConnection('c3');
        await closeConnection('c1');
        const paths = apiCalls.map((c) => [c.path, c.opts && c.opts.method]);
        expect(paths).toContainEqual(['/api/connections/request', 'POST']);
        expect(paths).toContainEqual(['/api/connections/c2/accept', 'POST']);
        expect(paths).toContainEqual(['/api/connections/c3/reject', 'POST']);
        expect(paths).toContainEqual(['/api/connections/c1', 'DELETE']);
    });

    it('findActiveConnectionWith پیدا می‌کند', async () => {
        const res = await findActiveConnectionWith('u2');
        expect(res.connection.id).toBe('c1');
        const missing = await findActiveConnectionWith('nobody');
        expect(missing.connection).toBeNull();
    });
});

describe('connections — blocks', () => {
    it('block/unblock/list مسیر درست', async () => {
        await blockUser('u5');
        await unblockUser('b7');
        await listBlocks();
        const paths = apiCalls.map((c) => [c.path, c.opts && c.opts.method]);
        expect(paths).toContainEqual(['/api/blocks', 'POST']);
        expect(paths).toContainEqual(['/api/blocks/b7', 'DELETE']);
    });

    it('findBlockForUserId', async () => {
        const found = await findBlockForUserId('u5');
        expect(found.block.id).toBe('b7');
        const missing = await findBlockForUserId('u1');
        expect(missing.block).toBeNull();
    });
});
