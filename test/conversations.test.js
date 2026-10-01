// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/conversations.test.js — تست‌های گفتگو (8.2-A)
//
// ⚠️ api.js کاملاً mock است (بدون شبکه). نکته‌ی قراردادی:
//    لیست گفتگو preview آخرین پیام ندارد (بک‌اند ندارد).

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../js/i18n.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        t: (key) => key,
        formatDateTime: (iso) => 'T:' + iso,
    };
});

const netState = { online: true };
const mockThreadMessages = { current: null };
vi.mock('../js/store.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, saveTask: vi.fn(async () => {}) };
});
vi.mock('../js/net.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, isOnline: () => netState.online };
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
                    ],
                },
            };
        }
        if (path.startsWith('/api/messages?with=u2')) {
            if (mockThreadMessages.current) return { ok: true, data: mockThreadMessages.current };
            return {
                ok: true,
                data: {
                    messages: [
                        { id: 'm1', senderId: 'u2', recipientId: 'u1', body: 'سلام', kind: 'text', createdAt: '2026-01-01T00:00:00Z', readAt: null },
                        { id: 'm2', senderId: 'u1', recipientId: 'u2', body: 'درود', kind: 'text', createdAt: '2026-01-02T00:00:00Z', readAt: null },
                    ],
                    nextCursor: null,
                    hasMore: false,
                },
            };
        }
        if (path === '/api/messages' && opts && opts.method === 'POST') {
            return { ok: true, data: { message: { id: 'm9', ...opts.body } } };
        }
        if (path.endsWith('/read')) return { ok: true, data: { readAt: 'now' } };
        if (path.endsWith('/accept')) return { ok: true, data: { connection: { id: 'c3' } } };
        if (path.endsWith('/reject')) return { ok: true, data: { rejected: true } };
        if (path === '/api/blocks' && opts && opts.method === 'POST') {
            return { ok: true, data: { block: { id: 'b1' }, connectionClosed: true } };
        }
        if (path === '/api/blocks') return { ok: true, data: { blocks: [] } };
        if (path.startsWith('/api/search')) {
            return { ok: true, data: { users: [{ id: 'u9', username: 'newguy', displayName: null }] } };
        }
        if (path === '/api/connections/request') return { ok: true, data: { connection: { id: 'c9' } } };
        if (opts && opts.method === 'DELETE') return { ok: true, data: { deleted: true } };
        if (opts && opts.method === 'PATCH') return { ok: true, data: { message: { id: 'm1' } } };
        return { ok: false, error: { code: 'NOT_FOUND', message: 'x' } };
    }),
    apiErrorMessage: (e) => (e && e.message) || 'err',
}));

import { state } from '../js/core.js';
import {
    listConversations,
    openMessagesWorkspace,
    openConversation,
    sendCurrentText,
    deleteMessage,
    submitEdit,
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
        </div>`;
}

beforeEach(() => {
    __resetConversationsForTest();
    apiCalls.length = 0;
    netState.online = true;
    state.sync.userId = 'u1';
    buildShell();
});

describe('conversations — list', () => {
    it('فقط accepted می‌آید + unread + بدون preview', async () => {
        const res = await listConversations();
        expect(res.ok).toBe(true);
        expect(res.conversations.length).toBe(1);
        expect(res.conversations[0].user.id).toBe('u2');
        expect(res.conversations[0].unread).toBe(1);
    });

    it('رندر لیست preview آخرین پیام ندارد', async () => {
        await openMessagesWorkspace();
        expect(document.querySelector('.conv-preview')).toBeNull();
        expect(document.querySelector('.conv-row')).not.toBeNull();
    });

    it('آفلاین → حالت offline', async () => {
        netState.online = false;
        await openMessagesWorkspace();
        expect(document.querySelector('.conv-row')).toBeNull();
    });
});

describe('conversations — thread', () => {
    it('باز کردن گفتگو پیام‌ها را با مالکیت درست رندر می‌کند', async () => {
        await openMessagesWorkspace();
        await openConversation('u2');
        const st = __getStateForTest();
        expect(st.messages.length).toBe(2);
        const mines = document.querySelectorAll('.msg-mine');
        expect(mines.length).toBe(1);
        expect(mines[0].textContent).toContain('درود');
    });

    it('پیام دریافتی read می‌شود', async () => {
        await openMessagesWorkspace();
        await openConversation('u2');
        const reads = apiCalls.filter((c) => c.path === '/api/messages/m1/read');
        expect(reads.length).toBe(1);
    });

    it('ارسال متن POST می‌زند', async () => {
        await openMessagesWorkspace();
        await openConversation('u2');
        document.getElementById('convInput').value = 'سلام دوباره';
        const before = apiCalls.length;
        await sendCurrentText();
        const posts = apiCalls.slice(before).filter((c) => c.path === '/api/messages');
        expect(posts.length).toBe(1);
        expect(posts[0].opts.body).toMatchObject({ recipientId: 'u2', kind: 'text' });
    });

    it('حذف پیام خودی', async () => {
        await openMessagesWorkspace();
        await openConversation('u2');
        expect(await deleteMessage('m2')).toBe(true);
        expect(__getStateForTest().messages.find((m) => m.id === 'm2')).toBeUndefined();
    });

    it('ویرایش PATCH می‌زند', async () => {
        const res = await submitEdit('m2', 'متن تازه');
        expect(res.ok).toBe(true);
        const patch = apiCalls.find((c) => c.opts && c.opts.method === 'PATCH' && c.path === '/api/messages/m2');
        expect(patch).toBeTruthy();
    });
});

describe('conversations — badges', () => {
    it('refreshConversationBadges مجموع را به دراور می‌دهد', async () => {
        const total = await refreshConversationBadges();
        expect(total).toBe(1);
    });
});

describe('conversations — task/location cards (8.2-C)', () => {
    const taskThread = {
        messages: [
            {
                id: 'mt1', senderId: 'u2', recipientId: 'u1', kind: 'task', body: 'یک تسک',
                metadata: JSON.stringify({
                    snapshot: JSON.stringify({ text: 'خرید نان' }),
                    source_task_id: 't1',
                }),
                createdAt: '2026-01-03T00:00:00Z', readAt: null,
            },
        ],
        nextCursor: null,
        hasMore: false,
    };
    const locThread = {
        messages: [
            {
                id: 'ml1', senderId: 'u2', recipientId: 'u1', kind: 'location',
                body: '35.70000,51.40000',
                metadata: JSON.stringify({ lat: 35.7, lng: 51.4, name: 'تهران' }),
                createdAt: '2026-01-04T00:00:00Z', readAt: null,
            },
        ],
        nextCursor: null,
        hasMore: false,
    };

    it('کارت تسک با دکمه‌ی افزودن رندر می‌شود و saveTask صدا می‌زند', async () => {
        mockThreadMessages.current = taskThread;
        try {
            await openMessagesWorkspace();
            await openConversation('u2');
            const card = document.querySelector('.msg-task-card');
            expect(card).not.toBeNull();
            expect(card.textContent).toContain('خرید نان');
            const { saveTask } = await import('../js/store.js');
            card.querySelector('.msg-task-add').click();
            await new Promise((r) => setTimeout(r, 20));
            expect(saveTask).toHaveBeenCalled();
            const saved = saveTask.mock.calls[0][0];
            expect(saved.text).toBe('خرید نان');
        } finally {
            mockThreadMessages.current = null;
        }
    });

    it('کارت مکان با preview و دکمه‌ی مسیر رندر می‌شود (بدون Leaflet)', async () => {
        expect(window.L).toBeUndefined();
        mockThreadMessages.current = locThread;
        try {
            await openMessagesWorkspace();
            await openConversation('u2');
            const card = document.querySelector('.msg-loc-card');
            expect(card).not.toBeNull();
            expect(card.textContent).toContain('تهران');
            const pv = card.querySelector('.loc-preview');
            expect(pv.dataset.lat).toBe('35.7');
            card.querySelector('.msg-loc-route').click();
            expect(document.getElementById('locModalOverlay')).not.toBeNull();
            document.querySelector('#locModalOverlay .btn-clear').click();
            expect(document.getElementById('locModalOverlay')).toBeNull();
        } finally {
            mockThreadMessages.current = null;
        }
    });

    it('metadata خراب، پیام را نمی‌شکند', async () => {
        mockThreadMessages.current = {
            messages: [{
                id: 'mx', senderId: 'u2', recipientId: 'u1', kind: 'task',
                body: 'متن جایگزین', metadata: 'not-json{{{',
                createdAt: '2026-01-05T00:00:00Z', readAt: null,
            }],
            nextCursor: null, hasMore: false,
        };
        try {
            await openMessagesWorkspace();
            await openConversation('u2');
            expect(document.querySelector('.msg-task-card')).not.toBeNull();
        } finally {
            mockThreadMessages.current = null;
        }
    });
});

describe('conversations — requests (8.2-B)', () => {
    it('درخواست ورودی نمایش داده می‌شود (خروجی نه)', async () => {
        await openMessagesWorkspace();
        const section = document.querySelector('.conv-request');
        expect(section).not.toBeNull();
        expect(section.textContent).toContain('رضا');
        expect(section.textContent).not.toContain('pending-user');
    });

    it('قبول درخواست POST می‌زند', async () => {
        await openMessagesWorkspace();
        const before = apiCalls.length;
        const acceptBtn = [...document.querySelectorAll('.conv-request .conv-mini-btn')]
            .find((b) => b.textContent === 'قبول');
        acceptBtn.click();
        await new Promise((r) => setTimeout(r, 20));
        const calls = apiCalls.slice(before).filter((c) => c.path === '/api/connections/c3/accept');
        expect(calls.length).toBe(1);
    });
});

describe('conversations — thread menu + search (8.2-B)', () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    it('منوی ⋯ گفتگو پروفایل/بلاک/بستن دارد', async () => {
        await openMessagesWorkspace();
        await openConversation('u2');
        document.querySelector('.conv-menu-btn').click();
        await sleep(20);
        const ids = [...document.querySelectorAll('[data-menu-id]')].map((b) => b.dataset.menuId);
        expect(ids).toEqual(['profile', 'block', 'close']);
    });

    it('بلاک از منو POST می‌زند', async () => {
        await openMessagesWorkspace();
        await openConversation('u2');
        document.querySelector('.conv-menu-btn').click();
        await sleep(20);
        document.querySelector('[data-menu-id="block"]').click();
        await sleep(20);
        const calls = apiCalls.filter((c) => c.path === '/api/blocks' && c.opts && c.opts.method === 'POST');
        expect(calls.length).toBe(1);
        expect(calls[0].opts.body).toMatchObject({ targetUserId: 'u2' });
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
