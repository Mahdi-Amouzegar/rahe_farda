// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/sheet.test.js — تست‌های باتم‌شیت اکشن‌ها (T4)

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../js/i18n.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, t: (key) => key };
});

import { initSheet, openSheet, closeSheet, isSheetOpen } from '../js/ui/sheet.js';

const ACTIONS = [
    { id: 'task', icon: '📝', label: 'کار جدید' },
    { id: 'plan', icon: '📂', label: 'برنامه جدید' },
];

function buildSheet() {
    document.body.innerHTML = `
        <button id="opener">⊕</button>
        <div class="sheet-root" id="sheetRoot" hidden>
            <div class="sheet-scrim" id="sheetScrim"></div>
            <section class="sheet" id="sheet" role="dialog" aria-modal="true"></section>
        </div>`;
}

beforeEach(() => {
    buildSheet();
    initSheet();
});

describe('sheet', () => {
    it('با اکشن‌ها باز می‌شود', () => {
        openSheet({ title: 'افزودن', actions: ACTIONS, onSelect: () => {} });
        expect(isSheetOpen()).toBe(true);
        expect(document.querySelectorAll('.sheet-action').length).toBe(2);
    });

    it('بدون اکشن باز نمی‌شود', () => {
        openSheet({ title: 'x', actions: [], onSelect: () => {} });
        expect(isSheetOpen()).toBe(false);
    });

    it('کلیک اکشن، onSelect را صدا می‌زند و می‌بندد', () => {
        const seen = [];
        openSheet({ title: 'x', actions: ACTIONS, onSelect: (id) => seen.push(id) });
        document.querySelector('[data-action-id="plan"]').click();
        expect(seen).toEqual(['plan']);
        expect(isSheetOpen()).toBe(false);
    });

    it('Escape می‌بندد', () => {
        openSheet({ title: 'x', actions: ACTIONS, onSelect: () => {} });
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(isSheetOpen()).toBe(false);
    });

    it('کلیک اسکریم می‌بندد', () => {
        openSheet({ title: 'x', actions: ACTIONS, onSelect: () => {} });
        document.getElementById('sheetScrim').click();
        expect(isSheetOpen()).toBe(false);
    });

    it('لیبل با textContent است (بدون HTML)', () => {
        openSheet({
            title: 'x',
            actions: [{ id: 'a', label: '<b>bold</b>' }],
            onSelect: () => {},
        });
        const btn = document.querySelector('[data-action-id="a"]');
        expect(btn.querySelector('b')).toBeNull();
        expect(btn.textContent).toContain('<b>bold</b>');
    });
});
