// style.css 里的新 token 块与 design/tokens.json 的一致性。
// 期望的块由 expectedCssBlocks 渲染；不一致时失败信息里带着期望文本，直接粘贴进 style.css 即可。
import { describe, it, expect } from 'vitest';
import { readStyleCss, parseCss } from './helpers/cssRules.js';
import {
  loadTokens, indexByName, expectedCssBlocks, renderCss, tokenToCssVar,
} from './helpers/designTokens.js';

const css = readStyleCss();
const rules = parseCss(css);
const tokens = loadTokens();
const blocks = expectedCssBlocks(tokens);

const THEME_SELECTOR = ':root, [data-theme="dark"]';
const selectorKey = (rule) => rule.selectors.map((s) => s.text).join(', ');
const topLevel = (rule) => rule.media === null;
const rootBlocks = rules.filter((r) => topLevel(r) && selectorKey(r) === ':root');
const themeBlocks = rules.filter((r) => topLevel(r) && selectorKey(r) === THEME_SELECTOR);
const customProps = (rule) => rule.decls.filter((d) => d.prop.startsWith('--'));

// 去掉每行的缩进差异，只比较声明文本，避免空白差异造成无意义的失败。
const normalize = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');

describe('新 token 块与 tokens.json 一致', () => {
  it('core 与尺寸类 token 出现在第一个 :root 块之后的 :root 块，值 = renderCss', () => {
    expect(normalize(css), `style.css 里缺少或不一致的 core 块，期望：\n${blocks.core}\n`)
      .toContain(normalize(blocks.core));
    expect(rootBlocks.length, '布局辅助 :root 块之外还应有一个 core :root 块').toBeGreaterThanOrEqual(2);
    // core 块在布局辅助块之后：布局辅助块行号更小。
    const [layoutRoot, ...rest] = rootBlocks;
    const coreFirstVar = tokenToCssVar(tokens.find((t) => t.set === 'core').name);
    const coreBlock = rest.find((r) => customProps(r).some((d) => d.prop === coreFirstVar));
    expect(coreBlock, 'core 块缺失').toBeTruthy();
    expect(coreBlock.line).toBeGreaterThan(layoutRoot.line);
  });

  it('core 块里每个 core token 的声明值 = renderCss（逐条）', () => {
    const byName = indexByName(tokens);
    const coreBlock = rootBlocks.find((r) => customProps(r).some((d) => d.prop === '--font-family-ui'));
    expect(coreBlock, 'core 块缺失').toBeTruthy();
    const declared = new Map(customProps(coreBlock).map((d) => [d.prop, d.value]));
    for (const t of tokens.filter((x) => x.set === 'core')) {
      expect(declared.get(tokenToCssVar(t.name)), t.name).toBe(renderCss(t, byName));
    }
    expect(declared.size).toBe(tokens.filter((x) => x.set === 'core').length);
  });

  it('语义色与阴影出现在 ":root, [data-theme=\\"dark\\"]" 块，并声明 color-scheme: dark', () => {
    expect(normalize(css), `style.css 里缺少或不一致的 theme 块，期望：\n${blocks.theme}\n`)
      .toContain(normalize(blocks.theme));
    expect(themeBlocks).toHaveLength(1);
    const scheme = themeBlocks[0].decls.find((d) => d.prop === 'color-scheme');
    expect(scheme?.value).toBe('dark');
    const byName = indexByName(tokens);
    const declared = new Map(customProps(themeBlocks[0]).map((d) => [d.prop, d.value]));
    const themeTokens = tokens.filter((x) => x.set === 'theme/dark');
    for (const t of themeTokens) {
      expect(declared.get(tokenToCssVar(t.name)), t.name).toBe(renderCss(t, byName));
    }
    expect(declared.size).toBe(themeTokens.length);
  });

  it('font.family.ui 的 CSS 值取 value.css，不是 Penpot 的字体名', () => {
    const token = tokens.find((t) => t.name === 'font.family.ui');
    const decl = rootBlocks.flatMap(customProps).find((d) => d.prop === '--font-family-ui');
    expect(decl?.value).toBe(token.value.css);
    expect(decl.value).not.toContain('Inter');
  });

  it('body 的 font-family 引用 var(--font-family-ui)，字体栈的唯一来源是 token', () => {
    const body = rules.filter((r) => topLevel(r) && selectorKey(r) === 'body');
    const fam = body.flatMap((r) => r.decls).filter((d) => d.prop === 'font-family').at(-1);
    expect(fam?.value).toBe('var(--font-family-ui)');
  });

  it('布局辅助块、core 块与 theme 块的变量互不重名', () => {
    const [layoutRoot, ...tokenRoots] = rootBlocks;
    const layoutNames = new Set(customProps(layoutRoot).map((d) => d.prop));
    const tokenNames = [...tokenRoots, ...themeBlocks].flatMap(customProps).map((d) => d.prop);
    expect(tokenNames.length).toBeGreaterThan(0);
    expect(tokenNames.filter((n) => layoutNames.has(n))).toEqual([]);
    expect(new Set(tokenNames).size, 'token 块内部也不能重名').toBe(tokenNames.length);
  });
});
