// 尺寸类 token 对齐（阶段 B4，Task 35；spec §5.1–§5.6、§8.4、§11.3 D5-29）：
// 间距、控件尺寸、布局尺寸、圆角、描边、阴影、模糊都改用 token。字号（Task 34）、z-index 与动效（Task 36）不在这里。
//
// 做法：
//   - 全表检查：扫 style.css 里 :root 之外的每条声明，值只能是 token（或明确登记的例外）。例外表里的每一项
//     都必须仍然命中，免得清单悄悄过期；每一项的理由写在注释里，规则 4 的视觉例外另列，留给 M14 目检。
//   - 元素检查：用 cssCascade 判定最终生效的值（选择器匹配 + 特异性 + 源码顺序）。
import { describe, it, expect } from 'vitest';
import { readStyleCss, parseCss, splitTopLevel } from './helpers/cssRules.js';
import { cascade, rulesMentioning } from './helpers/cssCascade.js';
import { dimViolations, DEFAULT_ALLOW } from './helpers/styleLint.js';

const css = readStyleCss();
const rules = parseCss(css);

const selectorKey = (rule) => rule.selectors.map((s) => s.text.replace(/\s+/g, ' ')).join(', ');
const ROOT_KEYS = new Set([':root', ':root, [data-theme="dark"]']);
// :root 两个定义块与 reduced-motion 里的 :root 不是使用处，不扫。
const usage = rules.filter((r) => !(ROOT_KEYS.has(selectorKey(r))));

const allDecls = [];
for (const r of usage) {
  for (const d of r.decls) allDecls.push({ sel: selectorKey(r), prop: d.prop, value: d.value.trim(), line: d.line, media: r.media });
}
const declsOf = (re) => allDecls.filter((d) => re.test(d.prop));

const $ = (sel) => document.querySelector(sel);
function buildCompound(sel) {
  const tag = /^[a-z][\w-]*/i.exec(sel)?.[0] ?? 'div';
  const el = document.createElement(tag);
  for (const m of sel.matchAll(/#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:=(?:"([^"]*)"|([^\]]*)))?\]/g)) {
    if (m[1]) el.id = m[1];
    else if (m[2]) el.classList.add(m[2]);
    else el.setAttribute(m[3], m[4] ?? m[5] ?? '');
  }
  return el;
}
// 挂载一个只有 class 的元素：mk('.btn-primary')、mk('.sidebar-action-btn.sync-delete-btn')
function mk(sel, parentSel = null) {
  document.body.innerHTML = '';
  let parent = document.body;
  if (parentSel) {
    for (const part of parentSel.trim().split(/\s+/)) {
      const p = buildCompound(part);
      parent.appendChild(p);
      parent = p;
    }
  }
  const el = buildCompound(sel);
  parent.appendChild(el);
  return el;
}
const win = (el, family, opts) => cascade(el, family, opts);

// ---------------------------------------------------------------------------
// 间距（§5.1）

const SPACING_PROP = /^(?:padding|margin)(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?$|^(?:row-|column-)?gap$/;
const SPACE_TOKEN = /^var\(--space-(?:1|2|3|4|5|6|8|10|12|16|20)\)$/;
const RUNTIME_SPACE = /^var\(--(?:rt-)?folder-mini-gap\)$/;   // JS 按卡片尺寸算出来的运行时变量（§5.3 末段同理）

// 例外：值里不是 space token 的那一段，必须登记。key = `选择器 | 属性`，value = 允许出现的原样值。
// 百分比（padding: 14%、padding-bottom: 100%）是相对自身尺寸的比例，不是间距，不用登记。
const SPACING_EXCEPTIONS = {
  // 滑块拇指在轨道上垂直居中的负 margin = (轨道高 - 拇指高) / 2，由两个尺寸 token 推出，不是间距档位（-8px）。
  '.sidebar-range::-webkit-slider-thumb | margin-top': 'calc((var(--size-range-track) - var(--size-range-thumb)) / 2)',
  // 规则 4 的视觉例外：目前没有（套规则 3 后无对齐被打破的元素；见 task-35-report.md）。
};

function spacingBad(d) {
  const key = `${d.sel} | ${d.prop}`;
  const tokens = splitTopLevel(d.value, ' ');
  const bad = tokens.filter((t) => !(
    t === '0' || t === 'auto' || /^-?\d+(?:\.\d+)?%$/.test(t) || SPACE_TOKEN.test(t) || RUNTIME_SPACE.test(t)
  ));
  if (bad.length === 0) return null;
  if (SPACING_EXCEPTIONS[key] === d.value) return null;
  return `${key}: ${d.value}`;
}

describe('间距：gap / padding / margin 只用 var(--space-*)', () => {
  it('没有字面的 px / rem / em 间距（0、auto、百分比与运行时变量除外），例外表之外一条不剩', () => {
    const bad = declsOf(SPACING_PROP).map(spacingBad).filter(Boolean);
    expect(bad).toEqual([]);
  });

  it('例外表里的每一项都仍然命中（清单不过期）', () => {
    for (const [key, value] of Object.entries(SPACING_EXCEPTIONS)) {
      const hit = declsOf(SPACING_PROP).some((d) => `${d.sel} | ${d.prop}` === key && d.value === value);
      expect(hit, key).toBe(true);
    }
  });

  it('网格间距 --grid-gap 改为 var(--space-4)', () => {
    const gaps = allDecls.filter((d) => d.prop === 'gap' && /grid-gap|space-4/.test(d.value) && /grid-area|modal-body/.test(d.sel));
    expect(gaps.length).toBeGreaterThan(0);
    for (const g of gaps) expect(g.value, g.sel).toBe('var(--space-4)');
  });

  it('档外值按规则 3 归档：2、3 → 4；6 → 8；10 → 12；14 → 16；.clock-container + .clock-container 的 margin-left 48 → space-12', () => {
    expect(rulesMentioning('clock-container').some((r) => r.decls.some((d) => d.prop === 'margin-left' && d.value === 'var(--space-12)'))).toBe(true);
    expect(win(mk('.sync-conflict-side'), 'gap')).toBe('var(--space-2)');           // 6 -> 8
    expect(win(mk('.sync-conflict-side'), 'padding')).toBe('var(--space-4)');       // 14 -> 16
    expect(win(mk('.signin-notice-text'), 'gap')).toBe('var(--space-1)');           // 2 -> 4
  });
});

// ---------------------------------------------------------------------------
// 控件高度（§5.1 规则 1、§5.2）

describe('控件尺寸：高度用 size.control.*，垂直 padding 置 0', () => {
  it('.btn-primary / .btn-secondary / .btn-danger 高度 md，垂直 padding 0', () => {
    for (const c of ['btn-primary', 'btn-secondary', 'btn-danger']) {
      const el = mk(`.${c}`);
      expect(win(el, 'height'), c).toBe('var(--size-control-md)');
      expect(win(el, 'padding'), c).toBe('0 var(--space-4)');
    }
  });

  it('.form-input 高度 md（输入框，规则 1），垂直 padding 0', () => {
    const el = mk('.form-input');
    expect(win(el, 'height')).toBe('var(--size-control-md)');
    expect(win(el, 'padding')).toBe('0 var(--space-4)');
  });

  it('.lang-toggle 高度 sm；.sidebar-value 高度 xs，垂直 padding 0', () => {
    expect(win(mk('.lang-toggle'), 'height')).toBe('var(--size-control-sm)');
    expect(win(mk('.lang-toggle'), 'padding')).toBe('0 var(--space-3)');
    const v = mk('.sidebar-value');
    expect(win(v, 'height')).toBe('var(--size-control-xs)');
    expect(win(v, 'padding')).toBe('0 var(--space-2)');
  });

  it('.sidebar-action-btn 高度 md；.sync-delete-btn 不再覆盖 height / padding / border-radius，与基类一致', () => {
    const base = mk('.sidebar-action-btn');
    expect(win(base, 'height')).toBe('var(--size-control-md)');
    expect(win(base, 'padding')).toBe('0 var(--space-3)');
    const del = mk('.sidebar-action-btn.sidebar-action-btn-danger.sync-delete-btn');
    expect(win(del, 'height')).toBe('var(--size-control-md)');
    expect(win(del, 'padding')).toBe('0 var(--space-3)');
    expect(win(del, 'border-radius')).toBe('var(--radius-sm)');
    for (const r of rulesMentioning('sync-delete-btn')) {
      for (const d of r.decls) expect(['height', 'padding', 'border-radius']).not.toContain(d.prop);
    }
  });

  it('.ctx-size-btn 高度 xs（右键菜单尺寸按钮，§5.2）', () => {
    const el = mk('.ctx-size-btn');
    expect(win(el, 'height')).toBe('var(--size-control-xs)');
  });

  it('.search-bar 显式高度 lg（56），内部 .search-input 垂直 padding 为 0 并居中，放得下', () => {
    expect(win(mk('.search-bar'), 'height')).toBe('var(--size-control-lg)');
    const input = mk('.search-input');
    expect(win(input, 'padding')).toBe('0 var(--space-4) 0 var(--space-10)');
    expect(win(mk('.search-input-wrap'), 'align-items')).toBe('center');
    // 垂直 padding 为 0 后，输入框必须拉满整个搜索栏的内容高度，点搜索栏任何位置都能聚焦
    expect(win(input, 'align-self')).toBe('stretch');
  });
});

// ---------------------------------------------------------------------------
// 布局尺寸（§8.4）

describe('布局尺寸：命中 §8.4 的值改用 --size-*', () => {
  it('侧栏宽度、把手宽度、预览宽度', () => {
    expect(win(mk('.left-sidebar'), 'width')).toBe('var(--size-sidebar-width)');
    expect(win(mk('.left-sidebar-handle'), 'width')).toBe('var(--size-sidebar-peek)');
    expect(win(mk('.sidebar-wallpaper-preview'), 'width')).toBe('var(--size-sidebar-preview)');
    expect(win(mk('.sidebar-wallpaper-preview'), 'flex')).toBe('0 0 var(--size-sidebar-preview)');
  });

  it('对话框、登录卡、菜单、搜索栏、文件夹弹窗的宽高', () => {
    expect(win(mk('.dialog-card'), 'max-width')).toBe('var(--size-dialog-md)');
    expect(win(mk('.dialog-card.dialog-card-wide'), 'max-width')).toBe('var(--size-dialog-lg)');
    expect(win(mk('.login-card'), 'max-width')).toBe('var(--size-dialog-login)');
    expect(win(mk('.context-menu'), 'min-width')).toBe('var(--size-menu-min)');
    expect(win(mk('.search-container'), 'max-width')).toBe('var(--size-search-max)');
    expect(win(mk('.folder-modal'), 'max-width')).toBe('var(--size-folder-max)');
    expect(win(mk('.folder-modal'), 'min-height')).toBe('var(--size-folder-minheight)');
    expect(win(mk('.app-toast'), 'min-width')).toBe('min(var(--size-toast-min), calc(100vw - var(--space-8)))');
  });

  it('滑块拇指与轨道、图标尺寸', () => {
    const track = rulesMentioning('sidebar-range').filter((r) => r.selectors.some((s) => /slider-runnable-track|moz-range-track/.test(s.text)));
    expect(track.length).toBe(2);
    for (const r of track) expect(r.decls.find((d) => d.prop === 'height').value).toBe('var(--size-range-track)');
    const thumb = rulesMentioning('sidebar-range').filter((r) => r.selectors.some((s) => /slider-thumb|moz-range-thumb/.test(s.text)) && r.decls.some((d) => d.prop === 'width'));
    expect(thumb.length).toBe(2);
    for (const r of thumb) {
      expect(r.decls.find((d) => d.prop === 'width').value).toBe('var(--size-range-thumb)');
      expect(r.decls.find((d) => d.prop === 'height').value).toBe('var(--size-range-thumb)');
    }
    expect(win(mk('svg', '.ctx-item'), 'width')).toBe('var(--size-icon-sm)');
  });

  it('网格列数与旧布局变量：不再引用 --grid-gap、--sidebar-*、--folder-grid-columns', () => {
    const OLD_LAYOUT = /var\(\s*--(?:grid-gap|sidebar-width|sidebar-min-width|sidebar-preview-width|sidebar-actions-min-width|sidebar-peek|folder-grid-columns)(?![\w-])/;
    const hits = allDecls.filter((d) => OLD_LAYOUT.test(d.value)).map((d) => `${d.sel} { ${d.prop}: ${d.value} }`);
    expect(hits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 圆角（§5.3）

const RADIUS_PROP = /^border(?:-(?:top|bottom)-(?:left|right)|-(?:start|end)-(?:start|end))?-radius$/;
const RADIUS_OK = /^(?:0|var\(--radius-(?:xs|sm|md|lg|xl|full)\)|var\(--(?:rt-)?folder-mini-radius\)|inherit)$/;

describe('圆角：只用 var(--radius-*)', () => {
  it('lint 的 raw-radius 为 0', () => {
    expect(dimViolations(css, { allow: DEFAULT_ALLOW }).filter((v) => v.rule === 'raw-radius')).toEqual([]);
  });

  it('border-radius 的每一段都是 0 或 radius token（文件夹迷你格用运行时变量）', () => {
    const bad = declsOf(RADIUS_PROP).filter((d) => !splitTopLevel(d.value, ' ').every((t) => RADIUS_OK.test(t)));
    expect(bad.map((d) => `${d.sel}: ${d.value}`)).toEqual([]);
  });

  it('按档归并：按钮 / 输入框 sm，卡片 lg，chip 与搜索栏 full，侧栏右侧圆角 xl，右键菜单 md，弹窗 xl / lg', () => {
    const r = (sel, parent) => win(mk(sel, parent), 'border-radius');
    expect(r('.btn-primary')).toBe('var(--radius-sm)');
    expect(r('.form-input')).toBe('var(--radius-sm)');
    expect(r('.engine-item')).toBe('var(--radius-sm)');          // 10 -> sm
    expect(r('.sync-conflict-warn')).toBe('var(--radius-sm)');   // 10 -> sm
    expect(r('.clock-remove-btn')).toBe('var(--radius-sm)');     // 6 -> sm（§5.3 并入表）
    expect(r('.grid-item-card')).toBe('var(--radius-lg)');
    expect(r('.add-card')).toBe('var(--radius-lg)');
    // toast：取 §5.3 radius.md 行「用于：右键菜单、下拉、toast」（12）；「并入」列把 0.9rem 并入 lg 的写法与之矛盾，不取
    expect(r('.app-toast')).toBe('var(--radius-md)');
    expect(r('.signin-notice')).toBe('var(--radius-lg)');        // 14 -> lg
    expect(r('.sidebar-value')).toBe('var(--radius-full)');
    expect(r('.search-bar')).toBe('var(--radius-full)');
    expect(r('.lang-toggle')).toBe('var(--radius-full)');
    expect(r('.context-menu')).toBe('var(--radius-md)');
    expect(r('.dialog-card')).toBe('var(--radius-lg)');
    expect(r('.folder-modal')).toBe('var(--radius-xl)');
    expect(r('.left-sidebar')).toBe('0 var(--radius-xl) var(--radius-xl) 0');
    expect(r('.blob')).toBe('var(--radius-full)');                // 50% -> full
    expect(r('.engine-dropdown')).toBe('var(--radius-md)');      // §5.3 radius.md「下拉」；内边距 4 + 菜单项 sm 8 = 12
  });
});

// ---------------------------------------------------------------------------
// 描边（§5.4）

const BORDER_WIDTH_OK = /^(?:0|var\(--border-width-(?:thin|thick)\))$/;
// 例外：只有这一处不是 1px / 2px 描边。
//   滚动条拇指的 3px 透明边：靠 background-clip 做出内缩的拇指，是布局手法，不是描边（§5.4 的两档不适用）。
const BORDER_WIDTH_EXCEPTIONS = {
  '.grid-scroll-region::-webkit-scrollbar-thumb | border': '3px solid transparent',
};

describe('描边：border / outline 的宽度只用 --border-width-thin / thick', () => {
  const props = declsOf(/^(?:border|border-(?:top|right|bottom|left)|outline)$/);

  it('简写里的宽度都是 token 或 0，例外表之外一条不剩', () => {
    const bad = [];
    for (const d of props) {
      if (/^(?:none|0|inherit|transparent)$/.test(d.value)) continue;
      if (BORDER_WIDTH_EXCEPTIONS[`${d.sel} | ${d.prop}`] === d.value) continue;
      const first = splitTopLevel(d.value, ' ')[0];
      if (!BORDER_WIDTH_OK.test(first)) bad.push(`${d.sel} | ${d.prop}: ${d.value}`);
    }
    expect(bad).toEqual([]);
  });

  it('例外表里的每一项仍然命中', () => {
    for (const [key, value] of Object.entries(BORDER_WIDTH_EXCEPTIONS)) {
      expect(props.some((d) => `${d.sel} | ${d.prop}` === key && d.value === value), key).toBe(true);
    }
  });

  it('输入框、搜索栏、面板轮廓 thin；焦点环与拖放组合态外框 thick；裁剪框 1.5px 改为 thin', () => {
    const b = (sel, side) => win(mk(sel), 'border', side ? { side } : {});
    expect(b('.form-input').width).toBe('var(--border-width-thin)');
    // .search-bar 有 :focus-within 规则，cascade 判定不了，直接读基础规则
    const own = (sel, prop) => rules.find((r) => selectorKey(r) === sel && r.decls.some((d) => d.prop === prop)).decls.find((d) => d.prop === prop).value;
    expect(own('.search-bar', 'border')).toBe('var(--border-width-thin) solid var(--color-input-border)');
    expect(b('.sidebar-panel').width).toBe('var(--border-width-thin)');
    expect(b('.icon-crop-box').width).toBe('var(--border-width-thin)');
    expect(b('.left-sidebar', 'right').width).toBe('var(--border-width-thin)');
    expect(win(mk('.grid-item-combine'), 'outline').width).toBe('var(--border-width-thick)');
    const rule = rules.find((r) => selectorKey(r).startsWith('.btn-primary:focus-visible'));
    expect(rule.decls.find((d) => d.prop === 'outline').value).toBe('var(--border-width-thick) solid var(--color-focus-ring)');
  });
});

// ---------------------------------------------------------------------------
// 阴影（§5.5）

const SHADOW_TOKENS = ['thumb', 'card', 'panel', 'popover', 'modal', 'drag', 'text', 'highlight'];

describe('阴影：层级阴影只用 8 个 --shadow-* token', () => {
  const shadows = declsOf(/^(?:box|text)-shadow$/);

  it('不再有字面的 rgba / 十六进制阴影，也不再引用旧阴影变量', () => {
    const bad = shadows.filter((d) => /rgba?\(|#[0-9a-f]{3,8}\b|--surface-shadow|--sidebar-shadow|--range-thumb-shadow/i.test(d.value));
    expect(bad.map((d) => `${d.sel}: ${d.value}`)).toEqual([]);
  });

  it('引用到的 --shadow-* 都在 8 个之内，且都在主题块里定义过', () => {
    const used = new Set(shadows.flatMap((d) => [...d.value.matchAll(/var\(--shadow-([a-z]+)\)/g)].map((m) => m[1])));
    for (const u of used) expect(SHADOW_TOKENS, u).toContain(u);
    const theme = rules.find((r) => selectorKey(r) === ':root, [data-theme="dark"]');
    for (const t of SHADOW_TOKENS) expect(theme.decls.some((d) => d.prop === `--shadow-${t}`), t).toBe(true);
  });

  it('状态型阴影不算层级阴影，只允许这几种形状（焦点光晕、滑块光圈、裁剪遮罩、警告内描边、把手条纹、none）', () => {
    const ok = [
      /^none$/,
      /^var\(--shadow-(?:thumb|card|panel|popover|modal|drag|text|highlight)\)$/,
      /^0 0 0 3px var\(--color-focus-glow\)$/,                                    // 输入框聚焦光晕，spec §5.5 明写的字面值
      /^0 0 0 4px var\(--color-control-panel-hover\), var\(--shadow-thumb\)$/,
      /^0 0 0 9999px var\(--color-crop-mask\)$/,
      /^inset 0 0 0 1px var\(--color-warning-border\)$/,
      /^-6px 0 0 var\(--color-handle\),\s*-12px 0 0 var\(--color-handle\)$/,
    ];
    const bad = shadows.filter((d) => !ok.some((re) => re.test(d.value.replace(/\s+/g, ' ').replace(/,\s*/g, ', '))
      || re.test(d.value)));
    expect(bad.map((d) => `${d.sel}: ${d.value}`)).toEqual([]);
  });

  it('逐元素对应 §5.5：侧栏 / 搜索栏 panel；卡片 / 加号卡 / 文件夹格 card；菜单类、文件夹弹窗 popover；对话框 modal', () => {
    const s = (sel, parent) => win(mk(sel, parent), 'box-shadow');
    expect(s('.left-sidebar')).toBe('var(--shadow-panel)');
    expect(s('.search-bar')).toBe('var(--shadow-panel)');
    expect(s('.grid-item-card')).toBe('var(--shadow-card)');
    expect(s('.add-card')).toBe('var(--shadow-card)');
    expect(s('.folder-slot-folder')).toBe('var(--shadow-card)');
    expect(s('.folder-mini-folder-slot')).toBe('var(--shadow-card)');
    expect(s('.engine-dropdown')).toBe('var(--shadow-popover)');
    expect(s('.context-menu')).toBe('var(--shadow-popover)');
    expect(s('.app-toast')).toBe('var(--shadow-popover)');
    expect(s('.signin-notice')).toBe('var(--shadow-popover)');
    expect(s('.folder-modal')).toBe('var(--shadow-popover)');
    expect(s('.dialog-card')).toBe('var(--shadow-modal)');
    expect(s('.icon-crop-handle')).toBe('var(--shadow-thumb)');
    expect(s('.sidebar-panel')).toBe('var(--shadow-highlight)');
  });

  it('拖放指示线的蓝色发光用 --shadow-drag；压在图上的文字阴影用 --shadow-text（含 .move-to-main-hint）', () => {
    expect(win(mk('.drag-indicator'), 'box-shadow')).toBe('var(--shadow-drag)');
    expect(win(mk('.move-to-main-hint'), 'text-shadow')).toBe('var(--shadow-text)');
    const rule = rules.find((r) => selectorKey(r).includes('.grid-item-name') && r.decls.some((d) => d.prop === 'text-shadow'));
    expect(rule.decls.find((d) => d.prop === 'text-shadow').value).toBe('var(--shadow-text)');
  });

  it('滑块拇指用 --shadow-thumb；悬停光圈叠在它上面；局部变量 --range-thumb-shadow 已删除', () => {
    const thumbRules = rulesMentioning('sidebar-range').filter((r) => r.selectors.some((s) => /thumb/.test(s.text)));
    const values = thumbRules.flatMap((r) => r.decls.filter((d) => d.prop === 'box-shadow').map((d) => d.value.replace(/\s+/g, ' ')));
    expect(values).toContain('var(--shadow-thumb)');
    expect(values).toContain('0 0 0 4px var(--color-control-panel-hover), var(--shadow-thumb)');
    expect(values.length).toBe(4);   // 两个厂商前缀 × （常态 + 悬停 / 按下）
    expect(css).not.toMatch(/--range-thumb-shadow/);
    expect(rulesMentioning('sidebar-range').some((r) => r.decls.some((d) => d.prop === '--range-thumb-shadow'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 模糊（§5.6，D5-29）

describe('模糊：backdrop-filter 与 filter 的 blur 用 --blur-* token', () => {
  const blurs = declsOf(/^(?:-webkit-)?backdrop-filter$|^filter$/);
  // 例外：侧栏壁纸预览里的装饰光斑 blur(28px)，不在 §5.6 的 6 档里（decoration 是 120），预览缩略图专用，保持写死。
  const BLUR_EXCEPTIONS = {
    '.sidebar-wallpaper-preview::before, .sidebar-wallpaper-preview::after | filter': 'blur(28px)',
  };

  it('blur() 里只有 var(--blur-*)，例外表之外一条不剩', () => {
    const bad = blurs.filter((d) => d.value !== 'none'
      && BLUR_EXCEPTIONS[`${d.sel} | ${d.prop}`] !== d.value
      && !/^blur\(var\(--blur-(?:scrim|sidebar|glass|menu|backdrop|decoration)\)\)$/.test(d.value));
    expect(bad.map((d) => `${d.sel} | ${d.prop}: ${d.value}`)).toEqual([]);
  });

  it('例外表仍然命中', () => {
    for (const [key, value] of Object.entries(BLUR_EXCEPTIONS)) {
      expect(blurs.some((d) => `${d.sel} | ${d.prop}` === key && d.value === value), key).toBe(true);
    }
  });

  it('侧栏 sidebar；登录提示 menu（D5-29：8 -> 16）；右键菜单、引擎下拉、toast menu；搜索栏、卡片 glass；文件夹遮罩 backdrop；背景光斑 decoration', () => {
    const f = (sel, prop = 'backdrop-filter') => win(mk(sel), prop);
    expect(f('.left-sidebar')).toBe('blur(var(--blur-sidebar))');
    expect(f('.signin-notice')).toBe('blur(var(--blur-menu))');
    expect(f('.context-menu')).toBe('blur(var(--blur-menu))');
    expect(f('.engine-dropdown')).toBe('blur(var(--blur-menu))');
    expect(f('.app-toast')).toBe('blur(var(--blur-menu))');
    expect(f('.search-bar')).toBe('blur(var(--blur-glass))');
    expect(f('.grid-item-card')).toBe('blur(var(--blur-glass))');
    expect(f('.lang-toggle')).toBe('blur(var(--blur-glass))');
    expect(f('.clocks-wrap')).toBe('blur(var(--blur-glass))');
    expect(f('#folder-overlay')).toBe('blur(var(--blur-backdrop))');
    expect(f('.overlay')).toBe('blur(var(--blur-scrim))');
    expect(f('.blob-blue', 'filter')).toBe('blur(var(--blur-decoration))');
    expect(f('.blob-purple', 'filter')).toBe('blur(var(--blur-decoration))');
  });

  it('不再引用旧模糊变量 --blur-light / soft / base / heavy / xl', () => {
    const hits = allDecls.filter((d) => /var\(\s*--blur-(?:light|soft|base|heavy|xl)(?![\w-])/.test(d.value));
    expect(hits.map((d) => `${d.sel}: ${d.value}`)).toEqual([]);
  });
});
