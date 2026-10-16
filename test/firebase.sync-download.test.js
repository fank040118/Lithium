import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadFirebaseModule } from './helpers/loadFirebaseModule.js';
import { jsonResponse } from './helpers/mockFetch.js';
import { setupSignedInFirebase, firestoreGetRoute, firestorePatchRoute } from './helpers/setupSignedInFirebase.js';

afterEach(() => {
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
  delete globalThis.normalizeFolderChildItemSizes;
  document.body.innerHTML = '';
});

function firestoreDoc(fb, { items, engines, selectedEngine, clocks, gridColumns, updateTime }) {
  return {
    updateTime,
    fields: {
      items: fb._toFV(JSON.stringify(items)),
      engines: fb._toFV(JSON.stringify(engines)),
      selected_engine: fb._toFV(selectedEngine),
      clocks: fb._toFV(JSON.stringify(clocks)),
      grid_columns: fb._toFV(gridColumns),
    },
  };
}

describe('syncFromCloud', () => {
  it('returns false without a network call when not signed in', async () => {
    const fb = loadFirebaseModule();
    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      throw new Error('should not be called');
    };

    const result = await fb.syncFromCloud();

    expect(result).toBe(false);
    expect(fetchCalled).toBe(false);
  });

  it('returns false when the cloud document does not exist yet', async () => {
    const fb = loadFirebaseModule();
    await setupSignedInFirebase(fb, {
      extraRoutes: [firestoreGetRoute(async () => jsonResponse(404, {}))],
    });

    const result = await fb.syncFromCloud();

    expect(result).toBe(false);
  });

  it('skips applying cloud data when the cloud has not changed since the last sync', async () => {
    const fb = loadFirebaseModule();
    const sentinelItems = [{ id: 'local-only' }];
    await setupSignedInFirebase(fb, {
      extraRoutes: [firestoreGetRoute(async () => jsonResponse(200, firestoreDoc(fb, {
        items: [{ id: 'cloud' }], engines: [], selectedEngine: 'google', clocks: [], gridColumns: 4,
        updateTime: '2024-01-01T00:00:00.000000000Z',
      })))],
    });
    globalThis.items = sentinelItems;
    await fb._saveCloudSyncTs(new Date('2024-06-01T00:00:00.000Z').getTime());

    const result = await fb.syncFromCloud();

    expect(result).toBe(true);
    expect(globalThis.items).toBe(sentinelItems);
  });

  it('re-queues a pending upload when the cloud has not changed since the last sync', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      let patchCalls = 0;
      await setupSignedInFirebase(fb, {
        extraRoutes: [
          firestoreGetRoute(async () => jsonResponse(200, firestoreDoc(fb, {
            items: [{ id: 'cloud' }], engines: [], selectedEngine: 'google', clocks: [], gridColumns: 4,
            updateTime: '2024-06-01T00:00:00.000000000Z',
          }))),
          firestorePatchRoute(async () => {
            patchCalls += 1;
            return jsonResponse(200, { updateTime: '2024-06-01T00:00:00.000000000Z' });
          }),
        ],
      });
      await fb._saveCloudSyncTs(new Date('2024-06-01T00:00:00.000Z').getTime());
      await fb.markLocalCloudDataChanged();   // 上次上传失败的遗留脏数据
      vi.clearAllTimers();                    // 清掉 mark 排的定时器，只验证 syncFromCloud 自己补排

      const result = await fb.syncFromCloud();

      expect(result).toBe(true);
      expect(vi.getTimerCount()).toBe(1);     // 跳过分支必须补排上传
      await vi.advanceTimersByTimeAsync(2000);
      expect(patchCalls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps local edits and reschedules an upload when both local and cloud changed', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      const sentinelItems = [{ id: 'local-only' }];
      await setupSignedInFirebase(fb, {
        extraRoutes: [firestoreGetRoute(async () => jsonResponse(200, firestoreDoc(fb, {
          items: [{ id: 'cloud' }], engines: [], selectedEngine: 'google', clocks: [], gridColumns: 4,
          updateTime: '2024-06-02T00:00:00.000000000Z',
        })))],
      });
      globalThis.items = sentinelItems;
      await fb._saveCloudSyncTs(new Date('2024-06-01T00:00:00.000Z').getTime());
      await fb.markLocalCloudDataChanged();

      const result = await fb.syncFromCloud();

      expect(result).toBe(false);
      expect(globalThis.items).toBe(sentinelItems);
      expect(vi.getTimerCount()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for an in-flight upload before fetching the cloud document', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      const events = [];
      let releasePatch;
      const patchGate = new Promise((resolve) => { releasePatch = resolve; });
      await setupSignedInFirebase(fb, {
        extraRoutes: [
          firestoreGetRoute(async () => {
            events.push('get');
            return jsonResponse(200, firestoreDoc(fb, {
              items: [{ id: 'cloud' }], engines: [], selectedEngine: 'google', clocks: [], gridColumns: 4,
              updateTime: '2024-06-01T12:00:00.000000000Z',
            }));
          }),
          firestorePatchRoute(async () => {
            events.push('patch:start');
            await patchGate;
            events.push('patch:end');
            return jsonResponse(200, { updateTime: '2024-06-01T12:00:00.000000000Z' });
          }),
        ],
      });

      await fb.markLocalCloudDataChanged();
      await vi.advanceTimersByTimeAsync(2000);   // 上传开始并阻塞在网关上
      expect(events).toEqual(['patch:start']);

      const syncPromise = fb.syncFromCloud();
      await vi.advanceTimersByTimeAsync(50);     // 给抢先发起 GET 的机会
      expect(events).toEqual(['patch:start']);   // 在途上传未结束前不得发起 GET

      releasePatch();
      await syncPromise;

      expect(events).toEqual(['patch:start', 'patch:end', 'get']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies cloud data unconditionally when forced, even mid-conflict', async () => {
    const fb = loadFirebaseModule();
    const cloudItems = [{ id: 'cloud' }];
    await setupSignedInFirebase(fb, {
      extraRoutes: [firestoreGetRoute(async () => jsonResponse(200, firestoreDoc(fb, {
        items: cloudItems, engines: [], selectedEngine: 'google', clocks: [], gridColumns: 4,
        updateTime: '2024-06-02T00:00:00.000000000Z',
      })))],
    });
    globalThis.items = [{ id: 'local-only' }];
    await fb._saveCloudSyncTs(new Date('2024-06-01T00:00:00.000Z').getTime());
    await fb.markLocalCloudDataChanged();

    const result = await fb.syncFromCloud({ force: true });

    expect(result).toBe(true);
    expect(globalThis.items).toEqual(cloudItems);
  });

  it('does not treat a schema migration as a user edit when re-queuing the upload', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      const cloudUpdateTime = '2024-06-02T00:00:00.000000000Z';
      const expectedTs = fb._rfc3339ToMs(cloudUpdateTime);
      globalThis.normalizeFolderChildItemSizes = (items) => ({ items, changed: true });
      await setupSignedInFirebase(fb, {
        extraRoutes: [firestoreGetRoute(async () => jsonResponse(200, firestoreDoc(fb, {
          items: [{ id: 'cloud', type: 'folder', children: [] }], engines: [], selectedEngine: 'google', clocks: [], gridColumns: 4,
          updateTime: cloudUpdateTime,
        })))],
      });

      try {
        const result = await fb.syncFromCloud();

        expect(result).toBe(true);
        expect(await fb._loadCloudSyncTs()).toBe(expectedTs);
        expect(await fb._loadRevState()).toEqual({ editRev: 1, syncedRev: 0 });
        expect(vi.getTimerCount()).toBe(1);
      } finally {
        delete globalThis.normalizeFolderChildItemSizes;
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('rethrows when the network request fails', async () => {
    const fb = loadFirebaseModule();
    await setupSignedInFirebase(fb, {
      extraRoutes: [firestoreGetRoute(async () => { throw new TypeError('network down'); })],
    });

    await expect(fb.syncFromCloud()).rejects.toThrow();
  });

  it('records the signed-in uid as the sync baseline after applying cloud data', async () => {
    const fb = loadFirebaseModule();
    const { storage, uid } = await setupSignedInFirebase(fb, {
      extraRoutes: [firestoreGetRoute(async () => jsonResponse(200, firestoreDoc(fb, {
        items: [{ id: 'cloud' }], engines: [], selectedEngine: 'google', clocks: [], gridColumns: 4,
        updateTime: '2024-06-02T00:00:00.000000000Z',
      })))],
    });

    await fb.syncFromCloud({ force: true });

    expect(storage._data._fb_sync_baseline_uid).toBe(uid);
  });
});

describe('_pullAfterSignIn', () => {
  it('forces a pull after an account switch even when the stored cloud ts is newer', async () => {
    const fb = loadFirebaseModule();
    const cloudItems = [{ id: 'account-b-cloud' }];
    const { storage, uid } = await setupSignedInFirebase(fb, {
      extraRoutes: [firestoreGetRoute(async () => jsonResponse(200, firestoreDoc(fb, {
        items: cloudItems, engines: [], selectedEngine: 'google', clocks: [], gridColumns: 4,
        updateTime: '2024-06-02T00:00:00.000000000Z',
      })))],
    });
    // 持久化基线仍指向上一次成功同步的账号 → 切号未解决
    storage._data._fb_sync_baseline_uid = 'account-a';
    await fb._loadAuth();
    // 场景：上一次同步时间戳比新账号云文档还新（旧账号残留）
    storage._data._fb_cloud_sync_ts = new Date('2024-12-01T00:00:00.000Z').getTime();
    await fb._loadCloudSyncTs();
    globalThis.items = [{ id: 'leftover-from-account-a' }];

    await fb._pullAfterSignIn();

    expect(globalThis.items).toEqual(cloudItems);
    expect(storage._data._fb_sync_baseline_uid).toBe(uid);
  });

  it('keeps the non-forced pull semantics on a first sign-in without a baseline', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      const cloudItems = [{ id: 'account-b-cloud' }];
      const { storage } = await setupSignedInFirebase(fb, {
        extraRoutes: [firestoreGetRoute(async () => jsonResponse(200, firestoreDoc(fb, {
          items: cloudItems, engines: [], selectedEngine: 'google', clocks: [], gridColumns: 4,
          updateTime: '2024-06-02T00:00:00.000000000Z',
        })))],
      });
      // 无基线（全新设备首次登录）：_pullAfterSignIn() 保持非强制语义，
      // 旧 _lastCloudTs 使 syncFromCloud 跳过，items 保持 leftover，且不排上传
      const leftoverItems = [{ id: 'leftover-from-account-a' }];
      storage._data._fb_cloud_sync_ts = new Date('2024-12-01T00:00:00.000Z').getTime();
      await fb._loadCloudSyncTs();
      globalThis.items = leftoverItems;

      await fb._pullAfterSignIn();

      expect(globalThis.items).toBe(leftoverItems);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('schedules an upload after sign-in when the cloud document does not exist yet', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      await setupSignedInFirebase(fb, {
        extraRoutes: [firestoreGetRoute(async () => jsonResponse(404, {}))],
      });
      globalThis.items = [{ id: 'local' }];

      await fb._pullAfterSignIn();

      expect(vi.getTimerCount()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not schedule an upload when the switch pull fails (fail-safe)', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      let patchCalls = 0;
      await setupSignedInFirebase(fb, {
        extraRoutes: [
          firestoreGetRoute(async () => { throw new TypeError('network down'); }),
          firestorePatchRoute(async () => {
            patchCalls += 1;
            return jsonResponse(200, { updateTime: '2024-06-02T00:00:00.000000000Z' });
          }),
        ],
      });
      globalThis.items = [{ id: 'leftover-from-account-a' }];
      await fb.markLocalCloudDataChanged();   // 本地脏数据（上一账号残留）
      vi.clearAllTimers();                    // 只观察 _pullAfterSignIn 是否自己排上传

      await fb._pullAfterSignIn(true);        // 切换后的强制拉取，GET 抛网络错误

      // fail-safe：拉取失败不代表“云端无数据”，不得把本地脏数据 PATCH 到新账号文档
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(2000);
      expect(patchCalls).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('blocks automatic uploads until a switched account has been pulled successfully', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      let getFails = true;
      let patchCalls = 0;
      const cloudItems = [{ id: 'account-b-cloud' }];
      const { storage, uid } = await setupSignedInFirebase(fb, {
        extraRoutes: [
          firestoreGetRoute(async () => {
            if (getFails) throw new TypeError('network down');
            return jsonResponse(200, firestoreDoc(fb, {
              items: cloudItems, engines: [], selectedEngine: 'google', clocks: [], gridColumns: 4,
              updateTime: '2024-06-02T00:00:00.000000000Z',
            }));
          }),
          firestorePatchRoute(async () => {
            patchCalls += 1;
            return jsonResponse(200, { updateTime: '2024-06-03T00:00:00.000000000Z' });
          }),
        ],
      });
      // 持久化基线仍指向上一账号 → 切号未解决
      storage._data._fb_sync_baseline_uid = 'account-a';
      await fb._loadAuth();

      globalThis.items = [{ id: 'leftover-from-account-a' }];
      await fb.markLocalCloudDataChanged();   // 本地脏数据（上一账号残留）
      vi.clearAllTimers();                    // 只观察拉取/自动上传行为

      await fb._pullAfterSignIn();            // 基线≠uid → 内部强制拉取，GET 抛错

      // fail-safe：拉取失败不代表“云端无数据”，不得把本地脏数据 PATCH 到新账号文档
      expect(vi.getTimerCount()).toBe(0);

      // 拉取失败后的本地编辑：自动上传必须因切号未解决而跳过
      await fb.markLocalCloudDataChanged();
      await vi.advanceTimersByTimeAsync(2000);
      expect(patchCalls).toBe(0);
      expect(vi.getTimerCount()).toBe(0);

      // 网络恢复后再次拉取：云端为准，脏被清，基线跟进
      getFails = false;
      await fb._pullAfterSignIn();

      expect(globalThis.items).toEqual(cloudItems);
      expect(fb._isDirty()).toBe(false);
      expect(storage._data._fb_sync_baseline_uid).toBe(uid);
      expect(fb._needsSwitchPull()).toBe(false);
      expect(patchCalls).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
