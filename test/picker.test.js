// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/picker.test.js — تداخل ۳۰ دقیقه‌ای: شخصی + مشترک

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { findConflict } from '../js/picker.js';
import { cacheSharedItems, __resetSharedForTest } from '../js/tasks/source.js';
import { state } from '../js/core.js';

const MIN = 60 * 1000;
const futureIso = (mins) => new Date(Date.now() + mins * MIN).toISOString();

let _savedTasks;
beforeEach(() => {
    _savedTasks = state.tasks;
    state.tasks = [];
    // کش allSessions به taskIndexVersion وابسته است — باطل‌سازی دستی
    state.taskIndexVersion = (state.taskIndexVersion || 0) + 1;
    __resetSharedForTest();
});
afterEach(() => {
    state.tasks = _savedTasks;
    __resetSharedForTest();
});

describe('findConflict', () => {
    it('تداخل شخصی در ۳۰ دقیقه پیدا می‌شود', () => {
        state.tasks = [{
            id: 'p1', text: 'شخصی', archived: false, completed: false,
            createdAt: futureIso(-60),
            sessions: [{ id: 's1', at: futureIso(60) }],
        }];
        const hit = findConflict(Date.now() + 70 * MIN);
        expect(hit && hit.owner).toBe('شخصی');
    });
    it('تداخل مشترک (گروه) پیدا می‌شود', () => {
        cacheSharedItems('g1', [{
            id: 'sh1', text: 'تسک گروهی', archived: false, completed: false,
            createdAt: futureIso(-60),
            sessions: [{ id: 's1', at: futureIso(60) }],
            _shared: { mine: false, dest: { type: 'group', groupId: 'g1' } },
        }]);
        const hit = findConflict(Date.now() + 70 * MIN);
        expect(hit && hit.owner).toBe('تسک گروهی');
    });
    it('بایگانی/تکمیل‌شده مشترک نادیده گرفته می‌شود', () => {
        cacheSharedItems('g1', [
            { id: 'a', text: 'بایگانی', archived: true, sessions: [{ id: 's', at: futureIso(60) }] },
            { id: 'c', text: 'تمام‌شده', archived: false, completed: true, sessions: [{ id: 's', at: futureIso(60) }] },
        ]);
        expect(findConflict(Date.now() + 70 * MIN)).toBeNull();
    });
    it('فاصله بیش از ۳۰ دقیقه → null', () => {
        state.tasks = [{
            id: 'p1', text: 'شخصی', archived: false, completed: false,
            createdAt: futureIso(-60),
            sessions: [{ id: 's1', at: futureIso(60) }],
        }];
        expect(findConflict(Date.now() + 120 * MIN)).toBeNull();
    });
    it('گذشته نادیده گرفته می‌شود', () => {
        state.tasks = [{
            id: 'p1', text: 'شخصی', archived: false, completed: false,
            createdAt: futureIso(-120),
            sessions: [{ id: 's1', at: futureIso(-10) }],
        }];
        expect(findConflict(Date.now() + 5 * MIN)).toBeNull();
    });
});
