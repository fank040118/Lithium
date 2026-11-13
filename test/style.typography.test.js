// 排版：字号改用 type token、font: inherit、字号相对 b733093 只变确认过的那几处。
// 比对基线 b733093 是设计规范化开始之前的 main，字号变化以它为准。
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
// 读不到基线提交（浅克隆、gc、git 不可用）时明确失败，不允许静默跳过：没有这份比对，「字号只变确认过的 7 项」就没有证据。
let baseCss;
try {
  baseCss = execFileSync('git', ['show', `${BASE_COMMIT}:style.css`], {
    cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
} catch (e) {
  const detail = [e.message, e.stderr && String(e.stderr).trim()].filter(Boolean).join(' | ');
  throw new Error(`需要 git 历史 ${BASE_COMMIT} 才能做字号比对（读不到 ${BASE_COMMIT}:style.css，需要完整的 git 历史）：${detail}`);
}

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
  if (/^(inherit|unset|initial|revert|revert-layer)$/i.test(v)) return 'inherit';
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
    if (size === null) continue;   // inherit / unset 也要记入：后置的 font-size: inherit 会把字号改成继承值
    for (const s of r.selectors) map.set(`${r.media ?? ''}|${s.text.replace(/\s+/g, ' ')}`, size);
  }
  return map;
}

// 明确确认要变的字号，键为选择器，值为 [b733093, 现在]。
const CONFIRMED_CHANGES = {
  '.tz-label': [11.2, 12],
  '.app-toast': [14.4, 14],
  '.move-to-main-hint': [24, 20],
  '.login-consent-title': [18, 20],
  '.sync-conflict-title': [18, 20],
  '.lang-toggle': [12.48, 13],
};
// 明确选择「保持 13px」的紧凑表单选择器（排版规范里的紧凑表单例外）。
const KEPT_AT_13 = ['.engine-form-input', '.engine-form-save', '.engine-form-cancel', '.icon-upload-btn', '.icon-clear-btn'];
// 迁移中删掉的死 CSS：页面里没有任何元素使用，b733093 里有字号、现在没有，不算字号变化。
const REMOVED_DEAD_CSS = ['.sidebar-note'];
const NEW_SELECTORS = ['.icon-letter', '.icon-letter-sm'];
const FORM_TAGS = ['button', 'input', 'select', 'textarea'];

describe('raw-font-size 归零', () => {
  it('style.css 里没有 font-size / font 的字面值（白名单只有首字母占位的 30px、10px）', () => {
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

// 排版角色表 + 迁移对照（字号 / 字重 -> token）落到选择器：每条都锁住字号、字重、行高（token 自带）。
// 依据列：R = 角色表「用于」列点名；M = 迁移对照（按字号 / 现有字重机械归档）；U = 明确选定。
const ROLE_MAP = {
  'type-clock': ['.clock-text'],
  'type-title-lg': ['.modal-title', '.dialog-title', '.dialog-plain-title', '.login-consent-title',
    '.sync-conflict-title', '.folder-name-input', '.move-to-main-hint'],
  'type-title-md': ['.sidebar-title', '.icon-crop-title'],
  'type-label-md': ['.btn-secondary', '.btn-danger', '.btn-primary', '.type-btn', '.sidebar-action-btn',
    '.sidebar-effect-label', '.clock-add-entry', '.engine-trigger', '.engine-item', '.add-engine-btn',
    '.form-label', '.ctx-item', '.signin-notice-title', '.auth-tab'],
  'type-label-sm': ['.sidebar-value', '.lang-toggle', '.sidebar-wallpaper-preview-label', '.engine-form-save',
    '.engine-form-cancel', '.icon-upload-btn', '.icon-clear-btn', '.sync-conflict-side-label', '.sync-delete-btn'],
  'type-label-xs': ['.tz-label', '.clock-entry-index', '.ctx-size-btn'],
  'type-body-lg': ['.search-input', '.sync-conflict-side-time'],
  'type-body-md': ['.sidebar-range-labels', '.date-text', '.clock-entry select', '.dialog-text', '.dialog-text-danger',
    '.form-input', '.login-desc', '.verify-desc', '.app-toast'],
  'type-body-sm': ['.login-consent-text', '.login-consent-bullets', '.sync-conflict-text',
    '.engine-form-input', '.sync-conflict-side-empty', '.sync-conflict-limit', '.sync-conflict-error',
    '.sync-conflict-signout', '.login-error', '.verify-status', '.forgot-password-btn'],
  'type-caption': ['.login-consent-footnote', '.sidebar-sync-hint', '.grid-item-name', '.clock-limit-msg',
    '.sync-conflict-side', '.icon-preview-placeholder', '.signin-notice-sub'],
};
// 角色表里找不到对应角色、保留 size / weight / leading 分开写的选择器，以及固定尺寸的首字母占位。
const UNMAPPED_WITH_SIZE = ['.sync-conflict-warn'];
const LETTER_SELECTORS = ['.icon-letter', '.icon-letter-sm', '.folder-slot-letter', '.folder-mini-letter'];

describe('排版角色表：每个有字号的选择器都归到一个 type token', () => {
  const entries = Object.entries(ROLE_MAP).flatMap(([token, sels]) => sels.map((sel) => [sel, token]));

  it('角色表里没有重复的选择器', () => {
    const names = entries.map(([sel]) => sel);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });

  it.each(entries)('%s 的 font 是 var(--%s)，字号 / 字重 / 行高由 token 决定，没有后置覆写', (sel, token) => {
    const d = declsOf(rules, sel);
    expect(lastOf(d, 'font'), sel).toBe(`var(--${token})`);
    const iFont = idxOf(d, 'font');
    const after = d.slice(iFont + 1).map((x) => x.prop).filter((p) => ['font-size', 'font-weight', 'line-height', 'font-family'].includes(p));
    expect(after, sel).toEqual([]);
    // 同一选择器在 @media 里的规则也不能再动字号 / 字重 / 行高
    const inMedia = rules.filter((r) => r.media !== null && r.selectors.some((x) => x.text === sel))
      .flatMap((r) => r.decls).filter((x) => ['font', 'font-size', 'font-weight', 'line-height'].includes(x.prop));
    expect(inMedia, sel).toEqual([]);
  });

  it('token 展开后的字号 / 字重 / 行高与角色表一致', () => {
    const vars = rootVars(rules);
    const expected = {
      'type-clock': '300 60px/1', 'type-title-lg': '600 20px/1.25', 'type-title-md': '600 16px/1.25',
      'type-body-lg': '400 16px/1.5', 'type-body-md': '400 14px/1.5', 'type-body-sm': '400 13px/1.5',
      'type-label-md': '500 14px/1', 'type-label-sm': '500 13px/1', 'type-label-xs': '500 12px/1',
      'type-caption': '400 12px/1.5',
    };
    for (const [token, want] of Object.entries(expected)) {
      const got = expandVars(vars.get(`--${token}`), vars).replace(/\s+(-apple-system|BlinkMacSystemFont).*$/, '');
      expect(got.split(/\s+/).slice(0, 2).join(' '), token).toBe(want);
    }
  });

  it('除首字母占位和 .sync-conflict-warn 外，没有规则单独写 font-size（都用 font 简写）', () => {
    const allowed = new Set([...LETTER_SELECTORS, ...UNMAPPED_WITH_SIZE]);   // 不含四个表单标签：它们只有 font: inherit
    const offenders = rules.filter((r) => r.decls.some((d) => d.prop === 'font-size')
      && !r.selectors.every((s) => allowed.has(s.text)))
      .map((r) => `${r.line} ${r.selectors.map((s) => s.text).join(', ')}`);
    expect(offenders).toEqual([]);
  });

  it('.sync-conflict-warn（多行 500 字重提示，角色表无对应角色）：13 / 500 / 1.5 用原始 token', () => {
    const d = declsOf(rules, '.sync-conflict-warn');
    expect(lastOf(d, 'font-size')).toBe('var(--font-size-sm)');
    expect(lastOf(d, 'font-weight')).toBe('var(--font-weight-medium)');
    expect(lastOf(d, 'line-height')).toBe('var(--font-leading-normal)');
  });

  it('仅改字重的规则（.verify-email-target、optgroup）用字重 token', () => {
    expect(lastOf(declsOf(rules, '.verify-email-target'), 'font-weight')).toBe('var(--font-weight-medium)');
    expect(lastOf(declsOf(rules, '.clock-entry select optgroup'), 'font-weight')).toBe('var(--font-weight-semibold)');
  });

  it('明确选定的字号：.grid-item-name 取 caption，.sync-conflict-side-time 取 body.lg（400）', () => {
    expect(lastOf(declsOf(rules, '.grid-item-name'), 'font')).toBe('var(--type-caption)');
    expect(lastOf(declsOf(rules, '.sync-conflict-side-time'), 'font')).toBe('var(--type-body-lg)');
    expect(lastOf(declsOf(rules, '.sync-conflict-side-time'), 'font-weight')).toBeUndefined();
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

describe('首字母占位', () => {
  it('.icon-letter 固定 30px、.icon-letter-sm 固定 10px，字重都是 semibold', () => {
    expect(lastOf(declsOf(rules, '.icon-letter'), 'font-size')).toBe('30px');
    expect(lastOf(declsOf(rules, '.icon-letter-sm'), 'font-size')).toBe('10px');
    for (const s of ['.icon-letter', '.icon-letter-sm', '.folder-mini-letter', '.folder-slot-letter', '.move-to-main-hint']) {
      const d = declsOf(rules, s);
      // type.title.lg 的字重是 semibold，用 font 简写的选择器按它算
      const font = lastOf(d, 'font');
      const w = lastOf(d, 'font-weight') ?? (font === 'var(--type-title-lg)' ? 'var(--font-weight-semibold)' : font);
      expect(w, s).toMatch(/semibold|600/);
    }
  });

  it('.folder-slot-letter / .folder-mini-letter 的字号来自 JS 写入的运行时变量，不是字面值', () => {
    expect(lastOf(declsOf(rules, '.folder-slot-letter'), 'font-size')).toBe('var(--rt-preview-letter-size)');
    expect(lastOf(declsOf(rules, '.folder-mini-letter'), 'font-size')).toBe('var(--rt-folder-mini-letter-size)');
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

describe('字号与 b733093 的差异恰好是明确确认的清单', () => {
  const oldMap = fontSizeMap(baseCss);
  const newMap = fontSizeMap(css);
  const keyOf = (sel) => `|${sel}`;
  // 运行时变量加了 --rt- 前缀，比对时还原成旧名，只看「是不是同一个变量驱动」。
  const unRt = (v) => (typeof v === 'string' ? v.replace('runtime:--rt-', 'runtime:--') : v);
  const dead = new Set(REMOVED_DEAD_CSS.map(keyOf));

  it('迁移中删掉的死 CSS：旧版有字号、现在整条没了，页面里也没有任何使用处', () => {
    for (const sel of REMOVED_DEAD_CSS) {
      expect(oldMap.has(keyOf(sel)), `${sel} @${BASE_COMMIT}`).toBe(true);
      expect(newMap.has(keyOf(sel)), `${sel} @HEAD`).toBe(false);
      const cls = sel.slice(1);
      for (const f of ['app.js', 'newtab.html']) {
        expect(readFileSync(resolve(REPO_ROOT, f), 'utf8'), `${f} 使用 ${sel}`).not.toContain(cls);
      }
    }
  });

  it('解析器能读到足够多的选择器（防止比对空转）', () => {
    expect(oldMap.size).toBeGreaterThan(60);
    expect(newMap.size).toBeGreaterThan(60);
  });

  it('b733093 里每个有字号的选择器，现在仍有字号声明', () => {
    const missing = [...oldMap.keys()].filter((k) => !newMap.has(k) && !dead.has(k));
    expect(missing).toEqual([]);
  });

  it('差异恰好是确认清单，数值逐条相符', () => {
    const diffs = {};
    for (const [k, oldPx] of oldMap) {
      if (dead.has(k)) continue;
      const newPx = unRt(newMap.get(k));
      const same = typeof oldPx === 'number' && typeof newPx === 'number'
        ? Math.abs(oldPx - newPx) < 1e-9 : oldPx === newPx;
      if (!same) diffs[k.replace(/^\|/, '')] = [oldPx, newPx];
    }
    expect(diffs).toEqual(CONFIRMED_CHANGES);
  });

  it('新出现的有字号的选择器只有首字母占位的两个类，加上 font: inherit 的四个标签', () => {
    const added = [...newMap.keys()].filter((k) => !oldMap.has(k)).map((k) => k.replace(/^\|/, ''));
    expect(added.sort()).toEqual([...NEW_SELECTORS, ...FORM_TAGS].sort());
    for (const tag of FORM_TAGS) expect(newMap.get(keyOf(tag)), tag).toBe('inherit');
  });

  it('旧版没有、现在也不能有「后置 inherit」：除四个标签外，没有选择器的最终字号是 inherit', () => {
    const inherits = [...newMap].filter(([k, v]) => v === 'inherit').map(([k]) => k.replace(/^\|/, ''));
    expect(inherits.sort()).toEqual([...FORM_TAGS].sort());
  });

  it('选择保持 13px 的选择器，字号与 b733093 相同（逐条）', () => {
    for (const sel of KEPT_AT_13) {
      expect(oldMap.get(keyOf(sel)), `${sel} @${BASE_COMMIT}`).toBe(13);
      expect(newMap.get(keyOf(sel)), `${sel} @HEAD`).toBe(oldMap.get(keyOf(sel)));
    }
  });

  it('运行时变量驱动的字号没有变', () => {
    for (const sel of ['.folder-slot-letter', '.folder-mini-letter']) {
      expect(unRt(newMap.get(keyOf(sel)))).toBe(oldMap.get(keyOf(sel)));
      expect(String(newMap.get(keyOf(sel)))).toMatch(/^runtime:--rt-/);
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
