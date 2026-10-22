// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/detail-sessions-anchor.test.js — سررسید «لنگر» دوره حذف‌ناشدنی است (10.27)
//
// ⚠️ گزارش کاربر: در جزئیات یک وظیفه‌ی دوره‌ای، اولین due-line (همان زمانی که
// برای شروع دوره انتخاب شده) با ✕ حذف می‌شد — مخصوصاً وقتی سررسیدهای بعدی را
// یکی‌یکی پاک می‌کردیم و همان اولی «فعال» می‌شد. حذفش دوره را بی‌ریشه می‌کند.

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../js/i18n.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, t: (key) => key };
});

import { state } from '../js/core.js';
import { renderDetailSessions } from '../js/detail.js';
import { anchorSessionId, isAnchorSession } from '../js/sessions.js';

const ROOT = '<span id="sessCount"></span><div id="sessList"></div>';

// تاریخ‌های دورِ آینده تا تست به زمان اجرا وابسته نباشد
const A1 = '2031-01-10T09:00:00.000Z';
const A2 = '2031-01-11T09:00:00.000Z';
const A3 = '2031-01-12T09:00:00.000Z';

function makeRecurTask(sessions) {
    return {
        id: 'r1',
        text: 'دوره',
        kind: 'task',
        priority: 'medium',
        recur: 'daily',
        sessions: sessions.map((at, i) => ({ id: 's' + (i + 1), at, remindMin: null, location: null })),
    };
}

const rows = () => [...document.querySelectorAll('#sessList .session-item')];
const deleteBtns = () => [...document.querySelectorAll('#sessList .btn-delete')];

beforeEach(() => {
    document.body.innerHTML = ROOT;
    state.tasks = [];
    state.currentDetailId = null;
});

describe('sessions — anchor helpers', () => {
    it('لنگر = قدیمی‌ترین جلسه', () => {
        const t = makeRecurTask([A2, A1, A3]);
        expect(anchorSessionId(t)).toBe('s2');
    });

    it('بدون جلسه → null', () => {
        expect(anchorSessionId({ sessions: [] })).toBe(null);
        expect(anchorSessionId(null)).toBe(null);
    });

    it('برای تسک غیرتکراری لنگر معنا ندارد', () => {
        const t = makeRecurTask([A1]);
        t.recur = 'none';
        expect(isAnchorSession(t, t.sessions[0])).toBe(false);
    });

    it('جلسه‌ی غیرلنگر لنگر نیست', () => {
        const t = makeRecurTask([A1, A2]);
        expect(isAnchorSession(t, t.sessions[0])).toBe(true);
        expect(isAnchorSession(t, t.sessions[1])).toBe(false);
    });
});

describe('detail sessions — ✕ روی لنگر', () => {
    it('ردیف فعال (لنگر) ✕ ندارد ولی یادآور/مکان دارد', () => {
        const t = makeRecurTask([A1, A2, A3]);
        state.tasks = [t];
        state.currentDetailId = 'r1';

        renderDetailSessions();

        const r = rows();
        expect(r).toHaveLength(3);
        // فقط ردیف اول فعال است؛ ردیف‌های بعدی سررسید آینده‌اند (نه غیرفعال)
        // ولی کنترل ویرایش ندارند.
        expect(r[0].classList.contains('active')).toBe(true);
        expect(r[1].classList.contains('active')).toBe(false);
        expect(r[2].classList.contains('active')).toBe(false);
        expect(r[1].querySelector('.sess-remind')).toBe(null);
        expect(r[2].querySelector('.sess-remind')).toBe(null);
        // لنگر: کنترل‌های ویرایش هست، ✕ نیست
        expect(r[0].querySelector('.sess-remind')).not.toBe(null);
        expect(r[0].querySelector('[data-sess-loc]')).not.toBe(null);
        expect(r[0].querySelector('.btn-delete')).toBe(null);
        // بقیه: هیچ کنترلی
        expect(deleteBtns()).toHaveLength(0);
    });

    it('اگر همه‌ی سررسیدهای بعدی حذف شوند، لنگر فعال می‌شود ولی ✕ نمی‌گیرد', () => {
        const t = makeRecurTask([A1]);
        state.tasks = [t];
        state.currentDetailId = 'r1';

        renderDetailSessions();

        const r = rows();
        expect(r).toHaveLength(1);
        expect(r[0].classList.contains('active')).toBe(true);
        expect(r[0].querySelector('.btn-delete')).toBe(null);
    });

    it('در تسک غیرتکراری حذف تاریخ همچنان ممکن است', () => {
        const t = makeRecurTask([A1]);
        t.recur = 'none';
        state.tasks = [t];
        state.currentDetailId = 'r1';

        renderDetailSessions();

        expect(deleteBtns()).toHaveLength(1);
    });
});
