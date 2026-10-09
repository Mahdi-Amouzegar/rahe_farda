// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/ui/avatar-settings.js -- بخش آواتار در تنظیمات + آواتار گروه (تصمیم F)
//
// ⚠️ آپلود از همان pipeline مدیا می‌گذرد (processImageFile → enqueueUpload →
//    انتظار confirm → PATCH با `media:<id>`). هیچ innerHTML.
// ═══════════════════════════════════════════════════════════════════════════

import { apiFetch, apiErrorMessage } from '../api.js';
import { t as i18nT } from '../i18n.js';
import { isLoggedIn, getCurrentUser, setStoredUserAvatar } from '../auth.js';
import { processImageFile } from '../media.js';
import { enqueueUpload, getUploadStatus } from '../media-upload.js';
import { avatarNode, clearAvatarCache, resolveAvatar } from './avatar.js';
import { showInfoModal } from '../core.js';

function tr(key, fallback) {
    const v = i18nT(key);
    return v !== key ? v : fallback;
}

function myAvatarRef() {
    try {
        const u = getCurrentUser();
        if (!u) return null;
        if (typeof u.avatarUrl === 'string' && u.avatarUrl) return u.avatarUrl;
        if (!u.profile) return null;
        const p = typeof u.profile === 'string' ? JSON.parse(u.profile) : u.profile;
        return (p && typeof p.avatarUrl === 'string' && p.avatarUrl) || null;
    } catch {
        return null;
    }
}

/**
 * انتظار برای confirm آپلود (poll سبک).
 *
 * @returns {Promise<string|null>} serverMediaId یا null
 */
async function waitForUpload(mediaId, timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 60000);
    while (Date.now() < deadline) {
        let st = null;
        try {
            st = await getUploadStatus(mediaId);
        } catch {
            st = null;
        }
        if (st && st.serverMediaId && (st.status === 'uploaded' || st.confirmedAt)) {
            return st.serverMediaId;
        }
        if (st && st.status === 'failed') return null;
        await new Promise((r) => setTimeout(r, 1000));
    }
    return null;
}

/**
 * آپلود یک فایل به‌عنوان آواتار و برگرداندن ref (`media:<id>`).
 */
export async function uploadAvatarFile(file) {
    const processed = await processImageFile(file);
    const up = await enqueueUpload({
        contentType: processed.contentType,
        sizeBytes: processed.blob.size,
        blob: processed.blob,
    });
    const serverId = await waitForUpload(up.mediaId, 60000);
    if (!serverId) return null;
    return 'media:' + serverId;
}

/**
 * رندر بخش آواتار در تنظیمات (#avatarBox). فقط وقتی وارد شده.
 */
export async function renderAvatarSettings() {
    const box = document.getElementById('avatarBox');
    if (!box) return;
    box.replaceChildren();
    if (!isLoggedIn()) {
        const p = document.createElement('p');
        p.className = 'settings-note';
        p.textContent = tr('avatar.loginRequired', 'برای آواتار وارد شوید.');
        box.appendChild(p);
        return;
    }

    const current = el_row();
    current.appendChild(avatarNode(myAvatarRef(), '?'));
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.id = 'avatarFileInput';
    input.style.display = 'none';
    const choose = document.createElement('button');
    choose.type = 'button';
    choose.className = 'btn-small';
    choose.textContent = tr('avatar.change', 'تغییر آواتار');
    choose.addEventListener('click', () => input.click());
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn-small';
    remove.textContent = tr('avatar.remove', 'حذف');
    remove.addEventListener('click', async () => {
        remove.disabled = true;
        const res = await apiFetch('/api/users/me', { method: 'PATCH', body: { avatarUrl: null } });
        remove.disabled = false;
        if (res.ok) {
            clearAvatarCache();
            setStoredUserAvatar(null);
            await renderAvatarSettings();
        } else {
            showInfoModal({ title: tr('avatar.title', 'آواتار'), paragraphs: [apiErrorMessage(res.error)] });
        }
    });
    input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        choose.disabled = true;
        try {
            const ref = await uploadAvatarFile(file);
            if (!ref) {
                showInfoModal({ title: tr('avatar.title', 'آواتار'), paragraphs: [tr('avatar.uploadFailed', 'آپلود ناموفق بود.') ] });
                return;
            }
            const res = await apiFetch('/api/users/me', { method: 'PATCH', body: { avatarUrl: ref } });
            if (!res.ok) {
                showInfoModal({ title: tr('avatar.title', 'آواتار'), paragraphs: [apiErrorMessage(res.error)] });
                return;
            }
            clearAvatarCache();
            setStoredUserAvatar(ref);
            await renderAvatarSettings();
        } finally {
            choose.disabled = false;
            input.value = '';
        }
    });
    current.appendChild(choose);
    current.appendChild(remove);
    box.appendChild(current);
    const hint = document.createElement('p');
    hint.className = 'settings-note';
    hint.textContent = tr('avatar.shapeHint', '💡 عکس مربعی انتخاب کنید تا کراپ یا کشیده نشود.');
    box.appendChild(hint);
    box.appendChild(input);

    function el_row() {
        const d = document.createElement('div');
        d.className = 'settings-row avatar-row';
        return d;
    }
}

/**
 * تغییر آواتار گروه (فقط owner) — picker فایل + آپلود + PATCH گروه.
 */
export async function changeGroupAvatar(groupId) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    document.body.appendChild(input);
    const file = await new Promise((resolve) => {
        input.addEventListener('change', () => resolve(input.files && input.files[0]), { once: true });
        input.click();
    });
    try {
        if (!file) return;
        const ref = await uploadAvatarFile(file);
        if (!ref) {
            showInfoModal({ title: tr('avatar.title', 'آواتار'), paragraphs: [tr('avatar.uploadFailed', 'x')] });
            return;
        }
        const res = await apiFetch('/api/groups/' + encodeURIComponent(groupId), {
            method: 'PATCH',
            body: { avatarUrl: ref },
        });
        if (!res.ok) {
            showInfoModal({ title: tr('avatar.title', 'آواتار'), paragraphs: [apiErrorMessage(res.error)] });
        }
    } finally {
        if (input.parentNode) input.parentNode.removeChild(input);
    }
}
