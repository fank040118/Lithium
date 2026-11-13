// 静态层叠判定。回答一个问题：在给定的一组元素状态下，样式表里哪一条声明最终胜出。
// 依据只有选择器匹配、特异性、!important、源码顺序。
//
// 判定不了的一律抛 CascadeUndecidable，不返回值，并登记进需要在浏览器里目检的选择器清单（见 cssRules.unsupportedSelectors）：
//   - 参与竞争的候选里有 unsupported 的选择器（:has()、:focus-within、:not/:is/:where 里的状态、el.matches 抛错）；
//   - 胜出值依赖 inherit / unset / revert；
//   - 简写拆分后有两段以上无法归类（例如整个值只有一个 var()）；var() 按变量名前缀归类：
//     --border-width-* / --space-* / --size-* 归 width，--color-* 归 color，其余前缀分不清；
//   - border 不指定 side 且四边结果不同。
// 它不负责：继承、currentColor、var() 的实际取值、:has()、@supports、除 prefers-reduced-motion 以外的 @media、
// JS 写的行内样式、浏览器默认样式、视觉上是否可见。
//
// 用法：createCascade(cssText) 返回 { cascade, rulesMentioning, rules }；模块级的 cascade / rulesMentioning
// 绑定到仓库的 style.css（首次调用时读取），给组件测试用。

import {
  parseCss, readStyleCss, specificity, splitTopLevel,
} from './cssRules.js';

export class CascadeUndecidable extends Error {
  constructor(selector, reason) {
    super(`无法静态判定：${selector}（${reason}）`);
    this.name = 'CascadeUndecidable';
    this.selector = selector;
    this.reason = reason;
  }
}

// 预设状态集：按浏览器的真实蕴含关系写出，且不可修改。cascade 只认这几个对象本身（按引用）。
class StateSet extends Set {
  constructor(items) {
    super();
    for (const x of items) Set.prototype.add.call(this, x);
  }
  add() { throw new TypeError('STATE_SETS 是只读预设'); }
  delete() { throw new TypeError('STATE_SETS 是只读预设'); }
  clear() { throw new TypeError('STATE_SETS 是只读预设'); }
}

export const STATE_SETS = Object.freeze({
  REST: new StateSet([]),
  HOVER: new StateSet(['hover']),
  PRESSED: new StateSet(['hover', 'active']),
  FOCUS_KB: new StateSet(['focus', 'focus-visible']),
  FOCUS_KB_HOVER: new StateSet(['hover', 'focus', 'focus-visible']),
  PRESSED_FOCUS: new StateSet(['hover', 'active', 'focus']),
});
const STATE_VALUES = new Set(Object.values(STATE_SETS));

const SIDES = ['top', 'right', 'bottom', 'left'];
const CSS_WIDE = /^(inherit|unset|revert|revert-layer)$/i;
const BORDER_PROP = /^border(?:-(top|right|bottom|left))?(?:-(width|style|color))?$/;
const OUTLINE_PROP = /^outline(?:-(width|style|color|offset))?$/;
const BORDER_STYLES = new Set(['none', 'hidden', 'dotted', 'dashed', 'solid', 'double', 'groove', 'ridge', 'inset', 'outset']);
const OUTLINE_STYLES = new Set([...BORDER_STYLES, 'auto']);
const WIDTH_TOKEN = /^(?:[+-]?(?:\d+\.?\d*|\.\d+)[a-z%]*|thin|medium|thick|calc\(.*)$/i;
// 简写里的 var() 按变量名前缀归类：尺寸类 token 归 width，--color-* 归 color；其余前缀分不清。
const VAR_WIDTH = /^var\(\s*--(?:border-width|space|size)-/i;
const VAR_COLOR = /^var\(\s*--color-/i;

// ---------------------------------------------------------------------------
// 简写拆分

// 按空白拆成 width / style / color，没写到的分量记为 'initial'。
function splitShorthand(value, styleKeywords, selector) {
  const tokens = splitTopLevel(value, ' ');
  if (tokens.length === 0) throw new CascadeUndecidable(selector, '简写值为空');
  if (tokens.length === 1 && CSS_WIDE.test(tokens[0])) {
    return { width: tokens[0], style: tokens[0], color: tokens[0] };
  }
  let width = null;
  let widthFromVar = false;
  let style = null;
  let color = null;
  const rest = [];
  for (const t of tokens) {
    if (styleKeywords.has(t.toLowerCase()) && style === null) style = t;
    else if (VAR_WIDTH.test(t)) {
      if (width !== null) throw new CascadeUndecidable(selector, `简写「${value}」里有两个宽度分量`);
      width = t;
      widthFromVar = true;
    } else if (VAR_COLOR.test(t)) {
      if (color !== null) throw new CascadeUndecidable(selector, `简写「${value}」里有两个颜色分量`);
      color = t;
    } else if (WIDTH_TOKEN.test(t)) {
      if (width !== null) throw new CascadeUndecidable(selector, `简写「${value}」里有两个宽度分量`);
      width = t;
    } else rest.push(t);
  }
  // 只有能按前缀明确归类的 var() 才归类：宽度由 var() 给出时，剩下的未知 var() 不能默认当成颜色。
  // 字面宽度 + 单个未知 var() 是旧写法（1px solid var(--x)），靠排除法归为颜色，不受影响。
  if (widthFromVar && rest.some((t) => /^var\(/i.test(t))) {
    throw new CascadeUndecidable(selector, `简写「${value}」里有无法按前缀归类的 var()`);
  }
  if (rest.length > 1) {
    throw new CascadeUndecidable(selector, `简写「${value}」有 ${rest.length} 段无法归类`);
  }
  if (rest.length === 1 && tokens.length === 1 && /^var\(/i.test(rest[0])) {
    throw new CascadeUndecidable(selector, `简写「${value}」整个值只有一个 var()，分不清它代表哪个分量`);
  }
  if (color !== null && rest.length > 0) {
    throw new CascadeUndecidable(selector, `简写「${value}」有 ${rest.length} 段无法归类`);
  }
  return { width: width ?? 'initial', style: style ?? 'initial', color: color ?? rest[0] ?? 'initial' };
}

// 1~4 个值按 CSS 的四边规则展开成 top/right/bottom/left。
function expandSides(value, selector) {
  const v = splitTopLevel(value, ' ');
  if (v.length < 1 || v.length > 4) throw new CascadeUndecidable(selector, `四边写法「${value}」值的个数不对`);
  const [t, r = t, b = t, l = r] = v;
  return { top: t, right: r, bottom: b, left: l };
}

// ---------------------------------------------------------------------------

// 数值为 0 的长度（0、0px、0.0em）；var()、calc() 无法判定，按非 0 处理。
const isZero = (w) => /^[+-]?[\d.]/.test(w.trim()) && parseFloat(w) === 0;

function wins(a, b) {
  if (a.important !== b.important) return a.important;
  const c = a.spec[0] - b.spec[0] || a.spec[1] - b.spec[1] || a.spec[2] - b.spec[2];
  return c !== 0 ? c > 0 : a.order > b.order;
}

function pickWinners(atoms) {
  const best = new Map();
  for (const a of atoms) {
    const cur = best.get(a.key);
    if (!cur || wins(a, cur)) best.set(a.key, a);
  }
  return best;
}

function ensureDecided(atom) {
  if (atom && CSS_WIDE.test(atom.value)) {
    throw new CascadeUndecidable(atom.selector, `胜出值为 ${atom.value}，依赖继承或浏览器默认`);
  }
  return atom?.value;
}

export function createCascade(cssOrRules) {
  const rules = typeof cssOrRules === 'string' ? parseCss(cssOrRules) : cssOrRules;

  function relevantProp(family) {
    switch (family) {
      case 'background': return (p) => p === 'background' || p === 'background-color';
      case 'font-size': return (p) => p === 'font' || p === 'font-size';
      case 'border': return (p) => BORDER_PROP.test(p);
      case 'outline': return (p) => OUTLINE_PROP.test(p);
      default: return (p) => p === family;
    }
  }

  // 收集候选声明：{ decl, selector, spec, important, order }。遇到可能参与竞争的 unsupported 选择器就抛错。
  function collect(el, family, state, pseudoEl) {
    const relevant = relevantProp(family);
    const out = [];
    let order = 0;
    for (const rule of rules) {
      for (const decl of rule.decls) {
        order += 1;
        if (rule.media !== null || !relevant(decl.prop)) continue;
        for (const sel of rule.selectors) {
          if (sel.pseudoEl !== pseudoEl) continue;
          // :focus-within 不在任何预设里，对它的 unsupported 选择器不用状态过滤，一律当作可能参与
          // 祖先、兄弟上的状态不由元素自身的状态蕴含，所以只用主体上的状态过滤
          const needed = sel.unsupported ? [...sel.subjectStates].filter((s) => s !== 'focus-within') : [...sel.states];
          if (!needed.every((s) => state.has(s))) continue;
          let matched;
          try {
            matched = el.matches(sel.base || '*');
          } catch {
            throw new CascadeUndecidable(sel.text, 'el.matches 抛错');
          }
          if (!matched) continue;
          if (sel.unsupported) throw new CascadeUndecidable(sel.text, `选择器无法静态判定（${sel.reason}）`);
          out.push({
            decl, selector: sel.text, spec: specificity(sel), important: decl.important, order,
          });
        }
      }
    }
    return out;
  }

  function simpleFamily(cands) {
    let best = null;
    for (const c of cands) if (!best || wins(c, best)) best = c;
    if (!best) return null;
    return ensureDecided({ value: best.decl.value, selector: best.selector });
  }

  function borderAtoms(cands) {
    const atoms = [];
    for (const c of cands) {
      const { prop, value } = c.decl;
      const [, side, comp] = BORDER_PROP.exec(prop);
      const base = { spec: c.spec, important: c.important, order: c.order, selector: c.selector };
      const push = (s, k, v) => atoms.push({ ...base, key: `${s}:${k}`, value: v });
      if (comp) {
        const perSide = side ? { [side]: value } : expandSides(value, c.selector);
        for (const [s, v] of Object.entries(perSide)) push(s, comp, v);
      } else {
        const parts = splitShorthand(value, BORDER_STYLES, c.selector);
        for (const s of side ? [side] : SIDES) {
          for (const k of ['width', 'style', 'color']) push(s, k, parts[k]);
        }
      }
    }
    return atoms;
  }

  function borderFamily(cands, side) {
    const atoms = borderAtoms(cands);
    const winners = pickWinners(atoms);
    const resultFor = (s) => {
      if (!atoms.some((a) => a.key.startsWith(`${s}:`))) return null;
      const get = (k) => ensureDecided(winners.get(`${s}:${k}`));
      const width = get('width');
      const style = get('style');
      const color = get('color');
      // border-style 的初始值是 none：没有声明过 style 就没有边框
      if (!style || /^(none|initial)$/i.test(style) || (width !== undefined && isZero(width))) return { kind: 'none' };
      return { kind: 'set', width: width ?? 'initial', style, color: color ?? 'initial' };
    };
    if (side) return resultFor(side);
    const results = SIDES.map(resultFor);
    const first = JSON.stringify(results[0]);
    if (results.some((r) => JSON.stringify(r) !== first)) {
      throw new CascadeUndecidable('(border)', '四边结果不同，请用 side 选项指定边');
    }
    return results[0];
  }

  function outlineFamily(cands) {
    const atoms = [];
    for (const c of cands) {
      const { prop, value } = c.decl;
      const [, comp] = OUTLINE_PROP.exec(prop);
      const base = { spec: c.spec, important: c.important, order: c.order, selector: c.selector };
      if (comp) {
        atoms.push({ ...base, key: comp, value });
      } else {
        const parts = splitShorthand(value, OUTLINE_STYLES, c.selector);
        for (const k of ['width', 'style', 'color']) atoms.push({ ...base, key: k, value: parts[k] });
      }
    }
    if (atoms.length === 0) return null;
    const winners = pickWinners(atoms);
    const get = (k) => ensureDecided(winners.get(k)) ?? 'initial';
    return { color: get('color'), width: get('width'), style: get('style'), offset: get('offset') };
  }

  function cascade(el, family, { state = STATE_SETS.REST, pseudoEl = null, side = null } = {}) {
    if (!STATE_VALUES.has(state)) {
      throw new TypeError('state 只能使用 STATE_SETS 里的预设（REST / HOVER / PRESSED / FOCUS_KB / FOCUS_KB_HOVER / PRESSED_FOCUS）');
    }
    if (side !== null && (family !== 'border' || !SIDES.includes(side))) {
      throw new TypeError('side 只对 border 族有效，取值 top / right / bottom / left');
    }
    const pe = pseudoEl === null ? null : normalizePseudoEl(pseudoEl);
    const cands = collect(el, family, state, pe);
    if (family === 'border') return cands.length ? borderFamily(cands, side) : null;
    if (family === 'outline') return outlineFamily(cands);
    return simpleFamily(cands);
  }

  // 选择器文本里含该 class 的所有规则，含 @media 里的。
  function rulesMentioning(className) {
    const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\.${escaped}(?![\\w-])`);
    return rules.filter((r) => r.selectors.some((s) => re.test(s.text)));
  }

  return { cascade, rulesMentioning, rules };
}

function normalizePseudoEl(pe) {
  const s = pe.trim().toLowerCase();
  return s.startsWith('::') ? s : `::${s.replace(/^:/, '')}`;
}

// 绑定到仓库 style.css 的默认实例（首次使用时才读文件）。
let defaultInstance = null;
const dflt = () => (defaultInstance ??= createCascade(readStyleCss()));
export const cascade = (...args) => dflt().cascade(...args);
export const rulesMentioning = (name) => dflt().rulesMentioning(name);
