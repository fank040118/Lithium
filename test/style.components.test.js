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

const { REST, HOVER, PRESSED, FOCUS_KB, FOCUS_KB_HOVER, PRESSED_FOCUS } = STATE_SETS;

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

// ---------------------------------------------------------------------------

describe('侧栏', () => {
  it('.left-sidebar：面板底 surface.panel，右边线 border.subtle，其余三边无边框', () => {
    const bar = mount('body', '<aside class="left-sidebar"></aside>');
    expect(win(bar, 'background')).toBe('var(--color-surface-panel)');
    expect(win(bar, 'border', { side: 'right' })).toEqual({ kind: 'set', width: '1px', style: 'solid', color: 'var(--color-border-subtle)' });
    expect(win(bar, 'border', { side: 'left' })).toEqual({ kind: 'none' });
    noOld('left-sidebar');
  });

  it('把手：三条纹统一 handle（D5-30），键盘焦点内缩环 focus.ring（D5-22）', () => {
    const handle = mount('.left-sidebar', '<button class="left-sidebar-handle"></button>');
    expect(win(handle, 'background')).toBe('transparent');
    expect(win(handle, 'background', { pseudoEl: '::before' })).toBe('var(--color-handle)');
    const stripes = win(handle, 'box-shadow', { pseudoEl: '::before' });
    expect(stripes.match(/var\(--color-handle\)/g)).toHaveLength(2);
    expect(stripes).not.toMatch(/rgba?\(/);
    expect(win(handle, 'outline', { state: FOCUS_KB })).toEqual({
      color: 'var(--color-focus-ring)', width: '2px', style: 'solid', offset: '-2px',
    });
    noOld('left-sidebar-handle');
  });

  it('.sidebar-panel：分组卡片底 surface.group（白 6%），边框 border.subtle，顶部内高光 shadow.highlight', () => {
    const panel = mount('.sidebar-stack', '<section class="sidebar-section sidebar-panel"></section>');
    expect(win(panel, 'background')).toBe('var(--color-surface-group)');
    expect(win(panel, 'border')).toEqual({ kind: 'set', width: '1px', style: 'solid', color: 'var(--color-border-subtle)' });
    expect(win(panel, 'box-shadow')).toBe('var(--shadow-highlight)');
    noOld('sidebar-panel');
  });

  it('标题、chip（.sidebar-value）、说明、滑块标签、效果标签的文字与底', () => {
    expect(win(mount('.sidebar-head', '<h2 class="sidebar-title"></h2>'), 'color')).toBe('var(--color-text-primary)');
    const chip = mount('.sidebar-head', '<span class="sidebar-value"></span>');
    expect(win(chip, 'background')).toBe('var(--color-chip-bg)');
    expect(win(chip, 'color')).toBe('var(--color-text-primary)');
    noBorder(chip, REST); noBorder(chip, HOVER);
    expect(win(mount('.sidebar-panel', '<p class="sidebar-note"></p>'), 'color')).toBe('var(--color-text-tertiary)'); // D5-27
    expect(win(mount('.sidebar-panel', '<div class="sidebar-range-labels"></div>'), 'color')).toBe('var(--color-text-muted)');
    expect(win(mount('.sidebar-head', '<span class="sidebar-effect-label"></span>'), 'color')).toBe('var(--color-text-muted)');
    for (const c of ['sidebar-title', 'sidebar-value', 'sidebar-note', 'sidebar-range-labels', 'sidebar-effect-label']) noOld(c);
  });

  it('滑块：轨道 range.track，拇指 range.thumb（webkit 与 moz 各一套）', () => {
    const range = mount('.sidebar-panel', '<input class="sidebar-range" type="range">');
    for (const pe of ['::-webkit-slider-runnable-track', '::-moz-range-track']) {
      expect(win(range, 'background', { pseudoEl: pe }), pe).toBe('var(--color-range-track)');
    }
    for (const pe of ['::-webkit-slider-thumb', '::-moz-range-thumb']) {
      expect(win(range, 'background', { pseudoEl: pe }), pe).toBe('var(--color-range-thumb)');
    }
    noOld('sidebar-range');
  });

  it('壁纸预览：底 bg.page（与页面底同色），轮廓 border.subtle', () => {
    const preview = mount('.sidebar-wallpaper-layout', '<div class="sidebar-wallpaper-preview"></div>');
    expect(win(preview, 'background')).toBe('var(--color-bg-page)');
    expect(win(preview, 'border')).toEqual({ kind: 'set', width: '1px', style: 'solid', color: 'var(--color-border-subtle)' });
    noOld('sidebar-wallpaper-preview');
  });

  it('.sidebar-action-btn：secondary × default × panel，无描边（spec §6.2）', () => {
    const btn = mount('.sidebar-panel', '<button class="sidebar-action-btn"></button>');
    expect(win(btn, 'background')).toBe('var(--color-control-panel-default)');
    expect(win(btn, 'background', { state: HOVER })).toBe('var(--color-control-panel-hover)');
    expect(win(btn, 'color')).toBe('var(--color-text-primary)');
    expect(win(btn, 'color', { state: HOVER })).toBe('var(--color-text-primary)');
    noBorder(btn, REST); noBorder(btn, HOVER);
    noOld('sidebar-action-btn');
  });

  it('.sidebar-action-btn-danger：只改文字为 text.dangeronfill（Q2 / D5-5），底与悬停同普通按钮', () => {
    const btn = mount('.sidebar-panel', '<button class="sidebar-action-btn sidebar-action-btn-danger"></button>');
    expect(win(btn, 'color')).toBe('var(--color-text-dangeronfill)');
    expect(win(btn, 'color', { state: HOVER })).toBe('var(--color-text-dangeronfill)');
    expect(win(btn, 'background')).toBe('var(--color-control-panel-default)');
    expect(win(btn, 'background', { state: HOVER })).toBe('var(--color-control-panel-hover)');
    noBorder(btn, REST); noBorder(btn, HOVER);
    noOld('sidebar-action-btn-danger');
  });

  it('.sync-delete-btn 并入 secondary × danger × panel：无描边、常态不半透明、悬停白 22%（D5-2、D5-33）', () => {
    const btn = mount('#sync-logged-section', '<button class="sidebar-action-btn sidebar-action-btn-danger sync-delete-btn"></button>');
    noBorder(btn, REST); noBorder(btn, HOVER);
    expect(win(btn, 'opacity')).toBeNull();
    expect(win(btn, 'opacity', { state: HOVER })).toBeNull();
    expect(win(btn, 'background')).toBe('var(--color-control-panel-default)');
    expect(win(btn, 'background', { state: HOVER })).toBe('var(--color-control-panel-hover)');
    expect(win(btn, 'color')).toBe('var(--color-text-dangeronfill)');
    expect(win(btn, 'color', { state: HOVER })).toBe('var(--color-text-dangeronfill)');
    noOld('sync-delete-btn');
  });

  it('同步状态胶囊：默认沿用 chip.bg，冲突态 warning.bg + warning.border 内描边 + text.warning', () => {
    const pill = mount('.sidebar-head', '<span class="sidebar-value sidebar-sync-status"></span>');
    expect(win(pill, 'background')).toBe('var(--color-chip-bg)');
    expect(win(pill, 'color')).toBe('var(--color-text-primary)');
    const conflict = mount('.sidebar-head', '<span class="sidebar-value sidebar-sync-status is-conflict"></span>');
    expect(win(conflict, 'background')).toBe('var(--color-warning-bg)');
    expect(win(conflict, 'box-shadow')).toBe('inset 0 0 0 1px var(--color-warning-border)');
    expect(win(conflict, 'color')).toBe('var(--color-text-warning)');
    noBorder(conflict, REST);
    noOld('sidebar-sync-status');
  });

  it('同步提示 .sidebar-sync-hint：text.muted（D5-24，--text-quaternary 的去向）', () => {
    expect(win(mount('.sidebar-panel', '<p class="sidebar-sync-hint"></p>'), 'color')).toBe('var(--color-text-muted)');
    noOld('sidebar-sync-hint');
  });
});

describe('弹窗与表单', () => {
  // 合并后的选择器列表：取「选择器文本含 selectorText 且声明了 prop」的规则（同一选择器可能有布局规则与颜色规则两条）。
  const selectorsOf = (className, selectorText, prop) => {
    const r = rulesMentioning(className)
      .find((x) => x.selectors.some((s) => s.text === selectorText) && x.decls.some((d) => d.prop === prop));
    expect(r, `找不到声明了 ${prop} 的规则 ${selectorText}`).toBeTruthy();
    return r.selectors.map((s) => s.text);
  };

  it('遮罩 .overlay：scrim；#folder-overlay 保持无底（只靠模糊）', () => {
    const overlay = mount('body', '<div class="overlay"></div>');
    expect(win(overlay, 'background')).toBe('var(--color-scrim)');
    const folder = mount('body', '<div id="folder-overlay" class="overlay"></div>');
    expect(win(folder, 'background')).toBe('transparent');
    noOld('overlay');
  });

  it('.dialog-card：surface.dialog，没有描边（定稿「弹窗边框 无」），各变体也没有', () => {
    const card = mount('.overlay', '<div class="dialog-card"></div>');
    expect(win(card, 'background')).toBe('var(--color-surface-dialog)');
    noBorder(card, REST);
    for (const extra of ['dialog-card-wide', 'login-consent-card', 'sync-conflict-card', 'icon-crop-card', 'delete-account-card']) {
      const v = mount('.overlay', `<div class="dialog-card ${extra}"></div>`);
      expect(win(v, 'background'), extra).toBe('var(--color-surface-dialog)');
      noBorder(v, REST);
    }
    noOld('dialog-card');
  });

  it('.folder-modal：surface.panel + border.strong；头部分隔线 border.subtle；标题图标底 surface.sunken', () => {
    const modal = mount('#folder-overlay', '<div id="folder-modal" class="folder-modal"></div>');
    expect(win(modal, 'background')).toBe('var(--color-surface-panel)');
    expect(win(modal, 'border')).toEqual({ kind: 'set', width: '1px', style: 'solid', color: 'var(--color-border-strong)' });
    const header = mount('#folder-modal', '<div class="modal-header"></div>');
    expect(win(header, 'border', { side: 'bottom' })).toEqual({ kind: 'set', width: '1px', style: 'solid', color: 'var(--color-border-subtle)' });
    expect(win(mount('.modal-title', '<span class="folder-title-icon"></span>'), 'background')).toBe('var(--color-surface-sunken)');
    noOld('folder-modal'); noOld('folder-title-icon'); noOld('modal-title');
  });

  it('按钮 primary × default：.btn-primary 与 .engine-form-save 共用一套规则（P-2、D5-36），悬停 blue.700（Q1）', () => {
    expect(selectorsOf('btn-primary', '.btn-primary', 'background')).toEqual(expect.arrayContaining(['.engine-form-save']));
    for (const cls of ['btn-primary', 'engine-form-save']) {
      const b = mount('.dialog-actions', `<button class="${cls}"></button>`);
      expect(win(b, 'background'), cls).toBe('var(--color-action-primary-default)');
      expect(win(b, 'background', { state: HOVER }), cls).toBe('var(--color-action-primary-hover)');
      expect(win(b, 'color'), cls).toBe('var(--color-text-onaccent)');
      expect(win(b, 'color', { state: HOVER }), cls).toBe('var(--color-text-onaccent)');
      noBorder(b, REST); noBorder(b, HOVER);
    }
    noOld('btn-primary'); noOld('engine-form-save');
  });

  it('按钮 primary × danger：.btn-danger 悬停 red.700（Q1），禁用态悬停不变深', () => {
    const b = mount('.dialog-actions', '<button class="btn-danger"></button>');
    expect(win(b, 'background')).toBe('var(--color-action-danger-default)');
    expect(win(b, 'background', { state: HOVER })).toBe('var(--color-action-danger-hover)');
    expect(win(b, 'color')).toBe('var(--color-text-onaccent)');
    noBorder(b, REST);
    const off = mount('.dialog-actions', '<button class="btn-danger" disabled></button>');
    expect(win(off, 'background', { state: HOVER })).toBe('var(--color-action-danger-default)');
    noOld('btn-danger');
  });

  it('按钮 secondary × default：.btn-secondary 与 .icon-upload-btn、.engine-form-cancel 共用一套规则（D5-18）', () => {
    expect(selectorsOf('btn-secondary', '.btn-secondary', 'background')).toEqual(expect.arrayContaining(['.icon-upload-btn', '.engine-form-cancel']));
    for (const cls of ['btn-secondary', 'icon-upload-btn', 'engine-form-cancel']) {
      const b = mount('.dialog-actions', `<button class="${cls}"></button>`);
      expect(win(b, 'color'), cls).toBe('var(--color-text-tertiary)');
      expect(win(b, 'color', { state: HOVER }), cls).toBe('var(--color-text-tertiary)');
      expect(win(b, 'background'), cls).toBe('var(--color-control-bg-default)');
      expect(win(b, 'background', { state: HOVER }), cls).toBe('var(--color-control-bg-hover)');
      noBorder(b, REST); noBorder(b, HOVER);
    }
    noOld('btn-secondary'); noOld('icon-upload-btn'); noOld('engine-form-cancel');
  });

  it('按钮 ghost × default：.close-btn、.add-engine-btn 普通态透明 + text.muted；悬停 control.bg.hover + text.primary（D5-17、D5-18）', () => {
    for (const cls of ['close-btn', 'add-engine-btn']) {
      const b = mount('.modal-header', `<button class="${cls}"></button>`);
      expect(win(b, 'background'), cls).toBe('transparent');
      expect(win(b, 'color'), cls).toBe('var(--color-text-muted)');
      expect(win(b, 'background', { state: HOVER }), cls).toBe('var(--color-control-bg-hover)');
      expect(win(b, 'color', { state: HOVER }), cls).toBe('var(--color-text-primary)');
      noBorder(b, REST); noBorder(b, HOVER);
      noOld(cls);
    }
    // .folder-rename-btn 的「不那么亮」靠 opacity 表达（不是颜色，不动）：字色保持 text.primary，悬停叠白
    const rename = mount('#folder-title', '<button class="folder-rename-btn"></button>');
    expect(win(rename, 'color')).toBe('var(--color-text-primary)');
    expect(win(rename, 'background', { state: HOVER })).toBe('var(--color-control-bg-hover)');
    expect(win(rename, 'color', { state: HOVER })).toBe('var(--color-text-primary)');
    noBorder(rename, REST); noBorder(rename, HOVER);
    noOld('folder-rename-btn');
  });

  it('按钮 ghost × danger：三个按钮共用一套规则，普通态透明 + text.muted，悬停 danger.bg + text.danger（D5-34、D5-38、D5-23）', () => {
    expect(selectorsOf('clock-remove-btn', '.clock-remove-btn', 'background')).toEqual(expect.arrayContaining(['.engine-delete-btn', '.icon-clear-btn']));
    for (const [parent, cls] of [['.clock-entry', 'clock-remove-btn'], ['.engine-item', 'engine-delete-btn'], ['.icon-upload-row', 'icon-clear-btn']]) {
      const b = mount(parent, `<button class="${cls}"></button>`);
      expect(win(b, 'background'), cls).toBe('transparent');
      expect(win(b, 'color'), cls).toBe('var(--color-text-muted)');
      expect(win(b, 'background', { state: HOVER }), cls).toBe('var(--color-danger-bg)');
      expect(win(b, 'color', { state: HOVER }), cls).toBe('var(--color-text-danger)');
      noBorder(b, REST); noBorder(b, HOVER);
      noOld(cls);
    }
  });

  it('.icon-red：text.danger（D5-23，#ef4444 -> #f87171）', () => {
    expect(win(mount('.dialog-title', '<svg class="icon-red"></svg>'), 'color')).toBe('var(--color-text-danger)');
    noOld('icon-red');
  });

  it('条目行叠白（D5-1）：.clock-entry、.sync-conflict-side 用 surface.group + border.subtle', () => {
    const entry = mount('.clock-list', '<div class="clock-entry"></div>');
    expect(win(entry, 'background')).toBe('var(--color-surface-group)');
    expect(win(entry, 'border')).toEqual({ kind: 'set', width: '1px', style: 'solid', color: 'var(--color-border-subtle)' });
    expect(win(mount('.clock-entry', '<span class="clock-entry-index"></span>'), 'color')).toBe('var(--color-text-muted)');
    const side = mount('.sync-conflict-compare', '<div class="sync-conflict-side"></div>');
    expect(win(side, 'background')).toBe('var(--color-surface-group)');
    expect(win(side, 'border')).toEqual({ kind: 'set', width: '1px', style: 'solid', color: 'var(--color-border-subtle)' });
    expect(win(side, 'color')).toBe('var(--color-text-muted)');
    noOld('clock-entry'); noOld('clock-entry-index'); noOld('sync-conflict-side');
  });

  it('.clock-add-entry：secondary 底、虚线框 border.subtle / 悬停 border.strong（D5-18）', () => {
    const b = mount('.clock-list', '<button class="clock-add-entry"></button>');
    expect(win(b, 'background')).toBe('var(--color-control-bg-default)');
    expect(win(b, 'background', { state: HOVER })).toBe('var(--color-control-bg-hover)');
    expect(win(b, 'border')).toEqual({ kind: 'set', width: '1px', style: 'dashed', color: 'var(--color-border-subtle)' });
    expect(win(b, 'border', { state: HOVER })).toEqual({ kind: 'set', width: '1px', style: 'dashed', color: 'var(--color-border-strong)' });
    expect(win(b, 'color')).toBe('var(--color-text-muted)');
    expect(win(b, 'color', { state: HOVER })).toBe('var(--color-text-secondary)');
    noOld('clock-add-entry'); noOld('clock-limit-msg');
  });

  it('冲突弹窗警告条：warning.bg + warning.border + text.warning；标题图标 icon.warning；说明字', () => {
    const warn = mount('.sync-conflict-card', '<p class="sync-conflict-warn"></p>');
    expect(win(warn, 'background')).toBe('var(--color-warning-bg)');
    expect(win(warn, 'border')).toEqual({ kind: 'set', width: '1px', style: 'solid', color: 'var(--color-warning-border)' });
    expect(win(warn, 'color')).toBe('var(--color-text-warning)');
    expect(win(mount('.sync-conflict-title', '<svg></svg>'), 'color')).toBe('var(--color-icon-warning)');
    expect(win(mount('.sync-conflict-card', '<p class="sync-conflict-limit"></p>'), 'color')).toBe('var(--color-text-warning)');
    expect(win(mount('.sync-conflict-card', '<p class="sync-conflict-error"></p>'), 'color')).toBe('var(--color-text-danger)');
    expect(win(mount('.sync-conflict-card', '<div class="sync-conflict-signout"></div>'), 'color')).toBe('var(--color-text-muted)');
    for (const c of ['sync-conflict-warn', 'sync-conflict-title', 'sync-conflict-limit', 'sync-conflict-error', 'sync-conflict-signout',
      'sync-conflict-text', 'sync-conflict-side-label', 'sync-conflict-side-time', 'sync-conflict-side-empty']) noOld(c);
  });

  it('分段切换：槽 surface.sunken（含 .auth-tabs，D5-15），选中段 selection.solid + onaccent，未选中 muted、悬停 primary', () => {
    expect(selectorsOf('type-toggle', '.type-toggle', 'background')).toEqual(expect.arrayContaining(['.auth-tabs']));
    expect(win(mount('.edit-form', '<div class="type-toggle"></div>'), 'background')).toBe('var(--color-surface-sunken)');
    expect(win(mount('.login-card', '<div class="auth-tabs"></div>'), 'background')).toBe('var(--color-surface-sunken)');
    for (const [parent, cls, active] of [['.type-toggle', 'type-btn', 'type-btn-active'], ['.auth-tabs', 'auth-tab', 'auth-tab active']]) {
      const off = mount(parent, `<button class="${cls}"></button>`);
      expect(win(off, 'background'), cls).toBe('transparent');
      expect(win(off, 'color'), cls).toBe('var(--color-text-muted)');
      expect(win(off, 'color', { state: HOVER }), cls).toBe('var(--color-text-primary)');
      noBorder(off, REST);
      const on = mount(parent, `<button class="${active}"></button>`);
      expect(win(on, 'background'), active).toBe('var(--color-selection-solid)');
      expect(win(on, 'color'), active).toBe('var(--color-text-onaccent)');
      expect(win(on, 'color', { state: HOVER }), active).toBe('var(--color-text-onaccent)');
      expect(win(on, 'background', { state: HOVER }), active).toBe('var(--color-selection-solid)');
    }
    noOld('type-toggle'); noOld('type-btn'); noOld('type-btn-active'); noOld('auth-tabs'); noOld('auth-tab');
  });

  it('输入框：input.bg + input.border，聚焦描边 focus.border + 3px focus.glow，占位 text.placeholder', () => {
    for (const [parent, cls] of [['.form-fields', 'form-input'], ['.add-engine-form', 'engine-form-input'], ['.modal-title', 'folder-name-input']]) {
      const i = mount(parent, `<input class="${cls}">`);
      expect(win(i, 'background'), cls).toBe('var(--color-input-bg)');
      expect(win(i, 'border'), cls).toEqual({ kind: 'set', width: '1px', style: 'solid', color: 'var(--color-input-border)' });
      expect(win(i, 'color'), cls).toBe('var(--color-text-primary)');
      expect(win(i, 'border', { state: FOCUS_KB }), cls).toEqual({ kind: 'set', width: '1px', style: 'solid', color: 'var(--color-focus-border)' });
      expect(win(i, 'box-shadow', { state: FOCUS_KB }), cls).toBe('0 0 0 3px var(--color-focus-glow)');
      noOld(cls);
    }
    for (const [parent, cls] of [['.form-fields', 'form-input'], ['.add-engine-form', 'engine-form-input']]) {
      expect(win(mount(parent, `<input class="${cls}">`), 'color', { pseudoEl: '::placeholder' }), cls).toBe('var(--color-text-placeholder)');
    }
  });

  it('时钟下拉 .clock-entry select：input.bg + input.border，聚焦 focus.border（D5-21，不加光晕）；选项底不透明', () => {
    const sel = mount('.clock-entry', '<select></select>');
    expect(win(sel, 'background')).toBe('var(--color-input-bg)');
    expect(win(sel, 'border')).toEqual({ kind: 'set', width: '1px', style: 'solid', color: 'var(--color-input-border)' });
    expect(win(sel, 'color')).toBe('var(--color-text-secondary)');
    expect(win(sel, 'border', { state: FOCUS_KB })).toEqual({ kind: 'set', width: '1px', style: 'solid', color: 'var(--color-focus-border)' });
    expect(win(mount('.clock-entry select', '<option></option>'), 'background')).toBe('var(--color-bg-page)');
    const group = mount('.clock-entry select', '<optgroup></optgroup>');
    expect(win(group, 'background')).toBe('var(--color-bg-page)');
    expect(win(group, 'color')).toBe('var(--color-text-muted)');
  });

  it('图标预览框 input.bg（D5-19）、占位字 muted；字段标签、弹窗说明 muted（D5-24）', () => {
    expect(win(mount('.icon-upload-row', '<div class="icon-preview-box"></div>'), 'background')).toBe('var(--color-input-bg)');
    expect(win(mount('.icon-preview-box', '<span class="icon-preview-placeholder"></span>'), 'color')).toBe('var(--color-text-muted)');
    for (const cls of ['form-label', 'dialog-text', 'login-desc', 'verify-status']) {
      expect(win(mount('.dialog-card', `<p class="${cls}"></p>`), 'color'), cls).toBe('var(--color-text-muted)');
      noOld(cls);
    }
    noOld('icon-preview-box'); noOld('icon-preview-placeholder');
  });

  it('弹窗里其余文字按同名 token 换引用：标题、正文、链接、错误', () => {
    const t = (cls, color) => {
      expect(win(mount('.dialog-card', `<div class="${cls}"></div>`), 'color'), cls).toBe(color);
      noOld(cls);
    };
    t('dialog-title', 'var(--color-text-primary)');
    t('dialog-plain-title', 'var(--color-text-primary)');
    t('dialog-text-danger', 'var(--color-text-secondary)');
    t('login-consent-title', 'var(--color-text-primary)');
    t('login-consent-text', 'var(--color-text-secondary)');
    t('login-consent-footnote', 'var(--color-text-tertiary)');
    t('login-error', 'var(--color-text-danger)');
    t('verify-desc', 'var(--color-text-tertiary)');
    t('verify-email-target', 'var(--color-text-accent)');
    t('forgot-password-btn', 'var(--color-text-accent)');
    expect(win(mount('.dialog-card', '<h2 class="dialog-title dialog-title-danger"></h2>'), 'color')).toBe('var(--color-text-danger)');
    noOld('dialog-title-danger');
  });

  it('图标裁剪：舞台 surface.sunken，裁剪框 1px crop.line（原 1.5px），框外压暗 crop.mask，三分线 crop.grid，手柄 crop.line', () => {
    expect(win(mount('.icon-crop-card', '<div class="icon-crop-stage"></div>'), 'background')).toBe('var(--color-surface-sunken)');
    const box = mount('.icon-crop-stage', '<div class="icon-crop-box"></div>');
    expect(win(box, 'border')).toEqual({ kind: 'set', width: '1px', style: 'solid', color: 'var(--color-crop-line)' });
    expect(win(box, 'box-shadow')).toBe('0 0 0 9999px var(--color-crop-mask)');
    expect(win(mount('.icon-crop-box', '<div class="icon-crop-grid icon-crop-grid-v"></div>'), 'background')).toBe('var(--color-crop-grid)');
    expect(win(mount('.icon-crop-box', '<div class="icon-crop-handle" data-handle="nw"></div>'), 'background')).toBe('var(--color-crop-line)');
    expect(win(mount('.icon-crop-card', '<h2 class="icon-crop-title"></h2>'), 'color')).toBe('var(--color-text-primary)');
    expect(win(mount('.icon-crop-title', '<svg></svg>'), 'color')).toBe('var(--color-text-tertiary)');
    for (const c of ['icon-crop-stage', 'icon-crop-box', 'icon-crop-grid', 'icon-crop-title']) noOld(c);
  });
});

describe('浮层', () => {
  const MENU_BORDER = { kind: 'set', width: '1px', style: 'solid', color: 'var(--color-border-menu)' };

  it('右键菜单容器：surface.menu 底 + border.menu 描边（定稿 黑 78% / 黑 40%）', () => {
    const m = mount('body', '<div class="context-menu"></div>');
    expect(win(m, 'background')).toBe('var(--color-surface-menu)');
    expect(win(m, 'border')).toEqual(MENU_BORDER);
    noOld('context-menu');
  });

  it('菜单项：text.secondary，悬停 menu.hover，选中 selection.bg + text.accent（§6.5）', () => {
    const item = mount('.context-menu', '<div class="ctx-item"></div>');
    expect(win(item, 'color')).toBe('var(--color-text-secondary)');
    expect(win(item, 'background')).toBeNull();
    expect(win(item, 'background', { state: HOVER })).toBe('var(--color-menu-hover)');
    expect(win(item, 'color', { state: HOVER })).toBe('var(--color-text-secondary)');
    const active = mount('.context-menu', '<div class="ctx-item ctx-item-active"></div>');
    expect(win(active, 'background')).toBe('var(--color-selection-bg)');
    expect(win(active, 'color')).toBe('var(--color-text-accent)');
    noBorder(item, REST); noBorder(item, HOVER); noBorder(active, REST);
    noOld('ctx-item'); noOld('ctx-item-active');
  });

  it('危险菜单项：text.danger，悬停 danger.bg', () => {
    const d = mount('.context-menu', '<div class="ctx-item ctx-danger"></div>');
    expect(win(d, 'color')).toBe('var(--color-text-danger)');
    expect(win(d, 'background')).toBeNull();
    expect(win(d, 'background', { state: HOVER })).toBe('var(--color-danger-bg)');
    expect(win(d, 'color', { state: HOVER })).toBe('var(--color-text-danger)');
    noOld('ctx-danger');
  });

  it('菜单分隔线 divider（Q3，D5-6：黑 50% -> 白 10%）', () => {
    expect(win(mount('.context-menu', '<div class="ctx-sep"></div>'), 'background')).toBe('var(--color-divider)');
    noOld('ctx-sep');
  });

  it('尺寸按钮：普通 surface.sunken + text.muted（D5-16），悬停 menu.hover + text.secondary，选中 selection.bg + text.accent（D5-28）', () => {
    const b = mount('.ctx-size-grid', '<div class="ctx-size-btn"></div>');
    expect(win(b, 'background')).toBe('var(--color-surface-sunken)');
    expect(win(b, 'color')).toBe('var(--color-text-muted)');
    expect(win(b, 'background', { state: HOVER })).toBe('var(--color-menu-hover)');
    expect(win(b, 'color', { state: HOVER })).toBe('var(--color-text-secondary)');
    const on = mount('.ctx-size-grid', '<div class="ctx-size-btn size-active"></div>');
    expect(win(on, 'background')).toBe('var(--color-selection-bg)');
    expect(win(on, 'color')).toBe('var(--color-text-accent)');
    noBorder(b, REST); noBorder(b, HOVER); noBorder(on, REST);
    noOld('ctx-size-btn'); noOld('size-active');
  });

  it('引擎下拉容器：surface.menu 底 + border.menu 描边（D5-13，黑 50% -> 40%）；页脚顶边 divider（D5-35）', () => {
    const dd = mount('.search-bar', '<div class="engine-dropdown"></div>');
    expect(win(dd, 'background')).toBe('var(--color-surface-menu)');
    expect(win(dd, 'border')).toEqual(MENU_BORDER);
    const foot = mount('.engine-dropdown', '<div class="engine-dropdown-footer"></div>');
    expect(win(foot, 'border', { side: 'top' })).toEqual({ kind: 'set', width: '1px', style: 'solid', color: 'var(--color-divider)' });
    noOld('engine-dropdown'); noOld('engine-dropdown-footer');
  });

  it('引擎列表项：text.secondary，悬停 list.hover，选中 selection.bg + text.accent', () => {
    const item = mount('.engine-list', '<div class="engine-item"></div>');
    expect(win(item, 'color')).toBe('var(--color-text-secondary)');
    expect(win(item, 'background')).toBeNull();
    expect(win(item, 'background', { state: HOVER })).toBe('var(--color-list-hover)');
    const sel = mount('.engine-list', '<div class="engine-item selected"></div>');
    expect(win(sel, 'background')).toBe('var(--color-selection-bg)');
    expect(win(sel, 'color')).toBe('var(--color-text-accent)');
    noBorder(item, REST); noBorder(sel, REST);
    noOld('engine-item'); noOld('selected');
  });

  it('toast：surface.menu 底 + border.subtle 描边 + text.primary（D5-14）；错误态 text.danger + danger.border', () => {
    const t = mount('body', '<div class="app-toast"></div>');
    expect(win(t, 'background')).toBe('var(--color-surface-menu)');
    expect(win(t, 'color')).toBe('var(--color-text-primary)');
    expect(win(t, 'border')).toEqual({ kind: 'set', width: '1px', style: 'solid', color: 'var(--color-border-subtle)' });
    const err = mount('body', '<div class="app-toast" data-variant="error"></div>');
    expect(win(err, 'color')).toBe('var(--color-text-danger)');
    expect(win(err, 'border')).toEqual({ kind: 'set', width: '1px', style: 'solid', color: 'var(--color-danger-border)' });
    expect(win(err, 'background')).toBe('var(--color-surface-menu)');
    noOld('app-toast');
  });

  it('登录提示：surface.menu 底 + border.subtle 描边，图标 text.accent，标题 primary，副文 tertiary', () => {
    const n = mount('body', '<div class="signin-notice"></div>');
    expect(win(n, 'background')).toBe('var(--color-surface-menu)');
    expect(win(n, 'border')).toEqual({ kind: 'set', width: '1px', style: 'solid', color: 'var(--color-border-subtle)' });
    expect(win(mount('.signin-notice', '<svg class="signin-notice-icon"></svg>'), 'color')).toBe('var(--color-text-accent)');
    expect(win(mount('.signin-notice-text', '<p class="signin-notice-title"></p>'), 'color')).toBe('var(--color-text-primary)');
    expect(win(mount('.signin-notice-text', '<p class="signin-notice-sub"></p>'), 'color')).toBe('var(--color-text-tertiary)');
    for (const c of ['signin-notice', 'signin-notice-icon', 'signin-notice-title', 'signin-notice-sub']) noOld(c);
  });
});

// ---------------------------------------------------------------------------
// 阶段 B3（Task 33，spec §6）：焦点环、按下态、禁用态、输入框聚焦与错误态、滑块悬停。

describe('交互状态', () => {
  // [class, 祖先链, 标签]：按真实 DOM 的位置搭，免得祖先上的选择器（.engine-item .x 之类）被漏判。
  const make = ([cls, parent, tag = 'button', extra = '']) => mount(parent, `<${tag} class="${cls}" ${extra}></${tag}>`);
  const decl = (selectorText, prop, className = selectorText.match(/\.([\w-]+)/)[1]) => {
    const r = rulesMentioning(className).find((x) => x.selectors.some((s) => s.text === selectorText) && x.decls.some((d) => d.prop === prop));
    expect(r, `找不到声明了 ${prop} 的规则 ${selectorText}`).toBeTruthy();
    return r.decls.find((d) => d.prop === prop).value;
  };
  const RING = (offset) => ({ color: 'var(--color-focus-ring)', width: '2px', style: 'solid', offset });

  // 外扩环：四周有 >= 4px 空间的元素（弹窗内容区、侧栏分组卡片、直接在壁纸上的语言切换）
  const OUTSET = [
    ['btn-primary', '.dialog-actions'], ['btn-secondary', '.dialog-actions'], ['btn-danger', '.dialog-actions'],
    ['sidebar-action-btn', '.sidebar-panel'], ['lang-toggle', 'body'], ['close-btn', '.modal-header'],
    ['sidebar-range', '.sidebar-panel', 'input', 'type="range"'],
    ['icon-upload-btn', '.icon-upload-row'], ['icon-clear-btn', '.icon-upload-row'],
    ['clock-remove-btn', '.clock-entry'], ['clock-add-entry', '.clock-list'],
    ['folder-rename-btn', '#folder-title'], ['forgot-password-btn', '.login-card'],
  ];
  // 内缩环：被 overflow: hidden 或 4px 内边距包住的元素（§6.1.1）
  const INSET = [
    ['engine-trigger', '.search-bar'], ['engine-item', '.engine-list', 'div'], ['ctx-item', '.context-menu', 'div'],
    ['ctx-size-btn', '.ctx-size-grid', 'div'], ['type-btn', '.type-toggle'], ['auth-tab', '.auth-tabs'],
    ['left-sidebar-handle', '.left-sidebar'],
    ['engine-form-save', '.add-engine-form'], ['engine-form-cancel', '.add-engine-form'],
    ['add-engine-btn', '.engine-dropdown-footer'], ['engine-delete-btn', '.engine-item'],
  ];

  for (const state of [FOCUS_KB, FOCUS_KB_HOVER]) {
    const name = state === FOCUS_KB ? '键盘聚焦' : '键盘聚焦且鼠标悬停';
    it(`外扩环清单（${name}）：2px focus.ring，间隔 2px`, () => {
      for (const row of OUTSET) expect(win(make(row), 'outline', { state }), row[0]).toEqual(RING('2px'));
    });
    it(`内缩环清单（${name}）：2px focus.ring，offset -2px`, () => {
      for (const row of INSET) expect(win(make(row), 'outline', { state }), row[0]).toEqual(RING('-2px'));
    });
  }

  it('焦点环只在键盘焦点（:focus-visible）出现：悬停、按下、鼠标点击聚焦（focus 而非 focus-visible）都没有环', () => {
    for (const row of [...OUTSET, ...INSET]) {
      const el = make(row);
      for (const state of [REST, HOVER, PRESSED, PRESSED_FOCUS]) {
        expect(win(el, 'outline', { state }), `${row[0]} ${[...state].join('+') || 'rest'}`).toBeNull();
      }
    }
  });

  it('焦点环颜色统一为 focus.ring，含把手与语言切换（D5-22）', () => {
    for (const cls of ['left-sidebar-handle', 'lang-toggle']) {
      const row = [...OUTSET, ...INSET].find((r) => r[0] === cls);
      expect(win(make(row), 'outline', { state: FOCUS_KB }).color, cls).toBe('var(--color-focus-ring)');
    }
    // 环的取值只能来自 focus.ring，不再有白 42% / 白 40% 的旧写法
    for (const cls of ['left-sidebar-handle', 'lang-toggle']) {
      for (const r of rulesMentioning(cls)) {
        for (const d of r.decls.filter((x) => /^outline/.test(x.prop))) expect(d.value, `${r.selectors[0].text} ${d.prop}`).not.toMatch(/rgba?\(|#[0-9a-f]{3}/i);
      }
    }
  });

  it('文本输入聚焦：不另画 outline（outline: none），描边与光晕由各自规则负责', () => {
    const inputs = [['form-input', '.form-fields', 'input'], ['engine-form-input', '.add-engine-form', 'input'],
      ['folder-name-input', '.modal-title', 'input'], ['search-input', '.search-input-wrap', 'input']];
    for (const row of inputs) expect(win(make(row), 'outline', { state: FOCUS_KB }).style, row[0]).toBe('none');
    expect(win(mount('.clock-entry', '<select></select>'), 'outline', { state: FOCUS_KB }).style).toBe('none');
  });

  it('.engine-delete-btn 平时透明、悬停行时才出现；键盘聚焦它本身时必须可见，否则环画在透明按钮上', () => {
    const b = make(['engine-delete-btn', '.engine-item']);
    // 祖先上的 :hover 无法静态判定（已登记 b6-unverified.json 的 .engine-item:hover .engine-delete-btn）：断言它抛错，再直接断言声明
    let err;
    try { win(b, 'opacity'); } catch (e) { err = e; }
    expect(err?.name).toBe('CascadeUndecidable');
    expect(err.selector).toBe('.engine-item:hover .engine-delete-btn');
    expect(decl('.engine-item:hover .engine-delete-btn', 'opacity', 'engine-delete-btn')).toBe('1');
    expect(decl('.engine-delete-btn', 'opacity')).toBe('0');
    expect(decl('.engine-delete-btn:focus-visible', 'opacity')).toBe('1');
  });

  // -------------------------------------------------------------------------
  // 按下与悬停

  const DISABLEABLE = [
    ['btn-primary', '.dialog-actions'], ['btn-secondary', '.dialog-actions'], ['btn-danger', '.dialog-actions'],
    ['engine-form-save', '.add-engine-form'], ['engine-form-cancel', '.add-engine-form'],
    ['icon-upload-btn', '.icon-upload-row'], ['icon-clear-btn', '.icon-upload-row'],
    ['close-btn', '.modal-header'], ['add-engine-btn', '.engine-dropdown-footer'],
    ['sidebar-action-btn', '.sidebar-panel'], ['forgot-password-btn', '.login-card'],
    ['lang-toggle', 'body'], ['clock-remove-btn', '.clock-entry'], ['clock-add-entry', '.clock-list'],
    ['folder-rename-btn', '#folder-title'],
  ];

  it('实心按钮按下态（PRESSED = hover + active，悬停规则写在后面也必须被按下规则压住）：blue.800 / red.800（Q1，D5-37）', () => {
    for (const cls of ['btn-primary', 'engine-form-save']) {
      const b = make([cls, '.dialog-actions']);
      expect(win(b, 'background', { state: PRESSED }), cls).toBe('var(--color-action-primary-pressed)');
      expect(win(b, 'background', { state: HOVER }), cls).toBe('var(--color-action-primary-hover)');
      expect(win(b, 'color', { state: PRESSED }), cls).toBe('var(--color-text-onaccent)');
    }
    const d = make(['btn-danger', '.dialog-actions']);
    expect(win(d, 'background', { state: PRESSED })).toBe('var(--color-action-danger-pressed)');
    expect(win(d, 'background', { state: HOVER })).toBe('var(--color-action-danger-hover)');
  });

  it('secondary × default × default 按下 control.bg.pressed（15%，介于普通 10% 与悬停 20% 之间）', () => {
    for (const cls of ['btn-secondary', 'icon-upload-btn', 'engine-form-cancel']) {
      const b = make([cls, '.dialog-actions']);
      expect(win(b, 'background', { state: PRESSED }), cls).toBe('var(--color-control-bg-pressed)');
      expect(win(b, 'color', { state: PRESSED }), cls).toBe('var(--color-text-tertiary)');
      noBorder(b, PRESSED);
    }
    const add = make(['clock-add-entry', '.clock-list']);
    expect(win(add, 'background', { state: PRESSED })).toBe('var(--color-control-bg-pressed)');
    expect(win(add, 'background', { state: HOVER })).toBe('var(--color-control-bg-hover)');
  });

  it('ghost × default 按下 control.bg.pressed + text.primary；ghost × danger 按下 = 悬停（danger.bg + text.danger）', () => {
    for (const [cls, parent] of [['close-btn', '.modal-header'], ['add-engine-btn', '.engine-dropdown-footer'], ['folder-rename-btn', '#folder-title']]) {
      const b = make([cls, parent]);
      expect(win(b, 'background', { state: PRESSED }), cls).toBe('var(--color-control-bg-pressed)');
      expect(win(b, 'color', { state: PRESSED }), cls).toBe('var(--color-text-primary)');
      expect(win(b, 'background', { state: HOVER }), cls).toBe('var(--color-control-bg-hover)');
      noBorder(b, PRESSED);
    }
    for (const [cls, parent] of [['clock-remove-btn', '.clock-entry'], ['engine-delete-btn', '.engine-list'], ['icon-clear-btn', '.icon-upload-row']]) {
      const b = make([cls, parent]);
      expect(win(b, 'background', { state: PRESSED }), cls).toBe('var(--color-danger-bg)');
      expect(win(b, 'color', { state: PRESSED }), cls).toBe('var(--color-text-danger)');
    }
  });

  it('侧栏按钮按下 control.panel.pressed（白 18%，D5-7），危险款同；文字不变', () => {
    const b = make(['sidebar-action-btn', '.sidebar-panel']);
    expect(win(b, 'background', { state: PRESSED })).toBe('var(--color-control-panel-pressed)');
    expect(win(b, 'background', { state: HOVER })).toBe('var(--color-control-panel-hover)');
    expect(win(b, 'color', { state: PRESSED })).toBe('var(--color-text-primary)');
    const danger = mount('.sidebar-panel', '<button class="sidebar-action-btn sidebar-action-btn-danger"></button>');
    expect(win(danger, 'background', { state: PRESSED })).toBe('var(--color-control-panel-pressed)');
    expect(win(danger, 'color', { state: PRESSED })).toBe('var(--color-text-dangeronfill)');
    noBorder(b, PRESSED);
  });

  it('分段切换、菜单项、列表项、引擎触发按下 = 悬停（§6.3、§6.5）', () => {
    for (const cls of ['type-btn', 'auth-tab']) {
      const b = make([cls, cls === 'type-btn' ? '.type-toggle' : '.auth-tabs']);
      expect(win(b, 'color', { state: PRESSED }), cls).toBe('var(--color-text-primary)');
    }
    expect(win(make(['ctx-item', '.context-menu', 'div']), 'background', { state: PRESSED })).toBe('var(--color-menu-hover)');
    expect(win(mount('.context-menu', '<div class="ctx-item ctx-danger"></div>'), 'background', { state: PRESSED })).toBe('var(--color-danger-bg)');
    expect(win(make(['ctx-size-btn', '.ctx-size-grid', 'div']), 'background', { state: PRESSED })).toBe('var(--color-menu-hover)');
    expect(win(make(['engine-item', '.engine-list', 'div']), 'background', { state: PRESSED })).toBe('var(--color-list-hover)');
    expect(win(make(['engine-trigger', '.search-bar']), 'background', { state: PRESSED })).toBe('var(--color-surface-glass-hover)');
  });

  it('选中 + 悬停 / 按下：尺寸按钮 menu.hover + text.accent（§6.4）；菜单项同理；引擎项 list.hover + text.accent（§6.5）', () => {
    const size = mount('.ctx-size-grid', '<div class="ctx-size-btn size-active"></div>');
    for (const state of [HOVER, PRESSED]) {
      expect(win(size, 'background', { state })).toBe('var(--color-menu-hover)');
      expect(win(size, 'color', { state })).toBe('var(--color-text-accent)');
    }
    expect(win(size, 'background')).toBe('var(--color-selection-bg)');
    const item = mount('.context-menu', '<div class="ctx-item ctx-item-active"></div>');
    for (const state of [HOVER, PRESSED]) {
      expect(win(item, 'background', { state })).toBe('var(--color-menu-hover)');
      expect(win(item, 'color', { state })).toBe('var(--color-text-accent)');
    }
    expect(win(item, 'background')).toBe('var(--color-selection-bg)');
    const eng = mount('.engine-list', '<div class="engine-item selected"></div>');
    for (const state of [HOVER, PRESSED]) {
      expect(win(eng, 'background', { state })).toBe('var(--color-list-hover)');
      expect(win(eng, 'color', { state })).toBe('var(--color-text-accent)');
    }
    expect(win(eng, 'background')).toBe('var(--color-selection-bg)');
  });

  it('文件夹格悬停叠白 surface.glass.hover，替换底色（D5-8）', () => {
    const slot = mount('.folder-slot-grid', '<div class="folder-slot-normal folder-slot-folder"></div>');
    const mini = mount('.folder-slot-mini-group', '<div class="folder-mini-icon folder-mini-folder-slot"></div>');
    for (const [el, name] of [[slot, 'folder-slot-folder'], [mini, 'folder-mini-folder-slot']]) {
      expect(win(el, 'background'), name).toBe('var(--color-surface-glass-default)');
      expect(win(el, 'background', { state: HOVER }), name).toBe('var(--color-surface-glass-hover)');
      expect(win(el, 'background', { state: PRESSED }), name).toBe('var(--color-surface-glass-hover)');
    }
    // 普通的预览格（非文件夹）没有悬停底
    const normal = mount('.folder-slot-grid', '<div class="folder-slot-normal"></div>');
    expect(win(normal, 'background', { state: HOVER })).toBe('transparent');
  });

  // -------------------------------------------------------------------------
  // 禁用

  it('禁用态不响应悬停与按下：底、字色、描边、透明度都等于禁用的普通态', () => {
    for (const row of DISABLEABLE) {
      const el = make([...row.slice(0, 2), 'button', 'disabled']);
      for (const family of ['background', 'color', 'border', 'opacity']) {
        const rest = win(el, family);
        for (const state of [HOVER, PRESSED]) {
          expect(win(el, family, { state }), `${row[0]} ${family} ${[...state].join('+')}`).toEqual(rest);
        }
      }
    }
    const range = make(['sidebar-range', '.sidebar-panel', 'input', 'type="range" disabled']);
    for (const pe of ['::-webkit-slider-thumb', '::-moz-range-thumb']) {
      expect(win(range, 'box-shadow', { state: HOVER, pseudoEl: pe }), pe).toBe(win(range, 'box-shadow', { pseudoEl: pe }));
    }
  });

  it('禁用态 = opacity var(--opacity-disabled) + cursor not-allowed（统一 0.4 / 0.55 / 0.6 / 0.7 与 cursor: default）', () => {
    for (const row of DISABLEABLE) {
      const off = make([...row.slice(0, 2), 'button', 'disabled']);
      expect(win(off, 'opacity'), row[0]).toBe('var(--opacity-disabled)');
      expect(win(off, 'cursor'), row[0]).toBe('not-allowed');
      const on = make(row);
      expect(win(on, 'opacity'), `${row[0]} 可用时`).not.toBe('var(--opacity-disabled)');
      expect(win(on, 'cursor'), `${row[0]} 可用时`).not.toBe('not-allowed');
    }
    // 输入框、下拉、滑块
    for (const row of [['form-input', '.form-fields', 'input'], ['engine-form-input', '.add-engine-form', 'input'],
      ['folder-name-input', '.modal-title', 'input'], ['sidebar-range', '.sidebar-panel', 'input', 'type="range"']]) {
      const off = make([row[0], row[1], row[2], `${row[3] ?? ''} disabled`]);
      expect(win(off, 'opacity'), row[0]).toBe('var(--opacity-disabled)');
      expect(win(off, 'cursor'), row[0]).toBe('not-allowed');
    }
    const sel = mount('.clock-entry', '<select disabled></select>');
    expect(win(sel, 'opacity')).toBe('var(--opacity-disabled)');
    expect(win(sel, 'cursor')).toBe('not-allowed');
    // .engine-delete-btn 在 .engine-item 里，opacity 族会撞上祖先 :hover 的规则（无法静态判定），直接断言规则里有它
    const unified = rulesMentioning('engine-delete-btn').find((r) => r.selectors.some((s) => s.text === '.engine-delete-btn:disabled'));
    expect(unified?.decls.find((d) => d.prop === 'opacity').value).toBe('var(--opacity-disabled)');
    expect(unified?.decls.find((d) => d.prop === 'cursor').value).toBe('not-allowed');
  });

  it('旧的禁用写法都收进统一规则：不再有 opacity 0.4 / 0.55 / 0.6 / 0.7 做禁用，也没有 cursor: default', () => {
    for (const cls of ['forgot-password-btn', 'sidebar-action-btn', 'btn-danger', 'btn-secondary']) {
      for (const r of rulesMentioning(cls)) {
        if (!r.selectors.some((s) => s.text.endsWith(':disabled'))) continue;
        const vals = Object.fromEntries(r.decls.map((d) => [d.prop, d.value]));
        expect(vals.opacity, r.selectors[0].text).toBe('var(--opacity-disabled)');
        expect(vals.cursor, r.selectors[0].text).toBe('not-allowed');
      }
    }
  });

  // -------------------------------------------------------------------------
  // 输入框聚焦、错误态

  it('.form-input:focus 用 focus.border + 3px focus.glow（三种输入框同）', () => {
    for (const row of [['form-input', '.form-fields', 'input'], ['engine-form-input', '.add-engine-form', 'input'], ['folder-name-input', '.modal-title', 'input']]) {
      const i = make(row);
      expect(win(i, 'border', { state: FOCUS_KB }), row[0]).toEqual({ kind: 'set', width: '1px', style: 'solid', color: 'var(--color-focus-border)' });
      expect(win(i, 'box-shadow', { state: FOCUS_KB }), row[0]).toBe('0 0 0 3px var(--color-focus-glow)');
    }
  });

  it('.is-invalid 描边为 danger.border，聚焦时保持（替代 JS 写入的 #ef4444）', () => {
    for (const cls of ['form-input', 'engine-form-input', 'folder-name-input']) {
      const parent = { 'form-input': '.form-fields', 'engine-form-input': '.add-engine-form', 'folder-name-input': '.modal-title' }[cls];
      const bad = mount(parent, `<input class="${cls} is-invalid">`);
      const red = { kind: 'set', width: '1px', style: 'solid', color: 'var(--color-danger-border)' };
      for (const state of [REST, HOVER, FOCUS_KB, FOCUS_KB_HOVER]) expect(win(bad, 'border', { state }), `${cls} ${[...state].join('+') || 'rest'}`).toEqual(red);
      // 没有 .is-invalid 的同类输入框不受影响
      expect(win(mount(parent, `<input class="${cls}">`), 'border', { state: FOCUS_KB }).color).toBe('var(--color-focus-border)');
      expect(win(mount(parent, `<input class="${cls}">`), 'border').color).toBe('var(--color-input-border)');
    }
  });

  // -------------------------------------------------------------------------
  // 焦点环不被裁掉、滑块悬停

  it('.grid-scroll-region 四周 padding >= 4px（外扩环不被 overflow 裁掉，§6.1.1）', () => {
    const region = mount('.main-content', '<section class="grid-scroll-region"></section>');
    const px = (v) => (/rem$/.test(v) ? parseFloat(v) * 16 : parseFloat(v));
    const [t, r = t, b = t, l = r] = win(region, 'padding').trim().split(/\s+/).map(px);
    for (const [side, v] of Object.entries({ top: t, right: r, bottom: b, left: l })) expect(v, side).toBeGreaterThanOrEqual(4);
  });

  it('滑块拇指悬停有 4px control.panel.hover 光圈，保留原有投影；时长 fast（D5-31）', () => {
    const range = make(['sidebar-range', '.sidebar-panel', 'input', 'type="range"']);
    for (const pe of ['::-webkit-slider-thumb', '::-moz-range-thumb']) {
      const rest = win(range, 'box-shadow', { pseudoEl: pe });
      const hover = win(range, 'box-shadow', { state: HOVER, pseudoEl: pe });
      expect(rest, pe).not.toContain('var(--color-control-panel-hover)');
      expect(hover, pe).toContain('0 0 0 4px var(--color-control-panel-hover)');
      expect(hover, `${pe} 保留原投影`).toContain(rest);
      expect(win(range, 'box-shadow', { state: PRESSED, pseudoEl: pe }), `${pe} 按下同悬停`).toBe(hover);
      expect(win(range, 'transition', { pseudoEl: pe }), pe).toContain('box-shadow var(--motion-duration-fast)');
      // 尺寸不变
      expect(win(range, 'width', { state: HOVER, pseudoEl: pe })).toBe(win(range, 'width', { pseudoEl: pe }));
    }
  });
});
