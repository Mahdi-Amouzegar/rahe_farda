// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/groups.test.js — تست‌های فضای گروه (8.3-A)

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
        if (path === '/api/groups') {
            return {
                ok: true,
                data: {
                    groups: [
                        { id: 'g1', name: 'سفر', ownerId: 'u1' },
                        { id: 'g2', name: 'خانواده', ownerId: 'u9' },
                    ],
                },
            };
        }
        if (path === '/api/groups/g1') {
            return { ok: true, data: { group: { id: 'g1', name: 'سفر', ownerId: 'u1' }, myRole: 'member' } };
        }
        if (path.startsWith('/api/groups/g1/timeline')) {
            return {
                ok: true,
                data: {
                    items: [
                        { id: 'gm1', entityType: 'message', actorId: 'u1', body: 'سلام گروه', kind: 'text', metadata: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
                        { id: 'gt1', entityType: 'group_task', actorId: 'u1', body: JSON.stringify({ text: 'بلیت' }), kind: 'task', metadata: null, createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' },
                    ],
                    nextCursor: null,
                },
            };
        }
        if (path === '/api/groups/g1/members') {
            return {
                ok: true,
                data: {
                    members: [
                        { id: 'm1', groupId: 'g1', userId: 'u1', role: 'owner', status: 'active', username: 'ali' },
                        { id: 'm2', groupId: 'g1', userId: 'u2', role: 'member', status: 'active', username: 'sara' },
                    ],
                },
            };
        }
        if (path === '/api/groups/g1/messages' && opts && opts.method === 'POST') {
            return { ok: true, data: { message: { id: 'gm9' }, changeSeq: 9 } };
        }
        return { ok: false, error: { code: 'NOT_FOUND', message: 'x' } };
    }),
    apiErrorMessage: (e) => (e && e.message) || 'err',
}));

import {
    listGroups,
    openGroupsWorkspace,
    openGroup,
    sendGroupText,
    loadMoreTimeline,
    __resetGroupsForTest,
    __getGroupsStateForTest,
} from '../js/communication/groups.js';

function buildShell() {
    document.body.innerHTML = `
        <div class="workspace-root" id="workspaceRoot">
            <section id="ws-groups"></section>
        </div>`;
}

beforeEach(() => {
    __resetGroupsForTest();
    apiCalls.length = 0;
    netState.online = true;
    buildShell();
});

describe('groups — list (8.3-A)', () => {
    it('لیست گروه‌ها رندر می‌شود', async () => {
        const res = await listGroups();
        expect(res.ok).toBe(true);
        expect(res.groups.length).toBe(2);
        await openGroupsWorkspace();
        expect(document.querySelectorAll('.conv-row').length).toBe(2);
    });

    it('آفلاین → حالت offline', async () => {
        netState.online = false;
        await openGroupsWorkspace();
        expect(document.querySelector('.conv-row')).toBeNull();
    });
});

describe('groups — workspace (8.3-A)', () => {
    it('باز کردن گروه: هدر + تایم‌لاین + کامپوزر', async () => {
        await openGroupsWorkspace();
        await openGroup('g1');
        const st = __getGroupsStateForTest();
        expect(st.items.length).toBe(2);
        expect(document.querySelector('.conv-title').textContent).toContain('سفر');
        expect(document.getElementById('grpInput')).not.toBeNull();
    });

    it('تسک تایم‌لاین فقط خواندنی است (بدون دکمه‌ی ویرایش)', async () => {
        await openGroupsWorkspace();
        await openGroup('g1');
        const card = document.querySelector('.msg-task-card');
        expect(card).not.toBeNull();
        expect(card.textContent).toContain('بلیت');
        expect(card.querySelector('.msg-task-add')).toBeNull();
    });

    it('ارسال پیام متنی POST می‌زند', async () => {
        await openGroupsWorkspace();
        await openGroup('g1');
        document.getElementById('grpInput').value = 'سلام';
        await sendGroupText();
        const posts = apiCalls.filter((c) => c.path === '/api/groups/g1/messages');
        expect(posts.length).toBe(1);
        expect(posts[0].opts.body).toMatchObject({ body: 'سلام', kind: 'text' });
    });

    it('نمای اعضا فقط خواندنی با نقش‌هاست', async () => {
        await openGroupsWorkspace();
        await openGroup('g1');
        document.querySelector('.conv-menu-btn').click();
        await new Promise((r) => setTimeout(r, 10));
        document.querySelector('[data-menu-id]').click();
        expect(document.querySelector('.conv-role')).not.toBeNull();
        expect(__getGroupsStateForTest().view).toBe('members');
    });
});
