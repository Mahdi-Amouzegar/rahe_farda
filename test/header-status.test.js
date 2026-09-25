// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/header-status.test.js — تست‌های indicator وضعیت
//
// ⚠️ نکات مهم:
//   ۱. header-status.js یک ماژول singleton است (متغیرهای _started، _el، _updating).
//      پس initHeaderStatus() باید فقط یک بار در beforeAll صدا زده شود.
//
//   ۲. i18n.js در jsdom نمی‌تواند localeها را fetch کند (fetch وجود ندارد
//      یا فایل‌ها در دسترس نیستند). پس t() خود کلید را برمی‌گرداند.
//      برای تست دقیق tooltip، ما i18n را mock می‌کنیم.

import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// Mock i18n — فقط تابع t() رو override می‌کنیم
// ═══════════════════════════════════════════════════════════════════════════
//
// ⚠️ چرا از importOriginal استفاده می‌کنیم؟
//   - i18n.js چندین export داره (formatNumber, formatBytes, formatYear, ...)
//   - core.js از formatBytes استفاده می‌کنه (خط ۲۳۰)
//   - اگه فقط t رو mock کنیم و بقیه رو ندیم، core.js لود نمی‌شه
//   - با importOriginal، بقیه‌ی exportها از نسخه‌ی واقعی میان
//
// ⚠️ چرا فقط t رو override می‌کنیم؟
//   - t در jsdom به fetch وابسته‌ست (localeها fetch نمی‌شن)
//   - بقیه‌ی توابع (formatNumber, formatBytes) به fetch وابسته نیستن
//     و از نسخه‌ی واقعی به‌درستی کار می‌کنن

vi.mock('../js/i18n.js', async (importOriginal) => {
    const actual = await importOriginal();

    return {
        ...actual,

        // ⚠️ فقط t رو override می‌کنیم — بقیه از actual میان
        t: (key, params) => {
            const dict = {
                'header.status.online': 'آنلاین',
                'header.status.offline': 'آفلاین — فقط روی همین دستگاه',
                'header.status.offlineWithQueue': `آفلاین — ${params?.n ?? 0} تغییر در انتظار`,
                'header.status.pending': `${params?.n ?? 0} تغییر در انتظار همگام‌سازی`,
                'header.status.syncing': 'در حال همگام‌سازی…',
                'header.status.unknown': 'در حال بررسی…',
                'header.status.ariaOnline': 'آنلاین',
                'header.status.ariaOffline': `آفلاین، ${params?.n ?? 0} تغییر در انتظار همگام‌سازی`,
                'header.status.ariaPending': `${params?.n ?? 0} تغییر در انتظار`,
            };
            return dict[key] || key;
        },
    };
});

// ─── حالا import header-status (که از i18n mock استفاده می‌کند) ───
import { state } from '../js/core.js';
import * as headerStatus from '../js/header-status.js';

// ═══════════════════════════════════════════════════════════════════════════
// Setup یک‌بار برای همه‌ی تست‌ها
// ═══════════════════════════════════════════════════════════════════════════

beforeAll(() => {
    // ─── ساخت DOM مصنوعی ───
    document.body.innerHTML = `
        <button id="headerStatusIndicator" type="button" data-status="unknown">
            <span class="status-icon" aria-hidden="true">○</span>
            <span class="status-badge" hidden></span>
        </button>
    `;

    // ─── راه‌اندازی header-status (فقط یک بار) ───
    headerStatus.initHeaderStatus();
});

// ═══════════════════════════════════════════════════════════════════════════
// Reset state قبل از هر تست
// ═══════════════════════════════════════════════════════════════════════════

beforeEach(() => {
    // ─── reset state.net ───
    state.net = {
        online: true,
        lastChangeAt: 0,
        effectiveType: null,
        downlink: null,
        deviceId: null,
    };

    // ─── reset state.sync ───
    state.sync = {
        queue: [],
        inFlight: false,
        retries: 0,
        lastFlushAt: null,
        lastError: null,
        enabled: false,
        endpoint: null,
        authToken: null,
        userId: null,
        deviceId: null,
    };

    // ─── reset signature (جلوگیری از cache شدن) ───
    // ⚠️ headerStatus._lastSignature رو نمی‌تونیم مستقیم reset کنیم (داخلی).
    //    ولی با عوض کردن state، signature جدید ساخته می‌شه.
});

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('header-status — _computeStatus', () => {
    it('offline + queue > 0 → state offline', () => {
        state.net.online = false;
        state.sync.queue = [{ id: '1' }, { id: '2' }];

        headerStatus.updateHeaderStatus({ immediate: true });

        const el = document.getElementById('headerStatusIndicator');
        expect(el.dataset.status).toBe('offline');
        expect(el.title).toContain('آفلاین');
    });

    it('online + syncEnabled + inFlight → state syncing', () => {
        state.net.online = true;
        state.sync.enabled = true;
        state.sync.inFlight = true;

        headerStatus.updateHeaderStatus({ immediate: true });

        const el = document.getElementById('headerStatusIndicator');
        expect(el.dataset.status).toBe('syncing');
        expect(el.title).toContain('همگام‌سازی');
    });

    it('online + syncEnabled + queue > 0 → state pending', () => {
        state.net.online = true;
        state.sync.enabled = true;
        state.sync.inFlight = false;
        state.sync.queue = [{ id: '1' }];

        headerStatus.updateHeaderStatus({ immediate: true });

        const el = document.getElementById('headerStatusIndicator');
        expect(el.dataset.status).toBe('pending');
        expect(el.title).toContain('در انتظار');
    });

    it('online بدون sync → state online', () => {
        state.net.online = true;
        state.sync.enabled = false;
        state.sync.queue = [];

        headerStatus.updateHeaderStatus({ immediate: true });

        const el = document.getElementById('headerStatusIndicator');
        expect(el.dataset.status).toBe('online');
        expect(el.title).toContain('آنلاین');
    });

    it('unknown → state unknown', () => {
        state.net.online = undefined;

        headerStatus.updateHeaderStatus({ immediate: true });

        const el = document.getElementById('headerStatusIndicator');
        expect(el.dataset.status).toBe('unknown');
        expect(el.title).toContain('بررسی');
    });
});