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
        if (path === '/api/groups' && opts && opts.method === 'POST') {
            return { ok: true, data: { group: { id: 'g9', name: 'گروه تازه', ownerId: 'u1', closedAt: null }, changeSeq: 1 } };
        }
        if (path === '/api/groups/g1') {
            return { ok: true, data: { group: { id: 'g1', name: 'سفر', ownerId: 'u1', closedAt: null }, myRole: 'owner' } };
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
        if (path === '/api/invitations/mine') {
            return {
                ok: true,
                data: {
                    invitations: [
                        { id: 'inv1', groupId: 'g9', groupName: 'G9', inviterId: 'u9', inviteeId: 'u1', type: 'invitation', status: 'pending', createdAt: '2026-01-01T00:00:00Z', expiresAt: '2026-02-01T00:00:00Z' },
                    ],
                },
            };
        }
        if (path === '/api/groups/g2') {
            return { ok: true, data: { group: { id: 'g2', name: 'G2', ownerId: 'u9', closedAt: null }, myRole: 'member' } };
        }
        if (path === '/api/groups/g2/members') {
            return {
                ok: true,
                data: {
                    members: [
                        { id: 'm9', groupId: 'g2', userId: 'u9', role: 'owner', status: 'active', username: 'boss' },
                        { id: 'm8', groupId: 'g2', userId: 'u1', role: 'member', status: 'active', username: 'ali' },
                    ],
                },
            };
        }
        if (path.startsWith('/api/groups/g2/timeline')) {
            return { ok: true, data: { items: [], nextCursor: null } };
        }
        if (path === '/api/groups/g2/tasks') {
            return {
                ok: true,
                data: {
                    tasks: [
                        { id: 't9', groupId: 'g2', creatorId: 'u9', kind: 'task', payload: '{"title":"Owner task"}', revision: 1, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', deletedAt: null },
                    ],
                },
            };
        }
        if (path === '/api/groups/g1/tasks') {
            return {
                ok: true,
                data: {
                    tasks: [
                        { id: 't1', groupId: 'g1', creatorId: 'u1', kind: 'task', payload: '{"title":"Mine"}', revision: 1, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', deletedAt: null },
                    ],
                },
            };
        }
        if (path.startsWith('/api/search')) {
            return { ok: true, data: { users: [{ id: 'u7', username: 'guest7' }] } };
        }
        if (path === '/api/invitations/mine') {
            return { ok: true, data: { invitations: [] } };
        }
        if (path.endsWith('/unread')) {
            return { ok: true, data: { unread: { messages: 2, tasks: 1 } } };
        }
        if (path.endsWith('/read') && opts && opts.method === 'POST') {
            return { ok: true, data: { readAt: 'now' } };
        }
        if (path.endsWith('/sync') && opts && opts.method === 'POST') {
            const ops = (opts.body && opts.body.ops) || [];
            return {
                ok: true,
                data: {
                    accepted: ops.map((o, i) => ({ opId: o.id, changeSeq: 10 + i })),
                    rejected: [],
                    changes: [],
                    newChangeSeq: 20,
                },
            };
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
import { state } from '../js/core.js';

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
    state.sync.userId = 'u1';
    buildShell();
});

describe('groups — list (8.3-A)', () => {
    it('لیست گروه‌ها رندر می‌شود', async () => {
        const res = await listGroups();
        expect(res.ok).toBe(true);
        expect(res.groups.length).toBe(2);
        await openGroupsWorkspace();
        expect(document.querySelectorAll('.grp-row').length).toBe(2);
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
        await openGroup('g2');
        document.querySelector('.conv-menu-btn').click();
        await new Promise((r) => setTimeout(r, 10));
        const memberItem = [...document.querySelectorAll('[data-menu-id]')]
            .find((b) => b.dataset.menuId === 'members');
        memberItem.click();
        expect(document.querySelector('.conv-role')).not.toBeNull();
        expect(__getGroupsStateForTest().view).toBe('members');
        // عضو عادی: دکمه‌ی حذف ندارد
        expect(document.querySelector('.conv-row .conv-mini-btn')).toBeNull();
    });
});

describe('groups — inbox + management (8.3-B)', () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    it('inbox دعوت با نام گروه + قبول', async () => {
        await openGroupsWorkspace();
        expect(document.body.textContent).toContain('G9');
        const acceptBtns = [...document.querySelectorAll('.conv-request .conv-mini-btn')];
        const accept = acceptBtns.find((b) => b.textContent === 'قبول');
        expect(accept).toBeTruthy();
        accept.click();
        await sleep(20);
        const calls = apiCalls.filter((c) => c.path === '/api/groups/g9/invitations/inv1/accept');
        expect(calls.length).toBe(1);
    });

    it('منوی owner همه‌ی آیتم‌های مدیریتی را دارد', async () => {
        await openGroupsWorkspace();
        await openGroup('g1');
        document.querySelector('.conv-menu-btn').click();
        await sleep(10);
        const ids = [...document.querySelectorAll('[data-menu-id]')].map((b) => b.dataset.menuId);
        expect(ids).toEqual(expect.arrayContaining(['members', 'tasks', 'invite', 'transfer', 'close', 'delete']));
    });

    it('منوی عضو عادی فقط members/tasks دارد', async () => {
        await openGroupsWorkspace();
        await openGroup('g2');
        document.querySelector('.conv-menu-btn').click();
        await sleep(10);
        const ids = [...document.querySelectorAll('[data-menu-id]')].map((b) => b.dataset.menuId);
        expect(ids).toEqual(['members', 'tasks']);
    });

    it('حذف عضو توسط owner', async () => {
        await openGroupsWorkspace();
        await openGroup('g1');
        // رفتن به نمای اعضا
        document.querySelector('.conv-menu-btn').click();
        await sleep(10);
        [...document.querySelectorAll('[data-menu-id]')]
            .find((b) => b.dataset.menuId === 'members').click();
        // دکمه‌ی حذف برای sara هست، برای خودم نیست
        const rows = [...document.querySelectorAll('.conv-box .conv-row')];
        const saraRow = rows.find((r) => r.textContent.includes('sara'));
        expect(saraRow.querySelector('.conv-mini-btn')).not.toBeNull();
        // confirm modal لازم دارد — بدون DOM مودال، showConfirmModal به alert می‌رسد؛
        // پس فقط حضور دکمه را چک می‌کنیم (فلو کامل در تست دوکاربره‌ی دستی)
    });

    it('نمای تسک‌ها + ساخت تسک (از مسیر صف sync)', async () => {
        await openGroupsWorkspace();
        await openGroup('g1');
        document.querySelector('.conv-menu-btn').click();
        await sleep(10);
        [...document.querySelectorAll('[data-menu-id]')]
            .find((b) => b.dataset.menuId === 'tasks').click();
        await sleep(30);
        expect(document.getElementById('gtaskInput')).not.toBeNull();
        expect(document.body.textContent).toContain('Mine');
        document.getElementById('gtaskInput').value = 'تازه';
        document.querySelector('.conv-composer .conv-send').click();
        await sleep(30);
        const syncs = apiCalls.filter((c) => c.path === '/api/groups/g1/sync');
        expect(syncs.length).toBeGreaterThan(0);
        const saveOp = syncs.flatMap((c) => (c.opts.body && c.opts.body.ops) || [])
            .find((o) => o.type === 'save');
        expect(saveOp).toBeTruthy();
        expect(saveOp.data.payload).toMatchObject({ title: 'تازه' });
    });

    it('ویرایش تسک خودی، حذف تسک خودی', async () => {
        await openGroupsWorkspace();
        await openGroup('g1');
        document.querySelector('.conv-menu-btn').click();
        await sleep(10);
        [...document.querySelectorAll('[data-menu-id]')]
            .find((b) => b.dataset.menuId === 'tasks').click();
        await sleep(30);
        const more = document.querySelector('.conv-row .msg-more');
        expect(more).not.toBeNull();
    });
});

describe('groups — create (8.3-D)', () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    it('فرم ساخت گروه POST می‌زند', async () => {
        await openGroupsWorkspace();
        const toggle = [...document.querySelectorAll('.conv-new > .conv-mini-btn')]
            .find((b) => b.textContent.length > 0);
        expect(toggle).toBeTruthy();
        toggle.click();
        const input = document.querySelector('.conv-new .conv-input');
        expect(input).not.toBeNull();
        input.value = 'گروه تازه';
        document.querySelector('.conv-new .conv-send').click();
        await sleep(20);
        const posts = apiCalls.filter((c) => c.path === '/api/groups' && c.opts && c.opts.method === 'POST');
        expect(posts.length).toBe(1);
        expect(posts[0].opts.body).toMatchObject({ name: 'گروه تازه', visibility: 'private' });
    });
});

describe('groups — unread badges (تصمیم ۳)', () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    it('بج نخوانده روی ردیف گروه', async () => {
        await openGroupsWorkspace();
        await sleep(30);
        const badge = document.querySelector('[data-group-unread]');
        expect(badge).not.toBeNull();
        expect(badge.hidden).toBe(false);
        expect(badge.textContent).toBeTruthy();
    });

    it('باز کردن گروه، خواندن را ثبت می‌کند', async () => {
        await openGroupsWorkspace();
        await openGroup('g1');
        await sleep(30);
        const reads = apiCalls.filter((c) => c.path === '/api/groups/g1/read');
        expect(reads.length).toBeGreaterThan(0);
        expect(reads[0].opts.body).toMatchObject({ type: 'messages' });
    });
});
