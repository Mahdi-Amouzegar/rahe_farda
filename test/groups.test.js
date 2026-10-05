// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/groups.test.js — تست‌های مدیریت گروه (تک‌صفحه: مودال + دراور)

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

vi.mock('../js/auth.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, isLoggedIn: () => authState.loggedIn };
});

const authState = { loggedIn: true };

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
            return { ok: true, data: { group: { id: 'g9', name: opts.body.name, ownerId: 'u1', closedAt: null }, changeSeq: 1 } };
        }
        if (path === '/api/groups/g1') {
            return { ok: true, data: { group: { id: 'g1', name: 'سفر', ownerId: 'u1', closedAt: null }, myRole: 'owner' } };
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
        if (path.endsWith('/accept') && opts && opts.method === 'POST') {
            return { ok: true, data: { accepted: true } };
        }
        if (path.endsWith('/reject') && opts && opts.method === 'POST') {
            return { ok: true, data: { rejected: true } };
        }
        if (path === '/api/groups/g1' && opts && opts.method === 'DELETE') {
            return { ok: true, data: { deleted: true } };
        }
        return { ok: false, error: { code: 'NOT_FOUND', message: 'x' } };
    }),
    apiErrorMessage: (e) => (e && e.message) || 'err',
}));

vi.mock('../js/tasks/composer.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, selectDestination: vi.fn(async () => ({ type: 'group' })) };
});

import {
    listGroups,
    loadGroupData,
    openGroup,
    openGroupMenuFor,
    openGroupMembersModal,
    closeModalShell,
    createGroup,
    refreshGroupInbox,
    respondGroupInvitation,
    __resetGroupsForTest,
    __getGroupsStateForTest,
} from '../js/communication/groups.js';
import { state } from '../js/core.js';

function buildShell() {
    document.body.innerHTML = `
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
    authState.loggedIn = true;
    state.sync.userId = 'u1';
    buildShell();
});

describe('groups — drawer preload (رگرسیون لود اولیه)', () => {
    it('listGroups + refreshGroupBadges → ردیف گروه زیر سرفصل گروه‌ها', async () => {
        const { listGroups, refreshGroupBadges } = await import('../js/communication/groups.js');
        const sb = await import('../js/navigation/sidebar.js');
        const res = await listGroups();
        expect(res.ok).toBe(true);
        await refreshGroupBadges();
        document.body.innerHTML = `
            <button id="opener">☰</button>
            <div class="drawer-root" id="drawerRoot" hidden>
                <div class="drawer-scrim" id="drawerScrim"></div>
                <aside class="drawer" id="drawer" role="dialog" aria-modal="true"></aside>
            </div>`;
        sb.initSidebar({});
        sb.openDrawer();
        document.querySelector('#drawer [data-dtab="groups"]').click();
        const drawerText = document.getElementById('drawer').textContent;
        expect(drawerText).toContain('سفر');
        // زیر سرفصل گروه‌ها، نه مخاطبان
        const html = document.getElementById('drawer').innerHTML;
        const contactsIdx = html.indexOf('مخاطبان');
        const groupsIdx = html.indexOf('گروه‌ها');
        const travelIdx = html.indexOf('سفر');
        expect(groupsIdx).toBeGreaterThan(-1);
        expect(travelIdx).toBeGreaterThan(groupsIdx);
        expect(contactsIdx).toBeGreaterThan(-1);
        expect(travelIdx).not.toBeLessThan(contactsIdx);
    });
});

describe('groups — data', () => {
    it('لیست گروه‌ها لود می‌شود', async () => {
        const res = await listGroups();
        expect(res.ok).toBe(true);
        expect(res.groups.length).toBe(2);
        expect(__getGroupsStateForTest().groups.length).toBe(2);
    });

    it('loadGroupData جزئیات + اعضا می‌آورد', async () => {
        const res = await loadGroupData('g1');
        expect(res.ok).toBe(true);
        const st = __getGroupsStateForTest();
        expect(st.group.id).toBe('g1');
        expect(st.members.length).toBe(2);
        expect(st.myRole).toBe('owner');
    });

    it('آفلاین → خطا', async () => {
        netState.online = false;
        const res = await loadGroupData('g1');
        expect(res.ok).toBe(false);
    });
});

describe('groups — members modal', () => {
    it('مودال اعضا با نقش‌ها رندر می‌شود', async () => {
        await openGroupMembersModal('g1');
        expect(document.getElementById('groupModalOverlay')).not.toBeNull();
        expect(document.body.textContent).toContain('sara');
        expect(document.body.textContent).toContain('عضو');
    });

    it('حذف عضو توسط owner (با تأیید)', async () => {
        await openGroupMembersModal('g1');
        const rows = [...document.querySelectorAll('#groupModalOverlay .conv-row')];
        const saraRow = rows.find((r) => r.textContent.includes('sara'));
        expect(saraRow.querySelector('.conv-mini-btn')).not.toBeNull();
        saraRow.querySelector('.conv-mini-btn').click();
        await new Promise((r) => setTimeout(r, 10));
        document.getElementById('confirmModalOk').click();
        await new Promise((r) => setTimeout(r, 30));
        const dels = apiCalls.filter((c) => c.path === '/api/groups/g1/members/u2');
        expect(dels.length).toBe(1);
    });

    it('بستن مودال با ✕', async () => {
        await openGroupMembersModal('g1');
        document.querySelector('#groupModalOverlay .btn-clear').click();
        expect(document.getElementById('groupModalOverlay')).toBeNull();
    });
});

describe('groups — drawer menu', () => {
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

    it('آیتم اعضا مودال را باز می‌کند (بدون تغییر فضا)', async () => {
        await openGroupMenuFor('g1', document.getElementById('anchor'));
        await sleep(10);
        [...document.querySelectorAll('[data-menu-id]')]
            .find((b) => b.dataset.menuId === 'members').click();
        await sleep(30);
        expect(document.getElementById('groupModalOverlay')).not.toBeNull();
    });
});

describe('groups — create', () => {
    it('createGroup POST می‌زند و لیست را تازه می‌کند', async () => {
        const res = await createGroup({ name: 'گروه تازه', visibility: 'private' });
        expect(res.ok).toBe(true);
        const posts = apiCalls.filter((c) => c.path === '/api/groups' && c.opts && c.opts.method === 'POST');
        expect(posts.length).toBe(1);
        expect(posts[0].opts.body).toMatchObject({ name: 'گروه تازه', visibility: 'private' });
    });

    it('نام خالی رد می‌شود', async () => {
        const res = await createGroup({ name: '   ', visibility: 'private' });
        expect(res.ok).toBe(false);
    });
});

describe('groups — inbox', () => {
    it('refreshGroupInbox دعوت‌ها را می‌آورد', async () => {
        const rows = await refreshGroupInbox();
        expect(rows.length).toBe(1);
        expect(rows[0]).toMatchObject({ id: 'inv1', groupId: 'g9' });
    });

    it('قبول دعوت POST می‌زند', async () => {
        const res = await respondGroupInvitation({ id: 'inv1', groupId: 'g9' }, true);
        expect(res.ok).toBe(true);
        const calls = apiCalls.filter((c) => c.path === '/api/groups/g9/invitations/inv1/accept');
        expect(calls.length).toBe(1);
    });
});

describe('groups — unread + leave', () => {
    it('باز کردن گروه خواندن all را ثبت می‌کند', async () => {
        await openGroup('g1');
        const reads = apiCalls.filter((c) => c.path === '/api/groups/g1/read');
        expect(reads.length).toBeGreaterThan(0);
        expect(reads[0].opts.body).toMatchObject({ type: 'all' });
    });

    it('ترک گروه از منوی عضو: تأیید → POST leave', async () => {
        await openGroupMenuFor('g2', document.getElementById('anchor'));
        await new Promise((r) => setTimeout(r, 10));
        [...document.querySelectorAll('[data-menu-id]')]
            .find((b) => b.dataset.menuId === 'leave').click();
        await new Promise((r) => setTimeout(r, 10));
        document.getElementById('confirmModalOk').click();
        await new Promise((r) => setTimeout(r, 30));
        const leaves = apiCalls.filter((c) => c.path === '/api/groups/g2/leave');
        expect(leaves.length).toBe(1);
    });

    it('لینک دعوت برای فرد خاص', async () => {
        await openGroupMembersModal('g1');
        const searchInput = document.querySelector('#groupModalOverlay .conv-input');
        searchInput.value = 'gue';
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 450));
        const linkBtns = [...document.querySelectorAll('#groupModalOverlay .conv-mini-btn')]
            .filter((b) => b.textContent === 'لینک' || b.textContent === 'Link');
        expect(linkBtns.length).toBeGreaterThan(0);
        linkBtns[0].click();
        await new Promise((r) => setTimeout(r, 30));
        const links = apiCalls.filter((c) => c.path === '/api/groups/g1/invitations/link');
        expect(links.length).toBe(1);
        expect(document.getElementById('infoModalBody').textContent).toContain('#/join/');
    });

    it('مهمان توکن deep-link را نگه می‌دارد (مصرف نمی‌کند)', async () => {
        authState.loggedIn = false;
        const { takePendingJoinToken, processPendingJoin } = await import('../js/communication/groups.js');
        window.location.hash = '#/join/tok-123';
        expect(takePendingJoinToken()).toBe('tok-123');
        expect(await processPendingJoin()).toBe(false);
        expect(takePendingJoinToken()).toBe('tok-123');
        window.location.hash = '';
        authState.loggedIn = true;
    });
});
