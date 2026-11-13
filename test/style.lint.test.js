// 样式 lint 与棘轮（Task 27）。
// lintStyle / lintJsColors 的规则用内联夹具验证；棘轮读真实的 style.css，只允许违规数下降，不允许上升。
// 每个后续 Task 完成时把 BASELINE_* 下调到新的实测值（B6 归零）。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStyleCss, parseCss } from './helpers/cssRules.js';
import { undefinedVarRefs, setPropertyVars } from './helpers/cssVars.js';
import {
  lintStyle, lintJsColors, colorViolations, dimViolations, DEFAULT_ALLOW,
} from './helpers/styleLint.js';
import { loadTokens, tokenToCssVar } from './helpers/designTokens.js';

const rulesOf = (css, opts) => lintStyle(css, opts).map((v) => v.rule);

// 2026-11-13 @ 6e0b1d5 实测（按声明计数，一条声明对一条规则只记一次）：
//   颜色类：hex 23 + rgb 27 + primitive-ref 0 = 50
//   尺寸类：transition-all 8 + raw-font-size 65 + raw-radius 60 + raw-z 16（已扣除 DEFAULT_ALLOW）= 149
// 2026-11-13 Task 29（主区玻璃）：颜色类 50 -> 29（-21）。
// 2026-11-13 Task 30（侧栏）：颜色类 29 -> 18（-11）。
// 2026-11-13 Task 31（弹窗与表单）：颜色类 18 -> 14（-4，裁剪框 4 处）。
// 2026-11-13 Task 32（浮层）：颜色类 14 -> 13（-1，toast 的 color: #fff）。
// 2026-11-13 Task 33（交互状态）：颜色类 13 -> 12（-1，滑块拇指两处同一条投影合为 --range-thumb-shadow 一处）。
// 2026-11-13 Task 35（间距、尺寸、圆角、阴影、模糊）：颜色类 12 -> 0（-12，box-shadow / text-shadow 里的 rgba 换成 --shadow-*）；
//   尺寸类 149 -> 89（-60，raw-radius 全部改为 var(--radius-*)）。
// 2026-11-13 Task 36（z-index 与动效）：尺寸类 89 -> 65（-24，transition-all 8 + raw-z 16 归零），只剩 raw-font-size 65（留给 Task 34）。
// 2026-11-13 Task 34（排版）：尺寸类 65 -> 0（-65，raw-font-size 全部改为 type / font-size token；白名单仅 G-3 的 30px、10px 与 z-index 小整数）。
const BASELINE_COLOR = 0;
const BASELINE_DIM = 0;

describe('lintStyle', () => {
  it('在 :root 外命中 #fff、rgba(、var(--color-blue-600)、transition: all', () => {
    const css = `
      .a { color: #fff; }
      .b { background: rgba(0, 0, 0, 0.5); }
      .c { color: var(--color-blue-600); }
      .d { transition: all 0.2s; }`;
    expect(rulesOf(css)).toEqual(['hex', 'rgb', 'primitive-ref', 'transition-all']);
  });

  it('Violation 带 rule、line、selector、prop、value', () => {
    const [v] = lintStyle('\n.a {\n  color: #FFF;\n}');
    expect(v).toMatchObject({ rule: 'hex', line: 3, selector: '.a', prop: 'color', value: '#FFF' });
  });

  it('豁免 :root、:root, [data-theme="dark"]，以及 prefers-reduced-motion 里的 :root', () => {
    const css = `
      :root { --a: #fff; --b: rgba(0,0,0,.5); --c: var(--color-white); }
      :root, [data-theme="dark"] { --d: var(--color-alpha-white-10); color-scheme: dark; }
      @media (prefers-reduced-motion: reduce) { :root { --e: rgba(0,0,0,0); } }`;
    expect(lintStyle(css)).toEqual([]);
  });

  it('其他 @media 里的 :root 与 [data-theme] 单独块不豁免；选择器列表里混有别的选择器也不豁免', () => {
    expect(rulesOf('@media (max-width: 1px) { :root { --e: #fff } }')).toEqual(['hex']);
    expect(rulesOf(':root, .x { --e: #fff }')).toEqual(['hex']);
  });

  it('hex：不把 #id、url(#frag)、引号字符串里的内容当颜色；3/4/6/8 位都命中', () => {
    expect(rulesOf('.a { background: url(#frag); content: "#fff"; }')).toEqual([]);
    expect(rulesOf('.a { color: #abc; border-color: #abcd; outline-color: #aabbcc; fill: #aabbccdd }'))
      .toEqual(['hex', 'hex', 'hex', 'hex']);
  });

  it('primitive-ref：slate/blue/red/amber/white/alpha 原始色变量命中，语义变量不命中', () => {
    const css = `.a { color: var(--color-slate-300); background: var(--color-alpha-white-10);
      border-color: var(--color-amber-500); outline-color: var(--color-text-primary); }`;
    expect(rulesOf(css)).toEqual(['primitive-ref', 'primitive-ref', 'primitive-ref']);
  });

  it('primitive-ref 的原始色家族与 tokens.json core 里的颜色 token 一致', () => {
    const prim = loadTokens().filter((t) => t.set === 'core' && t.name.startsWith('color.'));
    expect(prim.length).toBeGreaterThan(0);
    for (const t of prim) {
      const css = `.a { color: var(${tokenToCssVar(t.name)}); }`;
      expect(rulesOf(css), t.name).toEqual(['primitive-ref']);
    }
  });

  it('transition-all：transition、transition-property 里的 all 命中；all 出现在列表中间也命中；具体属性不命中', () => {
    expect(rulesOf('.a { transition: all 0.2s; }')).toEqual(['transition-all']);
    expect(rulesOf('.a { transition: opacity 0.2s, all 0.3s ease; }')).toEqual(['transition-all']);
    expect(rulesOf('.a { transition-property: all; }')).toEqual(['transition-all']);
    expect(rulesOf('.a { transition: background 0.2s, color 0.2s; }')).toEqual([]);
    expect(rulesOf('.a { transition: var(--motion-fast); }')).toEqual([]);
  });

  it('raw-font-size：font-size 字面值与 font 简写字面值命中；var()、继承关键字、font: var(...) 不命中', () => {
    expect(rulesOf('.a { font-size: 14px; } .b { font-size: 0.875rem; } .c { font: 600 14px/20px system-ui; }'))
      .toEqual(['raw-font-size', 'raw-font-size', 'raw-font-size']);
    expect(rulesOf('.a { font-size: var(--font-size-md); } .b { font: inherit; } .c { font: var(--type-label-md); } .d { font-size: inherit; }'))
      .toEqual([]);
  });

  it('raw-radius：border-radius 及各角长写里的字面值命中；var()、0、继承关键字不命中；混写的 0 不单独计', () => {
    expect(rulesOf('.a { border-radius: 8px; } .b { border-top-left-radius: 50%; } .c { border-radius: 0 1rem 1rem 0; }'))
      .toEqual(['raw-radius', 'raw-radius', 'raw-radius']);
    expect(rulesOf('.a { border-radius: var(--radius-md); } .b { border-radius: 0; } .c { border-radius: var(--rt-folder-mini-radius); } .d { border-radius: inherit; } .e { border-radius: 0 var(--radius-md) var(--radius-md) 0; }'))
      .toEqual([]);
  });

  it('raw-z：z-index 字面值命中；var()、auto 不命中', () => {
    expect(rulesOf('.a { z-index: 40; } .b { z-index: -2; }')).toEqual(['raw-z', 'raw-z']);
    expect(rulesOf('.a { z-index: var(--z-menu); } .b { z-index: auto; }')).toEqual([]);
  });

  it('allow 白名单：只对 raw-font-size 与 raw-z 生效，且按完整值精确匹配', () => {
    const allow = ['30px', '10px', '1', '2', '-1'];
    expect(rulesOf('.a { font-size: 30px; } .b { font-size: 10px; } .c { font-size: 11px; }', { allow }))
      .toEqual(['raw-font-size']);
    expect(rulesOf('.a { z-index: 1; } .b { z-index: 2; } .c { z-index: -1; } .d { z-index: 10; } .e { z-index: 12; }', { allow }))
      .toEqual(['raw-z', 'raw-z']);
    // 白名单里的 10px 不能顺带放过 border-radius: 10px
    expect(rulesOf('.a { border-radius: 10px; }', { allow })).toEqual(['raw-radius']);
    // 不传 allow 时没有豁免
    expect(rulesOf('.a { font-size: 30px; z-index: 1; }')).toEqual(['raw-font-size', 'raw-z']);
  });

  it('@keyframes 内部也扫描（cascade 才跳过）；@font-face、@property 等声明型 at-rule 同理', () => {
    const css = `
      @keyframes k { from { background: #fff; } to { color: rgba(0,0,0,1); transition: all 1s; } }
      @property --x { syntax: '<color>'; initial-value: #abcdef; }
      .a { color: red; }`;
    const vs = lintStyle(css);
    expect(vs.map((v) => [v.rule, v.selector])).toEqual([
      ['hex', 'from'], ['rgb', 'to'], ['transition-all', 'to'], ['hex', '@property --x'],
    ]);
  });

  it('!important 不影响判定；注释里的内容不计', () => {
    expect(rulesOf('.a { z-index: 5 !important; } /* .b { color: #fff } */')).toEqual(['raw-z']);
  });

  it('colorViolations 只含 hex / rgb / primitive-ref；dimViolations 含其余四类', () => {
    const css = '.a { color: #fff; border-radius: 4px; transition: all 1s; background: var(--color-red-500); z-index: 3; font-size: 12px; background-image: rgb(0 0 0); }';
    expect(colorViolations(css).map((v) => v.rule)).toEqual(['hex', 'primitive-ref', 'rgb']);
    expect(dimViolations(css, { allow: [] }).map((v) => v.rule))
      .toEqual(['raw-radius', 'transition-all', 'raw-z', 'raw-font-size']);
  });
});

describe('lintJsColors', () => {
  it('字符串字面量与模板字符串里的 #hex 和 rgba?( 命中，带行号', () => {
    const js = [
      "const a = '#fff';",
      'const b = "rgba(0,0,0,0.5)";',
      'const c = `x ${y} rgb(1,2,3) #abcdef`;',
    ].join('\n');
    const vs = lintJsColors(js);
    expect(vs.map((v) => [v.rule, v.line])).toEqual([['hex', 1], ['rgb', 2], ['rgb', 3], ['hex', 3]]);
  });

  it('注释、正则字面量、字符串之外的内容不计；#id 选择器不当作颜色', () => {
    const js = [
      "// const a = '#fff';",
      "/* const b = 'rgba(0,0,0,1)'; */",
      "const re = /'#fff'/; const s = 'ok';",
      "document.querySelector('#add-card'); const url = 'a#section';",
      "const x = a / b; const y = '#12';",
    ].join('\n');
    expect(lintJsColors(js)).toEqual([]);
  });
});

// 棘轮用 ===：违规减少了也必须下调基线，否则余量会抵消后来新增的违规。
function expectRatchet(label, actual, baseline, constName) {
  const hint = actual < baseline
    ? `${label}违规减少了（${baseline} -> ${actual}），请把 ${constName} 下调到 ${actual}`
    : `${label}新增了违规（${baseline} -> ${actual}），请修掉新增的写法，不要上调 ${constName}`;
  expect(actual, hint).toBe(baseline);
}

describe('棘轮：style.css', () => {
  const css = readStyleCss();
  it('颜色类违规数（hex + rgb + primitive-ref）等于基线', () => {
    expectRatchet('颜色类', colorViolations(css, { allow: DEFAULT_ALLOW }).length, BASELINE_COLOR, 'BASELINE_COLOR');
  });
  it('尺寸类违规数（transition-all + raw-font-size + raw-radius + raw-z）等于基线', () => {
    expectRatchet('尺寸类', dimViolations(css, { allow: DEFAULT_ALLOW }).length, BASELINE_DIM, 'BASELINE_DIM');
  });
  it('lintStyle 在 style.css 上不抛错，且每条违规都带行号', () => {
    // 带白名单时 style.css 已无违规（B6 归零）；不带白名单时 30px / 10px / z-index 小整数仍会命中，用来证明扫描没有空转。
    expect(lintStyle(css, { allow: DEFAULT_ALLOW })).toEqual([]);
    const vs = lintStyle(css);
    expect(vs.length).toBeGreaterThan(0);
    expect(vs.every((v) => Number.isInteger(v.line) && v.line > 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Task 37（B5，spec §9）：旧变量清零、变量全部有定义、JS 不写颜色、运行时变量统一 --rt- 前缀。

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readRepo = (f) => readFileSync(resolve(REPO_ROOT, f), 'utf8');
const JS_FILES = ['app.js', 'firebase.js', 'weather.js', 'iconCache.js'];
const SCAN_FILES = [...JS_FILES, 'newtab.html'];

// spec §9 的旧变量（改名或删除的全部旧名）；JS 运行时变量的旧名（加 --rt- 前缀之前）也在内。
// --clock-time-width、--main-grid-track-size、--main-grid-min-width 是 style.css 内部用的布局辅助变量，
// §9 没有要求改名或删除，不在清单里。
const OLD_VARS = [
  '--glass-l0', '--glass-l1', '--glass-l2', '--glass-l3', '--glass-l3-hover', '--glass-l4', '--glass-l4-strong',
  '--blur-light', '--blur-soft', '--blur-base', '--blur-heavy', '--blur-xl',
  '--border-white-faint', '--border-white-hairline', '--border-white-soft',
  '--border-black-soft', '--border-black-medium', '--border-black-strong',
  '--accent-blue-bg-soft', '--accent-blue-bg-hover', '--accent-blue-bg-active', '--accent-blue-border',
  '--accent-red-bg-soft', '--accent-red-bg-hover', '--accent-red-border-soft', '--accent-red-border',
  '--accent-amber-300', '--accent-amber-500', '--warning-bg', '--warning-border', '--text-warning',
  '--fg-muted', '--fg-soft', '--fg-strong',
  '--surface-bg', '--surface-bg-hover', '--surface-blur', '--surface-shadow', '--surface-border-soft',
  '--sidebar-blur', '--sidebar-shadow', '--sidebar-panel-bg', '--sidebar-panel-border', '--sidebar-panel-inset',
  '--sidebar-chip-bg', '--sidebar-button-bg', '--sidebar-button-bg-hover', '--sidebar-fg-muted',
  '--sidebar-danger-fg', '--sidebar-danger-border',
  '--grid-gap', '--folder-grid-columns',
  '--sidebar-width', '--sidebar-min-width', '--sidebar-preview-width', '--sidebar-actions-min-width', '--sidebar-peek',
  '--text-primary', '--text-secondary', '--text-tertiary', '--text-quaternary', '--text-placeholder',
  '--text-accent', '--text-danger',
  '--action-primary', '--action-primary-hover', '--action-danger', '--action-danger-hover',
  '--action-secondary', '--action-secondary-hover',
  '--bg-input', '--bg-input-border', '--bg-input-faint', '--bg-input-soft', '--focus-ring-blue',
  // JS 运行时变量的旧名
  '--main-grid-max-width', '--main-content-max-width', '--base-card-size', '--card-w', '--card-h',
  '--preview-icon-size', '--preview-letter-size', '--folder-mini-gap', '--folder-mini-radius',
  '--folder-mini-letter-size',
];

// JS 写入的运行时变量：10 个（spec §9）加 G-1 的壁纸压暗不透明度。
const RT_VARS = [
  '--rt-main-grid-max-width', '--rt-main-content-max-width', '--rt-base-card-size', '--rt-card-w', '--rt-card-h',
  '--rt-preview-icon-size', '--rt-preview-letter-size', '--rt-folder-mini-gap', '--rt-folder-mini-radius',
  '--rt-folder-mini-letter-size', '--rt-wallpaper-dim-opacity',
];

describe('cssVars：变量定义与引用扫描', () => {
  it('CSS 里引用了未定义的变量会被报出；有 :root 声明、组件内声明的都算已定义；注释里的不计', () => {
    const css = ':root { --a: 1px; } .x { --b: 2px; width: var(--a); height: var(--b); margin: var(--gone, 0); } /* var(--only-in-comment) */';
    expect(undefinedVarRefs({ 'style.css': css })).toEqual([{ file: 'style.css', name: '--gone' }]);
  });

  it('JS 字符串里的 var(--x) 要在 CSS 里有声明，或由 setProperty 写入；两处都没有就报出', () => {
    const css = ':root { --defined: 1px; }';
    const js = [
      "el.style.cssText = 'width:var(--defined)';",
      "el.style.setProperty('--rt-ok', '1px'); el.style.cssText = `top:var(--rt-ok)`;",
      "el.innerHTML = '<div style=\"width:var(--removed)\">';",
    ].join('\n');
    expect(undefinedVarRefs({ 'style.css': css, 'app.js': js })).toEqual([{ file: 'app.js', name: '--removed' }]);
  });

  it('setPropertyVars 只认字面量变量名', () => {
    expect([...setPropertyVars("a.setProperty('--rt-a','1'); b.setProperty(`--rt-b`, x); c.setProperty('display','')")].sort())
      .toEqual(['--rt-a', '--rt-b']);
  });
});

describe('B5 清理：style.css 与 JS', () => {
  const style = readStyleCss();
  const sources = Object.fromEntries([['style.css', style], ...SCAN_FILES.map((f) => [f, readRepo(f)])]);

  it('style.css 颜色类违规为 0', () => {
    expect(colorViolations(style, { allow: DEFAULT_ALLOW })).toEqual([]);
  });

  it('所有 var(--x) 都有定义（扫描 style.css 与 app.js 等 JS、newtab.html 里的字符串）', () => {
    expect(undefinedVarRefs(sources)).toEqual([]);
  });

  it('不再存在旧变量名（style.css、JS、newtab.html 里都没有）', () => {
    const hits = [];
    for (const [file, text] of Object.entries(sources)) {
      for (const v of OLD_VARS) {
        // 边界：前面不能是字母、数字、连字符（--color-text-primary 不算含 --text-primary），后面不能接变量名字符。
        const re = new RegExp(`(?<![\\w-])${v}(?![\\w-])`);
        if (re.test(text)) hits.push(`${file}: ${v}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('app.js、firebase.js、weather.js、iconCache.js 没有颜色字面量', () => {
    for (const f of JS_FILES) {
      expect(lintJsColors(readRepo(f)), f).toEqual([]);
    }
  });

  it('JS 写入的 CSS 变量全部带 --rt- 前缀，且恰好是约定的 11 个', () => {
    const written = new Set();
    for (const f of JS_FILES) for (const n of setPropertyVars(readRepo(f))) written.add(n);
    expect([...written].sort()).toEqual([...RT_VARS].sort());
  });

  it('运行时变量的默认值与使用处都改成 --rt-：主网格 / 内容宽度的默认值来自 size token（G-2）', () => {
    const rules = parseCss(style);
    const decls = (sel) => rules.filter((r) => r.media === null && r.selectors.some((s) => s.text === sel)).flatMap((r) => r.decls);
    const last = (sel, prop) => decls(sel).filter((d) => d.prop === prop).at(-1)?.value;
    expect(style).toContain('max-width: var(--rt-main-grid-max-width, var(--size-grid-max));');
    expect(style).toContain('max-width: max(56rem, var(--rt-main-content-max-width, var(--size-content-max)));');
    expect(last('.grid-item-wrap', '--rt-base-card-size')).toBe('min(100%, var(--size-card-base))');
    expect(last('.grid-item-wrap', '--rt-preview-letter-size')).toBe('30px');
  });

  it('壁纸压暗（G-1 方案 a）：#wallpaper-dim 用 --color-wallpaper-dim 做底，opacity 由 --rt-wallpaper-dim-opacity 控制，默认 0', () => {
    const decl = parseCss(style).filter((r) => r.media === null && r.selectors.some((s) => s.text === '#wallpaper-dim'))
      .flatMap((r) => r.decls);
    const last = (prop) => decl.filter((d) => d.prop === prop).at(-1)?.value;
    expect(last('background')).toBe('var(--color-wallpaper-dim)');
    expect(last('opacity')).toBe('var(--rt-wallpaper-dim-opacity, 0)');
  });

  it('文件夹图标描边走 currentColor：4 个选择器各自设 color: var(--color-text-secondary)；app.js 里没有 stroke="#..."', () => {
    const rules = parseCss(style);
    for (const sel of ['.folder-slot-folder-icon', '.folder-mini-folder-icon', '.grid-folder-icon', '.folder-title-icon svg']) {
      const d = rules.filter((r) => r.media === null && r.selectors.some((s) => s.text === sel)).flatMap((r) => r.decls);
      expect(d.filter((x) => x.prop === 'color').at(-1)?.value, sel).toBe('var(--color-text-secondary)');
    }
    expect(readRepo('app.js')).not.toMatch(/stroke="#/);
  });

  it('首字母占位（G-3）：颜色在 .icon-letter / .icon-letter-sm 上；ICON_FALLBACK_STYLE 只剩 display 与 pointer-events', () => {
    const rules = parseCss(style);
    for (const sel of ['.icon-letter', '.icon-letter-sm']) {
      const d = rules.filter((r) => r.media === null && r.selectors.some((s) => s.text === sel)).flatMap((r) => r.decls);
      expect(d.filter((x) => x.prop === 'color').at(-1)?.value, sel).toBe('var(--color-text-tertiary)');
    }
    const app = readRepo('app.js');
    expect(app).toContain("const ICON_FALLBACK_STYLE = 'display:none;pointer-events:none';");
    expect(app).toContain("const ICON_FALLBACK_STYLE_SM = 'display:none;pointer-events:none';");
    expect(app).not.toMatch(/class="icon-letter(?:-sm)?" style="[^"]*(?:color|font-size):/);
  });

  it('死 CSS：.sidebar-note 没有任何使用处，已从 style.css 删除', () => {
    expect(style).not.toMatch(/\.sidebar-note(?![\w-])/);
    for (const f of ['app.js', 'newtab.html']) expect(readRepo(f), f).not.toMatch(/sidebar-note(?![\w-])/);
  });
});
