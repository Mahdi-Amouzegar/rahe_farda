// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/tasks/composer.js -- نقطه‌ی ورود واحد ساخت/ویرایش وظیفه (تک‌صفحه)
//
// ⚠️ کامپوزر وظایف شخصی برای هر سه مقصد استفاده می‌شود:
//   local → addTask موجود (بدون تغییر رفتار)
//   peer  → POST /api/dm/tasks با payload کامل تسک
//   group → صف آفلاین گروه (enqueue + flush) با همان payload
// ⚠️ payload ریموت = همان آبجکت تسک محلی (سریال‌شده) تا همان کارت/فیلتر کار کند.
// ⚠️ ویرایش/حذف فقط تسک خودی؛ دیگران read-only (گیت در dispatcher اپ).
// ═══════════════════════════════════════════════════════════════════════════

import { addTask, buildTaskFromComposer, resetComposerForm } from '../store.js';
import { getDestination, setDestination } from './destination.js';
import { refreshSharedList, getSharedItem } from './source.js';
import { createDmTask, updateDmTask, deleteDmTask, markDmRead, getDmUnread } from '../communication/dm-tasks.js';
import { enqueueGroupOp, flushGroup } from '../communication/group-queue.js';
import { updateDrawerBadges } from '../navigation/sidebar.js';
import { apiFetch } from '../api.js';

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
            const input = document.getElementById('taskInput');
            if (input) {
                input.setAttribute('aria-invalid', 'true');
                try {
                    const { apiErrorMessage } = await import('../api.js');
                    input.title = apiErrorMessage(res.error);
                } catch { /* silent */ }
            }
            return res;
        }
    } else if (dest.type === 'group') {
        await enqueueGroupOp(dest.groupId, 'save', task.id, { kind: 'task', payload: task });
        try {
            await flushGroup(dest.groupId);
        } catch { /* آفلاین: pending می‌ماند */ }
    }
    resetComposerForm();
    const { render } = await import('../ui.js');
    await refreshSharedList();
    render();
    return { ok: true };
}

/**
 * ویرایش عنوان تسک خودی در نمای مشترک (inline-edit موجود همین را صدا می‌زند).
 */
export async function updateSharedTaskText(remoteId, title) {
    const item = getSharedItem(remoteId);
    if (!item || !item._shared || !item._shared.mine) return { ok: false };
    const dest = item._shared.dest;
    const next = { ...stripShared(item), text: String(title).slice(0, 200) };
    return writeSharedTask(dest, remoteId, next);
}

/**
 * تاگل تسک خودی در نمای مشترک.
 */
export async function toggleSharedTask(remoteId) {
    const item = getSharedItem(remoteId);
    if (!item || !item._shared || !item._shared.mine) return { ok: false };
    const dest = item._shared.dest;
    const completed = !item.completed;
    const next = {
        ...stripShared(item),
        completed,
        completedAt: completed ? new Date().toISOString() : null,
    };
    return writeSharedTask(dest, remoteId, next);
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

function stripShared(item) {
    const clean = { ...item };
    delete clean._shared;
    return clean;
}

async function writeSharedTask(dest, remoteId, taskObj) {
    if (dest.type === 'peer') {
        return updateDmTask(remoteId, taskObj);
    }
    if (dest.type === 'group') {
        await enqueueGroupOp(dest.groupId, 'save', remoteId, { kind: 'task', payload: taskObj });
        try {
            await flushGroup(dest.groupId);
        } catch { /* آفلاین */ }
        return { ok: true };
    }
    return { ok: false };
}
/**
 * ثبت خواندن مقصد جاری + تازه‌سازی بج دراور.
 */
export async function markDestinationRead() {
    const dest = getDestination();
    try {
        if (dest.type === 'peer') {
            await markDmRead(dest.peerId);
            const u = await getDmUnread();
            updateDrawerBadges({ messages: u.ok ? u.unread.total || 0 : 0 });
        } else if (dest.type === 'group') {
            await apiFetch('/api/groups/' + encodeURIComponent(dest.groupId) + '/read', {
                method: 'POST',
                body: { type: 'all' },
            });
        }
    } catch { /* best-effort */ }
}

/**
 * انتخاب مقصد مشترک از دراور (صفحه عوض نمی‌شود — همان چیدمان وظایف شخصی).
 * @returns مقصد نرمال‌شده
 */
export async function selectDestination(dest) {
    const norm = setDestination(dest);
    const { render, resetRenderSignature } = await import('../ui.js');
    resetRenderSignature();
    await refreshSharedList();
    render();
    await markDestinationRead();
    return norm;
}

/**
 * بازگشت به وظایف شخصی.
 */
export async function resetToLocal() {
    const { render, resetRenderSignature } = await import('../ui.js');
    setDestination({ type: 'local' });
    resetRenderSignature();
    await refreshSharedList();
    render();
}
