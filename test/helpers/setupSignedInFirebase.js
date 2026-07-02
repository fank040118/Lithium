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

export async function setupSignedInFirebase(fb, { extraRoutes = [] } = {}) {
  const storage = createMockChromeStorage({
    _fb_refresh: 'seed-refresh-token',
    _fb_uid: TEST_UID,
    _fb_email_verified: true,
    _fb_email: 'user@example.com',
  });
  globalThis.chrome = storage;
  globalThis.fetch = createRoutedFetch([tokenRoute(), ...extraRoutes]);
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
  return { storage, uid: TEST_UID };
}
