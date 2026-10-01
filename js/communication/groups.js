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
import { t as i18nT, formatDateTime } from '../i18n.js';
import { isOnline } from '../net.js';
import { openMenu } from '../ui/menu.js';
import {
    messageBodyNode,
    displayNameOf,
    initLocationPreviews,
} from './conversations.js';

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

function memberName(userId) {
    const m = _members.find((x) => x.userId === userId);
    if (m && m.username) return m.username;
    return String(userId || '').slice(0, 8);
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

function renderGroupsHome(state) {
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
    if (_groups.length === 0) {
        sec.appendChild(el('p', null, tr('workspace.groupsEmpty', '')));
        return;
    }

    const list = el('div', 'conv-list');
    list.setAttribute('role', 'list');
    for (const g of _groups) {
        const row = el('button', 'conv-row');
        row.type = 'button';
        row.setAttribute('role', 'listitem');
        const avatar = el('span', 'conv-avatar', (g.name || '?').trim().charAt(0) || '?');
        avatar.setAttribute('aria-hidden', 'true');
        row.appendChild(avatar);
        row.appendChild(el('span', 'conv-name', g.name || '…'));
        row.addEventListener('click', () => openGroup(g.id));
        list.appendChild(row);
    }
    sec.appendChild(list);
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
        renderGroupsHome('offline');
        return;
    }
    const res = await listGroups();
    if (!res.ok) {
        renderGroupsHome('error');
        return;
    }
    renderGroupsHome('list');
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
    const titleWrap = el('span', 'conv-title');
    titleWrap.appendChild(el('span', null, _group.name || '…'));
    head.appendChild(titleWrap);
    const menu = el('button', 'conv-menu-btn', '⋯');
    menu.type = 'button';
    menu.setAttribute('aria-label', tr('msg.moreAria', 'گزینه‌ها'));
    menu.addEventListener('click', () => {
        // ⚠️ 8.3-A: فقط اعضا (مدیریت در 8.3-B)
        openMenu({
            anchor: menu,
            items: [{ id: 'members', label: tr('grp.members', 'اعضا') }],
            onSelect: (id) => {
                if (id === 'members') {
                    _view = 'members';
                    renderGroupView();
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

    const box = el('div', 'conv-box');
    box.id = 'convBox';
    // API نزولی برمی‌گرداند؛ قدیمی‌تر اول نمایش بده
    for (const item of [..._items].reverse()) {
        box.appendChild(timelineNode(item));
    }
    sec.appendChild(box);

    if (_hasMore) {
        const more = el('button', 'conv-more', tr('grp.loadMore', 'قدیمی‌تر'));
        more.type = 'button';
        more.addEventListener('click', () => loadMoreTimeline());
        sec.appendChild(more);
    }

    const composer = el('div', 'conv-composer');
    const input = el('input', 'conv-input');
    input.id = 'grpInput';
    input.setAttribute('placeholder', tr('msg.placeholder', '…'));
    input.setAttribute('maxlength', '2000');
    input.setAttribute('autocomplete', 'off');
    const send = el('button', 'conv-send', tr('msg.send', '➤'));
    send.type = 'button';
    const doSend = () => sendGroupText();
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

    box.scrollTop = box.scrollHeight;
    initLocationPreviews(box);
}

function timelineNode(item) {
    const wrap = el('div', 'msg');
    if (item.entityType === 'group_task') {
        wrap.appendChild(groupTaskNode(item));
    } else {
        // پیام گروهی → همان رندر DM (بدون اکشن در A)
        wrap.appendChild(
            messageBodyNode({
                kind: item.kind || 'text',
                body: item.body || '',
                metadata: item.metadata || null,
            })
        );
    }
    const meta = el('div', 'msg-meta');
    try {
        const who = item.actorId ? memberName(item.actorId) : '';
        meta.textContent = (who ? who + ' • ' : '') + formatDateTime(item.createdAt);
    } catch {
        meta.textContent = '';
    }
    wrap.appendChild(meta);
    return wrap;
}

/**
 * تسک تایم‌لاین فقط خواندنی (payload JSON است، نه snapshot).
 */
function groupTaskNode(item) {
    const card = el('div', 'msg-task-card');
    let title = '';
    try {
        const payload = typeof item.body === 'string' ? JSON.parse(item.body) : item.body;
        title = String((payload && (payload.text || payload.title)) || '').slice(0, 200);
    } catch {
        title = '';
    }
    card.appendChild(el('div', 'msg-task-title', '📋 ' + (title || '…')));
    return card;
}

function renderMembersView(sec) {
    const box = el('div', 'conv-box');
    for (const m of _members) {
        const row = el('div', 'conv-row');
        const avatar = el('span', 'conv-avatar', ((m.username || '?').trim().charAt(0) || '?'));
        avatar.setAttribute('aria-hidden', 'true');
        row.appendChild(avatar);
        row.appendChild(el('span', 'conv-name', m.username || String(m.userId || '').slice(0, 8)));
        row.appendChild(el('span', 'conv-role', roleLabel(m.role)));
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

export async function sendGroupText() {
    const input = document.getElementById('grpInput');
    if (!input || _loading || !_openGroupId) return;
    const body = input.value.trim();
    if (!body) return;
    _loading = true;
    const res = await apiFetch('/api/groups/' + encodeURIComponent(_openGroupId) + '/messages', {
        method: 'POST',
        body: { body, kind: 'text' },
    });
    _loading = false;
    if (!res.ok) {
        input.setAttribute('aria-invalid', 'true');
        input.title = apiErrorMessage(res.error);
        return;
    }
    input.value = '';
    await openGroup(_openGroupId);
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
}
export function __getGroupsStateForTest() {
    return { groups: _groups, openGroupId: _openGroupId, items: _items, members: _members, view: _view };
}
