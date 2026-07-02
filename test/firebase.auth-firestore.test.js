import { describe, it, expect, afterEach, vi } from 'vitest';
import { loadFirebaseModule } from './helpers/loadFirebaseModule.js';
import { createMockChromeStorage } from './helpers/mockChromeStorage.js';
import { createRoutedFetch, jsonResponse } from './helpers/mockFetch.js';

afterEach(() => {
  delete globalThis.chrome;
  delete globalThis.fetch;
});

function base64urlEncode(payload) {
  return btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function makeJwt(payload) {
  return `header.${base64urlEncode(payload)}.sig`;
}

describe('_toFV', () => {
  it('serializes null and undefined as nullValue', () => {
    const fb = loadFirebaseModule();
    expect(fb._toFV(null)).toEqual({ nullValue: null });
    expect(fb._toFV(undefined)).toEqual({ nullValue: null });
  });

  it('serializes integers as string integerValue', () => {
    const fb = loadFirebaseModule();
    expect(fb._toFV(123)).toEqual({ integerValue: '123' });
    expect(fb._toFV(-7)).toEqual({ integerValue: '-7' });
    expect(fb._toFV(0)).toEqual({ integerValue: '0' });
  });

  it('serializes strings as stringValue', () => {
    const fb = loadFirebaseModule();
    expect(fb._toFV('hello')).toEqual({ stringValue: 'hello' });
    expect(fb._toFV('')).toEqual({ stringValue: '' });
  });

  it('serializes objects and arrays as JSON stringValue', () => {
    const fb = loadFirebaseModule();
    expect(fb._toFV({ a: 1 })).toEqual({ stringValue: JSON.stringify({ a: 1 }) });
    expect(fb._toFV([1, 2, 3])).toEqual({ stringValue: JSON.stringify([1, 2, 3]) });
  });
});

describe('_fromFV', () => {
  it('returns null for nullish input', () => {
    const fb = loadFirebaseModule();
    expect(fb._fromFV(null)).toBeNull();
    expect(fb._fromFV(undefined)).toBeNull();
    expect(fb._fromFV(false)).toBeNull();
  });

  it('returns null for nullValue fields', () => {
    const fb = loadFirebaseModule();
    expect(fb._fromFV({ nullValue: null })).toBeNull();
  });

  it('parses integerValue as an integer', () => {
    const fb = loadFirebaseModule();
    expect(fb._fromFV({ integerValue: '42' })).toBe(42);
    expect(fb._fromFV({ integerValue: '-7' })).toBe(-7);
  });

  it('deserializes JSON stringValue', () => {
    const fb = loadFirebaseModule();
    expect(fb._fromFV({ stringValue: JSON.stringify({ a: 1 }) })).toEqual({ a: 1 });
    expect(fb._fromFV({ stringValue: JSON.stringify([1, 2, 3]) })).toEqual([1, 2, 3]);
  });

  it('returns the raw string when stringValue is not valid JSON', () => {
    const fb = loadFirebaseModule();
    expect(fb._fromFV({ stringValue: 'plain text' })).toBe('plain text');
  });

  it('returns null for unknown field shapes', () => {
    const fb = loadFirebaseModule();
    expect(fb._fromFV({ booleanValue: true })).toBeNull();
    expect(fb._fromFV({})).toBeNull();
  });
});

describe('_parseEmailVerifiedFromToken', () => {
  it('returns true when the JWT payload claims email_verified=true', () => {
    const fb = loadFirebaseModule();
    const jwt = makeJwt({ email_verified: true });
    expect(fb._parseEmailVerifiedFromToken(jwt)).toBe(true);
  });

  it('returns false when the JWT payload claims email_verified=false', () => {
    const fb = loadFirebaseModule();
    const jwt = makeJwt({ email_verified: false });
    expect(fb._parseEmailVerifiedFromToken(jwt)).toBe(false);
  });

  it('returns false for an invalid JWT', () => {
    const fb = loadFirebaseModule();
    expect(fb._parseEmailVerifiedFromToken('not.a.jwt')).toBe(false);
    expect(fb._parseEmailVerifiedFromToken('')).toBe(false);
    expect(fb._parseEmailVerifiedFromToken('only-one-part')).toBe(false);
  });
});

describe('auth state readers', () => {
  it('report not signed in when storage is empty', async () => {
    const fb = loadFirebaseModule();
    globalThis.chrome = createMockChromeStorage({});
    await fb._loadAuth();

    expect(fb.fbIsSignedIn()).toBe(false);
    expect(fb.fbIsEmailVerified()).toBe(false);
    expect(fb.fbGetEmail()).toBeNull();
  });

  it('reflect seeded auth state after _loadAuth', async () => {
    const fb = loadFirebaseModule();
    globalThis.chrome = createMockChromeStorage({
      _fb_refresh: 'seed-refresh',
      _fb_uid: 'seed-uid',
      _fb_email_verified: true,
      _fb_email: 'seed@example.com',
    });
    await fb._loadAuth();

    expect(fb.fbIsSignedIn()).toBe(true);
    expect(fb.fbIsEmailVerified()).toBe(true);
    expect(fb.fbGetEmail()).toBe('seed@example.com');
  });
});

describe('_loadAuth', () => {
  it('reads the four auth keys from storage into internal state', async () => {
    const fb = loadFirebaseModule();
    globalThis.chrome = createMockChromeStorage({
      _fb_refresh: 'refresh-token',
      _fb_uid: 'user-uid',
      _fb_email_verified: true,
      _fb_email: 'user@example.com',
    });

    await fb._loadAuth();

    expect(fb.fbIsSignedIn()).toBe(true);
    expect(fb.fbIsEmailVerified()).toBe(true);
    expect(fb.fbGetEmail()).toBe('user@example.com');
  });

  it('silently returns when no storage is available', async () => {
    const fb = loadFirebaseModule();
    globalThis.chrome = undefined;

    await expect(fb._loadAuth()).resolves.toBeUndefined();
    expect(fb.fbIsSignedIn()).toBe(false);
    expect(fb.fbIsEmailVerified()).toBe(false);
    expect(fb.fbGetEmail()).toBeNull();
  });
});

describe('_saveAuth', () => {
  it('persists current internal auth state to storage', async () => {
    const fb = loadFirebaseModule();
    const mock = createMockChromeStorage({
      _fb_refresh: 'refresh-token',
      _fb_uid: 'user-uid',
      _fb_email_verified: true,
      _fb_email: 'user@example.com',
    });
    globalThis.chrome = mock;

    await fb._loadAuth();
    await fb._saveAuth();

    expect(mock._data._fb_refresh).toBe('refresh-token');
    expect(mock._data._fb_uid).toBe('user-uid');
    expect(mock._data._fb_email_verified).toBe(true);
    expect(mock._data._fb_email).toBe('user@example.com');
  });

  it('silently returns when no storage is available', async () => {
    const fb = loadFirebaseModule();
    globalThis.chrome = undefined;

    await expect(fb._saveAuth()).resolves.toBeUndefined();
  });
});

describe('_clearAuth', () => {
  it('resets internal state and removes auth keys plus cloud sync ts from storage', async () => {
    const fb = loadFirebaseModule();
    const mock = createMockChromeStorage({
      _fb_refresh: 'refresh-token',
      _fb_uid: 'user-uid',
      _fb_email_verified: true,
      _fb_email: 'user@example.com',
      _fb_cloud_sync_ts: 123456789,
    });
    globalThis.chrome = mock;

    const removeSpy = vi.spyOn(mock.storage.local, 'remove');

    await fb._loadAuth();
    expect(fb.fbIsSignedIn()).toBe(true);

    await fb._clearAuth();

    expect(fb.fbIsSignedIn()).toBe(false);
    expect(fb.fbIsEmailVerified()).toBe(false);
    expect(fb.fbGetEmail()).toBeNull();
    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy.mock.calls[0][0]).toEqual([
      '_fb_refresh',
      '_fb_uid',
      '_fb_email_verified',
      '_fb_email',
      '_fb_cloud_sync_ts',
    ]);
    expect(mock._data).not.toHaveProperty('_fb_refresh');
    expect(mock._data).not.toHaveProperty('_fb_uid');
    expect(mock._data).not.toHaveProperty('_fb_email_verified');
    expect(mock._data).not.toHaveProperty('_fb_email');
    expect(mock._data).not.toHaveProperty('_fb_cloud_sync_ts');
  });

  it('resets internal state and skips storage removal when storage is unavailable', async () => {
    const fb = loadFirebaseModule();
    globalThis.chrome = undefined;

    await fb._clearAuth();

    expect(fb.fbIsSignedIn()).toBe(false);
    expect(fb.fbIsEmailVerified()).toBe(false);
    expect(fb.fbGetEmail()).toBeNull();
  });
});

describe('_getToken', () => {
  afterEach(() => {
    delete globalThis.fetch;
  });

  it('returns a cached idToken without making a second fetch when still valid', async () => {
    const fb = loadFirebaseModule();
    const storage = createMockChromeStorage({ _fb_refresh: 'seed-refresh' });
    globalThis.chrome = storage;
    let calls = 0;
    globalThis.fetch = createRoutedFetch([{
      match: (url) => url.includes('securetoken.googleapis.com'),
      respond: async () => {
        calls++;
        return jsonResponse(200, {
          id_token: 'cached-token',
          expires_in: '3600',
          refresh_token: 'new-refresh',
          user_id: 'uid-1',
        });
      },
    }]);

    await fb._loadAuth();
    const first = await fb._getToken();
    expect(first).toBe('cached-token');
    expect(calls).toBe(1);

    const second = await fb._getToken();
    expect(second).toBe('cached-token');
    expect(calls).toBe(1);
  });

  it('returns null and does not fetch when no refresh token is loaded', async () => {
    const fb = loadFirebaseModule();
    const storage = createMockChromeStorage({});
    globalThis.chrome = storage;
    let calls = 0;
    globalThis.fetch = createRoutedFetch([{
      match: (url) => url.includes('securetoken.googleapis.com'),
      respond: async () => {
        calls++;
        return jsonResponse(200, {
          id_token: 'should-not-reach',
          expires_in: '3600',
          refresh_token: 'refresh',
          user_id: 'uid-2',
        });
      },
    }]);

    await fb._loadAuth();
    const result = await fb._getToken();
    expect(result).toBeNull();
    expect(calls).toBe(0);
  });

  it('refreshes the token, updates internal state and persists the new refresh token', async () => {
    const fb = loadFirebaseModule();
    const storage = createMockChromeStorage({ _fb_refresh: 'seed-refresh' });
    globalThis.chrome = storage;
    globalThis.fetch = createRoutedFetch([{
      match: (url) => url.includes('securetoken.googleapis.com'),
      respond: async () => jsonResponse(200, {
        id_token: 'fresh-id-token',
        expires_in: '3600',
        refresh_token: 'refreshed-refresh-token',
        user_id: 'user-1',
      }),
    }]);

    await fb._loadAuth();
    const result = await fb._getToken();
    expect(result).toBe('fresh-id-token');
    expect(storage._data._fb_refresh).toBe('refreshed-refresh-token');
  });

  it('throws a network CloudSyncError when fetch throws', async () => {
    const fb = loadFirebaseModule();
    const storage = createMockChromeStorage({ _fb_refresh: 'seed-refresh' });
    globalThis.chrome = storage;
    globalThis.fetch = async () => { throw new Error('net down'); };

    await fb._loadAuth();
    await expect(fb._getToken()).rejects.toMatchObject({ code: 'network' });
    expect(fb.fbIsSignedIn()).toBe(true);
  });

  it.each([
    ['INVALID_GRANT'],
    ['USER_DISABLED'],
    ['TOKEN_EXPIRED'],
  ])('throws an auth CloudSyncError and clears auth on fatal 400 (%s)', async (message) => {
    const fb = loadFirebaseModule();
    const storage = createMockChromeStorage({ _fb_refresh: 'seed-refresh' });
    globalThis.chrome = storage;
    globalThis.fetch = createRoutedFetch([{
      match: (url) => url.includes('securetoken.googleapis.com'),
      respond: async () => jsonResponse(400, { error: { message } }),
    }]);

    await fb._loadAuth();
    expect(fb.fbIsSignedIn()).toBe(true);
    await expect(fb._getToken()).rejects.toMatchObject({ code: 'auth', status: 400 });
    expect(fb.fbIsSignedIn()).toBe(false);
  });

  it('throws an auth CloudSyncError and clears auth on 401', async () => {
    const fb = loadFirebaseModule();
    const storage = createMockChromeStorage({ _fb_refresh: 'seed-refresh' });
    globalThis.chrome = storage;
    globalThis.fetch = createRoutedFetch([{
      match: (url) => url.includes('securetoken.googleapis.com'),
      respond: async () => jsonResponse(401, { error: { message: 'TOKEN_INVALID' } }),
    }]);

    await fb._loadAuth();
    expect(fb.fbIsSignedIn()).toBe(true);
    await expect(fb._getToken()).rejects.toMatchObject({ code: 'auth', status: 401 });
    expect(fb.fbIsSignedIn()).toBe(false);
  });

  it('throws an auth CloudSyncError and clears auth on 403', async () => {
    const fb = loadFirebaseModule();
    const storage = createMockChromeStorage({ _fb_refresh: 'seed-refresh' });
    globalThis.chrome = storage;
    globalThis.fetch = createRoutedFetch([{
      match: (url) => url.includes('securetoken.googleapis.com'),
      respond: async () => jsonResponse(403, { error: { message: 'FORBIDDEN' } }),
    }]);

    await fb._loadAuth();
    expect(fb.fbIsSignedIn()).toBe(true);
    await expect(fb._getToken()).rejects.toMatchObject({ code: 'auth', status: 403 });
    expect(fb.fbIsSignedIn()).toBe(false);
  });

  it('throws a quota CloudSyncError on 429 without clearing auth', async () => {
    const fb = loadFirebaseModule();
    const storage = createMockChromeStorage({ _fb_refresh: 'seed-refresh' });
    globalThis.chrome = storage;
    globalThis.fetch = createRoutedFetch([{
      match: (url) => url.includes('securetoken.googleapis.com'),
      respond: async () => jsonResponse(429, { error: { message: 'rate limited' } }),
    }]);

    await fb._loadAuth();
    expect(fb.fbIsSignedIn()).toBe(true);
    await expect(fb._getToken()).rejects.toMatchObject({ code: 'quota', status: 429 });
    expect(fb.fbIsSignedIn()).toBe(true);
  });

  it('throws a network CloudSyncError on 5xx without clearing auth', async () => {
    const fb = loadFirebaseModule();
    const storage = createMockChromeStorage({ _fb_refresh: 'seed-refresh' });
    globalThis.chrome = storage;
    globalThis.fetch = createRoutedFetch([{
      match: (url) => url.includes('securetoken.googleapis.com'),
      respond: async () => jsonResponse(503, { error: { message: 'server down' } }),
    }]);

    await fb._loadAuth();
    expect(fb.fbIsSignedIn()).toBe(true);
    await expect(fb._getToken()).rejects.toMatchObject({ code: 'network', status: 503 });
    expect(fb.fbIsSignedIn()).toBe(true);
  });

  it('throws an auth CloudSyncError on other non-ok responses without clearing auth', async () => {
    const fb = loadFirebaseModule();
    const storage = createMockChromeStorage({ _fb_refresh: 'seed-refresh' });
    globalThis.chrome = storage;
    globalThis.fetch = createRoutedFetch([{
      match: (url) => url.includes('securetoken.googleapis.com'),
      respond: async () => jsonResponse(404, { error: { message: 'not found' } }),
    }]);

    await fb._loadAuth();
    expect(fb.fbIsSignedIn()).toBe(true);
    await expect(fb._getToken()).rejects.toMatchObject({ code: 'auth', status: 404 });
    expect(fb.fbIsSignedIn()).toBe(true);
  });
});
