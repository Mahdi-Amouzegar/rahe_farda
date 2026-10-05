// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/tasks/readtrack.js -- خواندن تدریجی با اسکرول در نمای مشترک
//
//   - آیتم مخاطب که «کاملاً» داخل کادر لیست قرار گرفت (یا از قاب بلندتر است و قاب را پوشانده)
//     خوانده حساب می‌شود؛ cursor فقط جلو می‌رود (هرگز عقب‌گرد ندارد)
//   - ثبت با at=بیشترین updatedAt دیده‌شده (debounce)؛ آفلاین رد می‌شود و بعداً retry می‌شود
//   - بعد از هر ثبت، شمارش مقصد تازه و هدر/بج به‌روز می‌شود
// ═══════════════════════════════════════════════════════════════════════════

import { apiFetch } from '../api.js';
import { state } from '../core.js';
import { isOnline } from '../net.js';
import { getDestination } from './destination.js';
import { getSharedItems } from './source.js';
import { markDmRead } from '../communication/dm-tasks.js';
import { updateDrawerBadges } from '../navigation/sidebar.js';

let _sentCursor = '';
let _checkQueued = false;
let _scrollBound = false;

function scroller() {
    return document.getElementById('taskList');
}

/**
 * آیا کارت کاملاً داخل قاب اسکرول است (یا از قاب بلندتر و آن را پوشانده)؟
 */
export function isFullyVisible(card, box) {
    try {
        if (!card || !box) return false;
        const r = card.getBoundingClientRect();
        const b = box.getBoundingClientRect();
        if (r.height <= 0 || b.height <= 0) return false;
        const covers = r.top <= b.top && r.bottom >= b.bottom;
        const inside = r.top >= b.top && r.bottom <= b.bottom;
        return covers || inside;
    } catch {
        return false;
    }
}

/**
 * بیشترین updatedAt آیتم‌های مخاطبِ دیده‌شده که از cursor جلوتر است.
 * @returns {string|null}
 */
export function maxNewlyRead(items, visibleIds, cursor) {
    let best = null;
    for (const t of items || []) {
        if (!t || !t._shared || t._shared.mine) continue;
        if (!visibleIds.has(String(t.id))) continue;
        const ts = String(t.updatedAt || '');
        if (!ts || ts <= String(cursor || '')) continue;
        if (best === null || ts > best) best = ts;
    }
    return best;
}

/**
 * بررسی یک‌باره‌ی دید (بعد از رندر / انتخاب مقصد).
 */
export function checkVisibleReads() {
    try {
        const dest = getDestination();
        if (!dest || dest.type === 'local') return;
        if (!isOnline()) return;
        const box = scroller();
        if (!box) return;
        const items = getSharedItems();
        if (!items || items.length === 0) return;
        const byId = new Map(items.map((t) => [String(t.id), t]));
        const visible = new Set();
        for (const card of box.querySelectorAll('.task-item[data-id]')) {
            if (isFullyVisible(card, box)) visible.add(String(card.dataset.id));
        }
        void byId;
        const upto = maxNewlyRead(items, visible, _sentCursor);
        if (upto) void advanceCursorFor(dest, upto);
    } catch { /* silent */ }
}

/**
 * ثبت cursor تا نقطه‌ی داده‌شده + تازه‌سازی شمارش.
 */
export async function advanceCursorFor(dest, upto) {
    if (!dest || dest.type === 'local' || !upto) return { ok: false };
    if (upto <= _sentCursor) return { ok: false };
    try {
        if (dest.type === 'peer' && dest.peerId) {
            const res = await markDmRead(dest.peerId, upto);
            if (!res.ok) return res;
        } else if (dest.type === 'group' && dest.groupId) {
            const res = await apiFetch('/api/groups/' + encodeURIComponent(dest.groupId) + '/read', {
                method: 'POST',
                body: { type: 'tasks', at: upto },
            });
            if (!res.ok) return res;
        } else {
            return { ok: false };
        }
    } catch {
        return { ok: false };
    }
    _sentCursor = upto;
    await refreshDestCount(dest);
    return { ok: true };
}

/**
 * شمارش تازه‌ی مقصد + به‌روزرسانی هدر و بج دراور.
 */
export async function refreshDestCount(dest) {
    const d = dest || getDestination();
    if (!d || d.type === 'local') return 0;
    try {
        if (d.type === 'peer' && d.peerId) {
            const { getDmUnread } = await import('../communication/dm-tasks.js');
            const u = await getDmUnread();
            const row = u.ok ? (u.unread.byPeer || []).find((r) => String(r.peerId) === String(d.peerId)) : null;
            const n = row ? row.count || 0 : 0;
            updateDrawerBadges({ messages: u.ok ? u.unread.total || 0 : 0 });
            updateDestHeader(n);
            return n;
        }
        if (d.type === 'group' && d.groupId) {
            const res = await apiFetch('/api/groups/' + encodeURIComponent(d.groupId) + '/unread');
            const n = res.ok ? Number((res.data && res.data.unread && res.data.unread.tasks) || 0) : 0;
            try {
                const { refreshGroupBadges } = await import('../communication/groups.js');
                await refreshGroupBadges().catch(() => {});
            } catch { /* silent */ }
            updateDestHeader(n);
            return n;
        }
    } catch { /* silent */ }
    return 0;
}

async function updateDestHeader(n) {
    try {
        const el = document.getElementById('headerContext');
        if (!el) return;
        const d = getDestination();
        if (d && d.type !== 'local' && d.name) {
            el.textContent = n > 0 ? `${d.name} (${n})` : d.name;
        }
    } catch { /* silent */ }
}

/**
 * شروع رهگیری اسکرول (idempotent؛ یک‌بار در boot).
 */
export function startReadTracking() {
    if (_scrollBound) return;
    _scrollBound = true;
    const box = scroller();
    if (box) {
        box.addEventListener('scroll', queueVisibleCheck, { passive: true });
    }
}

function queueVisibleCheck() {
    if (_checkQueued) return;
    _checkQueued = true;
    const run = () => {
        _checkQueued = false;
        checkVisibleReads();
    };
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(run);
    } else {
        setTimeout(run, 100);
    }
}

/**
 * ریست cursor (هنگام تعویض مقصد).
 */
export function resetReadCursor() {
    _sentCursor = '';
}

// ⚠️ فقط برای تست
export function __setSentCursorForTest(v) {
    _sentCursor = v || '';
}
export function __getSentCursorForTest() {
    return _sentCursor;
}
