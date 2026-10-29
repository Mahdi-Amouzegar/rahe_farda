// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// js/ui/account-profile.js -- سه ردیف ویرایش‌پذیر «حساب من» (۱۰.۴۵)
//
// این ماژول کادر `auth-user-info` مودال حساب من را می‌سازد:
//   ۱. نام           → ویرایش درجا (PATCH displayName)
//   ۲. نام کاربری     → ویرایش درجا (PATCH username) + اعتبارسنجی
//   ۳. آواتار         → تصویر + «ویرایش»/«حذف»
//
// ⚠️ هیچ innerHTML ندارد؛ همه‌چیز با DOM API و textContent ساخته می‌شود
//    (گارد امنیتی test/security-baseline.test.js).
//
// ⚠️ قواعد نام کاربری = همان قواعد سرور (فاز ۱۲):
//    `^[a-z][a-z0-9_]{2,19}$` — حرف کوچک انگلیسی شروع، سپس حرف/عدد/آندرلاین،
//    ۳ تا ۲۰ کاراکتر. **خط تیره مجاز نیست** چون canonicalUsername خط تیره را
//    حذف می‌کند و `a-li` با `ali` از نظر سیاست یکی می‌شود.
//    اعتبارسنجی سمت کلاینت فقط برای بازخورد سریع است؛ مرجع نهایی سرور است.
//
// ⚠️ نام‌های «قابل واگذاری» (USERNAME_PREMIUM_REVIEW) با راهنما نمایش داده
//    می‌شوند: کاربر باید به `rahefarda_support` پیام بدهد.
// ═══════════════════════════════════════════════════════════════════════════

import { apiFetch, apiErrorMessage } from '../api.js';
import { t as i18nT } from '../i18n.js';
import { getCurrentUser, isLoggedIn, setStoredUserFields } from '../auth.js';
import { avatarNode, clearAvatarCache } from './avatar.js';
import { uploadAvatarFile } from './avatar-settings.js';

/** الگوی نام کاربری — آینه‌ی `USERNAME_RE` در `src/users/username-policy.ts` */
export const USERNAME_RE = /^[a-z][a-z0-9_]{2,19}$/;
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const DISPLAY_NAME_MAX = 100;

/** نام کاربری‌ای که درخواستش باید به پشتیبانی برود */
export const SUPPORT_HANDLE = 'rahefarda_support';

function tr(key, fallback) {
    const v = i18nT(key);
    return v !== key ? v : fallback;
}

/**
 * ساخت المان ساده (بدون innerHTML).
 *
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [text]
 * @returns {HTMLElement}
 */
function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
}

/**
 * نرمال‌سازی نام کاربری — همان کاری که سرور می‌کند (trim + lowercase).
 *
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeUsername(raw) {
    return String(raw === null || raw === undefined ? '' : raw).trim().toLowerCase();
}

/**
 * اعتبارسنجی سمت کلاینت (بازخورد سریع؛ مرجع سرور است).
 *
 * @param {unknown} raw
 * @returns {{ok: boolean, value: string}}
 */
export function validateUsernameInput(raw) {
    const value = normalizeUsername(raw);
    return { ok: USERNAME_RE.test(value), value };
}

/**
 * اعتبارسنجی نام نمایشی.
 *
 * @param {unknown} raw
 * @returns {{ok: boolean, value: string}}
 */
export function validateDisplayNameInput(raw) {
    const value = String(raw === null || raw === undefined ? '' : raw).trim();
    return { ok: value.length > 0 && value.length <= DISPLAY_NAME_MAX, value };
}

/**
 * پروفایل از کش محلی session (بدون شبکه) — برای رندر فوری.
 *
 * @returns {{displayName: string|null, username: string|null, avatarUrl: string|null}}
 */
function localProfile() {
    const local = getCurrentUser() || {};
    return {
        displayName: local.displayName || null,
        username: local.username || null,
        avatarUrl: local.avatarUrl || null,
    };
}

/**
 * خواندن پروفایل از سرور.
 *
 * ⚠️ سقف زمان کوتاه‌تر از پیش‌فرض (۶ ثانیه): این درخواست فقط «تازه‌سازی» است و
 *    کش محلی از قبل نمایش داده شده؛ اگر آفلاین باشیم نباید مودال منتظر بماند.
 *
 * @returns {Promise<object|null>} null یعنی شکست (کش محلی معتبر بماند)
 */
async function fetchProfile() {
    try {
        const res = await apiFetch('/api/users/me', { timeoutMs: 6000 });
        if (!res || !res.ok || !res.data) return null;
        return {
            displayName: res.data.displayName || null,
            username: res.data.username || null,
            avatarUrl: res.data.avatarUrl || null,
        };
    } catch {
        return null;
    }
}

/**
 * یک ردیف ویرایش‌پذیر (نام یا نام کاربری).
 *
 * @param {object} cfg
 * @param {string} cfg.kind — 'displayName' | 'username'
 * @param {string} cfg.label
 * @param {string|null} cfg.value — مقدار خام (داخل input)
 * @param {string} [cfg.display] — شکل نمایشی (مثلاً «@name»)؛ پیش‌فرض value
 * @param {string} [cfg.dir]
 * @param {string} [cfg.placeholder]
 * @param {string} [cfg.hint]
 * @param {number} [cfg.maxLength]
 * @param {() => void} cfg.onSaved
 * @returns {HTMLElement}
 */
function buildFieldRow(cfg) {
    const row = el('div', 'auth-edit-row');
    row.dataset.field = cfg.kind;

    const label = el('span', 'auth-edit-label', cfg.label);
    const valueWrap = el('span', 'auth-edit-value-wrap');

    const strong = el('strong', 'auth-edit-value', cfg.display || cfg.value || '—');
    if (cfg.dir) strong.setAttribute('dir', cfg.dir);
    valueWrap.appendChild(strong);

    const actions = el('span', 'auth-row-actions');
    const editBtn = el('button', 'btn-small auth-edit-btn', tr('auth.loggedIn.editButton', 'ویرایش'));
    editBtn.type = 'button';
    actions.appendChild(editBtn);

    const hintEl = el('small', 'auth-edit-hint', cfg.hint || '');
    hintEl.hidden = !cfg.hint;

    const errorEl = el('div', 'auth-edit-error');
    errorEl.hidden = true;

    row.appendChild(label);
    row.appendChild(valueWrap);
    row.appendChild(actions);
    row.appendChild(hintEl);
    row.appendChild(errorEl);

    let editing = false;

    const showError = (msg) => {
        errorEl.textContent = String(msg || '');
        errorEl.hidden = !msg;
    };

    const stopEdit = () => {
        editing = false;
        valueWrap.replaceChildren(strong);
        actions.replaceChildren(editBtn);
        hintEl.hidden = !cfg.hint;
        showError('');
        editBtn.focus({ preventScroll: true });
    };

    const save = async (input, saveBtn) => {
        const check = cfg.kind === 'username'
            ? validateUsernameInput(input.value)
            : validateDisplayNameInput(input.value);
        if (!check.ok) {
            showError(cfg.kind === 'username'
                ? tr('auth.loggedIn.usernameInvalid', 'نام کاربری معتبر نیست')
                : tr('auth.loggedIn.nameInvalid', 'نام نمی‌تواند خالی باشد'));
            input.focus({ preventScroll: true });
            return;
        }
        saveBtn.disabled = true;
        const body = cfg.kind === 'username'
            ? { username: check.value }
            : { displayName: check.value };
        let res;
        try {
            res = await apiFetch('/api/users/me', { method: 'PATCH', body });
        } catch {
            res = { ok: false, error: { code: 'NETWORK_ERROR', message: '' } };
        }
        saveBtn.disabled = false;

        if (!res || !res.ok) {
            const err = res && res.error;
            // ⚠️ برای «نام»، پیام سرور دقیق‌تر است: مپ کدهای USERNAME_*
            //    متن «نام کاربری…» می‌دهد که برای فیلد نام گمراه‌کننده است.
            const msg = (cfg.kind === 'displayName' && err && err.message)
                ? err.message
                : apiErrorMessage(err);
            showError(msg);
            // ⚠️ نام «قابل واگذاری» → راهنمای تماس با پشتیبانی
            if (err && err.code === 'USERNAME_PREMIUM_REVIEW') {
                hintEl.textContent = tr('auth.loggedIn.usernameSpecialHint', '') ||
                    ('برای دریافت این نام به ' + SUPPORT_HANDLE + ' پیام بدهید.');
                hintEl.hidden = false;
            }
            input.focus({ preventScroll: true });
            return;
        }

        const data = res.data || {};
        if (cfg.kind === 'username') {
            setStoredUserFields({ username: data.username || check.value });
        } else {
            setStoredUserFields({ displayName: data.displayName || check.value });
        }
        editing = false;
        if (typeof cfg.onSaved === 'function') cfg.onSaved();
    };

    const startEdit = () => {
        if (editing) return;
        editing = true;
        showError('');
        hintEl.textContent = cfg.hint || '';
        hintEl.hidden = !cfg.hint;

        const input = el('input', 'auth-inline-input');
        input.type = 'text';
        input.value = cfg.value || '';
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.maxLength = cfg.maxLength || DISPLAY_NAME_MAX;
        if (cfg.dir) input.setAttribute('dir', cfg.dir);
        if (cfg.placeholder) input.placeholder = cfg.placeholder;

        const saveBtn = el('button', 'btn-small auth-save-btn', tr('auth.loggedIn.saveButton', 'ذخیره'));
        saveBtn.type = 'button';
        const cancelBtn = el('button', 'btn-clear auth-cancel-btn', tr('auth.loggedIn.cancelButton', 'انصراف'));
        cancelBtn.type = 'button';

        saveBtn.addEventListener('click', () => { save(input, saveBtn); });
        cancelBtn.addEventListener('click', stopEdit);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                save(input, saveBtn);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                stopEdit();
            }
        });

        valueWrap.replaceChildren(input);
        actions.replaceChildren(saveBtn, cancelBtn);
        input.focus({ preventScroll: true });
        try { input.select(); } catch { /* silent */ }
    };

    editBtn.addEventListener('click', startEdit);
    return row;
}

/**
 * ردیف آواتار: تصویر + ویرایش/حذف.
 *
 * @param {{avatarUrl: string|null, displayName: string|null, username: string|null}} data
 * @param {() => void} onSaved
 * @returns {HTMLElement}
 */
function buildAvatarRow(data, onSaved) {
    const row = el('div', 'auth-edit-row auth-avatar-row');
    row.dataset.field = 'avatar';

    const label = el('span', 'auth-edit-label', tr('auth.loggedIn.avatarLabel', 'آواتار:'));
    const slot = el('span', 'auth-avatar-slot');
    const thumb = avatarNode(
        data.avatarUrl || null,
        data.displayName || data.username || '?',
        'conv-avatar auth-avatar-thumb'
    );
    slot.appendChild(thumb);

    const actions = el('span', 'auth-row-actions');
    const changeBtn = el('button', 'btn-small auth-edit-btn', tr('auth.loggedIn.editButton', 'ویرایش'));
    changeBtn.type = 'button';
    const removeBtn = el('button', 'btn-clear auth-remove-btn', tr('avatar.remove', 'حذف'));
    removeBtn.type = 'button';
    removeBtn.disabled = !data.avatarUrl;
    actions.appendChild(changeBtn);
    actions.appendChild(removeBtn);

    const errorEl = el('div', 'auth-edit-error');
    errorEl.hidden = true;

    const input = el('input', 'auth-avatar-input');
    input.type = 'file';
    input.accept = 'image/*';
    input.hidden = true;

    row.appendChild(label);
    row.appendChild(slot);
    row.appendChild(actions);
    row.appendChild(errorEl);
    row.appendChild(input);

    const showError = (msg) => {
        errorEl.textContent = String(msg || '');
        errorEl.hidden = !msg;
    };

    const patchAvatar = async (ref) => {
        const res = await apiFetch('/api/users/me', { method: 'PATCH', body: { avatarUrl: ref } });
        if (!res || !res.ok) {
            showError(apiErrorMessage(res && res.error));
            return false;
        }
        clearAvatarCache();
        setStoredUserFields({ avatarUrl: ref || null });
        if (typeof onSaved === 'function') onSaved();
        return true;
    };

    changeBtn.addEventListener('click', () => input.click());
    removeBtn.addEventListener('click', async () => {
        removeBtn.disabled = true;
        const ok = await patchAvatar(null);
        if (!ok) removeBtn.disabled = false;
    });

    input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        changeBtn.disabled = true;
        showError('');
        try {
            const ref = await uploadAvatarFile(file);
            if (!ref) {
                showError(tr('avatar.uploadFailed', 'آپلود ناموفق بود.'));
                return;
            }
            await patchAvatar(ref);
        } finally {
            changeBtn.disabled = false;
            input.value = '';
        }
    });

    return row;
}

/**
 * رندر کادر پروفایل داخل مودال «حساب من».
 *
 * @param {{onChange?: () => void}} [opts]
 * @returns {Promise<void>}
 */
export async function renderAccountProfile(opts) {
    const box = document.getElementById('accountProfileBlock');
    if (!box) return;
    const options = opts || {};
    const onChange = () => {
        renderAccountProfile(options).catch(() => {});
        if (typeof options.onChange === 'function') options.onChange();
    };

    const paint = (data) => {
        box.replaceChildren();
        box.appendChild(buildFieldRow({
            kind: 'displayName',
            label: tr('auth.loggedIn.nameLabel', 'نام:'),
            value: data.displayName,
            placeholder: tr('auth.loggedIn.namePlaceholder', 'نام شما'),
            maxLength: DISPLAY_NAME_MAX,
            onSaved: onChange,
        }));

        box.appendChild(buildFieldRow({
            kind: 'username',
            label: tr('auth.loggedIn.usernameLabel', 'نام کاربری:'),
            value: data.username || '',
            display: data.username ? '@' + data.username : null,
            dir: 'ltr',
            placeholder: tr('auth.loggedIn.usernamePlaceholder', 'username'),
            hint: tr('auth.loggedIn.usernameHint', 'حروف کوچک انگلیسی، عدد و _ — ۳ تا ۲۰ کاراکتر'),
            maxLength: USERNAME_MAX,
            onSaved: onChange,
        }));

        box.appendChild(buildAvatarRow(data, onChange));
    };

    if (!isLoggedIn()) {
        box.replaceChildren();
        return;
    }

    // ۱) رندر فوری از کش محلی — مودال هرگز «خالی» دیده نمی‌شود
    paint(localProfile());

    // ۲) تازه‌سازی از سرور (اگر آفلاین بود، همان کش محلی می‌ماند)
    const fresh = await fetchProfile();
    if (!fresh) return;
    if (!document.getElementById('accountProfileBlock')) return;
    // ⚠️ اگر کاربر مشغول ویرایش است، رندر دوباره ورودی‌اش را نابود می‌کند
    if (box.querySelector('.auth-inline-input')) return;
    paint(fresh);
}

/**
 * ریست تست‌ها.
 */
export function __resetAccountProfileForTest() {
    // هیچ state داخلی‌ای نگه نمی‌داریم؛ فقط برای هم‌شکلی با بقیه‌ی ماژول‌ها.
}
