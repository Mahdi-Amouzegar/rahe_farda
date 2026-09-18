// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// render-diff.js -- keyed diffing برای task list (ESM) — گام ۷ فاز ۴
//
// این ماژول خالص است (بدون DOM). ورودی: oldState و newState.
// خروجی: لیستی از عملیات diff که باید روی DOM اعمال شوند.
//
// ⚠️ چرا خالص؟ چون:
//   - تست‌پذیر است بدون نیاز به jsdom
//   - قابل استفاده در فاز ۵ (مثلاً برای sync آفلاین)
//   - اگر باگی داشت، در یک نقطه‌ی متمرکز رفع می‌شود
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} DiffSignature
 * @property {string} filter - currentFilter
 * @property {string} sort - currentSort
 * @property {string} search - searchQuery
 * @property {string|null} selectedDay
 * @property {string[]} pinnedIds - IDهای pinned به ترتیب
 * @property {string[]} visibleIds - IDهای قابل مشاهده به ترتیب
 * @property {string} expandedSignature - امضای expanded planها
 */

/**
 * ساخت یک امضای یکتا از state فعلی UI.
 *
 * اگر دو state مختلف امضای یکسان داشته باشند، یعنی DOM نهایی یکسان است.
 * این تابع برای تشخیص «آیا نیاز به render کامل است؟» استفاده می‌شود.
 *
 * @param {object} state - state سراسری
 * @param {string[]} visibleIds - لیست IDهای قابل مشاهده (به ترتیب نهایی)
 * @returns {string}
 */
export function buildRenderSignature(state, visibleIds) {
    const filter = state.currentFilter || 'all';
    const sort = state.currentSort || 'newest';
    const search = (state.searchQuery || '').trim();
    const selectedDay = state.selectedDay || '';
    const expanded = Array.from(state.expandedPlans || []).sort().join(',');
    const ids = (visibleIds || []).join('|');
    const editing = state.editingId || '';
    return `${filter}::${sort}::${search}::${selectedDay}::${expanded}::${ids}::${editing}`;
}

/**
 * مقایسه‌ی دو لیست از taskها و تولید لیست عملیات.
 *
 * هر عملیات یک آبجکت است با فیلد `type`:
 *   - 'reorder'   : { from, to }  — جابه‌جایی (در حال حاضر استفاده نمی‌شود)
 *   - 'add'       : { id, index }
 *   - 'remove'    : { id }
 *   - 'update'    : { id, patches: { field: newValue, ... } }
 *
 * ⚠️ محدودیت‌ها:
 *   - فقط taskهای سطح اول (task/plan) diff می‌شوند
 *   - فرزندان (children) داخل plan diff نمی‌شوند (چون پیچیده است)
 *   - اگر یک plan تغییر ساختاری داشت (expand/collapse)، به عنوان 'update' علامت‌گذاری می‌شود
 *
 * @param {object[]} oldTasks
 * @param {object[]} newTasks
 * @returns {Array<object>}
 */
export function diffTasks(oldTasks, newTasks) {
    const ops = [];
    const oldMap = new Map();
    const newMap = new Map();

    (oldTasks || []).forEach((t, i) => oldMap.set(String(t.id), { task: t, index: i }));
    (newTasks || []).forEach((t, i) => newMap.set(String(t.id), { task: t, index: i }));

    // حذف‌ها
    for (const [id] of oldMap) {
        if (!newMap.has(id)) {
            ops.push({ type: 'remove', id });
        }
    }

    // افزودن‌ها
    for (const [id, entry] of newMap) {
        if (!oldMap.has(id)) {
            ops.push({ type: 'add', id, index: entry.index });
        }
    }

    // تغییرات
    for (const [id, newEntry] of newMap) {
        const oldEntry = oldMap.get(id);
        if (!oldEntry) continue;
        const patches = diffTaskFields(oldEntry.task, newEntry.task);
        if (Object.keys(patches).length > 0) {
            ops.push({ type: 'update', id, patches });
        }
    }

    return ops;
}

/**
 * مقایسه‌ی دو task و برگرداندن فیلدهای تغییر یافته.
 *
 * فیلدهای بررسی‌شده:
 *   - text, completed, priority, pinned, archived, recur, recurN, recurDays
 *   - sessions (طول و محتوا)
 *   - children (طول و وضعیت)
 *   - photos (طول)
 *   - location (presence)
 *
 * @param {object} oldTask
 * @param {object} newTask
 * @returns {object} patches
 */
function diffTaskFields(oldTask, newTask) {
    const patches = {};

    if (oldTask.text !== newTask.text) patches.text = newTask.text;
    if (oldTask.completed !== newTask.completed) patches.completed = newTask.completed;
    if (oldTask.priority !== newTask.priority) patches.priority = newTask.priority;
    if (oldTask.pinned !== newTask.pinned) patches.pinned = newTask.pinned;
    if (oldTask.archived !== newTask.archived) patches.archived = newTask.archived;
    if (oldTask.recur !== newTask.recur) patches.recur = newTask.recur;
    if (oldTask.recurN !== newTask.recurN) patches.recurN = newTask.recurN;

    // recurDays: مقایسه آرایه
    const oldDays = (oldTask.recurDays || []).join(',');
    const newDays = (newTask.recurDays || []).join(',');
    if (oldDays !== newDays) patches.recurDays = newTask.recurDays;

    // sessions: طول
    const oldSessLen = (oldTask.sessions || []).length;
    const newSessLen = (newTask.sessions || []).length;
    if (oldSessLen !== newSessLen) patches.sessionsLength = newSessLen;

    // children: طول
    const oldChildLen = (oldTask.children || []).length;
    const newChildLen = (newTask.children || []).length;
    if (oldChildLen !== newChildLen) patches.childrenLength = newChildLen;

    // children: وضعیت completed (برای plan)
    if (newTask.kind === 'plan') {
        const oldDone = (oldTask.children || []).filter(c => c.completed).length;
        const newDone = (newTask.children || []).filter(c => c.completed).length;
        if (oldDone !== newDone) patches.childrenDone = newDone;
    }

    // photos: طول
    const oldPhotoLen = (oldTask.photos || []).length;
    const newPhotoLen = (newTask.photos || []).length;
    if (oldPhotoLen !== newPhotoLen) patches.photosLength = newPhotoLen;

    // location: presence
    const oldHasLoc = Boolean(oldTask.location);
    const newHasLoc = Boolean(newTask.location);
    if (oldHasLoc !== newHasLoc) patches.hasLocation = newHasLoc;

    return patches;
}

/**
 * تشخیص اینکه آیا یک لیست ops فقط شامل toggle/update است (بدون add/remove).
 * اگر بله، می‌توان از diffing استفاده کرد. اگر add/remove دارد،
 * ترتیب و indexها ممکن است بشکنند و بهتر است render کامل شود.
 *
 * @param {Array<object>} ops
 * @returns {boolean}
 */
export function isSafeForDiff(ops) {
    for (const op of ops) {
        if (op.type === 'add' || op.type === 'remove') return false;
        if (op.type === 'reorder') return false;
    }
    return true;
}

/**
 * خلاصه‌ی ops برای دیباگ.
 * @param {Array<object>} ops
 * @returns {string}
 */
export function summarizeOps(ops) {
    if (!ops.length) return 'no changes';
    const counts = {};
    for (const op of ops) {
        counts[op.type] = (counts[op.type] || 0) + 1;
    }
    return Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(', ');
}

// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ گام ۱۵: SHIM‌ها حذف شدند
// ═══════════════════════════════════════════════════════════════════════════