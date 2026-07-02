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
  it('_saveLocalSyncTs then _loadLocalSyncTs round-trips the value', async () => {
    const fb = loadFirebaseModule();
    globalThis.chrome = createMockChromeStorage();

    await fb._saveLocalSyncTs(1700000000000);
    const loaded = await fb._loadLocalSyncTs();

    expect(loaded).toBe(1700000000000);
  });

  it('_saveCloudSyncTs then _loadCloudSyncTs round-trips the value', async () => {
    const fb = loadFirebaseModule();
    globalThis.chrome = createMockChromeStorage();

    await fb._saveCloudSyncTs(1700000000000);
    const loaded = await fb._loadCloudSyncTs();

    expect(loaded).toBe(1700000000000);
  });

  it('normalizes an invalid value to 0 before persisting', async () => {
    const fb = loadFirebaseModule();
    globalThis.chrome = createMockChromeStorage();

    await fb._saveLocalSyncTs(-1);
    const loaded = await fb._loadLocalSyncTs();

    expect(loaded).toBe(0);
  });

  it('_loadLocalSyncTs returns 0 when storage has no value yet', async () => {
    const fb = loadFirebaseModule();
    globalThis.chrome = createMockChromeStorage();

    expect(await fb._loadLocalSyncTs()).toBe(0);
  });

  it('returns 0 without throwing when no storage API is available', async () => {
    const fb = loadFirebaseModule();
    globalThis.chrome = undefined;
    globalThis.browser = undefined;

    expect(await fb._loadLocalSyncTs()).toBe(0);
    await expect(fb._saveLocalSyncTs(123)).resolves.toBeUndefined();
  });
});
