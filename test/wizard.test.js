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

    it('قدم نام کاربری برای مهمان قفل است', () => {
        initWelcomeWizard({});
        clickNext(); // → 1 خوش‌آمد
        clickNext(); // → 2 تم
        clickNext(); // → 3 نام کاربری
        expect(__getStepForTest()).toBe(3);
        expect(document.getElementById('wizardRoot').textContent).toContain('بعد از ورود');
    });

    it('قدم نام کاربری برای واردشده نام را نشان می‌دهد', () => {
        authState.loggedIn = true;
        authState.user = { id: 'u1', username: 'ali' };
        initWelcomeWizard({});
        clickNext(); clickNext(); clickNext();
        expect(document.getElementById('wizardRoot').textContent).toContain('@ali');
    });

    it('قدم آخر دکمه‌ی شروع دارد و تمام می‌کند', () => {
        initWelcomeWizard({});
        for (let i = 0; i < 6; i++) clickNext();
        expect(__getStepForTest()).toBe(6);
        const done = [...document.querySelectorAll('#wizardRoot .btn-add')].pop();
        done.click();
        expect(state.prefs.tourSeen).toBe(true);
    });
});
