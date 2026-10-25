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
import { avatarNode, clearAvatarCache } from '../ui/avatar.js';
import { changeGroupAvatar, removeGroupAvatar } from '../ui/avatar-settings.js';
import {
    updateDrawerBadges,
    setRecentGroups,
    setGroupInvitations,
    removeDrawerRow,
    rerenderDrawer,
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

// ⚠️ 10.21/BUG-22: `/api/groups` هم‌زمان از چند جا صدا زده می‌شود (پالس
// دراور هر ۲ دقیقه، اسکنر یادآور هر ۶۰ ثانیه، پیش‌بارگذاری ورود). بدون
// dedupe، در شبکه‌ی کند چند درخواست موازی روی هم می‌افتادند و در کنسول
// `net::ERR_TIMED_OUT` می‌دادند. حالا یک درخواست در پرواز + backoff کوتاه
// بعد از خطای شبکه (force برای مسیرهای کاربری مثل بکاپ).
let _listInflight = null;
let _listFailedAt = 0;
const LIST_BACKOFF_MS = 20000;

export async function listGroups(opts) {
    const force = !!(opts && opts.force);
    if (_listInflight) return _listInflight;
    if (!force && _listFailedAt && (Date.now() - _listFailedAt) < LIST_BACKOFF_MS) {
        return {
            ok: false,
            error: { code: 'BACKOFF', message: '', status: null },
            groups: _groups,
        };
    }
    _listInflight = (async () => {
        const res = await apiFetch('/api/groups');
        if (!res.ok) {
            const code = res.error && res.error.code;
            if (code === 'NETWORK_ERROR' || code === 'TIMEOUT') _listFailedAt = Date.now();
            return res;
        }
        _listFailedAt = 0;
        _groups = (res.data && res.data.groups) || [];
        return { ok: true, groups: _groups };
    })();
    try {
        return await _listInflight;
    } finally {
        _listInflight = null;
    }
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
 * بعد از تغییر/حذف آواتار گروه: داده و دراور تازه شوند و مودال باز بماند.
 */
async function afterGroupAvatarChange(groupId) {
    try { clearAvatarCache(); } catch { /* silent */ }
    try { await loadGroupData(groupId); } catch { /* silent */ }
    try { await refreshGroupsHome(); } catch { /* silent */ }
    try { rerenderDrawer(); } catch { /* best-effort */ }
    closeModalShell();
    openGroupSettingsModal(groupId);
}

/**
 * مودال تنظیمات گروه (فقط مالک): نام + اعضا/اخراج.
 * هندل نام کاربری (username) در قدم بعدی همین‌جا اضافه می‌شود.
 */
export async function openGroupSettingsModal(groupId) {
    if (!groupId) return;
    const loaded = await loadGroupData(groupId);
    if (!loaded.ok) {
        showInfoModal({
            title: tr('grp.settings', 'تنظیمات گروه'),
            paragraphs: [apiErrorMessage(loaded.error)],
        });
        return;
    }
    // ⚠️ 10.37: گیت مالکیت با ownerId (نه myRole که ممکن است کهنه باشد)
    if (!isOwner()) return;
    const body = openModalShell(tr('grp.settings', 'تنظیمات گروه'));

    // ─── آواتار گروه (10.32) — انتخاب / تغییر / حذف، فقط مالک ───
    // ⚠️ پیش‌نمایش از همان `avatarNode` استفاده می‌کند که دراور و لیست اعضا؛
    // اگر گروه عکس نداشته باشد، حرف اول نام گروه می‌ماند.
    const avRow = el('div', 'settings-row group-avatar-row');
    const avRef = (_group && _group.avatarUrl) || null;
    const avPreview = avatarNode(avRef, (_group && _group.name) || '?');
    avPreview.classList.add('group-avatar-preview');
    avRow.appendChild(avPreview);
    const avPick = el('button', 'conv-mini-btn', tr('grp.changeAvatar', 'انتخاب عکس گروه'));
    avPick.type = 'button';
    avPick.addEventListener('click', async () => {
        avPick.disabled = true;
        try {
            const changed = await changeGroupAvatar(groupId);
            if (changed) await afterGroupAvatarChange(groupId);
        } catch (err) {
            console.error('[groups] avatar change failed:', err);
            showInfoModal({
                title: tr('grp.avatar', 'عکس گروه'),
                paragraphs: [tr('avatar.uploadFailed', 'آپلود ناموفق بود.')],
            });
        } finally {
            avPick.disabled = false;
        }
    });
    avRow.appendChild(avPick);
    if (avRef) {
        const avDel = el('button', 'conv-mini-btn', tr('grp.removeAvatar', 'حذف عکس'));
        avDel.type = 'button';
        avDel.addEventListener('click', async () => {
            const ok = await showConfirmModal({
                title: tr('grp.removeAvatar', 'حذف عکس'),
                message: tr('grp.removeAvatarConfirm', 'عکس گروه حذف شود؟'),
                danger: true,
            });
            if (!ok) return;
            avDel.disabled = true;
            try {
                const removed = await removeGroupAvatar(groupId);
                if (removed) await afterGroupAvatarChange(groupId);
            } finally {
                avDel.disabled = false;
            }
        });
        avRow.appendChild(avDel);
    }
    body.appendChild(avRow);
    body.appendChild(el('p', 'wizard-hint', tr('grp.avatarHint', 'عکس مربعی انتخاب کنید تا کراپ یا کشیده نشود.')));

    // ─── نام گروه ───
    const nameRow = el('div', 'conv-new');
    const nameInput = el('input', 'conv-input');
    nameInput.type = 'text';
    nameInput.value = (_group && _group.name) || '';
    nameInput.setAttribute('maxlength', '100');
    nameInput.setAttribute('autocomplete', 'off');
    const saveBtn = el('button', 'conv-mini-btn', tr('common.save', 'ذخیره'));
    saveBtn.type = 'button';
    saveBtn.addEventListener('click', async () => {
        const v = nameInput.value.trim().replace(/\s+/g, ' ');
        if (!v) {
            showInfoModal({
                title: tr('grp.settings', 'تنظیمات گروه'),
                paragraphs: [tr('grp.nameEmpty', 'نام گروه نمی‌تواند خالی باشد.')],
            });
            return;
        }
        saveBtn.disabled = true;
        try {
            const res = await apiFetch('/api/groups/' + encodeURIComponent(groupId), {
                method: 'PATCH',
                body: { name: v },
            });
            if (!res.ok) {
                showInfoModal({
                    title: tr('grp.settings', 'تنظیمات گروه'),
                    paragraphs: [apiErrorMessage(res.error)],
                });
                return;
            }
            await loadGroupData(groupId);
            await refreshGroupsHome();
            try { rerenderDrawer(); } catch { /* best-effort: نام تازه همان لحظه در دراور */ }
            closeModalShell();
            openGroupSettingsModal(groupId);
        } finally {
            saveBtn.disabled = false;
        }
    });
    nameRow.appendChild(nameInput);
    nameRow.appendChild(saveBtn);
    body.appendChild(nameRow);
    // ─── هندل عمومی (فقط گروه عمومی — مثل t.me/name) ───
    const unameRow = el('div', 'conv-new');
    const unamePrefix = el('span', 'drawer-hint', '@');
    const unameInput = el('input', 'conv-input');
    unameInput.type = 'text';
    unameInput.dir = 'ltr';
    unameInput.value = (_group && _group.username) || '';
    unameInput.setAttribute('maxlength', '20');
    unameInput.setAttribute('autocomplete', 'off');
    unameInput.setAttribute('placeholder', tr('grp.usernamePlaceholder', 'public-handle'));
    const unameSave = el('button', 'conv-mini-btn', tr('common.save', 'ذخیره'));
    unameSave.type = 'button';
    unameSave.addEventListener('click', async () => {
        const v = unameInput.value.trim().toLowerCase();
        unameSave.disabled = true;
        try {
            const res = await apiFetch('/api/groups/' + encodeURIComponent(groupId), {
                method: 'PATCH',
                body: { username: v.length === 0 ? null : v },
            });
            if (!res.ok) {
                showInfoModal({
                    title: tr('grp.settings', 'تنظیمات گروه'),
                    paragraphs: [apiErrorMessage(res.error)],
                });
                return;
            }
            await loadGroupData(groupId);
            await refreshGroupsHome();
            try { rerenderDrawer(); } catch { /* best-effort */ }
            closeModalShell();
            openGroupSettingsModal(groupId);
        } finally {
            unameSave.disabled = false;
        }
    });
    unameRow.appendChild(unamePrefix);
    unameRow.appendChild(unameInput);
    unameRow.appendChild(unameSave);
    body.appendChild(unameRow);
    body.appendChild(el('p', 'wizard-hint', tr('grp.usernameHint', 'هندل عمومی فقط برای گروه عمومی است و در لینک استفاده می‌شود.')));
    // ─── اعضا + اخراج (همان نمای مودال اعضا) ───
    renderMembersView(body, {
        onChanged: async () => {
            await loadGroupData(groupId);
            closeModalShell();
            openGroupSettingsModal(groupId);
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

async function openTransferPicker(groupId, anchor) {
    const gid = groupId || _openGroupId;
    if (!gid) return;
    // اعضا را تازه بخوان تا کاندیداها به‌روز باشند
    let members = _members;
    let ownerId = _group ? _group.ownerId : null;
    if (gid === _openGroupId && members && members.length > 0) {
        // همان کش کافی است
    } else {
        try {
            const res = await apiFetch('/api/groups/' + encodeURIComponent(gid) + '/members');
            if (res.ok) members = (res.data && res.data.members) || [];
        } catch { members = []; }
        try {
            const res = await apiFetch('/api/groups/' + encodeURIComponent(gid));
            if (res.ok) ownerId = (res.data && res.data.group && res.data.group.ownerId) || null;
        } catch { /* silent */ }
    }
    const candidates = (members || []).filter(
        (m) => m && m.status === 'active' && String(m.userId) !== String(ownerId)
    );
    if (candidates.length === 0) {
        showInfoModal({
            title: tr('grp.transfer', 'انتقال مالکیت'),
            paragraphs: [tr('grp.transferNoCandidate', 'عضو فعالی برای انتقال مالکیت نیست.')],
        });
        return;
    }
    openMenu({
        anchor: anchor || document.body,
        items: candidates.map((m) => ({
            id: String(m.userId),
            label: m.username || m.displayName || String(m.userId).slice(0, 8),
        })),
        onSelect: async (newOwnerId) => {
            const ok = await showConfirmModal({
                title: tr('grp.transfer', 'انتقال مالکیت'),
                message: tr('grp.transferConfirm', 'مالکیت منتقل شود؟'),
                danger: true,
            });
            if (!ok) return;
            const res = await apiFetch('/api/groups/' + encodeURIComponent(gid) + '/transfer', {
                method: 'POST',
                body: { newOwnerId },
            });
            if (!res.ok) {
                showInfoModal({ title: tr('grp.transfer', 'انتقال مالکیت'), paragraphs: [apiErrorMessage(res.error)] });
                return;
            }
            try {
                const { showToast } = await import('../ui.js');
                showToast(tr('grp.transferDone', 'مالکیت منتقل شد — حالا عضو عادی هستی و می‌توانی ترک کنی.'));
            } catch { /* silent */ }
            // ⚠️ 10.37: نقش/داده‌ی کش‌شده فوراً پاک می‌شود تا منوی ⋯ و مودال
            // تنظیمات همان لحظه بر اساس مالکیت تازه رندر شوند (وگرنه دکمه‌ی
            // «دعوت عضو» تا تیک بعدی برای مالک قبلی می‌ماند).
            _myRole = null;
            _group = null;
            _members = [];
            closeModalShell();
            try { rerenderDrawer(); } catch { /* best-effort */ }
            await refreshGroupsHome();
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
    // ⚠️ 10.37: مالکیت از `group.ownerId` محاسبه می‌شود. بعد از «انتقال
    // مالکیت»، `myRole` ممکن است یک تیک کهنه بماند و منوی مالک قبلی هنوز
    // «دعوت عضو»/«تنظیمات» را نشان دهد.
    const me = myUserId();
    const owner = (group && group.ownerId && me)
        ? String(group.ownerId) === String(me)
        : role === 'owner';
    const manager = owner || role === 'admin';
    const items = [
        { id: 'open', label: tr('grp.open', 'باز کردن') },
        { id: 'members', label: tr('grp.members', 'اعضا') },
    ];
    if (owner) items.push({ id: 'settings', label: tr('grp.settings', 'تنظیمات گروه') });
    if (manager) items.push({ id: 'invite', label: tr('grp.invite', 'دعوت عضو') });
    if (owner) {
        items.push({ id: 'transfer', label: tr('grp.transfer', 'انتقال مالکیت') });
        // ⚠️ 10.37: «بستن» و «حذف» دو کار متفاوت‌اند ولی نامشان تفاوت را
        // نشان نمی‌داد. حالا هر کدام یک خط توضیح دارند.
        items.push({
            id: 'close',
            label: tr('grp.close', 'بستن گروه'),
            desc: tr('v10.closeGroupHint', 'گروه بسته می‌شود و وظایفش پاک می‌شوند، ولی سابقه‌ی گروه و اعضا می‌ماند (فقط‌خواندنی).'),
            danger: true,
        });
        items.push({
            id: 'delete',
            label: tr('grp.delete', 'حذف گروه'),
            desc: tr('v10.deleteGroupHint', 'گروه برای همیشه و کامل حذف می‌شود — از فهرست همه‌ی اعضا هم برداشته می‌شود.'),
            danger: true,
        });
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
            } else if (id === 'settings') {
                await openGroupSettingsModal(groupId);
            } else if (id === 'leave') {
                await confirmGroupLeave(groupId);
            } else if (id === 'transfer') {
                await openTransferPicker(groupId, anchor);
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
    await listGroups({ force: true }).catch(() => {});
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
    removeDrawerRow('group', targetId);
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
    removeDrawerRow('group', targetId);
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
        await listGroups({ force: true });
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
    removeDrawerRow('group', targetId);
    await refreshGroupsHome();
}

// ═══════════════════════════════════════════════════════════════════════════
// پیش‌نمایش فقط‌خواندنی گروه عمومی (10.37 — درخواست کاربر)
// ═══════════════════════════════════════════════════════════════════════════
//
// ⚠️ پیش از این، کلیک روی گروه عمومیِ پیداشده در جستجو فقط پیام
// «عضویت فقط با دعوت» می‌داد — یعنی عملاً هیچ فرقی با گروه خصوصی نداشت.
// حالا محتوای وظایف دیده می‌شود (بدون امکان ارسال)، مدیر گروه با نام و
// نام کاربری معرفی می‌شود و دکمه‌ی «درخواست از مدیر» گفتگو با او را باز می‌کند.
//
// ⚠️ سمت سرور: GET /api/groups/:id/public فقط برای گروه public و باز جواب
// می‌دهد؛ عضویت/عدم‌عضویت در فیلد isMember برمی‌گردد.

/**
 * متن قابل‌نمایش یک تسک گروهی از payload سرور.
 * @param {unknown} raw
 * @returns {string}
 */
function taskTextOf(raw) {
    if (!raw) return '';
    let p = raw;
    if (typeof raw === 'string') {
        try { p = JSON.parse(raw); } catch { return String(raw).slice(0, 200); }
    }
    if (!p || typeof p !== 'object') return '';
    const t = (typeof p.text === 'string' && p.text)
        || (typeof p.title === 'string' && p.title)
        || '';
    return String(t).slice(0, 200);
}

/**
 * نمایش گروه عمومی به‌صورت فقط‌خواندنی.
 *
 * @param {string} groupId
 * @param {string} [fallbackName]
 * @returns {Promise<boolean>} آیا پیش‌نمایش باز شد؟
 */
export async function openPublicGroupPreview(groupId, fallbackName) {
    if (!groupId) return false;
    const res = await apiFetch('/api/groups/' + encodeURIComponent(groupId) + '/public');
    if (!res.ok) {
        showInfoModal({
            title: tr('v10.publicGroupTitle', 'گروه عمومی'),
            paragraphs: [apiErrorMessage(res.error)],
        });
        return false;
    }
    const data = res.data || {};
    const group = data.group || {};
    const owner = data.owner || null;
    const tasks = Array.isArray(data.tasks) ? data.tasks : [];
    const isMember = !!data.isMember;

    const body = openModalShell(group.name || fallbackName || tr('v10.publicGroupTitle', 'گروه عمومی'));

    // ─── برچسب نوع گروه ───
    const tagRow = el('div', 'conv-row');
    tagRow.appendChild(avatarNode(group.avatarUrl || null, group.name || '?'));
    const tagMain = el('span', 'conv-name conv-name-stack');
    tagMain.appendChild(el('span', 'conv-name-main', String(group.name || '')));
    if (group.username) tagMain.appendChild(el('span', 'conv-name-sub', '@' + group.username));
    tagRow.appendChild(tagMain);
    tagRow.appendChild(el('span', 'conv-role', tr('v10.publicGroupTitle', 'گروه عمومی')));
    body.appendChild(tagRow);

    // ─── مدیر گروه + دکمه‌ی درخواست ───
    if (owner && owner.id) {
        const ownerName = owner.displayName || owner.username || tr('grp.roleOwner', 'مالک');
        const ownerRow = el('div', 'conv-row');
        ownerRow.appendChild(avatarNode(owner.avatarUrl || null, ownerName));
        const ownerMain = el('span', 'conv-name conv-name-stack');
        ownerMain.appendChild(el('span', 'conv-name-main', ownerName));
        if (owner.username) ownerMain.appendChild(el('span', 'conv-name-sub', '@' + owner.username));
        ownerRow.appendChild(ownerMain);
        if (!isMember) {
            const ask = el('button', 'conv-mini-btn', tr('v10.publicGroupAskOwner', 'درخواست از مدیر'));
            ask.type = 'button';
            ask.addEventListener('click', async () => {
                ask.disabled = true;
                try {
                    closeModalShell();
                    const { selectDestination } = await import('../tasks/composer.js');
                    await selectDestination({
                        type: 'peer',
                        peerId: String(owner.id),
                        name: ownerName,
                    });
                } catch { /* best-effort */ } finally {
                    ask.disabled = false;
                }
            });
            ownerRow.appendChild(ask);
        }
        body.appendChild(ownerRow);
        body.appendChild(el('p', 'wizard-hint', tr('v10.publicGroupOwner', 'مدیر گروه') + ' — ' + ownerName));
    }

    // ─── وظایف (فقط خواندن) ───
    body.appendChild(el('div', 'picker-title', tr('v10.publicGroupTasks', 'وظایف این گروه')));
    if (tasks.length === 0) {
        body.appendChild(el('p', 'wizard-hint', tr('v10.publicGroupEmpty', 'هنوز وظیفه‌ای در این گروه نیست.')));
    } else {
        for (const t of tasks.slice(0, 100)) {
            const text = taskTextOf(t.payload);
            if (!text) continue;
            const row = el('div', 'conv-row');
            row.appendChild(el('span', 'conv-name', text));
            body.appendChild(row);
        }
    }

    if (!isMember) {
        body.appendChild(el('p', 'storage-guidance', tr('v10.publicGroupReadOnly', 'شما عضو این گروه نیستید؛ وظایف را فقط می‌توانید ببینید. برای عضویت، از مدیر گروه درخواست کنید.')));
    }

    const actions = el('div', 'conv-new');
    const closeBtn = el('button', 'conv-mini-btn', tr('v10.publicGroupClose', 'بستن'));
    closeBtn.type = 'button';
    closeBtn.addEventListener('click', () => closeModalShell());
    actions.appendChild(closeBtn);
    body.appendChild(actions);
    return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 6D: تسک‌های گروه (تایم‌لاین)
// ═══════════════════════════════════════════════════════════════════════════
//
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

/**
 * آیا کاربر جاری مالک گروه است؟
 *
 * ⚠️ 10.37: منبع حقیقت `groups.owner_id` است، نه `myRole` که از
 * `group_members.role` می‌آید. بعد از «انتقال مالکیت»، ردیف عضویت مالک قبلی
 * ممکن است تا تیک بعدی نقش قدیمی را برگرداند؛ نتیجه: مالک قبلی هنوز دکمه‌ی
 * «دعوت عضو»/«تنظیمات» را می‌دید. حالا اول ownerId مقایسه می‌شود و نقش
 * فقط fallback است.
 *
 * @returns {boolean}
 */
function isOwner() {
    const me = myUserId();
    if (_group && _group.ownerId && me) {
        return String(_group.ownerId) === String(me);
    }
    return _myRole === 'owner';
}

function isManager() {
    return isOwner() || _myRole === 'admin';
}

// ═══════════════════════════════════════════════════════════════════════════
// 8.3-C (تصمیم ۳): بج‌های نخوانده + ثبت خواندن
// ═══════════════════════════════════════════════════════════════════════════

/**
 * تازه‌سازی بج نخوانده‌ی همه‌ی گروه‌های لیست + بج دعوت‌های دراور + ردیف‌های اخیر دراور.
 *
 * ⚠️ singleflight: چند caller همزمان (preload + تیک زنده + readtrack) نباید هر کدام
 *    N درخواست /unread بزنند — فراخوانی همزمان به همان promise وصل می‌شود.
 */
let _badgesInflight = null;

export async function refreshGroupBadges() {
    if (_badgesInflight) return _badgesInflight;
    _badgesInflight = (async () => {
        try {
            await _refreshGroupBadgesInner();
        } finally {
            _badgesInflight = null;
        }
    })();
    return _badgesInflight;
}

async function _refreshGroupBadgesInner() {
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
        // ⚠️ 10.37: درخواست کاربر — گروهی که همین حالا باز است، پیام‌هایش همان
        // لحظه دیده می‌شوند؛ پس بج «نخوانده»ی ردیفش صفر نمایش داده می‌شود
        // (هم‌قاعده با گفتگوی خصوصی در `conversations.js`). شمارش سرور دست‌نخورده
        // است — این فقط لایه‌ی نمایش است.
        const openId = _openGroupId ? String(_openGroupId) : '';
        const rows = (_groups || []).map((g) => {
            const gid = String(g.id);
            return {
                id: gid,
                name: g.name || '…',
                avatarUrl: g.avatarUrl || null,
                unread: (openId && gid === openId) ? 0 : (unreadByGroup.get(gid) || 0),
                lastActivity: g.lastActivity || null,
            };
        });
        rows.sort((a, b) => {
            const x = String(a.lastActivity || '');
            const y = String(b.lastActivity || '');
            if (x === y) return 0;
            return x > y ? -1 : 1;
        });
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
