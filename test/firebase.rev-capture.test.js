import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadFirebaseModule } from './helpers/loadFirebaseModule.js';
import { jsonResponse } from './helpers/mockFetch.js';
import { setupSignedInFirebase, firestoreGetRoute, firestorePatchRoute } from './helpers/setupSignedInFirebase.js';

// Spec §6.5: syncFromCloud must capture revAtApply in the same synchronous
// block that assigns the in-memory state. An edit made while the landing is
// awaiting storage writes must stay dirty and be re-uploaded, never be marked
// clean by a late `_syncedRev = _editRev`.

const CLOUD_TS = '2024-06-02T00:00:00.000000000Z';
const PATCH_TS = '2024-06-03T00:00:00.000000000Z';

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

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

// Suspend the first storage write that lands the cloud items. `reached`
// resolves once the landing is parked inside that write; `release()` lets it
// finish. Every other write passes straight through.
function holdLandingWrite(storage) {
  const realSet = storage.storage.local.set;
  const reached = deferred();
  const gate = deferred();
  let held = false;
  storage.storage.local.set = async (values) => {
    if (!held && values && 'startpage_items' in values) {
      held = true;
      reached.resolve();
      await gate.promise;
    }
    return realSet(values);
  };
  return { reached: reached.promise, release: () => gate.resolve() };
}

async function editDuringLanding(fb, hold) {
  await hold.reached;
  globalThis.items = [...globalThis.items, { id: 'edit-during-landing' }];
  await fb.markLocalCloudDataChanged();
  hold.release();
}

function patchRecorder() {
  const patches = [];
  const route = firestorePatchRoute(async (url, options) => {
    const body = JSON.parse(options.body);
    patches.push({ items: JSON.parse(body.fields.items.stringValue) });
    return jsonResponse(200, { updateTime: PATCH_TS });
  });
  return { patches, route };
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
  delete globalThis.sanitizeItemsShape;
  document.body.innerHTML = '';
});

describe('syncFromCloud revAtApply capture', () => {
  it("edit during a forced pull's landing stays dirty and is re-uploaded", async () => {
    vi.useFakeTimers();
    const fb = loadFirebaseModule();
    const { patches, route } = patchRecorder();
    const { storage } = await setupSignedInFirebase(fb, {
      extraRoutes: [
        firestoreGetRoute(async () => jsonResponse(200, cloudDoc(fb, [{ id: 'cloud' }]))),
        route,
      ],
    });
    const hold = holdLandingWrite(storage);

    const pull = fb.syncFromCloud({ mode: 'forced' });
    await editDuringLanding(fb, hold);
    await expect(pull).resolves.toBe(true);

    expect(fb._isDirty()).toBe(true);

    await vi.advanceTimersByTimeAsync(2000);
    expect(patches).toHaveLength(1);
    expect(patches[0].items).toEqual([{ id: 'cloud' }, { id: 'edit-during-landing' }]);
    expect(fb._isDirty()).toBe(false);
  });

  it('edit during resolve-cloud landing stays dirty', async () => {
    vi.useFakeTimers();
    const fb = loadFirebaseModule();
    const { patches, route } = patchRecorder();
    const { storage } = await setupSignedInFirebase(fb, {
      extraRoutes: [
        firestoreGetRoute(async () => jsonResponse(200, cloudDoc(fb, [{ id: 'cloud' }]))),
        route,
      ],
    });
    // Build a pending conflict: dirty local state that differs from the cloud.
    globalThis.items = [{ id: 'local-only' }];
    await fb.markLocalCloudDataChanged();
    vi.clearAllTimers();
    await fb.syncFromCloud();
    expect(fb.fbGetSyncConflict()).not.toBeNull();

    const hold = holdLandingWrite(storage);
    const resolve = fb.fbResolveSyncConflict('cloud');
    await editDuringLanding(fb, hold);

    await expect(resolve).resolves.toEqual({ ok: true });
    expect(fb._isDirty()).toBe(true);
    expect(fb.fbGetSyncConflict()).toBeNull();

    // The edit was made while the conflict was still pending, so its own
    // schedule was suppressed; the landing must re-queue the upload.
    await vi.advanceTimersByTimeAsync(2000);
    expect(patches).toHaveLength(1);
    expect(patches[0].items).toEqual([{ id: 'cloud' }, { id: 'edit-during-landing' }]);
  });

  describe('normalization resync bumps from revAtApply', () => {
    function installNormalizer() {
      globalThis.sanitizeItemsShape = (list) => ({
        items: list.map((entry) => ({ ...entry, type: entry.type || 'link' })),
        changed: true,
      });
    }

    it('without an edit: synced = revAtApply, edit = revAtApply + 1', async () => {
      vi.useFakeTimers();
      const fb = loadFirebaseModule();
        const { patches, route } = patchRecorder();
      const { storage } = await setupSignedInFirebase(fb, {
        extraRoutes: [
          firestoreGetRoute(async () => jsonResponse(200, cloudDoc(fb, [{ id: 'cloud' }]))),
          route,
        ],
      });
      installNormalizer();
      await fb._saveRevState();
      const revAtApply = storage._data._fb_edit_rev;

      await expect(fb.syncFromCloud({ mode: 'forced' })).resolves.toBe(true);

      expect(storage._data._fb_synced_rev).toBe(revAtApply);
      expect(storage._data._fb_edit_rev).toBe(revAtApply + 1);
      await vi.advanceTimersByTimeAsync(2000);
      expect(patches).toHaveLength(1);
      expect(patches[0].items).toEqual([{ id: 'cloud', type: 'link' }]);
    });

    it('with an edit during landing: no extra bump, exactly one PATCH', async () => {
      vi.useFakeTimers();
      const fb = loadFirebaseModule();
        const { patches, route } = patchRecorder();
      const { storage } = await setupSignedInFirebase(fb, {
        extraRoutes: [
          firestoreGetRoute(async () => jsonResponse(200, cloudDoc(fb, [{ id: 'cloud' }]))),
          route,
        ],
      });
      installNormalizer();
      await fb._saveRevState();
      const revAtApply = storage._data._fb_edit_rev;
      const hold = holdLandingWrite(storage);

      const pull = fb.syncFromCloud({ mode: 'forced' });
      await editDuringLanding(fb, hold);
      await expect(pull).resolves.toBe(true);

      // The edit already made the state dirty past revAtApply; the canonical
      // re-upload rides on it instead of adding a second bump.
      expect(storage._data._fb_synced_rev).toBe(revAtApply);
      expect(storage._data._fb_edit_rev).toBe(revAtApply + 1);
      expect(fb._isDirty()).toBe(true);

      await vi.advanceTimersByTimeAsync(10000);
      expect(patches).toHaveLength(1);
      expect(patches[0].items).toEqual([
        { id: 'cloud', type: 'link' },
        { id: 'edit-during-landing' },
      ]);
      expect(fb._isDirty()).toBe(false);
    });
  });

  it('no edit during landing → clean', async () => {
    vi.useFakeTimers();
    const fb = loadFirebaseModule();
    const { patches, route } = patchRecorder();
    await setupSignedInFirebase(fb, {
      extraRoutes: [
        firestoreGetRoute(async () => jsonResponse(200, cloudDoc(fb, [{ id: 'cloud' }]))),
        route,
      ],
    });

    await expect(fb.syncFromCloud({ mode: 'forced' })).resolves.toBe(true);

    expect(fb._isDirty()).toBe(false);
    await vi.advanceTimersByTimeAsync(10000);
    expect(patches).toHaveLength(0);
  });
});
