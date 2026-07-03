import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_SRC = readFileSync(path.join(__dirname, '../../app.js'), 'utf8');

// Strip the trailing auto-invoked init() so loading in tests does not
// kick off the startup chain (migrate→loadAll→render→fbInit...).
const APP_SRC_NO_INIT = APP_SRC.replace(/\ninit\(\);\s*$/, '\n');

// All 30 pure-logic function names exposed on globalThis after eval.
// Task 1 tests the first 9; Task 2/3 will use the rest — listed up front
// so neither task needs to modify this helper.
const EXPORTED_NAMES = [
  'getDefaultData', 'getClockCityName', 'getCityKeyForTz', 'migrateClocks',
  'generateId', 'deepClone', 'escapeHtml', 'escapeAttr', 'escapeCssUrl',
  'clampMainGridColumns', 'getMainGridMaxWidth', 'getItemSize',
  'normalizeFolderChildItemSizes', 'findItem', 'removeItem', 'insertOrCombineItem',
  'readLegacyLocalStorage', 'removeLegacyLocalStorage',
  'isValidUrl', 'getContinentForTz', 'parseUtcOffsetMinutes', 'getTimezoneOffset',
  'getWeatherCitiesFromItems', 'bindCityToItem', 'getGridItemMetrics',
  'buildManagedImageTag', 'getWallpaperUploadErrorMessage',
  'getFavicon', 'getFaviconFallback', 'hasFaviconApi',
  // Batch 2: storage/state functions (15). Task 1 tests the first 3
  // (markSyncedDataChanged, migrateLegacyLocalStorage, loadAll); Task 2/3
  // use the rest — listed up front so neither task needs to modify this helper.
  'markSyncedDataChanged', 'migrateLegacyLocalStorage', 'loadAll',
  'saveItems', 'saveEngines', 'saveWallpaper', 'saveWallpaperEffects',
  'saveClocks', 'saveMainGridColumns', 'pruneWeatherCache',
  'fetchWeatherForAllCities', 'getAllEngines', 'getSelectedEngine',
  'updateGridColumnsControls', 'setMainGridColumns',
  // Batch 3: render/dom-light functions (41 total across Tasks 1-5), added
  // up front so no later task in this batch needs to touch this file.
  //
  // Task 1 (12) — confirmed against app.js with full behavior specs in
  // task-1-brief.md; each is exercised by test/app.render-dom-light.test.js:
  'getCurrentType', 'hideEngineDropdown', 'hideContextMenu', 'openDeleteConfirm',
  'hideDeleteConfirm', 'hideClockSettings', 'setUrlFieldVisible',
  'applyWallpaperEffects', 'updateSidebarWallpaperPreview',
  'handleManagedImageError', 'updateGridItemSizes', 'applyMainGridColumns',
  // Tasks 2-5 (29), sourced verbatim from the batch-3 plan's Global
  // Constraint 4 (docs/superpowers/plans/2026-07-02-app-batch3-render-dom-light.md).
  // Task 2 (9): engine dropdown + wallpaper apply + toast/signin
  'renderEngineDropdown', 'toggleEngineDropdown', 'selectEngine', 'deleteEngine',
  'addEngine', 'applyWallpaper', 'removeWallpaperAction', 'showToast',
  'showSigninNotice',
  // Task 3 (9): clock settings + edit modal type toggle
  'updateClock', 'renderClockSettings', 'showClockSettings', 'saveClockSettings',
  'resetTypeToggle', 'setActiveType', 'updateIconPreview', 'showEditModal',
  'hideEditModal',
  // Task 4 (7): icon/grid render family
  'renderFolderNormalSlot', 'renderFolderMiniSlot', 'renderIcon',
  'createGridItemHTML', 'renderGrid', 'render', 'closeFolderWithAnimation',
  // Task 5 (4): delete confirm + form save + context menu
  'confirmDelete', 'handleSaveItem', 'showContextMenu', 'handleContextAction',
];

// app.js is a classic (non-module) script: its top-level `function`
// declarations attach to the global object, same as multiple <script> tags
// sharing one global lexical environment in a browser. Indirect eval runs
// in global scope for the same reason, so re-running it here re-defines
// every function fresh (own closure over reset module state) — giving each
// test full isolation without touching the production file.
//
// Note: the `window.addEventListener('lithium:langchange', ...)` near the
// end of app.js registers a harmless listener at load time; tests must NOT
// dispatch that event.
export function loadAppModule() {
  (0, eval)(APP_SRC_NO_INIT);
  const mod = {};
  for (const name of EXPORTED_NAMES) {
    mod[name] = globalThis[name];
  }
  return mod;
}