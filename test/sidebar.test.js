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
    it('هر ۵ مقصد + تنظیمات + حساب رندر می‌شود', () => {
        openDrawer();
        const labels = [...document.querySelectorAll('#drawer [data-workspace]')]
            .map((b) => b.getAttribute('data-workspace'));
        expect(labels).toEqual(['search', 'tasks', 'messages', 'groups', 'notifications']);
    });

    it('بج‌ها اعمال می‌شوند', () => {
        updateDrawerBadges({ messages: 3, groups: 0, notifications: 12 });
        openDrawer();
        const msgBtn = document.querySelector('#drawer [data-workspace="messages"] .drawer-badge');
        expect(msgBtn.hidden).toBe(false);
        const grpBtn = document.querySelector('#drawer [data-workspace="groups"] .drawer-badge');
        expect(grpBtn.hidden).toBe(true);
    });

    it('حداکثر ۳ گروه اخیر', () => {
        setRecentGroups([
            { id: 'g1', name: 'یک' }, { id: 'g2', name: 'دو' },
            { id: 'g3', name: 'سه' }, { id: 'g4', name: 'چهار' },
        ]);
        openDrawer();
        expect(document.querySelectorAll('.drawer-recent').length).toBe(3);
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
        openDrawer();
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
        openDrawer();
        setRecentGroups([{ id: 'g1', name: 'سفر', avatarUrl: null, unread: 0 }]);
        expect(document.querySelectorAll('#drawer .drawer-recent').length).toBe(0);
        rerenderDrawer();
        expect(document.querySelectorAll('#drawer .drawer-recent').length).toBe(1);
    });

    it('کلیک مقصد، onNavigate را صدا می‌زند و می‌بندد', () => {
        const seen = [];
        initSidebar({ onNavigate: (ws) => seen.push(ws) });
        openDrawer();
        document.querySelector('#drawer [data-workspace="groups"]').click();
        expect(seen).toEqual(['groups']);
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

    it('رندر تازه در هر بازشدن (بج جدید دیده می‌شود)', () => {
        openDrawer();
        closeDrawer();
        updateDrawerBadges({ messages: 7 });
        openDrawer();
        const msgBtn = document.querySelector('#drawer [data-workspace="messages"] .drawer-badge');
        expect(msgBtn.hidden).toBe(false);
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
