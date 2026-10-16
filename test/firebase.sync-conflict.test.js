import { describe, it, expect, afterEach } from 'vitest';
import { loadFirebaseModule } from './helpers/loadFirebaseModule.js';
import { jsonResponse } from './helpers/mockFetch.js';
import { setupSignedInFirebase, firestorePatchRoute } from './helpers/setupSignedInFirebase.js';

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
