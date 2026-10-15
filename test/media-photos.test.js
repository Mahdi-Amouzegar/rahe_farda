// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/media-photos.test.js — عکس lazy: بایت هرگز در سینک نیست

import { describe, it, expect } from 'vitest';
import {
    stripPhotoBytesForSync,
    classifyPhotoForDisplay,
} from '../js/media-cache.js';
import { toServerOp } from '../js/sync-queue.js';
import { sanitizeTask } from '../js/store.js';

const photo = (over = {}) => ({
    id: 'p1',
    dataUrl: 'data:image/jpeg;base64,AAA',
    addedAt: '2026-10-14T00:00:00.000Z',
    contentType: 'image/jpeg',
    sizeBytes: 10,
    ...over,
});

describe('stripPhotoBytesForSync', () => {
    it('dataUrl را حذف و ارجاع را نگه می‌دارد', () => {
        const task = { id: 't1', photos: [photo({ serverMediaId: 'srv1' })] };
        const out = stripPhotoBytesForSync(task);
        expect(out.photos[0].dataUrl).toBeUndefined();
        expect(out.photos[0].id).toBe('p1');
        expect(out.photos[0].serverMediaId).toBe('srv1');
        expect(out.photos[0].sizeBytes).toBe(10);
    });
    it('ورودی را mutate نمی‌کند', () => {
        const task = { id: 't1', photos: [photo()] };
        stripPhotoBytesForSync(task);
        expect(task.photos[0].dataUrl).toBe('data:image/jpeg;base64,AAA');
    });
    it('عکس فرزندان plan هم strip می‌شود', () => {
        const task = { id: 't1', photos: [], children: [{ id: 'c1', photos: [photo()] }] };
        const out = stripPhotoBytesForSync(task);
        expect(out.children[0].photos[0].dataUrl).toBeUndefined();
    });
    it('تسک بدون عکس همان ارجاع برمی‌گردد', () => {
        const task = { id: 't1', photos: [] };
        expect(stripPhotoBytesForSync(task)).toBe(task);
    });
});

describe('classifyPhotoForDisplay', () => {
    it('کش → cache', () => {
        expect(classifyPhotoForDisplay(photo(), { cached: true, online: true, authed: true })).toBe('cache');
    });
    it('dataUrl → dataUrl', () => {
        expect(classifyPhotoForDisplay(photo(), { cached: false, online: false, authed: false })).toBe('dataUrl');
    });
    it('ارجاع سروری + آنلاین → fetch', () => {
        const p = photo({ dataUrl: undefined, serverMediaId: 'srv1' });
        expect(classifyPhotoForDisplay(p, { cached: false, online: true, authed: true })).toBe('fetch');
    });
    it('آفلاین → pending (درخواست دوباره نه)', () => {
        const p = photo({ dataUrl: undefined, serverMediaId: 'srv1' });
        expect(classifyPhotoForDisplay(p, { cached: false, online: false, authed: true })).toBe('pending');
    });
    it('null → pending', () => {
        expect(classifyPhotoForDisplay(null, { cached: false, online: true, authed: true })).toBe('pending');
    });
});

describe('toServerOp — بدون بایت عکس', () => {
    it('dataUrl از data حذف می‌شود ولی صف دست نمی‌خورد', () => {
        const entry = {
            id: 'op1', type: 'save', entityId: 't1', entityType: 'task',
            data: { id: 't1', photos: [photo()] },
            timestamp: '2026-10-14T00:00:00.000Z',
        };
        const op = toServerOp(entry);
        expect(op.data.photos[0].dataUrl).toBeUndefined();
        expect(op.data.photos[0].id).toBe('p1');
        expect(entry.data.photos[0].dataUrl).toBe('data:image/jpeg;base64,AAA');
    });
});

describe('sanitizeTask — عکس آپلودشده', () => {
    const base = () => ({
        id: 't1', text: 'x', createdAt: '2026-10-14T00:00:00.000Z',
        photos: [photo({ serverMediaId: 'srv1' })],
        mediaIds: ['p1'],
    });
    it('dataUrl عکس آپلودشده حذف و serverMediaId می‌ماند', () => {
        const out = sanitizeTask(base());
        expect(out.photos).toHaveLength(1);
        expect(out.photos[0].dataUrl).toBeUndefined();
        expect(out.photos[0].serverMediaId).toBe('srv1');
    });
    it('عکس هنوزآپلودنشده dataUrl را نگه می‌دارد', () => {
        const t = base();
        t.mediaIds = [];
        delete t.photos[0].serverMediaId;
        const out = sanitizeTask(t);
        expect(out.photos[0].dataUrl).toBe('data:image/jpeg;base64,AAA');
    });
    it('ارجاع آپلودشده در sanitize بعدی حذف نمی‌شود', () => {
        const once = sanitizeTask(base());
        const twice = sanitizeTask({ ...once, mediaIds: ['p1'] });
        expect(twice.photos).toHaveLength(1);
        expect(twice.photos[0].serverMediaId).toBe('srv1');
    });
});
