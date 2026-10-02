// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/backup-v2.js -- بکاپ/ریستور نسخه‌ی ۲ (Phase 8 — 8C)
//
// ⚠️ مدل (قرارداد 8C):
//   - personal (تسک/سطل/تنظیمات): تنها بخشی که restore می‌شود (merge مثل v1).
//   - groups/DMs: فقط آرشیو «ارسال‌شده‌های خودم» — هرگز پیام دیگران ندارد و
//     هرگز دوباره به سرور POST نمی‌شود (سرور مرجع نهایی است).
//   - media: فقط media_ids (بدون بایت)؛ URLها بعد از restore از سرور resolve می‌شوند.
//   - رمزنگاری فایل: خارج از scope (اختیاریِ spec — فعلاً نه).
//   - checksum: کل فایل (v2)؛ هشدار دست‌کاری، نه بلاک.
// ═══════════════════════════════════════════════════════════════════════════

import { state, computeChecksum } from './core.js';
import { t as i18nT } from './i18n.js';
import { isLoggedIn, getCurrentUser } from './auth.js';
import {
    exportTasks,
    importTasks,
} from './store.js';
import { listConversations, fetchFullThread } from './communication/conversations.js';
import { listGroups, fetchFullTimeline } from './communication/groups.js';

export const BACKUP_V2_VERSION = '2.0.0';

// ═══════════════════════════════════════════════════════════════════════════
// Export
// ═══════════════════════════════════════════════════════════════════════════

function collectMediaIds(tasks) {
    const ids = new Set();
    const scan = (t) => {
        if (!t || typeof t !== 'object') return;
        if (Array.isArray(t.mediaIds)) {
            for (const id of t.mediaIds) {
                if (typeof id === 'string' && id.length > 0) ids.add(id);
            }
        }
        if (typeof t.payload === 'string') {
            try {
                const p = JSON.parse(t.payload);
                if (p && Array.isArray(p.mediaIds)) {
                    for (const id of p.mediaIds) {
                        if (typeof id === 'string' && id.length > 0) ids.add(id);
                    }
                }
            } catch { /* payload غیر-JSON — رد شو */ }
        }
    };
    for (const t of tasks || []) {
        scan(t);
        if (Array.isArray(t.children)) t.children.forEach(scan);
    }
    return [...ids];
}

function myUserId() {
    try {
        const u = getCurrentUser();
        return (u && u.id) || null;
    } catch {
        return null;
    }
}

/**
 * ساخت بکاپ v2.
 */
export async function exportBackupV2(options) {
    const opts = options || {};
    const includePhotos = Boolean(opts.includePhotos);
    const includeSettings = Boolean(opts.includeSettings);

    // ─── بخش personal: همان منطق v1 (تک‌منبع) ───
    const v1 = await exportTasks({ includePhotos, includeSettings });

    const mediaIds = new Set(collectMediaIds(v1.data.tasks).concat(collectMediaIds(v1.data.trash)));

    // ─── بخش سرور (فقط ارسال‌شده‌های خودم) ───
    const groups = { created: [], messages_sent: [], tasks_sent: [] };
    const direct_messages = [];
    const me = myUserId();

    if (isLoggedIn() && me) {
        // گروه‌های من
        try {
            const gres = await listGroups();
            const mine = ((gres.ok && gres.groups) || []).filter((g) => g);
            for (const g of mine) {
                if (g.ownerId === me) groups.created.push(g);
                const tl = await fetchFullTimeline(g.id);
                if (!tl.ok) continue;
                for (const item of tl.items) {
                    if (item.actorId !== me) continue; // ⚠️ فقط خودم — هرگز دیگران
                    if (item.entityType === 'group_message') groups.messages_sent.push(item);
                    else if (item.entityType === 'group_task') {
                        groups.tasks_sent.push(item);
                        for (const id of collectMediaIds([{ payload: item.body }])) mediaIds.add(id);
                    }
                }
            }
        } catch { /* best-effort */ }

        // پیام‌های مستقیم من
        try {
            const cres = await listConversations();
            for (const c of (cres.ok && cres.conversations) || []) {
                const th = await fetchFullThread(c.user.id);
                if (!th.ok) continue;
                const mineOnly = th.messages.filter((m) => m.senderId === me);
                if (mineOnly.length > 0) {
                    direct_messages.push({ withUserId: c.user.id, messages: mineOnly });
                }
            }
        } catch { /* best-effort */ }
    }

    const backup = {
        version: BACKUP_V2_VERSION,
        schemaVersion: v1.schemaVersion,
        appVersion: v1.appVersion,
        exportedAt: v1.exportedAt,
        options: { includePhotos, includeSettings },
        user: me ? { id: me } : null,
        personal: v1.data,
        settings: v1.settings,
        groups,
        direct_messages,
        media: { included_files: false, media_ids: [...mediaIds] },
        checksum: '',
    };
    try {
        const { checksum, ...rest } = backup;
        void checksum;
        backup.checksum = await computeChecksum(JSON.stringify(rest));
    } catch {
        backup.checksum = '';
    }
    return backup;
}

// ═══════════════════════════════════════════════════════════════════════════
// Verify + Normalize + Import
// ═══════════════════════════════════════════════════════════════════════════

/**
 * راستی‌آزمایی checksum.
 *
 * @returns '' اگر سالم/ندارد، وگرنه پیام هشدار
 */
export async function verifyBackupChecksum(raw) {
    if (!raw || typeof raw !== 'object' || !raw.checksum) return '';
    try {
        let expected = '';
        if (typeof raw.version === 'string' && raw.version.startsWith('2.')) {
            const { checksum, ...rest } = raw;
            void checksum;
            expected = await computeChecksum(JSON.stringify(rest));
        } else if (raw.data) {
            // سازگار عقب‌رو با v1 (checksum روی data بود)
            expected = await computeChecksum(JSON.stringify(raw.data));
        } else {
            return '';
        }
        if (expected && expected !== raw.checksum) {
            return i18nT('import.checksumWarning');
        }
    } catch { /* silent */ }
    return '';
}

/**
 * نرمال‌سازی فایل ورودی (v1 یا v2) به شکل قابل‌مصرف UI.
 */
export function normalizeBackup(raw) {
    if (!raw || typeof raw !== 'object') {
        return { ok: false, error: 'invalid' };
    }
    // ─── v2 ───
    if (typeof raw.version === 'string' && raw.version.startsWith('2.') && raw.personal) {
        const groups = raw.groups || {};
        const dms = Array.isArray(raw.direct_messages) ? raw.direct_messages : [];
        return {
            ok: true,
            kind: 'v2',
            personal: raw.personal,
            settings: raw.settings,
            schemaVersion: raw.schemaVersion,
            exportedAt: raw.exportedAt,
            checksum: raw.checksum,
            serverSummary: {
                groupsCreated: (groups.created || []).length,
                groupMessagesSent: (groups.messages_sent || []).length,
                groupTasksSent: (groups.tasks_sent || []).length,
                dmThreads: dms.length,
                dmMessages: dms.reduce((s, t) => s + ((t.messages || []).length), 0),
                mediaIds: ((raw.media && raw.media.media_ids) || []).length,
            },
        };
    }
    // ─── v1 (سازگار عقب‌رو) ───
    if (raw.data && Array.isArray(raw.data.tasks)) {
        return {
            ok: true,
            kind: 'v1',
            personal: raw.data,
            settings: raw.settings,
            schemaVersion: raw.schemaVersion,
            exportedAt: raw.exportedAt,
            checksum: raw.checksum,
            serverSummary: null,
        };
    }
    return { ok: false, error: 'invalid' };
}

/**
 * ایمپورت بکاپ (v1 یا v2).
 *
 * ⚠️ فقط بخش personal بازگردانده می‌شود (merge: تسک‌های موجود که در فایل
 *    نیستند دست نمی‌خورند؛ همان‌ایدی‌ها با نسخه‌ی فایل جایگزین می‌شوند).
 *    بخش‌های سرور فقط گزارش می‌شوند و هرگز POST نمی‌شوند.
 */
export async function importBackupV2(raw, options) {
    const norm = normalizeBackup(raw);
    if (!norm.ok) {
        return { ok: false, error: i18nT('import.invalidStructure'), imported: 0, skipped: 0 };
    }
    const checksumWarning = await verifyBackupChecksum(raw);
    const adapted = {
        schemaVersion: norm.schemaVersion,
        data: norm.personal,
        settings: norm.settings,
        checksum: norm.kind === 'v1' ? norm.checksum : undefined,
    };
    const result = await importTasks(adapted, options);
    return { ...result, checksumWarning: checksumWarning || undefined, serverSummary: norm.serverSummary || undefined };
}
