// design/tokens.json 的读取与 CSS 渲染。
// tokens.json 是 Penpot 与 CSS 共同的 token 源：这里把它渲染成 style.css 里应有的 :root 块，
// 供一致性测试比对，也供执行者在 tokens.json 变更后直接粘贴。
//
// Token 结构：{ name, type, set, value, only, doc }
//   type  Penpot TokenType 的名字；CSS 专用的另有 duration、cubicBezier；blur 用 dimension
//   set   'core' | 'theme/dark'
//   only  null（两侧都有）| 'css'（只在 CSS）
//   doc   true 表示 Penpot 里只作文档展示、不绑定 shape
//   $extensions  可选，Penpot 之外的附加信息；目前只有 shadow.text 的 css.property = 'text-shadow'
// 引用写法：'{color.alpha.white.10}'。

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// jsdom 环境下全局 URL 被替换，fs 不认；用路径字符串，同样不依赖当前工作目录。
const TOKENS_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../design/tokens.json');

// 值是数字、CSS 里写成 Npx 的类型。
const PX_TYPES = new Set([
  'dimension', 'spacing', 'sizing', 'borderRadius', 'borderWidth', 'fontSizes', 'letterSpacing',
]);

const SET_ORDER = ['core', 'theme/dark'];

export function loadTokens() {
  return JSON.parse(readFileSync(TOKENS_PATH, 'utf8'));
}

export function indexByName(tokens) {
  return new Map(tokens.map((t) => [t.name, t]));
}

export function tokenToCssVar(name) {
  return '--' + name.replaceAll('.', '-');
}

// 段内禁止连字符，所以这条规则是双射。
export function cssVarToToken(cssVar) {
  return cssVar.replace(/^--/, '').replaceAll('-', '.');
}

function refName(value) {
  if (typeof value !== 'string') return null;
  const m = /^\{([^{}]+)\}$/.exec(value);
  return m ? m[1] : null;
}

function lookup(byName, name) {
  const found = byName instanceof Map ? byName.get(name) : byName[name];
  return found ?? null;
}

// 不是引用，或引用不存在时返回 null。
export function resolveRef(value, byName) {
  const name = refName(value);
  return name === null ? null : lookup(byName, name);
}

function refToVar(value, byName) {
  const target = resolveRef(value, byName);
  if (!target) throw new Error(`无法解析的引用：${value}`);
  return `var(${tokenToCssVar(target.name)})`;
}

const px = (n) => (n === 0 ? '0' : `${n}px`);

// text-shadow 的语法没有扩散半径（shadow.text 在 CSS 里输出为 text-shadow）。
// 由数据决定：token 上写 "$extensions": { "css": { "property": "text-shadow" } }。
function isTextShadow(token) {
  return token.$extensions?.css?.property === 'text-shadow';
}

// shadow 层字段名同 Penpot TokenShadowValueString：offsetX、offsetY、blur、spread、color、inset。
function renderShadow(token, byName) {
  const textOnly = isTextShadow(token);
  return token.value
    .map((layer) => {
      const parts = [px(layer.offsetX), px(layer.offsetY), px(layer.blur)];
      if (!textOnly) parts.push(px(layer.spread));
      parts.push(refName(layer.color) ? refToVar(layer.color, byName) : layer.color);
      return (layer.inset ? 'inset ' : '') + parts.join(' ');
    })
    .join(', ');
}

// typography 字段名同 Penpot TokenTypographyValueString：fontFamilies、fontSizes、fontWeight、lineHeight、letterSpacing。
// letterSpacing 不属于 font 简写，不在这里输出。
function renderTypography(token, byName) {
  const v = token.value;
  const r = (field) => refToVar(v[field], byName);
  return `${r('fontWeight')} ${r('fontSizes')}/${r('lineHeight')} ${r('fontFamilies')}`;
}

export function renderCss(token, byName) {
  const { type, value } = token;
  if (refName(value) !== null) return refToVar(value, byName);
  if (type === 'shadow') return renderShadow(token, byName);
  if (type === 'typography') return renderTypography(token, byName);
  if (type === 'fontFamilies') return typeof value === 'string' ? value : value.css;
  if (type === 'duration') return `${value}ms`;
  if (PX_TYPES.has(type)) return `${value}px`;
  return String(value);
}

function declarations(tokens, byName) {
  return tokens.map((t) => `  ${tokenToCssVar(t.name)}: ${renderCss(t, byName)};`);
}

// 两个块的完整文本：core 放原始层与尺寸；theme 放语义色与阴影，并声明 color-scheme。
export function expectedCssBlocks(tokens) {
  const byName = indexByName(tokens);
  const inSet = (set) => tokens.filter((t) => t.set === set);
  for (const t of tokens) {
    if (!SET_ORDER.includes(t.set)) throw new Error(`未知 set：${t.name} -> ${t.set}`);
  }
  const core = [':root {', ...declarations(inSet('core'), byName), '}'].join('\n');
  const theme = [
    ':root, [data-theme="dark"] {',
    '  color-scheme: dark;',
    ...declarations(inSet('theme/dark'), byName),
    '}',
  ].join('\n');
  return { core, theme };
}
