// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/readtrack.test.js -- خواندن تدریجی با دید

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../js/i18n.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, t: (key) => key };
});

vi.mock('../js/net.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, isOnline: () => true };
});

const apiCalls = [];
vi.mock('../js/api.js', async () => ({
    apiFetch: vi.fn(async (path, opts) => {
        apiCalls.push({ path, opts });
        if (path === '/api/dm/read') return { ok: true, data: { read: true } };
        if (path === '/api/dm/unread') {
            return { ok: true, data: { unread: { total: 0, byPeer: [] } } };
        }
        if (path.endsWith('/unread')) {
            return { ok: true, data: { unread: { messages: 0, tasks: 0, lastReadAt: null } } };
        }
        if (path.endsWith('/read')) return { ok: true, data: { readAt: 'now' } };
        return { ok: false, error: { code: 'NOT_FOUND', message: 'x' } };
    }),
    apiErrorMessage: (e) => (e && e.message) || 'err',
}));

import {
    isFullyVisible,
    maxNewlyRead,
    advanceCursorFor,
    __setSentCursorForTest,
    __getSentCursorForTest,
} from '../js/tasks/readtrack.js';
import { setDestination, __resetDestinationForTest } from '../js/tasks/destination.js';

const peerItem = (id, updatedAt, mine) => ({
    id, text: 't', updatedAt,
    _shared: { mine: !!mine, dest: { type: 'peer', peerId: 'u2' }, remoteId: id },
});

const rect = (top, bottom) => ({ top, bottom, height: bottom - top });
const withRects = (el, r) => {
    el.getBoundingClientRect = () => ({ ...r, height: r.bottom - r.top, left: 0, right: 100, width: 100 });
    return el;
};

beforeEach(() => {
    __resetDestinationForTest();
    __setSentCursorForTest('');
    apiCalls.length = 0;
    document.body.innerHTML = `
        <div class="task-list" id="taskList"></div>
        <span id="headerContext"></span>`;
});

describe('readtrack — geometry', () => {
    it('داخل کامل قاب: true؛ بیرون: false؛ پوشاننده: true', () => {
        const box = withRects(document.createElement('div'), rect(0, 200));
        expect(isFullyVisible(withRects(document.createElement('div'), rect(10, 50)), box)).toBe(true);
        expect(isFullyVisible(withRects(document.createElement('div'), rect(150, 250)), box)).toBe(false);
        expect(isFullyVisible(withRects(document.createElement('div'), rect(-50, 300)), box)).toBe(true);
        expect(isFullyVisible(withRects(document.createElement('div'), rect(0, 0)), box)).toBe(false);
    });
});

describe('readtrack — maxNewlyRead', () => {
    it('فقط مخاطب، فقط دیده‌شده، فقط جلوتر از cursor', () => {
        const items = [
            peerItem('d1', '2026-01-01', false),
            peerItem('d2', '2026-01-05', false),
            peerItem('d3', '2026-01-09', false),
            peerItem('m1', '2026-01-10', true),
        ];
        expect(maxNewlyRead(items, new Set(['d1', 'd2', 'd3', 'm1']), '')).toBe('2026-01-09');
        expect(maxNewlyRead(items, new Set(['d1']), '')).toBe('2026-01-01');
        expect(maxNewlyRead(items, new Set(['d1', 'd2']), '2026-01-05')).toBe(null);
        expect(maxNewlyRead(items, new Set(), '')).toBe(null);
    });
});

describe('readtrack — advanceCursorFor', () => {
    it('DM: ثبت at تا نقطه + cursor جلو می‌رود و دوباره ارسال نمی‌شود', async () => {
        setDestination({ type: 'peer', peerId: 'u2', name: 'سارا' });
        const r1 = await advanceCursorFor({ type: 'peer', peerId: 'u2' }, '2026-01-05');
        expect(r1.ok).toBe(true);
        expect(__getSentCursorForTest()).toBe('2026-01-05');
        const posts = apiCalls.filter((c) => c.path === '/api/dm/read');
        expect(posts.length).toBe(1);
        expect(posts[0].opts.body).toMatchObject({ peerId: 'u2', at: '2026-01-05' });
        const r2 = await advanceCursorFor({ type: 'peer', peerId: 'u2' }, '2026-01-05');
        expect(r2.ok).toBe(false);
        expect(apiCalls.filter((c) => c.path === '/api/dm/read').length).toBe(1);
    });

    it('گروه: ثبت type=tasks با at', async () => {
        setDestination({ type: 'group', groupId: 'g1', name: 'سفر' });
        const r = await advanceCursorFor({ type: 'group', groupId: 'g1' }, '2026-02-01');
        expect(r.ok).toBe(true);
        const posts = apiCalls.filter((c) => c.path === '/api/groups/g1/read');
        expect(posts.length).toBe(1);
        expect(posts[0].opts.body).toMatchObject({ type: 'tasks', at: '2026-02-01' });
    });
});
