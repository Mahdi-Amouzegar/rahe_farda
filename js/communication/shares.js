// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/communication/shares.js -- اشتراک‌گذاری تسک (Phase 8 — 8.2-C)
//
// ⚠️ فلو: کارت تسک ⋯ → اشتراک‌گذاری → انتخاب مخاطب (accepted connections)
//        → POST /api/task-shares {recipientId, sourceTaskId}
// ⚠️ همه‌ی requestها فقط از js/api.js. بدون innerHTML.
// ═══════════════════════════════════════════════════════════════════════════

import { apiFetch, apiErrorMessage } from '../api.js';
import { t as i18nT } from '../i18n.js';
import { showInfoModal } from '../core.js';
import { openMenu } from '../ui/menu.js';
import { listConversations } from './conversations.js';

/**
 * اشتراک‌گذاری یک تسک شخصی با یک کاربر.
 *
 * @returns {ok, share?}
 */
export async function shareTaskWith(taskId, recipientId) {
    const res = await apiFetch('/api/task-shares', {
        method: 'POST',
        body: { recipientId, sourceTaskId: taskId },
    });
    return res;
}

/**
 * باز کردن انتخابگر مخاطب (anchored به دکمه‌ی ⋯ کارت).
 */
export async function openSharePicker(anchor, taskId) {
    const res = await listConversations();
    if (!res.ok) {
        showInfoModal({
            title: i18nT('share.title'),
            paragraphs: [apiErrorMessage(res.error)],
        });
        return;
    }
    if (res.conversations.length === 0) {
        showInfoModal({
            title: i18nT('share.title'),
            paragraphs: [i18nT('share.noContacts')],
        });
        return;
    }
    openMenu({
        anchor,
        label: i18nT('share.pickRecipient'),
        items: res.conversations.map((c) => ({
            id: c.user.id,
            label: displayNameOf(c.user),
        })),
        onSelect: async (recipientId) => {
            const r = await shareTaskWith(taskId, recipientId);
            showInfoModal({
                title: i18nT('share.title'),
                paragraphs: [
                    r.ok ? i18nT('share.sent') : apiErrorMessage(r.error),
                ],
            });
        },
    });
}

function displayNameOf(user) {
    if (!user) return '…';
    return user.displayName || user.username || String(user.id || '').slice(0, 8);
}
