import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadFirebaseModule } from './helpers/loadFirebaseModule.js';
import { jsonResponse, deferred } from './helpers/mockFetch.js';
import {
  setupSignedInFirebase,
  firestoreGetRoute,
  firestorePatchRoute,
  preconditionOf,
  SEED_UPDATE_TIME,
  TEST_UID,
} from './helpers/setupSignedInFirebase.js';

// Spec §3.1 I3/I4, §5.3, §6.1: every PATCH carries a Firestore precondition
// taken from the cloud baseline in the same synchronous block as the payload;
// an Unknown baseline is first established by a baseline pull.

const RAW_KEY = '_fb_cloud_update_time';
const CLOUD_TS = '2024-06-02T00:00:00.000000Z';
const EMPTY_TS = '2024-06-02T12:00:00.654321Z';
const PATCH_TS = '2024-06-03T00:00:00.000000Z';

function cloudDoc(fb, items, updateTime = CLOUD_TS) {
  return {
    updateTime,
    fields: {
      items: fb._toFV(JSON.stringify(items)),
      engines: fb._toFV(JSON.stringify([])),
      selected_engine: fb._toFV('google'),
      clocks: fb._toFV(JSON.stringify([])),
      grid_columns: fb._toFV(4),
    },
  };
}

// Records every document request in order; `get` / `patch` return a response
// or a promise of one (e.g. a deferred).
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
const count = (log, kind) => log.filter((x) => x === kind).length;
const patchedItems = (patch) => JSON.parse(patch.body.fields.items.stringValue);

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

async function editLocally(fb, id) {
  globalThis.items = [...(globalThis.items || []), { id }];
  await fb.markLocalCloudDataChanged();
}

// A token route whose refresh response the test releases.
function gatedTokenRoute(gate) {
  return {
    match: (url) => url.includes('securetoken.googleapis.com'),
    respond: () => gate.promise,
  };
}

const tokenResponse = () => jsonResponse(200, {
  id_token: 'fresh-id-token',
  expires_in: '3600',
  refresh_token: 'refreshed-refresh-token',
  user_id: TEST_UID,
});

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

const firestoreError = (httpStatus, status) =>
  async () => jsonResponse(httpStatus, { error: { status, message: status } });

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
  document.body.innerHTML = '';
});

describe('precondition helpers', () => {
  it('maps baselines to preconditions and query strings', () => {
    const fb = loadFirebaseModule();
    const known = fb._knownBaseline('2024-06-02T00:00:00.123Z');
    expect(fb._preconditionFromBaseline(known)).toEqual({ updateTime: '2024-06-02T00:00:00.123Z' });
    expect(fb._preconditionFromBaseline({ kind: 'absent' })).toEqual({ exists: false });
    expect(() => fb._preconditionFromBaseline({ kind: 'unknown' }))
      .toThrow('precondition requested for unknown baseline');
    expect(fb._preconditionQuery({ updateTime: '2024-06-02T00:00:00.123Z' }))
      .toBe('?currentDocument.updateTime=2024-06-02T00%3A00%3A00.123Z');
    expect(fb._preconditionQuery({ exists: false })).toBe('?currentDocument.exists=false');
  });

  it('_preconditionQuery rejects malformed input instead of guessing a precondition', () => {
    const fb = loadFirebaseModule();
    // Never silently exists=false, never the literal "undefined".
    expect(() => fb._preconditionQuery({})).toThrow('invalid precondition');
    expect(() => fb._preconditionQuery(undefined)).toThrow('invalid precondition');
    expect(() => fb._preconditionQuery({ exists: true })).toThrow('invalid precondition');
    expect(() => fb._preconditionQuery({ updateTime: undefined })).toThrow('invalid precondition updateTime');
    expect(() => fb._preconditionQuery({ updateTime: null })).toThrow('invalid precondition updateTime');
    expect(() => fb._preconditionQuery({ updateTime: 123 })).toThrow('invalid precondition updateTime');
    expect(() => fb._preconditionQuery({ updateTime: '' })).toThrow('invalid precondition updateTime');
  });

  it('_docUrl defaults to the signed-in uid and accepts an explicit one', async () => {
    const fb = loadFirebaseModule();
    await setupSignedInFirebase(fb);
    expect(fb._docUrl()).toContain(`/documents/users/${TEST_UID}/data/settings`);
    expect(fb._docUrl('other')).toContain('/documents/users/other/data/settings');
  });

  it('_isPreconditionError covers exactly the three precondition codes', () => {
    const fb = loadFirebaseModule();
    for (const code of ['precondition-failed', 'already-exists', 'not-found']) {
      expect(fb._isPreconditionError(code)).toBe(true);
    }
    for (const code of ['firestore', 'network', 'auth', 'quota', undefined]) {
      expect(fb._isPreconditionError(code)).toBe(false);
    }
  });
});

describe('I3: every PATCH carries a precondition', () => {
  it.each([
    '2024-06-02T00:00:00.123Z',
    '2024-06-02T00:00:00.123456Z',
    '2024-06-02T00:00:00.123456789Z',
  ])('Known baseline %s is sent verbatim and URL-encoded', async (raw) => {
    const fb = loadFirebaseModule();
    const { patches, routes } = recordingRoutes();
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes, baseline: raw });
    await seedDirty(fb, storage);

    await expect(fb.syncToCloud()).resolves.toMatchObject({ ok: true, skipped: false });

    expect(patches).toHaveLength(1);
    expect(preconditionOf(patches[0].url)).toEqual({ updateTime: raw });
    expect(patches[0].url).toContain(`currentDocument.updateTime=${raw.replace(/:/g, '%3A')}`);
  });

  it('Absent baseline sends exists=false and no updateTime', async () => {
    const fb = loadFirebaseModule();
    const { patches, routes } = recordingRoutes();
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes, baseline: 'absent' });
    await seedDirty(fb, storage);

    await fb.syncToCloud();

    expect(patches).toHaveLength(1);
    expect(preconditionOf(patches[0].url)).toEqual({ exists: 'false' });
  });

  it('an explicit precondition overrides the baseline', async () => {
    const fb = loadFirebaseModule();
    const { patches, routes } = recordingRoutes();
    await setupSignedInFirebase(fb, { extraRoutes: routes });
    const result = await fb._enqueueSync({
      kind: 'upload',
      auto: false,
      run: (ctx) => fb._pushCore(ctx, { precondition: { exists: false } }),
    });

    expect(result).toMatchObject({ uploaded: true });
    expect(preconditionOf(patches[0].url)).toEqual({ exists: 'false' });
  });
});

describe('§5.3 baseline pull for an Unknown baseline', () => {
  it('GET 404 → PATCH with exists=false', async () => {
    const fb = loadFirebaseModule();
    const { log, patches, routes } = recordingRoutes();
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes, baseline: null });
    await seedDirty(fb, storage);

    await expect(fb.syncToCloud()).resolves.toMatchObject({ ok: true, skipped: false });

    expect(log).toEqual(['GET', 'PATCH']);
    expect(preconditionOf(patches[0].url)).toEqual({ exists: 'false' });
    expect(fb._getCloudBaseline().baseline).toMatchObject({ kind: 'known', raw: PATCH_TS });
  });

  it('GET empty document → PATCH with that document\'s raw updateTime', async () => {
    const fb = loadFirebaseModule();
    const { log, patches, routes } = recordingRoutes({
      get: async () => jsonResponse(200, { updateTime: EMPTY_TS }),
    });
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes, baseline: null });
    await seedDirty(fb, storage);

    await fb.syncToCloud();

    expect(log).toEqual(['GET', 'PATCH']);
    expect(preconditionOf(patches[0].url)).toEqual({ updateTime: EMPTY_TS });
  });

  it('GET with different content → conflict pending, zero PATCH', async () => {
    const fb = loadFirebaseModule();
    const { log, routes } = recordingRoutes({
      get: async () => jsonResponse(200, cloudDoc(fb, [{ id: 'cloud' }])),
    });
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes, baseline: null });
    await seedDirty(fb, storage);

    await expect(fb.syncToCloud()).resolves.toEqual({ ok: true, skipped: true, reason: 'conflict' });

    expect(count(log, 'PATCH')).toBe(0);
    expect(fb.fbGetSyncConflict()).not.toBeNull();
  });

  it('GET with the same content → up-to-date, clean, zero PATCH', async () => {
    const fb = loadFirebaseModule();
    const { log, routes } = recordingRoutes({
      get: async () => jsonResponse(200, cloudDoc(fb, [{ id: 'local' }])),
    });
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes, baseline: null });
    await seedDirty(fb, storage);

    await expect(fb.syncToCloud()).resolves.toEqual({ ok: true, skipped: true, reason: 'up-to-date' });

    expect(count(log, 'PATCH')).toBe(0);
    expect(fb._isDirty()).toBe(false);
  });

  it('a failed baseline pull rejects, stays Unknown and dirty, and arms no retry', async () => {
    const fb = loadFirebaseModule();
    const { log, routes } = recordingRoutes({ get: async () => { throw new Error('net'); } });
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes, baseline: null });
    await seedDirty(fb, storage);

    await expect(fb.syncToCloud()).rejects.toMatchObject({ code: 'network' });

    expect(count(log, 'PATCH')).toBe(0);
    expect(storage._data[RAW_KEY]).toBeUndefined();
    expect(fb._getCloudBaseline().baseline).toEqual({ kind: 'unknown' });
    expect(fb._isDirty()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('manual upload with a clean local state still compares: different → conflict', async () => {
    const fb = loadFirebaseModule();
    const { log, routes } = recordingRoutes({
      get: async () => jsonResponse(200, cloudDoc(fb, [{ id: 'cloud' }])),
    });
    await setupSignedInFirebase(fb, { extraRoutes: routes, baseline: null });
    globalThis.items = [{ id: 'local' }];
    expect(fb._isDirty()).toBe(false);

    await expect(fb.syncToCloud({ force: true }))
      .resolves.toEqual({ ok: true, skipped: true, reason: 'conflict' });

    expect(count(log, 'PATCH')).toBe(0);
    expect(fb.fbGetSyncConflict()).not.toBeNull();
    expect(globalThis.items).toEqual([{ id: 'local' }]); // nothing landed
  });

  it('manual upload with a clean local state and the same content → up-to-date', async () => {
    const fb = loadFirebaseModule();
    const { log, routes } = recordingRoutes({
      get: async () => jsonResponse(200, cloudDoc(fb, [{ id: 'local' }])),
    });
    await setupSignedInFirebase(fb, { extraRoutes: routes, baseline: null });
    globalThis.items = [{ id: 'local' }];

    await expect(fb.syncToCloud({ force: true }))
      .resolves.toEqual({ ok: true, skipped: true, reason: 'up-to-date' });

    expect(count(log, 'PATCH')).toBe(0);
    expect(fb.fbGetSyncConflict()).toBeNull();
  });
});

describe('§6.1 error classification', () => {
  const patchArgs = (fb) => ({
    url: fb._docUrl() + fb._preconditionQuery({ exists: false }),
    token: 'tok',
    body: '{"fields":{}}',
  });

  it.each([
    [400, 'FAILED_PRECONDITION', 'precondition-failed'],
    [409, 'ALREADY_EXISTS', 'already-exists'],
    [404, 'NOT_FOUND', 'not-found'],
    [400, 'INVALID_ARGUMENT', 'firestore'],
    [409, 'ABORTED', 'firestore'],
  ])('PATCH %i %s → %s', async (httpStatus, status, code) => {
    const fb = loadFirebaseModule();
    await setupSignedInFirebase(fb, {
      extraRoutes: [firestorePatchRoute(firestoreError(httpStatus, status))],
    });

    await expect(fb._fsSet(patchArgs(fb))).rejects.toMatchObject({ code, status: httpStatus });
  });

  it('GET 404 still resolves null', async () => {
    const fb = loadFirebaseModule();
    await setupSignedInFirebase(fb, {
      extraRoutes: [firestoreGetRoute(firestoreError(404, 'NOT_FOUND'))],
    });

    await expect(fb._fsGet()).resolves.toBeNull();
  });

  it('NOT_FOUND is only a precondition error for a PATCH', async () => {
    const fb = loadFirebaseModule();
    const res = jsonResponse(400, {});
    const body = { error: { status: 'NOT_FOUND' } };
    await expect(fb._parseFirestoreError(res, body, { op: 'get' }))
      .resolves.toEqual({ code: 'firestore', status: 400 });
    await expect(fb._parseFirestoreError(res, body, { op: 'patch' }))
      .resolves.toEqual({ code: 'not-found', status: 400 });
  });
});

describe('I4: the synchronous block after the last await', () => {
  it('a session switch during the token refresh sends no PATCH', async () => {
    const fb = loadFirebaseModule();
    const tokenGate = deferred();
    let patchCalls = 0;
    const counted = (inner) => (url, options = {}) => {
      if (options.method === 'PATCH') patchCalls += 1;
      return inner(url, options);
    };
    const { storage } = await setupSignedInFirebase(fb, {
      extraRoutes: [gatedTokenRoute(tokenGate), signInRoute('other-uid')],
      baseline: 'absent',
    });
    globalThis.fetch = counted(globalThis.fetch);
    await seedDirty(fb, storage);

    const upload = fb.syncToCloud();
    await flush();
    await fb._clearAuth();
    await fb.fbSignIn('other@example.com', 'pw');
    tokenGate.resolve(tokenResponse());

    await expect(upload).resolves.toEqual({ ok: true, skipped: true, reason: 'session-changed' });
    expect(patchCalls).toBe(0);
  });

  it('an edit during the token refresh is part of the payload', async () => {
    const fb = loadFirebaseModule();
    const tokenGate = deferred();
    const { log, patches, routes } = recordingRoutes();
    const { storage } = await setupSignedInFirebase(fb, {
      extraRoutes: [gatedTokenRoute(tokenGate), ...routes],
    });
    await seedDirty(fb, storage);

    const upload = fb.syncToCloud();
    await flush();
    await editLocally(fb, 'during-refresh');
    tokenGate.resolve(tokenResponse());

    await expect(upload).resolves.toMatchObject({ ok: true, skipped: false });
    expect(patchedItems(patches[0])).toEqual([{ id: 'local' }, { id: 'during-refresh' }]);
    expect(fb._isDirty()).toBe(false);

    // The edit's own debounce finds a clean state: no second PATCH.
    await vi.advanceTimersByTimeAsync(2000);
    await flush();
    expect(count(log, 'PATCH')).toBe(1);
  });

  it('an edit during the PATCH stays dirty and is uploaded by the follow-up', async () => {
    const fb = loadFirebaseModule();
    const patchGate = deferred();
    let first = true;
    const { log, patches, routes } = recordingRoutes({
      patch: () => {
        if (first) { first = false; return patchGate.promise; }
        return okPatch();
      },
    });
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes });
    await seedDirty(fb, storage);

    const upload = fb.syncToCloud();
    await flush();
    expect(count(log, 'PATCH')).toBe(1);
    await editLocally(fb, 'during-patch');
    patchGate.resolve(jsonResponse(200, { updateTime: PATCH_TS }));

    await expect(upload).resolves.toMatchObject({ ok: true, skipped: false });
    expect(fb._isDirty()).toBe(true);

    await vi.advanceTimersByTimeAsync(2000);
    await flush();
    expect(count(log, 'PATCH')).toBe(2);
    expect(patchedItems(patches[1])).toEqual([{ id: 'local' }, { id: 'during-patch' }]);
    expect(preconditionOf(patches[1].url)).toEqual({ updateTime: PATCH_TS });
    expect(fb._isDirty()).toBe(false);
  });
});

describe('Review Focus 4: an unpersisted baseline is never used as a precondition', () => {
  it('after the baseline write fails, the next PATCH still sends the old baseline', async () => {
    const fb = loadFirebaseModule();
    const { patches, routes } = recordingRoutes();
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes });
    await seedDirty(fb, storage);
    const local = storage.storage.local;
    const realSet = local.set;
    let failNext = true;
    local.set = async (values) => {
      if (failNext && RAW_KEY in values) {
        failNext = false;
        throw new Error('quota');
      }
      return realSet(values);
    };

    await expect(fb.syncToCloud()).rejects.toThrow('quota');
    expect(fb._getCloudBaseline().baseline).toMatchObject({ raw: SEED_UPDATE_TIME });

    await fb.syncToCloud();

    expect(patches).toHaveLength(2);
    expect(preconditionOf(patches[1].url)).toEqual({ updateTime: SEED_UPDATE_TIME });
  });
});

// Responders that answer call n with the n-th entry (the last one repeats).
function inSequence(...responders) {
  let n = 0;
  return (...args) => responders[Math.min(n++, responders.length - 1)](...args);
}

const preconditionFailed = firestoreError(400, 'FAILED_PRECONDITION');
const getDoc = (doc) => async () => jsonResponse(200, doc);
const get404 = async () => jsonResponse(404, {});

// Counts storage writes and records, at hook time, how many had happened.
function watchHookAfterWrites(storage) {
  const local = storage.storage.local;
  const realSet = local.set;
  const state = { setCalls: 0, setCallsAtHook: [], hookCalls: 0 };
  local.set = async (values) => { state.setCalls += 1; return realSet(values); };
  globalThis.onSyncConflict = () => {
    state.hookCalls += 1;
    state.setCallsAtHook.push(state.setCalls);
  };
  return state;
}

describe('§6.2 recovery pull after a failed precondition', () => {
  it('auto upload, cloud differs and local is dirty → conflict, hook last, no toast', async () => {
    const fb = loadFirebaseModule();
    globalThis.showToast = vi.fn();
    const { log, routes } = recordingRoutes({
      get: getDoc(cloudDoc(fb, [{ id: 'cloud' }])),
      patch: preconditionFailed,
    });
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes });
    await seedDirty(fb, storage);
    const hook = watchHookAfterWrites(storage);

    await expect(fb.syncToCloud()).resolves.toEqual({ ok: true, skipped: true, reason: 'conflict' });
    await flush();

    expect(log).toEqual(['PATCH', 'GET']);
    expect(fb.fbGetSyncConflict()).toMatchObject({ trigger: 'upload-precondition' });
    expect(hook.hookCalls).toBe(1);
    expect(hook.setCallsAtHook).toEqual([hook.setCalls]);
    expect(fb._isDirty()).toBe(true);
    expect(globalThis.showToast).not.toHaveBeenCalled();
  });

  it('auto upload, cloud has the same content → up-to-date, clean, baseline = recovery GET', async () => {
    const fb = loadFirebaseModule();
    const { log, routes } = recordingRoutes({
      get: getDoc(cloudDoc(fb, [{ id: 'local' }])),
      patch: preconditionFailed,
    });
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes });
    await seedDirty(fb, storage);

    await expect(fb.syncToCloud()).resolves.toEqual({ ok: true, skipped: true, reason: 'up-to-date' });

    expect(log).toEqual(['PATCH', 'GET']);
    expect(fb._isDirty()).toBe(false);
    expect(fb.fbGetSyncConflict()).toBeNull();
    expect(fb._getCloudBaseline().baseline).toMatchObject({ kind: 'known', raw: CLOUD_TS });
    expect(storage._data[RAW_KEY]).toBe(CLOUD_TS);
  });

  it('recovery GET 404 → Absent baseline persisted, retry PATCH with exists=false, then clean', async () => {
    const fb = loadFirebaseModule();
    let storage;
    const atRetry = {};
    const { log, patches, routes } = recordingRoutes({
      get: get404,
      patch: inSequence(preconditionFailed, async () => {
        atRetry.raw = storage._data[RAW_KEY];
        atRetry.uid = storage._data._fb_sync_baseline_uid;
        return okPatch();
      }),
    });
    ({ storage } = await setupSignedInFirebase(fb, { extraRoutes: routes }));
    await seedDirty(fb, storage);

    await expect(fb.syncToCloud()).resolves.toMatchObject({ ok: true, skipped: false });

    expect(log).toEqual(['PATCH', 'GET', 'PATCH']);
    expect(atRetry).toEqual({ raw: 'absent', uid: TEST_UID });
    expect(preconditionOf(patches[1].url)).toEqual({ exists: 'false' });
    expect(patchedItems(patches[1])).toEqual([{ id: 'local' }]);
    expect(fb._isDirty()).toBe(false);
    expect(fb._getCloudBaseline().baseline).toMatchObject({ kind: 'known', raw: PATCH_TS });
  });

  it('recovery GET empty document → retry PATCH with that document\'s raw updateTime', async () => {
    const fb = loadFirebaseModule();
    const { log, patches, routes } = recordingRoutes({
      get: getDoc({ updateTime: EMPTY_TS }),
      patch: inSequence(preconditionFailed, okPatch),
    });
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes });
    await seedDirty(fb, storage);

    await expect(fb.syncToCloud()).resolves.toMatchObject({ ok: true, skipped: false });

    expect(log).toEqual(['PATCH', 'GET', 'PATCH']);
    expect(preconditionOf(patches[1].url)).toEqual({ updateTime: EMPTY_TS });
    expect(fb._isDirty()).toBe(false);
  });

  it.each([
    ['409 ALREADY_EXISTS on an Absent baseline', 'absent', firestoreError(409, 'ALREADY_EXISTS')],
    ['404 NOT_FOUND on a Known baseline', SEED_UPDATE_TIME, firestoreError(404, 'NOT_FOUND')],
  ])('%s also goes through the recovery pull', async (_name, baseline, firstPatch) => {
    const fb = loadFirebaseModule();
    const { log, routes } = recordingRoutes({
      get: getDoc(cloudDoc(fb, [{ id: 'local' }])),
      patch: firstPatch,
    });
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes, baseline });
    await seedDirty(fb, storage);

    await expect(fb.syncToCloud()).resolves.toEqual({ ok: true, skipped: true, reason: 'up-to-date' });

    expect(log).toEqual(['PATCH', 'GET']);
    expect(fb._getCloudBaseline().baseline).toMatchObject({ kind: 'known', raw: CLOUD_TS });
  });

  it('manual upload with a clean local state still compares: different → conflict', async () => {
    const fb = loadFirebaseModule();
    const { log, routes } = recordingRoutes({
      get: getDoc(cloudDoc(fb, [{ id: 'cloud' }])),
      patch: preconditionFailed,
    });
    await setupSignedInFirebase(fb, { extraRoutes: routes });
    globalThis.items = [{ id: 'local' }];
    expect(fb._isDirty()).toBe(false);

    await expect(fb.syncToCloud({ force: true }))
      .resolves.toEqual({ ok: true, skipped: true, reason: 'conflict' });

    expect(log).toEqual(['PATCH', 'GET']);
    expect(fb.fbGetSyncConflict()).not.toBeNull();
    expect(globalThis.items).toEqual([{ id: 'local' }]); // nothing landed
  });

  it('manual upload with a clean local state and the same content → up-to-date', async () => {
    const fb = loadFirebaseModule();
    const { log, routes } = recordingRoutes({
      get: getDoc(cloudDoc(fb, [{ id: 'local' }])),
      patch: preconditionFailed,
    });
    await setupSignedInFirebase(fb, { extraRoutes: routes });
    globalThis.items = [{ id: 'local' }];

    await expect(fb.syncToCloud({ force: true }))
      .resolves.toEqual({ ok: true, skipped: true, reason: 'up-to-date' });

    expect(log).toEqual(['PATCH', 'GET']);
    expect(fb.fbGetSyncConflict()).toBeNull();
    expect(fb._getCloudBaseline().baseline).toMatchObject({ raw: CLOUD_TS });
  });

  it('cloud-empty imports even when the local state is clean (manual upload)', async () => {
    const fb = loadFirebaseModule();
    const { log, patches, routes } = recordingRoutes({
      get: get404,
      patch: inSequence(preconditionFailed, okPatch),
    });
    await setupSignedInFirebase(fb, { extraRoutes: routes });
    globalThis.items = [{ id: 'local' }];
    expect(fb._isDirty()).toBe(false);

    await expect(fb.syncToCloud({ force: true })).resolves.toMatchObject({ ok: true, skipped: false });

    expect(log).toEqual(['PATCH', 'GET', 'PATCH']);
    expect(preconditionOf(patches[1].url)).toEqual({ exists: 'false' });
    expect(patchedItems(patches[1])).toEqual([{ id: 'local' }]);
  });
  it('a session change during the rejected PATCH skips the recovery pull', async () => {
    const fb = loadFirebaseModule();
    const { log, routes } = recordingRoutes({
      get: get404,
      patch: async () => { await fb._clearAuth(); return preconditionFailed(); },
    });
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes });
    await seedDirty(fb, storage);

    await expect(fb.syncToCloud())
      .resolves.toEqual({ ok: true, skipped: true, reason: 'session-changed' });
    expect(log).toEqual(['PATCH']);
  });
});

describe('§7.5 round limits within one hold', () => {
  it('worst path: baseline GET, PATCH, recovery GET, retry PATCH → retry-exhausted', async () => {
    const fb = loadFirebaseModule();
    const EMPTY_TS_2 = '2024-06-02T13:00:00.111111Z';
    const { log, patches, routes } = recordingRoutes({
      get: inSequence(getDoc({ updateTime: EMPTY_TS }), getDoc({ updateTime: EMPTY_TS_2 })),
      patch: preconditionFailed,
    });
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes, baseline: null });
    await seedDirty(fb, storage);

    await expect(fb.syncToCloud())
      .resolves.toEqual({ ok: true, skipped: true, reason: 'retry-exhausted' });

    expect(log).toEqual(['GET', 'PATCH', 'GET', 'PATCH']);
    expect(preconditionOf(patches[0].url)).toEqual({ updateTime: EMPTY_TS });
    expect(preconditionOf(patches[1].url)).toEqual({ updateTime: EMPTY_TS_2 });
    expect(fb._isDirty()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('failure → recovery → retry completes within one hold (no self-wait)', async () => {
    const fb = loadFirebaseModule();
    const { log, routes } = recordingRoutes({
      get: get404,
      patch: inSequence(preconditionFailed, okPatch),
    });
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes });
    await seedDirty(fb, storage);

    const raced = Promise.race([
      fb.syncToCloud(),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 1000)),
    ]);
    await vi.advanceTimersByTimeAsync(1000);

    await expect(raced).resolves.toMatchObject({ ok: true, skipped: false });
    expect(log).toEqual(['PATCH', 'GET', 'PATCH']);
  });

  it('a manual pull queued during the recovery GET runs only after the upload task', async () => {
    const fb = loadFirebaseModule();
    const recoveryGate = deferred();
    const { log, routes } = recordingRoutes({
      get: inSequence(() => recoveryGate.promise, getDoc(cloudDoc(fb, [{ id: 'local' }], PATCH_TS))),
      patch: inSequence(preconditionFailed, okPatch),
    });
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes });
    await seedDirty(fb, storage);

    const upload = fb.syncToCloud();
    await flush();
    expect(log).toEqual(['PATCH', 'GET']);

    const pull = fb.syncFromCloud({ mode: 'forced' });
    await flush();
    expect(log).toEqual(['PATCH', 'GET']);

    recoveryGate.resolve(jsonResponse(404, {}));
    await expect(upload).resolves.toMatchObject({ ok: true, skipped: false });
    await expect(pull).resolves.toBe(true);
    expect(log).toEqual(['PATCH', 'GET', 'PATCH', 'GET']);
  });

  it('precondition errors from scheduled uploads never toast', async () => {
    const fb = loadFirebaseModule();
    globalThis.showToast = vi.fn();
    const EMPTY_TS_2 = '2024-06-02T13:00:00.111111Z';
    const { log, routes } = recordingRoutes({
      get: inSequence(
        getDoc(cloudDoc(fb, [{ id: 'cloud' }])), // path 1: conflict
        getDoc({ updateTime: EMPTY_TS }), // path 7: baseline pull
        getDoc({ updateTime: EMPTY_TS_2 }), // path 7: recovery pull
      ),
      patch: preconditionFailed,
    });
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes });
    await seedDirty(fb, storage);

    fb.scheduleSyncToCloud();
    await vi.advanceTimersByTimeAsync(2000);
    await flush();
    expect(log).toEqual(['PATCH', 'GET']);
    expect(fb.fbGetSyncConflict()).not.toBeNull();

    // Path 7 from a fresh session state: Unknown baseline, no pending conflict.
    fb._resetSession();
    fb.scheduleSyncToCloud();
    await vi.advanceTimersByTimeAsync(2000);
    await flush();
    expect(log).toEqual(['PATCH', 'GET', 'GET', 'PATCH', 'GET', 'PATCH']);
    expect(fb._isDirty()).toBe(true);
    expect(globalThis.showToast).not.toHaveBeenCalled();
  });
});
