// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/ui/sheet.js -- باتم‌شیت اکشن‌ها (Phase 8 — T4)
//
// ⚠️ قرارداد UI-SHELL §۲.۴: شیت اکشن‌های زمینه‌محور (نه ناوبری).
//    بدون innerHTML — فقط DOM API و textContent.
//    یک شیت در هر لحظه؛ بستن با اسکریم/Escape ؛ فوکوس‌ترپ.
// ═══════════════════════════════════════════════════════════════════════════

import { trapFocus } from '../core.js';

let _untrap = null;
let _opener = null;

function sheetRoot() {
    return document.getElementById('sheetRoot');
}

function sheetEl() {
    return document.getElementById('sheet');
}

/**
 * آیا شیت باز است؟
 */
export function isSheetOpen() {
    const root = sheetRoot();
    return !!root && !root.hidden;
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
}

/**
 * باز کردن شیت اکشن.
 *
 * @param {Object} options
 * @param {string} options.title
 * @param {Array<{id:string,label:string,icon?:string}>} options.actions
 * @param {(id:string) => void} options.onSelect
 * @param {Element} [options.opener]
 */
export function openSheet({ title, actions, onSelect, opener }) {
    const root = sheetRoot();
    const sheet = sheetEl();
    if (!root || !sheet || !Array.isArray(actions) || actions.length === 0) return;
    closeSheet();

    _opener = opener || document.activeElement || null;
    sheet.replaceChildren();

    if (title) {
        sheet.appendChild(el('div', 'sheet-title', title));
    }

    for (const action of actions) {
        if (!action || typeof action.id !== 'string') continue;
        const btn = el('button', 'sheet-action');
        btn.type = 'button';
        btn.dataset.actionId = action.id;
        if (action.icon) {
            const ic = el('span', 'sheet-action-icon', action.icon);
            ic.setAttribute('aria-hidden', 'true');
            btn.appendChild(ic);
        }
        btn.appendChild(el('span', 'sheet-action-label', String(action.label ?? action.id)));
        btn.addEventListener('click', () => {
            const id = action.id;
            closeSheet();
            if (typeof onSelect === 'function') onSelect(id);
        });
        sheet.appendChild(btn);
    }

    root.hidden = false;
    document.body.classList.add('sheet-open');
    try {
        if (_untrap) _untrap();
        _untrap = trapFocus(sheet);
        const first = sheet.querySelector('button');
        if (first) first.focus();
    } catch { /* silent */ }
}

/**
 * بستن شیت.
 */
export function closeSheet() {
    const root = sheetRoot();
    if (!root || root.hidden) return;
    root.hidden = true;
    document.body.classList.remove('sheet-open');
    try {
        if (_untrap) { _untrap(); _untrap = null; }
    } catch { /* silent */ }
    if (_opener && document.contains(_opener) && typeof _opener.focus === 'function') {
        try { _opener.focus(); } catch { /* silent */ }
    }
    _opener = null;
}

/**
 * راه‌اندازی (idempotent).
 */
export function initSheet() {
    const root = sheetRoot();
    if (!root || root.dataset.bound) return;
    root.dataset.bound = '1';
    const scrim = document.getElementById('sheetScrim');
    if (scrim) scrim.addEventListener('click', () => closeSheet());
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isSheetOpen()) closeSheet();
    });
}
