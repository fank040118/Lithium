// 测试用的 CSS 解析器（Task 27）。不引入依赖，只覆盖 style.css 实际用到的语法：
// 普通规则、一层 @media（及 @supports 等块级 at-rule，记入 media）、跳过 @keyframes。
// 它服务于层叠判定（cssCascade.js）和 lint（styleLint.js），不是通用 CSS 解析器：
// 遇到不认识的结构（比如 CSS 嵌套）直接抛错，而不是悄悄解析错。
//
// Rule = { selectors: Sel[], decls: Array<{prop, value, important, line}>, media: string | null, line }
// Sel  = { text, base, states: Set<string>, pseudoEl: string | null, unsupported: boolean, reason: string | null }
//   text       选择器原文（已 trim）
//   base       去掉状态伪类和伪元素之后的部分，交给 el.matches()；unsupported 的选择器里，
//              无法判定的部分（:has()、:not() 里的状态等）也被去掉，base 是「可能匹配」的宽松上界
//   states     从任何位置取出的状态伪类：hover / active / focus / focus-visible / focus-within
//   subjectStates  其中写在主体复合选择器（最后一个）上的；写在祖先、兄弟复合选择器上的不由元素自身的状态蕴含，
//              出现时整条选择器 unsupported（reason 'state-in-ancestor'），在 cascade 里对任何状态都可能参与
//   pseudoEl   归一化成双冒号写法，如 '::-webkit-slider-thumb'
//   unsupported/reason  静态无法判定：has、focus-within、state-in-ancestor、state-in-<not|is|where>、unknown-pseudo、match-error

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// jsdom 环境下全局 URL 被替换，fs 不认；用路径字符串，同样不依赖当前工作目录。
const STYLE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../style.css');

export function readStyleCss() {
  return readFileSync(STYLE_PATH, 'utf8');
}

const STATE_NAMES = new Set(['hover', 'active', 'focus', 'focus-visible', 'focus-within']);
const LEGACY_PSEUDO_ELEMENTS = new Set(['before', 'after', 'first-line', 'first-letter']);
const FUNCTIONAL_WRAPPERS = new Set(['not', 'is', 'where', 'matches', '-webkit-any', '-moz-any']);
const STATE_IN_ARG = /:(hover|active|focus-visible|focus-within|focus)(?![\w-])/i;
// 留在 base 里交给 el.matches 的伪类白名单。jsdom 对未知伪类的反应不可靠（取决于前面的部分是否匹配，
// 可能抛错、也可能悄悄返回 false 或 true），所以不在名单里的伪类（含 :-webkit-autofill 这类私有写法）一律判为 unsupported。
const KNOWN_PSEUDO_CLASSES = new Set([
  'root', 'empty', 'first-child', 'last-child', 'only-child', 'first-of-type', 'last-of-type', 'only-of-type',
  'nth-child', 'nth-last-child', 'nth-of-type', 'nth-last-of-type', 'not', 'is', 'where', 'matches',
  'link', 'visited', 'any-link', 'target', 'checked', 'disabled', 'enabled', 'required', 'optional',
  'read-only', 'read-write', 'placeholder-shown', 'indeterminate', 'default', 'valid', 'invalid',
  'in-range', 'out-of-range', 'lang', 'dir', 'scope', 'defined',
]);
// 内部不是普通规则的 at-rule：层叠判定（parseCss）整个跳过，lint 扫描（scanCss）要读进来。
const KEYFRAMES_AT_RULES = new Set(['keyframes', '-webkit-keyframes', '-moz-keyframes']);
const DECL_AT_RULES = new Set(['font-face', 'page', 'property', 'counter-style', 'font-feature-values']);

// ---------------------------------------------------------------------------
// 底层扫描工具

// 去掉注释，换行保留，行号不变。字符串里的 /* 不算注释。
function stripComments(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'") {
      const end = skipString(text, i);
      out += text.slice(i, end);
      i = end;
    } else if (c === '/' && text[i + 1] === '*') {
      let end = text.indexOf('*/', i + 2);
      end = end === -1 ? text.length : end + 2;
      out += text.slice(i, end).replace(/[^\n]/g, ' ');
      i = end;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

// i 指向引号，返回字符串结束后的下标。
function skipString(text, i) {
  const q = text[i];
  let j = i + 1;
  while (j < text.length && text[j] !== q) j += text[j] === '\\' ? 2 : 1;
  return Math.min(j + 1, text.length);
}

// i 指向 open，返回匹配的 close 的下标；找不到返回 -1。字符串和转义跳过。
function matchingClose(text, i, open, close) {
  let depth = 0;
  for (let j = i; j < text.length; j += 1) {
    const c = text[j];
    if (c === '\\') j += 1;
    else if (c === '"' || c === "'") j = skipString(text, j) - 1;
    else if (c === open) depth += 1;
    else if (c === close) {
      depth -= 1;
      if (depth === 0) return j;
    }
  }
  return -1;
}

// 在括号、方括号、字符串之外按 sep 拆分。
export function splitTopLevel(text, sep) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '\\') i += 1;
    else if (c === '"' || c === "'") i = skipString(text, i) - 1;
    else if (c === '(' || c === '[') depth += 1;
    else if (c === ')' || c === ']') depth -= 1;
    else if (depth === 0 && (sep === ' ' ? /\s/.test(c) : c === sep)) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return sep === ' ' ? parts.filter((p) => p !== '') : parts;
}

// ---------------------------------------------------------------------------
// 选择器

function readIdent(text, i) {
  let j = i;
  while (j < text.length && /[\w-]/.test(text[j])) j += 1;
  return j;
}

// 顶层（括号、方括号、字符串之外）最后一个组合符（空白、>、+、~）的下标；没有返回 -1。
function lastCombinatorIndex(text) {
  let depth = 0;
  let last = -1;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '\\') i += 1;
    else if (c === '"' || c === "'") i = skipString(text, i) - 1;
    else if (c === '(' || c === '[') depth += 1;
    else if (c === ')' || c === ']') depth -= 1;
    else if (depth === 0 && /[\s>+~]/.test(c)) last = i;
  }
  return last;
}

const HOLE = '\u0000';   // 被取出的伪类 / 伪元素在 base 里的占位

export function parseSelector(rawText) {
  const text = rawText.trim();
  const states = new Set();
  const subjectStates = new Set();
  const subjectStart = lastCombinatorIndex(text) + 1;
  let pseudoEl = null;
  let reason = null;
  let base = '';

  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') {
      base += text.slice(i, i + 2);
      i += 2;
    } else if (c === '"' || c === "'") {
      const end = skipString(text, i);
      base += text.slice(i, end);
      i = end;
    } else if (c === '[') {
      const end = matchingClose(text, i, '[', ']');
      const stop = end === -1 ? text.length : end + 1;
      base += text.slice(i, stop);
      i = stop;
    } else if (c === ':') {
      const double = text[i + 1] === ':';
      const nameStart = i + (double ? 2 : 1);
      const nameEnd = readIdent(text, nameStart);
      const name = text.slice(nameStart, nameEnd).toLowerCase();
      let end = nameEnd;
      let arg = null;
      if (text[nameEnd] === '(') {
        const close = matchingClose(text, nameEnd, '(', ')');
        end = close === -1 ? text.length : close + 1;
        arg = text.slice(nameEnd + 1, close === -1 ? text.length : close);
      }
      if (double || (arg === null && LEGACY_PSEUDO_ELEMENTS.has(name))) {
        pseudoEl = `::${name}${arg === null ? '' : `(${arg})`}`;
        base += HOLE;
      } else if (arg === null && STATE_NAMES.has(name)) {
        states.add(name);
        if (i >= subjectStart) subjectStates.add(name);
        else reason ??= 'state-in-ancestor';
        if (name === 'focus-within') reason ??= 'focus-within';
        base += HOLE;
      } else if (name === 'has') {
        reason ??= 'has';
        base += HOLE;
      } else if (FUNCTIONAL_WRAPPERS.has(name) && arg !== null && STATE_IN_ARG.test(arg)) {
        reason ??= `state-in-${name}`;
        base += HOLE;
      } else if (!KNOWN_PSEUDO_CLASSES.has(name) || (arg !== null && hasUnknownPseudoClass(arg))) {
        reason ??= 'unknown-pseudo';
        base += HOLE;
      } else {
        base += text.slice(i, end);
      }
      i = end;
    } else {
      base += c;
      i += 1;
    }
  }

  base = fillHoles(base.replace(new RegExp(`${HOLE}+`, 'g'), HOLE)).trim();

  const sel = { text, base, states, subjectStates, pseudoEl, unsupported: reason !== null, reason };
  if (reason === null && !canMatch(base)) {
    sel.unsupported = true;
    sel.reason = 'match-error';
  }
  return sel;
}

// 参数文本里（:not(...) 之类）是否出现白名单以外的伪类。属性选择器和字符串里的冒号不算。
function hasUnknownPseudoClass(arg) {
  const bare = arg.replace(/\[[^\]]*\]|"[^"]*"|'[^']*'/g, '');
  for (const m of bare.matchAll(/(?<!:):([a-zA-Z-][\w-]*)/g)) {
    const name = m[1].toLowerCase();
    if (!KNOWN_PSEUDO_CLASSES.has(name) && !STATE_NAMES.has(name) && name !== 'has') return true;
  }
  return false;
}

// 占位符左右只要有一侧紧贴着复合选择器的内容，就直接删掉；否则它自己就是一个完整的复合选择器，补 *。
function fillHoles(base) {
  const isBoundary = (ch) => ch === undefined || /[\s>+~(,]/.test(ch);
  let out = '';
  for (let i = 0; i < base.length; i += 1) {
    if (base[i] !== HOLE) {
      out += base[i];
    } else {
      const prev = base[i - 1];
      const next = base[i + 1] === ')' ? undefined : base[i + 1];
      out += isBoundary(prev) && isBoundary(next) ? '*' : '';
    }
  }
  return out;
}

// el.matches 对这个选择器是否不抛错。没有 document（纯 node 环境）时无法探测，视为可以。
function canMatch(base) {
  if (typeof document === 'undefined') return true;
  try {
    document.createElement('div').matches(base || '*');
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 特异性：在选择器原文上计算，状态伪类照样计入；:not/:is/:has 取参数里最大的，:where 为 0。

const cmpSpec = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

export function specificity(selOrText) {
  const text = typeof selOrText === 'string' ? selOrText : selOrText.text;
  let best = [0, 0, 0];
  for (const part of splitTopLevel(text, ',')) {
    const s = specificityOfComplex(part);
    if (cmpSpec(s, best) > 0) best = s;
  }
  return best;
}

function specificityOfComplex(text) {
  const spec = [0, 0, 0];
  const add = (s) => { spec[0] += s[0]; spec[1] += s[1]; spec[2] += s[2]; };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') {
      i += 2;
    } else if (c === '#') {
      spec[0] += 1;
      i = readIdentWithEscapes(text, i + 1);
    } else if (c === '.') {
      spec[1] += 1;
      i = readIdentWithEscapes(text, i + 1);
    } else if (c === '[') {
      spec[1] += 1;
      const end = matchingClose(text, i, '[', ']');
      i = end === -1 ? text.length : end + 1;
    } else if (c === ':') {
      const double = text[i + 1] === ':';
      const nameStart = i + (double ? 2 : 1);
      const nameEnd = readIdent(text, nameStart);
      const name = text.slice(nameStart, nameEnd).toLowerCase();
      let end = nameEnd;
      let arg = null;
      if (text[nameEnd] === '(') {
        const close = matchingClose(text, nameEnd, '(', ')');
        end = close === -1 ? text.length : close + 1;
        arg = text.slice(nameEnd + 1, close === -1 ? text.length : close);
      }
      if (double || LEGACY_PSEUDO_ELEMENTS.has(name)) {
        spec[2] += 1;
      } else if (name === 'where') {
        // 特异性 0
      } else if (['not', 'is', 'matches', 'has', '-webkit-any', '-moz-any'].includes(name) && arg !== null) {
        add(specificity(arg));
      } else if ((name === 'nth-child' || name === 'nth-last-child') && arg !== null) {
        spec[1] += 1;
        const of = /\sof\s(.+)$/i.exec(arg);
        if (of) add(specificity(of[1]));
      } else {
        spec[1] += 1;
      }
      i = end;
    } else if (/[A-Za-z_\u0080-￿]/.test(c)) {
      spec[2] += 1;
      i = readIdentWithEscapes(text, i);
    } else {
      i += 1;   // * 空白 组合符
    }
  }
  return spec;
}

function readIdentWithEscapes(text, i) {
  let j = i;
  while (j < text.length && /[\w\u0080-￿-]|\\/.test(text[j])) j += text[j] === '\\' ? 2 : 1;
  return j;
}

// ---------------------------------------------------------------------------
// 规则

// 层叠判定用：跳过 @keyframes 和声明型 at-rule。
export function parseCss(source) {
  return parse(source, false);
}

// lint 用：@keyframes 内部的关键帧规则（media 记为 '@keyframes 名字'）和 @font-face、@property 等的声明也读进来，
// 免得颜色、字号之类的字面值躲在里面逃过扫描。
export function scanCss(source) {
  return parse(source, true);
}

function parse(source, includeAll) {
  const text = stripComments(source);
  const lineStarts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (idx) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= idx) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };

  const rules = [];

  function parseBlock(start, end, media) {
    let i = start;
    while (i < end) {
      // 跳过空白，定位 prelude 起点
      while (i < end && /\s/.test(text[i])) i += 1;
      if (i >= end) break;
      const preludeStart = i;
      let depth = 0;
      let stop = -1;
      for (; i < end; i += 1) {
        const c = text[i];
        if (c === '\\') i += 1;
        else if (c === '"' || c === "'") i = skipString(text, i) - 1;
        else if (c === '(' || c === '[') depth += 1;
        else if (c === ')' || c === ']') depth -= 1;
        else if (depth === 0 && (c === '{' || c === ';')) { stop = i; break; }
      }
      if (stop === -1) break;   // 末尾残留，忽略
      const prelude = text.slice(preludeStart, stop).trim();
      if (text[stop] === ';') { i = stop + 1; continue; }   // @import / @charset 之类
      const close = matchingClose(text, stop, '{', '}');
      if (close === -1) throw new Error(`CSS 括号不匹配（第 ${lineOf(stop)} 行）`);
      const bodyStart = stop + 1;

      if (prelude.startsWith('@')) {
        const name = /^@([\w-]+)/.exec(prelude)?.[1]?.toLowerCase() ?? '';
        if (DECL_AT_RULES.has(name)) {
          if (includeAll) rules.push(buildRule(prelude, preludeStart, bodyStart, close, media ?? prelude));
        } else if (KEYFRAMES_AT_RULES.has(name)) {
          if (includeAll) parseBlock(bodyStart, close, media === null ? prelude : `${media} > ${prelude}`);
        } else if (name !== 'namespace') {
          const label = name === 'media' ? prelude.slice('@media'.length).trim() : prelude;
          const joined = media === null ? label : `${media} > ${label}`;
          parseBlock(bodyStart, close, joined);
        }
      } else {
        rules.push(buildRule(prelude, preludeStart, bodyStart, close, media));
      }
      i = close + 1;
    }
  }

  function buildRule(prelude, preludeStart, bodyStart, bodyEnd, media) {
    const body = text.slice(bodyStart, bodyEnd);
    if (body.includes('{')) throw new Error(`不支持 CSS 嵌套（第 ${lineOf(bodyStart)} 行：${prelude}）`);
    return {
      selectors: splitTopLevel(prelude, ',').map((s) => s.trim()).filter(Boolean).map(parseSelector),
      decls: parseDecls(body, bodyStart),
      media,
      line: lineOf(preludeStart),
    };
  }

  function parseDecls(body, offset) {
    const decls = [];
    let pos = 0;
    for (const part of splitTopLevel(body, ';')) {
      const lead = part.length - part.trimStart().length;
      const trimmed = part.trim();
      const startIdx = pos + lead;
      pos += part.length + 1;
      if (!trimmed) continue;
      const colon = trimmed.indexOf(':');
      if (colon === -1) continue;
      const rawProp = trimmed.slice(0, colon).trim();
      const prop = rawProp.startsWith('--') ? rawProp : rawProp.toLowerCase();
      let value = trimmed.slice(colon + 1).trim();
      const important = /!\s*important\s*$/i.test(value);
      if (important) value = value.replace(/\s*!\s*important\s*$/i, '').trim();
      decls.push({ prop, value, important, line: lineOf(offset + startIdx) });
    }
    return decls;
  }

  parseBlock(0, text.length, null);
  return rules;
}

// ---------------------------------------------------------------------------
// B6-U 的自动部分：静态无法判定的选择器清单。

const REDUCED_MOTION = /^\(\s*prefers-reduced-motion\s*:\s*[\w-]+\s*\)$/i;

export function isReducedMotion(media) {
  return media !== null && REDUCED_MOTION.test(media);
}

// 返回 [{ selector, reason }]，按源码顺序，同一 (selector, reason) 只记一次。不含行号：
// 行号随 style.css 每次改动而变，写进 fixture 会让一致性测试天天失败。
export function unsupportedSelectors(rules) {
  const seen = new Set();
  const out = [];
  for (const rule of rules) {
    for (const sel of rule.selectors) {
      let reason = null;
      if (rule.media !== null && !isReducedMotion(rule.media)) {
        reason = rule.media.startsWith('@') ? rule.media : `@media ${rule.media}`;
      } else if (sel.unsupported) {
        reason = sel.reason;
      }
      if (reason === null) continue;
      const key = `${sel.text}\u0000${reason}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ selector: sel.text, reason });
    }
  }
  return out;
}
