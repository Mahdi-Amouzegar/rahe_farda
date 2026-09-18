// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// Service Worker: آفلاین‌سازی پوسته برنامه (فقط فایل‌های همین‌سایت)

// ─────────────────────────────────────────────────────────────────────────────
// راهنمای نسخه‌بندی CACHE
// ─────────────────────────────────────────────────────────────────────────────
// ساختار: rahefarda-v<MAJOR>.<API>.<FEATURE>.<PHASE>-<DATE>
//
// تاریخچه:
//   v1.0.0.0-2026-09-11 — نقطه شروع (baseline) قبل از برنامه ارتقا
//   v1.0.0.1-2026-09-11 — فاز ۱: رفع باگ‌های بحرانی
//   v1.0.0.2-2026-09-11 — فاز ۲: امنیت
//   v1.0.0.3-2026-09-11 — فاز ۳: عملکرد
//   v1.0.0.4-2026-09-11 — فاز ۴: UX و دسترس‌پذیری
//   v1.1.0.0-2026-09-11 — فاز ۵-الف: Cascade Layers
//   v1.1.0.1-2026-09-11 — فاز ۵-ب: Design Tokens
//   v1.1.1.0-2026-09-11 — فاز ۵-ج: Theme/Lang
//   v1.1.2.0-2026-09-11 — فاز ۵-د: تقسیم CSS
//   v1.1.2.1-2026-09-12 — فاز ۶-ب: ESM + Vite + Vitest
//   v1.2.0.0-2026-09-12 — فاز ۷: حذف کامل shim‌ها
//   v1.2.0.1-2026-09-16 — فاز ۷-الف: حذف favicon.svg
//   v1.2.0.2-2026-09-16 — فاز ۷-ب: جستجوی مکان با Nominatim
//   v1.3.0.0-2026-09-16 — فاز ۸: ردیابی آنلاین، حالت پیشرفته
//   v1.3.0.1-2026-09-16 — فاز ۸-الف: پیش‌بینی هوا
//   v1.3.1.0-2026-09-17 — آیکن وضعیت هوا
//   v1.4.0.0-2026-09-18 — فاز ۴ + فاز ۵ گام ۱
//   v1.4.0.1-2026-09-18 — فاز ۵ گام ۳: یادآور صوتی سه‌حالته
//   v1.4.0.2-2026-09-18 — فاز ۵ گام ۳-الف: انتقال فایل‌های صوتی به runtime cache
//                          - حذف ogg از ASSETS اولیه (جلوگیری از باز شدن IDM در load)
//                          - افزودن isAudioAsset + cache-first برای صداها
// ─────────────────────────────────────────────────────────────────────────────
const CACHE = 'rahefarda-v1.4.0.2-2026-09-18';

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
  // ⚠️ فایل‌های صوتی اینجا نیستن — در runtime cache می‌آن
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
      // اگر بیش از ۳۰٪ assetها fail شوند، نصب را fail کن
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

// ⚠️ فاز ۵ گام ۳-الف: تشخیص فایل صوتی
function isAudioAsset(request) {
  return /\.(?:ogg|mp3|wav|m4a)$/i.test(new URL(request.url).pathname);
}

// برای code assets: اول شبکه، اگر fail شد (آفلاین) از کش.
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
  // ⚠️ فایل‌های صوتی: cache-first
  if (isAudioAsset(e.request)) {
    e.respondWith(
      caches.match(e.request).then(hit => {
        if (hit) return hit;
        return fetch(e.request).then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
          }
          return res;
        });
      })
    );
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