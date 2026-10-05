// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/navigation/workspace.js -- رجیستری تک‌فضای فعال (Phase 8 — T3)
//
// ⚠️ قرارداد UI-SHELL §۵:
//   - در هر لحظه دقیقاً یک Workspace فعال است: tasks/messages/groups/search/notifications
//   - مهمان فقط tasks را می‌بیند (بقیه → رویداد AUTH_REQUIRED، بدون تغییر فضا)
//   - وضعیت هر فضا (اسکرول) هنگام جابه‌جایی حفظ می‌شود
//   - بازگشت به tasks، تب موبایل جاری را دوباره اعمال می‌کند (invalidateSize نقشه)
//   - تغییر فضا رویداد WORKSPACE_CHANGED می‌فرستد (Sidebar/هدر گوش می‌دهند)
//
// ⚠️ بدون innerHTML — این ماژول فقط hidden را جابه‌جا می‌کند.
// ═══════════════════════════════════════════════════════════════════════════

import { events, EV } from '../events.js';
import { isLoggedIn } from '../auth.js';

export const WORKSPACES = ['tasks', 'search'];

const AUTH_GATED = ['search'];

let _active = 'tasks';
let _started = false;
const _scrollMemory = new Map();

/**
 * آیا نام معتبر است؟
 */
export function isWorkspace(name) {
    return WORKSPACES.includes(name);
}

/**
 * فضای فعال فعلی.
 */
export function getActiveWorkspace() {
    return _active;
}

function tasksRoot() {
    return document.querySelector('.layout');
}

function mobileTabs() {
    return document.querySelector('.mobile-tabs');
}

function mapPanel() {
    return document.getElementById('panelMap');
}

function workspaceRoot() {
    return document.getElementById('workspaceRoot');
}

function sectionFor(name) {
    return document.getElementById('ws-' + name);
}

function currentScrollHost() {
    if (_active === 'tasks') return tasksRoot();
    return workspaceRoot();
}

function rememberScroll() {
    const host = currentScrollHost();
    if (host) _scrollMemory.set(_active, host.scrollTop || 0);
}

function restoreScroll(name) {
    const host = name === 'tasks' ? tasksRoot() : workspaceRoot();
    if (host && _scrollMemory.has(name)) {
        try { host.scrollTop = _scrollMemory.get(name); } catch { /* silent */ }
    }
}

/**
 * اعمال دوباره‌ی تب موبایل جاری (برای invalidateSize نقشه هنگام بازگشت).
 * بدون import از map.js — با کلیک مصنوعی روی تب فعال، رفتار موجود بازتولید می‌شود.
 */
function reassertMobileTab() {
    try {
        const activeTab = document.querySelector('.mobile-tab.active');
        if (activeTab && typeof activeTab.click === 'function') {
            activeTab.click();
        }
    } catch { /* silent */ }
}

/**
 * جابه‌جایی فضا.
 *
 * @param {string} name
 * @returns {boolean} true اگر سوییچ انجام شد
 */
export function switchWorkspace(name) {
    if (!isWorkspace(name)) return false;
    if (name === _active) return true;

    // ─── گیت مهمان ───
    if (AUTH_GATED.includes(name) && !isLoggedIn()) {
        events.emit(EV.AUTH_REQUIRED, { workspace: name });
        return false;
    }

    const from = _active;
    rememberScroll();

    const layout = tasksRoot();
    const tabs = mobileTabs();
    const map = mapPanel();
    const root = workspaceRoot();

    if (name === 'tasks') {
        if (root) root.hidden = true;
        for (const ws of AUTH_GATED) {
            const sec = sectionFor(ws);
            if (sec) sec.hidden = true;
        }
        if (layout) layout.hidden = false;
        if (tabs) tabs.hidden = false;
        if (map) map.hidden = false;
        _active = 'tasks';
        restoreScroll('tasks');
        reassertMobileTab();
    } else {
        if (layout) layout.hidden = true;
        if (tabs) tabs.hidden = true;
        if (map) map.hidden = true;
        if (root) {
            root.hidden = false;
            for (const ws of AUTH_GATED) {
                const sec = sectionFor(ws);
                if (sec) sec.hidden = ws !== name;
            }
        }
        _active = name;
        restoreScroll(name);
    }

    events.emit(EV.WORKSPACE_CHANGED, { from, to: _active });
    return true;
}

/**
 * راه‌اندازی (idempotent). وضعیت اولیه = tasks.
 */
export function initWorkspace() {
    if (_started) return;
    _started = true;
    _active = 'tasks';
}

// ⚠️ فقط برای تست — ریست وضعیت ماژول
export function __resetWorkspaceForTest() {
    _active = 'tasks';
    _started = false;
    _scrollMemory.clear();
}
