import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadAppModule } from './helpers/loadAppModule.js';

// Task 3 of app.js pure-logic test batch 1: URL / timezone / weather / favicon
// helpers (12 functions). Each test gets a fresh closure via loadAppModule()
// in beforeEach; the loader strips the trailing `init();` so no startup chain
// runs. Closure-private state (e.g. `_faviconApiSupported`) resets per load,
// which `hasFaviconApi`'s cache test relies on.
describe('app.js pure-logic helpers (batch 1, task 3)', () => {
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

  describe('isValidUrl', () => {
    it('accepts http/https URLs', () => {
      expect(app.isValidUrl('https://example.com')).toBe(true);
      expect(app.isValidUrl('http://x')).toBe(true);
      expect(app.isValidUrl('https://a.b/c?d=1#e')).toBe(true);
    });

    it('rejects non-http(s) protocols', () => {
      expect(app.isValidUrl('ftp://x')).toBe(false);
      expect(app.isValidUrl('javascript:alert(1)')).toBe(false);
      expect(app.isValidUrl('file:///x')).toBe(false);
    });

    it('rejects non-URL strings and empty input', () => {
      expect(app.isValidUrl('not a url')).toBe(false);
      expect(app.isValidUrl('')).toBe(false);
    });

    // NOTE: the brief asserted `isValidUrl('http://') === true`, claiming
    // WHATWG URL accepts a bare `http://`. In practice both Node's and jsdom's
    // URL constructor throw on `http://` (empty host on a special scheme is a
    // parse failure), so the implementation's try/catch returns false. The
    // brief itself says "按实现真实行为断言" — assert real behavior — so we
    // assert false here and flag the discrepancy in the task report.
    it('returns false for "http://" (URL constructor throws on empty host)', () => {
      expect(app.isValidUrl('http://')).toBe(false);
    });
  });

  describe('getContinentForTz', () => {
    it('maps each inhabited continent prefix', () => {
      expect(app.getContinentForTz('Asia/Shanghai')).toBe('asia');
      expect(app.getContinentForTz('Europe/Paris')).toBe('europe');
      expect(app.getContinentForTz('America/New_York')).toBe('americas');
      expect(app.getContinentForTz('Australia/Sydney')).toBe('oceania');
      expect(app.getContinentForTz('Pacific/Auckland')).toBe('oceania');
      expect(app.getContinentForTz('Africa/Cairo')).toBe('africa');
    });

    it('returns "other" for unknown regions and empty input', () => {
      expect(app.getContinentForTz('Foo/Bar')).toBe('other');
      expect(app.getContinentForTz('')).toBe('other');
    });
  });

  describe('parseUtcOffsetMinutes', () => {
    it('parses signed hour and hour:minute offsets', () => {
      expect(app.parseUtcOffsetMinutes('+8')).toBe(480);
      expect(app.parseUtcOffsetMinutes('-5')).toBe(-300);
      expect(app.parseUtcOffsetMinutes('+5:30')).toBe(330);
      expect(app.parseUtcOffsetMinutes('-10:00')).toBe(-600);
      expect(app.parseUtcOffsetMinutes('+0')).toBe(0);
      // sign=-1 * 0 yields -0; Object.is(-0, 0) is false, so assert -0 verbatim
      // (numerically -0 === 0, matching the brief's "-0 → 0" intent).
      expect(app.parseUtcOffsetMinutes('-0')).toBe(-0);
    });

    it('returns 0 for non-matching inputs (no sign, bare plus, garbage)', () => {
      expect(app.parseUtcOffsetMinutes('abc')).toBe(0);
      expect(app.parseUtcOffsetMinutes('')).toBe(0);
      expect(app.parseUtcOffsetMinutes('8')).toBe(0);
      expect(app.parseUtcOffsetMinutes('+')).toBe(0);
    });
  });

  describe('getTimezoneOffset', () => {
    // Fixed date so DST is deterministic: January in northern hemisphere
    // gives standard time for America/Los_Angeles (PST, UTC-8).
    const DATE = new Date('2024-01-01T00:00:00Z');

    it('returns the short-offset token for known timezones', () => {
      expect(app.getTimezoneOffset('Asia/Shanghai', DATE)).toBe('+8');
      expect(app.getTimezoneOffset('Asia/Kolkata', DATE)).toBe('+5:30');
      expect(app.getTimezoneOffset('America/Los_Angeles', DATE)).toBe('-8');
    });

    it('returns "" for an invalid timezone (caught)', () => {
      expect(app.getTimezoneOffset('Invalid/Zone', DATE)).toBe('');
    });

    it('produces values matching /^[+-]\\d+:?\\d*$/', () => {
      for (const tz of ['Asia/Shanghai', 'Asia/Kolkata', 'America/Los_Angeles']) {
        expect(app.getTimezoneOffset(tz, DATE)).toMatch(/^[+-]\d+:?\d*$/);
      }
    });
  });

  describe('getWeatherCitiesFromItems', () => {
    it('extracts city objects from weather items', () => {
      const items = [{ type: 'weather', city: { name: 'A', lat: 1.1, lon: 2.2, tz: 'auto' } }];
      expect(app.getWeatherCitiesFromItems(items))
        .toEqual([{ name: 'A', lat: 1.1, lon: 2.2, tz: 'auto' }]);
    });

    it('walks into folder children and skips non-weather items', () => {
      const items = [
        { type: 'link', url: 'x' },
        { type: 'folder', children: [{ type: 'weather', city: { name: 'B', lat: 3, lon: 4, tz: 'auto' } }] },
      ];
      expect(app.getWeatherCitiesFromItems(items))
        .toEqual([{ name: 'B', lat: 3, lon: 4, tz: 'auto' }]);
    });

    it('deduplicates by lat|lon|tz', () => {
      const items = [
        { type: 'weather', city: { name: 'A', lat: 1.1, lon: 2.2, tz: 'auto' } },
        { type: 'weather', city: { name: 'A2', lat: 1.1, lon: 2.2, tz: 'auto' } },
      ];
      expect(app.getWeatherCitiesFromItems(items)).toHaveLength(1);
    });

    it('treats same coordinates with different tz as distinct', () => {
      const items = [
        { type: 'weather', city: { name: 'A', lat: 1.1, lon: 2.2, tz: 'Asia/Shanghai' } },
        { type: 'weather', city: { name: 'B', lat: 1.1, lon: 2.2, tz: 'Asia/Tokyo' } },
      ];
      expect(app.getWeatherCitiesFromItems(items)).toHaveLength(2);
    });

    it('skips weather items without a city field', () => {
      expect(app.getWeatherCitiesFromItems([{ type: 'weather' }])).toEqual([]);
    });

    it('returns [] for null / undefined / []', () => {
      expect(app.getWeatherCitiesFromItems(null)).toEqual([]);
      expect(app.getWeatherCitiesFromItems(undefined)).toEqual([]);
      expect(app.getWeatherCitiesFromItems([])).toEqual([]);
    });
  });

  describe('bindCityToItem', () => {
    it('maps a full location onto item.city and mutates the item in place', () => {
      const item = {};
      const location = {
        name: '北京', latitude: 39.9, longitude: 116.4,
        timezone: 'Asia/Shanghai', country: 'CN', admin1: 'Beijing',
      };
      app.bindCityToItem(item, location);
      expect(item.city).toEqual({
        name: '北京', lat: 39.9, lon: 116.4, tz: 'Asia/Shanghai',
        country: 'CN', admin1: 'Beijing',
      });
    });

    it('defaults tz to "auto" when location has no timezone', () => {
      const item = {};
      app.bindCityToItem(item, { name: 'X', latitude: 1, longitude: 2 });
      expect(item.city.tz).toBe('auto');
    });

    it('defaults country/admin1 to "" when missing', () => {
      const item = {};
      app.bindCityToItem(item, { name: 'X', latitude: 1, longitude: 2, timezone: 'auto' });
      expect(item.city.country).toBe('');
      expect(item.city.admin1).toBe('');
    });
  });

  describe('getGridItemMetrics', () => {
    it('computes wrap/card sizes for each FOLDER_SLOT_LAYOUTS entry at colWidth=80, gap=16', () => {
      const g = (size) => app.getGridItemMetrics(size, 80, 16);
      expect(g('1x2')).toEqual({ wrapHeight: 80, cardWidth: 160, cardHeight: 64 });
      expect(g('2x2')).toEqual({ wrapHeight: 176, cardWidth: 160, cardHeight: 160 });
      expect(g('2x4')).toEqual({ wrapHeight: 176, cardWidth: 352, cardHeight: 160 });
      expect(g('4x2')).toEqual({ wrapHeight: 368, cardWidth: 160, cardHeight: 352 });
      expect(g('2x1')).toEqual({ wrapHeight: 176, cardWidth: 64, cardHeight: 160 });
    });

    it('uses baseCard=min(colWidth,64) when colWidth < 64', () => {
      const r = app.getGridItemMetrics('1x2', 50, 16);
      // baseCard=50; wrapHeight=1*50+0=50; cardWidth=(1)*(50+16)+50=116; cardHeight=50
      expect(r).toEqual({ wrapHeight: 50, cardWidth: 116, cardHeight: 50 });
    });

    it('returns {wrapHeight:null, cardWidth:baseCard, cardHeight:baseCard} for unknown sizes including "1x1"', () => {
      const base = (size) => app.getGridItemMetrics(size, 80, 16);
      expect(base('9x9')).toEqual({ wrapHeight: null, cardWidth: 64, cardHeight: 64 });
      // '1x1' is intentionally NOT in FOLDER_SLOT_LAYOUTS.
      expect(base('1x1')).toEqual({ wrapHeight: null, cardWidth: 64, cardHeight: 64 });
    });
  });

  describe('buildManagedImageTag', () => {
    it('emits src/alt/data-managed-img/data-error-mode with default errorMode="hide"', () => {
      const out = app.buildManagedImageTag({ src: 'https://x.com/i.png' });
      expect(out.startsWith('<img ')).toBe(true);
      expect(out.endsWith('>')).toBe(true);
      expect(out).toContain('src="https://x.com/i.png"');
      expect(out).toContain('alt=""');
      expect(out).toContain('data-managed-img="true"');
      expect(out).toContain('data-error-mode="hide"');
      expect(out).not.toContain('style=');
      expect(out).not.toContain('data-fallback-src=');
    });

    it('includes style and data-fallback-src only when provided', () => {
      const out = app.buildManagedImageTag({ src: 'a', style: 'w:1', fallbackSrc: 'b', errorMode: 'remove' });
      expect(out).toContain('style="w:1"');
      expect(out).toContain('data-fallback-src="b"');
      expect(out).toContain('data-error-mode="remove"');
    });

    it('escapes attribute values via escapeAttr', () => {
      const out = app.buildManagedImageTag({ src: 'a"b' });
      expect(out).toContain('src="a&quot;b"');
    });
  });

  describe('getWallpaperUploadErrorMessage', () => {
    beforeEach(() => {
      globalThis.t = vi.fn((key) => key);
    });

    it('returns the quota key when the message mentions quota/storage/space', () => {
      expect(app.getWallpaperUploadErrorMessage({ message: 'Storage quota exceeded' }))
        .toBe('toast.wallpaperSaveFailedQuota');
      expect(app.getWallpaperUploadErrorMessage({ message: 'out of space' }))
        .toBe('toast.wallpaperSaveFailedQuota');
      expect(app.getWallpaperUploadErrorMessage({ message: 'storage full' }))
        .toBe('toast.wallpaperSaveFailedQuota');
    });

    it('returns the generic key for other errors, bare strings, null, undefined, and {}', () => {
      expect(app.getWallpaperUploadErrorMessage({ message: 'network error' }))
        .toBe('toast.wallpaperSaveFailedGeneric');
      expect(app.getWallpaperUploadErrorMessage('some string'))
        .toBe('toast.wallpaperSaveFailedGeneric');
      expect(app.getWallpaperUploadErrorMessage(null))
        .toBe('toast.wallpaperSaveFailedGeneric');
      expect(app.getWallpaperUploadErrorMessage(undefined))
        .toBe('toast.wallpaperSaveFailedGeneric');
      expect(app.getWallpaperUploadErrorMessage({}))
        .toBe('toast.wallpaperSaveFailedGeneric');
    });

    it('invokes t() with the resolved key', () => {
      globalThis.t = vi.fn((key) => key);
      app.getWallpaperUploadErrorMessage({ message: 'storage full' });
      expect(globalThis.t).toHaveBeenCalledWith('toast.wallpaperSaveFailedQuota');

      globalThis.t = vi.fn((key) => key);
      app.getWallpaperUploadErrorMessage({ message: 'network error' });
      expect(globalThis.t).toHaveBeenCalledWith('toast.wallpaperSaveFailedGeneric');
    });
  });

  describe('getFavicon', () => {
    // `_faviconApiSupported` is closure-private and reset by the fresh
    // loadAppModule() in beforeEach, so each test sets up its chrome/iconCache
    // mock before calling.
    it('returns "" for an empty url', () => {
      expect(app.getFavicon('')).toBe('');
    });

    it('returns "" for an invalid url (caught)', () => {
      expect(app.getFavicon('not a url')).toBe('');
    });

    it('uses the chrome favicon API when the favicon permission is present', () => {
      globalThis.chrome = {
        runtime: {
          getManifest: () => ({ permissions: ['favicon'] }),
          getURL: (p) => 'chrome-ext://' + p,
        },
      };
      expect(app.getFavicon('https://example.com'))
        .toBe('chrome-ext://_favicon/?pageUrl=https%3A%2F%2Fexample.com&size=64');
    });

    it('falls back to iconCache.getRemoteFaviconUrl when no favicon API but iconCache exists', () => {
      globalThis.chrome = { runtime: { getManifest: () => ({ permissions: [] }), getURL: () => '' } };
      window.iconCache = { getRemoteFaviconUrl: (host, size) => 'https://icon/' + host + '/' + size };
      expect(app.getFavicon('https://example.com')).toBe('https://icon/example.com/64');
    });

    it('returns "" when neither favicon API nor iconCache is available', () => {
      globalThis.chrome = { runtime: { getManifest: () => ({ permissions: [] }), getURL: () => '' } };
      window.iconCache = undefined;
      expect(app.getFavicon('https://example.com')).toBe('');
    });
  });

  describe('getFaviconFallback', () => {
    it('returns "" for an empty url', () => {
      expect(app.getFaviconFallback('')).toBe('');
    });

    it('returns "" for an invalid url (caught)', () => {
      expect(app.getFaviconFallback('not a url')).toBe('');
    });

    it('uses iconCache.getRemoteFallbackFaviconUrl when available', () => {
      window.iconCache = { getRemoteFallbackFaviconUrl: (host) => 'https://fh/' + host };
      expect(app.getFaviconFallback('https://example.com')).toBe('https://fh/example.com');
    });

    it('returns "" when iconCache is not available', () => {
      window.iconCache = undefined;
      expect(app.getFaviconFallback('https://example.com')).toBe('');
    });
  });

  describe('hasFaviconApi', () => {
    // Each scenario gets a fresh module (beforeEach) so the closure-private
    // `_faviconApiSupported` cache starts at null.
    it('returns true when chrome.runtime exposes the favicon permission + getURL', () => {
      globalThis.chrome = {
        runtime: {
          getManifest: () => ({ permissions: ['favicon'] }),
          getURL: () => '',
        },
      };
      expect(app.hasFaviconApi()).toBe(true);
    });

    it('returns false when the favicon permission is absent', () => {
      globalThis.chrome = {
        runtime: { getManifest: () => ({ permissions: [] }), getURL: () => '' },
      };
      expect(app.hasFaviconApi()).toBe(false);
    });

    it('returns false when chrome.runtime is undefined', () => {
      delete globalThis.chrome;
      expect(app.hasFaviconApi()).toBe(false);
    });

    it('returns false when getManifest throws', () => {
      globalThis.chrome = {
        runtime: {
          getManifest: () => { throw new Error('x'); },
          getURL: () => '',
        },
      };
      expect(app.hasFaviconApi()).toBe(false);
    });

    it('returns false when runtime lacks getURL', () => {
      globalThis.chrome = {
        runtime: { getManifest: () => ({ permissions: ['favicon'] }) },
      };
      expect(app.hasFaviconApi()).toBe(false);
    });

    it('caches the true result: a second call returns true even after runtime is removed', () => {
      globalThis.chrome = {
        runtime: {
          getManifest: () => ({ permissions: ['favicon'] }),
          getURL: () => '',
        },
      };
      expect(app.hasFaviconApi()).toBe(true);
      delete globalThis.chrome;
      // Cached: should not re-read runtime, still true.
      expect(app.hasFaviconApi()).toBe(true);
    });
  });
});