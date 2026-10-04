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

// ═══════════════════════════════════════════════════════════════════════════
// مقصد جاری صفحه‌ی اصلی (تک‌صفحه: وظایف من / مخاطب / گروه)
// ═══════════════════════════════════════════════════════════════════════════

let _current = { type: 'local' };
const _listeners = new Set();

/**
 * مقصد جاری (همیشه نرمال‌شده + name نمایشی اختیاری).
 */
export function getDestination() {
    return _current;
}

export function isLocalView() {
    return _current.type === 'local';
}

/**
 * ست کردن مقصد + خبر به شنونده‌ها (رندر/بج/هدر).
 * name فقط نمایشی است (در API فرستاده نمی‌شود).
 */
export function setDestination(dest) {
    const norm = normalizeDestination(dest);
    _current = dest && typeof dest === 'object' && typeof dest.name === 'string'
        ? { ...norm, name: dest.name }
        : norm;
    for (const fn of _listeners) {
        try { fn(_current); } catch { /* silent */ }
    }
    return _current;
}

export function onDestinationChange(fn) {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
}

// ⚠️ فقط برای تست
export function __resetDestinationForTest() {
    _current = { type: 'local' };
    _listeners.clear();
}
