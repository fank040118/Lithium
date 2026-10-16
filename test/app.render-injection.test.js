import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadAppModule } from './helpers/loadAppModule.js';
import { installAppDomFixture } from './helpers/appDomFixture.js';
import { createMockChromeStorage } from './helpers/mockChromeStorage.js';

// Attribute-context escaping: user-controlled values interpolated into
// attribute positions (data-item-type, data-engine-id) must go through
// escapeAttr, not escapeHtml (textContent→innerHTML does not escape quotes).

// 恶意 item.type / engine.id 试图逃出属性上下文注入 onmouseover
const EVIL = 'link" onmouseover="alert(1)';

let app;
beforeEach(() => {
  app = loadAppModule();
  installAppDomFixture();
  globalThis.t = vi.fn((key) => key);
});
afterEach(() => {
  document.body.innerHTML = '';
  delete globalThis.t;
  delete globalThis.chrome;
  vi.restoreAllMocks();
});

describe('attribute-context escaping', () => {
  it('keeps item.type inside data-item-type instead of injecting attributes', () => {
    // children: [] — a non-link type takes renderIcon's folder branch, which reads item.children
    const html = app.createGridItemHTML({ id: 'x', type: EVIL, name: 'x', size: '1x1', url: 'https://example.com', children: [] });
    const host = document.createElement('div');
    host.innerHTML = html;
    const card = host.querySelector('.grid-item-card');
    expect(Array.from(card.attributes).map(a => a.name)).toEqual(['class', 'data-action', 'data-item-type', 'draggable']);
    expect(card.getAttribute('data-item-type')).toBe(EVIL);
  });

  it('keeps a custom engine id inside data-engine-id instead of injecting attributes', async () => {
    const cs = createMockChromeStorage({ startpage_engines: [{ id: EVIL, name: 'E', url: 'https://e.com/?q=%s' }] });
    globalThis.chrome = { storage: { local: cs.storage.local } };
    // 驱动 renderEngineDropdown 需要 customEngines：经 loadAll 注入（与既有 render-dom-light 用例同法）
    const app2 = loadAppModule();
    await app2.loadAll();
    app2.renderEngineDropdown();

    const list = document.getElementById('engine-list');
    const items = list.querySelectorAll('.engine-item');
    expect(items.length).toBe(4); // 3 DEFAULT_ENGINES + 1 custom
    const customItem = items[3]; // customEngines come after the defaults
    // A single data-engine-id attribute means the quote in EVIL did not split
    // the attribute and inject an onmouseover handler.
    expect(Array.from(customItem.attributes).map(a => a.name)).toEqual(['class', 'data-engine-id']);
    expect(customItem.getAttribute('data-engine-id')).toBe(EVIL);
    // The delete button carries the same id (second interpolation site).
    const deleteBtn = customItem.querySelector('[data-action="delete-engine"]');
    expect(deleteBtn.getAttribute('data-engine-id')).toBe(EVIL);
  });

  it('still renders the normal case unchanged', () => {
    const html = app.createGridItemHTML({ id: 'a', type: 'link', name: 'GitHub', size: '1x1', url: 'https://github.com' });
    expect(html).toContain('data-item-type="link"');
  });
});
