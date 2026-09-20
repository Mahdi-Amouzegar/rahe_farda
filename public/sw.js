// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// Service Worker: آفلاین‌سازی پوسته برنامه (فقط فایل‌های همین‌سایت)

// ─────────────────────────────────────────────────────────────────────────────
// راهنمای نسخه‌بندی CACHE
// ─────────────────────────────────────────────────────────────────────────────
// ساختار: rahefarda-v<MAJOR>.<API>.<FEATURE>.<PHASE>-<DATE>
//
// تاریخچه:
//   v1.0.0.0-2026-09-11 — نقطه شروع (baseline)
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
//   v1.5.0.0-2026-09-18 — فاز ۵ گام ۴+۵: PWA Enhancement + Sync Queue
//                          - افزودن status.css به ASSETS
//                          - handler برای periodicsync
//                          - handler برای sync (Background Sync)
//                          - پیام‌های SW ↔ main thread (شروع)
//   v1.5.1.0-2026-09-19 — فاز ۶ گام ۲: Telegram Login UI + auth modal
//                          - js/auth.js (کامل)
//                          - js/app.js (renderAuthModal + TTL dropdown)
//                          - public/css/components.css (استایل‌های auth)
// ─────────────────────────────────────────────────────────────────────────────
const CACHE = 'rahefarda-v1.5.1.0-2026-09-19';

const ASSETS = [
  './',
  './index.html',
  './css/base.css',
  './css/components.css',
  './css/modals.css',
  './css/detail.css',
  './css/map.css',
  './css/status.css',
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

// ═══════════════════════════════════════════════════════════════════════════
// Notification click
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// Install
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// Activate
// ═══════════════════════════════════════════════════════════════════════════

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ فاز ۵ گام ۵: Periodic Background Sync
// ═══════════════════════════════════════════════════════════════════════════
//
// این رویداد فقط در Chrome/Edge (نصب‌شده PWA) فعال می‌شود.
// در فاز ۶، این handler صف sync را از IndexedDB می‌خواند و به Cloudflare می‌فرستد.
//
// ⚠️ فعلاً: فقط یک پیام به کلاینت‌ها می‌فرستد تا main thread flushQueue را اجرا کند.
// (چون صف در localStorage نگهداری می‌شود، نه IndexedDB.)

self.addEventListener('periodicsync', e => {
  if (e.tag === 'rahe-periodic-sync') {
    e.waitUntil(notifyClientsToSync('periodic'));
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ فاز ۵ گام ۵: Background Sync (یکی‌باره)
// ═══════════════════════════════════════════════════════════════════════════
//
// وقتی main thread آفلاین می‌شود و op جدیدی به صف اضافه می‌کند،
// می‌تواند این sync را ثبت کند. وقتی آنلاین شد، SW بیدار می‌شود.

self.addEventListener('sync', e => {
  if (e.tag === 'rahe-sync-one-shot') {
    e.waitUntil(notifyClientsToSync('one-shot'));
  }
});

/**
 * اطلاع‌دادن به همه‌ی کلاینت‌ها برای flush کردن صف sync.
 *
 * @param {'periodic'|'one-shot'} source
 */
async function notifyClientsToSync(source) {
  try {
    const allClients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    });

    for (const client of allClients) {
      try {
        client.postMessage({
          type: 'rahe-sw-sync-request',
          source,
          timestamp: new Date().toISOString()
        });
      } catch { /* silent */ }
    }

    // اگر هیچ کلاینتی باز نبود، نمی‌توانیم کاری کنیم
    // (چون صف در localStorage کلاینت است، نه IndexedDB SW)
    return true;
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Fetch strategies
// ═══════════════════════════════════════════════════════════════════════════

function isCodeAsset(request) {
  return request.destination === 'script' ||
         request.destination === 'style' ||
         /\.(?:js|css)$/i.test(new URL(request.url).pathname);
}

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

// ═══════════════════════════════════════════════════════════════════════════
// Fetch
// ═══════════════════════════════════════════════════════════════════════════

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

  // فایل‌های صوتی: cache-first
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

  // بقیه: cache-first با network fallback
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true })
      .then(hit => hit || fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      }))
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ فاز ۵ گام ۵: پیام از main thread
// ═══════════════════════════════════════════════════════════════════════════

self.addEventListener('message', e => {
  const data = e.data || {};
  if (data.type === 'rahe-skip-waiting') {
    self.skipWaiting();
    return;
  }
  if (data.type === 'rahe-request-sync-registration') {
    // main thread می‌تواند register یک sync یک‌باره درخواست کند
    if ('registration' in self && 'sync' in self.registration) {
      self.registration.sync.register('rahe-sync-one-shot').catch(() => {});
    }
  }
});