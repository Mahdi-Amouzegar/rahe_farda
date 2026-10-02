// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/search.test.js — تست فضای جستجو (8.3-D)

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../js/i18n.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, t: (key) => key, formatDateTime: (s) => s };
});

const netState = { online: true };
vi.mock('../js/net.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, isOnline: () => netState.online };
});

const apiCalls = [];
vi.mock('../js/api.js', async () => ({
    apiFetch: vi.fn(async (path, opts) => {
        apiCalls.push({ path, opts });
        if (path.startsWith('/api/search')) {
            return {
                ok: true,
                data: {
                    users: [{ id: 'u9', username: 'newguy', displayName: null, avatarUrl: null }],
                    groups: [{ id: 'g9', name: 'Pub', avatarUrl: null }],
                },
            };
        }
        if (path === '/api/groups') {
            return { ok: true, data: { groups: [{ id: 'g9', name: 'Pub' }] } };
        }
        if (path === '/api/connections/request') {
            return { ok: true, data: { connection: { id: 'c9' } } };
        }
        return { ok: true, data: {} };
    }),
    apiErrorMessage: (e) => (e && e.message) || 'err',
}));

import { openSearchWorkspace, __resetSearchForTest } from '../js/communication/search.js';

function buildShell() {
    document.body.innerHTML = `
        <div class="workspace-root" id="workspaceRoot">
            <section id="ws-search"></section>
        </div>`;
}

beforeEach(() => {
    __resetSearchForTest();
    apiCalls.length = 0;
    netState.online = true;
    buildShell();
});

describe('search workspace (8.3-D)', () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    it('ورودی + فیلتر نوع رندر می‌شود', async () => {
        await openSearchWorkspace();
        expect(document.getElementById('globalSearchInput')).not.toBeNull();
        expect(document.querySelector('.conv-type-select').options.length).toBe(3);
    });

    it('جستجو کاربران و گروه‌ها را نشان می‌دهد', async () => {
        await openSearchWorkspace();
        const input = document.getElementById('globalSearchInput');
        input.value = 'new';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(450);
        expect(document.body.textContent).toContain('newguy');
        expect(document.body.textContent).toContain('Pub');
    });

    it('درخواست دوستی از نتیجه ارسال می‌شود', async () => {
        await openSearchWorkspace();
        const input = document.getElementById('globalSearchInput');
        input.value = 'new';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(450);
        const req = [...document.querySelectorAll('#ws-search .conv-mini-btn')]
            .find((b) => b.textContent.length > 0);
        req.click();
        await sleep(20);
        const calls = apiCalls.filter((c) => c.path === '/api/connections/request');
        expect(calls.length).toBe(1);
    });

    it('آفلاین → حالت offline', async () => {
        netState.online = false;
        await openSearchWorkspace();
        expect(document.getElementById('globalSearchInput')).toBeNull();
    });
});
