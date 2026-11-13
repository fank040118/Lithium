import { describe, it, expect } from 'vitest';
import {
  loadTokens,
  indexByName,
  tokenToCssVar,
  cssVarToToken,
  resolveRef,
  renderCss,
  expectedCssBlocks,
} from './helpers/designTokens.js';

// design/tokens.json 的结构测试。
// 数值抄错由计数测试和抽样断言兜底；style.tokens.test.js 会再核一次 style.css 与 tokens.json 是否一致。

const tokens = loadTokens();
const byName = indexByName(tokens);
const get = (name) => {
  const t = byName.get(name);
  if (!t) throw new Error(`token 不存在：${name}`);
  return t;
};
const count = (pred) => tokens.filter(pred).length;
const inGroup = (prefix) => (t) => t.name.startsWith(prefix + '.');

describe('design/tokens.json 结构', () => {
  it('名字符合命名规则', () => {
    for (const t of tokens) expect(t.name).toMatch(/^[a-z]+(\.[a-z0-9]+)+$/);
  });

  it('名字唯一，且叶子不与分组同名', () => {
    const names = tokens.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    const prefixes = new Set();
    for (const name of names) {
      const parts = name.split('.');
      for (let i = 1; i < parts.length; i++) prefixes.add(parts.slice(0, i).join('.'));
    }
    for (const name of names) expect(prefixes.has(name), `${name} 既是叶子又是分组`).toBe(false);
  });

  it('每个 token 的字段齐全且取值合法', () => {
    const sets = new Set(['core', 'theme/dark']);
    for (const t of tokens) {
      expect(sets.has(t.set), `${t.name} 的 set`).toBe(true);
      expect(typeof t.type, `${t.name} 的 type`).toBe('string');
      expect(t.value, `${t.name} 的 value`).not.toBeUndefined();
      expect([null, 'css'], `${t.name} 的 only`).toContain(t.only);
      expect(typeof t.doc, `${t.name} 的 doc`).toBe('boolean');
    }
  });

  it('互转是双射', () => {
    expect(tokenToCssVar('color.alpha.blue500.15')).toBe('--color-alpha-blue500-15');
    expect(tokenToCssVar('space.4')).toBe('--space-4');
    expect(cssVarToToken('--color-control-bg-hover')).toBe('color.control.bg.hover');
    const vars = new Set();
    for (const t of tokens) {
      const cssVar = tokenToCssVar(t.name);
      expect(cssVarToToken(cssVar)).toBe(t.name);
      vars.add(cssVar);
    }
    expect(vars.size).toBe(tokens.length);
  });

  it('所有引用都能解析', () => {
    const refs = [];
    for (const t of tokens) {
      const v = t.value;
      if (typeof v === 'string') refs.push([t.name, v]);
      else if (Array.isArray(v)) for (const layer of v) refs.push([t.name, layer.color]);
      else if (v && typeof v === 'object' && t.type === 'typography') {
        for (const field of Object.values(v)) refs.push([t.name, field]);
      }
    }
    let resolved = 0;
    for (const [owner, raw] of refs) {
      if (typeof raw === 'string' && raw.startsWith('{')) {
        expect(resolveRef(raw, byName), `${owner} 引用 ${raw}`).not.toBeNull();
        resolved++;
      }
    }
    expect(resolved).toBeGreaterThan(100);
    expect(resolveRef('#ffffff', byName)).toBeNull();
    expect(resolveRef('{no.such.token}', byName)).toBeNull();
  });

  it('typography 的字段名是 Penpot TokenTypographyValueString 的名字，且每个引用指向正确类型', () => {
    // 字段 -> 允许的目标 type。lineHeight 没有独立 token 类型，按 API 说明引用 number。
    const allowed = {
      fontFamilies: ['fontFamilies'],
      fontSizes: ['fontSizes', 'dimension'],
      fontWeight: ['fontWeights'],
      lineHeight: ['number'],
      letterSpacing: ['letterSpacing'],
    };
    const typos = tokens.filter((t) => t.type === 'typography');
    expect(typos.length).toBe(10);
    for (const t of typos) {
      for (const [field, raw] of Object.entries(t.value)) {
        expect(Object.keys(allowed), `${t.name} 有未知字段 ${field}`).toContain(field);
        const target = resolveRef(raw, byName);
        expect(target, `${t.name}.${field} 必须是可解析的引用：${raw}`).not.toBeNull();
        expect(allowed[field], `${t.name}.${field} 引用了 ${target.name}（${target.type}）`).toContain(target.type);
      }
      for (const required of ['fontFamilies', 'fontSizes', 'fontWeight', 'lineHeight']) {
        expect(t.value[required], `${t.name} 缺 ${required}`).toBeDefined();
      }
    }
  });

  it('shadow 的字段名是 Penpot TokenShadowValueString 的名字', () => {
    const keys = ['offsetX', 'offsetY', 'blur', 'spread', 'color', 'inset'];
    for (const t of tokens.filter((x) => x.type === 'shadow')) {
      expect(Array.isArray(t.value) && t.value.length > 0, t.name).toBe(true);
      for (const layer of t.value) expect(Object.keys(layer).sort(), t.name).toEqual([...keys].sort());
    }
  });

  it('theme/dark 的颜色只引用 core 的原始色', () => {
    const semantic = tokens.filter((t) => t.set === 'theme/dark' && t.type === 'color');
    expect(semantic.length).toBeGreaterThan(0);
    for (const t of semantic) {
      const ref = resolveRef(t.value, byName);
      expect(ref, `${t.name} 必须是引用，不能写字面值`).not.toBeNull();
      expect(ref.set, `${t.name} 引用了 ${ref.name}`).toBe('core');
      expect(ref.type).toBe('color');
    }
  });

  it('阴影的颜色引用原始色，shadow.highlight 引用 border.highlight 是唯一例外', () => {
    const shadows = tokens.filter((t) => t.type === 'shadow');
    for (const t of shadows) {
      expect(t.set).toBe('theme/dark');
      for (const layer of t.value) {
        const ref = resolveRef(layer.color, byName);
        expect(ref, `${t.name} 的颜色`).not.toBeNull();
        if (t.name === 'shadow.highlight') {
          expect(ref.name).toBe('color.border.highlight');
        } else {
          expect(ref.set, `${t.name} 引用了 ${ref.name}`).toBe('core');
        }
      }
    }
  });

  it('原始层的颜色是字面值，不引用其他 token', () => {
    for (const t of tokens.filter((x) => x.set === 'core' && x.type === 'color')) {
      expect(resolveRef(t.value, byName), t.name).toBeNull();
      expect(t.value).toMatch(/^(#[0-9a-f]{6}|rgba\(\d+, ?\d+, ?\d+, ?0?\.\d+\))$/);
    }
  });

  it('不建只被 alpha 用到的实色，也不建 red.500', () => {
    for (const name of ['color.black', 'color.blue.900', 'color.purple.600', 'color.red.500']) {
      expect(byName.has(name), name).toBe(false);
    }
  });

  it('计数与设计规范一致', () => {
    const semanticColor = (t) => t.set === 'theme/dark' && t.type === 'color';
    expect(count(semanticColor)).toBe(67); // 含 color.wallpaper.dim
    expect(count((t) => t.type === 'shadow')).toBe(8);
    expect(count(inGroup('space'))).toBe(12);
    expect(count(inGroup('radius'))).toBe(6);
    expect(count(inGroup('font.size'))).toBe(6);
    expect(count((t) => t.type === 'typography')).toBe(10);
    expect(count(inGroup('type'))).toBe(10);
    expect(count(inGroup('z'))).toBe(12);
    expect(count(inGroup('motion.duration'))).toBe(4);
    expect(count(inGroup('motion.ease'))).toBe(4);
    expect(count(inGroup('blur'))).toBe(6);
    expect(count((t) => t.set === 'core' && t.type === 'color' && !t.name.startsWith('color.alpha.'))).toBe(17);
    expect(count((t) => t.name.startsWith('color.alpha.'))).toBe(33);
  });

  it('只在 CSS 的 token 与 Penpot 实际建的语义色数量', () => {
    const cssOnly = tokens.filter((t) => t.only === 'css').map((t) => t.name).sort();
    expect(cssOnly).toEqual([
      'color.scrollbar.hover',
      'color.scrollbar.thumb',
      'color.wallpaper.dim',
      'motion.ease.enter',
      'motion.ease.exit',
      'motion.ease.move',
      'motion.ease.standard',
    ]);
    const penpotSemantic = tokens.filter((t) => t.set === 'theme/dark' && t.type === 'color' && t.only !== 'css');
    expect(penpotSemantic.length).toBe(64);
  });

  it('只做文档展示的 token：blur、z、motion.duration', () => {
    const docNames = tokens.filter((t) => t.doc).map((t) => t.name);
    expect(docNames.length).toBe(6 + 12 + 4);
    for (const n of docNames) expect(n).toMatch(/^(blur|z|motion\.duration)\./);
    expect(count((t) => /^(blur|z|motion\.duration)\./.test(t.name) && !t.doc)).toBe(0);
  });

  it('抽样取值', () => {
    expect(get('color.slate.425').value).toBe('#8b98ac');
    expect(get('size.control.lg').value).toBe(56);
    expect(get('color.action.primary.hover').value).toBe('{color.blue.700}');
    expect(get('color.action.danger.hover').value).toBe('{color.red.700}');
    expect(get('color.text.dangeronfill').value).toBe('{color.red.300}');
    expect(get('color.divider').value).toBe('{color.alpha.white.10}');
    expect(get('font.size.xl').value).toBe(20);
    expect(get('color.control.panel.pressed').value).toBe('{color.alpha.white.18}');
    expect(get('color.wallpaper.dim').value).toBe('{color.alpha.black.85}');
    expect(get('color.alpha.black.29').value).toBe('rgba(0, 0, 0, 0.29)');
    expect(get('color.alpha.blue900.40').value).toBe('rgba(30, 58, 138, 0.4)');
    expect(get('z.notice').value).toBe(350);
    expect(get('motion.duration.slow').value).toBe(260);
    expect(get('motion.ease.enter').value).toBe('cubic-bezier(0.22, 1, 0.36, 1)');
    expect(get('size.sidebar.width').value).toBe(400);
    expect(get('size.folder.max').value).toBe(800);
    expect(get('opacity.disabled').value).toBe(0.5);
    expect(get('font.family.ui').value).toEqual({
      penpot: 'Inter',
      css: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    });
  });

  it('间距、字号、圆角的完整取值', () => {
    const values = (prefix) => tokens.filter(inGroup(prefix)).map((t) => [t.name.split('.').pop(), t.value]);
    expect(Object.fromEntries(values('space'))).toEqual({
      0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64, 20: 80,
    });
    expect(Object.fromEntries(values('font.size'))).toEqual({ xs: 12, sm: 13, md: 14, lg: 16, xl: 20, clock: 60 });
    expect(Object.fromEntries(values('radius'))).toEqual({ xs: 4, sm: 8, md: 12, lg: 16, xl: 24, full: 9999 });
  });

  it('不存在没有 CSS 渲染方式的 type', () => {
    const known = new Set([
      'color', 'shadow', 'typography', 'spacing', 'sizing', 'borderRadius', 'borderWidth', 'opacity',
      'fontFamilies', 'fontSizes', 'fontWeights', 'letterSpacing', 'number', 'dimension', 'duration', 'cubicBezier',
    ]);
    for (const t of tokens) expect(known.has(t.type), `${t.name}: ${t.type}`).toBe(true);
  });
});

describe('renderCss', () => {
  it('渲染 typography 与 shadow', () => {
    expect(renderCss(get('type.body.md'), byName)).toBe(
      'var(--font-weight-regular) var(--font-size-md)/var(--font-leading-normal) var(--font-family-ui)'
    );
    expect(renderCss(get('shadow.highlight'), byName)).toBe('inset 0 1px 0 0 var(--color-border-highlight)');
    expect(renderCss(get('shadow.card'), byName)).toBe('0 4px 12px 0 var(--color-alpha-black-30)');
  });

  it('shadow.text 靠数据标记（$extensions.css.property）输出 text-shadow 语法，没有扩散半径', () => {
    const text = get('shadow.text');
    expect(text.$extensions).toEqual({ css: { property: 'text-shadow' } });
    expect(renderCss(text, byName)).toBe('0 1px 6px var(--color-alpha-black-70)');
    // 只有 shadow.text 带标记，其余都是 box-shadow
    expect(tokens.filter((t) => t.$extensions).map((t) => t.name)).toEqual(['shadow.text']);
  });

  it('是否输出 spread 只由数据决定，不看 token 名', () => {
    const plain = { ...get('shadow.text') };
    delete plain.$extensions;
    expect(renderCss(plain, byName)).toBe('0 1px 6px 0 var(--color-alpha-black-70)');
    const marked = { ...get('shadow.card'), $extensions: { css: { property: 'text-shadow' } } };
    expect(renderCss(marked, byName)).toBe('0 4px 12px var(--color-alpha-black-30)');
  });

  it('渲染引用、dimension、duration、字体与字面值', () => {
    expect(renderCss(get('color.control.bg.hover'), byName)).toBe('var(--color-alpha-white-20)');
    expect(renderCss(get('space.4'), byName)).toBe('16px');
    expect(renderCss(get('radius.full'), byName)).toBe('9999px');
    expect(renderCss(get('blur.glass'), byName)).toBe('12px');
    expect(renderCss(get('motion.duration.slow'), byName)).toBe('260ms');
    expect(renderCss(get('z.menu'), byName)).toBe('400');
    expect(renderCss(get('opacity.disabled'), byName)).toBe('0.5');
    expect(renderCss(get('font.leading.tight'), byName)).toBe('1.25');
    expect(renderCss(get('color.slate.425'), byName)).toBe('#8b98ac');
    expect(renderCss(get('motion.ease.standard'), byName)).toBe('ease');
    expect(renderCss(get('font.family.ui'), byName)).toBe(
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    );
  });

  it('type.clock 的字间距不在 font 简写里', () => {
    const clock = get('type.clock');
    expect(renderCss(clock, byName)).toBe(
      'var(--font-weight-light) var(--font-size-clock)/var(--font-leading-none) var(--font-family-ui)'
    );
    expect(clock.value.letterSpacing).toBe('{font.tracking.clock}');
  });
});

describe('expectedCssBlocks', () => {
  const blocks = expectedCssBlocks(tokens);

  it('core 块只含 core 的 token，theme 块声明 color-scheme 并含全部语义色与阴影', () => {
    expect(blocks.core.startsWith(':root {\n')).toBe(true);
    expect(blocks.core.endsWith('\n}')).toBe(true);
    expect(blocks.theme.startsWith(':root, [data-theme="dark"] {\n  color-scheme: dark;\n')).toBe(true);
    expect(blocks.theme.endsWith('\n}')).toBe(true);

    const decls = (text) => text.split('\n').filter((l) => /^ {2}--/.test(l));
    expect(decls(blocks.core).length).toBe(count((t) => t.set === 'core'));
    expect(decls(blocks.theme).length).toBe(count((t) => t.set === 'theme/dark'));
  });

  it('每条声明是 --变量: 值;，变量名与 token 一一对应', () => {
    expect(blocks.core).toContain('  --color-slate-425: #8b98ac;\n');
    expect(blocks.core).toContain('  --z-notice: 350;\n');
    expect(blocks.core).toContain('  --type-body-md: var(--font-weight-regular) var(--font-size-md)/var(--font-leading-normal) var(--font-family-ui);\n');
    expect(blocks.theme).toContain('  --color-wallpaper-dim: var(--color-alpha-black-85);\n');
    expect(blocks.theme).toContain('  --shadow-highlight: inset 0 1px 0 0 var(--color-border-highlight);\n');
  });
});
