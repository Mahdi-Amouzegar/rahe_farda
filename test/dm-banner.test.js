// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/dm-banner.test.js -- بنر first-contact در نمای مشترک

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../js/i18n.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, t: (key, params) => (params && params.n !== undefined ? `${key}:${params.n}` : key) };
});

const apiCalls = [];
let stateResponse = { relation: 'accepted', remaining: null, connectionId: null };
vi.mock('../js/api.js', async () => ({
    apiFetch: vi.fn(async (path, opts) => {
        apiCalls.push({ path, opts });
        if (path.startsWith('/api/dm/state')) {
            return { ok: true, data: { state: stateResponse } };
        }
        if (path.endsWith('/accept') && opts && opts.method === 'POST') {
            return { ok: true, data: { accepted: true } };
        }
        if (path.endsWith('/reject') && opts && opts.method === 'POST') {
            return { ok: true, data: { rejected: true } };
        }
        if (path === '/api/dm/tasks' && opts && opts.method === 'POST') {
            return { ok: true, data: { task: { id: 'd9' } } };
        }
        if (path.startsWith('/api/dm/tasks?peer=')) {
            return { ok: true, data: { tasks: [] } };
        }
        if (path === '/api/dm/unread') {
            return { ok: true, data: { unread: { total: 0, byPeer: [] } } };
        }
        if (path === '/api/dm/read') return { ok: true, data: { read: true } };
        return { ok: false, error: { code: 'NOT_FOUND', message: 'x' } };
    }),
    apiErrorMessage: (e) => (e && e.message) || 'err',
}));

import { setDestination, __resetDestinationForTest } from '../js/tasks/destination.js';
import { refreshDestBanner } from '../js/tasks/banner.js';

function buildShell() {
    document.body.innerHTML = `
        <div class="task-list" id="taskList"></div>
        <div class="dest-banner" id="destBanner" role="status" hidden></div>
        <div class="photo-snackbar" id="photoSnackbar" role="status" aria-live="polite">
            <div class="photo-snackbar-content">
                <div class="photo-snackbar-msg" id="photoSnackbarMsg"></div>
            </div>
        </div>`;
}

beforeEach(() => {
    __resetDestinationForTest();
    apiCalls.length = 0;
    stateResponse = { relation: 'accepted', remaining: null, connectionId: null };
    buildShell();
});

describe('dm banner', () => {
    it('accepted/none → مخفی', async () => {
        setDestination({ type: 'peer', peerId: 'u2', name: 'سارا' });
        await refreshDestBanner();
        expect(document.getElementById('destBanner').hidden).toBe(true);
    });

    it('pending-in → متن + قبول/رد', async () => {
        stateResponse = { relation: 'pending-in', remaining: null, connectionId: 'c5' };
        setDestination({ type: 'peer', peerId: 'u2', name: 'سارا' });
        await refreshDestBanner();
        const bar = document.getElementById('destBanner');
        expect(bar.hidden).toBe(false);
        expect(bar.textContent).toContain('سارا');
        const btns = [...bar.querySelectorAll('button')];
        expect(btns.length).toBe(2);
        btns[0].click();
        let accepts = [];
        for (let i = 0; i < 30 && accepts.length === 0; i++) {
            await new Promise((r) => setTimeout(r, 100));
            accepts = apiCalls.filter((c) => c.path === '/api/connections/c5/accept');
        }
        expect(accepts.length).toBe(1);
    });

    it('pending-out → پیام انتظار با باقی‌مانده (بدون دکمه)', async () => {
        stateResponse = { relation: 'pending-out', remaining: 3, connectionId: null };
        setDestination({ type: 'peer', peerId: 'u2', name: 'سارا' });
        await refreshDestBanner();
        const bar = document.getElementById('destBanner');
        expect(bar.hidden).toBe(false);
        expect(bar.textContent).toContain('dm.waiting:3');
        expect(bar.querySelectorAll('button').length).toBe(0);
    });

    it('نمای محلی → مخفی', async () => {
        setDestination({ type: 'local' });
        await refreshDestBanner();
        expect(document.getElementById('destBanner').hidden).toBe(true);
    });
});
