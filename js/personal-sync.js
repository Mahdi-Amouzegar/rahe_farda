// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// personal-sync.js -- سینک فوری وظایف شخصی (Phase 10)
//
// ⚠️ مسئله (Phase 10): وظایف شخصی فقط لوکال می‌ماندند چون `flushQueue`
//    پشت `state.sync.enabled` قفل است و هیچ‌جا `enableCloudSync` صدا زده
//    نمی‌شود. این ماژول صف معلق را بلافاصله به `POST /api/sync` می‌فرستد —
//    بدون دست زدن به پرچم legacy و موتورهای DM/گروه.
//
// ⚠️ قراردادها (تأیید کاربر، اکتبر ۲۰۲۶):
//   - ملاک برد: `updatedAt` جدیدتر؛ `revision` فقط برای تشخیص تصادم همزمان.
//   - «تغییر کرده»: id یکسان + (revision متفاوت یا updatedAt جدیدتر).
//   - pull بعد از لاگین: full-snapshot (سیم‌کشی‌اش مرحله‌ی ۲/۳).
//
// ⚠️ این ماژول به store.js وابسته نیست (چرخه‌ی import ندارد)؛ store فقط
//    در runtime آن را dynamic-import می‌کند.
// ═══════════════════════════════════════════════════════════════════════════

import { state, uid, SCHEMA_VERSION } from './core.js';
import { apiFetch } from './api.js';
import { isOnline, getDeviceId } from './net.js';
import { getQueue, dequeue } from './sync-queue.js';

/** محافظ ورود همزمان (دو push موازی صف را دو بار نفرستد) */
let _pushing = false;

/**
 * آیا الان می‌توان push کرد؟ (واردشده + آنلاین)
 * ⚠️ عمداً به `state.sync.enabled` نگاه نمی‌کند — آن پرچم legacy است.
 */
export function canPushNow() {
    try {
        return Boolean(state.sync.authToken) && Boolean(state.sync.userId) && isOnline();
    } catch {
        return false;
    }
}

/**
 * نگاشت یک ردیف صف لوکال به op سرور (`POST /api/sync`).
 * ⚠️ `timestamp` همان مهر تسک است (نه `now`) تا conflict سرور درست کار کند.
 */
export function toServerOp(entry) {
    return {
        id: String(entry.id),
        type: entry.type,
        entityId: String(entry.entityId),
        entityType: entry.entityType === 'child' ? 'child' : 'task',
        data: entry.data || null,
        parentId: entry.parentId ? String(entry.parentId) : null,
        timestamp: entry.timestamp,
        deviceId: entry.deviceId,
        schemaVersion: entry.schemaVersion || SCHEMA_VERSION,
        retries: entry.retries || 0,
        lastError: entry.lastError || null,
    };
}

/**
 * ساخت op ذخیره از روی یک تسک (برای تست + استفاده‌ی آینده).
 */
export function buildSaveOp(task, opts) {
    const o = opts || {};
    const nowIso = o.nowIso || new Date().toISOString();
    return {
        id: o.opId || uid(),
        type: 'save',
        entityId: String(task.id),
        entityType: 'task',
        data: task,
        parentId: null,
        timestamp: task.updatedAt || nowIso,
        deviceId: o.deviceId || 'unknown',
        schemaVersion: SCHEMA_VERSION,
        retries: 0,
        lastError: null,
    };
}

/**
 * قانون «تغییر کرده» (تأیید کاربر): id یکسان + (revision متفاوت یا updatedAt جدیدتر لوکال).
 */
export function isTaskChanged(local, remote) {
    if (!local || !remote) return false;
    if (String(local.id) !== String(remote.id)) return false;
    const lr = Number(local.revision);
    const rr = Number(remote.revision);
    if (Number.isFinite(lr) && Number.isFinite(rr) && lr !== rr) return true;
    const lm = Date.parse(local.updatedAt);
    const rm = Date.parse(remote.updatedAt);
    if (Number.isFinite(lm) && Number.isFinite(rm)) return lm > rm;
    return false;
}

/**
 * ادغام snapshot سرور با تسک‌های لوکال (خالص، بدون IO — سیم‌کشی در مرحله‌ی ۲/۳).
 * - id فقط-سرور → اضافه می‌شود.
 * - id فقط-لوکال → نگه داشته می‌شود (هنوز سینک نشده).
 * - id مشترک → `updatedAt` جدیدتر می‌برد؛ تساوی → سرور (authoritative).
 */
export function mergeSnapshot(localTasks, snapshotEntries) {
    const local = Array.isArray(localTasks) ? localTasks : [];
    const snap = Array.isArray(snapshotEntries) ? snapshotEntries : [];
    const serverById = new Map();
    for (const e of snap) {
        if (!e) continue;
        const id = String(e.entityId ?? e.id ?? '');
        if (!id) continue;
        let task = e.data;
        if (typeof task === 'string') {
            try { task = JSON.parse(task); } catch { task = null; }
        }
        if (!task || typeof task !== 'object') continue;
        serverById.set(id, {
            ...task,
            id,
            updatedAt: task.updatedAt || e.updatedAt || e.createdAt || null,
            revision: task.revision ?? e.revision ?? 1,
        });
    }
    const out = [];
    const seen = new Set();
    for (const t of local) {
        if (!t) continue;
        const id = String(t.id ?? '');
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const s = serverById.get(id);
        if (!s) { out.push(t); continue; }
        const lm = Date.parse(t.updatedAt);
        const sm = Date.parse(s.updatedAt);
        if (Number.isFinite(lm) && Number.isFinite(sm) && lm > sm) out.push(t);
        else out.push(s);
        serverById.delete(id);
    }
    for (const [, t] of serverById) out.push(t);
    return out;
}

async function postSyncBatch(body) {
    return apiFetch('/api/sync', { method: 'POST', body });
}

/**
 * pull کامل از سرور (full-snapshot — تصمیم کاربر برای اولین ورود).
 * @returns {Promise<{ok:boolean, snapshot?:Array, reason?:string}>}
 */
export async function pullFullSnapshot(deps) {
    if (!canPushNow()) return { ok: false, reason: 'offline-or-guest' };
    const post = (deps && deps.postSync) || postSyncBatch;
    let deviceId = 'unknown';
    try { deviceId = state.sync.deviceId || getDeviceId(); } catch { /* fallback بالا */ }
    const res = await post({
        ops: [],
        deviceId,
        lastChangeSeq: null,
        requestFullResync: true,
    });
    if (!res || res.ok !== true || !res.data) return { ok: false, reason: 'server-or-network' };
    const snap = Array.isArray(res.data.fullSnapshot) ? res.data.fullSnapshot : [];
    return { ok: true, snapshot: snap };
}

/**
 * سینک ورود (مرحله ۲/۳/۴):
 * - snapshot خالی + لوکال غیرخالی → push همه‌ی لوکال (مهمانِ تازه).
 * - snapshot غیرخالی → merge بدون overwrite + push فقط تازه/تغییرکرده.
 * - هیچ‌کدام → هیچ‌کار.
 */
export async function syncOnLogin(deps) {
    if (!canPushNow()) return { ok: false, reason: 'offline-or-guest' };
    const d = deps || {};
    const readLocal = d.readLocal || (() => state.tasks);
    const persist = d.persist || (async (tasks) => {
        const store = await import('./store.js');
        return store.replaceLocalTasks(tasks);
    });
    const post = d.postSync || postSyncBatch;
    const removeOps = d.removeOps || dequeue;

    const pulled = await pullFullSnapshot({ postSync: post });
    if (!pulled.ok) {
        // pull شکست خورد → دست‌کم بک‌لاگ صف را push کن (بهتر از هیچی)
        return pushPendingNow({ readQueue: d.readQueue, postSync: post, removeOps });
    }

    const local = readLocal() || [];
    const snapshot = pulled.snapshot || [];
    if (snapshot.length === 0 && local.length > 0) {
        // ─── مهمانِ تازه: کل جدول لوکال به سرور ───
        let deviceId = 'unknown';
        try { deviceId = state.sync.deviceId || getDeviceId(); } catch { /* fallback */ }
        const ops = local.map(t => buildSaveOp(t, { deviceId }));
        const res = await post({ ops, deviceId, lastChangeSeq: null, requestFullResync: false });
        if (!res || res.ok !== true || !res.data) return { ok: false, reason: 'server-or-network' };
        try { await pushPendingNow({ readQueue: d.readQueue, postSync: post, removeOps }); } catch { /* silent */ }
        return { ok: true, action: 'pushed-all', pushed: ops.length };
    }

    // ─── مهمانِ قبلی / ورود مجدد: merge + push هوشمند ───
    const merged = mergeSnapshot(local, snapshot);
    const serverById = new Map(snapshot.map(e => [String(e.entityId ?? e.id ?? ''), e]));
    const toPush = local.filter(t => {
        const s = serverById.get(String(t.id));
        if (!s) return true;
        let task = s.data;
        if (typeof task === 'string') {
            try { task = JSON.parse(task); } catch { task = null; }
        }
        const remote = { id: String(t.id), revision: (task && task.revision) ?? s.revision ?? 1, updatedAt: (task && task.updatedAt) || s.updatedAt || s.createdAt || null };
        return isTaskChanged(t, remote);
    });
    try {
        await persist(merged);
    } catch {
        return { ok: false, reason: 'persist-failed' };
    }
    if (toPush.length > 0) {
        let deviceId = 'unknown';
        try { deviceId = state.sync.deviceId || getDeviceId(); } catch { /* fallback */ }
        const res = await post({ ops: toPush.map(t => buildSaveOp(t, { deviceId })), deviceId, lastChangeSeq: null, requestFullResync: false });
        if (!res || res.ok !== true || !res.data) return { ok: true, action: 'merged', pushed: 0, pullOk: true };
        return { ok: true, action: 'merged', pushed: toPush.length };
    }
    return { ok: true, action: 'merged', pushed: 0 };
}

/**
 * ارسال فوری صف معلق به سرور (fire-and-forget از سمت caller).
 * فقط opهای accepted از صف حذف می‌شوند؛ بقیه برای تلاش بعدی می‌مانند.
 */
export async function pushPendingNow(deps) {
    if (_pushing) return { ok: false, reason: 'busy' };
    if (!canPushNow()) return { ok: false, reason: 'offline-or-guest' };
    const readQueue = (deps && deps.readQueue) || getQueue;
    const post = (deps && deps.postSync) || postSyncBatch;
    const removeOps = (deps && deps.removeOps) || dequeue;
    let ops;
    try {
        ops = await readQueue();
    } catch {
        return { ok: false, reason: 'queue-read-failed' };
    }
    if (!ops || ops.length === 0) return { ok: true, pushed: 0 };
    _pushing = true;
    try {
        let deviceId = null;
        try { deviceId = state.sync.deviceId || getDeviceId(); } catch { deviceId = 'unknown'; }
        const res = await post({
            ops: ops.map(toServerOp),
            deviceId: deviceId || 'unknown',
            lastChangeSeq: null,
            requestFullResync: false,
        });
        if (!res || res.ok !== true || !res.data) return { ok: false, reason: 'server-or-network' };
        const accepted = Array.isArray(res.data.accepted) ? res.data.accepted : [];
        const acceptedIds = accepted.map(a => String(a && a.opId)).filter(Boolean);
        if (acceptedIds.length > 0) {
            try { await removeOps(acceptedIds); } catch { /* صف برای retry می‌ماند */ }
        }
        return {
            ok: true,
            pushed: acceptedIds.length,
            rejected: Array.isArray(res.data.rejected) ? res.data.rejected.length : 0,
        };
    } finally {
        _pushing = false;
    }
}
