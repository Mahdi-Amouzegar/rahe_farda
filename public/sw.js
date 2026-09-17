// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// Service Worker: آفلاین‌سازی پوسته برنامه (فقط فایل‌های همین‌سایت)


// ─────────────────────────────────────────────────────────────────────────────
// راهنمای نسخه‌بندی CACHE
// ─────────────────────────────────────────────────────────────────────────────
// ساختار: rahefarda-v<MAJOR>.<API>.<FEATURE>.<PHASE>-<DATE>
//
//   MAJOR    : تغییر بزرگ در معماری پروژه (مثلاً مهاجرت به framework جدید)
//   API      : تغییر در ساختار ذخیره‌سازی یا قرارداد داده (data contract)
//   FEATURE  : فیچر جدید یا بازسازی بزرگ (مثلاً بازسازی CSS، Light theme)
//   PHASE    : هر فاز از برنامه ارتقا (۰ تا ۷)
//   DATE     : تاریخ آخرین bump به فرمت YYYY-MM-DD (برای اطمینان از پاک شدن کش)
//
// راهنما:
//   - هر فاز برنامه ارتقا → PHASE + ۱
//   - هر فیچر جدید → FEATURE + ۱ و PHASE = ۰
//   - هر تغییر در ساختار داده → API + ۱ و بقیه صفر
//   - تغییر بزرگ معماری → MAJOR + ۱ و بقیه صفر
// ─────────────────────────────────────────────────────────────────────────────
// تاریخچه:
//   v1.0.0.0-2026-09-11 — نقطه شروع (baseline) قبل از برنامه ارتقا
//   v1.0.0.1-2026-09-11 — فاز ۱: رفع باگ‌های بحرانی (saveTasks deep clone، idbPutAll guard)
//   v1.0.0.2-2026-09-11 — فاز ۲: امنیت (CSP، SRI، sanitizeUrl، escapeHtml سریع)
//   v1.0.0.3-2026-09-11 — فاز ۳: عملکرد (debounce، Task Index، cache allSessions، ترتیب منابع زمان)
//   v1.0.0.4-2026-09-11 — فاز ۴: UX و دسترس‌پذیری (focus trap، مودال‌های سفارشی، Snackbar دقیق، Escape متمرکز)
//   v1.1.0.0-2026-09-11 — فاز ۵-الف: Cascade Layers + Logical Properties + رفع باگ findTask
//   v1.1.0.1-2026-09-11 — فاز ۵-ب: CSS Variables (Design Tokens) برای پشتیبانی از Light theme
//   v1.1.1.0-2026-09-11 — فاز ۵-ج: دکمه‌های تغییر Theme (auto/dark/light) و Lang (fa/en)
//   v1.1.2.0-2026-09-11 — فاز ۵-د: تقسیم CSS به ۶ فایل منطقی + دکمه‌های done-actions کنار هم
//   v1.1.2.1-2026-09-12 — فاز ۶-ب: Refactor ESM + Vite + Vitest
//   v1.2.0.0-2026-09-12 — فاز ۷: حذف کامل shim‌ها + refactor نهایی ESM + Vite build
//   v1.2.0.1-2026-09-16 — فاز ۷-الف: حذف favicon.svg (۳MB) + پاکسازی ارجاع‌ها
//   v1.2.0.2-2026-09-16 — فاز ۷-ب: افزودن جستجوی مکان با Nominatim (map-search.js) + دکمه میکروفن
//   v1.3.0.0-2026-09-16 — فاز ۸: ردیابی آنلاین، حالت پیشرفته، بهبود چیدمان موبایل، رفع باگ‌ها
//   v1.3.0.1-2026-09-16 — فاز ۸-الف: پیش‌بینی هوا با Open-Meteo (weather.js + weather-modal.js)
// ─────────────────────────────────────────────────────────────────────────────
const CACHE = 'rahefarda-v1.3.0.1-2026-09-16';

// فایل‌ها بدون query-string (?v=N) کش می‌شوند.
// networkFirst + ignoreSearch تضمین می‌کند همیشه نسخه درست لود شود:
//  - آنلاین: از شبکه (با query جدید)
//  - آفلاین: از کش (ignoreSearch نادیده می‌گیرد)
const ASSETS = [
  './',
  './index.html',
  './css/base.css',
  './css/components.css',
  './css/modals.css',
  './css/detail.css',
  './css/map.css',
  './css/responsive.css',
  './manifest.webmanifest',
  './fonts/vazirmatn-arabic.woff2',
  './fonts/vazirmatn-latin.woff2',
  './icons/logo.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.ico',
  './icons/favicon-96x96.png'
];

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
      const w = ws.find(x => x.url.includes('index.html') || x.url.endsWith('/'));
      if (w) return w.focus();
      return clients.openWindow('./');
    })
  );
});

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(async cache => {
      let failed = 0;
      await Promise.all(ASSETS.map(async asset => {
        try {
          await cache.add(asset);
        } catch (_) {
          failed++;
        }
      }));
      // اگر بیش از ۳۰٪ assetها fail شوند، نصب را fail کن تا کاربر با SW ناقص نماند.
      if (failed > ASSETS.length * 0.3) {
        throw new Error(`SW install failed: ${failed}/${ASSETS.length} assets could not be cached`);
      }
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isCodeAsset(request) {
  return request.destination === 'script' || request.destination === 'style' || /\.(?:js|css)$/i.test(new URL(request.url).pathname);
}

// برای code assets: اول شبکه، اگر fail شد (آفلاین) از کش.
// مهم: ابتدا exact match (با query)، سپس در صورت نبود، ignoreSearch.
// این ترتیب از باگ «نسخه قدیمی CSS بعد از bump» جلوگیری می‌کند.
function networkFirst(request) {
  return fetch(request).then(res => {
    if (res && res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(request, copy)).catch(() => {});
    }
    return res;
  }).catch(() =>
    caches.match(request).then(hit =>
      hit || caches.match(request, { ignoreSearch: true })
    )
  );
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  const isDocument = e.request.mode === 'navigate' || e.request.destination === 'document';
  if (isDocument) {
    e.respondWith(
      fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put('./index.html', copy)).catch(() => {});
        return res;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }
  if (isCodeAsset(e.request)) {
    e.respondWith(networkFirst(e.request));
    return;
  }
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true })
      .then(hit => hit || fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      }))
  );
});