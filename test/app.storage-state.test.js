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

      // The shape sanitizer also fills a string `name` here (renderIcon reads
      // name.charAt(0), so a missing name must not survive a load).
      expect(setSpy).toHaveBeenCalledWith({
        startpage_items: [{ id: '1', type: 'link', name: '', size: '1x1' }],
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
        // Fully-shaped weather item (name included): the sanitizer must have
        // nothing to repair, so this test observes only the dedupe path.
        { id: 'w1', type: 'weather', name: '北京', size: '1x2', city: { name: '北京', lat: 39.9, lon: 116.4, tz: 'Asia/Shanghai', country: 'CN', admin1: 'Beijing' } },
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

  // ---- Batch 2, Task 3: weather cross-module + grid-columns coordinator ----
  // pruneWeatherCache / fetchWeatherForAllCities reach out to a free var
  // `LithiumWeather` (resolved against globalThis). updateGridColumnsControls
  // touches light-DOM controls. setMainGridColumns coordinates four downstream
  // helpers (applyMainGridColumns / updateGridItemSizes / updateGridColumnsControls
  // / saveMainGridColumns); because app.js is loaded via sloppy indirect eval,
  // those function declarations attach to globalThis, so reassigning
  // globalThis.<name> = vi.fn() AFTER loadAppModule intercepts the internal
  // calls. Closure mainGridColumns is observed via the no-arg probe
  // getMainGridMaxWidth() (8->752, 10->944, 12->1136).

  describe('pruneWeatherCache', () => {
    it('no-op (no throw) when LithiumWeather is undefined and items empty', async () => {
      expect(globalThis.LithiumWeather).toBeUndefined();
      await app.loadAll();

      await expect(app.pruneWeatherCache()).resolves.toBeUndefined();
    });

    it('calls LithiumWeather.pruneCache with the city array derived from weather items', async () => {
      const pruneCache = vi.fn();
      globalThis.LithiumWeather = { pruneCache };
      cs._data.startpage_items = [
        { id: 'w', type: 'weather', size: '1x1', city: { name: '北京', lat: 39.9, lon: 116.4, tz: 'Asia/Shanghai' } },
      ];

      await app.loadAll();
      await app.pruneWeatherCache();

      expect(pruneCache).toHaveBeenCalledTimes(1);
      expect(pruneCache).toHaveBeenCalledWith([
        { name: '北京', lat: 39.9, lon: 116.4, tz: 'Asia/Shanghai' },
      ]);
    });

    it('calls pruneCache with an empty array when items contain no weather item', async () => {
      const pruneCache = vi.fn();
      globalThis.LithiumWeather = { pruneCache };
      cs._data.startpage_items = [{ id: 'l', type: 'link', size: '1x1' }];

      await app.loadAll();
      await app.pruneWeatherCache();

      expect(pruneCache).toHaveBeenCalledTimes(1);
      expect(pruneCache).toHaveBeenCalledWith([]);
    });
  });

  describe('fetchWeatherForAllCities', () => {
    it('empty items -> returns [] and does not touch LithiumWeather', async () => {
      const getForecastForCities = vi.fn();
      globalThis.LithiumWeather = { getForecastForCities };

      await app.loadAll();
      const result = await app.fetchWeatherForAllCities();

      expect(result).toEqual([]);
      expect(getForecastForCities).not.toHaveBeenCalled();
    });

    it('LithiumWeather undefined + weather item -> returns [] and warns without throwing', async () => {
      expect(globalThis.LithiumWeather).toBeUndefined();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      cs._data.startpage_items = [
        { id: 'w', type: 'weather', size: '1x1', city: { name: 'x', lat: 1, lon: 2, tz: 'auto' } },
      ];

      await app.loadAll();
      const result = await app.fetchWeatherForAllCities();

      expect(result).toEqual([]);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('LithiumWeather.getForecastForCities resolves -> returns its result, called once with cities', async () => {
      const getForecastForCities = vi.fn().mockResolvedValue(['forecast1', 'forecast2']);
      globalThis.LithiumWeather = { getForecastForCities };
      cs._data.startpage_items = [
        { id: 'w', type: 'weather', size: '1x1', city: { name: '北京', lat: 39.9, lon: 116.4, tz: 'Asia/Shanghai' } },
      ];

      await app.loadAll();
      const result = await app.fetchWeatherForAllCities();

      expect(result).toEqual(['forecast1', 'forecast2']);
      expect(getForecastForCities).toHaveBeenCalledTimes(1);
      expect(getForecastForCities).toHaveBeenCalledWith([
        { name: '北京', lat: 39.9, lon: 116.4, tz: 'Asia/Shanghai' },
      ]);
    });

    it('getForecastForCities rejects -> catch returns [] and warns without throwing', async () => {
      const getForecastForCities = vi.fn().mockRejectedValue(new Error('boom'));
      globalThis.LithiumWeather = { getForecastForCities };
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      cs._data.startpage_items = [
        { id: 'w', type: 'weather', size: '1x1', city: { name: 'x', lat: 1, lon: 2, tz: 'auto' } },
      ];

      await app.loadAll();
      const result = await app.fetchWeatherForAllCities();

      expect(result).toEqual([]);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateGridColumnsControls', () => {
    it('writes mainGridColumns into the slider value and text label', async () => {
      document.body.innerHTML = '<input id="grid-columns-range"><span id="grid-columns-value"></span>';
      cs._data.startpage_grid_columns = 10;

      await app.loadAll();
      app.updateGridColumnsControls();

      expect(document.querySelector('#grid-columns-range').value).toBe('10');
      expect(document.querySelector('#grid-columns-value').textContent).toBe('10');
    });

    it('empty body (controls absent) -> no throw (if-null guards)', async () => {
      document.body.innerHTML = '';
      await app.loadAll();

      expect(() => app.updateGridColumnsControls()).not.toThrow();
    });
  });

  describe('setMainGridColumns', () => {
    // Intercept the four downstream helpers. Installed AFTER loadAppModule()
    // so the reassignment targets the global binding the closure resolves
    // (sloppy indirect eval puts function declarations on globalThis, so a
    // bare-identifier call inside setMainGridColumns hits the overridden vi.fn).
    // loadAll() does not call any of these four, so the ordering relative to
    // loadAll is not load-bearing — only relative to loadAppModule matters.
    // Cleanup deletes the overrides so the shared afterEach's
    // vi.restoreAllMocks() + next beforeEach's loadAppModule() see clean state.
    let applyMainGridColumns, updateGridItemSizes, updateGridColumnsControls, saveMainGridColumns;

    beforeEach(async () => {
      await app.loadAll(); // empty storage -> mainGridColumns = 8 (default)
      applyMainGridColumns = vi.fn();
      updateGridItemSizes = vi.fn();
      updateGridColumnsControls = vi.fn();
      saveMainGridColumns = vi.fn();
      globalThis.applyMainGridColumns = applyMainGridColumns;
      globalThis.updateGridItemSizes = updateGridItemSizes;
      globalThis.updateGridColumnsControls = updateGridColumnsControls;
      globalThis.saveMainGridColumns = saveMainGridColumns;
    });

    afterEach(() => {
      delete globalThis.applyMainGridColumns;
      delete globalThis.updateGridItemSizes;
      delete globalThis.updateGridColumnsControls;
      delete globalThis.saveMainGridColumns;
    });

    it('value=10, persist=false: non-equal branch -> applyMainGridColumns + updateGridItemSizes called; updateGridColumnsControls + saveMainGridColumns NOT; closure now 10', () => {
      app.setMainGridColumns(10, false);

      expect(applyMainGridColumns).toHaveBeenCalledTimes(1);
      expect(updateGridItemSizes).toHaveBeenCalledTimes(1);
      expect(updateGridColumnsControls).not.toHaveBeenCalled();
      expect(saveMainGridColumns).not.toHaveBeenCalled();
      expect(app.getMainGridMaxWidth()).toBe(944);
    });

    it('value=8 (=default), persist=false: equal branch -> updateGridColumnsControls called; applyMainGridColumns + updateGridItemSizes NOT; closure unchanged (752)', () => {
      app.setMainGridColumns(8, false);

      expect(updateGridColumnsControls).toHaveBeenCalledTimes(1);
      expect(applyMainGridColumns).not.toHaveBeenCalled();
      expect(updateGridItemSizes).not.toHaveBeenCalled();
      expect(saveMainGridColumns).not.toHaveBeenCalled();
      expect(app.getMainGridMaxWidth()).toBe(752);
    });

    it('value=10, persist=true: non-equal branch -> saveMainGridColumns called once; applyMainGridColumns called', () => {
      app.setMainGridColumns(10, true);

      expect(saveMainGridColumns).toHaveBeenCalledTimes(1);
      expect(applyMainGridColumns).toHaveBeenCalledTimes(1);
    });

    it("value='15' -> clamped to 12 -> closure 12 (getMainGridMaxWidth===1136)", () => {
      app.setMainGridColumns('15', false);

      expect(app.getMainGridMaxWidth()).toBe(1136);
    });

    it("value='abc' -> clamped to 8 (=default) -> equal branch: applyMainGridColumns NOT called, updateGridColumnsControls called", () => {
      app.setMainGridColumns('abc', false);

      expect(applyMainGridColumns).not.toHaveBeenCalled();
      expect(updateGridColumnsControls).toHaveBeenCalledTimes(1);
    });
  });

  // ---- P2 residual hardening, Task 3: storage failure firewall ----
  // When the initial read fails, loadAll() rejects and init() falls back to
  // in-memory defaults. To keep those defaults from overwriting the real
  // stored data on the next edit, loadAll() raises the module-level
  // `storageLoadFailed` flag on a read failure (rethrowing the original error)
  // and lowers it again on the next successful read. While raised, storage.set
  // refuses to write and markSyncedDataChanged() refuses to mark/upload.

  describe('storage failure firewall (P2 task 3)', () => {
    it('blocks storage writes and sync marking after a failed loadAll()', async () => {
      vi.spyOn(cs.storage.local, 'get').mockRejectedValue(new Error('read failed'));
      const setSpy = vi.spyOn(cs.storage.local, 'set');
      const markMock = vi.fn().mockResolvedValue();
      globalThis.markLocalCloudDataChanged = markMock;
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(app.loadAll()).rejects.toThrow('read failed');

      await app.saveItems();
      await app.saveClocks();
      await app.markSyncedDataChanged({ reason: 'edit' });

      expect(setSpy).not.toHaveBeenCalled();
      expect(markMock).not.toHaveBeenCalled();
    });

    it('clears the block once a later loadAll() read succeeds', async () => {
      vi.spyOn(cs.storage.local, 'get').mockRejectedValueOnce(new Error('read failed'));
      const setSpy = vi.spyOn(cs.storage.local, 'set');
      const markMock = vi.fn().mockResolvedValue();
      globalThis.markLocalCloudDataChanged = markMock;
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(app.loadAll()).rejects.toThrow('read failed');

      // Still blocked right after the failed load.
      await app.saveItems();
      expect(setSpy).not.toHaveBeenCalled();
      expect(markMock).not.toHaveBeenCalled();

      // The once-mock is consumed; this call falls through to the real mock
      // implementation and must lift the firewall.
      await expect(app.loadAll()).resolves.toBeUndefined();
      await app.saveItems();

      expect(setSpy).toHaveBeenCalledTimes(1);
      expect(markMock).toHaveBeenCalledTimes(1);
      expect(cs._data.startpage_items).toBeDefined();
    });

    describe('localStorage branch (no chrome.storage)', () => {
      let appNoChrome;
      beforeEach(() => {
        delete globalThis.chrome;
        appNoChrome = loadAppModule();
      });

      it('blocks localStorage writes after a failed loadAll()', async () => {
        // jsdom's localStorage is a Proxy: spying on the instance does not
        // intercept, so target the shared Storage prototype instead.
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
          throw new Error('legacy read failed');
        });
        const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        await expect(appNoChrome.loadAll()).rejects.toThrow('legacy read failed');

        await appNoChrome.saveItems();

        expect(setItemSpy).not.toHaveBeenCalled();
      });
    });
  });
});
