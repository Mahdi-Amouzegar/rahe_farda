// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/tasks-unified.test.js -- قدم ۱ فاز ۹: مقصد + لیست دوحالته + seam کامپوزر

import { describe, it, expect } from 'vitest';
import { normalizeDestination, isLocalDestination } from '../js/tasks/destination.js';
import { ownerIdOf, isMine, canEdit, sideFor, splitTwoState, senderLabel } from '../js/tasks/list.js';

describe('tasks destination', () => {
    it('پیش‌فرض local است', () => {
        expect(normalizeDestination()).toEqual({ type: 'local' });
        expect(normalizeDestination('local')).toEqual({ type: 'local' });
        expect(isLocalDestination()).toBe(true);
    });
    it('peer بدون peerId خطای BAD_DESTINATION می‌دهد', () => {
        expect(() => normalizeDestination({ type: 'peer' })).toThrowError();
        try {
            normalizeDestination({ type: 'peer' });
        } catch (e) {
            expect(e.code).toBe('BAD_DESTINATION');
        }
    });
    it('group بدون groupId خطای BAD_DESTINATION می‌دهد', () => {
        try {
            normalizeDestination({ type: 'group' });
        } catch (e) {
            expect(e.code).toBe('BAD_DESTINATION');
        }
    });
    it('نوع ناشناخته خطا می‌دهد', () => {
        expect(() => normalizeDestination({ type: 'space' })).toThrowError();
    });
    it('peer/group معتبر نرمال می‌شوند (ولی کامپوزر تا ۱.۵ آماده نیست)', () => {
        expect(normalizeDestination({ type: 'peer', peerId: 'u2' })).toEqual({ type: 'peer', peerId: 'u2' });
        expect(normalizeDestination({ type: 'group', groupId: 'g1' })).toEqual({ type: 'group', groupId: 'g1' });
        expect(isLocalDestination({ type: 'peer', peerId: 'u2' })).toBe(false);
    });
});

describe('tasks two-state list', () => {
    const me = 'u1';
    const mine = { id: 't1', creatorId: 'u1', text: 'mine' };
    const other = { id: 't2', sender_id: 'u2', displayName: 'سارا' };

    it('ownerId هر دو شکل فرانت/بک‌اند را می‌خواند', () => {
        expect(ownerIdOf(mine)).toBe('u1');
        expect(ownerIdOf(other)).toBe('u2');
        expect(ownerIdOf(null)).toBe(null);
    });
    it('فقط مال خود قابل ویرایش است', () => {
        expect(isMine(mine, me)).toBe(true);
        expect(isMine(other, me)).toBe(false);
        expect(canEdit(mine, me)).toBe(true);
        expect(canEdit(other, me)).toBe(false);
    });
    it('side منطقی self/other می‌دهد', () => {
        expect(sideFor(mine, me)).toBe('self');
        expect(sideFor(other, me)).toBe('other');
    });
    it('split ترتیب را حفظ می‌کند', () => {
        const items = [other, mine, { id: 't3', creator_id: 'u2' }];
        const { mine: m, other: o } = splitTwoState(items, me);
        expect(m.map((t) => t.id)).toEqual(['t1']);
        expect(o.map((t) => t.id)).toEqual(['t2', 't3']);
    });
    it('senderLabel نام را ترجیح می‌دهد و هرگز خالی نمی‌ماند', () => {
        expect(senderLabel(other)).toBe('سارا');
        expect(typeof senderLabel({})).toBe('string');
    });
});

describe('tasks composer seam', () => {
    it('peer/group تا بک‌اند ۱.۵ خطای NOT_READY می‌دهند', async () => {
        const { submitTask } = await import('../js/tasks/composer.js');
        expect(() => submitTask('task', { type: 'peer', peerId: 'u2' })).toThrowError();
        try {
            submitTask('task', { type: 'group', groupId: 'g1' });
        } catch (e) {
            expect(e.code).toBe('NOT_READY_UNTIL_1_5');
        }
    });
});
