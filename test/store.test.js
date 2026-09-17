// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/store.test.js — تست‌های sanitization

import { describe, it, expect } from 'vitest';
import { sanitizeUrl, validLoc, sanitizeTask } from '../js/store.js';
import { MAX_LENGTH } from '../js/core.js';

describe('store — sanitizeUrl', () => {
    it('URL کامل https را حفظ می‌کند', () => {
        const r = sanitizeUrl('https://example.com/path?q=1');
        expect(r).toBe('https://example.com/path?q=1');
    });

    it('URL کامل http را حفظ می‌کند', () => {
        const r = sanitizeUrl('http://example.com');
        expect(r).toBe('http://example.com/');
    });

    it('دامنه بدون پروتکل را با https:// استاندارد می‌کند', () => {
        const r = sanitizeUrl('example.com');
        expect(r).toBe('https://example.com/');
    });

    it('دامنه با مسیر بدون پروتکل را استاندارد می‌کند', () => {
        const r = sanitizeUrl('example.com/path');
        expect(r).toBe('https://example.com/path');
    });

    it('javascript: را رد می‌کند', () => {
        expect(sanitizeUrl('javascript:alert(1)')).toBe('');
    });

    it('data: را رد می‌کند', () => {
        expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBe('');
    });

    it('ftp: را رد می‌کند', () => {
        expect(sanitizeUrl('ftp://example.com')).toBe('');
    });

    it('متن خالی را رد می‌کند', () => {
        expect(sanitizeUrl('')).toBe('');
        expect(sanitizeUrl(null)).toBe('');
        expect(sanitizeUrl(undefined)).toBe('');
        expect(sanitizeUrl(123)).toBe('');
    });

    it('متن غیر URL را رد می‌کند', () => {
        expect(sanitizeUrl('not a url')).toBe('');
    });

    it('فاصله‌های اضافی را trim می‌کند', () => {
        expect(sanitizeUrl('  example.com  ')).toBe('https://example.com/');
    });
});

describe('store — validLoc', () => {
    it('مکان معتبر را حفظ می‌کند', () => {
        const r = validLoc({ lat: 35.6892, lng: 51.389 });
        expect(r).toEqual({ lat: 35.6892, lng: 51.389, name: null });
    });

    it('مکان با نام را حفظ می‌کند', () => {
        const r = validLoc({ lat: 35.6892, lng: 51.389, name: 'خانه' });
        expect(r.name).toBe('خانه');
    });

    it('نام طولانی را trim می‌کند', () => {
        const longName = 'a'.repeat(200);
        const r = validLoc({ lat: 35, lng: 51, name: longName });
        expect(r.name.length).toBe(80);
    });

    it('lat/lng خارج از محدوده را رد می‌کند', () => {
        expect(validLoc({ lat: 100, lng: 51 })).toBe(null);
        expect(validLoc({ lat: 35, lng: 200 })).toBe(null);
    });

    it('lat/lng نامعتبر را رد می‌کند', () => {
        expect(validLoc({ lat: 'abc', lng: 51 })).toBe(null);
        expect(validLoc({ lat: 35 })).toBe(null);
        expect(validLoc(null)).toBe(null);
        expect(validLoc({})).toBe(null);
    });

    it('نام خالی را به null تبدیل می‌کند', () => {
        const r = validLoc({ lat: 35, lng: 51, name: '   ' });
        expect(r.name).toBe(null);
    });
});

describe('store — sanitizeTask', () => {
    const baseTask = {
        id: 'test-1',
        text: 'تست',
        kind: 'task',
        createdAt: new Date().toISOString()
    };

    it('task پایه را با فیلدهای پیش‌فرض برمی‌گرداند', () => {
        const r = sanitizeTask(baseTask);
        expect(r.id).toBe('test-1');
        expect(r.text).toBe('تست');
        expect(r.completed).toBe(false);
        expect(r.priority).toBe('medium');
        expect(r.kind).toBe('task');
        expect(r.sessions).toEqual([]);
        expect(r.children).toEqual([]);
        expect(r.photos).toEqual([]);
    });

    it('text طولانی را به MAX_LENGTH کوتاه می‌کند', () => {
        const longText = 'a'.repeat(500);
        const r = sanitizeTask({ ...baseTask, text: longText });
        expect(r.text.length).toBe(MAX_LENGTH);
    });

    it('اولویت نامعتبر را به medium تبدیل می‌کند', () => {
        const r = sanitizeTask({ ...baseTask, priority: 'invalid' });
        expect(r.priority).toBe('medium');
    });

    it('اولویت‌های معتبر را حفظ می‌کند', () => {
        expect(sanitizeTask({ ...baseTask, priority: 'high' }).priority).toBe('high');
        expect(sanitizeTask({ ...baseTask, priority: 'low' }).priority).toBe('low');
    });

    it('kind plan را با children می‌پذیرد', () => {
        const r = sanitizeTask({
            ...baseTask,
            kind: 'plan',
            children: [
                { id: 'c1', text: 'زیرکار ۱', kind: 'task' },
                { id: 'c2', text: 'زیرکار ۲', kind: 'task' }
            ]
        });
        expect(r.kind).toBe('plan');
        expect(r.children.length).toBe(2);
    });

    it('children بدون id را فیلتر می‌کند', () => {
        const r = sanitizeTask({
            ...baseTask,
            kind: 'plan',
            children: [
                { text: 'بدون id' },
                { id: 'c1', text: 'معتبر' }
            ]
        });
        expect(r.children.length).toBe(1);
        expect(r.children[0].id).toBe('c1');
    });

    it('children با text خالی را فیلتر می‌کند', () => {
        const r = sanitizeTask({
            ...baseTask,
            kind: 'plan',
            children: [
                { id: 'c1', text: '   ' },
                { id: 'c2', text: 'معتبر' }
            ]
        });
        expect(r.children.length).toBe(1);
    });

    it('sessions معتبر را حفظ می‌کند', () => {
        const at = new Date().toISOString();
        const r = sanitizeTask({
            ...baseTask,
            sessions: [{ id: 's1', at }]
        });
        expect(r.sessions.length).toBe(1);
        expect(r.sessions[0].at).toBe(at);
    });

    it('sessions با تاریخ نامعتبر را فیلتر می‌کند', () => {
        const r = sanitizeTask({
            ...baseTask,
            sessions: [
                { id: 's1', at: 'invalid' },
                { id: 's2', at: new Date().toISOString() }
            ]
        });
        expect(r.sessions.length).toBe(1);
    });

    it('URL نامعتبر را به رشته خالی تبدیل می‌کند', () => {
        const r = sanitizeTask({ ...baseTask, url: 'javascript:alert(1)' });
        expect(r.url).toBe('');
    });

    it('URL معتبر را حفظ می‌کند', () => {
        const r = sanitizeTask({ ...baseTask, url: 'https://example.com' });
        expect(r.url).toBe('https://example.com/');
    });

    it('location نامعتبر را به null تبدیل می‌کند', () => {
        const r = sanitizeTask({ ...baseTask, location: { lat: 100, lng: 51 } });
        expect(r.location).toBe(null);
    });

    it('location معتبر را حفظ می‌کند', () => {
        const r = sanitizeTask({ ...baseTask, location: { lat: 35.5, lng: 51.5 } });
        expect(r.location.lat).toBe(35.5);
        expect(r.location.lng).toBe(51.5);
    });

    it('kind plan — location معتبر را حفظ می‌کند', () => {
        const r = sanitizeTask({
            ...baseTask,
            kind: 'plan',
            location: { lat: 35.5, lng: 51.5 }
        });
        expect(r.location).not.toBe(null);
        expect(r.location.lat).toBe(35.5);
        expect(r.location.lng).toBe(51.5);
    });

    it('kind plan — location نامعتبر را به null تبدیل می‌کند', () => {
        const r = sanitizeTask({
            ...baseTask,
            kind: 'plan',
            location: { lat: 100, lng: 51 }
        });
        expect(r.location).toBe(null);
    });

    it('photos معتبر را حفظ می‌کند', () => {
        const r = sanitizeTask({
            ...baseTask,
            photos: [{ id: 'p1', dataUrl: 'data:image/jpeg;base64,xxx' }]
        });
        expect(r.photos.length).toBe(1);
    });

    it('photos نامعتبر را فیلتر می‌کند', () => {
        const r = sanitizeTask({
            ...baseTask,
            photos: [
                { id: 'p1', dataUrl: 'not-image' },
                { id: 'p2', dataUrl: 'data:image/jpeg;base64,xxx' }
            ]
        });
        expect(r.photos.length).toBe(1);
    });

    it('recur نامعتبر را به none تبدیل می‌کند', () => {
        const r = sanitizeTask({ ...baseTask, recur: 'invalid' });
        expect(r.recur).toBe('none');
    });

    it('recur معتبر را حفظ می‌کند', () => {
        expect(sanitizeTask({ ...baseTask, recur: 'daily' }).recur).toBe('daily');
        expect(sanitizeTask({ ...baseTask, recur: 'weekly' }).recur).toBe('weekly');
    });
});