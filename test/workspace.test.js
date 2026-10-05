// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/workspace.test.js — تست‌های رجیستری Workspace (تک‌صفحه: tasks + search)

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

import { events, EV } from '../js/events.js';
import {
    initWorkspace,
    switchWorkspace,
    getActiveWorkspace,
    isWorkspace,
    __resetWorkspaceForTest,
} from '../js/navigation/workspace.js';

function buildShell() {
    document.body.innerHTML = `
        <div class="layout" id="layout"></div>
        <div class="mobile-tabs">
            <button class="mobile-tab active" data-tab="tasks"></button>
            <button class="mobile-tab" data-tab="map"></button>
        </div>
        <div class="panel" id="panelMap"></div>
        <div class="workspace-root" id="workspaceRoot" hidden>
            <section id="ws-search" hidden></section>
        </div>`;
}

beforeEach(() => {
    __resetWorkspaceForTest();
    authState.loggedIn = true;
    buildShell();
    initWorkspace();
});

describe('workspace — registry', () => {
    it('فضای پیش‌فرض tasks است', () => {
        expect(getActiveWorkspace()).toBe('tasks');
    });

    it('نام نامعتبر رد می‌شود', () => {
        expect(isWorkspace('nope')).toBe(false);
        expect(switchWorkspace('nope')).toBe(false);
        expect(getActiveWorkspace()).toBe('tasks');
    });

    it('فضاهای قدیمی messages/groups/notifications دیگر معتبر نیستند', () => {
        expect(isWorkspace('messages')).toBe(false);
        expect(isWorkspace('groups')).toBe(false);
        expect(isWorkspace('notifications')).toBe(false);
        expect(switchWorkspace('messages')).toBe(false);
    });

    it('سوییچ به search: layout مخفی، سکشن نمایان، رویداد فرستاده می‌شود', () => {
        const seen = [];
        events.on(EV.WORKSPACE_CHANGED, (p) => seen.push(p));
        expect(switchWorkspace('search')).toBe(true);
        expect(getActiveWorkspace()).toBe('search');
        expect(document.querySelector('.layout').hidden).toBe(true);
        expect(document.querySelector('.mobile-tabs').hidden).toBe(true);
        expect(document.getElementById('workspaceRoot').hidden).toBe(false);
        expect(document.getElementById('ws-search').hidden).toBe(false);
        expect(seen).toEqual([{ from: 'tasks', to: 'search' }]);
    });

    it('برگشت به tasks همه را برمی‌گرداند', () => {
        switchWorkspace('search');
        switchWorkspace('tasks');
        expect(getActiveWorkspace()).toBe('tasks');
        expect(document.querySelector('.layout').hidden).toBe(false);
        expect(document.getElementById('workspaceRoot').hidden).toBe(true);
    });
});

describe('workspace — guest gate', () => {
    it('مهمان نمی‌تواند به search برود و AUTH_REQUIRED می‌آید', () => {
        authState.loggedIn = false;
        const seen = [];
        events.on(EV.AUTH_REQUIRED, (p) => seen.push(p));
        expect(switchWorkspace('search')).toBe(false);
        expect(getActiveWorkspace()).toBe('tasks');
        expect(seen.length).toBe(1);
        expect(seen[0].workspace).toBe('search');
    });

    it('مهمان در tasks می‌ماند (مجاز)', () => {
        authState.loggedIn = false;
        expect(switchWorkspace('tasks')).toBe(true);
    });
});

describe('workspace — scroll memory', () => {
    it('اسکرول هر فضا حفظ می‌شود', () => {
        const layout = document.querySelector('.layout');
        layout.scrollTop = 123;
        switchWorkspace('search');
        const root = document.getElementById('workspaceRoot');
        root.scrollTop = 45;
        switchWorkspace('tasks');
        expect(layout.scrollTop).toBe(123);
        switchWorkspace('search');
        expect(root.scrollTop).toBe(45);
    });
});
