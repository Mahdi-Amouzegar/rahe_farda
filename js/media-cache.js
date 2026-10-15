// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// media-cache.js -- کش محلی بایت عکس (lazy) + توابع خالص عکس
//
// مدل lazy (تصمیم کاربر):
//   - بایت عکس هرگز در سینک نیست (نه snapshot، نه op) — فقط ارجاع (id + meta).
//   - عکس فقط وقتی دانلود می‌شود که کاربر وارد جزئیات همان تسک شود.
//   - بایت دانلودشده در IDB (media_cache) می‌ماند؛ باز کردن دوباره‌ی
//     جزئیات هیچ درخواستی نمی‌زند. فقط عکس‌های جدید (کش‌نشده) fetch می‌شوند.
//
// ⚠️ دیتابیس جدا از spaceTodoDB (عمدی):
//    هندل‌های باز spaceTodoDB هیچ‌وقت بسته نمی‌شوند؛ اگر کش همان DB را
//    با version بالاتر باز کند، ارتقا برای همیشه blocked می‌ماند و
//    خواندن کش (و رندر عکس) هیچ‌وقت برنمی‌گردد. DB جدا این بن‌بست را ندارد.
const IDB_NAME = 'spaceTodoMedia';
const IDB_MEDIA_CACHE = 'media_cache';
const IDB_VERSION = 1;

/** نام دیتابیس کش — برای تست جدایی از spaceTodoDB */
export const MEDIA_CACHE_DB_NAME = IDB_NAME;

/** @type {IDBDatabase|null} */
let _db = null;

function openDb() {
    if (_db) return Promise.resolve(_db);
    if (typeof indexedDB === 'undefined') {
        return Promise.reject(new Error('no-indexeddb'));
    }
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_NAME, IDB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(IDB_MEDIA_CACHE)) {
                db.createObjectStore(IDB_MEDIA_CACHE, { keyPath: 'photoId' });
            }
        };
        req.onsuccess = () => { _db = req.result; resolve(_db); };
        req.onerror = () => reject(req.error);
    });
}

/**
 * خواندن عکس کش‌شده.
 * @param {string} photoId
 * @returns {Promise<{blob: Blob, contentType: string, serverMediaId: string|null}|null>}
 */
export async function getCachedPhoto(photoId) {
    if (!photoId) return null;
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_MEDIA_CACHE, 'readonly');
        const req = tx.objectStore(IDB_MEDIA_CACHE).get(String(photoId));
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

/**
 * ذخیره‌ی بایت عکس در کش.
 */
export async function putCachedPhoto(photoId, blob, contentType, serverMediaId) {
    if (!photoId || !blob) return;
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_MEDIA_CACHE, 'readwrite');
        tx.objectStore(IDB_MEDIA_CACHE).put({
            photoId: String(photoId),
            blob,
            contentType: contentType || blob.type || 'image/jpeg',
            serverMediaId: serverMediaId || null,
            cachedAt: new Date().toISOString(),
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * حذف عکس از کش (مثلاً وقتی کاربر عکس را حذف می‌کند).
 */
export async function deleteCachedPhoto(photoId) {
    if (!photoId) return;
    try {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_MEDIA_CACHE, 'readwrite');
            tx.objectStore(IDB_MEDIA_CACHE).delete(String(photoId));
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch {
        // silent — کش best-effort است
    }
}

/**
 * دانلود بایت عکس از سرور (presign و بعد GET بایت).
 * @param {string} endpoint — state.sync.endpoint
 * @param {string} token — state.sync.authToken
 * @param {string} serverMediaId — شناسه‌ی سروری مدیا
 * @returns {Promise<Blob>}
 */
export async function fetchPhotoBlob(endpoint, token, serverMediaId) {
    const presign = await fetch(`${endpoint}/api/media/${encodeURIComponent(serverMediaId)}`, {
        headers: { 'Authorization': `Bearer ${token}` },
    });
    const pj = await presign.json().catch(() => null);
    if (!presign.ok || !pj || pj.ok !== true || !pj.data || !pj.data.downloadUrl) {
        throw new Error('presign failed');
    }
    const res = await fetch(pj.data.downloadUrl);
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
    return await res.blob();
}

// ═══════════════════════════════════════════════════════════════════════════
// توابع خالص (تست‌پذیر، بدون IDB/DOM)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * کپی تسک برای سینک — بدون بایت عکس.
 * فقط ارجاع می‌ماند (id + meta + serverMediaId) تا حجم op/snapshot کم شود.
 *
 * @param {object} task
 * @returns {object} کپی کم‌حجم (تسک ورودی دست نمی‌خورد)
 */
export function stripPhotoBytesForSync(task) {
    if (!task || typeof task !== 'object') return task;
    const stripList = (list) => (Array.isArray(list) ? list.map(p => {
        if (!p || typeof p !== 'object') return p;
        const out = { ...p };
        delete out.dataUrl;
        return out;
    }) : list);
    const hasPhotos = Array.isArray(task.photos) && task.photos.length > 0;
    const hasKidPhotos = Array.isArray(task.children)
        && task.children.some(c => c && Array.isArray(c.photos) && c.photos.length > 0);
    if (!hasPhotos && !hasKidPhotos) return task;
    const out = { ...task };
    if (hasPhotos) out.photos = stripList(task.photos);
    if (hasKidPhotos) out.children = task.children.map(c => (
        (c && Array.isArray(c.photos) && c.photos.length > 0) ? { ...c, photos: stripList(c.photos) } : c
    ));
    return out;
}

/**
 * تصمیم نمایش یک عکس در جزئیات.
 *
 * @param {object} photo
 * @param {{cached: boolean, online: boolean, authed: boolean}} ctx
 * @returns {'cache'|'dataUrl'|'fetch'|'pending'}
 */
export function classifyPhotoForDisplay(photo, ctx) {
    if (!photo || typeof photo !== 'object') return 'pending';
    if (ctx && ctx.cached) return 'cache';
    if (typeof photo.dataUrl === 'string' && photo.dataUrl.startsWith('data:image')) return 'dataUrl';
    if (photo.serverMediaId && ctx && ctx.online && ctx.authed) return 'fetch';
    return 'pending';
}
