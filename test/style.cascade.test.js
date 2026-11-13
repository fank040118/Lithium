// CSS 解析器与静态层叠判定（Task 27）。全部用内联 CSS 夹具，不读 style.css（唯一例外：
// 最后一条把 style.css 的 unsupported 选择器与 b6-unverified.json 做只读比对）。
// 每条用例对应一种「测不出来」的失败模式。
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach } from 'vitest';
import { parseCss, scanCss, specificity, unsupportedSelectors, readStyleCss } from './helpers/cssRules.js';
import {
  STATE_SETS, CascadeUndecidable, createCascade,
} from './helpers/cssCascade.js';

const { REST, HOVER, PRESSED, FOCUS_KB, FOCUS_KB_HOVER, PRESSED_FOCUS } = STATE_SETS;
const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/b6-unverified.json');

function mount(html) {
  document.body.innerHTML = html;
  return document.body.firstElementChild;
}

describe('parseCss', () => {
  it('去掉注释且保留行号；声明带 important 与行号', () => {
    const rules = parseCss('/* a\n b */\n.x { color: red; /* c */\n  background: blue !important; }');
    expect(rules).toHaveLength(1);
    expect(rules[0].line).toBe(3);
    expect(rules[0].media).toBeNull();
    expect(rules[0].decls).toEqual([
      { prop: 'color', value: 'red', important: false, line: 3 },
      { prop: 'background', value: 'blue', important: true, line: 4 },
    ]);
  });

  it('选择器列表拆成多个 Sel；括号与引号里的逗号不拆', () => {
    const [r] = parseCss('.a, .b:not(.c, .d), [data-x="1,2"] { color: red }');
    expect(r.selectors.map((s) => s.text)).toEqual(['.a', '.b:not(.c, .d)', '[data-x="1,2"]']);
  });

  it('一层 @media 记入 media；@keyframes 内部整体跳过', () => {
    const rules = parseCss(`
      @keyframes pulse { 0% { opacity: 0 } 100% { opacity: 1 } }
      @media (prefers-reduced-motion: reduce) { .a { transition: none } }
      .b { color: red }`);
    expect(rules.map((r) => [r.selectors[0].text, r.media])).toEqual([
      ['.a', '(prefers-reduced-motion: reduce)'],
      ['.b', null],
    ]);
  });

  it('url() 与字符串里的分号不切断声明', () => {
    const [r] = parseCss('.a { background: url("data:image/svg+xml;utf8,<svg/>"); content: "a;b"; color: red }');
    expect(r.decls.map((d) => d.prop)).toEqual(['background', 'content', 'color']);
  });

  it('状态伪类从任何位置取出：伪元素之后、伪元素之前、祖先复合选择器里', () => {
    const [a, b, c] = parseCss(`
      .s::-webkit-slider-thumb:hover {}
      .i:hover::placeholder {}
      .p:hover .c:active {}`).map((r) => r.selectors[0]);
    expect(a.base).toBe('.s');
    expect(a.pseudoEl).toBe('::-webkit-slider-thumb');
    expect([...a.states]).toEqual(['hover']);
    expect(b.base).toBe('.i');
    expect(b.pseudoEl).toBe('::placeholder');
    expect([...b.states]).toEqual(['hover']);
    expect(c.base).toBe('.p .c');
    expect([...c.states].sort()).toEqual(['active', 'hover']);
  });

  it('状态伪类写在非主体复合选择器（祖先、兄弟）里时标为 unsupported，主体上的不受影响', () => {
    const s = (css) => parseCss(css)[0].selectors[0];
    for (const css of ['.a:focus .b {}', '.a:hover > .b {}', '.a:hover + .b {}', '.a:focus-visible ~ .b {}', '.a:active .b:hover {}']) {
      const sel = s(css);
      expect(sel.unsupported, css).toBe(true);
      expect(sel.reason, css).toBe('state-in-ancestor');
    }
    expect([...s('.a:active .b:hover {}').subjectStates]).toEqual(['hover']);
    expect(s('.a .b:hover {}').unsupported).toBe(false);
    expect(s('.a:not(.c .d) .b:hover {}').unsupported).toBe(false);
    expect(s('.a .b:hover::before {}').unsupported).toBe(false);
  });

  it('取出状态后复合选择器为空时补 *，旧式单冒号伪元素归一为双冒号', () => {
    const [a, b] = parseCss('.a :hover {} .b:after {}').map((r) => r.selectors[0]);
    expect(a.base).toBe('.a *');
    expect(b.pseudoEl).toBe('::after');
    expect(b.base).toBe('.b');
  });

  it('unsupported：:has()、:focus-within、:not/:is/:where 参数里的状态、白名单以外的伪类', () => {
    const s = (css) => parseCss(css)[0].selectors[0];
    expect(s('.f:has(> .g) {}').unsupported).toBe(true);
    expect(s('.f:focus-within {}').unsupported).toBe(true);
    expect(s('.x:focus:not(:focus-visible) {}').unsupported).toBe(true);
    expect(s('.x:is(:hover, .y) {}').unsupported).toBe(true);
    expect(s('.x:where(:active) {}').unsupported).toBe(true);
    expect(s('.x:made-up-pseudo {}').unsupported).toBe(true);
    expect(s('input:-webkit-autofill {}').unsupported).toBe(true);
    expect(s('.x:not(:-webkit-autofill) {}').unsupported).toBe(true);
    expect(s('.x:not(.y):first-child:nth-child(2n+1) {}').unsupported).toBe(false);
    expect(s('.x:not(:disabled):hover {}').unsupported).toBe(false);
    expect(s('.x:hover::before {}').unsupported).toBe(false);
  });
});

describe('scanCss（给 lint 用的口径）', () => {
  it('与 parseCss 的区别只在 @keyframes 与声明型 at-rule 内部：scanCss 读进来，parseCss 跳过', () => {
    const css = `
      @keyframes k { from { background: #fff } 50% { color: rgba(0,0,0,1) } }
      @font-face { font-family: x; src: url(a.woff) }
      .a { color: red }`;
    expect(parseCss(css).map((r) => r.selectors[0].text)).toEqual(['.a']);
    const scanned = scanCss(css);
    expect(scanned.map((r) => [r.selectors[0].text, r.media])).toEqual([
      ['from', '@keyframes k'], ['50%', '@keyframes k'], ['@font-face', '@font-face'], ['.a', null],
    ]);
    expect(scanned[0].decls[0]).toMatchObject({ prop: 'background', value: '#fff' });
  });
});

describe('specificity', () => {
  it.each([
    ['*', [0, 0, 0]],
    ['#a.b:hover > c::before', [1, 2, 2]],
    ['.x:focus:not(:focus-visible)', [0, 3, 0]],
    [':not(.a, #b)', [1, 0, 0]],
    [':is(.a, .b#c)', [1, 1, 0]],
    [':where(.a, #b)', [0, 0, 0]],
    ['[data-x="1"] .y', [0, 2, 0]],
    ['.a::-webkit-slider-thumb:hover', [0, 2, 1]],
    [':root', [0, 1, 0]],
  ])('%s', (sel, expected) => {
    expect(specificity({ text: sel })).toEqual(expected);
    expect(specificity(sel)).toEqual(expected);
  });
});

describe('STATE_SETS', () => {
  it('预设与 brief 一致', () => {
    const names = (s) => [...s].sort();
    expect(names(REST)).toEqual([]);
    expect(names(HOVER)).toEqual(['hover']);
    expect(names(PRESSED)).toEqual(['active', 'hover']);
    expect(names(FOCUS_KB)).toEqual(['focus', 'focus-visible']);
    expect(names(FOCUS_KB_HOVER)).toEqual(['focus', 'focus-visible', 'hover']);
    expect(names(PRESSED_FOCUS)).toEqual(['active', 'focus', 'hover']);
  });
  it('预设不可被修改', () => {
    expect(() => HOVER.add('active')).toThrow();
    expect(() => REST.add('hover')).toThrow();
  });
});

describe('cascade：状态与层叠顺序', () => {
  let el;
  beforeEach(() => { el = mount('<div class="b"></div>'); });

  it('后写的旧规则胜出：:hover 规则排在 :active 之后时，PRESSED 取到悬停值', () => {
    const { cascade } = createCascade('.b{background:O} .b:active{background:A} .b:hover{background:H}');
    expect(cascade(el, 'background', { state: PRESSED })).toBe('H');
    expect(cascade(el, 'background', { state: HOVER })).toBe('H');
    expect(cascade(el, 'background')).toBe('O');
  });

  it('PRESSED 下 :active 写在 :hover 之后时取到按下值', () => {
    const { cascade } = createCascade('.b:hover{background:H} .b:active{background:A}');
    expect(cascade(el, 'background', { state: PRESSED })).toBe('A');
    expect(cascade(el, 'background', { state: HOVER })).toBe('H');
  });

  it('FOCUS_KB 同时匹配 :focus 与 :focus-visible，后写者胜出', () => {
    const a = createCascade('.b:focus{background:F} .b:focus-visible{background:V}').cascade;
    expect(a(el, 'background', { state: FOCUS_KB })).toBe('V');
    const b = createCascade('.b:focus-visible{background:V} .b:focus{background:F}').cascade;
    expect(b(el, 'background', { state: FOCUS_KB })).toBe('F');
    expect(b(el, 'background', { state: HOVER })).toBeNull();
  });

  it('组合预设：FOCUS_KB_HOVER 与 PRESSED_FOCUS', () => {
    const { cascade } = createCascade('.b:hover{background:H} .b:focus{background:F} .b:active{background:A}');
    expect(cascade(el, 'background', { state: FOCUS_KB_HOVER })).toBe('F');
    expect(cascade(el, 'background', { state: PRESSED_FOCUS })).toBe('A');
  });

  it('不允许传单个状态：传 ["active"] 或自建 Set 时抛错', () => {
    const { cascade } = createCascade('.b:active{background:A}');
    expect(() => cascade(el, 'background', { state: ['active'] })).toThrow();
    expect(() => cascade(el, 'background', { state: new Set(['active']) })).toThrow();
    expect(() => cascade(el, 'background', { state: 'active' })).toThrow();
  });

  it('更具体的选择器胜过后出现的规则；!important 胜过特异性', () => {
    const el2 = mount('<div class="b c"></div>');
    const a = createCascade('.b.c{background:S} .b{background:L}').cascade;
    expect(a(el2, 'background')).toBe('S');
    const b = createCascade('.b.c{background:S} .b{background:L !important}').cascade;
    expect(b(el2, 'background')).toBe('L');
    const c = createCascade('.b{background:X !important} .b.c{background:S !important}').cascade;
    expect(c(el2, 'background')).toBe('S');
  });

  it('后代选择器要求真实父级；不匹配的元素取不到', () => {
    const { cascade } = createCascade('.p .c{background:D}');
    const child = mount('<div class="p"><span class="c"></span></div>').firstElementChild;
    expect(cascade(child, 'background')).toBe('D');
    expect(cascade(mount('<span class="c"></span>'), 'background')).toBeNull();
  });

  it('@media 里的规则不参与；没有候选返回 null', () => {
    const { cascade } = createCascade('@media (prefers-reduced-motion: reduce){.b{background:M}} .b{color:red}');
    expect(cascade(el, 'background')).toBeNull();
    expect(cascade(el, 'color')).toBe('red');
  });

  it('background-color 能覆盖更早的 background 简写；反之亦然', () => {
    const a = createCascade('.b{background:var(--old)} .b{background-color:var(--new)}').cascade;
    expect(a(el, 'background')).toBe('var(--new)');
    const b = createCascade('.b{background-color:var(--new)} .b{background:var(--old)}').cascade;
    expect(b(el, 'background')).toBe('var(--old)');
  });

  it('font-size 族：font 简写原样返回，与 font-size 按层叠竞争', () => {
    const a = createCascade('.b{font-size:14px} .b{font:var(--type-body)}').cascade;
    expect(a(el, 'font-size')).toBe('var(--type-body)');
    const b = createCascade('.b{font:inherit} .b{font-size:14px}').cascade;
    expect(b(el, 'font-size')).toBe('14px');
  });

  it('胜出值依赖 inherit / unset / revert 时抛 CascadeUndecidable', () => {
    for (const v of ['inherit', 'unset', 'revert', 'INHERIT']) {
      const { cascade } = createCascade(`.b{color:red} .b{color:${v}}`);
      expect(() => cascade(el, 'color')).toThrow(CascadeUndecidable);
    }
    const ok = createCascade('.b{color:inherit} .b{color:red}').cascade;
    expect(ok(el, 'color')).toBe('red');
  });
});

describe('cascade：border 族', () => {
  let el;
  beforeEach(() => { el = mount('<div class="b"></div>'); });
  const b = (css, opts) => createCascade(css).cascade(el, 'border', opts);

  it('border: none、border: 0、border-style: none 都归一为 kind none；没有声明时为 null', () => {
    expect(b('.b{border:none}')).toEqual({ kind: 'none' });
    expect(b('.b{border:0}')).toEqual({ kind: 'none' });
    expect(b('.b{border:1px solid red} .b{border-style:none}')).toEqual({ kind: 'none' });
    expect(b('.b{border:1px solid red} .b{border-width:0}')).toEqual({ kind: 'none' });
    expect(b('.b{color:red}')).toBeNull();
  });

  it('border: 1px solid red 四边相同，直接返回 set', () => {
    expect(b('.b{border:1px solid red}')).toEqual({ kind: 'set', width: '1px', style: 'solid', color: 'red' });
    expect(b('.b{border:red 2px dashed}')).toEqual({ kind: 'set', width: '2px', style: 'dashed', color: 'red' });
  });

  it('border-right: 1px solid var(--x) 拆成 width / style / color；括号内的空白不拆', () => {
    expect(b('.b{border-right:1px solid var(--x)}', { side: 'right' }))
      .toEqual({ kind: 'set', width: '1px', style: 'solid', color: 'var(--x)' });
    expect(b('.b{border-right:1px solid rgba(0, 0, 0, 0.5)}', { side: 'right' }).color).toBe('rgba(0, 0, 0, 0.5)');
    expect(b('.b{border-right:1px solid red}', { side: 'left' })).toBeNull();
  });

  it('整个值只有一个 var() 时抛 CascadeUndecidable，错误带选择器；两段以上无法归类也抛', () => {
    let err;
    try { b('.b{border:var(--x)}'); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(CascadeUndecidable);
    expect(err.selector).toBe('.b');
    expect(err.reason).toBeTruthy();
    expect(() => b('.b{border:1px solid var(--x) var(--y)}')).toThrow(CascadeUndecidable);
  });

  it('简写里出现两个 var() 时按变量名前缀归类：--border-width-* / --space-* / --size-* 归 width，--color-* 归 color', () => {
    expect(b('.b{border:var(--border-width-thin) solid var(--color-border-subtle)}'))
      .toEqual({ kind: 'set', width: 'var(--border-width-thin)', style: 'solid', color: 'var(--color-border-subtle)' });
    // 顺序无关
    expect(b('.b{border:var(--color-border-subtle) dashed var(--border-width-thick)}'))
      .toEqual({ kind: 'set', width: 'var(--border-width-thick)', style: 'dashed', color: 'var(--color-border-subtle)' });
    expect(b('.b{border-right:var(--space-1) solid var(--color-divider)}', { side: 'right' }))
      .toEqual({ kind: 'set', width: 'var(--space-1)', style: 'solid', color: 'var(--color-divider)' });
    expect(b('.b{border:var(--size-range-track) solid var(--color-x)}').width).toBe('var(--size-range-track)');
    // 宽度用字面值、颜色用 var() 的老写法不受影响
    expect(b('.b{border:1px solid var(--color-x)}').color).toBe('var(--color-x)');
  });

  it('前缀归类之外：未知前缀的两个 var()、同一分量出现两个 var() 仍抛 CascadeUndecidable', () => {
    expect(() => b('.b{border:1px solid var(--x) var(--y)}')).toThrow(CascadeUndecidable);
    expect(() => b('.b{border:var(--border-width-thin) var(--border-width-thick) solid}')).toThrow(CascadeUndecidable);
    expect(() => b('.b{border:solid var(--color-a) var(--color-b)}')).toThrow(CascadeUndecidable);
  });

  it('只有能按前缀明确归类的 var() 才归类：已知宽度 / 颜色旁边出现未知前缀的 var() 一律抛错，不默认当颜色', () => {
    // 已知宽度 + 未知 var()：旧实现把 --radius-sm 当成颜色返回
    expect(() => b('.b{border:var(--border-width-thin) solid var(--radius-sm)}')).toThrow(CascadeUndecidable);
    expect(() => b('.b{border:var(--space-1) solid var(--x)}')).toThrow(CascadeUndecidable);
    // 已知颜色 + 未知 var()
    expect(() => b('.b{border:var(--x) solid var(--color-a)}')).toThrow(CascadeUndecidable);
    expect(() => b('.b{border:solid var(--color-a) var(--shadow-card)}')).toThrow(CascadeUndecidable);
    // 同一分量同时出现字面值和 var()：旧实现把字面宽度落进 rest 当成颜色
    expect(() => b('.b{border:var(--border-width-thin) 1px solid}')).toThrow(CascadeUndecidable);
    expect(() => b('.b{border:1px var(--border-width-thin) solid}')).toThrow(CascadeUndecidable);
    // 旧写法不受影响：字面宽度 + 单个未知 var() 靠排除法归为颜色
    expect(b('.b{border:1px solid var(--x)}').color).toBe('var(--x)');
  });

  it('长写同样可以用 var()：border-width / border-style / border-color 分量各自取胜', () => {
    const css = '.b{border-width:var(--border-width-thin)} .b{border-style:solid} .b{border-color:var(--color-border-subtle)}'
      + ' .b:hover{border-color:var(--color-border-strong)}';
    expect(b(css)).toEqual({ kind: 'set', width: 'var(--border-width-thin)', style: 'solid', color: 'var(--color-border-subtle)' });
    expect(b(css, { state: HOVER }).color).toBe('var(--color-border-strong)');
  });

  it('简写（两个 var）后接长写 border-color：长写按分量覆盖颜色，宽度保持', () => {
    const css = '.b{border:var(--border-width-thin) solid var(--color-a)} .b:hover{border-color:var(--color-b)}';
    expect(b(css, { state: HOVER })).toEqual({ kind: 'set', width: 'var(--border-width-thin)', style: 'solid', color: 'var(--color-b)' });
  });

  it('先写 border: none、后写 border-right: 1px solid … 时，右边为 set、其他边为 none', () => {
    const css = '.b{border:none} .b{border-right:1px solid var(--x)}';
    expect(b(css, { side: 'right' })).toEqual({ kind: 'set', width: '1px', style: 'solid', color: 'var(--x)' });
    expect(b(css, { side: 'left' })).toEqual({ kind: 'none' });
    expect(b(css, { side: 'top' })).toEqual({ kind: 'none' });
    expect(() => b(css)).toThrow(CascadeUndecidable);   // 四边不同，必须指定 side
  });

  it('长写按分量各自取胜：border-color 只改颜色，border-width 多值按四边展开', () => {
    const css = '.b{border:1px solid red} .b:hover{border-color:blue} .b{border-width:1px 0 2px 0}';
    expect(b(css, { state: HOVER, side: 'top' })).toEqual({ kind: 'set', width: '1px', style: 'solid', color: 'blue' });
    expect(b(css, { state: HOVER, side: 'right' })).toEqual({ kind: 'none' });
    expect(b(css, { side: 'bottom' }).width).toBe('2px');
  });

  it('更具体的 border-bottom 简写胜过靠后的 border 简写（特异性优先）', () => {
    const css = '.b.c{border-bottom:2px solid X} .b{border:1px solid Y}';
    const el2 = mount('<div class="b c"></div>');
    const r = createCascade(css).cascade(el2, 'border', { side: 'bottom' });
    expect(r).toEqual({ kind: 'set', width: '2px', style: 'solid', color: 'X' });
  });
});

describe('cascade：outline 族', () => {
  let el;
  beforeEach(() => { el = mount('<div class="b"></div>'); });
  const o = (css, opts) => createCascade(css).cascade(el, 'outline', opts);

  it('outline 简写与 outline-color、outline-offset 长写按分量各自取胜；没写到的分量为 initial', () => {
    const css = '.b{outline:2px solid var(--a)} .b:focus{outline-color:var(--c)} .b:focus{outline-offset:2px}';
    expect(o(css)).toEqual({ color: 'var(--a)', width: '2px', style: 'solid', offset: 'initial' });
    expect(o(css, { state: FOCUS_KB })).toEqual({ color: 'var(--c)', width: '2px', style: 'solid', offset: '2px' });
  });

  it('outline 简写里的两个 var() 同样按前缀归类', () => {
    expect(o('.b{outline:var(--border-width-thick) solid var(--color-focus-ring)}'))
      .toEqual({ color: 'var(--color-focus-ring)', width: 'var(--border-width-thick)', style: 'solid', offset: 'initial' });
    expect(() => o('.b{outline:solid var(--x) var(--y)}')).toThrow(CascadeUndecidable);
  });

  it('outline: none 只给 style，其余为 initial；没有任何候选时为 null', () => {
    expect(o('.b{outline:none}')).toEqual({ color: 'initial', width: 'initial', style: 'none', offset: 'initial' });
    expect(o('.b{color:red}')).toBeNull();
  });

  it('同特异性下后写的简写覆盖先写的长写；更具体的长写胜过后写的简写', () => {
    expect(o('.b{outline-color:C} .b{outline:2px solid X}').color).toBe('X');
    expect(o('.b:focus{outline-color:C} .b{outline:2px solid X}', { state: FOCUS_KB }).color).toBe('C');
  });

  it('outline 简写里的 offset 不被简写重置', () => {
    expect(o('.b{outline-offset:3px} .b{outline:1px solid X}').offset).toBe('3px');
  });
});

describe('cascade：伪元素与 unsupported', () => {
  it('伪元素后接状态：::-webkit-slider-thumb:hover 在 HOVER + pseudoEl 下匹配', () => {
    const el = mount('<input class="s">');
    const { cascade } = createCascade('.s::-webkit-slider-thumb:hover{background:T} .s{background:B}');
    const pe = '::-webkit-slider-thumb';
    expect(cascade(el, 'background', { state: HOVER, pseudoEl: pe })).toBe('T');
    expect(cascade(el, 'background', { state: REST, pseudoEl: pe })).toBeNull();
    expect(cascade(el, 'background', { state: HOVER })).toBe('B');   // 元素自身不受伪元素规则影响
  });

  it('伪元素前接状态：:hover::placeholder 同样匹配', () => {
    const el = mount('<input class="i">');
    const { cascade } = createCascade('.i:hover::placeholder{color:P}');
    expect(cascade(el, 'color', { state: HOVER, pseudoEl: '::placeholder' })).toBe('P');
    expect(cascade(el, 'color', { state: REST, pseudoEl: '::placeholder' })).toBeNull();
  });

  it(':has() 选择器参与竞争时抛 CascadeUndecidable，错误里带选择器', () => {
    const el = mount('<div class="f"></div>');
    const { cascade } = createCascade('.f{background:A} .f:has(> .g){background:X}');
    let err;
    try { cascade(el, 'background'); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(CascadeUndecidable);
    expect(err.selector).toContain(':has(');
    expect(() => cascade(el, 'color')).not.toThrow();           // 没有声明目标属性，不参与竞争
    expect(cascade(mount('<div class="z"></div>'), 'background')).toBeNull();   // 元素本身不可能匹配
  });

  it('.x:focus:not(:focus-visible) 标为 unsupported；FOCUS_KB 下参与竞争时抛错，而不是被当成生效', () => {
    const el = mount('<div class="x"></div>');
    const { cascade, rules } = createCascade('.x{outline:none} .x:focus:not(:focus-visible){outline:2px solid red}');
    expect(rules[1].selectors[0].unsupported).toBe(true);
    expect(() => cascade(el, 'outline', { state: FOCUS_KB })).toThrow(CascadeUndecidable);
    expect(() => cascade(el, 'outline', { state: PRESSED_FOCUS })).toThrow(CascadeUndecidable);
    expect(cascade(el, 'outline', { state: HOVER })).toEqual({ color: 'initial', width: 'initial', style: 'none', offset: 'initial' });
  });

  it(':focus-within 规则标为 unsupported，任何状态下参与竞争都抛错', () => {
    const el = mount('<div class="s"></div>');
    const { cascade, rules } = createCascade('.s{background:A} .s:focus-within{background:W}');
    expect(rules[1].selectors[0].unsupported).toBe(true);
    for (const st of Object.values(STATE_SETS)) {
      expect(() => cascade(el, 'background', { state: st })).toThrow(CascadeUndecidable);
    }
  });

  it('未知伪类（jsdom 对它的反应不可靠）判为 unsupported，竞争时抛错', () => {
    const el = mount('<div class="x"></div>');
    const { cascade } = createCascade('.x:made-up-pseudo{background:A}');
    expect(() => cascade(el, 'background')).toThrow(CascadeUndecidable);
  });

  it('状态写在祖先上：.a:focus .b 在 FOCUS_KB 下必须抛错，而不是被当成生效；REST 下同样可能参与，也抛错', () => {
    const el = mount('<div class="a"><div class="b"></div></div>').firstElementChild;
    const { cascade } = createCascade('.b{background:R} .a:focus .b{background:F}');
    expect(() => cascade(el, 'background', { state: FOCUS_KB })).toThrow(CascadeUndecidable);
    expect(() => cascade(el, 'background')).toThrow(CascadeUndecidable);
    expect(() => cascade(el, 'color')).not.toThrow();           // 没声明目标属性，不参与
    expect(() => cascade(mount('<div class="z"></div>'), 'background')).not.toThrow();   // 元素本身不可能匹配
  });

  it('状态写在兄弟上：.a:hover + .b 在 HOVER 下抛错；主体自己的状态仍然参与过滤', () => {
    const el = mount('<div><i class="a"></i><i class="b"></i></div>').lastElementChild;
    const { cascade } = createCascade('.b{background:R} .a:hover + .b{background:H} .a:hover + .b:active{background:A}');
    expect(() => cascade(el, 'background', { state: HOVER })).toThrow(CascadeUndecidable);
    let err;
    try { cascade(el, 'background', { state: PRESSED }); } catch (e) { err = e; }
    expect(err.selector).toBe('.a:hover + .b');
    expect(err.reason).toContain('state-in-ancestor');
  });

  it('逗号分隔的选择器列表逐个判定：unsupported 的那一个不连累其余', () => {
    const el = mount('<div class="a"></div>');
    const { cascade } = createCascade('.a{background:A} .zzz:has(.y), .a:hover{background:H}');
    expect(cascade(el, 'background', { state: HOVER })).toBe('H');
  });

  it('rulesMentioning 返回选择器文本里含该 class 的所有规则，含 @media 里的；不误匹配前缀', () => {
    const { rulesMentioning } = createCascade(`
      .btn{color:red} .btn-primary{color:blue} .x .btn:hover{color:green}
      @media (prefers-reduced-motion: reduce){.btn{transition:none}}`);
    expect(rulesMentioning('btn').map((r) => r.selectors[0].text))
      .toEqual(['.btn', '.x .btn:hover', '.btn']);
    expect(rulesMentioning('btn-primary')).toHaveLength(1);
  });
});

describe('B6-U 清单', () => {
  it('unsupportedSelectors：包含 :has、:focus-within，以及 prefers-reduced-motion 以外的 @media / @supports', () => {
    const list = unsupportedSelectors(parseCss(`
      .a:has(.b){color:red}
      .c:focus-within{color:red}
      @media (max-width: 600px){.d{color:red}}
      @media (prefers-reduced-motion: reduce){.e{color:red}}
      @supports (display: grid){.f{color:red}}
      .g:hover{color:red}`));
    expect(list.map((x) => x.selector)).toEqual([
      '.a:has(.b)', '.c:focus-within', '.d', '.f',
    ]);
    expect(list.every((x) => typeof x.reason === 'string' && x.reason)).toBe(true);
  });

  it('style.css 的 unsupported 选择器清单与 test/fixtures/b6-unverified.json 一致', () => {
    const actual = unsupportedSelectors(parseCss(readStyleCss()));
    const expected = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    const render = (v) => JSON.stringify(v, null, 2);
    // 不一致时先人工确认新增项确属「静态无法判定」，再把下面打印的 JSON 写入 fixtures/b6-unverified.json。
    if (render(actual) !== render(expected)) console.log('期望的 b6-unverified.json：\n' + render(actual));
    expect(actual).toEqual(expected);
  });
});
