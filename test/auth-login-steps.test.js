// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/auth-login-steps.test.js — راهنمای گام‌به‌گام «ورود با تلگرام» در مودال حساب من
//
// ⚠️ چه چیزی قفل می‌شود:
//   ۱. هر پنج کلید در هر دو زبان (fa/en) موجود و غیرخالی‌اند.
//   ۲. نسخه‌ی انگلیسی هیچ کاراکتر فارسی ندارد.
//   ۳. چهار گام، متمایز و شماره‌دار (li) رندر می‌شوند — نه متن چسبیده.
//   ۴. مودال حساب من (حالت وارد‌نشده) واقعاً این بلوک را می‌سازد و CSS آن تعریف شده.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fa from '../public/js/locales/fa.json';
import en from '../public/js/locales/en.json';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const CSS_SRC = fs.readFileSync(path.join(ROOT, 'public', 'css', 'components.css'), 'utf8');

const KEYS = [
    'telegramHowTitle',
    'telegramStep1',
    'telegramStep2',
    'telegramStep3',
    'telegramStep4',
];

const FA_RE = /[\u0600-\u06FF]/;

describe('auth.login — راهنمای ورود با تلگرام', () => {
    it('هر پنج کلید در هر دو زبان موجود و غیرخالی است', () => {
        for (const k of KEYS) {
            expect(typeof fa.auth.login[k], `fa.${k}`).toBe('string');
            expect(fa.auth.login[k].trim().length, `fa.${k}`).toBeGreaterThan(0);
            expect(typeof en.auth.login[k], `en.${k}`).toBe('string');
            expect(en.auth.login[k].trim().length, `en.${k}`).toBeGreaterThan(0);
        }
    });

    it('نسخه‌ی انگلیسی رونوشت فارسی نیست', () => {
        for (const k of KEYS) {
            expect(FA_RE.test(en.auth.login[k]), `en.${k}`).toBe(false);
        }
    });

    it('چهار گام متمایزند (هیچ گامی تکرار نشده)', () => {
        const steps = [1, 2, 3, 4].map((n) => fa.auth.login[`telegramStep${n}`]);
        expect(new Set(steps).size).toBe(4);
    });

    it('گام اول به دکمه‌ی «ورود با حساب تلگرام» و امن بودن پنجره اشاره می‌کند', () => {
        const s1 = fa.auth.login.telegramStep1;
        expect(s1).toContain('ورود با حساب تلگرام');
        expect(s1).toContain('امن');
        expect(en.auth.login.telegramStep1).toContain('Sign in with Telegram');
    });

    it('گام سوم دکمه‌ی Confirm تلگرام را توضیح می‌دهد', () => {
        expect(fa.auth.login.telegramStep3).toContain('Confirm');
        expect(en.auth.login.telegramStep3).toContain('Confirm');
    });

    it('مودال حساب من هر پنج کلید را رندر می‌کند (بدون گام جاافتاده)', () => {
        expect(APP_SRC).toContain("i18nT('auth.login.telegramHowTitle')");
        for (const n of [1, 2, 3, 4]) {
            expect(APP_SRC, `step${n}`).toContain(`i18nT('auth.login.telegramStep${n}')`);
        }
        expect(APP_SRC).toContain('auth-steps-list');
    });

    it('استایل بلوک گام‌ها تعریف شده و رنگ متن از تم می‌آید', () => {
        expect(CSS_SRC).toContain('.auth-steps {');
        expect(CSS_SRC).toContain('.auth-steps-list {');
        const block = CSS_SRC.slice(CSS_SRC.indexOf('.auth-steps-list {'));
        expect(block.slice(0, 400)).toContain('var(--text-muted)');
    });
});
