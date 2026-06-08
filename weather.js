// Lithium Weather Module — Open-Meteo backed (free, no API key required)
//
// Scope: geocoding city names → coordinates, and fetching combined daily (7-day)
// + hourly (48h) forecasts. Includes in-memory caching with 30-minute TTL so
// repeated new-tab opens don't hit the API every time.
//
// Usage:
//   const cities = await LithiumWeather.searchLocations('东京');
//   // → [{ name, latitude, longitude, timezone, country, admin1 }, …]
//
//   const forecast = await LithiumWeather.fetchForecast(35.68, 139.76, 'Asia/Tokyo');
//   // → { daily: [{date, weatherCode, tempMax, tempMin, …}×7], hourly: [{time, temp, precipProb, …}×48], meta: {…} }
//
//   const results = await LithiumWeather.getForecastForCities(weatherCities);
//   // → [{ city, forecast }, …]  (respects cache)
//
// WMO weather codes are exported as LithiumWeather.WMO_CODES for mapping to
// icons / localized descriptions (use i18n key `weather.code.<value>`).

(function (global) {
  'use strict';

  const GEOCODING_BASE = 'https://geocoding-api.open-meteo.com/v1/search';
  const FORECAST_BASE = 'https://api.open-meteo.com/v1/forecast';
  const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

  // WMO Weather interpretation codes → locale-agnostic key.
  // https://www.nodc.noaa.gov/archive/arc0021/0002199/1.1/data/0-data/HTML/WMO-CODE/WMO4677.HTM
  // The caller maps keys through i18n for display text and icons.
  var WMO_CODES = {
    0:  'clear',
    1:  'mainlyClear',
    2:  'partlyCloudy',
    3:  'overcast',
    45: 'fog',
    48: 'depositingRimeFog',
    51: 'lightDrizzle',
    53: 'moderateDrizzle',
    55: 'denseDrizzle',
    56: 'lightFreezingDrizzle',
    57: 'denseFreezingDrizzle',
    61: 'slightRain',
    63: 'moderateRain',
    65: 'heavyRain',
    66: 'lightFreezingRain',
    67: 'heavyFreezingRain',
    71: 'slightSnow',
    73: 'moderateSnow',
    75: 'heavySnow',
    77: 'snowGrains',
    80: 'slightRainShowers',
    81: 'moderateRainShowers',
    82: 'violentRainShowers',
    85: 'slightSnowShowers',
    86: 'heavySnowShowers',
    95: 'thunderstorm',
    96: 'thunderstormSlightHail',
    99: 'thunderstormHeavyHail',
  };

  // Two-tier cache:
  //   1. chrome.storage.local — persists across tabs/sessions (primary)
  //   2. In-memory — avoids async I/O on repeated reads within the same page
  //
  // Each city gets its own storage key: weather_fc_<lat>_<lon>
  // Value: JSON { ts: <epoch ms>, data: <forecast object> }
  var _memCache = Object.create(null);

  function storageKey(lat, lon) {
    return 'weather_fc_' + Number(lat).toFixed(2) + '_' + Number(lon).toFixed(2);
  }

  function _getStorage() {
    // MV3: chrome.storage.local (via Promise or callback)
    var s = (typeof globalThis !== 'undefined' && globalThis.chrome && globalThis.chrome.storage && globalThis.chrome.storage.local) ||
            (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) ||
            null;
    return s;
  }

  function _storageGet(keys) {
    var s = _getStorage();
    if (!s) return Promise.resolve({});
    return new Promise(function (resolve) {
      s.get(keys, function (result) {
        // chrome.storage uses `undefined` for missing keys (lastError is null in
        // that case — it's not an error, just missing), but the result object
        // simply omits the key. Normalize so callers can do `result[key]`.
        resolve(result || {});
      });
    });
  }

  function _storageSet(obj) {
    var s = _getStorage();
    if (!s) return Promise.resolve();
    return new Promise(function (resolve) {
      s.set(obj, function () { resolve(); });
    });
  }

  function _storageRemove(keys) {
    var s = _getStorage();
    if (!s) return Promise.resolve();
    return new Promise(function (resolve) {
      s.remove(keys, function () { resolve(); });
    });
  }

  // ----- public API -----

  var weather = {
    WMO_CODES: WMO_CODES,

    /**
     * Search locations by name via Open-Meteo geocoding API.
     * @param {string} query         - City or location name
     * @param {string} [lang='zh']   - Language for result names
     * @param {number} [count=8]     - Max results to return
     * @returns {Promise<Array<{name:string, latitude:number, longitude:number, timezone:string, country:string, admin1?:string}>>}
     */
    searchLocations: function (query, lang, count) {
      if (lang === undefined) lang = 'zh';
      if (count === undefined) count = 8;
      var url = GEOCODING_BASE +
        '?name=' + encodeURIComponent(query) +
        '&count=' + Number(count) +
        '&language=' + encodeURIComponent(lang) +
        '&format=json';
      return fetch(url).then(function (resp) {
        if (!resp.ok) throw new Error('Geocoding failed: HTTP ' + resp.status);
        return resp.json();
      }).then(function (data) {
        if (!data.results || data.results.length === 0) return [];
        return data.results.map(function (r) {
          return {
            name: r.name,
            latitude: r.latitude,
            longitude: r.longitude,
            timezone: r.timezone || 'auto',
            country: r.country || '',
            admin1: r.admin1 || '',
          };
        });
      });
    },

    /**
     * Fetch combined daily (7-day) + hourly (48h) forecast from Open-Meteo.
     * Makes a single HTTP request that covers both.
     *
     * @param {number} lat
     * @param {number} lon
     * @param {string} [timezone='auto']
     * @param {number} [forecastDays=7]
     * @returns {Promise<{daily:Array, hourly:Array, meta:object}>}
     */
    fetchForecast: function (lat, lon, timezone, forecastDays) {
      if (timezone === undefined) timezone = 'auto';
      if (forecastDays === undefined) forecastDays = 7;

      var dailyVars = [
        'weather_code',
        'temperature_2m_max',
        'temperature_2m_min',
        'precipitation_sum',
        'precipitation_probability_max',
        'wind_speed_10m_max',
        'wind_direction_10m_dominant',
      ].join(',');

      var hourlyVars = [
        'temperature_2m',
        'weather_code',
        'precipitation_probability',
        'precipitation',
        'relative_humidity_2m',
        'wind_speed_10m',
      ].join(',');

      var url = FORECAST_BASE +
        '?latitude=' + Number(lat) +
        '&longitude=' + Number(lon) +
        '&daily=' + encodeURIComponent(dailyVars) +
        '&hourly=' + encodeURIComponent(hourlyVars) +
        '&timezone=' + encodeURIComponent(timezone) +
        '&forecast_days=' + Number(forecastDays);

      return fetch(url).then(function (resp) {
        if (!resp.ok) throw new Error('Forecast fetch failed: HTTP ' + resp.status);
        return resp.json();
      }).then(function (data) {
        // Transform parallel arrays into arrays of objects for ergonomic access.
        var daily = (data.daily && data.daily.time || []).map(function (date, i) {
          return {
            date: date,
            weatherCode: data.daily.weather_code[i],
            tempMax: data.daily.temperature_2m_max[i],
            tempMin: data.daily.temperature_2m_min[i],
            precipSum: data.daily.precipitation_sum[i],
            precipProbMax: data.daily.precipitation_probability_max[i],
            windSpeedMax: data.daily.wind_speed_10m_max[i],
            windDirDominant: data.daily.wind_direction_10m_dominant[i],
          };
        });

        var hourly = (data.hourly && data.hourly.time || []).map(function (time, i) {
          return {
            time: time,
            weatherCode: data.hourly.weather_code[i],
            temp: data.hourly.temperature_2m[i],
            precipProb: data.hourly.precipitation_probability[i],
            precip: data.hourly.precipitation[i],
            humidity: data.hourly.relative_humidity_2m[i],
            windSpeed: data.hourly.wind_speed_10m[i],
          };
        });

        return {
          daily: daily,
          hourly: hourly,
          meta: {
            latitude: data.latitude,
            longitude: data.longitude,
            timezone: data.timezone,
            elevation: data.elevation,
            generationTimeMs: data.generationtime_ms,
          },
        };
      });
    },

    /**
     * Get forecast for a single city.
     *
     * Cache tiers (checked in order):
     *   1. In-memory  — same page lifecycle, no I/O
     *   2. chrome.storage.local — cross-tab, persists across sessions
     *   3. Network fetch (Open-Meteo) — on miss or expiry
     *
     * @param {{lat:number, lon:number, tz?:string}} city
     * @returns {Promise<object>} Same shape as fetchForecast return
     */
    getCachedForecast: function (city) {
      var key = storageKey(city.lat, city.lon);

      // Tier 1: in-memory
      var mem = _memCache[key];
      if (mem && (Date.now() - mem.ts) < CACHE_TTL_MS) {
        return Promise.resolve(mem.data);
      }

      var self = this;

      // Tier 2: chrome.storage.local
      return _storageGet(key).then(function (result) {
        var stored = result[key];
        if (stored) {
          try {
            var parsed = typeof stored === 'string' ? JSON.parse(stored) : stored;
            if (parsed && parsed.ts && (Date.now() - parsed.ts) < CACHE_TTL_MS && parsed.data) {
              // Promote to memory so subsequent reads in this page skip storage I/O.
              _memCache[key] = { ts: parsed.ts, data: parsed.data };
              return Promise.resolve(parsed.data);
            }
          } catch (_) { /* corrupt entry — fall through to fetch */ }
        }

        // Tier 3: network fetch
        return weather.fetchForecast(city.lat, city.lon, city.tz || 'auto').then(function (data) {
          var entry = { ts: Date.now(), data: data };
          // Save to memory
          _memCache[key] = entry;
          // Persist to storage (fire-and-forget — failure is non-fatal)
          var setObj = {};
          setObj[key] = JSON.stringify(entry);
          _storageSet(setObj);
          return data;
        });
      });
    },

    /**
     * Fetch forecasts for multiple cities in parallel, respecting cache.
     * @param {Array<{lat:number, lon:number, tz?:string}>} cities
     * @returns {Promise<Array<{city:object, forecast:object|null, error?:string}>>}
     */
    getForecastForCities: function (cities) {
      var self = this;
      return Promise.allSettled(
        cities.map(function (city) {
          return weather.getCachedForecast(city).then(function (forecast) {
            return { city: city, forecast: forecast };
          });
        })
      ).then(function (results) {
        return results.map(function (r, i) {
          if (r.status === 'fulfilled') return r.value;
          return { city: cities[i], forecast: null, error: (r.reason && r.reason.message) || 'Unknown error' };
        });
      });
    },

    /**
     * Look up the locale-agnostic key for a WMO weather code.
     * Callers map the key through i18n: t('weather.code.' + key)
     * @param {number} code
     * @returns {string}
     */
    getWeatherKey: function (code) {
      return WMO_CODES[code] || 'unknown';
    },

    /**
     * Clear all cached forecasts (memory + storage).
     * @param {Array<{lat:number, lon:number}>} [cities] — if provided, only
     *   clear cache entries for these cities; otherwise clear everything.
     * @returns {Promise<void>}
     */
    clearCache: function (cities) {
      _memCache = Object.create(null);
      var s = _getStorage();
      if (!s) return Promise.resolve();

      if (cities && cities.length > 0) {
        // Targeted clear: only remove cache entries for known cities.
        var keys = cities.map(function (c) { return storageKey(c.lat, c.lon); });
        return _storageRemove(keys);
      }

      // Full clear: find all weather_fc_* keys and remove them.
      return new Promise(function (resolve) {
        s.get(null, function (all) {
          var weatherKeys = Object.keys(all || {}).filter(function (k) {
            return k.indexOf('weather_fc_') === 0;
          });
          if (weatherKeys.length > 0) {
            s.remove(weatherKeys, function () { resolve(); });
          } else {
            resolve();
          }
        });
      });
    },

    /**
     * Remove stale cache entries for cities no longer in the user's list.
     * Call this after removing a city from weatherCities.
     * @param {Array<{lat:number, lon:number}>} activeCities
     * @returns {Promise<void>}
     */
    pruneCache: function (activeCities) {
      var activeKeys = {};
      for (var i = 0; i < activeCities.length; i++) {
        activeKeys[storageKey(activeCities[i].lat, activeCities[i].lon)] = true;
      }
      // Also clean corresponding memory entries.
      var newMem = Object.create(null);
      var memKeys = Object.keys(_memCache);
      for (var j = 0; j < memKeys.length; j++) {
        if (activeKeys[memKeys[j]]) {
          newMem[memKeys[j]] = _memCache[memKeys[j]];
        }
      }
      _memCache = newMem;

      var s = _getStorage();
      if (!s) return Promise.resolve();
      var self = this;
      return new Promise(function (resolve) {
        s.get(null, function (all) {
          var stale = Object.keys(all || {}).filter(function (k) {
            return k.indexOf('weather_fc_') === 0 && !activeKeys[k];
          });
          if (stale.length > 0) {
            s.remove(stale, function () { resolve(); });
          } else {
            resolve();
          }
        });
      });
    },

    /**
     * Returns the cache TTL in milliseconds.
     * @returns {number}
     */
    getCacheTTL: function () {
      return CACHE_TTL_MS;
    },
  };

  global.LithiumWeather = weather;
})(typeof globalThis !== 'undefined' ? globalThis : window);
