import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadFirebaseModule } from './helpers/loadFirebaseModule.js';
import { createMockChromeStorage } from './helpers/mockChromeStorage.js';
import { jsonResponse, deferred } from './helpers/mockFetch.js';
import { mountAuthDom } from './helpers/authDomFixture.js';
import { installUiMocks } from './helpers/uiMocks.js';
import { cleanupFbInitIntercepts, installFbInitEventTracking } from './helpers/fbInitIntercepts.js';
import {
  setupSignedInFirebase,
  firestoreGetRoute,
  firestorePatchRoute,
  SEED_UPDATE_TIME,
  SEED_UPDATE_MS,
} from './helpers/setupSignedInFirebase.js';

// Spec §3.1 / §4 / §9: the cloud baseline is the raw updateTime string
// (Known / Absent / Unknown), persisted together with the millisecond key in
// one storage write, and the "cloud unchanged" fast path compares nanoseconds.

const RAW_KEY = '_fb_cloud_update_time';
const MS_KEY = '_fb_cloud_sync_ts';
const CLOUD_TS = '2024-06-02T00:00:00.000000Z';
const CLOUD_MS = Date.parse('2024-06-02T00:00:00Z');
const PATCH_TS = '2024-06-03T00:00:00.000000Z';

// updateTime null omits the field.
function cloudDoc(fb, items, updateTime = CLOUD_TS) {
  const doc = {
    fields: {
      items: fb._toFV(JSON.stringify(items)),
      engines: fb._toFV(JSON.stringify([])),
      selected_engine: fb._toFV('google'),
      clocks: fb._toFV(JSON.stringify([])),
      grid_columns: fb._toFV(4),
    },
  };
  if (updateTime !== null) doc.updateTime = updateTime;
  return doc;
}

function patchRecorder() {
  const patches = [];
  const route = firestorePatchRoute(async (url, options) => {
    patches.push(JSON.parse(options.body));
    return jsonResponse(200, { updateTime: PATCH_TS });
  });
  return { patches, route };
}

// Seed the pre-1.0.5 state: only the millisecond key, no raw string.
async function seedMigrationState(fb, storage, ms) {
  delete storage._data[RAW_KEY];
  storage._data[MS_KEY] = ms;
  await fb._loadCloudBaseline();
}

async function seedDirty(fb, storage) {
  storage._data._fb_edit_rev = 3;
  storage._data._fb_synced_rev = 2;
  await fb._loadRevState();
}

afterEach(() => {
  vi.useRealTimers();
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
  delete globalThis.onSyncConflict;
  document.body.innerHTML = '';
});

describe('updateTime parsing', () => {
  it('parses whole seconds and 3/6/9 fractional digits into nanoseconds', () => {
    const fb = loadFirebaseModule();
    expect(fb._parseUpdateTimeNs('2024-06-02T00:00:00Z')).toBe(1717286400000000000n);
    expect(fb._parseUpdateTimeNs('2024-06-02T00:00:00.123Z')).toBe(1717286400123000000n);
    expect(fb._parseUpdateTimeNs('2024-06-02T00:00:00.123456Z')).toBe(1717286400123456000n);
    expect(fb._parseUpdateTimeNs('2024-06-02T00:00:00.123456789Z')).toBe(1717286400123456789n);
    expect(fb._parseUpdateTimeNs('2024-06-02T00:00:00.123456Z'))
      .toBe(fb._parseUpdateTimeNs('2024-06-02T00:00:00.123456000Z'));
  });

  it('rejects more than 9 digits, non-Z offsets, garbage and non-strings', () => {
    const fb = loadFirebaseModule();
    expect(fb._parseUpdateTimeNs('2024-06-02T00:00:00.1234567890Z')).toBeNull();
    expect(fb._parseUpdateTimeNs('2024-06-02T00:00:00.123+08:00')).toBeNull();
    expect(fb._parseUpdateTimeNs('garbage')).toBeNull();
    expect(fb._parseUpdateTimeNs(123)).toBeNull();
    expect(fb._parseUpdateTimeNs('2024-13-02T00:00:00Z')).toBeNull();
  });

  it('_updateTimeToMs agrees with _rfc3339ToMs for 0/3/6/9 fractional digits', () => {
    const fb = loadFirebaseModule();
    for (const raw of [
      '2024-06-02T00:00:00Z',
      '2024-06-02T00:00:00.123Z',
      '2024-06-02T00:00:00.123456Z',
      '2024-06-02T00:00:00.123456789Z',
    ]) {
      expect(fb._updateTimeToMs(raw)).toBe(fb._rfc3339ToMs(raw));
    }
    expect(fb._updateTimeToMs('garbage')).toBe(0);
  });

  it('_sameUpdateTime is false whenever a side cannot be parsed', () => {
    const fb = loadFirebaseModule();
    expect(fb._sameUpdateTime('bad', 'bad')).toBe(false);
    expect(fb._sameUpdateTime('2024-06-02T00:00:00.000000Z', '2024-06-02T00:00:00Z')).toBe(true);
    expect(fb._sameUpdateTime('2024-06-02T00:00:00.000001Z', '2024-06-02T00:00:00Z')).toBe(false);
  });
});

describe('_baselineFromStorage', () => {
  it('maps every persisted combination to the right baseline (I1 load check)', () => {
    const fb = loadFirebaseModule();
    const knownMs = Date.parse('2024-06-02T00:00:00Z');
    expect(fb._baselineFromStorage('absent', 0))
      .toEqual({ baseline: { kind: 'absent' }, lastCloudTs: 0 });
    expect(fb._baselineFromStorage('absent', undefined))
      .toEqual({ baseline: { kind: 'absent' }, lastCloudTs: 0 });
    expect(fb._baselineFromStorage('absent', 123))
      .toEqual({ baseline: { kind: 'unknown' }, lastCloudTs: 0 });
    expect(fb._baselineFromStorage(CLOUD_TS, knownMs)).toEqual({
      baseline: { kind: 'known', raw: CLOUD_TS, ns: 1717286400000000000n },
      lastCloudTs: knownMs,
    });
    // Raw and ms disagree (downgrade, or an old tab wrote only the ms key):
    // Unknown, and the ms value must not be reused as a migration state.
    expect(fb._baselineFromStorage(CLOUD_TS, knownMs + 1))
      .toEqual({ baseline: { kind: 'unknown' }, lastCloudTs: 0 });
    expect(fb._baselineFromStorage('garbage', knownMs))
      .toEqual({ baseline: { kind: 'unknown' }, lastCloudTs: 0 });
    expect(fb._baselineFromStorage(undefined, knownMs))
      .toEqual({ baseline: { kind: 'unknown' }, lastCloudTs: knownMs });
    expect(fb._baselineFromStorage(undefined, undefined))
      .toEqual({ baseline: { kind: 'unknown' }, lastCloudTs: 0 });
  });
});

describe('_setCloudBaseline / _clearAuth storage writes (I1)', () => {
  it('writes Known and Absent with one set carrying both keys, Unknown with one remove', async () => {
    const fb = loadFirebaseModule();
    const { storage } = await setupSignedInFirebase(fb);
    const setSpy = vi.spyOn(storage.storage.local, 'set');
    const removeSpy = vi.spyOn(storage.storage.local, 'remove');

    await fb._setCloudBaseline(fb._knownBaseline(CLOUD_TS));
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenLastCalledWith({ [RAW_KEY]: CLOUD_TS, [MS_KEY]: CLOUD_MS });

    await fb._setCloudBaseline({ kind: 'absent' });
    expect(setSpy).toHaveBeenCalledTimes(2);
    expect(setSpy).toHaveBeenLastCalledWith({ [RAW_KEY]: 'absent', [MS_KEY]: 0 });

    await fb._setCloudBaseline({ kind: 'unknown' });
    expect(setSpy).toHaveBeenCalledTimes(2);
    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy.mock.calls[0][0]).toEqual(expect.arrayContaining([RAW_KEY, MS_KEY]));
    expect(storage._data).not.toHaveProperty(RAW_KEY);
    expect(storage._data).not.toHaveProperty(MS_KEY);
  });

  it('_clearAuth removes both baseline keys in the same remove call', async () => {
    const fb = loadFirebaseModule();
    const { storage } = await setupSignedInFirebase(fb);
    const removeSpy = vi.spyOn(storage.storage.local, 'remove');

    await fb._clearAuth();

    const call = removeSpy.mock.calls.find((c) => c[0].includes(RAW_KEY));
    expect(call).toBeDefined();
    expect(call[0]).toContain(MS_KEY);
    expect(storage._data).not.toHaveProperty(RAW_KEY);
    expect(storage._data).not.toHaveProperty(MS_KEY);
    expect(fb._getCloudBaseline()).toEqual({ baseline: { kind: 'unknown' }, lastCloudTs: 0 });
  });
});

describe('pull writes the baseline (I2)', () => {
  it('404 persists the absent sentinel with ms 0', async () => {
    const fb = loadFirebaseModule();
    const { storage } = await setupSignedInFirebase(fb, {
      extraRoutes: [firestoreGetRoute(async () => jsonResponse(404, {}))],
    });

    expect(await fb.syncFromCloud()).toBe(false);

    expect(storage._data[RAW_KEY]).toBe('absent');
    expect(storage._data[MS_KEY]).toBe(0);
    expect(fb._getCloudBaseline()).toEqual({ baseline: { kind: 'absent' }, lastCloudTs: 0 });
  });

  it('an empty document (no fields) is Known with its raw updateTime', async () => {
    const fb = loadFirebaseModule();
    const { storage } = await setupSignedInFirebase(fb, {
      extraRoutes: [firestoreGetRoute(async () => jsonResponse(200, { updateTime: CLOUD_TS }))],
    });

    expect(await fb.syncFromCloud()).toBe(false);

    expect(storage._data[RAW_KEY]).toBe(CLOUD_TS);
    expect(storage._data[MS_KEY]).toBe(CLOUD_MS);
    expect(fb._getCloudBaseline().baseline.kind).toBe('known');
  });

  it('a landed document records its raw updateTime and the derived ms', async () => {
    const fb = loadFirebaseModule();
    const raw = '2024-06-02T00:00:00.123456789Z';
    const { storage } = await setupSignedInFirebase(fb, {
      extraRoutes: [firestoreGetRoute(async () => jsonResponse(200, cloudDoc(fb, [{ id: 'c' }], raw)))],
    });

    expect(await fb.syncFromCloud()).toBe(true);

    expect(globalThis.items).toEqual([{ id: 'c' }]);
    expect(storage._data[RAW_KEY]).toBe(raw);
    expect(storage._data[MS_KEY]).toBe(fb._updateTimeToMs(raw));
    expect(fb._getCloudBaseline()).toEqual({
      baseline: { kind: 'known', raw, ns: 1717286400123456789n },
      lastCloudTs: fb._updateTimeToMs(raw),
    });
  });
});

describe('§4 fast path', () => {
  it('skips when the GET time equals the Known baseline in nanoseconds (6 vs 9 digits)', async () => {
    const fb = loadFirebaseModule();
    await setupSignedInFirebase(fb, {
      baseline: '2024-06-02T00:00:00.000000Z',
      extraRoutes: [firestoreGetRoute(async () =>
        jsonResponse(200, cloudDoc(fb, [{ id: 'c' }], '2024-06-02T00:00:00.000000000Z')))],
    });
    const render = vi.fn();
    globalThis.render = render;

    expect(await fb.syncFromCloud()).toBe(true);

    expect(render).not.toHaveBeenCalled();
    expect(globalThis.items).toEqual([]);
  });

  it('does not skip when the GET time is older than the baseline (no more <=)', async () => {
    const fb = loadFirebaseModule();
    await setupSignedInFirebase(fb, {
      baseline: '2024-06-02T00:00:00.000000Z',
      extraRoutes: [firestoreGetRoute(async () =>
        jsonResponse(200, cloudDoc(fb, [{ id: 'c' }], '2024-06-01T00:00:00.000000Z')))],
    });
    const render = vi.fn();
    globalThis.render = render;

    expect(await fb.syncFromCloud()).toBe(true);

    expect(render).toHaveBeenCalledTimes(1);
    expect(globalThis.items).toEqual([{ id: 'c' }]);
  });
});

describe('§9 migration state (ms key only)', () => {
  it('equal ms adopts the raw string and releases the dirty upload', async () => {
    vi.useFakeTimers();
    const fb = loadFirebaseModule();
    const { patches, route } = patchRecorder();
    const { storage } = await setupSignedInFirebase(fb, {
      baseline: null,
      extraRoutes: [
        firestoreGetRoute(async () => jsonResponse(200, cloudDoc(fb, [{ id: 'cloud' }]))),
        route,
      ],
    });
    await seedMigrationState(fb, storage, CLOUD_MS);
    await seedDirty(fb, storage);
    globalThis.items = [{ id: 'local' }];
    const render = vi.fn();
    globalThis.render = render;

    expect(await fb.syncFromCloud()).toBe(true);

    expect(render).not.toHaveBeenCalled();
    expect(storage._data[RAW_KEY]).toBe(CLOUD_TS);
    expect(fb._getCloudBaseline().baseline.kind).toBe('known');
    expect(patches).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(patches).toHaveLength(1);
  });

  it('different ms falls through to content comparison (dirty and different -> pending)', async () => {
    const fb = loadFirebaseModule();
    const { storage } = await setupSignedInFirebase(fb, {
      baseline: null,
      extraRoutes: [firestoreGetRoute(async () => jsonResponse(200, cloudDoc(fb, [{ id: 'cloud' }])))],
    });
    globalThis.onSyncConflict = vi.fn();
    await seedMigrationState(fb, storage, CLOUD_MS - 1000);
    await seedDirty(fb, storage);
    globalThis.items = [{ id: 'local' }];

    expect(await fb.syncFromCloud()).toBe(false);

    expect(fb.fbGetSyncConflict()).not.toBeNull();
    expect(storage._data).not.toHaveProperty(RAW_KEY);
    expect(globalThis.items).toEqual([{ id: 'local' }]);
  });

  it('uploads nothing before the first pull completes', async () => {
    vi.useFakeTimers();
    const fb = loadFirebaseModule();
    const getGate = deferred();
    const { patches, route } = patchRecorder();
    const { storage } = await setupSignedInFirebase(fb, {
      baseline: null,
      extraRoutes: [
        firestoreGetRoute(async () => {
          await getGate.promise;
          return jsonResponse(200, cloudDoc(fb, [{ id: 'cloud' }]));
        }),
        route,
      ],
    });
    await seedMigrationState(fb, storage, CLOUD_MS);
    const fetchLog = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (url, options = {}) => {
      if (url.includes('/documents/')) fetchLog.push(options.method || 'GET');
      return realFetch(url, options);
    };

    const pull = fb.syncFromCloud();
    await vi.advanceTimersByTimeAsync(0);
    globalThis.items = [{ id: 'edited' }];
    await fb.markLocalCloudDataChanged();
    await vi.advanceTimersByTimeAsync(2500);

    expect(patches).toHaveLength(0);
    expect(fetchLog[0]).toBe('GET');

    getGate.resolve();
    await pull;
  });
});

describe('error handling', () => {
  it('GET doc with missing updateTime throws firestore without landing or touching the baseline', async () => {
    const fb = loadFirebaseModule();
    const { storage } = await setupSignedInFirebase(fb, {
      extraRoutes: [firestoreGetRoute(async () => jsonResponse(200, cloudDoc(fb, [{ id: 'c' }], null)))],
    });

    await expect(fb.syncFromCloud()).rejects.toMatchObject({ code: 'firestore' });

    expect(globalThis.items).toEqual([]);
    expect(storage._data[RAW_KEY]).toBe(SEED_UPDATE_TIME);
    expect(storage._data[MS_KEY]).toBe(SEED_UPDATE_MS);
    expect(fb._getCloudBaseline().baseline.raw).toBe(SEED_UPDATE_TIME);
  });

  it('an empty document with an unparsable updateTime also throws firestore', async () => {
    const fb = loadFirebaseModule();
    const { storage } = await setupSignedInFirebase(fb, {
      extraRoutes: [firestoreGetRoute(async () => jsonResponse(200, { updateTime: 'garbage' }))],
    });

    await expect(fb.syncFromCloud()).rejects.toMatchObject({ code: 'firestore' });

    expect(storage._data[RAW_KEY]).toBe(SEED_UPDATE_TIME);
  });

  it('storage write throws mid-landing: neither the persisted nor the in-memory baseline advances', async () => {
    const fb = loadFirebaseModule();
    const cloudItems = [{ id: 'same' }];
    const { storage } = await setupSignedInFirebase(fb, {
      extraRoutes: [firestoreGetRoute(async () => jsonResponse(200, cloudDoc(fb, cloudItems)))],
    });
    // Dirty but equal to the cloud: the landing would mark it clean.
    await seedDirty(fb, storage);
    globalThis.items = [{ id: 'same' }];
    const realSet = storage.storage.local.set;
    let failNext = true;
    storage.storage.local.set = async (values) => {
      if (failNext && RAW_KEY in values) {
        failNext = false;
        throw new Error('QUOTA_BYTES exceeded');
      }
      return realSet(values);
    };

    await expect(fb.syncFromCloud()).rejects.toThrow('QUOTA_BYTES exceeded');

    expect(storage._data._fb_synced_rev).toBe(2);
    expect(fb._isDirty()).toBe(true);
    expect(storage._data[RAW_KEY]).toBe(SEED_UPDATE_TIME);
    expect(fb._getCloudBaseline()).toEqual({
      baseline: { kind: 'known', raw: SEED_UPDATE_TIME, ns: fb._parseUpdateTimeNs(SEED_UPDATE_TIME) },
      lastCloudTs: SEED_UPDATE_MS,
    });

    // The next action must not treat the unpersisted cloud time as the
    // baseline: the same GET is not "unchanged", it is compared and landed.
    const render = vi.fn();
    globalThis.render = render;
    expect(await fb.syncFromCloud()).toBe(true);
    expect(render).toHaveBeenCalledTimes(1);
    expect(fb._isDirty()).toBe(false);
    expect(fb._getCloudBaseline().baseline.raw).toBe(CLOUD_TS);
  });
});

describe('session reset', () => {
  it('_resetSession sets the in-memory baseline to Unknown and keeps the persisted keys', async () => {
    const fb = loadFirebaseModule();
    const { storage } = await setupSignedInFirebase(fb);
    expect(fb._getCloudBaseline().baseline.kind).toBe('known');

    fb._resetSession();

    expect(fb._getCloudBaseline()).toEqual({ baseline: { kind: 'unknown' }, lastCloudTs: 0 });
    expect(storage._data[RAW_KEY]).toBe(SEED_UPDATE_TIME);
    expect(storage._data[MS_KEY]).toBe(SEED_UPDATE_MS);
  });

  it('a session reset during _setCloudBaseline keeps the new session baseline Unknown', async () => {
    const fb = loadFirebaseModule();
    const { storage } = await setupSignedInFirebase(fb, { baseline: null });
    const realSet = storage.storage.local.set;
    const reached = deferred();
    const gate = deferred();
    storage.storage.local.set = async (values) => {
      if (RAW_KEY in values) {
        reached.resolve();
        await gate.promise;
      }
      return realSet(values);
    };

    const write = fb._setCloudBaseline(fb._knownBaseline(CLOUD_TS));
    await reached.promise;
    fb._resetSession();
    gate.resolve();
    await write;

    expect(fb._getCloudBaseline()).toEqual({ baseline: { kind: 'unknown' }, lastCloudTs: 0 });
  });
});

describe('fbInit', () => {
  afterEach(() => {
    cleanupFbInitIntercepts();
  });

  it('seeds the displayed sync time from a persisted Known baseline', async () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    installFbInitEventTracking();
    globalThis.chrome = createMockChromeStorage({ [RAW_KEY]: CLOUD_TS, [MS_KEY]: CLOUD_MS });
    globalThis._loadAuth = vi.fn(async () => {});
    globalThis._loadRevState = vi.fn(async () => {});
    globalThis._updateSyncUI = vi.fn();
    globalThis._bindSyncActionButtons = vi.fn();
    globalThis.fbIsSignedIn = vi.fn(() => false);
    globalThis.fbIsEmailVerified = vi.fn(() => false);
    window.showSigninNotice = vi.fn();

    await fb.fbInit();

    expect(fb._getCloudBaseline().baseline.raw).toBe(CLOUD_TS);
    expect(fb._getSyncDebugState().lastSyncDisplayTs).toBe(CLOUD_MS);
  });
});
