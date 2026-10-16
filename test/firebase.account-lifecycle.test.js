import { describe, it, expect, afterEach, vi } from 'vitest';
import { loadFirebaseModule } from './helpers/loadFirebaseModule.js';
import { createMockChromeStorage } from './helpers/mockChromeStorage.js';
import { createRoutedFetch, jsonResponse } from './helpers/mockFetch.js';
import { TEST_UID, setupSignedInFirebase, firestoreGetRoute } from './helpers/setupSignedInFirebase.js';

// Re-derived locally: setupSignedInFirebase.js keeps this as a private const,
// not exported. Same shape as the Firestore doc URL fragment _docUrl() builds
// internally, used here to match the DELETE-method request in extraRoutes.
const FIRESTORE_DOC_URL_PART = `/documents/users/${TEST_UID}/data/settings`;

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
      // Pre-existing baseline: _loadAuth() must not seed another write here.
      _fb_sync_baseline_uid: 'uid-1',
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
      // Pre-existing baseline: _loadAuth() must not seed another write here.
      _fb_sync_baseline_uid: 'uid-1',
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

describe('fbSignOut', () => {
  it('clears auth state and removes storage keys without throwing when signed in', async () => {
    const fb = loadFirebaseModule();
    const storage = createMockChromeStorage({
      _fb_refresh: 'refresh-token',
      _fb_uid: 'user-uid',
      _fb_email_verified: true,
      _fb_email: 'user@example.com',
      _fb_cloud_sync_ts: 123456789,
    });
    globalThis.chrome = storage;
    const removeSpy = vi.spyOn(storage.storage.local, 'remove');

    await fb._loadAuth();
    expect(fb.fbIsSignedIn()).toBe(true);

    await expect(fb.fbSignOut()).resolves.toBeUndefined();

    expect(fb.fbIsSignedIn()).toBe(false);
    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy.mock.calls[0][0]).toEqual([
      '_fb_refresh',
      '_fb_uid',
      '_fb_email_verified',
      '_fb_email',
      '_fb_cloud_sync_ts',
    ]);
    expect(storage._data).not.toHaveProperty('_fb_refresh');
    expect(storage._data).not.toHaveProperty('_fb_uid');
    expect(storage._data).not.toHaveProperty('_fb_email_verified');
    expect(storage._data).not.toHaveProperty('_fb_email');
    expect(storage._data).not.toHaveProperty('_fb_cloud_sync_ts');
  });

  it('cancels a pending sync timer on sign out', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      globalThis.chrome = createMockChromeStorage({
        _fb_refresh: 'refresh-token',
        _fb_uid: 'user-uid',
        _fb_email_verified: true,
        _fb_email: 'user@example.com',
      });
      await fb._loadAuth();

      fb.scheduleSyncToCloud();
      expect(vi.getTimerCount()).toBe(1);

      await fb.fbSignOut();

      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps _fb_sync_baseline_uid after sign out so the next sign-in can detect an account switch', async () => {
    const fb = loadFirebaseModule();
    const storage = createMockChromeStorage({
      _fb_refresh: 'refresh-token',
      _fb_uid: 'user-uid',
      _fb_sync_baseline_uid: 'user-uid',
      _fb_email_verified: true,
      _fb_email: 'user@example.com',
    });
    globalThis.chrome = storage;
    await fb._loadAuth();

    await fb.fbSignOut();

    expect(storage._data._fb_sync_baseline_uid).toBe('user-uid');
  });

  it('resets the in-memory cloud ts on sign out so a later pull is not skipped', async () => {
    const fb = loadFirebaseModule();
    const cloudItems = [{ id: 'account-b-cloud' }];
    const { storage } = await setupSignedInFirebase(fb, {
      extraRoutes: [firestoreGetRoute(async () => jsonResponse(200, {
        updateTime: '2024-06-02T00:00:00.000000000Z',
        fields: { items: fb._toFV(JSON.stringify(cloudItems)) },
      }))],
    });
    // 登出前的内存基线比云端文档还新；不随登出清零的话下面的拉取会被跳过
    storage._data._fb_cloud_sync_ts = new Date('2024-12-01T00:00:00.000Z').getTime();
    await fb._loadCloudSyncTs();

    await fb.fbSignOut();

    // 同一页面重新登录（storage 里的 auth 键由登录流程重新写入）
    storage._data._fb_refresh = 'next-refresh-token';
    storage._data._fb_uid = TEST_UID;
    storage._data._fb_email_verified = true;
    storage._data._fb_email = 'user@example.com';
    globalThis.items = [{ id: 'leftover-from-account-a' }];
    await fb._loadAuth();

    const pulled = await fb.syncFromCloud();

    expect(pulled).toBe(true);
    expect(globalThis.items).toEqual(cloudItems);
  });

  it('does not throw when no chrome storage is available', async () => {
    const fb = loadFirebaseModule();
    globalThis.chrome = undefined;

    await expect(fb.fbSignOut()).resolves.toBeUndefined();

    expect(fb.fbIsSignedIn()).toBe(false);
  });

  it('clears a pending sync conflict on sign out', async () => {
    const fb = loadFirebaseModule();
    await setupSignedInFirebase(fb, {
      extraRoutes: [firestoreGetRoute(async () => jsonResponse(200, {
        updateTime: '2024-06-02T00:00:00.000000000Z',
        fields: {
          items: fb._toFV(JSON.stringify([{ id: 'cloud' }])),
          engines: fb._toFV(JSON.stringify([])),
          selected_engine: fb._toFV('google'),
          clocks: fb._toFV(JSON.stringify([])),
          grid_columns: fb._toFV(4),
        },
      }))],
    });
    globalThis.items = [{ id: 'local-only' }];
    await fb.markLocalCloudDataChanged();

    await fb.syncFromCloud();
    expect(fb.fbGetSyncConflict()).not.toBeNull();

    await fb.fbSignOut();

    expect(fb.fbGetSyncConflict()).toBeNull();
  });
});

describe('fbDeleteAccount', () => {
  it('throws NOT_SIGNED_IN and makes no fetch calls when not signed in', async () => {
    const fb = loadFirebaseModule();
    globalThis.chrome = createMockChromeStorage({});
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls++;
      throw new Error('should not be called');
    };

    await fb._loadAuth();

    await expect(fb.fbDeleteAccount()).rejects.toThrow('NOT_SIGNED_IN');
    expect(fetchCalls).toBe(0);
  });

  it('deletes the Firestore document and the auth account, then clears local state', async () => {
    const fb = loadFirebaseModule();
    let firestoreDeleteCalls = 0;
    let accountDeleteCalls = 0;
    await setupSignedInFirebase(fb, {
      extraRoutes: [
        {
          match: (url, options = {}) =>
            url.includes(FIRESTORE_DOC_URL_PART) && options.method === 'DELETE',
          respond: async () => {
            firestoreDeleteCalls++;
            return jsonResponse(200, {});
          },
        },
        {
          match: (url) => url.includes('accounts:delete'),
          respond: async () => {
            accountDeleteCalls++;
            return jsonResponse(200, {});
          },
        },
      ],
    });

    await expect(fb.fbDeleteAccount()).resolves.toBeUndefined();

    expect(firestoreDeleteCalls).toBe(1);
    expect(accountDeleteCalls).toBe(1);
    expect(fb.fbIsSignedIn()).toBe(false);
  });

  it('continues to accounts:delete and clears local state when the Firestore delete throws (best-effort)', async () => {
    const fb = loadFirebaseModule();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let accountDeleteCalls = 0;
    await setupSignedInFirebase(fb, {
      extraRoutes: [
        {
          match: (url, options = {}) =>
            url.includes(FIRESTORE_DOC_URL_PART) && options.method === 'DELETE',
          respond: async () => {
            throw new Error('boom');
          },
        },
        {
          match: (url) => url.includes('accounts:delete'),
          respond: async () => {
            accountDeleteCalls++;
            return jsonResponse(200, {});
          },
        },
      ],
    });

    await expect(fb.fbDeleteAccount()).resolves.toBeUndefined();

    expect(accountDeleteCalls).toBe(1);
    expect(fb.fbIsSignedIn()).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('throws the server error message and does not clear state when accounts:delete is non-ok with a message', async () => {
    const fb = loadFirebaseModule();
    await setupSignedInFirebase(fb, {
      extraRoutes: [
        {
          match: (url, options = {}) =>
            url.includes(FIRESTORE_DOC_URL_PART) && options.method === 'DELETE',
          respond: async () => jsonResponse(200, {}),
        },
        {
          match: (url) => url.includes('accounts:delete'),
          respond: async () => jsonResponse(400, { error: { message: 'CREDENTIAL_TOO_OLD_LOGIN_AGAIN' } }),
        },
      ],
    });

    await expect(fb.fbDeleteAccount()).rejects.toThrow('CREDENTIAL_TOO_OLD_LOGIN_AGAIN');
    expect(fb.fbIsSignedIn()).toBe(true);
  });

  it('throws DELETE_ACCOUNT_FAILED when accounts:delete is non-ok with no error message', async () => {
    const fb = loadFirebaseModule();
    await setupSignedInFirebase(fb, {
      extraRoutes: [
        {
          match: (url, options = {}) =>
            url.includes(FIRESTORE_DOC_URL_PART) && options.method === 'DELETE',
          respond: async () => jsonResponse(200, {}),
        },
        {
          match: (url) => url.includes('accounts:delete'),
          respond: async () => jsonResponse(400, {}),
        },
      ],
    });

    await expect(fb.fbDeleteAccount()).rejects.toThrow('DELETE_ACCOUNT_FAILED');
    expect(fb.fbIsSignedIn()).toBe(true);
  });
});
