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

  // Batch 3, Task 3: clock settings + edit modal type toggle — 9 functions.
  // updateClock/saveClockSettings write through chrome.storage (via
  // saveClocks/loadAll), so per Global Constraint 8 those describes attach
  // createMockChromeStorage to globalThis.chrome BEFORE loadAppModule()
  // re-evaluates app.js, then re-load a local `app` inside their own
  // beforeEach/tests (mirroring the selectEngine/addEngine pattern above).
  // The mock's local.set assigns synchronously into `_data` before it hits
  // its own `await`/return, so callers here can assert on `cs._data`
  // immediately after calling the sync app.* function under test, without
  // awaiting anything extra (same as the deleteEngine/selectEngine tests).
  describe('updateClock', () => {
    it('sets data-count="0" and creates no .clock-container when clocks is the empty default (no loadAll called)', () => {
      const wrap = document.getElementById('clocks-wrap');

      app.updateClock();

      expect(wrap.dataset.count).toBe('0');
      expect(wrap.querySelectorAll('.clock-container').length).toBe(0);
    });

    it('renders one populated .clock-container once clocks is driven to 1 entry via loadAll', async () => {
      const cs = createMockChromeStorage({
        startpage_clocks: [{ tz: 'Asia/Shanghai', key: 'beijing' }],
      });
      globalThis.chrome = { storage: { local: cs.storage.local } };
      const localApp = loadAppModule();
      await localApp.loadAll();
      const wrap = document.getElementById('clocks-wrap');

      localApp.updateClock();

      expect(wrap.dataset.count).toBe('1');
      const containers = wrap.querySelectorAll('.clock-container');
      expect(containers.length).toBe(1);

      const clockText = wrap.querySelector('.clock-text[data-clock-idx="0"]');
      const dateText = wrap.querySelector('.date-text[data-clock-idx="0"]');
      const tzLabel = wrap.querySelector('.tz-label[data-clock-idx="0"]');
      expect(clockText.textContent).not.toBe('');
      expect(dateText.textContent).not.toBe('');
      expect(tzLabel.textContent).not.toBe('');

      const c = { tz: 'Asia/Shanghai', key: 'beijing' };
      const expectedPrefix = localApp.getClockCityName(c) + ' · UTC' + localApp.getTimezoneOffset(c.tz, new Date());
      expect(tzLabel.textContent).toBe(expectedPrefix);

      delete globalThis.chrome;
    });

    it('does not rebuild existing .clock-container elements on a second call with the same count', async () => {
      const cs = createMockChromeStorage({
        startpage_clocks: [{ tz: 'Asia/Shanghai', key: 'beijing' }],
      });
      globalThis.chrome = { storage: { local: cs.storage.local } };
      const localApp = loadAppModule();
      await localApp.loadAll();
      const wrap = document.getElementById('clocks-wrap');

      localApp.updateClock();
      const container = wrap.querySelector('.clock-container');
      container.setAttribute('data-marker', 'x');

      localApp.updateClock();

      expect(wrap.dataset.count).toBe('1');
      expect(wrap.querySelectorAll('.clock-container').length).toBe(1);
      expect(wrap.querySelector('.clock-container').getAttribute('data-marker')).toBe('x');

      delete globalThis.chrome;
    });
  });

  describe('renderClockSettings', () => {
    it('renders one .clock-entry with a select and an add-clock button when tempClocks has 1 entry (< MAX_CLOCKS)', async () => {
      const cs = createMockChromeStorage({
        startpage_clocks: [{ tz: 'Asia/Shanghai', key: 'beijing' }],
      });
      globalThis.chrome = { storage: { local: cs.storage.local } };
      const localApp = loadAppModule();
      await localApp.loadAll();
      localApp.showClockSettings(); // drives the private tempClocks via deepClone(clocks)

      const list = document.getElementById('clock-list');

      expect(list.querySelectorAll('.clock-entry').length).toBe(1);
      expect(list.querySelector('.clock-entry .clock-tz-select')).not.toBeNull();
      expect(list.querySelector('[data-action="add-clock"]')).not.toBeNull();
      expect(list.querySelector('.clock-limit-msg')).toBeNull();

      delete globalThis.chrome;
    });

    it('renders 2 .clock-entry elements and an atLimit message (no add-clock button) when tempClocks has 2 entries', async () => {
      const cs = createMockChromeStorage({
        startpage_clocks: [
          { tz: 'Asia/Shanghai', key: 'beijing' },
          { tz: 'Asia/Tokyo', key: 'tokyo' },
        ],
      });
      globalThis.chrome = { storage: { local: cs.storage.local } };
      const localApp = loadAppModule();
      await localApp.loadAll();
      localApp.showClockSettings();

      const list = document.getElementById('clock-list');

      expect(list.querySelectorAll('.clock-entry').length).toBe(2);
      expect(list.querySelector('[data-action="add-clock"]')).toBeNull();
      const limitMsg = list.querySelector('.clock-limit-msg');
      expect(limitMsg).not.toBeNull();
      // t() is mocked to return the key verbatim; the {max:2} interpolation
      // argument is ignored by the mock (Global Constraint 5).
      expect(limitMsg.textContent).toBe('dialog.clockSettings.atLimit');

      delete globalThis.chrome;
    });
  });

  describe('showClockSettings', () => {
    it('sets tempClocks to an empty deep clone of the default clocks=[] and removes #clock-overlay hidden', () => {
      const overlay = document.getElementById('clock-overlay');
      const list = document.getElementById('clock-list');

      app.showClockSettings();

      expect(overlay.classList.contains('hidden')).toBe(false);
      // Observed indirectly via renderClockSettings' output (tempClocks has no public getter).
      expect(list.querySelectorAll('.clock-entry').length).toBe(0);
      expect(list.querySelector('[data-action="add-clock"]')).not.toBeNull();
    });
  });

  describe('saveClockSettings', () => {
    it('rebuilds clocks from #clock-list selects, persists via saveClocks, hides the overlay, and refreshes #clocks-wrap', () => {
      const cs = createMockChromeStorage({});
      globalThis.chrome = { storage: { local: cs.storage.local } };
      const localApp = loadAppModule();
      localApp.showClockSettings();

      // renderClockSettings' real <select> (grouped optgroups) is complex to
      // reproduce; a hand-built <select class="clock-tz-select"> is enough
      // since saveClockSettings only queries that selector (Global Constraint 7).
      const list = document.getElementById('clock-list');
      list.innerHTML = '<select class="clock-tz-select"><option value="Asia/Tokyo" data-key="tokyo" selected></option></select>';

      localApp.saveClockSettings();

      expect(cs._data.startpage_clocks).toEqual([
        { id: expect.any(String), tz: 'Asia/Tokyo', key: 'tokyo' },
      ]);
      expect(document.getElementById('clock-overlay').classList.contains('hidden')).toBe(true);
      expect(document.getElementById('clocks-wrap').dataset.count).toBe('1');

      delete globalThis.chrome;
    });
  });

  describe('resetTypeToggle', () => {
    it('resets #type-toggle to visible, calls setUrlFieldVisible(true), and reactivates the link type-btn', () => {
      const typeToggle = document.getElementById('type-toggle');
      const urlFieldWrap = document.getElementById('url-field-wrap');
      const linkBtn = document.querySelector('.type-btn[data-type="link"]');
      const folderBtn = document.querySelector('.type-btn[data-type="folder"]');

      // Simulate a prior "folder" selection, to verify resetTypeToggle flips it back.
      typeToggle.style.display = 'none';
      urlFieldWrap.style.display = 'none';
      linkBtn.classList.remove('type-btn-active');
      folderBtn.classList.add('type-btn-active');

      app.resetTypeToggle();

      expect(typeToggle.style.display).toBe('');
      expect(urlFieldWrap.style.display).toBe(''); // real setUrlFieldVisible(true) call
      expect(linkBtn.classList.contains('type-btn-active')).toBe(true);
      expect(folderBtn.classList.contains('type-btn-active')).toBe(false);
    });
  });

  describe('setActiveType', () => {
    it('activates the folder type-btn and hides the url field wrap', () => {
      app.setActiveType('folder');

      expect(document.querySelector('.type-btn[data-type="folder"]').classList.contains('type-btn-active')).toBe(true);
      expect(document.querySelector('.type-btn[data-type="link"]').classList.contains('type-btn-active')).toBe(false);
      expect(document.getElementById('url-field-wrap').style.display).toBe('none');
    });

    it('activates the link type-btn and shows the url field wrap', () => {
      // Start from the folder state set by a previous call, to confirm the toggle reverses.
      app.setActiveType('folder');

      app.setActiveType('link');

      expect(document.querySelector('.type-btn[data-type="link"]').classList.contains('type-btn-active')).toBe(true);
      expect(document.querySelector('.type-btn[data-type="folder"]').classList.contains('type-btn-active')).toBe(false);
      expect(document.getElementById('url-field-wrap').style.display).toBe('');
    });
  });

  describe('updateIconPreview', () => {
    it('renders an <img> and unhides #icon-clear-btn when given a dataUrl', () => {
      const dataUrl = 'data:image/png;base64,AAA';

      app.updateIconPreview(dataUrl);

      const preview = document.getElementById('icon-preview');
      expect(preview.innerHTML).toContain('<img src="' + dataUrl + '"');
      expect(document.getElementById('icon-clear-btn').classList.contains('hidden')).toBe(false);
    });

    it('renders the placeholder and hides #icon-clear-btn when given no dataUrl', () => {
      // Start from the "has an image" state to confirm the clear branch reverses it.
      app.updateIconPreview('data:image/png;base64,AAA');

      app.updateIconPreview('');

      const preview = document.getElementById('icon-preview');
      expect(preview.innerHTML).toContain('class="icon-preview-placeholder"');
      expect(preview.textContent).toBe('dialog.edit.iconNone'); // t() mock returns the key
      expect(document.getElementById('icon-clear-btn').classList.contains('hidden')).toBe(true);
    });
  });

  describe('showEditModal', () => {
    it('opens in "add" mode for a new top-level item: cleared fields, title=add, type-toggle visible, defaults to "link"', () => {
      document.getElementById('edit-name').value = 'stale';
      document.getElementById('edit-url').value = 'stale-url';

      app.showEditModal(null, false);

      expect(document.getElementById('edit-title').textContent).toBe('dialog.edit.add');
      expect(document.getElementById('edit-name').value).toBe('');
      expect(document.getElementById('edit-url').value).toBe('');
      expect(document.getElementById('type-toggle').style.display).toBe('flex');
      // Real setActiveType('link') call underneath the "add" branch's default:
      expect(document.querySelector('.type-btn[data-type="link"]').classList.contains('type-btn-active')).toBe(true);
      expect(document.getElementById('url-field-wrap').style.display).toBe('');
      expect(document.getElementById('icon-upload-btn').textContent).toBe('dialog.edit.iconUpload');
      expect(document.activeElement).toBe(document.getElementById('edit-name'));
      expect(document.getElementById('edit-overlay').classList.contains('hidden')).toBe(false);
    });

    it('opens in "edit" mode for an existing link item: fields populated, title=edit, type-toggle hidden, url field visible', () => {
      const item = { id: '1', type: 'link', name: 'X', url: 'https://x', icon: '' };

      app.showEditModal(item, false);

      expect(document.getElementById('edit-title').textContent).toBe('dialog.edit.edit');
      expect(document.getElementById('edit-name').value).toBe('X');
      expect(document.getElementById('edit-url').value).toBe('https://x');
      expect(document.getElementById('type-toggle').style.display).toBe('none');
      expect(document.getElementById('url-field-wrap').style.display).toBe(''); // setUrlFieldVisible(true): item.type !== 'folder'
    });

    it('opens for a new item inside a folder: type-toggle hidden, url field visible (item?.type!=="folder" is true for null item)', () => {
      app.showEditModal(null, true);

      expect(document.getElementById('type-toggle').style.display).toBe('none');
      expect(document.getElementById('url-field-wrap').style.display).toBe('');
    });

    it('sets pendingIcon (observed via the upload button label) when the item already has an icon', () => {
      const item = { id: '2', type: 'link', name: 'Y', url: 'https://y', icon: 'data:image/png;base64,AAA' };

      app.showEditModal(item, false);

      expect(document.getElementById('icon-upload-btn').textContent).toBe('dialog.edit.iconUploadDone');
      expect(document.getElementById('icon-preview').innerHTML).toContain('<img src="data:image/png;base64,AAA"');
    });
  });

  describe('hideEditModal', () => {
    it('hides #edit-overlay and resets the type toggle (real resetTypeToggle call)', () => {
      const typeToggle = document.getElementById('type-toggle');
      app.showEditModal(null, true); // enters edit state with type-toggle hidden (display: 'none')
      expect(typeToggle.style.display).toBe('none');

      app.hideEditModal();

      expect(document.getElementById('edit-overlay').classList.contains('hidden')).toBe(true);
      expect(typeToggle.style.display).toBe(''); // resetTypeToggle() ran for real
    });
  });

  // Batch 3, Task 4: icon/grid render family — 7 functions with a real
  // dependency chain (renderFolderNormalSlot/renderFolderMiniSlot are leaves
  // called by renderIcon; renderIcon is called by createGridItemHTML; that is
  // called by renderGrid; renderGrid is called ×2 by render(); render() is
  // called by closeFolderWithAnimation()). Tests below call the real
  // downstream function wherever the brief calls for it, and only stub
  // window.iconCache to steer the icon/cached/favicon/letter branches.
  describe('renderFolderNormalSlot', () => {
    it('renders an empty slot for a null child', () => {
      expect(app.renderFolderNormalSlot(null)).toBe('<div class="folder-slot-normal folder-slot-empty"></div>');
    });

    it('renders a folder-icon slot when child.type is "folder"', () => {
      const html = app.renderFolderNormalSlot({ id: 'f1', type: 'folder', name: 'Sub', children: [] });
      expect(html).toBe('<div class="folder-slot-normal folder-slot-folder"><svg class="folder-slot-folder-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#e5e7eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg></div>');
    });

    it('uses child.icon via buildManagedImageTag when present (link child), with data-preview-child-id', () => {
      const child = { id: 'c1', type: 'link', name: 'Ex', url: 'https://ex.com', icon: 'data:image/png;base64,AAA' };
      const html = app.renderFolderNormalSlot(child);
      expect(html).toContain('data-preview-child-id="c1"');
      expect(html).toContain('src="data:image/png;base64,AAA"');
      expect(html).toContain('data-managed-img="true"');
      expect(html).toContain('data-error-mode="show-sibling"');
      expect(html).toContain('folder-slot-letter" style="display:none">E</span>');
    });

    it('falls back to window.iconCache.getCachedIcon(url) when no child.icon', () => {
      window.iconCache = { getCachedIcon: (url) => `cached:${url}` };
      const child = { id: 'c2', type: 'link', name: 'No Icon', url: 'https://noicon.com' };
      const html = app.renderFolderNormalSlot(child);
      expect(html).toContain('src="cached:https://noicon.com"');
    });

    it('falls back to getFavicon(url) when no icon and no cached hit', () => {
      window.iconCache = { getRemoteFaviconUrl: (host) => `fav://${host}`, getRemoteFallbackFaviconUrl: (host) => `favfallback://${host}` };
      const child = { id: 'c3', type: 'link', name: 'Fav', url: 'https://favtest.com' };
      const html = app.renderFolderNormalSlot(child);
      expect(html).toContain('src="fav://favtest.com"');
      expect(html).toContain('data-fallback-src="favfallback://favtest.com"');
    });

    it('falls back to the first-letter span when icon/cache/favicon all miss', () => {
      const child = { id: 'c4', type: 'link', name: 'Zeta', url: 'https://zeta.com' };
      const html = app.renderFolderNormalSlot(child);
      expect(html).toBe('<div class="folder-slot-normal" data-preview-child-id="c4"><span class="folder-slot-letter">Z</span></div>');
    });
  });

  describe('renderFolderMiniSlot', () => {
    it('renders null/folder/icon/cached-icon branches together inside one folder-slot-mini-group', () => {
      window.iconCache = { getCachedIcon: (url) => `cached:${url}` };
      const miniChildren = [
        null,
        { id: 'm1', type: 'folder', name: 'Sub', children: [] },
        { id: 'm2', type: 'link', name: 'Icon', url: 'https://icon.com', icon: 'data:image/png;base64,BBB' },
        { id: 'm3', type: 'link', name: 'Cached', url: 'https://cached.com' },
      ];
      const html = app.renderFolderMiniSlot(miniChildren);
      expect(html.startsWith('<div class="folder-slot-mini-group">')).toBe(true);
      expect(html).toContain('<div class="folder-mini-icon folder-mini-icon-empty"></div>');
      expect(html).toContain('folder-mini-icon folder-mini-folder-slot');
      expect(html).toContain('folder-mini-folder-icon');
      expect(html).toContain('src="data:image/png;base64,BBB"');
      expect(html).toContain('folder-mini-letter" style="display:none">I</span>');
      expect(html).toContain('src="cached:https://cached.com"');
      expect(html).toContain('folder-mini-letter" style="display:none">C</span>');
    });

    it('falls back to getFavicon(url) for a no-icon/no-cache child', () => {
      window.iconCache = { getRemoteFaviconUrl: (host) => `fav://${host}` };
      const html = app.renderFolderMiniSlot([{ id: 'm4', type: 'link', name: 'Fav', url: 'https://favmini.com' }]);
      expect(html).toContain('src="fav://favmini.com"');
    });

    it('falls back to the first-letter span when icon/cache/favicon all miss', () => {
      const html = app.renderFolderMiniSlot([{ id: 'm5', type: 'link', name: 'Zed', url: 'https://zed.com' }]);
      expect(html).toBe('<div class="folder-slot-mini-group"><div class="folder-mini-icon"><span class="folder-mini-letter">Z</span></div></div>');
    });
  });

  describe('renderIcon', () => {
    describe('type: link', () => {
      it('icon present, 1x1 (default) size -> unwrapped managed image + fallback letter span, no grid-item-link-preview wrapper', () => {
        const item = { id: 'l1', type: 'link', name: 'Ex', url: 'https://ex.com', icon: 'data:image/png;base64,CCC', size: '1x1' };
        const html = app.renderIcon(item);
        expect(html).not.toContain('grid-item-link-preview');
        expect(html).toContain('src="data:image/png;base64,CCC"');
        expect(html).toContain('style="width:100%;height:100%;display:block;object-fit:cover;pointer-events:none"');
        expect(html).toContain('style="display:none;font-size:1.875rem;font-weight:600;color:#cbd5e1;pointer-events:none">E</span>');
      });

      it('icon present, non-1x1 size -> wrapped in grid-item-link-preview (isExpandedLink)', () => {
        const item = { id: 'l2', type: 'link', name: 'Ex', url: 'https://ex.com', icon: 'data:image/png;base64,CCC', size: '1x2' };
        const html = app.renderIcon(item);
        expect(html.startsWith('<div class="grid-item-link-preview">')).toBe(true);
        expect(html.endsWith('</div>')).toBe(true);
        expect(html).toContain('src="data:image/png;base64,CCC"');
      });

      it('no icon, cached hit -> uses cached src', () => {
        window.iconCache = { getCachedIcon: () => 'cached-src' };
        const item = { id: 'l3', type: 'link', name: 'Ex', url: 'https://ex.com' };
        const html = app.renderIcon(item);
        expect(html).toContain('src="cached-src"');
      });

      it('no icon, no cache, favicon hit -> uses favicon src + fallback favicon src', () => {
        window.iconCache = { getRemoteFaviconUrl: () => 'fav-src', getRemoteFallbackFaviconUrl: () => 'fav-fallback' };
        const item = { id: 'l4', type: 'link', name: 'Ex', url: 'https://ex.com' };
        const html = app.renderIcon(item);
        expect(html).toContain('src="fav-src"');
        expect(html).toContain('data-fallback-src="fav-fallback"');
      });

      it('no icon, no cache, no favicon -> letter fallback span only, non-expanded (1x1)', () => {
        const item = { id: 'l5', type: 'link', name: 'Zeta', url: 'https://zeta.com', size: '1x1' };
        const html = app.renderIcon(item);
        expect(html).toBe('<span style="font-size:1.875rem;font-weight:600;color:#cbd5e1;pointer-events:none">Z</span>');
      });
    });

    describe('type: folder', () => {
      it('icon present -> managed image tag regardless of children', () => {
        const item = { id: 'f1', type: 'folder', name: 'F', icon: 'data:image/png;base64,DDD', children: [{ id: 'c1' }] };
        const html = app.renderIcon(item);
        expect(html).toContain('src="data:image/png;base64,DDD"');
      });

      it('no icon, empty children -> grid-folder-icon svg', () => {
        const item = { id: 'f2', type: 'folder', name: 'F', children: [] };
        const html = app.renderIcon(item);
        expect(html).toContain('grid-folder-icon');
      });

      it('no icon, children present, size 1x1 (no matching layout) -> 2x2 mini-grid preview with empty padding', () => {
        const item = {
          id: 'f3', type: 'folder', name: 'F', size: '1x1',
          children: [
            { id: 'c1', type: 'link', name: 'A', url: 'https://a.com', icon: 'data:image/png;base64,EEE' },
            { id: 'c2', type: 'link', name: 'B', url: 'https://b.com' },
          ],
        };
        const html = app.renderIcon(item);
        const wrap = document.createElement('div');
        wrap.innerHTML = html;
        expect(wrap.firstElementChild.className).toBe('folder-preview-grid');
        expect(wrap.querySelectorAll('.folder-preview-cell').length).toBe(4); // 2 previews + 2 empty pads
        expect(wrap.querySelectorAll('.folder-preview-cell.empty').length).toBe(2);
        expect(html).toContain('src="data:image/png;base64,EEE"');
      });

      it('no icon, children.length <= normalCount+1 for a slot-layout size (2x2) -> last slot rendered via real renderFolderNormalSlot, no mini-group', () => {
        const item = {
          id: 'f4', type: 'folder', name: 'F', size: '2x2',
          children: [
            { id: 'c1', type: 'link', name: 'A', url: 'https://a.com', icon: 'data:image/png;base64,111' },
            { id: 'c2', type: 'link', name: 'B', url: 'https://b.com', icon: 'data:image/png;base64,222' },
          ],
        };
        // 2x2 layout: cols=2, rows=2 -> normalCount=3; children.length(2) <= normalCount+1(4).
        const html = app.renderIcon(item);
        expect(html).toContain('folder-slot-grid');
        expect(html).toContain('grid-template-columns:repeat(2,var(--base-card-size))');
        expect(html).toContain('grid-template-rows:repeat(2,var(--base-card-size))');
        const wrap = document.createElement('div');
        wrap.innerHTML = html;
        const grid = wrap.querySelector('.folder-slot-grid');
        const normalSlots = Array.from(grid.children).filter((c) => c.classList.contains('folder-slot-normal'));
        expect(normalSlots.length).toBe(4); // 3 normal slots + the last slot rendered as a normal slot too
        expect(grid.querySelector('.folder-slot-mini-group')).toBeNull();
      });

      it('no icon, children.length > normalCount+1 for a slot-layout size (2x2) -> last slot rendered via real renderFolderMiniSlot', () => {
        const item = {
          id: 'f5', type: 'folder', name: 'F', size: '2x2',
          children: Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, type: 'link', name: `L${i}`, url: `https://l${i}.com`, icon: `data:img${i}` })),
        };
        // normalCount=3; children.length(6) > normalCount+1(4) -> mini-group branch.
        const html = app.renderIcon(item);
        const wrap = document.createElement('div');
        wrap.innerHTML = html;
        const grid = wrap.querySelector('.folder-slot-grid');
        const normalSlots = Array.from(grid.children).filter((c) => c.classList.contains('folder-slot-normal'));
        expect(normalSlots.length).toBe(3);
        const miniGroup = grid.querySelector('.folder-slot-mini-group');
        expect(miniGroup).not.toBeNull();
        expect(miniGroup.querySelectorAll('.folder-mini-icon').length).toBe(4);
      });
    });
  });

  describe('createGridItemHTML', () => {
    it('wraps the real renderIcon(item) output with grid-item-wrap markup, using item.id/size and escaped item.name', () => {
      const item = { id: 'gi1', type: 'link', name: '<b>A&B</b>', url: 'https://ab.com', icon: 'data:image/png;base64,ABC', size: '2x1' };
      const html = app.createGridItemHTML(item);
      expect(html).toContain('data-id="gi1"');
      expect(html).toContain('data-size="2x1"');
      expect(html).toContain('data-item-type="link"');
      expect(html).toContain('grid-item-name');
      expect(html).toContain(app.escapeHtml('<b>A&B</b>'));
      // real renderIcon() call embedded verbatim (icon + non-1x1 size -> grid-item-link-preview wrapper)
      expect(html).toContain(app.renderIcon(item));
    });
  });

  describe('renderGrid', () => {
    const item1 = { id: 'g1', type: 'link', name: 'One', url: 'https://one.com', size: '1x1' };
    const item2 = { id: 'g2', type: 'link', name: 'Two', url: 'https://two.com', size: '1x1' };

    it('renders each item via the real createGridItemHTML plus a trailing add-card by default', () => {
      const container = document.createElement('div'); // not attached to body — renderGrid only needs .innerHTML
      app.renderGrid(container, [item1, item2]);
      expect(container.querySelectorAll('.grid-item-wrap').length).toBe(3); // 2 items + add-wrap
      expect(container.querySelector('.add-card')).not.toBeNull();
      expect(container.innerHTML).toContain(app.createGridItemHTML(item1));
      expect(container.innerHTML).toContain(app.createGridItemHTML(item2));
    });

    it('omits the add-card when options.showAddCard is false', () => {
      const container = document.createElement('div');
      app.renderGrid(container, [item1], { showAddCard: false });
      expect(container.querySelector('.add-card')).toBeNull();
      expect(container.querySelectorAll('.grid-item-wrap').length).toBe(1);
    });

    it('renders only the add-card for an empty items list (default options)', () => {
      const container = document.createElement('div');
      app.renderGrid(container, []);
      expect(container.querySelectorAll('.grid-item-wrap').length).toBe(1);
      expect(container.querySelector('.add-card')).not.toBeNull();
    });

    it('renders nothing at all for an empty items list with showAddCard:false', () => {
      const container = document.createElement('div');
      app.renderGrid(container, [], { showAddCard: false });
      expect(container.innerHTML).toBe('<div></div>');
    });
  });

  describe('render', () => {
    // Known limitation (batch-3 plan Global Constraint 10 / task-4 brief):
    // currentFolderId only becomes non-null inside setupEventListeners' grid
    // click handler, which is out of scope for this task (batch 6). So only
    // the currentFolderId===null path (folder overlay staying/becoming
    // hidden) is reachable here; the folder-open branch (app.js render(),
    // ~lines 1337-1366) is left for the setupEventListeners task to cover
    // via a real click.
    it('renders #grid-container via a real renderGrid call (default empty items -> add-card only) and keeps #folder-overlay hidden', () => {
      app.render();
      const gridContainer = document.getElementById('grid-container');
      expect(gridContainer.querySelectorAll('.grid-item-wrap').length).toBe(1); // add-wrap only
      expect(gridContainer.querySelector('.add-card')).not.toBeNull();
      expect(document.getElementById('folder-overlay').classList.contains('hidden')).toBe(true);
    });

    it('re-adds the hidden class to #folder-overlay even if it had been removed (currentFolderId===null else-branch is real code)', () => {
      document.getElementById('folder-overlay').classList.remove('hidden');
      app.render();
      expect(document.getElementById('folder-overlay').classList.contains('hidden')).toBe(true);
    });

    it('does not throw calling the real updateGridItemSizes() (fixture grid-container has no .grid-item-wrap[data-size] children)', () => {
      expect(() => app.render()).not.toThrow();
    });

    it('renders real items loaded via loadAll() as grid-item-wrap entries in #grid-container', async () => {
      const cs = createMockChromeStorage({
        startpage_items: [
          { id: 'r1', type: 'link', name: 'One', url: 'https://one.com', icon: '', size: '1x1' },
          { id: 'r2', type: 'link', name: 'Two', url: 'https://two.com', icon: '', size: '1x1' },
        ],
      });
      globalThis.chrome = { storage: { local: cs.storage.local } };
      const localApp = loadAppModule(); // fresh closure so `items`/`render` bind to this chrome mock
      await localApp.loadAll();

      localApp.render();

      const gridContainer = document.getElementById('grid-container');
      const nonAddWraps = Array.from(gridContainer.querySelectorAll('.grid-item-wrap')).filter((el) => !el.classList.contains('add-wrap'));
      expect(nonAddWraps.length).toBe(2);
      expect(nonAddWraps.map((el) => el.dataset.id)).toEqual(['r1', 'r2']);
    });
  });

  describe('closeFolderWithAnimation', () => {
    // Known limitation: currentFolderId is always null in this batch (see
    // the `render` describe above), so both branches below are selected
    // purely by #folder-overlay's hidden state — which matches the actual
    // early-exit condition `!modal || overlay.classList.contains('hidden')`
    // and is independent of currentFolderId.
    afterEach(() => {
      vi.useRealTimers();
      delete globalThis.render;
    });

    it('early-exits straight to a real render() call when #folder-overlay is already hidden (fixture default)', async () => {
      const cs = createMockChromeStorage({
        startpage_items: [{ id: 'x1', type: 'link', name: 'X', url: 'https://x.com', size: '1x1' }],
      });
      globalThis.chrome = { storage: { local: cs.storage.local } };
      const localApp = loadAppModule();
      await localApp.loadAll();
      expect(document.getElementById('folder-overlay').classList.contains('hidden')).toBe(true);

      localApp.closeFolderWithAnimation();

      const gridContainer = document.getElementById('grid-container');
      expect(gridContainer.querySelector('.grid-item-wrap[data-id="x1"]')).not.toBeNull();
    });

    it('animation branch: sets folder-closing/overlay-closing classes, then the setTimeout(320) fallback finishes and calls render() exactly once', () => {
      vi.useFakeTimers();
      const overlay = document.getElementById('folder-overlay');
      const modal = document.getElementById('folder-modal');
      overlay.classList.remove('hidden'); // simulate an open folder overlay
      const renderSpy = vi.fn();
      globalThis.render = renderSpy; // intercept the closure's unqualified render() call

      app.closeFolderWithAnimation();

      expect(modal.classList.contains('folder-closing')).toBe(true);
      expect(overlay.classList.contains('overlay-closing')).toBe(true);
      expect(renderSpy).not.toHaveBeenCalled();

      vi.advanceTimersByTime(320);

      expect(modal.classList.contains('folder-closing')).toBe(false);
      expect(overlay.classList.contains('overlay-closing')).toBe(false);
      expect(renderSpy).toHaveBeenCalledTimes(1);

      // done-guard: a late animationend must not re-trigger finish()/render()
      overlay.dispatchEvent(new Event('animationend'));
      expect(renderSpy).toHaveBeenCalledTimes(1);
    });

    it('animation branch: an animationend event finishes immediately (racing ahead of the 320ms timeout), calling render() exactly once', () => {
      vi.useFakeTimers();
      const overlay = document.getElementById('folder-overlay');
      const modal = document.getElementById('folder-modal');
      overlay.classList.remove('hidden');
      const renderSpy = vi.fn();
      globalThis.render = renderSpy;

      app.closeFolderWithAnimation();
      overlay.dispatchEvent(new Event('animationend'));

      expect(renderSpy).toHaveBeenCalledTimes(1);
      expect(modal.classList.contains('folder-closing')).toBe(false);
      expect(overlay.classList.contains('overlay-closing')).toBe(false);

      // the setTimeout fallback firing afterward must be a no-op (done-guard)
      vi.advanceTimersByTime(320);
      expect(renderSpy).toHaveBeenCalledTimes(1);
    });
  });
});
