import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadFirebaseModule } from './helpers/loadFirebaseModule.js';
import { jsonResponse, createRoutedFetch } from './helpers/mockFetch.js';
import { createMockChromeStorage } from './helpers/mockChromeStorage.js';
import { installUiMocks } from './helpers/uiMocks.js';
import { TEST_UID, setupSignedInFirebase, firestoreGetRoute, firestorePatchRoute } from './helpers/setupSignedInFirebase.js';

// A faithful stand-in for app.js's sanitizeItemsShape (which is not loaded in
// firebase tests) covering the behaviors these cases rely on: folder children
// defaulting to [], unknown types coerced to 'link', stray children dropped
// from links, and fresh ids generated for entries missing one.
function mockSanitizeItemsShape(list) {
  let changed = false;
  const items = list
    .filter((entry) => !!entry && typeof entry === 'object' && !Array.isArray(entry))
    .map((entry) => {
      let next = { ...entry };
      if (typeof next.id !== 'string' || next.id === '') {
        next = { ...next, id: `gen-${Math.random().toString(36).slice(2)}` };
        changed = true;
      }
      if (next.type !== 'link' && next.type !== 'folder' && next.type !== 'weather') {
        next = { ...next, type: 'link' };
        changed = true;
      }
      if (next.type === 'link') {
        if ('children' in next) {
          next = { ...next };
          delete next.children;
          changed = true;
        }
      } else if (next.type === 'folder' && !Array.isArray(next.children)) {
        next = { ...next, children: [] };
        changed = true;
      }
      return next;
    });
  return { items, changed };
}

// Mirrors app.js clampMainGridColumns: 6..12 inclusive.
function mockClampColumns(v) {
  const parsed = parseInt(v, 10);
  if (Number.isNaN(parsed)) return 8;
  return Math.max(6, Math.min(12, parsed));
}

// Build a full cloud document (all five sync fields) for the conflict cases.
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

// Shorthand for a well-formed cloud document where only `items` differs.
const CLOUD_TS = '2024-06-02T00:00:00.000000000Z';
const PATCH_TS = '2024-06-03T00:00:00.000000000Z';
function cloudDoc(fb, items, updateTime = CLOUD_TS) {
  return firestoreDoc(fb, {
    items, engines: [], selectedEngine: 'google', clocks: [], gridColumns: 4, updateTime,
  });
}

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
  delete globalThis.sanitizeItemsShape;
  delete globalThis.normalizeFolderChildItemSizes;
  delete globalThis.clampMainGridColumns;
  delete globalThis.onSyncConflict;
  delete globalThis.isStorageLoadFailed;
  delete globalThis.t;
  delete globalThis.showToast;
  document.body.innerHTML = '';
});

describe('_canonicalJson', () => {
  it('treats key-order-different equivalent objects as equal', () => {
    const fb = loadFirebaseModule();

    expect(fb._canonicalJson({ id: 'a', type: 'folder' }))
      .toBe(fb._canonicalJson({ type: 'folder', id: 'a' }));

    expect(fb._canonicalJson({ items: [{ id: 'a', name: 'x' }], engines: [] }))
      .toBe(fb._canonicalJson({ engines: [], items: [{ name: 'x', id: 'a' }] }));
  });
});

describe('_cloudSnapshotFromFields', () => {
  it('maps every missing key to undefined', () => {
    const fb = loadFirebaseModule();

    const snap = fb._cloudSnapshotFromFields({});

    expect(snap.items).toBeUndefined();
    expect(snap.engines).toBeUndefined();
    expect(snap.selected_engine).toBeUndefined();
    expect(snap.clocks).toBeUndefined();
    expect(snap.grid_columns).toBeUndefined();
  });

  it('treats a nullish fields map as all-undefined', () => {
    const fb = loadFirebaseModule();

    expect(fb._cloudSnapshotFromFields(undefined).items).toBeUndefined();
    expect(fb._cloudSnapshotFromFields(null).items).toBeUndefined();
  });

  it('decodes present fields to their parsed values', () => {
    const fb = loadFirebaseModule();

    const snap = fb._cloudSnapshotFromFields({
      items: fb._toFV(JSON.stringify([{ id: 'a' }])),
      engines: fb._toFV(JSON.stringify([{ id: 'e1' }])),
      selected_engine: fb._toFV('e1'),
      clocks: fb._toFV(JSON.stringify([{ id: 'c1' }])),
      grid_columns: fb._toFV(8),
    });

    expect(snap.items).toEqual([{ id: 'a' }]);
    expect(snap.engines).toEqual([{ id: 'e1' }]);
    expect(snap.selected_engine).toBe('e1');
    expect(snap.clocks).toEqual([{ id: 'c1' }]);
    expect(snap.grid_columns).toBe(8);
  });

  it('decodes an explicit Firestore nullValue to null (not undefined)', () => {
    const fb = loadFirebaseModule();

    const snap = fb._cloudSnapshotFromFields({ items: { nullValue: null } });

    expect(snap.items).toBeNull();
  });

  it('lets _compareSnapshots treat an explicit-null field as a skipped field', () => {
    const fb = loadFirebaseModule();

    const local = { items: [{ id: 'a' }] };
    const cloud = fb._cloudSnapshotFromFields({ items: { nullValue: null } });

    const result = fb._compareSnapshots(local, cloud);
    expect(result.equal).toBe(true);
    expect(result.skippedFields).toContain('items');
  });
});

describe('_compareSnapshots — items normalization', () => {
  it('normalizes folder children, unknown type, and stray link children to equal', () => {
    const fb = loadFirebaseModule();
    globalThis.sanitizeItemsShape = mockSanitizeItemsShape;

    const local = { items: [{ id: 'a', type: 'folder' }] };
    const cloud = { items: [{ id: 'a', type: 'folder', children: [] }] };
    expect(fb._compareSnapshots(local, cloud).equal).toBe(true);

    const local2 = { items: [{ id: 'a', type: 'banana' }] };
    const cloud2 = { items: [{ id: 'a', type: 'link' }] };
    expect(fb._compareSnapshots(local2, cloud2).equal).toBe(true);

    const local3 = { items: [{ id: 'a', type: 'link', children: [{ id: 'b' }] }] };
    const cloud3 = { items: [{ id: 'a', type: 'link' }] };
    expect(fb._compareSnapshots(local3, cloud3).equal).toBe(true);
  });

  it('treats a cloud item missing an id as unequal (sanitize generates a fresh id)', () => {
    const fb = loadFirebaseModule();
    globalThis.sanitizeItemsShape = mockSanitizeItemsShape;

    const local = { items: [{ id: 'a', type: 'link', name: 'x' }] };
    const cloud = { items: [{ type: 'link', name: 'x' }] };

    const result = fb._compareSnapshots(local, cloud);
    expect(result.equal).toBe(false);
  });
});

describe('_compareSnapshots — skipped fields', () => {
  it('reports items as skipped when cloud items are missing and other fields differ', () => {
    const fb = loadFirebaseModule();
    globalThis.sanitizeItemsShape = mockSanitizeItemsShape;

    const local = { items: [{ id: 'a' }], engines: [{ id: 'e1' }] };
    const cloud = { engines: [{ id: 'other' }] };

    const result = fb._compareSnapshots(local, cloud);
    expect(result.equal).toBe(false);
    expect(result.skippedFields).toContain('items');
  });

  it('reports items as skipped and equal when only cloud items are missing', () => {
    const fb = loadFirebaseModule();
    globalThis.sanitizeItemsShape = mockSanitizeItemsShape;

    const local = { items: [{ id: 'a' }], engines: [{ id: 'e1' }] };
    const cloud = { engines: [{ id: 'e1' }] };

    const result = fb._compareSnapshots(local, cloud);
    expect(result.equal).toBe(true);
    expect(result.skippedFields).toContain('items');
  });
});

describe('_compareSnapshots — clocks', () => {
  it('treats an empty cloud clocks array as equal to a missing one (and skips it)', () => {
    const fb = loadFirebaseModule();

    const local = { clocks: [] };
    const cloudMissing = {};
    const resultMissing = fb._compareSnapshots(local, cloudMissing);
    expect(resultMissing.equal).toBe(true);
    expect(resultMissing.skippedFields).toContain('clocks');

    const cloudEmpty = { clocks: [] };
    expect(fb._compareSnapshots(local, cloudEmpty).equal).toBe(true);
    expect(fb._compareSnapshots(local, cloudEmpty).skippedFields).not.toContain('clocks');
  });

  it('treats an empty clock list as unequal to a non-empty one', () => {
    const fb = loadFirebaseModule();

    const local = { clocks: [] };
    const cloud = { clocks: [{ id: 'c1', tz: 'UTC' }] };

    expect(fb._compareSnapshots(local, cloud).equal).toBe(false);
  });
});

describe('_compareSnapshots — grid_columns', () => {
  it('compares grid_columns after clamping', () => {
    const fb = loadFirebaseModule();
    globalThis.clampMainGridColumns = mockClampColumns;

    // 999 clamps to 12; local 12 clamps to 12 → equal
    expect(fb._compareSnapshots(
      { grid_columns: 12 }, { grid_columns: 999 },
    ).equal).toBe(true);

    // 999 clamps to 12; local 4 clamps to 6 → unequal
    expect(fb._compareSnapshots(
      { grid_columns: 4 }, { grid_columns: 999 },
    ).equal).toBe(false);
  });
});

describe('_compareSnapshots — selected_engine', () => {
  it('skips an empty or missing selected_engine, and compares non-empty values', () => {
    const fb = loadFirebaseModule();

    const local = { selected_engine: 'google' };

    expect(fb._compareSnapshots(local, {}).equal).toBe(true);
    expect(fb._compareSnapshots(local, {}).skippedFields).toContain('selected_engine');
    expect(fb._compareSnapshots(local, { selected_engine: '' }).equal).toBe(true);
    expect(fb._compareSnapshots(local, { selected_engine: '' }).skippedFields).toContain('selected_engine');
    expect(fb._compareSnapshots(local, { selected_engine: 'duckduckgo' }).equal).toBe(false);
  });
});

describe('_compareSnapshots — engines', () => {
  it('compares engines raw without sanitizing', () => {
    const fb = loadFirebaseModule();
    globalThis.sanitizeItemsShape = mockSanitizeItemsShape;

    // A malformed engine entry is compared as-is: no shape normalization is
    // applied to engines, so an entry missing a name stays unequal.
    const local = { engines: [{ id: 'e1', name: 'Engine' }] };
    const cloudMalformed = { engines: [{ id: 'e1' }] };
    expect(fb._compareSnapshots(local, cloudMalformed).equal).toBe(false);

    const cloudMatching = { engines: [{ id: 'e1', name: 'Engine' }] };
    expect(fb._compareSnapshots(local, cloudMatching).equal).toBe(true);
  });
});

describe('_buildSyncSnapshot', () => {
  it('reflects the current global values', () => {
    const fb = loadFirebaseModule();
    globalThis.items = [{ id: 'a', type: 'link' }];
    globalThis.customEngines = [{ id: 'e1', name: 'E' }];
    globalThis.selectedEngineId = 'e1';
    globalThis.clocks = [{ id: 'c1', tz: 'UTC' }];
    globalThis.mainGridColumns = 10;

    expect(fb._buildSyncSnapshot()).toEqual({
      items: [{ id: 'a', type: 'link' }],
      engines: [{ id: 'e1', name: 'E' }],
      selected_engine: 'e1',
      clocks: [{ id: 'c1', tz: 'UTC' }],
      grid_columns: 10,
    });
  });
});

describe('_doSyncToCloud payload equivalence', () => {
  it('builds the PATCH payload field-for-field from _buildSyncSnapshot', async () => {
    const fb = loadFirebaseModule();
    let capturedBody = null;
    await setupSignedInFirebase(fb, {
      extraRoutes: [firestorePatchRoute(async (url, options) => {
        capturedBody = JSON.parse(options.body);
        return jsonResponse(200, { updateTime: '2024-06-01T12:00:00.500000000Z' });
      })],
    });

    globalThis.items = [{ id: 'a', type: 'folder', name: 'Folder', children: [] }];
    globalThis.customEngines = [{ id: 'e1', name: 'Engine', url: 'https://e' }];
    globalThis.selectedEngineId = 'e1';
    globalThis.clocks = [{ id: 'c1', tz: 'UTC' }];
    globalThis.mainGridColumns = 8;

    const snap = fb._buildSyncSnapshot();

    await fb._doSyncToCloud({ force: true });

    const fields = capturedBody.fields;
    expect(fields.items.stringValue).toBe(JSON.stringify(snap.items));
    expect(fields.engines.stringValue).toBe(JSON.stringify(snap.engines));
    expect(fields.selected_engine.stringValue).toBe(snap.selected_engine);
    expect(fields.clocks.stringValue).toBe(JSON.stringify(snap.clocks));
    expect(parseInt(fields.grid_columns.integerValue, 10)).toBe(snap.grid_columns);
    expect(fields.updated_at.integerValue).toBeTruthy();
    expect(Number(fields.updated_at.integerValue)).toBeGreaterThan(0);
  });
});

describe('syncFromCloud conflict detection', () => {
  function b64url(payload) {
    return Buffer.from(JSON.stringify(payload)).toString('base64url');
  }

  it('flags a conflict (not an account switch) on first login with dirty local and a different cloud', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      const verifiedToken = `h.${b64url({ email_verified: true })}.s`;
      const conflictHook = vi.fn();
      globalThis.onSyncConflict = conflictHook;
      let patchCalls = 0;

      // 首登无基线：不预置 _fb_uid（避免 _loadAuth 播种基线），走 fbSignIn。
      globalThis.chrome = createMockChromeStorage({});
      globalThis.fetch = createRoutedFetch([
        {
          match: (url) => url.includes('accounts:signInWithPassword'),
          respond: async () => jsonResponse(200, {
            idToken: verifiedToken, expiresIn: '3600', refreshToken: 'b-refresh', localId: 'first-uid',
          }),
        },
        {
          match: (url, options = {}) =>
            url.includes('/documents/users/') && (!options.method || options.method === 'GET'),
          respond: async () => jsonResponse(200, firestoreDoc(fb, {
            items: [{ id: 'cloud' }], engines: [], selectedEngine: 'google', clocks: [], gridColumns: 4,
            updateTime: '2024-06-02T00:00:00.000000000Z',
          })),
        },
        {
          match: (url, options = {}) => url.includes('/documents/users/') && options.method === 'PATCH',
          respond: async () => {
            patchCalls += 1;
            return jsonResponse(200, { updateTime: '2024-06-03T00:00:00.000000000Z' });
          },
        },
      ]);

      globalThis.items = [{ id: 'local-only' }];
      globalThis.customEngines = [];
      globalThis.selectedEngineId = 'google';
      globalThis.clocks = [];
      globalThis.mainGridColumns = 4;
      globalThis.applyWallpaper = () => {};
      globalThis.applyMainGridColumns = () => {};
      globalThis.render = () => {};
      globalThis.getSelectedEngine = () => ({ name: 'Google' });
      document.body.innerHTML = '<div id="engine-name"></div>';

      await fb.fbSignIn('x@example.com', 'pw');
      await fb.markLocalCloudDataChanged();
      vi.clearAllTimers();

      const result = await fb.syncFromCloud({ trigger: 'sign-in' });

      expect(result).toBe(false);
      expect(globalThis.items).toEqual([{ id: 'local-only' }]);
      expect(patchCalls).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(conflictHook).toHaveBeenCalledTimes(1);
      expect(conflictHook).toHaveBeenCalledWith(expect.objectContaining({
        isAccountSwitch: false,
        trigger: 'sign-in',
      }));
      expect(fb.fbGetSyncConflict()).not.toBeNull();
      expect(fb.fbGetSyncConflict().isAccountSwitch).toBe(false);
    } finally {
      delete globalThis.onSyncConflict;
      vi.useRealTimers();
    }
  });

  it('applies cleanly when local and cloud are identical (no conflict)', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      const conflictHook = vi.fn();
      globalThis.onSyncConflict = conflictHook;
      const cloudItems = [{ id: 'cloud' }];
      let patchCalls = 0;
      const { storage, uid } = await setupSignedInFirebase(fb, {
        extraRoutes: [
          firestoreGetRoute(async () => jsonResponse(200, firestoreDoc(fb, {
            items: cloudItems, engines: [], selectedEngine: 'google', clocks: [], gridColumns: 4,
            updateTime: '2024-06-02T00:00:00.000000000Z',
          }))),
          firestorePatchRoute(async () => {
            patchCalls += 1;
            return jsonResponse(200, { updateTime: '2024-06-03T00:00:00.000000000Z' });
          }),
        ],
      });
      globalThis.items = [{ id: 'cloud' }];
      await fb.markLocalCloudDataChanged();
      vi.clearAllTimers();

      const result = await fb.syncFromCloud();

      expect(result).toBe(true);
      expect(conflictHook).not.toHaveBeenCalled();
      expect(fb.fbGetSyncConflict()).toBeNull();
      expect(globalThis.items).toEqual(cloudItems);
      expect(fb._isDirty()).toBe(false);
      expect(storage._data._fb_sync_baseline_uid).toBe(uid);
      expect(vi.getTimerCount()).toBe(0);   // clean apply queues no re-upload
      expect(patchCalls).toBe(0);
    } finally {
      delete globalThis.onSyncConflict;
      vi.useRealTimers();
    }
  });

  it('does not raise a conflict when the cloud is unchanged and dirty (P0-3 re-queue)', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      let patchCalls = 0;
      const conflictHook = vi.fn();
      globalThis.onSyncConflict = conflictHook;
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
      await fb.markLocalCloudDataChanged();
      vi.clearAllTimers();

      const result = await fb.syncFromCloud();

      expect(result).toBe(true);
      expect(conflictHook).not.toHaveBeenCalled();
      expect(fb.fbGetSyncConflict()).toBeNull();
      expect(vi.getTimerCount()).toBe(1);   // 跳过分支必须补排上传
      await vi.advanceTimersByTimeAsync(2000);
      expect(patchCalls).toBe(1);
    } finally {
      delete globalThis.onSyncConflict;
      vi.useRealTimers();
    }
  });

  it('pauses auto-upload while a conflict is pending', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      let patchCalls = 0;
      const conflictHook = vi.fn();
      globalThis.onSyncConflict = conflictHook;
      await setupSignedInFirebase(fb, {
        extraRoutes: [
          firestoreGetRoute(async () => jsonResponse(200, firestoreDoc(fb, {
            items: [{ id: 'cloud' }], engines: [], selectedEngine: 'google', clocks: [], gridColumns: 4,
            updateTime: '2024-06-02T00:00:00.000000000Z',
          }))),
          firestorePatchRoute(async () => {
            patchCalls += 1;
            return jsonResponse(200, { updateTime: '2024-06-03T00:00:00.000000000Z' });
          }),
        ],
      });
      globalThis.items = [{ id: 'local-only' }];
      await fb._saveCloudSyncTs(new Date('2024-06-01T00:00:00.000Z').getTime());
      await fb.markLocalCloudDataChanged();
      vi.clearAllTimers();

      await fb.syncFromCloud();

      expect(fb.fbGetSyncConflict()).not.toBeNull();
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(2500);
      expect(patchCalls).toBe(0);
    } finally {
      delete globalThis.onSyncConflict;
      vi.useRealTimers();
    }
  });

  it('does not re-queue auto-upload from a user edit while a conflict is pending', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      let patchCalls = 0;
      const conflictHook = vi.fn();
      globalThis.onSyncConflict = conflictHook;
      await setupSignedInFirebase(fb, {
        extraRoutes: [
          firestoreGetRoute(async () => jsonResponse(200, firestoreDoc(fb, {
            items: [{ id: 'cloud' }], engines: [], selectedEngine: 'google', clocks: [], gridColumns: 4,
            updateTime: '2024-06-02T00:00:00.000000000Z',
          }))),
          firestorePatchRoute(async () => {
            patchCalls += 1;
            return jsonResponse(200, { updateTime: '2024-06-03T00:00:00.000000000Z' });
          }),
        ],
      });
      globalThis.items = [{ id: 'local-only' }];
      await fb._saveCloudSyncTs(new Date('2024-06-01T00:00:00.000Z').getTime());
      await fb.markLocalCloudDataChanged();
      vi.clearAllTimers();

      await fb.syncFromCloud();
      expect(fb.fbGetSyncConflict()).not.toBeNull();

      await fb.markLocalCloudDataChanged();   // 未决期间的用户编辑
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(2500);
      expect(patchCalls).toBe(0);
    } finally {
      delete globalThis.onSyncConflict;
      vi.useRealTimers();
    }
  });

  it('does not throw when no conflict hook is registered', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      let patchCalls = 0;
      await setupSignedInFirebase(fb, {
        extraRoutes: [
          firestoreGetRoute(async () => jsonResponse(200, firestoreDoc(fb, {
            items: [{ id: 'cloud' }], engines: [], selectedEngine: 'google', clocks: [], gridColumns: 4,
            updateTime: '2024-06-02T00:00:00.000000000Z',
          }))),
          firestorePatchRoute(async () => {
            patchCalls += 1;
            return jsonResponse(200, { updateTime: '2024-06-03T00:00:00.000000000Z' });
          }),
        ],
      });
      globalThis.items = [{ id: 'local-only' }];
      await fb._saveCloudSyncTs(new Date('2024-06-01T00:00:00.000Z').getTime());
      await fb.markLocalCloudDataChanged();
      vi.clearAllTimers();

      await expect(fb.syncFromCloud()).resolves.toBe(false);
      expect(fb.fbGetSyncConflict()).not.toBeNull();
      await vi.advanceTimersByTimeAsync(2500);
      expect(patchCalls).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('survives a throwing conflict hook', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      let patchCalls = 0;
      globalThis.onSyncConflict = () => { throw new Error('hook boom'); };
      await setupSignedInFirebase(fb, {
        extraRoutes: [
          firestoreGetRoute(async () => jsonResponse(200, firestoreDoc(fb, {
            items: [{ id: 'cloud' }], engines: [], selectedEngine: 'google', clocks: [], gridColumns: 4,
            updateTime: '2024-06-02T00:00:00.000000000Z',
          }))),
          firestorePatchRoute(async () => {
            patchCalls += 1;
            return jsonResponse(200, { updateTime: '2024-06-03T00:00:00.000000000Z' });
          }),
        ],
      });
      globalThis.items = [{ id: 'local-only' }];
      await fb._saveCloudSyncTs(new Date('2024-06-01T00:00:00.000Z').getTime());
      await fb.markLocalCloudDataChanged();
      vi.clearAllTimers();

      const result = await fb.syncFromCloud();

      expect(result).toBe(false);
      expect(fb.fbGetSyncConflict()).not.toBeNull();
      await vi.advanceTimersByTimeAsync(2500);
      expect(patchCalls).toBe(0);
    } finally {
      delete globalThis.onSyncConflict;
      vi.useRealTimers();
    }
  });

  it('detects a conflict even when the cloud document has no updateTime', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      const conflictHook = vi.fn();
      globalThis.onSyncConflict = conflictHook;
      await setupSignedInFirebase(fb, {
        extraRoutes: [firestoreGetRoute(async () => jsonResponse(200, {
          fields: {
            items: fb._toFV(JSON.stringify([{ id: 'cloud' }])),
            engines: fb._toFV(JSON.stringify([])),
            selected_engine: fb._toFV('google'),
            clocks: fb._toFV(JSON.stringify([])),
            grid_columns: fb._toFV(4),
          },
        }))],
      });
      globalThis.items = [{ id: 'local-only' }];
      await fb.markLocalCloudDataChanged();
      vi.clearAllTimers();

      const result = await fb.syncFromCloud();

      expect(result).toBe(false);
      expect(fb.fbGetSyncConflict()).not.toBeNull();
      expect(conflictHook).toHaveBeenCalledTimes(1);
    } finally {
      delete globalThis.onSyncConflict;
      vi.useRealTimers();
    }
  });

  it('drops a late GET response after sign-out with zero writes', async () => {
    const fb = loadFirebaseModule();
    let releaseGet;
    let markGetStarted;
    const getStarted = new Promise((resolve) => { markGetStarted = resolve; });
    const getGate = new Promise((resolve) => { releaseGet = resolve; });
    const conflictHook = vi.fn();
    globalThis.onSyncConflict = conflictHook;
    const { storage } = await setupSignedInFirebase(fb, {
      extraRoutes: [firestoreGetRoute(async () => {
        markGetStarted();
        await getGate;
        return jsonResponse(200, firestoreDoc(fb, {
          items: [{ id: 'cloud' }], engines: [], selectedEngine: 'google', clocks: [], gridColumns: 4,
          updateTime: '2024-06-02T00:00:00.000000000Z',
        }));
      })],
    });
    globalThis.items = [{ id: 'local-only' }];

    const pullPromise = fb.syncFromCloud();
    await getStarted;               // GET 已发起并挂起在网关上
    await fb.fbSignOut();           // 在途 GET 期间登出
    releaseGet();
    const result = await pullPromise;

    expect(result).toBe(false);
    expect(fb.fbGetSyncConflict()).toBeNull();
    expect(conflictHook).not.toHaveBeenCalled();
    expect(globalThis.items).toEqual([{ id: 'local-only' }]);
    // 迟到的响应不得复活云端时间戳，也不得改写基线
    expect(storage._data._fb_cloud_sync_ts).toBeUndefined();
    expect(storage._data._fb_sync_baseline_uid).toBe(TEST_UID);
  });

  it('re-uploads a skipped local field after an equal apply (I8)', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      let patchCalls = 0;
      let capturedBody = null;
      await setupSignedInFirebase(fb, {
        extraRoutes: [
          firestoreGetRoute(async () => jsonResponse(200, {
            updateTime: '2024-06-02T00:00:00.000000000Z',
            fields: {
              items: fb._toFV(JSON.stringify([{ id: 'cloud' }])),
              engines: fb._toFV(JSON.stringify([])),
              selected_engine: fb._toFV('google'),
              grid_columns: fb._toFV(4),
              // clocks 字段缺失 → 被跳过，落地后需补传本地值
            },
          })),
          firestorePatchRoute(async (url, options) => {
            patchCalls += 1;
            capturedBody = JSON.parse(options.body);
            return jsonResponse(200, { updateTime: '2024-06-03T00:00:00.000000000Z' });
          }),
        ],
      });
      globalThis.items = [{ id: 'cloud' }];
      globalThis.clocks = [{ id: 'c1', tz: 'UTC' }];
      await fb.markLocalCloudDataChanged();
      vi.clearAllTimers();

      const result = await fb.syncFromCloud();

      expect(result).toBe(true);
      // 落地后缺字段的本地值需补传：排一次上传
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(2000);
      expect(patchCalls).toBe(1);
      expect(JSON.parse(capturedBody.fields.clocks.stringValue)).toEqual([{ id: 'c1', tz: 'UTC' }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('raises a conflict on a manual pull when local is dirty and cloud differs', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      let patchCalls = 0;
      const conflictHook = vi.fn();
      globalThis.onSyncConflict = conflictHook;
      await setupSignedInFirebase(fb, {
        extraRoutes: [
          firestoreGetRoute(async () => jsonResponse(200, firestoreDoc(fb, {
            items: [{ id: 'cloud' }], engines: [], selectedEngine: 'google', clocks: [], gridColumns: 4,
            updateTime: '2024-06-02T00:00:00.000000000Z',
          }))),
          firestorePatchRoute(async () => {
            patchCalls += 1;
            return jsonResponse(200, { updateTime: '2024-06-03T00:00:00.000000000Z' });
          }),
        ],
      });
      globalThis.items = [{ id: 'local-only' }];
      await fb._saveCloudSyncTs(new Date('2024-06-01T00:00:00.000Z').getTime());
      await fb.markLocalCloudDataChanged();
      vi.clearAllTimers();

      const result = await fb.syncFromCloud({ mode: 'forced', trigger: 'manual-pull' });

      expect(result).toBe(false);
      expect(globalThis.items).toEqual([{ id: 'local-only' }]);
      expect(conflictHook).toHaveBeenCalledTimes(1);
      expect(conflictHook).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'manual-pull' }));
      expect(fb.fbGetSyncConflict()).not.toBeNull();
      expect(patchCalls).toBe(0);
    } finally {
      delete globalThis.onSyncConflict;
      vi.useRealTimers();
    }
  });

  it('applies cloud data unconditionally on a manual pull when local is clean', async () => {
    const fb = loadFirebaseModule();
    const cloudItems = [{ id: 'cloud' }];
    const conflictHook = vi.fn();
    globalThis.onSyncConflict = conflictHook;
    await setupSignedInFirebase(fb, {
      extraRoutes: [firestoreGetRoute(async () => jsonResponse(200, firestoreDoc(fb, {
        items: cloudItems, engines: [], selectedEngine: 'google', clocks: [], gridColumns: 4,
        updateTime: '2024-06-02T00:00:00.000000000Z',
      })))],
    });
    globalThis.items = [{ id: 'local-only' }];

    const result = await fb.syncFromCloud({ mode: 'forced', trigger: 'manual-pull' });

    expect(result).toBe(true);
    expect(globalThis.items).toEqual(cloudItems);
    expect(conflictHook).not.toHaveBeenCalled();
    expect(fb.fbGetSyncConflict()).toBeNull();
  });
});

describe('fbResolveSyncConflict', () => {
  // Common setup for the resolution cases: a dirty local list differing from
  // the cloud, then a detection pull that records the conflict without applying
  // either side. Callers pass extra GET/PATCH routes to exercise failures.
  async function makeConflict(fb, { getResponder, patchResponder, localItems = [{ id: 'local-only' }] }) {
    const routes = [];
    if (getResponder) routes.push(firestoreGetRoute(getResponder));
    if (patchResponder) routes.push(firestorePatchRoute(patchResponder));
    const setup = await setupSignedInFirebase(fb, { extraRoutes: routes });
    globalThis.items = localItems;
    await fb.markLocalCloudDataChanged();
    // No-op under real timers; under fake timers this drops the auto-upload
    // timer markLocalCloudDataChanged scheduled so a later syncFromCloud is the
    // only thing that could queue a PATCH.
    vi.clearAllTimers();
    return setup;
  }

  it("'cloud' applies the cloud snapshot, clears the conflict, and resumes auto-upload", async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      const cloudItems = [{ id: 'cloud' }];
      let patchCalls = 0;
      const { storage } = await makeConflict(fb, {
        getResponder: async () => jsonResponse(200, cloudDoc(fb, cloudItems)),
        patchResponder: async () => {
          patchCalls += 1;
          return jsonResponse(200, { updateTime: PATCH_TS });
        },
      });
      await fb.syncFromCloud();
      expect(fb.fbGetSyncConflict()).not.toBeNull();

      const result = await fb.fbResolveSyncConflict('cloud');

      expect(result).toEqual({ ok: true });
      expect(globalThis.items).toEqual(cloudItems);
      expect(fb._isDirty()).toBe(false);
      expect(fb.fbGetSyncConflict()).toBeNull();
      expect(storage._data._fb_sync_baseline_uid).toBe(TEST_UID);

      // Auto-upload resumes after resolution: a later edit is re-uploaded.
      await fb.markLocalCloudDataChanged();
      await vi.advanceTimersByTimeAsync(2000);
      expect(patchCalls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("'local' force-uploads the local state and clears the conflict", async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      const localItems = [{ id: 'local-only' }];
      let patchCalls = 0;
      let capturedBody = null;
      const { storage } = await makeConflict(fb, {
        getResponder: async () => jsonResponse(200, cloudDoc(fb, [{ id: 'cloud' }])),
        patchResponder: async (url, options) => {
          patchCalls += 1;
          capturedBody = JSON.parse(options.body);
          return jsonResponse(200, { updateTime: PATCH_TS });
        },
        localItems,
      });
      await fb.syncFromCloud();
      expect(fb.fbGetSyncConflict()).not.toBeNull();

      const result = await fb.fbResolveSyncConflict('local');

      expect(result).toEqual({ ok: true });
      expect(patchCalls).toBe(1);
      expect(JSON.parse(capturedBody.fields.items.stringValue)).toEqual(localItems);
      expect(fb.fbGetSyncConflict()).toBeNull();
      expect(storage._data._fb_sync_baseline_uid).toBe(TEST_UID);
    } finally {
      vi.useRealTimers();
    }
  });

  it("'cloud' keeps the conflict pending and applies nothing when the pull fails with a network error", async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      const localItems = [{ id: 'local-only' }];
      let patchCalls = 0;
      let getCalls = 0;
      await makeConflict(fb, {
        getResponder: async () => {
          getCalls += 1;
          if (getCalls === 1) return jsonResponse(200, cloudDoc(fb, [{ id: 'cloud' }]));
          throw new Error('network boom');
        },
        patchResponder: async () => {
          patchCalls += 1;
          return jsonResponse(200, { updateTime: PATCH_TS });
        },
        localItems,
      });
      await fb.syncFromCloud();
      expect(fb.fbGetSyncConflict()).not.toBeNull();

      const result = await fb.fbResolveSyncConflict('cloud');

      expect(result).toEqual({ ok: false, code: 'network' });
      expect(fb.fbGetSyncConflict()).not.toBeNull();
      expect(globalThis.items).toEqual(localItems);
      expect(patchCalls).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("'cloud' imports the local state when the cloud document has been deleted", async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      let patchCalls = 0;
      let getCalls = 0;
      const { storage } = await makeConflict(fb, {
        getResponder: async () => {
          getCalls += 1;
          if (getCalls === 1) return jsonResponse(200, cloudDoc(fb, [{ id: 'cloud' }]));
          return jsonResponse(404, {});
        },
        patchResponder: async () => {
          patchCalls += 1;
          return jsonResponse(200, { updateTime: PATCH_TS });
        },
      });
      await fb.syncFromCloud();
      expect(fb.fbGetSyncConflict()).not.toBeNull();

      const result = await fb.fbResolveSyncConflict('cloud');

      expect(result).toEqual({ ok: true, code: 'no-cloud-data' });
      expect(fb.fbGetSyncConflict()).toBeNull();
      expect(storage._data._fb_sync_baseline_uid).toBe(TEST_UID);

      await vi.advanceTimersByTimeAsync(2000);
      expect(patchCalls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("'cloud' reports session-changed and does not import when the session changes mid-GET", async () => {
    // Fake timers are safe here: the GET is gated on a manually-resolved
    // promise (not a timer), so the epoch race is reproduced without the
    // timer clock interfering. They let us assert no import upload got queued.
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      const localItems = [{ id: 'local-only' }];
      let patchCalls = 0;
      let getCalls = 0;
      let markResolveGetStarted;
      let releaseResolveGet;
      const resolveGetStarted = new Promise((r) => { markResolveGetStarted = r; });
      const resolveGate = new Promise((r) => { releaseResolveGet = r; });
      await makeConflict(fb, {
        getResponder: async () => {
          getCalls += 1;
          if (getCalls === 1) return jsonResponse(200, cloudDoc(fb, [{ id: 'cloud' }]));
          markResolveGetStarted();
          await resolveGate;
          return jsonResponse(200, cloudDoc(fb, [{ id: 'cloud' }]));
        },
        patchResponder: async () => {
          patchCalls += 1;
          return jsonResponse(200, { updateTime: PATCH_TS });
        },
        localItems,
      });
      await fb.syncFromCloud();
      expect(fb.fbGetSyncConflict()).not.toBeNull();

      const resolvePromise = fb.fbResolveSyncConflict('cloud');
      await resolveGetStarted;
      await fb.fbSignOut();
      releaseResolveGet();
      const result = await resolvePromise;

      expect(result).toEqual({ ok: false, code: 'session-changed' });
      expect(fb.fbGetSyncConflict()).toBeNull();
      expect(globalThis.items).toEqual(localItems);
      expect(patchCalls).toBe(0);
      // The late response was dropped with zero writes, not treated as "empty
      // cloud": no import upload may be queued for the new session.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("'local' reports storage-read-only and keeps the conflict when the firewall blocks upload", async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      let patchCalls = 0;
      await makeConflict(fb, {
        getResponder: async () => jsonResponse(200, cloudDoc(fb, [{ id: 'cloud' }])),
        patchResponder: async () => {
          patchCalls += 1;
          return jsonResponse(200, { updateTime: PATCH_TS });
        },
      });
      await fb.syncFromCloud();
      expect(fb.fbGetSyncConflict()).not.toBeNull();

      globalThis.isStorageLoadFailed = () => true;
      const result = await fb.fbResolveSyncConflict('local');

      expect(result).toEqual({ ok: false, code: 'storage-read-only' });
      expect(fb.fbGetSyncConflict()).not.toBeNull();
      expect(patchCalls).toBe(0);
    } finally {
      delete globalThis.isStorageLoadFailed;
      vi.useRealTimers();
    }
  });

  it("'local' clears the conflict on upload failure and keeps the local state dirty", async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      const localItems = [{ id: 'local-only' }];
      let patchCalls = 0;
      await makeConflict(fb, {
        getResponder: async () => jsonResponse(200, cloudDoc(fb, [{ id: 'cloud' }])),
        patchResponder: async () => {
          patchCalls += 1;
          return jsonResponse(429, {});
        },
        localItems,
      });
      await fb.syncFromCloud();
      expect(fb.fbGetSyncConflict()).not.toBeNull();

      const result = await fb.fbResolveSyncConflict('local');

      expect(result).toEqual({ ok: false, code: 'quota' });
      expect(fb.fbGetSyncConflict()).toBeNull();
      expect(fb._isDirty()).toBe(true);
      expect(globalThis.items).toEqual(localItems);
      expect(patchCalls).toBe(1);

      // Retry path: the conflict is now cleared, so the next user edit resumes
      // the automatic upload (existing error path) instead of staying paused.
      await fb.markLocalCloudDataChanged();
      await vi.advanceTimersByTimeAsync(2000);
      expect(patchCalls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns no-conflict when nothing is pending', async () => {
    const fb = loadFirebaseModule();
    await setupSignedInFirebase(fb);

    await expect(fb.fbResolveSyncConflict('cloud')).resolves.toEqual({ ok: false, code: 'no-conflict' });
    await expect(fb.fbResolveSyncConflict('local')).resolves.toEqual({ ok: false, code: 'no-conflict' });
  });

  it('returns not-signed-in when not signed in', async () => {
    const fb = loadFirebaseModule();

    await expect(fb.fbResolveSyncConflict('cloud')).resolves.toEqual({ ok: false, code: 'not-signed-in' });
  });

  it('returns invalid-choice for an unknown choice while a conflict is pending', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      await makeConflict(fb, {
        getResponder: async () => jsonResponse(200, cloudDoc(fb, [{ id: 'cloud' }])),
      });
      await fb.syncFromCloud();
      expect(fb.fbGetSyncConflict()).not.toBeNull();

      await expect(fb.fbResolveSyncConflict('banana')).resolves.toEqual({ ok: false, code: 'invalid-choice' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('manual sync buttons while a conflict is pending', () => {
  it('re-notifies the conflict on a manual upload instead of force-uploading', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      const conflictHook = vi.fn();
      globalThis.onSyncConflict = conflictHook;
      const { showToast } = installUiMocks();
      let patchCalls = 0;
      await setupSignedInFirebase(fb, {
        extraRoutes: [
          firestoreGetRoute(async () => jsonResponse(200, cloudDoc(fb, [{ id: 'cloud' }]))),
          firestorePatchRoute(async () => {
            patchCalls += 1;
            return jsonResponse(200, { updateTime: PATCH_TS });
          }),
        ],
      });
      globalThis.items = [{ id: 'local-only' }];
      await fb.markLocalCloudDataChanged();
      vi.clearAllTimers();

      await fb.syncFromCloud();
      expect(fb.fbGetSyncConflict()).not.toBeNull();
      conflictHook.mockClear();

      await fb._handleSyncBtn('upload');

      expect(conflictHook).toHaveBeenCalledTimes(1);
      expect(conflictHook).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'manual-upload' }));
      expect(patchCalls).toBe(0);
      expect(showToast).not.toHaveBeenCalled();
    } finally {
      delete globalThis.onSyncConflict;
      vi.useRealTimers();
    }
  });

  it('re-notifies the conflict on a manual pull when the cloud still differs', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      const conflictHook = vi.fn();
      globalThis.onSyncConflict = conflictHook;
      const { showToast } = installUiMocks();
      const localItems = [{ id: 'local-only' }];
      let patchCalls = 0;
      await setupSignedInFirebase(fb, {
        extraRoutes: [
          firestoreGetRoute(async () => jsonResponse(200, cloudDoc(fb, [{ id: 'cloud' }]))),
          firestorePatchRoute(async () => {
            patchCalls += 1;
            return jsonResponse(200, { updateTime: PATCH_TS });
          }),
        ],
      });
      globalThis.items = localItems;
      await fb.markLocalCloudDataChanged();
      vi.clearAllTimers();

      await fb.syncFromCloud();
      expect(fb.fbGetSyncConflict()).not.toBeNull();
      conflictHook.mockClear();

      await fb._handleSyncBtn('download');

      expect(conflictHook).toHaveBeenCalledTimes(1);
      expect(conflictHook).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'manual-pull' }));
      expect(globalThis.items).toEqual(localItems);
      expect(fb.fbGetSyncConflict()).not.toBeNull();
      expect(patchCalls).toBe(0);
      expect(showToast).not.toHaveBeenCalled();
    } finally {
      delete globalThis.onSyncConflict;
      vi.useRealTimers();
    }
  });

  it('applies and clears the conflict on a manual pull once the cloud has converged', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      const conflictHook = vi.fn();
      globalThis.onSyncConflict = conflictHook;
      installUiMocks();
      let cloudItems = [{ id: 'cloud' }];
      await setupSignedInFirebase(fb, {
        extraRoutes: [firestoreGetRoute(async () => jsonResponse(200, cloudDoc(fb, cloudItems)))],
      });
      globalThis.items = [{ id: 'local-only' }];
      await fb.markLocalCloudDataChanged();
      vi.clearAllTimers();

      await fb.syncFromCloud();
      expect(fb.fbGetSyncConflict()).not.toBeNull();

      cloudItems = [{ id: 'local-only' }];
      await fb._handleSyncBtn('download');

      expect(globalThis.items).toEqual([{ id: 'local-only' }]);
      expect(fb.fbGetSyncConflict()).toBeNull();
    } finally {
      delete globalThis.onSyncConflict;
      vi.useRealTimers();
    }
  });
});

describe('fbGetSyncConflict copy semantics', () => {
  it('returns a copy so external mutation cannot pollute internal state', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      await setupSignedInFirebase(fb, {
        extraRoutes: [firestoreGetRoute(async () => jsonResponse(200, cloudDoc(fb, [{ id: 'cloud' }])))],
      });
      globalThis.items = [{ id: 'local-only' }];
      await fb.markLocalCloudDataChanged();
      vi.clearAllTimers();

      await fb.syncFromCloud();
      expect(fb.fbGetSyncConflict()).not.toBeNull();

      const copy = fb.fbGetSyncConflict();
      copy.trigger = 'mutated';
      copy.isAccountSwitch = true;

      expect(fb.fbGetSyncConflict().trigger).not.toBe('mutated');
      expect(fb.fbGetSyncConflict().isAccountSwitch).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('startup re-popup', () => {
  it('re-detects a pending conflict on startup and re-notifies the hook', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      const conflictHook = vi.fn();
      globalThis.onSyncConflict = conflictHook;
      let patchCalls = 0;
      const cloudItems = [{ id: 'cloud' }];
      await setupSignedInFirebase(fb, {
        extraRoutes: [
          firestoreGetRoute(async () => jsonResponse(200, cloudDoc(fb, cloudItems))),
          firestorePatchRoute(async () => {
            patchCalls += 1;
            return jsonResponse(200, { updateTime: PATCH_TS });
          }),
        ],
      });
      globalThis.items = [{ id: 'local-only' }];
      await fb.markLocalCloudDataChanged();
      vi.clearAllTimers();

      // 首次登录检测 → 未决（脏本地 + 云端不同）
      await fb.syncFromCloud();
      expect(fb.fbGetSyncConflict()).not.toBeNull();
      expect(conflictHook).toHaveBeenCalledTimes(1);
      conflictHook.mockClear();

      // "reload": re-eval the module against the same storage, then re-init.
      // The pending state is re-derived by the startup pull from persisted
      // dirty/baseline, not carried over from the previous closure.
      const fb2 = loadFirebaseModule();
      globalThis.onSyncConflict = conflictHook;
      await fb2.fbInit();

      expect(conflictHook).toHaveBeenCalledTimes(1);
      expect(conflictHook).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'startup' }));
      expect(fb2.fbGetSyncConflict()).not.toBeNull();
      expect(globalThis.items).toEqual([{ id: 'local-only' }]);
      expect(patchCalls).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      delete globalThis.onSyncConflict;
      vi.useRealTimers();
    }
  });
});

describe('account switch end-to-end', () => {
  // Set up a signed-in account (TEST_UID) whose persisted baseline still points
  // at a previous account, plus a dirty local state that differs from the cloud.
  async function setupSwitch(fb, { cloudItems, patchResponder }) {
    const routes = [
      firestoreGetRoute(async () => jsonResponse(200, cloudDoc(fb, cloudItems))),
    ];
    if (patchResponder) routes.push(firestorePatchRoute(patchResponder));
    const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routes });
    // 持久化基线仍指向上一次成功同步的账号 → 切号未解决
    storage._data._fb_sync_baseline_uid = 'account-a';
    await fb._loadAuth();
    return storage;
  }

  it('switch + dirty + different → hook(isAccountSwitch) → resolve cloud lands the new account snapshot', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      const conflictHook = vi.fn();
      globalThis.onSyncConflict = conflictHook;
      const cloudItems = [{ id: 'B-cloud-data' }];
      let patchCalls = 0;
      const storage = await setupSwitch(fb, {
        cloudItems,
        patchResponder: async () => {
          patchCalls += 1;
          return jsonResponse(200, { updateTime: PATCH_TS });
        },
      });

      globalThis.items = [{ id: 'A-secret-leftover' }];
      await fb.markLocalCloudDataChanged();
      vi.clearAllTimers();

      await fb._pullAfterSignIn({ trigger: 'sign-in' });

      expect(conflictHook).toHaveBeenCalledTimes(1);
      expect(conflictHook).toHaveBeenCalledWith(expect.objectContaining({
        isAccountSwitch: true,
        trigger: 'sign-in',
      }));
      expect(fb.fbGetSyncConflict()).not.toBeNull();
      expect(globalThis.items).toEqual([{ id: 'A-secret-leftover' }]);
      expect(patchCalls).toBe(0);
      expect(fb._needsSwitchPull()).toBe(true);

      const result = await fb.fbResolveSyncConflict('cloud');

      expect(result).toEqual({ ok: true });
      expect(globalThis.items).toEqual(cloudItems);
      expect(storage._data._fb_sync_baseline_uid).toBe(TEST_UID);
      expect(fb._needsSwitchPull()).toBe(false);
      expect(fb.fbGetSyncConflict()).toBeNull();
      expect(patchCalls).toBe(0);   // resolve cloud never PATCHes
    } finally {
      delete globalThis.onSyncConflict;
      vi.useRealTimers();
    }
  });

  it('switch + dirty + different → resolve local force-uploads the leftover data into the new account', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      const conflictHook = vi.fn();
      globalThis.onSyncConflict = conflictHook;
      let patchCalls = 0;
      let capturedBody = null;
      const storage = await setupSwitch(fb, {
        cloudItems: [{ id: 'B-cloud-data' }],
        patchResponder: async (url, options) => {
          patchCalls += 1;
          capturedBody = JSON.parse(options.body);
          return jsonResponse(200, { updateTime: PATCH_TS });
        },
      });

      const localItems = [{ id: 'A-secret-leftover' }];
      globalThis.items = localItems;
      await fb.markLocalCloudDataChanged();
      vi.clearAllTimers();

      await fb._pullAfterSignIn({ trigger: 'sign-in' });
      expect(fb.fbGetSyncConflict()).not.toBeNull();

      const result = await fb.fbResolveSyncConflict('local');

      expect(result).toEqual({ ok: true });
      expect(patchCalls).toBe(1);
      expect(JSON.parse(capturedBody.fields.items.stringValue)).toEqual(localItems);
      expect(storage._data._fb_sync_baseline_uid).toBe(TEST_UID);
      expect(fb.fbGetSyncConflict()).toBeNull();
    } finally {
      delete globalThis.onSyncConflict;
      vi.useRealTimers();
    }
  });

  it('switch + dirty + identical content → no hook, silently clears dirty, baseline = new account', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      const conflictHook = vi.fn();
      globalThis.onSyncConflict = conflictHook;
      const cloudItems = [{ id: 'same' }];
      let patchCalls = 0;
      const storage = await setupSwitch(fb, {
        cloudItems,
        patchResponder: async () => {
          patchCalls += 1;
          return jsonResponse(200, { updateTime: PATCH_TS });
        },
      });

      globalThis.items = [{ id: 'same' }];
      await fb.markLocalCloudDataChanged();   // 脏，但内容与云端相同
      vi.clearAllTimers();

      await fb._pullAfterSignIn({ trigger: 'sign-in' });

      expect(conflictHook).not.toHaveBeenCalled();
      expect(fb.fbGetSyncConflict()).toBeNull();
      expect(globalThis.items).toEqual(cloudItems);
      expect(fb._isDirty()).toBe(false);
      expect(storage._data._fb_sync_baseline_uid).toBe(TEST_UID);
      expect(patchCalls).toBe(0);
    } finally {
      delete globalThis.onSyncConflict;
      vi.useRealTimers();
    }
  });

  it('switch + cloud absent → silently imports the local state (no hook, one PATCH)', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      const conflictHook = vi.fn();
      globalThis.onSyncConflict = conflictHook;
      let patchCalls = 0;
      const { storage } = await setupSignedInFirebase(fb, {
        extraRoutes: [
          firestoreGetRoute(async () => jsonResponse(404, {})),
          firestorePatchRoute(async () => {
            patchCalls += 1;
            return jsonResponse(200, { updateTime: PATCH_TS });
          }),
        ],
      });
      storage._data._fb_sync_baseline_uid = 'account-a';
      await fb._loadAuth();

      globalThis.items = [{ id: 'A-secret-leftover' }];
      await fb.markLocalCloudDataChanged();
      vi.clearAllTimers();

      await fb._pullAfterSignIn({ trigger: 'sign-in' });

      expect(conflictHook).not.toHaveBeenCalled();
      expect(fb.fbGetSyncConflict()).toBeNull();
      expect(vi.getTimerCount()).toBe(1);   // 导入上传排定
      await vi.advanceTimersByTimeAsync(2000);
      expect(patchCalls).toBe(1);
    } finally {
      delete globalThis.onSyncConflict;
      vi.useRealTimers();
    }
  });

  it('clears the pending conflict and schedules an import when the cloud doc is deleted while pending', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      const conflictHook = vi.fn();
      globalThis.onSyncConflict = conflictHook;
      let patchCalls = 0;
      let cloudDeleted = false;
      await setupSignedInFirebase(fb, {
        extraRoutes: [
          firestoreGetRoute(async () => {
            if (cloudDeleted) return jsonResponse(404, {});
            return jsonResponse(200, cloudDoc(fb, [{ id: 'cloud' }]));
          }),
          firestorePatchRoute(async () => {
            patchCalls += 1;
            return jsonResponse(200, { updateTime: PATCH_TS });
          }),
        ],
      });
      globalThis.items = [{ id: 'local-only' }];
      await fb.markLocalCloudDataChanged();
      vi.clearAllTimers();

      await fb.syncFromCloud();   // 冲突检测 → 未决
      expect(fb.fbGetSyncConflict()).not.toBeNull();
      conflictHook.mockClear();

      cloudDeleted = true;
      await fb._pullAfterSignIn({ trigger: 'sign-in' });

      expect(conflictHook).not.toHaveBeenCalled();
      expect(fb.fbGetSyncConflict()).toBeNull();
      expect(vi.getTimerCount()).toBe(1);   // 导入上传排定
      await vi.advanceTimersByTimeAsync(2000);
      expect(patchCalls).toBe(1);
    } finally {
      delete globalThis.onSyncConflict;
      vi.useRealTimers();
    }
  });
});

describe('same-account re-login', () => {
  function b64url(payload) {
    return Buffer.from(JSON.stringify(payload)).toString('base64url');
  }

  async function setupRelogin(fb, cloudItems, { patchCallsRef }) {
    const verifiedToken = `h.${b64url({ email_verified: true })}.s`;
    const { storage } = await setupSignedInFirebase(fb, {
      extraRoutes: [
        {
          match: (url) => url.includes('accounts:signInWithPassword'),
          respond: async () => jsonResponse(200, {
            idToken: verifiedToken, expiresIn: '3600', refreshToken: 'b-refresh', localId: TEST_UID,
          }),
        },
        firestoreGetRoute(async () => jsonResponse(200, cloudDoc(fb, cloudItems))),
        firestorePatchRoute(async () => {
          patchCallsRef.count += 1;
          return jsonResponse(200, { updateTime: PATCH_TS });
        }),
      ],
    });
    return storage;
  }

  it('same-account re-login with dirty local and differing cloud → hook (not a switch)', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      const conflictHook = vi.fn();
      globalThis.onSyncConflict = conflictHook;
      const patchCalls = { count: 0 };
      await setupRelogin(fb, [{ id: 'cloud' }], { patchCallsRef: patchCalls });

      globalThis.items = [{ id: 'local-only' }];
      await fb.markLocalCloudDataChanged();
      vi.clearAllTimers();

      // 同账号重登：登出（清 ts）→ 重登同账号 → 拉取
      await fb.fbSignOut();
      await fb.fbSignIn('user@example.com', 'pw');
      await fb._pullAfterSignIn({ trigger: 'sign-in' });

      expect(conflictHook).toHaveBeenCalledTimes(1);
      expect(conflictHook).toHaveBeenCalledWith(expect.objectContaining({
        isAccountSwitch: false,
        trigger: 'sign-in',
      }));
      expect(fb.fbGetSyncConflict()).not.toBeNull();
      expect(globalThis.items).toEqual([{ id: 'local-only' }]);
      expect(patchCalls.count).toBe(0);
    } finally {
      delete globalThis.onSyncConflict;
      vi.useRealTimers();
    }
  });

  it('same-account re-login with dirty local and identical cloud → no hook, clears dirty', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      const conflictHook = vi.fn();
      globalThis.onSyncConflict = conflictHook;
      const patchCalls = { count: 0 };
      const storage = await setupRelogin(fb, [{ id: 'same' }], { patchCallsRef: patchCalls });

      globalThis.items = [{ id: 'same' }];
      await fb.markLocalCloudDataChanged();
      vi.clearAllTimers();

      await fb.fbSignOut();
      await fb.fbSignIn('user@example.com', 'pw');
      await fb._pullAfterSignIn({ trigger: 'sign-in' });

      expect(conflictHook).not.toHaveBeenCalled();
      expect(fb.fbGetSyncConflict()).toBeNull();
      expect(globalThis.items).toEqual([{ id: 'same' }]);
      expect(fb._isDirty()).toBe(false);
      expect(storage._data._fb_sync_baseline_uid).toBe(TEST_UID);
      expect(patchCalls.count).toBe(0);
    } finally {
      delete globalThis.onSyncConflict;
      vi.useRealTimers();
    }
  });
});

describe('_countSyncItems', () => {
  it('returns zero counts for non-array input', () => {
    const fb = loadFirebaseModule();
    expect(fb._countSyncItems([])).toEqual({ shortcuts: 0, folders: 0 });
    expect(fb._countSyncItems(null)).toEqual({ shortcuts: 0, folders: 0 });
    expect(fb._countSyncItems('x')).toEqual({ shortcuts: 0, folders: 0 });
  });

  it('counts links, id-only and unknown-type objects as shortcuts', () => {
    const fb = loadFirebaseModule();
    expect(fb._countSyncItems([{ type: 'link' }, { id: 'a' }, { type: 'mystery' }]))
      .toEqual({ shortcuts: 3, folders: 0 });
  });

  it('counts folder children recursively without counting the folder as a shortcut', () => {
    const fb = loadFirebaseModule();
    expect(fb._countSyncItems([
      { type: 'folder', children: [{ type: 'link' }, { type: 'link' }] },
      { type: 'link' },
    ])).toEqual({ shortcuts: 3, folders: 1 });
  });

  it('handles nested folders', () => {
    const fb = loadFirebaseModule();
    expect(fb._countSyncItems([
      { type: 'folder', children: [{ type: 'folder', children: [{ type: 'link' }] }] },
    ])).toEqual({ shortcuts: 1, folders: 2 });
  });

  it('ignores weather widgets, non-objects, and tolerates folders without children', () => {
    const fb = loadFirebaseModule();
    expect(fb._countSyncItems([{ type: 'weather', city: 'x' }, null, 3, { type: 'folder' }]))
      .toEqual({ shortcuts: 0, folders: 1 });
  });
});

describe('conflict info fields', () => {
  const routesFor = (fb, cloudItems) => [
    firestoreGetRoute(async () => jsonResponse(200, cloudDoc(fb, cloudItems))),
    firestorePatchRoute(async () => jsonResponse(200, { updateTime: PATCH_TS })),
  ];

  it('carries recursive counts and the local edit time, without the old item counts', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      await setupSignedInFirebase(fb, { extraRoutes: routesFor(fb, [{ type: 'link' }]) });
      globalThis.items = [
        { type: 'folder', children: [{ type: 'link' }, { type: 'link' }] },
        { type: 'link' },
      ];
      vi.setSystemTime(new Date(2026, 9, 18, 14, 32));
      await fb.markLocalCloudDataChanged();
      vi.clearAllTimers();

      expect(await fb.syncFromCloud()).toBe(false);
      const info = fb.fbGetSyncConflict();
      expect(info).toEqual(expect.objectContaining({
        localShortcutCount: 3,
        localFolderCount: 1,
        cloudShortcutCount: 1,
        cloudFolderCount: 0,
        localEditTime: new Date(2026, 9, 18, 14, 32).getTime(),
      }));
      expect(info).not.toHaveProperty('localItemCount');
      expect(info).not.toHaveProperty('cloudItemCount');
    } finally {
      vi.useRealTimers();
    }
  });

  it('legacy install has localEditTime 0', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      const { storage } = await setupSignedInFirebase(fb, { extraRoutes: routesFor(fb, [{ type: 'link' }]) });
      storage._data._fb_edit_rev = 2;
      storage._data._fb_synced_rev = 1;
      await fb._loadRevState();
      globalThis.items = [{ type: 'link' }, { type: 'link' }];

      expect(await fb.syncFromCloud()).toBe(false);
      expect(fb.fbGetSyncConflict().localEditTime).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('system resync does not bump edit time', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      const { storage } = await setupSignedInFirebase(fb, {
        extraRoutes: [
          firestoreGetRoute(async () => jsonResponse(200, {
            updateTime: CLOUD_TS,
            fields: {
              items: fb._toFV(JSON.stringify([{ id: 'cloud' }])),
              engines: fb._toFV(JSON.stringify([])),
              selected_engine: fb._toFV('google'),
              grid_columns: fb._toFV(4),
              // clocks missing -> skipped field -> system resync (_editRev bump)
            },
          })),
          firestorePatchRoute(async () => jsonResponse(200, { updateTime: PATCH_TS })),
        ],
      });
      globalThis.items = [{ id: 'cloud' }];
      globalThis.clocks = [{ id: 'c1', tz: 'UTC' }];
      vi.setSystemTime(new Date(2026, 9, 18, 10, 0));
      await fb.markLocalCloudDataChanged();
      vi.clearAllTimers();
      const before = storage._data._fb_local_edit_ts;
      const revBefore = storage._data._fb_edit_rev;
      vi.setSystemTime(new Date(2026, 9, 18, 11, 0));

      expect(await fb.syncFromCloud()).toBe(true);
      expect(storage._data._fb_edit_rev).toBeGreaterThan(revBefore);
      expect(storage._data._fb_local_edit_ts).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it('edit time persists and survives sign-out', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      const { storage } = await setupSignedInFirebase(fb);
      const editedAt = new Date(2026, 9, 18, 14, 32).getTime();
      vi.setSystemTime(editedAt);
      await fb.markLocalCloudDataChanged();
      vi.clearAllTimers();
      expect(storage._data._fb_local_edit_ts).toBe(editedAt);

      await fb._clearAuth();
      expect(storage._data._fb_local_edit_ts).toBe(editedAt);
    } finally {
      vi.useRealTimers();
    }
  });
});
