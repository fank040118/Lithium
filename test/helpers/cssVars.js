// CSS 变量的定义与引用扫描（Task 37）。
// 目的：删除或改名一个变量后，若还有 var(--x) 引用它，浏览器会静默失效（取初始值），不会报错。
// 所以「所有 var(--x) 都有定义」要同时扫描 style.css 与 JS / HTML 里的字符串。
//
//   定义来源：style.css 里任意位置的 `--x:` 声明（两个 :root 块与组件内的默认值），
//             加上 JS 里 setProperty('--x', ...) 写入的运行时变量。
//   引用来源：style.css 与各 JS / HTML 文本里的 var(--x...)。

const stripCssComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

export function declaredVars(css) {
  const out = new Set();
  for (const m of stripCssComments(css).matchAll(/(?:^|[;{}\s])(--[\w-]+)\s*:/g)) out.add(m[1]);
  return out;
}

export function setPropertyVars(js) {
  const out = new Set();
  for (const m of js.matchAll(/setProperty\(\s*(['"`])(--[\w-]+)\1/g)) out.add(m[2]);
  return out;
}

export function referencedVars(text) {
  const out = new Set();
  for (const m of text.matchAll(/var\(\s*(--[\w-]+)/g)) out.add(m[1]);
  return out;
}

// sources: { 文件名: 文本 }；其中 'style.css' 当 CSS 处理，其余按 JS / HTML 处理。
// 返回 [{ file, name }]：被引用但没有任何定义的变量。
export function undefinedVarRefs(sources) {
  const defined = new Set();
  for (const [file, text] of Object.entries(sources)) {
    if (file.endsWith('.css')) for (const n of declaredVars(text)) defined.add(n);
    else for (const n of setPropertyVars(text)) defined.add(n);
  }
  const out = [];
  for (const [file, text] of Object.entries(sources)) {
    const refs = file.endsWith('.css') ? referencedVars(stripCssComments(text)) : referencedVars(text);
    for (const name of refs) if (!defined.has(name)) out.push({ file, name });
  }
  return out;
}
