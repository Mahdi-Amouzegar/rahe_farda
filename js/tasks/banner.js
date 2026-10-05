// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/tasks/banner.js -- بنر وضعیت رابطه در نمای مشترک DM
//
//   - pending-in  → متن + دکمه‌های پذیرش/رد (زیر اولین پیام‌ها)
//   - pending-out → «در انتظار پذیرش» + سقف باقی‌مانده
//   - accepted/none → مخفی
// ⚠️ بدون innerHTML — فقط DOM API و textContent.
// ═══════════════════════════════════════════════════════════════════════════

import { apiFetch, apiErrorMessage } from '../api.js';
import { t as i18nT } from '../i18n.js';
import { getDestination } from './destination.js';
import { updateDrawerBadges } from '../navigation/sidebar.js';

function bannerEl() {
    return document.getElementById('destBanner');
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
}

function hideBanner() {
    const bar = bannerEl();
    if (!bar) return;
    bar.replaceChildren();
    bar.hidden = true;
}

/**
 * تازه‌سازی بنر مقصد جاری (بعد از انتخاب مقصد / پذیرش / رد).
 */
export async function refreshDestBanner() {
    const bar = bannerEl();
    if (!bar) return;
    const dest = getDestination();
    if (!dest || dest.type !== 'peer' || !dest.peerId) {
        hideBanner();
        return;
    }
    let st = null;
    try {
        const res = await apiFetch('/api/dm/state?peer=' + encodeURIComponent(dest.peerId));
        if (res.ok) st = res.data && res.data.state;
    } catch { /* silent */ }
    if (!st || st.relation === 'accepted' || st.relation === 'none') {
        hideBanner();
        return;
    }
    bar.replaceChildren();
    if (st.relation === 'pending-in') {
        bar.appendChild(el('span', 'dest-banner-text',
            i18nT('dm.reqTitle') + ' — ' + (dest.name || '')));
        const okBtn = el('button', 'conv-mini-btn', i18nT('conn.accept'));
        okBtn.type = 'button';
        okBtn.addEventListener('click', () => respondToRequest(st.connectionId, true, dest));
        const noBtn = el('button', 'conv-mini-btn', i18nT('conn.reject'));
        noBtn.type = 'button';
        noBtn.addEventListener('click', () => respondToRequest(st.connectionId, false, dest));
        bar.appendChild(okBtn);
        bar.appendChild(noBtn);
    } else if (st.relation === 'pending-out') {
        bar.appendChild(el('span', 'dest-banner-text',
            i18nT('dm.waiting', { n: st.remaining ?? 0 })));
    } else {
        hideBanner();
        return;
    }
    bar.hidden = false;
}

async function respondToRequest(connectionId, accept, dest) {
    if (!connectionId) return;
    try {
        const { showToast } = await import('../ui.js');
        const res = await apiFetch('/api/connections/' + encodeURIComponent(connectionId) +
            (accept ? '/accept' : '/reject'), { method: 'POST' });
        if (!res.ok) {
            showToast(apiErrorMessage(res.error));
            return;
        }
        if (!accept) {
            showToast(i18nT('dm.rejected'));
            const { resetToLocal } = await import('./composer.js');
            await resetToLocal();
            await refreshDestBanner();
            return;
        }
        const { refreshSharedList } = await import('./source.js');
        const { render } = await import('../ui.js');
        await refreshSharedList();
        render();
        await refreshDestBanner();
        try {
            const { getDmUnread } = await import('../communication/dm-tasks.js');
            const u = await getDmUnread();
            updateDrawerBadges({ messages: u.ok ? u.unread.total || 0 : 0 });
        } catch { /* silent */ }
    } catch { /* silent */ }
}

export function hideDestBanner() {
    hideBanner();
}
