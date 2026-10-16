import { describe, it, expect, vi } from 'vitest';
import { loadFirebaseModule } from './helpers/loadFirebaseModule.js';
import { jsonResponse } from './helpers/mockFetch.js';
import { setupSignedInFirebase, firestorePatchRoute } from './helpers/setupSignedInFirebase.js';

function firestoreDoc(fb, { items, updateTime }) {
  return {
    updateTime,
    fields: { items: fb._toFV(JSON.stringify(items)) },
  };
}

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
    const { storage, uid } = await setupSignedInFirebase(fb, {
      extraRoutes: [firestorePatchRoute(async () =>
        jsonResponse(200, { updateTime: '2024-06-01T12:00:00.500000000Z' }))],
    });

    const result = await fb._doSyncToCloud({ force: true });

    const expectedMs = new Date('2024-06-01T12:00:00.500Z').getTime();
    expect(result).toEqual({ ok: true, skipped: false, ts: expectedMs });
    expect(await fb._loadRevState()).toEqual({ editRev: 0, syncedRev: 0 });
    expect(await fb._loadCloudSyncTs()).toBe(expectedMs);
    // 成功上传后，本机同步基线跟进到当前账号
    expect(storage._data._fb_sync_baseline_uid).toBe(uid);
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

  it('does not lose an edit made while an upload is in flight', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      let patchCalls = 0;
      let releaseFirstPatch;
      const firstPatchGate = new Promise((resolve) => { releaseFirstPatch = resolve; });
      await setupSignedInFirebase(fb, {
        extraRoutes: [firestorePatchRoute(async () => {
          patchCalls += 1;
          if (patchCalls === 1) await firstPatchGate;
          return jsonResponse(200, { updateTime: `2024-01-0${patchCalls}T00:00:00.000000000Z` });
        })],
      });

      await fb.markLocalCloudDataChanged();          // 编辑 1
      await vi.advanceTimersByTimeAsync(2000);       // 触发上传（挂起在网关上）
      await fb.markLocalCloudDataChanged();          // 编辑 2（上传在途）
      releaseFirstPatch();
      await vi.advanceTimersByTimeAsync(4000);       // 第二次上传

      expect(patchCalls).toBe(2);
      expect(await fb._loadRevState()).toEqual({ editRev: 2, syncedRev: 2 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops a queued upload continuation when the account changed while the first upload was in flight', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const verifiedToken = `h.${b64url({ email_verified: true })}.s`;
      const patches = [];
      let releaseFirstPatch;
      const firstPatchGate = new Promise((resolve) => { releaseFirstPatch = resolve; });

      const { uid } = await setupSignedInFirebase(fb, {
        extraRoutes: [
          {
            match: (url) => url.includes('accounts:signInWithPassword'),
            respond: async () => jsonResponse(200, {
              idToken: verifiedToken, expiresIn: '3600', refreshToken: 'b-refresh', localId: 'account-b',
            }),
          },
          {
            match: (url, options = {}) =>
              url.includes('/documents/users/') && (!options.method || options.method === 'GET'),
            respond: async () => jsonResponse(200, firestoreDoc(fb, {
              items: [{ id: 'B-cloud-data' }], updateTime: '2024-06-02T00:00:00.000000000Z',
            })),
          },
          {
            match: (url, options = {}) => url.includes('/documents/users/') && options.method === 'PATCH',
            respond: async (url, options) => {
              const body = JSON.parse(options.body);
              patches.push({ url, items: JSON.parse(body.fields.items.stringValue) });
              if (patches.length === 1) await firstPatchGate;
              return jsonResponse(200, { updateTime: '2024-06-03T00:00:00.000000000Z' });
            },
          },
        ],
      });

      globalThis.items = [{ id: 'A-secret-leftover' }];
      await fb.markLocalCloudDataChanged();          // 编辑 1 → U1
      await vi.advanceTimersByTimeAsync(2000);       // U1 开始并挂起在网关上
      await fb.markLocalCloudDataChanged();          // 编辑 2 → 续跑排在 U1 之后
      await vi.advanceTimersByTimeAsync(2000);
      expect(patches.length).toBe(1);

      // U1 落定前登出旧账号、登录新账号
      await fb.fbSignOut();
      await fb.fbSignIn('b@example.com', 'password123');

      const pullPromise = fb._pullAfterSignIn(true); // 等待在途 U1
      releaseFirstPatch();
      await pullPromise;

      // 只有旧账号那一次 PATCH；排队续跑不得把旧账号遗留数据写入新账号
      expect(patches.map((p) => p.url.match(/users\/([^/]+)\//)[1])).toEqual([uid]);
      expect(JSON.stringify(patches[0].items)).toContain('A-secret-leftover');
      // 切换后的强制拉取仍应把新账号的云端快照应用下来
      expect(globalThis.items).toEqual([{ id: 'B-cloud-data' }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the persisted switch baseline intact when an upload response lands after sign-out', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const verifiedToken = `h.${b64url({ email_verified: true })}.s`;
      const patches = [];
      let releaseFirstPatch;
      const firstPatchGate = new Promise((resolve) => { releaseFirstPatch = resolve; });

      const { storage, uid } = await setupSignedInFirebase(fb, {
        extraRoutes: [
          {
            match: (url) => url.includes('accounts:signInWithPassword'),
            respond: async () => jsonResponse(200, {
              idToken: verifiedToken, expiresIn: '3600', refreshToken: 'b-refresh', localId: 'account-b',
            }),
          },
          {
            match: (url, options = {}) =>
              url.includes('/documents/users/') && (!options.method || options.method === 'GET'),
            respond: async () => jsonResponse(200, firestoreDoc(fb, {
              items: [{ id: 'B-cloud-data' }], updateTime: '2024-06-02T00:00:00.000000000Z',
            })),
          },
          {
            match: (url, options = {}) => url.includes('/documents/users/') && options.method === 'PATCH',
            respond: async (url, options) => {
              const body = JSON.parse(options.body);
              patches.push({ url, items: JSON.parse(body.fields.items.stringValue) });
              if (patches.length === 1) await firstPatchGate;
              // U1 的服务端时间刻意晚于 B 的云端文档，若落定后仍在册则会让 B 的拉取被跳过
              return jsonResponse(200, { updateTime: '2024-06-05T00:00:00.000000000Z' });
            },
          },
        ],
      });

      // 本机当前状态基于已登录的 A 账号
      storage._data._fb_sync_baseline_uid = uid;
      await fb._loadAuth();

      globalThis.items = [{ id: 'A-secret-leftover' }];
      await fb.markLocalCloudDataChanged();          // 编辑 1 → U1
      await vi.advanceTimersByTimeAsync(2000);       // U1 开始并挂起在网关上
      await fb.markLocalCloudDataChanged();          // 编辑 2 → 续跑排在 U1 之后
      await vi.advanceTimersByTimeAsync(2000);
      expect(patches.length).toBe(1);

      // U1 落定前登出：响应将在未登录状态下落地
      await fb.fbSignOut();
      releaseFirstPatch();
      await vi.advanceTimersByTimeAsync(0);

      // 迟到的响应不得覆写切换信号与云端时间戳
      expect(storage._data._fb_sync_baseline_uid).toBe(uid);
      expect(storage._data._fb_cloud_sync_ts).toBeUndefined();

      // 下一次登录仍能识别账号切换并强制拉取 B 的云端快照
      await fb.fbSignIn('b@example.com', 'password123');
      expect(fb._needsSwitchPull()).toBe(true);
      await fb._pullAfterSignIn();
      await vi.advanceTimersByTimeAsync(2600);       // 错误的自动上传会在此期间发出

      expect(globalThis.items).toEqual([{ id: 'B-cloud-data' }]);
      expect(patches.filter((p) => p.url.includes('account-b'))).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not clear the persisted baseline when a sign-out lands during the post-upload bookkeeping', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      const { storage, uid } = await setupSignedInFirebase(fb, {
        extraRoutes: [firestorePatchRoute(async () =>
          jsonResponse(200, { updateTime: '2024-06-01T12:00:00.000000000Z' }))],
      });

      // Hold the cloud-ts write so the sign-out lands exactly between the
      // post-response epoch re-check and the baseline write that follows the
      // awaited bookkeeping.
      const originalSet = storage.storage.local.set;
      let releaseTsWrite;
      const tsWriteGate = new Promise((resolve) => { releaseTsWrite = resolve; });
      let markTsWriteStarted;
      const tsWriteStarted = new Promise((resolve) => { markTsWriteStarted = resolve; });
      let gatedOnce = false;
      storage.storage.local.set = async (values) => {
        if (!gatedOnce && '_fb_cloud_sync_ts' in values) {
          gatedOnce = true;
          markTsWriteStarted();
          await tsWriteGate;
        }
        return originalSet(values);
      };

      globalThis.items = [{ id: 'local-edit' }];
      await fb.markLocalCloudDataChanged();
      vi.clearAllTimers();
      const uploadPromise = fb._doSyncToCloud();

      await tsWriteStarted;      // PATCH response handled; stuck in the bookkeeping write
      await fb.fbSignOut();      // _uid is nulled while that write is pending
      releaseTsWrite();
      await uploadPromise;

      // The upload belongs to the session captured before the sign-out: its uid
      // must stay the persisted baseline instead of being cleared to null.
      expect(storage._data._fb_sync_baseline_uid).toBe(uid);
      expect(fb.fbIsSignedIn()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
