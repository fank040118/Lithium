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
});