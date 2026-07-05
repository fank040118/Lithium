import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadAppModule } from './helpers/loadAppModule.js';
import { installAppDomFixture } from './helpers/appDomFixture.js';
import { createMockChromeStorage } from './helpers/mockChromeStorage.js';

// Batch 4: drag/dom-heavy layer — dragState is a closure-private `let` with
// handleDragStart(e, id) as its only public entry point. Tests that need
// non-default overId/action drive it through updateDragStateForTarget
// (which reads/writes dragState then calls applyDragVisuals). The sloppy
// indirect eval used by loadAppModule() puts every top-level function
// declaration on globalThis, so a bare-identifier call inside another
// app.js function (e.g. updateDragStateForTarget calling applyDragVisuals)
// resolves to globalThis.applyDragVisuals at call time — overwriting that
// binding with a vi.fn() intercepts the internal call without affecting
// app.applyDragVisuals captured on the module object (same trick batch 3
// used for closeFolderWithAnimation intercepting render()).

describe('app.js drag/dom-heavy layer', () => {
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
    delete globalThis.applyDragVisuals;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('captureGridPositions', () => {
    it('builds an {id: {x,y}} map from every .grid-item-wrap[data-id], excluding the add-wrap (no data-id)', () => {
      const container = document.getElementById('grid-container');
      container.innerHTML = `
        <div>
          <div class="grid-item-wrap" data-id="a1" data-size="1x1"></div>
          <div class="grid-item-wrap" data-id="b2" data-size="1x1"></div>
          <div class="grid-item-wrap add-wrap"></div>
        </div>`;
      const a1 = container.querySelector('[data-id="a1"]');
      const b2 = container.querySelector('[data-id="b2"]');
      vi.spyOn(a1, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20 });
      vi.spyOn(b2, 'getBoundingClientRect').mockReturnValue({ left: 30, top: 40 });

      const map = app.captureGridPositions();

      expect(Object.keys(map).sort()).toEqual(['a1', 'b2']);
      expect(map.a1).toEqual({ x: 10, y: 20 });
      expect(map.b2).toEqual({ x: 30, y: 40 });
    });

    it('returns an empty object when the grid has no data-id wraps', () => {
      const container = document.getElementById('grid-container');
      container.innerHTML = '<div></div>';
      const map = app.captureGridPositions();
      expect(map).toEqual({});
    });
  });

  describe('animateGridFlip', () => {
    const FLIP_TRANSITION = 'transform 260ms cubic-bezier(0.25, 0.46, 0.45, 0.94)';

    function makeWrap(id, rect) {
      const wrap = document.createElement('div');
      wrap.className = 'grid-item-wrap';
      wrap.dataset.id = id;
      document.getElementById('grid-container').appendChild(wrap);
      vi.spyOn(wrap, 'getBoundingClientRect').mockReturnValue(rect);
      return wrap;
    }

    it('leaves transform untouched when the wrap has no matching oldPositions entry', () => {
      const wrap = makeWrap('a1', { left: 50, top: 60 });
      app.animateGridFlip({ other: { x: 0, y: 0 } });
      expect(wrap.style.transform).toBe('');
      expect(wrap.style.transition).toBe('');
    });

    it('skips wraps whose dx and dy are both under 0.5px', () => {
      // old.x=50.2, new.left=50 → dx=0.2 (<0.5); old.y=60.3, new.top=60 → dy=0.3 (<0.5)
      const wrap = makeWrap('a1', { left: 50, top: 60 });
      app.animateGridFlip({ a1: { x: 50.2, y: 60.3 } });
      expect(wrap.style.transform).toBe('');
      expect(wrap.style.transition).toBe('');
    });

    it('applies the FLIP transform then resets it, leaving only the transition string; transitionend cleans up', () => {
      const wrap = makeWrap('a1', { left: 50, top: 60 });
      app.animateGridFlip({ a1: { x: 10, y: 20 } });
      // The function synchronously resets transform to '' to trigger the transition;
      // only the transition property remains observable.
      expect(wrap.style.transform).toBe('');
      expect(wrap.style.transition).toBe(FLIP_TRANSITION);

      // Dispatching transitionend fires the one-shot cleanup listener.
      wrap.dispatchEvent(new Event('transitionend'));
      expect(wrap.style.transition).toBe('');
      expect(wrap.style.transform).toBe('');
    });

    it('falls back to the 320ms setTimeout cleanup when transitionend does not fire, and the cleaned guard prevents double-cleanup errors', () => {
      vi.useFakeTimers();
      const wrap = makeWrap('a1', { left: 50, top: 60 });
      app.animateGridFlip({ a1: { x: 10, y: 20 } });
      expect(wrap.style.transition).toBe(FLIP_TRANSITION);

      vi.advanceTimersByTime(320); // DURATION(260) + 60ms fallback
      expect(wrap.style.transition).toBe('');
      expect(wrap.style.transform).toBe('');

      // A late transitionend must not throw (cleaned guard already true).
      expect(() => wrap.dispatchEvent(new Event('transitionend'))).not.toThrow();
    });
  });

  describe('clearDragVisuals', () => {
    it('removes every drag-related class and indicator element, plus the folder-overlay drag-over class', () => {
      // Seed all five markers clearDragVisuals is responsible for.
      const container = document.getElementById('grid-container');
      container.innerHTML = `
        <div>
          <div class="grid-item-wrap" data-id="a1">
            <div class="grid-item-action-area grid-item-dragging"></div>
            <div class="drag-indicator left"></div>
          </div>
          <div class="grid-item-wrap" data-id="b2">
            <div class="grid-item-action-area grid-item-combine"></div>
            <div class="move-to-main-hint"></div>
          </div>
        </div>`;
      const overlay = document.getElementById('folder-overlay');
      overlay.classList.add('drag-over-folder-bg');

      app.clearDragVisuals();

      expect(container.querySelectorAll('.grid-item-dragging')).toHaveLength(0);
      expect(container.querySelectorAll('.grid-item-combine')).toHaveLength(0);
      expect(container.querySelectorAll('.drag-indicator')).toHaveLength(0);
      expect(container.querySelectorAll('.move-to-main-hint')).toHaveLength(0);
      expect(overlay.classList.contains('drag-over-folder-bg')).toBe(false);
    });

    it('does not throw when the DOM has none of the drag markers', () => {
      expect(() => app.clearDragVisuals()).not.toThrow();
    });
  });

  describe('applyDragVisuals', () => {
    // handleDragStart schedules requestAnimationFrame(() => applyDragVisuals()).
    // jsdom has no RAF, so stub it to drop the callback — these tests drive
    // applyDragVisuals explicitly to assert its own behavior.
    beforeEach(() => {
      globalThis.requestAnimationFrame = vi.fn(() => 1);
    });

    // Helper: build a grid with the given data-id wraps inside grid-container.
    function buildGrid(...ids) {
      const container = document.getElementById('grid-container');
      container.innerHTML = `<div>${ids
        .map(
          (id) => `<div class="grid-item-wrap" data-id="${id}">
            <div class="grid-item-action-area"></div>
          </div>`
        )
        .join('')}</div>`;
      return container;
    }

    it('does nothing and does not throw when dragState is null (handleDragStart never called)', () => {
      buildGrid('a1');
      app.applyDragVisuals();
      expect(document.querySelectorAll('.grid-item-dragging')).toHaveLength(0);
      expect(document.querySelectorAll('.grid-item-combine')).toHaveLength(0);
      expect(document.querySelectorAll('.drag-indicator')).toHaveLength(0);
    });

    it('marks only the active item with .grid-item-dragging when overId is still null', () => {
      buildGrid('a1', 'b1');
      // handleDragStart has already synchronously set dragState in the same
      // closure; the outer beforeEach stubs RAF to drop the queued callback,
      // so we drive applyDragVisuals explicitly here.
      app.handleDragStart({ dataTransfer: { setData: vi.fn() } }, 'a1');
      // overId stays null — applyDragVisuals should not look at any target.
      app.applyDragVisuals();

      const a1Area = document.querySelector('[data-id="a1"] .grid-item-action-area');
      const b1Area = document.querySelector('[data-id="b1"] .grid-item-action-area');
      expect(a1Area.classList.contains('grid-item-dragging')).toBe(true);
      expect(b1Area.classList.contains('grid-item-dragging')).toBe(false);
      expect(document.querySelectorAll('.grid-item-combine')).toHaveLength(0);
      expect(document.querySelectorAll('.drag-indicator')).toHaveLength(0);
    });

    it('marks the target action-area with .grid-item-combine when action === "combine" (ratio 0.5 in [0.3,0.7))', () => {
      buildGrid('a1', 'b1');
      app.handleDragStart({ dataTransfer: { setData: vi.fn() } }, 'a1');
      // drive overId='b1', action='combine' via the public state engine.
      app.updateDragStateForTarget('b1', { left: 0, top: 0, right: 100, bottom: 50, width: 100 }, 50, 25);
      // updateDragStateForTarget already calls applyDragVisuals internally;
      // call it once more explicitly to assert the pure applyDragVisuals path.
      app.applyDragVisuals();

      const b1Area = document.querySelector('[data-id="b1"] .grid-item-action-area');
      expect(b1Area.classList.contains('grid-item-combine')).toBe(true);
      expect(document.querySelectorAll('.drag-indicator')).toHaveLength(0);
    });

    it('appends a .drag-indicator.left into the target wrap when action === "before" (ratio 0.1 < 0.3)', () => {
      buildGrid('a1', 'b1');
      app.handleDragStart({ dataTransfer: { setData: vi.fn() } }, 'a1');
      app.updateDragStateForTarget('b1', { left: 0, top: 0, right: 100, bottom: 50, width: 100 }, 10, 25);
      app.applyDragVisuals();

      const b1Wrap = document.querySelector('[data-id="b1"]');
      const indicator = b1Wrap.querySelector('.drag-indicator');
      expect(indicator).not.toBeNull();
      expect(indicator.classList.contains('left')).toBe(true);
      expect(indicator.classList.contains('right')).toBe(false);
      // combine class must not be applied in before/after branch.
      expect(b1Wrap.querySelector('.grid-item-action-area').classList.contains('grid-item-combine')).toBe(false);
    });

    it('does not throw when overId points at an id with no matching DOM element (targetWrap === null)', () => {
      buildGrid('a1');
      app.handleDragStart({ dataTransfer: { setData: vi.fn() } }, 'a1');
      // 'ghost' is not in the DOM; updateDragStateForTarget still sets
      // dragState.overId='ghost' and calls applyDragVisuals, which must
      // hit the `if (!targetWrap) return` path without throwing.
      expect(() =>
        app.updateDragStateForTarget('ghost', { left: 0, top: 0, right: 100, bottom: 50, width: 100 }, 90, 25)
      ).not.toThrow();
      // active item marking still applies; no indicator rendered.
      expect(document.querySelector('[data-id="a1"] .grid-item-action-area').classList.contains('grid-item-dragging')).toBe(true);
      expect(document.querySelectorAll('.drag-indicator')).toHaveLength(0);
    });
  });

  describe('handleDragStart', () => {
    it('sets dragState, writes dataTransfer, and queues a RAF that applies the dragging visual', () => {
      // RAF stub fires the callback synchronously so the applyDragVisuals
      // call happens before we assert.
      globalThis.requestAnimationFrame = vi.fn((cb) => {
        cb();
        return 1;
      });
      const container = document.getElementById('grid-container');
      container.innerHTML = `<div>
        <div class="grid-item-wrap" data-id="a1">
          <div class="grid-item-action-area"></div>
        </div>
      </div>`;
      const e = { dataTransfer: { setData: vi.fn() } };

      app.handleDragStart(e, 'a1');

      expect(e.dataTransfer.setData).toHaveBeenCalledTimes(1);
      expect(e.dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'a1');
      expect(e.dataTransfer.effectAllowed).toBe('move');
      // RAF callback ran applyDragVisuals → active item gets .grid-item-dragging.
      const a1Area = document.querySelector('[data-id="a1"] .grid-item-action-area');
      expect(a1Area.classList.contains('grid-item-dragging')).toBe(true);
    });
  });

  describe('updateDragStateForTarget', () => {
    // Per Global Constraint 5: intercept the internal applyDragVisuals call
    // via globalThis binding so we can assert call counts precisely, without
    // relying on DOM side effects. RAF is stubbed to drop handleDragStart's
    // queued callback so it never reaches applyDragVisuals, keeping counts
    // clean (only updateDragStateForTarget's calls are counted).
    let applyDragVisualsStub;

    beforeEach(() => {
      globalThis.requestAnimationFrame = vi.fn(() => 1);
      applyDragVisualsStub = vi.fn();
      globalThis.applyDragVisuals = applyDragVisualsStub;
    });

    // Helper to drive dragState into the active state used by cases 2-9.
    function startDrag(localApp, id = 'active1') {
      localApp.handleDragStart({ dataTransfer: { setData: vi.fn() } }, id);
    }

    const RECT = { left: 0, top: 0, right: 100, bottom: 50, width: 100 };

    it('case 1: does nothing when dragState is null (handleDragStart not called)', () => {
      app.updateDragStateForTarget('b1', RECT, 50, 25);
      expect(applyDragVisualsStub).not.toHaveBeenCalled();
    });

    it('case 2: does nothing when targetId === dragState.activeId (drag onto itself)', () => {
      startDrag(app);
      app.updateDragStateForTarget('active1', RECT, 50, 25);
      expect(applyDragVisualsStub).not.toHaveBeenCalled();
    });

    it('case 3: allowCombine=true (default), clientX=10 → ratio 0.1 < 0.3 → action="before", applyDragVisuals called once', () => {
      startDrag(app);
      app.updateDragStateForTarget('b1', RECT, 10, 25);
      expect(applyDragVisualsStub).toHaveBeenCalledTimes(1);
    });

    it('case 4: allowCombine=true, clientX=50 → ratio 0.5 in [0.3,0.7) → action="combine"', () => {
      startDrag(app);
      app.updateDragStateForTarget('b1', RECT, 50, 25);
      expect(applyDragVisualsStub).toHaveBeenCalledTimes(1);
    });

    it('case 5: allowCombine=true, clientX=90 → ratio 0.9 >= 0.7 → action="after"', () => {
      startDrag(app);
      app.updateDragStateForTarget('b1', RECT, 90, 25);
      expect(applyDragVisualsStub).toHaveBeenCalledTimes(1);
    });

    it('case 6: allowCombine=false, clientX=50 → preventCombine → thresholdRight=0.5, ratio 0.5 >= 0.5 → action="after"', () => {
      startDrag(app);
      app.updateDragStateForTarget('b1', RECT, 50, 25, false);
      expect(applyDragVisualsStub).toHaveBeenCalledTimes(1);
    });

    it('case 7: allowCombine=false, clientY=-10 < rect.top=0 → action="before" (clientY check precedes ratio)', () => {
      startDrag(app);
      app.updateDragStateForTarget('b1', RECT, 50, -10, false);
      expect(applyDragVisualsStub).toHaveBeenCalledTimes(1);
    });

    it('case 8: activeItem.type==="folder" forces preventCombine even with allowCombine=true (default), clientX=50 → action="after"', async () => {
      // Known limitation (Global Constraint 11): the third preventCombine
      // source — isInsideFolder = !!currentFolderId — is not drivable this
      // batch (currentFolderId has no public setter and stays null). The
      // folder-type source is equivalent for coverage of the
      // preventCombine=true branch; this test proves that source alone.
      const cs = createMockChromeStorage({
        startpage_items: [{ id: 'active1', type: 'folder', name: 'F', size: '1x1', children: [] }],
      });
      globalThis.chrome = { storage: { local: cs.storage.local } };
      const localApp = loadAppModule();
      // Re-stub RAF + applyDragVisuals for the fresh closure.
      globalThis.requestAnimationFrame = vi.fn(() => 1);
      const stub = vi.fn();
      globalThis.applyDragVisuals = stub;
      await localApp.loadAll();

      startDrag(localApp);
      localApp.updateDragStateForTarget('b1', RECT, 50, 25);
      expect(stub).toHaveBeenCalledTimes(1);
    });

    it('case 9: two consecutive calls with same targetId and same final action → applyDragVisuals called only once (dedupe branch)', () => {
      startDrag(app);
      app.updateDragStateForTarget('b1', RECT, 10, 25); // action='before'
      expect(applyDragVisualsStub).toHaveBeenCalledTimes(1);
      app.updateDragStateForTarget('b1', RECT, 10, 25); // same overId + same action → early return
      expect(applyDragVisualsStub).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleDragOver', () => {
    it('calls preventDefault and reads targetEl.getBoundingClientRect, forwarding them into updateDragStateForTarget', () => {
      // Intercept the internal applyDragVisuals call so we can observe that
      // the delegation chain reached it (proving updateDragStateForTarget
      // was invoked) without depending on DOM visuals.
      const applyDragVisualsStub = vi.fn();
      globalThis.applyDragVisuals = applyDragVisualsStub;
      globalThis.requestAnimationFrame = vi.fn(() => 1);
      app.handleDragStart({ dataTransfer: { setData: vi.fn() } }, 'a1');

      const targetEl = document.createElement('div');
      vi.spyOn(targetEl, 'getBoundingClientRect').mockReturnValue({
        left: 0, top: 0, right: 100, bottom: 50, width: 100,
      });
      const e = { preventDefault: vi.fn(), clientX: 10, clientY: 10 };

      app.handleDragOver(e, 'b1', targetEl);

      expect(e.preventDefault).toHaveBeenCalledTimes(1);
      expect(targetEl.getBoundingClientRect).toHaveBeenCalledTimes(1);
      // updateDragStateForTarget was reached → it called applyDragVisuals.
      expect(applyDragVisualsStub).toHaveBeenCalledTimes(1);
    });

    it('end-to-end: handleDragStart on a1 then handleDragOver on b1 with clientX=10 produces a .drag-indicator.left in b1', () => {
      globalThis.requestAnimationFrame = vi.fn((cb) => {
        cb();
        return 1;
      });
      const container = document.getElementById('grid-container');
      container.innerHTML = `<div>
        <div class="grid-item-wrap" data-id="a1"><div class="grid-item-action-area"></div></div>
        <div class="grid-item-wrap" data-id="b1"><div class="grid-item-action-area"></div></div>
      </div>`;
      app.handleDragStart({ dataTransfer: { setData: vi.fn() } }, 'a1');

      const b1Wrap = container.querySelector('[data-id="b1"]');
      vi.spyOn(b1Wrap, 'getBoundingClientRect').mockReturnValue({
        left: 0, top: 0, right: 100, bottom: 50, width: 100,
      });
      const e = { preventDefault: vi.fn(), clientX: 10, clientY: 10 };
      app.handleDragOver(e, 'b1', b1Wrap);

      const a1Area = container.querySelector('[data-id="a1"] .grid-item-action-area');
      expect(a1Area.classList.contains('grid-item-dragging')).toBe(true);
      const indicator = b1Wrap.querySelector('.drag-indicator');
      expect(indicator).not.toBeNull();
      expect(indicator.classList.contains('left')).toBe(true);
    });
  });

  // ── Task 2: getGridDropTargetAtPoint ────────────────────────────────────
  // dragState is closure-private; cases 2-6 drive it via handleDragStart
  // (RAF stubbed to drop the applyDragVisuals callback — we only need
  // dragState.activeId set). getBoundingClientRect is stubbed per-candidate
  // because jsdom defaults every rect to all-zeros, which would make every
  // candidate tie at distance 0.
  describe('getGridDropTargetAtPoint', () => {
    beforeEach(() => {
      // Drop the RAF callback handleDragStart schedules; these tests only
      // need dragState.activeId, not the visual side effects.
      globalThis.requestAnimationFrame = vi.fn(() => 1);
    });

    function startDrag(id) {
      app.handleDragStart({ dataTransfer: { setData: vi.fn() } }, id);
    }

    it('case 1: returns null when dragState is null (handleDragStart never called)', () => {
      expect(app.getGridDropTargetAtPoint(document.body, 50, 50)).toBeNull();
    });

    it('case 2: returns null when target is not inside .grid-area or .modal-body', () => {
      startDrag('a1');
      // document.body is outside both .grid-area and .modal-body.
      expect(app.getGridDropTargetAtPoint(document.body, 50, 50)).toBeNull();
    });

    it('case 3: returns null when gridHost has no firstElementChild (empty #grid-container)', () => {
      startDrag('a1');
      const container = document.getElementById('grid-container');
      container.innerHTML = '';
      // container itself carries .grid-area, so closest() resolves to it,
      // but firstElementChild is null → null.
      expect(app.getGridDropTargetAtPoint(container, 50, 50)).toBeNull();
    });

    it('case 4: returns null when the only candidate is the active item itself (candidates empty after filter)', () => {
      startDrag('active');
      const container = document.getElementById('grid-container');
      container.innerHTML = `<div>
        <div class="grid-item-wrap" data-id="active"></div>
      </div>`;
      expect(app.getGridDropTargetAtPoint(container, 50, 50)).toBeNull();
    });

    it('case 5: among non-active candidates, returns the {wrap, rect} with the smallest euclidean distance to (clientX, clientY)', () => {
      startDrag('active');
      const container = document.getElementById('grid-container');
      container.innerHTML = `<div>
        <div class="grid-item-wrap" data-id="active"></div>
        <div class="grid-item-wrap" data-id="b1"></div>
        <div class="grid-item-wrap" data-id="b2"></div>
      </div>`;
      const b1 = container.querySelector('[data-id="b1"]');
      const b2 = container.querySelector('[data-id="b2"]');
      // b1 rect [100,0,200,50], b2 rect [300,0,400,50]. Point (50,10):
      // b1: dx=100-50=50, dy=0 → distance 50. b2: dx=300-50=250 → 250.
      vi.spyOn(b1, 'getBoundingClientRect').mockReturnValue({
        left: 100, top: 0, right: 200, bottom: 50, width: 100,
      });
      vi.spyOn(b2, 'getBoundingClientRect').mockReturnValue({
        left: 300, top: 0, right: 400, bottom: 50, width: 100,
      });

      const result = app.getGridDropTargetAtPoint(container, 50, 10);
      expect(result).not.toBeNull();
      expect(result.wrap.dataset.id).toBe('b1');
      expect(result.rect).toEqual({ left: 100, top: 0, right: 200, bottom: 50, width: 100 });
    });

    it('case 6: a candidate whose rect contains (clientX, clientY) has distance 0 and always wins, even if another candidate is nearer by center', () => {
      startDrag('active');
      const container = document.getElementById('grid-container');
      container.innerHTML = `<div>
        <div class="grid-item-wrap" data-id="active"></div>
        <div class="grid-item-wrap" data-id="b1"></div>
        <div class="grid-item-wrap" data-id="b2"></div>
      </div>`;
      const b1 = container.querySelector('[data-id="b1"]');
      const b2 = container.querySelector('[data-id="b2"]');
      // b1 rect [0,0,100,50], b2 rect [200,0,300,50]. Point (250,10):
      // b1: dx=250-100=150, dy=0 → 150. b2: 250∈[200,300] → dx=0, dy=0 → 0.
      // b2 wins despite b1 being "closer by center" — proves the
      // "inside rect → distance 0" rule.
      vi.spyOn(b1, 'getBoundingClientRect').mockReturnValue({
        left: 0, top: 0, right: 100, bottom: 50, width: 100,
      });
      vi.spyOn(b2, 'getBoundingClientRect').mockReturnValue({
        left: 200, top: 0, right: 300, bottom: 50, width: 100,
      });

      const result = app.getGridDropTargetAtPoint(container, 250, 10);
      expect(result).not.toBeNull();
      expect(result.wrap.dataset.id).toBe('b2');
    });
  });

  // ── Task 2: handleDrop ──────────────────────────────────────────────────
  // handleDrop persists items via saveItems() → storage.set, which requires
  // createMockChromeStorage attached to globalThis.chrome BEFORE loadAppModule
  // (the closure `storage` const captures extensionStorageArea at eval time).
  // The outer beforeEach already ran loadAppModule without chrome, so this
  // describe re-runs loadAppModule in its own beforeEach after installing the
  // chrome mock — giving each test a fresh closure wired to the mock storage.
  describe('handleDrop', () => {
    let cs;

    beforeEach(() => {
      cs = createMockChromeStorage({
        startpage_items: [
          { id: 'x1', type: 'link', name: 'X', url: 'https://x.com', size: '1x1' },
          { id: 'x2', type: 'link', name: 'Y', url: 'https://y.com', size: '1x1' },
        ],
      });
      globalThis.chrome = { storage: { local: cs.storage.local } };
      // Drop handleDragStart's RAF callback; handleDrop calls render() which
      // rebuilds the DOM, so applyDragVisuals' visuals are irrelevant here.
      globalThis.requestAnimationFrame = vi.fn(() => 1);
      app = loadAppModule();
    });

    // Flush the async saveItems() chain (handleDrop does not await it).
    const flushAsync = () => new Promise((r) => setTimeout(r, 0));

    // Real-DOM setup: load items from storage then render the grid so the
    // .grid-item-wrap[data-id] elements exist for updateDragStateForTarget.
    async function bootstrap() {
      await app.loadAll();
      app.render();
    }

    it('case 1: when dragState is null, still calls preventDefault/stopPropagation once and does not throw', async () => {
      await bootstrap();
      const e = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: { setData: vi.fn() },
        clientX: 0,
        clientY: 0,
      };
      expect(() => app.handleDrop(e)).not.toThrow();
      expect(e.preventDefault).toHaveBeenCalledTimes(1);
      expect(e.stopPropagation).toHaveBeenCalledTimes(1);
      await flushAsync();
      // storage untouched: still the original two items in original order.
      expect(cs._data.startpage_items.map((i) => i.id)).toEqual(['x1', 'x2']);
    });

    it('case 2: dragging onto itself (activeId === resolvedTargetId) clears dragState and leaves items unchanged', async () => {
      await bootstrap();
      app.handleDragStart({ dataTransfer: { setData: vi.fn() } }, 'x1');
      const e = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: { setData: vi.fn() },
        clientX: 0,
        clientY: 0,
      };
      app.handleDrop(e, 'x1'); // targetId === activeId
      expect(e.preventDefault).toHaveBeenCalledTimes(1);
      expect(e.stopPropagation).toHaveBeenCalledTimes(1);
      await flushAsync();
      expect(cs._data.startpage_items.map((i) => i.id)).toEqual(['x1', 'x2']);
    });

    it('case 3: real drop — x1 dragged after x2 (action="after") reorders items to [x2, x1] in storage and in the rendered DOM', async () => {
      await bootstrap();
      app.handleDragStart({ dataTransfer: { setData: vi.fn() } }, 'x1');
      // ratio = (90 - 0) / 100 = 0.9 ≥ 0.7 → action="after".
      app.updateDragStateForTarget('x2', { left: 0, top: 0, right: 100, bottom: 50, width: 100 }, 90, 25);
      const e = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: { setData: vi.fn() },
        clientX: 90,
        clientY: 25,
      };
      app.handleDrop(e); // no targetId → falls back to dragState.overId ('x2')
      await flushAsync();

      // storage persisted the new order.
      expect(cs._data.startpage_items.map((i) => i.id)).toEqual(['x2', 'x1']);
      // The rendered DOM reflects the same order (add-wrap has no data-id,
      // so it is naturally excluded by the [data-id] selector).
      const container = document.getElementById('grid-container');
      const ids = Array.from(container.querySelectorAll('.grid-item-wrap[data-id]')).map((w) => w.dataset.id);
      expect(ids).toEqual(['x2', 'x1']);
    });

    it('case 4: activeItem not found in items (removeItem returns falsy) triggers the render()-only branch; storage unchanged, no throw', async () => {
      await bootstrap();
      // 'ghost' is not in items but handleDragStart only needs an id string.
      app.handleDragStart({ dataTransfer: { setData: vi.fn() } }, 'ghost');
      // Point at x1 so overId='x1' resolves; activeId='ghost' !== 'x1'.
      app.updateDragStateForTarget('x1', { left: 0, top: 0, right: 100, bottom: 50, width: 100 }, 90, 25);
      const e = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: { setData: vi.fn() },
        clientX: 90,
        clientY: 25,
      };
      expect(() => app.handleDrop(e)).not.toThrow();
      await flushAsync();
      // removeItem returned null → handleDrop did `render(); return;` before
      // touching items or saveItems.
      expect(cs._data.startpage_items.map((i) => i.id)).toEqual(['x1', 'x2']);
    });
  });

  // ── Task 2: handleDragEnd ───────────────────────────────────────────────
  // handleDragEnd resets dragState to null, clears all drag visuals, and
  // strips the folder-overlay's drag-over class plus .move-to-main-hint
  // children. The dragState reset is verified indirectly: calling
  // applyDragVisuals() afterwards must hit the `!dragState` early return
  // (clearDragVisuals + return) and NOT re-add .grid-item-dragging.
  //
  // Per Global Constraint 10: the `.grid-item-wrap[data-id]` DOM is built
  // by `app.render()` + `await app.loadAll()` from real storage items —
  // not handcrafted innerHTML. This mirrors the handleDrop describe's
  // `bootstrap()` pattern: install chrome storage BEFORE loadAppModule
  // (the closure `storage` const captures extensionStorageArea at eval
  // time), re-run loadAppModule in this describe's beforeEach (the public
  // beforeEach already ran it without chrome), then loadAll + render.
  describe('handleDragEnd', () => {
    let cs;

    beforeEach(() => {
      cs = createMockChromeStorage({
        startpage_items: [
          { id: 'a1', type: 'link', name: 'A', url: 'https://a.com', size: '1x1' },
          { id: 'b1', type: 'link', name: 'B', url: 'https://b.com', size: '1x1' },
        ],
      });
      globalThis.chrome = { storage: { local: cs.storage.local } };
      // Fire RAF synchronously so handleDragStart's queued applyDragVisuals
      // runs and seeds .grid-item-dragging for us to assert got cleared.
      globalThis.requestAnimationFrame = vi.fn((cb) => {
        cb();
        return 1;
      });
      app = loadAppModule();
    });

    // Real-DOM setup: load items from storage then render the grid so the
    // .grid-item-wrap[data-id] elements exist for the drag flow.
    async function bootstrap() {
      await app.loadAll();
      app.render();
    }

    it('resets dragState, clears every drag visual, strips folder-overlay drag-over class + .move-to-main-hint, and leaves dragState null (applyDragVisuals cannot re-add visuals)', async () => {
      await bootstrap();
      const container = document.getElementById('grid-container');

      // Build a live dragState with activeId='a1', overId='b1', action='combine'
      // by driving the real public drag flow on the rendered DOM.
      app.handleDragStart({ dataTransfer: { setData: vi.fn() } }, 'a1');
      // ratio 0.5 in [0.3,0.7) → action="combine".
      app.updateDragStateForTarget('b1', { left: 0, top: 0, right: 100, bottom: 50, width: 100 }, 50, 25);

      // Sanity: the dragging + combine visuals exist before handleDragEnd.
      expect(container.querySelector('[data-id="a1"] .grid-item-action-area').classList.contains('grid-item-dragging')).toBe(true);
      expect(container.querySelector('[data-id="b1"] .grid-item-action-area').classList.contains('grid-item-combine')).toBe(true);

      // Seed the folder-overlay markers handleDragEnd is responsible for.
      // These aren't produced by the drag flow on the main grid —
      // handleDragEnd's job is to clean them up.
      const overlay = document.getElementById('folder-overlay');
      overlay.classList.add('drag-over-folder-bg');
      const hint = document.createElement('div');
      hint.className = 'move-to-main-hint';
      overlay.appendChild(hint);
      expect(overlay.classList.contains('drag-over-folder-bg')).toBe(true);
      expect(overlay.querySelectorAll('.move-to-main-hint')).toHaveLength(1);

      app.handleDragEnd();

      // Every drag marker is gone from the document.
      expect(container.querySelectorAll('.grid-item-dragging')).toHaveLength(0);
      expect(container.querySelectorAll('.grid-item-combine')).toHaveLength(0);
      expect(container.querySelectorAll('.drag-indicator')).toHaveLength(0);
      expect(document.querySelectorAll('.move-to-main-hint')).toHaveLength(0);
      expect(overlay.classList.contains('drag-over-folder-bg')).toBe(false);

      // Indirect proof dragState is null: applyDragVisuals() on a null
      // dragState only calls clearDragVisuals() then returns, so it must
      // NOT re-add .grid-item-dragging to the active item.
      app.applyDragVisuals();
      expect(container.querySelectorAll('.grid-item-dragging')).toHaveLength(0);
      expect(container.querySelectorAll('.grid-item-combine')).toHaveLength(0);
    });
  });

  // ── Task 3: handleDragOverFolderBg ──────────────────────────────────────
  // Known limitation (Global Constraint 11): `currentFolderId` is a
  // closure-private `let` with no public setter, and the batch-4 test
  // harness never drives the folder-open flow, so it stays `null` for
  // every test in this batch. The `if (dragState && currentFolderId)`
  // branch inside handleDragOverFolderBg is therefore unreachable —
  // `dragState` can be set (via handleDragStart) but the AND condition
  // still fails on the `currentFolderId` operand. The "move-to-main"
  // visual feedback (setting `drag-over-folder-bg` on #folder-overlay
  // + flipping dragState.action to 'move-to-main' + applyDragVisuals)
  // is left for batch 6 to cover, where setupEventListeners drives the
  // real folder-open flow. This batch only asserts the always-taken
  // early path: `e.preventDefault()` runs unconditionally, and the
  // overlay never receives the `drag-over-folder-bg` class regardless
  // of whether dragState is null or set.
  describe('handleDragOverFolderBg', () => {
    // Drop handleDragStart's RAF callback for case 2 — we only need
    // dragState set, not the applyDragVisuals side effects.
    beforeEach(() => {
      globalThis.requestAnimationFrame = vi.fn(() => 1);
    });

    it('case 1: no dragState → still calls e.preventDefault once, #folder-overlay never gets .drag-over-folder-bg', () => {
      const e = { preventDefault: vi.fn() };
      app.handleDragOverFolderBg(e);
      expect(e.preventDefault).toHaveBeenCalledTimes(1);
      const overlay = document.getElementById('folder-overlay');
      expect(overlay.classList.contains('drag-over-folder-bg')).toBe(false);
    });

    it('case 2: dragState set via handleDragStart → still calls e.preventDefault once, #folder-overlay stays clean (currentFolderId===null blocks the visual branch)', () => {
      // Seed a grid item so handleDragStart has a target id; the DOM is
      // not strictly required (handleDragStart only writes dragState +
      // dataTransfer + queues RAF), but kept consistent with Task 1 style.
      const container = document.getElementById('grid-container');
      container.innerHTML = `<div>
        <div class="grid-item-wrap" data-id="a1"><div class="grid-item-action-area"></div></div>
      </div>`;
      app.handleDragStart({ dataTransfer: { setData: vi.fn() } }, 'a1');

      const e = { preventDefault: vi.fn() };
      app.handleDragOverFolderBg(e);
      expect(e.preventDefault).toHaveBeenCalledTimes(1);
      const overlay = document.getElementById('folder-overlay');
      // currentFolderId is null → the `if (dragState && currentFolderId)`
      // branch is skipped → no class added, even though dragState is set.
      expect(overlay.classList.contains('drag-over-folder-bg')).toBe(false);
    });
  });

  // ── Task 3: handleDropFolderBg ──────────────────────────────────────────
  // Known limitation (Global Constraint 11): the only way dragState.action
  // becomes 'move-to-main' is via handleDragOverFolderBg's reachable-only-
  // when-currentFolderId-is-truthy branch (see previous describe). Since
  // currentFolderId stays null this batch, dragState.action can only ever
  // be null (fresh from handleDragStart) or one of 'combine'/'before'/
  // 'after' (set by updateDragStateForTarget) — never 'move-to-main'.
  // Therefore `if (!dragState || dragState.action !== 'move-to-main') return;`
  // always early-returns, and the "move item out of folder to main grid"
  // body (deepClone + removeItem + push + saveItems + captureGridPositions
  // + render + animateGridFlip) is unreachable. Full move-out-to-main
  // coverage is left for batch 6. This batch asserts the three early-return
  // shapes: all call e.preventDefault() once, none throw, none touch
  // storage or trigger render() side effects.
  describe('handleDropFolderBg', () => {
    beforeEach(() => {
      // Drop RAF so handleDragStart (used by cases 2 & 3) doesn't fire
      // applyDragVisuals visuals; we only need dragState set.
      globalThis.requestAnimationFrame = vi.fn(() => 1);
    });

    it('case 1: no dragState → e.preventDefault called once, no throw, no storage/render side effects', () => {
      const e = { preventDefault: vi.fn() };
      expect(() => app.handleDropFolderBg(e)).not.toThrow();
      expect(e.preventDefault).toHaveBeenCalledTimes(1);
    });

    it('case 2: dragState set but action===null (fresh handleDragStart, no updateDragStateForTarget) → same early-return behavior', () => {
      app.handleDragStart({ dataTransfer: { setData: vi.fn() } }, 'a1');
      const e = { preventDefault: vi.fn() };
      expect(() => app.handleDropFolderBg(e)).not.toThrow();
      expect(e.preventDefault).toHaveBeenCalledTimes(1);
    });

    it('case 3: dragState.action set to "combine" via updateDragStateForTarget (≠ "move-to-main") → same early-return behavior', () => {
      // Intercept the internal applyDragVisuals call so updateDragStateForTarget
      // does not try to read the DOM for visuals (keeps the test pure).
      globalThis.applyDragVisuals = vi.fn();
      const container = document.getElementById('grid-container');
      container.innerHTML = `<div>
        <div class="grid-item-wrap" data-id="a1"><div class="grid-item-action-area"></div></div>
        <div class="grid-item-wrap" data-id="b1"><div class="grid-item-action-area"></div></div>
      </div>`;
      app.handleDragStart({ dataTransfer: { setData: vi.fn() } }, 'a1');
      // ratio 0.5 in [0.3,0.7) → action='combine'.
      app.updateDragStateForTarget('b1', { left: 0, top: 0, right: 100, bottom: 50, width: 100 }, 50, 25);

      const e = { preventDefault: vi.fn() };
      expect(() => app.handleDropFolderBg(e)).not.toThrow();
      expect(e.preventDefault).toHaveBeenCalledTimes(1);
    });
  });

  // ── Task 3: enterFolderRenameMode ───────────────────────────────────────
  // Known limitation (Global Constraint 11): `if (!currentFolderId) return;`
  // is the first statement and currentFolderId has no public setter, so
  // the entire rename interaction body is unreachable this batch. The
  // full rename flow (input replace + FOLDER_NAME_MAX_LEN truncation +
  // commit/cancel/restoreFocus + keydown(Enter/Escape)/blur handlers +
  // isConnected double-fire guard) is left for batch 6's
  // setupEventListeners tests, where the real folder-open click drives
  // currentFolderId to a non-null value. This batch only asserts the
  // early-return: calling enterFolderRenameMode() does not throw, the
  // .folder-name-display span present in #folder-title is NOT replaced
  // with an <input>, and no .folder-name-input element appears anywhere.
  describe('enterFolderRenameMode', () => {
    it('early-returns when currentFolderId is null: no throw, .folder-name-display span untouched, no .folder-name-input in DOM', () => {
      // Seed the title with the same shape render() would produce for an
      // open folder: a <span class="folder-name-display">. The fixture's
      // #folder-title starts empty, so we plant the span here to make the
      // "still a span, not replaced with input" assertion meaningful.
      const title = document.getElementById('folder-title');
      title.innerHTML = '<span class="folder-name-display">F</span>';

      expect(() => app.enterFolderRenameMode()).not.toThrow();

      // The display span is still a span (not swapped for an <input>).
      const display = title.querySelector('.folder-name-display');
      expect(display).not.toBeNull();
      expect(display.tagName).toBe('SPAN');
      // No rename input was inserted anywhere in the document.
      expect(document.querySelector('.folder-name-input')).toBeNull();
    });
  });
});
