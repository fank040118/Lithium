import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadAppModule } from './helpers/loadAppModule.js';
import { createMockChromeStorage } from './helpers/mockChromeStorage.js';

// Batch 2, Task 1: storage/state — markSyncedDataChanged,
// migrateLegacyLocalStorage, loadAll.
//
// Closure-private `let` state (items/customEngines/...) cannot be set
// externally, so loadAll() is the state-populator: we mock
// chrome.storage.local BEFORE loadAppModule() (the closure `storage` const
// is built at eval time from globalThis.chrome.storage.local), then
// `await app.loadAll()` to drive state, and observe via save* probes or
// the batch-1 no-arg probe getMainGridMaxWidth().

describe('app.js storage/state (batch 2, task 1)', () => {
  let app;
  let cs;

  beforeEach(() => {
    // i18n stub: getDefaultData() resolves the folder name through t().
    globalThis.t = vi.fn((key) => key);
    cs = createMockChromeStorage({});
    globalThis.chrome = { storage: { local: cs.storage.local } };
    app = loadAppModule();
  });

  afterEach(() => {
    delete globalThis.chrome;
    delete globalThis.markLocalCloudDataChanged;
    delete globalThis.LithiumWeather;
    delete globalThis.t;
    localStorage.clear();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('markSyncedDataChanged', () => {
    it('no-op when globalThis.markLocalCloudDataChanged is not a function', async () => {
      // No mock installed; should resolve without throwing or calling anything.
      await expect(app.markSyncedDataChanged()).resolves.toBeUndefined();
      expect(globalThis.markLocalCloudDataChanged).toBeUndefined();
    });

    it('delegates to globalThis.markLocalCloudDataChanged with options', async () => {
      const mock = vi.fn().mockResolvedValue();
      globalThis.markLocalCloudDataChanged = mock;

      await app.markSyncedDataChanged({ reason: 'edit' });

      expect(mock).toHaveBeenCalledTimes(1);
      expect(mock).toHaveBeenCalledWith({ reason: 'edit' });
    });

    it('propagates rejection from markLocalCloudDataChanged', async () => {
      const mock = vi.fn().mockRejectedValue(new Error('sync failed'));
      globalThis.markLocalCloudDataChanged = mock;

      await expect(app.markSyncedDataChanged()).rejects.toThrow('sync failed');
      expect(mock).toHaveBeenCalledTimes(1);
    });
  });

  describe('migrateLegacyLocalStorage', () => {
    describe('without chrome storage', () => {
      // Override the shared setup: load app.js with no chrome so
      // extensionStorageArea is null and migrateLegacyLocalStorage early-returns.
      let appNoChrome;
      beforeEach(() => {
        delete globalThis.chrome;
        appNoChrome = loadAppModule();
      });

      it('early-returns undefined and does not touch localStorage', async () => {
        localStorage.setItem('sp_startpage_items', '[{"id":"1"}]');
        const before = localStorage.getItem('sp_startpage_items');

        await expect(appNoChrome.migrateLegacyLocalStorage()).resolves.toBeUndefined();
        // Legacy key left intact (no migration ran).
        expect(localStorage.getItem('sp_startpage_items')).toBe(before);
      });
    });

    it('early-returns when localStorage has no legacy keys (no storage.set)', async () => {
      const setSpy = vi.spyOn(cs.storage.local, 'set');

      await app.migrateLegacyLocalStorage();

      expect(setSpy).not.toHaveBeenCalled();
    });

    it('migrates a legacy key missing from chrome storage, then removes it from localStorage', async () => {
      const setSpy = vi.spyOn(cs.storage.local, 'set');
      localStorage.setItem(
        'sp_startpage_items',
        JSON.stringify([{ id: '1', size: '1x1' }]),
      );

      await app.migrateLegacyLocalStorage();

      expect(setSpy).toHaveBeenCalledWith({ startpage_items: [{ id: '1', size: '1x1' }] });
      expect(cs._data.startpage_items).toEqual([{ id: '1', size: '1x1' }]);
      expect(localStorage.getItem('sp_startpage_items')).toBeNull();
    });

    it('does not overwrite a key already present in chrome storage, but still removes the legacy localStorage key', async () => {
      // Pre-populate chrome storage with existing data.
      cs._data.startpage_items = [{ id: 'existing', size: '1x1' }];
      const setSpy = vi.spyOn(cs.storage.local, 'set');
      localStorage.setItem(
        'sp_startpage_items',
        JSON.stringify([{ id: 'legacy', size: '1x1' }]),
      );

      await app.migrateLegacyLocalStorage();

      expect(setSpy).not.toHaveBeenCalled();
      // Existing chrome data untouched.
      expect(cs._data.startpage_items).toEqual([{ id: 'existing', size: '1x1' }]);
      // Legacy key still removed.
      expect(localStorage.getItem('sp_startpage_items')).toBeNull();
    });

    it('migrates the legacy weather-cities key even though it is not in STORAGE_KEYS', async () => {
      const setSpy = vi.spyOn(cs.storage.local, 'set');
      localStorage.setItem(
        'sp_startpage_weather_cities',
        JSON.stringify([{ name: 'x', lat: 1, lon: 2 }]),
      );

      await app.migrateLegacyLocalStorage();

      expect(setSpy).toHaveBeenCalledWith({
        startpage_weather_cities: [{ name: 'x', lat: 1, lon: 2 }],
      });
      expect(cs._data.startpage_weather_cities).toEqual([{ name: 'x', lat: 1, lon: 2 }]);
      expect(localStorage.getItem('sp_startpage_weather_cities')).toBeNull();
    });
  });

  describe('loadAll', () => {
    it('empty storage -> defaults: 3 default engines, selectedEngineId="google", mainGridColumns=8, no storage.set', async () => {
      const setSpy = vi.spyOn(cs.storage.local, 'set');

      await app.loadAll();

      // items normalized from getDefaultData(); changed=false so no set.
      expect(setSpy).not.toHaveBeenCalled();
      // Engines: 3 defaults, no custom.
      expect(app.getAllEngines()).toHaveLength(3);
      expect(app.getSelectedEngine().id).toBe('google');
      // mainGridColumns=8 -> 8*80 + 7*16 = 752.
      expect(app.getMainGridMaxWidth()).toBe(752);
    });

    it('normalizes an invalid item size to 1x1 and persists via storage.set', async () => {
      cs._data.startpage_items = [{ id: '1', type: 'link', size: '9x9' }];
      const setSpy = vi.spyOn(cs.storage.local, 'set');

      await app.loadAll();

      expect(setSpy).toHaveBeenCalledWith({
        startpage_items: [{ id: '1', type: 'link', size: '1x1' }],
      });
      expect(cs._data.startpage_items[0].size).toBe('1x1');
    });

    it('loads custom engines + selectedEngineId from storage', async () => {
      cs._data.startpage_engines = [{ id: 'ddg', name: 'DuckDuckGo', url: 'u' }];
      cs._data.startpage_selected_engine = 'ddg';

      await app.loadAll();

      expect(app.getAllEngines()).toHaveLength(4);
      expect(app.getSelectedEngine().id).toBe('ddg');
    });

    it('falls back to DEFAULT_ENGINES[0] when selectedEngineId is invalid', async () => {
      cs._data.startpage_selected_engine = 'nope';

      await app.loadAll();

      expect(app.getSelectedEngine().id).toBe('google');
    });

    it('loads wallpaper without throwing and saveWallpaper persists it', async () => {
      cs._data.startpage_wallpaper = { data: 'abc' };

      await app.loadAll();
      await app.saveWallpaper();

      expect(cs._data.startpage_wallpaper).toEqual({ data: 'abc' });
    });

    it('migrates legacy clock entries (strips city, infers key) and saveClocks persists migrated shape', async () => {
      cs._data.startpage_clocks = [{ tz: 'Asia/Shanghai', city: '上海' }];

      await app.loadAll();
      await app.saveClocks();

      expect(cs._data.startpage_clocks).toEqual([{ tz: 'Asia/Shanghai', key: 'beijing' }]);
    });

    it('mainGridColumns=10 -> getMainGridMaxWidth===944', async () => {
      cs._data.startpage_grid_columns = 10;

      await app.loadAll();

      expect(app.getMainGridMaxWidth()).toBe(944);
    });

    it('mainGridColumns=99 -> clamped to 12 -> getMainGridMaxWidth===1136', async () => {
      cs._data.startpage_grid_columns = 99;

      await app.loadAll();

      expect(app.getMainGridMaxWidth()).toBe(1136);
    });

    it('migrates legacy weather cities into items and removes the legacy key', async () => {
      cs._data.startpage_weather_cities = [
        { name: '北京', lat: 39.9, lon: 116.4, tz: 'Asia/Shanghai', country: 'CN', admin1: 'Beijing' },
      ];
      const setSpy = vi.spyOn(cs.storage.local, 'set');
      const removeSpy = vi.spyOn(cs.storage.local, 'remove');

      await app.loadAll();

      // A weather item was pushed onto items and persisted.
      expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ startpage_items: expect.any(Array) }));
      const items = cs._data.startpage_items;
      expect(items.some(i => i.type === 'weather' && i.city.lat === 39.9 && i.city.lon === 116.4)).toBe(true);
      // Legacy key removed.
      expect(removeSpy).toHaveBeenCalledWith(['startpage_weather_cities']);
      expect('startpage_weather_cities' in cs._data).toBe(false);
    });

    it('does not re-push a weather city whose coords already exist in items, but still removes the legacy key', async () => {
      cs._data.startpage_items = [
        { id: 'w1', type: 'weather', size: '1x2', city: { name: '北京', lat: 39.9, lon: 116.4, tz: 'Asia/Shanghai', country: 'CN', admin1: 'Beijing' } },
      ];
      cs._data.startpage_weather_cities = [
        { name: '北京', lat: 39.9, lon: 116.4, tz: 'Asia/Shanghai', country: 'CN', admin1: 'Beijing' },
      ];
      const setSpy = vi.spyOn(cs.storage.local, 'set');
      const removeSpy = vi.spyOn(cs.storage.local, 'remove');

      await app.loadAll();

      // No new weather item pushed -> no storage.set with items.
      expect(setSpy).not.toHaveBeenCalled();
      // Legacy key still removed regardless.
      expect(removeSpy).toHaveBeenCalledWith(['startpage_weather_cities']);
      expect('startpage_weather_cities' in cs._data).toBe(false);
      // Items unchanged: still exactly one weather item.
      expect(cs._data.startpage_items.filter(i => i.type === 'weather')).toHaveLength(1);
    });
  });

  // ---- Batch 2, Task 2: save* persistence + engine getters ----
  // Closure state is populated via loadAll() (see file header note). We
  // assert on cs._data (real storage writes through the mock) and on a
  // globalThis.markLocalCloudDataChanged vi.fn to verify markSyncedDataChanged
  // is/isn't invoked. saveWallpaper and saveWallpaperEffects deliberately do
  // NOT call markSyncedDataChanged (per app.js source).

  describe('saveItems', () => {
    it('persists current items to storage and calls markSyncedDataChanged once', async () => {
      cs._data.startpage_items = [{ id: '1', type: 'link', size: '1x1' }];
      const markMock = vi.fn().mockResolvedValue();
      globalThis.markLocalCloudDataChanged = markMock;

      await app.loadAll();
      const before = cs._data.startpage_items;
      await app.saveItems();

      expect(cs._data.startpage_items).toEqual(before);
      expect(markMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('saveEngines', () => {
    it('persists customEngines and selectedEngineId, calls markSyncedDataChanged once', async () => {
      cs._data.startpage_engines = [{ id: 'x', name: 'X', url: 'u' }];
      cs._data.startpage_selected_engine = 'x';
      const markMock = vi.fn().mockResolvedValue();
      globalThis.markLocalCloudDataChanged = markMock;

      await app.loadAll();
      await app.saveEngines();

      expect(cs._data.startpage_engines).toEqual([{ id: 'x', name: 'X', url: 'u' }]);
      expect(cs._data.startpage_selected_engine).toBe('x');
      expect(markMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('saveWallpaper', () => {
    it('when wallpaper is truthy, persists it and does NOT call markSyncedDataChanged', async () => {
      cs._data.startpage_wallpaper = { data: 'abc' };
      const markMock = vi.fn().mockResolvedValue();
      globalThis.markLocalCloudDataChanged = markMock;

      await app.loadAll();
      await app.saveWallpaper();

      expect(cs._data.startpage_wallpaper).toEqual({ data: 'abc' });
      expect(markMock).not.toHaveBeenCalled();
    });

    it('when wallpaper is null, removes the startpage_wallpaper key', async () => {
      // Empty storage -> loadAll leaves wallpaper null.
      const removeSpy = vi.spyOn(cs.storage.local, 'remove');
      const markMock = vi.fn().mockResolvedValue();
      globalThis.markLocalCloudDataChanged = markMock;

      await app.loadAll();
      await app.saveWallpaper();

      expect(removeSpy).toHaveBeenCalledWith('startpage_wallpaper');
      expect(cs._data.startpage_wallpaper).toBeUndefined();
      expect(markMock).not.toHaveBeenCalled();
    });
  });

  describe('saveWallpaperEffects', () => {
    // Known limitation: wallpaperBlur/wallpaperDim are closure-private with no
    // public setter, so only the default {0, 0} state is testable here. Non-
    // default blur/dim values cannot be driven through loadAll() either (it
    // does not read startpage_wallpaper_blur/dim into the closure). Hence we
    // assert only the default-0 write path.
    it('persists default blur=0 and dim=0, does NOT call markSyncedDataChanged', async () => {
      const markMock = vi.fn().mockResolvedValue();
      globalThis.markLocalCloudDataChanged = markMock;

      await app.loadAll();
      await app.saveWallpaperEffects();

      expect(cs._data.startpage_wallpaper_blur).toBe(0);
      expect(cs._data.startpage_wallpaper_dim).toBe(0);
      expect(markMock).not.toHaveBeenCalled();
    });
  });

  describe('saveClocks', () => {
    it('persists current clocks and calls markSyncedDataChanged once', async () => {
      cs._data.startpage_clocks = [{ tz: 'Asia/Tokyo', key: 'tokyo' }];
      const markMock = vi.fn().mockResolvedValue();
      globalThis.markLocalCloudDataChanged = markMock;

      await app.loadAll();
      await app.saveClocks();

      expect(cs._data.startpage_clocks).toEqual([{ tz: 'Asia/Tokyo', key: 'tokyo' }]);
      expect(markMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('saveMainGridColumns', () => {
    it('persists current mainGridColumns and calls markSyncedDataChanged once', async () => {
      cs._data.startpage_grid_columns = 10;
      const markMock = vi.fn().mockResolvedValue();
      globalThis.markLocalCloudDataChanged = markMock;

      await app.loadAll();
      await app.saveMainGridColumns();

      expect(cs._data.startpage_grid_columns).toBe(10);
      expect(markMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('getAllEngines', () => {
    it('default (empty storage) -> 3 defaults (google/bing/duckduckgo), not same ref as DEFAULT_ENGINES', async () => {
      await app.loadAll();

      const engines = app.getAllEngines();
      expect(engines).toHaveLength(3);
      expect(engines.map(e => e.id)).toEqual(['google', 'bing', 'duckduckgo']);
      // Spread copy: not the same array reference as the closure's DEFAULT_ENGINES.
      // Two calls return distinct array instances.
      expect(app.getAllEngines()).not.toBe(engines);
    });

    it('with custom engines -> defaults + custom appended', async () => {
      cs._data.startpage_engines = [{ id: 'x', name: 'X', url: 'u' }];

      await app.loadAll();

      const engines = app.getAllEngines();
      expect(engines).toHaveLength(4);
      expect(engines[3]).toEqual({ id: 'x', name: 'X', url: 'u' });
    });
  });

  describe('getSelectedEngine', () => {
    it('default -> DEFAULT_ENGINES[0] (google)', async () => {
      await app.loadAll();

      expect(app.getSelectedEngine().id).toBe('google');
    });

    it('selected custom engine -> returns that engine', async () => {
      cs._data.startpage_engines = [{ id: 'x', name: 'X', url: 'u' }];
      cs._data.startpage_selected_engine = 'x';

      await app.loadAll();

      expect(app.getSelectedEngine()).toEqual({ id: 'x', name: 'X', url: 'u' });
    });

    it('invalid selectedEngineId -> falls back to DEFAULT_ENGINES[0]', async () => {
      cs._data.startpage_selected_engine = 'nope';

      await app.loadAll();

      expect(app.getSelectedEngine().id).toBe('google');
    });
  });
});