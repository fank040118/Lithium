import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
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

describe('_friendlyAuthError', () => {
  beforeEach(() => {
    globalThis.t = vi.fn((key, vars) => key);
  });

  afterEach(() => {
    delete globalThis.t;
  });

  it('returns error.unknown for empty, null, or undefined input', () => {
    const fb = loadFirebaseModule();

    expect(fb._friendlyAuthError('')).toBe('error.unknown');
    expect(fb._friendlyAuthError(null)).toBe('error.unknown');
    expect(fb._friendlyAuthError(undefined)).toBe('error.unknown');
    expect(globalThis.t).toHaveBeenCalledWith('error.unknown');
  });

  it('maps EMAIL_NOT_FOUND to error.emailNotFound', () => {
    const fb = loadFirebaseModule();

    expect(fb._friendlyAuthError('EMAIL_NOT_FOUND')).toBe('error.emailNotFound');
  });

  it('maps INVALID_LOGIN_CREDENTIALS to error.invalidLoginCredentials', () => {
    const fb = loadFirebaseModule();

    expect(fb._friendlyAuthError('INVALID_LOGIN_CREDENTIALS')).toBe('error.invalidLoginCredentials');
  });

  it('maps INVALID_PASSWORD to error.invalidLoginCredentials', () => {
    const fb = loadFirebaseModule();

    expect(fb._friendlyAuthError('INVALID_PASSWORD')).toBe('error.invalidLoginCredentials');
  });

  it('maps EMAIL_EXISTS to error.emailExists', () => {
    const fb = loadFirebaseModule();

    expect(fb._friendlyAuthError('EMAIL_EXISTS')).toBe('error.emailExists');
  });

  it('maps WEAK_PASSWORD to error.weakPassword', () => {
    const fb = loadFirebaseModule();

    expect(fb._friendlyAuthError('WEAK_PASSWORD')).toBe('error.weakPassword');
  });

  it('maps INVALID_EMAIL to error.invalidEmail', () => {
    const fb = loadFirebaseModule();

    expect(fb._friendlyAuthError('INVALID_EMAIL')).toBe('error.invalidEmail');
  });

  it('maps MISSING_PASSWORD to error.missingPassword', () => {
    const fb = loadFirebaseModule();

    expect(fb._friendlyAuthError('MISSING_PASSWORD')).toBe('error.missingPassword');
  });

  it('maps MISSING_EMAIL to error.missingEmail', () => {
    const fb = loadFirebaseModule();

    expect(fb._friendlyAuthError('MISSING_EMAIL')).toBe('error.missingEmail');
  });

  it('maps TOO_MANY_ATTEMPTS to error.tooManyAttempts', () => {
    const fb = loadFirebaseModule();

    expect(fb._friendlyAuthError('TOO_MANY_ATTEMPTS')).toBe('error.tooManyAttempts');
  });

  it('maps USER_DISABLED to error.userDisabled', () => {
    const fb = loadFirebaseModule();

    expect(fb._friendlyAuthError('USER_DISABLED')).toBe('error.userDisabled');
  });

  it('maps OPERATION_NOT_ALLOWED to error.operationNotAllowed', () => {
    const fb = loadFirebaseModule();

    expect(fb._friendlyAuthError('OPERATION_NOT_ALLOWED')).toBe('error.operationNotAllowed');
  });

  it('maps QUOTA_EXCEEDED to error.quotaExceeded', () => {
    const fb = loadFirebaseModule();

    expect(fb._friendlyAuthError('QUOTA_EXCEEDED')).toBe('error.quotaExceeded');
  });

  it('maps PROJECT_QUOTA_EXCEEDED to error.quotaExceeded', () => {
    const fb = loadFirebaseModule();

    expect(fb._friendlyAuthError('PROJECT_QUOTA_EXCEEDED')).toBe('error.quotaExceeded');
  });

  it('maps NOT_SIGNED_IN to error.notSignedIn', () => {
    const fb = loadFirebaseModule();

    expect(fb._friendlyAuthError('NOT_SIGNED_IN')).toBe('error.notSignedIn');
  });

  it('still matches a substring embedded in surrounding text', () => {
    const fb = loadFirebaseModule();

    expect(fb._friendlyAuthError('ERROR: EMAIL_EXISTS for user')).toBe('error.emailExists');
  });

  it('falls back to error.generic with detail for unmatched messages', () => {
    const fb = loadFirebaseModule();

    expect(fb._friendlyAuthError('something totally unmatched')).toBe('error.generic');
    expect(globalThis.t).toHaveBeenLastCalledWith('error.generic', { detail: 'something totally unmatched' });
  });
});

describe('_updateVerifyEmailDisplay', () => {
  it('writes the email to #verify-email-target', () => {
    const fb = loadFirebaseModule();
    mountAuthDom();

    fb._updateVerifyEmailDisplay('a@b.com');

    expect(document.getElementById('verify-email-target').textContent).toBe('a@b.com');
  });

  it('writes empty string when email is empty', () => {
    const fb = loadFirebaseModule();
    mountAuthDom();

    fb._updateVerifyEmailDisplay('');

    expect(document.getElementById('verify-email-target').textContent).toBe('');
  });

  it('writes empty string when email is null or undefined', () => {
    const fb = loadFirebaseModule();
    mountAuthDom();

    fb._updateVerifyEmailDisplay(null);
    expect(document.getElementById('verify-email-target').textContent).toBe('');

    fb._updateVerifyEmailDisplay(undefined);
    expect(document.getElementById('verify-email-target').textContent).toBe('');
  });

  it('does not throw when #verify-email-target is absent', () => {
    const fb = loadFirebaseModule();
    document.body.innerHTML = '';

    expect(() => fb._updateVerifyEmailDisplay('a@b.com')).not.toThrow();
  });
});
