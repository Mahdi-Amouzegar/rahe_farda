// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/welcome-wizard.js -- ویزارد خوش‌آمد چندمرحله‌ای (Phase 8 — 8B)
//
// ⚠️ ۷ قدم (همه اختیاری — بستن در هر قدم = ورود با پیش‌فرض‌ها):
//    ۰ زبان (پیش‌انتخاب از locale مرورگر، اعمال فوری)
//    ۱ خوش‌آمد (متن + هشدار ذخیره‌سازی موجود)
//    ۲ حالت نمایش (auto/light/dark)
//    ۳ نام کاربری (فقط نمایشی/قفل — بک‌اند endpoint برای تغییر ندارد)
//    ۴ ساده/پیشرفته (proMode)
//    ۵ مجوزها (فقط اعلان، با توضیح + قابل رد)
//    ۶ حساب آنلاین (تلگرام / کد → مودال حساب موجود)
//
// ⚠️ بدون innerHTML — فقط DOM API و textContent (به‌جز رشته‌های استاتیک لوکال
//    که از همان الگوی data-i18n-html استفاده می‌کنند — در اینجا textContent).
// ═══════════════════════════════════════════════════════════════════════════

import { state } from './core.js';
import { savePrefs } from './map.js';
import { getLang, setLang, applyToDOM, t as i18nT } from './i18n.js';
import { isLoggedIn, getCurrentUser } from './auth.js';
import { ensureNotifPerm, notifSupported } from './notify.js';
import { refreshHeaderContext } from './navigation/header.js';

// ⚠️ عمداً از app.js ایمپورت نمی‌کنیم (چرخه + بوت سنگین در تست).
//    توابع لازم (applyDisplaySettings، onOpenAuth) از طریق init تزریق می‌شوند.

let _step = 0;
let _opts = null;
const TOTAL_STEPS = 7;

function tr(key, fallback) {
    const v = i18nT(key);
    return v !== key ? v : fallback;
}

function overlay() {
    return document.getElementById('welcomeOverlay');
}

function root() {
    return document.getElementById('wizardRoot');
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
}

function browserDefaultLang() {
    try {
        const nav = (navigator.language || '').toLowerCase();
        if (nav.startsWith('fa')) return 'fa';
    } catch { /* silent */ }
    return 'en';
}

function optionButton({ label, selected, onClick }) {
    const btn = el('button', 'welcome-opt' + (selected ? ' selected' : ''));
    btn.type = 'button';
    btn.textContent = label;
    if (selected) btn.setAttribute('aria-pressed', 'true');
    btn.addEventListener('click', onClick);
    return btn;
}

function finishTour() {
    state.prefs.tourSeen = true;
    try {
        savePrefs();
    } catch { /* silent */ }
    const ov = overlay();
    if (ov) ov.hidden = true;
    const ti = document.getElementById('taskInput');
    if (ti) {
        try { ti.focus({ preventScroll: true }); } catch { /* silent */ }
    }
}

function renderChrome(sec, { showBack, showNext, showSkip, onNext }) {
    const dots = el('div', 'wizard-dots');
    dots.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < TOTAL_STEPS; i++) {
        const d = el('span', 'wizard-dot' + (i === _step ? ' active' : '') + (i < _step ? ' done' : ''));
        dots.appendChild(d);
    }
    sec.appendChild(dots);

    const nav = el('div', 'picker-actions wizard-nav');
    if (showBack && _step > 0) {
        const back = el('button', 'btn-clear', tr('wiz.back', '‹ برگشت'));
        back.type = 'button';
        back.addEventListener('click', () => {
            _step = Math.max(0, _step - 1);
            renderStep();
        });
        nav.appendChild(back);
    }
    const spacer = el('span', 'wizard-spacer');
    nav.appendChild(spacer);
    if (showSkip) {
        const skip = el('button', 'btn-clear', tr('wiz.skip', 'رد کردن'));
        skip.type = 'button';
        skip.addEventListener('click', () => finishTour());
        nav.appendChild(skip);
    }
    if (showNext) {
        const next = el('button', 'btn-add picker-confirm', tr('wiz.next', 'بعدی'));
        next.type = 'button';
        next.addEventListener('click', () => {
            if (typeof onNext === 'function') onNext();
            else if (_step < TOTAL_STEPS - 1) {
                _step += 1;
                renderStep();
            } else {
                finishTour();
            }
        });
        nav.appendChild(next);
    }
    sec.appendChild(nav);
}

function renderStep() {
    const box = root();
    if (!box) return;
    box.replaceChildren();
    const sec = el('div', 'wizard-step');
    const close = el('button', 'wizard-close', '✕');
    close.type = 'button';
    close.setAttribute('aria-label', tr('wiz.close', 'بستن'));
    close.addEventListener('click', () => finishTour());
    sec.appendChild(close);

    if (_step === 0) renderLangStep(sec);
    else if (_step === 1) renderWelcomeStep(sec);
    else if (_step === 2) renderThemeStep(sec);
    else if (_step === 3) renderUsernameStep(sec);
    else if (_step === 4) renderProStep(sec);
    else if (_step === 5) renderPermStep(sec);
    else renderAccountStep(sec);

    box.appendChild(sec);
}

function stepTitle(sec, text) {
    sec.appendChild(el('div', 'picker-title', text));
}

// ─── قدم ۰: زبان ───
function renderLangStep(sec) {
    stepTitle(sec, tr('wiz.langTitle', 'زبان / Language'));
    const def = browserDefaultLang();
    const row = el('div', 'welcome-settings-buttons');
    row.appendChild(optionButton({
        label: '🇮🇷 فارسی',
        selected: getLang() === 'fa',
        onClick: async () => {
            await setLang('fa');
            applyToDOM();
            refreshHeaderContext();
            renderStep();
        },
    }));
    row.appendChild(optionButton({
        label: '🇬🇧 English',
        selected: getLang() === 'en',
        onClick: async () => {
            await setLang('en');
            applyToDOM();
            refreshHeaderContext();
            renderStep();
        },
    }));
    sec.appendChild(row);
    if (getLang() !== def) {
        sec.appendChild(el('p', 'wizard-hint', tr('wiz.langBrowserHint', '') || 'زبان مرورگر: ' + def));
    }
    renderChrome(sec, { showBack: false, showNext: true, showSkip: true });
}

// ─── قدم ۱: خوش‌آمد ───
function renderWelcomeStep(sec) {
    stepTitle(sec, tr('welcome.title', '👋 خوش آمدید'));
    sec.appendChild(el('p', 'welcome-text', tr('welcome.textShort', 'برنامه‌ریز شخصی آفلاین و خصوصی.')));
    sec.appendChild(el('p', 'storage-guidance', tr('welcome.storageGuidance', '')));
    renderChrome(sec, { showBack: true, showNext: true, showSkip: true });
}

// ─── قدم ۲: حالت نمایش ───
function renderThemeStep(sec) {
    stepTitle(sec, tr('wiz.themeTitle', 'حالت نمایش'));
    const row = el('div', 'welcome-settings-buttons');
    const cur = (state.prefs && state.prefs.theme) || 'auto';
    const setTheme = (value) => {
        state.prefs.theme = value;
        savePrefs();
        if (_opts && typeof _opts.applyDisplay === 'function') _opts.applyDisplay();
        renderStep();
    };
    row.appendChild(optionButton({ label: tr('theme.auto', '🖥 خودکار'), selected: cur === 'auto', onClick: () => setTheme('auto') }));
    row.appendChild(optionButton({ label: tr('theme.light', '☀️ روشن'), selected: cur === 'light', onClick: () => setTheme('light') }));
    row.appendChild(optionButton({ label: tr('theme.dark', '🌙 تاریک'), selected: cur === 'dark', onClick: () => setTheme('dark') }));
    sec.appendChild(row);
    renderChrome(sec, { showBack: true, showNext: true, showSkip: true });
}

// ─── قدم ۳: نام کاربری (نمایشی/قفل — بک‌اند endpoint تغییر ندارد) ───
function renderUsernameStep(sec) {
    stepTitle(sec, tr('wiz.usernameTitle', 'نام کاربری'));
    if (isLoggedIn()) {
        let name = '';
        try {
            const u = getCurrentUser();
            name = (u && (u.username || u.displayName)) || '';
        } catch { /* silent */ }
        sec.appendChild(el('p', 'wizard-text', name ? '@' + name : '—'));
        sec.appendChild(el('p', 'wizard-hint', tr('wiz.usernameFromTelegram', 'نام کاربری از تلگرام گرفته شده است.')));
    } else {
        sec.appendChild(el('p', 'wizard-text', tr('wiz.usernameLocked', 'بعد از ورود، نام کاربری اینجا نمایش داده می‌شود.')));
    }
    renderChrome(sec, { showBack: true, showNext: true, showSkip: true });
}

// ─── قدم ۴: ساده/پیشرفته ───
function renderProStep(sec) {
    stepTitle(sec, tr('wiz.proTitle', 'حالت کاری'));
    const row = el('div', 'welcome-settings-buttons');
    const pro = !!(state.prefs && state.prefs.proMode);
    const setPro = (value) => {
        state.prefs.proMode = value;
        savePrefs();
        renderStep();
    };
    row.appendChild(optionButton({ label: tr('wiz.proSimple', 'ساده'), selected: !pro, onClick: () => setPro(false) }));
    row.appendChild(optionButton({ label: tr('wiz.proPro', 'پیشرفته'), selected: pro, onClick: () => setPro(true) }));
    sec.appendChild(row);
    renderChrome(sec, { showBack: true, showNext: true, showSkip: true });
}

// ─── قدم ۵: مجوزها (فقط اعلان) ───
function renderPermStep(sec) {
    stepTitle(sec, tr('wiz.permTitle', 'مجوزها'));
    sec.appendChild(el('p', 'wizard-text', tr('wiz.permDesc', 'برای یادآورها، اعلان مرورگر لازم است. بدون آن هم برنامه کامل کار می‌کند.')));
    const row = el('div', 'welcome-settings-buttons');
    const enable = el('button', 'btn-add picker-confirm', tr('wiz.permEnable', 'فعال‌سازی اعلان'));
    enable.type = 'button';
    enable.addEventListener('click', async () => {
        await ensureNotifPerm();
        renderStep();
    });
    row.appendChild(enable);
    sec.appendChild(row);
    let state_text = '';
    try {
        if (!notifSupported()) state_text = tr('wiz.permUnsupported', 'مرورگر اعلان پشتیبانی نمی‌کند.');
        else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            state_text = tr('wiz.permGranted', 'اعلان‌ها فعال‌اند.');
        }
    } catch { /* silent */ }
    if (state_text) sec.appendChild(el('p', 'wizard-hint', state_text));
    renderChrome(sec, { showBack: true, showNext: true, showSkip: true });
}

// ─── قدم ۶: حساب آنلاین ───
function renderAccountStep(sec) {
    stepTitle(sec, tr('wiz.accountTitle', 'حساب آنلاین'));
    if (isLoggedIn()) {
        sec.appendChild(el('p', 'wizard-text', tr('wiz.accountLoggedIn', 'وارد شده‌اید — همگام‌سازی فعال است.')));
    } else {
        sec.appendChild(el('p', 'wizard-text', tr('wiz.accountDesc', 'با حساب آنلاین، همگام‌سازی بین دستگاه‌ها، پیام و گروه فعال می‌شود. بدون آن هم همه‌ی قابلیت‌های اصلی کار می‌کنند.')));
        const row = el('div', 'welcome-settings-buttons');
        const tg = el('button', 'btn-add picker-confirm', tr('wiz.accountTelegram', 'ورود با تلگرام'));
        tg.type = 'button';
        tg.addEventListener('click', () => {
            finishTour();
            if (_opts && typeof _opts.onOpenAuth === 'function') _opts.onOpenAuth();
        });
        // ⚠️ ورود با کد هنوز در مودال حساب «به‌زودی» است — دکمه به همان مودال می‌رود تا وضعیت واقعی دیده شود
        const code = el('button', 'btn-clear', tr('wiz.accountCode', 'ورود با کد'));
        code.type = 'button';
        code.addEventListener('click', () => {
            finishTour();
            if (_opts && typeof _opts.onOpenAuth === 'function') _opts.onOpenAuth();
        });
        row.appendChild(tg);
        row.appendChild(code);
        sec.appendChild(row);
    }
    renderChrome(sec, {
        showBack: true,
        showNext: false,
        showSkip: false,
    });
    const done = el('button', 'btn-add picker-confirm', tr('wiz.finish', 'شروع'));
    done.type = 'button';
    done.addEventListener('click', () => finishTour());
    sec.appendChild(done);
}

/**
 * راه‌اندازی ویزارد (idempotent). فقط وقتی tourSeen=false صدا زده می‌شود.
 */
export function initWelcomeWizard(opts) {
    _opts = opts || {};
    const ov = overlay();
    if (!ov || !root()) return;
    _step = 0;
    renderStep();
    ov.hidden = false;
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && ov && !ov.hidden) finishTour();
    });
}

// ⚠️ فقط برای تست
export function __resetWizardForTest() {
    _step = 0;
    _opts = null;
}
export function __getStepForTest() {
    return _step;
}
