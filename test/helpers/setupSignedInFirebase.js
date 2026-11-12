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

// I3 guard (spec §3.1): every PATCH must carry a Firestore precondition. A
// violation is recorded rather than thrown — a throw inside the fetch double
// would surface as a `network` error and be swallowed by the sync paths — and
// asserted by the global afterEach in test/setup/preconditionGuard.js.
export const preconditionViolations = [];

export function assertNoPreconditionViolations() {
  const found = preconditionViolations.splice(0);
  if (found.length > 0) {
    throw new Error(`PATCH without a precondition: ${found.map((v) => v.url).join(', ')}`);
  }
}

// The precondition query parameters of a PATCH url (absent ones are omitted).
export function preconditionOf(url) {
  const params = new URL(url).searchParams;
  const pre = {};
  if (params.has('currentDocument.updateTime')) pre.updateTime = params.get('currentDocument.updateTime');
  if (params.has('currentDocument.exists')) pre.exists = params.get('currentDocument.exists');
  return pre;
}

export function firestorePatchRoute(responder, { requirePrecondition = true } = {}) {
  return {
    match: (url, options = {}) =>
      url.includes(FIRESTORE_DOC_URL_PART) && options.method === 'PATCH',
    respond: (url, options) => {
      if (requirePrecondition) {
        const pre = preconditionOf(url);
        if (pre.updateTime === undefined && pre.exists === undefined) {
          preconditionViolations.push({ url });
        }
      }
      return responder(url, options);
    },
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
