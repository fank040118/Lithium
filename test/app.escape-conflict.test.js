import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadAppModule } from './helpers/loadAppModule.js';
import { installAppDomFixture } from './helpers/appDomFixture.js';

// Wire-up check: the real keydown handler registered by setupEventListeners()
// must honour isEscapeBlockedByModal() while the sync-conflict dialog is open.
describe('Escape with the sync-conflict dialog open (real app.js handler)', () => {
  let keydownHandler;

  beforeEach(() => {
    vi.useFakeTimers();
    installAppDomFixture();
    globalThis.t = vi.fn((key) => key);
    loadAppModule();
    const realAdd = document.addEventListener.bind(document);
    vi.spyOn(document, 'addEventListener').mockImplementation((type, fn, opts) => {
      if (type === 'keydown') keydownHandler = fn; // capture only; keeps document clean
      else realAdd(type, fn, opts);
    });
    // setupEventListeners is a top-level declaration of the classic script, so
    // the indirect eval in loadAppModule exposes it on globalThis.
    globalThis.setupEventListeners();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '';
    delete globalThis.t;
  });

  const esc = () => keydownHandler(new KeyboardEvent('keydown', { key: 'Escape' }));
  const hidden = (id) => document.getElementById(id).classList.contains('hidden');

  it('keeps the dialog, the other overlays and the sidebar untouched', () => {
    expect(typeof keydownHandler).toBe('function');
    const sidebar = document.getElementById('left-sidebar');
    sidebar.classList.add('is-open');
    document.getElementById('sync-conflict-overlay').classList.remove('hidden');
    // An overlay underneath that Escape would normally close.
    document.getElementById('clock-overlay').classList.remove('hidden');

    esc();

    expect(hidden('sync-conflict-overlay')).toBe(false);
    expect(hidden('clock-overlay')).toBe(false);
    expect(sidebar.classList.contains('is-open')).toBe(true);
  });

  it('still closes the sidebar once the dialog is hidden (handler is live)', () => {
    const sidebar = document.getElementById('left-sidebar');
    sidebar.classList.add('is-open');
    esc();
    expect(sidebar.classList.contains('is-open')).toBe(false);
  });
});
