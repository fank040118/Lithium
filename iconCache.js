// Favicon local cache.
//
// Caches fetched favicons as base64 PNG dataURLs in chrome.storage.local under
// a dedicated key (NOT in STORAGE_KEYS), so the cache stays local-only and is
// never uploaded to Firestore. items[].icon continues to hold ONLY user-uploaded
// custom icons (which should sync to the cloud as part of the user's config).
//
// Render-time lookup order (in app.js renderIcon):
//   1. item.icon                         (user-uploaded custom, base64)
//   2. iconCache.getCachedIcon(item.url) (auto-fetched, base64)
//   3. getFavicon(url)                   (native _favicon API, then remote)
//   4. first-letter placeholder

(function () {
  const ICON_CACHE_KEY = 'startpage_icon_cache';
  const ICON_FETCH_TIMEOUT_MS = 8000;
  const ICON_STALE_DAYS = 30;
  const ICON_STALE_MS = ICON_STALE_DAYS * 24 * 60 * 60 * 1000;
  const ICON_SIZE = 64;
  const MAX_CONCURRENCY = 3;
  const FLUSH_DEBOUNCE_MS = 300;

  const store =
    (globalThis.browser && globalThis.browser.storage && globalThis.browser.storage.local) ||
    (globalThis.chrome && globalThis.chrome.storage && globalThis.chrome.storage.local) ||
    null;

  // In-memory mirror of { [hostname]: { dataURL, fetchedAt } }
  let cache = null;
  let loadPromise = null;
  let dirty = false;
  let flushTimer = null;
  // Coalesce concurrent ensureIcon(host) calls so we don't fetch the same host twice.
  const inflight = new Map();

  async function loadCache() {
    if (cache) return cache;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      if (!store) {
        cache = {};
        return cache;
      }
      try {
        const data = await store.get(ICON_CACHE_KEY);
        const raw = data && data[ICON_CACHE_KEY];
        cache = raw && typeof raw === 'object' ? raw : {};
      } catch {
        cache = {};
      }
      return cache;
    })();
    return loadPromise;
  }

  async function flushCache() {
    if (!store || !dirty || !cache) return;
    dirty = false;
    try {
      await store.set({ [ICON_CACHE_KEY]: cache });
    } catch {
      // If persistence fails, retain in-memory cache; next mutation will retry.
      dirty = true;
    }
  }

  function scheduleFlush() {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      flushCache();
    }, FLUSH_DEBOUNCE_MS);
  }

  function getHost(url) {
    if (!url) return '';
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  }

  function isStale(entry) {
    if (!entry || !entry.fetchedAt) return true;
    return Date.now() - entry.fetchedAt > ICON_STALE_MS;
  }

  function getCachedIcon(url) {
    if (!cache) return '';
    const host = getHost(url);
    if (!host) return '';
    const entry = cache[host];
    return (entry && entry.dataURL) || '';
  }

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('FileReader failed'));
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  }

  function dataURLToScaledPng(dataURL, size) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Image decode failed'));
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');
          const scale = Math.max(size / img.width, size / img.height);
          const w = img.width * scale;
          const h = img.height * scale;
          ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
          resolve(canvas.toDataURL('image/png'));
        } catch (e) {
          reject(e);
        }
      };
      img.src = dataURL;
    });
  }

  async function fetchOnce(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ICON_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      if (!blob.type || !blob.type.startsWith('image/')) {
        throw new Error('Not an image: ' + blob.type);
      }
      if (blob.size < 16) throw new Error('Suspicious tiny payload');
      return blob;
    } finally {
      clearTimeout(timer);
    }
  }

  // Remote favicon URL builders — also re-exported on window.iconCache so the
  // render path in app.js (which feeds <img src> directly, no fetch) shares
  // a single source of truth for these endpoints.
  function getRemoteFaviconUrl(host, size) {
    if (!host) return '';
    const sz = Number.isFinite(size) ? size : 128;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${sz}`;
  }

  function getRemoteFallbackFaviconUrl(host) {
    if (!host) return '';
    return `https://icon.horse/icon/${encodeURIComponent(host)}`;
  }

  async function fetchFaviconAsDataURL(host) {
    if (!host) throw new Error('Empty host');
    const sources = [
      getRemoteFaviconUrl(host, 128),
      getRemoteFallbackFaviconUrl(host),
    ];
    let lastErr;
    for (const src of sources) {
      try {
        const blob = await fetchOnce(src);
        const rawDataURL = await blobToDataURL(blob);
        return await dataURLToScaledPng(rawDataURL, ICON_SIZE);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('All favicon sources failed');
  }

  async function ensureIconForHost(host, opts) {
    const { force = false } = opts || {};
    if (!host) return '';
    await loadCache();
    const existing = cache[host];
    if (!force && existing && !isStale(existing) && existing.dataURL) return existing.dataURL;

    if (inflight.has(host)) return inflight.get(host);
    const p = (async () => {
      try {
        const dataURL = await fetchFaviconAsDataURL(host);
        cache[host] = { dataURL, fetchedAt: Date.now() };
        dirty = true;
        scheduleFlush();
        return dataURL;
      } catch {
        return '';
      } finally {
        inflight.delete(host);
      }
    })();
    inflight.set(host, p);
    return p;
  }

  async function ensureIconForUrl(url, opts) {
    return ensureIconForHost(getHost(url), opts);
  }

  function collectHosts(items, set) {
    if (!Array.isArray(items)) return;
    for (const it of items) {
      if (!it) continue;
      if (it.type === 'link' && it.url) {
        const host = getHost(it.url);
        if (host) set.add(host);
      }
      if (Array.isArray(it.children)) collectHosts(it.children, set);
    }
  }

  // Build { host -> allHaveCustomIcon } so callers can skip hosts whose every
  // link already carries a user-uploaded icon (no point spending network on them).
  function collectHostStatus(items, map) {
    if (!Array.isArray(items)) return;
    for (const it of items) {
      if (!it) continue;
      if (it.type === 'link' && it.url) {
        const host = getHost(it.url);
        if (host) {
          if (!map.has(host)) map.set(host, { allHaveCustom: true });
          if (!it.icon) map.get(host).allHaveCustom = false;
        }
      }
      if (Array.isArray(it.children)) collectHostStatus(it.children, map);
    }
  }

  async function refreshAll(items, opts) {
    const { staleOnly = true, force = false, skipHostsWithCustomIcon = false } = opts || {};
    await loadCache();
    const hostMap = new Map();
    collectHostStatus(items, hostMap);
    const queue = [];
    for (const [host, info] of hostMap) {
      if (skipHostsWithCustomIcon && info.allHaveCustom) continue;
      const entry = cache[host];
      if (force) {
        queue.push(host);
        continue;
      }
      if (!entry || !entry.dataURL) {
        queue.push(host);
        continue;
      }
      if (staleOnly && isStale(entry)) queue.push(host);
    }
    if (queue.length === 0) return 0;

    let updated = 0;
    let cursor = 0;
    async function worker() {
      while (cursor < queue.length) {
        const host = queue[cursor++];
        try {
          const dataURL = await fetchFaviconAsDataURL(host);
          cache[host] = { dataURL, fetchedAt: Date.now() };
          dirty = true;
          updated++;
        } catch {
          // Skip; leave previous entry (if any) untouched so the UI keeps working.
        }
      }
    }
    const workerCount = Math.min(MAX_CONCURRENCY, queue.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    if (dirty) await flushCache();
    return updated;
  }

  async function pruneOrphans(items) {
    await loadCache();
    const keep = new Set();
    collectHosts(items, keep);
    let removed = 0;
    for (const host of Object.keys(cache)) {
      if (!keep.has(host)) {
        delete cache[host];
        removed++;
      }
    }
    if (removed > 0) {
      dirty = true;
      scheduleFlush();
    }
    return removed;
  }

  async function clearAll() {
    await loadCache();
    for (const host of Object.keys(cache)) delete cache[host];
    dirty = true;
    if (store) await store.remove(ICON_CACHE_KEY);
    dirty = false;
  }

  window.iconCache = {
    loadCache,
    getCachedIcon,
    ensureIconForHost,
    ensureIconForUrl,
    refreshAll,
    pruneOrphans,
    clearAll,
    getRemoteFaviconUrl,
    getRemoteFallbackFaviconUrl,
    _internal: { ICON_CACHE_KEY, ICON_STALE_DAYS },
  };
})();
