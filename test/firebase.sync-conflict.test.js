import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadFirebaseModule } from './helpers/loadFirebaseModule.js';
import { jsonResponse, createRoutedFetch } from './helpers/mockFetch.js';
import { createMockChromeStorage } from './helpers/mockChromeStorage.js';
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
      const { storage, uid } = await setupSignedInFirebase(fb, {
        extraRoutes: [firestoreGetRoute(async () => jsonResponse(200, firestoreDoc(fb, {
          items: cloudItems, engines: [], selectedEngine: 'google', clocks: [], gridColumns: 4,
          updateTime: '2024-06-02T00:00:00.000000000Z',
        })))],
      });
      globalThis.items = [{ id: 'cloud' }];
      await fb.markLocalCloudDataChanged();

      const result = await fb.syncFromCloud();

      expect(result).toBe(true);
      expect(conflictHook).not.toHaveBeenCalled();
      expect(fb.fbGetSyncConflict()).toBeNull();
      expect(globalThis.items).toEqual(cloudItems);
      expect(fb._isDirty()).toBe(false);
      expect(storage._data._fb_sync_baseline_uid).toBe(uid);
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
