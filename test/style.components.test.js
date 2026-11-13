// 组件对齐（阶段 B2，spec §3.3、§3.3.2、§6）：逐元素断言 style.css 里**最终生效**的颜色声明。
// 这里的断言都经 cssCascade.cascade 判定（选择器匹配 + 特异性 + 源码顺序），而不是 grep 某条规则：
// 后面的规则覆盖了前面的，测试看到的就是覆盖后的值。
//
// 统一工具（Task 30–32 往本文件追加 describe 时复用）：
//   mount(parentSel, html)  把 html 挂到由 parentSel 搭出来的祖先链下（'#folder-grid'、'.a .b' 都可），返回 html 的首个元素
//   win(el, family, opts)   最终生效的值；opts = { state, pseudoEl, side }，state 只能取 STATE_SETS 里的预设（默认 REST）
//   noBorder(el, state)     断言 border 判定为 { kind: 'none' } 或 null（交互元素不新增描边，spec §3.1）
//   noOld(className)        断言选择器里含该 class 的所有规则，声明值里不再出现旧颜色变量（清单取自 spec §9）
//                           只管颜色类旧变量；--surface-shadow / --sidebar-shadow 与 --blur-* 的改名归 Task 35，不在清单里
import { describe, it, expect, beforeEach } from 'vitest';
import { cascade, rulesMentioning, STATE_SETS } from './helpers/cssCascade.js';

const { REST, HOVER, PRESSED, FOCUS_KB } = STATE_SETS;

// ---------------------------------------------------------------------------
// 工具

const $ = (sel) => document.querySelector(sel);

// 复合选择器 -> 元素：支持 tag、#id、.class、[attr="v"]。够用即可，不是通用选择器解析器。
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

function mount(parentSel, html) {
  let parent = document.body;
  for (const part of parentSel.trim().split(/\s+/)) {
    const el = buildCompound(part);
    parent.appendChild(el);
    parent = el;
  }
  parent.insertAdjacentHTML('beforeend', html);
  return parent.lastElementChild;
}

const win = (el, family, opts = {}) => cascade(el, family, opts);

function noBorder(el, state = REST) {
  const b = cascade(el, 'border', { state });
  expect(b === null || b.kind === 'none', `border 应为 none 或无声明，实际 ${JSON.stringify(b)}`).toBe(true);
}

// spec §9 的旧颜色变量。surface-shadow / sidebar-shadow / blur 不在此列（Task 35）。
const OLD_COLOR_VAR = new RegExp(
  'var\\(\\s*--(?:'
  + 'glass-'
  + '|text-(?:primary|secondary|tertiary|quaternary|placeholder|accent|danger|warning)(?![\\w-])'
  + '|action-'
  + '|sidebar-(?:panel-bg|panel-border|panel-inset|chip-bg|button-bg|fg-muted|danger-)'
  + '|bg-input'
  + '|border-(?:white|black)-'
  + '|accent-'
  + '|fg-'
  + '|warning-(?:bg|border)'
  + '|focus-ring-blue'
  + '|surface-(?:bg|border-soft)'
  + ')',
  'i',
);

function noOld(className) {
  const rules = rulesMentioning(className);
  expect(rules.length, `没有规则提到 .${className}`).toBeGreaterThan(0);
  const hits = [];
  for (const r of rules) {
    for (const d of r.decls) {
      if (OLD_COLOR_VAR.test(d.value)) hits.push(`${r.selectors.map((s) => s.text).join(', ')} { ${d.prop}: ${d.value} }`);
    }
  }
  expect(hits, `.${className} 仍引用旧颜色变量`).toEqual([]);
}

beforeEach(() => { document.body.innerHTML = ''; });

// ---------------------------------------------------------------------------

describe('工具自检', () => {
  it('mount 搭出祖先链，descendant 与属性选择器可以匹配', () => {
    const el = mount('#folder-grid', '<div class="grid-item-card" data-item-type="link"></div>');
    expect(el.matches('#folder-grid .grid-item-card[data-item-type="link"]')).toBe(true);
    const deep = mount('.a .b', '<i class="c"></i>');
    expect(deep.matches('.a .b > .c')).toBe(true);
  });

  it('win 只接受 STATE_SETS 预设', () => {
    const el = mount('.grid-area', '<div class="grid-item-card"></div>');
    expect(() => win(el, 'background', { state: new Set(['hover']) })).toThrow(TypeError);
  });

  it('noOld 的旧变量清单：抓得到旧颜色变量，放过新 token 与 Task 35 才处理的阴影、模糊变量', () => {
    for (const v of ['var(--glass-l3)', 'var(--text-quaternary)', 'var(--action-primary-hover)', 'var(--bg-input-soft)',
      'var(--border-white-hairline)', 'var(--accent-blue-bg-soft)', 'var(--fg-strong)', 'var(--sidebar-button-bg)']) {
      expect(OLD_COLOR_VAR.test(v), v).toBe(true);
    }
    for (const v of ['var(--color-surface-glass-default)', 'var(--color-text-primary)', 'var(--surface-shadow)',
      'var(--sidebar-shadow)', 'var(--blur-base)', 'var(--color-action-primary-hover)']) {
      expect(OLD_COLOR_VAR.test(v), v).toBe(false);
    }
  });
});

describe('主区玻璃', () => {
  it('body：页面底与正文色', () => {
    expect(win(document.body, 'background')).toBe('var(--color-bg-page)');
    expect(win(document.body, 'color')).toBe('var(--color-text-primary)');
  });

  it('背景光斑与壁纸预览空态球', () => {
    expect(win(mount('body', '<div class="blob blob-blue"></div>'), 'background')).toBe('var(--color-decoration-blob-blue)');
    expect(win(mount('body', '<div class="blob blob-purple"></div>'), 'background')).toBe('var(--color-decoration-blob-purple)');
    const preview = mount('body', '<div class="sidebar-wallpaper-preview" data-empty="true"></div>');
    expect(win(preview, 'background', { pseudoEl: '::before' })).toBe('var(--color-decoration-preview-blue)');
    expect(win(preview, 'background', { pseudoEl: '::after' })).toBe('var(--color-decoration-preview-purple)');
    noOld('blob-blue'); noOld('blob-purple');
  });

  it('壁纸预览标签：空态无底，设了壁纸后用玻璃底（D5-12）', () => {
    const empty = mount('.sidebar-wallpaper-preview[data-empty="true"]', '<span class="sidebar-wallpaper-preview-label"></span>');
    expect(win(empty, 'background')).toBe('transparent');
    const set = mount('.sidebar-wallpaper-preview[data-empty="false"]', '<span class="sidebar-wallpaper-preview-label"></span>');
    expect(win(set, 'background')).toBe('var(--color-surface-glass-default)');
    expect(win(set, 'color')).toBe('var(--color-text-primary)');
    noOld('sidebar-wallpaper-preview-label');
  });

  it('.clocks-wrap 与时钟文字', () => {
    const wrap = mount('body', '<div class="clocks-wrap"></div>');
    expect(win(wrap, 'background')).toBe('var(--color-surface-glass-default)');
    for (const cls of ['clock-text', 'date-text', 'tz-label']) {
      expect(win(mount('.clocks-wrap .clock-container', `<div class="${cls}"></div>`), 'color'), cls).toBe('var(--color-text-primary)');
      noOld(cls);
    }
    noOld('clocks-wrap');
  });

  it('.search-bar：玻璃底 + input.border 描边，聚焦描边 focus.border（D5-21）', () => {
    const bar = mount('.search-form', '<div class="search-bar"></div>');
    expect(win(bar, 'background')).toBe('var(--color-surface-glass-default)');
    // 描边：:focus-within 不在 STATE_SETS 里，只要它的 base 匹配，border 族就判不了（CascadeUndecidable，
    // 该选择器已登记在 fixtures/b6-unverified.json，由 B6-U 在浏览器里确认）。不绕过，改为：
    //   1) 断言 cascade 确实抛了这条选择器；2) 直接断言两条规则各自的声明。
    let err;
    try { win(bar, 'border'); } catch (e) { err = e; }
    expect(err?.name).toBe('CascadeUndecidable');
    expect(err.selector).toBe('.search-bar:focus-within');
    const decls = (selector) => rulesMentioning('search-bar')
      .find((r) => r.selectors.some((s) => s.text === selector)).decls;
    expect(decls('.search-bar').find((d) => d.prop === 'border').value).toBe('1px solid var(--color-input-border)');
    expect(decls('.search-bar:focus-within').find((d) => d.prop === 'border-color').value).toBe('var(--color-focus-border)');
    noOld('search-bar');
  });

  it('.engine-trigger：透明底、悬停叠白（D5-10）、右侧分隔线 divider（D5-11）、左边无边框', () => {
    const t = mount('.search-bar', '<button class="engine-trigger"></button>');
    expect(win(t, 'background')).toBe('transparent');
    expect(win(t, 'background', { state: HOVER })).toBe('var(--color-surface-glass-hover)');
    expect(win(t, 'border', { side: 'right' })).toEqual({ kind: 'set', width: '1px', style: 'solid', color: 'var(--color-divider)' });
    expect(win(t, 'border', { side: 'left' })).toEqual({ kind: 'none' });
    expect(win(t, 'color')).toBe('var(--color-text-primary)');
    noOld('engine-trigger');
  });

  it('搜索输入：文字、占位（D5-25）、图标', () => {
    const input = mount('.search-input-wrap', '<input class="search-input">');
    expect(win(input, 'color')).toBe('var(--color-text-primary)');
    expect(win(input, 'color', { pseudoEl: '::placeholder' })).toBe('var(--color-text-placeholder)');
    expect(win(mount('.search-input-wrap', '<svg class="search-icon-svg"></svg>'), 'color')).toBe('var(--color-text-muted)');
    noOld('search-input'); noOld('search-icon-svg');
  });

  it('.grid-item-card：玻璃底，悬停替换为叠白；文件夹内的链接卡片透明，悬停叠白（D5-32）', () => {
    const card = mount('.grid-area', '<div class="grid-item-card"></div>');
    expect(win(card, 'background')).toBe('var(--color-surface-glass-default)');
    expect(win(card, 'background', { state: HOVER })).toBe('var(--color-surface-glass-hover)');
    noBorder(card, REST); noBorder(card, HOVER);
    const link = mount('#folder-grid', '<div class="grid-item-card" data-item-type="link"></div>');
    expect(win(link, 'background')).toBe('transparent');
    expect(win(link, 'background', { state: HOVER })).toBe('var(--color-surface-glass-hover)');
    noOld('grid-item-card');
  });

  it('卡片名', () => {
    expect(win(mount('.grid-item-wrap', '<div class="grid-item-name"></div>'), 'color')).toBe('var(--color-text-primary)');
    const big = mount('.grid-item-wrap[data-size="2x2"]', '<div class="grid-item-name"></div>');
    expect(win(big, 'color')).toBe('var(--color-text-primary)');
    noOld('grid-item-name');
  });

  it('.add-card：玻璃底，悬停叠白（D5-8）', () => {
    const add = mount('.grid-item-wrap', '<button class="add-card"></button>');
    expect(win(add, 'background')).toBe('var(--color-surface-glass-default)');
    expect(win(add, 'background', { state: HOVER })).toBe('var(--color-surface-glass-hover)');
    expect(win(add, 'color')).toBe('var(--color-text-primary)');
    noBorder(add, REST); noBorder(add, HOVER);
    noOld('add-card');
  });

  it('文件夹格（大卡片槽、迷你槽）：玻璃底（D5-8）；首字母占位 text.tertiary', () => {
    const slot = mount('.folder-slot-grid', '<div class="folder-slot-normal folder-slot-folder"></div>');
    expect(win(slot, 'background')).toBe('var(--color-surface-glass-default)');
    const mini = mount('.folder-slot-mini-group', '<div class="folder-mini-icon folder-mini-folder-slot"></div>');
    expect(win(mini, 'background')).toBe('var(--color-surface-glass-default)');
    expect(win(mount('.folder-slot-normal', '<span class="folder-slot-letter"></span>'), 'color')).toBe('var(--color-text-tertiary)');
    expect(win(mount('.folder-mini-icon', '<span class="folder-mini-letter"></span>'), 'color')).toBe('var(--color-text-tertiary)');
    for (const c of ['folder-slot-folder', 'folder-mini-folder-slot', 'folder-slot-letter', 'folder-mini-letter']) noOld(c);
  });

  it('.lang-toggle：玻璃底 + 轮廓；悬停叠白 + 强轮廓；文字 secondary（D5-9、D5-26）；焦点环（D5-22）', () => {
    const t = mount('body', '<button class="lang-toggle"></button>');
    expect(win(t, 'background')).toBe('var(--color-surface-glass-default)');
    expect(win(t, 'border')).toEqual({ kind: 'set', width: '1px', style: 'solid', color: 'var(--color-border-subtle)' });
    expect(win(t, 'color')).toBe('var(--color-text-secondary)');
    expect(win(t, 'background', { state: HOVER })).toBe('var(--color-surface-glass-hover)');
    expect(win(t, 'border', { state: HOVER }).color).toBe('var(--color-border-strong)');
    expect(win(t, 'color', { state: HOVER })).toBe('var(--color-text-primary)');
    expect(win(t, 'outline', { state: FOCUS_KB }).color).toBe('var(--color-focus-ring)');
    noOld('lang-toggle');
  });

  it('主网格滚动条：thumb / hover 用 scrollbar token（D5-20）', () => {
    const region = mount('.main-content', '<section class="grid-scroll-region"></section>');
    expect(win(region, 'scrollbar-color')).toBe('var(--color-scrollbar-thumb) transparent');
    const thumb = (state) => win(region, 'background', { state, pseudoEl: '::-webkit-scrollbar-thumb' });
    expect(thumb(REST)).toBe('var(--color-scrollbar-thumb)');
    expect(thumb(HOVER)).toBe('var(--color-scrollbar-hover)');
    expect(thumb(PRESSED)).toBe('var(--color-scrollbar-hover)');
    expect(win(region, 'background', { pseudoEl: '::-webkit-scrollbar-track' })).toBe('transparent');
    noOld('grid-scroll-region');
  });

  it('拖放：插入线、合并态外框与底、拖到主网格的目标底、提示文字', () => {
    expect(win(mount('.grid-item-wrap', '<div class="drag-indicator left"></div>'), 'background')).toBe('var(--color-drag-indicator)');
    const combine = mount('.grid-item-wrap', '<div class="grid-item-card grid-item-combine"></div>');
    expect(win(combine, 'outline').color).toBe('var(--color-drag-indicator)');
    expect(win(combine, 'background')).toBe('var(--color-drag-combine)');
    expect(win(mount('body', '<div class="overlay drag-over-folder-bg"></div>'), 'background')).toBe('var(--color-drag-target)');
    expect(win(mount('.overlay', '<div class="move-to-main-hint"></div>'), 'color')).toBe('var(--color-text-primary)');
    for (const c of ['drag-indicator', 'grid-item-combine', 'drag-over-folder-bg', 'move-to-main-hint']) noOld(c);
  });
});
