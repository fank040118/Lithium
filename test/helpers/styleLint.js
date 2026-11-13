// 样式 lint（Task 27）：把 spec §9 的验收项和尺寸类 token 的迁移进度变成可计数的规则，供棘轮使用。
//
// lintStyle(text, { allow }) -> Violation[]；Violation = { rule, line, selector, prop, value }
// 规则：
//   hex            值里有 #rgb / #rgba / #rrggbb / #rrggbbaa（url() 与引号字符串里的不算）
//   rgb            值里有 rgb( / rgba(
//   primitive-ref  值里引用了原始色变量 var(--color-(slate|blue|red|amber|white|alpha)…)，含无后缀的 --color-white
//   transition-all transition / transition-property 里出现 all
//   raw-font-size  font-size 不是 var()；font 简写不是单个 var()（继承类关键字除外）
//   raw-radius     border-radius 及各角长写里有 var() 以外的非零数值
//   raw-z          z-index 不是 var() / auto（继承类关键字除外）
// 同一条声明对同一条规则只记一次。
//
// 豁免：:root、:root, [data-theme="dark"] 两个块，以及 prefers-reduced-motion 里的 :root。
// allow 白名单只对 raw-font-size、raw-z 生效，按完整值精确匹配（比如 '30px'、'1'）；
// 不对 raw-radius 生效，免得白名单里的 10px 顺带放过 border-radius: 10px。

import { parseCss, isReducedMotion, splitTopLevel } from './cssRules.js';

// G-3 的首字母占位字号（30px / 10px）；spec §5.7 局部层表里的 z-index 小整数（-1 是壁纸预览的 ::after）。
export const DEFAULT_ALLOW = ['30px', '10px', '1', '2', '-1'];

const COLOR_RULES = new Set(['hex', 'rgb', 'primitive-ref']);
const DIM_RULES = new Set(['transition-all', 'raw-font-size', 'raw-radius', 'raw-z']);

const HEX = /#[0-9a-fA-F]{3,8}(?![\w-])/;
const RGB = /\brgba?\(/i;
const PRIMITIVE_REF = /var\(\s*--color-(?:slate|blue|red|amber|white|alpha)(?!\w)/i;
const TRANSITION_ALL = /(?:^|[\s,])all(?=$|[\s,])/i;
const RADIUS_PROP = /^border(?:-(?:top|bottom)-(?:left|right)|-(?:start|end)-(?:start|end))?-radius$/;
const CSS_WIDE = /^(inherit|initial|unset|revert|revert-layer)$/i;

const EXEMPT_ROOT_BLOCKS = new Set([':root', ':root, [data-theme="dark"]']);

function selectorKey(rule) {
  return rule.selectors.map((s) => s.text.replace(/\s+/g, ' ').replace(/'/g, '"')).join(', ');
}

function isExempt(rule) {
  const key = selectorKey(rule);
  if (rule.media === null) return EXEMPT_ROOT_BLOCKS.has(key);
  return isReducedMotion(rule.media) && key === ':root';
}

// 去掉引号字符串和 url(...) 的内容，免得把 url(#frag)、data URI、content 里的文字当成颜色。
function withoutLiterals(value) {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const c = value[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < value.length && value[j] !== c) j += value[j] === '\\' ? 2 : 1;
      out += '""';
      i = j;
    } else if (/^url\(/i.test(value.slice(i, i + 4))) {
      let depth = 0;
      let j = i + 3;
      for (; j < value.length; j += 1) {
        if (value[j] === '"' || value[j] === "'") {
          const q = value[j];
          j += 1;
          while (j < value.length && value[j] !== q) j += value[j] === '\\' ? 2 : 1;
        } else if (value[j] === '(') depth += 1;
        else if (value[j] === ')') { depth -= 1; if (depth === 0) break; }
      }
      out += 'url()';
      i = j;
    } else {
      out += c;
    }
  }
  return out;
}

// 去掉所有 var(...)（括号配平）。
function withoutVars(value) {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    if (/^var\(/i.test(value.slice(i, i + 4))) {
      let depth = 0;
      let j = i + 3;
      for (; j < value.length; j += 1) {
        if (value[j] === '(') depth += 1;
        else if (value[j] === ')') { depth -= 1; if (depth === 0) break; }
      }
      out += ' ';
      i = j;
    } else {
      out += value[i];
    }
  }
  return out;
}

const isSoleVar = (value) => /^var\(/i.test(value) && withoutVars(value).trim() === '';

function declViolations(prop, value, allowSet) {
  const found = [];
  const bare = withoutLiterals(value);
  if (HEX.test(bare)) found.push('hex');
  if (RGB.test(bare)) found.push('rgb');
  if (PRIMITIVE_REF.test(bare)) found.push('primitive-ref');

  if ((prop === 'transition' || prop === 'transition-property') && TRANSITION_ALL.test(withoutVars(value))) {
    found.push('transition-all');
  }
  if (prop === 'font-size') {
    if (!CSS_WIDE.test(value) && !value.includes('var(') && !allowSet.has(value.toLowerCase())) found.push('raw-font-size');
  } else if (prop === 'font') {
    if (!CSS_WIDE.test(value) && !isSoleVar(value) && !allowSet.has(value.toLowerCase())) found.push('raw-font-size');
  }
  if (RADIUS_PROP.test(prop) && !CSS_WIDE.test(value)) {
    const literal = value.includes('calc(') && value.includes('var(') ? '' : withoutVars(value);
    const raw = splitTopLevel(literal.replace(/\//g, ' '), ' ').some((t) => /\d/.test(t) && !/^0+(\.0+)?$/.test(t));
    if (raw) found.push('raw-radius');
  }
  if (prop === 'z-index') {
    if (!CSS_WIDE.test(value) && !/^auto$/i.test(value) && !value.includes('var(') && !allowSet.has(value)) found.push('raw-z');
  }
  return found;
}

export function lintStyle(text, { allow = [] } = {}) {
  const allowSet = new Set(allow.map((a) => String(a).toLowerCase()));
  const out = [];
  for (const rule of parseCss(text)) {
    if (isExempt(rule)) continue;
    const selector = rule.selectors.map((s) => s.text).join(', ');
    for (const d of rule.decls) {
      for (const r of declViolations(d.prop, d.value, allowSet)) {
        out.push({ rule: r, line: d.line, selector, prop: d.prop, value: d.value });
      }
    }
  }
  return out;
}

export function colorViolations(text, { allow = DEFAULT_ALLOW } = {}) {
  return lintStyle(text, { allow }).filter((v) => COLOR_RULES.has(v.rule));
}

export function dimViolations(text, { allow = DEFAULT_ALLOW } = {}) {
  return lintStyle(text, { allow }).filter((v) => DIM_RULES.has(v.rule));
}

// ---------------------------------------------------------------------------
// JS：字符串字面量（含模板字符串的文本部分）里的颜色字面值。注释和正则字面量不计。

const JS_COLOR = /#[0-9a-fA-F]{3,8}(?![\w-])|\brgba?\(/g;
const REGEX_PRECEDING_WORDS = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do', 'instanceof', 'yield', 'await']);

export function lintJsColors(text) {
  const out = [];
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
  const report = (start, end) => {
    const seg = text.slice(start, end);
    for (const m of seg.matchAll(JS_COLOR)) {
      out.push({ rule: m[0].startsWith('#') ? 'hex' : 'rgb', line: lineOf(start + m.index), value: m[0] });
    }
  };

  // 以下函数都返回「下一个待扫描位置」。
  function readString(i) {
    const q = text[i];
    let j = i + 1;
    while (j < text.length && text[j] !== q && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
    report(i + 1, j);
    return j + 1;
  }

  function readTemplate(i) {
    let j = i + 1;
    let segStart = j;
    while (j < text.length && text[j] !== '`') {
      if (text[j] === '\\') {
        j += 2;
      } else if (text[j] === '$' && text[j + 1] === '{') {
        report(segStart, j);
        j = scanCode(j + 2, true);
        segStart = j;
      } else {
        j += 1;
      }
    }
    report(segStart, j);
    return j + 1;
  }

  function regexAllowedAt(i) {
    let j = i - 1;
    while (j >= 0 && /\s/.test(text[j])) j -= 1;
    if (j < 0) return true;
    const prev = text[j];
    if (/[\w$]/.test(prev)) {
      let k = j;
      while (k >= 0 && /[\w$]/.test(text[k])) k -= 1;
      return REGEX_PRECEDING_WORDS.has(text.slice(k + 1, j + 1));
    }
    return !(prev === ')' || prev === ']' || prev === '}');
  }

  function readRegex(i) {
    let j = i + 1;
    let inClass = false;
    while (j < text.length && text[j] !== '\n') {
      if (text[j] === '\\') j += 1;
      else if (text[j] === '[') inClass = true;
      else if (text[j] === ']') inClass = false;
      else if (text[j] === '/' && !inClass) return j + 1;
      j += 1;
    }
    return j;
  }

  function scanCode(start, untilBrace) {
    let i = start;
    let depth = 0;
    while (i < text.length) {
      const c = text[i];
      if (c === '/' && text[i + 1] === '/') {
        const nl = text.indexOf('\n', i);
        i = nl === -1 ? text.length : nl;
      } else if (c === '/' && text[i + 1] === '*') {
        const end = text.indexOf('*/', i + 2);
        i = end === -1 ? text.length : end + 2;
      } else if (c === '"' || c === "'") {
        i = readString(i);
      } else if (c === '`') {
        i = readTemplate(i);
      } else if (c === '/') {
        i = regexAllowedAt(i) ? readRegex(i) : i + 1;
      } else if (c === '{') {
        depth += 1;
        i += 1;
      } else if (c === '}') {
        if (untilBrace && depth === 0) return i + 1;
        depth -= 1;
        i += 1;
      } else {
        i += 1;
      }
    }
    return i;
  }

  scanCode(0, false);
  return out;
}
