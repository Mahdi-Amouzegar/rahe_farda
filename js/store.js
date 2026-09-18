// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// store.js -- IndexedDB + CRUD actions (ESM) — گام ۶ فاز ۴ (نسخه‌ی نهایی)
//
// ⚠️ این نسخه incremental save دارد:
//   - saveTask(task) برای ذخیره‌ی یک task
//   - deleteTaskFromStore(id) برای حذف یک task
//   - saveTasks() فقط برای bulk (import/migration) نگه داشته شده
//   - structuredClone حذف شد (IndexedDB خودش کپی می‌کند)
// ═══════════════════════════════════════════════════════════════════════════

import { state, MAX_LENGTH, toFa, uid, escapeHtml } from './core.js';
import { sameMinute, nearestUpcoming, allSessions, hasSessionAt, visibleChildren } from './sessions.js';
import { getNow } from './time.js';
import { events, EV, CALLBACK_TO_EVENT } from './events.js';

// ═══════════════════════════════════════════════════════════════════════════
// Map helpers — set by app.js during boot
// ═══════════════════════════════════════════════════════════════════════════

const _mapHelpers = {
    getMap: () => null,
    getMapReady: () => false,
    getPickMarker: () => null,
    setPickMarker: () => {}
};

/**
 * تنظیم helperهای map — فقط از app.js در بوت فراخوانی می‌شود.
 * @param {Partial<typeof _mapHelpers>} helpers
 */
export function setMapHelpers(helpers) {
    if (!helpers || typeof helpers !== 'object') return;
    if (typeof helpers.getMap === 'function') _mapHelpers.getMap = helpers.getMap;
    if (typeof helpers.getMapReady === 'function') _mapHelpers.getMapReady = helpers.getMapReady;
    if (typeof helpers.getPickMarker === 'function') _mapHelpers.getPickMarker = helpers.getPickMarker;
    if (typeof helpers.setPickMarker === 'function') _mapHelpers.setPickMarker = helpers.setPickMarker;
}

// ═══════════════════════════════════════════════════════════════════════════
// call() / invoke() — جایگزین _callbacks[name](...args)
// ═══════════════════════════════════════════════════════════════════════════

function call(name, ...args) {
    const eventName = CALLBACK_TO_EVENT[name];
    if (!eventName) {
        // eslint-disable-next-line no-console
        console.warn(`store.call: unknown callback "${name}"`);
        return;
    }
    events.emit(eventName, ...args);
}

function invoke(name, ...args) {
    const eventName = CALLBACK_TO_EVENT[name];
    if (!eventName) {
        // eslint-disable-next-line no-console
        console.warn(`store.invoke: unknown callback "${name}"`);
        return undefined;
    }
    const listeners = events._listeners.get(eventName);
    if (!listeners || listeners.size === 0) return undefined;
    let result;
    for (const listener of listeners) {
        try {
            const r = listener(...args);
            if (r !== undefined) {
                result = r;
                break;
            }
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error(`store.invoke: listener for "${eventName}" threw:`, err);
        }
    }
    return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// IndexedDB
// ═══════════════════════════════════════════════════════════════════════════

const IDB_NAME = 'spaceTodoDB';
const IDB_STORE = 'tasks';
const IDB_TRASH = 'trash';
const IDB_VERSION = 2;
const useIDB = typeof indexedDB !== 'undefined';
let idbPromise = null;

function idbOpen() {
    if (!useIDB) return Promise.reject(new Error('no-indexeddb'));
    if (!idbPromise) {
        idbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(IDB_NAME, IDB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(IDB_STORE)) {
                    db.createObjectStore(IDB_STORE, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(IDB_TRASH)) {
                    db.createObjectStore(IDB_TRASH, { keyPath: 'id' });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }
    return idbPromise;
}

function idbGetAll(storeName) {
    return idbOpen().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const rq = tx.objectStore(storeName).getAll();
        rq.onsuccess = () => resolve(rq.result || []);
        rq.onerror = () => reject(rq.error);
    }));
}

// ⚠️ idbPutAll فقط برای bulk (import/migration) — نه برای هر تغییر
function idbPutAll(storeName, items, opts) {
    const options = opts || {};
    return idbOpen().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        if (items.length > 0 || options.allowEmptyClear) {
            store.clear();
            items.forEach(item => store.put(item));
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    }));
}

// ⚠️ جدید: idbPut تکی — فقط یک رکورد را ذخیره می‌کند
function idbPut(storeName, item) {
    return idbOpen().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(item);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    }));
}

// ⚠️ جدید: idbDelete تکی — فقط یک رکورد را حذف می‌کند
function idbDelete(storeName, id) {
    return idbOpen().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    }));
}

// ⚠️ جدید: idbClear — کل store را پاک می‌کند (برای import)
function idbClear(storeName) {
    return idbOpen().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    }));
}

// ═══════════════════════════════════════════════════════════════════════════
// Sanitization
// ═══════════════════════════════════════════════════════════════════════════

function sanitizeBilingualNames(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const out = {};
    if (typeof obj.fa === 'string' && obj.fa.trim()) out.fa = obj.fa.trim().replace(/\s+/g, ' ').slice(0, 80);
    if (typeof obj.en === 'string' && obj.en.trim()) out.en = obj.en.trim().replace(/\s+/g, ' ').slice(0, 80);
    return Object.keys(out).length ? out : null;
}

export function validLoc(v) {
    if (!v || !Number.isFinite(+v.lat) || !Number.isFinite(+v.lng) ||
        Math.abs(+v.lat) > 90 || Math.abs(+v.lng) > 180) {
        return null;
    }
    const out = { lat: +v.lat, lng: +v.lng };
    if (typeof v.name === 'string' && v.name.trim()) {
        out.name = v.name.trim().replace(/\s+/g, ' ').slice(0, 80);
    } else {
        out.name = null;
    }
    const names = sanitizeBilingualNames(v.names);
    if (names) out.names = names;
    const cityNames = sanitizeBilingualNames(v.cityNames);
    if (cityNames) out.cityNames = cityNames;
    return out;
}

export function sanitizeUrl(raw) {
    if (typeof raw !== 'string') return '';
    const v = raw.trim().slice(0, 300);
    if (!v) return '';

    if (/^[a-z][a-z0-9+.-]*:/i.test(v)) {
        try {
            const u = new URL(v);
            if (!['http:', 'https:'].includes(u.protocol)) return '';
            return u.href.slice(0, 300);
        } catch {
            return '';
        }
    }

    if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/i.test(v)) {
        try {
            const u = new URL('https://' + v);
            if (!['http:', 'https:'].includes(u.protocol)) return '';
            return u.href.slice(0, 300);
        } catch {
            return '';
        }
    }

    return '';
}

export function sanitizeTask(t) {
    const sessions = Array.isArray(t.sessions)
        ? t.sessions
            .filter(s => s && typeof s.at === 'string' && !isNaN(new Date(s.at)))
            .map(s => ({
                id: typeof s.id !== 'undefined' ? s.id : uid(),
                at: s.at,
                reminded: Boolean(s.reminded),
                remindedDue: Boolean(s.remindedDue),
                location: validLoc(s.location),
                remindMin: (s.remindMin === null || s.remindMin === undefined) ? null
                    : (Number.isFinite(+s.remindMin) && +s.remindMin >= 0 ? Math.floor(+s.remindMin) : null)
            }))
        : [];
    for (let i = sessions.length - 1; i >= 0; i--) {
        if (sessions.findIndex(x => sameMinute(x.at, sessions[i].at)) !== i) sessions.splice(i, 1);
    }
    if (sessions.length === 0 && typeof t.dueAt === 'string' && !isNaN(new Date(t.dueAt))) {
        sessions.push({ id: uid(), at: t.dueAt });
    }
    const kind = (t.kind === 'plan' || t.kind === 'group')
        ? 'plan'
        : (t.kind === 'series' ? 'series' : 'task');
    const children = kind === 'plan' && Array.isArray(t.children)
        ? t.children
            .filter(c => c && typeof c.id !== 'undefined' && typeof c.text === 'string' && c.text.trim() !== '' && c.kind !== 'plan')
            .map(c => sanitizeTask({ ...c, kind: 'task', children: undefined }))
        : [];
    return {
        id: t.id,
        text: String(t.text).slice(0, MAX_LENGTH),
        completed: Boolean(t.completed),
        priority: ['high', 'medium', 'low'].includes(t.priority) ? t.priority : 'medium',
        createdAt: typeof t.createdAt === 'string' ? t.createdAt : new Date().toISOString(),
        completedAt: (typeof t.completedAt === 'string' && !isNaN(new Date(t.completedAt))) ? t.completedAt : null,
        timeSpent: Number.isFinite(+t.timeSpent) && +t.timeSpent > 0 ? Math.floor(+t.timeSpent) : 0,
        timerStartedAt: (typeof t.timerStartedAt === 'string' && !isNaN(new Date(t.timerStartedAt))) ? t.timerStartedAt : null,
        startAt: (typeof t.startAt === 'string' && !isNaN(new Date(t.startAt))) ? t.startAt : null,
        endAt: (typeof t.endAt === 'string' && !isNaN(new Date(t.endAt))) ? t.endAt : null,
        description: typeof t.description === 'string' ? t.description.slice(0, 1000) : '',
        phone: typeof t.phone === 'string' ? t.phone.slice(0, 20) : '',
        address: typeof t.address === 'string' ? t.address.slice(0, 500) : '',
        url: sanitizeUrl(t.url),
        sessions,
        kind,
        children,
        pinned: Boolean(t.pinned),
        recur: ['daily', 'weekly', 'monthly', 'custom', 'hourly', 'weeklyDays', 'monthlyDays'].includes(t.recur) ? t.recur : 'none',
        recurN: (Number.isFinite(+t.recurN) && +t.recurN >= 1 && +t.recurN <= 365) ? Math.floor(+t.recurN) : null,
        recurDays: Array.isArray(t.recurDays) ? [...new Set(t.recurDays.map(x => Math.floor(+x)).filter(x => x >= 0 && x <= 31))].slice(0, 31) : [],
        archived: Boolean(t.archived),
        photos: Array.isArray(t.photos) ? t.photos
            .filter(p => p && typeof p.dataUrl === 'string' && p.dataUrl.startsWith('data:image') && p.dataUrl.length < 1500000)
            .slice(0, 8)
            .map(p => ({ id: typeof p.id !== 'undefined' ? p.id : uid(), dataUrl: p.dataUrl, addedAt: typeof p.addedAt === 'string' ? p.addedAt : new Date().toISOString() }))
            : [],
        location: validLoc(t.location)
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// Load / Save — Incremental
// ═══════════════════════════════════════════════════════════════════════════

export async function loadTasks() {
    let raw = [];
    if (useIDB) {
        try {
            raw = await idbGetAll(IDB_STORE);
        } catch {
            raw = [];
        }
    }
    state.tasks = raw
        .filter(t => t && typeof t.id !== 'undefined' && typeof t.text === 'string' && t.text.trim() !== '')
        .map(sanitizeTask);
}

/**
 * ذخیره‌ی یک task تکی در IndexedDB.
 *
 * ⚠️ این تابع جایگزین saveTasks برای تغییرات تکی است.
 * بدون structuredClone — IndexedDB خودش داده را کپی می‌کند.
 *
 * @param {object} task
 * @param {object} [parent] - اگر task یک فرزند است، والد آن را هم ذخیره می‌کند
 * @returns {Promise<void>}
 */
export function saveTask(task, parent) {
    if (!task || typeof task.id === 'undefined') {
        return Promise.reject(new Error('saveTask: invalid task'));
    }
    invalidateTaskIndex();

    // اگر فرزند است، والد را ذخیره کن (چون فرزندان درون والد ذخیره می‌شوند)
    const target = parent || task;

    const p = useIDB
        ? idbPut(IDB_STORE, target)
        : (function () {
            try {
                // fallback: localStorage (bulk)
                localStorage.setItem('spaceTodoTasks', JSON.stringify(state.tasks));
                return Promise.resolve();
            } catch (e) {
                return Promise.reject(e);
            }
        })();

    p.then(() => {
        events.emit(EV.TASK_SAVED, { task, parent: parent || null });
    }).catch(err => {
        console.error('saveTask failed', err);
        events.emit(EV.STORAGE_ERROR, {
            message: 'خطا در ذخیره‌سازی محلی. ممکن است حافظه مرورگر پر شده باشد.'
        });
        if (!saveTask._warned) {
            saveTask._warned = true;
            window.dispatchEvent(new CustomEvent('rahe-storage-error', {
                detail: { message: 'خطا در ذخیره‌سازی محلی. ممکن است حافظه مرورگر پر شده باشد.' }
            }));
        }
    });
    return p;
}

/**
 * حذف یک task تکی از IndexedDB.
 * @param {string|number} id
 * @returns {Promise<void>}
 */
export function deleteTaskFromStore(id) {
    invalidateTaskIndex();
    const p = useIDB
        ? idbDelete(IDB_STORE, id)
        : (function () {
            try {
                localStorage.setItem('spaceTodoTasks', JSON.stringify(state.tasks));
                return Promise.resolve();
            } catch (e) {
                return Promise.reject(e);
            }
        })();

    p.catch(err => {
        console.error('deleteTaskFromStore failed', err);
    });
    return p;
}

/**
 * ذخیره‌ی کل state.tasks در IndexedDB (bulk).
 *
 * ⚠️ این تابع فقط برای موارد خاص استفاده می‌شود:
 *   - import از JSON
 *   - migration
 *   - bulk operations (مثل archiveDone)
 *
 * برای تغییرات تکی، از saveTask استفاده کنید.
 *
 * @deprecated برای تغییرات تکی از saveTask استفاده کنید
 * @returns {Promise<void>}
 */
export function saveTasks() {
    const snapshot = state.tasks;
    invalidateTaskIndex();

    const p = useIDB
        ? idbPutAll(IDB_STORE, snapshot, { allowEmptyClear: true })
        : (function () {
            try {
                localStorage.setItem('spaceTodoTasks', JSON.stringify(snapshot));
                return Promise.resolve();
            } catch (e) {
                return Promise.reject(e);
            }
        })();
    p.then(() => {
        events.emit(EV.TASK_SAVED, { bulk: true });
    }).catch(() => {
        console.error('storage save failed (bulk)');
        events.emit(EV.STORAGE_ERROR, {
            message: 'خطا در ذخیره‌سازی محلی. ممکن است حافظه مرورگر پر شده باشد.'
        });
    });
    return p;
}

// ═══════════════════════════════════════════════════════════════════════════
// Cache Invalidation
// ═══════════════════════════════════════════════════════════════════════════

export function invalidateTaskIndex() {
    state.taskIndex = null;
    state.taskIndexVersion++;
}

export function findTask(id) {
    const key = String(id);
    for (const t of state.tasks) {
        if (String(t.id) === key) return { task: t, parent: null };
        if (t.kind === 'plan' && Array.isArray(t.children)) {
            for (const c of t.children) {
                if (String(c.id) === key) return { task: c, parent: t };
            }
        }
    }
    return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Plan helpers
// ═══════════════════════════════════════════════════════════════════════════

export function planStats(g) {
    const k = visibleChildren(g);
    return { total: k.length, done: k.filter(c => c.completed).length };
}

export function planIsDone(g) {
    const s = planStats(g);
    return s.total > 0 && s.done === s.total;
}

export function planDueKey(g) {
    const now = getNow().getTime();
    let best = Infinity;
    (g.sessions || []).forEach(s => {
        const v = new Date(s.at).getTime();
        if (v >= now && v < best) best = v;
    });
    (g.children || []).forEach(c => {
        if (c.archived) return;
        const u = nearestUpcoming(c);
        if (u) {
            const v = new Date(u.at).getTime();
            if (v < best) best = v;
        }
    });
    return best;
}

// ═══════════════════════════════════════════════════════════════════════════
// Recur
// ═══════════════════════════════════════════════════════════════════════════

function daysInMonth(gy, gm) {
    return new Date(gy, gm + 1, 0).getDate();
}

function addInterval(date, recur, n) {
    const d = new Date(date.getTime());
    if (recur === 'daily') d.setDate(d.getDate() + 1);
    else if (recur === 'weekly') d.setDate(d.getDate() + 7);
    else if (recur === 'monthly') {
        const day = d.getDate();
        d.setDate(1);
        d.setMonth(d.getMonth() + 1);
        d.setDate(Math.min(day, daysInMonth(d.getFullYear(), d.getMonth())));
    }
    else if (recur === 'custom' && n >= 1) d.setDate(d.getDate() + n);
    else if (recur === 'hourly' && n >= 1) d.setTime(d.getTime() + n * 3600 * 1000);
    return d;
}

function nextWeekday(base, days) {
    const set = (days || []).filter(d => d >= 0 && d <= 6);
    if (!set.length) return null;
    for (let i = 1; i <= 7; i++) {
        const d = new Date(base.getTime());
        d.setDate(d.getDate() + i);
        if (set.includes(d.getDay())) {
            d.setHours(base.getHours(), base.getMinutes(), 0, 0);
            return d;
        }
    }
    return null;
}

function nextMonthday(base, days) {
    const set = [...new Set((days || []).filter(d => d >= 1 && d <= 31))].sort((a, b) => a - b);
    if (!set.length) return null;
    for (let m = 0; m < 13; m++) {
        const y = base.getFullYear();
        const mo = base.getMonth() + m;
        for (const dd of set) {
            if (dd > daysInMonth(y, mo)) continue;
            const c = new Date(y, mo, dd, base.getHours(), base.getMinutes(), 0, 0);
            if (c.getTime() > base.getTime()) return c;
        }
    }
    return null;
}

export function advanceRecur(task) {
    const r = task.recur;
    const n = r === 'custom'
        ? ((task.recurN >= 1 && task.recurN <= 365) ? task.recurN : 0)
        : r === 'hourly'
            ? ((task.recurN >= 1 && task.recurN <= 168) ? task.recurN : 0)
            : 0;
    if ((r === 'custom' || r === 'hourly') && !n) return false;
    const list = task.sessions || [];
    let base = Date.now();
    if (list.length) {
        base = list.reduce((m, s) => {
            const v = new Date(s.at).getTime();
            return isNaN(v) ? m : Math.max(m, v);
        }, base);
    }
    const b = new Date(base);
    let next = null;
    if (r === 'weeklyDays') next = nextWeekday(b, task.recurDays);
    else if (r === 'monthlyDays') next = nextMonthday(b, task.recurDays);
    else next = addInterval(b, r, n);
    if (!next || next.getTime() <= base) return false;
    task.sessions.push({ id: uid(), at: next.toISOString(), reminded: false, remindMin: null, location: null });
    return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// Trash
// ═══════════════════════════════════════════════════════════════════════════

export async function loadTrash() {
    if (useIDB) {
        try {
            state.trash = await idbGetAll(IDB_TRASH);
        } catch {
            state.trash = [];
        }
    }
    purgeTrash(false);
}

export function saveTrash() {
    const p = useIDB ? idbPutAll(IDB_TRASH, state.trash, { allowEmptyClear: true }) : Promise.resolve();
    p.catch(() => {});
    return p;
}

/**
 * ذخیره‌ی یک آیتم تکی در سطل زباله.
 * @param {object} item
 * @returns {Promise<void>}
 */
export function saveTrashItem(item) {
    if (!item || typeof item.id === 'undefined') return Promise.resolve();
    const p = useIDB ? idbPut(IDB_TRASH, item) : Promise.resolve();
    p.catch(() => {});
    return p;
}

/**
 * حذف یک آیتم تکی از سطل زباله.
 * @param {string|number} id
 * @returns {Promise<void>}
 */
export function deleteTrashItem(id) {
    const p = useIDB ? idbDelete(IDB_TRASH, id) : Promise.resolve();
    p.catch(() => {});
    return p;
}

export function purgeTrash(renderAfter) {
    const cut = Date.now() - 30 * 86400000;
    const before = state.trash.length;
    const removed = [];
    state.trash = state.trash.filter(x => {
        try {
            const keep = new Date(x.deletedAt).getTime() > cut;
            if (!keep) removed.push(x.id);
            return keep;
        } catch {
            removed.push(x.id);
            return false;
        }
    });
    if (state.trash.length !== before) {
        // حذف تکی موارد منقضی
        if (useIDB) {
            removed.forEach(id => deleteTrashItem(id));
        }
        if (renderAfter !== false) call('render');
    }
}

export function moveToTrashById(id) {
    const found = findTask(id);
    if (!found) return false;
    const trashItem = {
        ...found.task,
        parentId: found.parent ? found.parent.id : null,
        deletedAt: new Date().toISOString()
    };
    if (found.parent) {
        found.parent.children = found.parent.children.filter(c => String(c.id) !== String(id));
    } else {
        state.tasks = state.tasks.filter(t => String(t.id) !== String(id));
    }
    state.trash.unshift(trashItem);
    invalidateTaskIndex();

    // ✅ incremental: ذخیره‌ی trashItem تکی + حذف task تکی
    if (useIDB) {
        saveTrashItem(trashItem);
        deleteTaskFromStore(id);
    } else {
        saveTrash();
        saveTasks();
    }

    events.emit(EV.TASK_DELETED, { id, task: found.task, parentId: found.parent ? found.parent.id : null });
    return true;
}

export function restoreTrash(id) {
    const i = state.trash.findIndex(x => String(x.id) === String(id));
    if (i < 0) return;
    const [item] = state.trash.splice(i, 1);
    const { parentId, deletedAt, ...rest } = item;
    const g = parentId ? state.tasks.find(t => String(t.id) === String(parentId) && t.kind === 'plan') : null;
    if (g) {
        (g.children = g.children || []).unshift(rest);
    } else {
        state.tasks.unshift(rest);
    }
    invalidateTaskIndex();

    // ✅ incremental: ذخیره‌ی task تکی + حذف trashItem تکی
    if (useIDB) {
        if (g) saveTask(rest, g);
        else saveTask(rest);
        deleteTrashItem(id);
    } else {
        saveTrash();
        saveTasks();
    }

    call('render');
    call('renderTrash');
    events.emit(EV.TASK_RESTORED, { id, task: rest });
}

// ═══════════════════════════════════════════════════════════════════════════
// CRUD
// ═══════════════════════════════════════════════════════════════════════════

export function addTask(forceKind) {
    const input = document.getElementById('taskInput');
    const prioritySelect = document.getElementById('prioritySelect');
    const text = input.value.trim().replace(/\s+/g, ' ');
    if (!text) {
        input.classList.remove('input-error');
        void input.offsetWidth;
        input.classList.add('input-error');
        input.focus();
        return;
    }
    const kind = forceKind || state.pendingKind || 'task';
    const isPlan = kind === 'plan';
    const isSeries = kind === 'series';
    let recur = 'none';
    let recurN = null;
    let recurDays = [];
    let sessions = state.addDraftSessions.map(s => ({ ...s }));
    if (isSeries) {
        const errEl = document.getElementById('seriesError');
        if (errEl) errEl.textContent = '';
        if (state.seriesType === 'dates') {
            sessions.sort((a, b) => new Date(a.at) - new Date(b.at));
        } else if (['hourly', 'daily', 'weekly', 'monthly'].includes(state.seriesType)) {
            recur = state.seriesType;
            sessions = [];
        } else if (state.seriesType === 'hourlyN') {
            const n = parseInt(document.getElementById('seriesN').value, 10);
            if (!(n >= 1 && n <= 168)) {
                if (errEl) errEl.textContent = 'عدد ساعت بین ۱ تا ۱۶۸ باشد';
                input.focus();
                return;
            }
            recur = 'hourly';
            recurN = n;
            sessions = [];
        } else if (state.seriesType === 'weeklyDays' || state.seriesType === 'monthlyDays') {
            if (!state.seriesDays.length) {
                if (errEl) errEl.textContent = 'حداقل یک روز انتخاب کنید';
                input.focus();
                return;
            }
            recur = state.seriesType;
            recurDays = [...state.seriesDays];
            sessions = [];
        }
    }
    state.justAddedId = uid();
    const newTask = {
        id: state.justAddedId,
        text: text.slice(0, MAX_LENGTH),
        completed: false,
        completedAt: null,
        priority: prioritySelect.value,
        recur,
        recurN,
        recurDays,
        description: document.getElementById('descInput').value.trim().slice(0, 1000),
        createdAt: new Date().toISOString(),
        phone: '',
        address: '',
        url: '',
        kind: isPlan ? 'plan' : (isSeries ? 'series' : 'task'),
        children: isPlan ? state.planDraftKids.map(k => blankTask(k)) : [],
        pinned: false,
        archived: false,
        timeSpent: 0,
        timerStartedAt: null,
        sessions: sessions,
        location: state.pendingLoc ? { ...state.pendingLoc } : null,
        photos: [],
        startAt: isPlan ? (state.planDraftStart || null) : null,
        endAt: isPlan ? (state.planDraftEnd || null) : null
    };
    state.tasks.unshift(newTask);
    if (isPlan) state.expandedPlans.add(String(state.justAddedId));

    // ✅ incremental: ذخیره‌ی task تکی
    saveTask(newTask);

    input.value = '';
    input.classList.remove('input-error');
    state.addDraftSessions = [];
    call('updateDueChips');
    state.planDraftKids = [];
    state.planDraftStart = null;
    state.planDraftEnd = null;
    call('renderPlanKids');
    document.getElementById('descInput').value = '';
    document.getElementById('prioritySelect').value = 'medium';
    const sErr = document.getElementById('seriesError');
    if (sErr) sErr.textContent = '';
    state.pendingLoc = null;
    const map = _mapHelpers.getMap();
    const pm = _mapHelpers.getPickMarker();
    if (pm && map && _mapHelpers.getMapReady()) {
        map.removeLayer(pm);
        _mapHelpers.setPickMarker(null);
    }
    call('updateLocChip');
    input.focus();
    call('render');
    if (kind === 'series') {
        const newId = state.justAddedId;
        state.justAddedId = null;
        call('openDetail', newId);
    }
}

export function toggleTask(id) {
    const found = findTask(id);
    if (!found) return;
    found.task.completed = !found.task.completed;
    found.task.completedAt = found.task.completed ? new Date().toISOString() : null;
    let recurred = false;
    if (found.task.completed && found.task.recur && found.task.recur !== 'none' && advanceRecur(found.task)) {
        found.task.completed = false;
        recurred = true;
    }
    // ✅ incremental: ذخیره‌ی task تکی
    saveTask(found.task, found.parent);
    call('render');
}

export async function deleteTask(id, el) {
    const pre = findTask(id);
    if (!pre) return;
    if (!pre.parent && pre.task.kind === 'plan' && (pre.task.children || []).length > 0) {
        const ok = await invoke('showConfirmModal', {
            title: 'حذف برنامه',
            message: `این برنامه ${toFa(pre.task.children.length)} کار دارد. همه با هم به سطل زباله منتقل شوند؟`,
            confirmText: 'بله، منتقل کن',
            cancelText: 'انصراف',
            danger: true
        });
        if (!ok) return;
    }
    const remove = () => {
        invalidateTaskIndex();
        if (!moveToTrashById(id)) {
            call('render');
            return;
        }
        call('render');
        call('showUndoFor', [id]);
    };
    if (el) {
        el.classList.add('removing');
        setTimeout(remove, 220);
    } else {
        remove();
    }
}

export function archiveDone() {
    let n = 0;
    const changedParents = new Set();
    state.tasks.forEach(t => {
        if (t.kind === 'plan') {
            let planChanged = false;
            (t.children || []).forEach(c => {
                if (c.completed && !c.archived) {
                    c.archived = true;
                    n++;
                    planChanged = true;
                }
            });
            if (planChanged) changedParents.add(t);
        } else if (t.completed && !t.archived) {
            t.archived = true;
            n++;
            changedParents.add(t);
        }
    });
    if (!n) return;

    // ✅ incremental: فقط والدهای تغییر یافته ذخیره می‌شوند
    if (useIDB) {
        changedParents.forEach(t => saveTask(t));
    } else {
        saveTasks();
    }
    call('render');
}

export async function clearCompleted() {
    const ids = [];
    state.tasks.forEach(t => {
        if (t.kind === 'plan') (t.children || []).forEach(c => { if (c.completed && !c.archived) ids.push(c.id); });
        else if (t.completed && !t.archived) ids.push(t.id);
    });
    if (ids.length === 0) return;
    const ok = await invoke('showConfirmModal', {
        title: 'پاک کردن انجام‌شده‌ها',
        message: `${toFa(ids.length)} وظیفه انجام‌شده به سطل زباله منتقل شود؟`,
        confirmText: 'بله، منتقل کن',
        cancelText: 'انصراف',
        danger: true
    });
    if (!ok) return;
    // moveToTrashById خودش deleteTaskFromStore می‌کند
    ids.forEach(moveToTrashById);
    call('render');
    call('showUndoFor', ids);
}

// ═══════════════════════════════════════════════════════════════════════════
// Templates
// ═══════════════════════════════════════════════════════════════════════════

export const PLAN_TEMPLATES = [
    { id: 'travel', title: '✈️ سفر', children: ['بررسی تاریخ و ساعت حرکت', 'بررسی مدارک شناسایی', 'بررسی بلیت و رزرو محل اقامت', 'بررسی شارژر موبایل و کابل‌ها', 'شارژ پاوربانک', 'آماده کردن داروهای ضروری', 'آماده کردن لباس‌های مناسب مقصد و آب‌وهوا', 'آماده کردن لوازم بهداشتی', 'بررسی پول نقد و کارت‌های بانکی', 'بررسی وسایل ضروری شخصی', 'شارژ کامل موبایل', 'بررسی خانه قبل از خروج'] },
    { id: 'road-trip', title: '🚗 سفر با خودرو', children: ['بررسی روغن موتور', 'بررسی آب و مایعات خودرو', 'بررسی فشار و سلامت لاستیک‌ها', 'بررسی لاستیک زاپاس', 'بررسی ترمزها', 'بررسی چراغ‌ها و راهنماها', 'بررسی برف‌پاک‌کن و شیشه‌شوی', 'بررسی باتری', 'بررسی مدارک خودرو', 'آماده کردن جعبه ابزار', 'آماده کردن تجهیزات اضطراری', 'شارژ موبایل و پاوربانک'] },
    { id: 'moving', title: '🏠 اسباب‌کشی', children: ['تعیین تاریخ اسباب‌کشی', 'هماهنگی خودرو یا باربری', 'تهیه کارتن و لوازم بسته‌بندی', 'جمع‌آوری وسایل غیرضروری', 'بسته‌بندی اتاق‌ها', 'بسته‌بندی وسایل آشپزخانه', 'بسته‌بندی وسایل شکستنی', 'آماده کردن مدارک و وسایل ارزشمند', 'بررسی وضعیت خانه جدید', 'هماهنگی آب، برق، گاز و اینترنت', 'انتقال وسایل', 'بررسی خانه قدیمی پس از تخلیه'] },
    { id: 'cleaning', title: '🧹 خانه‌تکانی', children: ['مرتب کردن وسایل اضافی', 'دور ریختن وسایل غیرقابل استفاده', 'تمیز کردن آشپزخانه', 'تمیز کردن یخچال', 'تمیز کردن اجاق و فر', 'تمیز کردن سرویس‌های بهداشتی', 'گردگیری اتاق‌ها', 'تمیز کردن پنجره‌ها', 'جارو و شست‌وشوی کف', 'مرتب کردن کمدها', 'شست‌وشوی ملحفه‌ها و پرده‌ها', 'جمع‌آوری و مرتب کردن وسایل نهایی'] },
    { id: 'shopping', title: '🛒 خرید ماهانه', children: ['بررسی موجودی مواد غذایی', 'بررسی مواد شوینده', 'بررسی لوازم بهداشتی', 'بررسی اقلام مصرفی خانه', 'تهیه فهرست خرید', 'بررسی بودجه خرید', 'خرید اقلام ضروری', 'بررسی اقلام خریداری‌شده', 'مرتب کردن خریدها در خانه'] },
    { id: 'doctor', title: '🩺 مراجعه به پزشک', children: ['انتخاب پزشک', 'گرفتن نوبت', 'ثبت تاریخ و ساعت مراجعه', 'ثبت آدرس مطب', 'آماده کردن مدارک لازم', 'آماده کردن فهرست داروهای مصرفی', 'یادداشت سؤال‌ها و موارد مهم', 'همراه داشتن نتایج آزمایش‌ها و مدارک پزشکی مرتبط', 'تنظیم یادآور مراجعه', 'ثبت توصیه‌ها و اقدامات بعد از مراجعه'] },
    { id: 'exam', title: '📚 آمادگی برای امتحان', children: ['مشخص کردن تاریخ امتحان', 'جمع‌آوری منابع', 'مشخص کردن فصل‌های مورد مطالعه', 'برنامه‌ریزی مطالعه', 'مطالعه مباحث اصلی', 'مرور یادداشت‌ها', 'حل تمرین‌ها', 'حل نمونه سؤال', 'بررسی اشتباهات', 'مرور نهایی', 'آماده کردن وسایل روز امتحان'] },
    { id: 'party', title: '🎉 برگزاری مهمانی', children: ['تعیین تاریخ و ساعت', 'تهیه فهرست مهمانان', 'اطلاع دادن به مهمانان', 'تعیین منوی غذا', 'تهیه فهرست خرید', 'خرید مواد موردنیاز', 'آماده کردن خانه', 'آماده کردن غذا', 'آماده کردن پذیرایی', 'مرتب کردن خانه بعد از مهمانی'] }
];

export function blankTask(text) {
    return {
        id: uid(),
        text: text.slice(0, MAX_LENGTH),
        completed: false,
        completedAt: null,
        priority: 'medium',
        createdAt: new Date().toISOString(),
        description: '',
        phone: '',
        address: '',
        url: '',
        kind: 'task',
        children: [],
        pinned: false,
        recur: 'none',
        timeSpent: 0,
        timerStartedAt: null,
        sessions: [],
        location: null,
        photos: []
    };
}

export function createPlanCustom(name, kids, opts) {
    const title = String(name || '').trim().replace(/\s+/g, ' ').slice(0, MAX_LENGTH);
    if (!title) return null;
    const g = blankTask(title);
    g.kind = 'plan';
    g.children = (kids || []).filter(k => k && k.trim()).map(k => blankTask(k.trim().slice(0, MAX_LENGTH)));
    g.startAt = opts && opts.startAt ? opts.startAt : null;
    g.endAt = opts && opts.endAt ? opts.endAt : null;
    state.tasks.unshift(g);
    state.expandedPlans.add(String(g.id));
    state.justAddedId = g.id;

    // ✅ incremental: ذخیره‌ی برنامه‌ی جدید (شامل فرزندان)
    saveTask(g);

    call('render');
    return g.id;
}

export function addChild(gid) {
    const g = state.tasks.find(t => String(t.id) === String(gid) && t.kind === 'plan');
    if (!g) return;
    const taskList = document.getElementById('taskList');
    const item = taskList ? taskList.querySelector(`.task-item[data-id="${gid}"]`) : null;
    const inp = item ? item.querySelector('.child-input') : null;
    const prio = item ? item.querySelector('.child-prio') : null;
    const text = inp ? inp.value.trim().replace(/\s+/g, ' ') : '';
    if (!text) {
        if (inp) {
            inp.focus();
            inp.classList.remove('input-error');
            void inp.offsetWidth;
            inp.classList.add('input-error');
        }
        return;
    }
    state.justAddedId = uid();
    g.children.unshift({
        id: state.justAddedId,
        text: text.slice(0, MAX_LENGTH),
        completed: false,
        priority: prio && ['high', 'medium', 'low'].includes(prio.value) ? prio.value : 'medium',
        createdAt: new Date().toISOString(),
        description: '',
        phone: '',
        address: '',
        url: '',
        kind: 'task',
        children: [],
        sessions: (state.childDrafts[gid] || []).map(s => ({ ...s })),
        location: null
    });
    state.childDrafts[gid] = [];

    // ✅ incremental: ذخیره‌ی والد (که فرزند جدید را در خود دارد)
    saveTask(g);

    call('render');
    const ni = taskList ? taskList.querySelector(`.task-item[data-id="${gid}"] .child-input`) : null;
    if (ni) ni.focus();
}

// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ گام ۱۵: SHIM‌ها حذف شدند
// ═══════════════════════════════════════════════════════════════════════════