# تصمیمات معماری «راه فردا»

> این فایل، تصمیمات کلیدی معماری را ثبت می‌کند.
> هر تصمیم یک شناسه دارد (`D-XXX`) تا در کد و CHANGELOG قابل ارجاع باشد.
> فرمت هر ورودی: زمینه → تصمیم → دلیل → تأثیر.
>
> ⚠️ تصمیمات این فایل **قطعی** هستند تا زمانی که با یک تصمیم جدیدتر
> (با شناسه‌ی بالاتر) supersede نشوند. تصمیم قدیمی حذف نمی‌شود،
> فقط با `⚠️ Superseded by D-YYY` علامت می‌خورد.

---

## D-001 — آگاه‌سازی تغییرات از راه دور

**تاریخ:** ۱۴۰۵/۰۶/۲۹ (2026-09-19)
**فاز:** ۶ — گام ۳ (Sync Engine)
**وضعیت:** ✅ فعال

### زمینه
کاربر می‌تواند یک حساب را در چند دستگاه (موبایل، لپ‌تاپ، تبلت) همزمان
وارد شود. اگر در دستگاه A یک task حذف/ویرایش/اضافه شود، دستگاه B
بدون اطلاع قبلی، تغییر را در خودش می‌بیند (بعد از delta sync بعدی)
و این برای کاربر گیج‌کننده است.

### تصمیم
- **Polling سبک:** بعد از هر flush موفق، یک `setInterval` با فاصله‌ی
  ۶۰ ثانیه فقط `POST /api/sync` با `ops: []` می‌زند تا delta سرور را بگیرد.
- **شرط اجرا:** فقط وقتی `state.sync.enabled === true` و `net.online === true`.
- **مکث در حین ویرایش:** اگر `state.editingId != null` یا detail-page باز
  است و draft تغییرات دارد، polling موقتاً متوقف می‌شود (تا conflict
  مصنوعی نسازد).
- **Snackbar info:** هر تغییر از دستگاه دیگر → یک رویداد
  `sync:remote-change { kind, taskText, count }` منتشر می‌شود.
- **بدون Undo:** snackbar اطلاع‌رسانی، دکمه‌ی Undo **ندارد** (چون تغییر
  در دستگاه دیگر رخ داده و Undo در این دستگاه معنی ندارد).

### دلیل
- Cloudflare Workers + D1 به‌طور بومی WebSocket/SSE ندارند.
  Durable Objects وجود دارد ولی خارج از محدوده‌ی فاز ۶ است.
- Polling ۶۰ ثانیه‌ای برای یک اپ برنامه‌ریزی شخصی کافی است.
- هر درخواست کوچک است (فقط `lastSyncAt` + `deviceId` + `ops: []`).
- Snackbar بدون Undo از پیچیدگی UI جلوگیری می‌کند.

### تأثیر
- `sync-queue.js`: افزودن `startRemotePolling()` / `stopRemotePolling()`.
- `events.js`: افزودن `EV.SYNC_REMOTE_CHANGE = 'sync:remote-change'`.
- `ui.js`: افزودن `showInfoSnackbar(message)` (variant جدید).
- `worker/handlers/sync.ts`: پیاده‌سازی delta sync (بدون ops هم کار کند).

---

## D-002 — ویرایش در صفحه‌ی جزئیات: Draft + دکمه‌ی تأیید

**تاریخ:** ۱۴۰۵/۰۶/۲۹ (2026-09-19)
**فاز:** ۶ — گام ۳ (Sync Engine)
**وضعیت:** ✅ فعال

### زمینه
در نسخه‌ی فعلی (`js/detail.js`)، هر تغییر در فیلدهای متن (عنوان، توضیح،
تلفن، آدرس، URL) با `debounce` ۳۰۰-۵۰۰ms ذخیره می‌شود. این یعنی:
- هر چند ثانیه یک `saveTask()` در IndexedDB → یک op در صف sync.
- احتمال خطای کاربر (تایپ اشتباه، فشار اشتباهی) بالا می‌رود.
- برای sync دو-دستگاهی، تعداد ops زیاد و احتمال conflict بالاست.

### تصمیم
- تغییرات فیلدهای متنی در `state.pendingDetailChanges` نگه‌داری می‌شوند
  (draft).
- یک دکمه‌ی «💾 ذخیره‌ی تغییرات» (sticky در بالای detail-page) ظاهر
  می‌شود وقتی draft خالی نیست.
- با کلیک روی دکمه → یک `saveTask()` واحد + یک op واحد.
- در `closeDetail()` اگر draft خالی نبود → dialog «تغییرات ذخیره نشده —
  ذخیره کنم؟» با سه دکمه (ذخیره / دور ریختن / انصراف).

### استثناها (فوری، بدون دکمه‌ی تأیید)
- `toggle` (انجام‌شده / انجام‌نشده)
- `pin` (سنجاق)
- `archive` (بایگانی)
- افزودن / حذف session (چون اتمیک است)
- افزودن / حذف عکس (چون اتمیک است)
- `priority` — در dropdown انتخاب می‌شود و انتخاب یک عمل اتمیک است،
  پس فوری ذخیره می‌شود.

### دلیل
- کاهش تعداد ops ارسالی به سرور (یک op به جای چند op).
- کاهش احتمال conflict و خطای کاربر.
- تجربه‌ی کاربری شبیه به فرم‌های اداری (پر کن، تأیید کن).

### تأثیر
- `detail.js`: حذف `debouncedSaveTitle` / `debouncedSaveDesc` /
  `debouncedSavePhone` / `debouncedSaveAddr` / `debouncedSaveUrl`.
- `detail.js`: افزودن `markDirty(field, value)` + `flushDetailChanges()`.
- `index.html`: افزودن دکمه‌ی «💾 ذخیره‌ی تغییرات» در detail-header.
- `core.js`: افزودن `state.pendingDetailChanges = {}`.

---

## D-003 — Conflict resolution

**تاریخ:** ۱۴۰۵/۰۶/۲۹ (2026-09-19)
**فاز:** ۶ — گام ۳ (Sync Engine)
**وضعیت:** ✅ فعال

### زمینه
دو دستگاه ممکن است همزمان یک task را ویرایش کنند. باید تصمیم بگیریم
کدام نسخه برنده است.

### تصمیم
- مبنای تصمیم: `updated_at` + `device_id`.
- در سرور (`queries.ts:upsertTask`): اگر `data.updatedAt <= existing.updatedAt`
  → `'ignored'` برگردانده می‌شود (نسخه‌ی سرور برنده است).
- در کلاینت: اگر op `ignored` برگشت، task محلی **بازنویسی می‌شود** با
  نسخه‌ی سرور + یک رویداد `sync:conflict { taskId, localVersion, serverVersion }`.
- UI: dialog «نسخه‌ی دستگاه دیگر جدیدتر است — کدام را نگه دارم؟» با دو دکمه
  (نسخه‌ی من / نسخه‌ی سرور).
- ⚠️ **`client_mutation_id` و `if-match` به فاز ۷ موکول شد** — نیاز به
  تغییر schema و پیچیدگی بیشتر دارد.

### دلیل
- `updated_at` + `device_id` برای یک اپ شخصی کافی است.
- D1 + Workers امکان تراکنش سریع می‌دهد.
- فاز ۷ می‌تواند `client_mutation_id` را برای ذخیره‌ی history اضافه کند.

### تأثیر
- `worker/db/queries.ts:upsertTask` — پیاده‌سازی فعلی درست است (فقط
  کافی است در گام ۳ استفاده شود).
- `sync-queue.js`: مدیریت پاسخ `ignored` → رویداد conflict.
- `detail.js`: dialog conflict (فاز ۷ می‌تواند بهبود دهد).

---

## D-004 — Offline-First و فعال‌سازی اختیاری sync ابری

**تاریخ:** ۱۴۰۵/۰۶/۲۹ (2026-09-19)
**فاز:** ۶ — گام ۲ و ۳
**وضعیت:** ✅ فعال

### زمینه
برنامه باید کاملاً آفلاین کار کند. sync ابری یک **آپشن** است، نه الزام.

### تصمیم
- `state.sync.enabled = false` پیش‌فرض.
- Login (گام ۲) فقط token را ذخیره می‌کند — `enableCloudSync()` را
  صدا نمی‌زند.
- فعال‌سازی sync ابری فقط از تنظیمات، با دکمه‌ی جداگانه (گام ۳).
- صف ops در localStorage حتی وقتی sync غیرفعال است، ساخته می‌شود
  (تا اگر کاربر بعداً فعال کرد، ops از دست نروند).

### دلیل
- اصل Offline-First پروژه.
- کاربر کنترل کامل دارد.
- حریم خصوصی: کاربر باید صریحاً انتخاب کند.

### تأثیر
- `auth.js` (گام ۲): فقط token + user.
- `sync-queue.js` (گام ۳): `enableCloudSync()` / `disableCloudSync()`.
- `settings` (گام ۵): UI جدا برای فعال‌سازی.

---

## D-005 — Telegram Login Widget

**تاریخ:** ۱۴۰۵/۰۶/۲۹ (2026-09-19)
**فاز:** ۶ — گام ۲
**وضعیت:** ✅ فعال

### تصمیم
- استفاده از Telegram Login Widget رسمی (`https://telegram.org/js/telegram-widget.js`).
- دامنه در BotFather ثبت شده: `mahdi-amouzegar.github.io/rahe_farda/`.
- دامنه در CSP: افزودن `https://telegram.org` به `script-src`.
- `auth_date` نباید قدیمی‌تر از ۵ دقیقه باشد (پیاده‌شده در Worker).
- امضا با `SHA256(bot_token)` + `HMAC-SHA256` تأیید می‌شود (پیاده‌شده).

### دلیل
- تجربه‌ی کاربر: ۳ کلیک، بدون ساخت حساب.
- امن: token هرگز به کلاینت نمی‌رسد.
- مستندات رسمی و پایدار.

### تأثیر
- `index.html`: CSP + `data-telegram-login="rahe_farda_bot"`.
- `auth.js` (گام ۲): هندل callback + POST به `/api/auth/telegram`.
- `worker/handlers/auth-telegram.ts`: آماده است.

---

## D-006 — Sync Code (گام ۴)

**تاریخ:** ۱۴۰۵/۰۶/۲۹ (2026-09-19)
**فاز:** ۶ — گام ۴
**وضعیت:** ✅ فعال

### تصمیم
- فرمت: `XXXX-XXXX-XXXX`.
- الفبای بدون ابهام: `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`
  (بدون `0`, `O`, `1`, `I`, `L`).
- ذخیره در سرور: فقط `hash(code, pepper)` — هرگز plain.
- hint: ۴ کاراکتر اول برای نمایش در UI (مثال: `X7K9-****-****`).
- قابل بازسازی: کد قدیمی باطل می‌شود.
- pepper در `SYNC_CODE_PEPPER` (Worker Secret).

### دلیل
- کاربر می‌تواند در دستگاه جدید فقط با کد وارد شود.
- رمزنگاری امن با pepper.
- فرمت بدون ابهام برای جلوگیری از خطای تایپی.

### تأثیر
- `worker/handlers/auth-sync-code.ts` (گام ۴).
- `auth.js`: `loginWithSyncCode(code)`.
- `index.html`: UI نمایش/کپی/بازسازی کد در مودال «حساب من».

---

## D-007 — Token: HMAC-signed سبک

**تاریخ:** ۱۴۰۵/۰۶/۲۹ (2026-09-19)
**فاز:** ۶ — گام ۱ (تکمیل‌شده)
**وضعیت:** ✅ فعال

### تصمیم
- HMAC-signed token سبک (JWT-like، بدون کتابخانه).
- ساختار: `base64url(payload).base64url(HMAC-SHA256(secret, payload))`.
- payload: `{ sub, iat, exp, jti }`.
- TTL قابل تنظیم: ۳۰ / ۹۰ / ۱۸۰ / ۳۶۵ روز (پیش‌فرض ۹۰).
- ذخیره‌ی TTL در `users.token_ttl_days`.

### دلیل
- JWT کامل نیاز به کتابخانه دارد.
- ما فقط امضای payload را نیاز داریم.
- سبک و بدون وابستگی.

### تأثیر
- `worker/lib/crypto.ts` (پیاده‌شده).
- `auth.js`: ذخیره در localStorage با کلید `spaceTodoAuth`.

---

## D-008 — Refresh Token Endpoint

**تاریخ:** ۱۴۰۵/۰۶/۲۹ (2026-09-19)
**فاز:** ۶ — گام ۲
**وضعیت:** ✅ فعال

### زمینه
توکن‌های ما TTL بلند دارند (۳۰ تا ۳۶۵ روز)، ولی به هر حال منقضی
می‌شوند. اگر کاربر در حال استفاده باشد و توکن منقضی شود، تجربه‌ی بدی
خواهد داشت (باید دوباره از Telegram Login استفاده کند).

### تصمیم
- Endpoint جدید: `POST /api/auth/refresh`
- ورودی: توکن معتبر فعلی در هدر `Authorization: Bearer <token>`.
- خروجی: توکن جدید با همان `sub` (userId) و TTL جدید.
- بدون نیاز به payload تلگرام — فقط تأیید امضای توکن فعلی.
- اگر توکن فعلی منقضی باشد یا نامعتبر باشد → `401 INVALID_TOKEN`.
- کاربر می‌تواند در تنظیمات TTL را عوض کند (گام ۵).

### دلیل
- تجربه‌ی کاربری بهتر (بدون logout اجباری).
- درخواست سبک است (فقط هدر).
- می‌تواند در پس‌زمینه اجرا شود (وقتی توکن نزدیک انقضا است).

### تأثیر
- `worker/handlers/auth-refresh.ts` (جدید — همین گام).
- `worker/index.ts`: ثبت مسیر `POST /api/auth/refresh`.
- `auth.js`: افزودن `refreshToken()` که در boot صدا زده می‌شود
  اگر توکن کمتر از ۷ روز اعتبار داشته باشد.

---

## پایان