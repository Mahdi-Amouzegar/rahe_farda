// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/detail-photos-render.test.js — رندر واقعی شبکه‌ی عکس در جزئیات (10.31)
//
// ⚠️ ریشه‌ی BUG-38: `renderDetailPhotos` به `isDeadPhotoRef` ارجاع می‌داد که
// import نشده بود. خطا داخل `openDetail` با `.catch()` بلعیده می‌شد، پس فقط
// در کنسول دیده می‌شد و شبکه‌ی عکس‌ها خالی می‌ماند. هیچ تستی این مسیر را
// اجرا نمی‌کرد؛ این فایل همان شکاف را می‌بندد.

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../js/i18n.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        t: (key) => key,
        formatNumber: (n) => String(n),
        formatDate: (iso) => String(iso),
    };
});

import { state } from '../js/core.js';
import { renderDetailPhotos } from '../js/detail.js';

const GRID = '<div id="photoGrid"></div><span id="photoCount"></span>'
    + '<div class="photo-actions"></div><div id="photoLimitHint"></div>';

const photo = (over = {}) => ({
    id: 'p1',
    contentType: 'image/jpeg',
    sizeBytes: 1024,
    ...over,
});

function seed(task) {
    state.tasks = [task];
    state.currentDetailId = task.id;
    state.sync.enabled = false;
    state.sync.authToken = null;
}

beforeEach(() => {
    document.body.innerHTML = GRID;
    state.tasks = [];
    state.currentDetailId = null;
});

describe('renderDetailPhotos — بدون استثنا و با خروجی درست', () => {
    it('بدون خطا اجرا می‌شود و عکس dataUrl‌دار را نشان می‌دهد', async () => {
        seed({
            id: 't1',
            text: 'x',
            photos: [photo({ dataUrl: 'data:image/jpeg;base64,AAAA' })],
        });

        await expect(renderDetailPhotos()).resolves.toBeUndefined();

        const imgs = document.querySelectorAll('#photoGrid img');
        expect(imgs).toHaveLength(1);
        expect(imgs[0].getAttribute('src')).toBe('data:image/jpeg;base64,AAAA');
        expect(document.getElementById('photoCount').textContent).toContain('1');
    });

    it('عکس با ارجاع سروری (بدون بایت محلی) به‌صورت در انتظار نمایش داده می‌شود', async () => {
        seed({
            id: 't2',
            text: 'x',
            photos: [photo({ serverMediaId: 'srv-1' })],
        });

        await renderDetailPhotos();

        const thumbs = document.querySelectorAll('#photoGrid .photo-thumb');
        expect(thumbs).toHaveLength(1);
        expect(thumbs[0].classList.contains('photo-thumb--loading')).toBe(true);
        // ارجاع سروری «مرده» نیست → مخفی نمی‌شود
        expect(document.querySelector('#photoGrid .photo-thumb').hidden).toBe(false);
    });

    it('ارجاع مرده (نه بایت، نه سرور، نه آپلود) مخفی می‌شود', async () => {
        seed({
            id: 't3',
            text: 'x',
            photos: [photo({ id: 'dead' })],
        });

        await renderDetailPhotos();

        expect(document.querySelectorAll('#photoGrid .photo-thumb')).toHaveLength(0);
    });

    it('بدون عکس، پیام خالی رندر می‌شود', async () => {
        seed({ id: 't4', text: 'x', photos: [] });

        await renderDetailPhotos();

        expect(document.querySelector('#photoGrid .session-empty')).not.toBeNull();
    });
});
