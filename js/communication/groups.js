// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/communication/groups.js -- لیست گروه + فضای گروه (Phase 8 — 8.3-A)
//
// ⚠️ scope قفل‌شده‌ی 8.3-A (فقط خواندن/گفتگو):
//   - لیست گروه‌ها + هدر گروه + منوی ⋯ (فقط اعضا در A) + تایم‌لاین + کامپوزر متن
//   - تایم‌لاین mergeشده‌ی بک‌اند با cursor pagination (before/beforeId)
//   - تسک‌های تایم‌لاین فقط خواندنی (ویرایش/حذف در 8.3-B)
//   - مدیریت عضویت/دعوت/نقش در 8.3-B ؛ صف آفلاین در 8.3-C
//   - آفلاین → حالت غیرفعال با پیام (کش نداریم)
//
// ⚠️ مدل: server-authoritative + locally cached + offline queue (بعداً) —
//    گروه local-first نیست. همه‌ی requestها فقط از js/api.js. بدون innerHTML.
// ═══════════════════════════════════════════════════════════════════════════

import { apiFetch, apiErrorMessage } from '../api.js';
import { state, uid } from '../core.js';
import { isLoggedIn } from '../auth.js';
import { t as i18nT, formatDateTime } from '../i18n.js';
import { isOnline } from '../net.js';
import { openMenu } from '../ui/menu.js';
import { setBadge } from '../ui/badge.js';
import { avatarNode } from '../ui/avatar.js';
import { updateDrawerBadges, setRecentGroups } from '../navigation/sidebar.js';
import { showInfoModal, showConfirmModal } from '../core.js';
import { displayNameOf } from './conversations.js';
import { sideFor, canEdit, taskTitle } from '../tasks/list.js';
import { searchUsers } from './connections.js';
import { switchWorkspace, getActiveWorkspace } from '../navigation/workspace.js';
import { enqueueGroupOp, flushGroup, getPendingCount } from './group-queue.js';
import { changeGroupAvatar } from '../ui/avatar-settings.js';

const PAGE_LIMIT = 30;

let _groups = [];
let _openGroupId = null;
let _group = null;
let _myRole = null;
let _members = [];
let _items = [];
let _cursor = null;
let _hasMore = false;
let _loading = false;
let _view = 'timeline';
let _tasksCache = [];

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

function groupsSection() {
    return document.getElementById('ws-groups');
}

/**
 * نام + آواتار یک عضو (برای بج «از: نام» روی آیتم دیگران).
 */
function memberInfo(userId) {
    const m = _members.find((x) => String(x.userId) === String(userId));
    if (!m) return { name: String(userId || '').slice(0, 8), avatarUrl: null };
    return {
        name: m.username || m.displayName || String(m.userId || '').slice(0, 8),
        avatarUrl: m.avatarUrl || null,
    };
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
function renderCreateForm() {
    const box = el('div', 'conv-new');
    const toggle = el('button', 'conv-mini-btn', tr('grp.create', '＋ گروه تازه'));
    toggle.type = 'button';
    const form = el('div', 'conv-search');
    form.hidden = true;
    const input = el('input', 'conv-input');
    input.setAttribute('placeholder', tr('grp.createPlaceholder', 'نام گروه…'));
    input.setAttribute('maxlength', '100');
    input.setAttribute('autocomplete', 'off');
    const visRow = el('div', 'conv-vis-row');
    const pubLabel = el('label', 'conv-vis-option');
    const pubRadio = el('input', null);
    pubRadio.type = 'radio';
    pubRadio.name = 'grp-visibility';
    pubRadio.value = 'public';
    pubLabel.appendChild(pubRadio);
    pubLabel.appendChild(document.createTextNode(tr('grp.visibilityPublic', 'عمومی')));
    const privLabel = el('label', 'conv-vis-option');
    const privRadio = el('input', null);
    privRadio.type = 'radio';
    privRadio.name = 'grp-visibility';
    privRadio.value = 'private';
    privRadio.checked = true;
    privLabel.appendChild(privRadio);
    privLabel.appendChild(document.createTextNode(tr('grp.visibilityPrivate', 'خصوصی')));
    visRow.appendChild(pubLabel);
    visRow.appendChild(privLabel);
    const create = el('button', 'conv-send', tr('grp.createGo', 'ساخت'));
    create.type = 'button';
    create.addEventListener('click', async () => {
        const name = input.value.trim();
        if (!name) return;
        const visibility = form.querySelector('input[name="grp-visibility"]:checked')?.value || 'private';
        create.disabled = true;
        const res = await apiFetch('/api/groups', {
            method: 'POST',
            body: { name, visibility },
        });
        create.disabled = false;
        if (!res.ok || !res.data || !res.data.group) {
            input.title = apiErrorMessage(res.error);
            return;
        }
        await openGroup(res.data.group.id);
    });
    form.appendChild(input);
    form.appendChild(visRow);
    form.appendChild(create);
    toggle.addEventListener('click', () => {
        form.hidden = !form.hidden;
        if (!form.hidden) input.focus();
    });
    box.appendChild(toggle);
    box.appendChild(form);
    return box;
}

async function renderGroupsHome(state) {
    const sec = groupsSection();
    if (!sec) return;
    sec.replaceChildren();
    sec.appendChild(el('h2', null, tr('workspace.groupsTitle', '👥 گروه‌ها')));

    if (state === 'offline') {
        sec.appendChild(el('p', null, tr('grp.offline', 'آفلاین هستی — برای دیدن گروه‌ها وصل شو.')));
        return;
    }
    if (state === 'error') {
        sec.appendChild(el('p', null, tr('errors.serverError', 'خطا')));
        return;
    }
    await renderInbox(sec);
    sec.appendChild(renderCreateForm());
    if (_groups.length === 0) {
        sec.appendChild(el('p', null, tr('workspace.groupsEmpty', '')));
        return;
    }

    const list = el('div', 'conv-list');
    list.setAttribute('role', 'list');
    for (const g of _groups) {
        const row = el('button', 'conv-row grp-row');
        row.type = 'button';
        row.setAttribute('role', 'listitem');
        row.appendChild(avatarNode(g.avatarUrl, g.name || '?'));
        row.appendChild(el('span', 'conv-name', g.name || '…'));
        const badge = el('span', 'drawer-badge');
        badge.hidden = true;
        badge.dataset.groupUnread = g.id;
        row.appendChild(badge);
        row.addEventListener('click', () => openGroup(g.id));
        list.appendChild(row);
    }
    sec.appendChild(list);
    refreshGroupBadges();
}

export async function openGroupsWorkspace() {
    _openGroupId = null;
    _view = 'timeline';
    const sec = groupsSection();
    if (sec) {
        sec.replaceChildren();
        sec.appendChild(el('h2', null, tr('workspace.groupsTitle', '👥 گروه‌ها')));
        sec.appendChild(el('p', null, '…'));
    }
    if (!isOnline()) {
        await renderGroupsHome('offline');
        return;
    }
    const res = await listGroups();
    if (!res.ok) {
        await renderGroupsHome('error');
        return;
    }
    await renderGroupsHome('list');
    // بج‌های نخوانده + دعوت‌ها (best-effort)
    refreshGroupBadges().catch(() => {});
}

// ═══════════════════════════════════════════════════════════════════════════
// View — group workspace
// ═══════════════════════════════════════════════════════════════════════════

function renderGroupView() {
    const sec = groupsSection();
    if (!sec || !_group) return;
    sec.replaceChildren();

    const head = el('div', 'conv-head');
    const back = el('button', 'conv-back', tr('grp.back', '‹ گروه‌ها'));
    back.type = 'button';
    back.addEventListener('click', () => {
        _openGroupId = null;
        openGroupsWorkspace();
    });
    head.appendChild(back);
    head.appendChild(avatarNode(_group.avatarUrl, _group.name));
    const titleWrap = el('span', 'conv-title');
    titleWrap.appendChild(el('span', null, _group.name || '…'));
    head.appendChild(titleWrap);
    const menu = el('button', 'conv-menu-btn', '⋯');
    menu.type = 'button';
    menu.setAttribute('aria-label', tr('msg.moreAria', 'گزینه‌ها'));
    menu.addEventListener('click', () => {
        // ⚠️ آیتم‌ها بر اساس نقش (UI فقط منعکس می‌کند؛ backend مرجع نهایی است)
        const items = [
            { id: 'members', label: tr('grp.members', 'اعضا') },
            { id: 'tasks', label: tr('gtask.title', 'تسک‌ها') },
        ];
        if (isManager()) items.push({ id: 'invite', label: tr('grp.invite', 'دعوت عضو') });
        if (isOwner()) {
            items.push({ id: 'avatar', label: tr('grp.avatar', 'آواتار گروه') });
            items.push({ id: 'transfer', label: tr('grp.transfer', 'انتقال مالکیت') });
            items.push({ id: 'close', label: tr('grp.close', 'بستن گروه'), danger: true });
            items.push({ id: 'delete', label: tr('grp.delete', 'حذف گروه'), danger: true });
        }
        // ترک گروه: همه به‌جز مالک (مالک باید اول منتقل کند)
        if (_group && !isOwner()) {
            items.push({ id: 'leave', label: tr('grp.leave', 'ترک گروه'), danger: true });
        }
        openMenu({
            anchor: menu,
            items,
            onSelect: async (id) => {
                if (id === 'members' || id === 'invite') {
                    _view = 'members';
                    renderGroupView();
                } else if (id === 'tasks') {
                    openTasksView();
                } else if (id === 'avatar') {
                    await changeGroupAvatar(_openGroupId);
                    await openGroup(_openGroupId);
                } else if (id === 'leave') {
                    await confirmGroupLeave();
                } else if (id === 'transfer') {
                    openTransferPicker();
                } else if (id === 'close') {
                    confirmGroupClose();
                } else if (id === 'delete') {
                    confirmGroupDelete();
                }
            },
        });
    });
    head.appendChild(menu);
    sec.appendChild(head);

    if (_view === 'members') {
        renderMembersView(sec);
        return;
    }

    if (_view === 'tasks') {
        renderGroupTasksView(sec);
        return;
    }

    const box = el('div', 'conv-box');
    box.id = 'convBox';
    const me = myUserId();
    // API نزولی برمی‌گرداند؛ قدیمی‌تر اول نمایش بده
    for (const item of [..._items].reverse()) {
        box.appendChild(groupTimelineNode(item, me));
    }
    if (_items.length === 0) {
        box.appendChild(el('p', null, tr('gtask.empty', 'تسکی نیست.')));
    }
    sec.appendChild(box);

    if (_hasMore) {
        const more = el('button', 'conv-more', tr('grp.loadMore', 'قدیمی‌تر'));
        more.type = 'button';
        more.addEventListener('click', () => loadMoreTimeline());
        sec.appendChild(more);
    }

    // ─── کامپوزر تسک (مثل پیام: عنوان ساده؛ جزئیات کامل در فضای شخصی) ───
    // آفلاین = از طریق صف (enqueue + flush؛ flush ناموفق = pending می‌ماند)
    if (_group && !_group.closedAt) {
        const composer = el('div', 'conv-composer');
        const input = el('input', 'conv-input');
        input.id = 'grpTaskInput';
        input.setAttribute('placeholder', tr('gtask.placeholder', 'تسک تازه…'));
        input.setAttribute('maxlength', '500');
        input.setAttribute('autocomplete', 'off');
        const send = el('button', 'conv-send', tr('gtask.create', 'افزودن'));
        send.type = 'button';
        const doSend = () => submitGroupTask(input, send);
        send.addEventListener('click', doSend);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                doSend();
            }
        });
        if (!isOnline()) {
            input.disabled = true;
            send.disabled = true;
        }
        composer.appendChild(input);
        composer.appendChild(send);
        sec.appendChild(composer);
    }

    box.scrollTop = box.scrollHeight;
}

/**
 * یک ردیف تسک گروه: سمت خودی/اعضا + آواتار+نام فرستنده + ⋯ (ویرایش خودی، حذف creator/owner).
 */
function groupTimelineNode(item, me) {
    const mine = sideFor({ creator_id: item.actorId }, me) === 'self';
    const wrap = el('div', 'msg msg-task' + (mine ? ' msg-mine' : ' msg-other'));
    const info = mine ? null : memberInfo(item.actorId);
    const av = avatarNode(info ? info.avatarUrl : null, mine ? '?' : (info ? info.name : '?'));
    av.classList.add('msg-avatar');
    wrap.appendChild(av);
    const content = el('div', 'msg-content');
    if (!mine && info) {
        content.appendChild(el('div', 'msg-from', info.name));
    }
    content.appendChild(el('div', 'msg-body', taskTitle({ payload: item.body })));
    const meta = el('div', 'msg-meta');
    try {
        meta.textContent = formatDateTime(item.createdAt || item.updated_at);
    } catch {
        meta.textContent = '';
    }
    content.appendChild(meta);
    wrap.appendChild(content);
    const editable = canEdit({ creator_id: item.actorId }, me);
    const canDelete = editable || isOwner();
    if (editable || canDelete) {
        const more = el('button', 'msg-more', '⋯');
        more.type = 'button';
        more.setAttribute('aria-label', tr('msg.moreAria', 'گزینه‌ها'));
        more.addEventListener('click', (e) => {
            e.stopPropagation();
            const items = [];
            if (editable) items.push({ id: 'edit', label: tr('msg.edit', 'ویرایش') });
            if (canDelete) items.push({ id: 'delete', label: tr('msg.delete', 'حذف'), danger: true });
            openMenu({
                anchor: more,
                items,
                onSelect: (id) => {
                    if (id === 'edit') startTimelineEdit(item, wrap);
                    else if (id === 'delete') removeTimelineTask(item.id);
                },
            });
        });
        wrap.appendChild(more);
    }
    return wrap;
}

/**
 * ساخت تسک گروهی از کامپوزر نمای اصلی (از طریق صف آفلاین).
 */
export async function submitGroupTask(inputEl, sendEl) {
    const input = inputEl || document.getElementById('grpTaskInput');
    const send = sendEl || null;
    if (!input || _loading || !_openGroupId) return;
    const text = input.value.trim().slice(0, 500);
    if (!text) return;
    _loading = true;
    if (send) send.disabled = true;
    try {
        await enqueueGroupOp(_openGroupId, 'save', uid(), { kind: 'task', payload: { title: text } });
        await flushGroup(_openGroupId);
    } finally {
        _loading = false;
        if (send) send.disabled = false;
    }
    input.value = '';
    await openGroup(_openGroupId);
}

function startTimelineEdit(item, rowEl) {
    if (!rowEl) return;
    rowEl.replaceChildren();
    const input = el('input', 'conv-input');
    const cur = taskTitle({ payload: item.body });
    input.value = cur === '…' ? '' : cur;
    input.setAttribute('maxlength', '500');
    const save = el('button', 'conv-mini-btn', tr('gtask.save', 'ذخیره'));
    save.type = 'button';
    save.addEventListener('click', async () => {
        const text = input.value.trim();
        if (!text) return;
        save.disabled = true;
        await enqueueGroupOp(_openGroupId, 'save', item.id, { kind: item.kind || 'task', payload: { title: text } });
        await flushGroup(_openGroupId);
        await openGroup(_openGroupId);
    });
    const cancel = el('button', 'conv-mini-btn', tr('gtask.cancel', 'انصراف'));
    cancel.type = 'button';
    cancel.addEventListener('click', () => renderGroupView());
    rowEl.appendChild(input);
    rowEl.appendChild(save);
    rowEl.appendChild(cancel);
    input.focus();
}

async function removeTimelineTask(taskId) {
    const ok = await showConfirmModal({
        title: tr('msg.delete', 'حذف'),
        message: tr('gtask.deleteConfirm', 'این تسک حذف شود؟'),
        danger: true,
    });
    if (!ok) return;
    await enqueueGroupOp(_openGroupId, 'delete', taskId, null);
    await flushGroup(_openGroupId);
    await openGroup(_openGroupId);
}

function renderMembersView(sec) {
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
                await openGroup(_openGroupId);
            });
            row.appendChild(rm);
        }
        box.appendChild(row);
    }
    if (_members.length === 0) {
        box.appendChild(el('p', null, tr('workspace.groupsEmpty', '')));
    }
    sec.appendChild(box);
    const back = el('button', 'conv-more', tr('grp.backToTimeline', 'بازگشت به تایم‌لاین'));
    back.type = 'button';
    back.addEventListener('click', () => {
        _view = 'timeline';
        renderGroupView();
    });
    sec.appendChild(back);
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
            await openGroup(_openGroupId);
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
                if (switchWorkspace('groups')) await openGroup(groupId);
            } else if (id === 'members' || id === 'invite') {
                if (switchWorkspace('groups')) {
                    await openGroup(groupId);
                    _view = 'members';
                    renderGroupView();
                }
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
    if (getActiveWorkspace() === 'groups') await openGroupsWorkspace();
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
    if (getActiveWorkspace() === 'groups') await openGroupsWorkspace();
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
        if (switchWorkspace('groups')) {
            await openGroup(res.data.groupId);
            return true;
        }
    }
    await openGroupsWorkspace();
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
    if (getActiveWorkspace() === 'groups') await openGroupsWorkspace();
}

// ═══════════════════════════════════════════════════════════════════════════
// 8.3-B: تسک‌های گروه (CRUD کامل با Permission Matrix بخش ۱۰)
//   - مشاهده/ایجاد: همه‌ی اعضا | ویرایش: فقط creator | حذف: creator یا owner
// ═══════════════════════════════════════════════════════════════════════════

function groupTaskTitle(t) {
    try {
        const p = typeof t.payload === 'string' ? JSON.parse(t.payload) : t.payload;
        return String((p && (p.text || p.title)) || '').slice(0, 200) || '…';
    } catch {
        return '…';
    }
}

async function loadGroupTasks() {
    const res = await apiFetch('/api/groups/' + encodeURIComponent(_openGroupId) + '/tasks');
    return res.ok ? (res.data.tasks || []) : null;
}

function renderGroupTasksView(sec) {
    const box = el('div', 'conv-box');
    box.appendChild(el('div', 'conv-section', tr('gtask.title', 'تسک‌ها')));

    // ─── نشانگر pending (8.3-C) ───
    const pendingRow = el('div', 'conv-pending');
    pendingRow.id = 'gtaskPending';
    pendingRow.hidden = true;
    box.appendChild(pendingRow);
    getPendingCount(_openGroupId).then((n) => {
        const badge = document.getElementById('gtaskPending');
        if (!badge || n <= 0) return;
        badge.hidden = false;
        badge.textContent = '⏳ ' + n;
    });

    // ─── فرم ساخت (همه‌ی اعضا، گروه باز) ───
    if (_group && !_group.closedAt) {
        const form = el('div', 'conv-composer');
        const input = el('input', 'conv-input');
        input.id = 'gtaskInput';
        input.setAttribute('placeholder', tr('gtask.placeholder', 'تسک تازه…'));
        input.setAttribute('maxlength', '500');
        input.setAttribute('autocomplete', 'off');
        const add = el('button', 'conv-send', tr('gtask.create', 'افزودن'));
        add.type = 'button';
        add.addEventListener('click', async () => {
            const text = input.value.trim();
            if (!text) return;
            add.disabled = true;
            // ⚠️ 8.3-C: از طریق صف (آنلاین = flush فوری، آفلاین = pending)
            await enqueueGroupOp(_openGroupId, 'save', uid(), { kind: 'task', payload: { title: text } });
            await flushGroup(_openGroupId);
            add.disabled = false;
            input.value = '';
            await refreshTasksView();
        });
        form.appendChild(input);
        form.appendChild(add);
        box.appendChild(form);
    }

    const tasks = _tasksCache || [];
    if (tasks.length === 0) {
        box.appendChild(el('p', null, tr('gtask.empty', 'تسکی نیست.')));
    }
    const me = myUserId();
    for (const t of tasks) {
        const row = el('div', 'conv-row');
        row.appendChild(el('span', 'conv-name', groupTaskTitle(t)));
        const canEdit = t.creatorId === me;
        const canDelete = t.creatorId === me || isOwner();
        if (canEdit || canDelete) {
            const more = el('button', 'msg-more', '⋯');
            more.type = 'button';
            more.addEventListener('click', (e) => {
                e.stopPropagation();
                const items = [];
                if (canEdit) items.push({ id: 'edit', label: tr('msg.edit', 'ویرایش') });
                if (canDelete) items.push({ id: 'delete', label: tr('msg.delete', 'حذف'), danger: true });
                openMenu({
                    anchor: more,
                    items,
                    onSelect: (id) => {
                        if (id === 'edit') startGroupTaskEdit(t);
                        else if (id === 'delete') deleteGroupTask(t.id);
                    },
                });
            });
            row.appendChild(more);
        }
        box.appendChild(row);
    }
    sec.appendChild(box);

    const back = el('button', 'conv-more', tr('grp.backToTimeline', 'بازگشت به تایم‌لاین'));
    back.type = 'button';
    back.addEventListener('click', () => {
        _view = 'timeline';
        renderGroupView();
    });
    sec.appendChild(back);
}

async function refreshTasksView() {
    const tasks = await loadGroupTasks();
    if (tasks === null || _view !== 'tasks') return;
    _tasksCache = tasks;
    renderGroupView();
}

async function openTasksView() {
    _view = 'tasks';
    _tasksCache = [];
    renderGroupView();
    try {
        await flushGroup(_openGroupId);
    } catch { /* best-effort */ }
    await refreshTasksView();
    // ثبت خواندن تسک‌ها + تازه‌سازی بج‌ها (best-effort)
    markCurrentGroupRead('tasks').then(() => refreshGroupBadges()).catch(() => {});
}

async function startGroupTaskEdit(t) {
    const sec = groupsSection();
    if (!sec) return;
    // ویرایش inline ساده: ورودی + ذخیره/انصراف
    const rows = [...sec.querySelectorAll('.conv-row')];
    const row = rows.find((r) => r.textContent.includes(groupTaskTitle(t)));
    if (!row) return;
    row.replaceChildren();
    const input = el('input', 'conv-input');
    input.value = groupTaskTitle(t) === '…' ? '' : groupTaskTitle(t);
    input.setAttribute('maxlength', '500');
    const save = el('button', 'conv-mini-btn', tr('gtask.save', 'ذخیره'));
    save.type = 'button';
    save.addEventListener('click', async () => {
        const text = input.value.trim();
        if (!text) return;
        save.disabled = true;
        await enqueueGroupOp(_openGroupId, 'save', t.id, { kind: t.kind || 'task', payload: { title: text } });
        await flushGroup(_openGroupId);
        await refreshTasksView();
    });
    const cancel = el('button', 'conv-mini-btn', tr('gtask.cancel', 'انصراف'));
    cancel.type = 'button';
    cancel.addEventListener('click', () => renderGroupView());
    row.appendChild(input);
    row.appendChild(save);
    row.appendChild(cancel);
    input.focus();
}

async function deleteGroupTask(taskId) {
    const ok = await showConfirmModal({
        title: tr('msg.delete', 'حذف'),
        message: tr('gtask.deleteConfirm', 'این تسک حذف شود؟'),
        danger: true,
    });
    if (!ok) return;
    await enqueueGroupOp(_openGroupId, 'delete', taskId, null);
    await flushGroup(_openGroupId);
    await refreshTasksView();
}

function roleLabel(role) {
    if (role === 'owner') return tr('grp.roleOwner', 'مالک');
    if (role === 'admin') return tr('grp.roleAdmin', 'مدیر');
    return tr('grp.roleMember', 'عضو');
}

export async function openGroup(groupId) {
    _openGroupId = groupId;
    _view = 'timeline';
    _group = null;
    _items = [];
    _cursor = null;
    _hasMore = false;
    renderGroupSkeleton();
    if (!isOnline()) return;
    _loading = true;
    // ⚠️ 8.3-C: اول flush صف pending همین گروه (pull بعدی شامل آن‌ها می‌شود)
    try {
        await flushGroup(groupId);
    } catch { /* best-effort */ }
    const [detailRes, tlRes, memRes] = await Promise.all([
        apiFetch('/api/groups/' + encodeURIComponent(groupId)),
        fetchTimeline(groupId, null),
        fetchMembers(groupId),
    ]);
    _loading = false;
    if (!detailRes.ok) return;
    _group = detailRes.data.group;
    _myRole = detailRes.data.myRole || null;
    if (tlRes.ok) {
        _items = (tlRes.data.items || []).map((it) => ({ ...it, mine: false }));
        _cursor = tlRes.data.nextCursor || null;
        _hasMore = !!tlRes.data.nextCursor;
    }
    if (memRes.ok) _members = memRes.data.members || [];
    renderGroupView();
    // ثبت خواندن همه + تازه‌سازی بج‌ها (best-effort)
    markCurrentGroupRead('all').then(() => refreshGroupBadges()).catch(() => {});
}

function renderGroupSkeleton() {
    const sec = groupsSection();
    if (!sec) return;
    sec.replaceChildren();
    sec.appendChild(el('p', null, '…'));
}

export async function loadMoreTimeline() {
    if (!_openGroupId || !_hasMore || _loading || !_cursor) return;
    _loading = true;
    const res = await fetchTimeline(_openGroupId, _cursor);
    _loading = false;
    if (!res.ok) return;
    _items = _items.concat((res.data.items || []).map((it) => ({ ...it, mine: false })));
    _cursor = res.data.nextCursor || null;
    _hasMore = !!res.data.nextCursor;
    renderGroupView();
}

/**
 * دریافت کل تایم‌لاین یک گروه (برای بکاپ — حداکثر ۲۰ صفحه).
 */
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

function myUserId() {
    try {
        return (state.sync && state.sync.userId) || null;
    } catch {
        return null;
    }
}

/**
 * inbox دعوت‌های خودم (بالای لیست گروه‌ها).
 */
async function renderInbox(sec) {
    let mine = [];
    try {
        const res = await apiFetch('/api/invitations/mine');
        if (res.ok) mine = (res.data && res.data.invitations) || [];
    } catch {
        mine = [];
    }
    if (mine.length === 0) return;
    sec.appendChild(el('div', 'conv-section', tr('grp.myInvitations', 'دعوت‌های من')));
    for (const inv of mine) {
        const row = el('div', 'conv-row conv-request');
        row.appendChild(el('span', 'conv-avatar', '👥'));
        const mid = el('span', 'conv-main');
        mid.appendChild(el('span', 'conv-name', inv.groupName || '…'));
        row.appendChild(mid);
        const okBtn = el('button', 'conv-mini-btn', tr('conn.accept', 'قبول'));
        okBtn.type = 'button';
        okBtn.addEventListener('click', async () => {
            await apiFetch(
                '/api/groups/' + encodeURIComponent(inv.groupId) +
                '/invitations/' + encodeURIComponent(inv.id) + '/accept',
                { method: 'POST' }
            );
            await openGroupsWorkspace();
        });
        const noBtn = el('button', 'conv-mini-btn', tr('conn.reject', 'رد'));
        noBtn.type = 'button';
        noBtn.addEventListener('click', async () => {
            await apiFetch(
                '/api/groups/' + encodeURIComponent(inv.groupId) +
                '/invitations/' + encodeURIComponent(inv.id) + '/reject',
                { method: 'POST' }
            );
            await openGroupsWorkspace();
        });
        row.appendChild(okBtn);
        row.appendChild(noBtn);
        sec.appendChild(row);
    }
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
    for (const g of _groups) {
        try {
            const res = await apiFetch('/api/groups/' + encodeURIComponent(g.id) + '/unread');
            if (!res.ok) continue;
            const u = (res.data && res.data.unread) || { messages: 0, tasks: 0 };
            const total = (Number(u.messages) || 0) + (Number(u.tasks) || 0);
            unreadByGroup.set(String(g.id), total);
            const badge = document.querySelector('[data-group-unread="' + String(g.id).replace(/"/g, '') + '"]');
            if (badge) setBadge(badge, total);
        } catch { /* best-effort per group */ }
    }
    try {
        const rows = (_groups || []).map((g) => ({
            id: String(g.id),
            name: g.name || '…',
            avatarUrl: g.avatarUrl || null,
            unread: unreadByGroup.get(String(g.id)) || 0,
        }));
        rows.sort((a, b) => (b.unread || 0) - (a.unread || 0));
        setRecentGroups(rows.slice(0, 3));
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
    _items = [];
    _cursor = null;
    _hasMore = false;
    _loading = false;
    _view = 'timeline';
    _tasksCache = [];
    _pendingJoinToken = null;
}
export function __getGroupsStateForTest() {
    return { groups: _groups, openGroupId: _openGroupId, items: _items, members: _members, view: _view };
}
