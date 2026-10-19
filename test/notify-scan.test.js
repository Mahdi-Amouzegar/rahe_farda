// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/notify-scan.test.js — گیت تازه‌سازی مقصد برای یادآور (10.17 → 10.20/BUG-19)

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    cacheSharedItems,
    cachedUpdatedAtMs,
    shouldRefreshSharedKey,
    __resetSharedForTest,
} from '../js/tasks/source.js';

const farFuture = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

function item(id, updatedAt) {
    return { id, archived: false, updatedAt, sessions: [{ id: 's1', at: farFuture() }] };
}

describe('notify — سیگنال فعالیت سروری (10.20/BUG-19)', () => {
    beforeEach(() => { __resetSharedForTest(); });
    afterEach(() => { __resetSharedForTest(); });

    it('جدیدترین updatedAt کش را برمی‌گرداند (null برای کش خالی)', () => {
        expect(cachedUpdatedAtMs('peer:p1')).toBe(null);
        cacheSharedItems('peer:p1', [
            item('t1', '2026-10-19T10:00:00.000Z'),
            item('t2', '2026-10-19T10:05:00.000Z'),
        ]);
        expect(cachedUpdatedAtMs('peer:p1')).toBe(new Date('2026-10-19T10:05:00.000Z').getTime());
    });

    it('فعالیت جدیدتر از کش → تازه‌سازی فوری (حتی با سررسید دور و کش تازه)', () => {
        cacheSharedItems('peer:p1', [item('t1', '2026-10-19T10:00:00.000Z')]);
        expect(shouldRefreshSharedKey('peer:p1', '2026-10-19T10:06:00.000Z')).toBe(true);
    });

    it('فعالیت هم‌زمان/قدیمی‌تر از کش + سررسید دور → صرفه‌جویی', () => {
        cacheSharedItems('peer:p1', [item('t1', '2026-10-19T10:00:00.000Z')]);
        expect(shouldRefreshSharedKey('peer:p1', '2026-10-19T10:00:00.000Z')).toBe(false);
        expect(shouldRefreshSharedKey('peer:p1', '2026-10-19T09:00:00.000Z')).toBe(false);
        expect(shouldRefreshSharedKey('peer:p1', null)).toBe(false);
    });

    it('مقصد تازه‌فعال‌شده (کش خالی + فعالیت سروری) → تازه‌سازی', () => {
        cacheSharedItems('group:g1', []);
        expect(shouldRefreshSharedKey('group:g1', '2026-10-19T10:00:00.000Z')).toBe(true);
    });

    it('مقصد کش‌نشده → تازه‌سازی', () => {
        expect(shouldRefreshSharedKey('group:g1', null)).toBe(true);
    });
});
