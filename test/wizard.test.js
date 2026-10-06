// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/wizard.test.js — تست‌های ویزارد خوش‌آمد (8B)

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../js/i18n.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, t: (key) => key, getLang: () => 'fa' };
});

const authState = { loggedIn: false, user: null };
vi.mock('../js/auth.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        isLoggedIn: () => authState.loggedIn,
        getCurrentUser: () => authState.user,
    };
});

import { state } from '../js/core.js';
import {
    initWelcomeWizard,
    __resetWizardForTest,
    __getStepForTest,
} from '../js/welcome-wizard.js';

function buildOverlay() {
    document.body.innerHTML = `
        <div class="picker-overlay" id="welcomeOverlay" hidden>
            <div class="picker wizard" role="dialog" aria-modal="true">
                <div id="wizardRoot"></div>
            </div>
        </div>
        <input id="taskInput">`;
}

beforeEach(() => {
    __resetWizardForTest();
    authState.loggedIn = false;
    authState.user = null;
    state.prefs.tourSeen = false;
    buildOverlay();
});

function clickNext() {
    const btns = [...document.querySelectorAll('#wizardRoot .wizard-nav .btn-add')];
    const next = btns[btns.length - 1];
    next.click();
}

describe('wizard — flow (8B)', () => {
    it('از قدم زبان شروع می‌شود و جلو می‌رود', () => {
        initWelcomeWizard({});
        expect(__getStepForTest()).toBe(0);
        expect(document.getElementById('welcomeOverlay').hidden).toBe(false);
        clickNext();
        expect(__getStepForTest()).toBe(1);
    });

    it('رد کردن، تور را تمام می‌کند', () => {
        initWelcomeWizard({});
        clickNext();
        // ⚠️ mock کلید برمی‌گرداند پس fallback فارسی رندر می‌شود
        const skip = [...document.querySelectorAll('#wizardRoot .wizard-nav .btn-clear')]
            .find((b) => b.textContent === 'رد کردن');
        expect(skip).toBeTruthy();
        skip.click();
        expect(state.prefs.tourSeen).toBe(true);
        expect(document.getElementById('welcomeOverlay').hidden).toBe(true);
    });

    it('بستن با ✕ وارد محیط با پیش‌فرض می‌شود', () => {
        initWelcomeWizard({});
        document.querySelector('.wizard-close').click();
        expect(state.prefs.tourSeen).toBe(true);
        expect(document.getElementById('welcomeOverlay').hidden).toBe(true);
    });

    it('قدم تم بعد از خوش‌آمد می‌آید (قدم یوزرنیم حذف شده)', () => {
        initWelcomeWizard({});
        clickNext(); // → 1 خوش‌آمد
        clickNext(); // → 2 تم
        clickNext(); // → 3 ساده/پیشرفته (نه یوزرنیم)
        expect(__getStepForTest()).toBe(3);
        expect(document.getElementById('wizardRoot').textContent).not.toContain('بعد از ورود');
    });

    it('قدم مجوزها هر ۳ مجوز را با دکمه فعال‌سازی نشان می‌دهد', async () => {
        initWelcomeWizard({});
        clickNext(); clickNext(); clickNext(); clickNext();
        expect(__getStepForTest()).toBe(4);
        await new Promise((r) => setTimeout(r, 20));
        const rows = document.querySelectorAll('#wizardRoot .wizard-perm-row');
        expect(rows.length).toBe(3);
        const btns = document.querySelectorAll('#wizardRoot .wizard-perm-row .btn-small');
        expect(btns.length).toBe(3);
    });

    it('قدم آخر دکمه‌ی شروع دارد و تمام می‌کند', () => {
        initWelcomeWizard({});
        for (let i = 0; i < 5; i++) clickNext();
        expect(__getStepForTest()).toBe(5);
        const done = [...document.querySelectorAll('#wizardRoot .btn-add')].pop();
        done.click();
        expect(state.prefs.tourSeen).toBe(true);
    });
});
