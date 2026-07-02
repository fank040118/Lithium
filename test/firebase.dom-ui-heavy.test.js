import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadFirebaseModule } from './helpers/loadFirebaseModule.js';
import { mountAuthDom } from './helpers/authDomFixture.js';
import { installUiMocks } from './helpers/uiMocks.js';

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  delete globalThis.t;
  delete globalThis.showToast;
  delete globalThis.fbIsSignedIn;
  delete globalThis.fbIsEmailVerified;
  delete globalThis.syncToCloud;
  delete globalThis.syncFromCloud;
  delete globalThis._updateSyncUI;
  delete globalThis._handleSyncBtn;
  vi.useRealTimers();
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('_updateSyncUI', () => {
  it('shows the login section and hides the logged section when not signed in', () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    globalThis.fbIsSignedIn = vi.fn(() => false);

    fb._updateSyncUI();

    const loginSection = document.getElementById('sync-login-section');
    const loggedSection = document.getElementById('sync-logged-section');
    expect(loginSection.classList.contains('hidden')).toBe(false);
    expect(loggedSection.classList.contains('hidden')).toBe(true);
    expect(document.getElementById('sync-status-text').textContent).toBe('');
  });

  it('shows notVerified status when signed in but email is not verified', () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    globalThis.fbIsSignedIn = vi.fn(() => true);
    globalThis.fbIsEmailVerified = vi.fn(() => false);

    fb._updateSyncUI();

    const loginSection = document.getElementById('sync-login-section');
    const loggedSection = document.getElementById('sync-logged-section');
    expect(loginSection.classList.contains('hidden')).toBe(true);
    expect(loggedSection.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('sync-status-text').textContent).toBe('sidebar.sync.status.notVerified');
  });

  it('shows syncedAt with the local HH:MM when signed in, verified, idle and ts is provided', () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    globalThis.fbIsSignedIn = vi.fn(() => true);
    globalThis.fbIsEmailVerified = vi.fn(() => true);

    fb._updateSyncUI(1700000000000);

    expect(document.getElementById('sync-status-text').textContent).toBe('sidebar.sync.status.syncedAt');
  });

  it('passes {time: HH:MM} vars to t when displaying syncedAt', () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    globalThis.fbIsSignedIn = vi.fn(() => true);
    globalThis.fbIsEmailVerified = vi.fn(() => true);
    const d = new Date(1700000000000);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const expectedTime = `${hh}:${mm}`;
    globalThis.t = vi.fn((key, vars) => key + '|' + (vars ? JSON.stringify(vars) : ''));

    fb._updateSyncUI(1700000000000);

    expect(globalThis.t).toHaveBeenCalledWith('sidebar.sync.status.syncedAt', { time: expectedTime });
  });

  it('shows syncing status when signed in, verified, idle and no ts is provided', () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    globalThis.fbIsSignedIn = vi.fn(() => true);
    globalThis.fbIsEmailVerified = vi.fn(() => true);

    fb._updateSyncUI();

    expect(document.getElementById('sync-status-text').textContent).toBe('sidebar.sync.status.syncing');
  });

  it('does not throw when the fixture is absent', () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    globalThis.fbIsSignedIn = vi.fn(() => true);

    expect(() => fb._updateSyncUI()).not.toThrow();
  });

  // uploading / downloading / error branches depend on closure-private
  // _syncState being non-idle during an in-flight sync and are left for
  // indirect coverage.
});

describe('_bindSyncActionButtons', () => {
  it('marks both buttons as bound after calling', () => {
    const fb = loadFirebaseModule();
    mountAuthDom();

    fb._bindSyncActionButtons();

    expect(document.getElementById('sync-upload-btn').dataset.bound).toBe('true');
    expect(document.getElementById('sync-download-btn').dataset.bound).toBe('true');
  });

  it('calls _handleSyncBtn with upload when the upload button is clicked', () => {
    const fb = loadFirebaseModule();
    mountAuthDom();
    globalThis._handleSyncBtn = vi.fn();

    fb._bindSyncActionButtons();
    document.getElementById('sync-upload-btn').click();

    expect(globalThis._handleSyncBtn).toHaveBeenCalledTimes(1);
    expect(globalThis._handleSyncBtn).toHaveBeenCalledWith('upload');
  });

  it('calls _handleSyncBtn with download when the download button is clicked', () => {
    const fb = loadFirebaseModule();
    mountAuthDom();
    globalThis._handleSyncBtn = vi.fn();

    fb._bindSyncActionButtons();
    document.getElementById('sync-download-btn').click();

    expect(globalThis._handleSyncBtn).toHaveBeenCalledTimes(1);
    expect(globalThis._handleSyncBtn).toHaveBeenCalledWith('download');
  });

  it('does not bind the same listener twice', () => {
    const fb = loadFirebaseModule();
    mountAuthDom();
    globalThis._handleSyncBtn = vi.fn();

    fb._bindSyncActionButtons();
    fb._bindSyncActionButtons();
    document.getElementById('sync-upload-btn').click();

    expect(globalThis._handleSyncBtn).toHaveBeenCalledTimes(1);
  });
});

describe('_handleSyncBtn', () => {
  it('shows an error toast and returns early when email is not verified', () => {
    const { showToast } = installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    globalThis.fbIsEmailVerified = vi.fn(() => false);
    globalThis.syncToCloud = vi.fn();
    globalThis.syncFromCloud = vi.fn();

    fb._handleSyncBtn('upload');

    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith('toast.syncMustVerifyEmail', 'error');
    expect(globalThis.syncToCloud).not.toHaveBeenCalled();
    expect(globalThis.syncFromCloud).not.toHaveBeenCalled();
    expect(document.getElementById('sync-upload-btn').disabled).toBe(false);
    expect(document.getElementById('sync-download-btn').disabled).toBe(false);
  });

  it('disables buttons during upload, toasts success, updates UI, then re-enables', async () => {
    const { showToast } = installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    globalThis.fbIsEmailVerified = vi.fn(() => true);
    globalThis._updateSyncUI = vi.fn();
    const { promise, resolve } = deferred();
    globalThis.syncToCloud = vi.fn(() => promise);
    globalThis.syncFromCloud = vi.fn();

    const callPromise = fb._handleSyncBtn('upload');
    expect(document.getElementById('sync-upload-btn').disabled).toBe(true);
    expect(document.getElementById('sync-download-btn').disabled).toBe(true);

    resolve();
    await callPromise;

    expect(globalThis.syncToCloud).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith('toast.syncUploaded', 'default');
    expect(globalThis._updateSyncUI).toHaveBeenCalled();
    expect(document.getElementById('sync-upload-btn').disabled).toBe(false);
    expect(document.getElementById('sync-download-btn').disabled).toBe(false);
  });

  it('toasts downloaded and updates UI when download returns true', async () => {
    const { showToast } = installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    globalThis.fbIsEmailVerified = vi.fn(() => true);
    globalThis._updateSyncUI = vi.fn();
    const { promise, resolve } = deferred();
    globalThis.syncFromCloud = vi.fn(() => promise);
    globalThis.syncToCloud = vi.fn();

    const callPromise = fb._handleSyncBtn('download');
    expect(document.getElementById('sync-upload-btn').disabled).toBe(true);
    expect(document.getElementById('sync-download-btn').disabled).toBe(true);

    resolve(true);
    await callPromise;

    expect(globalThis.syncFromCloud).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith('toast.syncDownloaded', 'default');
    expect(globalThis._updateSyncUI).toHaveBeenCalled();
    expect(document.getElementById('sync-upload-btn').disabled).toBe(false);
    expect(document.getElementById('sync-download-btn').disabled).toBe(false);
  });

  it('toasts noCloudData when download returns false', async () => {
    const { showToast } = installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    globalThis.fbIsEmailVerified = vi.fn(() => true);
    globalThis._updateSyncUI = vi.fn();
    globalThis.syncFromCloud = vi.fn(() => Promise.resolve(false));
    globalThis.syncToCloud = vi.fn();

    await fb._handleSyncBtn('download');

    expect(showToast).toHaveBeenCalledWith('toast.syncNoCloudData', 'default');
    expect(globalThis._updateSyncUI).toHaveBeenCalled();
  });

  it('toasts auth failure when syncToCloud rejects with code auth', async () => {
    const { showToast } = installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    globalThis.fbIsEmailVerified = vi.fn(() => true);
    globalThis._updateSyncUI = vi.fn();
    globalThis.syncToCloud = vi.fn(() => Promise.reject({ code: 'auth' }));
    globalThis.syncFromCloud = vi.fn();

    await fb._handleSyncBtn('upload');

    expect(showToast).toHaveBeenCalledWith('toast.syncAuthFailed', 'error');
    expect(globalThis._updateSyncUI).toHaveBeenCalled();
  });

  it('toasts network failure when syncToCloud rejects with code network', async () => {
    const { showToast } = installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    globalThis.fbIsEmailVerified = vi.fn(() => true);
    globalThis._updateSyncUI = vi.fn();
    globalThis.syncToCloud = vi.fn(() => Promise.reject({ code: 'network' }));
    globalThis.syncFromCloud = vi.fn();

    await fb._handleSyncBtn('upload');

    expect(showToast).toHaveBeenCalledWith('toast.syncNetworkFailed', 'error');
    expect(globalThis._updateSyncUI).toHaveBeenCalled();
  });

  it('toasts quota failure when syncToCloud rejects with code quota', async () => {
    const { showToast } = installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    globalThis.fbIsEmailVerified = vi.fn(() => true);
    globalThis._updateSyncUI = vi.fn();
    globalThis.syncToCloud = vi.fn(() => Promise.reject({ code: 'quota' }));
    globalThis.syncFromCloud = vi.fn();

    await fb._handleSyncBtn('upload');

    expect(showToast).toHaveBeenCalledWith('toast.syncQuotaFailed', 'error');
    expect(globalThis._updateSyncUI).toHaveBeenCalled();
  });

  it('toasts generic sync failure when syncToCloud rejects without a code', async () => {
    const { showToast } = installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    globalThis.fbIsEmailVerified = vi.fn(() => true);
    globalThis._updateSyncUI = vi.fn();
    globalThis.syncToCloud = vi.fn(() => Promise.reject({}));

    await fb._handleSyncBtn('upload');

    expect(showToast).toHaveBeenCalledWith('toast.syncFailed', 'error');
    expect(globalThis._updateSyncUI).toHaveBeenCalled();
  });

  it('toasts generic sync failure when syncToCloud rejects with a plain Error', async () => {
    const { showToast } = installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    globalThis.fbIsEmailVerified = vi.fn(() => true);
    globalThis._updateSyncUI = vi.fn();
    globalThis.syncToCloud = vi.fn(() => Promise.reject(new Error('boom')));

    await fb._handleSyncBtn('upload');

    expect(showToast).toHaveBeenCalledWith('toast.syncFailed', 'error');
    expect(globalThis._updateSyncUI).toHaveBeenCalled();
  });
});

function cleanupAuthIntercepts() {
  delete globalThis.fbSignIn;
  delete globalThis.fbSignUp;
  delete globalThis.fbIsEmailVerified;
  delete globalThis.syncFromCloud;
  delete globalThis.scheduleSyncToCloud;
  delete globalThis._updateSyncUI;
  delete globalThis._showAuthMode;
  delete globalThis._hideLoginOverlay;
  delete globalThis._updateVerifyEmailDisplay;
  delete globalThis._hasLoginConsent;
  delete globalThis._showLoginOverlay;
  delete globalThis._showLoginConsentOverlay;
}

describe('_showAuthMode', () => {
  afterEach(() => {
    cleanupAuthIntercepts();
  });

  it("activates the signup pane and tab", () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();

    fb._showAuthMode('signup');

    document.querySelectorAll('.auth-pane').forEach(el => {
      const expectedHidden = el.id !== 'auth-pane-signup';
      expect(el.classList.contains('hidden')).toBe(expectedHidden);
    });
    document.querySelectorAll('.auth-tab').forEach(el => {
      const expectedActive = el.dataset.mode === 'signup';
      expect(el.classList.contains('active')).toBe(expectedActive);
    });
  });

  it("activates the login pane and tab", () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();

    fb._showAuthMode('login');

    document.querySelectorAll('.auth-pane').forEach(el => {
      const expectedHidden = el.id !== 'auth-pane-login';
      expect(el.classList.contains('hidden')).toBe(expectedHidden);
    });
    document.querySelectorAll('.auth-tab').forEach(el => {
      const expectedActive = el.dataset.mode === 'login';
      expect(el.classList.contains('active')).toBe(expectedActive);
    });
  });
});

describe('_handleSyncLoginClick', () => {
  afterEach(() => {
    cleanupAuthIntercepts();
  });

  it('opens login overlay directly when consent has already been granted', () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    globalThis._hasLoginConsent = vi.fn(() => true);
    globalThis._showAuthMode = vi.fn();
    globalThis._showLoginOverlay = vi.fn();
    globalThis._showLoginConsentOverlay = vi.fn();

    fb._handleSyncLoginClick();

    expect(globalThis._showAuthMode).toHaveBeenCalledTimes(1);
    expect(globalThis._showAuthMode).toHaveBeenCalledWith('login');
    expect(globalThis._showLoginOverlay).toHaveBeenCalledTimes(1);
    expect(globalThis._showLoginConsentOverlay).not.toHaveBeenCalled();
  });

  it('shows the consent overlay when consent has not been granted', () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    globalThis._hasLoginConsent = vi.fn(() => false);
    globalThis._showAuthMode = vi.fn();
    globalThis._showLoginOverlay = vi.fn();
    globalThis._showLoginConsentOverlay = vi.fn();

    fb._handleSyncLoginClick();

    expect(globalThis._showLoginConsentOverlay).toHaveBeenCalledTimes(1);
    expect(globalThis._showAuthMode).not.toHaveBeenCalled();
    expect(globalThis._showLoginOverlay).not.toHaveBeenCalled();
  });
});

describe('_handleLogin', () => {
  afterEach(() => {
    cleanupAuthIntercepts();
  });

  it('returns early when email or password is empty', async () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    globalThis.fbSignIn = vi.fn();

    await fb._handleLogin();

    expect(globalThis.fbSignIn).not.toHaveBeenCalled();
  });

  it('hides overlay and does not schedule sync when cloud data exists', async () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    document.getElementById('login-email').value = 'user@example.com';
    document.getElementById('login-password').value = 'password123';
    globalThis.fbSignIn = vi.fn(async () => {});
    globalThis.fbIsEmailVerified = vi.fn(() => true);
    globalThis.syncFromCloud = vi.fn(async () => true);
    globalThis.scheduleSyncToCloud = vi.fn();
    globalThis._hideLoginOverlay = vi.fn();
    globalThis._updateSyncUI = vi.fn();

    await fb._handleLogin();

    expect(globalThis.fbSignIn).toHaveBeenCalledTimes(1);
    expect(globalThis.fbSignIn).toHaveBeenCalledWith('user@example.com', 'password123');
    expect(globalThis._hideLoginOverlay).toHaveBeenCalledTimes(1);
    expect(globalThis._updateSyncUI).toHaveBeenCalled();
    expect(globalThis.syncFromCloud).toHaveBeenCalledTimes(1);
    expect(globalThis.scheduleSyncToCloud).not.toHaveBeenCalled();
    const btn = document.getElementById('login-submit-btn');
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('dialog.login.submitLogin');
  });

  it('schedules sync to cloud when no cloud data exists', async () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    document.getElementById('login-email').value = 'user@example.com';
    document.getElementById('login-password').value = 'password123';
    globalThis.fbSignIn = vi.fn(async () => {});
    globalThis.fbIsEmailVerified = vi.fn(() => true);
    globalThis.syncFromCloud = vi.fn(async () => false);
    globalThis.scheduleSyncToCloud = vi.fn();
    globalThis._hideLoginOverlay = vi.fn();
    globalThis._updateSyncUI = vi.fn();

    await fb._handleLogin();

    expect(globalThis.syncFromCloud).toHaveBeenCalledTimes(1);
    expect(globalThis.scheduleSyncToCloud).toHaveBeenCalledTimes(1);
    const btn = document.getElementById('login-submit-btn');
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('dialog.login.submitLogin');
  });

  it('switches to verify pane when signed in but email is not verified', async () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    document.getElementById('login-email').value = 'user@example.com';
    document.getElementById('login-password').value = 'password123';
    globalThis.fbSignIn = vi.fn(async () => {});
    globalThis.fbIsEmailVerified = vi.fn(() => false);
    globalThis._updateVerifyEmailDisplay = vi.fn();
    globalThis._showAuthMode = vi.fn();
    globalThis._updateSyncUI = vi.fn();
    globalThis._hideLoginOverlay = vi.fn();
    globalThis.syncFromCloud = vi.fn();

    await fb._handleLogin();

    expect(globalThis._updateVerifyEmailDisplay).toHaveBeenCalledTimes(1);
    expect(globalThis._updateVerifyEmailDisplay).toHaveBeenCalledWith('user@example.com');
    expect(globalThis._showAuthMode).toHaveBeenCalledTimes(1);
    expect(globalThis._showAuthMode).toHaveBeenCalledWith('verify');
    expect(globalThis._updateSyncUI).toHaveBeenCalled();
    expect(globalThis._hideLoginOverlay).not.toHaveBeenCalled();
    expect(globalThis.syncFromCloud).not.toHaveBeenCalled();
    const btn = document.getElementById('login-submit-btn');
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('dialog.login.submitLogin');
  });

  it('shows friendly error and resets button when fbSignIn rejects', async () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    document.getElementById('login-email').value = 'user@example.com';
    document.getElementById('login-password').value = 'password123';
    globalThis.fbSignIn = vi.fn(async () => {
      throw new Error('EMAIL_NOT_FOUND');
    });

    await fb._handleLogin();

    expect(document.getElementById('login-error').textContent).toBe('error.emailNotFound');
    const btn = document.getElementById('login-submit-btn');
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('dialog.login.submitLogin');
  });
});

describe('_handleSignUp', () => {
  afterEach(() => {
    cleanupAuthIntercepts();
  });

  it('returns early when email or password is empty', async () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    globalThis.fbSignUp = vi.fn();

    await fb._handleSignUp();

    expect(globalThis.fbSignUp).not.toHaveBeenCalled();
  });

  it('shows mismatch error when passwords do not match', async () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    document.getElementById('signup-email').value = 'user@example.com';
    document.getElementById('signup-password').value = 'Abcdefg1';
    document.getElementById('signup-password-confirm').value = 'Abcdefg2';
    globalThis.fbSignUp = vi.fn();

    await fb._handleSignUp();

    expect(document.getElementById('signup-error').textContent).toBe('auth.signupPasswordMismatch');
    expect(globalThis.fbSignUp).not.toHaveBeenCalled();
  });

  it('shows too-short error for passwords shorter than 8 characters', async () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    document.getElementById('signup-email').value = 'user@example.com';
    document.getElementById('signup-password').value = 'Aa1';
    document.getElementById('signup-password-confirm').value = 'Aa1';
    globalThis.fbSignUp = vi.fn();

    await fb._handleSignUp();

    expect(document.getElementById('signup-error').textContent).toBe('auth.signupPasswordTooShort');
    expect(globalThis.fbSignUp).not.toHaveBeenCalled();
  });

  it('shows too-long error for passwords longer than 128 characters', async () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    document.getElementById('signup-email').value = 'user@example.com';
    const longPassword = 'Abcdefg1' + 'a'.repeat(121);
    document.getElementById('signup-password').value = longPassword;
    document.getElementById('signup-password-confirm').value = longPassword;
    globalThis.fbSignUp = vi.fn();

    await fb._handleSignUp();

    expect(document.getElementById('signup-error').textContent).toBe('auth.signupPasswordTooLong');
    expect(globalThis.fbSignUp).not.toHaveBeenCalled();
  });

  it('shows needs-upper error when password has no uppercase letter', async () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    document.getElementById('signup-email').value = 'user@example.com';
    document.getElementById('signup-password').value = 'abcdefg1';
    document.getElementById('signup-password-confirm').value = 'abcdefg1';
    globalThis.fbSignUp = vi.fn();

    await fb._handleSignUp();

    expect(document.getElementById('signup-error').textContent).toBe('auth.signupPasswordNeedsUpper');
    expect(globalThis.fbSignUp).not.toHaveBeenCalled();
  });

  it('shows needs-lower error when password has no lowercase letter', async () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    document.getElementById('signup-email').value = 'user@example.com';
    document.getElementById('signup-password').value = 'ABCDEFG1';
    document.getElementById('signup-password-confirm').value = 'ABCDEFG1';
    globalThis.fbSignUp = vi.fn();

    await fb._handleSignUp();

    expect(document.getElementById('signup-error').textContent).toBe('auth.signupPasswordNeedsLower');
    expect(globalThis.fbSignUp).not.toHaveBeenCalled();
  });

  it('shows needs-digit error when password has no digit', async () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    document.getElementById('signup-email').value = 'user@example.com';
    document.getElementById('signup-password').value = 'Abcdefgh';
    document.getElementById('signup-password-confirm').value = 'Abcdefgh';
    globalThis.fbSignUp = vi.fn();

    await fb._handleSignUp();

    expect(document.getElementById('signup-error').textContent).toBe('auth.signupPasswordNeedsDigit');
    expect(globalThis.fbSignUp).not.toHaveBeenCalled();
  });

  it('shows invalid-char error when password contains a non-whitelisted character', async () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    document.getElementById('signup-email').value = 'user@example.com';
    document.getElementById('signup-password').value = 'Abcdefg1^';
    document.getElementById('signup-password-confirm').value = 'Abcdefg1^';
    globalThis.fbSignUp = vi.fn();

    await fb._handleSignUp();

    expect(document.getElementById('signup-error').textContent).toBe('auth.signupPasswordInvalidChar');
    expect(globalThis.fbSignUp).not.toHaveBeenCalled();
  });

  it('creates account and switches to verify pane on valid input', async () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    document.getElementById('signup-email').value = 'user@example.com';
    document.getElementById('signup-password').value = 'Abcdefg1';
    document.getElementById('signup-password-confirm').value = 'Abcdefg1';
    globalThis.fbSignUp = vi.fn(async () => {});
    globalThis._updateVerifyEmailDisplay = vi.fn();
    globalThis._showAuthMode = vi.fn();
    globalThis._updateSyncUI = vi.fn();

    await fb._handleSignUp();

    expect(globalThis.fbSignUp).toHaveBeenCalledTimes(1);
    expect(globalThis.fbSignUp).toHaveBeenCalledWith('user@example.com', 'Abcdefg1');
    expect(globalThis._updateVerifyEmailDisplay).toHaveBeenCalledTimes(1);
    expect(globalThis._updateVerifyEmailDisplay).toHaveBeenCalledWith('user@example.com');
    expect(globalThis._showAuthMode).toHaveBeenCalledTimes(1);
    expect(globalThis._showAuthMode).toHaveBeenCalledWith('verify');
    expect(globalThis._updateSyncUI).toHaveBeenCalled();
    const btn = document.getElementById('signup-submit-btn');
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('dialog.login.submitSignup');
  });

  it('shows friendly error and resets button when fbSignUp rejects', async () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    document.getElementById('signup-email').value = 'user@example.com';
    document.getElementById('signup-password').value = 'Abcdefg1';
    document.getElementById('signup-password-confirm').value = 'Abcdefg1';
    globalThis.fbSignUp = vi.fn(async () => {
      throw new Error('EMAIL_EXISTS');
    });

    await fb._handleSignUp();

    expect(document.getElementById('signup-error').textContent).toBe('error.emailExists');
    const btn = document.getElementById('signup-submit-btn');
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('dialog.login.submitSignup');
  });
});

function cleanupVerifyIntercepts() {
  delete globalThis.fbSendEmailVerification;
  delete globalThis.fbSendPasswordReset;
  delete globalThis.fbRefreshEmailVerifiedStatus;
  delete globalThis.syncFromCloud;
  delete globalThis.scheduleSyncToCloud;
  delete globalThis._hideLoginOverlay;
  delete globalThis._updateSyncUI;
}

describe('_handleResendVerification', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanupVerifyIntercepts();
    vi.useRealTimers();
  });

  it('sets pending status, then success, and re-enables the button after 30s', async () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    const { promise, resolve } = deferred();
    globalThis.fbSendEmailVerification = vi.fn(() => promise);

    const callPromise = fb._handleResendVerification();
    const statusEl = document.getElementById('verify-status');
    const btn = document.getElementById('verify-resend-btn');
    expect(statusEl.textContent).toBe('auth.verifyResendPending');
    expect(btn.disabled).toBe(true);

    resolve();
    await callPromise;
    expect(statusEl.textContent).toBe('auth.verifyResendSuccess');
    expect(btn.disabled).toBe(true);

    await vi.advanceTimersByTimeAsync(30000);
    expect(btn.disabled).toBe(false);
  });

  it('shows error status when fbSendEmailVerification rejects', async () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    globalThis.fbSendEmailVerification = vi.fn(async () => {
      throw new Error('OPERATION_NOT_ALLOWED');
    });

    await fb._handleResendVerification();

    expect(document.getElementById('verify-status').textContent).toBe('auth.verifyResendError');
  });
});

describe('_handleForgotPassword', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanupVerifyIntercepts();
    vi.useRealTimers();
  });

  it('returns early when the button is already disabled', async () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    globalThis.fbSendPasswordReset = vi.fn(async () => {});
    const btn = document.getElementById('forgot-password-btn');
    btn.disabled = true;

    await fb._handleForgotPassword();

    expect(globalThis.fbSendPasswordReset).not.toHaveBeenCalled();
    expect(btn.disabled).toBe(true);
  });

  it('toasts an error and does not call reset when the email input is empty', async () => {
    const { showToast } = installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    document.getElementById('login-email').value = '';
    globalThis.fbSendPasswordReset = vi.fn(async () => {});
    const btn = document.getElementById('forgot-password-btn');

    await fb._handleForgotPassword();

    expect(globalThis.fbSendPasswordReset).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith('auth.passwordResetEmptyEmail', 'error');
    expect(btn.disabled).toBe(false);
  });

  it('sends reset, toasts success and locks the button for 30s', async () => {
    const { showToast } = installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    document.getElementById('login-email').value = 'user@example.com';
    globalThis.fbSendPasswordReset = vi.fn(async () => {});
    const btn = document.getElementById('forgot-password-btn');

    await fb._handleForgotPassword();

    expect(globalThis.fbSendPasswordReset).toHaveBeenCalledTimes(1);
    expect(globalThis.fbSendPasswordReset).toHaveBeenCalledWith('user@example.com');
    expect(showToast).toHaveBeenCalledWith('auth.passwordResetSent', 'default');
    expect(btn.disabled).toBe(true);

    await vi.advanceTimersByTimeAsync(30000);
    expect(btn.disabled).toBe(false);
  });

  it('toasts an error and immediately re-enables the button when reset fails', async () => {
    const { showToast } = installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    document.getElementById('login-email').value = 'user@example.com';
    globalThis.fbSendPasswordReset = vi.fn(async () => {
      throw new Error('INVALID_EMAIL');
    });
    const btn = document.getElementById('forgot-password-btn');

    await fb._handleForgotPassword();

    expect(showToast).toHaveBeenCalledWith('auth.passwordResetError', 'error');
    expect(btn.disabled).toBe(false);
  });
});

describe('_handleCheckVerified', () => {
  afterEach(() => {
    cleanupVerifyIntercepts();
  });

  it('hides overlay and does not schedule sync when cloud data exists', async () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    const { promise, resolve } = deferred();
    globalThis.fbRefreshEmailVerifiedStatus = vi.fn(() => promise);
    globalThis.syncFromCloud = vi.fn(async () => true);
    globalThis.scheduleSyncToCloud = vi.fn();
    globalThis._hideLoginOverlay = vi.fn();
    globalThis._updateSyncUI = vi.fn();

    const callPromise = fb._handleCheckVerified();
    const statusEl = document.getElementById('verify-status');
    const btn = document.getElementById('verify-check-btn');
    expect(statusEl.textContent).toBe('auth.verifyChecking');
    expect(btn.disabled).toBe(true);

    resolve(true);
    await callPromise;
    expect(statusEl.textContent).toBe('');
    expect(globalThis._hideLoginOverlay).toHaveBeenCalledTimes(1);
    expect(globalThis._updateSyncUI).toHaveBeenCalled();
    expect(globalThis.syncFromCloud).toHaveBeenCalledTimes(1);
    expect(globalThis.scheduleSyncToCloud).not.toHaveBeenCalled();
    expect(btn.disabled).toBe(false);
  });

  it('hides overlay and schedules sync when no cloud data exists', async () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    globalThis.fbRefreshEmailVerifiedStatus = vi.fn(async () => true);
    globalThis.syncFromCloud = vi.fn(async () => false);
    globalThis.scheduleSyncToCloud = vi.fn();
    globalThis._hideLoginOverlay = vi.fn();
    globalThis._updateSyncUI = vi.fn();

    await fb._handleCheckVerified();

    expect(document.getElementById('verify-status').textContent).toBe('');
    expect(globalThis._hideLoginOverlay).toHaveBeenCalledTimes(1);
    expect(globalThis._updateSyncUI).toHaveBeenCalled();
    expect(globalThis.syncFromCloud).toHaveBeenCalledTimes(1);
    expect(globalThis.scheduleSyncToCloud).toHaveBeenCalledTimes(1);
    expect(document.getElementById('verify-check-btn').disabled).toBe(false);
  });

  it('shows not-yet status and does not hide overlay when email is not verified', async () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    globalThis.fbRefreshEmailVerifiedStatus = vi.fn(async () => false);
    globalThis.syncFromCloud = vi.fn();
    globalThis._hideLoginOverlay = vi.fn();
    globalThis._updateSyncUI = vi.fn();

    await fb._handleCheckVerified();

    expect(document.getElementById('verify-status').textContent).toBe('auth.verifyNotYet');
    expect(globalThis._hideLoginOverlay).not.toHaveBeenCalled();
    expect(globalThis.syncFromCloud).not.toHaveBeenCalled();
  });

  it('shows error status and re-enables the button when refresh throws', async () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    globalThis.fbRefreshEmailVerifiedStatus = vi.fn(async () => {
      throw new Error('TOO_MANY_ATTEMPTS');
    });

    await fb._handleCheckVerified();

    expect(document.getElementById('verify-status').textContent).toBe('auth.verifyCheckError');
    expect(document.getElementById('verify-check-btn').disabled).toBe(false);
  });
});
