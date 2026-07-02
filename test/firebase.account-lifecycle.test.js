import { describe, it, expect, afterEach, vi } from 'vitest';
import { loadFirebaseModule } from './helpers/loadFirebaseModule.js';
import { createMockChromeStorage } from './helpers/mockChromeStorage.js';
import { createRoutedFetch, jsonResponse } from './helpers/mockFetch.js';

afterEach(() => {
  delete globalThis.chrome;
  delete globalThis.fetch;
  delete globalThis.items;
  delete globalThis.customEngines;
  delete globalThis.selectedEngineId;
  delete globalThis.clocks;
  delete globalThis.mainGridColumns;
  delete globalThis.applyWallpaper;
  delete globalThis.applyMainGridColumns;
  delete globalThis.render;
  delete globalThis.getSelectedEngine;
  delete globalThis.normalizeFolderChildItemSizes;
  document.body.innerHTML = '';
});

function secureTokenRoute(onHit) {
  return {
    match: (url) => url.includes('securetoken.googleapis.com'),
    respond: async () => {
      onHit();
      return jsonResponse(200, {
        id_token: 'fresh-id-token',
        expires_in: '3600',
        refresh_token: 'refreshed-refresh-token',
        user_id: 'uid-1',
      });
    },
  };
}

describe('fbRefreshEmailVerifiedStatus', () => {
  it('returns false and makes no fetch calls when not signed in', async () => {
    const fb = loadFirebaseModule();
    globalThis.chrome = createMockChromeStorage({});
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls++;
      throw new Error('should not be called');
    };

    await fb._loadAuth();
    const result = await fb.fbRefreshEmailVerifiedStatus();

    expect(result).toBe(false);
    expect(fetchCalls).toBe(0);
  });

  it('returns the cached emailVerified value and skips a state-change save when accounts:lookup is non-200', async () => {
    const fb = loadFirebaseModule();
    const storage = createMockChromeStorage({
      _fb_refresh: 'seed-refresh',
      _fb_uid: 'uid-1',
      _fb_email_verified: true,
      _fb_email: 'user@example.com',
    });
    globalThis.chrome = storage;
    const setSpy = vi.spyOn(storage.storage.local, 'set');
    let secureCalls = 0;
    let lookupCalls = 0;
    globalThis.fetch = createRoutedFetch([
      secureTokenRoute(() => { secureCalls++; }),
      {
        match: (url) => url.includes('identitytoolkit.googleapis.com') && url.includes('accounts:lookup'),
        respond: async () => {
          lookupCalls++;
          return jsonResponse(400, { error: { message: 'INVALID_ID_TOKEN' } });
        },
      },
    ]);

    await fb._loadAuth();
    const result = await fb.fbRefreshEmailVerifiedStatus();

    expect(result).toBe(true);
    expect(lookupCalls).toBe(1);
    expect(secureCalls).toBe(1);
    // Only the initial _getToken() call persists auth (it always saves the
    // refreshed token); the lookup branch itself must not trigger another save.
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(storage._data._fb_email_verified).toBe(true);
  });

  it('flips emailVerified to true, persists it, and forces a second token refresh', async () => {
    const fb = loadFirebaseModule();
    const storage = createMockChromeStorage({
      _fb_refresh: 'seed-refresh',
      _fb_uid: 'uid-1',
      _fb_email_verified: false,
      _fb_email: 'user@example.com',
    });
    globalThis.chrome = storage;
    let secureCalls = 0;
    let lookupCalls = 0;
    globalThis.fetch = createRoutedFetch([
      secureTokenRoute(() => { secureCalls++; }),
      {
        match: (url) => url.includes('identitytoolkit.googleapis.com') && url.includes('accounts:lookup'),
        respond: async () => {
          lookupCalls++;
          return jsonResponse(200, { users: [{ emailVerified: true }] });
        },
      },
    ]);

    await fb._loadAuth();
    const result = await fb.fbRefreshEmailVerifiedStatus();

    expect(result).toBe(true);
    expect(lookupCalls).toBe(1);
    // Initial _getToken() + the forced re-fetch after the verified branch.
    expect(secureCalls).toBe(2);
    expect(storage._data._fb_email_verified).toBe(true);
    expect(fb.fbIsEmailVerified()).toBe(true);
  });

  it('leaves emailVerified false unchanged and does not force a second token refresh', async () => {
    const fb = loadFirebaseModule();
    const storage = createMockChromeStorage({
      _fb_refresh: 'seed-refresh',
      _fb_uid: 'uid-1',
      _fb_email_verified: false,
      _fb_email: 'user@example.com',
    });
    globalThis.chrome = storage;
    const setSpy = vi.spyOn(storage.storage.local, 'set');
    let secureCalls = 0;
    let lookupCalls = 0;
    globalThis.fetch = createRoutedFetch([
      secureTokenRoute(() => { secureCalls++; }),
      {
        match: (url) => url.includes('identitytoolkit.googleapis.com') && url.includes('accounts:lookup'),
        respond: async () => {
          lookupCalls++;
          return jsonResponse(200, { users: [{ emailVerified: false }] });
        },
      },
    ]);

    await fb._loadAuth();
    const result = await fb.fbRefreshEmailVerifiedStatus();

    expect(result).toBe(false);
    expect(lookupCalls).toBe(1);
    expect(secureCalls).toBe(1);
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(storage._data._fb_email_verified).toBe(false);
  });
});
