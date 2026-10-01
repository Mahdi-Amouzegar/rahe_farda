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
                            id: 'c2', status: 'pending',
                            otherUserId: 'u3',
                            otherUser: { id: 'u3', username: 'pending-user' },
                        },
                    ],
                },
            };
        }
        if (path.startsWith('/api/messages?with=u2')) {
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
