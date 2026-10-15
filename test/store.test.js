// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/store.test.js — تست‌های sanitization

import { describe, it, expect, vi } from 'vitest';
import { sanitizeUrl, validLoc, sanitizeTask, saveTasks, loadTasks, validateSeriesStart, advanceRecur, rollforwardRecur, invalidateTaskIndex, isTrashOpType } from '../js/store.js';
import { isDueFireable, DUE_CATCH_UP_MS, dayKey } from '../js/sessions.js';
import { checkReminders, collectSharedDue, paintIfPending, rollforwardSharedCache, firedSharedKey, nextSessionAtMap, todaySessions } from '../js/notify.js';
import { cacheSharedItems, getCachedSharedAll, sharedCacheKey, __resetSharedForTest, persistAdvancedShared, shouldRefreshSharedKey } from '../js/tasks/source.js';
import { MAX_LENGTH, state, uid } from '../js/core.js';

describe('store — sanitizeUrl', () => {
    it('URL کامل https را حفظ می‌کند', () => {
        const r = sanitizeUrl('https://example.com/path?q=1');
        expect(r).toBe('https://example.com/path?q=1');
    });

    it('URL کامل http را حفظ می‌کند', () => {
        const r = sanitizeUrl('http://example.com');
        expect(r).toBe('http://example.com/');
    });

    it('دامنه بدون پروتکل را با https:// استاندارد می‌کند', () => {
        const r = sanitizeUrl('example.com');
        expect(r).toBe('https://example.com/');
    });

    it('دامنه با مسیر بدون پروتکل را استاندارد می‌کند', () => {
        const r = sanitizeUrl('example.com/path');
        expect(r).toBe('https://example.com/path');
    });

    it('javascript: را رد می‌کند', () => {
        expect(sanitizeUrl('javascript:alert(1)')).toBe('');
    });

    it('data: را رد می‌کند', () => {
        expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBe('');
    });

    it('ftp: را رد می‌کند', () => {
        expect(sanitizeUrl('ftp://example.com')).toBe('');
    });

    it('متن خالی را رد می‌کند', () => {
        expect(sanitizeUrl('')).toBe('');
        expect(sanitizeUrl(null)).toBe('');
        expect(sanitizeUrl(undefined)).toBe('');
        expect(sanitizeUrl(123)).toBe('');
    });

    it('متن غیر URL را رد می‌کند', () => {
        expect(sanitizeUrl('not a url')).toBe('');
    });

    it('فاصله‌های اضافی را trim می‌کند', () => {
        expect(sanitizeUrl('  example.com  ')).toBe('https://example.com/');
    });
});

describe('store — validLoc', () => {
    it('مکان معتبر را حفظ می‌کند', () => {
        const r = validLoc({ lat: 35.6892, lng: 51.389 });
        expect(r).toEqual({ lat: 35.6892, lng: 51.389, name: null });
    });

    it('مکان با نام را حفظ می‌کند', () => {
        const r = validLoc({ lat: 35.6892, lng: 51.389, name: 'خانه' });
        expect(r.name).toBe('خانه');
    });

    it('نام طولانی را trim می‌کند', () => {
        const longName = 'a'.repeat(200);
        const r = validLoc({ lat: 35, lng: 51, name: longName });
        expect(r.name.length).toBe(80);
    });

    it('lat/lng خارج از محدوده را رد می‌کند', () => {
        expect(validLoc({ lat: 100, lng: 51 })).toBe(null);
        expect(validLoc({ lat: 35, lng: 200 })).toBe(null);
    });

    it('lat/lng نامعتبر را رد می‌کند', () => {
        expect(validLoc({ lat: 'abc', lng: 51 })).toBe(null);
        expect(validLoc({ lat: 35 })).toBe(null);
        expect(validLoc(null)).toBe(null);
        expect(validLoc({})).toBe(null);
    });

    it('نام خالی را به null تبدیل می‌کند', () => {
        const r = validLoc({ lat: 35, lng: 51, name: '   ' });
        expect(r.name).toBe(null);
    });
});

describe('store — sanitizeTask', () => {
    const baseTask = {
        id: 'test-1',
        text: 'تست',
        kind: 'task',
        createdAt: new Date().toISOString()
    };

    it('task پایه را با فیلدهای پیش‌فرض برمی‌گرداند', () => {
        const r = sanitizeTask(baseTask);
        expect(r.id).toBe('test-1');
        expect(r.text).toBe('تست');
        expect(r.completed).toBe(false);
        expect(r.priority).toBe('medium');
        expect(r.kind).toBe('task');
        expect(r.sessions).toEqual([]);
        expect(r.children).toEqual([]);
        expect(r.photos).toEqual([]);
    });

    it('text طولانی را به MAX_LENGTH کوتاه می‌کند', () => {
        const longText = 'a'.repeat(500);
        const r = sanitizeTask({ ...baseTask, text: longText });
        expect(r.text.length).toBe(MAX_LENGTH);
    });

    it('اولویت نامعتبر را به medium تبدیل می‌کند', () => {
        const r = sanitizeTask({ ...baseTask, priority: 'invalid' });
        expect(r.priority).toBe('medium');
    });

    it('اولویت‌های معتبر را حفظ می‌کند', () => {
        expect(sanitizeTask({ ...baseTask, priority: 'high' }).priority).toBe('high');
        expect(sanitizeTask({ ...baseTask, priority: 'low' }).priority).toBe('low');
    });

    it('kind plan را با children می‌پذیرد', () => {
        const r = sanitizeTask({
            ...baseTask,
            kind: 'plan',
            children: [
                { id: 'c1', text: 'زیرکار ۱', kind: 'task' },
                { id: 'c2', text: 'زیرکار ۲', kind: 'task' }
            ]
        });
        expect(r.kind).toBe('plan');
        expect(r.children.length).toBe(2);
    });

    it('children بدون id را فیلتر می‌کند', () => {
        const r = sanitizeTask({
            ...baseTask,
            kind: 'plan',
            children: [
                { text: 'بدون id' },
                { id: 'c1', text: 'معتبر' }
            ]
        });
        expect(r.children.length).toBe(1);
        expect(r.children[0].id).toBe('c1');
    });

    it('children با text خالی را فیلتر می‌کند', () => {
        const r = sanitizeTask({
            ...baseTask,
            kind: 'plan',
            children: [
                { id: 'c1', text: '   ' },
                { id: 'c2', text: 'معتبر' }
            ]
        });
        expect(r.children.length).toBe(1);
    });

    it('sessions معتبر را حفظ می‌کند', () => {
        const at = new Date().toISOString();
        const r = sanitizeTask({
            ...baseTask,
            sessions: [{ id: 's1', at }]
        });
        expect(r.sessions.length).toBe(1);
        expect(r.sessions[0].at).toBe(at);
    });

    it('sessions با تاریخ نامعتبر را فیلتر می‌کند', () => {
        const r = sanitizeTask({
            ...baseTask,
            sessions: [
                { id: 's1', at: 'invalid' },
                { id: 's2', at: new Date().toISOString() }
            ]
        });
        expect(r.sessions.length).toBe(1);
    });

    it('URL نامعتبر را به رشته خالی تبدیل می‌کند', () => {
        const r = sanitizeTask({ ...baseTask, url: 'javascript:alert(1)' });
        expect(r.url).toBe('');
    });

    it('URL معتبر را حفظ می‌کند', () => {
        const r = sanitizeTask({ ...baseTask, url: 'https://example.com' });
        expect(r.url).toBe('https://example.com/');
    });

    it('location نامعتبر را به null تبدیل می‌کند', () => {
        const r = sanitizeTask({ ...baseTask, location: { lat: 100, lng: 51 } });
        expect(r.location).toBe(null);
    });

    it('location معتبر را حفظ می‌کند', () => {
        const r = sanitizeTask({ ...baseTask, location: { lat: 35.5, lng: 51.5 } });
        expect(r.location.lat).toBe(35.5);
        expect(r.location.lng).toBe(51.5);
    });

    it('kind plan — location معتبر را حفظ می‌کند', () => {
        const r = sanitizeTask({
            ...baseTask,
            kind: 'plan',
            location: { lat: 35.5, lng: 51.5 }
        });
        expect(r.location).not.toBe(null);
        expect(r.location.lat).toBe(35.5);
        expect(r.location.lng).toBe(51.5);
    });

    it('kind plan — location نامعتبر را به null تبدیل می‌کند', () => {
        const r = sanitizeTask({
            ...baseTask,
            kind: 'plan',
            location: { lat: 100, lng: 51 }
        });
        expect(r.location).toBe(null);
    });

    it('photos معتبر را حفظ می‌کند', () => {
        const r = sanitizeTask({
            ...baseTask,
            photos: [{ id: 'p1', dataUrl: 'data:image/jpeg;base64,xxx' }]
        });
        expect(r.photos.length).toBe(1);
    });

    it('photos نامعتبر را فیلتر می‌کند', () => {
        const r = sanitizeTask({
            ...baseTask,
            photos: [
                { id: 'p1', dataUrl: 'not-image' },
                { id: 'p2', dataUrl: 'data:image/jpeg;base64,xxx' }
            ]
        });
        expect(r.photos.length).toBe(1);
    });

    it('recur نامعتبر را به none تبدیل می‌کند', () => {
        const r = sanitizeTask({ ...baseTask, recur: 'invalid' });
        expect(r.recur).toBe('none');
    });

    it('recur معتبر را حفظ می‌کند', () => {
        expect(sanitizeTask({ ...baseTask, recur: 'daily' }).recur).toBe('daily');
        expect(sanitizeTask({ ...baseTask, recur: 'weekly' }).recur).toBe('weekly');
    });
});

describe('store — photo round-trip 10.11/BUG-01', () => {
    it('عکس بعد از saveTasks و loadTasks می‌ماند', async () => {
        const id = uid();
        state.tasks = [{
            id,
            text: 'تست عکس',
            photos: [{
                id: uid(),
                dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
                addedAt: new Date().toISOString(),
                contentType: 'image/png',
                sizeBytes: 100,
            }],
            mediaIds: [],
        }];
        await saveTasks();
        state.tasks = [];
        await loadTasks();
        const found = state.tasks.find(t => String(t.id) === String(id));
        expect(found).toBeTruthy();
        expect(Array.isArray(found.photos)).toBe(true);
        expect(found.photos.length).toBe(1);
        state.tasks = [];
    });
});

describe('store — validateSeriesStart 10.11', () => {
    const NOW = new Date('2026-10-10T12:00:00.000Z').getTime();
    it('خالی را رد می‌کند', () => {
        expect(validateSeriesStart(null, NOW).ok).toBe(false);
        expect(validateSeriesStart('', NOW).error).toBe('tasks.series.firstRequired');
    });
    it('گذشته و اکنون را رد می‌کند', () => {
        expect(validateSeriesStart('2026-10-09T12:00:00.000Z', NOW).error).toBe('tasks.series.firstMustBeFuture');
        expect(validateSeriesStart('2026-10-10T12:00:00.000Z', NOW).ok).toBe(false);
        expect(validateSeriesStart('not-a-date', NOW).ok).toBe(false);
    });
    it('آینده را با ISO نرمال قبول می‌کند', () => {
        const r = validateSeriesStart('2026-10-11T08:30:00.000Z', NOW);
        expect(r.ok).toBe(true);
        expect(r.at).toBe('2026-10-11T08:30:00.000Z');
    });
});

describe('store — advanceRecur anchoring 10.11', () => {
    it('روزانه: روز بعد با همان ساعت', () => {
        const last = new Date(Date.now() + 3600 * 1000);
        const task = { recur: 'daily', sessions: [{ id: 's1', at: last.toISOString() }] };
        expect(advanceRecur(task)).toBe(true);
        expect(task.sessions.length).toBe(2);
        const next = new Date(task.sessions[1].at);
        expect(next.getHours()).toBe(last.getHours());
        expect(next.getDate()).toBe(new Date(last.getTime() + 86400000).getDate());
        expect(next.getTime()).toBeGreaterThan(last.getTime());
    });
    it('ساعتی: دقیقاً N ساعت بعد', () => {
        const last = new Date(Date.now() + 3600 * 1000);
        const task = { recur: 'hourly', recurN: 3, sessions: [{ id: 's1', at: last.toISOString() }] };
        expect(advanceRecur(task)).toBe(true);
        expect(new Date(task.sessions[1].at).getTime() - last.getTime()).toBe(3 * 3600 * 1000);
    });
    it('ساعتی با دقیقه: ۳ ساعت و ۲۰ دقیقه بعد (10.12)', () => {
        const last = new Date(Date.now() + 3600 * 1000);
        const task = { recur: 'hourly', recurN: 3, recurMin: 20, sessions: [{ id: 's1', at: last.toISOString() }] };
        expect(advanceRecur(task)).toBe(true);
        expect(new Date(task.sessions[1].at).getTime() - last.getTime()).toBe((3 * 3600 + 20 * 60) * 1000);
    });
    it('ساعتی فقط‌دقیقه: ۴۵ دقیقه بعد (10.12)', () => {
        const last = new Date(Date.now() + 3600 * 1000);
        const task = { recur: 'hourly', recurN: 0, recurMin: 45, sessions: [{ id: 's1', at: last.toISOString() }] };
        expect(advanceRecur(task)).toBe(true);
        expect(new Date(task.sessions[1].at).getTime() - last.getTime()).toBe(45 * 60 * 1000);
    });
    it('تمدید از آخرین سررسید محاسبه می‌شود نه از لحظه تمدید (10.13)', () => {
        const last = new Date(Date.now() - 60 * 1000); // ۱ دقیقه پیش
        const task = { recur: 'hourly', recurN: 0, recurMin: 5, sessions: [{ id: 's1', at: last.toISOString() }] };
        expect(advanceRecur(task)).toBe(true);
        expect(new Date(task.sessions[1].at).getTime() - last.getTime()).toBe(5 * 60 * 1000);
        expect(typeof task.sessions[1].regAt).toBe('string');
    });
    it('ساعتی با بازه‌ی صفر: جلو نمی‌رود (10.12)', () => {
        const last = new Date(Date.now() + 3600 * 1000);
        const task = { recur: 'hourly', recurN: 0, recurMin: 0, sessions: [{ id: 's1', at: last.toISOString() }] };
        expect(advanceRecur(task)).toBe(false);
        expect(task.sessions.length).toBe(1);
    });
    it('sanitizeTask: recurMin و recurN=۰ ساعتی را می‌پذیرد (10.12)', () => {
        const r = sanitizeTask({ id: 'x', text: 't', recur: 'hourly', recurN: 0, recurMin: 45, sessions: [] });
        expect(r.recur).toBe('hourly');
        expect(r.recurN).toBe(0);
        expect(r.recurMin).toBe(45);
    });
    it('sanitizeTask: recurMin نامعتبر را صفر می‌کند (10.12)', () => {
        const r = sanitizeTask({ id: 'x', text: 't', recur: 'hourly', recurN: 2, recurMin: 99, sessions: [] });
        expect(r.recurMin).toBe(0);
    });
    it('روزهای هفته: نزدیک‌ترین روز آینده', () => {
        const last = new Date(Date.now() + 3600 * 1000);
        const want = (last.getDay() + 2) % 7; // دوری که قطعاً امروز/فردا نیست
        const task = { recur: 'weeklyDays', recurDays: [want], sessions: [{ id: 's1', at: last.toISOString() }] };
        expect(advanceRecur(task)).toBe(true);
        expect(new Date(task.sessions[1].at).getDay()).toBe(want);
        expect(new Date(task.sessions[1].at).getTime()).toBeGreaterThan(last.getTime());
    });
});

describe('store — rollforwardRecur 10.11', () => {
    const NOW = Date.now();
    const past = new Date(NOW - 2 * 86400000).toISOString();
    it('روزانه گذشته را تا آینده جلو می‌برد', () => {
        const tasks = [{ id: 't1', text: 'x', recur: 'daily', completed: false, archived: false, sessions: [{ id: 's1', at: past }] }];
        const out = rollforwardRecur(tasks, NOW);
        expect(out).toEqual(['t1']);
        const latest = Math.max(...tasks[0].sessions.map(s => new Date(s.at).getTime()));
        expect(latest).toBeGreaterThan(NOW);    });
    it('آینده‌دار/تکمیل‌شده/بدون قانون/بدون جلسه را دست نمی‌زند', () => {
        const future = new Date(NOW + 86400000).toISOString();
        const tasks = [
            { id: 'a', text: 'x', recur: 'daily', sessions: [{ id: 's', at: future }] },
            { id: 'b', text: 'x', recur: 'daily', completed: true, sessions: [{ id: 's', at: past }] },
            { id: 'c', text: 'x', recur: 'none', sessions: [{ id: 's', at: past }] },
            { id: 'd', text: 'x', recur: 'daily', sessions: [] },
        ];
        expect(rollforwardRecur(tasks, NOW)).toEqual([]);
        expect(tasks[0].sessions.length).toBe(1);
    });
    it('فرزند plan را هم جلو می‌برد', () => {
        const tasks = [{ id: 'p', text: 'x', kind: 'plan', sessions: [], children: [
            { id: 'c1', text: 'y', recur: 'daily', sessions: [{ id: 's', at: past }] },
        ] }];
        const out = rollforwardRecur(tasks, NOW);
        expect(out).toContain('c1');
    });
    it('سررسید بعدی روی شبکه است نه از لحظه اسکن (10.13)', () => {
        const last = new Date(NOW - 60 * 1000).toISOString(); // ۱ دقیقه پیش
        const tasks = [{ id: 't1', text: 'x', recur: 'hourly', recurN: 0, recurMin: 5, completed: false, archived: false, sessions: [{ id: 's1', at: last }] }];
        const out = rollforwardRecur(tasks, NOW);
        expect(out).toEqual(['t1']);
        const latest = Math.max(...tasks[0].sessions.map(s => new Date(s.at).getTime()));
        expect(latest - new Date(last).getTime()).toBe(5 * 60 * 1000);
        expect(latest).toBeGreaterThan(NOW);
    });
});

describe('store — sanitizeTask regAt 10.13', () => {
    it('regAt را می‌پذیرد؛ نبودش به createdAt می‌افتد', () => {
        const created = new Date(Date.now() - 86400000).toISOString();
        const at = new Date(Date.now() + 3600000).toISOString();
        const r = sanitizeTask({ id: 'x', text: 't', createdAt: created, sessions: [{ id: 's1', at }] });
        expect(r.sessions[0].regAt).toBe(created);
        const regAt = new Date().toISOString();
        const r2 = sanitizeTask({ id: 'y', text: 't', createdAt: created, sessions: [{ id: 's1', at, regAt }] });
        expect(r2.sessions[0].regAt).toBe(regAt);
    });
});

describe('sessions — isDueFireable 10.11', () => {
    const V = new Date('2026-10-10T12:00:00.000Z').getTime();
    it('۵ دقیقه قبل و لحظه سررسید شلیک می‌کند', () => {
        expect(isDueFireable(V - 5 * 60000, V, false)).toBe(true);
        expect(isDueFireable(V, V, false)).toBe(true);
        expect(isDueFireable(V + 60 * 1000, V, false)).toBe(true);
    });
    it('بعد از مهلت جبران یا با flag شلیک نمی‌کند', () => {
        expect(isDueFireable(V + DUE_CATCH_UP_MS + 1000, V, false)).toBe(false);
        expect(isDueFireable(V, V, true)).toBe(false);
        expect(isDueFireable(V - 6 * 60000, V, false)).toBe(false);
    });
});

describe('notify — lead suppression 10.13', () => {
    const NOW = Date.now();
    const at = new Date(NOW + 30 * 60000).toISOString();
    it('ثبت با فاصله‌ی < ۲ ساعت: یادآور اصلی خاموش', () => {
        const regAt = new Date(NOW - 30 * 60000).toISOString();
        const items = [{ id: 't1', text: 'x', createdAt: regAt,
            sessions: [{ id: 's1', at, regAt, remindMin: 60 }] }];
        const out = collectSharedDue(items, NOW, {});
        expect(out.filter(x => x.kind === 'lead').length).toBe(0);
    });
    it('ثبت با فاصله‌ی ≥ ۲ ساعت: یادآور اصلی فعال', () => {
        const regAt = new Date(NOW - 150 * 60000).toISOString();
        const items = [{ id: 't1', text: 'x', createdAt: regAt,
            sessions: [{ id: 's1', at, regAt, remindMin: 60 }] }];
        const out = collectSharedDue(items, NOW, {});
        expect(out.some(x => x.kind === 'lead')).toBe(true);
    });
    it('بدون regAt: fallback به createdAt تسک', () => {
        const old = new Date(NOW - 3 * 86400000).toISOString();
        const items = [{ id: 't1', text: 'x', createdAt: old,
            sessions: [{ id: 's1', at, remindMin: 60 }] }];
        expect(collectSharedDue(items, NOW, {}).some(x => x.kind === 'lead')).toBe(true);
        const fresh = new Date(NOW - 10 * 60000).toISOString();
        const items2 = [{ id: 't2', text: 'y', createdAt: fresh,
            sessions: [{ id: 's2', at, remindMin: 60 }] }];
        expect(collectSharedDue(items2, NOW, {}).some(x => x.kind === 'lead')).toBe(false);
    });
});

describe('notify — checkReminders 10.11-fix', () => {
    it('جلو بردن داده مستقل از خاموش بودن اعلان است', () => {
        const prev = state.prefs.remindOn;
        state.prefs.remindOn = false;
        try {
            const past = new Date(Date.now() - 2 * 86400000).toISOString();
            state.tasks = [{ id: 'r1', text: 'x', recur: 'daily', completed: false, archived: false, sessions: [{ id: 's', at: past }] }];
            checkReminders();
            const t = state.tasks.find(x => String(x.id) === 'r1');
            const latest = Math.max(...t.sessions.map(s => new Date(s.at).getTime()));
            expect(latest).toBeGreaterThan(Date.now());
        } finally {
            state.prefs.remindOn = prev;
            state.tasks = [];
            try { localStorage.removeItem('spaceTodoTasks'); } catch { /* silent */ }
        }
    });
});

describe('notify — at-due fires with own flag 10.11/BUG-05', () => {
    it('هشدار لحظه سررسید بعد از ۵دقیقه‌ای هم می‌آید', () => {
        const seen = [];
        const prevNotif = globalThis.Notification;
        globalThis.Notification = class {
            constructor(title, opts) { seen.push({ title, tag: opts && opts.tag }); }
        };
        globalThis.Notification.permission = 'granted';
        const prevRemind = state.prefs.remindOn;
        state.prefs.remindOn = true;
        try {
            const at = new Date(Date.now() - 30 * 1000).toISOString();
            state.tasks = [{ id: 'n1', text: 'x', completed: false, archived: false,
                sessions: [{ id: 'ns1', at, reminded: false, remindedDue: false, remindedDueSoon: true }] }];
            checkReminders();
            expect(seen.length).toBe(1);
            expect(seen[0].title).toBe('notifications.reminder.dueTitle');
            expect(seen[0].tag).toBe('due-ns1');
        } finally {
            if (prevNotif === undefined) delete globalThis.Notification;
            else globalThis.Notification = prevNotif;
            state.prefs.remindOn = prevRemind;
            state.tasks = [];
            try { localStorage.removeItem('spaceTodoTasks'); } catch { /* silent */ }
        }
    });
});

describe('notify — legacyNotif tag replace 10.11/BUG-05b', () => {
    it('نمایش دوم با تگ تکراری، قبلی را می‌بندد تا بنر بی‌صدا جایگزین نشود', async () => {
        const { legacyNotif } = await import('../js/notify.js');
        const closed = [];
        const prevNotif = globalThis.Notification;
        globalThis.Notification = class {
            constructor(title, opts) { this.title = title; this.tag = opts && opts.tag; }
            close() { closed.push(this.tag); }
        };
        try {
            expect(legacyNotif('a', { tag: 'x' })).toBe(true);
            expect(legacyNotif('b', { tag: 'x' })).toBe(true);
            expect(closed).toEqual(['x']);
        } finally {
            if (prevNotif === undefined) delete globalThis.Notification;
            else globalThis.Notification = prevNotif;
        }
    });
});

describe('notify — collectSharedDue REQ-02', () => {
    const V = new Date('2026-10-10T12:00:00.000Z').getTime();
    const items = [{ id: 'g1', text: 't', archived: false,
        sessions: [{ id: 's1', at: new Date(V).toISOString(), remindMin: null }] }];
    it('لحظه سررسید را با پرچم خالی برمی‌گرداند', () => {
        const out = collectSharedDue(items, V + 1000, {});
        expect(out.map(o => o.kind)).toEqual(['due']);
        expect(out[0].key).toBe('shr:g1:s1');
    });
    it('۴ دقیقه قبل lead و dueSoon را برمی‌گرداند', () => {
        const out = collectSharedDue(items, V - 4 * 60000, {});
        expect(out.map(o => o.kind).sort()).toEqual(['dueSoon', 'lead']);
    });
    it('پرچم‌های خورده و بایگانی را رد می‌کند', () => {
        const flags = { 'shr:g1:s1': { reminded: true, remindedDueSoon: true, remindedDue: true } };
        expect(collectSharedDue(items, V + 1000, flags)).toEqual([]);
        const arch = [{ id: 'x', text: 't', archived: true, sessions: [{ id: 's', at: new Date(V).toISOString() }] }];
        expect(collectSharedDue(arch, V + 1000, {})).toEqual([]);
    });
    it('جلسه تکراری در ورودی دوبار هشدار نمی‌دهد', () => {
        const dup = [...items, { id: 'g1', text: 't', archived: false,
            sessions: [{ id: 's1', at: new Date(V).toISOString(), remindMin: null }] }];
        const out = collectSharedDue(dup, V + 1000, {});
        expect(out.map(o => o.kind)).toEqual(['due']);
    });
});

describe('source — shared cache REQ-02', () => {
    it('کلید مقصد + کش + خواندن همه', () => {
        __resetSharedForTest();
        try {
            expect(sharedCacheKey({ type: 'peer', peerId: 'p1' })).toBe('peer:p1');
            expect(sharedCacheKey({ type: 'group', groupId: 'g1' })).toBe('group:g1');
            expect(sharedCacheKey({ type: 'local' })).toBe(null);
            cacheSharedItems('peer:p1', [{ id: 'a' }]);
            cacheSharedItems('group:g1', [{ id: 'b' }, { id: 'c' }]);
            expect(getCachedSharedAll().map(t => t.id).sort()).toEqual(['a', 'b', 'c']);
        } finally {
            __resetSharedForTest();
        }
    });
});

describe('sessions — allSessions carries dueSoon flag 10.11/BUG-05c', () => {
    it('remindedDueSoon در projection می‌ماند تا هشدار ۵دقیقه‌ای تکرار نشود', async () => {
        const { allSessions } = await import('../js/sessions.js');
        state.tasks = [{ id: 'f1', text: 'x', completed: false, archived: false,
            sessions: [{ id: 'fs1', at: new Date(Date.now() + 3600000).toISOString(), remindedDueSoon: true }] }];
        invalidateTaskIndex();
        try {
            const out = allSessions(false).filter(s => String(s.taskId) === 'f1');
            expect(out.length).toBe(1);
            expect(out[0].remindedDueSoon).toBe(true);
        } finally {
            state.tasks = [];
            invalidateTaskIndex();
        }
    });
});

describe('notify — paintIfPending BUG-07', () => {
    it('repaint بدهی تب مخفی را موقع بازگشت می‌دهد', () => {
        const prevHidden = Object.getOwnPropertyDescriptor(document, 'hidden');
        const prevRemind = state.prefs.remindOn;
        state.prefs.remindOn = false;
        try {
            Object.defineProperty(document, 'hidden', { value: true, configurable: true });
            const past = new Date(Date.now() - 2 * 86400000).toISOString();
            state.tasks = [{ id: 'h1', text: 'x', recur: 'daily', completed: false, archived: false, sessions: [{ id: 's', at: past }] }];
            checkReminders();
            Object.defineProperty(document, 'hidden', { value: false, configurable: true });
            expect(paintIfPending()).toBe(true);
            expect(paintIfPending()).toBe(false);
        } finally {
            if (prevHidden) Object.defineProperty(document, 'hidden', prevHidden);
            state.prefs.remindOn = prevRemind;
            state.tasks = [];
            try { localStorage.removeItem('spaceTodoTasks'); } catch { /* silent */ }
        }
    });
});

describe('rollforwardSharedCache — جلو بردن سری‌های مشترک (10.16)', () => {
    beforeEach(() => { __resetSharedForTest(); });
    afterEach(() => { __resetSharedForTest(); });

    const H = 3600000;

    it('جلسه‌ی گذشته را جلو می‌برد و جلسه‌ی آینده می‌سازد', () => {
        const t = {
            id: 't1', text: 'مشترک', recur: 'daily', archived: false, completed: false,
            sessions: [{ id: 's0', at: new Date(Date.now() - H).toISOString() }],
            _shared: { mine: false, dest: { type: 'peer', peerId: 'p1' } },
        };
        cacheSharedItems('peer:p1', [t]);
        const advanced = rollforwardSharedCache(Date.now());
        expect(advanced).toHaveLength(1);
        expect(t.sessions).toHaveLength(2);
        expect(new Date(t.sessions[1].at).getTime()).toBeGreaterThan(Date.now());
    });

    it('id جلسه‌ی ساخته‌شده قطعی است (همگرایی چند دستگاه)', () => {
        const base = new Date(Date.now() - 2 * 24 * H).toISOString();
        const mk = () => ({
            id: 't1', text: 'x', recur: 'daily', archived: false, completed: false,
            sessions: [{ id: 's0', at: base }],
            _shared: { mine: false, dest: { type: 'peer', peerId: 'p1' } },
        });
        const a = mk();
        cacheSharedItems('peer:p1', [a]);
        rollforwardSharedCache(Date.now());
        expect(a.sessions[1].id).toBe('t1@' + a.sessions[1].at);
        expect(a.sessions[2].id).toBe('t1@' + a.sessions[2].at);
    });

    it('بدون قانون / تکمیل‌شده / بایگانی / جلسه‌ی آینده دست نمی‌خورد', () => {
        const future = new Date(Date.now() + H).toISOString();
        const items = [
            { id: 'a', text: 'x', recur: 'none', sessions: [{ id: 's', at: new Date(Date.now() - H).toISOString() }], _shared: { mine: false } },
            { id: 'b', text: 'x', recur: 'daily', completed: true, sessions: [{ id: 's', at: new Date(Date.now() - H).toISOString() }], _shared: { mine: false } },
            { id: 'c', text: 'x', recur: 'daily', archived: true, sessions: [{ id: 's', at: new Date(Date.now() - H).toISOString() }], _shared: { mine: false } },
            { id: 'd', text: 'x', recur: 'daily', sessions: [{ id: 's', at: future }], _shared: { mine: false } },
            { id: 'e', text: 'x', recur: 'daily', sessions: [], _shared: { mine: false } },
        ];
        cacheSharedItems('peer:p1', items);
        expect(rollforwardSharedCache(Date.now())).toHaveLength(0);
        for (const it of items) {
            if (it.id === 'd') expect(it.sessions).toHaveLength(1);
            else if (it.sessions.length) expect(it.sessions).toHaveLength(1);
        }
    });

    it('غیبت طولانی → فروپاشی به یک جلسه‌ی آینده از اکنون', () => {
        const t = {
            id: 't2', text: 'x', recur: 'daily', archived: false, completed: false,
            sessions: [{ id: 's0', at: new Date(Date.now() - 400 * 24 * H).toISOString() }],
            _shared: { mine: false, dest: { type: 'peer', peerId: 'p1' } },
        };
        cacheSharedItems('peer:p1', [t]);
        rollforwardSharedCache(Date.now());
        expect(t.sessions).toHaveLength(1);
        expect(new Date(t.sessions[0].at).getTime()).toBeGreaterThan(Date.now());
        expect(t.sessions[0].id).toBe('t2@' + t.sessions[0].at);
    });

    it('persistAdvancedShared برای غیرخودی بدون درخواست شبکه {ok:false} است', async () => {
        const t = { id: 't3', text: 'x', _shared: { mine: false, dest: { type: 'peer', peerId: 'p1' } } };
        const r = await persistAdvancedShared(t);
        expect(r).toEqual({ ok: false });
    });
});

describe('shouldRefreshSharedKey — گیت مقصد اسکنر (10.17)', () => {
    beforeEach(() => { __resetSharedForTest(); });
    afterEach(() => { __resetSharedForTest(); });

    it('مقصد کش‌نشده → تازه‌سازی', () => {
        expect(shouldRefreshSharedKey('group:g1')).toBe(true);
    });

    it('سررسید نزدیک (≤ ۱۵ دقیقه) → تازه‌سازی', () => {
        const t = { id: 't1', archived: false, sessions: [{ id: 's', at: new Date(Date.now() + 60000).toISOString() }] };
        cacheSharedItems('group:g1', [t]);
        expect(shouldRefreshSharedKey('group:g1')).toBe(true);
    });

    it('سررسید دور + کش تازه → صرفه‌جویی', () => {
        const t = { id: 't1', archived: false, sessions: [{ id: 's', at: new Date(Date.now() + 3600000).toISOString() }] };
        cacheSharedItems('group:g1', [t]);
        expect(shouldRefreshSharedKey('group:g1')).toBe(false);
    });

    it('سررسید دور + گذشت ۱۰ دقیقه → دوباره تازه‌سازی', () => {
        vi.useFakeTimers();
        try {
            const t = { id: 't1', archived: false, sessions: [{ id: 's', at: new Date(Date.now() + 3600000).toISOString() }] };
            cacheSharedItems('group:g1', [t]);
            expect(shouldRefreshSharedKey('group:g1')).toBe(false);
            vi.advanceTimersByTime(11 * 60 * 1000);
            expect(shouldRefreshSharedKey('group:g1')).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('firedSharedKey — گیت شلیک دوگانه (10.17)', () => {
    it('هر (جلسه، نوع) در ۹۰ ثانیه حداکثر یک بار', () => {
        expect(firedSharedKey('shr:xa:sa', 'due', 1000)).toBe(false);
        expect(firedSharedKey('shr:xa:sa', 'due', 2000)).toBe(true);
        expect(firedSharedKey('shr:xa:sa', 'due', 1000 + 90001)).toBe(false);
    });

    it('نوع و کلید متفاوت مستقل‌اند', () => {
        expect(firedSharedKey('shr:xb:sb', 'due', 1000)).toBe(false);
        expect(firedSharedKey('shr:xb:sb', 'dueSoon', 1001)).toBe(false);
        expect(firedSharedKey('shr:xc:sc', 'due', 1002)).toBe(false);
    });
});

describe('nextSessionAtMap + گیت dueSoon (10.18)', () => {
    const M = 60000;

    it('نخستین جلسه‌ی آینده‌ی هر تسک را می‌یابد', () => {
        const now = 1000;
        const map = nextSessionAtMap([
            { taskId: 'a', at: new Date(now + 2 * M).toISOString() },
            { taskId: 'a', at: new Date(now + 5 * M).toISOString() },
            { taskId: 'a', at: new Date(now - M).toISOString() },
            { taskId: 'b', at: new Date(now + M).toISOString() },
        ], now);
        expect(map.get('a')).toBe(now + 2 * M);
        expect(map.get('b')).toBe(now + M);
    });

    it('بدون جلسه‌ی آینده → نقشه‌ی خالی', () => {
        expect(nextSessionAtMap([], 1000).size).toBe(0);
        expect(nextSessionAtMap([{ taskId: 'a', at: new Date(500).toISOString() }], 1000).size).toBe(0);
    });

    it('dueSoon فقط برای جلسه‌ی فعلی است (نه جلسه‌ی بعدی‌اش)', () => {
        const now = Date.now();
        const items = [{
            id: 't1', text: 'x', archived: false,
            sessions: [
                { id: 's1', at: new Date(now + 3 * M).toISOString() },
                { id: 's2', at: new Date(now + 4 * M).toISOString() },
            ],
        }];
        const due = collectSharedDue(items, now, {});
        const soon = due.filter(d => d.kind === 'dueSoon');
        expect(soon).toHaveLength(1);
        expect(soon[0].sessId).toBe('s1');
    });

    it('جلسه‌ی گذشته فقط «زمان رسید» می‌گیرد', () => {
        const now = Date.now();
        const items = [{
            id: 't1', text: 'x', archived: false,
            sessions: [
                { id: 's1', at: new Date(now - 2 * M).toISOString() },
                { id: 's2', at: new Date(now + 3 * M).toISOString() },
            ],
        }];
        const due = collectSharedDue(items, now, {});
        expect(due.filter(d => d.kind === 'due').map(d => d.sessId)).toEqual(['s1']);
        expect(due.filter(d => d.kind === 'dueSoon').map(d => d.sessId)).toEqual(['s2']);
    });
});

describe('todaySessions — دایجست امروز شخصی+مشترک (10.19)', () => {
    const M = 60000;

    it('وظایف امروز شخصی و مشترک را می‌شمارد و مرتب می‌کند', () => {
        const now = Date.now();
        const personal = [
            { owner: 'شخصی۱', at: new Date(now + 2 * M).toISOString() },
            { owner: 'شخصی۲', at: new Date(now - 24 * 60 * M).toISOString() },
        ];
        const shared = [{
            id: 't1', text: 'مشترک۱', archived: false,
            sessions: [{ id: 's1', at: new Date(now + M).toISOString() }],
        }];
        const day = dayKey(now);
        const out = todaySessions(personal, shared, day);
        expect(out.map(o => o.owner)).toEqual(['مشترک۱', 'شخصی۱']);
    });

    it('آیتم بایگانی‌شده و جلسه‌ی غیرامروز حذف می‌شود', () => {
        const now = Date.now();
        const personal = [];
        const shared = [
            { id: 'a', text: 'بایگانی', archived: true, sessions: [{ id: 's', at: new Date(now).toISOString() }] },
            { id: 'b', text: 'فردا', archived: false, sessions: [{ id: 's', at: new Date(now + 24 * 60 * M).toISOString() }] },
            { id: 'c', text: 'امروز', archived: false, sessions: [{ id: 's', at: new Date(now).toISOString() }] },
        ];
        const day = dayKey(now);
        const out = todaySessions(personal, shared, day);
        expect(out.map(o => o.owner)).toEqual(['امروز']);
    });

    it('ورودی‌های خالی → خالی', () => {
        expect(todaySessions([], [], 'x')).toEqual([]);
        expect(todaySessions(null, null, 'x')).toEqual([]);
    });
});
describe('store — isTrashOpType (سطل local-only)', () => {
    it('trash-add و trash-delete سطل‌اند', () => {
        expect(isTrashOpType('trash-add')).toBe(true);
        expect(isTrashOpType('trash-delete')).toBe(true);
    });
    it('save و delete سطل نیستند', () => {
        expect(isTrashOpType('save')).toBe(false);
        expect(isTrashOpType('delete')).toBe(false);
        expect(isTrashOpType(null)).toBe(false);
    });
});
