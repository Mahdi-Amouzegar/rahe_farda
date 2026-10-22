// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/tasks/source.js -- خواندن + نرمال‌سازی تسک‌های مقصد مشترک
//
// ⚠️ خروجی همیشه به شکل تسک محلی است (همان کارت/فیلتر/مرتب‌سازی کار می‌کند):
//   { ...payload, id, _shared: { mine, dest, remoteId, senderName } }
// ⚠️ آیتم دیگران read-only است (گیت در dispatcher اپ).
// ═══════════════════════════════════════════════════════════════════════════

import { apiFetch } from '../api.js';
import { state } from '../core.js';
import { events, EV } from '../events.js';
import { stripPhotoBytesForSync, putCachedPhoto } from '../media-cache.js';
import { enqueueUpload } from '../media-upload.js';
import { dataUrlToBlob } from '../media.js';
import { listDmTasks, updateDmTask, deleteDmTask } from '../communication/dm-tasks.js';
import { enqueueGroupOp, flushGroup } from '../communication/group-queue.js';
import { getDestination } from './destination.js';
// ⚠️ 10.24: منطق دوره در sessions.js است (بدون چرخه‌ی import با store.js).
import { advanceRecurOnTick } from '../sessions.js';

function parsePayload(raw) {
    if (!raw) return null;
    try {
        const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return p && typeof p === 'object' ? p : null;
    } catch {
        return null;
    }
}

function baseLocalShape() {
    return {
        text: '…',
        completed: false,
        completedAt: null,
        priority: 'medium',
        recur: 'none',
        recurN: null,
        recurDays: [],
        description: '',
        kind: 'task',
        children: [],
        pinned: false,
        archived: false,
        timeSpent: 0,
        timerStartedAt: null,
        sessions: [],
        location: null,
        photos: [],
        startAt: null,
        endAt: null,
        phone: '',
        address: '',
        url: '',
        updatedAt: null,
        revision: 1,
    };
}

function normalizeRemote(parsed, extra) {
    const task = { ...baseLocalShape(), ...(parsed || {}) };
    // سازگاری عقب‌رو: payloadهای قدیمی فقط {title} داشتند (قدم ۱.۵/۲)
    if ((!task.text || task.text === '…') && parsed && typeof parsed.title === 'string' && parsed.title) {
        task.text = String(parsed.title).slice(0, 200);
    }
    task.id = extra.serverId;
    task.createdAt = extra.createdAt || task.createdAt || new Date().toISOString();
    if (extra.updatedAt) task.updatedAt = extra.updatedAt;
    if (extra.revision !== undefined && extra.revision !== null) task.revision = extra.revision;
    task._shared = {
        mine: extra.mine,
        dest: extra.dest,
        remoteId: extra.serverId,
        senderName: extra.senderName || null,
    };
    return task;
}

/**
 * تسک‌های گفتگوی دوطرفه (چند صفحه، جدیدترین اول → برعکس برای نمایش).
 */
export async function fetchPeerTasks(peerId, myId, peerName) {
    const all = [];
    let cursor = null;
    for (let page = 0; page < 5; page++) {
        const res = await listDmTasks(peerId, cursor);
        if (!res.ok) return { ok: false, error: res.error };
        all.push(...(res.tasks || []));
        if (!res.hasMore || !res.nextCursor) break;
        cursor = res.nextCursor;
    }
    const items = all.map((t) => {
        const mine = String(t.creatorId || t.creator_id || '') === String(myId || '');
        return normalizeRemote(parsePayload(t.payload), {
            serverId: t.id,
            createdAt: t.createdAt || t.created_at,
            updatedAt: t.updatedAt || t.updated_at,
            revision: t.revision,
            mine,
            dest: { type: 'peer', peerId },
            senderName: mine ? null : (peerName || null),
        });
    });
    return { ok: true, items };
}

// ═══════════════════════════════════════════════════════════════════════════
// فروشگاه نمای مشترک صفحه‌ی اصلی (تک‌صفحه)
// ═══════════════════════════════════════════════════════════════════════════

let _items = [];
let _loading = false;
let _error = null;

export function getSharedItems() {
    return _items;
}

export function isSharedLoading() {
    return _loading;
}

export function getSharedError() {
    return _error;
}

export function getSharedItem(id) {
    return _items.find((t) => String(t.id) === String(id)) || null;
}

/**
 * یافتن تسک مشترک در هر عمقی (سطح‌بالا یا زیرکار برنامه).
 *
 * ⚠️ 10.25: دکمه‌ی «جزئیات» روی ردیف زیرکار هم هست، ولی `getSharedItem`
 * فقط سطح‌بالا را می‌دید؛ نتیجه: جزئیات زیرکار برنامه‌ی مشترک اصلاً باز
 * نمی‌شد (نه برای خودی، نه برای مخاطب).
 *
 * @param {string} id
 * @returns {{ item: object, childId: string|null }|null}
 */
export function getSharedTaskDeep(id) {
    const key = String(id);
    for (const t of _items) {
        if (!t) continue;
        if (String(t.id) === key) return { item: t, childId: null };
        if (t.kind === 'plan' && Array.isArray(t.children)) {
            const c = t.children.find(x => x && String(x.id) === key);
            if (c) return { item: t, childId: key };
        }
    }
    return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// کش مقصدها برای یادآور پس‌زمینه (REQ-02)
// ═══════════════════════════════════════════════════════════════════════════
//
// حلقه یادآور باید همه مقصدها (باز یا بسته) را ببیند، ولی fetch دوره‌ای همه
// سنگین است. راه میانه: آیتم‌های هر مقصدی که لود می‌شود (بازدید یا اسکن
// پس‌زمینه گیت‌دار) اینجا کش می‌شود و اسکن یادآور فقط همین کش را می‌خواند.

const _sharedCache = new Map(); // destKey -> { items, at }
const SHARED_CACHE_CAP = 25;

// ⚠️ 10.17: آستانه‌های اسکنر یادآور مشترک (notify.js هم از آن‌ها استفاده می‌کند)
export const SHARED_SCAN_NEAR_MS = 15 * 60 * 1000;
export const SHARED_SCAN_IDLE_MS = 10 * 60 * 1000;

/**
 * جدیدترین `updatedAt` کش یک مقصد (ms) — برای مقایسه با فعالیت سروری.
 * null یعنی کش خالی است یا آیتم‌ها مهر نسخه ندارند.
 */
export function cachedUpdatedAtMs(key) {
    const entry = _sharedCache.get(key);
    if (!entry || !Array.isArray(entry.items) || entry.items.length === 0) return null;
    let max = 0;
    for (const t of entry.items) {
        const v = new Date(t && t.updatedAt).getTime();
        if (Number.isFinite(v) && v > max) max = v;
    }
    return max > 0 ? max : null;
}

/**
 * آیا این مقصد برای اسکنر یادآور نیاز به تازه‌سازی دارد؟ (10.17 / 10.20)
 *
 * ⚠️ 10.20: سیگنال ارزان `activityAt` (lastActivity سرور برای همان مقصد) —
 * اگر سرور فعالیت تازه‌تری از کش دارد (تسک تازه‌ی طرف مقابل)، فوری تازه کن.
 * بدون این، تسکی که ۱-۲ دقیقه قبل از سررسید ساخته شود تا تیک ۱۰دقیقه‌ای
 * بعدی دیده نمی‌شد و هشدار گیرنده از دست می‌رفت.
 *
 * بقیه‌ی قواعد:
 * سررسید نزدیک (≤ ۱۵ دقیقه) → بله (هر ۶۰ ثانیه).
 * در سکون → حداکثر هر ۱۰ دقیقه.
 */
export function shouldRefreshSharedKey(key, activityAt) {
    const entry = _sharedCache.get(key);
    if (!entry || !Array.isArray(entry.items)) return true;
    const now = Date.now();
    if (activityAt) {
        const act = new Date(activityAt).getTime();
        if (Number.isFinite(act)) {
            const cached = cachedUpdatedAtMs(key);
            // مقصد تازه‌فعال‌شده (کش خالی) یا فعالیت جدیدتر از کش → فوری
            if (cached === null || act > cached) return true;
        }
    }
    let nearest = null;
    for (const t of entry.items) {
        if (!t || t.archived) continue;
        for (const s of (t.sessions || [])) {
            const v = new Date(s.at).getTime();
            if (!Number.isFinite(v)) continue;
            const d = v - now;
            if (d >= 0 && (nearest === null || d < nearest)) nearest = d;
        }
    }
    if (nearest !== null && nearest <= SHARED_SCAN_NEAR_MS) return true;
    return (now - entry.at) >= SHARED_SCAN_IDLE_MS;
}

export function sharedCacheKey(dest) {
    if (!dest) return null;
    if (dest.type === 'peer' && dest.peerId) return 'peer:' + dest.peerId;
    if (dest.type === 'group' && dest.groupId) return 'group:' + dest.groupId;
    return null;
}

/**
 * idهای «دیده‌شده»ی هر مقصد — روی دیسک می‌ماند (10.23).
 *
 * ⚠️ چرا روی دیسک؟ کش درون‌حافظه‌ای با رفرش/بستن برنامه پاک می‌شود و همه‌چیز
 * دوباره «بیس‌لاین» می‌شد؛ یعنی تسکی که وقتی برنامه بسته بود اضافه شده،
 * هرگز اعلان نمی‌گرفت. با ماندگاری، در نخستین اسکن بعد از بازگشایی اعلان می‌آید.
 * ⚠️ نخستین باری که یک مقصد دیده می‌شود = بیس‌لاین (بدون اعلان).
 */
const SEEN_STORAGE_KEY = 'spaceTodoSharedSeen';
const SEEN_MAX_DESTS = 25;
const SEEN_MAX_IDS = 300;

let _seen = null; // Map<string, string[]> | null

function seenMap() {
    if (_seen) return _seen;
    _seen = new Map();
    try {
        const raw = localStorage.getItem(SEEN_STORAGE_KEY);
        const obj = raw ? JSON.parse(raw) : null;
        for (const [k, v] of Object.entries(obj || {})) {
            if (Array.isArray(v)) _seen.set(k, v.map(String));
        }
    } catch { /* بدون localStorage: فقط درون‌حافظه */ }
    return _seen;
}

function persistSeen() {
    try {
        const obj = {};
        for (const [k, ids] of seenMap()) obj[k] = ids;
        localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(obj));
    } catch { /* silent */ }
}

/**
 * کش آیتم‌های یک مقصد + تشخیص «تسک تازه‌ی طرف مقابل» (10.23).
 *
 * @param {string} key  کلید مقصد (`peer:<id>` / `group:<id>`)
 * @param {Array} items آیتم‌های تازه
 * @param {string|null} [destName] نام نمایشی مقصد (برای متن اعلان گروه)
 */
export function cacheSharedItems(key, items, destName) {
    if (!key) return;
    const next = Array.isArray(items) ? items : [];
    _sharedCache.set(key, { items: next, at: Date.now() });
    while (_sharedCache.size > SHARED_CACHE_CAP) {
        _sharedCache.delete(_sharedCache.keys().next().value);
    }

    const seen = seenMap();
    const prevIds = seen.get(key);
    const known = prevIds ? new Set(prevIds) : null;
    const addedIds = [];
    const fresh = [];
    for (const t of next) {
        if (!t || t.id == null) continue;
        const id = String(t.id);
        if (known && !known.has(id)) {
            addedIds.push(id);
            if (t._shared && !t._shared.mine) fresh.push(t);
        }
    }
    // ⚠️ نخستین دیدن این مقصد = بیس‌لاین: ثبت بدون اعلان.
    // ⚠️ ادغام ترتیبی: idهای تازه به **انتها** اضافه می‌شوند تا سقف
    // SEEN_MAX_IDS قدیمی‌ترین‌ها را بیندازد (وگرنه یک تسک تازه در مقصد
    // پرحجم از حافظه بیرون می‌افتاد و هر اسکن دوباره اعلان می‌داد).
    if (!known || addedIds.length > 0) {
        const merged = prevIds ? prevIds.slice() : [];
        const have = new Set(merged);
        for (const t of next) {
            if (!t || t.id == null) continue;
            const id = String(t.id);
            if (!have.has(id)) {
                have.add(id);
                merged.push(id);
            }
        }
        seen.set(key, merged.slice(-SEEN_MAX_IDS));
        while (seen.size > SEEN_MAX_DESTS) seen.delete(seen.keys().next().value);
        persistSeen();
    }
    if (!known || fresh.length === 0) return;
    try {
        events.emit(EV.SHARED_NEW_TASK, {
            key,
            destName: destName || null,
            dest: (fresh[0]._shared && fresh[0]._shared.dest) || null,
            tasks: fresh,
        });
    } catch { /* silent */ }
}

export function getCachedSharedAll() {
    const out = [];
    for (const [, c] of _sharedCache) {
        if (c && Array.isArray(c.items)) out.push(...c.items);
    }
    return out;
}

export function getSharedRole(id) {
    const hit = getSharedTaskDeep(id);
    if (!hit || !hit.item._shared) return null;
    return { mine: !!hit.item._shared.mine };
}

function myId() {
    try {
        return (state.sync && state.sync.userId) || null;
    } catch {
        return null;
    }
}

/**
 * بارگذاری دوباره‌ی لیست مقصد جاری (local → خالی).
 */
export async function refreshSharedList() {
    const dest = getDestination();
    if (dest.type === 'local') {
        _items = [];
        _loading = false;
        _error = null;
        return { ok: true, items: [] };
    }
    _loading = true;
    _error = null;
    try {
        let res;
        if (dest.type === 'peer') {
            res = await fetchPeerTasks(dest.peerId, myId(), dest.name);
        } else if (dest.type === 'group') {
            res = await fetchGroupTasks(dest.groupId, myId());
        } else {
            res = { ok: false, error: { code: 'BAD_DESTINATION' } };
        }
        if (!res.ok) {
            _error = res.error || { code: 'LOAD_FAILED' };
            _items = [];
            return res;
        }
        _items = res.items || [];
        // ⚠️ REQ-02: بازدید هم کش یادآور را تازه می‌کند
        cacheSharedItems(sharedCacheKey(dest), _items, dest.name);
        return { ok: true, items: _items };
    } finally {
        _loading = false;
    }
}

// ⚠️ فقط برای تست
export function __resetSharedForTest() {
    _items = [];
    _sharedCache.clear();
    _seen = null;
    _loading = false;
    _error = null;
    _detailBridge = null;
    _detailBridgeChildId = null;
    _detailBridgeReadOnly = false;
    try { localStorage.removeItem(SEEN_STORAGE_KEY); } catch { /* silent */ }
}

// ⚠️ فقط برای تست
export function __setSharedItemsForTest(items) {
    setSharedItems(items);
}

/**
 * جایگزینی کل آیتم‌های نمای مشترک (برای موتور زنده).
 */
export function setSharedItems(items) {
    _items = Array.isArray(items) ? items : [];
}

// ═══════════════════════════════════════════════════════════════════════════
// نوشتن روی مقصد مشترک (ویرایش فقط خودی)
// ═══════════════════════════════════════════════════════════════════════════

function stripShared(item) {
    const clean = { ...item };
    delete clean._shared;
    return clean;
}

/**
 * payload نوشتن مشترک — گروه و DM: بدون بایت عکس (lazy).
 *
 * پیش‌نیاز DM در سرور فراهم است (آپلود task-linked با مشارکت + خواندن peer).
 */
export function stripSharedPayload(taskObj, dest) {
    if (dest && (dest.type === 'group' || dest.type === 'peer')) return stripPhotoBytesForSync(taskObj);
    return taskObj;
}

/**
 * enqueue آپلود عکس‌های مشترکِ هنوزآپلودنشده (گروه + DM).
 * گروه: taskId تهی + groupId (تطبیق محلی با photo.id).
 * DM: taskId همان id تسک (سرور مشارکت DM را می‌پذیرد).
 */
export async function enqueueSharedPhotosForUpload(dest, taskObj) {
    if (!dest || (dest.type !== 'group' && dest.type !== 'peer')) return { enqueued: 0 };
    if (dest.type === 'group' && !dest.groupId) return { enqueued: 0 };
    if (!taskObj || !Array.isArray(taskObj.photos) || taskObj.photos.length === 0) return { enqueued: 0 };
    if (!state.sync.enabled || !state.sync.authToken) return { enqueued: 0 };
    const uploaded = new Set(
        Array.isArray(taskObj.mediaIds) ? taskObj.mediaIds.map(id => String(id)) : []
    );
    let enqueued = 0;
    for (const photo of taskObj.photos) {
        if (!photo || !photo.id || uploaded.has(String(photo.id))) continue;
        if (typeof photo.dataUrl !== 'string' || !photo.dataUrl.startsWith('data:')) continue;
        if (typeof photo.contentType !== 'string' || typeof photo.sizeBytes !== 'number') continue;
        try {
            const blob = dataUrlToBlob(photo.dataUrl);
            await enqueueUpload({
                mediaId: photo.id,
                taskId: dest.type === 'peer' ? taskObj.id : null,
                groupId: dest.type === 'group' ? dest.groupId : null,
                contentType: photo.contentType,
                sizeBytes: photo.sizeBytes,
                blob,
            });
            enqueued++;
        } catch { /* silent */ }
    }
    return { enqueued };
}

async function writeSharedTask(dest, remoteId, taskObj) {
    try {
        if (dest.type === 'peer') {
            const res = await updateDmTask(remoteId, stripSharedPayload(taskObj, dest));
            if (res && res.ok) enqueueSharedPhotosForUpload(dest, taskObj).catch(() => {});
            return res;
        }
        if (dest.type === 'group') {
            await enqueueGroupOp(dest.groupId, 'save', remoteId, { kind: 'task', payload: stripSharedPayload(taskObj, dest) });
            let failed = 0;
            try {
                const fr = await flushGroup(dest.groupId);
                failed = (fr && fr.failed) || 0;
            } catch {
                failed = 0; // آفلاین/transport: در صف می‌ماند، خطا نیست
            }
            if (failed > 0) return { ok: false, code: 'FLUSH_FAILED' };
            enqueueSharedPhotosForUpload(dest, taskObj).catch(() => {});
            return { ok: true };
        }
    } catch {
        return { ok: false };
    }
    return { ok: false };
}

// ─── upload-complete مشترک (گروه + DM): ثبت serverMediaId و برداشتن بایت ───
events.on('media:upload-complete', ({ mediaId, serverMediaId }) => {
    if (!mediaId || !serverMediaId) return;
    let item = null;
    try {
        item = getSharedItems().find(t => t && t._shared && t._shared.mine
            && t._shared.dest && (t._shared.dest.type === 'group' || t._shared.dest.type === 'peer')
            && Array.isArray(t.photos) && t.photos.some(p => p && String(p.id) === String(mediaId)));
    } catch { return; }
    if (!item) return;
    const photo = item.photos.find(p => p && String(p.id) === String(mediaId));
    if (!photo || photo.serverMediaId === serverMediaId) return;
    photo.serverMediaId = serverMediaId;
    const ids = Array.isArray(item.mediaIds) ? item.mediaIds : [];
    if (!ids.some(id => String(id) === String(mediaId))) ids.push(String(mediaId));
    item.mediaIds = ids;
    const persist = async () => {
        try {
            if (typeof photo.dataUrl === 'string' && photo.dataUrl.startsWith('data:')) {
                const blob = dataUrlToBlob(photo.dataUrl);
                await putCachedPhoto(photo.id, blob, photo.contentType || blob.type, serverMediaId);
            }
        } catch { /* silent — کش best-effort است */ }
        delete photo.dataUrl;
        try {
            await writeSharedTask(item._shared.dest, item.id, stripShared(item));
        } catch { /* silent */ }
    };
    persist();
});

/**
 * ذخیره‌ی کامل آبجکت تسک مشترک (برای saveTask پل جزئیات — بدون refresh).
 */
export async function saveSharedTask(task) {
    if (!task || !task._shared || !task._shared.mine || !task._shared.dest) {
        return { ok: false };
    }
    const gen = ++_sharedSaveGen;
    _inflightSharedSave = (async () => {
        try {
            return await writeSharedTask(task._shared.dest, task.id, stripShared(task));
        } catch {
            return { ok: false };
        }
    })();
    try {
        return await _inflightSharedSave;
    } finally {
        if (gen === _sharedSaveGen) _inflightSharedSave = null;
    }
}

let _inflightSharedSave = null;
let _sharedSaveGen = 0;

/**
 * انتظار برای ذخیره‌های مشترک در حال پرواز (برای تطبیق بعد از بستن جزئیات).
 */
export function waitSharedSaves() {
    return _inflightSharedSave || Promise.resolve();
}

/**
 * ویرایش عنوان تسک خودی در نمای مشترک.
 */
export async function updateSharedTaskText(remoteId, title) {
    const item = getSharedItem(remoteId);
    if (!item || !item._shared || !item._shared.mine) return { ok: false };
    const next = { ...stripShared(item), text: String(title).slice(0, 200) };
    return writeSharedTask(item._shared.dest, remoteId, next);
}

/**
 * نوشتن تسک مشترکِ جلو رفته (rollforward 10.16 — فقط خودی).
 * @returns {Promise<{ok:boolean}>}
 */
export function persistAdvancedShared(task) {
    if (!task || !task._shared || !task._shared.mine || !task._shared.dest) {
        return Promise.resolve({ ok: false });
    }
    return writeSharedTask(task._shared.dest, task.id, stripShared(task));
}

/**
 * تاگل تسک خودی در نمای مشترک.
 *
 * ⚠️ 10.24: تیک یک **دوره** در DM/گروه هم مثل نسخه‌ی شخصی رفتار می‌کند —
 * جلسه‌ی جاری مصرف (`doneAt`) و جلسه‌ی بعدی ساخته می‌شود، تسک باز می‌ماند و
 * payload کامل (شامل sessions) روی مقصد نوشته می‌شود. قبلاً فقط
 * `completed` عوض می‌شد؛ سری روی سرور همان جلسه‌ی اول می‌ماند و
 * `advanceSharedOne` هم چون تسک completed بود از آن رد می‌شد → دوره برای همیشه
 * «تکمیل» می‌شد و due-line هرگز جلو نمی‌رفت.
 */
export async function toggleSharedTask(remoteId) {
    const item = getSharedItem(remoteId);
    if (!item || !item._shared || !item._shared.mine) return { ok: false };
    const next = { ...stripShared(item) };
    let completed = !item.completed;
    if (completed && advanceRecurOnTick(next)) completed = false;
    next.completed = completed;
    next.completedAt = completed ? new Date().toISOString() : null;
    return writeSharedTask(item._shared.dest, remoteId, next);
}

/**
 * حذف تسک خودی در نمای مشترک.
 */
export async function deleteSharedTask(remoteId) {
    const item = getSharedItem(remoteId);
    if (!item || !item._shared || !item._shared.mine) return { ok: false };
    const dest = item._shared.dest;
    if (dest.type === 'peer') {
        return deleteDmTask(remoteId);
    }
    if (dest.type === 'group') {
        await enqueueGroupOp(dest.groupId, 'delete', remoteId, null);
        try {
            await flushGroup(dest.groupId);
        } catch { /* آفلاین */ }
        return { ok: true };
    }
    return { ok: false };
}

// ═══════════════════════════════════════════════════════════════════════════
// پل جزئیات: آیتم خودیِ مشترک زیر دست detail (خواندن/نوشتن روی همان آبجکت)
// فعال فقط وقتی state.currentDetailId با آن ست است (با بستن detail غیرفعال).
// ═══════════════════════════════════════════════════════════════════════════

let _detailBridge = null;
let _detailBridgeChildId = null;
let _detailBridgeReadOnly = false;

/**
 * ثبت پل برای باز کردن جزئیات.
 *
 * ⚠️ 10.25: حالا آیتم **دیگران** هم پل می‌گیرد، ولی با `readOnly: true`.
 * دلیل: مخاطب/عضو گروه باید بتواند جزئیات وظیفه‌ی فرستاده‌شده را ببیند
 * (متن، تاریخ‌ها، مکان، عکس‌ها) بدون اینکه چیزی را عوض کند. پیش از این
 * `openSharedDetail` برای آیتم غیرخودی `false` برمی‌گرداند و کلیک «جزئیات»
 * هیچ کاری نمی‌کرد.
 *
 * @param {object} item — آیتم سطح‌بالای مشترک (صاحب `_shared`)
 * @param {{readOnly?: boolean, childId?: string}} [opts]
 * @returns {boolean}
 */
export function setDetailBridge(item, opts) {
    if (!item || !item._shared) return false;
    const o = opts || {};
    const mine = Boolean(item._shared.mine);
    const readOnly = Boolean(o.readOnly);
    if (!mine && !readOnly) return false;
    _detailBridge = item;
    _detailBridgeChildId = o.childId ? String(o.childId) : null;
    _detailBridgeReadOnly = readOnly || !mine;
    return true;
}

export function clearDetailBridge() {
    _detailBridge = null;
    _detailBridgeChildId = null;
    _detailBridgeReadOnly = false;
}

/**
 * آیا جزئیات باز، «فقط خواندنی» است؟ (آیتم دیگران)
 * @returns {boolean}
 */
export function isDetailBridgeReadOnly() {
    return _detailBridgeReadOnly;
}

/**
 * آیتم سطح‌بالای پل (صاحب `_shared`) — برای ذخیره‌ی bulk؛ حتی وقتی جزئیات
 * روی یک زیرکار باز است، نوشتن باید روی والد انجام شود.
 * @returns {object|null}
 */
export function getDetailBridgeRoot() {
    return _detailBridge;
}

let _reconcileSubscribed = false;

function ensureReconcileSubscribed() {
    if (_reconcileSubscribed) return;
    _reconcileSubscribed = true;
    // بعد از بستن جزئیات مشترک: تطبیق با حقیقت سرور (اگر PATCH شکست خورده بود، لیست اصلاح می‌شود)
    // بعد از بستن جزئیات مشترک: اول ذخیره‌های در حال پرواز، بعد تطبیق با حقیقت سرور
    events.on(EV.DETAIL_CLOSED, async () => {
        if (!_detailBridge) return;
        const hadBridge = _detailBridge;
        _detailBridge = null;
        _detailBridgeChildId = null;
        _detailBridgeReadOnly = false;
        if (!hadBridge || !hadBridge._shared) return;
        // ⚠️ 10.25: جزئیات فقط‌خواندنی چیزی ننوشته که نیاز به تطبیق داشته باشد.
        if (!hadBridge._shared.mine) return;
        try {
            const dest = getDestination();
            const sameDest = dest.type !== 'local' &&
                String((dest.peerId || dest.groupId || '')) ===
                String((hadBridge._shared.dest.peerId || hadBridge._shared.dest.groupId || ''));
            if (!sameDest) return;
            await waitSharedSaves();
            await refreshSharedList();
            const { render } = await import('../ui.js');
            render();
        } catch { /* best-effort */ }
    });
}
ensureReconcileSubscribed();

/**
 * آبجکت پل اگر id همان جزئیات باز باشد، وگرنه null.
 * اگر جزئیات روی زیرکارِ یک برنامه‌ی مشترک باز شده باشد، همان زیرکار برمی‌گردد.
 */
export function getDetailBridgeTask(id) {
    try {
        if (!_detailBridge) return null;
        if (!state.currentDetailId) return null;
        if (String(state.currentDetailId) !== String(id)) return null;
        if (_detailBridgeChildId) {
            if (String(_detailBridgeChildId) !== String(id)) return null;
            const c = (_detailBridge.children || []).find(x => x && String(x.id) === String(id));
            return c || null;
        }
        if (String(_detailBridge.id) !== String(id)) return null;
        return _detailBridge;
    } catch {
        return null;
    }
}

/**
 * تسک‌های گروه + نام/آواتار فرستنده از اعضا.
 * opts.lite: بدون درخواست members (نام/آواتار خالی می‌ماند؛ برای یادآور کافی است).
 */
export async function fetchGroupTasks(groupId, myId, opts) {
    const lite = !!(opts && opts.lite);
    const tasksP = apiFetch('/api/groups/' + encodeURIComponent(groupId) + '/tasks');
    const membersP = lite ? null : apiFetch('/api/groups/' + encodeURIComponent(groupId) + '/members');
    const [tres, mres] = membersP ? await Promise.all([tasksP, membersP]) : [await tasksP, null];
    if (!tres.ok) return tres;
    const members = (mres && mres.ok && mres.data && mres.data.members) || [];
    const nameOf = (uid) => {
        const m = members.find((x) => String(x.userId) === String(uid));
        if (!m) return String(uid || '').slice(0, 8);
        return m.displayName || m.username || String(m.userId).slice(0, 8);
    };
    const avatarOf = (uid) => {
        const m = members.find((x) => String(x.userId) === String(uid));
        return (m && m.avatarUrl) || null;
    };
    const items = ((tres.data && tres.data.tasks) || []).map((t) => {
        const creator = t.creatorId || t.creator_id;
        const mine = String(creator || '') === String(myId || '');
        const task = normalizeRemote(parsePayload(t.payload), {
            serverId: t.id,
            createdAt: t.createdAt || t.created_at,
            updatedAt: t.updatedAt || t.updated_at,
            revision: t.revision,
            mine,
            dest: { type: 'group', groupId },
            senderName: mine ? null : nameOf(creator),
        });
        if (!mine) task._shared.senderAvatar = avatarOf(creator);
        return task;
    });
    return { ok: true, items };
}
