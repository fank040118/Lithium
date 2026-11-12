import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadFirebaseModule } from './helpers/loadFirebaseModule.js';
import { jsonResponse } from './helpers/mockFetch.js';
import {
  setupSignedInFirebase,
  firestoreGetRoute,
  firestorePatchRoute,
  preconditionOf,
  SEED_UPDATE_TIME,
} from './helpers/setupSignedInFirebase.js';

// Spec §6.3 (an upload whose outcome is unknown), §7.3 (an in-flight snapshot
// hit while a conflict is pending counts as "same content"), §10.1-9/12/14.

const RAW_KEY = '_fb_cloud_update_time';
const CLOUD_V1 = '2024-06-02T00:00:00.000000Z';
const CLOUD_V2 = '2024-06-04T00:00:00.000000Z';
const PATCH_TS = '2024-06-03T00:00:00.000000Z';
const TIMEOUT_MS = 20000;

const LOCAL_ITEMS = [{ id: 'local' }];
const CLOUD_ITEMS = [{ id: 'cloud' }];

function cloudDoc(fb, items, updateTime) {
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
const networkFail = async () => { throw new TypeError('Failed to fetch'); };
const hang = () => new Promise(() => {});
const getDoc = (doc) => async () => jsonResponse(200, doc);
const preconditionFailed = async () =>
  jsonResponse(400, { error: { status: 'FAILED_PRECONDITION', message: 'FAILED_PRECONDITION' } });

// GET and PATCH answer through replaceable responders; every request is logged.
function network() {
  const net = { get: async () => jsonResponse(404, {}), patch: okPatch, log: [], patches: [] };
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

// The cloud document as it would be if the PATCH `p` had actually landed.
const landedDoc = (p, updateTime = CLOUD_V2) => ({ updateTime, fields: p.body.fields });

async function flush() {
  for (let i = 0; i < 20; i += 1) await vi.advanceTimersByTimeAsync(0);
}

async function seedDirty(fb, storage, items = LOCAL_ITEMS) {
  globalThis.items = items;
  storage._data._fb_edit_rev = 3;
  storage._data._fb_synced_rev = 2;
  await fb._loadRevState();
}

// Records every storage write so "no landing" (no startpage_* key) is observable.
function trackStorageWrites(storage) {
  const writes = [];
  const realSet = storage.storage.local.set;
  storage.storage.local.set = async (obj) => {
    writes.push(Object.keys(obj));
    return realSet(obj);
  };
  return () => writes.flat().filter((k) => k.startsWith('startpage_'));
}

async function setup() {
  const fb = loadFirebaseModule();
  const net = network();
  const { storage } = await setupSignedInFirebase(fb, { extraRoutes: net.routes });
  await seedDirty(fb, storage);
  return { fb, net, storage };
}

// Signed in, dirty, and a pending conflict against CLOUD_V1.
async function setupConflict() {
  const ctx = await setup();
  ctx.net.get = getDoc(cloudDoc(ctx.fb, CLOUD_ITEMS, CLOUD_V1));
  await ctx.fb.syncFromCloud({ mode: 'forced' });
  expect(ctx.fb.fbGetSyncConflict()).toMatchObject({ cloudState: 'doc', cloudRaw: CLOUD_V1 });
  ctx.net.log.length = 0;
  return ctx;
}

function mountOpenDialog() {
  const overlay = document.createElement('div');
  overlay.id = 'sync-conflict-overlay';
  document.body.appendChild(overlay);
  return overlay;
}

const inflight = (fb) => fb._getSyncDebugState().inflightUpload;

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

describe('recording the in-flight snapshot (§6.3)', () => {
  it('1. PATCH network failure → a later auto pull of that payload adopts it without landing, clean', async () => {
    const { fb, net, storage } = await setup();
    net.patch = networkFail;
    await expect(fb.syncToCloud()).rejects.toMatchObject({ code: 'network' });
    expect(inflight(fb)).toMatchObject({ revAtStart: 3 });
    expect(fb._isDirty()).toBe(true);
    expect(storage._data[RAW_KEY]).toBe(SEED_UPDATE_TIME);

    const landingKeys = trackStorageWrites(storage);
    globalThis.render = vi.fn();
    net.get = getDoc(landedDoc(net.patches[0]));
    await expect(fb.syncFromCloud()).resolves.toBe(true);

    expect(storage._data[RAW_KEY]).toBe(CLOUD_V2);
    expect(fb._getCloudBaseline().baseline).toMatchObject({ kind: 'known', raw: CLOUD_V2 });
    expect(globalThis.render).not.toHaveBeenCalled();
    expect(landingKeys()).toEqual([]);
    expect(fb._isDirty()).toBe(false);
    expect(inflight(fb)).toBeNull();
  });

  it('2. an edit after the failed PATCH stays dirty and is re-uploaded once against the adopted raw', async () => {
    const { fb, net, storage } = await setup();
    net.patch = networkFail;
    await expect(fb.syncToCloud()).rejects.toMatchObject({ code: 'network' });
    const sent = net.patches[0];

    globalThis.items = [{ id: 'local' }, { id: 'later' }];
    await fb.markLocalCloudDataChanged();
    net.patch = okPatch;
    net.get = getDoc(landedDoc(sent));
    const landingKeys = trackStorageWrites(storage);

    const r = await fb._runPullTask();
    expect(r).toMatchObject({ applied: true, outcome: 'adopted' });
    expect(landingKeys()).toEqual([]);
    expect(storage._data[RAW_KEY]).toBe(CLOUD_V2);
    expect(fb._isDirty()).toBe(true);
    expect(fb.fbGetSyncConflict()).toBeNull();

    net.patches.length = 0;
    await vi.advanceTimersByTimeAsync(2000);
    await flush();
    expect(net.patches).toHaveLength(1);
    expect(net.patches[0].pre).toEqual({ updateTime: CLOUD_V2 });
    expect(fb._isDirty()).toBe(false);
  });

  it('the snapshot is the payload as sent: an in-place edit afterwards does not change it', async () => {
    const { fb, net } = await setup();
    net.patch = networkFail;
    await expect(fb.syncToCloud()).rejects.toMatchObject({ code: 'network' });
    globalThis.items.push({ id: 'pushed-later' });
    await fb.markLocalCloudDataChanged();

    net.get = getDoc(landedDoc(net.patches[0]));
    await expect(fb._runPullTask()).resolves.toMatchObject({ outcome: 'adopted' });
    expect(fb.fbGetSyncConflict()).toBeNull();
    expect(fb._isDirty()).toBe(true);
  });

  it('3. a PATCH timeout (20s) records the snapshot too (§10.1-12)', async () => {
    const { fb, net } = await setup();
    net.patch = hang;
    let err = null;
    fb.syncToCloud().catch((e) => { err = e; });
    await flush();
    expect(inflight(fb)).toBeNull();
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    await flush();
    expect(err).toMatchObject({ code: 'network' });
    expect(inflight(fb)).toMatchObject({ revAtStart: 3 });

    net.get = getDoc(landedDoc(net.patches[0]));
    await expect(fb._runPullTask()).resolves.toMatchObject({ outcome: 'adopted' });
    expect(fb._isDirty()).toBe(false);
  });

  it('4. a 200 without updateTime rejects firestore and records the snapshot', async () => {
    const { fb, net } = await setup();
    net.patch = async () => jsonResponse(200, {});
    await expect(fb.syncToCloud()).rejects.toMatchObject({ code: 'firestore' });
    expect(inflight(fb)).toMatchObject({ revAtStart: 3 });
    expect(inflight(fb).snap.items).toEqual(LOCAL_ITEMS);
  });

  it('a definite HTTP error does not record; a later successful PATCH clears the snapshot', async () => {
    const { fb, net } = await setup();
    net.patch = async () => jsonResponse(500, { error: { status: 'INTERNAL', message: 'boom' } });
    await expect(fb.syncToCloud()).rejects.toMatchObject({ code: 'firestore' });
    expect(inflight(fb)).toBeNull();

    net.patch = networkFail;
    await expect(fb.syncToCloud()).rejects.toMatchObject({ code: 'network' });
    expect(inflight(fb)).not.toBeNull();

    net.patch = okPatch;
    await expect(fb.syncToCloud()).resolves.toMatchObject({ skipped: false });
    expect(inflight(fb)).toBeNull();
  });

  it('8. only the latest is kept: after two failures, a cloud equal to the first payload is not a hit', async () => {
    const { fb, net } = await setup();
    net.patch = networkFail;
    await expect(fb.syncToCloud()).rejects.toMatchObject({ code: 'network' });
    globalThis.items = [{ id: 'second' }];
    await fb.markLocalCloudDataChanged();
    await expect(fb.syncToCloud()).rejects.toMatchObject({ code: 'network' });
    expect(net.patches).toHaveLength(2);
    expect(inflight(fb)).toMatchObject({ revAtStart: 4 });

    net.get = getDoc(landedDoc(net.patches[0]));
    const r = await fb._runPullTask();
    expect(r).toMatchObject({ applied: false, outcome: 'conflict' });
    expect(fb.fbGetSyncConflict()).toMatchObject({ cloudRaw: CLOUD_V2 });
  });

  it('9. _resetSession clears the snapshot', async () => {
    const { fb, net } = await setup();
    net.patch = networkFail;
    await expect(fb.syncToCloud()).rejects.toMatchObject({ code: 'network' });
    expect(inflight(fb)).not.toBeNull();
    fb._resetSession();
    expect(inflight(fb)).toBeNull();
  });
});

describe('in-flight snapshot while a conflict is pending (§7.3)', () => {
  it('5. choose-cloud does not check the snapshot: it lands as usual', async () => {
    const { fb, net, storage } = await setupConflict();
    net.patch = networkFail;
    await expect(fb.fbResolveSyncConflict('local')).resolves.toEqual({ ok: false, code: 'network' });
    expect(inflight(fb)).not.toBeNull();
    expect(fb.fbGetSyncConflict()).not.toBeNull();

    const landingKeys = trackStorageWrites(storage);
    globalThis.render = vi.fn();
    net.get = getDoc(landedDoc(net.patches[0]));
    await expect(fb.fbResolveSyncConflict('cloud')).resolves.toEqual({ ok: true });

    expect(globalThis.render).toHaveBeenCalled();
    expect(landingKeys()).toContain('startpage_items');
    expect(fb.fbGetSyncConflict()).toBeNull();
    expect(inflight(fb)).toBeNull();
  });

  it('6. a hit while pending → pending cleared, dialog closed, clean, no landing, no hook', async () => {
    const { fb, net, storage } = await setupConflict();
    net.patch = networkFail;
    await expect(fb.fbResolveSyncConflict('local')).resolves.toEqual({ ok: false, code: 'network' });
    const overlay = mountOpenDialog();
    const hook = vi.fn();
    globalThis.onSyncConflict = hook;
    globalThis.render = vi.fn();
    const landingKeys = trackStorageWrites(storage);

    net.get = getDoc(landedDoc(net.patches[0]));
    await expect(fb._runPullTask()).resolves.toMatchObject({ applied: true, outcome: 'adopted' });

    expect(fb.fbGetSyncConflict()).toBeNull();
    expect(overlay.classList.contains('hidden')).toBe(true);
    expect(fb._isDirty()).toBe(false);
    expect(storage._data[RAW_KEY]).toBe(CLOUD_V2);
    expect(globalThis.render).not.toHaveBeenCalled();
    expect(landingKeys()).toEqual([]);
    expect(hook).not.toHaveBeenCalled();
  });

  it('6b. a hit while pending after a later edit → pending cleared without a new dialog, dirty, re-uploaded', async () => {
    const { fb, net, storage } = await setupConflict();
    net.patch = networkFail;
    await expect(fb.fbResolveSyncConflict('local')).resolves.toEqual({ ok: false, code: 'network' });
    const sent = net.patches[0];
    globalThis.items = [{ id: 'local' }, { id: 'after-timeout' }];
    await fb.markLocalCloudDataChanged();
    const hook = vi.fn();
    globalThis.onSyncConflict = hook;

    net.patch = okPatch;
    net.get = getDoc(landedDoc(sent));
    await expect(fb._runPullTask()).resolves.toMatchObject({ outcome: 'adopted' });
    expect(fb.fbGetSyncConflict()).toBeNull();
    expect(hook).not.toHaveBeenCalled();
    expect(fb._isDirty()).toBe(true);
    expect(storage._data[RAW_KEY]).toBe(CLOUD_V2);

    net.patches.length = 0;
    await vi.advanceTimersByTimeAsync(2000);
    await flush();
    expect(net.patches).toHaveLength(1);
    expect(net.patches[0].pre).toEqual({ updateTime: CLOUD_V2 });
    expect(hook).not.toHaveBeenCalled();
  });

  it('7. choose-local timed out but landed → choosing local again: precondition fails, recovery hits, ok (§10.1-9)', async () => {
    const { fb, net, storage } = await setupConflict();
    const landingKeys = trackStorageWrites(storage);
    globalThis.render = vi.fn();
    net.patch = hang;
    let first = null;
    fb.fbResolveSyncConflict('local').then((r) => { first = r; });
    await flush();
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    await flush();
    expect(first).toEqual({ ok: false, code: 'network' });
    expect(fb.fbGetSyncConflict()).toMatchObject({ cloudRaw: CLOUD_V1 });

    // The timed-out PATCH did land: the cloud now holds that payload.
    net.get = getDoc(landedDoc(net.patches[0]));
    net.patch = preconditionFailed;
    net.log.length = 0;
    await expect(fb.fbResolveSyncConflict('local')).resolves.toEqual({ ok: true });

    expect(net.log).toEqual(['PATCH', 'GET']);
    expect(net.patches[1].pre).toEqual({ updateTime: CLOUD_V1 });
    // Adopted as our own write, not landed as cloud content.
    expect(globalThis.render).not.toHaveBeenCalled();
    expect(landingKeys()).toEqual([]);
    expect(fb.fbGetSyncConflict()).toBeNull();
    expect(fb._isDirty()).toBe(false);
    expect(fb._getCloudBaseline().baseline).toMatchObject({ kind: 'known', raw: CLOUD_V2 });
  });

  it('7b. same, with an edit after the timeout → the retry PATCH uploads it against the adopted raw', async () => {
    const { fb, net } = await setupConflict();
    net.patch = networkFail;
    await expect(fb.fbResolveSyncConflict('local')).resolves.toEqual({ ok: false, code: 'network' });
    const sent = net.patches[0];
    globalThis.items = [{ id: 'local' }, { id: 'after-timeout' }];
    await fb.markLocalCloudDataChanged();
    const hook = vi.fn();
    globalThis.onSyncConflict = hook;

    net.get = getDoc(landedDoc(sent));
    net.patch = (url) => (preconditionOf(url).updateTime === CLOUD_V1 ? preconditionFailed() : okPatch());
    net.patches.length = 0;
    await expect(fb.fbResolveSyncConflict('local')).resolves.toEqual({ ok: true });

    expect(net.patches.map((p) => p.pre)).toEqual([{ updateTime: CLOUD_V1 }, { updateTime: CLOUD_V2 }]);
    expect(fb.fbGetSyncConflict()).toBeNull();
    expect(fb._isDirty()).toBe(false);
    expect(hook).not.toHaveBeenCalled();
  });
});
