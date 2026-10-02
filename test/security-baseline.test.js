// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/security-baseline.test.js -- گیت امنیتی innerHTML (T2)
//
// ⚠️ قرارداد UI-SHELL §۱۰: «baseline + enforcement»
//    - لیست زیر، همه‌ی موارد مجاز innerHTML در کد فعلی است (baseline ثبت‌شده).
//    - اگر این تست شکست خورد، یعنی یک مورد innerHTML جدید اضافه شده:
//      یا آن را با textContent/DOM API جایگزین کن، یا اگر واقعاً لازم و امن است
//      (escape شده / رشته‌ی استاتیک)، آن را با دلیل به همین لیست اضافه کن.
//    - هدف: هیچ محتوای user-generated بدون escape نباید به innerHTML برسد.
//
// ⚠️ نکته: اثر انگشت «فایل + خط نرمال‌شده» است (بدون شماره خط تا جابه‌جایی
//    خطوط تست را نشکند). ویرایش همان خط هم نیاز به بازبینی و به‌روزرسانی دارد.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JS_DIR = path.join(__dirname, '..', 'js');

// ─── Baseline ثبت‌شده (T2 — ۲۹ سپتامبر ۲۰۲۶) ───
const BASELINE = new Set([
  'app.js:body.innerHTML = `',
  'app.js:box.innerHTML = state.planDraftKids.map((k, i) => `<span class="due-chip">📝 ${escapeHtml(k)}<button type="button" data-plankid="${i}" aria-label="${t(\'common.delete\')}">✕</button></span>`).join(\'\');',
  'app.js:container.innerHTML = HOURS.map(h =>',
  'app.js:document.getElementById(\'importMeta\').innerHTML = \'\';',
  'app.js:hourSel.innerHTML = \'\';',
  'app.js:if (metaEl) metaEl.innerHTML = `<div class="import-error">${escapeHtml(msg)}</div>`;',
  'app.js:if (metaEl) metaEl.innerHTML = `<div class="import-error">${t(\'import.invalidStructure\')}</div>`;',
  'app.js:label.innerHTML = t(\'sound.tts.noPersianVoice\');',
  'app.js:mc.innerHTML = h;',
  'app.js:meta.innerHTML = `',
  'app.js:metaEl.innerHTML = `',
  'app.js:minSel.innerHTML = \'\';',
  'app.js:presetSel.innerHTML = `<option value="">${escapeHtml(t(\'sound.preset.none\'))}</option>` +',
  'app.js:sel.innerHTML = `<option value="">${escapeHtml(t(\'sound.tts.defaultVoice\'))}</option>` +',
  'core.js:bodyEl.innerHTML = \'\';',
  'core.js:bodyEl.innerHTML = opts.html;',
  'core.js:bodyEl.innerHTML = opts.paragraphs.map(p => `<p>${p}</p>`).join(\'\');',
  'detail.js:detailsEl.innerHTML = \'\';',
  'detail.js:detailsEl.innerHTML = details',
  'detail.js:el.innerHTML = `<div class="session-empty">${i18nT(\'detail.sessions.empty\')}</div>`;',
  'detail.js:el.innerHTML = list.map((s, i) => {',
  'detail.js:grid.innerHTML = `<div class="session-empty">${i18nT(\'detail.photo.empty\')}</div>`;',
  'detail.js:grid.innerHTML = list.map((p, idx) => {',
  'detail.js:mc.innerHTML = mhtml;',
  'detail.js:wc.innerHTML = weekOrder.map(([key, v]) =>',
  'header-status.js:_el.innerHTML = `<span class="status-icon" aria-hidden="true">${status.icon}</span>${badgeHtml}`;',
  'i18n.js:*   - data-i18n-html         → innerHTML (⚠️ فقط برای رشته‌های امن)',
  'i18n.js:// ─── data-i18n-html (innerHTML — فقط برای رشته‌های امن) ───',
  'i18n.js:el.innerHTML = value;',
  'location-ui.js:body.innerHTML = `<div class="saved-locations-body">${sorted.map(x => `',
  'location-ui.js:body.innerHTML = `<div class="session-empty">${i18nT(\'location.emptyList\')}</div>`;',
  'location-ui.js:box.innerHTML = `',
  'location-ui.js:if (actions.innerHTML !== ah) actions.innerHTML = ah;',
  'location-ui.js:if (line.innerHTML !== html) line.innerHTML = html;',
  'location-ui.js:if (list.innerHTML !== html) list.innerHTML = html;',
  'location-ui.js:if (text.innerHTML !== html) text.innerHTML = html;',
  'map-search.js:resultsEl.innerHTML = \'<div class="map-search-empty">مکانی یافت نشد</div>\';',
  'map-search.js:resultsEl.innerHTML = \'<div class="map-search-loading">در حال جستجو...</div>\';',
  'map-search.js:resultsEl.innerHTML = `<div class="map-search-empty">${escapeHtml(msg)}</div>`;',
  'map-search.js:resultsEl.innerHTML = results.map((r, i) => {',
  'map.js:if (el) el.innerHTML = \'<div class="map-fallback">برای نمایش نقشه به اینترنت نیاز است.<br>برنامه بدون نقشه هم کامل کار می‌کند.</div>\';',
  'communication/conversations.js:// ⚠️ بدون innerHTML — فقط DOM API و textContent.',
  'communication/groups.js://    گروه local-first نیست. همه‌ی requestها فقط از js/api.js. بدون innerHTML.',
  'communication/search.js:// ⚠️ فقط واردشده‌ها (فضا گیت ورود دارد). بدون innerHTML.',
  'communication/shares.js:// ⚠️ همه‌ی requestها فقط از js/api.js. بدون innerHTML.',
  'navigation/sidebar.js://   - هیچ innerHTML — فقط DOM API و textContent',
  'navigation/workspace.js:// ⚠️ بدون innerHTML — این ماژول فقط hidden را جابه‌جا می‌کند.',
  'picker.js:container.innerHTML = keys.map(k =>',
  'picker.js:document.getElementById(\'pickerDays\').innerHTML = html;',
  'route-ui.js:el.innerHTML = `<div class="route-summary-title"><button type="button" class="route-summary-close" data-route-close aria-label="بستن" title="بستن">×</button><span class="route-summary-title-text">${title}</span></div><div class="route-options">${rows}</div>`;',
  'sessions.js:wrap.innerHTML = \'\';',
  'sessions.js:wrap.innerHTML = sorted.map(s =>',
  'ui.js:* رندر کامل — innerHTML-based.',
  'ui.js://   - برای تغییرات ساختاری (filter/sort/search/editing)، همچنان innerHTML می‌سازد',
  'ui.js:box.innerHTML = `<div class="stats-title">${titleText}</div><div class="bars">` +',
  'ui.js:chip.innerHTML = `📅 ${formatDate(new Date(gy, gm - 1, gd), { day: \'numeric\', month: \'long\' })} <b>✕</b>`;',
  'ui.js:container.innerHTML = keys.map(k =>',
  'ui.js:document.getElementById(\'calDays\').innerHTML = html;',
  'ui.js:el.innerHTML = `<div class="session-empty">${i18nT(\'trash.empty\')}</div>`;',
  'ui.js:el.innerHTML = `<div class="tpl-list">` + PLAN_TEMPLATES.map(x =>',
  'ui.js:el.innerHTML = sorted.map(x => {',
  'ui.js:el.innerHTML = tplDraft.kids.length ? tplDraft.kids.map((k, i) =>',
  'ui.js:taskList.innerHTML = `',
  'ui.js:taskList.innerHTML = filtered.map(task => {',
  'ui.js:textEl.innerHTML = iconHtml + escapeHtml(op.patches.text);',
  'ui/badge.js://    بدون innerHTML — فقط textContent و hidden.',
  'ui/menu.js://   - هیچ innerHTML — فقط DOM API و textContent (محتوای کاربر هرگز HTML نمی‌شود)',
  'ui/sheet.js://    بدون innerHTML — فقط DOM API و textContent.',
  'weather-modal.js:if (content) content.innerHTML = html;',
  'ui/avatar-settings.js://    انتظار confirm → PATCH با `media:<id>`). هیچ innerHTML.',
  'ui/avatar.js:// ⚠️ بدون innerHTML.',
  'welcome-wizard.js:// ⚠️ بدون innerHTML — فقط DOM API و textContent (به‌جز رشته‌های استاتیک لوکال',
]);

function collectInnerHtml() {
  const found = new Set();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.js')) continue;
      const rel = path.relative(JS_DIR, full).replace(/\\/g, '/');
      const lines = fs.readFileSync(full, 'utf8').split('\n');
      for (const raw of lines) {
        if (!raw.includes('innerHTML')) continue;
        // ⚠️ فایل‌ها CRLF هستند — \r هم باید پاک شود
        const line = raw.replace(/^\s+|\s+$/g, '');
        found.add(`${rel}:${line}`);
      }
    }
  };
  walk(JS_DIR);
  return found;
}

describe('security baseline — innerHTML', () => {
  it('مورد innerHTML جدیدی اضافه نشده است', () => {
    const current = collectInnerHtml();
    const unknown = [...current].filter((fp) => !BASELINE.has(fp));
    expect(
      unknown,
      unknown.length > 0
        ? `موارد innerHTML جدید (نیازمند بازبینی امنیتی):\n- ${unknown.join('\n- ')}\n` +
          'یا با textContent جایگزین کن یا با دلیل به BASELINE اضافه کن.'
        : 'new innerHTML found'
    ).toEqual([]);
  });
});
