import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadAppModule } from './helpers/loadAppModule.js';

// Task 1 of app.js pure-logic test batch 1: data/i18n/escape helpers.
// Each test gets a fresh closure via loadAppModule() in beforeEach; the
// loader strips the trailing `init();` so no startup chain runs.
describe('app.js pure-logic helpers (batch 1, task 1)', () => {
  let app;
  let mathRandomSpy;

  beforeEach(() => {
    app = loadAppModule();
  });

  afterEach(() => {
    delete globalThis.t;
    delete globalThis.chrome;
    delete globalThis.browser;
    if (window && 'iconCache' in window) delete window.iconCache;
    if (mathRandomSpy) {
      mathRandomSpy.mockRestore();
      mathRandomSpy = null;
    }
    vi.restoreAllMocks();
  });

  describe('getDefaultData', () => {
    it('returns 3 entries with the two top-level links shaped correctly', () => {
      globalThis.t = vi.fn((key) => key);
      const data = app.getDefaultData();

      expect(data).toHaveLength(3);
      expect(data[0]).toEqual({
        id: '1', type: 'link', name: 'GitHub',
        url: 'https://github.com', icon: '', size: '1x1',
      });
      expect(data[1]).toEqual({
        id: '2', type: 'link', name: 'YouTube',
        url: 'https://youtube.com', icon: '', size: '1x1',
      });
    });

    it('returns a folder as the 3rd entry with two link children', () => {
      globalThis.t = vi.fn((key) => key);
      const data = app.getDefaultData();
      const folder = data[2];

      expect(folder.type).toBe('folder');
      expect(folder.id).toBe('3');
      expect(folder.size).toBe('1x1');
      expect(folder.name).toBe('defaults.folderName');
      expect(folder.children).toHaveLength(2);
      expect(folder.children[0].id).toBe('3-1');
      expect(folder.children[0].type).toBe('link');
      expect(folder.children[1].id).toBe('3-2');
      expect(folder.children[1].type).toBe('link');
    });

    it('resolves the folder name through t() with the expected key', () => {
      const tMock = vi.fn((key) => key);
      globalThis.t = tMock;
      app.getDefaultData();

      expect(tMock).toHaveBeenCalledWith('defaults.folderName');
    });
  });

  describe('getClockCityName', () => {
    it('returns "" for null', () => {
      globalThis.t = vi.fn((key) => key);
      expect(app.getClockCityName(null)).toBe('');
    });

    it('returns "" for undefined', () => {
      globalThis.t = vi.fn((key) => key);
      expect(app.getClockCityName(undefined)).toBe('');
    });

    it('resolves a keyed entry via t("city.<key>")', () => {
      const tMock = vi.fn((key) => key);
      globalThis.t = tMock;

      expect(app.getClockCityName({ key: 'beijing' })).toBe('city.beijing');
      expect(tMock).toHaveBeenCalledWith('city.beijing');
    });

    it('falls back to the legacy city string when no key is present', () => {
      globalThis.t = vi.fn((key) => key);
      expect(app.getClockCityName({ city: '北京' })).toBe('北京');
    });

    it('returns "" for an empty object', () => {
      globalThis.t = vi.fn((key) => key);
      expect(app.getClockCityName({})).toBe('');
    });
  });

  describe('getCityKeyForTz', () => {
    it('maps known IANA timezones to their city keys', () => {
      expect(app.getCityKeyForTz('Asia/Shanghai')).toBe('beijing');
      expect(app.getCityKeyForTz('America/Los_Angeles')).toBe('losAngeles');
      expect(app.getCityKeyForTz('Europe/London')).toBe('london');
    });

    it('returns null for an unknown timezone', () => {
      expect(app.getCityKeyForTz('Foo/Bar')).toBeNull();
    });

    it('returns null for an empty string', () => {
      expect(app.getCityKeyForTz('')).toBeNull();
    });
  });

  describe('migrateClocks', () => {
    it('returns non-array inputs unchanged', () => {
      expect(app.migrateClocks(null)).toBeNull();
      expect(app.migrateClocks(undefined)).toBeUndefined();
      expect(app.migrateClocks({})).toEqual({});
    });

    it('leaves entries that already have a key untouched', () => {
      const entry = { tz: 'Asia/Shanghai', key: 'beijing', city: '上海' };
      expect(app.migrateClocks([entry])).toEqual([entry]);
    });

    it('infers a key from a known tz and strips the legacy city', () => {
      const result = app.migrateClocks([{ tz: 'Asia/Shanghai', city: '上海' }]);
      expect(result).toEqual([{ tz: 'Asia/Shanghai', key: 'beijing' }]);
    });

    it('keeps an unknown-tz entry as-is (city retained as fallback)', () => {
      const entry = { tz: 'Foo/Bar', city: 'X' };
      expect(app.migrateClocks([entry])).toEqual([entry]);
    });

    it('passes through non-object elements unchanged', () => {
      expect(app.migrateClocks([null, 'str'])).toEqual([null, 'str']);
    });

    it('handles a mixed array of all entry shapes at once', () => {
      const input = [
        { tz: 'Asia/Shanghai', key: 'beijing' },
        { tz: 'America/Los_Angeles', city: 'LA' },
        { tz: 'Foo/Bar', city: 'X' },
        null,
        'str',
      ];
      const result = app.migrateClocks(input);
      expect(result).toEqual([
        { tz: 'Asia/Shanghai', key: 'beijing' },
        { tz: 'America/Los_Angeles', key: 'losAngeles' },
        { tz: 'Foo/Bar', city: 'X' },
        null,
        'str',
      ]);
    });
  });

  describe('generateId', () => {
    it('returns a 9-char alphanumeric string', () => {
      const id = app.generateId();
      expect(typeof id).toBe('string');
      expect(id).toHaveLength(9);
      expect(id).toMatch(/^[a-z0-9]+$/i);
    });

    it('matches Math.random().toString(36).substring(2,11) under a fixed mock', () => {
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.123456789);
      const expected = Math.random().toString(36).substring(2, 11);
      mathRandomSpy.mockReturnValue(0.123456789);
      expect(app.generateId()).toBe(expected);
    });
  });

  describe('deepClone', () => {
    it('deep-copies a nested object (equal but not same reference)', () => {
      const obj = { a: 1, b: { c: 2 } };
      const result = app.deepClone(obj);
      expect(result).toEqual(obj);
      expect(result).not.toBe(obj);
      expect(result.b).not.toBe(obj.b);
    });

    it('deep-copies nested arrays', () => {
      const arr = [1, [2, 3]];
      const result = app.deepClone(arr);
      expect(result).toEqual(arr);
      expect(result).not.toBe(arr);
      expect(result[1]).not.toBe(arr[1]);
    });

    it('drops undefined and function fields (JSON round-trip semantics)', () => {
      const result = app.deepClone({ a: undefined, b: () => {} });
      expect(result).toEqual({});
    });
  });

  describe('escapeHtml', () => {
    it('escapes <, >, & in a string', () => {
      const result = app.escapeHtml('<b>&"x"</b>');
      expect(result).toContain('&lt;b&gt;');
      expect(result).toContain('&amp;');
    });

    it('passes plain text through unchanged', () => {
      expect(app.escapeHtml('hello')).toBe('hello');
    });

    it('stringifies a number via textContent', () => {
      expect(app.escapeHtml(123)).toBe('123');
    });
  });

  describe('escapeAttr', () => {
    it('escapes all five special chars in order &, ", \', <, >', () => {
      expect(app.escapeAttr('a"b<c>d&e\'f')).toBe('a&quot;b&lt;c&gt;d&amp;e&#39;f');
    });

    it('returns "" for an empty string', () => {
      expect(app.escapeAttr('')).toBe('');
    });

    it('stringifies a number via String()', () => {
      expect(app.escapeAttr(123)).toBe('123');
    });

    it('does not escape newlines', () => {
      expect(app.escapeAttr('a\nb')).toBe('a\nb');
    });
  });

  describe('escapeCssUrl', () => {
    it('backslash-escapes ", \\, (, ) characters', () => {
      // Input JS string: a"b\c(d)e
      expect(app.escapeCssUrl('a"b\\c(d)e')).toBe('a\\"b\\\\c\\(d\\)e');
    });

    it('leaves a plain string unchanged', () => {
      expect(app.escapeCssUrl('plain')).toBe('plain');
    });

    it('returns "" for an empty string', () => {
      expect(app.escapeCssUrl('')).toBe('');
    });
  });

  // ---- Task 2: grid math + item tree + legacy storage ----

  describe('clampMainGridColumns', () => {
    it('clamps below the minimum to 6', () => {
      expect(app.clampMainGridColumns('3')).toBe(6);
    });

    it('clamps above the maximum to 12', () => {
      expect(app.clampMainGridColumns('15')).toBe(12);
    });

    it('passes in-range string values through', () => {
      expect(app.clampMainGridColumns('8')).toBe(8);
      expect(app.clampMainGridColumns('10')).toBe(10);
      expect(app.clampMainGridColumns('6')).toBe(6);
      expect(app.clampMainGridColumns('12')).toBe(12);
    });

    it('returns the default (8) when parseInt yields NaN', () => {
      expect(app.clampMainGridColumns('abc')).toBe(8);
      expect(app.clampMainGridColumns('')).toBe(8);
      expect(app.clampMainGridColumns(undefined)).toBe(8);
    });

    it('truncates numeric inputs via parseInt', () => {
      expect(app.clampMainGridColumns(7)).toBe(7);
      expect(app.clampMainGridColumns(7.9)).toBe(7);
    });
  });

  describe('getMainGridMaxWidth', () => {
    it('computes columns*80 + (columns-1)*16 for typical values', () => {
      expect(app.getMainGridMaxWidth(8)).toBe(8 * 80 + 7 * 16);
      expect(app.getMainGridMaxWidth(6)).toBe(560);
      expect(app.getMainGridMaxWidth(12)).toBe(1136);
    });

    it('handles a single column (no gaps)', () => {
      expect(app.getMainGridMaxWidth(1)).toBe(80);
    });

    it('reads the closure default mainGridColumns=8 when called with no arg', () => {
      // Fresh loadAppModule() in beforeEach resets mainGridColumns to its
      // initial DEFAULT_MAIN_GRID_COLUMNS (8), so the no-arg path is stable.
      expect(app.getMainGridMaxWidth()).toBe(752);
    });
  });

  describe('getItemSize', () => {
    it('returns valid sizes verbatim', () => {
      expect(app.getItemSize({ size: '2x2' })).toBe('2x2');
      expect(app.getItemSize({ size: '1x1' })).toBe('1x1');
      expect(app.getItemSize({ size: '4x2' })).toBe('4x2');
    });

    it('falls back to 1x1 for an unrecognized size string', () => {
      expect(app.getItemSize({ size: 'invalid' })).toBe('1x1');
    });

    it('falls back to 1x1 when size is missing', () => {
      expect(app.getItemSize({ size: undefined })).toBe('1x1');
      expect(app.getItemSize({})).toBe('1x1');
    });
  });

  describe('normalizeFolderChildItemSizes', () => {
    it('leaves valid top-level sizes untouched (changed=false)', () => {
      const result = app.normalizeFolderChildItemSizes([{ id: '1', size: '2x2' }]);
      expect(result.changed).toBe(false);
      expect(result.items[0].size).toBe('2x2');
    });

    it('normalizes an invalid top-level size to 1x1 (changed=true)', () => {
      const result = app.normalizeFolderChildItemSizes([{ id: '1', size: '9x9' }]);
      expect(result.changed).toBe(true);
      expect(result.items[0].size).toBe('1x1');
    });

    it('forces folder children to 1x1 regardless of incoming size', () => {
      const result = app.normalizeFolderChildItemSizes(
        [{ id: '1', size: '2x2' }],
        true,
      );
      expect(result.changed).toBe(true);
      expect(result.items[0].size).toBe('1x1');
    });

    it('recurses into nested folder children, forcing 1x1 inside folders', () => {
      const input = [{
        id: 'f', type: 'folder', size: '1x1',
        children: [{ id: 'c', size: '2x2' }],
      }];
      const result = app.normalizeFolderChildItemSizes(input);
      // Top-level folder size 1x1 is valid, left as-is.
      expect(result.items[0].size).toBe('1x1');
      // Child 2x2 is invalid inside a folder → 1x1.
      expect(result.items[0].children[0].size).toBe('1x1');
      expect(result.changed).toBe(true);
    });

    it('reports changed=false when the input is already normalized', () => {
      const input = [{ id: '1', size: '1x1' }];
      const result = app.normalizeFolderChildItemSizes(input);
      expect(result.changed).toBe(false);
      expect(result.items).toEqual(input);
    });

    it('returns an object with both items and changed fields', () => {
      const result = app.normalizeFolderChildItemSizes([]);
      expect(result).toHaveProperty('items');
      expect(result).toHaveProperty('changed');
    });
  });

  describe('findItem', () => {
    it('finds a top-level item by id', () => {
      expect(app.findItem([{ id: 'a' }, { id: 'b' }], 'b')).toEqual({ id: 'b' });
    });

    it('finds an item nested inside a folder', () => {
      expect(app.findItem([{ id: 'f', children: [{ id: 'c' }] }], 'c')).toEqual({ id: 'c' });
    });

    it('returns null when no match exists', () => {
      expect(app.findItem([{ id: 'a' }], 'z')).toBeNull();
    });

    it('finds items through multiple folder layers', () => {
      const list = [{
        id: 'outer', type: 'folder', children: [{
          id: 'inner', type: 'folder', children: [{ id: 'deep' }],
        }],
      }];
      expect(app.findItem(list, 'deep')).toEqual({ id: 'deep' });
    });
  });

  describe('removeItem', () => {
    it('removes and returns a top-level item', () => {
      const list = [{ id: 'a' }, { id: 'b' }];
      const removed = app.removeItem(list, 'a');
      expect(removed).toEqual({ id: 'a' });
      expect(list).toHaveLength(1);
      expect(list[0]).toEqual({ id: 'b' });
    });

    it('removes an item from a folder children array', () => {
      const list = [{ id: 'f', type: 'folder', children: [{ id: 'c1' }, { id: 'c2' }] }];
      const removed = app.removeItem(list, 'c1');
      expect(removed).toEqual({ id: 'c1' });
      expect(list[0].children).toHaveLength(1);
      expect(list[0].children[0]).toEqual({ id: 'c2' });
    });

    it('returns null and leaves the list unchanged when not found', () => {
      const list = [{ id: 'a' }];
      const removed = app.removeItem(list, 'z');
      expect(removed).toBeNull();
      expect(list).toEqual([{ id: 'a' }]);
    });
  });

  describe('insertOrCombineItem', () => {
    // The combine-wrap branch calls generateId() (Math.random based) and t().
    // t() is mocked per-test via globalThis.t; Math.random is spied here for
    // deterministic id generation. NOTE: the brief suggested mocking
    // Math.random to 0.5, but (0.5).toString(36).substring(2,11) is only one
    // char long ("i"), contradicting the brief's own "id length 9" assertion.
    // We mock to 0.123456789 instead, which yields a 9-char id — preserving
    // the brief's determinism intent AND the length-9 expectation.
    const MOCK_RANDOM = 0.123456789;

    beforeEach(() => {
      globalThis.t = vi.fn((key) => key);
      mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(MOCK_RANDOM);
    });

    it('inserts before the target via action:"before"', () => {
      const list = [{ id: 'a' }, { id: 'b' }];
      expect(app.insertOrCombineItem(list, 'a', 'before', { id: 'x' })).toBe(true);
      expect(list[0].id).toBe('x');
      expect(list[1].id).toBe('a');
    });

    it('inserts after the target via action:"after"', () => {
      const list = [{ id: 'a' }, { id: 'b' }];
      expect(app.insertOrCombineItem(list, 'a', 'after', { id: 'x' })).toBe(true);
      expect(list[1].id).toBe('x');
      expect(list[0].id).toBe('a');
    });

    it('splices a folder itemObj after the target on action:"combine"', () => {
      const list = [{ id: 'a', type: 'link' }];
      expect(app.insertOrCombineItem(list, 'a', 'combine', { id: 'x', type: 'folder' })).toBe(true);
      expect(list[1].id).toBe('x');
      expect(list[1].type).toBe('folder');
    });

    it('pushes a link itemObj into a folder target children on action:"combine"', () => {
      const list = [{ id: 'f', type: 'folder', children: [] }];
      expect(app.insertOrCombineItem(list, 'f', 'combine', { id: 'x', type: 'link' })).toBe(true);
      expect(list[0].children[0].id).toBe('x');
    });

    it('wraps two links into a new folder on action:"combine" with both as links', () => {
      const list = [{ id: 'a', type: 'link' }];
      const itemObj = { id: 'x', type: 'link' };
      expect(app.insertOrCombineItem(list, 'a', 'combine', itemObj)).toBe(true);

      const folder = list[0];
      expect(folder.type).toBe('folder');
      expect(folder.name).toBe('folder.defaultName');
      expect(folder.size).toBe('1x1');
      expect(folder.children).toHaveLength(2);
      expect(folder.children[0].id).toBe('a');
      expect(folder.children[1].id).toBe('x');
      expect(folder.id).toHaveLength(9);
      expect(globalThis.t).toHaveBeenCalledWith('folder.defaultName');
    });

    it('returns false and leaves the list unchanged when targetId is not found', () => {
      const list = [{ id: 'a' }];
      expect(app.insertOrCombineItem(list, 'z', 'before', { id: 'x' })).toBe(false);
      expect(list).toEqual([{ id: 'a' }]);
    });

    it('handles a nested target inside a folder children array', () => {
      const list = [{ id: 'f', type: 'folder', children: [{ id: 'c' }] }];
      expect(app.insertOrCombineItem(list, 'c', 'after', { id: 'x' })).toBe(true);
      expect(list[0].children[1].id).toBe('x');
    });
  });

  describe('readLegacyLocalStorage', () => {
    afterEach(() => {
      localStorage.clear();
    });

    // NOTE: the brief asserted the single-key case deep-equals the bare
    // parsed value [1,2], but readLegacyLocalStorage always returns a
    // {key: value} object keyed by the requested key name (see app.js:131).
    // The array-keys case below already reflects this shape; the single-key
    // path shares it. Test matches real behavior; brief flagged in report.
    it('reads a single key (JSON-parsed) via the sp_ prefix', () => {
      localStorage.setItem('sp_items', JSON.stringify([1, 2]));
      expect(app.readLegacyLocalStorage('items')).toEqual({ items: [1, 2] });
    });

    it('reads an array of keys into a {key: value} object', () => {
      localStorage.setItem('sp_a', JSON.stringify([1]));
      localStorage.setItem('sp_b', JSON.stringify([2]));
      expect(app.readLegacyLocalStorage(['a', 'b'])).toEqual({ a: [1], b: [2] });
    });

    it('falls back to the raw string when JSON.parse fails', () => {
      localStorage.setItem('sp_raw', 'notjson');
      expect(app.readLegacyLocalStorage('raw')).toEqual({ raw: 'notjson' });
    });

    it('omits keys that are not present in localStorage', () => {
      const result = app.readLegacyLocalStorage('missing');
      expect(result).toEqual({});
    });

    it('returns {} when localStorage is undefined', () => {
      const saved = globalThis.localStorage;
      // Setting to undefined makes `typeof localStorage === 'undefined'` true
      // (typeof reads the global binding; an explicit undefined binding reports
      // 'undefined'). Restore immediately so other tests keep a working jsdom
      // localStorage.
      Object.defineProperty(globalThis, 'localStorage', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      try {
        expect(app.readLegacyLocalStorage(['a', 'b'])).toEqual({});
      } finally {
        Object.defineProperty(globalThis, 'localStorage', {
          value: saved,
          configurable: true,
          writable: true,
        });
      }
    });
  });

  describe('removeLegacyLocalStorage', () => {
    afterEach(() => {
      localStorage.clear();
    });

    it('removes a single key via the sp_ prefix', () => {
      localStorage.setItem('sp_x', 'v');
      app.removeLegacyLocalStorage('x');
      expect(localStorage.getItem('sp_x')).toBeNull();
    });

    it('removes an array of keys', () => {
      localStorage.setItem('sp_a', '1');
      localStorage.setItem('sp_b', '2');
      app.removeLegacyLocalStorage(['a', 'b']);
      expect(localStorage.getItem('sp_a')).toBeNull();
      expect(localStorage.getItem('sp_b')).toBeNull();
    });

    it('is a noop when localStorage is undefined (does not throw)', () => {
      const saved = globalThis.localStorage;
      Object.defineProperty(globalThis, 'localStorage', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      try {
        expect(() => app.removeLegacyLocalStorage(['a', 'b'])).not.toThrow();
      } finally {
        Object.defineProperty(globalThis, 'localStorage', {
          value: saved,
          configurable: true,
          writable: true,
        });
      }
    });
  });
});