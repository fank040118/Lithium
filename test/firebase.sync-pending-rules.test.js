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

// Spec §7.3 "pull-class tasks while a conflict is pending", §5.1 choose-local /
// choose-cloud as executor tasks, §6.2 / §6.4 choose-local failures, §10.2
// _pullAfterSignIn by reason.

const RAW_KEY = '_fb_cloud_update_time';
const MS_KEY = '_fb_cloud_sync_ts';
const CLOUD_V1 = '2024-06-02T00:00:00.000000Z';
const CLOUD_V2 = '2024-06-04T00:00:00.000000Z';
const EMPTY_TS = '2024-06-05T00:00:00.000000Z';
const PATCH_TS = '2024-06-03T00:00:00.000000Z';
const OTHER_TAB_TS = '2024-05-01T00:00:00.000000Z';
const OTHER_TAB_MS = Date.parse('2024-05-01T00:00:00Z');

const LOCAL_ITEMS = [{ id: 'local' }];
const CLOUD_ITEMS = [{ id: 'cloud' }];

function cloudDoc(fb, items, updateTime = CLOUD_V1) {
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

const okPatch = async () => jsonResponse(200, { updateTime: PATCH_TS });
const getDoc = (doc) => async () => jsonResponse(200, doc);
const get404 = async () => jsonResponse(404, {});
const getEmptyDoc = async () => jsonResponse(200, { updateTime: EMPTY_TS });
const preconditionFailed = async () =>
  jsonResponse(400, { error: { status: 'FAILED_PRECONDITION', message: 'FAILED_PRECONDITION' } });

// GET and PATCH answer through replaceable responders; every request is logged.
function network() {
  const net = { get: get404, patch: okPatch, log: [], patches: [] };
  net.routes = [
    firestoreGetRoute(() => { net.log.push('GET'); return net.get(); }),
    firestorePatchRoute((url, options) => {
      net.log.push('PATCH');
      net.patches.push({ url, pre: preconditionOf(url), body: JSON.parse(options.body) });
      return net.patch(url, options);
    }),
  ];
  return net;
}

async function flush() {
  for (let i = 0; i < 20; i += 1) await vi.advanceTimersByTimeAsync(0);
}

async function seedDirty(fb, storage, items = LOCAL_ITEMS) {
  globalThis.items = items;
  storage._data._fb_edit_rev = 3;
  storage._data._fb_synced_rev = 2;
  await fb._loadRevState();
}

async function markClean(fb, storage) {
  storage._data._fb_synced_rev = storage._data._fb_edit_rev;
  await fb._loadRevState();
}

// Signed in, dirty local state, and a pending conflict against CLOUD_V1.
async function setupConflict(fb, { baseline } = {}) {
  const net = network();
  const opts = { extraRoutes: net.routes };
  if (baseline !== undefined) opts.baseline = baseline;
  const { storage } = await setupSignedInFirebase(fb, opts);
  await seedDirty(fb, storage);
  net.get = getDoc(cloudDoc(fb, CLOUD_ITEMS, CLOUD_V1));
  await fb.syncFromCloud({ mode: 'forced' });
  expect(fb.fbGetSyncConflict()).toMatchObject({ cloudState: 'doc', cloudRaw: CLOUD_V1 });
  net.log.length = 0;
  return { net, storage };
}

// The open conflict dialog, so its closing can be observed.
function mountOpenDialog() {
  const overlay = document.createElement('div');
  overlay.id = 'sync-conflict-overlay';
  document.body.appendChild(overlay);
  return overlay;
}

// The four pull kinds of §7.3. Baseline and recovery pulls are internal pulls
// of an upload task; run them as their own task so the rule is observed alone.
function runPull(fb, kind) {
  if (kind === 'auto' || kind === 'fast-path') return fb._runPullTask();
  if (kind === 'forced') return fb._runPullTask({ mode: 'forced', trigger: 'manual-pull' });
  const trigger = kind === 'baseline' ? 'baseline' : 'upload-precondition';
  return fb._enqueueSync({
    kind: 'pull',
    auto: false,
    run: (ctx) => fb._pullCore(ctx, { mode: 'forced', trigger, compareWhenClean: true }),
  });
}

const PULL_KINDS = ['auto', 'forced', 'baseline', 'recovery', 'fast-path'];

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
  delete globalThis.markStorageLoadRecovered;
  document.body.innerHTML = '';
});

describe('pulls while a conflict is pending (§7.3)', () => {
  describe.each(PULL_KINDS)('%s pull', (kind) => {
    // fast-path: the baseline equals the GET time in nanoseconds (§4).
    const baseline = kind === 'fast-path' ? CLOUD_V1 : undefined;
    const nextRaw = kind === 'fast-path' ? CLOUD_V1 : CLOUD_V2;

    it.each([['dirty', false], ['clean', true]])(
      'different content (%s local) → nothing lands, baseline kept, pending raw updated, hook fired',
      async (_label, clean) => {
        const fb = loadFirebaseModule();
        const { net, storage } = await setupConflict(fb, { baseline });
        if (clean) await markClean(fb, storage);
        const before = fb._getCloudBaseline();
        const hook = vi.fn();
        globalThis.onSyncConflict = hook;
        globalThis.render = vi.fn();
        net.get = getDoc(cloudDoc(fb, [{ id: 'cloud' }, { id: 'cloud-2' }], nextRaw));

        const r = await runPull(fb, kind);

        expect(r).toMatchObject({ applied: false, outcome: 'conflict' });
        expect(globalThis.render).not.toHaveBeenCalled();
        expect(globalThis.items).toEqual(LOCAL_ITEMS);
        expect(fb._getCloudBaseline()).toEqual(before);
        expect(storage._data[RAW_KEY]).toBe(baseline ?? SEED_UPDATE_TIME);
        expect(fb._isDirty()).toBe(!clean);
        expect(fb.fbGetSyncConflict()).toMatchObject({
          cloudState: 'doc', cloudRaw: nextRaw, cloudShortcutCount: 2, isAccountSwitch: false,
        });
        expect(hook).toHaveBeenCalledTimes(1);
        expect(net.log).toEqual(['GET']);
      },
    );

    it('same content → pending cleared, clean, baseline = GET raw, dialog closed', async () => {
      const fb = loadFirebaseModule();
      const { net, storage } = await setupConflict(fb, { baseline });
      const overlay = mountOpenDialog();
      net.get = getDoc(cloudDoc(fb, LOCAL_ITEMS, nextRaw));

      const r = await runPull(fb, kind);

      expect(r).toMatchObject({ applied: true, outcome: 'applied' });
      expect(fb.fbGetSyncConflict()).toBeNull();
      expect(fb._isDirty()).toBe(false);
      expect(fb._getCloudBaseline().baseline).toMatchObject({ kind: 'known', raw: nextRaw });
      expect(storage._data[RAW_KEY]).toBe(nextRaw);
      expect(overlay.classList.contains('hidden')).toBe(true);
    });
  });

  it('an edit during the same-content landing stays dirty (revAtApply)', async () => {
    const fb = loadFirebaseModule();
    const { net, storage } = await setupConflict(fb);
    net.get = getDoc(cloudDoc(fb, LOCAL_ITEMS, CLOUD_V2));
    const realSet = storage.storage.local.set;
    let edited = false;
    storage.storage.local.set = async (obj) => {
      if (!edited && 'startpage_items' in obj) {
        edited = true;
        await fb.markLocalCloudDataChanged();
      }
      return realSet(obj);
    };

    await fb.syncFromCloud({ mode: 'forced' });

    expect(fb.fbGetSyncConflict()).toBeNull();
    expect(fb._isDirty()).toBe(true);
  });
});

describe('cloud absent while a conflict is pending', () => {
  it('GET 404 → cloud-absent not-found; choose-local then PATCHes exists=false and clears the pending', async () => {
    const fb = loadFirebaseModule();
    const { net, storage } = await setupConflict(fb);
    const hook = vi.fn();
    globalThis.onSyncConflict = hook;
    net.get = get404;

    await expect(fb.syncFromCloud()).resolves.toBe(false);
    expect(fb.fbGetSyncConflict()).toMatchObject({
      cloudState: 'not-found', cloudRaw: null, cloudShortcutCount: 0, cloudFolderCount: 0,
    });
    expect(hook).toHaveBeenCalledTimes(1);
    expect(storage._data[RAW_KEY]).toBe(SEED_UPDATE_TIME); // baseline untouched
    expect(fb._isDirty()).toBe(true);

    await expect(fb.fbResolveSyncConflict('local')).resolves.toEqual({ ok: true });
    expect(net.patches).toHaveLength(1);
    expect(net.patches[0].pre).toEqual({ exists: 'false' });
    expect(fb.fbGetSyncConflict()).toBeNull();
    expect(storage._data[RAW_KEY]).toBe(PATCH_TS);
  });

  it('empty document → cloud-absent empty; choose-local then PATCHes with that document raw string', async () => {
    const fb = loadFirebaseModule();
    const { net } = await setupConflict(fb);
    net.get = getEmptyDoc;

    await fb.syncFromCloud({ mode: 'forced' });
    expect(fb.fbGetSyncConflict()).toMatchObject({ cloudState: 'empty', cloudRaw: EMPTY_TS });

    await expect(fb.fbResolveSyncConflict('local')).resolves.toEqual({ ok: true });
    expect(net.patches).toHaveLength(1);
    expect(net.patches[0].pre).toEqual({ updateTime: EMPTY_TS });
    expect(fb.fbGetSyncConflict()).toBeNull();
  });

  it('after a 404 marking, choose-cloud takes the cloud-empty import path', async () => {
    const fb = loadFirebaseModule();
    const { net } = await setupConflict(fb);
    net.get = get404;
    await fb.syncFromCloud();
    expect(fb.fbGetSyncConflict()).toMatchObject({ cloudState: 'not-found' });

    await expect(fb.fbResolveSyncConflict('cloud')).resolves.toEqual({ ok: true, code: 'no-cloud-data' });
    expect(net.patches).toHaveLength(1);
    expect(net.patches[0].pre).toEqual({ exists: 'false' });
    expect(fb.fbGetSyncConflict()).toBeNull();
  });
});

describe('choose-local as an executor task', () => {
  it('a pull queued ahead updates the pending to v2 → choose-local returns cloud-changed, 0 PATCH', async () => {
    const fb = loadFirebaseModule();
    const { net } = await setupConflict(fb);
    const gate = deferred();
    net.get = () => gate.promise;

    const pull = fb.syncFromCloud({ mode: 'forced' });
    await flush();
    const resolve = fb.fbResolveSyncConflict('local');
    gate.resolve(jsonResponse(200, cloudDoc(fb, [{ id: 'cloud-v2' }], CLOUD_V2)));
    await pull;

    await expect(resolve).resolves.toEqual({ ok: false, code: 'cloud-changed' });
    expect(net.patches).toHaveLength(0);
    expect(fb.fbGetSyncConflict()).toMatchObject({ cloudRaw: CLOUD_V2 });
  });

  it('pending gone by dequeue → choose-local and choose-cloud both return no-conflict', async () => {
    const fb = loadFirebaseModule();
    const { net } = await setupConflict(fb);
    const gate = deferred();
    net.get = () => gate.promise;

    const pull = fb.syncFromCloud({ mode: 'forced' });
    await flush();
    const local = fb.fbResolveSyncConflict('local');
    const cloud = fb.fbResolveSyncConflict('cloud');
    gate.resolve(jsonResponse(200, cloudDoc(fb, LOCAL_ITEMS, CLOUD_V2)));
    await pull;

    await expect(local).resolves.toEqual({ ok: false, code: 'no-conflict' });
    await expect(cloud).resolves.toEqual({ ok: false, code: 'no-conflict' });
    expect(net.log).toEqual(['GET']);
  });

  it('isAccountSwitch conflict → choose-local PATCHes (not stopped by switch-pending)', async () => {
    const fb = loadFirebaseModule();
    const net = network();
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: net.routes });
    storage._data._fb_sync_baseline_uid = 'account-a';
    await fb._loadAuth();
    await seedDirty(fb, storage);
    net.get = getDoc(cloudDoc(fb, CLOUD_ITEMS, CLOUD_V1));
    await fb._pullAfterSignIn({ trigger: 'sign-in' });
    expect(fb.fbGetSyncConflict()).toMatchObject({ isAccountSwitch: true });

    await expect(fb.fbResolveSyncConflict('local')).resolves.toEqual({ ok: true });
    expect(net.patches).toHaveLength(1);
    expect(net.patches[0].pre).toEqual({ updateTime: CLOUD_V1 });
    expect(storage._data._fb_sync_baseline_uid).toBe(TEST_UID);
  });

  it('another tab signed out → baseline-cleared, 0 fetch, keys not written back', async () => {
    const fb = loadFirebaseModule();
    const { storage } = await setupConflict(fb);
    delete storage._data._fb_refresh;
    delete storage._data[RAW_KEY];
    delete storage._data[MS_KEY];
    const fetchSpy = vi.fn(globalThis.fetch);
    globalThis.fetch = fetchSpy;

    await expect(fb.fbResolveSyncConflict('local')).resolves.toEqual({ ok: false, code: 'baseline-cleared' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect('_fb_refresh' in storage._data).toBe(false);
    expect(RAW_KEY in storage._data).toBe(false);
    expect(MS_KEY in storage._data).toBe(false);
    expect(fb.fbGetSyncConflict()).not.toBeNull();
  });

  it('baseline keys cleared with the auth key intact → baseline-cleared, 0 fetch, keys not written back', async () => {
    const fb = loadFirebaseModule();
    const { storage } = await setupConflict(fb);
    delete storage._data[RAW_KEY];
    delete storage._data[MS_KEY];
    const fetchSpy = vi.fn(globalThis.fetch);
    globalThis.fetch = fetchSpy;

    await expect(fb.fbResolveSyncConflict('local')).resolves.toEqual({ ok: false, code: 'baseline-cleared' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(RAW_KEY in storage._data).toBe(false);
    expect(MS_KEY in storage._data).toBe(false);
  });

  it('uses the raw string captured at enqueue and is exempt from a differing stored baseline', async () => {
    const fb = loadFirebaseModule();
    const { net, storage } = await setupConflict(fb);
    // Another tab uploaded: storage disagrees with memory.
    storage._data[RAW_KEY] = OTHER_TAB_TS;
    storage._data[MS_KEY] = OTHER_TAB_MS;

    await expect(fb.fbResolveSyncConflict('local')).resolves.toEqual({ ok: true });
    expect(net.log).toEqual(['PATCH']);
    expect(net.patches[0].pre).toEqual({ updateTime: CLOUD_V1 });
  });

  describe('precondition failure → recovery pull under the pending rules', () => {
    it('recovery GET differs → cloud-changed, pending counts updated', async () => {
      const fb = loadFirebaseModule();
      const { net } = await setupConflict(fb);
      net.patch = preconditionFailed;
      net.get = getDoc(cloudDoc(fb, [{ id: 'a' }, { id: 'b' }, { id: 'c' }], CLOUD_V2));

      await expect(fb.fbResolveSyncConflict('local')).resolves.toEqual({ ok: false, code: 'cloud-changed' });
      expect(net.log).toEqual(['PATCH', 'GET']);
      expect(fb.fbGetSyncConflict()).toMatchObject({ cloudRaw: CLOUD_V2, cloudShortcutCount: 3 });
      expect(fb._isDirty()).toBe(true);
    });

    it('recovery GET has the same content → {ok:true}, pending cleared', async () => {
      const fb = loadFirebaseModule();
      const { net } = await setupConflict(fb);
      net.patch = preconditionFailed;
      net.get = getDoc(cloudDoc(fb, LOCAL_ITEMS, CLOUD_V2));

      await expect(fb.fbResolveSyncConflict('local')).resolves.toEqual({ ok: true });
      expect(net.log).toEqual(['PATCH', 'GET']);
      expect(fb.fbGetSyncConflict()).toBeNull();
      expect(fb._isDirty()).toBe(false);
      expect(fb._getCloudBaseline().baseline).toMatchObject({ kind: 'known', raw: CLOUD_V2 });
    });

    it('recovery GET 404 → import in the same hold → {ok:true}', async () => {
      const fb = loadFirebaseModule();
      const { net } = await setupConflict(fb);
      let patches = 0;
      net.patch = async (...args) => {
        patches += 1;
        return patches === 1 ? preconditionFailed() : okPatch(...args);
      };
      net.get = get404;

      await expect(fb.fbResolveSyncConflict('local')).resolves.toEqual({ ok: true });
      expect(net.log).toEqual(['PATCH', 'GET', 'PATCH']);
      expect(net.patches[0].pre).toEqual({ updateTime: CLOUD_V1 });
      expect(net.patches[1].pre).toEqual({ exists: 'false' });
      expect(fb.fbGetSyncConflict()).toBeNull();
    });

    it('recovery GET 404 and the import fails → the pending stays (cleared only after a successful import)', async () => {
      const fb = loadFirebaseModule();
      const { net } = await setupConflict(fb);
      let patches = 0;
      net.patch = async () => {
        patches += 1;
        return patches === 1 ? preconditionFailed() : jsonResponse(429, {});
      };
      net.get = get404;

      await expect(fb.fbResolveSyncConflict('local')).resolves.toEqual({ ok: false, code: 'quota' });
      expect(fb.fbGetSyncConflict()).toMatchObject({ cloudState: 'not-found' });
    });
  });

  it('retry-exhausted → the pending stays', async () => {
    const fb = loadFirebaseModule();
    const { net } = await setupConflict(fb);
    net.patch = preconditionFailed;
    net.get = get404;

    await expect(fb.fbResolveSyncConflict('local')).resolves.toEqual({ ok: false, code: 'retry-exhausted' });
    expect(net.log).toEqual(['PATCH', 'GET', 'PATCH']);
    expect(fb.fbGetSyncConflict()).not.toBeNull();
    expect(fb._isDirty()).toBe(true);
  });

  it('network failure → {ok:false, code:network}, pending kept', async () => {
    const fb = loadFirebaseModule();
    const { net } = await setupConflict(fb);
    net.patch = async () => { throw new Error('offline'); };

    await expect(fb.fbResolveSyncConflict('local')).resolves.toEqual({ ok: false, code: 'network' });
    expect(fb.fbGetSyncConflict()).not.toBeNull();
    expect(fb._isDirty()).toBe(true);
  });

  it('payload-too-large → {ok:false, code:payload-too-large}, pending kept, no PATCH', async () => {
    const fb = loadFirebaseModule();
    const { net } = await setupConflict(fb);
    globalThis.items = [{ id: 'big', name: 'x'.repeat(100000) }];

    await expect(fb.fbResolveSyncConflict('local')).resolves.toEqual({ ok: false, code: 'payload-too-large' });
    expect(net.patches).toHaveLength(0);
    expect(fb.fbGetSyncConflict()).not.toBeNull();
  });

  it('two concurrent choose-local calls → exactly one PATCH, the second gets no-conflict', async () => {
    const fb = loadFirebaseModule();
    const { net } = await setupConflict(fb);

    const [a, b] = await Promise.all([
      fb.fbResolveSyncConflict('local'),
      fb.fbResolveSyncConflict('local'),
    ]);

    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: false, code: 'no-conflict' });
    expect(net.patches).toHaveLength(1);
  });
});

describe('choose-cloud as an executor task', () => {
  it.each([['404', get404, { exists: 'false' }], ['empty document', getEmptyDoc, { updateTime: EMPTY_TS }]])(
    'cloud %s → import in the same hold → {ok:true, code:no-cloud-data}',
    async (_label, get, pre) => {
      const fb = loadFirebaseModule();
      const { net, storage } = await setupConflict(fb);
      net.get = get;

      await expect(fb.fbResolveSyncConflict('cloud')).resolves.toEqual({ ok: true, code: 'no-cloud-data' });
      // The PATCH went out before the resolution returned (no debounce timer).
      expect(net.log).toEqual(['GET', 'PATCH']);
      expect(net.patches[0].pre).toEqual(pre);
      expect(fb.fbGetSyncConflict()).toBeNull();
      expect(storage._data[RAW_KEY]).toBe(PATCH_TS);
      expect(fb._isDirty()).toBe(false);
    },
  );

  it('import fails with 429 → {ok:false, code:quota}, pending already cleared', async () => {
    const fb = loadFirebaseModule();
    const { net } = await setupConflict(fb);
    net.get = get404;
    net.patch = async () => jsonResponse(429, {});

    await expect(fb.fbResolveSyncConflict('cloud')).resolves.toEqual({ ok: false, code: 'quota' });
    expect(fb.fbGetSyncConflict()).toBeNull();
    expect(fb._isDirty()).toBe(true);
  });

  it('import blocked by the storage firewall → storage-read-only, 0 PATCH, local still dirty', async () => {
    const fb = loadFirebaseModule();
    const { net } = await setupConflict(fb);
    net.get = get404;
    globalThis.isStorageLoadFailed = () => true;

    await expect(fb.fbResolveSyncConflict('cloud')).resolves.toEqual({ ok: false, code: 'storage-read-only' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(net.patches).toHaveLength(0);
    expect(fb.fbGetSyncConflict()).toBeNull();
    expect(fb._isDirty()).toBe(true);
  });

  it('landing is not limited by the storage firewall and lifts it', async () => {
    const fb = loadFirebaseModule();
    const { net } = await setupConflict(fb);
    globalThis.isStorageLoadFailed = () => true;
    globalThis.markStorageLoadRecovered = vi.fn();
    net.get = getDoc(cloudDoc(fb, CLOUD_ITEMS, CLOUD_V2));

    await expect(fb.fbResolveSyncConflict('cloud')).resolves.toEqual({ ok: true });
    expect(globalThis.items).toEqual(CLOUD_ITEMS);
    expect(globalThis.markStorageLoadRecovered).toHaveBeenCalled();
    expect(fb._isDirty()).toBe(false);
  });
});

describe('no self-wait: resolutions never call the public entry points', () => {
  it('choose-cloud (with import) and choose-local never call syncFromCloud / syncToCloud', async () => {
    const fb = loadFirebaseModule();
    const { net } = await setupConflict(fb);
    // Classic script: internal calls resolve these through the global object.
    globalThis.syncFromCloud = vi.fn();
    globalThis.syncToCloud = vi.fn();
    try {
      net.get = get404;
      await expect(fb.fbResolveSyncConflict('cloud')).resolves.toEqual({ ok: true, code: 'no-cloud-data' });

      // A fresh conflict for choose-local.
      await fb.markLocalCloudDataChanged();
      vi.clearAllTimers();
      net.get = getDoc(cloudDoc(fb, CLOUD_ITEMS, CLOUD_V2));
      await fb._runPullTask({ mode: 'forced' });
      expect(fb.fbGetSyncConflict()).not.toBeNull();
      await expect(fb.fbResolveSyncConflict('local')).resolves.toEqual({ ok: true });

      expect(globalThis.syncFromCloud).not.toHaveBeenCalled();
      expect(globalThis.syncToCloud).not.toHaveBeenCalled();
    } finally {
      delete globalThis.syncFromCloud;
      delete globalThis.syncToCloud;
    }
  });
});

describe('_pullAfterSignIn decides by the pull reason (§10.2)', () => {
  it('session changed during the GET → no upload queued', async () => {
    const fb = loadFirebaseModule();
    const net = network();
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: net.routes });
    await seedDirty(fb, storage);
    const gate = deferred();
    net.get = () => gate.promise;

    const p = fb._pullAfterSignIn();
    await flush();
    fb._resetSession();
    gate.resolve(jsonResponse(404, {}));
    await p;
    await flush();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('blocked by the storage check → no upload queued', async () => {
    const fb = loadFirebaseModule();
    const net = network();
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: net.routes });
    await seedDirty(fb, storage);
    storage.storage.local.get = async () => { throw new Error('storage read failed'); };

    await fb._pullAfterSignIn();
    await flush();

    expect(vi.getTimerCount()).toBe(0);
    expect(net.log).toEqual([]);
  });

  it('cloud empty → an upload is queued', async () => {
    const fb = loadFirebaseModule();
    const net = network();
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: net.routes });
    await seedDirty(fb, storage);
    net.get = get404;

    await fb._pullAfterSignIn();
    await flush();

    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(net.patches).toHaveLength(1);
  });

  it('conflict → no upload queued', async () => {
    const fb = loadFirebaseModule();
    const net = network();
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: net.routes });
    await seedDirty(fb, storage);
    net.get = getDoc(cloudDoc(fb, CLOUD_ITEMS, CLOUD_V1));

    await fb._pullAfterSignIn();
    await flush();

    expect(fb.fbGetSyncConflict()).not.toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('queue interactions (§10.1-7, §10.1-8)', () => {
  it('a manual upload queued behind a conflict-ending pull → 0 PATCH, hook re-fired with manual-upload', async () => {
    const fb = loadFirebaseModule();
    const net = network();
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: net.routes });
    await seedDirty(fb, storage);
    const hook = vi.fn();
    globalThis.onSyncConflict = hook;
    const gate = deferred();
    net.get = () => gate.promise;

    const pull = fb.syncFromCloud({ mode: 'forced', trigger: 'manual-pull' });
    await flush();
    const upload = fb.syncToCloud({ force: true });
    gate.resolve(jsonResponse(200, cloudDoc(fb, CLOUD_ITEMS, CLOUD_V1)));

    await expect(pull).resolves.toBe(false);
    await expect(upload).resolves.toEqual({ ok: true, skipped: true, reason: 'conflict-pending' });
    expect(net.patches).toHaveLength(0);
    expect(hook).toHaveBeenCalledTimes(2);
    expect(hook.mock.calls[0][0]).toMatchObject({ trigger: 'manual-pull' });
    expect(hook.mock.calls[1][0]).toMatchObject({ trigger: 'manual-upload' });
    // The re-surfacing label is the hook's only; the pending keeps its own.
    expect(fb.fbGetSyncConflict().trigger).toBe('manual-pull');
  });

  it("an upload task's recovery pull and choose-cloud never land concurrently", async () => {
    const fb = loadFirebaseModule();
    const { net } = await setupConflict(fb);
    const gate = deferred();
    const events = [];
    net.patch = preconditionFailed;
    let gets = 0;
    net.get = () => {
      gets += 1;
      events.push(`GET${gets}`);
      if (gets === 1) return gate.promise; // choose-local's recovery GET
      return jsonResponse(200, cloudDoc(fb, CLOUD_ITEMS, CLOUD_V2));
    };

    const local = fb.fbResolveSyncConflict('local').then((r) => { events.push('local-settled'); return r; });
    await flush();
    expect(gets).toBe(1);
    const cloud = fb.fbResolveSyncConflict('cloud');
    await flush();
    expect(gets).toBe(1); // choose-cloud waits behind the running task

    gate.resolve(jsonResponse(200, cloudDoc(fb, [{ id: 'v2' }], CLOUD_V2)));
    await expect(local).resolves.toEqual({ ok: false, code: 'cloud-changed' });
    await expect(cloud).resolves.toEqual({ ok: true });
    expect(events).toEqual(['GET1', 'local-settled', 'GET2']);
    expect(globalThis.items).toEqual(CLOUD_ITEMS);
    expect(fb.fbGetSyncConflict()).toBeNull();
  });
});
