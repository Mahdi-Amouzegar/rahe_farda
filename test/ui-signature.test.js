// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/ui-signature.test.js — امضای رندر لیست (10.24 / T-12)
// ⚠️ از render-diff.js (ماژول خالص، بدون DOM) تست می‌شود.

import { describe, it, expect, beforeEach } from 'vitest';
import { listSignature } from '../js/render-diff.js';
import { state } from '../js/core.js';

beforeEach(() => {
    state.currentFilter = 'all';
    state.currentSort = 'newest';
    state.searchQuery = '';
    state.selectedDay = null;
    state.expandedPlans = new Set();
    state.editingId = null;
});

function plan(text) {
    return {
        id: 'p1',
        text,
        completed: false,
        kind: 'plan',
        priority: 'medium',
        children: [
            { id: 'c1', text: 'رزرو هتل', completed: false, priority: 'medium', sessions: [] },
            { id: 'c2', text: 'خرید بلیت', completed: false, priority: 'medium', sessions: [] },
        ],
        sessions: [],
    };
}

const sig = (tasks) => listSignature(tasks, tasks.map(t => String(t.id)), state);

describe('render-diff — listSignature (10.24/T-12)', () => {
    it('تغییر عنوان زیرکار امضا را عوض می‌کند (رندر کامل → لیست تازه)', () => {
        const t = plan('سفر شمال');
        const before = sig([t]);
        t.children[0].text = 'رزرو هتل و پرواز';
        expect(sig([t])).not.toBe(before);
    });

    it('تیک زیرکار امضا را عوض می‌کند', () => {
        const t = plan('سفر شمال');
        const before = sig([t]);
        t.children[1].completed = true;
        expect(sig([t])).not.toBe(before);
    });

    it('بدون تغییر، امضا ثابت می‌ماند', () => {
        const t = plan('سفر شمال');
        expect(sig([t])).toBe(sig([t]));
    });

    it('مصرف‌شدن جلسه (doneAt) امضا را عوض می‌کند', () => {
        const at = new Date(Date.now() + 86400000).toISOString();
        const t = { ...plan('دوره'), recur: 'daily', sessions: [{ id: 's1', at }] };
        const before = sig([t]);
        t.sessions[0].doneAt = new Date().toISOString();
        expect(sig([t])).not.toBe(before);
    });

    it('افزودن جلسه‌ی بعدی (تیک دوره) امضا را عوض می‌کند', () => {
        const at = new Date(Date.now() + 86400000).toISOString();
        const t = { ...plan('دوره'), recur: 'daily', sessions: [{ id: 's1', at }] };
        const before = sig([t]);
        t.sessions.push({ id: 's2', at: new Date(Date.now() + 2 * 86400000).toISOString() });
        expect(sig([t])).not.toBe(before);
    });
});
