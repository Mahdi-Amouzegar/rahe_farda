// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/map-lifecycle.test.js — تست‌های لایف‌سایکل نقشه در Shell (T5)
//
// ⚠️ نقشه‌ی واقعی (Leaflet) در jsdom ساخته نمی‌شود؛ این تست‌ها سیم‌کشی
//    رویدادها و امن‌بودن no-op را قفل می‌کنند، نه رندر کاشی‌ها.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../js/i18n.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, t: (key) => key };
});

import { events, EV } from '../js/events.js';
import { refreshMapSize, getMapReady } from '../js/map.js';

beforeEach(() => {
    vi.useFakeTimers();
});

describe('map lifecycle', () => {
    it('refreshMapSize بدون نقشه خطا نمی‌دهد (no-op)', () => {
        expect(getMapReady()).toBe(false);
        expect(() => refreshMapSize()).not.toThrow();
    });

    it('WORKSPACE_CHANGED به‌سمت tasks خطا نمی‌دهد', () => {
        expect(() => events.emit(EV.WORKSPACE_CHANGED, { from: 'messages', to: 'tasks' })).not.toThrow();
        vi.runAllTimers();
    });

    it('WORKSPACE_CHANGED به‌سمت دیگر نادیده گرفته می‌شود', () => {
        expect(() => events.emit(EV.WORKSPACE_CHANGED, { from: 'tasks', to: 'groups' })).not.toThrow();
        vi.runAllTimers();
    });
});
