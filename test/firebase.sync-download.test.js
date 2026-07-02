import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadFirebaseModule } from './helpers/loadFirebaseModule.js';
import { jsonResponse } from './helpers/mockFetch.js';
import { setupSignedInFirebase, firestoreGetRoute } from './helpers/setupSignedInFirebase.js';

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
      await fb._saveLocalSyncTs(new Date('2024-06-01T12:00:00.000Z').getTime());

      const result = await fb.syncFromCloud();

      expect(result).toBe(false);
      expect(globalThis.items).toBe(sentinelItems);
      expect(vi.getTimerCount()).toBe(1);
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
    await fb._saveLocalSyncTs(new Date('2024-06-01T12:00:00.000Z').getTime());

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
        expect(await fb._loadLocalSyncTs()).toBe(expectedTs);
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
