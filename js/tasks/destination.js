// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/tasks/destination.js -- مقصد ذخیره‌سازی کامپوزر واحد (Phase 9 قدم ۱)
//
// ⚠️ قرارداد UI-SHELL §۱۳.۲ / §۶.۱:
//   - هر سه فضا دقیقاً همان کامپوزر را رندر می‌کنند؛ فقط «مقصد» فرق می‌کند:
//     local (شخصی) / peer (پیام DM) / group (گروه)
//   - قدم ۱: فقط local فعال است. peer/group تا قدم ۱.۵ (بک‌اند scope=dm)
//     عمداً NOT_READY می‌دهند تا کسی روی endpoint منسوخ سوار نشود.
//   - این ماژول pure است (بدون DOM) تا unit-test پذیر بماند.
// ═══════════════════════════════════════════════════════════════════════════

export const DESTINATIONS = ['local', 'peer', 'group'];

/**
 * نرمال‌سازی مقصد.
 * ورودی: 'local' | { type:'local' } | { type:'peer', peerId } | { type:'group', groupId }
 * خروجی: آبجکت نرمال { type, peerId?, groupId? }
 * خطا: Error با code='BAD_DESTINATION' برای ورودی نامعتبر.
 */
export function normalizeDestination(dest) {
    if (dest === undefined || dest === null) return { type: 'local' };
    if (typeof dest === 'string') {
        if (dest === 'local') return { type: 'local' };
        const err = new Error('unsupported string destination until backend 1.5');
        err.code = 'NOT_READY_UNTIL_1_5';
        throw err;
    }
    if (typeof dest !== 'object' || typeof dest.type !== 'string') {
        const err = new Error('bad destination');
        err.code = 'BAD_DESTINATION';
        throw err;
    }
    if (dest.type === 'local') return { type: 'local' };
    if (dest.type === 'peer') {
        if (typeof dest.peerId !== 'string' || !dest.peerId) {
            const err = new Error('peer destination needs peerId');
            err.code = 'BAD_DESTINATION';
            throw err;
        }
        return { type: 'peer', peerId: dest.peerId };
    }
    if (dest.type === 'group') {
        if (typeof dest.groupId !== 'string' || !dest.groupId) {
            const err = new Error('group destination needs groupId');
            err.code = 'BAD_DESTINATION';
            throw err;
        }
        return { type: 'group', groupId: dest.groupId };
    }
    const err = new Error('unknown destination type');
    err.code = 'BAD_DESTINATION';
    throw err;
}

export function isLocalDestination(dest) {
    return normalizeDestination(dest).type === 'local';
}
