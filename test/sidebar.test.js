// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/sidebar.test.js — تست‌های دراور ناوبری (T3)

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../js/i18n.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, t: (key) => key };
});

const authState = { loggedIn: true };
vi.mock('../js/auth.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, isLoggedIn: () => authState.loggedIn };
});

import {
    initSidebar,
    openDrawer,
    closeDrawer,
    isDrawerOpen,
    updateDrawerBadges,
    setRecentGroups,
    setRecentConversations,
    rerenderDrawer,
    __resetSidebarForTest,
} from '../js/navigation/sidebar.js';

function buildDrawer() {
    document.body.innerHTML = `
        <button id="opener">☰</button>
        <div class="drawer-root" id="drawerRoot" hidden>
            <div class="drawer-scrim" id="drawerScrim"></div>
            <aside class="drawer" id="drawer" role="dialog" aria-modal="true"></aside>
        </div>`;
}

beforeEach(() => {
    __resetSidebarForTest();
    authState.loggedIn = true;
    buildDrawer();
    initSidebar({});
    vi.useFakeTimers();
});

describe('sidebar — guest', () => {
    it('مهمان فقط tasks + ورود را می‌بیند (بدون پیام/گروه)', () => {
        authState.loggedIn = false;
        openDrawer();
        expect(isDrawerOpen()).toBe(true);
        const labels = [...document.querySelectorAll('#drawer [data-workspace]')]
            .map((b) => b.getAttribute('data-workspace'));
        expect(labels).toEqual(['tasks']);
        expect(document.querySelector('.drawer-login')).not.toBeNull();
    });

    it('کلیک ورود، onLogin را صدا می‌زند و می‌بندد', () => {
        authState.loggedIn = false;
        let called = 0;
        initSidebar({ onLogin: () => { called += 1; } });
        openDrawer();
        document.querySelector('.drawer-login').click();
        expect(called).toBe(1);
        vi.advanceTimersByTime(300);
        expect(isDrawerOpen()).toBe(false);
    });
});

describe('sidebar — logged in', () => {
    it('جستجو + وظایف (بدون دکمه قدیمی پیام/گروه/اعلان و بدون جستجوی جدا)', () => {
        openDrawer();
        const labels = [...document.querySelectorAll('#drawer [data-workspace]')]
            .map((b) => b.getAttribute('data-workspace'));
        expect(labels).toEqual(['tasks']);
    });

    it('تب سه‌تایی مخاطبان/گروه‌ها/جستجو', () => {
        openDrawer();
        const tabs = [...document.querySelectorAll('#drawer [data-dtab]')]
            .map((b) => b.getAttribute('data-dtab'));
        expect(tabs).toEqual(['contacts', 'groups', 'search']);
    });

    function openGroupsTab() {
        openDrawer();
        document.querySelector('#drawer [data-dtab="groups"]').click();
    }

    it('تب مخاطبان پیش‌فرض است و لیست کامل را نشان می‌دهد', () => {
        setRecentConversations([
            { userId: 'u2', name: 'سارا', avatarUrl: null, unread: 1 },
            { userId: 'u3', name: 'رضا', avatarUrl: null, unread: 0 },
            { userId: 'u4', name: 'نگار', avatarUrl: null, unread: 0 },
            { userId: 'u5', name: 'امیر', avatarUrl: null, unread: 0 },
        ]);
        openDrawer();
        expect(document.querySelectorAll('#drawer .drawer-recent').length).toBe(4);
    });

    it('درخواست ورودی با قبول/رد', async () => {
        const { setIncomingRequests } = await import('../js/navigation/sidebar.js');
        setIncomingRequests([{ id: 'c9', userId: 'u9', name: 'تازه', avatarUrl: null }]);
        const seen = [];
        initSidebar({
            onAcceptRequest: (id) => seen.push(['accept', id]),
            onRejectRequest: (id) => seen.push(['reject', id]),
        });
        openDrawer();
        const btns = [...document.querySelectorAll('#drawer .conv-mini-btn')];
        expect(btns.length).toBe(2);
        btns[0].click();
        await vi.advanceTimersByTimeAsync(10);
        expect(seen).toEqual([['accept', 'c9']]);
    });

    it('دکمه ＋ فرم ساخت گروه را باز می‌کند', () => {
        openGroupsTab();
        const addBtns = [...document.querySelectorAll('#drawer .drawer-mini-btn')];
        expect(addBtns.length).toBe(1);
        addBtns[0].click();
        expect(document.querySelector('#drawer .conv-search .conv-input')).not.toBeNull();
    });

    it('بج‌ها روی ردیف‌های اخیر اعمال می‌شوند', () => {
        setRecentConversations([
            { userId: 'u2', name: 'سارا', avatarUrl: null, unread: 3 },
            { userId: 'u3', name: 'رضا', avatarUrl: null, unread: 0 },
        ]);
        openDrawer();
        const badges = [...document.querySelectorAll('#drawer .drawer-recent .drawer-badge')];
        expect(badges.length).toBe(2);
        expect(badges[0].hidden).toBe(false);
        expect(badges[1].hidden).toBe(true);
    });

    it('لیست کامل گروه‌ها (بدون سقف ۳تایی)', () => {
        setRecentGroups([
            { id: 'g1', name: 'یک' }, { id: 'g2', name: 'دو' },
            { id: 'g3', name: 'سه' }, { id: 'g4', name: 'چهار' },
        ]);
        openGroupsTab();
        expect(document.querySelectorAll('#drawer .drawer-recent').length).toBe(4);
    });

    it('ردیف گروه: نام + بج نخوانده + ⋯', () => {
        setRecentGroups([
            { id: 'g1', name: 'سفر', avatarUrl: null, unread: 2 },
        ]);
        const opened = [];
        const menus = [];
        initSidebar({
            onOpenGroup: (id) => opened.push(id),
            onGroupMenu: (id) => menus.push(id),
        });
        openGroupsTab();
        const rows = [...document.querySelectorAll('#drawer .drawer-recent')];
        expect(rows.length).toBe(1);
        expect(rows[0].querySelector('.drawer-badge').hidden).toBe(false);
        rows[0].querySelector('.drawer-more').click();
        expect(menus).toEqual(['g1']);
        rows[0].querySelector('.drawer-item-label-btn').click();
        expect(opened).toEqual(['g1']);
    });

    it('باز شدن دراور هوک onDrawerOpened را صدا می‌زند (خودترمیمی)', () => {
        let called = 0;
        initSidebar({ onDrawerOpened: () => { called += 1; } });
        openDrawer();
        expect(called).toBe(1);
    });

    it('rerenderDrawer دراور باز را تازه می‌کند', () => {
        openGroupsTab();
        setRecentGroups([{ id: 'g1', name: 'سفر', avatarUrl: null, unread: 0 }]);
        expect(document.querySelectorAll('#drawer .drawer-recent').length).toBe(0);
        rerenderDrawer();
        expect(document.querySelectorAll('#drawer .drawer-recent').length).toBe(1);
    });

    it('removeDrawerRow ردیف را درجا جمع می‌کند (بدون رفرش کل)', async () => {
        const { removeDrawerRow } = await import('../js/navigation/sidebar.js');
        setRecentConversations([
            { userId: 'u2', name: 'سارا', avatarUrl: null, unread: 0 },
            { userId: 'u3', name: 'رضا', avatarUrl: null, unread: 0 },
        ]);
        openDrawer();
        expect(document.querySelectorAll('#drawer .drawer-recent').length).toBe(2);
        expect(removeDrawerRow('peer', 'u2')).toBe(true);
        // بلافاصله: کلاس انیمیشن خورده ولی هنوز در DOM است
        const leaving = document.querySelector('#drawer .drawer-recent.drawer-row-leaving');
        expect(leaving).not.toBeNull();
        expect(leaving.textContent).toContain('سارا');
        await vi.advanceTimersByTimeAsync(300);
        expect(document.querySelectorAll('#drawer .drawer-recent').length).toBe(1);
        expect(document.getElementById('drawer').textContent).not.toContain('سارا');
        expect(document.getElementById('drawer').textContent).toContain('رضا');
        expect(removeDrawerRow('peer', 'nope')).toBe(true);
    });

    it('جستجوی گفتگوی تازه: مخاطب موجود دکمه درخواست ندارد', async () => {
        initSidebar({
            onSearchUsers: async () => [
                { id: 'u2', username: 'sara', rel: 'accepted' },
                { id: 'u9', username: 'newguy', rel: 'none' },
            ],
        });
        openDrawer();
        document.querySelector('#drawer .drawer-mini-btn').click();
        const input = document.querySelector('#drawer .conv-search input');
        input.value = 'sar';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await vi.advanceTimersByTimeAsync(500);
        const rows = [...document.querySelectorAll('#drawer .conv-search-results .conv-row')];
        expect(rows.length).toBe(2);
        expect(rows[0].querySelector('.conv-mini-btn')).toBeNull();
        expect(rows[0].textContent).toContain('مخاطب');
        expect(rows[1].querySelector('.conv-mini-btn')).not.toBeNull();
    });

    it('تب جستجو: input + نتایج قابل کلیک', async () => {
        const seen = [];
        initSidebar({
            onSearchAll: async () => ({
                users: [{ id: 'u9', username: 'newguy', displayName: null }],
                groups: [{ id: 'g9', name: 'تازه' }],
            }),
            onOpenSearchUser: (u) => seen.push(['user', u.id]),
            onOpenSearchGroup: (g) => seen.push(['group', g.id]),
        });
        openDrawer();
        document.querySelector('#drawer [data-dtab="search"]').click();
        const input = document.querySelector('#drawer .conv-search .conv-input');
        expect(input).not.toBeNull();
        input.value = 'new';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await vi.advanceTimersByTimeAsync(500);
        const rows = [...document.querySelectorAll('#drawer .conv-search-results .conv-row')];
        expect(rows.length).toBe(2);
        rows[0].click();
        expect(seen).toEqual([['user', 'u9']]);
    });

    it('کلیک مقصد، onNavigate را صدا می‌زند و می‌بندد', () => {
        const seen = [];
        initSidebar({ onNavigate: (ws) => seen.push(ws) });
        openDrawer();
        document.querySelector('#drawer [data-workspace="tasks"]').click();
        expect(seen).toEqual(['tasks']);
        vi.advanceTimersByTime(300);
        expect(isDrawerOpen()).toBe(false);
    });

    it('باز شدن کلاس open می‌گیرد (هوک انیمیشن)', () => {
        openDrawer();
        expect(document.getElementById('drawerRoot').classList.contains('open')).toBe(true);
        closeDrawer();
        expect(document.getElementById('drawerRoot').classList.contains('open')).toBe(false);
        vi.advanceTimersByTime(300);
        expect(isDrawerOpen()).toBe(false);
    });

    it('Escape می‌بندد', () => {
        openDrawer();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        vi.advanceTimersByTime(300);
        expect(isDrawerOpen()).toBe(false);
    });

    it('باز شدن فوکوس را داخل دراور می‌برد و Escape برمی‌گرداند', () => {
        const opener = document.getElementById('opener');
        opener.focus();
        openDrawer(opener);
        expect(document.activeElement.closest('#drawer')).not.toBeNull();
    });

    it('رندر تازه در هر بازشدن (ردیف جدید دیده می‌شود)', () => {
        openDrawer();
        closeDrawer();
        setRecentConversations([{ userId: 'u7', name: 'تازه', avatarUrl: null, unread: 7 }]);
        openDrawer();
        const rows = [...document.querySelectorAll('#drawer .drawer-recent')];
        expect(rows.length).toBe(1);
        expect(rows[0].querySelector('.drawer-badge').hidden).toBe(false);
    });

    it('گفتگوهای اخیر: نام + بج نخوانده + ⋯ (حداکثر ۳)', () => {
        setRecentConversations([
            { userId: 'u2', name: 'سارا', avatarUrl: null, unread: 2 },
            { userId: 'u3', name: 'رضا', avatarUrl: null, unread: 0 },
        ]);
        const opened = [];
        const menus = [];
        initSidebar({
            onOpenConversation: (id) => opened.push(id),
            onConversationMenu: (id) => menus.push(id),
        });
        openDrawer();
        const rows = [...document.querySelectorAll('#drawer .drawer-recent')];
        expect(rows.length).toBe(2);
        const badge = rows[0].querySelector('.drawer-badge');
        expect(badge.hidden).toBe(false);
        rows[0].querySelector('.drawer-more').click();
        expect(menus).toEqual(['u2']);
        rows[0].querySelector('.drawer-item-label-btn').click();
        expect(opened).toEqual(['u2']);
    });
});
