// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/groups.test.js — تست‌های فضای گروه روی مدل تسک واحد (Phase 9 قدم ۳)

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
                        { id: 'gt1', entityType: 'group_task', actorId: 'u2', body: JSON.stringify({ title: 'بلیت' }), kind: 'task', metadata: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
                        { id: 'gt2', entityType: 'group_task', actorId: 'u1', body: JSON.stringify({ title: 'هتل' }), kind: 'task', metadata: null, createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' },
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
                        { id: 'm1', groupId: 'g1', userId: 'u1', role: 'owner', status: 'active', username: 'ali', avatarUrl: null },
                        { id: 'm2', groupId: 'g1', userId: 'u2', role: 'member', status: 'active', username: 'sara', avatarUrl: null },
                    ],
                },
            };
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
            return {
                ok: true,
                data: {
                    items: [
                        { id: 'gt9', entityType: 'group_task', actorId: 'u9', body: JSON.stringify({ title: 'کار مدیر' }), kind: 'task', metadata: null, createdAt: '2026-01-03T00:00:00Z', updatedAt: '2026-01-03T00:00:00Z' },
                    ],
                    nextCursor: null,
                },
            };
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
        if (path.endsWith('/unread')) {
            return { ok: true, data: { unread: { messages: 0, tasks: 1 } } };
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
        if (path.endsWith('/invitations/link') && opts && opts.method === 'POST') {
            return { ok: true, data: { linkId: 'l1', token: 'tok-abc', expiresAt: 'x', maxUses: 1 } };
        }
        if (path === '/api/invitations/link/consume' && opts && opts.method === 'POST') {
            return { ok: true, data: { joined: true, groupId: 'g1', changeSeq: 3 } };
        }
        if (path.endsWith('/leave') && opts && opts.method === 'POST') {
            return { ok: true, data: { left: true, changeSeq: 4 } };
        }
        return { ok: false, error: { code: 'NOT_FOUND', message: 'x' } };
    }),
    apiErrorMessage: (e) => (e && e.message) || 'err',
}));

import {
    listGroups,
    openGroupsWorkspace,
    openGroup,
    openGroupMenuFor,
    submitGroupTask,
    loadMoreTimeline,
    __resetGroupsForTest,
    __getGroupsStateForTest,
} from '../js/communication/groups.js';
import { state } from '../js/core.js';

function buildShell() {
    document.body.innerHTML = `
        <div class="workspace-root" id="workspaceRoot">
            <section id="ws-groups"></section>
        </div>
        <div class="picker-overlay" id="confirmModal" hidden>
            <div class="picker" role="dialog" aria-modal="true">
                <div class="picker-title" id="confirmModalTitle"></div>
                <div id="confirmModalMessage"></div>
                <button id="confirmModalOk"></button>
                <button id="confirmModalCancel"></button>
            </div>
        </div>
        <div class="picker-overlay" id="infoModal" hidden>
            <div class="picker" role="dialog" aria-modal="true">
                <div class="picker-title" id="infoModalTitle"></div>
                <div id="infoModalBody"></div>
                <button id="infoModalOk"></button>
            </div>
        </div>
        <button id="anchor">⋯</button>`;
}

beforeEach(() => {
    __resetGroupsForTest();
    apiCalls.length = 0;
    netState.online = true;
    state.sync.userId = 'u1';
    buildShell();
});

describe('groups — list (قدم ۳)', () => {
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

describe('groups — unified task list (قدم ۳)', () => {
    it('نمای اصلی: هدر + لیست دوحالته + کامپوزر تسک (بدون کامپوزر متنی)', async () => {
        await openGroupsWorkspace();
        await openGroup('g1');
        const st = __getGroupsStateForTest();
        expect(st.items.length).toBe(2);
        expect(document.querySelector('.conv-title').textContent).toContain('سفر');
        expect(document.getElementById('grpTaskInput')).not.toBeNull();
        expect(document.getElementById('grpInput')).toBeNull();
    });

    it('آیتم دیگران سمت مقابل + آواتار و نام فرستنده؛ خودی راست‌چین', async () => {
        await openGroupsWorkspace();
        await openGroup('g1');
        expect(document.querySelectorAll('.msg-mine').length).toBe(1);
        expect(document.querySelectorAll('.msg-other').length).toBe(1);
        const other = document.querySelector('.msg-other');
        expect(other.textContent).toContain('بلیت');
        expect(other.textContent).toContain('sara');
        expect(other.querySelector('.msg-avatar')).not.toBeNull();
    });

    it('⋯ خودی ویرایش/حذف دارد؛ دیگران برای مالک فقط حذف (read-only محتوا)', async () => {
        await openGroupsWorkspace();
        await openGroup('g1');
        expect(document.querySelector('.msg-mine .msg-more')).not.toBeNull();
        // مالک روی آیتم دیگران فقط حذف مدیریتی دارد (نه ویرایش)
        const otherMore = document.querySelector('.msg-other .msg-more');
        expect(otherMore).not.toBeNull();
        otherMore.click();
        await new Promise((r) => setTimeout(r, 10));
        const ids = [...document.querySelectorAll('[data-menu-id]')].map((b) => b.dataset.menuId);
        expect(ids).toEqual(['delete']);
    });

    it('کامپوزر تسک از مسیر صف sync می‌سازد', async () => {
        await openGroupsWorkspace();
        await openGroup('g1');
        document.getElementById('grpTaskInput').value = 'تازه';
        await submitGroupTask();
        const syncs = apiCalls.filter((c) => c.path === '/api/groups/g1/sync');
        expect(syncs.length).toBeGreaterThan(0);
        const saveOp = syncs.flatMap((c) => (c.opts.body && c.opts.body.ops) || [])
            .find((o) => o.type === 'save');
        expect(saveOp).toBeTruthy();
        expect(saveOp.data.payload).toMatchObject({ title: 'تازه' });
    });

    it('عضو عادی روی آیتم دیگران هیچ ⋯ نمی‌بیند', async () => {
        await openGroupsWorkspace();
        await openGroup('g2');
        expect(document.querySelector('.msg-other')).not.toBeNull();
        expect(document.querySelector('.msg-other .msg-more')).toBeNull();
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
        expect(document.querySelector('.conv-row .conv-mini-btn')).toBeNull();
    });
});

describe('groups — drawer menu (قدم ۳)', () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    it('منوی owner: باز کردن/اعضا/دعوت/بستن/حذف', async () => {
        await openGroupMenuFor('g1', document.getElementById('anchor'));
        await sleep(10);
        const ids = [...document.querySelectorAll('[data-menu-id]')].map((b) => b.dataset.menuId);
        expect(ids).toEqual(expect.arrayContaining(['open', 'members', 'invite', 'close', 'delete']));
        expect(ids).not.toContain('leave');
    });

    it('منوی عضو عادی: باز کردن/اعضا/ترک', async () => {
        await openGroupMenuFor('g2', document.getElementById('anchor'));
        await sleep(10);
        const ids = [...document.querySelectorAll('[data-menu-id]')].map((b) => b.dataset.menuId);
        expect(ids).toEqual(['open', 'members', 'leave']);
    });
});

describe('groups — inbox + management (بدون تغییر)', () => {
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

    it('منوی عضو عادی: members/tasks/leave بدون مدیریت', async () => {
        await openGroupsWorkspace();
        await openGroup('g2');
        document.querySelector('.conv-menu-btn').click();
        await sleep(10);
        const ids = [...document.querySelectorAll('[data-menu-id]')].map((b) => b.dataset.menuId);
        expect(ids).toEqual(['members', 'tasks', 'leave']);
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
    });

    it('ویرایش تسک خودی ⋯ دارد', async () => {
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

describe('groups — create (بدون تغییر)', () => {
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

describe('groups — unread badges (قدم ۳: ثبت all)', () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    it('بج نخوانده روی ردیف گروه', async () => {
        await openGroupsWorkspace();
        await sleep(30);
        const badge = document.querySelector('[data-group-unread]');
        expect(badge).not.toBeNull();
        expect(badge.hidden).toBe(false);
        expect(badge.textContent).toBeTruthy();
    });

    it('باز کردن گروه، خواندن all را ثبت می‌کند', async () => {
        await openGroupsWorkspace();
        await openGroup('g1');
        await sleep(30);
        const reads = apiCalls.filter((c) => c.path === '/api/groups/g1/read');
        expect(reads.length).toBeGreaterThan(0);
        expect(reads[0].opts.body).toMatchObject({ type: 'all' });
    });
});

describe('groups — leave + invite link (بدون تغییر)', () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    async function openMenuFor(groupId) {
        await openGroupsWorkspace();
        await openGroup(groupId);
        document.querySelector('.conv-menu-btn').click();
        await sleep(10);
    }

    async function clickMenuItem(id) {
        [...document.querySelectorAll('[data-menu-id]')]
            .find((b) => b.dataset.menuId === id).click();
        await sleep(10);
    }

    it('عضو عادی آیتم ترک را می‌بیند، مالک نه', async () => {
        await openMenuFor('g2');
        let ids = [...document.querySelectorAll('[data-menu-id]')].map((b) => b.dataset.menuId);
        expect(ids).toContain('leave');
        expect(ids).not.toContain('transfer');
    });

    it('ترک گروه: تأیید → POST leave → بازگشت به لیست', async () => {
        await openMenuFor('g2');
        await clickMenuItem('leave');
        document.getElementById('confirmModalOk').click();
        await sleep(30);
        const leaves = apiCalls.filter((c) => c.path === '/api/groups/g2/leave');
        expect(leaves.length).toBe(1);
    });

    it('ساخت لینک دعوت برای فرد خاص از نمای اعضا', async () => {
        await openMenuFor('g1');
        await clickMenuItem('members');
        const searchInput = document.querySelector('.conv-box .conv-input');
        searchInput.value = 'gue';
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(450);
        const linkBtns = [...document.querySelectorAll('.conv-box .conv-mini-btn')]
            .filter((b) => b.textContent === 'لینک' || b.textContent === 'Link');
        expect(linkBtns.length).toBeGreaterThan(0);
        linkBtns[0].click();
        await sleep(30);
        const links = apiCalls.filter((c) => c.path === '/api/groups/g1/invitations/link');
        expect(links.length).toBe(1);
        expect(document.getElementById('infoModalBody').textContent).toContain('#/join/');
    });

    it('مهمان توکن deep-link را نگه می‌دارد (مصرف نمی‌کند)', async () => {
        const { takePendingJoinToken, processPendingJoin } = await import('../js/communication/groups.js');
        window.location.hash = '#/join/tok-123';
        expect(takePendingJoinToken()).toBe('tok-123');
        expect(await processPendingJoin()).toBe(false);
        expect(takePendingJoinToken()).toBe('tok-123');
        window.location.hash = '';
    });
});
