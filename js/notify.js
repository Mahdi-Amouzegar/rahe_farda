// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// notify.js -- offline reminders + morning digest + 3-mode audio (ESM)
//
// ⚠️ فاز ۵ گام ۳: یادآور صوتی سه‌حالته
//   - حالت ۱: ریتم پیش‌فرض (Web Audio API — دو نت ساده)
//   - حالت ۲: ریتم‌های آماده (فایل‌های ogg در assets/sounds/)
//   - حالت ۳: TTS (speechSynthesis — خواندن عنوان)
//
// اولویت پخش: پیش‌فرض → preset → TTS
// ═══════════════════════════════════════════════════════════════════════════

import { state, toFa } from './core.js';
import { findTask, saveTasks } from './store.js';
import { allSessions, faShort, dayKey } from './sessions.js';
import { getNow } from './time.js';
import { savePrefs } from './map.js';

// ═══════════════════════════════════════════════════════════════════════════
// Notification support
// ═══════════════════════════════════════════════════════════════════════════

export function notifSupported() {
    return 'Notification' in window;
}

export function notifGranted() {
    return notifSupported() && Notification.permission === 'granted';
}

export function updateNotifStatus() {
    const el = document.getElementById('notifStatus');
    if (!el) return;
    el.classList.remove('ok');
    if (!notifSupported()) {
        el.textContent = 'مرورگر شما اعلان پشتیبانی نمی‌کند.';
    } else if (Notification.permission === 'granted') {
        el.textContent = '✓ اعلان‌ها فعال‌اند.';
        el.classList.add('ok');
    } else if (Notification.permission === 'denied') {
        el.textContent = 'اعلان‌ها مسدود شده‌اند؛ از تنظیمات مرورگر فعال کنید.';
    } else {
        el.textContent = 'برای دریافت یادآور، دکمه فعال‌سازی را بزنید.';
    }
}

export async function ensureNotifPerm() {
    if (!notifSupported()) return false;
    if (Notification.permission === 'granted') return true;
    try {
        return (await Notification.requestPermission()) === 'granted';
    } catch {
        return false;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Audio — Web Audio API (حالت ۱: ریتم پیش‌فرض)
// ═══════════════════════════════════════════════════════════════════════════

let audioCtx = null;

export function ensureAudio() {
    try {
        if (!audioCtx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return null;
            audioCtx = new AC();
        }
        if (audioCtx.state === 'suspended') {
            const p = audioCtx.resume();
            if (p && typeof p.catch === 'function') p.catch(() => {});
        }
        return audioCtx;
    } catch {
        return null;
    }
}

/**
 * حالت ۱: ریتم پیش‌فرض — دو نت ساده با Web Audio API.
 * این همان playChime قدیمی است.
 */
function playDefaultChime() {
    try {
        ensureAudio();
        if (!audioCtx || audioCtx.state !== 'running') return;
        const t0 = audioCtx.currentTime;
        [[659.25, 0], [880, 0.35]].forEach(([freq, dt]) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.0001, t0 + dt);
            gain.gain.exponentialRampToValueAtTime(0.25, t0 + dt + 0.05);
            gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.9);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(t0 + dt);
            osc.stop(t0 + dt + 1);
        });
    } catch { /* نادیده */ }
}

// ═══════════════════════════════════════════════════════════════════════════
// Audio — presets (حالت ۲: ریتم‌های آماده)
// ═══════════════════════════════════════════════════════════════════════════

const SOUND_PRESETS = {
    'gentle-bell': {
        file: 'page-forward-single-chime.ogg',
        label: '🔔 زنگ ملایم'
    },
    'soft-chime': {
        file: 'software-interface.ogg',
        label: '💻 صدای دیجیتال'
    },
    'digital-alert': {
        file: 'uplifting-bells.ogg',
        label: '🎵 ناقوس‌های شاد'
    }
};

/**
 * برگرداندن مسیر کامل فایل صوتی بر اساس نام preset.
 * @param {string} presetName
 * @returns {string|null}
 */
function presetFilePath(presetName) {
    const preset = SOUND_PRESETS[presetName];
    if (!preset) return null;
    // نسبت به فایل HTML (index.html در ریشه)
    return `./assets/sounds/${preset.file}`;
}

/**
 * برگرداندن لیست presetها برای استفاده در UI.
 * @returns {Array<{ key: string, label: string, file: string }>}
 */
export function getSoundPresets() {
    return Object.entries(SOUND_PRESETS).map(([key, val]) => ({
        key,
        label: val.label,
        file: val.file
    }));
}

/**
 * حالت ۲: پخش فایل صوتی آماده.
 * @param {string} presetName - نام preset (مثل 'gentle-bell')
 */
function playPreset(presetName) {
    const path = presetFilePath(presetName);
    if (!path) return;
    try {
        const audio = new Audio(path);
        audio.volume = 0.7;
        // پخش با catch برای جلوگیری از unhandled promise rejection
        const p = audio.play();
        if (p && typeof p.catch === 'function') {
            p.catch(err => {
                // Autoplay policy ممکنه جلوش رو بگیره
                console.warn('Preset audio play failed:', err.message);
            });
        }
    } catch (err) {
        console.warn('Preset audio error:', err);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Audio — TTS (حالت ۳: خواندن عنوان)
// ═══════════════════════════════════════════════════════════════════════════

const TTS_DELAY_MS = 500; // تأخیر قبل از TTS (بعد از chime)

/**
 * بررسی پشتیبانی TTS.
 * @returns {boolean}
 */
export function ttsSupported() {
    return typeof window !== 'undefined' &&
        'speechSynthesis' in window &&
        typeof window.SpeechSynthesisUtterance === 'function';
}

/**
 * برگرداندن لیست voiceهای موجود.
 * ⚠️ در بعضی مرورگرها، لیست اول خالی است و باید به رویداد voiceschanged گوش داد.
 * @returns {SpeechSynthesisVoice[]}
 */
export function getAvailableVoices() {
    if (!ttsSupported()) return [];
    try {
        return window.speechSynthesis.getVoices() || [];
    } catch {
        return [];
    }
}

/**
 * فیلتر کردن voiceها برای زبان فعلی.
 * اگر زبان fa باشه، اول fa-IR رو ترجیح می‌ده.
 * @param {'fa'|'en'} lang
 * @returns {SpeechSynthesisVoice[]}
 */
export function getVoicesForLang(lang) {
    const all = getAvailableVoices();
    if (!all.length) return [];
    const target = lang === 'en' ? 'en' : 'fa';
    const exact = all.filter(v => v.lang && v.lang.toLowerCase().startsWith(target));
    if (exact.length) return exact;
    // fallback به همه
    return all;
}

/**
 * بررسی وجود voice فارسی در سیستم.
 * @returns {boolean}
 */
export function hasPersianTtsVoice() {
    const all = getAvailableVoices();
    return all.some(v => v.lang && v.lang.toLowerCase().startsWith('fa'));
}

/**
 * حالت ۳: خواندن متن با speechSynthesis.
 * @param {string} text
 */
function playTts(text) {
    if (!ttsSupported()) return;
    const clean = String(text || '').trim();
    if (!clean) return;
    try {
        // ⚠️ cancel قبلی
        try { window.speechSynthesis.cancel(); } catch { /* silent */ }

        const utter = new SpeechSynthesisUtterance(clean);
        const all = getAvailableVoices();
        
        // ⚠️ ترتیب اولویت انتخاب voice:
        //   1. voice انتخابی کاربر
        //   2. voice فارسی (fa-IR)
        //   3. voice انگلیسی (en-US / en-GB)
        //   4. اولین voice موجود
        const preferred = state.prefs.soundTtsVoice;
        let chosen = null;
        let effectiveLang = 'fa-IR';

        if (preferred) {
            chosen = all.find(v => v.name === preferred);
        }
        if (!chosen) {
            chosen = all.find(v => v.lang && v.lang.toLowerCase().startsWith('fa'));
        }
        if (!chosen) {
            // fallback به انگلیسی
            chosen = all.find(v => v.lang && /^en/i.test(v.lang));
        }
        if (!chosen && all.length > 0) {
            chosen = all[0];
        }

        if (chosen) {
            utter.voice = chosen;
            utter.lang = chosen.lang;
            effectiveLang = chosen.lang;
        } else {
            utter.lang = state.prefs.lang === 'en' ? 'en-US' : 'fa-IR';
        }

        // ⚠️ warning در Console (برای دیباگ)
        const wantsFa = state.prefs.lang !== 'en';
        if (wantsFa && !effectiveLang.toLowerCase().startsWith('fa')) {
            console.warn(
                '[TTS] voice فارسی در سیستم یافت نشد. ' +
                'از voice انگلیسی استفاده می‌شود: ' + effectiveLang
            );
        }

        utter.rate = 0.95;
        utter.pitch = 1.0;
        utter.volume = 1.0;

        // ⚠️ تأخیر کوچک قبل از speak (برای autoplay policy)
        setTimeout(() => {
            try {
                window.speechSynthesis.speak(utter);
            } catch (err) {
                console.warn('TTS speak failed:', err);
            }
        }, 50);
    } catch (err) {
        console.warn('TTS error:', err);
    }
}

/**
 * توقف TTS در حال پخش.
 */
export function stopTts() {
    if (!ttsSupported()) return;
    try {
        window.speechSynthesis.cancel();
    } catch { /* silent */ }
}

// ═══════════════════════════════════════════════════════════════════════════
// playChime — نقطه‌ی ورود اصلی (سه‌حالته)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * پخش یادآور صوتی سه‌حالته.
 *
 * اولویت پخش:
 *   1. ریتم پیش‌فرض (اگر soundDefault !== false)
 *   2. ریتم آماده (اگر soundPresetOn && soundPreset)
 *   3. TTS (اگر soundTtsOn) — با تأخیر ۵۰۰ms
 *
 * @param {string} [titleText] - متن عنوان برای TTS (اختیاری)
 */
export function playChime(titleText) {
    // سازگاری: soundOn قدیمی به عنوان master switch
    if (state.prefs.soundOn === false) return;

    const wantDefault = state.prefs.soundDefault !== false;
    const wantPreset = state.prefs.soundPresetOn === true && state.prefs.soundPreset;
    const wantTts = state.prefs.soundTtsOn === true;

    // حالت ۱: پیش‌فرض
    if (wantDefault) {
        playDefaultChime();
    }

    // حالت ۲: preset
    if (wantPreset) {
        playPreset(state.prefs.soundPreset);
    }

    // حالت ۳: TTS (با تأخیر)
    if (wantTts && titleText) {
        setTimeout(() => {
            playTts(titleText);
        }, TTS_DELAY_MS);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Notification firing
// ═══════════════════════════════════════════════════════════════════════════

export function fireNotification(title, body, tag) {
    if (!notifGranted()) return Promise.resolve(false);
    const opts = { body, tag, icon: 'icons/icon-192.png', dir: 'rtl', lang: 'fa' };
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        return navigator.serviceWorker.ready
            .then(reg => reg.showNotification(title, opts))
            .then(() => true)
            .catch(() => legacyNotif(title, opts));
    }
    return Promise.resolve(legacyNotif(title, opts));
}

export function legacyNotif(title, opts) {
    try {
        new Notification(title, opts);
        return true;
    } catch {
        return false;
    }
}

function markReminded(taskId, sessId, which) {
    const found = findTask(taskId);
    if (!found) return;
    const s = (found.task.sessions || []).find(x => String(x.id) === String(sessId));
    if (s) {
        if (which === 'due') s.remindedDue = true;
        else s.reminded = true;
        saveTasks();
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Reminders check
// ═══════════════════════════════════════════════════════════════════════════

export function checkReminders() {
    if (!state.prefs.remindOn) return;
    if (!notifGranted()) return;
    const now = Date.now();
    const REMINDER_GRACE = 2 * 60 * 1000;
    const NEAR_DUE_MIN = 5;
    allSessions(true).forEach(s => {
        const rm = (s.remindMin != null) ? s.remindMin : state.prefs.remindMin;
        const v = new Date(s.at).getTime();
        if (isNaN(v)) return;

        // ۱. یادآور اصلی (مثلاً ۶۰ دقیقه قبل)
        if (rm && rm > 0) {
            const leadTarget = v - rm * 60 * 1000;
            if (!s.reminded && now >= leadTarget && now < v) {
                fireNotification('⏰ یادآور جلسه', `${s.owner} — ${faShort(s.at)}`, 'sess-' + s.id).then(ok => {
                    if (ok) {
                        // ⚠️ TTS عنوان را می‌خواند
                        playChime(s.owner);
                        markReminded(s.taskId, s.id, 'lead');
                    }
                });
            }
        }

        // ۲. هشدار ۵ دقیقه قبل (همیشه، مستقل از rm)
        const nearDueTarget = v - NEAR_DUE_MIN * 60 * 1000;
        if (!s.remindedDue && now >= nearDueTarget && now < v && now - nearDueTarget <= REMINDER_GRACE) {
            fireNotification('🔔 ۵ دقیقه تا جلسه', `${s.owner} — ${faShort(s.at)}`, 'due-' + s.id).then(ok => {
                if (ok) {
                    playChime(s.owner);
                    markReminded(s.taskId, s.id, 'due');
                }
            });
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// Digest
// ═══════════════════════════════════════════════════════════════════════════

export function checkDigest() {
    if (!state.prefs.digestOn || !notifGranted()) return;
    const now = getNow();
    if (now.getHours() < 6) return;
    const day = dayKey(now);
    if (state.prefs.lastDigest === day) return;

    // نکته: allSessions(false) چون می‌خواهیم همه جلسات امروز (حتی completed) را ببینیم
    const todays = allSessions(false).filter(s => dayKey(new Date(s.at)) === day);
    const body = todays.length
        ? `امروز ${toFa(todays.length)} جلسه داری: ${todays.slice(0, 3).map(s => s.owner).join('، ')}${todays.length > 3 ? ' و…' : ''}`
        : 'امروز جلسه‌ای نداری 🎉';
    fireNotification('📅 برنامه امروز', body, 'digest-' + day).then(ok => {
        if (ok) {
            playChime();
            state.prefs.lastDigest = day;
            savePrefs();
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// Reminder loop
// ═══════════════════════════════════════════════════════════════════════════

export function startReminderLoop() {
    const run = () => {
        try {
            checkReminders();
            checkDigest();
        } catch (e) {
            console.error('reminder loop error', e);
        }
    };
    run();
    setInterval(run, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) run(); });
}

// ═══════════════════════════════════════════════════════════════════════════
// Debug/test helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * تست یادآور صوتی (برای دکمه‌ی «تست» در تنظیمات).
 * @param {string} [titleText]
 */
export function testAudioReminder(titleText) {
    playChime(titleText || 'این یک یادآور آزمایشی است');
}