import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadFirebaseModule } from './helpers/loadFirebaseModule.js';
import { jsonResponse, hangingFetchResponse } from './helpers/mockFetch.js';
import { setupSignedInFirebase, firestoreGetRoute, firestorePatchRoute } from './helpers/setupSignedInFirebase.js';

// Spec §7.6: every cloud request is bounded by a 20s timeout that covers the
// body read too, and a timeout always surfaces as a `network` error.

const TIMEOUT_MS = 20000;
const never = () => new Promise(() => {});

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
  document.body.innerHTML = '';
});

// Starts `promise` and records how it settles, so a pending state can be
// asserted without leaving an unhandled rejection behind.
function track(promise) {
  const state = { settled: false, error: null, value: undefined };
  promise.then(
    (value) => { state.settled = true; state.value = value; },
    (error) => { state.settled = true; state.error = error; },
  );
  return state;
}

describe('cloud request timeout', () => {
  it('_fsGet aborts after 20s with network', async () => {
    vi.useFakeTimers();
    const fb = loadFirebaseModule();
    let signal = null;
    await setupSignedInFirebase(fb, {
      extraRoutes: [firestoreGetRoute((url, options) => { signal = options.signal; return never(); })],
    });

    const state = track(fb._fsGet());
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);

    expect(state.settled).toBe(true);
    expect(state.error).toMatchObject({ name: 'CloudSyncError', code: 'network' });
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(true);
  });

  it('_fsGet does not abort at 19999ms', async () => {
    vi.useFakeTimers();
    const fb = loadFirebaseModule();
    let signal = null;
    await setupSignedInFirebase(fb, {
      extraRoutes: [firestoreGetRoute((url, options) => { signal = options.signal; return never(); })],
    });

    const state = track(fb._fsGet());
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);

    expect(state.settled).toBe(false);
    expect(signal.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(state.error).toMatchObject({ code: 'network' });
  });

  it('_fsGet times out when res.json() hangs', async () => {
    vi.useFakeTimers();
    const fb = loadFirebaseModule();
    await setupSignedInFirebase(fb, {
      extraRoutes: [firestoreGetRoute(async () => hangingFetchResponse(200))],
    });

    const state = track(fb._fsGet());
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    expect(state.settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(state.error).toMatchObject({ code: 'network' });
  });

  it('_fsSet PATCH hang → network', async () => {
    vi.useFakeTimers();
    const fb = loadFirebaseModule();
    let patchCalls = 0;
    await setupSignedInFirebase(fb, {
      extraRoutes: [firestorePatchRoute(() => { patchCalls++; return never(); })],
    });

    const state = track(fb._fsSet({
      url: fb._docUrl() + fb._preconditionQuery({ exists: false }),
      token: 'id-token',
      body: '{"fields":{}}',
    }));
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);

    expect(patchCalls).toBe(1);
    expect(state.error).toMatchObject({ code: 'network' });
  });

  it('error body read hang → network', async () => {
    vi.useFakeTimers();
    const fb = loadFirebaseModule();
    await setupSignedInFirebase(fb, {
      extraRoutes: [firestoreGetRoute(async () => hangingFetchResponse(500))],
    });

    const state = track(fb._fsGet());
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    expect(state.settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(state.error).toMatchObject({ code: 'network' });
    expect(fb.fbIsSignedIn()).toBe(true);
  });

  it('token refresh hang → network and keeps the session', async () => {
    vi.useFakeTimers();
    const fb = loadFirebaseModule();
    let getCalls = 0;
    const { storage } = await setupSignedInFirebase(fb, {
      extraRoutes: [
        { match: (url) => url.includes('securetoken.googleapis.com'), respond: never },
        firestoreGetRoute(async () => { getCalls++; return jsonResponse(200, {}); }),
      ],
    });

    const state = track(fb._fsGet());
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);

    expect(state.error).toMatchObject({ code: 'network' });
    expect(getCalls).toBe(0);
    expect(fb.fbIsSignedIn()).toBe(true);
    expect(storage._data._fb_refresh).toBe('seed-refresh-token');
  });

  it('completed request leaves no timer behind', async () => {
    vi.useFakeTimers();
    const fb = loadFirebaseModule();
    const doc = { fields: {}, updateTime: '2024-01-01T00:00:00.000000000Z' };
    await setupSignedInFirebase(fb, {
      extraRoutes: [firestoreGetRoute(async () => jsonResponse(200, doc))],
    });

    await expect(fb._fsGet()).resolves.toEqual(doc);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('_fsGet with 200 and an unparsable body throws firestore', async () => {
    const fb = loadFirebaseModule();
    await setupSignedInFirebase(fb, {
      extraRoutes: [firestoreGetRoute(async () => ({
        ok: true,
        status: 200,
        json: async () => { throw new SyntaxError('Unexpected end of JSON input'); },
      }))],
    });

    await expect(fb._fsGet()).rejects.toMatchObject({ code: 'firestore', status: 200 });
  });
});
