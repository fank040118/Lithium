import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { jsonResponse } from './helpers/mockFetch.js';
import { createCallbackMockChromeStorage } from './helpers/mockCallbackChromeStorage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEATHER_SRC = readFileSync(path.join(__dirname, '../weather.js'), 'utf8');

function loadWeatherModule() {
  (0, eval)(WEATHER_SRC);
  return globalThis.LithiumWeather;
}

function makeForecastBody(overrides = {}) {
  return {
    latitude: 35.7,
    longitude: 139.75,
    timezone: 'Asia/Tokyo',
    elevation: 40,
    generationtime_ms: 12.34,
    daily: {
      time: ['2026-07-02', '2026-07-03'],
      weather_code: [0, 61],
      temperature_2m_max: [28, 26],
      temperature_2m_min: [22, 21],
      precipitation_sum: [0, 5.2],
      precipitation_probability_max: [10, 80],
      wind_speed_10m_max: [8, 12],
      wind_direction_10m_dominant: [180, 90],
      sunrise: ['2026-07-02T04:30', '2026-07-03T04:31'],
      sunset: ['2026-07-02T19:00', '2026-07-03T19:01'],
    },
    hourly: {
      time: ['2026-07-02T00:00', '2026-07-02T01:00'],
      weather_code: [1, 2],
      temperature_2m: [24, 23.5],
      precipitation_probability: [5, 10],
      precipitation: [0, 0.1],
      relative_humidity_2m: [60, 65],
      wind_speed_10m: [3, 4],
    },
    ...overrides,
  };
}

describe('weather.js cache and storage integration', () => {
  let weather;
  let fetchMock;
  let storageMock;
  let consoleWarnSpy;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-02T12:00:00.000Z'));

    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    storageMock = createCallbackMockChromeStorage();
    globalThis.chrome = {
      storage: { local: storageMock },
      runtime: { lastError: null },
    };

    weather = loadWeatherModule();
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    delete globalThis.fetch;
    delete globalThis.LithiumWeather;
    delete globalThis.chrome;
    vi.restoreAllMocks();
  });

  describe('_storageGet / _storageSet / _storageRemove', () => {
    it('resolves storage.get callback result through getCachedForecast', async () => {
      const key = 'weather_fc_1.0000_2.0000_auto';
      const entry = { ts: Date.now(), data: { daily: [{ date: 'stored' }], hourly: [] } };
      storageMock._data[key] = JSON.stringify(entry);

      const result = await weather.getCachedForecast({ lat: 1, lon: 2 });

      expect(storageMock.get).toHaveBeenCalledTimes(1);
      expect(storageMock.get.mock.calls[0][0]).toBe(key);
      expect(storageMock.get.mock.calls[0][1]).toEqual(expect.any(Function));
      expect(result).toEqual(entry.data);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('falls back to fetch when chrome.storage.local is unavailable', async () => {
      delete globalThis.chrome.storage;
      fetchMock.mockResolvedValue(jsonResponse(200, makeForecastBody()));

      await weather.getCachedForecast({ lat: 1, lon: 2 });

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('logs warning and falls back to fetch on storage.get runtime.lastError', async () => {
      storageMock.get = vi.fn((keys, callback) => {
        globalThis.chrome.runtime.lastError = new Error('storage get failed');
        callback({});
        globalThis.chrome.runtime.lastError = null;
      });
      fetchMock.mockResolvedValue(jsonResponse(200, makeForecastBody()));

      await weather.getCachedForecast({ lat: 1, lon: 2 });

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[LithiumWeather] storage.get error:',
        'storage get failed'
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('persists fetched entry via storage.set and logs warning on runtime.lastError', async () => {
      storageMock.set = vi.fn((values, callback) => {
        globalThis.chrome.runtime.lastError = new Error('storage set failed');
        if (callback) callback();
        globalThis.chrome.runtime.lastError = null;
      });
      fetchMock.mockResolvedValue(jsonResponse(200, makeForecastBody()));

      await weather.getCachedForecast({ lat: 1, lon: 2 });

      expect(storageMock.set).toHaveBeenCalledTimes(1);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[LithiumWeather] storage.set error:',
        'storage set failed'
      );
    });

    it('removes entries via storage.remove and logs warning on runtime.lastError', async () => {
      storageMock._data['weather_fc_1.0000_2.0000_auto'] = JSON.stringify({
        ts: Date.now(),
        data: { daily: [], hourly: [] },
      });
      storageMock.remove = vi.fn((keys, callback) => {
        globalThis.chrome.runtime.lastError = new Error('storage remove failed');
        if (callback) callback();
        globalThis.chrome.runtime.lastError = null;
      });

      await weather.clearCache();

      expect(storageMock.remove).toHaveBeenCalledTimes(1);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[LithiumWeather] storage.remove error:',
        'storage remove failed'
      );
    });
  });

  describe('getCachedForecast', () => {
    it('returns in-memory cache immediately when entry is fresh', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, makeForecastBody()));
      await weather.getCachedForecast({ lat: 1, lon: 2 });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const result = await weather.getCachedForecast({ lat: 1, lon: 2 });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.daily).toHaveLength(2);
    });

    it('promotes fresh storage entry to memory and returns it', async () => {
      const key = 'weather_fc_1.0000_2.0000_auto';
      const entry = { ts: Date.now(), data: { daily: [{ date: 'stored' }], hourly: [] } };
      storageMock._data[key] = JSON.stringify(entry);

      const result = await weather.getCachedForecast({ lat: 1, lon: 2 });

      expect(result).toEqual(entry.data);
      expect(fetchMock).not.toHaveBeenCalled();

      // Second call should now hit memory and skip storage I/O.
      storageMock.get.mockClear();
      await weather.getCachedForecast({ lat: 1, lon: 2 });
      expect(storageMock.get).not.toHaveBeenCalled();
    });

    it('handles already-parsed object values in storage', async () => {
      const key = 'weather_fc_1.0000_2.0000_auto';
      const entry = { ts: Date.now(), data: { daily: [{ date: 'object' }], hourly: [] } };
      storageMock._data[key] = entry;

      const result = await weather.getCachedForecast({ lat: 1, lon: 2 });

      expect(result).toEqual(entry.data);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('falls back to network when storage entry is expired', async () => {
      const key = 'weather_fc_1.0000_2.0000_auto';
      const entry = { ts: Date.now(), data: { daily: [{ date: 'old' }], hourly: [] } };
      storageMock._data[key] = JSON.stringify(entry);
      vi.setSystemTime(Date.now() + weather.getCacheTTL() + 1);
      fetchMock.mockResolvedValue(jsonResponse(200, makeForecastBody()));

      const result = await weather.getCachedForecast({ lat: 1, lon: 2 });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.daily[0].date).toBe('2026-07-02');
    });

    it('does not return expired in-memory entry and refetches', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, makeForecastBody()));
      await weather.getCachedForecast({ lat: 1, lon: 2 });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      vi.setSystemTime(Date.now() + weather.getCacheTTL() + 1);
      const result = await weather.getCachedForecast({ lat: 1, lon: 2 });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.daily[0].date).toBe('2026-07-02');
    });

    it('falls back to network on corrupt storage entry', async () => {
      storageMock._data['weather_fc_1.0000_2.0000_auto'] = 'not valid json';
      fetchMock.mockResolvedValue(jsonResponse(200, makeForecastBody()));

      const result = await weather.getCachedForecast({ lat: 1, lon: 2 });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.daily).toHaveLength(2);
    });

    it('treats storage entry exactly at TTL age as expired', async () => {
      const key = 'weather_fc_1.0000_2.0000_auto';
      const entry = { ts: Date.now(), data: { daily: [{ date: 'old' }], hourly: [] } };
      storageMock._data[key] = JSON.stringify(entry);
      vi.setSystemTime(Date.now() + weather.getCacheTTL());
      fetchMock.mockResolvedValue(jsonResponse(200, makeForecastBody()));

      const result = await weather.getCachedForecast({ lat: 1, lon: 2 });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.daily[0].date).toBe('2026-07-02');
    });

    it('writes fetched forecast to both memory and storage', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, makeForecastBody()));
      await weather.getCachedForecast({ lat: 1, lon: 2 });

      // Memory was written: second call skips fetch and storage.get.
      fetchMock.mockClear();
      storageMock.get.mockClear();
      const result = await weather.getCachedForecast({ lat: 1, lon: 2 });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(storageMock.get).not.toHaveBeenCalled();
      expect(result.daily).toHaveLength(2);

      // Storage was written: verify key and value shape.
      expect(storageMock.set).toHaveBeenCalledTimes(1);
      const setCall = storageMock.set.mock.calls[0][0];
      const setKey = Object.keys(setCall)[0];
      expect(setKey).toBe('weather_fc_1.0000_2.0000_auto');
      const setValue = JSON.parse(setCall[setKey]);
      expect(setValue.ts).toBe(Date.now());
      expect(setValue.data.daily).toHaveLength(2);
    });

    it('rejects when the network fallback fails', async () => {
      fetchMock.mockRejectedValue(new Error('network down'));

      await expect(weather.getCachedForecast({ lat: 1, lon: 2 })).rejects.toThrow('network down');
    });

    it('rejects on non-200 HTTP response from the network fallback', async () => {
      fetchMock.mockResolvedValue(jsonResponse(503, {}));

      await expect(weather.getCachedForecast({ lat: 1, lon: 2 })).rejects.toThrow(
        'Forecast fetch failed: HTTP 503'
      );
    });
  });

  describe('getForecastForCities', () => {
    it('deduplicates identical cities and only fetches once', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, makeForecastBody()));

      const results = await weather.getForecastForCities([
        { lat: 1, lon: 2 },
        { lat: 1, lon: 2 },
      ]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(results).toHaveLength(2);
      expect(results[0].forecast).not.toBeNull();
      expect(results[1].forecast).not.toBeNull();
      expect(results[0].city).toEqual({ lat: 1, lon: 2 });
      expect(results[1].city).toEqual({ lat: 1, lon: 2 });
    });

    it('preserves input order in results', async () => {
      fetchMock.mockImplementation(async (url) => {
        const lat = Number(new URL(url).searchParams.get('latitude'));
        return jsonResponse(200, makeForecastBody({ latitude: lat }));
      });

      const results = await weather.getForecastForCities([
        { lat: 1, lon: 2 },
        { lat: 3, lon: 4 },
      ]);

      expect(results).toHaveLength(2);
      expect(results[0].city).toEqual({ lat: 1, lon: 2 });
      expect(results[1].city).toEqual({ lat: 3, lon: 4 });
      expect(results[0].forecast.meta.latitude).toBe(1);
      expect(results[1].forecast.meta.latitude).toBe(3);
    });

    it('mixes cached hits and network fetches in parallel', async () => {
      storageMock._data['weather_fc_1.0000_2.0000_auto'] = JSON.stringify({
        ts: Date.now(),
        data: { daily: [{ date: 'cached' }], hourly: [], meta: { latitude: 1 } },
      });
      fetchMock.mockResolvedValue(jsonResponse(200, makeForecastBody({ latitude: 3 })));

      const results = await weather.getForecastForCities([
        { lat: 1, lon: 2 },
        { lat: 3, lon: 4 },
      ]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(results[0].forecast.daily[0].date).toBe('cached');
      expect(results[1].forecast.meta.latitude).toBe(3);
    });

    it('returns mixed results when one city is cached and another fails', async () => {
      storageMock._data['weather_fc_1.0000_2.0000_auto'] = JSON.stringify({
        ts: Date.now(),
        data: { daily: [{ date: 'cached' }], hourly: [], meta: { latitude: 1 } },
      });
      fetchMock.mockImplementation(async (url) => {
        const lat = Number(new URL(url).searchParams.get('latitude'));
        if (lat === 3) throw new Error('network down');
        return jsonResponse(200, makeForecastBody({ latitude: lat }));
      });

      const results = await weather.getForecastForCities([
        { lat: 1, lon: 2 },
        { lat: 3, lon: 4 },
      ]);

      expect(results).toHaveLength(2);
      expect(results[0].city).toEqual({ lat: 1, lon: 2 });
      expect(results[0].forecast.daily[0].date).toBe('cached');
      expect(results[0].error).toBeUndefined();
      expect(results[1].city).toEqual({ lat: 3, lon: 4 });
      expect(results[1].forecast).toBeNull();
      expect(results[1].error).toBe('network down');
    });

    it('returns error entries without rejecting when individual city fails', async () => {
      fetchMock.mockRejectedValue(new Error('network down'));

      const results = await weather.getForecastForCities([
        { lat: 1, lon: 2 },
        { lat: 3, lon: 4 },
      ]);

      expect(results).toHaveLength(2);
      expect(results[0].forecast).toBeNull();
      expect(results[0].error).toBe('network down');
      expect(results[1].forecast).toBeNull();
      expect(results[1].error).toBe('network down');
    });

    it('fetches distinct cities separately', async () => {
      fetchMock.mockImplementation(async (url) => {
        const lat = Number(new URL(url).searchParams.get('latitude'));
        return jsonResponse(200, makeForecastBody({ latitude: lat }));
      });

      const results = await weather.getForecastForCities([
        { lat: 1, lon: 2 },
        { lat: 3, lon: 4 },
      ]);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(results[0].forecast.meta.latitude).toBe(1);
      expect(results[1].forecast.meta.latitude).toBe(3);
    });

    it('returns empty results for an empty city list', async () => {
      const results = await weather.getForecastForCities([]);

      expect(results).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('clearCache', () => {
    it('clears all memory and storage weather entries when called without arguments', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, makeForecastBody()));
      await weather.getCachedForecast({ lat: 1, lon: 2 });
      await weather.getCachedForecast({ lat: 3, lon: 4 });

      await weather.clearCache();

      // Storage cleared: only weather_fc_* keys removed.
      expect(storageMock.remove).toHaveBeenCalledTimes(1);
      expect(storageMock.remove.mock.calls[0][0]).toEqual(
        expect.arrayContaining([
          'weather_fc_1.0000_2.0000_auto',
          'weather_fc_3.0000_4.0000_auto',
        ])
      );
      expect(storageMock._data).toEqual({});

      // Memory cleared: subsequent reads refetch.
      fetchMock.mockClear();
      await weather.getCachedForecast({ lat: 1, lon: 2 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('clears only specified cities from memory and storage', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, makeForecastBody()));
      await weather.getCachedForecast({ lat: 1, lon: 2 });
      await weather.getCachedForecast({ lat: 3, lon: 4 });

      fetchMock.mockClear();
      await weather.clearCache([{ lat: 1, lon: 2 }]);

      // Cleared city refetches.
      await weather.getCachedForecast({ lat: 1, lon: 2 });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Uncleared city remains cached in memory.
      fetchMock.mockClear();
      await weather.getCachedForecast({ lat: 3, lon: 4 });
      expect(fetchMock).not.toHaveBeenCalled();

      // Only the specified key was removed from storage.
      expect(storageMock.remove).toHaveBeenCalledTimes(1);
      expect(storageMock.remove.mock.calls[0][0]).toEqual([
        'weather_fc_1.0000_2.0000_auto',
      ]);
    });

    it('clears all weather cache entries when called with an empty array', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, makeForecastBody()));
      await weather.getCachedForecast({ lat: 1, lon: 2 });

      await weather.clearCache([]);

      expect(storageMock.remove).toHaveBeenCalledTimes(1);
      expect(storageMock.remove.mock.calls[0][0]).toEqual([
        'weather_fc_1.0000_2.0000_auto',
      ]);
      expect(storageMock._data).toEqual({});

      fetchMock.mockClear();
      await weather.getCachedForecast({ lat: 1, lon: 2 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('resolves and logs warning when full clear storage.get reports lastError', async () => {
      storageMock.get = vi.fn((keys, callback) => {
        globalThis.chrome.runtime.lastError = new Error('storage scan failed');
        callback({});
        globalThis.chrome.runtime.lastError = null;
      });

      await weather.clearCache();

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[LithiumWeather] storage.get error:',
        'storage scan failed'
      );
    });

    it('resolves and logs warning when full clear storage.remove reports lastError', async () => {
      storageMock._data['weather_fc_1.0000_2.0000_auto'] = JSON.stringify({
        ts: Date.now(),
        data: { daily: [], hourly: [] },
      });
      storageMock.remove = vi.fn((keys, callback) => {
        globalThis.chrome.runtime.lastError = new Error('storage remove failed');
        if (callback) callback();
        globalThis.chrome.runtime.lastError = null;
      });

      await weather.clearCache();

      expect(storageMock.remove).toHaveBeenCalledTimes(1);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[LithiumWeather] storage.remove error:',
        'storage remove failed'
      );
    });
  });

  describe('pruneCache', () => {
    it('removes inactive cities from memory and storage', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, makeForecastBody()));
      await weather.getCachedForecast({ lat: 1, lon: 2 });
      await weather.getCachedForecast({ lat: 3, lon: 4 });

      fetchMock.mockClear();
      await weather.pruneCache([{ lat: 3, lon: 4 }]);

      // Inactive city refetches.
      await weather.getCachedForecast({ lat: 1, lon: 2 });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Active city remains cached in memory.
      fetchMock.mockClear();
      await weather.getCachedForecast({ lat: 3, lon: 4 });
      expect(fetchMock).not.toHaveBeenCalled();

      // Only the inactive key was removed from storage.
      expect(storageMock.remove).toHaveBeenCalledTimes(1);
      expect(storageMock.remove.mock.calls[0][0]).toEqual([
        'weather_fc_1.0000_2.0000_auto',
      ]);
    });

    it('keeps all entries and removes none when every city is active', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, makeForecastBody()));
      await weather.getCachedForecast({ lat: 1, lon: 2 });

      await weather.pruneCache([{ lat: 1, lon: 2 }]);

      expect(storageMock.remove).not.toHaveBeenCalled();

      fetchMock.mockClear();
      await weather.getCachedForecast({ lat: 1, lon: 2 });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('removes all weather cache entries when active list is empty', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, makeForecastBody()));
      await weather.getCachedForecast({ lat: 1, lon: 2 });

      await weather.pruneCache([]);

      expect(storageMock.remove).toHaveBeenCalledTimes(1);
      expect(storageMock.remove.mock.calls[0][0]).toEqual([
        'weather_fc_1.0000_2.0000_auto',
      ]);
      expect(storageMock._data).toEqual({});

      fetchMock.mockClear();
      await weather.getCachedForecast({ lat: 1, lon: 2 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('resolves and logs warning when prune storage.get reports lastError', async () => {
      storageMock.get = vi.fn((keys, callback) => {
        globalThis.chrome.runtime.lastError = new Error('storage scan failed');
        callback({});
        globalThis.chrome.runtime.lastError = null;
      });

      await weather.pruneCache([{ lat: 1, lon: 2 }]);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[LithiumWeather] storage.get error:',
        'storage scan failed'
      );
    });

    it('resolves and logs warning when prune storage.remove reports lastError', async () => {
      storageMock._data['weather_fc_1.0000_2.0000_auto'] = JSON.stringify({
        ts: Date.now(),
        data: { daily: [], hourly: [] },
      });
      storageMock.get = vi.fn((keys, callback) => {
        callback({ 'weather_fc_1.0000_2.0000_auto': storageMock._data['weather_fc_1.0000_2.0000_auto'] });
      });
      storageMock.remove = vi.fn((keys, callback) => {
        globalThis.chrome.runtime.lastError = new Error('storage remove failed');
        if (callback) callback();
        globalThis.chrome.runtime.lastError = null;
      });

      await weather.pruneCache([]);

      expect(storageMock.remove).toHaveBeenCalledTimes(1);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[LithiumWeather] storage.remove error:',
        'storage remove failed'
      );
    });
  });
});
