import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadFirebaseModule } from './helpers/loadFirebaseModule.js';
import { jsonResponse, deferred } from './helpers/mockFetch.js';
import {
  setupSignedInFirebase,
  firestoreGetRoute,
  firestorePatchRoute,
  TEST_UID,
} from './helpers/setupSignedInFirebase.js';

// Spec §7.1/§7.2/§7.4: every cloud operation runs in one serial executor.
// Tasks run strictly one at a time, auto tasks of the same kind merge while
// queued, and a session reset drops queued work and stale debounce timers.

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

// Firestore routes that record the order of document requests. `get` is a
// responder returning a response or a promise of one (e.g. a deferred).
function recordingRoutes({ get, patch }) {
  const log = [];
  const routes = [
    firestoreGetRoute(() => { log.push('GET'); return get(); }),
    firestorePatchRoute((url, options) => { log.push('PATCH'); return patch(url, options); }),
  ];
  return { log, routes };
}

const okPatch = async () => jsonResponse(200, { updateTime: PATCH_TS });
const count = (log, kind) => log.filter((x) => x === kind).length;

// Drain pending microtasks/zero-delay timers without advancing the clock.
async function flush() {
  for (let i = 0; i < 20; i += 1) await vi.advanceTimersByTimeAsync(0);
}

async function editLocally(fb, id = 'local-edit') {
  globalThis.items = [...(globalThis.items || []), { id }];
  await fb.markLocalCloudDataChanged();
}

function fakeIdToken(claims = { email_verified: true }) {
  return `h.${btoa(JSON.stringify(claims))}.s`;
}

function signInRoute() {
  return {
    match: (url) => url.includes('accounts:signInWithPassword') || url.includes('accounts:signUp'),
    respond: async () => jsonResponse(200, {
      idToken: fakeIdToken(),
      expiresIn: '3600',
      refreshToken: 'new-refresh',
      localId: TEST_UID,
    }),
  };
}

function sendOobRoute() {
  return {
    match: (url) => url.includes('accounts:sendOobCode'),
    respond: async () => jsonResponse(200, {}),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
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

describe('serial sync queue', () => {
  it('tasks run strictly one at a time', async () => {
    const fb = loadFirebaseModule();
    const getGate = deferred();
    const { log, routes } = recordingRoutes({ get: () => getGate.promise, patch: okPatch });
    await setupSignedInFirebase(fb, { extraRoutes: routes });
    await editLocally(fb);

    const pull = fb.syncFromCloud({ mode: 'forced' });
    const upload = fb.syncToCloud();
    await flush();
    expect(count(log, 'PATCH')).toBe(0);

    getGate.resolve(jsonResponse(404, {}));
    await expect(pull).resolves.toBe(false);
    await expect(upload).resolves.toMatchObject({ ok: true, skipped: false });
    expect(log).toEqual(['GET', 'PATCH']);
  });

  it('edits during a >2s startup GET never PATCH early', async () => {
    const fb = loadFirebaseModule();
    const getGate = deferred();
    const { log, routes } = recordingRoutes({ get: () => getGate.promise, patch: okPatch });
    await setupSignedInFirebase(fb, { extraRoutes: routes });

    const startup = fb._pullAfterSignIn({ trigger: 'startup' });
    await flush();
    await editLocally(fb);
    await vi.advanceTimersByTimeAsync(2500);
    expect(count(log, 'PATCH')).toBe(0);

    // The cloud differs from the dirty local state: the decision tree records
    // a conflict, and the upload queued behind the pull is skipped by it.
    getGate.resolve(jsonResponse(200, cloudDoc(fb, [{ id: 'cloud-item' }])));
    await startup;
    await flush();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fb.fbGetSyncConflict()).not.toBeNull();
    expect(count(log, 'PATCH')).toBe(0);
  });

  it('two auto pulls merge into one GET; a forced pull does not merge', async () => {
    const fb = loadFirebaseModule();
    const firstGate = deferred();
    let getCalls = 0;
    const { log, routes } = recordingRoutes({
      get: () => {
        getCalls += 1;
        return getCalls === 1
          ? firstGate.promise
          : jsonResponse(200, cloudDoc(fb, [{ id: 'cloud-item' }]));
      },
      patch: okPatch,
    });
    await setupSignedInFirebase(fb, { extraRoutes: routes });

    const running = fb.syncFromCloud({ mode: 'forced' });
    await flush();
    const autoA = fb.syncFromCloud();
    const autoB = fb.syncFromCloud();
    const forced = fb.syncFromCloud({ mode: 'forced' });

    firstGate.resolve(jsonResponse(200, cloudDoc(fb, [{ id: 'cloud-item' }])));
    const results = await Promise.all([running, autoA, autoB, forced]);

    expect(count(log, 'GET')).toBe(3);
    expect(results[1]).toBe(results[2]);
    expect(results).toEqual([true, true, true, true]);
  });

  it('offline edit storm queues at most one auto upload', async () => {
    const fb = loadFirebaseModule();
    const getGate = deferred();
    const patchGate = deferred();
    let patchCalls = 0;
    const { log, routes } = recordingRoutes({
      get: () => getGate.promise,
      patch: () => {
        patchCalls += 1;
        return patchCalls === 1 ? patchGate.promise : okPatch();
      },
    });
    await setupSignedInFirebase(fb, { extraRoutes: routes });

    const pull = fb.syncFromCloud({ mode: 'forced' });
    await flush();
    for (let i = 0; i < 5; i += 1) {
      await editLocally(fb, `edit-${i}`);
      await vi.advanceTimersByTimeAsync(2000);
    }
    expect(count(log, 'PATCH')).toBe(0);

    getGate.resolve(jsonResponse(404, {}));
    await pull;
    await flush();
    expect(count(log, 'PATCH')).toBe(1);

    // An edit during that PATCH keeps the local state dirty: any duplicate
    // auto upload still queued would PATCH again right away instead of being
    // skipped as clean. Only the follow-up debounce may upload, 2s later.
    await editLocally(fb, 'edit-during-patch');
    vi.clearAllTimers();
    patchGate.resolve(jsonResponse(200, { updateTime: PATCH_TS }));
    await flush();
    expect(count(log, 'PATCH')).toBe(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(count(log, 'PATCH')).toBe(2);
  });

  it('a failing task does not block the next', async () => {
    const fb = loadFirebaseModule();
    let patchCalls = 0;
    const { routes } = recordingRoutes({
      get: async () => jsonResponse(404, {}),
      patch: async () => {
        patchCalls += 1;
        return patchCalls === 1
          ? jsonResponse(429, { error: { status: 'RESOURCE_EXHAUSTED' } })
          : jsonResponse(200, { updateTime: PATCH_TS });
      },
    });
    await setupSignedInFirebase(fb, { extraRoutes: routes });

    const first = fb.syncToCloud({ force: true });
    const second = fb.syncToCloud({ force: true });

    await expect(first).rejects.toMatchObject({ code: 'quota' });
    await expect(second).resolves.toMatchObject({ ok: true, skipped: false });
    expect(patchCalls).toBe(2);
  });

  it('_clearAuth drops queued tasks with session-changed', async () => {
    const fb = loadFirebaseModule();
    const getGate = deferred();
    const { log, routes } = recordingRoutes({ get: () => getGate.promise, patch: okPatch });
    await setupSignedInFirebase(fb, { extraRoutes: routes });
    await editLocally(fb);

    const running = fb.syncFromCloud({ mode: 'forced' });
    await flush();
    const queuedUpload = fb.syncToCloud();
    const queuedPull = fb.syncFromCloud();

    await fb._clearAuth();
    await expect(queuedUpload).resolves.toEqual({ ok: true, skipped: true, reason: 'session-changed' });
    await expect(queuedPull).resolves.toBe(false);

    getGate.resolve(jsonResponse(200, cloudDoc(fb, [{ id: 'cloud-item' }])));
    await expect(running).resolves.toBe(false);
    await flush();
    expect(log).toEqual(['GET']);
  });

  describe.each([
    ['fbSignIn', (fb) => fb.fbSignIn('user@example.com', 'pw')],
    ['fbSignUp', (fb) => fb.fbSignUp('user@example.com', 'pw')],
  ])('%s runs the unified session reset', (_name, signIn) => {
    it('clears the pending conflict and drops queued tasks', async () => {
      const fb = loadFirebaseModule();
      let getCalls = 0;
      const hangGate = deferred();
      const { log, routes } = recordingRoutes({
        get: () => {
          getCalls += 1;
          return getCalls === 1
            ? jsonResponse(200, cloudDoc(fb, [{ id: 'cloud-item' }]))
            : hangGate.promise;
        },
        patch: okPatch,
      });
      await setupSignedInFirebase(fb, { extraRoutes: [signInRoute(), sendOobRoute(), ...routes] });
      await editLocally(fb);
      vi.clearAllTimers();

      // Record a conflict, then park a task behind a hanging pull.
      await fb.syncFromCloud();
      expect(fb.fbGetSyncConflict()).not.toBeNull();
      const running = fb.syncFromCloud({ mode: 'forced' });
      await flush();
      const queued = fb.syncToCloud({ force: true });

      await signIn(fb);
      expect(fb.fbGetSyncConflict()).toBeNull();
      await expect(queued).resolves.toEqual({ ok: true, skipped: true, reason: 'session-changed' });

      hangGate.resolve(jsonResponse(200, cloudDoc(fb, [{ id: 'cloud-item' }])));
      await expect(running).resolves.toBe(false);
      await flush();
      expect(count(log, 'PATCH')).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('clears the debounce timer', async () => {
      const fb = loadFirebaseModule();
      const { log, routes } = recordingRoutes({ get: async () => jsonResponse(404, {}), patch: okPatch });
      await setupSignedInFirebase(fb, { extraRoutes: [signInRoute(), sendOobRoute(), ...routes] });
      await editLocally(fb);
      expect(vi.getTimerCount()).toBe(1);

      await signIn(fb);
      await flush();
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(5000);
      expect(count(log, 'PATCH')).toBe(0);
    });
  });

  it('a debounce timer scheduled in an old epoch never enqueues', async () => {
    const fb = loadFirebaseModule();
    const { log, routes } = recordingRoutes({ get: async () => jsonResponse(404, {}), patch: okPatch });
    await setupSignedInFirebase(fb, { extraRoutes: routes });
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    await editLocally(fb);
    const call = timeoutSpy.mock.calls.find(([, delay]) => delay === 2000);
    expect(call).toBeDefined();
    const debounceCallback = call[0];

    fb._resetSession();
    // Run the captured callback by hand: the reset already cleared the real
    // timer, so only the callback's own epoch check can stop the upload.
    debounceCallback();
    await flush();
    expect(log).toEqual([]);
  });

  it('auth failure inside a running task exits with zero writes and no deadlock', async () => {
    const fb = loadFirebaseModule();
    let refreshCalls = 0;
    const tokenRoute = {
      match: (url) => url.includes('securetoken.googleapis.com'),
      respond: async () => {
        refreshCalls += 1;
        return refreshCalls === 1
          ? jsonResponse(200, {
            id_token: 'fresh-id-token', expires_in: '3600',
            refresh_token: 'refreshed', user_id: TEST_UID,
          })
          : jsonResponse(400, { error: { message: 'INVALID_GRANT' } });
      },
    };
    let patchCalls = 0;
    const { log, routes } = recordingRoutes({
      get: async () => jsonResponse(200, cloudDoc(fb, [{ id: 'cloud-item' }])),
      patch: async () => { patchCalls += 1; return jsonResponse(401, { error: { status: 'UNAUTHENTICATED' } }); },
    });
    const { storage } = await setupSignedInFirebase(fb, {
      extraRoutes: [tokenRoute, signInRoute(), ...routes],
    });

    const upload = fb.syncToCloud({ force: true });
    const queued = fb.syncFromCloud();
    await expect(upload).rejects.toMatchObject({ code: 'auth' });
    await expect(queued).resolves.toBe(false);
    expect(fb.fbIsSignedIn()).toBe(false);
    expect(storage._data._fb_cloud_sync_ts).toBeUndefined();
    expect(storage._data._fb_cloud_update_time).toBeUndefined();
    expect(count(log, 'GET')).toBe(0);

    await fb.fbSignIn('user@example.com', 'pw');
    const raced = Promise.race([
      fb.syncFromCloud(),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 1000)),
    ]);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(raced).resolves.toBe(true);
    expect(patchCalls).toBe(1);
  });

  it("a new session's task runs within the timeout while an old GET hangs", async () => {
    const fb = loadFirebaseModule();
    let getCalls = 0;
    const { routes } = recordingRoutes({
      get: () => {
        getCalls += 1;
        return getCalls === 1
          ? new Promise(() => {})
          : jsonResponse(200, cloudDoc(fb, [{ id: 'cloud-item' }]));
      },
      patch: okPatch,
    });
    await setupSignedInFirebase(fb, { extraRoutes: [signInRoute(), ...routes] });

    const old = fb.syncFromCloud({ mode: 'forced' });
    old.catch(() => {});
    await flush();
    await fb._clearAuth();
    await fb.fbSignIn('user@example.com', 'pw');

    let settled = false;
    const fresh = fb.syncFromCloud().then((v) => { settled = true; return v; });
    await flush();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(20000);
    await flush();
    expect(settled).toBe(true);
    await expect(fresh).resolves.toBe(true);
    expect(getCalls).toBe(2);
  });

  it("conflict hook fires after the task's last write", async () => {
    const fb = loadFirebaseModule();
    const { routes } = recordingRoutes({
      get: async () => jsonResponse(200, cloudDoc(fb, [{ id: 'cloud-item' }])),
      patch: okPatch,
    });
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes });
    await editLocally(fb);
    vi.clearAllTimers();

    const realSet = storage.storage.local.set;
    let setCalls = 0;
    storage.storage.local.set = async (values) => { setCalls += 1; return realSet(values); };
    const order = [];
    let setCallsAtHook = null;
    globalThis.onSyncConflict = () => { setCallsAtHook = setCalls; order.push('hook'); };

    const pulled = await fb.syncFromCloud().then((v) => { order.push('settled'); return v; });
    await flush();

    expect(pulled).toBe(false);
    expect(order).toEqual(['hook', 'settled']);
    expect(setCalls).toBe(setCallsAtHook);
  });

  it('a debounce upload that fires during a landing runs after the landing', async () => {
    const fb = loadFirebaseModule();
    const patchedItems = [];
    const { log, routes } = recordingRoutes({
      get: async () => jsonResponse(200, cloudDoc(fb, [{ id: 'cloud-item' }])),
      patch: async (url, options) => {
        patchedItems.push(JSON.parse(JSON.parse(options.body).fields.items.stringValue));
        return jsonResponse(200, { updateTime: PATCH_TS });
      },
    });
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes });

    // Park the landing inside its first storage write, and log when its last
    // bookkeeping write (the baseline uid) completes.
    const realSet = storage.storage.local.set;
    const reached = deferred();
    const gate = deferred();
    let held = false;
    storage.storage.local.set = async (values) => {
      if (!held && 'startpage_items' in values) {
        held = true;
        reached.resolve();
        await gate.promise;
      }
      await realSet(values);
      if ('_fb_sync_baseline_uid' in values) log.push('baseline-written');
    };

    const pull = fb.syncFromCloud({ mode: 'forced' });
    await reached.promise;
    await editLocally(fb, 'edit-during-landing');
    await vi.advanceTimersByTimeAsync(2500); // the edit's own debounce timer fires
    expect(count(log, 'PATCH')).toBe(0);

    gate.resolve();
    await expect(pull).resolves.toBe(true);
    await flush();
    await vi.advanceTimersByTimeAsync(5000);

    expect(count(log, 'PATCH')).toBe(1);
    expect(log.indexOf('baseline-written')).toBeLessThan(log.indexOf('PATCH'));
    expect(patchedItems[0].map((it) => it.id)).toContain('edit-during-landing');
  });
});
