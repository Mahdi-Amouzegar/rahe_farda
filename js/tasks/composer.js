// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/tasks/composer.js -- نقطه‌ی ورود واحد ساخت وظیفه (Phase 9 قدم ۱)
//
// ⚠️ قرارداد UI-SHELL §۶.۱ / §۱۳.۲:
//   - هر سه فضا همین نقطه را صدا می‌زنند؛ فقط destination فرق می‌کند.
//   - قدم ۱: مسیر local دقیقاً به رفتار فعلی (store.addTask) delegate می‌کند —
//     بدون هیچ تغییر رفتار در وظایف شخصی (فریز).
//   - peer/group تا قدم ۱.۵ (migration بک‌اند scope=dm) عمداً خطای
//     NOT_READY_UNTIL_1_5 می‌دهند تا قدم ۲ روی API جدید سوار شود،
//     نه روی endpointهای منسوخ پیام متنی.
// ═══════════════════════════════════════════════════════════════════════════

import { normalizeDestination } from './destination.js';
import { addTask } from '../store.js';

/**
 * ساخت وظیفه از کامپوزر واحد.
 * @param {string} [kind] - 'task' | 'plan' | 'series' (مثل رفتار فعلی)
 * @param {string|object} [destination] - پیش‌فرض local
 */
export function submitTask(kind, destination) {
    const dest = normalizeDestination(destination);
    if (dest.type === 'local') {
        return addTask(kind);
    }
    const err = new Error('destination not ready until backend 1.5');
    err.code = 'NOT_READY_UNTIL_1_5';
    err.destination = dest;
    throw err;
}
