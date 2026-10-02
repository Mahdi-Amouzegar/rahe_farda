// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/communication/search.js -- جستجوی سراسری کاربران و گروه‌های عمومی (8.3-D)
//
// ⚠️ فقط واردشده‌ها (فضا گیت ورود دارد). بدون innerHTML.
// ⚠️ گروه عمومی که عضوش نیستی: فقط نمایش + توضیح (عضویت فقط با دعوت است).
// ═══════════════════════════════════════════════════════════════════════════

import { apiFetch, apiErrorMessage } from '../api.js';
import { t as i18nT } from '../i18n.js';
import { isOnline } from '../net.js';
import { avatarNode } from '../ui/avatar.js';
import { showInfoModal } from '../core.js';
import { switchWorkspace } from '../navigation/workspace.js';
import { displayNameOf } from './conversations.js';
import { openGroup } from './groups.js';

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

function searchSection() {
    return document.getElementById('ws-search');
}

let _memberGroupIds = null;

async function loadMyGroupIds() {
    if (_memberGroupIds) return _memberGroupIds;
    try {
        const res = await apiFetch('/api/groups');
        _memberGroupIds = new Set(
            ((res.ok && res.data && res.data.groups) || []).map((g) => g.id)
        );
    } catch {
        _memberGroupIds = new Set();
    }
    return _memberGroupIds;
}

function userRow(u) {
    const row = el('div', 'conv-row');
    row.appendChild(avatarNode(u.avatarUrl, displayNameOf(u)));
    row.appendChild(el('span', 'conv-name', displayNameOf(u)));
    const req = el('button', 'conv-mini-btn', tr('conn.request', 'درخواست'));
    req.type = 'button';
    req.addEventListener('click', async () => {
        const res = await apiFetch('/api/connections/request', {
            method: 'POST',
            body: { targetUserId: u.id },
        });
        req.disabled = true;
        req.textContent = res.ok
            ? tr('conn.requestSent', 'فرستاده شد')
            : apiErrorMessage(res.error);
    });
    row.appendChild(req);
    return row;
}

function groupRow(g, isMember) {
    const row = el('button', 'conv-row grp-row');
    row.type = 'button';
    row.appendChild(avatarNode(g.avatarUrl, g.name || '?'));
    row.appendChild(el('span', 'conv-name', g.name || '…'));
    row.addEventListener('click', async () => {
        if (isMember) {
            if (switchWorkspace('groups')) openGroup(g.id);
        } else {
            showInfoModal({
                title: g.name || '',
                paragraphs: [tr('search.inviteOnly', 'عضویت در گروه فقط با دعوت ممکن است.')],
            });
        }
    });
    return row;
}

async function runSearch(query, type, resultsBox) {
    resultsBox.replaceChildren();
    if (query.length < 3) return;
    const res = await apiFetch(
        '/api/search?q=' + encodeURIComponent(query) + '&type=' + type
    );
    if (!res.ok) {
        resultsBox.appendChild(el('p', null, apiErrorMessage(res.error)));
        return;
    }
    const data = res.data || {};
    let empty = true;
    if ((type === 'user' || type === 'all') && Array.isArray(data.users)) {
        if (data.users.length > 0) {
            resultsBox.appendChild(el('div', 'conv-section', tr('search.users', 'کاربران')));
            for (const u of data.users) resultsBox.appendChild(userRow(u));
            empty = false;
        }
    }
    if ((type === 'group' || type === 'all') && Array.isArray(data.groups)) {
        if (data.groups.length > 0) {
            const memberIds = await loadMyGroupIds();
            resultsBox.appendChild(el('div', 'conv-section', tr('search.groups', 'گروه‌ها')));
            for (const g of data.groups) {
                resultsBox.appendChild(groupRow(g, memberIds.has(g.id)));
            }
            empty = false;
        }
    }
    if (empty) {
        resultsBox.appendChild(el('p', null, tr('search.noResults', 'نتیجه‌ای نیست.')));
    }
}

/**
 * ورود به فضای جستجو.
 */
export async function openSearchWorkspace() {
    const sec = searchSection();
    if (!sec) return;
    sec.replaceChildren();
    sec.appendChild(el('h2', null, tr('workspace.searchTitle', '🔎 جستجو')));
    if (!isOnline()) {
        sec.appendChild(el('p', null, tr('msg.offline', 'آفلاین هستی.')));
        return;
    }
    const bar = el('div', 'conv-composer');
    const input = el('input', 'conv-input');
    input.id = 'globalSearchInput';
    input.setAttribute('placeholder', tr('search.placeholder', 'نام کاربر یا گروه… (حداقل ۳ حرف)'));
    input.setAttribute('maxlength', '50');
    input.setAttribute('autocomplete', 'off');
    const typeSel = el('select', 'conv-type-select');
    for (const [value, key, fallback] of [
        ['all', 'search.typeAll', 'همه'],
        ['user', 'search.typeUser', 'کاربر'],
        ['group', 'search.typeGroup', 'گروه'],
    ]) {
        const opt = el('option', null, tr(key, fallback));
        opt.value = value;
        typeSel.appendChild(opt);
    }
    bar.appendChild(input);
    bar.appendChild(typeSel);
    sec.appendChild(bar);
    const results = el('div', 'conv-list');
    sec.appendChild(results);
    let timer = null;
    const go = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            runSearch(input.value.trim(), typeSel.value, results).catch(() => {});
        }, 350);
    };
    input.addEventListener('input', go);
    typeSel.addEventListener('change', () => {
        runSearch(input.value.trim(), typeSel.value, results).catch(() => {});
    });
}

// ⚠️ فقط برای تست
export function __resetSearchForTest() {
    _memberGroupIds = null;
}
