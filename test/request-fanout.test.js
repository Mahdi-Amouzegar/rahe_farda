// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/request-fanout.test.js — رگرسیون سیل درخواست‌های بوت (گزارش کاربر، اکتبر ۲۰۲۶)
//
// ⚠️ باگ‌ها:
//   ۱. listConversations دوبار /api/dm/unread می‌زد.
//   ۲. callerهای همزمان getDmUnread / refreshGroupBadges هر کدام فن‌اوت جدا می‌زدند.
//   ۳. تیک زنده ۴ مرحله را ترتیبی اجرا می‌کرد (پوشش با موازی‌سازی؛ تست مستقیم ندارد).

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../js/i18n.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, t: (key) => key, formatDateTime: (iso) => 'T:' + iso };
});

const netState = { online: true };
vi.mock('../js/net.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, isOnline: () => netState.online };
});

const calls = [];
vi.mock('../js/api.js', async () => ({
    apiFetch: vi.fn(async (path, opts) => {
        calls.push({ path, method: (opts && opts.method) || 'GET' });
        if (path === '/api/connections') {
            return {
                ok: true,
                data: {
                    connections: [
                        { id: 'c1', status: 'accepted', otherUserId: 'u2', otherUser: { id: 'u2', displayName: 'سارا' } },
                    ],
                },
            };
        }
        if (path === '/api/dm/unread') {
            return { ok: true, data: { unread: { total: 1, byPeer: [{ peerId: 'u2', count: 1 }], activity: [] } } };
        }
        if (path === '/api/dm/read') return { ok: true, data: { read: true } };
        if (path === '/api/groups') {
            return {
                ok: true,
                data: { groups: [{ id: 'g1', name: 'سفر', lastActivity: '2026-01-01T00:00:00Z' }] },
            };
        }
        if (path === '/api/invitations/mine') return { ok: true, data: { invitations: [] } };
        if (path === '/api/groups/g1/unread') {
            return { ok: true, data: { unread: { messages: 0, tasks: 0, lastReadAt: null } } };
        }
        return { ok: false, error: { code: 'NOT_FOUND', message: 'x' } };
    }),
    apiErrorMessage: (e) => (e && e.message) || 'err',
}));

import { state } from '../js/core.js';
import { getDmUnread, markDmRead, __resetDmUnreadForTest } from '../js/communication/dm-tasks.js';
import { listConversations, __resetConversationsForTest } from '../js/communication/conversations.js';
import { listGroups, refreshGroupBadges, __resetGroupsForTest } from '../js/communication/groups.js';
import { __resetSidebarForTest } from '../js/navigation/sidebar.js';

function unreadCalls() {
    return calls.filter((c) => c.path === '/api/dm/unread').length;
}

beforeEach(() => {
    calls.length = 0;
    netState.online = true;
    state.sync.userId = 'u1';
    document.body.innerHTML = '<div class="drawer-root" id="drawerRoot" hidden><aside class="drawer" id="drawer"></aside></div>';
    __resetDmUnreadForTest();
    __resetConversationsForTest();
    __resetGroupsForTest();
    __resetSidebarForTest();
});

describe('fanout — getDmUnread تکی‌خیز + کش کوتاه', () => {
    it('۳ فراخوانی همزمان → فقط ۱ درخواست', async () => {
        const [a, b, c] = await Promise.all([getDmUnread(), getDmUnread(), getDmUnread()]);
        expect(a.ok && b.ok && c.ok).toBe(true);
        expect(unreadCalls()).toBe(1);
    });

    it('فراخوانی دوم در TTL → بدون درخواست تازه', async () => {
        await getDmUnread();
        await getDmUnread();
        expect(unreadCalls()).toBe(1);
    });

    it('بعد از markDmRead موفق → کش باطل و درخواست تازه', async () => {
        await getDmUnread();
        expect(unreadCalls()).toBe(1);
        const m = await markDmRead('u2', '2026-01-01T00:00:00.000Z');
        expect(m.ok).toBe(true);
        await getDmUnread();
        expect(unreadCalls()).toBe(2);
    });
});

describe('fanout — listConversations فقط یک unread می‌زند', () => {
    it('دوبار صدا زدن پشت سر هم → همان ۱ درخواست کش‌شده', async () => {
        const r1 = await listConversations();
        expect(r1.ok).toBe(true);
        const r2 = await listConversations();
        expect(r2.ok).toBe(true);
        expect(unreadCalls()).toBe(1);
    });
});

describe('fanout — refreshGroupBadges همزمان', () => {
    it('۲ فراخوانی همزمان → یک فن‌اوت', async () => {
        const lg = await listGroups();
        expect(lg.ok).toBe(true);
        await Promise.all([refreshGroupBadges(), refreshGroupBadges()]);
        expect(calls.filter((c) => c.path === '/api/groups/g1/unread').length).toBe(1);
    });
});
