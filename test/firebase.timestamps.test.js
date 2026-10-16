import { describe, it, expect } from 'vitest';
import { loadFirebaseModule } from './helpers/loadFirebaseModule.js';
import { createMockChromeStorage } from './helpers/mockChromeStorage.js';

describe('_normalizeTs', () => {
  it('returns the number for a positive finite value', () => {
    const fb = loadFirebaseModule();
    expect(fb._normalizeTs(500)).toBe(500);
  });

  it('returns 0 for zero', () => {
    const fb = loadFirebaseModule();
    expect(fb._normalizeTs(0)).toBe(0);
  });

  it('returns 0 for a negative value', () => {
    const fb = loadFirebaseModule();
    expect(fb._normalizeTs(-1)).toBe(0);
  });

  it('returns 0 for NaN', () => {
    const fb = loadFirebaseModule();
    expect(fb._normalizeTs(NaN)).toBe(0);
  });

  it('returns 0 for Infinity', () => {
    const fb = loadFirebaseModule();
    expect(fb._normalizeTs(Infinity)).toBe(0);
  });

  it('coerces numeric strings', () => {
    const fb = loadFirebaseModule();
    expect(fb._normalizeTs('123')).toBe(123);
  });

  it('returns 0 for undefined', () => {
    const fb = loadFirebaseModule();
    expect(fb._normalizeTs(undefined)).toBe(0);
  });
});

describe('_rfc3339ToMs', () => {
  it('parses a full RFC3339 timestamp with nanosecond precision', () => {
    const fb = loadFirebaseModule();
    const ms = fb._rfc3339ToMs('2024-01-01T00:00:00.123456789Z');
    expect(ms).toBe(new Date('2024-01-01T00:00:00.123Z').getTime());
  });

  it('parses a timestamp with no fractional seconds', () => {
    const fb = loadFirebaseModule();
    const ms = fb._rfc3339ToMs('2024-01-01T00:00:00Z');
    expect(ms).toBe(new Date('2024-01-01T00:00:00Z').getTime());
  });

  it('returns 0 for null', () => {
    const fb = loadFirebaseModule();
    expect(fb._rfc3339ToMs(null)).toBe(0);
  });

  it('returns 0 for undefined', () => {
    const fb = loadFirebaseModule();
    expect(fb._rfc3339ToMs(undefined)).toBe(0);
  });

  it('returns 0 for a non-string value', () => {
    const fb = loadFirebaseModule();
    expect(fb._rfc3339ToMs(1700000000000)).toBe(0);
  });

  it('returns 0 for a malformed date string', () => {
    const fb = loadFirebaseModule();
    expect(fb._rfc3339ToMs('not-a-date')).toBe(0);
  });
});

describe('sync timestamp persistence', () => {
  it('_saveCloudSyncTs then _loadCloudSyncTs round-trips the value', async () => {
    const fb = loadFirebaseModule();
    globalThis.chrome = createMockChromeStorage();

    await fb._saveCloudSyncTs(1700000000000);
    const loaded = await fb._loadCloudSyncTs();

    expect(loaded).toBe(1700000000000);
  });
});

describe('sync rev state persistence', () => {
  it('_loadRevState returns {editRev:0, syncedRev:0} when storage is empty', async () => {
    const fb = loadFirebaseModule();
    globalThis.chrome = createMockChromeStorage();
    expect(await fb._loadRevState()).toEqual({ editRev: 0, syncedRev: 0 });
  });

  it('migrates the legacy _fb_local_sync_ts into a dirty rev and removes the legacy key', async () => {
    const fb = loadFirebaseModule();
    const storage = createMockChromeStorage({
      _fb_local_sync_ts: 1700000000000,
      _fb_cloud_sync_ts: 1600000000000,
    });
    globalThis.chrome = storage;
    await fb._loadCloudSyncTs();
    expect(await fb._loadRevState()).toEqual({ editRev: 1, syncedRev: 0 });
    expect(storage._data).not.toHaveProperty('_fb_local_sync_ts');
    expect(storage._data._fb_edit_rev).toBe(1);
    expect(storage._data._fb_synced_rev).toBe(0);
  });

  it('migrates to a clean rev pair when the legacy local ts is not newer than the cloud ts', async () => {
    const fb = loadFirebaseModule();
    globalThis.chrome = createMockChromeStorage({
      _fb_local_sync_ts: 1500000000000,
      _fb_cloud_sync_ts: 1600000000000,
    });
    await fb._loadCloudSyncTs();
    expect(await fb._loadRevState()).toEqual({ editRev: 0, syncedRev: 0 });
  });

  it('returns a clean rev pair without throwing when no storage API is available', async () => {
    const fb = loadFirebaseModule();
    globalThis.chrome = undefined;
    globalThis.browser = undefined;
    expect(await fb._loadRevState()).toEqual({ editRev: 0, syncedRev: 0 });
    await expect(fb._saveRevState()).resolves.toBeUndefined();
  });
});
