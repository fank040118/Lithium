import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadAppModule } from './helpers/loadAppModule.js';
import { installAppDomFixture } from './helpers/appDomFixture.js';
import { createMockChromeStorage } from './helpers/mockChromeStorage.js';

// Batch 3, Task 1: render/dom-light layer — 12 leaf/light-DOM functions that
// read or write a handful of fixed elements in the real newtab.html markup
// (see test/helpers/appDomFixture.js) without orchestrating other untested
// app.js functions. Each test gets a fresh closure via loadAppModule() and a
// freshly-installed DOM fixture, matching the isolation pattern used by the
// batch-1/batch-2 app.js test files.
describe('app.js render/dom-light layer', () => {
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
    if (window && 'iconCache' in window) delete window.iconCache;
    vi.restoreAllMocks();
  });

  describe('getCurrentType', () => {
    it('returns "link" when the link type-btn carries type-btn-active (fixture default)', () => {
      expect(app.getCurrentType()).toBe('link');
    });

    it('returns "folder" once the active class moves to the folder button', () => {
      document.querySelector('.type-btn[data-type="link"]').classList.remove('type-btn-active');
      document.querySelector('.type-btn[data-type="folder"]').classList.add('type-btn-active');
      expect(app.getCurrentType()).toBe('folder');
    });

    it('falls back to "link" when no type-btn is active', () => {
      document.querySelectorAll('.type-btn').forEach((btn) => btn.classList.remove('type-btn-active'));
      expect(app.getCurrentType()).toBe('link');
    });
  });

  describe('hideEngineDropdown', () => {
    it('adds the hidden class back to #engine-dropdown', () => {
      const dd = document.getElementById('engine-dropdown');
      dd.classList.remove('hidden'); // simulate an already-open dropdown
      app.hideEngineDropdown();
      expect(dd.classList.contains('hidden')).toBe(true);
    });
  });

  describe('hideContextMenu', () => {
    it('adds the hidden class back to #context-menu', () => {
      const menu = document.getElementById('context-menu');
      menu.classList.remove('hidden'); // simulate an already-open menu
      app.hideContextMenu();
      expect(menu.classList.contains('hidden')).toBe(true);
    });
    // contextTarget is a private closure variable with no public getter;
    // only the DOM side effect is verifiable from this test file.
  });

  describe('openDeleteConfirm / hideDeleteConfirm', () => {
    it('round-trips #delete-overlay hidden state', () => {
      const overlay = document.getElementById('delete-overlay');
      expect(overlay.classList.contains('hidden')).toBe(true); // fixture default

      app.openDeleteConfirm('item-1');
      expect(overlay.classList.contains('hidden')).toBe(false);

      app.hideDeleteConfirm();
      expect(overlay.classList.contains('hidden')).toBe(true);
    });
  });

  describe('hideClockSettings', () => {
    it('adds the hidden class back to #clock-overlay', () => {
      const overlay = document.getElementById('clock-overlay');
      overlay.classList.remove('hidden'); // simulate an already-open settings modal
      app.hideClockSettings();
      expect(overlay.classList.contains('hidden')).toBe(true);
    });
  });

  describe('setUrlFieldVisible', () => {
    it('clears inline display when visible=true', () => {
      const wrap = document.getElementById('url-field-wrap');
      wrap.style.display = 'none';
      app.setUrlFieldVisible(true);
      expect(wrap.style.display).toBe('');
    });

    it('sets display:none when visible=false', () => {
      const wrap = document.getElementById('url-field-wrap');
      app.setUrlFieldVisible(false);
      expect(wrap.style.display).toBe('none');
    });
  });

  describe('applyWallpaperEffects', () => {
    // KNOWN LIMITATION: wallpaperBlur/wallpaperDim are closure-private `let`
    // bindings with no public setter reachable from this test file, so only
    // the default-0 branch is exercisable here. The non-zero blur()/rgba()
    // string-formatting branches are not covered by this task.
    it('writes the default (0/0) blur/dim state to all six target elements', () => {
      app.applyWallpaperEffects();

      expect(document.getElementById('wallpaper-bg').style.filter).toBe('');
      expect(document.getElementById('wallpaper-dim').style.background).toBe('');
      expect(document.getElementById('wallpaper-blur-range').value).toBe('0');
      expect(document.getElementById('wallpaper-dim-range').value).toBe('0');
      expect(document.getElementById('wallpaper-blur-value').textContent).toBe('0');
      expect(document.getElementById('wallpaper-dim-value').textContent).toBe('0%');
    });
  });

  describe('updateSidebarWallpaperPreview', () => {
    it('renders the empty state when wallpaper is null (initial closure state)', () => {
      app.updateSidebarWallpaperPreview();

      const preview = document.getElementById('sidebar-wallpaper-preview');
      const label = document.getElementById('sidebar-wallpaper-preview-label');
      const clearBtn = document.getElementById('sidebar-wallpaper-clear-btn');

      expect(preview.dataset.empty).toBe('true');
      expect(preview.style.backgroundImage).toBe('');
      expect(preview.getAttribute('aria-label')).toBe('sidebar.wallpaper.previewAria');
      expect(label.textContent).toBe('sidebar.wallpaper.previewLabel');
      expect(clearBtn.disabled).toBe(true);
      expect(clearBtn.getAttribute('aria-disabled')).toBe('true');
    });

    // NOTE: the task brief modeled wallpaper storage as `{ startpage_wallpaper:
    // { data: 'abc' } }`, but loadAll() does `wallpaper = data.startpage_wallpaper
    // || null` and updateSidebarWallpaperPreview() feeds `wallpaper` straight
    // into escapeCssUrl(), i.e. it is a plain string (a data: URL in
    // production), not an object. Corrected here to match real behavior.
    it('renders the "current wallpaper" state after loadAll resolves a wallpaper string', async () => {
      const wallpaperValue = 'data:image/png;base64,abc';
      const cs = createMockChromeStorage({ startpage_wallpaper: wallpaperValue });
      globalThis.chrome = { storage: { local: cs.storage.local } };
      const localApp = loadAppModule(); // fresh closure so `storage` binds to this chrome mock
      await localApp.loadAll();

      localApp.updateSidebarWallpaperPreview();

      const preview = document.getElementById('sidebar-wallpaper-preview');
      const label = document.getElementById('sidebar-wallpaper-preview-label');
      const clearBtn = document.getElementById('sidebar-wallpaper-clear-btn');

      expect(preview.dataset.empty).toBe('false');
      expect(preview.style.backgroundImage).toBe(`url("${localApp.escapeCssUrl(wallpaperValue)}")`);
      expect(preview.getAttribute('aria-label')).toBe('sidebar.wallpaper.previewCurrentAria');
      expect(label.textContent).toBe('sidebar.wallpaper.previewCurrentLabel');
      expect(clearBtn.disabled).toBe(false);
      expect(clearBtn.getAttribute('aria-disabled')).toBe('false');
    });
  });

  describe('handleManagedImageError', () => {
    it('applies the fallback src once when fallbackSrc is set and not yet applied', () => {
      const img = document.createElement('img');
      img.dataset.fallbackSrc = 'https://example.com/fallback.png';
      app.handleManagedImageError(img);

      expect(img.src).toBe('https://example.com/fallback.png');
      expect(img.dataset.fallbackApplied).toBe('true');
    });

    it('removes the image when errorMode is "remove" and no fresh fallback applies', () => {
      const img = document.createElement('img');
      img.dataset.errorMode = 'remove';
      document.body.appendChild(img);
      expect(img.isConnected).toBe(true);

      app.handleManagedImageError(img);

      expect(img.isConnected).toBe(false);
    });

    it('removes the image when the fallback was already applied, even without errorMode=remove semantics bypassed', () => {
      const img = document.createElement('img');
      img.dataset.fallbackSrc = 'https://example.com/fallback.png';
      img.dataset.fallbackApplied = 'true'; // already applied on a prior error
      img.dataset.errorMode = 'remove';
      document.body.appendChild(img);

      app.handleManagedImageError(img);

      expect(img.isConnected).toBe(false);
    });

    it('hides the image (display:none) for errorMode "hide"', () => {
      const img = document.createElement('img');
      img.dataset.errorMode = 'hide';
      app.handleManagedImageError(img);

      expect(img.style.display).toBe('none');
    });

    it('hides the image and reveals the next sibling for errorMode "show-sibling"', () => {
      const wrap = document.createElement('div');
      const img = document.createElement('img');
      img.dataset.errorMode = 'show-sibling';
      const sibling = document.createElement('span');
      sibling.style.display = 'none';
      wrap.appendChild(img);
      wrap.appendChild(sibling);
      document.body.appendChild(wrap);

      app.handleManagedImageError(img);

      expect(img.style.display).toBe('none');
      expect(img.nextElementSibling).toBe(sibling);
      expect(sibling.style.display).toBe('');
    });
  });

  describe('updateGridItemSizes', () => {
    // jsdom (v29, verified locally) correctly reflects inline
    // `grid-template-columns` / `gap` back through getComputedStyle(), so no
    // Object.defineProperty workaround is needed and no known limitation
    // applies to this function's primary path.
    it('writes computed CSS custom properties onto each .grid-item-wrap[data-size]', () => {
      const container = document.getElementById('grid-container');
      expect(container.classList.contains('grid-area')).toBe(true);
      container.innerHTML = `
        <div style="grid-template-columns:80px 80px;gap:16px">
          <div class="grid-item-wrap" data-size="1x1"></div>
          <div class="grid-item-wrap" data-size="2x2"></div>
        </div>
      `;

      app.updateGridItemSizes();

      const wrap1x1 = container.querySelector('[data-size="1x1"]');
      const wrap2x2 = container.querySelector('[data-size="2x2"]');
      const metrics2x2 = app.getGridItemMetrics('2x2', 80, 16);

      expect(wrap1x1.style.getPropertyValue('--base-card-size')).toBe('64px'); // Math.min(80,64)
      expect(wrap1x1.style.height).toBe(''); // no FOLDER_SLOT_LAYOUTS entry for 1x1 -> wrapHeight:null
      expect(wrap2x2.style.getPropertyValue('--card-w')).toBe(`${Math.round(metrics2x2.cardWidth)}px`);
      expect(wrap2x2.style.getPropertyValue('--card-h')).toBe(`${Math.round(metrics2x2.cardHeight)}px`);
      expect(wrap2x2.style.height).toBe(`${Math.round(metrics2x2.wrapHeight)}px`);
    });

    it('silently skips a container whose grid-template-columns is unparsable, without throwing or touching other containers', () => {
      const container = document.getElementById('grid-container');
      container.innerHTML = `
        <div><div class="grid-item-wrap" data-size="1x1"></div></div>
        <div style="grid-template-columns:80px 80px;gap:16px"><div class="grid-item-wrap" data-size="1x1"></div></div>
      `;

      expect(() => app.updateGridItemSizes()).not.toThrow();

      const wraps = container.querySelectorAll('.grid-item-wrap');
      expect(wraps[0].style.getPropertyValue('--base-card-size')).toBe(''); // untouched: colWidth was NaN
      expect(wraps[1].style.getPropertyValue('--base-card-size')).toBe('64px'); // sibling container still processed
    });

    it('does not throw when no matching elements exist (pristine fixture)', () => {
      expect(() => app.updateGridItemSizes()).not.toThrow();
    });
  });

  describe('applyMainGridColumns', () => {
    it('sets --main-grid-max-width/--main-content-max-width and syncs the sidebar controls for the default 8-column state', () => {
      app.applyMainGridColumns();

      const root = document.documentElement;
      expect(root.style.getPropertyValue('--main-grid-max-width')).toBe('752px'); // 8*80 + 7*16
      expect(root.style.getPropertyValue('--main-content-max-width')).toBe('800px'); // 752 + MAIN_CONTENT_SIDE_PADDING(48)
      expect(document.getElementById('grid-columns-range').value).toBe('8');
      expect(document.getElementById('grid-columns-value').textContent).toBe('8');
    });
  });
});
