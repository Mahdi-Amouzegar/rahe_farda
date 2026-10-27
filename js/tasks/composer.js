// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/tasks/composer.js -- نقطه‌ی ورود واحد ساخت/ویرایش وظیفه (تک‌صفحه)
//
// ⚠️ کامپوزر وظایف شخصی برای هر سه مقصد استفاده می‌شود:
//   local → addTask موجود (بدون تغییر رفتار)
//   peer  → POST /api/dm/tasks با payload کامل تسک
//   group → صف آفلاین گروه (enqueue + flush) با همان payload
// ⚠️ payload ریموت = همان آبجکت تسک محلی (سریال‌شده) تا همان کارت/فیلتر کار کند.
// ⚠️ نوشتن روی مقصد در source.js است (بدون چرخه‌ی import با store)؛ اینجا re-export می‌شود.
// ═══════════════════════════════════════════════════════════════════════════

import { addTask, buildTaskFromComposer, resetComposerForm } from '../store.js';
import { getDestination, setDestination } from './destination.js';
import {
    refreshSharedList,
    updateSharedTaskText,
    toggleSharedTask,
    deleteSharedTask,
    setDetailBridge,
    getSharedItem,
    getSharedTaskDeep,
    addOptimisticSharedItem,
    stripSharedPayload,
} from './source.js';
import { enqueueDmOp, flushDmQueue } from '../communication/dm-queue.js';
import { getDmUnread } from '../communication/dm-tasks.js';
import { enqueueGroupOp, flushGroup } from '../communication/group-queue.js';
import { apiFetch } from '../api.js';
import { refreshDestBanner, hideDestBanner } from './banner.js';

export {
    refreshSharedList,
    getSharedItem,
    updateSharedTaskText,
    toggleSharedTask,
    deleteSharedTask,
};

/**
 * ساخت وظیفه از کامپوزر واحد (مقصد = جاری صفحه).
 *
 * ⚠️ 10.40 (آفلاین‌فرست):
 *   - DM و گروه هر دو اول در **صف** می‌نشینند، بعد در لیست **همان لحظه**
 *     نمایش داده می‌شوند (خوش‌بینانه) و ارسال در پس‌زمینه انجام می‌شود.
 *   - اگر شبکه نبود، هیچ پیام خطایی نمی‌آید؛ آیتم با پرچم pending می‌ماند و
 *     در اولین فرصت (آنلاین‌شدن یا flush بعدی) به سرور می‌رود.
 *   - فقط ردِ دائمی سرور (بلاک/سقف اولین تماس) در `source.js` به کاربر
 *     اطلاع داده می‌شود و ردیف خوش‌بینانه حذف می‌شود.
 */
export async function submitTask(kind) {
    const dest = getDestination();
    if (dest.type === 'local') {
        return addTask(kind);
    }
    const built = buildTaskFromComposer(kind);
    if (!built) return;
    const { task } = built;

    if (dest.type === 'peer') {
        await enqueueDmOp(dest.peerId, 'create', task.id, {
            kind: 'task',
            payload: stripSharedPayload(task, dest),
        });
        addOptimisticSharedItem(task, dest);
        flushDmQueue(dest.peerId)
            .then((r) => { if (r && r.flushed > 0) syncAfterFlush(); })
            .catch(() => {});
    } else if (dest.type === 'group') {
        await enqueueGroupOp(dest.groupId, 'save', task.id, {
            kind: 'task',
            payload: stripSharedPayload(task, dest),
        });
        addOptimisticSharedItem(task, dest);
        flushGroup(dest.groupId)
            .then((fr) => { if (fr && fr.flushed > 0) syncAfterFlush(); })
            .catch(() => {});
    }

    resetComposerForm();
    const { render } = await import('../ui.js');
    await refreshSharedList();
    render();
    return { ok: true, queued: true };
}

/**
 * بعد از flush موفق: لیست را با حقیقت سرور تطبیق بده (idهای سروری، revision).
 */
async function syncAfterFlush() {
    try {
        const { render } = await import('../ui.js');
        await refreshSharedList();
        render();
    } catch { /* best-effort */ }
}

/**
 * باز کردن جزئیات تسک مشترک (پل زنده زیر دست detail).
 *
 * ⚠️ 10.25: برای آیتم **دیگران** هم باز می‌شود، ولی در حالت «فقط خواندنی»
 * (`readOnly`) — صفحه پر می‌شود، همه‌ی ورودی‌ها قفل و دکمه‌های ویرایش/حذف
 * پنهان می‌شوند؛ پیش‌نمایش و دانلود عکس باقی می‌ماند.
 * زیرکار برنامه هم پشتیبانی می‌شود (`childId`).
 *
 * @param {string} remoteId
 * @returns {Promise<boolean>}
 */
export async function openSharedDetail(remoteId) {
    const hit = getSharedTaskDeep(remoteId);
    if (!hit || !hit.item._shared) return false;
    const mine = Boolean(hit.item._shared.mine);
    if (!setDetailBridge(hit.item, { readOnly: !mine, childId: hit.childId })) return false;
    const { openDetail } = await import('../detail.js');
    openDetail(remoteId);
    return true;
}

/**
 * انتخاب مقصد مشترک از دراور (صفحه عوض نمی‌شود — همان چیدمان وظایف شخصی).
 * خواندن با دید تدریجی است (نه mark-all): بعد از رندر، دیده‌شده‌ها ثبت می‌شوند.
 * @returns مقصد نرمال‌شده
 */
export async function selectDestination(dest) {
    const norm = setDestination(dest);
    const { render, resetRenderSignature } = await import('../ui.js');
    const { resetReadCursor, refreshDestCount } = await import('./readtrack.js');
    resetRenderSignature();
    resetReadCursor();
    await refreshSharedList();
    render();
    await refreshDestBanner();
    await scrollToFirstUnread(norm);
    try {
        await refreshDestCount(norm);
    } catch { /* silent */ }
    return norm;
}

/**
 * اسکرول به اولین پیام خوانده‌نشده‌ی مخاطب (نه آخرین پیام).
 */
async function scrollToFirstUnread(dest) {
    try {
        if (!dest || dest.type === 'local') return;
        let cursor = null;
        if (dest.type === 'peer' && dest.peerId) {
            const u = await getDmUnread();
            const row = u.ok ? (u.unread.byPeer || []).find((r) => String(r.peerId) === String(dest.peerId)) : null;
            cursor = (row && row.lastReadAt) || null;
        } else if (dest.type === 'group' && dest.groupId) {
            const res = await apiFetch('/api/groups/' + encodeURIComponent(dest.groupId) + '/unread');
            cursor = (res.ok && res.data && res.data.unread && res.data.unread.lastReadAt) || null;
        }
        if (!cursor) return;
        const { getSharedItems } = await import('./source.js');
        const byId = new Map(getSharedItems().map((t) => [String(t.id), t]));
        const list = document.getElementById('taskList');
        if (!list) return;
        const cards = [...list.querySelectorAll('.task-item[data-id]')];
        for (let i = cards.length - 1; i >= 0; i--) {
            const t = byId.get(String(cards[i].dataset.id));
            if (!t || (t._shared && t._shared.mine)) continue;
            if (String(t.updatedAt || '') > String(cursor)) {
                try {
                    cards[i].scrollIntoView({ block: 'center' });
                } catch { /* silent */ }
                return;
            }
        }
    } catch { /* best-effort */ }
}

/**
 * بازگشت به وظایف شخصی.
 */
export async function resetToLocal() {
    const { render, resetRenderSignature } = await import('../ui.js');
    setDestination({ type: 'local' });
    hideDestBanner();
    resetRenderSignature();
    await refreshSharedList();
    render();
}
