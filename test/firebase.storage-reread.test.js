import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadFirebaseModule } from './helpers/loadFirebaseModule.js';
import { jsonResponse, deferred } from './helpers/mockFetch.js';
import {
  setupSignedInFirebase,
  firestoreGetRoute,
  firestorePatchRoute,
  preconditionOf,
  SEED_UPDATE_TIME,
  SEED_UPDATE_MS,
} from './helpers/setupSignedInFirebase.js';

// Spec §8 (same-device tabs) and §7.3 (dequeue guard order): an upload body
// re-reads storage before any request and decides by the §8 table; every task
// checks storage-unavailable and a cleared auth key before landing or writing.

const RAW_KEY = '_fb_cloud_update_time';
const MS_KEY = '_fb_cloud_sync_ts';
const CLOUD_TS = '2024-06-02T00:00:00.000000Z';
const OTHER_TAB_TS = '2024-05-01T00:00:00.000000Z';
const OTHER_TAB_MS = Date.parse('2024-05-01T00:00:00Z');
const PATCH_TS = '2024-06-03T00:00:00.000000Z';

function cloudDoc(fb, items, { updateTime = CLOUD_TS, clocks = true } = {}) {
  const fields = {
    items: fb._toFV(JSON.stringify(items)),
    engines: fb._toFV(JSON.stringify([])),
    selected_engine: fb._toFV('google'),
    grid_columns: fb._toFV(4),
  };
  if (clocks) fields.clocks = fb._toFV(JSON.stringify([]));
  return { updateTime, fields };
}

function recordingRoutes({ get = async () => jsonResponse(404, {}), patch = okPatch } = {}) {
  const log = [];
  const patches = [];
  const routes = [
    firestoreGetRoute(() => { log.push('GET'); return get(); }),
    firestorePatchRoute((url, options) => {
      log.push('PATCH');
      patches.push({ url, body: JSON.parse(options.body) });
      return patch(url, options);
    }),
  ];
  return { log, patches, routes };
}

const okPatch = async () => jsonResponse(200, { updateTime: PATCH_TS });
const getDoc = (doc) => async () => jsonResponse(200, doc);
const preconditionFailed = async () =>
  jsonResponse(400, { error: { status: 'FAILED_PRECONDITION', message: 'FAILED_PRECONDITION' } });

async function flush() {
  for (let i = 0; i < 20; i += 1) await vi.advanceTimersByTimeAsync(0);
}

// Local state with one unsynced edit, without arming the debounce timer.
async function seedDirty(fb, storage, items = [{ id: 'local' }]) {
  globalThis.items = items;
  storage._data._fb_edit_rev = 3;
  storage._data._fb_synced_rev = 2;
  await fb._loadRevState();
}

// Another tab signed out: _clearAuth removed the auth and baseline keys.
function otherTabSignedOut(storage) {
  delete storage._data._fb_refresh;
  delete storage._data[RAW_KEY];
  delete storage._data[MS_KEY];
}

function breakStorageReads(storage) {
  storage.storage.local.get = async () => { throw new Error('storage read failed'); };
}

// A pending conflict from a forced pull over a dirty, different local state.
async function makeConflict(fb, storage, routesGet) {
  await seedDirty(fb, storage);
  routesGet.current = getDoc(cloudDoc(fb, [{ id: 'cloud' }]));
  await fb.syncFromCloud({ mode: 'forced' });
  expect(fb.fbGetSyncConflict()).not.toBeNull();
}

function signInRoute(localId) {
  return {
    match: (url) => url.includes('accounts:signInWithPassword'),
    respond: async () => jsonResponse(200, {
      idToken: `h.${btoa(JSON.stringify({ email_verified: true }))}.s`,
      expiresIn: '3600',
      refreshToken: 'other-refresh',
      localId,
    }),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

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
  delete globalThis.showToast;
  delete globalThis.isStorageLoadFailed;
  document.body.innerHTML = '';
});

describe('_decideUploadStorage: the §8 table (§10.1-15)', () => {
  const fb = loadFirebaseModule();
  const KNOWN = fb._knownBaseline(SEED_UPDATE_TIME);
  const KNOWN_SAME_9 = fb._knownBaseline('2024-01-01T00:00:00.000000000Z');
  const KNOWN_OTHER = fb._knownBaseline(OTHER_TAB_TS);
  const ABSENT = { kind: 'absent' };
  const UNKNOWN = { kind: 'unknown' };
  const read = (over = {}) => ({
    ok: true, authCleared: false, baselinePresent: true, stored: KNOWN, storedValid: true, ...over,
  });
  const MISSING = read({ baselinePresent: false, stored: UNKNOWN, storedValid: false });
  const INVALID = read({ stored: UNKNOWN, storedValid: false });

  // [row, read, mem, expected, expected with exemptValueDiff]
  const rows = [
    ['1 unreadable', { ok: false }, KNOWN, 'storage-unavailable', 'storage-unavailable'],
    ['1 unreadable', { ok: false }, ABSENT, 'storage-unavailable', 'storage-unavailable'],
    ['1 unreadable', { ok: false }, UNKNOWN, 'storage-unavailable', 'storage-unavailable'],
    ['2 auth cleared', read({ authCleared: true }), KNOWN, 'baseline-cleared', 'baseline-cleared'],
    ['2 auth cleared', read({ authCleared: true }), ABSENT, 'baseline-cleared', 'baseline-cleared'],
    ['2 auth cleared', read({ authCleared: true }), UNKNOWN, 'baseline-cleared', 'baseline-cleared'],
    ['3 keys missing', MISSING, KNOWN, 'baseline-cleared', 'baseline-cleared'],
    ['3 keys missing', MISSING, ABSENT, 'baseline-cleared', 'baseline-cleared'],
    // D3 deviation: with exemptValueDiff, Unknown proceeds (the caller pulls).
    ['4 keys missing', MISSING, UNKNOWN, 'baseline-pull', 'proceed'],
    ['5 valid stored', read(), UNKNOWN, 'baseline-pull', 'proceed'],
    ['5 invalid stored', INVALID, UNKNOWN, 'baseline-pull', 'proceed'],
    ['6 differs', read({ stored: KNOWN_OTHER }), KNOWN, 'recovery-pull', 'proceed'],
    ['6 absent vs known', read({ stored: ABSENT }), KNOWN, 'recovery-pull', 'proceed'],
    ['6 known vs absent', read(), ABSENT, 'recovery-pull', 'proceed'],
    ['6 invalid stored', INVALID, KNOWN, 'recovery-pull', 'proceed'],
    ['6 invalid stored', INVALID, ABSENT, 'recovery-pull', 'proceed'],
    ['7 same', read(), KNOWN, 'proceed', 'proceed'],
    ['7 same instant, other digits', read({ stored: KNOWN_SAME_9 }), KNOWN, 'proceed', 'proceed'],
    ['7 same absent', read({ stored: ABSENT }), ABSENT, 'proceed', 'proceed'],
  ];

  it.each(rows)('row %s (mem %#)', (_row, r, mem, expected, exempt) => {
    expect(fb._decideUploadStorage(r, mem)).toBe(expected);
    expect(fb._decideUploadStorage(r, mem, { exemptValueDiff: true })).toBe(exempt);
  });

  it('order: unreadable beats a cleared auth key, which beats every baseline row', () => {
    expect(fb._decideUploadStorage({ ok: false, authCleared: true }, KNOWN)).toBe('storage-unavailable');
    for (const mem of [KNOWN, ABSENT, UNKNOWN]) {
      expect(fb._decideUploadStorage(read({ authCleared: true, stored: KNOWN_OTHER }), mem))
        .toBe('baseline-cleared');
      expect(fb._decideUploadStorage(
        read({ authCleared: true, baselinePresent: false, stored: UNKNOWN, storedValid: false }), mem,
      )).toBe('baseline-cleared');
    }
  });
});

describe('§8 re-read in the upload body', () => {
  it('a storage read that throws → auto upload makes no request, storage-unavailable', async () => {
    const fb = loadFirebaseModule();
    const fetchSpy = vi.fn();
    const { routes, log } = recordingRoutes();
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes });
    await seedDirty(fb, storage);
    const inner = globalThis.fetch;
    globalThis.fetch = (...args) => { fetchSpy(...args); return inner(...args); };
    breakStorageReads(storage);

    await expect(fb.syncToCloud())
      .resolves.toEqual({ ok: true, skipped: true, reason: 'storage-unavailable' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(log).toEqual([]);
  });

  it('another tab signed out (auth and baseline keys gone, memory Known) → baseline-cleared, no request, keys stay gone', async () => {
    const fb = loadFirebaseModule();
    const fetchSpy = vi.fn();
    const { routes } = recordingRoutes();
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes });
    await seedDirty(fb, storage);
    const inner = globalThis.fetch;
    globalThis.fetch = (...args) => { fetchSpy(...args); return inner(...args); };
    otherTabSignedOut(storage);

    await expect(fb.syncToCloud())
      .resolves.toEqual({ ok: true, skipped: true, reason: 'baseline-cleared' });
    await flush();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(RAW_KEY in storage._data).toBe(false);
    expect(MS_KEY in storage._data).toBe(false);
  });

  it('only the baseline keys gone, memory Known → baseline-cleared without a GET', async () => {
    const fb = loadFirebaseModule();
    const { routes, log } = recordingRoutes();
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes });
    await seedDirty(fb, storage);
    delete storage._data[RAW_KEY];
    delete storage._data[MS_KEY];

    await expect(fb.syncToCloud())
      .resolves.toEqual({ ok: true, skipped: true, reason: 'baseline-cleared' });
    expect(log).toEqual([]);
    expect(RAW_KEY in storage._data).toBe(false);
  });

  it('baseline keys missing, memory Unknown → baseline pull (one GET)', async () => {
    const fb = loadFirebaseModule();
    const { routes, log, patches } = recordingRoutes();
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes, baseline: null });
    await seedDirty(fb, storage);

    await expect(fb.syncToCloud()).resolves.toMatchObject({ ok: true, skipped: false });
    expect(log).toEqual(['GET', 'PATCH']);
    expect(preconditionOf(patches[0].url)).toEqual({ exists: 'false' });
  });

  it('a failed startup pull leaves the baseline Unknown; the next auto upload pulls before any PATCH', async () => {
    const fb = loadFirebaseModule();
    let getCalls = 0;
    const { routes, log } = recordingRoutes({
      get: async () => {
        getCalls += 1;
        return getCalls === 1 ? jsonResponse(503, { error: { status: 'UNAVAILABLE' } }) : jsonResponse(404, {});
      },
    });
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes, baseline: null });
    await expect(fb.syncFromCloud()).rejects.toBeTruthy();
    expect(fb._getCloudBaseline().baseline).toEqual({ kind: 'unknown' });

    await seedDirty(fb, storage);
    await expect(fb.syncToCloud()).resolves.toMatchObject({ ok: true, skipped: false });
    expect(log).toEqual(['GET', 'GET', 'PATCH']);
  });

  it('another tab wrote a new baseline → one recovery GET; the PATCH uses the GET raw string; a second failure is retry-exhausted', async () => {
    const fb = loadFirebaseModule();
    // The cloud has the local content but no clocks field: it lands, and the
    // skipped field re-dirties the state so the upload goes on to PATCH.
    const { routes, log, patches } = recordingRoutes({
      get: getDoc(cloudDoc(fb, [{ id: 'local' }], { clocks: false })),
      patch: preconditionFailed,
    });
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes });
    await seedDirty(fb, storage);
    storage._data[RAW_KEY] = OTHER_TAB_TS;
    storage._data[MS_KEY] = OTHER_TAB_MS;

    await expect(fb.syncToCloud())
      .resolves.toEqual({ ok: true, skipped: true, reason: 'retry-exhausted' });
    expect(log).toEqual(['GET', 'PATCH']);
    expect(preconditionOf(patches[0].url)).toEqual({ updateTime: CLOUD_TS });
    expect(fb._isDirty()).toBe(true);
  });

  it('I4: a session switch while the re-read is pending sends no PATCH (memory Absent)', async () => {
    const fb = loadFirebaseModule();
    const { routes, log } = recordingRoutes();
    const { storage } = await setupSignedInFirebase(fb, {
      extraRoutes: [...routes, signInRoute('other-uid')],
      baseline: 'absent',
    });
    await seedDirty(fb, storage);
    // Hold the second sync re-read (the upload body's, after the dequeue one).
    const gate = deferred();
    const realGet = storage.storage.local.get;
    let syncReads = 0;
    storage.storage.local.get = async (keys) => {
      if (Array.isArray(keys) && keys.includes('_fb_refresh') && keys.includes(RAW_KEY)) {
        syncReads += 1;
        if (syncReads === 2) await gate.promise;
      }
      return realGet(keys);
    };

    const upload = fb.syncToCloud();
    await flush();
    expect(syncReads).toBe(2);
    await fb._clearAuth();
    await fb.fbSignIn('other@example.com', 'pw');
    gate.resolve();

    await expect(upload).resolves.toEqual({ ok: true, skipped: true, reason: 'session-changed' });
    expect(log.filter((x) => x === 'PATCH')).toHaveLength(0);
  });
});

describe('§8 check before a pull lands', () => {
  it('the auth key cleared during the GET → syncFromCloud false, nothing rendered or written', async () => {
    const fb = loadFirebaseModule();
    const gate = deferred();
    const { routes } = recordingRoutes({ get: () => gate.promise });
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes });
    globalThis.render = vi.fn();

    const pull = fb.syncFromCloud({ mode: 'forced' });
    await flush();
    delete storage._data._fb_refresh;
    gate.resolve(jsonResponse(200, cloudDoc(fb, [{ id: 'cloud' }])));

    await expect(pull).resolves.toBe(false);
    expect(globalThis.render).not.toHaveBeenCalled();
    expect(storage._data[RAW_KEY]).toBe(SEED_UPDATE_TIME);
    expect(storage._data[MS_KEY]).toBe(SEED_UPDATE_MS);
    expect(storage._data.startpage_items).toBeUndefined();
  });

  it('choose-cloud blocked by a cleared auth key → {ok:false, code:baseline-cleared}, no import queued', async () => {
    const fb = loadFirebaseModule();
    const routesGet = { current: async () => jsonResponse(404, {}) };
    const { routes, log } = recordingRoutes({ get: () => routesGet.current() });
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes });
    await makeConflict(fb, storage, routesGet);
    routesGet.current = async () => jsonResponse(404, {});
    delete storage._data._fb_refresh;

    await expect(fb.fbResolveSyncConflict('cloud'))
      .resolves.toEqual({ ok: false, code: 'baseline-cleared' });
    await vi.advanceTimersByTimeAsync(5000);
    await flush();
    expect(log).toEqual(['GET']);
    expect(log.filter((x) => x === 'PATCH')).toHaveLength(0);
  });
});

describe('§7.3 dequeue guard order and matrix', () => {
  it('a pending conflict with unreadable storage → the auto upload gets storage-unavailable (step 3 before 4)', async () => {
    const fb = loadFirebaseModule();
    const routesGet = { current: async () => jsonResponse(404, {}) };
    const { routes } = recordingRoutes({ get: () => routesGet.current() });
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes });
    await makeConflict(fb, storage, routesGet);
    breakStorageReads(storage);

    await expect(fb.syncToCloud())
      .resolves.toEqual({ ok: true, skipped: true, reason: 'storage-unavailable' });
  });

  describe('auto upload', () => {
    it('pending conflict → conflict-pending', async () => {
      const fb = loadFirebaseModule();
      const routesGet = { current: async () => jsonResponse(404, {}) };
      const { routes, log } = recordingRoutes({ get: () => routesGet.current() });
      const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes });
      await makeConflict(fb, storage, routesGet);

      await expect(fb.syncToCloud())
        .resolves.toEqual({ ok: true, skipped: true, reason: 'conflict-pending' });
      expect(log).toEqual(['GET']);
    });

    it('account switch pending → switch-pending', async () => {
      const fb = loadFirebaseModule();
      const { routes, log } = recordingRoutes();
      const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes });
      storage._data._fb_sync_baseline_uid = 'previous-uid';
      await fb._loadAuth();
      await seedDirty(fb, storage);

      await expect(fb.syncToCloud())
        .resolves.toEqual({ ok: true, skipped: true, reason: 'switch-pending' });
      expect(log).toEqual([]);
    });

    it('clean → clean', async () => {
      const fb = loadFirebaseModule();
      const { routes, log } = recordingRoutes();
      await setupSignedInFirebase(fb, { extraRoutes: routes });

      await expect(fb.syncToCloud()).resolves.toEqual({ ok: true, skipped: true, reason: 'clean' });
      expect(log).toEqual([]);
    });

    it('storage firewall → storage-read-only', async () => {
      const fb = loadFirebaseModule();
      const { routes, log } = recordingRoutes();
      const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes });
      await seedDirty(fb, storage);
      globalThis.isStorageLoadFailed = () => true;

      await expect(fb.syncToCloud())
        .resolves.toEqual({ ok: true, skipped: true, reason: 'storage-read-only' });
      expect(log).toEqual([]);
    });
  });

  describe('manual upload', () => {
    it('account switch pending → uploads anyway', async () => {
      const fb = loadFirebaseModule();
      const { routes, log } = recordingRoutes();
      const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes });
      storage._data._fb_sync_baseline_uid = 'previous-uid';
      await fb._loadAuth();
      await seedDirty(fb, storage);

      await expect(fb.syncToCloud({ force: true })).resolves.toMatchObject({ ok: true, skipped: false });
      expect(log).toEqual(['PATCH']);
    });

    it('storage firewall → storage-read-only', async () => {
      const fb = loadFirebaseModule();
      const { routes, log } = recordingRoutes();
      const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes });
      await seedDirty(fb, storage);
      globalThis.isStorageLoadFailed = () => true;

      await expect(fb.syncToCloud({ force: true }))
        .resolves.toEqual({ ok: true, skipped: true, reason: 'storage-read-only' });
      expect(log).toEqual([]);
    });
  });

  it('a pull that ends in a conflict skips the auto upload queued behind it (§10.1-7)', async () => {
    const fb = loadFirebaseModule();
    const gate = deferred();
    const { routes, log } = recordingRoutes({ get: () => gate.promise });
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes });
    await seedDirty(fb, storage);

    const pull = fb.syncFromCloud({ mode: 'forced' });
    const upload = fb.syncToCloud();
    await flush();
    gate.resolve(jsonResponse(200, cloudDoc(fb, [{ id: 'cloud' }])));

    await expect(pull).resolves.toBe(false);
    await expect(upload).resolves.toEqual({ ok: true, skipped: true, reason: 'conflict-pending' });
    expect(log).toEqual(['GET']);
  });
});

describe('_runPullTask', () => {
  async function pullWith(makeGet, { dirty = false } = {}) {
    const fb = loadFirebaseModule();
    const { routes } = recordingRoutes({ get: makeGet(fb) });
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes });
    if (dirty) await seedDirty(fb, storage);
    return fb;
  }

  const cases = [
    ['applied', (fb) => getDoc(cloudDoc(fb, [{ id: 'cloud' }])), {}, { applied: true, outcome: 'applied' }, true],
    ['unchanged', (fb) => getDoc(cloudDoc(fb, [{ id: 'cloud' }], { updateTime: SEED_UPDATE_TIME })),
      { mode: 'auto' }, { applied: true, outcome: 'unchanged' }, true],
    ['cloud-empty (404)', () => async () => jsonResponse(404, {}), {},
      { applied: false, outcome: 'cloud-empty', cloud: 'not-found' }, false],
    ['cloud-empty (empty document)', () => async () => jsonResponse(200, { updateTime: CLOUD_TS }), {},
      { applied: false, outcome: 'cloud-empty', cloud: 'empty' }, false],
    ['conflict', (fb) => getDoc(cloudDoc(fb, [{ id: 'cloud' }])), { dirty: true },
      { applied: false, outcome: 'conflict' }, false],
  ];

  it.each(cases)('%s', async (_name, makeGet, opts, expected) => {
    const fb = await pullWith(makeGet, opts);
    await expect(fb._runPullTask({ mode: opts.mode || 'forced' })).resolves.toEqual(expected);
  });

  it.each(cases)('syncFromCloud maps %s to its applied flag', async (_name, makeGet, opts, _expected, applied) => {
    const fb = await pullWith(makeGet, opts);
    await expect(fb.syncFromCloud({ mode: opts.mode || 'forced' })).resolves.toBe(applied);
  });

  it('session-changed: a sign-out during the GET', async () => {
    const fb = loadFirebaseModule();
    const gate = deferred();
    const { routes } = recordingRoutes({ get: () => gate.promise });
    await setupSignedInFirebase(fb, { extraRoutes: routes });

    const pull = fb._runPullTask({ mode: 'forced' });
    await flush();
    await fb._clearAuth();
    gate.resolve(jsonResponse(200, cloudDoc(fb, [{ id: 'cloud' }])));
    await expect(pull).resolves.toEqual({ applied: false, outcome: 'session-changed' });
  });

  it('syncFromCloud resolves false on session-changed', async () => {
    const fb = loadFirebaseModule();
    const gate = deferred();
    const { routes } = recordingRoutes({ get: () => gate.promise });
    await setupSignedInFirebase(fb, { extraRoutes: routes });

    const pull = fb.syncFromCloud({ mode: 'forced' });
    await flush();
    await fb._clearAuth();
    gate.resolve(jsonResponse(200, cloudDoc(fb, [{ id: 'cloud' }])));
    await expect(pull).resolves.toBe(false);
  });
});
