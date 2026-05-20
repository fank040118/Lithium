// Lithium i18n core (runtime UI strings)
//
// Scope: drives in-page UI text. Dictionaries live in i18n.zh.js / i18n.en.js
// and register into this module at load time.
//
// NOT to be confused with _locales/{en,zh_CN}/messages.json — those exist only
// to localize manifest.json placeholders (__MSG_extName__, __MSG_extDesc__)
// shown by the browser in the extensions list and store. They are not loaded
// at runtime and do not feed t().
//
// Usage:
//   I18N.register('zh-CN', { ... });
//   I18N.t('sidebar.title.gridColumns');               // -> '主页列数'
//   I18N.t('toast.iconRefreshedCount', { count: 3 });  // -> '已刷新 3 个图标'
//   I18N.setLang('en');                                // re-apply DOM + emit event
//   window.addEventListener('lithium:langchange', () => { ... });
//
// DOM annotation attributes (any combination, applied in one pass):
//   data-i18n="key"                       -> textContent
//   data-i18n-html="key"                  -> innerHTML (use sparingly, only for trusted text)
//
// SECURITY INVARIANT (data-i18n-html):
//   t() values used by data-i18n-html are written to innerHTML verbatim.
//   Dictionaries MUST stay hard-coded in i18n.*.js source files — never
//   load translations from network, user input, storage, or cloud sync.
//   If that ever changes, audit every data-i18n-html call-site and either
//   strip tags here or move it to a sanitizer (e.g. DOMPurify) before
//   relaxing this invariant.
//   data-i18n-placeholder="key"           -> placeholder attribute
//   data-i18n-aria-label="key"            -> aria-label attribute
//   data-i18n-title="key"                 -> title attribute
//   data-i18n-attr="attr1:key1,attr2:key2"-> arbitrary attributes
(function (global) {
  'use strict';

  const STORAGE_KEY = 'lithium.lang';
  const SUPPORTED = ['zh-CN', 'en'];
  const FALLBACK = 'zh-CN';

  const dictionaries = Object.create(null);
  let currentLang = FALLBACK;
  let initialized = false;
  const listeners = new Set();

  function register(lang, dict) {
    if (!lang || typeof dict !== 'object') return;
    dictionaries[lang] = dict;
  }

  function getNested(obj, key) {
    if (!obj || typeof key !== 'string') return undefined;
    const parts = key.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length; i += 1) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function interpolate(str, vars) {
    if (!vars || typeof str !== 'string') return str;
    return str.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
  }

  function t(key, vars) {
    if (!key) return '';
    let val = getNested(dictionaries[currentLang], key);
    if (val == null && currentLang !== FALLBACK) {
      val = getNested(dictionaries[FALLBACK], key);
    }
    if (val == null) return key;
    return interpolate(val, vars);
  }

  // Default rule: any Chinese variant (zh / zh-CN / zh-TW / zh-HK / zh-Hans /
  // zh-Hant / ...) → zh-CN; everything else → en. We deliberately do NOT
  // fall back to zh-CN for unknown locales — most non-Chinese users would
  // rather see English than an unfamiliar language.
  function detectBrowserLang() {
    const cands = [];
    if (Array.isArray(navigator.languages)) cands.push(...navigator.languages);
    if (navigator.language) cands.push(navigator.language);
    for (const c of cands) {
      if (!c) continue;
      const low = String(c).toLowerCase();
      if (low === 'zh' || low.startsWith('zh-') || low.startsWith('zh_')) return 'zh-CN';
    }
    return 'en';
  }

  function detectInitialLang() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && SUPPORTED.indexOf(saved) !== -1) return saved;
    } catch (e) { /* localStorage may be disabled */ }
    return detectBrowserLang();
  }

  function applyDom(root) {
    const scope = root || document;
    if (!scope || !scope.querySelectorAll) return;
    scope.querySelectorAll('[data-i18n]').forEach((el) => {
      const k = el.getAttribute('data-i18n');
      if (k) el.textContent = t(k);
    });
    scope.querySelectorAll('[data-i18n-html]').forEach((el) => {
      const k = el.getAttribute('data-i18n-html');
      if (k) el.innerHTML = t(k);
    });
    scope.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const k = el.getAttribute('data-i18n-placeholder');
      if (k) el.setAttribute('placeholder', t(k));
    });
    scope.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
      const k = el.getAttribute('data-i18n-aria-label');
      if (k) el.setAttribute('aria-label', t(k));
    });
    scope.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const k = el.getAttribute('data-i18n-title');
      if (k) el.setAttribute('title', t(k));
    });
    scope.querySelectorAll('[data-i18n-attr]').forEach((el) => {
      const spec = el.getAttribute('data-i18n-attr');
      if (!spec) return;
      spec.split(',').forEach((pair) => {
        const idx = pair.indexOf(':');
        if (idx <= 0) return;
        const attr = pair.slice(0, idx).trim();
        const key = pair.slice(idx + 1).trim();
        if (attr && key) el.setAttribute(attr, t(key));
      });
    });
  }

  function setLang(lang, opts) {
    if (!lang || SUPPORTED.indexOf(lang) === -1) return;
    if (lang === currentLang && initialized) return;
    currentLang = lang;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) { /* ignore */ }
    if (document.documentElement) document.documentElement.lang = lang;
    if (!opts || opts.applyDom !== false) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => applyDom(), { once: true });
      } else {
        applyDom();
      }
    }
    listeners.forEach((fn) => {
      try { fn(lang); } catch (e) { console.error('[i18n] listener error', e); }
    });
    try {
      window.dispatchEvent(new CustomEvent('lithium:langchange', { detail: { lang } }));
    } catch (e) { /* CustomEvent may not be available in unusual envs */ }
  }

  function getLang() { return currentLang; }
  function getSupported() { return SUPPORTED.slice(); }
  function getNextLang() {
    const idx = SUPPORTED.indexOf(currentLang);
    return SUPPORTED[(idx + 1) % SUPPORTED.length];
  }

  function onChange(fn) {
    if (typeof fn !== 'function') return () => {};
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  // Initialize as early as possible: detect language and set <html lang>.
  // DOM substitution waits until DOMContentLoaded (or runs now if already loaded).
  function init() {
    if (initialized) return;
    currentLang = detectInitialLang();
    if (document.documentElement) document.documentElement.lang = currentLang;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => applyDom(), { once: true });
    } else {
      applyDom();
    }
    initialized = true;
  }

  global.I18N = {
    register, t, setLang, getLang, getSupported, getNextLang,
    onChange, applyDom, init, FALLBACK, STORAGE_KEY,
  };
  // Short alias for terser call-sites
  global.t = t;

  // Auto-init once this file is loaded — dictionaries register before init
  // by virtue of being loaded earlier in the page. Calling init() is also
  // idempotent, so dictionary files / app code can safely call it again.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  }
  // Defer init() to a microtask so dictionary scripts loaded right after this
  // file can register before applyDom runs.
  Promise.resolve().then(init);
})(window);
