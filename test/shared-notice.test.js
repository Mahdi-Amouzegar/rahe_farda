// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/shared-notice.test.js — رگرسیون 10.23
//
//   ۱) buildSharedNewTaskNotice — متن اعلان «تسک تازه از طرف مقابل»
//   ۲) cacheSharedItems — تشخیص delta (بیس‌لاین ساکت، خودی نادیده)
//   ۳) collectSharedDue — سررسید زیرکارِ برنامه‌ی مشترک هم هشدار می‌دهد

import { describe, it, expect, beforeEach, vi } from 'vitest';

// i18n واقعی بارگذاری نمی‌شود (fetch لازم دارد) → t کلید + پارامترها را برمی‌گرداند
vi.mock('../js/i18n.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        t: (key, params) => (params ? key + '|' + JSON.stringify(params) : key),
        formatNumber: (n) => String(n),
    };
});

/** پارامترهای تزریق‌شده به کلید ترجمه */
function paramsOf(str) {
    const s = String(str || '');
    const i = s.indexOf('|');
    return i < 0 ? {} : JSON.parse(s.slice(i + 1));
}

// ═══════════════════════════════════════════════════════════════════════════
// ۱. متن اعلان
// ═══════════════════════════════════════════════════════════════════════════

describe('buildSharedNewTaskNotice — متن اعلان تسک تازه (10.23)', () => {
    let notify;

    beforeEach(async () => {
        vi.resetModules();
        notify = await import('../js/notify.js');
    });

    const dmTask = () => ({
        id: 't1',
        text: 'خرید نان',
        _shared: { mine: false, senderName: 'سارا', dest: { type: 'peer', peerId: 'p1' } },
    });

    it('پیام خصوصی: نام فرستنده + عنوان تسک', () => {
        const n = notify.buildSharedNewTaskNotice({
            key: 'peer:p1', destName: 'سارا', dest: { type: 'peer', peerId: 'p1' }, tasks: [dmTask()],
        });
        expect(n).not.toBeNull();
        expect(n.toast.startsWith('notifications.sharedNew.dmToast')).toBe(true);
        expect(paramsOf(n.toast)).toEqual({ sender: 'سارا', title: 'خرید نان' });
        expect(paramsOf(n.title)).toEqual({ sender: 'سارا' });
        expect(paramsOf(n.body)).toEqual({ sender: 'سارا', title: 'خرید نان' });
    });

    it('گروه: نام گروه + نام فرستنده + عنوان تسک', () => {
        const t = dmTask();
        t._shared.dest = { type: 'group', groupId: 'g1' };
        const n = notify.buildSharedNewTaskNotice({
            key: 'group:g1', destName: 'تیم فنی', dest: { type: 'group', groupId: 'g1' }, tasks: [t],
        });
        expect(n.toast.startsWith('notifications.sharedNew.groupToast')).toBe(true);
        expect(paramsOf(n.toast)).toEqual({ sender: 'سارا', group: 'تیم فنی', title: 'خرید نان' });
        expect(paramsOf(n.title)).toEqual({ group: 'تیم فنی' });
    });

    it('چند تسک تازه → یک اعلان شمارشی (نه چند toast روی هم)', () => {
        const a = dmTask();
        const b = dmTask();
        b.id = 't2';
        b.text = 'خرید میوه';
        const n = notify.buildSharedNewTaskNotice({
            key: 'group:g1', destName: 'تیم فنی', dest: { type: 'group', groupId: 'g1' }, tasks: [a, b],
        });
        expect(n.toast.startsWith('notifications.sharedNew.groupToastMany')).toBe(true);
        expect(paramsOf(n.toast).n).toBe('2');
    });

    it('بدون فرستنده/گروه → متن جایگزین (نه رشته‌ی خالی)', () => {
        const t = dmTask();
        t._shared.senderName = null;
        const n = notify.buildSharedNewTaskNotice({
            key: 'peer:p1', dest: { type: 'peer', peerId: 'p1' }, tasks: [t],
        });
        expect(paramsOf(n.toast).sender).toBe('notifications.sharedNew.unknownPeer');
    });

    it('فقط تسک خودی → null (اعلان نمی‌دهیم)', () => {
        const t = dmTask();
        t._shared.mine = true;
        expect(notify.buildSharedNewTaskNotice({ tasks: [t] })).toBeNull();
        expect(notify.buildSharedNewTaskNotice({ tasks: [] })).toBeNull();
        expect(notify.buildSharedNewTaskNotice(null)).toBeNull();
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// ۲. تشخیص تسک تازه در کش مقصد
// ═══════════════════════════════════════════════════════════════════════════

describe('cacheSharedItems — رویداد تسک تازه (10.23)', () => {
    let source;
    let events;
    let EV;
    let got;

    const foreign = (id, text) => ({
        id, text, archived: false, completed: false, sessions: [],
        _shared: { mine: false, senderName: 'سارا', dest: { type: 'group', groupId: 'g1' } },
    });

    beforeEach(async () => {
        vi.resetModules();
        source = await import('../js/tasks/source.js');
        ({ events, EV } = await import('../js/events.js'));
        source.__resetSharedForTest();
        got = [];
        events.on(EV.SHARED_NEW_TASK, (p) => got.push(p));
    });

    it('نخستین پر شدن کش (بیس‌لاین) اعلان نمی‌دهد', () => {
        source.cacheSharedItems('group:g1', [foreign('t1', 'الف')], 'تیم فنی');
        expect(got).toHaveLength(0);
    });

    it('تسک تازه‌ی دیگران → یک رویداد با همان آیتم', () => {
        source.cacheSharedItems('group:g1', [foreign('t1', 'الف')], 'تیم فنی');
        source.cacheSharedItems('group:g1', [foreign('t1', 'الف'), foreign('t2', 'ب')], 'تیم فنی');
        expect(got).toHaveLength(1);
        expect(got[0].tasks.map(t => t.id)).toEqual(['t2']);
        expect(got[0].destName).toBe('تیم فنی');
        expect(got[0].key).toBe('group:g1');
    });

    it('تسک خودی تازه → اعلان نمی‌دهد', () => {
        source.cacheSharedItems('group:g1', [foreign('t1', 'الف')], 'تیم فنی');
        const mine = foreign('t9', 'خودم');
        mine._shared.mine = true;
        source.cacheSharedItems('group:g1', [foreign('t1', 'الف'), mine], 'تیم فنی');
        expect(got).toHaveLength(0);
    });

    it('همان لیست دوباره → رویداد تکراری نمی‌دهد', () => {
        source.cacheSharedItems('group:g1', [foreign('t1', 'الف')], 'تیم فنی');
        source.cacheSharedItems('group:g1', [foreign('t1', 'الف'), foreign('t2', 'ب')], 'تیم فنی');
        source.cacheSharedItems('group:g1', [foreign('t1', 'الف'), foreign('t2', 'ب')], 'تیم فنی');
        expect(got).toHaveLength(1);
    });

    it('برنامه بسته بوده: تسک تازه در بازگشایی بعدی هم اعلان می‌گیرد', async () => {
        // نشست ۱ — بیس‌لاین
        source.cacheSharedItems('group:g1', [foreign('t1', 'الف')], 'تیم فنی');
        expect(got).toHaveLength(0);

        // نشست ۲ — کش حافظه با رفرش پاک شده، ولی idهای دیده‌شده روی دیسک مانده‌اند
        vi.resetModules();
        const src2 = await import('../js/tasks/source.js');
        const ev2 = await import('../js/events.js');
        const got2 = [];
        ev2.events.on(ev2.EV.SHARED_NEW_TASK, (p) => got2.push(p));

        src2.cacheSharedItems('group:g1', [foreign('t1', 'الف')], 'تیم فنی');
        expect(got2).toHaveLength(0); // تسک قدیمی دوباره اعلان نمی‌شود

        src2.cacheSharedItems('group:g1', [foreign('t1', 'الف'), foreign('t2', 'ب')], 'تیم فنی');
        expect(got2.map(p => p.tasks.map(t => t.id))).toEqual([['t2']]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// ۳. هشدار سررسید زیرکارِ برنامه‌ی مشترک
// ═══════════════════════════════════════════════════════════════════════════

describe('collectSharedDue — زیرکار برنامه‌ی مشترک (10.23)', () => {
    let notify;

    beforeEach(async () => {
        vi.resetModules();
        notify = await import('../js/notify.js');
    });

    it('سررسیدِ زیرکار هم هشدار «زمان رسید» می‌گیرد', () => {
        const now = Date.now();
        const at = new Date(now - 60 * 1000).toISOString();
        const plan = {
            id: 'p1', text: 'برنامه', kind: 'plan', archived: false, sessions: [],
            children: [{
                id: 'c1', text: 'زیرکار', archived: false,
                sessions: [{ id: 'c1@' + at, at }],
            }],
            _shared: { mine: false, dest: { type: 'group', groupId: 'g1' } },
        };
        const out = notify.collectSharedDue([plan], now, {});
        const hit = out.find(o => o.sessId === 'c1@' + at);
        expect(hit).toBeTruthy();
        expect(hit.kind).toBe('due');
        expect(hit.owner).toBe('زیرکار');
        expect(hit.key).toBe('shr:c1:c1@' + at);
    });

    it('زیرکارِ آرشیوشده هشدار نمی‌دهد', () => {
        const now = Date.now();
        const at = new Date(now - 60 * 1000).toISOString();
        const plan = {
            id: 'p1', text: 'برنامه', kind: 'plan', archived: false, sessions: [],
            children: [{ id: 'c1', text: 'زیرکار', archived: true, sessions: [{ id: 'c1@' + at, at }] }],
        };
        const out = notify.collectSharedDue([plan], now, {});
        expect(out).toHaveLength(0);
    });

    it('برنامه‌ی معمولی (بدون فرزند) همان رفتار قبلی را دارد', () => {
        const now = Date.now();
        const at = new Date(now - 60 * 1000).toISOString();
        const t = { id: 't1', text: 'کار', archived: false, sessions: [{ id: 's1', at }] };
        const out = notify.collectSharedDue([t], now, {});
        expect(out.map(o => o.key)).toEqual(['shr:t1:s1']);
    });
});
