// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// time.js -- server-corrected clock (ESM)

import { state } from './core.js';

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

// timeout برای هر سرور — کوتاه‌تر از قبل (بود ۶ ثانیه)
// با ۲.۵ ثانیه، اگر اینترنت ضعیف باشد، کاربر سریع‌تر متوجه می‌شود
const SYNC_TIMEOUT_MS = 2500;

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

export function getNow() {
    return new Date(Date.now() + state.timeOffsetMs);
}

export async function syncServerTime() {
    const icon = document.getElementById('timeSourceIcon');
    if (!icon) return;

    const sources = [
        {
            label: 'timeapi.io',
            fn: async (signal) => {
                const r = await fetch('https://timeapi.io/api/time/current/zone?timeZone=Asia%2FTehran', { signal });
                if (!r.ok) throw new Error('bad response');
                const j = await r.json();
                const ms = Date.parse(j.dateTime);
                if (!Number.isFinite(ms)) throw new Error('bad date');
                return ms;
            }
        },
        {
            label: 'worldclockapi.com',
            fn: async (signal) => {
                const r = await fetch('https://worldclockapi.com/api/json/utc/now', { signal });
                if (!r.ok) throw new Error('bad response');
                const j = await r.json();
                const ms = Date.parse(j.currentDateTime);
                if (!Number.isFinite(ms)) throw new Error('bad date');
                return ms;
            }
        },
        {
            label: 'worldtimeapi.org',
            fn: async (signal) => {
                const r = await fetch('https://worldtimeapi.org/api/timezone/Asia/Tehran', { signal });
                if (!r.ok) throw new Error('bad response');
                const j = await r.json();
                const ms = typeof j.unixtime === 'number' ? j.unixtime * 1000 : Date.parse(j.datetime);
                if (!Number.isFinite(ms)) throw new Error('bad date');
                return ms;
            }
        }
    ];

    icon.textContent = '🕐';
    icon.title = i18nT('header.timeSource.connecting');
    icon.classList.remove('online', 'offline');

    for (let i = 0; i < sources.length; i++) {
        const source = sources[i];
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), SYNC_TIMEOUT_MS);

        try {
            // نمایش وضعیت در حال اتصال (۱/۳)، (۲/۳)، ...
            icon.title = `در حال اتصال (${i + 1}/${sources.length}) — ${source.label}...`;

            const ms = await source.fn(ctrl.signal);
            if (!Number.isFinite(ms)) continue;

            state.timeOffsetMs = ms - Date.now();
            icon.textContent = '🕐';
            icon.title = `✓ زمان آنلاین (${source.label}) — همگام با سرور اینترنتی`;
            icon.classList.remove('offline');
            icon.classList.add('online');
            return;
        } catch {
            // سرور بعدی را امتحان کن
        } finally {
            clearTimeout(timer);
        }
    }

    // همه‌ی سرورها ناموفق بودند — آفلاین
    icon.textContent = '🕐';
    icon.title = '⚠ آفلاین — مبنا ساعت دستگاه است';
    icon.classList.remove('online');
    icon.classList.add('offline');
}

// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ گام ۱۵: SHIM‌ها حذف شدند
// ═══════════════════════════════════════════════════════════════════════════