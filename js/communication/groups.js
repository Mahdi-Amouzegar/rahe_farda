// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/communication/groups.js -- لایه‌ی داده و مدیریت گروه (تک‌صفحه)
//
//   - لیست گروه‌ها + بج نخوانده + ردیف‌های دراور
//   - مودال مدیریت گروه (اعضا/دعوت/نقش/آواتار/انتقال)
//   - دیالوگ ساخت گروه (دراور + شیت ⊕)
//   - لینک دعوت + ترک/بستن/حذف + deep-link
//   - صف آفلاین تسک‌ها در group-queue.js می‌ماند
// ⚠️ نمای لیست/تایم‌لاین/تسک قدیمی حذف شد — صفحه اصلی تنها میزبان تسک‌هاست.
//    گروه local-first نیست. همه‌ی requestها فقط از js/api.js. بدون innerHTML.
// ═══════════════════════════════════════════════════════════════════════════

import { apiFetch, apiErrorMessage } from '../api.js';
import { state } from '../core.js';
import { isLoggedIn } from '../auth.js';
import { t as i18nT } from '../i18n.js';
import { isOnline } from '../net.js';
import { openMenu } from '../ui/menu.js';
import { avatarNode } from '../ui/avatar.js';
import {
    updateDrawerBadges,
    setRecentGroups,
    setGroupInvitations,
} from '../navigation/sidebar.js';
import { showInfoModal, showConfirmModal } from '../core.js';
import { displayNameOf } from './conversations.js';
import { searchUsers } from './connections.js';
import { flushGroup } from './group-queue.js';

const PAGE_LIMIT = 30;

let _groups = [];
let _openGroupId = null;
let _group = null;
let _myRole = null;
let _members = [];
let _loading = false;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
}

function tr(key, fallback) {
    const v = i18nT(key);
    return v !== key ? v : fallback;
}

// ═══════════════════════════════════════════════════════════════════════════
// Data
// ═══════════════════════════════════════════════════════════════════════════

export async function listGroups() {
    const res = await apiFetch('/api/groups');
    if (!res.ok) return res;
    _groups = (res.data && res.data.groups) || [];
    return { ok: true, groups: _groups };
}

async function fetchTimeline(groupId, cursor) {
    let path = '/api/groups/' + encodeURIComponent(groupId) + '/timeline?limit=' + PAGE_LIMIT;
    if (cursor) {
        path += '&before=' + encodeURIComponent(cursor.createdAt) + '&beforeId=' + encodeURIComponent(cursor.id);
    }
    return apiFetch(path);
}

async function fetchMembers(groupId) {
    return apiFetch('/api/groups/' + encodeURIComponent(groupId) + '/members');
}

// ═══════════════════════════════════════════════════════════════════════════
// View — list
// ═══════════════════════════════════════════════════════════════════════════

/**
 * فرم ساخت گروه تازه (فقط واردشده‌ها — فضا خودش گیت دارد).
 */
function renderMembersView(sec, opts) {
    const o = opts || {};
    const box = el('div', 'conv-box');
    // ─── فرم دعوت (فقط owner/admin) ───
    if (isManager() && _group && _group.closedAt === null) {
        const invBox = el('div', 'conv-new');
        const searchInput = el('input', 'conv-input');
        searchInput.setAttribute('placeholder', tr('conn.searchPlaceholder', '…'));
        searchInput.setAttribute('maxlength', '50');
        searchInput.setAttribute('autocomplete', 'off');
        const results = el('div', 'conv-search-results');
        invBox.appendChild(searchInput);
        invBox.appendChild(results);
        let timer = null;
        searchInput.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(async () => {
                const q = searchInput.value.trim();
                results.replaceChildren();
                if (q.length < 3) return;
                const res = await apiFetch(
                    '/api/search?q=' + encodeURIComponent(q) + '&type=user'
                );
                if (!res.ok) return;
                for (const u of (res.data && res.data.users) || []) {
                    const row = el('div', 'conv-row');
                    row.appendChild(el('span', 'conv-name', displayNameOf(u)));
                    const req = el('button', 'conv-mini-btn', tr('conn.request', 'درخواست'));
                    req.type = 'button';
                    req.addEventListener('click', async () => {
                        const r = await apiFetch(
                            '/api/groups/' + encodeURIComponent(_openGroupId) + '/invitations',
                            { method: 'POST', body: { inviteeId: u.id, type: 'invitation' } }
                        );
                        req.disabled = true;
                        req.textContent = r.ok
                            ? tr('conn.requestSent', 'فرستاده شد')
                            : apiErrorMessage(r.error);
                    });
                    const linkBtn = el('button', 'conv-mini-btn', tr('grp.inviteLinkShort', 'لینک'));
                    linkBtn.type = 'button';
                    linkBtn.addEventListener('click', () => createInviteLinkFor(u.id, linkBtn));
                    row.appendChild(req);
                    row.appendChild(linkBtn);
                    results.appendChild(row);
                }
            }, 350);
        });
        box.appendChild(invBox);
    }
    const me = myUserId();
    for (const m of _members) {
        const row = el('div', 'conv-row');
        row.appendChild(avatarNode(m.avatarUrl, m.username));
        row.appendChild(el('span', 'conv-name', m.username || String(m.userId || '').slice(0, 8)));
        row.appendChild(el('span', 'conv-role', roleLabel(m.role)));
        // ─── حذف عضو: فقط owner، نه خودش، نه مالک ───
        if (isOwner() && m.userId !== me && m.userId !== (_group && _group.ownerId)) {
            const rm = el('button', 'conv-mini-btn', tr('grp.removeMember', 'حذف'));
            rm.type = 'button';
            rm.addEventListener('click', async () => {
                const ok = await showConfirmModal({
                    title: tr('grp.removeMember', 'حذف'),
                    message: tr('grp.removeConfirm', 'این عضو حذف شود؟'),
                    confirmText: tr('conn.reject', 'رد'),
                    danger: true,
                });
                if (!ok) return;
                await apiFetch(
                    '/api/groups/' + encodeURIComponent(_openGroupId) +
                    '/members/' + encodeURIComponent(m.userId),
                    { method: 'DELETE' }
                );
                if (o && typeof o.onChanged === 'function') await o.onChanged();
            });
            row.appendChild(rm);
        }
        box.appendChild(row);
    }
    if (_members.length === 0) {
        box.appendChild(el('p', null, tr('workspace.groupsEmpty', '')));
    }
    sec.appendChild(box);
}

/**
 * بارگذاری دوباره‌ی داده‌ی گروه باز + رندر مجدد نمای اعضا (داخل مودال).
 */
async function reloadMembersInto(sec, opts) {
    if (!_openGroupId) return;
    await loadGroupData(_openGroupId);
    sec.replaceChildren();
    renderMembersView(sec, opts);
}

// ═══════════════════════════════════════════════════════════════════════════
// مودال مدیریت گروه (روی صفحه‌ی اصلی — بدون تغییر فضا)
// ═══════════════════════════════════════════════════════════════════════════

function openModalShell(titleText) {
    closeModalShell();
    const overlay = el('div', 'picker-overlay group-modal-overlay');
    overlay.id = 'groupModalOverlay';
    const box = el('div', 'picker group-modal-box');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    const head = el('div', 'picker-title-row');
    head.appendChild(el('div', 'picker-title', titleText));
    const close = el('button', 'btn-clear', '✕');
    close.type = 'button';
    close.setAttribute('aria-label', tr('common.close', 'بستن'));
    close.addEventListener('click', () => closeModalShell());
    head.appendChild(close);
    box.appendChild(head);
    const body = el('div', 'group-modal-body');
    box.appendChild(body);
    overlay.appendChild(box);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModalShell();
    });
    document.body.appendChild(overlay);
    return body;
}

export function closeModalShell() {
    const old = document.getElementById('groupModalOverlay');
    if (old && old.parentNode) old.parentNode.removeChild(old);
}

/**
 * مودال اعضا/دعوت گروه.
 */
export async function openGroupMembersModal(groupId) {
    if (!groupId) return;
    const loaded = await loadGroupData(groupId);
    if (!loaded.ok) {
        showInfoModal({
            title: tr('grp.members', 'اعضا'),
            paragraphs: [apiErrorMessage(loaded.error)],
        });
        return;
    }
    const body = openModalShell((_group && _group.name) || tr('grp.members', 'اعضا'));
    renderMembersView(body, {
        onChanged: async () => {
            await loadGroupData(groupId);
            const fresh = document.querySelector('#groupModalOverlay .group-modal-body');
            if (fresh) {
                fresh.replaceChildren();
                renderMembersView(fresh, {});
            }
        },
    });
}

/**
 * بارگذاری داده‌ی گروه (جزئیات + اعضا) بدون رندر فضا.
 */
export async function loadGroupData(groupId) {
    if (!groupId) return { ok: false };
    if (!isOnline()) return { ok: false, error: { code: 'NETWORK_ERROR' } };
    _loading = true;
    try {
        try {
            await flushGroup(groupId);
        } catch { /* best-effort */ }
        const [detailRes, memRes] = await Promise.all([
            apiFetch('/api/groups/' + encodeURIComponent(groupId)),
            apiFetch('/api/groups/' + encodeURIComponent(groupId) + '/members'),
        ]);
        if (!detailRes.ok) return detailRes;
        _openGroupId = groupId;
        _group = detailRes.data.group;
        _myRole = detailRes.data.myRole || null;
        if (memRes.ok) _members = memRes.data.members || [];
        return { ok: true };
    } finally {
        _loading = false;
    }
}

/**
 * باز کردن گروه (سازگار عقب‌رو: فقط داده + ثبت خواندن؛ بدون رندر فضا).
 */
export async function openGroup(groupId) {
    const res = await loadGroupData(groupId);
    if (!res.ok) return res;
    try {
        await markCurrentGroupRead('all');
        await refreshGroupBadges();
    } catch { /* best-effort */ }
    return { ok: true };
}

async function openTransferPicker() {
    if (!_group) return;
    const candidates = _members.filter(
        (m) => m.status === 'active' && m.userId !== _group.ownerId
    );
    if (candidates.length === 0) return;
    openMenu({
        items: candidates.map((m) => ({
            id: m.userId,
            label: m.username || String(m.userId).slice(0, 8),
        })),
        onSelect: async (newOwnerId) => {
            const ok = await showConfirmModal({
                title: tr('grp.transfer', 'انتقال مالکیت'),
                message: tr('grp.transferConfirm', 'مالکیت منتقل شود؟'),
                danger: true,
            });
            if (!ok) return;
            await apiFetch('/api/groups/' + encodeURIComponent(_openGroupId) + '/transfer', {
                method: 'POST',
                body: { newOwnerId },
            });
            if (o && typeof o.onChanged === 'function') await o.onChanged();
        },
    });
}

/**
 * منوی ⋯ یک گروه برای استفاده‌ی دراور (مدیریت همان سطح، بر اساس نقش).
 * خود نام در دراور → باز کردن گروه (از طریق onOpenGroup).
 */
export async function openGroupMenuFor(groupId, anchor) {
    if (!groupId) return;
    let detail = null;
    try {
        const res = await apiFetch('/api/groups/' + encodeURIComponent(groupId));
        if (!res.ok) return;
        detail = res.data;
    } catch {
        return;
    }
    const role = (detail && detail.myRole) || null;
    const group = (detail && detail.group) || { id: groupId };
    const owner = role === 'owner';
    const manager = owner || role === 'admin';
    const items = [
        { id: 'open', label: tr('grp.open', 'باز کردن') },
        { id: 'members', label: tr('grp.members', 'اعضا') },
    ];
    if (manager) items.push({ id: 'invite', label: tr('grp.invite', 'دعوت عضو') });
    if (owner) {
        items.push({ id: 'close', label: tr('grp.close', 'بستن گروه'), danger: true });
        items.push({ id: 'delete', label: tr('grp.delete', 'حذف گروه'), danger: true });
    } else {
        items.push({ id: 'leave', label: tr('grp.leave', 'ترک گروه'), danger: true });
    }
    openMenu({
        anchor,
        items,
        onSelect: async (id) => {
            if (id === 'open') {
                const { selectDestination } = await import('../tasks/composer.js');
                await selectDestination({ type: 'group', groupId: String(groupId), name: group.name || undefined });
            } else if (id === 'members' || id === 'invite') {
                await openGroupMembersModal(groupId);
            } else if (id === 'leave') {
                await confirmGroupLeave(groupId);
            } else if (id === 'close') {
                await confirmGroupClose(groupId);
            } else if (id === 'delete') {
                await confirmGroupDelete(groupId);
            }
        },
    });
}

/**
 * تازه‌سازی خانه‌ی گروه‌ها بعد از تغییر (لیست + بج + خروج از مقصد حذف‌شده).
 */
async function refreshGroupsHome() {
    await listGroups().catch(() => {});
    await refreshGroupBadges().catch(() => {});
    await refreshGroupInbox().catch(() => {});
    try {
        const { getDestination, setDestination } = await import('../tasks/destination.js');
        const dest = getDestination();
        if (dest.type === 'group') {
            const gone = !(_groups || []).some((g) => String(g.id) === String(dest.groupId));
            if (gone) {
                const { resetToLocal } = await import('../tasks/composer.js');
                await resetToLocal();
                return;
            }
            const { refreshSharedList } = await import('../tasks/source.js');
            const { render } = await import('../ui.js');
            await refreshSharedList();
            render();
        }
    } catch { /* best-effort */ }
}

async function confirmGroupClose(forId) {
    const targetId = forId || _openGroupId;
    if (!targetId && !_group) return;
    const ok = await showConfirmModal({
        title: tr('grp.close', 'بستن گروه'),
        message: tr('grp.closeConfirm', 'گروه بسته و تسک‌هایش حذف می‌شوند. ادامه؟'),
        danger: true,
    });
    if (!ok) return;
    await apiFetch('/api/groups/' + encodeURIComponent(targetId) + '/close', { method: 'POST' });
    if (targetId === _openGroupId) _openGroupId = null;
    await refreshGroupsHome();
}

async function confirmGroupLeave(forId) {
    const targetId = forId || _openGroupId;
    if (!targetId) return;
    const ok = await showConfirmModal({
        title: tr('grp.leave', 'ترک گروه'),
        message: tr('grp.leaveConfirm', 'از این گروه خارج می‌شوی؟'),
        danger: true,
    });
    if (!ok) return;
    const res = await apiFetch('/api/groups/' + encodeURIComponent(targetId) + '/leave', {
        method: 'POST',
    });
    if (!res.ok) {
        showInfoModal({ title: tr('grp.leave', 'ترک گروه'), paragraphs: [apiErrorMessage(res.error)] });
        return;
    }
    if (targetId === _openGroupId) _openGroupId = null;
    await refreshGroupsHome();
}

/**
 * ساخت گروه تازه (نام + عمومی/خصوصی).
 * @returns {ok, group?, error?}
 */
export async function createGroup({ name, visibility }) {
    const clean = String(name || '').trim().slice(0, 100);
    if (!clean) return { ok: false, error: { code: 'BAD_REQUEST' } };
    const vis = visibility === 'public' ? 'public' : 'private';
    const res = await apiFetch('/api/groups', {
        method: 'POST',
        body: { name: clean, visibility: vis },
    });
    if (!res.ok || !res.data || !res.data.group) return res;
    try {
        await listGroups();
        await refreshGroupBadges();
    } catch { /* best-effort */ }
    return res;
}

/**
 * دیالوگ ساخت گروه (برای شیت ⊕ و هر فراخوان دیگر).
 * بعد از ساخت، مقصد همان گروه می‌شود (تک‌صفحه).
 */
export function openCreateGroupDialog() {
    const overlay = el('div', 'picker-overlay group-modal-overlay');
    overlay.id = 'groupCreateOverlay';
    const box = el('div', 'picker group-modal-box');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.appendChild(el('div', 'picker-title', tr('grp.create', '＋ گروه تازه')));
    const input = el('input', 'conv-input');
    input.setAttribute('placeholder', tr('grp.createPlaceholder', 'نام گروه…'));
    input.setAttribute('maxlength', '100');
    input.setAttribute('autocomplete', 'off');
    box.appendChild(input);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            create.click();
        }
    });
    const visRow = el('div', 'conv-vis-row');
    const pubLabel = el('label', 'conv-vis-option');
    const pubRadio = el('input', null);
    pubRadio.type = 'radio';
    pubRadio.name = 'dlg-grp-visibility';
    pubRadio.value = 'public';
    pubLabel.appendChild(pubRadio);
    pubLabel.appendChild(document.createTextNode(tr('grp.visibilityPublic', 'عمومی')));
    const privLabel = el('label', 'conv-vis-option');
    const privRadio = el('input', null);
    privRadio.type = 'radio';
    privRadio.name = 'dlg-grp-visibility';
    privRadio.value = 'private';
    privRadio.checked = true;
    privLabel.appendChild(privRadio);
    privLabel.appendChild(document.createTextNode(tr('grp.visibilityPrivate', 'خصوصی')));
    visRow.appendChild(pubLabel);
    visRow.appendChild(privLabel);
    box.appendChild(visRow);
    const hint = el('div', 'drawer-hint');
    hint.hidden = true;
    const actions = el('div', 'conv-new');
    const cancel = el('button', 'conv-mini-btn', tr('gtask.cancel', 'انصراف'));
    cancel.type = 'button';
    cancel.addEventListener('click', () => {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    });
    const create = el('button', 'conv-send', tr('grp.createGo', 'ساخت'));
    create.type = 'button';
    create.addEventListener('click', async () => {
        const vis = box.querySelector('input[name="dlg-grp-visibility"]:checked');
        create.disabled = true;
        hint.hidden = true;
        let res = null;
        try {
            res = await createGroup({ name: input.value, visibility: (vis && vis.value) || 'private' });
        } catch (err) {
            console.error('[groups] create failed:', err);
            res = { ok: false, error: (err && err.code) ? err : { code: 'UNKNOWN' } };
        }
        create.disabled = false;
        if (res && res.ok && res.data && res.data.group) {
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            const { selectDestination } = await import('../tasks/composer.js');
            await selectDestination({
                type: 'group',
                groupId: String(res.data.group.id),
                name: res.data.group.name,
            });
        } else {
            console.error('[groups] create rejected:', res);
            hint.textContent = apiErrorMessage(res ? res.error : null);
            hint.hidden = false;
        }
    });
    actions.appendChild(cancel);
    actions.appendChild(create);
    box.appendChild(actions);
    box.appendChild(hint);
    overlay.appendChild(box);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    });
    document.body.appendChild(overlay);
    setTimeout(() => {
        try { input.focus(); } catch { /* silent */ }
    }, 30);
}

function buildInviteLink(token) {
    try {
        const base = location.origin + location.pathname;
        return base + '#/join/' + token;
    } catch {
        return '#/join/' + token;
    }
}

async function createInviteLinkFor(inviteeId, btn) {
    const res = await apiFetch(
        '/api/groups/' + encodeURIComponent(_openGroupId) + '/invitations/link',
        { method: 'POST', body: { inviteeId } }
    );
    if (!res.ok || !res.data || !res.data.token) {
        showInfoModal({ title: tr('grp.inviteLink', 'لینک دعوت'), paragraphs: [apiErrorMessage(res.error)] });
        return;
    }
    const url = buildInviteLink(res.data.token);
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(url);
        }
    } catch { /* کپی خودکار نشد — کاربر دستی کپی می‌کند */ }
    if (btn) {
        btn.disabled = true;
        btn.textContent = tr('grp.linkCopied', 'کپی شد');
    }
    showInfoModal({ title: tr('grp.inviteLink', 'لینک دعوت'), paragraphs: [url] });
}

/**
 * مصرف لینک دعوت از deep-link بوت (‎#/join/<token>).
 */
export async function consumeInviteLinkToken(token) {
    if (!token) return { ok: false };
    const res = await apiFetch('/api/invitations/link/consume', {
        method: 'POST',
        body: { token },
    });
    return res;
}

let _pendingJoinToken = null;

/**
 * خواندن توکن join از hash (بدون پاک‌سازی — تا بعد از ورود حفظ می‌شود).
 */
export function takePendingJoinToken() {
    if (_pendingJoinToken) return _pendingJoinToken;
    try {
        const h = location.hash || '';
        const m = h.match(/^#\/join\/([A-Za-z0-9-]+)\/?$/);
        if (m && m[1]) _pendingJoinToken = m[1];
    } catch { /* silent */ }
    return _pendingJoinToken;
}

function clearJoinHash() {
    try {
        if ((location.hash || '').startsWith('#/join/')) {
            history.replaceState(null, '', location.pathname + location.search);
        }
    } catch { /* silent */ }
}

/**
 * پردازش لینک معلق — فقط وقتی وارد شده؛ مهمان توکن را نگه می‌دارد.
 */
export async function processPendingJoin() {
    if (!_pendingJoinToken) return false;
    if (!isLoggedIn()) return false;
    const token = _pendingJoinToken;
    _pendingJoinToken = null;
    clearJoinHash();
    const res = await consumeInviteLinkToken(token);
    if (!res.ok) {
        showInfoModal({
            title: tr('grp.inviteLink', 'لینک دعوت'),
            paragraphs: [apiErrorMessage(res.error)],
        });
        return true;
    }
    if (res.data && res.data.groupId) {
        const { selectDestination } = await import('../tasks/composer.js');
        await selectDestination({ type: 'group', groupId: String(res.data.groupId) });
        return true;
    }
    return true;
}

async function confirmGroupDelete(forId) {
    const targetId = forId || _openGroupId;
    if (!targetId) return;
    const ok = await showConfirmModal({
        title: tr('grp.delete', 'حذف گروه'),
        message: tr('grp.deleteConfirm', 'گروه برای همیشه حذف شود؟'),
        danger: true,
    });
    if (!ok) return;
    await apiFetch('/api/groups/' + encodeURIComponent(targetId), { method: 'DELETE' });
    if (targetId === _openGroupId) _openGroupId = null;
    await refreshGroupsHome();
}

// ═══════════════════════════════════════════════════════════════════════════
// 8.3-B: تسک‌های گروه (CRUD کامل با Permission Matrix بخش ۱۰)
//   - مشاهده/ایجاد: همه‌ی اعضا | ویرایش: فقط creator | حذف: creator یا owner
// ═══════════════════════════════════════════════════════════════════════════

export async function fetchFullTimeline(groupId) {
    const all = [];
    let cursor = null;
    for (let page = 0; page < 20; page++) {
        const res = await fetchTimeline(groupId, cursor);
        if (!res.ok) return { ok: false, error: res.error };
        all.push(...((res.data && res.data.items) || []));
        cursor = (res.data && res.data.nextCursor) || null;
        if (!cursor) break;
    }
    return { ok: true, items: all };
}

// ═══════════════════════════════════════════════════════════════════════════
// 8.3-B: inbox دعوت‌ها + مدیریت + نقش‌ها (+ تسک گروهی در ادامه‌ی همین فایل)
// ═══════════════════════════════════════════════════════════════════════════

function roleLabel(role) {
    if (role === 'owner') return tr('grp.roleOwner', 'مالک');
    if (role === 'admin') return tr('grp.roleAdmin', 'مدیر');
    return tr('grp.roleMember', 'عضو');
}

function myUserId() {
    try {
        return (state.sync && state.sync.userId) || null;
    } catch {
        return null;
    }
}

/**
 * inbox دعوت‌های گروهی خودم → ردیف‌های دراور (قبول/رد همان‌جا).
 */
export async function refreshGroupInbox() {
    try {
        const res = await apiFetch('/api/invitations/mine');
        const rows = ((res.ok && res.data && res.data.invitations) || []).map((inv) => ({
            id: inv.id,
            groupId: inv.groupId,
            name: inv.groupName || '…',
        }));
        setGroupInvitations(rows);
        return rows;
    } catch {
        return [];
    }
}

/**
 * قبول/رد دعوت گروهی از دراور.
 */
export async function respondGroupInvitation(inv, accept) {
    if (!inv) return { ok: false };
    const res = await apiFetch(
        '/api/groups/' + encodeURIComponent(inv.groupId) +
        '/invitations/' + encodeURIComponent(inv.id) + (accept ? '/accept' : '/reject'),
        { method: 'POST' }
    );
    if (res.ok) await refreshGroupInbox();
    return res;
}

function isManager() {
    return _myRole === 'owner' || _myRole === 'admin';
}

function isOwner() {
    return _myRole === 'owner';
}

// ═══════════════════════════════════════════════════════════════════════════
// 8.3-C (تصمیم ۳): بج‌های نخوانده + ثبت خواندن
// ═══════════════════════════════════════════════════════════════════════════

/**
 * تازه‌سازی بج نخوانده‌ی همه‌ی گروه‌های لیست + بج دعوت‌های دراور + ردیف‌های اخیر دراور.
 */
export async function refreshGroupBadges() {
    try {
        const [mineRes] = await Promise.all([
            apiFetch('/api/invitations/mine').catch(() => null),
        ]);
        if (mineRes && mineRes.ok) {
            updateDrawerBadges({ groups: ((mineRes.data && mineRes.data.invitations) || []).length });
        }
    } catch { /* best-effort */ }
    const unreadByGroup = new Map();
    // ⚠️ موازی (نه ترتیبی): هر گروه یک /unread جدا می‌خواهد و latency جمع می‌شد
    await Promise.all((_groups || []).map(async (g) => {
        try {
            const res = await apiFetch('/api/groups/' + encodeURIComponent(g.id) + '/unread');
            if (!res.ok) return;
            const u = (res.data && res.data.unread) || { messages: 0, tasks: 0 };
            const total = (Number(u.messages) || 0) + (Number(u.tasks) || 0);
            unreadByGroup.set(String(g.id), total);
        } catch { /* best-effort per group */ }
    }));
    try {
        const rows = (_groups || []).map((g) => ({
            id: String(g.id),
            name: g.name || '…',
            avatarUrl: g.avatarUrl || null,
            unread: unreadByGroup.get(String(g.id)) || 0,
        }));
        rows.sort((a, b) => (b.unread || 0) - (a.unread || 0));
        setRecentGroups(rows);
    } catch { /* best-effort */ }
}

/**
 * ثبت خواندن (messages/tasks) برای گروه باز.
 */
async function markCurrentGroupRead(type) {
    if (!_openGroupId) return;
    try {
        await apiFetch('/api/groups/' + encodeURIComponent(_openGroupId) + '/read', {
            method: 'POST',
            body: { type: type || 'all' },
        });
    } catch { /* best-effort */ }
}

// ⚠️ فقط برای تست
export function __resetGroupsForTest() {
    _groups = [];
    _openGroupId = null;
    _group = null;
    _myRole = null;
    _members = [];
    _loading = false;
    _pendingJoinToken = null;
    closeModalShell();
}
export function __getGroupsStateForTest() {
    return { groups: _groups, openGroupId: _openGroupId, group: _group, myRole: _myRole, members: _members };
}
