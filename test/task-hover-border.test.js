// © Mahdi Amouzegar — All rights reserved | مهدی آموزگار — همه حقوق محفوظ است
// test/task-hover-border.test.js -- گارد رگرسیون BUG-35 (هاور کل کادر را آبی کند)
//
// باگ: نوار اولویت کارت خودی (`side-own`/`shared-mine`) با قاعده‌ی سه‌کلاسی
// رنگی می‌ماند و `.task-item:hover` (دو کلاس) رویش را نمی‌گرفت؛ نتیجه: در هاور
// سه ضلع کادر آبی می‌شد و نوار سمت راست نه. تست jsdom نمی‌تواند `:hover` را
// شبیه‌سازی کند، پس اینجا فقط «وجود و ترتیب» قاعده را در CSS چک می‌کنیم —
// ترتیب مهم است چون specificity دو قاعده برابر است.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '..', 'public', 'css', 'components.css'), 'utf8');

function indexOfRule(needle) {
    return css.indexOf(needle);
}

describe('CSS — هاور نوار اولویت کارت خودی (BUG-35)', () => {
    it('قاعده‌ی هاور مخصوص side-own/shared-mine وجود دارد', () => {
        expect(css).toContain('.task-item.side-own:hover');
        expect(css).toContain('.task-item.shared-mine:hover');
    });

    it('بعد از قواعد رنگی اولویت می‌آید (ترتیب آبشاری درست)', () => {
        const prio = indexOfRule('.task-item.side-own.prio-high');
        const hover = indexOfRule('.task-item.side-own:hover');
        expect(prio).toBeGreaterThan(-1);
        expect(hover).toBeGreaterThan(prio);
    });

    it('رنگ نوار در هاور از متغیر مشترک هاور می‌آید، نه رنگ اولویت', () => {
        const hover = indexOfRule('.task-item.side-own:hover');
        const block = css.slice(hover, hover + 400);
        expect(block).toContain('border-inline-start-color');
        expect(block).toContain('var(--task-hover-border');
        // رنگ ثابت اولویت نباید داخل این قاعده باشد
        expect(block).not.toContain('--accent-pink');
        expect(block).not.toContain('--accent-yellow');
    });

    it('قواعد هاور عمومی متغیر رنگ را ست می‌کنند', () => {
        expect(css).toContain('--task-hover-border: var(--accent-cyan-border)');
        expect(css).toContain('--task-hover-border: var(--accent-primary)');
    });
});
