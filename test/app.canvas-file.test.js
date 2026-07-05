import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadAppModule } from './helpers/loadAppModule.js';
import { installAppDomFixture } from './helpers/appDomFixture.js';

// Batch 5: canvas/file layer. Covers the wallpaper center-crop pipeline
// (processWallpaper) and the icon crop pipeline (processIconFile). Both
// chain FileReader → Image → canvas; jsdom's HTMLCanvasElement.prototype
// .getContext returns null, so we spyOn the prototype to inject a stub 2d
// context and capture drawImage/toDataURL calls. The mock factories below
// (FileReader/Image/canvas spies) are reused by Task 2/3 describes added
// to this same top-level describe.

describe('app.js canvas/file layer', () => {
  let app;
  let ctxStub;

  // FileReader/Image mock modes — module-level so the mock classes (re-
  // installed in beforeEach) read the current mode/ dimensions. Each test
  // flips these before invoking the pipeline; afterEach deletes the mock
  // classes themselves.
  let frMode = 'load';
  let imgMode = 'load';
  let mockImgW = 100;
  let mockImgH = 100;

  beforeEach(() => {
    installAppDomFixture();
    globalThis.t = vi.fn((key) => key);
    app = loadAppModule();

    frMode = 'load';
    imgMode = 'load';
    mockImgW = 100;
    mockImgH = 100;

    // FileReader mock — synchronously dispatches onload/onerror out of
    // readAsDataURL so the Promise pipeline resolves without microtask
    // nesting surprises.
    globalThis.FileReader = class {
      readAsDataURL(file) {
        this.file = file;
        if (frMode === 'error') {
          this.onerror?.();
        } else {
          this.onload?.({ target: { result: 'data:image/png;base64,FAKE' } });
        }
      }
    };

    // Image mock — width/height read from module-level vars so each test
    // can stage landscape/portrait dims; src setter triggers onload/onerror.
    globalThis.Image = class {
      set src(v) {
        this._src = v;
        if (imgMode === 'error') {
          this.onerror?.();
        } else {
          this.onload?.();
        }
      }
      get src() { return this._src; }
      get width() { return mockImgW; }
      get height() { return mockImgH; }
      get naturalWidth() { return mockImgW; }
      get naturalHeight() { return mockImgH; }
    };

    ctxStub = { drawImage: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctxStub);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,FAKE');
  });

  afterEach(() => {
    document.body.innerHTML = '';
    delete globalThis.t;
    delete globalThis.FileReader;
    delete globalThis.Image;
    delete globalThis.openIconCropper;
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('processWallpaper', () => {
    beforeEach(() => {
      // screen 1920×1080, dpr=1 → screenW=1920, screenH=1080,
      // screenRatio≈1.7778.
      Object.defineProperty(window, 'screen', {
        value: { width: 1920, height: 1080 },
        configurable: true,
      });
      vi.stubGlobal('devicePixelRatio', 1);
    });

    it('横图成功: center-crops to screen ratio and resolves with PNG dataURL', async () => {
      // imgRatio = 400/200 = 2 > screenRatio ≈ 1.778 → landscape branch:
      // cropH=200, cropW=200*1.778≈355.56, cropX=(400-355.56)/2≈22.22,
      // cropY=0. scale=min(1, 2560/355.56, 1440/200)=1 → canvas≈356×200.
      mockImgW = 400;
      mockImgH = 200;
      const file = { name: 'wide.png' };

      const result = await app.processWallpaper(file);

      expect(ctxStub.drawImage).toHaveBeenCalledTimes(1);
      // 9 args: (img, cropX, cropY, cropW, cropH, 0, 0, canvasW, canvasH)
      expect(ctxStub.drawImage.mock.calls[0]).toHaveLength(9);
      expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledTimes(1);
      expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledWith('image/png');
      expect(result).toBe('data:image/png;base64,FAKE');
    });

    it('竖图成功: portrait branch reaches toDataURL without throwing', async () => {
      // imgRatio = 100/200 = 0.5 < screenRatio → portrait branch:
      // cropW=100, cropH=100/1.778≈56.25, cropX=0, cropY≈71.88.
      mockImgW = 100;
      mockImgH = 200;
      const file = { name: 'tall.png' };

      const result = await app.processWallpaper(file);

      expect(ctxStub.drawImage).toHaveBeenCalledTimes(1);
      expect(ctxStub.drawImage.mock.calls[0]).toHaveLength(9);
      expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledTimes(1);
      expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledWith('image/png');
      expect(result).toBe('data:image/png;base64,FAKE');
    });

    it('reader.onerror: rejects with "Failed to read file" and skips canvas', async () => {
      frMode = 'error';
      const file = { name: 'bad.png' };

      await expect(app.processWallpaper(file)).rejects.toThrow('Failed to read file');
      expect(ctxStub.drawImage).not.toHaveBeenCalled();
      expect(HTMLCanvasElement.prototype.toDataURL).not.toHaveBeenCalled();
    });

    it('img.onerror: rejects with "Failed to load image" and skips canvas', async () => {
      frMode = 'load';
      imgMode = 'error';
      const file = { name: 'broken.png' };

      await expect(app.processWallpaper(file)).rejects.toThrow('Failed to load image');
      expect(ctxStub.drawImage).not.toHaveBeenCalled();
      expect(HTMLCanvasElement.prototype.toDataURL).not.toHaveBeenCalled();
    });
  });

  describe('processIconFile', () => {
    it('sel 有值: drawImage with crop rect, toDataURL webp 0.9, resolves dataURL', async () => {
      globalThis.openIconCropper = vi.fn().mockResolvedValue({ sx: 10, sy: 20, ss: 50 });
      const file = { name: 'icon.png' };

      const result = await app.processIconFile(file);

      expect(globalThis.openIconCropper).toHaveBeenCalledTimes(1);
      expect(ctxStub.drawImage).toHaveBeenCalledTimes(1);
      expect(ctxStub.drawImage).toHaveBeenCalledWith(
        expect.anything(), 10, 20, 50, 50, 0, 0, 128, 128
      );
      expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledTimes(1);
      expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledWith('image/webp', 0.9);
      expect(result).toBe('data:image/png;base64,FAKE');
      delete globalThis.openIconCropper;
    });

    it('sel=null: resolves null and skips canvas rasterization', async () => {
      globalThis.openIconCropper = vi.fn().mockResolvedValue(null);
      const file = { name: 'icon.png' };

      const result = await app.processIconFile(file);

      expect(globalThis.openIconCropper).toHaveBeenCalledTimes(1);
      expect(result).toBeNull();
      expect(ctxStub.drawImage).not.toHaveBeenCalled();
      expect(HTMLCanvasElement.prototype.toDataURL).not.toHaveBeenCalled();
      delete globalThis.openIconCropper;
    });

    it('openIconCropper reject: propagates rejection error', async () => {
      globalThis.openIconCropper = vi.fn().mockRejectedValue(new Error('crop cancel'));
      const file = { name: 'icon.png' };

      await expect(app.processIconFile(file)).rejects.toThrow('crop cancel');
      expect(ctxStub.drawImage).not.toHaveBeenCalled();
      expect(HTMLCanvasElement.prototype.toDataURL).not.toHaveBeenCalled();
      delete globalThis.openIconCropper;
    });

    it('reader.onerror: rejects with "Failed to read file"', async () => {
      frMode = 'error';
      const file = { name: 'bad.png' };

      await expect(app.processIconFile(file)).rejects.toThrow('Failed to read file');
      expect(ctxStub.drawImage).not.toHaveBeenCalled();
      expect(HTMLCanvasElement.prototype.toDataURL).not.toHaveBeenCalled();
    });

    it('img.onerror: rejects with "Failed to load image"', async () => {
      frMode = 'load';
      imgMode = 'error';
      const file = { name: 'broken.png' };

      await expect(app.processIconFile(file)).rejects.toThrow('Failed to load image');
      expect(ctxStub.drawImage).not.toHaveBeenCalled();
      expect(HTMLCanvasElement.prototype.toDataURL).not.toHaveBeenCalled();
    });
  });

  describe('openIconCropper', () => {
    // Shared image stub — openIconCropper only reads naturalWidth/
    // naturalHeight/src, so a plain object is enough (Global Constraint 7).
    // imgW=200, imgH=100 → minSize=min(32,200,100)=32; resetCrop:
    // cropSize=max(32,floor(100*0.8))=80, cropX=floor((200-80)/2)=60,
    // cropY=floor((100-80)/2)=10.
    const fakeImg = { naturalWidth: 200, naturalHeight: 100, src: 'data:fake' };

    // Default RAF stub drops the callback → relayout never runs, layout=null,
    // applyBox early-returns (boxEl.style stays empty) — but cropX/Y/Size are
    // set synchronously by resetCrop(), so onConfirm/onCancel/onReset logic
    // is still testable. vi.stubGlobal is auto-restored by the top-level
    // afterEach's vi.unstubAllGlobals.
    beforeEach(() => {
      vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    });

    it('① 初始状态: shows overlay, sets imgEl.src, leaves boxEl.style empty (layout=null)', () => {
      app.openIconCropper(fakeImg);

      const overlay = document.getElementById('icon-crop-overlay');
      const imgEl = document.getElementById('icon-crop-image');
      const boxEl = document.getElementById('icon-crop-box');

      expect(overlay.classList.contains('hidden')).toBe(false);
      expect(imgEl.getAttribute('src')).toBe('data:fake');
      // layout=null → applyBox early-returns without touching boxEl.style.
      expect(boxEl.style.left).toBe('');
      expect(boxEl.style.top).toBe('');
      expect(boxEl.style.width).toBe('');
      expect(boxEl.style.height).toBe('');
    });

    it('② confirm: resolves {sx,sy,ss} rounded, overlay hidden, imgEl src removed', async () => {
      const p = app.openIconCropper(fakeImg);
      const confirmBtn = document.getElementById('icon-crop-confirm');
      const overlay = document.getElementById('icon-crop-overlay');
      const imgEl = document.getElementById('icon-crop-image');

      confirmBtn.click();
      const result = await p;

      // cropX=60, cropY=10, cropSize=80 → rounded unchanged.
      expect(result).toEqual({ sx: 60, sy: 10, ss: 80 });
      expect(overlay.classList.contains('hidden')).toBe(true);
      expect(imgEl.getAttribute('src')).toBe(null);
    });

    it('③ cancel: resolves null, overlay hidden, imgEl src removed', async () => {
      const p = app.openIconCropper(fakeImg);
      const cancelBtn = document.getElementById('icon-crop-cancel');
      const overlay = document.getElementById('icon-crop-overlay');
      const imgEl = document.getElementById('icon-crop-image');

      cancelBtn.click();
      const result = await p;

      expect(result).toBeNull();
      expect(overlay.classList.contains('hidden')).toBe(true);
      expect(imgEl.getAttribute('src')).toBe(null);
    });

    it('④ reset: after a click on reset, confirm yields the original centered crop', async () => {
      const p = app.openIconCropper(fakeImg);
      const resetBtn = document.getElementById('icon-crop-reset');
      const confirmBtn = document.getElementById('icon-crop-confirm');

      // resetCrop is idempotent; resetBtn re-runs it. Even without mutating
      // cropX/Y/Size in between, this exercises onReset → resetCrop and
      // proves the values stay at 60/10/80.
      resetBtn.click();
      confirmBtn.click();
      const result = await p;

      expect(result).toEqual({ sx: 60, sy: 10, ss: 80 });
    });

    it('⑤ pointerdown on box (button=0): does not throw; non-zero button is ignored', () => {
      app.openIconCropper(fakeImg);
      const stage = document.getElementById('icon-crop-stage');
      const boxEl = document.getElementById('icon-crop-box');

      // layout=null → onPointerDown early-returns before drag is set, so no
      // pointermove/up listeners are registered. We assert only that the
      // dispatch doesn't throw and that a follow-up non-zero-button pointerdown
      // is similarly safe.
      expect(() => boxEl.dispatchEvent(new PointerEvent('pointerdown', { clientX: 60, clientY: 10, button: 0 }))).not.toThrow();
      expect(() => stage.dispatchEvent(new PointerEvent('pointerdown', { clientX: 60, clientY: 10, button: 2 }))).not.toThrow();
    });

    it('⑥ pointerdown on handle[data-handle="se"]: does not throw (drag stays null because layout=null)', () => {
      app.openIconCropper(fakeImg);
      const seHandle = document.querySelector('#icon-crop-box [data-handle="se"]');

      expect(seHandle).not.toBeNull();
      expect(() => seHandle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 50, button: 0 }))).not.toThrow();
    });

    it('⑦ non-zero button pointerdown: ignored (no throw, no drag)', () => {
      app.openIconCropper(fakeImg);
      const stage = document.getElementById('icon-crop-stage');

      // button=2 → onPointerDown returns immediately. A subsequent pointerup
      // dispatch on window (which would only have a listener if drag was set)
      // must not throw either.
      expect(() => stage.dispatchEvent(new PointerEvent('pointerdown', { clientX: 0, clientY: 0, button: 2 }))).not.toThrow();
      expect(() => window.dispatchEvent(new PointerEvent('pointerup'))).not.toThrow();
    });

    it('⑧ window resize: does not throw (relayout early-returns when clientWidth=0)', () => {
      app.openIconCropper(fakeImg);

      // jsdom stage.clientWidth=0 → relayout's `if (!sw || !sh) return` fires.
      expect(() => window.dispatchEvent(new Event('resize'))).not.toThrow();
    });

    it('⑨ relayout 真实路径: sync RAF + clientWidth/Height stub → imgEl and boxEl styled', async () => {
      // Override the default RAF stub to fire the callback synchronously, so
      // relayout runs immediately after openIconCropper's resetCrop().
      vi.stubGlobal('requestAnimationFrame', vi.fn((cb) => { cb(); return 1; }));

      const stage = document.getElementById('icon-crop-stage');
      // jsdom leaves clientWidth/Height at 0; stub them so relayout proceeds.
      // imgR = 200/100 = 2 > stageR = 500/300 ≈ 1.67 → dispW=500, dispH=250,
      // left=(500-500)/2=0, top=(300-250)/2=25, scale=500/200=2.5.
      Object.defineProperty(stage, 'clientWidth', { value: 500, configurable: true });
      Object.defineProperty(stage, 'clientHeight', { value: 300, configurable: true });

      const p = app.openIconCropper(fakeImg);
      const imgEl = document.getElementById('icon-crop-image');
      const boxEl = document.getElementById('icon-crop-box');

      // imgEl positioned to display the image with object-fit:contain math.
      expect(imgEl.style.left).toBe('0px');
      expect(imgEl.style.top).toBe('25px');
      expect(imgEl.style.width).toBe('500px');
      expect(imgEl.style.height).toBe('250px');
      // boxEl: left=layout.left + cropX*scale = 0+60*2.5=150;
      // top=layout.top + cropY*scale = 25+10*2.5=50; size=80*2.5=200.
      expect(boxEl.style.left).toBe('150px');
      expect(boxEl.style.top).toBe('50px');
      expect(boxEl.style.width).toBe('200px');
      expect(boxEl.style.height).toBe('200px');

      // Cleanup via cancel so the Promise resolves.
      document.getElementById('icon-crop-cancel').click();
      await expect(p).resolves.toBeNull();
    });
  });
});