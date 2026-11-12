import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Loads one dictionary file against a stub I18N.register and returns what it
// registered. The files are IIFEs that bail out when window.I18N is missing.
function loadDict(file) {
  const store = {};
  const prev = window.I18N;
  window.I18N = { register: (lang, dict) => { store[lang] = dict; } };
  try {
    const src = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
    new Function(src)();
  } finally {
    if (prev === undefined) delete window.I18N;
    else window.I18N = prev;
  }
  const langs = Object.keys(store);
  expect(langs).toHaveLength(1);
  return store[langs[0]];
}

// { a: { b: 'x' } } -> Map('a.b' -> 'x')
function flatten(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flatten(v, key, out);
    else out.set(key, v);
  }
  return out;
}

// Placeholders like {count} must match between the two languages.
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

let zh;
let en;

beforeAll(() => {
  zh = flatten(loadDict('i18n.zh.js'));
  en = flatten(loadDict('i18n.en.js'));
});

describe('i18n dictionaries', () => {
  it('zh and en define exactly the same keys', () => {
    const onlyZh = [...zh.keys()].filter((k) => !en.has(k));
    const onlyEn = [...en.keys()].filter((k) => !zh.has(k));
    expect({ onlyZh, onlyEn }).toEqual({ onlyZh: [], onlyEn: [] });
  });

  it('every key has the same placeholders in both languages', () => {
    const mismatched = [...zh.keys()]
      .filter((k) => en.has(k))
      .filter((k) => placeholders(zh.get(k)).join() !== placeholders(en.get(k)).join());
    expect(mismatched).toEqual([]);
  });

  it('has no empty strings', () => {
    const empty = [...zh, ...en].filter(([, v]) => typeof v === 'string' && v === '').map(([k]) => k);
    expect(empty).toEqual([]);
  });
});

describe('upload-precondition sync texts', () => {
  const REQUIRED = {
    'toast.syncStorageUnavailable': ['无法读取本地同步状态，请重新打开页面',
      "Couldn't read the local sync state. Please reopen the page."],
    'toast.syncBaselineCleared': ['同步状态已在其他页面变更，请重新打开页面',
      'Sync state was changed in another tab. Please reopen the page.'],
    'toast.syncRetryExhausted': ['云端正在频繁变化，请稍后重试',
      'Cloud data is changing frequently. Please try again later.'],
    'toast.syncUpToDate': ['已是最新', 'Already up to date'],
    'dialog.syncConflict.cloudChanged': ['云端数据刚刚又有变化，上方信息已更新，请确认后重新选择。',
      'The cloud data just changed again. The details above have been updated; please review and choose again.'],
    // Reworded with the "Decide later" way out (conflict-dialog-defer, Q4).
    'dialog.syncConflict.payloadTooLarge': ['本地数据超出 100KB 上传上限，无法使用本地。可先「稍后处理」精简自定义图标，再重新打开本窗口并选「使用本地」，或改选「使用云端」。',
      'Local data exceeds the 100 KB upload limit, so it can\'t be kept. Choose "Decide later", trim custom icons, then reopen this dialog and choose "Use local", or choose "Use cloud".'],
  };

  it.each(Object.entries(REQUIRED))('%s has the agreed text in both languages', (key, [zhText, enText]) => {
    expect(zh.get(key)).toBe(zhText);
    expect(en.get(key)).toBe(enText);
  });

  it('defines the cloud-absent hint of the conflict dialog in both languages', () => {
    expect(zh.get('dialog.syncConflict.cloudAbsent')).toBeTruthy();
    expect(en.get('dialog.syncConflict.cloudAbsent')).toBeTruthy();
  });

  it('no longer defines the unreachable local-upload-failed toast', () => {
    expect(zh.has('toast.syncConflictLocalUploadFailed')).toBe(false);
    expect(en.has('toast.syncConflictLocalUploadFailed')).toBe(false);
  });
});
