// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/personal-sync.test.js — تست‌های Phase 10 مرحله ۱ (سینک فوری شخصی)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../js/i18n.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, t: (key) => key };
});

import { state } from '../js/core.js';
import { sanitizeTask } from '../js/store.js';
import {
    canPushNow,
    toServerOp,
    buildSaveOp,
    isTaskChanged,
    mergeSnapshot,
    pushPendingNow,
    pullFullSnapshot,
    syncOnLogin,
} from '../js/personal-sync.js';

let _savedSync;
let _savedOnline;

beforeEach(() => {
    _savedSync = { ...state.sync };
    _savedOnline = state.net.online;
    state.sync.authToken = null;
    state.sync.userId = null;
    state.sync.deviceId = 'dev-test';
    state.net.online = true;
});

afterEach(() => {
    Object.assign(state.sync, _savedSync);
    state.net.online = _savedOnline;
});

function loggedIn() {
    state.sync.authToken = 'tok-test';
    state.sync.userId = 'user-test';
    state.net.online = true;
}

describe('personal-sync — sanitizeTask نگه‌داشتن مهر سینک', () => {
    it('updatedAt و revision موجود حفظ می‌شوند', () => {
        const t = sanitizeTask({
            id: 'a', text: 'x', createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-02-01T00:00:00.000Z', revision: 3,
        });
        expect(t.updatedAt).toBe('2026-02-01T00:00:00.000Z');
        expect(t.revision).toBe(3);
    });

    it('تسک قدیمی بدون مهر → backfill از createdAt و revision=1', () => {
        const t = sanitizeTask({ id: 'b', text: 'y', createdAt: '2026-01-01T00:00:00.000Z' });
        expect(t.updatedAt).toBe('2026-01-01T00:00:00.000Z');
        expect(t.revision).toBe(1);
    });
});

describe('personal-sync — canPushNow', () => {
    it('مهمان → false (بدون POST)', () => {
        expect(canPushNow()).toBe(false);
    });

    it('آفلاینِ واردشده → false', () => {
        loggedIn();
        state.net.online = false;
        expect(canPushNow()).toBe(false);
    });

    it('واردشده+آنلاین → true', () => {
        loggedIn();
        expect(canPushNow()).toBe(true);
    });
});

describe('personal-sync — toServerOp/buildSaveOp', () => {
    it('مهر تسک به timestamp op می‌رود (نه now)', () => {
        const task = { id: 't1', text: 'hi', updatedAt: '2026-03-01T10:00:00.000Z', revision: 1 };
        const op = buildSaveOp(task, { deviceId: 'd1', nowIso: '2026-05-01T00:00:00.000Z' });
        expect(op.timestamp).toBe('2026-03-01T10:00:00.000Z');
        expect(op.entityId).toBe('t1');
        expect(op.entityType).toBe('task');
        expect(op.parentId).toBe(null);
    });

    it('toServerOp فیلدهای صف را کامل نگاشت می‌کند', () => {
        const entry = {
            id: 'op1', type: 'save', entityId: 't1', entityType: 'task',
            data: { id: 't1' }, parentId: null, timestamp: '2026-03-01T10:00:00.000Z',
            deviceId: 'd1', schemaVersion: '1.0.0', retries: 0, lastError: null,
        };
        const op = toServerOp(entry);
        expect(op.id).toBe('op1');
        expect(op.timestamp).toBe('2026-03-01T10:00:00.000Z');
        expect(op.deviceId).toBe('d1');
    });
});

describe('personal-sync — pushPendingNow', () => {
    it('مهمان → بدون POST، صف دست‌نخورده', async () => {
        const postSync = vi.fn();
        const r = await pushPendingNow({ readQueue: async () => [{ id: 'op1' }], postSync, removeOps: vi.fn() });
        expect(r.ok).toBe(false);
        expect(postSync).not.toHaveBeenCalled();
    });

    it('فقط acceptedها از صف حذف می‌شوند', async () => {
        loggedIn();
        const removeOps = vi.fn(async () => {});
        const postSync = vi.fn(async () => ({
            ok: true,
            data: { accepted: [{ opId: 'op1' }], rejected: [{ opId: 'op2', reason: 'stale' }] },
        }));
        const r = await pushPendingNow({
            readQueue: async () => [
                { id: 'op1', type: 'save', entityId: 't1', entityType: 'task', data: {}, parentId: null, timestamp: '2026-01-01T00:00:00.000Z', deviceId: 'd', schemaVersion: '1.0.0', retries: 0, lastError: null },
                { id: 'op2', type: 'save', entityId: 't2', entityType: 'task', data: {}, parentId: null, timestamp: '2026-01-01T00:00:00.000Z', deviceId: 'd', schemaVersion: '1.0.0', retries: 0, lastError: null },
            ],
            postSync,
            removeOps,
        });
        expect(r.ok).toBe(true);
        expect(r.pushed).toBe(1);
        expect(removeOps).toHaveBeenCalledWith(['op1']);
        const sentBody = postSync.mock.calls[0][0];
        expect(sentBody.ops).toHaveLength(2);
        expect(sentBody.requestFullResync).toBe(false);
    });

    it('صف خالی → ok بدون POST', async () => {
        loggedIn();
        const postSync = vi.fn();
        const r = await pushPendingNow({ readQueue: async () => [], postSync, removeOps: vi.fn() });
        expect(r.ok).toBe(true);
        expect(r.pushed).toBe(0);
        expect(postSync).not.toHaveBeenCalled();
    });

    it('خطای شبکه → ok:false و حذف از صف انجام نمی‌شود', async () => {
        loggedIn();
        const removeOps = vi.fn();
        const r = await pushPendingNow({
            readQueue: async () => [{ id: 'op1' }],
            postSync: async () => ({ ok: false, error: { code: 'NETWORK_ERROR' } }),
            removeOps,
        });
        expect(r.ok).toBe(false);
        expect(removeOps).not.toHaveBeenCalled();
    });
});

describe('personal-sync — isTaskChanged (قانون تأییدشده)', () => {
    it('id متفاوت → false', () => {
        expect(isTaskChanged({ id: 'a', revision: 2, updatedAt: '2026-02-01T00:00:00.000Z' }, { id: 'b', revision: 1, updatedAt: '2026-01-01T00:00:00.000Z' })).toBe(false);
    });

    it('revision متفاوت → true', () => {
        expect(isTaskChanged({ id: 'a', revision: 2, updatedAt: '2026-01-01T00:00:00.000Z' }, { id: 'a', revision: 1, updatedAt: '2026-01-01T00:00:00.000Z' })).toBe(true);
    });

    it('revision یکسان ولی updatedAt جدیدتر → true', () => {
        expect(isTaskChanged({ id: 'a', revision: 1, updatedAt: '2026-02-01T00:00:00.000Z' }, { id: 'a', revision: 1, updatedAt: '2026-01-01T00:00:00.000Z' })).toBe(true);
    });

    it('همان‌چیز → false', () => {
        expect(isTaskChanged({ id: 'a', revision: 1, updatedAt: '2026-01-01T00:00:00.000Z' }, { id: 'a', revision: 1, updatedAt: '2026-01-01T00:00:00.000Z' })).toBe(false);
    });
});

describe('personal-sync — mergeSnapshot', () => {
    it('فقط-سرور اضافه، فقط-لوکال نگه داشته می‌شود', () => {
        const out = mergeSnapshot(
            [{ id: 'local', text: 'l', updatedAt: '2026-01-01T00:00:00.000Z', revision: 1 }],
            [{ entityId: 'srv', data: JSON.stringify({ id: 'srv', text: 's' }), revision: 1, createdAt: '2026-01-02T00:00:00.000Z' }],
        );
        expect(out.map(t => String(t.id)).sort()).toEqual(['local', 'srv']);
    });

    it('تعارض: updatedAt جدیدتر می‌برد؛ تساوی → سرور', () => {
        const newer = mergeSnapshot(
            [{ id: 'x', text: 'old', updatedAt: '2026-01-01T00:00:00.000Z', revision: 1 }],
            [{ entityId: 'x', data: { id: 'x', text: 'new' }, revision: 2, createdAt: '2026-02-01T00:00:00.000Z' }],
        );
        expect(newer[0].text).toBe('new');
        const localWins = mergeSnapshot(
            [{ id: 'x', text: 'mine', updatedAt: '2026-03-01T00:00:00.000Z', revision: 1 }],
            [{ entityId: 'x', data: { id: 'x', text: 'srv' }, revision: 1, createdAt: '2026-02-01T00:00:00.000Z' }],
        );
        expect(localWins[0].text).toBe('mine');
    });
});

describe('personal-sync — syncOnLogin مرحله ۲ (مهمانِ تازه)', () => {
    it('snapshot خالی + لوکال غیرخالی → push همه', async () => {
        loggedIn();
        const postSync = vi.fn(async () => ({ ok: true, data: { accepted: [], rejected: [] } }));
        const r = await syncOnLogin({
            readLocal: () => [
                { id: 'a', text: 'one', updatedAt: '2026-01-01T00:00:00.000Z', revision: 1 },
                { id: 'b', text: 'two', updatedAt: '2026-01-02T00:00:00.000Z', revision: 1 },
            ],
            postSync,
            readQueue: async () => [],
            removeOps: vi.fn(),
            persist: vi.fn(),
        });
        // pull اول (ops خالی + fullSnapshot) + push دوم
        expect(postSync).toHaveBeenCalledTimes(2);
        expect(postSync.mock.calls[0][0].requestFullResync).toBe(true);
        expect(postSync.mock.calls[0][0].ops).toHaveLength(0);
        expect(postSync.mock.calls[1][0].ops).toHaveLength(2);
        expect(r.ok).toBe(true);
        expect(r.action).toBe('pushed-all');
        expect(r.persisted).toBe(false);
    });

    it('هر دو خالی → هیچ POSTای', async () => {
        loggedIn();
        const postSync = vi.fn(async () => ({ ok: true, data: { fullSnapshot: [] } }));
        const persist = vi.fn();
        const r = await syncOnLogin({ readLocal: () => [], postSync, persist });
        expect(postSync).toHaveBeenCalledTimes(1);
        expect(persist).toHaveBeenCalled();
        expect(r.action).toBe('merged');
        expect(r.pushed).toBe(0);
    });
});

describe('personal-sync — syncOnLogin مرحله ۳ (مهمانِ قبلی)', () => {
    it('merge بدون overwrite + push فقط تازه/تغییرکرده', async () => {
        loggedIn();
        const serverOlder = { entityId: 'keep', data: { id: 'keep', text: 'srv-old', updatedAt: '2026-01-01T00:00:00.000Z', revision: 1 }, revision: 1, createdAt: '2026-01-01T00:00:00.000Z' };
        const serverSame = { entityId: 'same', data: { id: 'same', text: 'same', updatedAt: '2026-01-01T00:00:00.000Z', revision: 1 }, revision: 1, createdAt: '2026-01-01T00:00:00.000Z' };
        const postSync = vi.fn(async (body) => {
            if (body.requestFullResync) return { ok: true, data: { fullSnapshot: [serverOlder, serverSame] } };
            return { ok: true, data: { accepted: [], rejected: [] } };
        });
        const persist = vi.fn(async () => {});
        const r = await syncOnLogin({
            readLocal: () => [
                { id: 'keep', text: 'mine-new', updatedAt: '2026-02-01T00:00:00.000Z', revision: 1 },
                { id: 'same', text: 'same', updatedAt: '2026-01-01T00:00:00.000Z', revision: 1 },
                { id: 'guest-new', text: 'g', updatedAt: '2026-02-01T00:00:00.000Z', revision: 1 },
            ],
            postSync,
            persist,
        });
        // persist با merge: keep=نسخه لوکال (جدیدتر)، same=سرور، guest-new نگه داشته
        const merged = persist.mock.calls[0][0];
        expect(merged.find(t => String(t.id) === 'keep').text).toBe('mine-new');
        expect(merged.find(t => String(t.id) === 'same').text).toBe('same');
        expect(merged.find(t => String(t.id) === 'guest-new')).toBeTruthy();
        // push فقط keep (تغییرکرده) + guest-new (تازه) — نه same
        const pushBody = postSync.mock.calls[postSync.mock.calls.length - 1][0];
        expect(pushBody.ops.map(o => o.entityId).sort()).toEqual(['guest-new', 'keep']);
        expect(r.action).toBe('merged');
        expect(r.persisted).toBe(true);
    });

    it('pull شکست خورد → fallback به push صف', async () => {
        loggedIn();
        const postSync = vi.fn(async () => ({ ok: false, error: { code: 'NETWORK_ERROR' } }));
        const r = await syncOnLogin({
            readLocal: () => [{ id: 'a', text: 'x', updatedAt: '2026-01-01T00:00:00.000Z', revision: 1 }],
            postSync,
            readQueue: async () => [],
            removeOps: vi.fn(),
        });
        expect(r.ok).toBe(true);
    });
});

describe('personal-sync — pullFullSnapshot', () => {
    it('مهمان → بدون POST', async () => {
        const postSync = vi.fn();
        const r = await pullFullSnapshot({ postSync });
        expect(r.ok).toBe(false);
        expect(postSync).not.toHaveBeenCalled();
    });
});
