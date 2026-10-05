// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/header.test.js — تست‌های اسلات‌های هدر (تک‌صفحه: بدون زنگ)

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../js/i18n.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, t: (key) => 'X:' + key };
});

import { events, EV } from '../js/events.js';
import {
    initHeader,
    refreshHeaderContext,
} from '../js/navigation/header.js';

function buildHeader() {
    document.body.innerHTML = `
        <div class="header-actions">
            <button id="drawerBtn">☰</button>
            <button id="accountBtn">👤</button>
        </div>
        <span id="headerContext"></span>`;
}

beforeEach(() => {
    buildHeader();
});

describe('header', () => {
    it('زمینه = نام فضای فعال (tasks)', () => {
        initHeader({});
        expect(document.getElementById('headerContext').textContent).toBe('X:nav.tasks');
    });

    it('کلیک حساب → onAccount، دراور → onDrawer (بدون بل)', () => {
        const seen = [];
        initHeader({
            onDrawer: () => seen.push('drawer'),
            onAccount: () => seen.push('account'),
        });
        document.getElementById('accountBtn').click();
        document.getElementById('drawerBtn').click();
        expect(seen).toEqual(['account', 'drawer']);
        expect(document.getElementById('notifBell')).toBeNull();
    });

    it('با WORKSPACE_CHANGED زمینه تازه می‌شود', () => {
        initHeader({});
        events.emit(EV.WORKSPACE_CHANGED, { from: 'tasks', to: 'tasks' });
        expect(document.getElementById('headerContext').textContent).toBe('X:nav.tasks');
    });

    it('بدون markup خطا نمی‌دهد', () => {
        document.body.innerHTML = '';
        expect(() => initHeader({})).not.toThrow();
        expect(() => refreshHeaderContext()).not.toThrow();
    });
});
