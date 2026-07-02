import { describe, it, expect, afterEach } from 'vitest';
import { loadFirebaseModule } from './helpers/loadFirebaseModule.js';
import { createMockChromeStorage } from './helpers/mockChromeStorage.js';

afterEach(() => {
  delete globalThis.chrome;
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

    await fb._loadAuth();
    expect(fb.fbIsSignedIn()).toBe(true);

    await fb._clearAuth();

    expect(fb.fbIsSignedIn()).toBe(false);
    expect(fb.fbIsEmailVerified()).toBe(false);
    expect(fb.fbGetEmail()).toBeNull();
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
