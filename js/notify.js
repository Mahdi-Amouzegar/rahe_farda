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

import { state, uid } from './core.js';
import { findTask, saveTasks, rollforwardRecur, advanceRecur, ROLLFORWARD_GUARD } from './store.js';
import { allSessions, faShort, dayKey, isDueFireable, NEAR_DUE_MIN } from './sessions.js';
import { getCachedSharedAll, cacheSharedItems, fetchPeerTasks, fetchGroupTasks, persistAdvancedShared, shouldRefreshSharedKey, getSharedItems } from './tasks/source.js';
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

// ⚠️ 10.21/BUG-21: ساخت AudioContext بدون ژست کاربر → هشدار کروم
// «The AudioContext was not allowed to start...» و کانتکست در حالت
// suspended می‌ماند (صدای یادآور بی‌صدا). پس تا نخستین ژست واقعی
// هیچ کانتکستی نمی‌سازیم؛ ژست با `installAudioUnlock()` گرفته می‌شود.
let _audioGestureSeen = false;
let _audioUnlockBound = false;

/**
 * ساخت/آنلاک کانتکست صوتی. باید از داخل ژست کاربر صدا زده شود.
 * @returns {boolean} — آیا کانتکست آماده (running) است؟
 */
export function unlockAudio() {
    try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        if (!audioCtx) audioCtx = new AC();
        _audioGestureSeen = true;
        if (audioCtx.state === 'suspended') {
            const p = audioCtx.resume();
            if (p && typeof p.catch === 'function') p.catch(() => {});
        }
        return audioCtx.state === 'running';
    } catch {
        return false;
    }
}

/**
 * نصب آنلاک صوتی روی نخستین تعامل کاربر (یک بار).
 * ⚠️ capture=true تا قبل از هندلر خود دکمه اجرا شود.
 */
export function installAudioUnlock() {
    if (_audioUnlockBound) return;
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    _audioUnlockBound = true;
    const types = ['pointerdown', 'keydown', 'touchstart'];
    const handler = () => {
        let ok = false;
        try { ok = unlockAudio(); } catch { ok = false; }
        if (!ok) return; // کانتکست ساخته شد ولی هنوز suspended → ژست بعدی
        for (const t of types) {
            try { document.removeEventListener(t, handler, true); } catch { /* silent */ }
        }
    };
    for (const t of types) {
        try { document.addEventListener(t, handler, true); } catch { /* silent */ }
    }
}

export function ensureAudio() {
    try {
        if (!audioCtx) {
            // ⚠️ 10.21: بدون ژست نساز (هشدار + کانتکست مرده)
            if (!_audioGestureSeen) return null;
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
    // ⚠️ 10.21/BUG-21: بدون ژست کاربر هم Web Audio و هم <audio> مسدودند
    // (نتیجه: هشدار کنسول + بی‌صدایی). تا آنلاک نشدن تلاش نمی‌کنیم.
    if (!_audioGestureSeen) return;

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
/**
 * نخستین جلسه‌ی آینده‌ی هر تسک (10.18 — گیت هشدار ۵ دقیقه‌ای).
 * هشدار «کمتر از ۵ دقیقه» فقط برای جلسه‌ی فعلی (نخستین آینده)
 * است — جلسات از دست رفته‌ی دوره‌ها فقط هشدار «زمان رسید»
 * می‌گیرند، تا در بازگشایی صفحه تعداد نوتیف‌ها کم شود.
 * @param {Array<{taskId:(string|number), at:string}>} entries
 * @param {number} nowMs
 * @returns {Map<string, number>} taskId -> زمان نخستین جلسه‌ی آینده
 */
export function nextSessionAtMap(entries, nowMs) {
    const map = new Map();
    for (const e of entries || []) {
        if (!e || e.at == null || e.taskId == null) continue;
        const v = new Date(e.at).getTime();
        if (!Number.isFinite(v) || v <= nowMs) continue;
        const k = String(e.taskId);
        const cur = map.get(k);
        if (cur === undefined || v < cur) map.set(k, v);
    }
    return map;
}

export function collectSharedDue(items, nowMs, flags) {
    const out = [];
    const seenKey = new Set();
    const rmDefault = (() => { try { return state.prefs.remindMin; } catch { return null; } })();
    // ⚠️ 10.18: هشدار ۵ دقیقه‌ای فقط برای جلسه‌ی فعلی هر تسک
    const nextAt = nextSessionAtMap(
        (items || []).flatMap(t => (t && !t.archived && Array.isArray(t.sessions))
            ? t.sessions.map(s => ({ taskId: t.id, at: s.at }))
            : []),
        nowMs);
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
            // ⚠️ 10.18: فقط جلسه‌ی فعلی (نخستین آینده) — جلسات
            // از دست رفته فقط هشدار «زمان رسید» می‌گیرند.
            if (!f.remindedDueSoon && nextAt.get(String(t.id)) === v
                && nowMs >= v - NEAR_DUE_MIN * 60 * 1000 && nowMs < v) {
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

    // ⚠️ 10.21/BUG-20: سری‌های مشترک (DM/گروه) هم باید مستقل از تنظیم اعلان
    // جلو بروند — دقیقاً همان دلیلی که 10.11-fix برای شخصی حل کرد. قبلاً این
    // کار داخل `scanCachedShared` و پشت گیت‌های remindOn/notifGranted بود؛
    // با اعلان خاموش، due-line تسک مشترک هرگز به «جلسه‌ی بعدی» نمی‌رفت.
    let sharedAdvanced = [];
    try {
        sharedAdvanced = rollforwardSharedCache(now);
    } catch {
        sharedAdvanced = [];
    }
    if (sharedAdvanced.length > 0) {
        if (typeof document === 'undefined' || !document.hidden) {
            paintSharedAdvanced(sharedAdvanced);
        } else {
            _pendingPaint = true;
        }
    }

    if (!state.prefs.remindOn) return;
    if (!notifGranted()) return;

    const allSess = allSessions(true);
    // ⚠️ 10.18: هشدار ۵ دقیقه‌ای فقط برای جلسه‌ی فعلی هر تسک
    const nextAt = nextSessionAtMap(allSess, now);
    allSess.forEach(s => {
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
        // ⚠️ 10.18: فقط جلسه‌ی فعلی (نخستین آینده) — جلسات از دست
        // رفته‌ی دوره‌ها فقط هشدار «زمان رسید» می‌گیرند.
        const nearDueTarget = v - NEAR_DUE_MIN * 60 * 1000;
        if (!s.remindedDueSoon && nextAt.get(String(s.taskId)) === v
            && now >= nearDueTarget && now < v) {
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
    // ⚠️ 10.17: اسکن فوری از کش فعلی — مستقل از شبکه. سرور گاهی
    // ۲-۵ ثانیه (یا بیشتر) پاسخ می‌دهد؛ اگر اسکن منتظر تازه‌سازی
    // بماند، یادآورها چند دقیقه صف می‌شوند و با جبران ۱۵ دقیقه‌ای
    // یکجا شلیک می‌شوند. تازه‌سازی پس‌زمینه، بعد از اتمام یک
    // اسکن دوم (با داده‌ی تازه‌تر) می‌دهد.
    try {
        scanCachedShared(now);
    } catch { /* silent */ }
    refreshSharedCacheForReminders()
        .catch(() => {})
        .finally(() => {
            _sharedFirstScanDone = true;
            try { scanCachedShared(Date.now()); } catch { /* silent */ }
        });
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
 * repaint بعد از جلو رفتن سری مشترک (10.21/BUG-20).
 * ⚠️ جزئیات (detail.js) فقط تسک‌های شخصی را می‌شناسد (`findTask`) — آیتم
 * مشترک read-only است و در همان لیست دیده می‌شود؛ پس فقط رندر لیست لازم است.
 */
function paintSharedAdvanced(advanced) {
    if (!advanced || advanced.length === 0) return;
    try { events.emit(EV.UI_RENDER_REQUESTED); } catch { /* silent */ }
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
 *
 * ⚠️ 10.20/BUG-19: قبلاً «همه‌ی مقصدها هر ۱۰ دقیقه» بود؛ دو شکاف داشت:
 *   ۱) مقصد باز، لیست تازه را می‌گرفت ولی در کش یادآور نوشته نمی‌شد.
 *   ۲) تسک تازه‌ی طرف مقابل تا تیک بعدی (۱۰ دقیقه) دیده نمی‌شد و اگر نزدیک
 *      سررسید ساخته می‌شد، از پنجره‌ی جبران ۱۵دقیقه‌ای جا می‌ماند.
 * حالا اول یک سیگنال ارزان می‌گیریم و فقط مقصدِ تغییرکرده را می‌خوانیم:
 *   - DM: `/api/dm/unread` هم شمارنده و هم `activity` (آخرین updated_at هر
 *     مخاطب) را می‌دهد — همه‌ی مخاطبان، حتی اولین‌تماسِ تأییدنشده که در
 *     `listConversations` (فقط accepted) نیست.
 *   - گروه: `/api/groups` فیلد `lastActivity` هر گروه را دارد.
 */
let _sharedFirstScanDone = false;

let _sharedScanInflight = false;

async function refreshSharedCacheForReminders() {
    if (_sharedScanInflight) return;
    let me = null;
    try { me = state.sync && state.sync.userId ? String(state.sync.userId) : null; } catch { me = null; }
    if (!me) return;
    try { if (!isOnline()) return; } catch { return; }
    _sharedScanInflight = true;
    try {
        const [{ listConversations }, { listGroups }, { getDmUnread }] = await Promise.all([
            import('./communication/conversations.js'),
            import('./communication/groups.js'),
            import('./communication/dm-tasks.js'),
        ]);
        const [convs, groups, unread] = await Promise.all([
            listConversations().catch(() => null),
            listGroups().catch(() => null),
            getDmUnread().catch(() => null),
        ]);

        const nameByPeer = new Map();
        for (const c of ((convs && convs.conversations) || [])) {
            const pid = c && c.user && c.user.id;
            if (!pid) continue;
            nameByPeer.set(String(pid), (c.user.displayName || c.user.username || null));
        }

        // سیگنال فعالیت: همه‌ی مخاطبان DM (accepted + اولین‌تماس) از unread.activity
        const activityByPeer = new Map();
        for (const row of ((unread && unread.ok && unread.unread && unread.unread.activity) || [])) {
            if (!row || !row.peerId) continue;
            activityByPeer.set(String(row.peerId), row.lastActivity || null);
        }
        // مخاطب accepted که هنوز هیچ تسکی ندارد هم یک بار کش شود (لیست خالی)
        for (const pid of nameByPeer.keys()) {
            if (!activityByPeer.has(pid)) activityByPeer.set(pid, null);
        }

        const jobs = [];
        for (const [pid, activityAt] of activityByPeer) {
            const key = 'peer:' + pid;
            if (!shouldRefreshSharedKey(key, activityAt)) continue;
            jobs.push(
                fetchPeerTasks(pid, me, nameByPeer.get(pid) || null)
                    .then(res => { if (res && res.ok) cacheSharedItems(key, res.items); })
                    .catch(() => {})
            );
        }
        for (const g of ((groups && groups.groups) || [])) {
            if (!g || !g.id) continue;
            const key = 'group:' + g.id;
            if (!shouldRefreshSharedKey(key, g.lastActivity)) continue;
            jobs.push(
                // ⚠️ 10.15: lite — نام/آواتار برای یادآور لازم نیست (نصف درخواست‌ها)
                fetchGroupTasks(g.id, me, { lite: true })
                    .then(res => { if (res && res.ok) cacheSharedItems(key, res.items); })
                    .catch(() => {})
            );
        }
        if (jobs.length > 0) {
            try { console.debug('[remind] shared refresh:', jobs.length); } catch { /* silent */ }
            await Promise.all(jobs);
        }
    } catch { /* silent */ }
    finally { _sharedScanInflight = false; }
}

/**
 * جلو بردن یک آیتم مشترک (معادل visit در rollforwardRecur).
 * ⚠️ 10.16: سری‌های مشترک روی سرور فقط جلسات زمان ساخت را دارند —
 * بدون این، هشدار به‌موقع و سررسید بعدی هرگز ظاهر نمی‌شوند.
 * id جلسه‌ی ساخته‌شده قطعی است (taskId@at) تا چند دستگاه روی یک
 * سررسید همگرا شوند و هشدار دوگانه نیاید.
 */
function advanceSharedRecur(t, nowMs) {
    if (!t || t.archived || t.completed) return false;
    if (!t.recur || t.recur === 'none') return false;
    const list = t.sessions;
    if (!Array.isArray(list) || list.length === 0) return false;
    const latestOf = () => {
        let m = -Infinity;
        for (const s of list) {
            const v = new Date(s.at).getTime();
            if (Number.isFinite(v) && v > m) m = v;
        }
        return m;
    };
    if (!(latestOf() <= nowMs)) return false;
    let changed = false;
    let guard = 0;
    while (guard++ < ROLLFORWARD_GUARD) {
        if (!(latestOf() <= nowMs)) break;
        if (!advanceRecur(t)) break;
        const s = list[list.length - 1];
        if (s) s.id = String(t.id) + '@' + s.at;
        changed = true;
    }
    if (changed && latestOf() <= nowMs) {
        // غیبت طولانی: فروپاشی به یک جلسه آینده از اکنون
        const scratch = {
            recur: t.recur,
            recurN: t.recurN,
            recurMin: t.recurMin,
            recurDays: Array.isArray(t.recurDays) ? [...t.recurDays] : [],
            sessions: [{ id: 'seed', at: new Date(nowMs).toISOString() }],
        };
        if (advanceRecur(scratch) && scratch.sessions.length > 1) {
            const s = scratch.sessions[scratch.sessions.length - 1];
            s.id = String(t.id) + '@' + s.at;
            t.sessions = scratch.sessions.slice(-1);
        }
    }
    return changed;
}

/**
 * جلو بردن سری‌های مشترک در کش مقصدها (حلقه‌ی یادآور).
 * آیتم‌های خودی را به سرور می‌نویسد (fire-and-forget؛ شکست →
 * دوره‌ی بعدی بعد از تازه‌سازی کش دوباره تلاش می‌کند).
 *
 * ⚠️ 10.21/BUG-20: علاوه بر کش، **لیست روی صفحه** هم جلو برده می‌شود.
 * دلیل: کش و لیست می‌توانند دو آرایه/آبجکت جدا با همان id باشند (اسکن
 * پس‌زمینه آرایه‌ی تازه می‌سازد و تا تیک بعدی موتور زنده، لیست صفحه
 * همان قبلی می‌ماند). بدون این، due-line نمای باز تا رفرش دستی کهنه بود.
 * id جلسه قطعی است (`taskId@at`) پس هر دو نسخه به یک نتیجه می‌رسند.
 *
 * @returns {Array} آیتم‌های جلو رفته (هر id حداکثر یک بار)
 */
export function rollforwardSharedCache(nowMs) {
    const advanced = [];
    const seenObj = new Set();
    const seenId = new Set();
    const persistList = [];
    const persistIds = new Set();
    const lists = [];
    try { lists.push(getCachedSharedAll()); } catch { /* silent */ }
    try { lists.push(getSharedItems()); } catch { /* silent */ }
    for (const list of lists) {
        for (const t of (list || [])) {
            if (!t || seenObj.has(t)) continue;
            seenObj.add(t);
            let changed = false;
            try { changed = advanceSharedRecur(t, nowMs); } catch { changed = false; }
            if (!changed) continue;
            const id = String(t.id);
            if (!seenId.has(id)) {
                seenId.add(id);
                advanced.push(t);
            }
            if (t._shared && t._shared.mine && !persistIds.has(id)) {
                persistIds.add(id);
                persistList.push(t);
            }
        }
    }
    for (const t of persistList) {
        persistAdvancedShared(t).catch(() => { /* آفلاین */ });
    }
    return advanced;
}

/**
 * گیت شلیک دوگانه (10.17): اسکن فوری + اسکن پس از تازه‌سازی
 * می‌توانند همزمان بیفتند (پرچم‌ها تا resolve شدن نوتیف ثبت
 * نمی‌شوند) — هر (جلسه، نوع) را در ۹۰ ثانیه حداکثر یک بار
 * شلیک می‌دهد.
 */
const _firedSharedKeys = new Map();

export function firedSharedKey(key, kind, nowMs) {
    const k = key + ':' + kind;
    const exp = _firedSharedKeys.get(k);
    if (exp !== undefined && exp > nowMs) return true;
    _firedSharedKeys.set(k, nowMs + 90000);
    if (_firedSharedKeys.size > 500) {
        for (const [kk, ee] of _firedSharedKeys) {
            if (ee <= nowMs) _firedSharedKeys.delete(kk);
        }
    }
    return false;
}

/**
 * اسکن کش مشترک و شلیک هشدارها.
 */
function scanCachedShared(now) {
    try {
        const cached = getCachedSharedAll();
        if (Array.isArray(cached) && cached.length > 0) {
            // ⚠️ 10.16: اول سری‌های مشترک جلو می‌روند (جلسات آینده ساخته می‌شود)
            rollforwardSharedCache(now);
            const flags = readSharedRem();
            const due = collectSharedDue(cached, now, flags)
                .filter(d => !firedSharedKey(d.key, d.kind, now));
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

/**
 * وظایف امروز — شخصی + مشترک (10.19، محض و تست‌پذیر).
 * @param {Array} personalSessions خروجی allSessions(false)
 * @param {Array} sharedItems آیتم‌های کش مقصدها
 * @param {string} day کلید روز (dayKey)
 * @returns {Array<{owner:string, at:string}>} مرتب‌شده بر اساس زمان
 */
export function todaySessions(personalSessions, sharedItems, day) {
    const out = [];
    for (const s of personalSessions || []) {
        if (s && dayKey(new Date(s.at)) === day) out.push({ owner: s.owner, at: s.at });
    }
    for (const t of sharedItems || []) {
        if (!t || t.archived) continue;
        for (const s of (t.sessions || []) || []) {
            if (s && dayKey(new Date(s.at)) === day) out.push({ owner: t.text, at: s.at });
        }
    }
    out.sort((a, b) => new Date(a.at) - new Date(b.at));
    return out;
}

export function checkDigest() {
    if (!state.prefs.digestOn || !notifGranted()) return;
    const now = getNow();
    if (now.getHours() < 6) return;
    const day = dayKey(now);
    if (state.prefs.lastDigest === day) return;
    // ⚠️ 10.19: اگر کاربر وارد شده، صبر کن تا نخستین اسکن
    // مقصدهای مشترک تمام شود (کش هنوز خالی است) — در غیر
    // این صورت نوتیف فقط وظایف شخصی را می‌شمارد.
    let loggedIn = false;
    try { loggedIn = !!(state.sync && state.sync.userId); } catch { /* silent */ }
    if (loggedIn && !_sharedFirstScanDone) return;

    const todays = todaySessions(allSessions(false), getCachedSharedAll(), day);
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
    // ⚠️ 10.21: این تابع از دکمه‌ی «تست» صدا زده می‌شود (ژست کاربر) — همان‌جا
    // کانتکست را آنلاک کن تا در بازکردن اول با هشدار کروم روبه‌رو نشویم.
    try { unlockAudio(); } catch { /* silent */ }
    playChime(titleText || i18nT('notifications.testReminder'));
}