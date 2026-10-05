// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/conversations.test.js — تست‌های لایه‌ی داده‌ی مخاطبان (تک‌صفحه)
//
// ⚠️ api.js کاملاً mock است (بدون شبکه).
//    منبع نخوانده‌ها /api/dm/unread است؛ نمای قدیمی حذف شده است.

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../js/i18n.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        t: (key, params) => (params && params.name ? `${key}:${params.name}` : key),
        formatDateTime: (iso) => 'T:' + iso,
    };
});

const netState = { online: true };
vi.mock('../js/net.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, isOnline: () => netState.online };
});

const apiCalls = [];
const CONNS = [
    {
        id: 'c1', status: 'accepted',
        otherUserId: 'u2',
        otherUser: { id: 'u2', username: 'sara', displayName: 'سارا' },
    },
    {
        id: 'c2', status: 'pending', requestedBy: 'u1',
        otherUserId: 'u3',
        otherUser: { id: 'u3', username: 'pending-user' },
    },
    {
        id: 'c3', status: 'pending', requestedBy: 'u4',
        otherUserId: 'u4',
        otherUser: { id: 'u4', username: 'reza', displayName: 'رضا' },
    },
];
vi.mock('../js/api.js', async () => ({
    apiFetch: vi.fn(async (path, opts) => {
        apiCalls.push({ path, opts });
        if (path === '/api/connections') {
            return { ok: true, data: { connections: CONNS } };
        }
        if (path === '/api/dm/unread') {
            return { ok: true, data: { unread: { total: 1, byPeer: [{ peerId: 'u2', count: 1 }] } } };
        }
        if (path === '/api/blocks' && opts && opts.method === 'POST') {
            return { ok: true, data: { block: { id: 'b1' }, connectionClosed: true } };
        }
        if (path === '/api/blocks') return { ok: true, data: { blocks: [] } };
        if (opts && opts.method === 'DELETE') return { ok: true, data: { deleted: true } };
        return { ok: false, error: { code: 'NOT_FOUND', message: 'x' } };
    }),
    apiErrorMessage: (e) => (e && e.message) || 'err',
}));

import { state } from '../js/core.js';
import {
    listConversations,
    refreshConversationBadges,
    refreshIncomingRequests,
    openConversationMenuFor,
    pushRecentConversations,
    __resetConversationsForTest,
    __getStateForTest,
} from '../js/communication/conversations.js';
import { __resetSidebarForTest } from '../js/navigation/sidebar.js';

function buildShell() {
    document.body.innerHTML = `
        <div class="drawer-root" id="drawerRoot" hidden>
            <aside class="drawer" id="drawer"></aside>
        </div>`;
}

beforeEach(() => {
    __resetConversationsForTest();
    __resetSidebarForTest();
    apiCalls.length = 0;
    netState.online = true;
    state.sync.userId = 'u1';
    buildShell();
});

describe('conversations — list (DM unread)', () => {
    it('فقط accepted می‌آید + unread از /api/dm/unread', async () => {
        const res = await listConversations();
        expect(res.ok).toBe(true);
        expect(res.conversations.length).toBe(1);
        expect(res.conversations[0].user.id).toBe('u2');
        expect(res.conversations[0].unread).toBe(1);
        expect(apiCalls.some((c) => c.path === '/api/dm/unread')).toBe(true);
    });
});

describe('conversations — incoming requests', () => {
    it('درخواست ورودی (نه خروجی) برمی‌گردد', async () => {
        const rows = await refreshIncomingRequests();
        expect(rows.length).toBe(1);
        expect(rows[0]).toMatchObject({ id: 'c3', userId: 'u4', name: 'رضا' });
    });
});

describe('conversations — badges', () => {
    it('refreshConversationBadges مجموع DM را می‌دهد', async () => {
        const total = await refreshConversationBadges();
        expect(total).toBe(1);
    });

    it('pushRecentConversations ردیف‌های دراور را می‌سازد', async () => {
        await listConversations();
        pushRecentConversations();
        expect(__getStateForTest().conversations.length).toBe(1);
    });
});

describe('conversations — thread menu', () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    it('منوی ⋯ مخاطب پروفایل/بلاک/بستن دارد', async () => {
        await listConversations();
        const anchor = document.createElement('button');
        document.body.appendChild(anchor);
        openConversationMenuFor('u2', anchor);
        await sleep(20);
        const ids = [...document.querySelectorAll('[data-menu-id]')].map((b) => b.dataset.menuId);
        expect(ids).toEqual(['profile', 'block', 'close']);
    });

    it('بلاک از منو POST می‌زند و لیست تازه می‌شود', async () => {
        await listConversations();
        const anchor = document.createElement('button');
        document.body.appendChild(anchor);
        openConversationMenuFor('u2', anchor);
        await sleep(20);
        document.querySelector('[data-menu-id="block"]').click();
        await sleep(20);
        const calls = apiCalls.filter((c) => c.path === '/api/blocks' && c.opts && c.opts.method === 'POST');
        expect(calls.length).toBe(1);
        expect(calls[0].opts.body).toMatchObject({ targetUserId: 'u2' });
    });
});
