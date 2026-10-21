// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/due-line-live.test.js — رگرسیون 10.21
//
//   BUG-20: due-line باید با گذشتن زمان زنده شود (بدون رفرش) — شخصی/DM/گروه
//   BUG-21: AudioContext بدون ژست کاربر ساخته نشود (هشدار کروم)
//   BUG-22: apiFetch بدون سقف زمان نماند + listGroups هم‌زمان چندبار fetch نکند

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const fetchCalls = [];
let fetchImpl = null;

vi.mock('../js/api.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        apiFetch: vi.fn(async (path, opts) => {
            fetchCalls.push({ path, opts });
            return fetchImpl(path, opts);
        }),
    };
});

const H = 3600000;

// ═══════════════════════════════════════════════════════════════════════════
// BUG-20 — فاز due-line
// ═══════════════════════════════════════════════════════════════════════════

describe('dueLinePhase — فاز due-line (10.21/BUG-20)', () => {
    let dueLinePhase;

    beforeEach(async () => {
        ({ dueLinePhase } = await import('../js/sessions.js'));
    });

    it('بدون جلسه → رشته‌ی خالی', () => {
        expect(dueLinePhase({ sessions: [] })).toBe('');
        expect(dueLinePhase({})).toBe('');
        expect(dueLinePhase(null)).toBe('');
    });

    it('تکمیل‌شده → c<count>', () => {
        const t = { completed: true, sessions: [{ id: 's1', at: new Date().toISOString() }] };
        expect(dueLinePhase(t)).toBe('c1');
    });

    it('جلسه‌ی آینده → u<at>#<روز>', () => {
        const now = Date.now();
        const at = new Date(now + 2 * H).toISOString();
        const fp = dueLinePhase({ sessions: [{ id: 's1', at }] }, now);
        expect(fp).toBe('u' + new Date(at).getTime() + '#0');
    });

    it('همه گذشته → o<latest> (سررسید گذشته)', () => {
        const now = Date.now();
        const older = new Date(now - 3 * H).toISOString();
        const latest = new Date(now - H).toISOString();
        const fp = dueLinePhase({ sessions: [{ id: 's1', at: older }, { id: 's2', at: latest }] }, now);
        expect(fp).toBe('o' + new Date(latest).getTime());
    });

    it('با گذشتن سررسید، فاز عوض می‌شود (منبع باگ: due-line کهنه)', () => {
        const now = Date.now();
        const at = new Date(now + 1000).toISOString();
        const task = { sessions: [{ id: 's1', at }] };
        const before = dueLinePhase(task, now);
        const after = dueLinePhase(task, now + 2000);
        expect(before).not.toBe(after);
        expect(after).toBe('o' + new Date(at).getTime());
    });

    it('فاصله‌ی روز در فاز هست (امروز → فردا در نیمه‌شب)', () => {
        const now = new Date(2026, 9, 20, 23, 30, 0).getTime();
        const at = new Date(2026, 9, 21, 0, 30, 0).toISOString();
        const lateNight = dueLinePhase({ sessions: [{ id: 's1', at }] }, now);
        expect(lateNight.endsWith('#1')).toBe(true);
        const afterMidnight = dueLinePhase({ sessions: [{ id: 's1', at }] }, new Date(2026, 9, 21, 0, 10, 0).getTime());
        expect(afterMidnight.endsWith('#0')).toBe(true);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// BUG-20 — جلو بردن لیست روی صفحه (نه فقط کش)
// ═══════════════════════════════════════════════════════════════════════════

describe('rollforwardSharedCache — لیست روی صفحه هم جلو می‌رود (10.21)', () => {
    let notify, source;

    beforeEach(async () => {
        vi.resetModules();
        notify = await import('../js/notify.js');
        source = await import('../js/tasks/source.js');
        source.__resetSharedForTest();
    });

    afterEach(() => { source.__resetSharedForTest(); });

    it('وقتی کش و لیست دو آبجکت جدا با همان id دارند، هر دو جلو می‌روند', () => {
        const mk = () => ({
            id: 't1', text: 'مشترک', recur: 'daily', archived: false, completed: false,
            sessions: [{ id: 's0', at: new Date(Date.now() - H).toISOString() }],
            _shared: { mine: false, dest: { type: 'peer', peerId: 'p1' } },
        });
        const cached = mk();
        const visible = mk();
        source.cacheSharedItems('peer:p1', [cached]);
        source.setSharedItems([visible]);

        const advanced = notify.rollforwardSharedCache(Date.now());

        expect(advanced).toHaveLength(1);
        expect(cached.sessions.length).toBe(2);
        expect(visible.sessions.length).toBe(2);
        expect(new Date(visible.sessions[1].at).getTime()).toBeGreaterThan(Date.now());
    });

    it('برنامه‌ی مشترک: زیرکارِ دوره‌ای هم جلو می‌رود (10.22)', () => {
        const child = {
            id: 'c1', text: 'زیرکار', recur: 'daily', archived: false, completed: false,
            sessions: [{ id: 's0', at: new Date(Date.now() - H).toISOString() }],
        };
        const plan = {
            id: 'p1', text: 'برنامه', kind: 'plan', recur: 'none', archived: false, completed: false,
            sessions: [{ id: 'ps0', at: new Date(Date.now() - 2 * H).toISOString() }],
            children: [child],
            _shared: { mine: false, dest: { type: 'group', groupId: 'g1' } },
        };
        source.cacheSharedItems('group:g1', [plan]);

        const advanced = notify.rollforwardSharedCache(Date.now());

        // خود برنامه دوره‌ای نیست → فقط فرزند جلو می‌رود، ولی آیتم والد گزارش می‌شود
        expect(advanced).toHaveLength(1);
        expect(plan.sessions.length).toBe(1);
        expect(child.sessions.length).toBe(2);
        expect(new Date(child.sessions[1].at).getTime()).toBeGreaterThan(Date.now());
        // id قطعی: چند دستگاه روی یک سررسید همگرا شوند
        expect(child.sessions[1].id).toBe('c1@' + child.sessions[1].at);
    });

    it('همان آبجکت در کش و لیست → فقط یک بار جلو می‌رود (بدون جلسه‌ی تکراری)', () => {
        const t = {
            id: 't1', text: 'x', recur: 'daily', archived: false, completed: false,
            sessions: [{ id: 's0', at: new Date(Date.now() - H).toISOString() }],
            _shared: { mine: false, dest: { type: 'group', groupId: 'g1' } },
        };
        source.cacheSharedItems('group:g1', [t]);
        source.setSharedItems([t]);

        notify.rollforwardSharedCache(Date.now());
        expect(t.sessions.length).toBe(2);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// BUG-21 — صدا فقط بعد از ژست کاربر
// ═══════════════════════════════════════════════════════════════════════════

describe('audio unlock — بدون ژست کانتکست ساخته نمی‌شود (10.21/BUG-21)', () => {
    let created = 0;
    let notify;

    beforeEach(async () => {
        created = 0;
        vi.resetModules();
        window.AudioContext = class {
            constructor() { created++; this.state = 'running'; this.currentTime = 0; }
            resume() { return Promise.resolve(); }
            createOscillator() { return { frequency: {}, connect() {}, start() {}, stop() {} }; }
            createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
            get destination() { return {}; }
        };
        notify = await import('../js/notify.js');
    });

    it('ensureAudio بدون ژست → null و هیچ کانتکستی ساخته نمی‌شود', () => {
        expect(notify.ensureAudio()).toBeNull();
        expect(created).toBe(0);
    });

    it('unlockAudio → کانتکست ساخته و آماده می‌شود', () => {
        expect(notify.unlockAudio()).toBe(true);
        expect(created).toBe(1);
        expect(notify.ensureAudio()).not.toBeNull();
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// BUG-22 — timeout و dedupe
// ═══════════════════════════════════════════════════════════════════════════

describe('listGroups — یک درخواست در پرواز (10.21/BUG-22)', () => {
    it('دو فراخوان هم‌زمان → فقط یک apiFetch', async () => {
        vi.resetModules();
        fetchCalls.length = 0;
        let release;
        fetchImpl = () => new Promise((resolve) => {
            release = () => resolve({ ok: true, data: { groups: [] } });
        });
        const { listGroups } = await import('../js/communication/groups.js');
        const p1 = listGroups({ force: true });
        const p2 = listGroups({ force: true });
        for (let i = 0; i < 20 && typeof release !== 'function'; i++) await Promise.resolve();
        expect(typeof release).toBe('function');
        release();
        const [a, b] = await Promise.all([p1, p2]);
        expect(a.ok).toBe(true);
        expect(b.ok).toBe(true);
        expect(fetchCalls.filter(c => c.path === '/api/groups')).toHaveLength(1);
    });
});
