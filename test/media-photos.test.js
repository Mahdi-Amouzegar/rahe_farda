// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/media-photos.test.js — عکس lazy: بایت هرگز در سینک نیست

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../js/media-upload.js', () => ({
    enqueueUpload: vi.fn(async () => ({})),
    getUploadStatus: vi.fn(async () => null),
}));

import {
    stripPhotoBytesForSync,
    classifyPhotoForDisplay,
    MEDIA_CACHE_DB_NAME,
    clampZoom,
    extForContentType,
} from '../js/media-cache.js';
import { toServerOp } from '../js/sync-queue.js';
import { sanitizeTask, enqueueNewPhotosForTask } from '../js/store.js';
import { stripSharedPayload, enqueueSharedPhotosForUpload } from '../js/tasks/source.js';
import { enqueueUpload } from '../js/media-upload.js';
import { state } from '../js/core.js';

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

describe('stripSharedPayload — گروه/DM', () => {
    it('گروه: dataUrl حذف می‌شود', () => {
        const out = stripSharedPayload({ id: 't1', photos: [photo()] }, { type: 'group', groupId: 'g1' });
        expect(out.photos[0].dataUrl).toBeUndefined();
        expect(out.photos[0].id).toBe('p1');
    });
    it('DM هم strip می‌شود (آپلود/دانلود peer در سرور مجاز است)', () => {
        const out = stripSharedPayload({ id: 't1', photos: [photo()] }, { type: 'peer' });
        expect(out.photos[0].dataUrl).toBeUndefined();
        expect(out.photos[0].id).toBe('p1');
    });
    it('بدون dest: دست‌نخورده', () => {
        const task = { id: 't1', photos: [photo()] };
        expect(stripSharedPayload(task, null)).toBe(task);
    });
});

describe('enqueueSharedPhotosForUpload', () => {
    const syncWas = { enabled: false, token: null };
    beforeEach(() => {
        syncWas.enabled = state.sync.enabled;
        syncWas.token = state.sync.authToken;
        state.sync.enabled = true;
        state.sync.authToken = 'tok';
        vi.mocked(enqueueUpload).mockClear();
    });
    afterEach(() => {
        state.sync.enabled = syncWas.enabled;
        state.sync.authToken = syncWas.token;
    });
    const groupDest = { type: 'group', groupId: 'g1' };
    it('عکس جدید گروهی با groupId و taskId تهی enqueue می‌شود', async () => {
        const res = await enqueueSharedPhotosForUpload(groupDest, { id: 't1', photos: [photo()], mediaIds: [] });
        expect(res).toEqual({ enqueued: 1 });
        expect(vi.mocked(enqueueUpload)).toHaveBeenCalledTimes(1);
        const arg = vi.mocked(enqueueUpload).mock.calls[0][0];
        expect(arg.mediaId).toBe('p1');
        expect(arg.taskId).toBeNull();
        expect(arg.groupId).toBe('g1');
        expect(arg.blob instanceof Blob).toBe(true);
    });
    it('عکس آپلودشده رد می‌شود', async () => {
        const res = await enqueueSharedPhotosForUpload(groupDest, { id: 't1', photos: [photo()], mediaIds: ['p1'] });
        expect(res).toEqual({ enqueued: 0 });
        expect(vi.mocked(enqueueUpload)).not.toHaveBeenCalled();
    });
    it('عکس جدید DM با taskId تسک و بدون groupId enqueue می‌شود', async () => {
        const res = await enqueueSharedPhotosForUpload({ type: 'peer' }, { id: 'dm1', photos: [photo()], mediaIds: [] });
        expect(res).toEqual({ enqueued: 1 });
        expect(vi.mocked(enqueueUpload)).toHaveBeenCalledTimes(1);
        const arg = vi.mocked(enqueueUpload).mock.calls[0][0];
        expect(arg.mediaId).toBe('p1');
        expect(arg.taskId).toBe('dm1');
        expect(arg.groupId).toBeNull();
    });
    it('مقصد نامعتبر: هیچ enqueue', async () => {
        const res = await enqueueSharedPhotosForUpload(null, { id: 't1', photos: [photo()], mediaIds: [] });
        expect(res).toEqual({ enqueued: 0 });
        expect(vi.mocked(enqueueUpload)).not.toHaveBeenCalled();
    });
});

describe('media-cache — جدایی از spaceTodoDB', () => {
    it('کش در دیتابیس جدا باز می‌شود (بن‌بست ارتقا ندارد)', () => {
        expect(MEDIA_CACHE_DB_NAME).not.toBe('spaceTodoDB');
    });
});

describe('lightbox helpers', () => {
    it('clampZoom در بازه نگه می‌دارد', () => {
        expect(clampZoom(0.5)).toBe(1);
        expect(clampZoom(5)).toBe(3);
        expect(clampZoom(2)).toBe(2);
        expect(clampZoom(NaN)).toBe(1);
        expect(clampZoom('x')).toBe(1);
    });
    it('extForContentType پسوند درست می‌دهد', () => {
        expect(extForContentType('image/jpeg')).toBe('jpg');
        expect(extForContentType('image/png')).toBe('png');
        expect(extForContentType('image/webp')).toBe('webp');
        expect(extForContentType('image/avif')).toBe('avif');
        expect(extForContentType('image/gif')).toBe('gif');
        expect(extForContentType('application/octet-stream')).toBe('jpg');
        expect(extForContentType('')).toBe('jpg');
    });
});

describe('enqueueNewPhotosForTask — مسیر bulk', () => {
    const syncWas = { enabled: false, token: null };
    beforeEach(() => {
        syncWas.enabled = state.sync.enabled;
        syncWas.token = state.sync.authToken;
        state.sync.enabled = true;
        state.sync.authToken = 'tok';
        vi.mocked(enqueueUpload).mockClear();
    });
    afterEach(() => {
        state.sync.enabled = syncWas.enabled;
        state.sync.authToken = syncWas.token;
    });
    it('عکس dataUrlدار شخصی enqueue می‌شود (با taskId)', async () => {
        await enqueueNewPhotosForTask({ id: 't1', photos: [photo()], mediaIds: [] });
        expect(vi.mocked(enqueueUpload)).toHaveBeenCalledTimes(1);
        const arg = vi.mocked(enqueueUpload).mock.calls[0][0];
        expect(arg.mediaId).toBe('p1');
        expect(arg.taskId).toBe('t1');
        expect(arg.blob instanceof Blob).toBe(true);
    });
});
