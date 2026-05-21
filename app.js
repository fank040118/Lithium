const DEFAULT_ENGINES = [
  { id: 'google',     name: 'Google',     url: 'https://www.google.com/search?q=%s' },
  { id: 'bing',       name: 'Bing',       url: 'https://www.bing.com/search?q=%s' },
  { id: 'duckduckgo', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
];

// Build DEFAULT_DATA lazily so the folder name resolves through i18n at the time
// of first use (after i18n.js has registered dictionaries).
function getDefaultData() {
  return [
    { id: '1', type: 'link', name: 'GitHub', url: 'https://github.com', icon: '', size: '1x1' },
    { id: '2', type: 'link', name: 'YouTube', url: 'https://youtube.com', icon: '', size: '1x1' },
    {
      id: '3', type: 'folder', name: t('defaults.folderName'), size: '1x1', children: [
        { id: '3-1', type: 'link', name: 'Figma', url: 'https://figma.com', icon: '', size: '1x1' },
        { id: '3-2', type: 'link', name: 'Dribbble', url: 'https://dribbble.com', icon: '', size: '1x1' },
      ],
    },
  ];
}

const TIMEZONE_CITIES = [
  { tz: 'Asia/Shanghai', key: 'beijing' },
  { tz: 'Asia/Tokyo', key: 'tokyo' },
  { tz: 'Asia/Seoul', key: 'seoul' },
  { tz: 'Asia/Singapore', key: 'singapore' },
  { tz: 'Asia/Hong_Kong', key: 'hongKong' },
  { tz: 'Asia/Taipei', key: 'taipei' },
  { tz: 'Asia/Kolkata', key: 'mumbai' },
  { tz: 'Asia/Dubai', key: 'dubai' },
  { tz: 'Asia/Bangkok', key: 'bangkok' },
  { tz: 'Europe/London', key: 'london' },
  { tz: 'Europe/Paris', key: 'paris' },
  { tz: 'Europe/Berlin', key: 'berlin' },
  { tz: 'Europe/Moscow', key: 'moscow' },
  { tz: 'Europe/Rome', key: 'rome' },
  { tz: 'Europe/Madrid', key: 'madrid' },
  { tz: 'America/New_York', key: 'newYork' },
  { tz: 'America/Chicago', key: 'chicago' },
  { tz: 'America/Denver', key: 'denver' },
  { tz: 'America/Los_Angeles', key: 'losAngeles' },
  { tz: 'America/Sao_Paulo', key: 'saoPaulo' },
  { tz: 'America/Vancouver', key: 'vancouver' },
  { tz: 'America/Mexico_City', key: 'mexicoCity' },
  { tz: 'Pacific/Auckland', key: 'auckland' },
  { tz: 'Australia/Sydney', key: 'sydney' },
  { tz: 'Australia/Melbourne', key: 'melbourne' },
  { tz: 'Pacific/Honolulu', key: 'honolulu' },
  { tz: 'Africa/Cairo', key: 'cairo' },
  { tz: 'Africa/Johannesburg', key: 'johannesburg' },
];

const DEFAULT_CLOCKS = [
  { id: 'c1', tz: 'Asia/Shanghai', key: 'beijing' },
];

// Helper: resolve a clock entry's localized display name. Prefers the i18n
// `key` field; falls back to legacy `city` string for entries that haven't
// been migrated (e.g. raw cloud payloads or external imports).
function getClockCityName(entry) {
  if (!entry) return '';
  if (entry.key) return t('city.' + entry.key);
  return entry.city || '';
}

// Helper: find the i18n key for a given IANA timezone string.
function getCityKeyForTz(tz) {
  const found = TIMEZONE_CITIES.find(entry => entry.tz === tz);
  return found ? found.key : null;
}

// Migrate legacy clock entries shaped as { tz, city } into { tz, key, city? }.
// If the tz matches a known TIMEZONE_CITIES row we drop the stale `city`
// string; otherwise we keep `city` as a fallback so the user doesn't lose
// their label for an unknown zone.
function migrateClocks(list) {
  if (!Array.isArray(list)) return list;
  return list.map(entry => {
    if (!entry || typeof entry !== 'object') return entry;
    if (entry.key) return entry;
    const inferredKey = getCityKeyForTz(entry.tz);
    if (inferredKey) {
      const { city, ...rest } = entry;
      return { ...rest, key: inferredKey };
    }
    return entry;
  });
}

const DEFAULT_MAIN_GRID_COLUMNS = 8;
const MIN_MAIN_GRID_COLUMNS = 6;
const MAX_MAIN_GRID_COLUMNS = 12;
const MAIN_GRID_TRACK_SIZE = 80;
const MAIN_GRID_GAP = 16;
const MAIN_CONTENT_SIDE_PADDING = 48;
const WALLPAPER_MAX_WIDTH = 2560;
const WALLPAPER_MAX_HEIGHT = 1440;
const STORAGE_KEYS = [
  'startpage_items',
  'startpage_engines',
  'startpage_selected_engine',
  'startpage_wallpaper',
  'startpage_clocks',
  'startpage_grid_columns',
];

const ICON_STYLE = 'width:100%;height:100%;display:block;object-fit:cover;pointer-events:none';

let items = [];
let customEngines = [];
let selectedEngineId = 'google';
let wallpaper = null;
let wallpaperBlur = 0;
let wallpaperDim = 0;
let clocks = [];
let mainGridColumns = DEFAULT_MAIN_GRID_COLUMNS;
let currentFolderId = null;
let dragState = null;
let editingItem = null;
let itemToDelete = null;
let contextTarget = null;
let pendingIcon = '';
let tempClocks = [];
let toastTimer = null;

const extensionStorageArea = globalThis.browser?.storage?.local
  || globalThis.chrome?.storage?.local
  || null;

function readLegacyLocalStorage(keys) {
  if (typeof localStorage === 'undefined') return {};
  const result = {};
  const ks = Array.isArray(keys) ? keys : [keys];
  for (const k of ks) {
    const v = localStorage.getItem('sp_' + k);
    if (v !== null) {
      try { result[k] = JSON.parse(v); } catch { result[k] = v; }
    }
  }
  return result;
}

function removeLegacyLocalStorage(keys) {
  if (typeof localStorage === 'undefined') return;
  const ks = Array.isArray(keys) ? keys : [keys];
  for (const k of ks) localStorage.removeItem('sp_' + k);
}

const storage = extensionStorageArea
  ? {
      async get(keys) { return extensionStorageArea.get(keys); },
      async set(obj) { return extensionStorageArea.set(obj); },
      async remove(key) { return extensionStorageArea.remove(key); },
    }
  : {
      async get(keys) { return readLegacyLocalStorage(keys); },
      async set(obj) {
        for (const [k, v] of Object.entries(obj)) {
          localStorage.setItem('sp_' + k, JSON.stringify(v));
        }
      },
      async remove(key) {
        removeLegacyLocalStorage(key);
      },
    };

async function markSyncedDataChanged() {
  if (typeof globalThis.markLocalCloudDataChanged !== 'function') return;
  await globalThis.markLocalCloudDataChanged();
}

async function migrateLegacyLocalStorage() {
  if (!extensionStorageArea || typeof localStorage === 'undefined') return;
  const legacyData = readLegacyLocalStorage(STORAGE_KEYS);
  const legacyKeys = Object.keys(legacyData);
  if (legacyKeys.length === 0) return;

  const currentData = await storage.get(STORAGE_KEYS);
  const migratedData = {};
  for (const key of legacyKeys) {
    if (typeof currentData[key] === 'undefined') {
      migratedData[key] = legacyData[key];
    }
  }

  if (Object.keys(migratedData).length > 0) {
    await storage.set(migratedData);
  }

  removeLegacyLocalStorage(legacyKeys);
}

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let _faviconApiSupported = null;
function hasFaviconApi() {
  if (_faviconApiSupported !== null) return _faviconApiSupported;
  try {
    const runtime = (globalThis.browser && globalThis.browser.runtime)
      || (globalThis.chrome && globalThis.chrome.runtime)
      || null;
    const manifest = runtime && typeof runtime.getManifest === 'function' ? runtime.getManifest() : null;
    const perms = manifest && Array.isArray(manifest.permissions) ? manifest.permissions : [];
    _faviconApiSupported = !!(runtime && typeof runtime.getURL === 'function' && perms.includes('favicon'));
  } catch {
    _faviconApiSupported = false;
  }
  return _faviconApiSupported;
}

function getFavicon(url) {
  if (!url) return '';
  try {
    const hostname = new URL(url).hostname;
    if (hasFaviconApi()) {
      const runtime = (globalThis.browser && globalThis.browser.runtime)
        || (globalThis.chrome && globalThis.chrome.runtime);
      return runtime.getURL(`_favicon/?pageUrl=${encodeURIComponent(url)}&size=64`);
    }
    return window.iconCache && window.iconCache.getRemoteFaviconUrl
      ? window.iconCache.getRemoteFaviconUrl(hostname, 64)
      : '';
  } catch { return ''; }
}

function getFaviconFallback(url) {
  if (!url) return '';
  try {
    const hostname = new URL(url).hostname;
    return window.iconCache && window.iconCache.getRemoteFallbackFaviconUrl
      ? window.iconCache.getRemoteFallbackFaviconUrl(hostname)
      : '';
  } catch { return ''; }
}

function buildManagedImageTag({ src, style = '', fallbackSrc = '', errorMode = 'hide' }) {
  const attrs = [
    `src="${escapeAttr(src)}"`,
    'alt=""',
    'data-managed-img="true"',
    `data-error-mode="${escapeAttr(errorMode)}"`,
  ];
  if (style) attrs.push(`style="${escapeAttr(style)}"`);
  if (fallbackSrc) attrs.push(`data-fallback-src="${escapeAttr(fallbackSrc)}"`);
  return `<img ${attrs.join(' ')}>`;
}

function handleManagedImageError(img) {
  const fallbackSrc = img.dataset.fallbackSrc;
  if (fallbackSrc && img.dataset.fallbackApplied !== 'true') {
    img.dataset.fallbackApplied = 'true';
    img.src = fallbackSrc;
    return;
  }

  if (img.dataset.errorMode === 'remove') {
    img.remove();
    return;
  }

  img.style.display = 'none';
  if (img.dataset.errorMode === 'show-sibling') {
    img.nextElementSibling?.style.setProperty('display', '');
  }
}

function generateId() {
  return Math.random().toString(36).substring(2, 11);
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function escapeHtml(s) {
  const el = document.createElement('span');
  el.textContent = s;
  return el.innerHTML;
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeCssUrl(s) {
  return String(s).replace(/["\\()]/g, '\\$&');
}

function clampMainGridColumns(value) {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) return DEFAULT_MAIN_GRID_COLUMNS;
  return Math.max(MIN_MAIN_GRID_COLUMNS, Math.min(MAX_MAIN_GRID_COLUMNS, parsed));
}

function getMainGridMaxWidth(columns = mainGridColumns) {
  return columns * MAIN_GRID_TRACK_SIZE + (columns - 1) * MAIN_GRID_GAP;
}

function updateGridColumnsControls() {
  const slider = $('#grid-columns-range');
  const value = $('#grid-columns-value');
  if (slider) slider.value = String(mainGridColumns);
  if (value) value.textContent = `${mainGridColumns}`;
}

function applyMainGridColumns() {
  const root = document.documentElement;
  const gridWidth = getMainGridMaxWidth();
  // The configured column count is treated as an upper bound: it caps the
  // grid container's max-width while auto-fill in CSS picks the actual track
  // count based on available width (see .grid-area > div in style.css).
  root.style.setProperty('--main-grid-max-width', `${gridWidth}px`);
  root.style.setProperty('--main-content-max-width', `${gridWidth + MAIN_CONTENT_SIDE_PADDING}px`);
  updateGridColumnsControls();
}

async function saveMainGridColumns() {
  await storage.set({ startpage_grid_columns: mainGridColumns });
  await markSyncedDataChanged();
}

function setMainGridColumns(value, persist = false) {
  const nextValue = clampMainGridColumns(value);
  if (nextValue === mainGridColumns) {
    updateGridColumnsControls();
    if (persist) saveMainGridColumns();
    return;
  }
  mainGridColumns = nextValue;
  applyMainGridColumns();
  updateGridItemSizes();
  if (persist) saveMainGridColumns();
}

const SIZES = ['1x1', '1x2', '2x1', '2x2', '2x4', '4x2'];
const SIZE_LABELS = { '1x1': '1×1', '1x2': '1×2', '2x1': '2×1', '2x2': '2×2', '2x4': '2×4', '4x2': '4×2' };
function getItemSize(item) {
  return SIZES.includes(item.size) ? item.size : '1x1';
}

function normalizeFolderChildItemSizes(list, insideFolder = false) {
  let changed = false;
  const normalizedItems = list.map(item => {
    let nextItem = item;
    const normalizedSize = insideFolder ? '1x1' : getItemSize(item);

    if (item.size !== normalizedSize) {
      nextItem = { ...nextItem, size: normalizedSize };
      changed = true;
    }

    if (Array.isArray(item.children)) {
      const childResult = normalizeFolderChildItemSizes(item.children, true);
      if (childResult.changed) {
        nextItem = nextItem === item ? { ...nextItem } : nextItem;
        nextItem.children = childResult.items;
        changed = true;
      }
    }

    return nextItem;
  });

  return { items: normalizedItems, changed };
}

// Slot layout for folder preview on large-size cards.
// Each size maps to { cols, rows } where cols×rows = total slots.
// All slots except the last show one normal icon; the last slot shows a 2×2 mini-group.
// Sizes are CSS grid-span dimensions: e.g. "1x2" = 2 CSS cols wide, 1 CSS row tall.
const FOLDER_SLOT_LAYOUTS = {
  '1x2': { cols: 2, rows: 1 },
  '2x1': { cols: 1, rows: 2 },
  '2x2': { cols: 2, rows: 2 },
  '2x4': { cols: 2, rows: 4 },
  '4x2': { cols: 4, rows: 2 },
};

function findItem(list, id) {
  for (const item of list) {
    if (item.id === id) return item;
    if (item.children) {
      const found = findItem(item.children, id);
      if (found) return found;
    }
  }
  return null;
}

function removeItem(list, id) {
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) return list.splice(i, 1)[0];
    if (list[i].children) {
      const removed = removeItem(list[i].children, id);
      if (removed) return removed;
    }
  }
  return null;
}

function insertOrCombineItem(list, targetId, action, itemObj) {
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === targetId) {
      if (action === 'before') list.splice(i, 0, itemObj);
      else if (action === 'after') list.splice(i + 1, 0, itemObj);
      else if (action === 'combine') {
        if (itemObj.type === 'folder') {
          list.splice(i + 1, 0, itemObj);
        } else if (list[i].type === 'folder') {
          list[i].children.push(itemObj);
        } else {
          list[i] = { id: generateId(), type: 'folder', name: t('folder.defaultName'), size: '1x1', children: [list[i], itemObj] };
        }
      }
      return true;
    }
    if (list[i].children && insertOrCombineItem(list[i].children, targetId, action, itemObj)) return true;
  }
  return false;
}

async function loadAll() {
  const data = await storage.get(STORAGE_KEYS);
  const itemResult = normalizeFolderChildItemSizes(data.startpage_items || getDefaultData());
  items = itemResult.items;
  customEngines = data.startpage_engines || [];
  selectedEngineId = data.startpage_selected_engine || 'google';
  wallpaper = data.startpage_wallpaper || null;
  clocks = migrateClocks(data.startpage_clocks || deepClone(DEFAULT_CLOCKS));
  mainGridColumns = clampMainGridColumns(data.startpage_grid_columns);
  if (itemResult.changed) {
    await storage.set({ startpage_items: items });
    await markSyncedDataChanged();
  }
  if (clocks.length === 0) clocks = deepClone(DEFAULT_CLOCKS);
}

async function saveItems() {
  await storage.set({ startpage_items: items });
  await markSyncedDataChanged();
}

async function saveEngines() {
  await storage.set({
    startpage_engines: customEngines,
    startpage_selected_engine: selectedEngineId,
  });
  await markSyncedDataChanged();
}

async function saveWallpaper() {
  if (wallpaper) {
    await storage.set({ startpage_wallpaper: wallpaper });
  } else {
    await storage.remove('startpage_wallpaper');
  }
}

async function saveWallpaperEffects() {
  await storage.set({
    startpage_wallpaper_blur: wallpaperBlur,
    startpage_wallpaper_dim: wallpaperDim,
  });
}

function applyWallpaperEffects() {
  const bg = $('#wallpaper-bg');
  const dim = $('#wallpaper-dim');
  if (bg) bg.style.filter = wallpaperBlur > 0 ? `blur(${wallpaperBlur}px)` : '';
  if (dim) dim.style.background = wallpaperDim > 0 ? `rgba(0,0,0,${wallpaperDim / 100})` : '';

  const blurRange = $('#wallpaper-blur-range');
  const dimRange = $('#wallpaper-dim-range');
  const blurVal = $('#wallpaper-blur-value');
  const dimVal = $('#wallpaper-dim-value');
  if (blurRange) blurRange.value = String(wallpaperBlur);
  if (dimRange) dimRange.value = String(wallpaperDim);
  if (blurVal) blurVal.textContent = String(wallpaperBlur);
  if (dimVal) dimVal.textContent = `${wallpaperDim}%`;
}

async function saveClocks() {
  await storage.set({ startpage_clocks: clocks });
  await markSyncedDataChanged();
}

function getAllEngines() {
  return [...DEFAULT_ENGINES, ...customEngines];
}

function getSelectedEngine() {
  return getAllEngines().find(e => e.id === selectedEngineId) || DEFAULT_ENGINES[0];
}

function selectEngine(id) {
  selectedEngineId = id;
  $('#engine-name').textContent = getAllEngines().find(e => e.id === id)?.name || 'Google';
  saveEngines();
  hideEngineDropdown();
}

function isValidUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}

function renderEngineDropdown() {
  const engines = getAllEngines();
  const list = $('#engine-list');
  list.innerHTML = engines.map(e => `
    <div class="engine-item ${e.id === selectedEngineId ? 'selected' : ''}" data-engine-id="${escapeHtml(e.id)}">
      <span>${escapeHtml(e.name)}</span>
      ${!DEFAULT_ENGINES.some(d => d.id === e.id) ? `<button class="engine-delete-btn" data-action="delete-engine" data-engine-id="${escapeHtml(e.id)}" title="${escapeAttr(t('search.engine.deleteTitle'))}">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>` : ''}
    </div>
  `).join('');
}

function toggleEngineDropdown() {
  const dd = $('#engine-dropdown');
  if (dd.classList.contains('hidden')) {
    renderEngineDropdown();
    dd.classList.remove('hidden');
    $('#add-engine-form').classList.add('hidden');
  } else {
    hideEngineDropdown();
  }
}

function hideEngineDropdown() {
  $('#engine-dropdown').classList.add('hidden');
}

function deleteEngine(id) {
  customEngines = customEngines.filter(e => e.id !== id);
  if (selectedEngineId === id) {
    selectedEngineId = getAllEngines()[0]?.id || 'google';
    $('#engine-name').textContent = getSelectedEngine().name;
  }
  saveEngines();
  renderEngineDropdown();
}

function addEngine() {
  const nameInput = $('#new-engine-name');
  const urlInput = $('#new-engine-url');
  const name = nameInput.value.trim();
  const url = urlInput.value.trim();

  nameInput.style.borderColor = '';
  urlInput.style.borderColor = '';

  if (!name) {
    nameInput.style.borderColor = '#ef4444';
    nameInput.focus();
    return;
  }
  if (!url) {
    urlInput.style.borderColor = '#ef4444';
    urlInput.focus();
    return;
  }
  if (!url.includes('%s')) {
    urlInput.style.borderColor = '#ef4444';
    urlInput.focus();
    return;
  }

  customEngines.push({ id: generateId(), name, url });
  saveEngines();
  renderEngineDropdown();
  nameInput.value = '';
  urlInput.value = '';
  $('#add-engine-form').classList.add('hidden');
}

function updateClock() {
  const now = new Date();
  const wrap = $('#clocks-wrap');
  if (!wrap) return;
  const count = clocks.length;
  wrap.setAttribute('data-count', count);

  const existingContainers = wrap.querySelectorAll('.clock-container');
  if (existingContainers.length !== count) {
    let html = '';
    for (let i = 0; i < count; i++) {
      html += `<div class="clock-container">
        <h1 class="clock-text" data-clock-idx="${i}"></h1>
        <p class="date-text" data-clock-idx="${i}"></p>
        <p class="tz-label" data-clock-idx="${i}"></p>
      </div>`;
    }
    wrap.innerHTML = html;
  }

  for (let i = 0; i < count; i++) {
    const c = clocks[i];
    const timeEl = wrap.querySelector(`.clock-text[data-clock-idx="${i}"]`);
    const dateEl = wrap.querySelector(`.date-text[data-clock-idx="${i}"]`);
    const tzEl = wrap.querySelector(`.tz-label[data-clock-idx="${i}"]`);
    if (!timeEl) continue;

    const opts = { timeZone: c.tz };
    const locale = (window.I18N && window.I18N.getLang()) || 'zh-CN';
    timeEl.textContent = now.toLocaleTimeString(locale, { ...opts, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    dateEl.textContent = now.toLocaleDateString(locale, { ...opts, weekday: 'long', month: 'long', day: 'numeric' });
    tzEl.textContent = getClockCityName(c) + ' · UTC' + getTimezoneOffset(c.tz, now);
  }
}

function getTimezoneOffset(tz, date) {
  try {
    const str = date.toLocaleString('en-US', { timeZone: tz, timeZoneName: 'shortOffset' });
    const match = str.match(/GMT([+-]\d+:?\d*)/);
    return match ? match[1] : '';
  } catch {
    return '';
  }
}

function updateSidebarWallpaperPreview() {
  const preview = $('#sidebar-wallpaper-preview');
  const label = $('#sidebar-wallpaper-preview-label');
  const clearBtn = $('#sidebar-wallpaper-clear-btn');
  if (!preview) return;

  const hasWallpaper = !!wallpaper;
  preview.dataset.empty = hasWallpaper ? 'false' : 'true';
  preview.style.backgroundImage = hasWallpaper ? `url("${escapeCssUrl(wallpaper)}")` : '';
  preview.setAttribute('aria-label', hasWallpaper ? t('sidebar.wallpaper.previewCurrentAria') : t('sidebar.wallpaper.previewAria'));

  if (label) {
    label.textContent = hasWallpaper ? t('sidebar.wallpaper.previewCurrentLabel') : t('sidebar.wallpaper.previewLabel');
  }

  if (clearBtn) {
    clearBtn.disabled = !hasWallpaper;
    clearBtn.setAttribute('aria-disabled', hasWallpaper ? 'false' : 'true');
  }
}

function applyWallpaper() {
  const blobs = document.querySelectorAll('.blob');
  const bg = $('#wallpaper-bg');
  if (wallpaper) {
    if (bg) bg.style.backgroundImage = `url("${escapeCssUrl(wallpaper)}")`;
    document.body.style.backgroundImage = '';
    blobs.forEach(b => b.style.display = 'none');
  } else {
    if (bg) bg.style.backgroundImage = '';
    document.body.style.backgroundImage = '';
    blobs.forEach(b => b.style.display = '');
  }
  updateSidebarWallpaperPreview();
}

function showToast(message, variant = 'default') {
  const toast = $('#app-toast');
  if (!toast) return;

  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }

  toast.textContent = message;
  toast.dataset.variant = variant;
  toast.classList.remove('hidden');
  requestAnimationFrame(() => {
    toast.classList.add('is-visible');
  });

  toastTimer = window.setTimeout(() => {
    toast.classList.remove('is-visible');
    window.setTimeout(() => {
      toast.classList.add('hidden');
      toast.textContent = '';
      delete toast.dataset.variant;
    }, 180);
    toastTimer = null;
  }, 3200);
}

// Sign-in notice — passive "you are not signed in, data is local-only" card
// that flies in from the top-right on first new-tab of a browser session when
// the user is unsigned. Auto-dismisses after the hold window; no interaction.
// De-duped per session so opening many tabs in a row doesn't spam.
let _signinNoticeTimer = null;
const _SIGNIN_NOTICE_SESSION_KEY = 'lithium.notice.signin.shown';

function showSigninNotice() {
  const notice = $('#signin-notice');
  if (!notice) return;
  try {
    if (sessionStorage.getItem(_SIGNIN_NOTICE_SESSION_KEY) === '1') return;
    sessionStorage.setItem(_SIGNIN_NOTICE_SESSION_KEY, '1');
  } catch { /* sessionStorage may be disabled — show anyway */ }

  if (_signinNoticeTimer) clearTimeout(_signinNoticeTimer);

  requestAnimationFrame(() => {
    notice.classList.add('is-visible');
  });

  _signinNoticeTimer = window.setTimeout(() => {
    notice.classList.remove('is-visible');
    _signinNoticeTimer = null;
  }, 5000);
}
window.showSigninNotice = showSigninNotice;

function getWallpaperUploadErrorMessage(err) {
  const rawMessage = String(err?.message || err || '').toLowerCase();
  if (rawMessage.includes('quota') || rawMessage.includes('storage') || rawMessage.includes('space')) {
    return t('toast.wallpaperSaveFailedQuota');
  }
  return t('toast.wallpaperSaveFailedGeneric');
}

function processWallpaper(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.onload = (ev) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Failed to load image'));
      img.onload = () => {
        const screenW = window.screen.width * window.devicePixelRatio;
        const screenH = window.screen.height * window.devicePixelRatio;
        const imgRatio = img.width / img.height;
        const screenRatio = screenW / screenH;

        let cropW, cropH, cropX, cropY;
        if (imgRatio > screenRatio) {
          cropH = img.height;
          cropW = img.height * screenRatio;
          cropX = (img.width - cropW) / 2;
          cropY = 0;
        } else {
          cropW = img.width;
          cropH = img.width / screenRatio;
          cropX = 0;
          cropY = (img.height - cropH) / 2;
        }

        const canvas = document.createElement('canvas');
        const scale = Math.min(
          1,
          WALLPAPER_MAX_WIDTH / cropW,
          WALLPAPER_MAX_HEIGHT / cropH
        );
        canvas.width = Math.max(1, Math.round(cropW * scale));
        canvas.height = Math.max(1, Math.round(cropH * scale));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// Minimum side length of the crop rect in *source-image* pixels. Anything
// smaller produces a useless mush after downscaling to 128px.
const ICON_CROP_MIN_SOURCE_PX = 32;
const ICON_OUTPUT_SIZE = 128;

// Loads `file` into an Image, hands it to the interactive cropper, then
// rasterizes the user's selection to a 128×128 PNG dataURL. Resolves with
// `null` if the user cancels (so callers can quietly bail without erroring).
function processIconFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.onload = (ev) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Failed to load image'));
      img.onload = () => {
        openIconCropper(img).then((sel) => {
          if (!sel) { resolve(null); return; }
          const { sx, sy, ss } = sel;
          const canvas = document.createElement('canvas');
          canvas.width = ICON_OUTPUT_SIZE;
          canvas.height = ICON_OUTPUT_SIZE;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, sx, sy, ss, ss, 0, 0, ICON_OUTPUT_SIZE, ICON_OUTPUT_SIZE);
          resolve(canvas.toDataURL('image/webp', 0.9));
        }, reject);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// Escape handler reaches in here to dismiss the cropper without having to
// know about its internal pointer state.
let _iconCropCancel = null;

// Opens the crop overlay and resolves with {sx, sy, ss} in *source-image*
// pixel coordinates (square selection), or null if the user cancels.
//
// The selection lives in source coords throughout — display ↔ source is one
// shared `scale` factor since the image is rendered with object-fit:contain
// preserving aspect ratio. Display layout is recomputed on window resize so
// the box tracks the image instead of detaching.
function openIconCropper(img) {
  return new Promise((resolve) => {
    const overlay = $('#icon-crop-overlay');
    const stage = $('#icon-crop-stage');
    const imgEl = $('#icon-crop-image');
    const boxEl = $('#icon-crop-box');
    const resetBtn = $('#icon-crop-reset');
    const cancelBtn = $('#icon-crop-cancel');
    const confirmBtn = $('#icon-crop-confirm');

    const imgW = img.naturalWidth;
    const imgH = img.naturalHeight;
    // Pathological tiny images (<32px) can't honor the source-px floor; back
    // off so the box never tries to exceed the image itself.
    const minSize = Math.min(ICON_CROP_MIN_SOURCE_PX, imgW, imgH);
    imgEl.src = img.src;
    overlay.classList.remove('hidden');

    let cropX = 0, cropY = 0, cropSize = 0;
    let layout = null;

    function relayout() {
      const sw = stage.clientWidth;
      const sh = stage.clientHeight;
      if (!sw || !sh) return;
      const stageR = sw / sh;
      const imgR = imgW / imgH;
      let dispW, dispH;
      if (imgR > stageR) { dispW = sw; dispH = sw / imgR; }
      else { dispH = sh; dispW = sh * imgR; }
      const left = (sw - dispW) / 2;
      const top = (sh - dispH) / 2;
      imgEl.style.left = left + 'px';
      imgEl.style.top = top + 'px';
      imgEl.style.width = dispW + 'px';
      imgEl.style.height = dispH + 'px';
      layout = { left, top, scale: dispW / imgW };
      applyBox();
    }

    function applyBox() {
      cropSize = Math.max(minSize, Math.min(cropSize, imgW, imgH));
      cropX = Math.max(0, Math.min(cropX, imgW - cropSize));
      cropY = Math.max(0, Math.min(cropY, imgH - cropSize));
      if (!layout) return;
      const { left, top, scale } = layout;
      boxEl.style.left = (left + cropX * scale) + 'px';
      boxEl.style.top = (top + cropY * scale) + 'px';
      boxEl.style.width = (cropSize * scale) + 'px';
      boxEl.style.height = (cropSize * scale) + 'px';
    }

    function resetCrop() {
      const minSide = Math.min(imgW, imgH);
      cropSize = Math.max(minSize, Math.floor(minSide * 0.8));
      cropX = Math.floor((imgW - cropSize) / 2);
      cropY = Math.floor((imgH - cropSize) / 2);
      applyBox();
    }

    resetCrop();
    // Defer until after first paint — clientWidth is 0 while overlay is
    // still transitioning from hidden to laid out.
    requestAnimationFrame(relayout);

    const onWinResize = () => relayout();
    window.addEventListener('resize', onWinResize);

    let drag = null;
    function toSourceCoords(e) {
      const r = stage.getBoundingClientRect();
      return {
        x: (e.clientX - r.left - layout.left) / layout.scale,
        y: (e.clientY - r.top - layout.top) / layout.scale,
      };
    }

    function onPointerDown(e) {
      if (e.button !== undefined && e.button !== 0) return;
      if (!layout) return;
      const handle = e.target?.dataset?.handle;
      if (handle) {
        let anchorX, anchorY, dirX, dirY;
        if (handle === 'nw') { anchorX = cropX + cropSize; anchorY = cropY + cropSize; dirX = -1; dirY = -1; }
        else if (handle === 'ne') { anchorX = cropX; anchorY = cropY + cropSize; dirX = 1; dirY = -1; }
        else if (handle === 'sw') { anchorX = cropX + cropSize; anchorY = cropY; dirX = -1; dirY = 1; }
        else { anchorX = cropX; anchorY = cropY; dirX = 1; dirY = 1; }
        drag = { mode: 'resize', anchorX, anchorY, dirX, dirY };
      } else if (boxEl.contains(e.target) || e.target === boxEl) {
        const { x, y } = toSourceCoords(e);
        drag = { mode: 'move', startX: x, startY: y, origCX: cropX, origCY: cropY };
      } else {
        return;
      }
      e.preventDefault();
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    }

    function onPointerMove(e) {
      if (!drag || !layout) return;
      const { x, y } = toSourceCoords(e);
      if (drag.mode === 'move') {
        cropX = drag.origCX + (x - drag.startX);
        cropY = drag.origCY + (y - drag.startY);
      } else {
        const { anchorX, anchorY, dirX, dirY } = drag;
        const extentX = (x - anchorX) * dirX;
        const extentY = (y - anchorY) * dirY;
        const maxX = dirX > 0 ? (imgW - anchorX) : anchorX;
        const maxY = dirY > 0 ? (imgH - anchorY) : anchorY;
        const newSize = Math.max(
          minSize,
          Math.min(Math.max(extentX, extentY), maxX, maxY)
        );
        cropSize = newSize;
        cropX = dirX > 0 ? anchorX : anchorX - newSize;
        cropY = dirY > 0 ? anchorY : anchorY - newSize;
      }
      applyBox();
    }

    function onPointerUp() {
      drag = null;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    }

    stage.addEventListener('pointerdown', onPointerDown);

    function cleanup(result) {
      overlay.classList.add('hidden');
      stage.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('resize', onWinResize);
      resetBtn.removeEventListener('click', onReset);
      cancelBtn.removeEventListener('click', onCancel);
      confirmBtn.removeEventListener('click', onConfirm);
      imgEl.removeAttribute('src');
      _iconCropCancel = null;
      resolve(result);
    }
    function onReset() { resetCrop(); }
    function onCancel() { cleanup(null); }
    function onConfirm() {
      cleanup({
        sx: Math.round(cropX),
        sy: Math.round(cropY),
        ss: Math.round(cropSize),
      });
    }

    resetBtn.addEventListener('click', onReset);
    cancelBtn.addEventListener('click', onCancel);
    confirmBtn.addEventListener('click', onConfirm);
    _iconCropCancel = onCancel;
  });
}

async function handleWallpaperUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    wallpaper = await processWallpaper(file);
    await saveWallpaper();
    applyWallpaper();
  } catch (err) {
    console.error('Wallpaper upload failed:', err);
    showToast(getWallpaperUploadErrorMessage(err), 'error');
  }
  e.target.value = '';
}

async function removeWallpaperAction() {
  wallpaper = null;
  await saveWallpaper();
  applyWallpaper();
}

function updateIconPreview(dataUrl) {
  const preview = $('#icon-preview');
  const clearBtn = $('#icon-clear-btn');
  if (dataUrl) {
    preview.innerHTML = `<img src="${escapeAttr(dataUrl)}" style="width:100%;height:100%;object-fit:contain">`;
    clearBtn.classList.remove('hidden');
  } else {
    preview.innerHTML = `<span class="icon-preview-placeholder">${escapeHtml(t('dialog.edit.iconNone'))}</span>`;
    clearBtn.classList.add('hidden');
  }
}

const ICON_FALLBACK_STYLE = 'display:none;font-size:1.875rem;font-weight:600;color:#cbd5e1;pointer-events:none';
const ICON_FALLBACK_STYLE_SM = 'display:none;font-size:10px;color:#cbd5e1;font-weight:bold;pointer-events:none';
const FOLDER_PREVIEW_ICON = '<svg class="folder-slot-folder-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#e5e7eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>';
const FOLDER_PREVIEW_ICON_MINI = '<svg class="folder-mini-folder-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#e5e7eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>';

// Renders a single normal slot (1 child icon) in the large-folder slot grid.
function renderFolderNormalSlot(child) {
  if (!child) return `<div class="folder-slot-normal folder-slot-empty"></div>`;
  if (child.type === 'folder') {
    return `<div class="folder-slot-normal folder-slot-folder">${FOLDER_PREVIEW_ICON}</div>`;
  }
  const previewAttr = child.type === 'link' ? ` data-preview-child-id="${escapeAttr(child.id)}"` : '';
  const ch = escapeHtml(child.name.charAt(0));
  if (child.icon) {
    return `<div class="folder-slot-normal"${previewAttr}>${buildManagedImageTag({ src: child.icon, errorMode: 'show-sibling' })}<span class="folder-slot-letter" style="display:none">${ch}</span></div>`;
  }
  const cached = (window.iconCache && typeof window.iconCache.getCachedIcon === 'function')
    ? window.iconCache.getCachedIcon(child.url)
    : '';
  if (cached) {
    return `<div class="folder-slot-normal"${previewAttr}>${buildManagedImageTag({ src: cached, errorMode: 'show-sibling' })}<span class="folder-slot-letter" style="display:none">${ch}</span></div>`;
  }
  const fav = getFavicon(child.url);
  if (fav) {
    return `<div class="folder-slot-normal"${previewAttr}>${buildManagedImageTag({ src: fav, fallbackSrc: getFaviconFallback(child.url), errorMode: 'show-sibling' })}<span class="folder-slot-letter" style="display:none">${ch}</span></div>`;
  }
  return `<div class="folder-slot-normal"${previewAttr}><span class="folder-slot-letter">${ch}</span></div>`;
}

// Renders the last slot as a 2×2 mini-group of up to 4 icons.
function renderFolderMiniSlot(miniChildren) {
  let iconsHtml = '';
  for (const child of miniChildren) {
    if (!child) {
      iconsHtml += `<div class="folder-mini-icon folder-mini-icon-empty"></div>`;
      continue;
    }
    if (child.type === 'folder') {
      iconsHtml += `<div class="folder-mini-icon folder-mini-folder-slot">${FOLDER_PREVIEW_ICON_MINI}</div>`;
      continue;
    }
    const ch = escapeHtml(child.name.charAt(0));
    if (child.icon) {
      iconsHtml += `<div class="folder-mini-icon">${buildManagedImageTag({ src: child.icon, errorMode: 'show-sibling' })}<span class="folder-mini-letter" style="display:none">${ch}</span></div>`;
      continue;
    }
    const cached = (window.iconCache && typeof window.iconCache.getCachedIcon === 'function')
      ? window.iconCache.getCachedIcon(child.url)
      : '';
    if (cached) {
      iconsHtml += `<div class="folder-mini-icon">${buildManagedImageTag({ src: cached, errorMode: 'show-sibling' })}<span class="folder-mini-letter" style="display:none">${ch}</span></div>`;
      continue;
    }
    const fav = getFavicon(child.url);
    if (fav) {
      iconsHtml += `<div class="folder-mini-icon">${buildManagedImageTag({ src: fav, fallbackSrc: getFaviconFallback(child.url), errorMode: 'show-sibling' })}<span class="folder-mini-letter" style="display:none">${ch}</span></div>`;
    } else {
      iconsHtml += `<div class="folder-mini-icon"><span class="folder-mini-letter">${ch}</span></div>`;
    }
  }
  return `<div class="folder-slot-mini-group">${iconsHtml}</div>`;
}

function renderIcon(item) {
  const ch = escapeHtml(item.name.charAt(0));
  const isExpandedLink = item.type === 'link' && getItemSize(item) !== '1x1';
  if (item.type === 'link') {
    if (item.icon) {
      const content = `${buildManagedImageTag({ src: item.icon, style: ICON_STYLE, errorMode: 'show-sibling' })}<span style="${ICON_FALLBACK_STYLE}">${ch}</span>`;
      return isExpandedLink ? `<div class="grid-item-link-preview">${content}</div>` : content;
    }
    const cached = (window.iconCache && typeof window.iconCache.getCachedIcon === 'function')
      ? window.iconCache.getCachedIcon(item.url)
      : '';
    if (cached) {
      const content = `${buildManagedImageTag({ src: cached, style: ICON_STYLE, errorMode: 'show-sibling' })}<span style="${ICON_FALLBACK_STYLE}">${ch}</span>`;
      return isExpandedLink ? `<div class="grid-item-link-preview">${content}</div>` : content;
    }
    const favicon = getFavicon(item.url);
    if (favicon) {
      const content = `${buildManagedImageTag({ src: favicon, style: ICON_STYLE, fallbackSrc: getFaviconFallback(item.url), errorMode: 'show-sibling' })}<span style="${ICON_FALLBACK_STYLE}">${ch}</span>`;
      return isExpandedLink ? `<div class="grid-item-link-preview">${content}</div>` : content;
    }
    const content = `<span style="font-size:1.875rem;font-weight:600;color:#cbd5e1;pointer-events:none">${ch}</span>`;
    return isExpandedLink ? `<div class="grid-item-link-preview">${content}</div>` : content;
  }

  if (item.icon) {
    return `${buildManagedImageTag({ src: item.icon, style: ICON_STYLE, errorMode: 'show-sibling' })}<span style="${ICON_FALLBACK_STYLE}">${ch}</span>`;
  }

  if (item.children.length === 0) {
    return `<svg class="grid-folder-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#e5e7eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
  }

  const sz = getItemSize(item);
  const layout = FOLDER_SLOT_LAYOUTS[sz];

  if (!layout) {
    // 1x1: existing 2×2 mini-grid preview
    const previews = item.children.slice(0, 4);
    const empties = 4 - previews.length;
    let cells = previews.map(c => {
      const cch = escapeHtml(c.name.charAt(0));
      if (c.icon) {
        return `<div class="folder-preview-cell">${buildManagedImageTag({ src: c.icon, errorMode: 'show-sibling' })}<span style="${ICON_FALLBACK_STYLE_SM}">${cch}</span></div>`;
      }
      const cached = (window.iconCache && typeof window.iconCache.getCachedIcon === 'function')
        ? window.iconCache.getCachedIcon(c.url)
        : '';
      if (cached) {
        return `<div class="folder-preview-cell">${buildManagedImageTag({ src: cached, errorMode: 'show-sibling' })}<span style="${ICON_FALLBACK_STYLE_SM}">${cch}</span></div>`;
      }
      const fav = getFavicon(c.url);
      if (fav) return `<div class="folder-preview-cell">${buildManagedImageTag({ src: fav, fallbackSrc: getFaviconFallback(c.url), errorMode: 'show-sibling' })}<span style="${ICON_FALLBACK_STYLE_SM}">${cch}</span></div>`;
      return `<div class="folder-preview-cell"><span style="font-size:10px;color:#cbd5e1;font-weight:bold;pointer-events:none">${cch}</span></div>`;
    }).join('');
    for (let i = 0; i < empties; i++) {
      cells += `<div class="folder-preview-cell empty"></div>`;
    }
    return `<div class="folder-preview-grid">${cells}</div>`;
  }

  // Large sizes: slot-based layout.
  // (cols * rows - 1) normal icon slots + 1 mini-group slot (2×2 grid of 4 icons).
  const { cols, rows } = layout;
  const totalSlots = cols * rows;
  const normalCount = totalSlots - 1;
  let slotsHtml = '';
  for (let i = 0; i < normalCount; i++) {
    slotsHtml += renderFolderNormalSlot(item.children[i] || null);
  }
  const miniChildren = [];
  for (let i = normalCount; i < normalCount + 4; i++) {
    miniChildren.push(item.children[i] || null);
  }
  slotsHtml += renderFolderMiniSlot(miniChildren);
  return `<div class="folder-slot-grid" style="grid-template-columns:repeat(${cols},var(--base-card-size));grid-template-rows:repeat(${rows},var(--base-card-size))">${slotsHtml}</div>`;
}

function createGridItemHTML(item) {
  const sz = getItemSize(item);
  return `
    <div class="grid-item-wrap" data-id="${escapeAttr(item.id)}" data-size="${sz}">
      <div class="grid-item-action-area">
        <div class="grid-item-card" data-action="click-item" data-item-type="${item.type}" draggable="true">
          ${renderIcon(item)}
        </div>
      </div>
      <span class="grid-item-name">${escapeHtml(item.name)}</span>
    </div>`;
}

function renderGrid(container, itemsList, options = {}) {
  const { showAddCard = true } = options;
  let html = '<div>';
  for (const item of itemsList) {
    html += createGridItemHTML(item);
  }
  if (showAddCard) {
    html += `
      <div class="grid-item-wrap add-wrap">
        <div class="grid-item-action-area">
          <div class="add-card" data-action="add">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </div>
        </div>
      </div>`;
  }
  html += '</div>';
  container.innerHTML = html;
}

function getGridItemMetrics(size, colWidth, gap) {
  const baseCard = Math.min(colWidth, 64);
  const layout = FOLDER_SLOT_LAYOUTS[size];
  if (!layout) {
    return { wrapHeight: null, cardWidth: baseCard, cardHeight: baseCard };
  }

  return {
    wrapHeight: layout.rows * colWidth + (layout.rows - 1) * gap,
    cardWidth: (layout.cols - 1) * (colWidth + gap) + baseCard,
    cardHeight: (layout.rows - 1) * (colWidth + gap) + baseCard,
  };
}

function updateGridItemSizes() {
  document.querySelectorAll('.grid-area > div, .modal-body > div').forEach(gridEl => {
    const cs = getComputedStyle(gridEl);
    const colStr = cs.getPropertyValue('grid-template-columns');
    const firstTrack = colStr.split(' ').find(Boolean);
    const colWidth = parseFloat(firstTrack);
    if (!colWidth || isNaN(colWidth)) return;

    const gap = parseFloat(cs.getPropertyValue('gap')) ||
                parseFloat(cs.getPropertyValue('column-gap')) || 16;

    gridEl.querySelectorAll('.grid-item-wrap[data-size]').forEach(wrap => {
      const size = wrap.dataset.size;
      const baseCard = Math.min(colWidth, 64);
      const { wrapHeight, cardWidth, cardHeight } = getGridItemMetrics(size, colWidth, gap);
      const miniGap = 2;
      const miniCell = Math.max(1, (baseCard - miniGap) / 2);
      const miniRadius = Math.max(1, Math.min(Math.floor(miniCell / 2), Math.round(miniCell * 0.25)));

      wrap.style.setProperty('--base-card-size', Math.round(baseCard) + 'px');
      wrap.style.setProperty('--card-w', Math.round(cardWidth) + 'px');
      wrap.style.setProperty('--card-h', Math.round(cardHeight) + 'px');
      wrap.style.setProperty('--preview-icon-size', Math.max(20, Math.round(baseCard * 0.625)) + 'px');
      wrap.style.setProperty('--preview-letter-size', Math.max(14, Math.round(baseCard * 0.46875)) + 'px');
      wrap.style.setProperty('--folder-mini-gap', miniGap + 'px');
      wrap.style.setProperty('--folder-mini-radius', miniRadius + 'px');
      wrap.style.setProperty('--folder-mini-letter-size', Math.max(8, Math.round(baseCard * 0.125)) + 'px');
      wrap.style.height = wrapHeight ? Math.round(wrapHeight) + 'px' : '';
    });
  });
}

function render() {
  renderGrid($('#grid-container'), items, { showAddCard: true });

  if (currentFolderId) {
    const folder = findItem(items, currentFolderId);
    if (folder && folder.type === 'folder') {
      const overlay = $('#folder-overlay');
      const wasHidden = overlay.classList.contains('hidden');
      overlay.classList.remove('hidden');
      $('#folder-title').innerHTML = `
        <div class="folder-title-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#e5e7eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
        </div>
        <span class="folder-name-display">${escapeHtml(folder.name)}</span>
        <button type="button" class="folder-rename-btn" data-action="rename-folder" title="${escapeAttr(t('folder.renameTitle'))}" aria-label="${escapeAttr(t('folder.renameTitle'))}">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
        </button>`;
      renderGrid($('#folder-grid'), folder.children, { showAddCard: false });
      if (wasHidden) {
        const modal = $('#folder-modal');
        modal.classList.remove('folder-opening', 'folder-closing');
        overlay.classList.remove('overlay-opening', 'overlay-closing');
        modal.getBoundingClientRect(); // force reflow
        modal.classList.add('folder-opening');
        overlay.classList.add('overlay-opening');
        modal.addEventListener('animationend', () => {
          modal.classList.remove('folder-opening');
        }, { once: true });
        overlay.addEventListener('animationend', () => {
          overlay.classList.remove('overlay-opening');
        }, { once: true });
      }
    }
  } else {
    $('#folder-overlay').classList.add('hidden');
  }

  updateGridItemSizes();
}

function closeFolderWithAnimation() {
  const overlay = $('#folder-overlay');
  const modal = $('#folder-modal');
  if (!modal || overlay.classList.contains('hidden')) {
    currentFolderId = null;
    render();
    return;
  }
  modal.classList.remove('folder-opening');
  modal.classList.add('folder-closing');
  overlay.classList.remove('overlay-opening');
  overlay.classList.add('overlay-closing');
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    modal.classList.remove('folder-closing');
    overlay.classList.remove('overlay-closing');
    currentFolderId = null;
    render();
  };
  overlay.addEventListener('animationend', finish, { once: true });
  setTimeout(finish, 320);
}

// Folder inline rename. Swaps the display span for an input; commit on
// Enter or blur, cancel on Escape. The 50-char cap prevents pathological
// strings from breaking the header layout — display itself ellipsises via
// max-width on .folder-name-display, but capping at the source is safer.
//
// The `!input.isConnected` guard inside commit/cancel matters: after we
// re-render the title we wipe the input from the DOM, but the queued blur
// event still fires synchronously afterwards and would re-enter commit
// (and incorrectly save the user's typed value when they pressed Escape).
// Checking `isConnected` lets the second invocation no-op cleanly.
const FOLDER_NAME_MAX_LEN = 50;

function enterFolderRenameMode() {
  if (!currentFolderId) return;
  const folder = findItem(items, currentFolderId);
  if (!folder) return;
  const display = $('#folder-title .folder-name-display');
  const renameBtn = $('#folder-title .folder-rename-btn');
  if (!display || !renameBtn) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'folder-name-input';
  input.value = folder.name;
  input.maxLength = FOLDER_NAME_MAX_LEN;
  input.setAttribute('aria-label', t('folder.renameTitle'));

  display.replaceWith(input);
  renameBtn.style.display = 'none';
  input.focus();
  input.select();

  const commit = () => {
    if (!input.isConnected) return;
    const next = input.value.trim().slice(0, FOLDER_NAME_MAX_LEN);
    if (next && next !== folder.name) {
      folder.name = next;
      saveItems();   // markSyncedDataChanged() inside saveItems handles cloud sync
    }
    render();   // restores display span + rename button
  };
  const cancel = () => {
    if (!input.isConnected) return;
    render();
  };
  const restoreFocus = () => {
    // After render() the rename button is a fresh DOM node, so requery.
    $('#folder-title .folder-rename-btn')?.focus();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); restoreFocus(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); restoreFocus(); }
  });
  // Blur (click-outside): commit silently without grabbing focus back — the
  // user explicitly moved focus elsewhere, so don't fight them.
  input.addEventListener('blur', commit);
}

function setUrlFieldVisible(visible) {
  const wrap = $('#url-field-wrap');
  if (wrap) wrap.style.display = visible ? '' : 'none';
}

function showEditModal(item, isInsideFolder) {
  editingItem = item;
  pendingIcon = '';
  const overlay = $('#edit-overlay');
  overlay.classList.remove('hidden');

  $('#edit-title').textContent = item ? t('dialog.edit.edit') : t('dialog.edit.add');
  $('#edit-name').value = item?.name || '';
  $('#edit-url').value = item?.url || '';

  const icon = item?.icon || '';
  updateIconPreview(icon);
  if (icon) {
    pendingIcon = icon;
    $('#icon-upload-btn').textContent = t('dialog.edit.iconUploadDone');
  } else {
    $('#icon-upload-btn').textContent = t('dialog.edit.iconUpload');
  }

  const typeToggle = $('#type-toggle');
  if (item || isInsideFolder) {
    // Edit mode (or add inside a folder where only links are allowed):
    // hide the type tabs and let the item's actual type drive field visibility.
    typeToggle.style.display = 'none';
    setUrlFieldVisible(item?.type !== 'folder');
  } else {
    typeToggle.style.display = 'flex';
    setActiveType(item?.type || 'link');
  }

  $('#edit-name').focus();
}

function hideEditModal() {
  editingItem = null;
  pendingIcon = '';
  $('#edit-overlay').classList.add('hidden');
  resetTypeToggle();
}

function resetTypeToggle() {
  $('#type-toggle').style.display = '';
  setUrlFieldVisible(true);
  $$('.type-btn').forEach(btn => {
    if (btn.dataset.type === 'link') {
      btn.classList.add('type-btn-active');
    } else {
      btn.classList.remove('type-btn-active');
    }
  });
}

function setActiveType(type) {
  $$('.type-btn').forEach(btn => {
    if (btn.dataset.type === type) {
      btn.classList.add('type-btn-active');
    } else {
      btn.classList.remove('type-btn-active');
    }
  });
  setUrlFieldVisible(type === 'link');
}

function getCurrentType() {
  const active = document.querySelector('.type-btn.type-btn-active');
  return active ? active.dataset.type : 'link';
}

function openDeleteConfirm(id) {
  itemToDelete = id;
  $('#delete-overlay').classList.remove('hidden');
}

function hideDeleteConfirm() {
  itemToDelete = null;
  $('#delete-overlay').classList.add('hidden');
}

function confirmDelete() {
  if (!itemToDelete) return;
  const removeFromList = (list) => {
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].id === itemToDelete) {
        list.splice(i, 1);
        return true;
      }
      if (list[i].children) removeFromList(list[i].children);
    }
    return false;
  };
  removeFromList(items);
  saveItems();
  hideDeleteConfirm();
  render();
  if (window.iconCache) {
    Promise.resolve().then(() => window.iconCache.pruneOrphans(items).catch(() => {}));
  }
}

function handleSaveItem(e) {
  e.preventDefault();
  const name = $('#edit-name').value.trim();
  if (!name) return;

  const isExisting = !!editingItem;
  const isInsideFolder = !!currentFolderId && !isExisting;
  const type = isExisting ? editingItem.type : (isInsideFolder ? 'link' : getCurrentType());
  const url = type === 'link' ? $('#edit-url').value.trim() : undefined;
  const icon = pendingIcon || '';

  if (type === 'link' && (!url || !isValidUrl(url))) return;

  if (isExisting) {
    const updateList = (list) => list.map(item => {
      if (item.id === editingItem.id) return { ...item, name, url, icon };
      if (item.children) return { ...item, children: updateList(item.children) };
      return item;
    });
    items = updateList(items);
  } else {
    const newItem = {
      id: generateId(),
      type,
      name,
      url,
      icon,
      size: '1x1',
      ...(type === 'folder' ? { children: [] } : {}),
    };
    if (currentFolderId && isInsideFolder) {
      const folder = findItem(items, currentFolderId);
      if (folder) folder.children.push(newItem);
    } else {
      items.push(newItem);
    }
  }

  saveItems();
  hideEditModal();
  render();

  // For links without a user-uploaded custom icon, fetch the favicon. On edit
  // we force a re-fetch so the user can use "edit → save" to refresh a stale
  // icon for that single shortcut.
  if (type === 'link' && url && !icon && window.iconCache) {
    Promise.resolve().then(async () => {
      try {
        const dataURL = await window.iconCache.ensureIconForUrl(url, { force: isExisting });
        if (dataURL) render();
      } catch {}
    });
  }
}

// --- FLIP drag animation helpers ---

function captureGridPositions() {
  const map = {};
  document.querySelectorAll('.grid-item-wrap[data-id]').forEach(el => {
    const rect = el.getBoundingClientRect();
    map[el.dataset.id] = { x: rect.left, y: rect.top };
  });
  return map;
}

function animateGridFlip(oldPositions) {
  const DURATION = 260;
  const EASING = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';
  document.querySelectorAll('.grid-item-wrap[data-id]').forEach(el => {
    const old = oldPositions[el.dataset.id];
    if (!old) return;
    const newRect = el.getBoundingClientRect();
    const dx = old.x - newRect.left;
    const dy = old.y - newRect.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    el.style.transform = `translate(${dx}px,${dy}px)`;
    el.style.transition = 'none';
    el.getBoundingClientRect(); // force reflow
    el.style.transition = `transform ${DURATION}ms ${EASING}`;
    el.style.transform = '';
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      el.style.transform = '';
      el.style.transition = '';
    };
    el.addEventListener('transitionend', cleanup, { once: true });
    setTimeout(cleanup, DURATION + 60);
  });
}

function clearDragVisuals() {
  document.querySelectorAll('.grid-item-dragging').forEach(el => el.classList.remove('grid-item-dragging'));
  document.querySelectorAll('.grid-item-combine').forEach(el => el.classList.remove('grid-item-combine'));
  document.querySelectorAll('.drag-indicator').forEach(el => el.remove());
  document.querySelectorAll('.drag-over-folder-bg').forEach(el => el.classList.remove('drag-over-folder-bg'));
  document.querySelectorAll('.move-to-main-hint').forEach(el => el.remove());
}

function applyDragVisuals() {
  clearDragVisuals();
  if (!dragState) return;

  const activeEl = document.querySelector(`.grid-item-wrap[data-id="${dragState.activeId}"] .grid-item-action-area`);
  if (activeEl) activeEl.classList.add('grid-item-dragging');

  if (!dragState.overId) return;

  if (dragState.overId === 'main-bg') {
    const overlay = $('#folder-overlay');
    overlay.classList.add('drag-over-folder-bg');
    const hint = document.createElement('div');
    hint.className = 'move-to-main-hint';
    hint.textContent = t('drag.moveToHomeHint');
    overlay.appendChild(hint);
    return;
  }

  const targetWrap = document.querySelector(`.grid-item-wrap[data-id="${dragState.overId}"]`);
  if (!targetWrap) return;
  const targetArea = targetWrap.querySelector('.grid-item-action-area');

  if (dragState.action === 'combine' && targetArea) {
    targetArea.classList.add('grid-item-combine');
  } else if (dragState.action === 'before' || dragState.action === 'after') {
    const ind = document.createElement('div');
    ind.className = `drag-indicator ${dragState.action === 'before' ? 'left' : 'right'}`;
    targetWrap.appendChild(ind);
  }
}

function handleDragStart(e, id) {
  dragState = { activeId: id, overId: null, action: null };
  e.dataTransfer.setData('text/plain', id);
  e.dataTransfer.effectAllowed = 'move';
  requestAnimationFrame(() => applyDragVisuals());
}

function updateDragStateForTarget(targetId, rect, clientX, clientY, allowCombine = true) {
  if (!dragState || dragState.activeId === targetId) return;

  const x = clientX - rect.left;
  const ratio = rect.width ? x / rect.width : 0.5;

  const activeItem = findItem(items, dragState.activeId);
  const isInsideFolder = !!currentFolderId;
  const preventCombine = isInsideFolder || activeItem?.type === 'folder' || !allowCombine;

  const thresholdLeft = preventCombine ? 0.5 : 0.3;
  const thresholdRight = preventCombine ? 0.5 : 0.7;

  let action;
  if (preventCombine && clientY < rect.top) action = 'before';
  else if (preventCombine && clientY > rect.bottom) action = 'after';
  else if (ratio < thresholdLeft) action = 'before';
  else if (ratio >= thresholdRight) action = 'after';
  else action = 'combine';

  if (dragState.overId === targetId && dragState.action === action) return;
  dragState = { ...dragState, overId: targetId, action };
  applyDragVisuals();
}

function handleDragOver(e, targetId, targetEl, allowCombine = true) {
  e.preventDefault();
  updateDragStateForTarget(targetId, targetEl.getBoundingClientRect(), e.clientX, e.clientY, allowCombine);
}

function getGridDropTargetAtPoint(target, clientX, clientY) {
  if (!dragState) return null;

  const gridHost = target.closest('.grid-area, .modal-body');
  if (!gridHost) return null;

  const gridEl = gridHost.firstElementChild;
  if (!gridEl) return null;

  const candidates = Array.from(gridEl.querySelectorAll('.grid-item-wrap[data-id]'))
    .filter(wrap => wrap.dataset.id !== dragState.activeId);
  if (!candidates.length) return null;

  let closest = null;
  let closestDistance = Infinity;

  candidates.forEach(wrap => {
    const rect = wrap.getBoundingClientRect();
    const dx = clientX < rect.left ? rect.left - clientX : clientX > rect.right ? clientX - rect.right : 0;
    const dy = clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
    const distance = Math.hypot(dx, dy);
    if (distance < closestDistance) {
      closest = { wrap, rect };
      closestDistance = distance;
    }
  });

  return closest;
}

function handleDrop(e, targetId) {
  e.preventDefault();
  e.stopPropagation();
  const resolvedTargetId = targetId || dragState?.overId;
  if (!dragState || !resolvedTargetId || dragState.activeId === resolvedTargetId) {
    dragState = null;
    clearDragVisuals();
    return;
  }

  const { activeId, action } = dragState;
  dragState = null;
  clearDragVisuals();

  const newItems = deepClone(items);
  const activeItemObj = removeItem(newItems, activeId);
  if (!activeItemObj) { render(); return; }

  insertOrCombineItem(newItems, resolvedTargetId, action, activeItemObj);
  items = newItems;
  saveItems();
  const flipSnap = captureGridPositions();
  render();
  animateGridFlip(flipSnap);
}

function handleDragEnd() {
  dragState = null;
  clearDragVisuals();
  const overlay = $('#folder-overlay');
  if (overlay) {
    overlay.classList.remove('drag-over-folder-bg');
    overlay.querySelectorAll('.move-to-main-hint').forEach(el => el.remove());
  }
}

function handleDragOverFolderBg(e) {
  e.preventDefault();
  if (dragState && currentFolderId) {
    if (dragState.action !== 'move-to-main') {
      dragState = { ...dragState, overId: 'main-bg', action: 'move-to-main' };
      applyDragVisuals();
    }
  }
}

function handleDropFolderBg(e) {
  e.preventDefault();
  if (!dragState || dragState.action !== 'move-to-main') return;
  const { activeId } = dragState;
  dragState = null;
  clearDragVisuals();

  const newItems = deepClone(items);
  const activeItemObj = removeItem(newItems, activeId);
  if (activeItemObj) {
    newItems.push(activeItemObj);
    items = newItems;
    saveItems();
  }
  const flipSnap = captureGridPositions();
  render();
  animateGridFlip(flipSnap);
}

// Continent grouping for the timezone picker. Order = the order optgroups
// appear in the dropdown; Asia first because the default clock is Shanghai.
const CONTINENT_ORDER = ['asia', 'europe', 'americas', 'oceania', 'africa'];

function getContinentForTz(tz) {
  if (tz.startsWith('Asia/')) return 'asia';
  if (tz.startsWith('Europe/')) return 'europe';
  if (tz.startsWith('America/')) return 'americas';
  if (tz.startsWith('Australia/') || tz.startsWith('Pacific/')) return 'oceania';
  if (tz.startsWith('Africa/')) return 'africa';
  return 'other';
}

// "+8" / "+5:30" / "-5" → signed minutes for sorting.
function parseUtcOffsetMinutes(str) {
  const m = String(str).match(/^([+-])(\d+)(?::(\d+))?$/);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (parseInt(m[2], 10) * 60 + (m[3] ? parseInt(m[3], 10) : 0));
}

function renderClockSettings() {
  const list = $('#clock-list');
  const now = new Date();

  const removeTitle = escapeAttr(t('dialog.clockSettings.removeTitle'));
  const MAX_CLOCKS = 2;

  // Annotate every entry with its current offset + continent once, then group
  // by continent and sort each group ascending by UTC offset.
  const annotated = TIMEZONE_CITIES.map(entry => {
    const offset = getTimezoneOffset(entry.tz, now);
    return {
      ...entry,
      offset,
      offsetMin: parseUtcOffsetMinutes(offset),
      continent: getContinentForTz(entry.tz),
    };
  });
  const groups = CONTINENT_ORDER
    .map(cont => ({
      cont,
      items: annotated
        .filter(a => a.continent === cont)
        .sort((a, b) => a.offsetMin - b.offsetMin),
    }))
    .filter(g => g.items.length);

  list.innerHTML = tempClocks.map((c, i) => {
    const tzOptions = groups.map(g => {
      const opts = g.items.map(item => {
        const selected = item.tz === c.tz ? ' selected' : '';
        const cityName = t('city.' + item.key);
        return `<option value="${item.tz}" data-key="${escapeAttr(item.key)}"${selected}>${escapeHtml(cityName)} (UTC${item.offset})</option>`;
      }).join('');
      return `<optgroup label="${escapeAttr(t('continent.' + g.cont))}">${opts}</optgroup>`;
    }).join('');

    return `
    <div class="clock-entry" data-clock-idx="${i}">
      <span class="clock-entry-index">${i + 1}</span>
      <select class="clock-tz-select">
        ${tzOptions}
      </select>
      <button type="button" class="clock-remove-btn" data-action="remove-clock" title="${removeTitle}">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`;
  }).join('') +
  (tempClocks.length < MAX_CLOCKS
    ? `<button type="button" class="clock-add-entry" data-action="add-clock">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        ${escapeHtml(t('dialog.clockSettings.add'))}
      </button>`
    : `<p class="clock-limit-msg">${escapeHtml(t('dialog.clockSettings.atLimit', { max: MAX_CLOCKS }))}</p>`);
}

function showClockSettings() {
  tempClocks = deepClone(clocks);
  renderClockSettings();
  $('#clock-overlay').classList.remove('hidden');
}

function hideClockSettings() {
  tempClocks = [];
  $('#clock-overlay').classList.add('hidden');
}

function saveClockSettings() {
  const selects = $$('#clock-list .clock-tz-select');
  const newClocks = [];
  selects.forEach(sel => {
    const opt = sel.options[sel.selectedIndex];
    newClocks.push({
      id: generateId(),
      tz: sel.value,
      key: opt.dataset.key || getCityKeyForTz(sel.value) || null,
    });
  });
  clocks = newClocks;
  saveClocks();
  hideClockSettings();
  updateClock();
}

const SVG_EXTERNAL_LINK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
const SVG_EDIT = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
const SVG_TRASH = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
const SVG_PLUS = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
const SVG_IMAGE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
const SVG_X_CIRCLE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';

function showContextMenu(e) {
  e.preventDefault();

  if (e.target.closest('#search-form, #edit-overlay, #delete-overlay, #engine-dropdown, .context-menu, #clock-overlay')) return;

  const menu = $('#context-menu');
  const gridCard = e.target.closest('.grid-item-card');
  const gridItem = gridCard?.closest('.grid-item-wrap');
  const clockArea = e.target.closest('.clocks-wrap, .clock-container');
  let html = '';

  if (clockArea) {
    html += `<div class="ctx-item" data-ctx="clock-settings">${SVG_EDIT} ${escapeHtml(t('contextMenu.clockSettings'))}</div>`;
  } else if (gridItem) {
    const id = gridItem.dataset.id;
    const item = currentFolderId
      ? findItem(findItem(items, currentFolderId)?.children || [], id)
      : findItem(items, id);
    if (!item) return;

    contextTarget = item;

    if (item.type === 'link') {
      html += `<div class="ctx-item" data-ctx="open-new-tab">${SVG_EXTERNAL_LINK} ${escapeHtml(t('contextMenu.openInNewTab'))}</div>`;
    }
    html += `<div class="ctx-item" data-ctx="edit">${SVG_EDIT} ${escapeHtml(t('contextMenu.edit'))}</div>`;
    if (!currentFolderId) {
      html += `<div class="ctx-sep"></div>`;
      html += `<div class="ctx-size-grid">`;
      for (const sz of SIZES) {
        const active = getItemSize(item) === sz ? ' size-active' : '';
        html += `<div class="ctx-size-btn${active}" data-ctx="size-${sz}">${SIZE_LABELS[sz]}</div>`;
      }
      html += `</div>`;
    }
    html += `<div class="ctx-sep"></div>`;
    html += `<div class="ctx-item ctx-danger" data-ctx="delete">${SVG_TRASH} ${escapeHtml(t('contextMenu.delete'))}</div>`;
  } else {
    if (currentFolderId) return;
    contextTarget = null;
    html += `<div class="ctx-item" data-ctx="add">${SVG_PLUS} ${escapeHtml(t('contextMenu.addShortcut'))}</div>`;
    html += `<div class="ctx-item" data-ctx="wallpaper">${SVG_IMAGE} ${escapeHtml(t('contextMenu.changeWallpaper'))}</div>`;
    if (wallpaper) {
      html += `<div class="ctx-item ctx-danger" data-ctx="remove-wallpaper">${SVG_X_CIRCLE} ${escapeHtml(t('contextMenu.removeWallpaper'))}</div>`;
    }
  }

  menu.innerHTML = html;
  menu.classList.remove('hidden');

  requestAnimationFrame(() => {
    let x = e.clientX;
    let y = e.clientY;
    const mRect = menu.getBoundingClientRect();
    if (x + mRect.width > window.innerWidth) x = window.innerWidth - mRect.width - 8;
    if (y + mRect.height > window.innerHeight) y = window.innerHeight - mRect.height - 8;
    if (x < 0) x = 8;
    if (y < 0) y = 8;
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
  });
}

function hideContextMenu() {
  $('#context-menu').classList.add('hidden');
  contextTarget = null;
}

function handleContextAction(action) {
  const item = contextTarget;
  hideContextMenu();

  if (action.startsWith('size-')) {
    const newSize = action.slice(5);
    if (currentFolderId || !SIZES.includes(newSize) || !item) return;
    const updateSize = (list) => list.map(it => {
      if (it.id === item.id) return { ...it, size: newSize };
      if (it.children) return { ...it, children: updateSize(it.children) };
      return it;
    });
    items = updateSize(items);
    saveItems();
    render();
    return;
  }

  switch (action) {
    case 'open-new-tab':
      if (item?.type === 'link' && isValidUrl(item.url)) window.open(item.url, '_blank');
      break;
    case 'edit':
      if (item) showEditModal(item, !!currentFolderId);
      break;
    case 'delete':
      if (item) openDeleteConfirm(item.id);
      break;
    case 'add':
      if (!currentFolderId) showEditModal(null, false);
      break;
    case 'wallpaper':
      $('#wallpaper-input').click();
      break;
    case 'remove-wallpaper':
      removeWallpaperAction();
      break;
    case 'clock-settings':
      showClockSettings();
      break;
  }
}

function setupEventListeners() {
  setInterval(updateClock, 1000);
  updateClock();

  $('#search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const query = $('#search-input').value.trim();
    if (query) {
      const engine = getSelectedEngine();
      const targetUrl = engine.url.replace('%s', encodeURIComponent(query));
      if (isValidUrl(targetUrl)) window.location.href = targetUrl;
    }
  });

  $('#engine-trigger').addEventListener('click', (e) => {
    e.preventDefault();
    toggleEngineDropdown();
  });

  $('#engine-list').addEventListener('click', (e) => {
    const delBtn = e.target.closest('[data-action="delete-engine"]');
    if (delBtn) {
      e.stopPropagation();
      deleteEngine(delBtn.dataset.engineId);
      return;
    }
    const engineItem = e.target.closest('.engine-item');
    if (engineItem) {
      selectEngine(engineItem.dataset.engineId);
    }
  });

  $('#add-engine-btn').addEventListener('click', () => {
    const form = $('#add-engine-form');
    form.classList.toggle('hidden');
    if (!form.classList.contains('hidden')) {
      $('#new-engine-name').focus();
    }
  });

  $('#save-engine-btn').addEventListener('click', addEngine);
  $('#cancel-engine-btn').addEventListener('click', () => {
    $('#add-engine-form').classList.add('hidden');
    $('#new-engine-name').value = '';
    $('#new-engine-url').value = '';
  });

  document.addEventListener('click', (e) => {
    if (!$('#engine-dropdown').contains(e.target) && e.target !== $('#engine-trigger') && !$('#engine-trigger').contains(e.target)) {
      hideEngineDropdown();
    }
  });

  document.addEventListener('click', (e) => {
    const sidebar = $('#left-sidebar');
    const sidebarHandle = $('#left-sidebar-handle');
    if (!sidebar || !sidebar.classList.contains('is-open')) return;
    if (!sidebar.contains(e.target)) {
      sidebar.classList.remove('is-open');
      sidebarHandle?.setAttribute('aria-expanded', 'false');
    }
  });

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'delete-engine') return;

    const wrap = btn.closest('.grid-item-wrap');
    const id = wrap?.dataset.id;

    e.stopPropagation();

    switch (action) {
      case 'click-item': {
        if (dragState?.activeId) return;
        const item = currentFolderId
          ? findItem(findItem(items, currentFolderId)?.children || [], id)
          : findItem(items, id);
        if (!item) return;
        if (item.type === 'folder' && getItemSize(item) !== '1x1') {
          const previewSlot = e.target.closest('.folder-slot-normal[data-preview-child-id]');
          if (previewSlot) {
            const child = item.children.find(c => c.id === previewSlot.dataset.previewChildId);
            if (child?.type === 'link' && isValidUrl(child.url)) {
              window.location.href = child.url;
              return;
            }
          }
        }
        if (item.type === 'link' && isValidUrl(item.url)) window.location.href = item.url;
        else currentFolderId = item.id;
        render();
        break;
      }
      case 'add': {
        showEditModal(null, !!currentFolderId);
        break;
      }
    }
  });

  document.addEventListener('contextmenu', showContextMenu);

  $('#context-menu').addEventListener('click', (e) => {
    const ctxItem = e.target.closest('[data-ctx]');
    if (!ctxItem) return;
    e.stopPropagation();
    handleContextAction(ctxItem.dataset.ctx);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.context-menu')) {
      hideContextMenu();
    }
  });

  document.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.grid-item-card');
    if (!card) return;
    const wrap = card.closest('.grid-item-wrap');
    if (!wrap || !wrap.dataset.id) return;
    handleDragStart(e, wrap.dataset.id);
  });

  document.addEventListener('dragover', (e) => {
    const actionArea = e.target.closest('.grid-item-action-area');
    if (actionArea) {
      const wrap = actionArea.closest('.grid-item-wrap[data-id]');
      if (wrap && wrap.dataset.id) handleDragOver(e, wrap.dataset.id, actionArea, true);
      return;
    }

    const wrap = e.target.closest('.grid-item-wrap[data-id]');
    if (wrap && wrap.dataset.id) {
      handleDragOver(e, wrap.dataset.id, wrap, false);
      return;
    }

    const gapTarget = getGridDropTargetAtPoint(e.target, e.clientX, e.clientY);
    if (gapTarget) {
      e.preventDefault();
      updateDragStateForTarget(gapTarget.wrap.dataset.id, gapTarget.rect, e.clientX, e.clientY, false);
    }
  });

  document.addEventListener('drop', (e) => {
    const actionArea = e.target.closest('.grid-item-action-area');
    if (actionArea) {
      const wrap = actionArea.closest('.grid-item-wrap[data-id]');
      if (wrap && wrap.dataset.id) handleDrop(e, wrap.dataset.id);
      return;
    }

    const wrap = e.target.closest('.grid-item-wrap[data-id]');
    if (wrap && wrap.dataset.id) {
      updateDragStateForTarget(wrap.dataset.id, wrap.getBoundingClientRect(), e.clientX, e.clientY, false);
      handleDrop(e, wrap.dataset.id);
      return;
    }

    const gapTarget = getGridDropTargetAtPoint(e.target, e.clientX, e.clientY);
    if (gapTarget) {
      updateDragStateForTarget(gapTarget.wrap.dataset.id, gapTarget.rect, e.clientX, e.clientY, false);
      handleDrop(e, gapTarget.wrap.dataset.id);
    }
  });

  document.addEventListener('dragend', handleDragEnd);

  $('#folder-overlay').addEventListener('click', (e) => {
    if (e.target === $('#folder-overlay')) {
      closeFolderWithAnimation();
    }
  });
  $('#folder-overlay').addEventListener('dragover', (e) => {
    if (e.target === $('#folder-overlay')) handleDragOverFolderBg(e);
  });
  $('#folder-overlay').addEventListener('drop', (e) => {
    if (e.target === $('#folder-overlay')) handleDropFolderBg(e);
  });

  $('#folder-close').addEventListener('click', () => {
    closeFolderWithAnimation();
  });

  // Folder inline rename — click the pencil icon to swap the display span
  // for an input, type new name, then commit on Enter/blur or cancel on Esc.
  $('#folder-title').addEventListener('click', (e) => {
    if (e.target.closest('[data-action="rename-folder"]')) {
      enterFolderRenameMode();
    }
  });

  $('#delete-cancel').addEventListener('click', hideDeleteConfirm);
  $('#delete-confirm').addEventListener('click', confirmDelete);

  $('#edit-close').addEventListener('click', hideEditModal);
  $('#edit-form').addEventListener('submit', handleSaveItem);

  $$('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => setActiveType(btn.dataset.type));
  });

  $('#wallpaper-input').addEventListener('change', handleWallpaperUpload);
  $('#sidebar-wallpaper-upload-btn')?.addEventListener('click', () => {
    $('#wallpaper-input').click();
  });
  $('#sidebar-wallpaper-clear-btn')?.addEventListener('click', () => {
    if (!wallpaper) return;
    removeWallpaperAction();
  });

  $('#refresh-icons-btn')?.addEventListener('click', handleRefreshAllIcons);

  $('#lang-toggle')?.addEventListener('click', () => {
    if (window.I18N) window.I18N.setLang(window.I18N.getNextLang());
  });

  const blurRange = $('#wallpaper-blur-range');
  const dimRange = $('#wallpaper-dim-range');
  if (blurRange) {
    blurRange.addEventListener('input', (e) => {
      wallpaperBlur = parseInt(e.target.value, 10);
      applyWallpaperEffects();
    });
    blurRange.addEventListener('change', () => saveWallpaperEffects());
  }
  if (dimRange) {
    dimRange.addEventListener('input', (e) => {
      wallpaperDim = parseInt(e.target.value, 10);
      applyWallpaperEffects();
    });
    dimRange.addEventListener('change', () => saveWallpaperEffects());
  }

  $('#icon-upload-btn').addEventListener('click', () => {
    $('#edit-icon-file').click();
  });

  $('#icon-clear-btn').addEventListener('click', () => {
    pendingIcon = '';
    updateIconPreview('');
    $('#icon-upload-btn').textContent = t('dialog.edit.iconUpload');
  });

  $('#edit-icon-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const result = await processIconFile(file);
      if (result == null) { e.target.value = ''; return; }   // user cancelled cropper
      pendingIcon = result;
      updateIconPreview(pendingIcon);
      $('#icon-upload-btn').textContent = file.name;
    } catch (err) {
      console.error('Icon upload failed:', err);
    }
    e.target.value = '';
  });

  $('#clock-settings-form').addEventListener('submit', (e) => {
    e.preventDefault();
    saveClockSettings();
  });
  $('#clock-settings-close').addEventListener('click', hideClockSettings);
  $('#clock-list').addEventListener('click', (e) => {
    const addBtn = e.target.closest('[data-action="add-clock"]');
    if (addBtn) {
      if (tempClocks.length >= 2) return;
      const defaultTz = TIMEZONE_CITIES.find(entry => entry.tz === 'America/New_York') || TIMEZONE_CITIES[0];
      tempClocks.push({ id: generateId(), tz: defaultTz.tz, key: defaultTz.key });
      renderClockSettings();
      return;
    }
    const btn = e.target.closest('[data-action="remove-clock"]');
    if (!btn) return;
    const entry = btn.closest('.clock-entry');
    const idx = parseInt(entry?.dataset.clockIdx);
    if (isNaN(idx)) return;
    tempClocks.splice(idx, 1);
    if (tempClocks.length === 0) tempClocks = deepClone(DEFAULT_CLOCKS);
    renderClockSettings();
  });

  const sidebar = $('#left-sidebar');
  const sidebarHandle = $('#left-sidebar-handle');
  const gridColumnsRange = $('#grid-columns-range');
  if (sidebar && sidebarHandle) {
    const toggleSidebar = (forceOpen = null) => {
      const nextOpen = typeof forceOpen === 'boolean' ? forceOpen : !sidebar.classList.contains('is-open');
      sidebar.classList.toggle('is-open', nextOpen);
      sidebarHandle.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
    };

    sidebarHandle.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSidebar();
    });

    sidebarHandle.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleSidebar();
      } else if (e.key === 'Escape') {
        toggleSidebar(false);
      }
    });
  }

  if (gridColumnsRange) {
    gridColumnsRange.addEventListener('input', (e) => {
      setMainGridColumns(e.target.value, false);
    });
    gridColumnsRange.addEventListener('change', (e) => {
      setMainGridColumns(e.target.value, true);
    });
  }

  // Centralized Escape handler. Walks dialogs top-down (highest z-index
  // first); the first open one is closed and we stop. Sidebar is the
  // lowest-priority fallback. The delete-account modal owns its own Esc
  // handler in firebase.js (it resolves a pending Promise on close), so
  // we skip it here to avoid double-firing.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;

    // Folder rename input has its own Esc semantics (cancel rename, don't
    // close the folder). If it's focused, let its onkeydown handler take it.
    if (document.activeElement?.classList.contains('folder-name-input')) return;

    const isOpen = (id) => {
      const el = document.getElementById(id);
      return el && !el.classList.contains('hidden');
    };

    if (isOpen('delete-account-overlay')) return;            // firebase.js handles this one
    if (isOpen('delete-overlay')) { hideDeleteConfirm(); return; }
    if (isOpen('login-consent-overlay')) { _hideLoginConsentOverlayIfPresent(); return; }
    if (isOpen('icon-crop-overlay')) { _iconCropCancel?.(); return; }
    if (isOpen('edit-overlay')) { hideEditModal(); return; }
    if (isOpen('clock-overlay')) { hideClockSettings(); return; }
    if (isOpen('login-overlay')) { _hideLoginOverlayIfPresent(); return; }
    if (isOpen('folder-overlay')) { closeFolderWithAnimation(); return; }

    const sidebar = $('#left-sidebar');
    const sidebarHandle = $('#left-sidebar-handle');
    if (sidebar?.classList.contains('is-open')) {
      sidebar.classList.remove('is-open');
      sidebarHandle?.setAttribute('aria-expanded', 'false');
    }
  });

  // Tiny shims so this file doesn't depend on firebase.js being loaded
  // (which it always is in production, but tests / partial builds may differ).
  function _hideLoginOverlayIfPresent() {
    document.getElementById('login-overlay')?.classList.add('hidden');
  }
  function _hideLoginConsentOverlayIfPresent() {
    document.getElementById('login-consent-overlay')?.classList.add('hidden');
  }

  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || img.dataset.managedImg !== 'true') return;
    handleManagedImageError(img);
  }, true);

  window.addEventListener('resize', updateGridItemSizes);
}

async function init() {
  try {
    await migrateLegacyLocalStorage();
    await loadAll();
  } catch {
    items = getDefaultData();
    clocks = deepClone(DEFAULT_CLOCKS);
    mainGridColumns = DEFAULT_MAIN_GRID_COLUMNS;
  }
  try {
    const effectsData = await storage.get(['startpage_wallpaper_blur', 'startpage_wallpaper_dim']);
    if (typeof effectsData.startpage_wallpaper_blur === 'number') {
      wallpaperBlur = Math.max(0, Math.min(20, effectsData.startpage_wallpaper_blur));
    }
    if (typeof effectsData.startpage_wallpaper_dim === 'number') {
      wallpaperDim = Math.max(0, Math.min(80, effectsData.startpage_wallpaper_dim));
    }
  } catch {}
  // Preload favicon cache before first render so renderIcon can look it up synchronously.
  try {
    if (window.iconCache) await window.iconCache.loadCache();
  } catch {}
  applyWallpaper();
  applyWallpaperEffects();
  applyMainGridColumns();
  updateClock();
  $('#engine-name').textContent = getSelectedEngine().name;
  setupEventListeners();
  render();
  fbInit();
  scheduleIconCacheRefresh();
}

function scheduleIconCacheRefresh() {
  if (!window.iconCache) return;
  // Fire-and-forget; refreshes stale/missing entries then re-renders if anything changed.
  Promise.resolve().then(async () => {
    try {
      const updated = await window.iconCache.refreshAll(items, { staleOnly: true });
      if (updated > 0) render();
    } catch {}
  });
}

let _iconRefreshInFlight = false;
async function handleRefreshAllIcons() {
  if (_iconRefreshInFlight) return;
  if (!window.iconCache) {
    showToast(t('toast.iconCacheUnavailable'), 'error');
    return;
  }
  const btn = $('#refresh-icons-btn');
  const status = $('#icon-refresh-status');
  _iconRefreshInFlight = true;
  if (btn) btn.disabled = true;
  if (status) status.textContent = t('toast.iconRefreshing');
  try {
    const updated = await window.iconCache.refreshAll(items, {
      force: true,
      skipHostsWithCustomIcon: true,
    });
    render();
    if (status) status.textContent = '';
    showToast(updated > 0 ? t('toast.iconRefreshedCount', { count: updated }) : t('toast.iconAlreadyFresh'), 'default');
  } catch {
    if (status) status.textContent = '';
    showToast(t('toast.iconRefreshFailed'), 'error');
  } finally {
    _iconRefreshInFlight = false;
    if (btn) btn.disabled = false;
  }
}

// Re-render dynamic JS-built UI on language change. Static markup with
// `data-i18n*` attributes is handled by i18n.js's applyDom() automatically.
window.addEventListener('lithium:langchange', () => {
  // Clocks: city labels are read from t() inside updateClock().
  updateClock();

  // Sidebar wallpaper preview: aria-label + label text are localized.
  updateSidebarWallpaperPreview();

  // Context menu: items are built on-open and don't track language. Hiding
  // is cheaper and clearer than reconstructing the menu in place.
  hideContextMenu();

  // Engine dropdown (delete button title) — re-render only if currently visible.
  const engineDropdown = $('#engine-dropdown');
  if (engineDropdown && !engineDropdown.classList.contains('hidden')) {
    renderEngineDropdown();
  }

  // Engine name display (only re-render for built-in engines whose name is
  // not localized today, but call this to keep it consistent if we ever
  // localize default engine names).
  const engineNameEl = $('#engine-name');
  if (engineNameEl) engineNameEl.textContent = getSelectedEngine().name;

  // Clock settings dialog list (if open).
  const clockOverlay = $('#clock-overlay');
  if (clockOverlay && !clockOverlay.classList.contains('hidden')) {
    renderClockSettings();
  }

  // Edit dialog (if open): refresh title + icon-upload button label.
  const editOverlay = $('#edit-overlay');
  if (editOverlay && !editOverlay.classList.contains('hidden')) {
    const titleEl = $('#edit-title');
    if (titleEl) titleEl.textContent = editingItem ? t('dialog.edit.edit') : t('dialog.edit.add');
    const iconBtn = $('#icon-upload-btn');
    if (iconBtn) {
      iconBtn.textContent = pendingIcon ? t('dialog.edit.iconUploadDone') : t('dialog.edit.iconUpload');
    }
    // Refresh icon-preview placeholder if showing the "none" state.
    if (!pendingIcon) updateIconPreview('');
  }

  // Toast: in-flight messages already committed are intentionally left as-is.
});

init();
