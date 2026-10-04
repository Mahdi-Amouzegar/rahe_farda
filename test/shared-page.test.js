// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/shared-page.test.js -- تک‌صفحه: مقصد + لیست مشترک + مسیریابی کامپوزر

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../js/i18n.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        t: (key, params) => (params && params.name ? `${key}:${params.name}` : key),
        formatDateTime: (iso) => 'T:' + iso,
        formatNumber: (n) => String(n),
        formatPercent: (n) => String(n) + '%',
    };
});

vi.mock('../js/net.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, isOnline: () => true };
});

const apiCalls = [];
vi.mock('../js/api.js', async () => ({
    apiFetch: vi.fn(async (path, opts) => {
        apiCalls.push({ path, opts });
        if (path.startsWith('/api/dm/tasks?peer=')) {
            return {
                ok: true,
                data: {
                    tasks: [
                        {
                            id: 'd1', creatorId: 'u2', peerId: 'u1', kind: 'task',
                            payload: JSON.stringify({ title: 'از سارا', priority: 'high' }),
                            createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
                        },
                        {
                            id: 'd2', creatorId: 'u1', peerId: 'u2', kind: 'task',
                            payload: JSON.stringify({ title: 'از من' }),
                            createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
                        },
                    ],
                },
            };
        }
        if (path === '/api/dm/tasks' && opts && opts.method === 'POST') {
            return { ok: true, data: { task: { id: 'd9' } } };
        }
        if (path === '/api/dm/read') return { ok: true, data: { read: true } };
        if (path === '/api/dm/unread') {
            return { ok: true, data: { unread: { total: 0, byPeer: [] } } };
        }
        if (path === '/api/groups/g1/tasks') {
            return {
                ok: true,
                data: {
                    tasks: [
                        {
                            id: 't1', groupId: 'g1', creatorId: 'u2', kind: 'task',
                            payload: JSON.stringify({ title: 'کار گروه' }),
                            createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
                        },
                    ],
                },
            };
        }
        if (path === '/api/groups/g1/members') {
            return {
                ok: true,
                data: {
                    members: [
                        { userId: 'u1', username: 'ali' },
                        { userId: 'u2', username: 'sara', displayName: 'سارا' },
                    ],
                },
            };
        }
        if (path === '/api/groups/g1/read') return { ok: true, data: { read: true } };
        return { ok: false, error: { code: 'NOT_FOUND', message: 'x' } };
    }),
    apiErrorMessage: (e) => (e && e.message) || 'err',
}));

const queueCalls = [];
vi.mock('../js/communication/group-queue.js', async () => ({
    enqueueGroupOp: vi.fn(async (...args) => {
        queueCalls.push(args);
        return { ok: true };
    }),
    flushGroup: vi.fn(async () => ({ ok: true, flushed: 0 })),
    getPendingCount: vi.fn(async () => 0),
}));

import { state } from '../js/core.js';
import { getDestination, setDestination, __resetDestinationForTest } from '../js/tasks/destination.js';
import {
    getSharedItems,
    getSharedRole,
    refreshSharedList,
    __resetSharedForTest,
} from '../js/tasks/source.js';
import { selectDestination, resetToLocal, submitTask } from '../js/tasks/composer.js';

function buildComposerShell() {
    document.body.innerHTML = `
        <input type="text" id="taskInput" maxlength="200">
        <select id="prioritySelect">
            <option value="low">low</option>
            <option value="medium" selected>medium</option>
            <option value="high">high</option>
        </select>
        <input type="text" id="descInput" maxlength="200">
        <div id="seriesError"></div>
        <div class="task-list" id="taskList"></div>
        <div id="taskListStatus"></div>
        <div id="dueChips" hidden></div>
        <div class="loc-chip" id="locChip" hidden><span id="locChipText"></span></div>
        <div id="planKidsWrap" hidden><div id="planKidChips"></div></div>`;
}

beforeEach(() => {
    __resetDestinationForTest();
    __resetSharedForTest();
    apiCalls.length = 0;
    queueCalls.length = 0;
    state.sync.userId = 'u1';
    state.tasks = [];
    state.pendingKind = 'task';
    state.addDraftSessions = [];
    state.planDraftKids = [];
    state.seriesType = 'daily';
    state.pendingLoc = null;
    buildComposerShell();
});

describe('shared page — destination', () => {
    it('پیش‌فرض محلی است و انتخاب مخاطب مقصد را ست می‌کند', async () => {
        expect(getDestination()).toEqual({ type: 'local' });
        const norm = await selectDestination({ type: 'peer', peerId: 'u2', name: 'سارا' });
        expect(norm.type).toBe('peer');
        expect(getDestination().peerId).toBe('u2');
    });

    it('resetToLocal برمی‌گرداند و لیست را خالی می‌کند', async () => {
        await selectDestination({ type: 'peer', peerId: 'u2', name: 'سارا' });
        expect(getSharedItems().length).toBe(2);
        await resetToLocal();
        expect(getDestination()).toEqual({ type: 'local' });
        expect(getSharedItems()).toEqual([]);
    });
});

describe('shared page — peer list', () => {
    it('آیتم‌ها به شکل محلی نرمال می‌شوند (مال من/مخاطب)', async () => {
        await selectDestination({ type: 'peer', peerId: 'u2', name: 'سارا' });
        const items = getSharedItems();
        expect(items.length).toBe(2);
        expect(getSharedRole('d1')).toEqual({ mine: false });
        expect(getSharedRole('d2')).toEqual({ mine: true });
        expect(getSharedRole('nope')).toBeNull();
        const other = items.find((t) => t.id === 'd1');
        expect(other.text).toBe('از سارا');
        expect(other._shared.senderName).toBe('سارا');
    });
});

describe('shared page — group list', () => {
    it('نام فرستنده از اعضا می‌آید', async () => {
        await selectDestination({ type: 'group', groupId: 'g1', name: 'سفر' });
        const items = getSharedItems();
        expect(items.length).toBe(1);
        expect(items[0]._shared.senderName).toBe('سارا');
        expect(getSharedRole('t1')).toEqual({ mine: false });
    });
});

describe('shared page — composer routing', () => {
    it('مقصد مخاطب: POST کامل به /api/dm/tasks', async () => {
        await selectDestination({ type: 'peer', peerId: 'u2', name: 'سارا' });
        apiCalls.length = 0;
        document.getElementById('taskInput').value = 'سلام سارا';
        await submitTask('task');
        const posts = apiCalls.filter((c) => c.path === '/api/dm/tasks' && c.opts && c.opts.method === 'POST');
        expect(posts.length).toBe(1);
        expect(posts[0].opts.body.peerId).toBe('u2');
        expect(posts[0].opts.body.payload.text).toBe('سلام سارا');
    });

    it('مقصد گروه: enqueue + flush (بدون POST مستقیم)', async () => {
        const { enqueueGroupOp } = await import('../js/communication/group-queue.js');
        await selectDestination({ type: 'group', groupId: 'g1', name: 'سفر' });
        queueCalls.length = 0;
        document.getElementById('taskInput').value = 'کار گروهی';
        await submitTask('task');
        expect(enqueueGroupOp).toHaveBeenCalled();
        const call = queueCalls[0];
        expect(call[0]).toBe('g1');
        expect(call[1]).toBe('save');
        expect(call[3].payload.text).toBe('کار گروهی');
    });
});
