// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/tasks/list.js -- لیست دوحالته واحد (Phase 9 قدم ۱)
//
// ⚠️ قرارداد UI-SHELL §۶.۲ / §۱۳.۲:
//   - شخصی: فقط آیتم‌های من (وضع موجود، بدون تغییر)
//   - پیام: من + همان یک مخاطب (سمت مقابل، رنگ متفاوت)
//   - گروه: من + همه اعضای دیگر (هر آیتم دیگران با آواتار+نام فرستنده)
//   - ویرایش: فقط مال خود (دقیقاً مثل شخصی)؛ بقیه read-only
//   - این ماژول pure است: فقط DOM API و textContent در رندر (بدون تزریق رشته به درخت).
// ═══════════════════════════════════════════════════════════════════════════

/**
 * شناسه‌ی سازنده/فرستنده با تحمل هر دو شکل فرانت و بک‌اند.
 */
export function ownerIdOf(task) {
    if (!task || typeof task !== 'object') return null;
    return (
        task.creatorId ??
        task.creator_id ??
        task.ownerId ??
        task.owner_id ??
        task.senderId ??
        task.sender_id ??
        null
    );
}

/**
 * آیا این آیتم مال من است؟ مقایسه‌ی رشته‌ای سخت‌گیرانه.
 */
export function isMine(task, myId) {
    if (!myId) return false;
    const owner = ownerIdOf(task);
    return owner !== null && String(owner) === String(myId);
}

/**
 * فقط مال خود قابل ویرایش است (ماتریس §۱۰ ARCH).
 */
export function canEdit(task, myId) {
    return isMine(task, myId);
}

/**
 * سمت چسبندگی منطقی (نه فیزیکی): 'self' | 'other'.
 * نگاشت به راست/چپ با CSS logical در قدم ۲/۳ انجام می‌شود.
 */
export function sideFor(task, myId) {
    return isMine(task, myId) ? 'self' : 'other';
}

/**
 * تقسیم ترتیب‌دار به دو سطل mine/other.
 */
export function splitTwoState(items, myId) {
    const mine = [];
    const other = [];
    for (const item of items || []) {
        if (isMine(item, myId)) mine.push(item);
        else other.push(item);
    }
    return { mine, other };
}

/**
 * نام نمایشی فرستنده برای بج «از: نام» در گروه.
 * هرگز رشته‌ی خام برنمی‌گرداند مگر از خود آبجکت (رندر با textContent).
 */
export function senderLabel(task) {
    if (!task || typeof task !== 'object') return '…';
    const named = task.displayName || task.senderName || task.fromName || task.username || task.senderUsername;
    if (named) return named;
    const fallbackId = task.sender_id || task.creator_id || task.id;
    if (fallbackId) return String(fallbackId).slice(0, 8);
    return '…';
}
