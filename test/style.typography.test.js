// 排版（Task 34，spec §4.1–§4.4）：字号改用 type token、font: inherit、字号相对 b733093 只变确认过的那几处。
// 比对基线 b733093 是 M-F 确认字号时的代码（设计规范化开始之前的 main）。
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCss, readStyleCss } from './helpers/cssRules.js';
import { dimViolations, DEFAULT_ALLOW } from './helpers/styleLint.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_COMMIT = 'b733093';

const css = readStyleCss();
const rules = parseCss(css);
const baseCss = execFileSync('git', ['show', `${BASE_COMMIT}:style.css`], {
  cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
});

// 某个选择器在顶层（不在 @media 里）所有规则的声明，按源码顺序合并。
function declsOf(ruleList, selector) {
  return ruleList
    .filter((r) => r.media === null && r.selectors.some((s) => s.text === selector))
    .flatMap((r) => r.decls);
}
const lastOf = (decls, prop) => decls.filter((d) => d.prop === prop).at(-1)?.value;
const idxOf = (decls, prop) => decls.map((d) => d.prop).lastIndexOf(prop);

// --- 字号解析：把 font-size / font 声明解析成 px 数值，解析不了的（运行时变量）保持字符串 ---

function rootVars(ruleList) {
  const vars = new Map();
  for (const r of ruleList) {
    if (r.media !== null) continue;
    if (!r.selectors.every((s) => s.text === ':root' || s.text === '[data-theme="dark"]')) continue;
    for (const d of r.decls) if (d.prop.startsWith('--')) vars.set(d.prop, d.value);
  }
  return vars;
}

function expandVars(value, vars) {
  let out = value;
  for (let i = 0; i < 10; i += 1) {
    const next = out.replace(/var\((--[\w-]+)\)/g, (m, name) => (vars.has(name) ? vars.get(name) : m));
    if (next === out) break;
    out = next;
  }
  return out;
}

function sizeToPx(value, vars) {
  const v = expandVars(value.trim(), vars);
  if (/^inherit$/i.test(v)) return 'inherit';
  const m = /(?:^|\s)(\d*\.?\d+)(px|rem)(?:\/\S+)?(?=\s|$)/.exec(v);
  if (m) return Number(m[1]) * (m[2] === 'rem' ? 16 : 1);
  const rt = /^var\((--[\w-]+)\)$/.exec(v);
  if (rt) return `runtime:${rt[1]}`;
  return `unparsed:${v}`;
}

// 每个选择器（带 media 前缀）最后一次声明的字号；纯 inherit 不计。
function fontSizeMap(cssText) {
  const list = parseCss(cssText);
  const vars = rootVars(list);
  const map = new Map();
  for (const r of list) {
    let size = null;
    for (const d of r.decls) {
      if (d.prop === 'font-size' || d.prop === 'font') size = sizeToPx(d.value, vars);
    }
    if (size === null || size === 'inherit') continue;
    for (const s of r.selectors) map.set(`${r.media ?? ''}|${s.text.replace(/\s+/g, ' ')}`, size);
  }
  return map;
}

// M-F 确认要变的字号（spec §4.2「M-F 字号结论」），键为选择器，值为 [b733093, 现在]。
const CONFIRMED_CHANGES = {
  '.sidebar-note': [13.12, 13],
  '.tz-label': [11.2, 12],
  '.app-toast': [14.4, 14],
  '.move-to-main-hint': [24, 20],
  '.login-consent-title': [18, 20],
  '.sync-conflict-title': [18, 20],
  '.lang-toggle': [12.48, 13],
};
// M-F 选「保持」的紧凑表单选择器（spec §4.4「紧凑表单例外」）。
const KEPT_AT_13 = ['.engine-form-input', '.engine-form-save', '.engine-form-cancel', '.icon-upload-btn', '.icon-clear-btn'];
const NEW_SELECTORS = ['.icon-letter', '.icon-letter-sm'];

describe('raw-font-size 归零', () => {
  it('style.css 里没有 font-size / font 的字面值（白名单只有 G-3 的 30px、10px）', () => {
    const left = dimViolations(css, { allow: DEFAULT_ALLOW }).filter((v) => v.rule === 'raw-font-size');
    expect(left.map((v) => `${v.line} ${v.selector} ${v.prop}: ${v.value}`)).toEqual([]);
  });

  it('白名单里的字号值恰好是 30px 与 10px，且只有 .icon-letter / .icon-letter-sm 在用', () => {
    expect(DEFAULT_ALLOW).toEqual(expect.arrayContaining(['30px', '10px']));
    const users = rules.flatMap((r) => r.decls
      .filter((d) => d.prop === 'font-size' && /^\d/.test(d.value))
      .map((d) => `${r.selectors.map((s) => s.text).join(', ')}: ${d.value}`));
    expect(users.sort()).toEqual(['.icon-letter-sm: 10px', '.icon-letter: 30px']);
  });

  it('style.css 没有 rem 字号和 bold 字重', () => {
    const decls = rules.flatMap((r) => r.decls);
    expect(decls.filter((d) => d.prop === 'font-size' && /rem/.test(d.value))).toEqual([]);
    expect(decls.filter((d) => d.prop === 'font-weight' && /^(bold|bolder|700)$/.test(d.value))).toEqual([]);
  });
});

describe('type token 的使用', () => {
  const fontOf = (sel) => lastOf(declsOf(rules, sel), 'font');

  it('时钟用 type.clock，字间距用 tracking.clock', () => {
    expect(fontOf('.clock-text')).toBe('var(--type-clock)');
    expect(lastOf(declsOf(rules, '.clock-text'), 'letter-spacing')).toBe('var(--font-tracking-clock)');
  });

  it('弹窗标题、文件夹名、拖到主网格提示用 type.title.lg', () => {
    for (const s of ['.modal-title', '.dialog-title', '.dialog-plain-title', '.login-consent-title',
      '.sync-conflict-title', '.folder-name-input', '.move-to-main-hint']) {
      expect(fontOf(s), s).toBe('var(--type-title-lg)');
    }
  });

  it('侧栏标题、裁剪弹窗标题用 type.title.md', () => {
    for (const s of ['.sidebar-title', '.icon-crop-title']) expect(fontOf(s), s).toBe('var(--type-title-md)');
  });

  it('.btn-*、.type-btn、.sidebar-action-btn 用 type.label.md', () => {
    for (const s of ['.btn-secondary', '.btn-danger', '.btn-primary', '.type-btn', '.sidebar-action-btn']) {
      expect(fontOf(s), s).toBe('var(--type-label-md)');
    }
  });

  it('.sidebar-value 与 .lang-toggle 用 type.label.sm', () => {
    for (const s of ['.sidebar-value', '.lang-toggle']) expect(fontOf(s), s).toBe('var(--type-label-sm)');
  });

  it('font 简写后面不再跟同一规则里的 font-size / font-weight / line-height 覆写', () => {
    for (const r of rules) {
      const names = r.decls.map((d) => d.prop);
      const i = names.lastIndexOf('font');
      if (i === -1) continue;
      const after = names.slice(i + 1).filter((p) => p === 'font-size' || p === 'font-weight' || p === 'line-height');
      expect(after, r.selectors.map((s) => s.text).join(', ')).toEqual([]);
    }
  });

  it('font-variant-numeric 写在 font 之后', () => {
    for (const s of ['.clock-text', '.sidebar-value']) {
      const d = declsOf(rules, s);
      expect(idxOf(d, 'font'), s).toBeGreaterThanOrEqual(0);
      expect(idxOf(d, 'font-variant-numeric'), s).toBeGreaterThan(idxOf(d, 'font'));
    }
  });

  it('字重只用 token（var(--font-weight-*)）或 300-600 的数字，没有 700', () => {
    for (const d of rules.flatMap((r) => r.decls).filter((x) => x.prop === 'font-weight')) {
      expect(d.value, `line ${d.line}`).toMatch(/^(var\(--font-weight-\w+\)|[3-6]00)$/);
    }
  });

  it('行高只用无单位数字或 var()，不再有 18px / 20px / 22px 这类像素行高', () => {
    for (const d of rules.flatMap((r) => r.decls).filter((x) => x.prop === 'line-height')) {
      expect(d.value, `line ${d.line}`).toMatch(/^(var\(--font-leading-\w+\)|\d*\.?\d+)$/);
    }
  });
});

describe('字间距', () => {
  it('只有时钟与拖放提示有非 0 letter-spacing，且都用 token', () => {
    const nonZero = [];
    for (const r of rules) {
      for (const d of r.decls) {
        if (d.prop !== 'letter-spacing') continue;
        if (/^(0|0px|normal|var\(--font-tracking-none\))$/.test(d.value)) continue;
        nonZero.push(`${r.selectors.map((s) => s.text).join(', ')}: ${d.value}`);
      }
    }
    expect(nonZero.sort()).toEqual([
      '.clock-text: var(--font-tracking-clock)',
      '.move-to-main-hint: var(--font-tracking-wide)',
    ]);
  });
});

describe('首字母占位（G-3）', () => {
  it('.icon-letter 固定 30px、.icon-letter-sm 固定 10px，字重都是 semibold', () => {
    expect(lastOf(declsOf(rules, '.icon-letter'), 'font-size')).toBe('30px');
    expect(lastOf(declsOf(rules, '.icon-letter-sm'), 'font-size')).toBe('10px');
    for (const s of ['.icon-letter', '.icon-letter-sm', '.folder-mini-letter', '.folder-slot-letter', '.move-to-main-hint']) {
      const d = declsOf(rules, s);
      // type.title.lg 的字重是 semibold（spec §4.4），用 font 简写的选择器按它算
      const font = lastOf(d, 'font');
      const w = lastOf(d, 'font-weight') ?? (font === 'var(--type-title-lg)' ? 'var(--font-weight-semibold)' : font);
      expect(w, s).toMatch(/semibold|600/);
    }
  });

  it('.folder-slot-letter / .folder-mini-letter 的字号来自 JS 写入的运行时变量，不是字面值', () => {
    expect(lastOf(declsOf(rules, '.folder-slot-letter'), 'font-size')).toBe('var(--preview-letter-size)');
    expect(lastOf(declsOf(rules, '.folder-mini-letter'), 'font-size')).toBe('var(--folder-mini-letter-size)');
  });
});

describe('button, input, select, textarea { font: inherit }', () => {
  const tagRules = rules.filter((r) => r.media === null
    && r.selectors.every((s) => ['button', 'input', 'select', 'textarea'].includes(s.text)));

  it('只有一条，选择器恰好是这四个标签，声明恰好是 font: inherit', () => {
    expect(tagRules).toHaveLength(1);
    expect(tagRules[0].selectors.map((s) => s.text).sort()).toEqual(['button', 'input', 'select', 'textarea']);
    expect(tagRules[0].decls.map((d) => [d.prop, d.value])).toEqual([['font', 'inherit']]);
  });

  it('放在全局重置（*, *::before, *::after）之后、body 规则之前', () => {
    const reset = rules.find((r) => r.media === null && r.selectors.some((s) => s.text === '*'));
    const body = rules.find((r) => r.media === null && r.selectors.some((s) => s.text === 'body'));
    expect(tagRules[0].line).toBeGreaterThan(reset.line);
    expect(tagRules[0].line).toBeLessThan(body.line);
  });
});

describe('字号与 b733093 的差异恰好是 M-F 确认的清单', () => {
  const oldMap = fontSizeMap(baseCss);
  const newMap = fontSizeMap(css);
  const keyOf = (sel) => `|${sel}`;

  it('解析器能读到足够多的选择器（防止比对空转）', () => {
    expect(oldMap.size).toBeGreaterThan(60);
    expect(newMap.size).toBeGreaterThan(60);
  });

  it('b733093 里每个有字号的选择器，现在仍有字号声明', () => {
    const missing = [...oldMap.keys()].filter((k) => !newMap.has(k));
    expect(missing).toEqual([]);
  });

  it('差异恰好是确认清单，数值逐条相符', () => {
    const diffs = {};
    for (const [k, oldPx] of oldMap) {
      const newPx = newMap.get(k);
      const same = typeof oldPx === 'number' && typeof newPx === 'number'
        ? Math.abs(oldPx - newPx) < 1e-9 : oldPx === newPx;
      if (!same) diffs[k.replace(/^\|/, '')] = [oldPx, newPx];
    }
    expect(diffs).toEqual(CONFIRMED_CHANGES);
  });

  it('新出现的有字号的选择器只有 G-3 的两个类', () => {
    const added = [...newMap.keys()].filter((k) => !oldMap.has(k)).map((k) => k.replace(/^\|/, ''));
    expect(added.sort()).toEqual([...NEW_SELECTORS].sort());
  });

  it('M-F 选「保持」的选择器，字号与 b733093 相同（逐条）', () => {
    for (const sel of KEPT_AT_13) {
      expect(oldMap.get(keyOf(sel)), `${sel} @${BASE_COMMIT}`).toBe(13);
      expect(newMap.get(keyOf(sel)), `${sel} @HEAD`).toBe(oldMap.get(keyOf(sel)));
    }
  });

  it('运行时变量驱动的字号没有变', () => {
    for (const sel of ['.folder-slot-letter', '.folder-mini-letter']) {
      expect(newMap.get(keyOf(sel))).toBe(oldMap.get(keyOf(sel)));
      expect(String(newMap.get(keyOf(sel)))).toMatch(/^runtime:--/);
    }
  });
});

describe('app.js 的首字母占位改用 class', () => {
  const appJs = readFileSync(resolve(REPO_ROOT, 'app.js'), 'utf8');
  it('不再写 font-size / font-weight 内联样式', () => {
    expect(appJs).not.toMatch(/font-size:\s*(1\.875rem|10px)/);
    expect(appJs).not.toMatch(/font-weight:\s*(bold|600)/);
  });
  it('大号用 icon-letter，小号用 icon-letter-sm', () => {
    expect(appJs).toMatch(/class="icon-letter"/);
    expect(appJs).toMatch(/class="icon-letter-sm"/);
  });
});
