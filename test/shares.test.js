// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/shares.test.js — تست‌های اشتراک‌گذاری تسک (8.2-C)

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../js/i18n.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, t: (key) => key };
});

const apiCalls = [];
vi.mock('../js/api.js', async () => ({
    apiFetch: vi.fn(async (path, opts) => {
        apiCalls.push({ path, opts });
        if (path === '/api/connections') {
            return {
                ok: true,
                data: {
                    connections: [
                        {
                            id: 'c1', status: 'accepted',
                            otherUserId: 'u2',
                            otherUser: { id: 'u2', username: 'sara', displayName: 'سارا' },
                        },
                    ],
                },
            };
        }
        if (path.startsWith('/api/messages?with=')) {
            return { ok: true, data: { messages: [], nextCursor: null, hasMore: false } };
        }
        if (path === '/api/task-shares' && opts && opts.method === 'POST') {
            return { ok: true, data: { share: { id: 's1' } } };
        }
        return { ok: true, data: {} };
    }),
    apiErrorMessage: (e) => (e && e.message) || 'err',
}));

import { shareTaskWith, openSharePicker } from '../js/communication/shares.js';

function buildShell() {
    document.body.innerHTML = `
        <div class="workspace-root" id="workspaceRoot">
            <section id="ws-messages"></section>
        </div>
        <button id="anchor">⋯</button>`;
}

beforeEach(() => {
    apiCalls.length = 0;
    buildShell();
});

describe('shares', () => {
    it('shareTaskWith مسیر و body درست را می‌فرستد', async () => {
        const res = await shareTaskWith('task-1', 'u2');
        expect(res.ok).toBe(true);
        expect(apiCalls[0]).toMatchObject({
            path: '/api/task-shares',
            opts: expect.objectContaining({ method: 'POST' }),
        });
        expect(apiCalls[0].opts.body).toMatchObject({ recipientId: 'u2', sourceTaskId: 'task-1' });
    });

    it('openSharePicker مخاطبان را لیست می‌کند', async () => {
        await openSharePicker(document.getElementById('anchor'), 'task-1');
        const items = [...document.querySelectorAll('[data-menu-id]')].map((b) => b.dataset.menuId);
        expect(items).toEqual(['u2']);
    });
});
