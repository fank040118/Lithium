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
});