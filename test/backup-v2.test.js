// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/backup-v2.test.js — تست بکاپ/ریستور نسخه‌ی ۲ (8C)

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../js/i18n.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, t: (key) => key };
});

const authState = { loggedIn: true, userId: 'u1' };
vi.mock('../js/auth.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        isLoggedIn: () => authState.loggedIn,
        getCurrentUser: () => (authState.loggedIn ? { id: authState.userId } : null),
    };
});

vi.mock('../js/api.js', async () => ({
    apiFetch: vi.fn(async (path) => {
        if (path === '/api/groups') {
            return { ok: true, data: { groups: [{ id: 'g1', ownerId: 'u1', name: 'G' }] } };
        }
        if (path.startsWith('/api/groups/g1/timeline')) {
            return {
                ok: true,
                data: {
                    items: [
                        { id: 'gm1', entityType: 'group_message', actorId: 'u1', body: 'mine', kind: 'text', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
                        { id: 'gm2', entityType: 'group_message', actorId: 'u2', body: 'theirs', kind: 'text', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
                        { id: 'gt1', entityType: 'group_task', actorId: 'u1', body: '{"title":"T","mediaIds":["med-1"]}', kind: 'task', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
                    ],
                    nextCursor: null,
                },
            };
        }
        if (path === '/api/connections') {
            return {
                ok: true,
                data: {
                    connections: [
                        { id: 'c1', status: 'accepted', otherUserId: 'u2', otherUser: { id: 'u2' } },
                    ],
                },
            };
        }
        if (path.startsWith('/api/messages?with=')) {
            return {
                ok: true,
                data: {
                    messages: [
                        { id: 'dm1', senderId: 'u1', recipientId: 'u2', body: 'hi', kind: 'text', createdAt: '2026-01-01T00:00:00Z' },
                        { id: 'dm2', senderId: 'u2', recipientId: 'u1', body: 'yo', kind: 'text', createdAt: '2026-01-01T00:00:00Z' },
                    ],
                    nextCursor: null,
                    hasMore: false,
                },
            };
        }
        return { ok: false, error: { code: 'NOT_FOUND', message: 'x' } };
    }),
    apiErrorMessage: (e) => (e && e.message) || 'err',
}));

import { state } from '../js/core.js';
import {
    exportBackupV2,
    normalizeBackup,
    verifyBackupChecksum,
    importBackupV2,
    BACKUP_V2_VERSION,
} from '../js/backup-v2.js';

beforeEach(() => {
    authState.loggedIn = true;
    authState.userId = 'u1';
    state.tasks = [
        { id: 't1', text: 'local', mediaIds: ['med-9'] },
    ];
    state.trash = [];
    try { localStorage.clear(); } catch { /* silent */ }
});

describe('backup v2 — export (8C)', () => {
    it('ساختار v2 با بخش‌های درست', async () => {
        const b = await exportBackupV2({ includePhotos: false, includeSettings: false });
        expect(b.version).toBe(BACKUP_V2_VERSION);
        expect(b.media.included_files).toBe(false);
        expect(b.user).toMatchObject({ id: 'u1' });
        expect(b.personal.tasks.length).toBe(1);
    });

    it('فقط ارسال‌شده‌های خودم — هرگز دیگران', async () => {
        const b = await exportBackupV2({});
        expect(b.groups.messages_sent.map((m) => m.id)).toEqual(['gm1']);
        expect(b.groups.tasks_sent.map((t) => t.id)).toEqual(['gt1']);
        expect(b.direct_messages.length).toBe(1);
        expect(b.direct_messages[0].messages.map((m) => m.id)).toEqual(['dm1']);
    });

    it('media_ids جمع می‌شود (تسک محلی + تسک گروهی)', async () => {
        const b = await exportBackupV2({});
        expect(b.media.media_ids).toEqual(expect.arrayContaining(['med-9', 'med-1']));
    });

    it('checksum روی کل فایل تأیید می‌شود', async () => {
        const b = await exportBackupV2({});
        expect(await verifyBackupChecksum(b)).toBe('');
        const tampered = { ...b, groups: { created: [], messages_sent: [], tasks_sent: [{ id: 'evil' }] } };
        expect(await verifyBackupChecksum(tampered)).not.toBe('');
    });

    it('مهمان: بخش سرور خالی ولی personal هست', async () => {
        authState.loggedIn = false;
        const b = await exportBackupV2({});
        expect(b.user).toBeNull();
        expect(b.groups.messages_sent).toEqual([]);
        expect(b.personal.tasks.length).toBe(1);
    });
});

describe('backup v2 — import (8C)', () => {
    it('merge: موجودهای متفاوت دست نمی‌خورند، همان‌ایدی جایگزین می‌شود', async () => {
        const b = await exportBackupV2({});
        state.tasks = [
            { id: 'keep', text: 'stay' },
            { id: 't1', text: 'old-text' },
        ];
        const res = await importBackupV2(b, { mode: 'merge', importSettings: false });
        expect(res.ok).toBe(true);
        const byId = Object.fromEntries(state.tasks.map((t) => [t.id, t]));
        expect(byId.keep.text).toBe('stay');
        expect(byId.t1.text).toBe('local');
        expect(res.serverSummary).toBeTruthy();
    });

    it('بخش سرور هرگز POST نمی‌شود', async () => {
        const { apiFetch } = await import('../js/api.js');
        apiFetch.mockClear();
        const b = await exportBackupV2({});
        await importBackupV2(b, { mode: 'merge', importSettings: false });
        const posts = apiFetch.mock.calls.filter(([, o]) => o && o.method === 'POST');
        expect(posts.length).toBe(0);
    });

    it('normalize نسخه‌ی v1 قدیمی را هم می‌فهمد', () => {
        const norm = normalizeBackup({ schemaVersion: '1.0', data: { tasks: [{ id: 'a' }], trash: [] } });
        expect(norm.ok).toBe(true);
        expect(norm.kind).toBe('v1');
    });

    it('فایل نامعتبر رد می‌شود', async () => {
        const res = await importBackupV2({ nope: 1 }, {});
        expect(res.ok).toBe(false);
    });
});
