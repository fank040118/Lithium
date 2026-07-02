import { describe, it, expect } from 'vitest';
import { loadFirebaseModule } from './loadFirebaseModule.js';

describe('loadFirebaseModule', () => {
  it('exposes firebase.js top-level functions', () => {
    const fb = loadFirebaseModule();
    expect(typeof fb._normalizeTs).toBe('function');
    expect(fb._normalizeTs(42)).toBe(42);
  });

  it('gives each call fresh module state', () => {
    const fb1 = loadFirebaseModule();
    expect(fb1.fbIsSignedIn()).toBe(false);
  });
});
