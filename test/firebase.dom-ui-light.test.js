import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { loadFirebaseModule } from './helpers/loadFirebaseModule.js';
import { mountAuthDom } from './helpers/authDomFixture.js';

afterEach(() => {
  delete globalThis.chrome;
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('_showLoginOverlay', () => {
  it('removes hidden class from #login-overlay when the DOM is mounted', () => {
    const fb = loadFirebaseModule();
    mountAuthDom();

    fb._showLoginOverlay();

    expect(document.getElementById('login-overlay').classList.contains('hidden')).toBe(false);
  });

  it('does not throw when the overlay is absent', () => {
    const fb = loadFirebaseModule();

    expect(() => fb._showLoginOverlay()).not.toThrow();
  });
});

describe('_hideLoginOverlay', () => {
  it('adds hidden class to #login-overlay', () => {
    const fb = loadFirebaseModule();
    mountAuthDom();
    const el = document.getElementById('login-overlay');
    el.classList.remove('hidden');

    fb._hideLoginOverlay();

    expect(el.classList.contains('hidden')).toBe(true);
  });

  it('does not throw when the overlay is absent', () => {
    const fb = loadFirebaseModule();

    expect(() => fb._hideLoginOverlay()).not.toThrow();
  });
});

describe('_showLoginConsentOverlay', () => {
  it('removes hidden class from #login-consent-overlay', () => {
    const fb = loadFirebaseModule();
    mountAuthDom();

    fb._showLoginConsentOverlay();

    expect(document.getElementById('login-consent-overlay').classList.contains('hidden')).toBe(false);
  });

  it('does not throw when the overlay is absent', () => {
    const fb = loadFirebaseModule();

    expect(() => fb._showLoginConsentOverlay()).not.toThrow();
  });
});

describe('_hideLoginConsentOverlay', () => {
  it('adds hidden class to #login-consent-overlay', () => {
    const fb = loadFirebaseModule();
    mountAuthDom();
    const el = document.getElementById('login-consent-overlay');
    el.classList.remove('hidden');

    fb._hideLoginConsentOverlay();

    expect(el.classList.contains('hidden')).toBe(true);
  });

  it('does not throw when the overlay is absent', () => {
    const fb = loadFirebaseModule();

    expect(() => fb._hideLoginConsentOverlay()).not.toThrow();
  });
});

describe('_hasLoginConsent', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns true when lithium.cloud.consent is set to "1"', () => {
    const fb = loadFirebaseModule();
    localStorage.setItem('lithium.cloud.consent', '1');

    expect(fb._hasLoginConsent()).toBe(true);
  });

  it('returns false when the consent key is absent', () => {
    const fb = loadFirebaseModule();

    expect(fb._hasLoginConsent()).toBe(false);
  });
});

describe('_persistLoginConsent', () => {
  it('writes "1" to lithium.cloud.consent', () => {
    const fb = loadFirebaseModule();
    localStorage.clear();

    fb._persistLoginConsent();

    expect(localStorage.getItem('lithium.cloud.consent')).toBe('1');
  });

  it('makes _hasLoginConsent return true in the same closure', () => {
    const fb = loadFirebaseModule();
    localStorage.clear();

    fb._persistLoginConsent();

    expect(fb._hasLoginConsent()).toBe(true);
  });
});
