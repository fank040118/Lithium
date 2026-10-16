import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadAppModule } from './helpers/loadAppModule.js';
import { installAppDomFixture } from './helpers/appDomFixture.js';
import { createMockChromeStorage } from './helpers/mockChromeStorage.js';

// P0 data-boundary hardening, Task 2: sanitizeItemsShape (single shape entry
// point for loadAll/syncFromCloud), renderIcon tolerance for items without a
// children array, and selector-value escaping for drag visuals.
//
// Tests that need chrome.storage attach createMockChromeStorage to
// globalThis.chrome BEFORE loadAppModule() re-evaluates app.js, because the
// closure `storage` const is captured at eval time (same pattern as
// test/app.render-dom-light.test.js and test/app.storage-state.test.js).

describe('app.js data-hardening layer', () => {
  let app;

  beforeEach(() => {
    installAppDomFixture();
    globalThis.t = vi.fn((key) => key);
    app = loadAppModule();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    delete globalThis.t;
    delete globalThis.chrome;
    delete globalThis.requestAnimationFrame;
    vi.restoreAllMocks();
  });

  describe('sanitizeItemsShape', () => {
    it('sanitizeItemsShape drops non-object entries and repairs missing fields', () => {
      const input = [
        null,
        'x',
        { name: 'no-id' },
        { id: 'a', type: 'weather', name: 'W', city: { name: 'X', lat: 1, lon: 2, tz: 'auto' } },
      ];

      const result = app.sanitizeItemsShape(input);

      expect(result.items).toHaveLength(2);
      const noId = result.items[0];
      const weather = result.items[1];
      expect(typeof noId.id).toBe('string');
      expect(noId.id).not.toBe('');
      expect(noId.name).toBe('no-id');
      expect(typeof weather.id).toBe('string');
      expect(weather.type).toBe('weather');
      expect('children' in weather).toBe(false);
      expect(result.changed).toBe(true);
      // The sanitizer must not mutate the caller's list or its entries.
      expect(input).toHaveLength(4);
      expect('id' in input[2]).toBe(false);
    });

    it('sanitizeItemsShape coerces unknown types to link and strips stray children', () => {
      const result = app.sanitizeItemsShape([
        { id: 'a', type: 'banana', children: [{ id: 'b' }] },
      ]);

      expect(result.items[0].type).toBe('link');
      expect('children' in result.items[0]).toBe(false);
      expect(result.changed).toBe(true);
    });

    it('sanitizeItemsShape ensures folders keep a children array', () => {
      const result = app.sanitizeItemsShape([{ id: 'f', type: 'folder', name: 'F' }]);

      expect(result.items[0].children).toEqual([]);
      expect(result.changed).toBe(true);
    });
  });

  describe('render tolerance', () => {
    it('render tolerates a weather item without children', async () => {
      const cs = createMockChromeStorage({
        startpage_items: [
          { id: 'w', type: 'weather', name: '天气', size: '1x2', city: { name: 'X', lat: 1, lon: 2, tz: 'auto' } },
        ],
      });
      globalThis.chrome = { storage: { local: cs.storage.local } };
      const localApp = loadAppModule();
      await localApp.loadAll();

      expect(() => localApp.render()).not.toThrow();

      const card = document.querySelector('#grid-container .grid-item-wrap[data-id="w"]');
      expect(card).not.toBeNull();
    });

    it('renderIcon keeps folder rendering intact for children-bearing items', () => {
      const item = {
        id: 'f', type: 'folder', name: 'F', size: '1x1',
        children: [{ id: 'c1', type: 'link', name: 'A', url: 'https://a.com' }],
      };

      const html = app.renderIcon(item);

      const wrap = document.createElement('div');
      wrap.innerHTML = html;
      expect(wrap.querySelector('.folder-preview-grid')).not.toBeNull();
    });
  });

  describe('selector escaping', () => {
    it('escapeSelectorValue escapes quotes and backslashes', () => {
      expect(app.escapeSelectorValue('a"b]')).toBe('a\\"b]');
      expect(app.escapeSelectorValue('a\\b')).toBe('a\\\\b');
    });

    it('applyDragVisuals survives a hostile item id', () => {
      // Drop the RAF callback handleDragStart queues; this test drives
      // applyDragVisuals explicitly.
      globalThis.requestAnimationFrame = vi.fn(() => 1);
      app.handleDragStart({ dataTransfer: { setData() {}, effectAllowed: '' } }, 'evil"]id');

      expect(() => app.applyDragVisuals()).not.toThrow();
    });
  });
});
