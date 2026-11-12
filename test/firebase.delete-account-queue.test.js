import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadFirebaseModule } from './helpers/loadFirebaseModule.js';
import { jsonResponse, deferred, hangingFetchResponse } from './helpers/mockFetch.js';
import {
  setupSignedInFirebase,
  firestoreGetRoute,
  firestorePatchRoute,
  TEST_UID,
} from './helpers/setupSignedInFirebase.js';

// Spec §5.1 (account deletion row, "partial failure"), §7.3 step 2, §10.1-9:
// fbDeleteAccount runs as an executor task. Queueing it drops every
// not-started task (session-changed) and sets the deleting flag; while the
// flag is set no upload may be sent — above all no exists=false import that
// would recreate the document before it is deleted. The flag is cleared in a
// finally, on success and on failure.

const FIRESTORE_DOC_URL_PART = `/documents/users/${TEST_UID}/data/settings`;
const PATCH_TS = '2024-06-03T00:00:00.000000Z';

const preconditionFailed = async () =>
  jsonResponse(400, { error: { status: 'FAILED_PRECONDITION', message: 'FAILED_PRECONDITION' } });
const okPatch = async () => jsonResponse(200, { updateTime: PATCH_TS });

function inSequence(...responders) {
  let n = 0;
  return (...args) => responders[Math.min(n++, responders.length - 1)](...args);
}

// Records every request in order. Each responder may return a promise (e.g.
// a deferred) so a test can hold a request open.
function deletionRoutes({
  get = async () => jsonResponse(404, {}),
  patch = okPatch,
  firestoreDelete = async () => jsonResponse(200, {}),
  accountDelete = async () => jsonResponse(200, {}),
} = {}) {
  const log = [];
  const patches = [];
  const routes = [
    {
      match: (url, options = {}) => url.includes(FIRESTORE_DOC_URL_PART) && options.method === 'DELETE',
      respond: () => { log.push('DELETE'); return firestoreDelete(); },
    },
    {
      match: (url) => url.includes('accounts:delete'),
      respond: () => { log.push('ACCOUNT_DELETE'); return accountDelete(); },
    },
    firestoreGetRoute(() => { log.push('GET'); return get(); }),
    firestorePatchRoute((url, options) => {
      log.push('PATCH');
      patches.push({ url });
      return patch(url, options);
    }),
  ];
  return { log, patches, routes };
}

const count = (log, kind) => log.filter((x) => x === kind).length;

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

const deleting = (fb) => fb._getSyncDebugState().accountDeleting;

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
  document.body.innerHTML = '';
});

describe('fbDeleteAccount as an executor task', () => {
  it('a queued syncToCloud() is dropped with session-changed when the deletion is queued', async () => {
    const fb = loadFirebaseModule();
    const gate = deferred();
    const { log, routes } = deletionRoutes({ get: () => gate.promise });
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes });
    await seedDirty(fb, storage);

    // A running pull holds the executor so the upload stays queued.
    const pull = fb.syncFromCloud({ mode: 'forced' });
    await flush();
    const upload = fb.syncToCloud();
    const del = fb.fbDeleteAccount();

    await expect(upload).resolves.toEqual({ ok: true, skipped: true, reason: 'session-changed' });

    gate.resolve(jsonResponse(404, {}));
    await pull;
    await expect(del).resolves.toBeUndefined();
    expect(count(log, 'PATCH')).toBe(0);
    expect(log).toEqual(['GET', 'DELETE', 'ACCOUNT_DELETE']);
  });

  it('an upload already running when the deletion is queued does not send its exists=false import', async () => {
    const fb = loadFirebaseModule();
    const gate = deferred();
    const { log, routes } = deletionRoutes({
      // The recovery GET is held until the deletion is queued, then finds 404.
      get: () => gate.promise,
      patch: inSequence(preconditionFailed, okPatch),
    });
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes });
    await seedDirty(fb, storage);

    const upload = fb.syncToCloud();
    await flush();
    expect(log).toEqual(['PATCH', 'GET']);

    const del = fb.fbDeleteAccount();
    expect(deleting(fb)).toBe(true);
    gate.resolve(jsonResponse(404, {}));

    await expect(upload).resolves.toEqual({ ok: true, skipped: true, reason: 'account-deleting' });
    await expect(del).resolves.toBeUndefined();
    expect(count(log, 'PATCH')).toBe(1);
    expect(log).toEqual(['PATCH', 'GET', 'DELETE', 'ACCOUNT_DELETE']);
  });

  it('an auto upload due during the deletion is skipped with account-deleting and sends no PATCH', async () => {
    const fb = loadFirebaseModule();
    const accountGate = deferred();
    const { log, routes } = deletionRoutes({ accountDelete: () => accountGate.promise });
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes });
    await seedDirty(fb, storage);

    const del = fb.fbDeleteAccount();
    await flush();
    expect(log).toEqual(['DELETE', 'ACCOUNT_DELETE']);

    // An edit during the deletion arms the debounce timer; once due it queues
    // an auto upload, which syncToCloud() joins.
    await fb.markLocalCloudDataChanged();
    await vi.advanceTimersByTimeAsync(2000);
    const upload = fb.syncToCloud();

    // The deletion fails, so the queued upload runs its dequeue guard while
    // the deletion is still in progress.
    accountGate.resolve(jsonResponse(400, { error: { message: 'CREDENTIAL_TOO_OLD_LOGIN_AGAIN' } }));
    await expect(del).rejects.toThrow('CREDENTIAL_TOO_OLD_LOGIN_AGAIN');
    await expect(upload).resolves.toEqual({ ok: true, skipped: true, reason: 'account-deleting' });
    await flush();
    expect(count(log, 'PATCH')).toBe(0);
    expect(deleting(fb)).toBe(false);
  });

  it('a pull or choose-cloud dequeued during the deletion ends with session-changed, without a request', async () => {
    const fb = loadFirebaseModule();
    const accountGate = deferred();
    const { log, routes } = deletionRoutes({ accountDelete: () => accountGate.promise });
    await setupSignedInFirebase(fb, { extraRoutes: routes });

    const del = fb.fbDeleteAccount();
    await flush();
    const pull = fb.syncFromCloud({ mode: 'forced' });

    accountGate.resolve(jsonResponse(400, { error: { message: 'CREDENTIAL_TOO_OLD_LOGIN_AGAIN' } }));
    await expect(del).rejects.toThrow('CREDENTIAL_TOO_OLD_LOGIN_AGAIN');
    await expect(pull).resolves.toBe(false);
    expect(count(log, 'GET')).toBe(0);
    expect(count(log, 'PATCH')).toBe(0);
  });

  it('choose-cloud queued during the deletion ends with session-changed and imports nothing', async () => {
    const fb = loadFirebaseModule();
    const accountGate = deferred();
    const cloud = {
      updateTime: '2024-06-02T00:00:00.000000Z',
      fields: {
        items: fb._toFV(JSON.stringify([{ id: 'cloud' }])),
        engines: fb._toFV(JSON.stringify([])),
        selected_engine: fb._toFV('google'),
        clocks: fb._toFV(JSON.stringify([])),
        grid_columns: fb._toFV(4),
      },
    };
    const { log, routes } = deletionRoutes({
      get: async () => jsonResponse(200, cloud),
      accountDelete: () => accountGate.promise,
    });
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes });
    await seedDirty(fb, storage);
    await fb.syncFromCloud();
    expect(fb.fbGetSyncConflict()).not.toBeNull();
    log.length = 0;

    const del = fb.fbDeleteAccount();
    await flush();
    const choice = fb.fbResolveSyncConflict('cloud');

    accountGate.resolve(jsonResponse(400, { error: { message: 'CREDENTIAL_TOO_OLD_LOGIN_AGAIN' } }));
    await expect(del).rejects.toThrow('CREDENTIAL_TOO_OLD_LOGIN_AGAIN');
    await expect(choice).resolves.toEqual({ ok: false, code: 'session-changed' });
    expect(log).toEqual(['DELETE', 'ACCOUNT_DELETE']);
    expect(fb.fbGetSyncConflict()).not.toBeNull();
  });

  it('accounts:delete 400 → rejects with the server message, flag cleared, still signed in', async () => {
    const fb = loadFirebaseModule();
    const { routes } = deletionRoutes({
      accountDelete: async () => jsonResponse(400, { error: { message: 'CREDENTIAL_TOO_OLD_LOGIN_AGAIN' } }),
    });
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes });

    await expect(fb.fbDeleteAccount()).rejects.toThrow('CREDENTIAL_TOO_OLD_LOGIN_AGAIN');
    expect(deleting(fb)).toBe(false);
    expect(fb.fbIsSignedIn()).toBe(true);
    expect(storage._data._fb_refresh).toBeTruthy();
  });

  it('success → _clearAuth ran (both baseline keys removed), flag cleared', async () => {
    const fb = loadFirebaseModule();
    const { log, routes } = deletionRoutes();
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes });
    expect(storage._data._fb_cloud_update_time).toBeTruthy();

    await expect(fb.fbDeleteAccount()).resolves.toBeUndefined();
    expect(log).toEqual(['DELETE', 'ACCOUNT_DELETE']);
    expect(fb.fbIsSignedIn()).toBe(false);
    expect('_fb_refresh' in storage._data).toBe(false);
    expect('_fb_cloud_update_time' in storage._data).toBe(false);
    expect('_fb_cloud_sync_ts' in storage._data).toBe(false);
    expect(deleting(fb)).toBe(false);
  });

  it('a hanging accounts:delete rejects with network after 20s and clears the flag', async () => {
    const fb = loadFirebaseModule();
    const { routes } = deletionRoutes({ accountDelete: async () => hangingFetchResponse(200) });
    await setupSignedInFirebase(fb, { extraRoutes: routes });

    const del = fb.fbDeleteAccount();
    const settled = del.then(() => 'resolved', (e) => e);
    await flush();
    expect(deleting(fb)).toBe(true);

    await vi.advanceTimersByTimeAsync(20000);
    const err = await settled;
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('network');
    expect(deleting(fb)).toBe(false);
    expect(fb.fbIsSignedIn()).toBe(true);
  });

  it('a hanging Firestore DELETE times out, warns and still deletes the account (best-effort)', async () => {
    const fb = loadFirebaseModule();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { log, routes } = deletionRoutes({ firestoreDelete: () => new Promise(() => {}) });
    await setupSignedInFirebase(fb, { extraRoutes: routes });

    const del = fb.fbDeleteAccount();
    await flush();
    await vi.advanceTimersByTimeAsync(20000);
    await expect(del).resolves.toBeUndefined();
    expect(log).toEqual(['DELETE', 'ACCOUNT_DELETE']);
    expect(warnSpy).toHaveBeenCalled();
    expect(fb.fbIsSignedIn()).toBe(false);
  });

  it('signed out → NOT_SIGNED_IN, no fetch, the flag is never set', async () => {
    const fb = loadFirebaseModule();
    const { log, routes } = deletionRoutes();
    await setupSignedInFirebase(fb, { extraRoutes: routes });
    await fb.fbSignOut();

    const del = fb.fbDeleteAccount();
    // Checked synchronously before queueing: the flag never flips.
    expect(deleting(fb)).toBe(false);
    await expect(del).rejects.toThrow('NOT_SIGNED_IN');
    expect(log).toEqual([]);
  });

  it('auth keys cleared by another page → the task ends with baseline-cleared, no DELETE', async () => {
    const fb = loadFirebaseModule();
    const { log, routes } = deletionRoutes();
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes });
    delete storage._data._fb_refresh;

    await expect(fb.fbDeleteAccount()).rejects.toThrow('baseline-cleared');
    expect(log).toEqual([]);
    expect(deleting(fb)).toBe(false);
  });

  it('an unverified account can still be deleted (the email-verified check does not apply)', async () => {
    const fb = loadFirebaseModule();
    const { log, routes } = deletionRoutes();
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes });
    storage._data._fb_email_verified = false;
    await fb._loadAuth();
    expect(fb.fbIsEmailVerified()).toBe(false);

    await expect(fb.fbDeleteAccount()).resolves.toBeUndefined();
    expect(log).toEqual(['DELETE', 'ACCOUNT_DELETE']);
    expect(fb.fbIsSignedIn()).toBe(false);
  });
});
