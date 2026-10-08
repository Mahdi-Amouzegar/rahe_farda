// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/live.test.js -- موتور زنده: diff آیتم‌ها (تازه/ویرایش/حذف)

import { describe, it, expect } from 'vitest';

import { diffSharedItems, shouldFullFetch } from '../js/tasks/live.js';

const mine = (id, updatedAt) => ({
    id, text: 'mine', updatedAt,
    _shared: { mine: true, dest: { type: 'peer', peerId: 'u2' }, remoteId: id },
});
const other = (id, updatedAt) => ({
    id, text: 'other', updatedAt,
    _shared: { mine: false, dest: { type: 'peer', peerId: 'u2' }, remoteId: id, senderName: 'سارا' },
});

describe('live diff', () => {
    it('بدون تغییر → خالی', () => {
        const a = [mine('d1', '2026-01-01'), other('d2', '2026-01-02')];
        const b = [mine('d1', '2026-01-01'), other('d2', '2026-01-02')];
        expect(diffSharedItems(a, b)).toEqual({ added: [], updated: [], removed: [] });
    });

    it('پیام تازه‌ی مخاطب → added (مال خود نه)', () => {
        const a = [mine('d1', '2026-01-01')];
        const b = [mine('d1', '2026-01-01'), other('d2', '2026-01-02'), mine('d3', '2026-01-03')];
        const d = diffSharedItems(a, b);
        expect(d.added.map((t) => t.id)).toEqual(['d2']);
        expect(d.updated).toEqual([]);
        expect(d.removed).toEqual([]);
    });

    it('ویرایش مخاطب (updatedAt جدید) → updated', () => {
        const a = [other('d2', '2026-01-02')];
        const b = [other('d2', '2026-01-05')];
        const d = diffSharedItems(a, b);
        expect(d.updated.map((t) => t.id)).toEqual(['d2']);
        expect(d.added).toEqual([]);
    });

    it('حذف مخاطب → removed (مال خود نه)', () => {
        const a = [other('d2', '2026-01-02'), mine('d1', '2026-01-01')];
        const b = [mine('d1', '2026-01-01')];
        const d = diffSharedItems(a, b);
        expect(d.removed.map((t) => t.id)).toEqual(['d2']);
    });
});

describe('live gate', () => {
    it('تغییر مقصد → fetch', () => {
        expect(shouldFullFetch('', -1, 'peer:u2', 0, 1)).toBe(true);
    });

    it('شمارش نامشخص یا عوض‌شده → fetch', () => {
        expect(shouldFullFetch('peer:u2', 3, 'peer:u2', null, 1)).toBe(true);
        expect(shouldFullFetch('peer:u2', 3, 'peer:u2', 4, 2)).toBe(true);
    });

    it('شمارش ثابت → سکوت', () => {
        expect(shouldFullFetch('peer:u2', 3, 'peer:u2', 3, 1)).toBe(false);
        expect(shouldFullFetch('peer:u2', 3, 'peer:u2', 3, 2)).toBe(false);
    });

    it('هر پنجمین تیک → fetch دوره‌ای', () => {
        expect(shouldFullFetch('peer:u2', 3, 'peer:u2', 3, 5)).toBe(true);
        expect(shouldFullFetch('peer:u2', 3, 'peer:u2', 3, 10)).toBe(true);
    });
});
