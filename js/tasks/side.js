// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/tasks/side.js — «سمت» کارت وظیفه (نوار رنگی اولویت) — خالص و تست‌پذیر
//
// ⚠️ قاعده‌ی محصول (10.26 / 10.27):
//   - هر چیزی که «از طرف خودمان» است (وظایف شخصی + پیام‌های ارسالی ما در
//     DM/گروه) نوار را سمت راست می‌گیرد → `side-own`.
//   - فقط آیتم‌های دیگران در نمای مشترک نوار سمت چپ می‌گیرند → `shared-other`.
//   - حاشیه‌ی ۶ پیکسلی تفکیک دو طرف فقط مخصوص نمای مشترک است (`shared-mine`).
//
// چرا خالص شد: تصمیم «سمت» فقط به دو ورودی وابسته است و باید unit-test شود؛
// در ui.js این تصمیم با `isLocalView()` و `task._shared.mine` گرفته می‌شود.

/**
 * کلاس(های) سمت کارت.
 *
 * @param {{ local: boolean, mine: boolean }} ctx
 *   local — نمای «وظایف من» است؟
 *   mine  — آیتم نمای مشترک متعلق به خود کاربر است؟
 * @returns {string} '' یا ' side-own' یا ' shared-mine' یا ' shared-other'
 */
export function sideClassFor(ctx) {
    const local = !!(ctx && ctx.local);
    const mine = !!(ctx && ctx.mine);
    if (local) return ' side-own';
    return mine ? ' shared-mine' : ' shared-other';
}
