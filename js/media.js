// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// media.js -- پردازش عکس برای آپلود در ParsPack
//
// این ماژول:
//   - validateImageFile(): اعتبارسنجی MIME + extension + حجم
//   - processImageFile(): تبدیل به WebP + downscale (در صورت لزوم)
//   - isWebPSupported(): چک پشتیبانی مرورگر
//   - formatBytes(): فرمت‌بندی حجم برای نمایش
//
// ⚠️ تصمیمات طراحی (Stage D):
//   - حفظ ابعاد اصلی (مگر > 4096)
//   - کیفیت WebP: 0.9
//   - کیفیت JPEG (fallback): 0.9
//   - حجم ورودی: حداکثر 5MB
//   - EXIF حذف می‌شود (canvas خودش)
//
// ⚠️ چرا این تصمیمات؟
//   - عکس‌ها ممکن است شامل متن ریز باشند (فاکتور، رسید، قرارداد)
//   - downscale تهاجمی، متن را نابود می‌کند
//   - WebP خودش 25-35٪ صرفه‌جویی نسبت به JPEG می‌دهد
//
// ⚠️ بدون کتابخانه‌ی خارجی:
//   - همه‌چیز با HTMLCanvasElement + toBlob
//   - قابل استفاده در همه‌ی مرورگرهای مدرن
// ═══════════════════════════════════════════════════════════════════════════

import { t as i18nT } from './i18n.js';

// ═══════════════════════════════════════════════════════════════════════════
// ثابت‌ها
// ═══════════════════════════════════════════════════════════════════════════

/** حداکثر حجم فایل ورودی (قبل از پردازش) */
export const MAX_INPUT_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

/** حداکثر ابعاد خروجی (اگر بزرگ‌تر بود، downscale) */
export const MAX_OUTPUT_DIMENSION = 4096;

/** کیفیت WebP */
export const WEBP_QUALITY = 0.9;

/** کیفیت JPEG (fallback) */
export const JPEG_QUALITY = 0.9;

/** حداکثر تعداد عکس در هر task */
export const MAX_PHOTOS_PER_TASK = 8;

/** MIME typeهای مجاز */
export const ALLOWED_MIME_TYPES = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'image/avif',
    'image/gif',
    'image/bmp',
];

/** Extensionهای مجاز (lowercase) */
export const ALLOWED_EXTENSIONS = [
    '.jpg',
    '.jpeg',
    '.png',
    '.webp',
    '.heic',
    '.heif',
    '.avif',
    '.gif',
    '.bmp',
];

// ═══════════════════════════════════════════════════════════════════════════
// Helpers — فرمت
// ═══════════════════════════════════════════════════════════════════════════

/**
 * فرمت‌بندی حجم برای نمایش.
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '—';
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Validation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * بررسی پشتیبانی WebP در مرورگر.
 * با یک canvas کوچک تست می‌کنیم.
 *
 * @returns {boolean}
 */
export function isWebPSupported() {
    try {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        return canvas.toDataURL('image/webp').startsWith('data:image/webp');
    } catch {
        return false;
    }
}

/**
 * استخراج extension از نام فایل.
 * @param {string} filename
 * @returns {string} extension با نقطه (lowercase) یا ''
 */
function getExtension(filename) {
    if (typeof filename !== 'string') return '';
    const idx = filename.lastIndexOf('.');
    if (idx < 0) return '';
    return filename.slice(idx).toLowerCase();
}

/**
 * اعتبارسنجی یک فایل عکس.
 *
 * @param {File} file
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validateImageFile(file) {
    // ─── نوع ورودی ───
    if (!file || !(file instanceof File)) {
        return { ok: false, reason: i18nT('media.errors.invalidFile') };
    }

    // ─── حجم ───
    if (file.size === 0) {
        return { ok: false, reason: i18nT('media.errors.emptyFile') };
    }
    if (file.size > MAX_INPUT_SIZE_BYTES) {
        return {
            ok: false,
            reason: i18nT('media.errors.tooLarge', { max: formatBytes(MAX_INPUT_SIZE_BYTES) }),
        };
    }

    // ─── MIME type ───
    const mime = (file.type || '').toLowerCase();
    if (!mime) {
        // اگر MIME خالی بود، بر اساس extension چک کن
        const ext = getExtension(file.name);
        if (!ALLOWED_EXTENSIONS.includes(ext)) {
            return { ok: false, reason: i18nT('media.errors.unsupportedFormat') };
        }
        return { ok: true };
    }

    if (!ALLOWED_MIME_TYPES.includes(mime)) {
        return {
            ok: false,
            reason: i18nT('media.errors.unsupportedFormatWithMime', { mime }),
        };
    }

    // ─── Extension (اختیاری، ولی برای defense in depth) ───
    const ext = getExtension(file.name);
    if (ext && !ALLOWED_EXTENSIONS.includes(ext)) {
        return {
            ok: false,
            reason: i18nT('media.errors.unsupportedExtension', { ext }),
        };
    }

    return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// Load Image
// ═══════════════════════════════════════════════════════════════════════════

/**
 * بارگذاری فایل به عنوان HTMLImageElement.
 *
 * @param {File} file
 * @returns {Promise<HTMLImageElement>}
 */
function loadImage(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();

        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('بارگذاری تصویر ناموفق بود'));
        };

        img.src = url;
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// Downscale
// ═══════════════════════════════════════════════════════════════════════════

/**
 * محاسبه‌ی ابعاد جدید (اگر لازم باشد downscale).
 *
 * @param {number} width
 * @param {number} height
 * @param {number} maxDim
 * @returns {{ width: number, height: number, scaled: boolean }}
 */
function computeTargetSize(width, height, maxDim) {
    const maxSide = Math.max(width, height);
    if (maxSide <= maxDim) {
        return { width, height, scaled: false };
    }

    const ratio = maxDim / maxSide;
    return {
        width: Math.max(1, Math.round(width * ratio)),
        height: Math.max(1, Math.round(height * ratio)),
        scaled: true,
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// Canvas → Blob
// ═══════════════════════════════════════════════════════════════════════════

/**
 * تبدیل canvas به Blob با فرمت و کیفیت مشخص.
 *
 * ⚠️ اگر فرمت پشتیبانی نشد، fallback به JPEG.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {string} mimeType
 * @param {number} quality
 * @returns {Promise<Blob>}
 */
function canvasToBlob(canvas, mimeType, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            blob => {
                if (!blob) {
                    reject(new Error('تبدیل canvas به Blob ناموفق بود'));
                    return;
                }

                // ⚠️ اگر مرورگر فرمت درخواستی را پشتیبانی نکند،
                //    ممکن است blob.type با mimeType فرق کند.
                //    در آن صورت، خطا می‌دهیم (تا caller fallback کند).
                if (blob.type && !blob.type.includes(mimeType.split('/')[1])) {
                    reject(new Error(`مرورگر فرمت ${mimeType} را پشتیبانی نمی‌کند`));
                    return;
                }

                resolve(blob);
            },
            mimeType,
            quality
        );
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// processImageFile — تابع اصلی
// ═══════════════════════════════════════════════════════════════════════════

/**
 * پردازش یک فایل عکس:
 *   ۱. اعتبارسنجی
 *   ۲. بارگذاری
 *   ۳. downscale (در صورت لزوم)
 *   ۴. تبدیل به WebP (یا JPEG در fallback)
 *   ۵. برگرداندن Blob + metadata
 *
 * @param {File} file
 * @returns {Promise<{
 *   blob: Blob,
 *   contentType: string,
 *   width: number,
 *   height: number,
 *   sizeBytes: number,
 *   originalSizeBytes: number,
 *   scaled: boolean,
 *   originalWidth: number,
 *   originalHeight: number,
 *   extension: string,
 * }>}
 * @throws {Error} اگر فایل نامعتبر باشد یا پردازش شکست بخورد
 */
export async function processImageFile(file) {
    // ─── ۱. اعتبارسنجی ───
    const validation = validateImageFile(file);
    if (!validation.ok) {
        throw new Error(validation.reason);
    }

    // ─── ۲. بارگذاری ───
    const img = await loadImage(file);

    const originalWidth = img.naturalWidth || img.width;
    const originalHeight = img.naturalHeight || img.height;

    if (!originalWidth || !originalHeight) {
        throw new Error('ابعاد تصویر نامعتبر است');
    }

    // ─── ۳. محاسبه‌ی ابعاد ───
    const target = computeTargetSize(
        originalWidth,
        originalHeight,
        MAX_OUTPUT_DIMENSION
    );

    // ─── ۴. رسم روی canvas ───
    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
        throw new Error('canvas context در دسترس نیست');
    }

    // ⚠️ کیفیت تصویر در زمان downscale
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ctx.drawImage(img, 0, 0, target.width, target.height);

    // ─── ۵. تبدیل به Blob ───
    let blob;
    let contentType;
    let extension;

    if (isWebPSupported()) {
        try {
            blob = await canvasToBlob(canvas, 'image/webp', WEBP_QUALITY);
            contentType = 'image/webp';
            extension = 'webp';
        } catch {
            // fallback به JPEG
            blob = await canvasToBlob(canvas, 'image/jpeg', JPEG_QUALITY);
            contentType = 'image/jpeg';
            extension = 'jpeg';
        }
    } else {
        blob = await canvasToBlob(canvas, 'image/jpeg', JPEG_QUALITY);
        contentType = 'image/jpeg';
        extension = 'jpeg';
    }

    return {
        blob,
        contentType,
        width: target.width,
        height: target.height,
        sizeBytes: blob.size,
        originalSizeBytes: file.size,
        scaled: target.scaled,
        originalWidth,
        originalHeight,
        extension,
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper: پردازش چند فایل
// ═══════════════════════════════════════════════════════════════════════════

/**
 * پردازش چند فایل با مدیریت خطا.
 *
 * @param {File[]} files
 * @returns {Promise<{
 *   results: Array<{ file: File, processed?: object, error?: string }>,
 *   successCount: number,
 *   failureCount: number,
 * }>}
 */
export async function processImageFiles(files) {
    const results = [];
    let successCount = 0;
    let failureCount = 0;

    for (const file of files) {
        try {
            const processed = await processImageFile(file);
            results.push({ file, processed });
            successCount++;
        } catch (err) {
            results.push({
                file,
                error: err instanceof Error ? err.message : 'خطای نامشخص',
            });
            failureCount++;
        }
    }

    return { results, successCount, failureCount };
}

// ═══════════════════════════════════════════════════════════════════════════
// پایان media.js
// ═══════════════════════════════════════════════════════════════════════════