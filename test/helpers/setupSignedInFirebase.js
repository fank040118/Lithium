import { createMockChromeStorage } from './mockChromeStorage.js';
import { createRoutedFetch, jsonResponse } from './mockFetch.js';

export const TEST_UID = 'test-uid';
const FIRESTORE_DOC_URL_PART = `/documents/users/${TEST_UID}/data/settings`;

export function tokenRoute() {
  return {
    match: (url) => url.includes('securetoken.googleapis.com'),
    respond: async () => jsonResponse(200, {
      id_token: 'fresh-id-token',
      expires_in: '3600',
      refresh_token: 'refreshed-refresh-token',
      user_id: TEST_UID,
    }),
  };
}

export function firestoreGetRoute(responder) {
  return {
    match: (url, options = {}) =>
      url.includes(FIRESTORE_DOC_URL_PART) && (!options.method || options.method === 'GET'),
    respond: (url, options) => responder(url, options),
  };
}

export function firestorePatchRoute(responder) {
  return {
    match: (url, options = {}) =>
      url.includes(FIRESTORE_DOC_URL_PART) && options.method === 'PATCH',
    respond: (url, options) => responder(url, options),
  };
}

// Default persisted cloud baseline: a Known raw updateTime (with its derived
// ms key) that predates every cloud fixture, so pulls are never "unchanged"
// unless a test opts into it.
export const SEED_UPDATE_TIME = '2024-01-01T00:00:00.000000Z';
export const SEED_UPDATE_MS = Date.parse('2024-01-01T00:00:00Z');

function baselineSeed(baseline) {
  if (baseline === null) return {}; // Unknown: neither key present
  if (baseline === 'absent') return { _fb_cloud_update_time: 'absent', _fb_cloud_sync_ts: 0 };
  // Truncate to milliseconds the way the production ms key is derived.
  const ms = Date.parse(baseline.replace(/\.(\d{1,3})\d*Z$/, (_, d) => `.${d.padEnd(3, '0')}Z`));
  return { _fb_cloud_update_time: baseline, _fb_cloud_sync_ts: ms };
}

// baseline: raw updateTime string (Known), 'absent', or null (Unknown).
export async function setupSignedInFirebase(fb, { extraRoutes = [], baseline = SEED_UPDATE_TIME } = {}) {
  const storage = createMockChromeStorage({
    _fb_refresh: 'seed-refresh-token',
    _fb_uid: TEST_UID,
    _fb_email_verified: true,
    _fb_email: 'user@example.com',
    ...baselineSeed(baseline),
  });
  globalThis.chrome = storage;
  // extraRoutes are matched first so a test can override the default token
  // route (e.g. simulate a rejected refresh); tokenRoute() stays as fallback.
  globalThis.fetch = createRoutedFetch([...extraRoutes, tokenRoute()]);
  globalThis.items = [];
  globalThis.customEngines = [];
  globalThis.selectedEngineId = 'google';
  globalThis.clocks = [];
  globalThis.mainGridColumns = 4;
  globalThis.applyWallpaper = () => {};
  globalThis.applyMainGridColumns = () => {};
  globalThis.render = () => {};
  globalThis.getSelectedEngine = () => ({ name: 'Google' });
  document.body.innerHTML = '<div id="engine-name"></div>';

  await fb._loadAuth();
  if (fb._loadCloudBaseline) await fb._loadCloudBaseline();
  return { storage, uid: TEST_UID };
}
