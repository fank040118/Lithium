// z-index 命名分层与动效 token。
//
// 做法：
//   - 全局层按设计规范的全局层表逐个断言（经 cssCascade 判定最终生效的值）；局部层按局部层表。
//   - 「先后顺序不变」不硬编码期望序列：用 git show b733093:style.css 的旧值排一次序，再拿现在的新值排一次序，
//     比较两个序列。同值的元素按 newtab.html 里的 DOM 顺序决定先后（后面的在上），与浏览器一致。
//   - 动效：只扫声明，没有 transition: all，时长与缓动全部走 token；减少动效的 @media 块直接解析声明
//     （cssCascade 不处理 @media）。
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStyleCss, parseCss, splitTopLevel, isReducedMotion } from './helpers/cssRules.js';
import { cascade, createCascade, rulesMentioning, STATE_SETS } from './helpers/cssCascade.js';
import { loadTokens, tokenToCssVar } from './helpers/designTokens.js';

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const css = readStyleCss();
const rules = parseCss(css);

const selectorKey = (rule) => rule.selectors.map((s) => s.text.replace(/\s+/g, ' ')).join(', ');
const ROOT_KEYS = new Set([':root', ':root, [data-theme="dark"]']);
const usage = rules.filter((r) => r.media === null && !ROOT_KEYS.has(selectorKey(r)));
const usageDecls = [];
for (const r of usage) {
  for (const d of r.decls) usageDecls.push({ sel: selectorKey(r), prop: d.prop, value: d.value.trim(), line: d.line });
}

const NEWTAB = readFileSync(resolve(ROOT_DIR, 'newtab.html'), 'utf8');
const BODY_HTML = /<body[^>]*>([\s\S]*)<\/body>/i.exec(NEWTAB)[1];

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

// ---------------------------------------------------------------------------
// z-index：全局层

// 元素 → 设计规范全局层表里的 token。选择器用 mk 搭出元素；多 class 的弹窗按 newtab.html 里的实际写法。
const GLOBAL_LAYERS = [
  ['#wallpaper-bg', 'var(--z-wallpaper)'],
  ['#wallpaper-dim', 'var(--z-dim)'],
  ['.main-content', 'var(--z-content)'],
  ['.left-sidebar', 'var(--z-sidebar)'],
  ['.overlay', 'var(--z-modal-base)'],                                            // 文件夹弹窗、登录弹窗
  ['.overlay.overlay-edit', 'var(--z-modal-nested)'],                             // 编辑、时钟设置
  ['.lang-toggle', 'var(--z-floating)'],
  ['.overlay.overlay-mid', 'var(--z-modal-confirm)'],                             // 删除、删除账户、登录同意、裁剪
  ['.overlay.overlay-mid.sync-conflict-overlay', 'var(--z-modal-critical)'],      // 同步冲突
  ['.signin-notice', 'var(--z-notice)'],
  ['.context-menu', 'var(--z-menu)'],
  ['.app-toast', 'var(--z-toast)'],
];

// 局部层（设计规范局部层表）：元素 → 新值。小整数不进 token，只要求保持原有先后。
const LOCAL_LAYERS = [
  { sel: '.grid-area', parent: '.main-content', value: '1' },
  { sel: '.main-hero', parent: '.main-content', value: '2' },
  { sel: '.search-container', parent: '.main-content .main-hero', value: '2' },
  { sel: '.engine-dropdown', parent: '.search-container', value: '1' },
  { sel: '.drag-indicator', parent: '.grid-area', value: '2' },
  { sel: '.grid-item-name', parent: '.grid-area .grid-item-wrap[data-size="4x2"]', value: '1' },
  { sel: '.left-sidebar-handle', parent: '.left-sidebar', value: '1' },
];

describe('z-index：全局层只用 var(--z-*)，取值与设计规范全局层表一致', () => {
  it('逐个元素最终生效的 z-index 是表里的 token', () => {
    for (const [sel, token] of GLOBAL_LAYERS) {
      expect(cascade(mk(sel), 'z-index'), sel).toBe(token);
    }
  });

  it('--z-* 的值与 tokens.json 的 z.* 一致（12 个全局层，值都在 :root 里）', () => {
    const rootDecls = new Map();
    for (const r of rules) {
      if (r.media === null && selectorKey(r) === ':root') for (const d of r.decls) rootDecls.set(d.prop, d.value.trim());
    }
    const zTokens = loadTokens().filter((t) => t.name.startsWith('z.'));
    expect(zTokens).toHaveLength(12);
    for (const t of zTokens) expect(rootDecls.get(tokenToCssVar(t.name)), t.name).toBe(String(t.value));
    for (const [, token] of GLOBAL_LAYERS) {
      const name = /var\((--[\w-]+)\)/.exec(token)[1];
      expect(rootDecls.has(name), name).toBe(true);
    }
  });

  it('语言切换 315 在登录、文件夹、编辑弹窗之上，在确认类弹窗之下（修正点 1）', () => {
    const z = (sel) => Number(cssZ(cascade(mk(sel), 'z-index')));
    expect(z('.lang-toggle')).toBeGreaterThan(z('.overlay.overlay-edit'));
    expect(z('.lang-toggle')).toBeLessThan(z('.overlay.overlay-mid'));
  });
});

// var(--z-x) → 数字（读 :root）
function cssZ(value) {
  if (/^-?\d+$/.test(value)) return value;
  const name = /^var\((--z-[\w-]+)\)$/.exec(value)?.[1];
  if (!name) throw new Error(`不是 z token：${value}`);
  for (const r of rules) {
    if (r.media !== null || selectorKey(r) !== ':root') continue;
    const d = r.decls.find((x) => x.prop === name);
    if (d) return d.value.trim();
  }
  throw new Error(`:root 里没有 ${name}`);
}

describe('z-index：局部层', () => {
  it('局部层取值与设计规范局部层表一致', () => {
    for (const { sel, parent, value } of LOCAL_LAYERS) {
      expect(cascade(mk(sel, parent), 'z-index'), sel).toBe(value);
    }
  });

  it('壁纸预览的 ::before / ::after 仍是 -1（预览自己 isolation: isolate 形成上下文）', () => {
    const el = mk('.sidebar-wallpaper-preview');
    expect(cascade(el, 'isolation')).toBe('isolate');
    expect(cascade(el, 'z-index', { pseudoEl: '::after' })).toBe('-1');
    expect(cascade(el, 'z-index', { pseudoEl: '::before' })).toBe('-1');
  });

  it('全表扫描：style.css 里的 z-index 声明只有 token、全局层与局部层表，没有别的裸整数', () => {
    const found = usageDecls
      .filter((d) => d.prop === 'z-index')
      .map((d) => (/^var\(--z-[\w-]+\)$/.test(d.value) ? 'token' : `${d.sel} | ${d.value}`));
    const literals = found.filter((x) => x !== 'token').sort();
    const expected = [
      '.engine-dropdown | 1',
      '.drag-indicator | 2',
      '.grid-area | 1',
      '.grid-item-wrap[data-size="1x2"] .grid-item-name, .grid-item-wrap[data-size="2x1"] .grid-item-name, .grid-item-wrap[data-size="2x2"] .grid-item-name, .grid-item-wrap[data-size="2x4"] .grid-item-name, .grid-item-wrap[data-size="4x2"] .grid-item-name | 1',
      '.left-sidebar-handle | 1',
      '.main-hero | 2',
      '.search-container | 2',
      '.sidebar-wallpaper-preview::before, .sidebar-wallpaper-preview::after | -1',
    ].sort();
    expect(literals).toEqual(expected);
    // 12 条全局层声明：壁纸、压暗、主区、侧栏、.overlay / -mid / -edit / 冲突弹窗、语言切换、菜单、toast、登录提示
    expect(found.filter((x) => x === 'token')).toHaveLength(12);
  });
});

describe('.main-content 层叠上下文', () => {
  it('.main-content 声明 isolation: isolate', () => {
    expect(cascade(mk('.main-content'), 'isolation')).toBe('isolate');
  });

  it('浮层（菜单、toast、弹窗、登录提示、语言切换）都是 body 的直接子元素，不在 .main-content 里面', () => {
    document.body.innerHTML = BODY_HTML;
    const main = document.querySelector('.main-content');
    const ids = ['context-menu', 'app-toast', 'signin-notice', 'lang-toggle', 'folder-overlay', 'login-overlay',
      'edit-overlay', 'clock-overlay', 'delete-overlay', 'delete-account-overlay', 'login-consent-overlay',
      'icon-crop-overlay', 'sync-conflict-overlay', 'left-sidebar'];
    for (const id of ids) {
      const el = document.getElementById(id);
      expect(el, id).not.toBeNull();
      expect(main.contains(el), id).toBe(false);
      expect(el.parentElement, id).toBe(document.body);
    }
  });
});

// ---------------------------------------------------------------------------
// 先后顺序：与 b733093 对照

describe('z-index：先后顺序与 b733093 相同', () => {
  let oldCascade;
  beforeAll(() => {
    let oldCss;
    try {
      oldCss = execFileSync('git', ['show', 'b733093:style.css'], { cwd: ROOT_DIR, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    } catch (e) {
      throw new Error(`读不到 b733093:style.css（需要完整的 git 历史）：${e.message}`);
    }
    oldCascade = createCascade(oldCss);
  });

  // 取 newtab.html 里真实的元素，按 (z, DOM 顺序) 排序，返回 id / 选择器序列。
  const GLOBAL_ELEMENTS = [
    '#wallpaper-bg', '#wallpaper-dim', '.main-content', '#left-sidebar',
    '#folder-overlay', '#login-overlay', '#edit-overlay', '#clock-overlay',
    '#delete-overlay', '#delete-account-overlay', '#login-consent-overlay', '#icon-crop-overlay',
    '#sync-conflict-overlay', '#lang-toggle', '#context-menu', '#app-toast', '#signin-notice',
  ];

  function sequence(cascadeFn, toNumber) {
    document.body.innerHTML = BODY_HTML;
    const all = [...document.body.querySelectorAll('*')];
    return GLOBAL_ELEMENTS
      .map((sel) => {
        const el = document.querySelector(sel);
        expect(el, sel).not.toBeNull();
        const hit = cascadeFn(el);
        expect(hit, sel).not.toBeNull();
        return { sel, z: toNumber(hit), dom: all.indexOf(el) };
      })
      .sort((a, b) => a.z - b.z || a.dom - b.dom)
      .map((x) => x.sel);
  }

  it('全局层：旧值排一次序、新值排一次序，两个序列相同', () => {
    const oldSeq = sequence((el) => oldCascade.cascade(el, 'z-index'), Number);
    const newSeq = sequence((el) => cascade(el, 'z-index'), (v) => Number(cssZ(v)));
    expect(newSeq).toEqual(oldSeq);
    // 序列本身不是空的、也没有元素被漏掉
    expect(oldSeq).toHaveLength(GLOBAL_ELEMENTS.length);
  });

  it('全局层：新值互不相同（不再靠 DOM 顺序打破平局）', () => {
    document.body.innerHTML = BODY_HTML;
    const zs = GLOBAL_ELEMENTS.map((sel) => Number(cssZ(cascade(document.querySelector(sel), 'z-index'))));
    const kinds = new Set(zs);
    // 同一类弹窗成员（两个 base、两个 nested、四个 confirm）共用一个层，所以种类数 = 12
    expect(kinds.size).toBe(12);
  });

  it('局部层：旧值有先后的成对元素，新值保持同样的先后', () => {
    const PAIRS = [
      // [低层, 高层, 低层的祖先链, 高层的祖先链]
      ['.grid-area', '.main-hero', '.main-content', '.main-content'],
      ['.grid-item-name', '.drag-indicator', '.grid-area .grid-item-wrap[data-size="4x2"]', '.grid-area'],
    ];
    for (const [lo, hi, loParent, hiParent] of PAIRS) {
      const oldLo = Number(oldCascade.cascade(mk(lo, loParent), 'z-index'));
      const oldHi = Number(oldCascade.cascade(mk(hi, hiParent), 'z-index'));
      const newLo = Number(cascade(mk(lo, loParent), 'z-index'));
      const newHi = Number(cascade(mk(hi, hiParent), 'z-index'));
      expect(oldLo, `${lo} < ${hi}（旧）`).toBeLessThan(oldHi);
      expect(newLo, `${lo} < ${hi}（新）`).toBeLessThan(newHi);
    }
  });
});

// ---------------------------------------------------------------------------
// 动效

const TIME = /^-?(?:\d+\.?\d*|\.\d+)m?s$/;
const EASING_KEYWORD = /^(?:ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end)$|^(?:cubic-bezier|steps)\(/;
const MOTION_PROP = /^(?:transition|transition-duration|transition-timing-function|animation|animation-duration|animation-timing-function)$/;

// 例外：设计规范没有给它们定 token。每一项必须仍然命中。
const MOTION_EXCEPTIONS = {
  // .move-to-main-hint 的无限呼吸动画，2 秒循环、缓动 ease-in-out；不在 4 档时长里，留给后续决定。
  '.move-to-main-hint | animation': 'pulse 2s ease-in-out infinite',
};

const motionDecls = usageDecls.filter((d) => MOTION_PROP.test(d.prop));
const exceptionKey = (d) => `${d.sel} | ${d.prop}`;

function motionProblems(d) {
  if (MOTION_EXCEPTIONS[exceptionKey(d)] === d.value) return [];
  const problems = [];
  for (const item of splitTopLevel(d.value, ',')) {
    for (const t of splitTopLevel(item.trim(), ' ')) {
      if (t === 'all') problems.push(`transition all：${d.sel} | ${d.value}`);
      if (TIME.test(t) && !/^0m?s$/.test(t)) problems.push(`字面时长 ${t}：${d.sel} | ${d.value}`);
      if (EASING_KEYWORD.test(t)) problems.push(`字面缓动 ${t}：${d.sel} | ${d.value}`);
    }
  }
  return problems;
}

describe('动效 token', () => {
  it('没有 transition: all；时长只用 var(--motion-duration-*)，缓动只用 var(--motion-ease-*)', () => {
    expect(motionDecls.length).toBeGreaterThan(30);
    expect(motionDecls.flatMap(motionProblems)).toEqual([]);
  });

  it('transition / animation 里出现的 var() 都是 --motion-duration-(fast|base|slow|slower) 或 --motion-ease-(standard|exit|enter|move)', () => {
    for (const d of motionDecls) {
      for (const m of d.value.matchAll(/var\(\s*(--[\w-]+)/g)) {
        expect(m[1], `${d.sel} | ${d.value}`).toMatch(/^--motion-(?:duration-(?:fast|base|slow|slower)|ease-(?:standard|exit|enter|move))$/);
      }
    }
  });

  it('例外表里的每一项都仍然命中（清单不过期）', () => {
    for (const [key, value] of Object.entries(MOTION_EXCEPTIONS)) {
      expect(motionDecls.some((d) => exceptionKey(d) === key && d.value === value), key).toBe(true);
    }
  });

  it('时长按设计规范并入：0.15s → fast；0.18s、0.2s → base；0.24s、260ms → slow；340ms、0.36s → slower', () => {
    const get = (sel, prop = 'transition') => cascade(mk(sel), prop);
    expect(get('.left-sidebar')).toBe('transform var(--motion-duration-slow) var(--motion-ease-standard)');      // 0.24s
    expect(get('.sidebar-action-btn')).toContain('background var(--motion-duration-base)');                       // 0.18s
    expect(get('.lang-toggle')).toContain('border-color var(--motion-duration-base)');                            // 0.18s
    expect(get('.app-toast')).toBe('opacity var(--motion-duration-base) var(--motion-ease-standard), transform var(--motion-duration-base) var(--motion-ease-standard)');
    expect(get('.signin-notice')).toBe('transform var(--motion-duration-slower) var(--motion-ease-move), opacity var(--motion-duration-slower) var(--motion-ease-standard)');  // 0.36s，曲线 move
    // 弹窗 / 文件夹：打开 340ms enter，关闭 260ms exit
    const anim = (sel, parent) => cascade(mk(sel, parent), 'animation');
    expect(anim('.folder-modal.folder-opening')).toBe('folder-open var(--motion-duration-slower) var(--motion-ease-enter) both');
    expect(anim('.folder-modal.folder-closing')).toBe('folder-close var(--motion-duration-slow) var(--motion-ease-exit) both');
    expect(anim('#folder-overlay.overlay-opening')).toBe('overlay-open var(--motion-duration-slower) var(--motion-ease-enter) both');
    expect(anim('#folder-overlay.overlay-closing')).toBe('overlay-close var(--motion-duration-slow) var(--motion-ease-exit) both');
  });
});

// 原来写 transition: all 的 8 个元素：改成列出属性后，必须仍覆盖各状态规则里真正变化的属性。
// 时长不变（0.15s → fast，0.2s → base）。focus-visible 的 outline 不列入：同一组控件
// （.btn-*、.sidebar-action-btn 等）的 transition 都不含 outline，焦点环瞬间出现（见 task-36-report.md）。
// tag 是该 class 在 newtab.html / app.js 里实际用的元素；jsdom 的 :disabled 只匹配表单控件，用 div 建会让禁用态判定落空。
// disableRule：该元素有 :disabled 规则（改 opacity）。.type-btn 没有；.ctx-size-btn 是 div，不可禁用。
const ALL_REWRITES = [
  { sel: '.clock-remove-btn', tag: 'button', disableRule: true,    duration: 'fast', props: ['background', 'color', 'opacity'] },
  { sel: '.clock-add-entry', tag: 'button', disableRule: true,     duration: 'base', props: ['background', 'color', 'border-color', 'opacity'] },
  { sel: '.engine-delete-btn', tag: 'button', disableRule: true,   duration: 'fast', props: ['opacity', 'background', 'color'] },
  { sel: '.add-engine-btn', tag: 'button', disableRule: true,      duration: 'fast', props: ['background', 'color', 'opacity'] },
  { sel: '.engine-form-cancel', tag: 'button', disableRule: true,  duration: 'fast', props: ['background', 'opacity'] },
  { sel: '.close-btn', tag: 'button', disableRule: true,           duration: 'base', props: ['background', 'color', 'opacity'] },
  { sel: '.type-btn', tag: 'button', disableRule: false,            duration: 'base', props: ['background', 'color'] },
  { sel: '.ctx-size-btn', tag: 'div', disableRule: false,        duration: 'fast', props: ['background', 'color'] },
];

describe('transition: all 改成列出属性', () => {
  const listed = (sel, tag) => splitTopLevel(cascade(mk(`${tag}${sel}`), 'transition'), ',')
    .map((item) => {
      const [prop, dur, ease] = splitTopLevel(item.trim(), ' ');
      return { prop, dur, ease };
    });

  it('8 个元素的属性与时长与表一致', () => {
    for (const { sel, tag, duration, props } of ALL_REWRITES) {
      const got = listed(sel, tag);
      expect(got.map((x) => x.prop), sel).toEqual(props);
      for (const x of got) {
        expect(x.dur, sel).toBe(`var(--motion-duration-${duration})`);
        expect(x.ease, sel).toBe('var(--motion-ease-standard)');
      }
    }
  });

  it('列出的属性覆盖各状态下实际变化的属性：悬停、按下、禁用逐一对照最终生效值', () => {
    const FAMILIES = ['background', 'color', 'opacity'];
    const norm = (p) => (p === 'background-color' ? 'background' : p);
    for (const { sel, tag, disableRule, props } of ALL_REWRITES) {
      // 防止禁用态这一支再次落空：有 :disabled 规则的元素，禁用与否的 opacity 必须真的不同
      const opacityOf = (disabled) => {
        const el = mk(`${tag}${sel}`);
        if (disabled) el.setAttribute('disabled', '');
        return cascade(el, 'opacity');
      };
      if (disableRule) {
        expect(opacityOf(true), `${sel} 禁用态 opacity`).toBe('var(--opacity-disabled)');
        expect(opacityOf(false), `${sel} 可用态 opacity`).not.toBe('var(--opacity-disabled)');
      }
      const states = [
        [STATE_SETS.REST, false], [STATE_SETS.HOVER, false], [STATE_SETS.PRESSED, false], [STATE_SETS.REST, true],
      ];
      const changed = new Set();
      for (const family of [...FAMILIES, 'border']) {
        const vals = states.map(([state, disabled]) => {
          const el = mk(`${tag}${sel}`);
          if (disabled) el.setAttribute('disabled', '');
          try {
            const r = cascade(el, family, { state, ...(family === 'border' ? { side: 'top' } : {}) });
            return JSON.stringify(r);
          } catch {
            return 'undecidable';
          }
        });
        if (new Set(vals).size > 1) changed.add(family === 'border' ? 'border-color' : family);
      }
      // 祖先上的状态判不了（.engine-item:hover .engine-delete-btn 改 opacity），这里手工登记
      if (sel === '.engine-delete-btn') changed.add('opacity');
      for (const p of changed) expect(props.map(norm), `${sel} 的 ${p}`).toContain(p);
    }
  });

  it('改写后 style.css 里没有 transition-property: all，规则数不变（34 条 transition 声明）', () => {
    expect(motionDecls.filter((d) => d.prop === 'transition')).toHaveLength(34);
    expect(rulesMentioning('close-btn').length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 减少动效

describe('prefers-reduced-motion', () => {
  const reduced = rules.filter((r) => isReducedMotion(r.media));
  const DURATIONS = ['--motion-duration-fast', '--motion-duration-base', '--motion-duration-slow', '--motion-duration-slower'];

  const rootReduced = reduced.filter((r) => selectorKey(r) === ':root');

  it('存在 @media (prefers-reduced-motion: reduce) 的 :root 块', () => {
    expect(rootReduced.length).toBeGreaterThan(0);
    for (const b of reduced) expect(/reduce/i.test(b.media), b.media).toBe(true);
  });

  it('所有 --motion-duration-* 在该块里为 0ms，且 :root 块里没有别的声明', () => {
    const decls = rootReduced.flatMap((r) => r.decls);
    const got = Object.fromEntries(decls.map((d) => [d.prop, d.value.trim()]));
    for (const name of DURATIONS) expect(got[name], name).toBe('0ms');
    expect(Object.keys(got).sort()).toEqual([...DURATIONS].sort());
  });

  it('时长 token 集合与 :root 里定义的 --motion-duration-* 一致（新增一档不会漏掉）', () => {
    const defined = new Set();
    for (const r of rules) {
      if (r.media === null && ROOT_KEYS.has(selectorKey(r))) {
        for (const d of r.decls) if (d.prop.startsWith('--motion-duration-')) defined.add(d.prop);
      }
    }
    expect([...defined].sort()).toEqual([...DURATIONS].sort());
  });

  it('块在 :root 定义之后（同特异性，靠源码顺序覆盖）', () => {
    const defLines = rules
      .filter((r) => r.media === null && ROOT_KEYS.has(selectorKey(r)) && r.decls.some((d) => d.prop.startsWith('--motion-duration-')))
      .map((r) => r.line);
    expect(defLines.length).toBeGreaterThan(0);
    for (const r of rootReduced) expect(r.line).toBeGreaterThan(Math.max(...defLines));
  });

  it('其余 @media 里没有 --motion-duration-* 的覆写（不会在别的条件下悄悄改时长）', () => {
    const others = rules.filter((r) => r.media !== null && !isReducedMotion(r.media));
    for (const r of others) for (const d of r.decls) expect(d.prop).not.toMatch(/^--motion-duration-/);
  });

  it('减少动效下 .move-to-main-hint 的 animation 为 none（提示照常显示，只是不再闪烁），且写在基础规则之后', () => {
    const hint = reduced.filter((r) => selectorKey(r) === '.move-to-main-hint');
    expect(hint).toHaveLength(1);
    expect(hint[0].decls.map((d) => [d.prop, d.value.trim()])).toEqual([['animation', 'none']]);
    const base = rules.find((r) => r.media === null && selectorKey(r) === '.move-to-main-hint');
    expect(base.decls.some((d) => d.prop === 'animation' && d.value.trim() === 'pulse 2s ease-in-out infinite')).toBe(true);
    expect(hint[0].line).toBeGreaterThan(base.line);
    // 提示本身不隐藏：覆写里没有 display / opacity / visibility
    expect(hint[0].decls.some((d) => /^(display|opacity|visibility)$/.test(d.prop))).toBe(false);
  });
});
