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
});
