// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/detail-readonly.test.js — جزئیات فقط‌خواندنی وظیفه‌ی دیگران (10.25)
//
// ⚠️ هدف: کلیک «جزئیات» روی وظیفه‌ی فرستاده‌شده باید صفحه را باز کند،
// همه‌چیز قابل‌دیدن باشد، ولی هیچ ورودی/دکمه‌ی تغییردهنده‌ای فعال نماند.
// پیش‌نمایش/دانلود عکس دست‌نخورده است (حذف/افزودن پنهان).

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../js/i18n.js', async (importOriginal) => {
    const actual = await importOriginal();
    // t شبیه‌سازی‌شده: کلید + پارامترهای جای‌گذاری‌شده (برای بررسی نام فرستنده)
    return { ...actual, t: (key, p) => (p && p.name ? `${key} ${p.name}` : key) };
});

import { state } from '../js/core.js';
import {
    setDetailBridge,
    clearDetailBridge,
    isDetailBridgeReadOnly,
    __resetSharedForTest,
} from '../js/tasks/source.js';
import { applyDetailReadOnly } from '../js/detail.js';

const ROOT = `
<section id="detailPage">
    <div class="detail-header"><h2 id="detailTitle"></h2>
        <span id="detailReadonlyBadge" hidden></span></div>
    <div id="detailReadonlyBanner" hidden><span id="detailReadonlyText"></span></div>
    <section data-detail-section="basic"><span class="detail-section-status">editable</span>
        <input id="fTitle"><textarea id="fDesc"></textarea>
        <select id="fPriority"></select><input type="checkbox" id="fPin">
    </section>
    <input id="fPhone"><textarea id="fAddr"></textarea><input id="fUrl">
    <select id="fRecur"></select><input type="number" id="fRecurN">
    <button id="addSessionBtn"></button><button id="timerToggle"></button>
    <button id="detailPlanStartBtn"></button><button id="detailPlanEndBtn"></button>
    <button id="detailPlanDatesClear"></button>
    <button id="detailLocChange"></button><button id="detailLocRemove"></button>
    <button id="detailDelete"></button>
    <div class="photo-actions"><label>افزودن</label></div>
</section>`;

const other = {
    id: 'd1',
    text: 'از سارا',
    kind: 'task',
    _shared: { mine: false, dest: { type: 'peer', peerId: 'u2' }, remoteId: 'd1', senderName: 'سارا' },
};
const mine = {
    id: 'd2',
    text: 'از من',
    kind: 'task',
    _shared: { mine: true, dest: { type: 'peer', peerId: 'u2' }, remoteId: 'd2', senderName: null },
};

const $ = (id) => document.getElementById(id);

beforeEach(() => {
    document.body.innerHTML = ROOT;
    __resetSharedForTest();
    clearDetailBridge();
    state.tasks = [];
    state.currentDetailId = null;
});

describe('detail read-only — DOM', () => {
    it('آیتم دیگران: ورودی‌ها قفل و دکمه‌های ویرایش پنهان می‌شوند', () => {
        setDetailBridge(other, { readOnly: true });
        state.currentDetailId = 'd1';
        expect(isDetailBridgeReadOnly()).toBe(true);

        applyDetailReadOnly(true);

        expect($('detailPage').classList.contains('readonly')).toBe(true);
        // متن‌ها: readOnly (نه disabled — متن قابل انتخاب/کپی می‌ماند)
        ['fTitle', 'fDesc', 'fPhone', 'fAddr', 'fUrl'].forEach(id => {
            expect($(id).readOnly).toBe(true);
            expect($(id).disabled).toBe(false);
        });
        // انتخاب‌گرها: disabled
        ['fPriority', 'fRecur', 'fRecurN', 'fPin'].forEach(id => {
            expect($(id).disabled).toBe(true);
        });
        // دکمه‌های تغییردهنده پنهان
        ['addSessionBtn', 'timerToggle', 'detailPlanStartBtn', 'detailPlanEndBtn',
            'detailPlanDatesClear', 'detailLocChange', 'detailLocRemove', 'detailDelete'
        ].forEach(id => {
            expect($(id).hidden).toBe(true);
        });
        // افزودن عکس پنهان، بنر/بج دیده می‌شود
        expect(document.querySelector('#detailPage .photo-actions').hidden).toBe(true);
        expect($('detailReadonlyBanner').hidden).toBe(false);
        expect($('detailReadonlyBadge').hidden).toBe(false);
        expect($('detailReadonlyText').textContent).toContain('سارا');
    });

    it('آیتم خودی: بعد از بستن حالت خواندنی همه‌چیز برمی‌گردد', () => {
        setDetailBridge(other, { readOnly: true });
        state.currentDetailId = 'd1';
        applyDetailReadOnly(true);
        clearDetailBridge();

        setDetailBridge(mine);
        state.currentDetailId = 'd2';
        applyDetailReadOnly(false);

        expect($('detailPage').classList.contains('readonly')).toBe(false);
        expect($('fTitle').readOnly).toBe(false);
        expect($('fPriority').disabled).toBe(false);
        expect($('addSessionBtn').hidden).toBe(false);
        expect($('detailDelete').hidden).toBe(false);
        expect(document.querySelector('#detailPage .photo-actions').hidden).toBe(false);
        expect($('detailReadonlyBanner').hidden).toBe(true);
    });
});
