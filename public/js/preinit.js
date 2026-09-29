// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// public/js/preinit.js -- پیش‌مقداردهی همگام تم و زبان (قبل از اولین paint)
//
// ⚠️ این فایل عمداً ماژول نیست و با defer/async لود نمی‌شود:
//    <script src="./js/preinit.js"></script> در <head> به‌صورت blocking اجرا می‌شود
//    تا تم و زبان/جهت قبل از اولین paint ست شوند (بدون پرش تم و بدون پرش ترجمه).
//
// ⚠️ قوانین:
//    - فقط DOM همگام + localStorage + matchMedia — بدون fetch، بدون import.
//    - با CSP سازگار است (بدون inline — همین فایل جایگزین اسکریپت inline قبلی شد).
//    - idempotent و خطاناپذیر (try/catch دور localStorage).
//
// ⚠️ منطق زبان (ضد FOUC ترجمه):
//    اگر زبان ذخیره‌شده انگلیسی باشد، کلاس i18n-prehide روی <html> می‌نشیند و
//    بدنه تا اعمال ترجمه‌ها مخفی می‌ماند (قانون CSS در base.css).
//    کلاس در js/i18n.js (applyToDOM) برداشته می‌شود؛ تایمر زیر fallback امن است
//    تا در صورت لودنشدن ماژول‌ها صفحه هرگز خالی نماند.
(function () {
    'use strict';

    var preference = 'auto';
    var lang = 'fa';

    try {
        var saved = JSON.parse(localStorage.getItem('spaceTodoPrefs') || 'null');
        if (saved && (saved.theme === 'auto' || saved.theme === 'dark' || saved.theme === 'light')) {
            preference = saved.theme;
        }
        if (saved && (saved.lang === 'fa' || saved.lang === 'en')) {
            lang = saved.lang;
        }
    } catch (err) { /* حافظه در دسترس نیست — پیش‌فرض‌ها */ }

    var effective = 'dark';
    try {
        if (preference === 'light' ||
            (preference === 'auto' && window.matchMedia('(prefers-color-scheme: light)').matches)) {
            effective = 'light';
        }
    } catch (err) { /* matchMedia در دسترس نیست — dark */ }

    var html = document.documentElement;
    html.classList.add('theme-' + effective);
    html.dataset.theme = effective;
    html.style.colorScheme = effective;

    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
        meta.content = effective === 'light' ? '#f0f3f8' : '#0a0a1a';
    }

    html.setAttribute('lang', lang);
    html.setAttribute('dir', lang === 'en' ? 'ltr' : 'rtl');
    html.dataset.lang = lang;

    if (lang === 'en') {
        html.classList.add('i18n-prehide');
        setTimeout(function () {
            html.classList.remove('i18n-prehide');
        }, 4000);
    }
})();
