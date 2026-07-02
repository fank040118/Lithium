import { describe, it, expect } from 'vitest';
import { loadFirebaseModule } from './helpers/loadFirebaseModule.js';
import { jsonResponse } from './helpers/mockFetch.js';
import { setupSignedInFirebase, firestorePatchRoute } from './helpers/setupSignedInFirebase.js';

describe('_doSyncToCloud / syncToCloud', () => {
  it('throws not-signed-in when there is no authenticated user', async () => {
    const fb = loadFirebaseModule();

    await expect(fb._doSyncToCloud()).rejects.toMatchObject({ code: 'not-signed-in' });
  });

  it('skips the upload when there are no local changes and force is not set', async () => {
    const fb = loadFirebaseModule();
    let patchCalls = 0;
    await setupSignedInFirebase(fb, {
      extraRoutes: [firestorePatchRoute(async () => {
        patchCalls += 1;
        return jsonResponse(200, { updateTime: '2024-01-01T00:00:00.000000000Z' });
      })],
    });

    const result = await fb._doSyncToCloud();

    expect(result).toEqual({ ok: true, skipped: true });
    expect(patchCalls).toBe(0);
  });

  it('uploads and persists the server updateTime when forced', async () => {
    const fb = loadFirebaseModule();
    await setupSignedInFirebase(fb, {
      extraRoutes: [firestorePatchRoute(async () =>
        jsonResponse(200, { updateTime: '2024-06-01T12:00:00.500000000Z' }))],
    });

    const result = await fb._doSyncToCloud({ force: true });

    const expectedMs = new Date('2024-06-01T12:00:00.500Z').getTime();
    expect(result).toEqual({ ok: true, skipped: false, ts: expectedMs });
    expect(await fb._loadLocalSyncTs()).toBe(expectedMs);
    expect(await fb._loadCloudSyncTs()).toBe(expectedMs);
  });

  it('throws a firestore error when the server response has no updateTime', async () => {
    const fb = loadFirebaseModule();
    await setupSignedInFirebase(fb, {
      extraRoutes: [firestorePatchRoute(async () => jsonResponse(200, {}))],
    });

    await expect(fb._doSyncToCloud({ force: true })).rejects.toMatchObject({ code: 'firestore' });
  });

  it('throws a firestore error when the server response has an unparseable updateTime', async () => {
    const fb = loadFirebaseModule();
    await setupSignedInFirebase(fb, {
      extraRoutes: [firestorePatchRoute(async () => jsonResponse(200, { updateTime: 'not-a-valid-timestamp' }))],
    });

    await expect(fb._doSyncToCloud({ force: true })).rejects.toMatchObject({ code: 'firestore' });
  });

  it('serializes concurrent syncToCloud calls instead of dropping them', async () => {
    const fb = loadFirebaseModule();
    let patchCalls = 0;
    await setupSignedInFirebase(fb, {
      extraRoutes: [firestorePatchRoute(async () => {
        patchCalls += 1;
        return jsonResponse(200, { updateTime: `2024-01-0${patchCalls}T00:00:00.000000000Z` });
      })],
    });

    const [first, second] = await Promise.all([
      fb.syncToCloud({ force: true }),
      fb.syncToCloud({ force: true }),
    ]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(patchCalls).toBe(2);
  });
});
