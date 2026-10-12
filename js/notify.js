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

import { state } from './core.js';
import { findTask, saveTasks, rollforwardRecur } from './store.js';
import { allSessions, faShort, dayKey, isDueFireable, NEAR_DUE_MIN } from './sessions.js';
import { getCachedSharedAll, cacheSharedItems, fetchPeerTasks, fetchGroupTasks } from './tasks/source.js';
import { isOnline } from './net.js';
import { events, EV } from './events.js';
import { getNow } from './time.js';
import { savePrefs } from './map.js';
import { formatNumber, getLang, t as i18nT } from './i18n.js';

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
        labelKey: 'sound.preset.gentleBell'
    },
    'soft-chime': {
        file: 'software-interface.ogg',
        labelKey: 'sound.preset.softChime'
    },
    'digital-alert': {
        file: 'uplifting-bells.ogg',
        labelKey: 'sound.preset.digitalAlert'
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
        label: i18nT(val.labelKey),
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
            utter.lang = getLang() === 'en' ? 'en-US' : 'fa-IR';
        }

        // ⚠️ warning در Console (برای دیباگ)
        const wantsFa = getLang() !== 'en';
        if (wantsFa && !effectiveLang.toLowerCase().startsWith('fa')) {
            console.warn(
                '[TTS] Persian voice not found on system. ' +
                'Using English voice: ' + effectiveLang
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
    // ⚠️ 10.11-diag: مدرک شلیک (فقط سطح debug — در کنسول عادی دیده نمی‌شود).
    try { console.debug('[remind] fire:', title, tag); } catch { /* silent */ }
    const opts = { body, tag, icon: 'icons/icon-192.png', dir: 'rtl', lang: 'fa' };
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        // ⚠️ 10.11/BUG-05b: اول تگ قبلی بسته می‌شود — وگرنه showNotification با تگ
        // تکراری بی‌صدا جایگزین می‌کند (renotify پیش‌فرض false) و کاربر فقط صدای chime را می‌شنود.
        return closeTagNotifications(tag)
            .then(() => navigator.serviceWorker.ready)
            .then(reg => reg.showNotification(title, opts))
            .then(() => true)
            .catch(() => legacyNotif(title, opts));
    }
    return Promise.resolve(legacyNotif(title, opts));
}

async function closeTagNotifications(tag) {
    try {
        if (!tag || !('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return;
        const reg = await navigator.serviceWorker.ready;
        const list = await reg.getNotifications({ tag });
        list.forEach(n => { try { n.close(); } catch { /* silent */ } });
    } catch { /* silent */ }
}

/** نگهداشت آبجکت‌های legacy برای بستن تگ تکراری (معادل SW در تب بدون worker). */
const _legacyNotifs = new Map();

export function legacyNotif(title, opts) {
    try {
        const n = new Notification(title, opts);
        const tag = opts && opts.tag;
        if (tag) {
            try {
                const prev = _legacyNotifs.get(tag);
                if (prev && prev !== n && typeof prev.close === 'function') prev.close();
            } catch { /* silent */ }
            _legacyNotifs.set(tag, n);
        }
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
        // ⚠️ 10.11/BUG-05: «۵ دقیقه قبل» و «لحظه سررسید» پرچم جدا دارند؛ وگرنه
        // اولی دومی را برای همیشه می‌بلعد.
        if (which === 'due') s.remindedDue = true;
        else if (which === 'dueSoon') s.remindedDueSoon = true;
        else s.reminded = true;
        saveTasks();
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Shared reminders — پرچم محلی هر دستگاه (REQ-02)
// ═══════════════════════════════════════════════════════════════════════════
//
// ⚠️ چرا محلی؟ پرچم یادآور روی سرور مشترک است — اگر یک طرف ببیند، طرف دیگر
// نمی‌بیند. وضعیت per-user در سرور نیاز به مایگریشن دارد (خارج از scope)؛
// پس هر دستگاه برای خودش یادآوری می‌کند (ممکن است هر دستگاه یک بار بگوید).
// ⚠️ فقط آیتم‌های لودشده مقصد فعلی اسکن می‌شوند (بدون fetch اضافه).

const SHARED_REM_KEY = 'spaceTodoSharedReminded';
const SHARED_REM_CAP = 300;

function readSharedRem() {
    try {
        const v = JSON.parse(localStorage.getItem(SHARED_REM_KEY) || '{}');
        return v && typeof v === 'object' ? v : {};
    } catch {
        return {};
    }
}

function writeSharedRem(map) {
    try {
        const keys = Object.keys(map);
        if (keys.length > SHARED_REM_CAP) {
            for (const k of keys.slice(0, keys.length - SHARED_REM_CAP)) delete map[k];
        }
        localStorage.setItem(SHARED_REM_KEY, JSON.stringify(map));
    } catch { /* silent */ }
}

// ⚠️ 10.13: جلسه‌ای که با فاصله‌ی کمتر از ۲ ساعت ثبت شده،
// یادآور اصلی (مثلاً یک ساعت قبل) نمی‌دهد — هشدار فوری
// تودرتو و بی‌صرفه می‌شود. (یادآورهای ۵ دقیقه و لحظه‌ای
// همچنان فعال‌اند.)
const LEAD_REG_MIN = 120;

function leadRegisteredTooSoon(regAt, v) {
    const regMs = regAt ? new Date(regAt).getTime() : NaN;
    return Number.isFinite(regMs) && (v - regMs) < LEAD_REG_MIN * 60 * 1000;
}

/**
 * کدام جلسه‌های مشترک باید هشدار بدهند؟ (خالص و تست‌پذیر — شلیک نمی‌کند)
 * @returns {Array<{key:string, owner:string, at:string, kind:'lead'|'dueSoon'|'due', sessId:string}>}
 */
export function collectSharedDue(items, nowMs, flags) {
    const out = [];
    const seenKey = new Set();
    const rmDefault = (() => { try { return state.prefs.remindMin; } catch { return null; } })();
    for (const t of items || []) {
        if (!t || t.archived) continue;
        for (const s of (t.sessions || [])) {
            if (!s) continue;
            const v = new Date(s.at).getTime();
            if (!Number.isFinite(v)) continue;
            const key = `shr:${t.id}:${s.id}`;
            // ⚠️ نمای فعلی + کش ممکن است هم‌پوشانی داشته باشند — هر جلسه یک بار در هر اسکن.
            if (seenKey.has(key)) continue;
            seenKey.add(key);
            const f = (flags && flags[key]) || {};
            const owner = t.text || '';
            const rm = (s.remindMin != null) ? s.remindMin : rmDefault;
            const regAt = s.regAt != null ? s.regAt : t.createdAt;
            if (rm && rm > 0 && !f.reminded && nowMs >= v - rm * 60 * 1000 && nowMs < v
                && !leadRegisteredTooSoon(regAt, v)) {
                out.push({ key, owner, at: s.at, kind: 'lead', sessId: String(s.id) });
            }
            if (!f.remindedDueSoon && nowMs >= v - NEAR_DUE_MIN * 60 * 1000 && nowMs < v) {
                out.push({ key, owner, at: s.at, kind: 'dueSoon', sessId: String(s.id) });
            }
            if (nowMs >= v && isDueFireable(nowMs, v, f.remindedDue)) {
                out.push({ key, owner, at: s.at, kind: 'due', sessId: String(s.id) });
            }
        }
    }
    return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// Reminders check
// ═══════════════════════════════════════════════════════════════════════════

export function checkReminders() {
    const now = Date.now();

    // ⚠️ 10.11-fix: جلو بردن داده مستقل از تنظیم اعلان است — اگر پشت گیت‌های
    // remindOn/notifGranted باشد، با اعلان خاموش due-line هرگز زنده نمی‌شود.
    // (یادآورها پایین‌تر همچنان گیت خودشان را دارند.)
    let advanced = [];
    try {
        advanced = rollforwardRecur(state.tasks, now);
    } catch {
        advanced = [];
    }
    if (advanced.length > 0) {
        try { saveTasks(); } catch { /* saveTasks خودش لاگ می‌کند */ }
        // رندر زنده فقط وقتی صفحه دیده می‌شود (در تب مخفی: persist می‌شود ولی repaint نه —
        // موقع بازگشت، paintIfPending جبران می‌کند).
        if (typeof document === 'undefined' || !document.hidden) {
            paintAdvanced(advanced);
        } else {
            _pendingPaint = true;
        }
    }

    if (!state.prefs.remindOn) return;
    if (!notifGranted()) return;

    allSessions(true).forEach(s => {
        const rm = (s.remindMin != null) ? s.remindMin : state.prefs.remindMin;
        const v = new Date(s.at).getTime();
        if (isNaN(v)) return;

        // ۱. یادآور اصلی (مثلاً ۶۰ دقیقه قبل)
        // ⚠️ 10.13: ثبت با فاصله‌ی کمتر از ۲ ساعت → خاموش.
        if (rm && rm > 0) {
            const leadTarget = v - rm * 60 * 1000;
            if (!s.reminded && now >= leadTarget && now < v
                && !leadRegisteredTooSoon(s.regAt, v)) {
                fireNotification(
                    i18nT('notifications.reminder.title'),
                    `${s.owner} — ${faShort(s.at)}`,
                    'sess-' + s.id
                ).then(ok => {
                    if (ok) {
                        // ⚠️ TTS عنوان را می‌خواند
                        playChime(s.owner);
                        markReminded(s.taskId, s.id, 'lead');
                    }
                });
            }
        }

        // ۲. هشدار ۵ دقیقه قبل (فقط قبل از سررسید، با پرچم خودش).
        const nearDueTarget = v - NEAR_DUE_MIN * 60 * 1000;
        if (!s.remindedDueSoon && now >= nearDueTarget && now < v) {
            fireNotification(
                i18nT('notifications.reminder.dueSoonTitle'),
                `${s.owner} — ${faShort(s.at)}`,
                'due-' + s.id
            ).then(ok => {
                if (ok) {
                    playChime(s.owner);
                    markReminded(s.taskId, s.id, 'dueSoon');
                }
            });
        }

        // ۳. هشدار لحظه سررسید + جبران عقب‌افتادگی (تب بسته/رفرش دیر).
        // ⚠️ 10.11/BUG-05: پرچمش از شاخه ۲ جداست تا آن را نبلعد؛ و فقط از v به بعد تا دو هشدار هم‌زمان نیاید.
        if (now >= v && isDueFireable(now, v, s.remindedDue)) {
            fireNotification(
                i18nT('notifications.reminder.dueTitle'),
                `${s.owner} — ${faShort(s.at)}`,
                'due-' + s.id
            ).then(ok => {
                if (ok) {
                    playChime(s.owner);
                    markReminded(s.taskId, s.id, 'due');
                }
            });
        }
    });

    // ۴. یادآور مشترک (REQ-02 — محلی هر دستگاه، همه مقصدها).
    // ⚠️ REQ-02 کامل: اول کش همه مقصدها تازه می‌شود (پس‌زمینه گیت‌دار)، بعد اسکن.
    try {
        refreshSharedCacheForReminders().catch(() => {}).finally(() => {
            scanCachedShared(now);
        });
    } catch { /* silent */ }
}

/**
 * repaint لیست + جزئیاتِ باز بعد از جلو رفتن داده.
 */
function paintAdvanced(advanced) {
    try { events.emit(EV.UI_RENDER_REQUESTED); } catch { /* silent */ }
    try {
        const openId = state.currentDetailId != null ? String(state.currentDetailId) : null;
        if (openId && (advanced || []).includes(openId)) {
            import('./detail.js').then(m => {
                try { m.renderDetailSessions(); } catch { /* silent */ }
            }).catch(() => {});
        }
    } catch { /* silent */ }
}

/**
 * آیا در تب مخفی داده جلو رفته و repaint بدهکاریم؟ (BUG-07)
 */
let _pendingPaint = false;

export function paintIfPending() {
    if (!_pendingPaint) return false;
    _pendingPaint = false;
    paintAdvanced();
    return true;
}

/**
 * تازه‌سازی کش مقصدها برای یادآور (پس‌زمینه: گیت ورود/آنلاین/هم‌پوشانی، best-effort).
 */
let _sharedScanInflight = false;

async function refreshSharedCacheForReminders() {
    if (_sharedScanInflight) return;
    let me = null;
    try { me = state.sync && state.sync.userId ? String(state.sync.userId) : null; } catch { me = null; }
    if (!me) return;
    try { if (!isOnline()) return; } catch { return; }
    _sharedScanInflight = true;
    try {
        const [{ listConversations }, { listGroups }] = await Promise.all([
            import('./communication/conversations.js'),
            import('./communication/groups.js'),
        ]);
        const [convs, groups] = await Promise.all([
            listConversations().catch(() => null),
            listGroups().catch(() => null),
        ]);
        const jobs = [];
        const seen = new Set();
        for (const c of ((convs && convs.conversations) || [])) {
            const pid = c && c.user && c.user.id;
            if (!pid) continue;
            const key = 'peer:' + pid;
            if (seen.has(key)) continue;
            seen.add(key);
            const nm = (c.user.displayName || c.user.username || '');
            jobs.push(
                fetchPeerTasks(pid, me, nm)
                    .then(res => { if (res && res.ok) cacheSharedItems(key, res.items); })
                    .catch(() => {})
            );
        }
        for (const g of ((groups && groups.groups) || [])) {
            if (!g || !g.id) continue;
            const key = 'group:' + g.id;
            if (seen.has(key)) continue;
            seen.add(key);
            jobs.push(
                fetchGroupTasks(g.id, me)
                    .then(res => { if (res && res.ok) cacheSharedItems(key, res.items); })
                    .catch(() => {})
            );
        }
        if (jobs.length > 0) await Promise.all(jobs);
    } catch { /* silent */ }
    finally { _sharedScanInflight = false; }
}

/**
 * اسکن کش مشترک و شلیک هشدارها.
 */
function scanCachedShared(now) {
    try {
        const cached = getCachedSharedAll();
        if (Array.isArray(cached) && cached.length > 0) {
            const flags = readSharedRem();
            const due = collectSharedDue(cached, now, flags);
            if (due.length > 0) {
                for (const d of due) {
                    const titleKey = d.kind === 'due'
                        ? 'notifications.reminder.dueTitle'
                        : (d.kind === 'dueSoon' ? 'notifications.reminder.dueSoonTitle' : 'notifications.reminder.title');
                    const f = flags[d.key] || (flags[d.key] = {});
                    fireNotification(
                        i18nT(titleKey),
                        `${d.owner} — ${faShort(d.at)}`,
                        'sh-' + d.kind + '-' + d.sessId
                    ).then(ok => {
                        if (!ok) return;
                        playChime(d.owner);
                        if (d.kind === 'due') f.remindedDue = true;
                        else if (d.kind === 'dueSoon') f.remindedDueSoon = true;
                        else f.reminded = true;
                        writeSharedRem(flags);
                    });
                }
            }
        }
    } catch { /* silent */ }
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
        ? i18nT('notifications.digest.hasSessions', {
            n: formatNumber(todays.length),
            list: todays.slice(0, 3).map(s => s.owner).join('، '),
            more: todays.length > 3 ? i18nT('notifications.digest.more') : ''
        })
        : i18nT('notifications.digest.noSessions');
    fireNotification(i18nT('notifications.digest.title'), body, 'digest-' + day).then(ok => {
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
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) return;
        run();
        // ⚠️ 10.11/BUG-07: داده ممکن است در تب مخفی جلو رفته باشد — repaint بدهی را بده.
        try { paintIfPending(); } catch { /* silent */ }
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// Debug/test helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * تست یادآور صوتی (برای دکمه‌ی «تست» در تنظیمات).
 * @param {string} [titleText]
 */
export function testAudioReminder(titleText) {
    playChime(titleText || i18nT('notifications.testReminder'));
}