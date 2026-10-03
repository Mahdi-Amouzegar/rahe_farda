// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/conversations.test.js — تست‌های فضای پیام روی تسک DM (Phase 9 قدم ۲)
//
// ⚠️ api.js کاملاً mock است (بدون شبکه).
//    منبع نخوانده‌ها /api/dm/unread است؛ thread از /api/dm/tasks می‌آید.

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
const DM_TASKS = [
    {
        id: 'd1', creatorId: 'u2', peerId: 'u1', kind: 'task',
        payload: JSON.stringify({ title: 'خرید نان' }),
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', revision: 1,
    },
    {
        id: 'd2', creatorId: 'u1', peerId: 'u2', kind: 'task',
        payload: JSON.stringify({ title: 'چای هم بگیر' }),
        createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z', revision: 1,
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
        if (path === '/api/dm/read') {
            return { ok: true, data: { read: true } };
        }
        if (path.startsWith('/api/dm/tasks?peer=')) {
            return { ok: true, data: { tasks: DM_TASKS } };
        }
        if (path === '/api/dm/tasks' && opts && opts.method === 'POST') {
            return { ok: true, data: { task: { id: 'd9', ...opts.body } } };
        }
        if (path.startsWith('/api/dm/tasks/') && opts && opts.method === 'PATCH') {
            return { ok: true, data: { updated: true, revision: 2 } };
        }
        if (path.startsWith('/api/dm/tasks/') && opts && opts.method === 'DELETE') {
            return { ok: true, data: { deleted: true } };
        }
        if (path.startsWith('/api/search')) {
            return { ok: true, data: { users: [{ id: 'u9', username: 'newguy', displayName: null }] } };
        }
        if (path === '/api/connections/request') return { ok: true, data: { connection: { id: 'c9' } } };
        if (opts && opts.method === 'DELETE') return { ok: true, data: { deleted: true } };
        if (opts && opts.method === 'PATCH') return { ok: true, data: { updated: true } };
        if (path.endsWith('/accept')) return { ok: true, data: { connection: { id: 'c3' } } };
        if (path.endsWith('/reject')) return { ok: true, data: { rejected: true } };
        if (path === '/api/blocks' && opts && opts.method === 'POST') {
            return { ok: true, data: { block: { id: 'b1' }, connectionClosed: true } };
        }
        if (path === '/api/blocks') return { ok: true, data: { blocks: [] } };
        return { ok: false, error: { code: 'NOT_FOUND', message: 'x' } };
    }),
    apiErrorMessage: (e) => (e && e.message) || 'err',
}));

import { state } from '../js/core.js';
import {
    listConversations,
    openMessagesWorkspace,
    openConversation,
    submitDmTask,
    removeDmTask,
    refreshConversationBadges,
    __resetConversationsForTest,
    __getStateForTest,
} from '../js/communication/conversations.js';

function buildShell() {
    document.body.innerHTML = `
        <div class="drawer-root" id="drawerRoot" hidden>
            <aside class="drawer" id="drawer"></aside>
        </div>
        <div class="workspace-root" id="workspaceRoot">
            <section id="ws-messages"></section>
        </div>
        <div class="photo-snackbar" id="photoSnackbar" role="status" aria-live="polite">
            <div class="photo-snackbar-content">
                <div class="photo-snackbar-msg" id="photoSnackbarMsg"></div>
            </div>
        </div>`;
}

beforeEach(() => {
    __resetConversationsForTest();
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
        expect(apiCalls.some((c) => c.path.startsWith('/api/messages'))).toBe(false);
    });

    it('آفلاین → حالت offline', async () => {
        netState.online = false;
        await openMessagesWorkspace();
        expect(document.querySelector('.conv-row')).toBeNull();
    });
});

describe('conversations — DM thread', () => {
    it('تسک‌ها دوحالته با سمت درست رندر می‌شوند', async () => {
        await openMessagesWorkspace();
        await openConversation('u2');
        const st = __getStateForTest();
        expect(st.dmTasks.length).toBe(2);
        expect(document.querySelectorAll('.msg-mine').length).toBe(1);
        expect(document.querySelectorAll('.msg-other').length).toBe(1);
        expect(document.body.textContent).toContain('خرید نان');
        expect(document.body.textContent).toContain('چای هم بگیر');
    });

    it('باز کردن گفتگو read را ثبت می‌کند', async () => {
        await openMessagesWorkspace();
        await openConversation('u2');
        const reads = apiCalls.filter((c) => c.path === '/api/dm/read');
        expect(reads.length).toBe(1);
        expect(reads[0].opts.body).toMatchObject({ peerId: 'u2' });
    });

    it('کامپوزر تسک POST می‌زند (بدون دکمه‌ی مکان مستقل)', async () => {
        await openMessagesWorkspace();
        await openConversation('u2');
        expect(document.querySelector('.conv-loc')).toBeNull();
        document.getElementById('dmTaskInput').value = 'تسک تازه';
        const before = apiCalls.length;
        await submitDmTask();
        const posts = apiCalls.slice(before).filter((c) => c.path === '/api/dm/tasks');
        expect(posts.length).toBe(1);
        expect(posts[0].opts.body).toMatchObject({ peerId: 'u2', kind: 'task' });
    });

    it('⋯ فقط روی تسک خودی است؛ حذف تسک خودی', async () => {
        await openMessagesWorkspace();
        await openConversation('u2');
        expect(document.querySelectorAll('.msg-more').length).toBe(1);
        expect(await removeDmTask('d2')).toBe(true);
        expect(__getStateForTest().dmTasks.find((t) => t.id === 'd2')).toBeUndefined();
    });
});

describe('conversations — badges', () => {
    it('refreshConversationBadges مجموع DM را می‌دهد', async () => {
        const total = await refreshConversationBadges();
        expect(total).toBe(1);
    });
});

describe('conversations — requests (8.2-B, بدون تغییر)', () => {
    it('درخواست ورودی نمایش داده می‌شود (خروجی نه)', async () => {
        await openMessagesWorkspace();
        const section = document.querySelector('.conv-request');
        expect(section).not.toBeNull();
        expect(section.textContent).toContain('رضا');
        expect(section.textContent).not.toContain('pending-user');
    });
});

describe('conversations — thread menu + search (8.2-B, بدون تغییر)', () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    it('منوی ⋯ گفتگو پروفایل/بلاک/بستن دارد', async () => {
        await openMessagesWorkspace();
        await openConversation('u2');
        document.querySelector('.conv-menu-btn').click();
        await sleep(20);
        const ids = [...document.querySelectorAll('[data-menu-id]')].map((b) => b.dataset.menuId);
        expect(ids).toEqual(['profile', 'block', 'close']);
    });

    it('جستجو و درخواست گفتگوی تازه', async () => {
        await openMessagesWorkspace();
        document.querySelector('.conv-new > .conv-mini-btn').click();
        const input = document.querySelector('.conv-search input');
        input.value = 'new';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(450);
        const reqBtn = [...document.querySelectorAll('.conv-search-results .conv-mini-btn')]
            .find((b) => b.textContent === 'درخواست');
        expect(reqBtn).toBeTruthy();
        reqBtn.click();
        await sleep(20);
        const calls = apiCalls.filter((c) => c.path === '/api/connections/request');
        expect(calls.length).toBe(1);
    }, 10000);
});
