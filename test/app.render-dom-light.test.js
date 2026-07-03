import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadAppModule } from './helpers/loadAppModule.js';
import { installAppDomFixture } from './helpers/appDomFixture.js';
import { createMockChromeStorage } from './helpers/mockChromeStorage.js';

// Batch 3, Task 2: engine dropdown + wallpaper apply + toast/signin notice —
// 9 functions layered on top of Task 1's fixture/setup. Functions that write
// through chrome.storage (selectEngine/deleteEngine/addEngine/
// removeWallpaperAction) need createMockChromeStorage attached to
// globalThis.chrome BEFORE loadAppModule() re-evaluates app.js, per the
// pattern in test/app.storage-state.test.js — the closure-private `storage`
// const is captured at eval time. Functions that touch requestAnimationFrame
// (showToast/showSigninNotice) need a synchronous RAF stub since jsdom does
// not implement it, plus fake timers to assert the setTimeout-driven
// hide/dismiss behavior.

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

  describe('renderEngineDropdown', () => {
    it('renders only the 3 DEFAULT_ENGINES with no delete button when customEngines is empty (initial closure state)', () => {
      app.renderEngineDropdown();

      const list = document.getElementById('engine-list');
      const items = list.querySelectorAll('.engine-item');
      expect(items.length).toBe(3);
      expect(list.querySelectorAll('[data-action="delete-engine"]').length).toBe(0);
      expect(list.textContent).toContain('Google');
      expect(list.textContent).toContain('Bing');
      expect(list.textContent).toContain('DuckDuckGo');
    });

    it('adds a delete button for custom engines once customEngines is populated via loadAll', async () => {
      const cs = createMockChromeStorage({ startpage_engines: [{ id: 'x', name: 'X', url: 'https://x.example/?q=%s' }] });
      globalThis.chrome = { storage: { local: cs.storage.local } };
      const localApp = loadAppModule();
      await localApp.loadAll();

      localApp.renderEngineDropdown();

      const list = document.getElementById('engine-list');
      expect(list.querySelectorAll('.engine-item').length).toBe(4);
      const deleteBtn = list.querySelector('[data-action="delete-engine"][data-engine-id="x"]');
      expect(deleteBtn).not.toBeNull();
      // the 3 defaults still carry no delete button
      expect(list.querySelectorAll('[data-action="delete-engine"]').length).toBe(1);
    });
  });

  describe('toggleEngineDropdown', () => {
    it('opens the dropdown (rendering the list + hiding the add-engine form) when it starts hidden (fixture default)', () => {
      const dd = document.getElementById('engine-dropdown');
      const form = document.getElementById('add-engine-form');
      expect(dd.classList.contains('hidden')).toBe(true); // fixture default

      app.toggleEngineDropdown();

      expect(dd.classList.contains('hidden')).toBe(false);
      expect(form.classList.contains('hidden')).toBe(true);
      // renderEngineDropdown() ran as a side effect
      expect(document.getElementById('engine-list').querySelectorAll('.engine-item').length).toBe(3);
    });

    it('closes the dropdown (delegates to hideEngineDropdown) when it is already open', () => {
      const dd = document.getElementById('engine-dropdown');
      dd.classList.remove('hidden'); // simulate an already-open dropdown

      app.toggleEngineDropdown();

      expect(dd.classList.contains('hidden')).toBe(true);
    });
  });

  describe('selectEngine', () => {
    let cs;

    beforeEach(() => {
      cs = createMockChromeStorage({});
      globalThis.chrome = { storage: { local: cs.storage.local } };
      app = loadAppModule(); // re-load AFTER mock is attached (Global Constraint 7)
    });

    afterEach(() => {
      delete globalThis.chrome;
    });

    it('sets #engine-name to the matched engine name, persists via saveEngines, and hides the dropdown', () => {
      const dd = document.getElementById('engine-dropdown');
      dd.classList.remove('hidden'); // simulate an already-open dropdown, to observe hideEngineDropdown's effect

      app.selectEngine('bing');

      expect(document.getElementById('engine-name').textContent).toBe('Bing');
      expect(cs._data.startpage_selected_engine).toBe('bing');
      expect(dd.classList.contains('hidden')).toBe(true);
    });

    it('falls back to "Google" for an id that matches no known engine', () => {
      app.selectEngine('does-not-exist');

      expect(document.getElementById('engine-name').textContent).toBe('Google');
      expect(cs._data.startpage_selected_engine).toBe('does-not-exist');
    });
  });

  describe('deleteEngine', () => {
    it('removes the engine from customEngines, persists via saveEngines, and re-renders the list without its delete button', async () => {
      const cs = createMockChromeStorage({
        startpage_engines: [
          { id: 'x', name: 'X', url: 'https://x.example/?q=%s' },
          { id: 'y', name: 'Y', url: 'https://y.example/?q=%s' },
        ],
        startpage_selected_engine: 'y',
      });
      globalThis.chrome = { storage: { local: cs.storage.local } };
      const localApp = loadAppModule();
      await localApp.loadAll();

      localApp.deleteEngine('x');

      expect(cs._data.startpage_engines).toEqual([{ id: 'y', name: 'Y', url: 'https://y.example/?q=%s' }]);
      const list = document.getElementById('engine-list');
      expect(list.querySelector('[data-engine-id="x"]')).toBeNull();
      expect(list.querySelector('[data-action="delete-engine"][data-engine-id="y"]')).not.toBeNull();
    });

    it('falls back the selection to the first engine and updates #engine-name when the deleted engine was selected', async () => {
      const cs = createMockChromeStorage({
        startpage_engines: [{ id: 'x', name: 'X', url: 'https://x.example/?q=%s' }],
        startpage_selected_engine: 'x',
      });
      globalThis.chrome = { storage: { local: cs.storage.local } };
      const localApp = loadAppModule();
      await localApp.loadAll();

      localApp.deleteEngine('x');

      // getAllEngines() = [...DEFAULT_ENGINES, ...customEngines] -> defaults always precede
      // customs, so once the last custom engine is gone the fallback is DEFAULT_ENGINES[0].
      expect(cs._data.startpage_selected_engine).toBe('google');
      expect(document.getElementById('engine-name').textContent).toBe('Google');
    });
  });

  describe('addEngine', () => {
    let cs;
    let nameInput;
    let urlInput;

    beforeEach(() => {
      cs = createMockChromeStorage({});
      globalThis.chrome = { storage: { local: cs.storage.local } };
      app = loadAppModule(); // re-load AFTER mock is attached (Global Constraint 7)
      nameInput = document.getElementById('new-engine-name');
      urlInput = document.getElementById('new-engine-url');
    });

    afterEach(() => {
      delete globalThis.chrome;
    });

    it('rejects an empty name: red border + focus on the name input, nothing persisted', () => {
      nameInput.value = '';
      urlInput.value = 'https://x.example/?q=%s';

      app.addEngine();

      expect(nameInput.style.borderColor).toBe('rgb(239, 68, 68)');
      expect(document.activeElement).toBe(nameInput);
      expect(cs._data.startpage_engines).toBeUndefined();
    });

    it('rejects an empty url: red border + focus on the url input, nothing persisted', () => {
      nameInput.value = 'My Engine';
      urlInput.value = '';

      app.addEngine();

      expect(urlInput.style.borderColor).toBe('rgb(239, 68, 68)');
      expect(document.activeElement).toBe(urlInput);
      expect(cs._data.startpage_engines).toBeUndefined();
    });

    it('rejects a url without "%s": red border + focus on the url input, nothing persisted', () => {
      nameInput.value = 'My Engine';
      urlInput.value = 'https://x.example/search';

      app.addEngine();

      expect(urlInput.style.borderColor).toBe('rgb(239, 68, 68)');
      expect(document.activeElement).toBe(urlInput);
      expect(cs._data.startpage_engines).toBeUndefined();
    });

    it('adds a valid engine: persists, re-renders the list, clears the inputs, and hides the form', () => {
      const form = document.getElementById('add-engine-form');
      form.classList.remove('hidden'); // simulate the form being open
      nameInput.value = 'My Engine';
      urlInput.value = 'https://x.example/?q=%s';

      app.addEngine();

      expect(cs._data.startpage_engines).toHaveLength(1);
      expect(cs._data.startpage_engines[0]).toMatchObject({ name: 'My Engine', url: 'https://x.example/?q=%s' });
      const list = document.getElementById('engine-list');
      expect(list.textContent).toContain('My Engine');
      expect(nameInput.value).toBe('');
      expect(urlInput.value).toBe('');
      expect(form.classList.contains('hidden')).toBe(true);
    });
  });

  describe('applyWallpaper', () => {
    it('clears the wallpaper background and restores the decorative blobs when wallpaper is null (initial closure state)', () => {
      app.applyWallpaper();

      document.querySelectorAll('.blob').forEach((blob) => {
        expect(blob.style.display).toBe('');
      });
      expect(document.getElementById('wallpaper-bg').style.backgroundImage).toBe('');
      expect(document.getElementById('sidebar-wallpaper-preview').dataset.empty).toBe('true');
    });

    // NOTE: like the Task 1 updateSidebarWallpaperPreview test, `wallpaper` is
    // a plain string (a data/https URL) once loadAll() resolves it, not a
    // `{ data: ... }` object as an earlier draft of this task modeled it.
    it('sets the background image and hides the blobs when wallpaper resolves to a non-empty string', async () => {
      const wallpaperValue = 'https://x/y.png';
      const cs = createMockChromeStorage({ startpage_wallpaper: wallpaperValue });
      globalThis.chrome = { storage: { local: cs.storage.local } };
      const localApp = loadAppModule();
      await localApp.loadAll();

      localApp.applyWallpaper();

      document.querySelectorAll('.blob').forEach((blob) => {
        expect(blob.style.display).toBe('none');
      });
      expect(document.getElementById('wallpaper-bg').style.backgroundImage).toBe(`url("${localApp.escapeCssUrl(wallpaperValue)}")`);
      expect(document.getElementById('sidebar-wallpaper-preview').dataset.empty).toBe('false');
    });
  });

  describe('removeWallpaperAction', () => {
    it('clears the wallpaper, removes it from storage, and re-applies (restoring the blobs)', async () => {
      const cs = createMockChromeStorage({ startpage_wallpaper: 'https://x/y.png' });
      globalThis.chrome = { storage: { local: cs.storage.local } };
      const localApp = loadAppModule();
      await localApp.loadAll();
      // sanity: wallpaper is applied before removal
      localApp.applyWallpaper();
      expect(document.getElementById('wallpaper-bg').style.backgroundImage).not.toBe('');

      await localApp.removeWallpaperAction();

      expect(cs._data.startpage_wallpaper).toBeUndefined();
      document.querySelectorAll('.blob').forEach((blob) => {
        expect(blob.style.display).toBe('');
      });
      expect(document.getElementById('wallpaper-bg').style.backgroundImage).toBe('');
    });
  });

  describe('showToast', () => {
    beforeEach(() => {
      // vi.useFakeTimers() replaces requestAnimationFrame with its own queued
      // mock by default, so the synchronous stub must be installed AFTER
      // enabling fake timers to take effect (order matters here).
      vi.useFakeTimers();
      globalThis.requestAnimationFrame = vi.fn((cb) => { cb(); return 1; });
    });

    afterEach(() => {
      vi.useRealTimers();
      delete globalThis.requestAnimationFrame;
    });

    it('shows the message/variant, becomes visible via RAF, then hides after 3200ms + a 180ms fade-out', () => {
      const toast = document.getElementById('app-toast');
      expect(toast.classList.contains('hidden')).toBe(true); // fixture default

      app.showToast('hello', 'error');

      expect(toast.textContent).toBe('hello');
      expect(toast.dataset.variant).toBe('error');
      expect(toast.classList.contains('hidden')).toBe(false);
      expect(toast.classList.contains('is-visible')).toBe(true); // RAF stub ran synchronously

      vi.advanceTimersByTime(3200);
      expect(toast.classList.contains('is-visible')).toBe(false);
      expect(toast.classList.contains('hidden')).toBe(false); // second (180ms) timer not fired yet

      vi.advanceTimersByTime(180);
      expect(toast.classList.contains('hidden')).toBe(true);
      expect(toast.textContent).toBe('');
      expect('variant' in toast.dataset).toBe(false);
    });

    it('clears the pending hide-timer from a first call when a second call arrives before it fires', () => {
      const toast = document.getElementById('app-toast');

      app.showToast('first');
      vi.advanceTimersByTime(100);
      app.showToast('second', 'error');

      // If the first call's 3200ms timer had NOT been cleared, it would fire
      // here (100ms + 3100ms = the first call's original 3200ms mark) and
      // stomp the second toast's visible state.
      vi.advanceTimersByTime(3100);
      expect(toast.textContent).toBe('second');
      expect(toast.dataset.variant).toBe('error');
      expect(toast.classList.contains('is-visible')).toBe(true);

      // The second call's own 3200ms timer fires 100ms later (started at
      // t=100, so its mark is at t=3300; we're currently at t=3200).
      vi.advanceTimersByTime(100);
      expect(toast.classList.contains('is-visible')).toBe(false);

      vi.advanceTimersByTime(180);
      expect(toast.classList.contains('hidden')).toBe(true);
      expect(toast.textContent).toBe('');
    });
  });

  describe('showSigninNotice', () => {
    beforeEach(() => {
      // See showToast's beforeEach: fake timers must be enabled BEFORE the
      // synchronous requestAnimationFrame stub is installed, or the fake
      // timers' own rAF mock overwrites it.
      vi.useFakeTimers();
      globalThis.requestAnimationFrame = vi.fn((cb) => { cb(); return 1; });
      sessionStorage.clear(); // jsdom sessionStorage persists across tests in this file
    });

    afterEach(() => {
      vi.useRealTimers();
      delete globalThis.requestAnimationFrame;
      sessionStorage.clear();
    });

    it('marks the session, shows the notice via RAF, and auto-hides after 5000ms', () => {
      const notice = document.getElementById('signin-notice');

      app.showSigninNotice();

      expect(sessionStorage.getItem('lithium.notice.signin.shown')).toBe('1');
      expect(notice.classList.contains('is-visible')).toBe(true);

      vi.advanceTimersByTime(5000);
      expect(notice.classList.contains('is-visible')).toBe(false);
    });

    it('is a no-op on a second call within the same session (returns before RAF runs)', () => {
      const notice = document.getElementById('signin-notice');

      app.showSigninNotice();
      notice.classList.remove('is-visible'); // reset so we can tell the 2nd call did nothing

      app.showSigninNotice();

      expect(notice.classList.contains('is-visible')).toBe(false);
    });
  });
});
