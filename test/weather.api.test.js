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

describe('weather.js API and pure-logic helpers', () => {
  let weather;
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    weather = loadWeatherModule();
  });

  afterEach(() => {
    delete globalThis.fetch;
    delete globalThis.LithiumWeather;
    delete globalThis.chrome;
    vi.restoreAllMocks();
  });

  describe('searchLocations', () => {
    it('constructs the Open-Meteo geocoding URL and returns mapped results', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, {
        results: [
          {
            name: 'Tokyo',
            latitude: 35.6895,
            longitude: 139.6917,
            timezone: 'Asia/Tokyo',
            country: 'Japan',
            admin1: 'Tokyo',
          },
          {
            name: 'Tokorozawa',
            latitude: 35.7864,
            longitude: 139.4678,
            country: 'Japan',
          },
        ],
      }));

      const results = await weather.searchLocations('tokyo', 'en', 5);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const url = fetchMock.mock.calls[0][0];
      expect(url).toMatch(/^https:\/\/geocoding-api\.open-meteo\.com\/v1\/search\?/);
      expect(url).toContain('name=tokyo');
      expect(url).toContain('count=5');
      expect(url).toContain('language=en');
      expect(url).toContain('format=json');

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        name: 'Tokyo',
        latitude: 35.6895,
        longitude: 139.6917,
        timezone: 'Asia/Tokyo',
        country: 'Japan',
        admin1: 'Tokyo',
      });
      expect(results[1]).toEqual({
        name: 'Tokorozawa',
        latitude: 35.7864,
        longitude: 139.4678,
        timezone: 'auto',
        country: 'Japan',
        admin1: '',
      });
    });

    it('uses default lang=zh and count=8', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { results: [] }));

      await weather.searchLocations('beijing');

      const url = fetchMock.mock.calls[0][0];
      expect(url).toContain('language=zh');
      expect(url).toContain('count=8');
    });

    it('returns an empty array when results are missing or empty', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, {}));
      expect(await weather.searchLocations('nowhere')).toEqual([]);

      fetchMock.mockResolvedValue(jsonResponse(200, { results: [] }));
      expect(await weather.searchLocations('void')).toEqual([]);
    });

    it('encodes special characters in the query', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { results: [] }));

      await weather.searchLocations('São Paulo');

      const url = fetchMock.mock.calls[0][0];
      expect(url).toContain('name=S%C3%A3o%20Paulo');
    });

    it('throws when the network request fails', async () => {
      fetchMock.mockRejectedValue(new Error('network down'));

      await expect(weather.searchLocations('paris')).rejects.toThrow('network down');
    });

    it('throws on non-200 HTTP responses', async () => {
      fetchMock.mockResolvedValue(jsonResponse(500, {}));

      await expect(weather.searchLocations('london')).rejects.toThrow('Geocoding failed: HTTP 500');
    });

    it('throws when the response body is not valid JSON', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => { throw new Error('invalid json'); },
      });

      await expect(weather.searchLocations('berlin')).rejects.toThrow('invalid json');
    });

    it('returns an empty array for an empty query', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { results: [] }));

      const results = await weather.searchLocations('');

      const url = fetchMock.mock.calls[0][0];
      expect(url).toContain('name=');
      expect(results).toEqual([]);
    });
  });

  function makeForecastBody() {
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
    };
  }

  describe('fetchForecast', () => {

    it('constructs the Open-Meteo forecast URL and returns transformed daily/hourly arrays', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, makeForecastBody()));

      const result = await weather.fetchForecast(35.7, 139.75, 'Asia/Tokyo', 2);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const url = fetchMock.mock.calls[0][0];
      expect(url).toMatch(/^https:\/\/api\.open-meteo\.com\/v1\/forecast\?/);
      expect(url).toContain('latitude=35.7');
      expect(url).toContain('longitude=139.75');
      expect(url).toContain('daily=' + encodeURIComponent('weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_direction_10m_dominant,sunrise,sunset'));
      expect(url).toContain('hourly=' + encodeURIComponent('temperature_2m,weather_code,precipitation_probability,precipitation,relative_humidity_2m,wind_speed_10m'));
      expect(url).toContain('timezone=Asia%2FTokyo');
      expect(url).toContain('forecast_days=2');

      expect(result.daily).toHaveLength(2);
      expect(result.daily[0]).toEqual({
        date: '2026-07-02',
        weatherCode: 0,
        tempMax: 28,
        tempMin: 22,
        precipSum: 0,
        precipProbMax: 10,
        windSpeedMax: 8,
        windDirDominant: 180,
        sunrise: '2026-07-02T04:30',
        sunset: '2026-07-02T19:00',
      });
      expect(result.hourly).toHaveLength(2);
      expect(result.hourly[1]).toEqual({
        time: '2026-07-02T01:00',
        weatherCode: 2,
        temp: 23.5,
        precipProb: 10,
        precip: 0.1,
        humidity: 65,
        windSpeed: 4,
      });
      expect(result.meta).toEqual({
        latitude: 35.7,
        longitude: 139.75,
        timezone: 'Asia/Tokyo',
        elevation: 40,
        generationTimeMs: 12.34,
      });
    });

    it('uses default timezone=auto and forecastDays=7', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, makeForecastBody()));

      await weather.fetchForecast(0, 0);

      const url = fetchMock.mock.calls[0][0];
      expect(url).toContain('timezone=auto');
      expect(url).toContain('forecast_days=7');
    });

    it('encodes timezone special characters', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, makeForecastBody()));

      await weather.fetchForecast(1, 2, 'America/New_York', 3);

      const url = fetchMock.mock.calls[0][0];
      expect(url).toContain('timezone=America%2FNew_York');
      expect(url).toContain('forecast_days=3');
    });

    it('throws when the network request fails', async () => {
      fetchMock.mockRejectedValue(new Error('forecast network error'));

      await expect(weather.fetchForecast(0, 0)).rejects.toThrow('forecast network error');
    });

    it('throws on non-200 HTTP responses', async () => {
      fetchMock.mockResolvedValue(jsonResponse(503, {}));

      await expect(weather.fetchForecast(0, 0)).rejects.toThrow('Forecast fetch failed: HTTP 503');
    });

    it('throws when the response body is not valid JSON', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => { throw new Error('bad body'); },
      });

      await expect(weather.fetchForecast(0, 0)).rejects.toThrow('bad body');
    });
  });

  describe('getWeatherKey', () => {
    it('maps known WMO weather codes to semantic keys', () => {
      expect(weather.getWeatherKey(0)).toBe('clear');
      expect(weather.getWeatherKey(1)).toBe('mainlyClear');
      expect(weather.getWeatherKey(2)).toBe('partlyCloudy');
      expect(weather.getWeatherKey(3)).toBe('overcast');
      expect(weather.getWeatherKey(45)).toBe('fog');
      expect(weather.getWeatherKey(61)).toBe('slightRain');
      expect(weather.getWeatherKey(95)).toBe('thunderstorm');
      expect(weather.getWeatherKey(99)).toBe('thunderstormHeavyHail');
    });

    it('returns unknown for unrecognized codes', () => {
      expect(weather.getWeatherKey(-1)).toBe('unknown');
      expect(weather.getWeatherKey(999)).toBe('unknown');
      expect(weather.getWeatherKey(undefined)).toBe('unknown');
    });
  });

  describe('getCacheTTL', () => {
    it('returns the 30-minute TTL constant', () => {
      expect(weather.getCacheTTL()).toBe(30 * 60 * 1000);
    });
  });

  describe('storageKey / cityKey (indirectly via getCachedForecast)', () => {
    it('formats coordinates to four decimals and sanitizes the timezone in the cache key', async () => {
      const mockStorage = createCallbackMockChromeStorage();
      globalThis.chrome = { storage: { local: mockStorage } };
      fetchMock.mockResolvedValue(jsonResponse(200, makeForecastBody()));

      await weather.getCachedForecast({ lat: 35.6789, lon: 139.7654, tz: 'Asia/Tokyo' });

      expect(mockStorage.get).toHaveBeenCalledTimes(1);
      expect(mockStorage.get.mock.calls[0][0]).toBe('weather_fc_35.6789_139.7654_Asia_Tokyo');
      expect(mockStorage.set).toHaveBeenCalledTimes(1);
      const setKey = Object.keys(mockStorage.set.mock.calls[0][0])[0];
      expect(setKey).toBe('weather_fc_35.6789_139.7654_Asia_Tokyo');
    });

    it('uses auto as the default timezone in the cache key', async () => {
      const mockStorage = createCallbackMockChromeStorage();
      globalThis.chrome = { storage: { local: mockStorage } };
      fetchMock.mockResolvedValue(jsonResponse(200, makeForecastBody()));

      await weather.getCachedForecast({ lat: 0, lon: 0 });

      expect(mockStorage.get.mock.calls[0][0]).toBe('weather_fc_0.0000_0.0000_auto');
    });

    it('replaces unsafe timezone characters with underscores in the cache key', async () => {
      const mockStorage = createCallbackMockChromeStorage();
      globalThis.chrome = { storage: { local: mockStorage } };
      fetchMock.mockResolvedValue(jsonResponse(200, makeForecastBody()));

      await weather.getCachedForecast({ lat: 1, lon: 2, tz: 'foo bar+baz!' });

      expect(mockStorage.get.mock.calls[0][0]).toBe('weather_fc_1.0000_2.0000_foo_bar_baz_');
    });

    it('computes the same cache key for duplicate cities', async () => {
      const mockStorage = createCallbackMockChromeStorage();
      globalThis.chrome = { storage: { local: mockStorage } };
      fetchMock.mockResolvedValue(jsonResponse(200, makeForecastBody()));

      const result = await weather.getForecastForCities([
        { lat: 48.8566, lon: 2.3522, tz: 'Europe/Paris' },
        { lat: 48.8566, lon: 2.3522, tz: 'Europe/Paris' },
      ]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(2);
      expect(result[0].forecast).not.toBeNull();
      expect(result[1].forecast).not.toBeNull();
    });
  });
});
