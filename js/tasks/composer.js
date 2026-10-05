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
} from './source.js';
import { createDmTask } from '../communication/dm-tasks.js';
import { enqueueGroupOp, flushGroup } from '../communication/group-queue.js';
import { apiFetch, apiErrorMessage } from '../api.js';
import { showToast } from '../ui.js';
import { t as i18nT } from '../i18n.js';
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
        const res = await createDmTask(dest.peerId, task);
        if (!res.ok) {
            const msg = apiErrorMessage(res.error);
            const input = document.getElementById('taskInput');
            if (input) {
                input.setAttribute('aria-invalid', 'true');
                input.title = msg;
            }
            showToast(msg);
            return res;
        }
    } else if (dest.type === 'group') {
        await enqueueGroupOp(dest.groupId, 'save', task.id, { kind: 'task', payload: task });
        try {
            const fr = await flushGroup(dest.groupId);
            if (fr && fr.failed > 0) {
                showToast(i18nT('errors.saveFailed'));
                return { ok: false };
            }
        } catch { /* آفلاین: pending می‌ماند */ }
    }
    resetComposerForm();
    const { render } = await import('../ui.js');
    await refreshSharedList();
    render();
    return { ok: true };
}

/**
 * باز کردن جزئیات تسک خودیِ مشترک (پل زنده زیر دست detail).
 * دیگران: false (read-only می‌ماند).
 */
export async function openSharedDetail(remoteId) {
    const item = getSharedItem(remoteId);
    if (!item || !item._shared || !item._shared.mine) return false;
    if (!setDetailBridge(item)) return false;
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
