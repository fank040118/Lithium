import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadFirebaseModule } from './helpers/loadFirebaseModule.js';
import { createMockChromeStorage } from './helpers/mockChromeStorage.js';
import { createRoutedFetch, jsonResponse } from './helpers/mockFetch.js';
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
  delete globalThis._pullAfterSignIn;
  delete globalThis._updateSyncUI;
  delete globalThis._handleSyncBtn;
  delete globalThis.chrome;
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
  delete globalThis._pullAfterSignIn;
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

  it('hides the overlay and delegates the post-login pull without scheduling a duplicate upload', async () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    document.getElementById('login-email').value = 'user@example.com';
    document.getElementById('login-password').value = 'password123';
    const storage = createMockChromeStorage({});
    globalThis.chrome = storage;
    await fb._loadAuth();
    // Emulate the real fbSignIn(): the new uid appears before _handleLogin
    // resumes. Switch detection (baseline vs. uid) now lives inside
    // _pullAfterSignIn, so the caller no longer captures a previous uid.
    globalThis.fbSignIn = vi.fn(async () => {
      storage._data._fb_uid = 'user-uid';
      await fb._loadAuth();
    });
    globalThis.fbIsEmailVerified = vi.fn(() => true);
    globalThis._pullAfterSignIn = vi.fn(async () => {});
    globalThis.syncFromCloud = vi.fn();
    globalThis.scheduleSyncToCloud = vi.fn();
    globalThis._hideLoginOverlay = vi.fn();
    globalThis._updateSyncUI = vi.fn();

    await fb._handleLogin();

    expect(globalThis.fbSignIn).toHaveBeenCalledTimes(1);
    expect(globalThis.fbSignIn).toHaveBeenCalledWith('user@example.com', 'password123');
    expect(globalThis._hideLoginOverlay).toHaveBeenCalledTimes(1);
    expect(globalThis._updateSyncUI).toHaveBeenCalled();
    // First login ever: no persisted baseline → _pullAfterSignIn decides on
    // its own; _handleLogin must not force or pass any uid.
    expect(globalThis._pullAfterSignIn).toHaveBeenCalledTimes(1);
    expect(globalThis._pullAfterSignIn).toHaveBeenCalledWith();
    expect(globalThis.syncFromCloud).not.toHaveBeenCalled();
    expect(globalThis.scheduleSyncToCloud).not.toHaveBeenCalled();
    const btn = document.getElementById('login-submit-btn');
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('dialog.login.submitLogin');
  });

  it('delegates the switch decision to _pullAfterSignIn even for a different account', async () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    document.getElementById('login-email').value = 'other@example.com';
    document.getElementById('login-password').value = 'password123';
    const storage = createMockChromeStorage({
      _fb_refresh: 'seed-refresh',
      _fb_uid: 'account-a',
      _fb_sync_baseline_uid: 'account-a',
      _fb_email_verified: true,
      _fb_email: 'a@example.com',
    });
    globalThis.chrome = storage;
    await fb._loadAuth();
    // Emulate the real fbSignIn(): the signed-in uid becomes the new account,
    // while the persisted baseline still points at the old one.
    globalThis.fbSignIn = vi.fn(async () => {
      storage._data._fb_uid = 'account-b';
      await fb._loadAuth();
    });
    globalThis.fbIsEmailVerified = vi.fn(() => true);
    globalThis._pullAfterSignIn = vi.fn(async () => {});
    globalThis.syncFromCloud = vi.fn();
    globalThis.scheduleSyncToCloud = vi.fn();
    globalThis._hideLoginOverlay = vi.fn();
    globalThis._updateSyncUI = vi.fn();

    await fb._handleLogin();

    expect(globalThis._pullAfterSignIn).toHaveBeenCalledTimes(1);
    // 切号强制拉取的判定在 _pullAfterSignIn 内部（基线≠uid），调用点不再传参
    expect(globalThis._pullAfterSignIn).toHaveBeenCalledWith();
    expect(globalThis.syncFromCloud).not.toHaveBeenCalled();
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
  delete globalThis._pullAfterSignIn;
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

  it('hides overlay and delegates the post-verification pull without scheduling a duplicate upload', async () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    const { promise, resolve } = deferred();
    globalThis.fbRefreshEmailVerifiedStatus = vi.fn(() => promise);
    globalThis._pullAfterSignIn = vi.fn(async () => {});
    globalThis.syncFromCloud = vi.fn();
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
    expect(globalThis._pullAfterSignIn).toHaveBeenCalledTimes(1);
    expect(globalThis.syncFromCloud).not.toHaveBeenCalled();
    expect(globalThis.scheduleSyncToCloud).not.toHaveBeenCalled();
    expect(btn.disabled).toBe(false);
  });

  it('requests a non-forced pull after verification (same account, not a switch)', async () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    globalThis.fbRefreshEmailVerifiedStatus = vi.fn(async () => true);
    globalThis._pullAfterSignIn = vi.fn(async () => {});
    globalThis.syncFromCloud = vi.fn();
    globalThis.scheduleSyncToCloud = vi.fn();
    globalThis._hideLoginOverlay = vi.fn();
    globalThis._updateSyncUI = vi.fn();

    await fb._handleCheckVerified();

    expect(document.getElementById('verify-status').textContent).toBe('');
    expect(globalThis._hideLoginOverlay).toHaveBeenCalledTimes(1);
    expect(globalThis._updateSyncUI).toHaveBeenCalled();
    expect(globalThis._pullAfterSignIn).toHaveBeenCalledTimes(1);
    expect(globalThis._pullAfterSignIn).toHaveBeenCalledWith();
    expect(globalThis.syncFromCloud).not.toHaveBeenCalled();
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

// 账号切换端到端回归：复现 /tmp/opencode/repro-verify-path-cross-account.mjs
// （A 脏遗留 + 持久化基线=A → 登录未验证 B → 验证完成 → 拉取必须强制生效）。
describe('账号切换验证邮箱路径（C1 回归）', () => {
  afterEach(() => {
    delete globalThis.fetch;
    delete globalThis.items;
    delete globalThis.customEngines;
    delete globalThis.selectedEngineId;
    delete globalThis.clocks;
    delete globalThis.mainGridColumns;
    delete globalThis.applyWallpaper;
    delete globalThis.applyMainGridColumns;
    delete globalThis.render;
    delete globalThis.getSelectedEngine;
  });

  function base64urlEncode(payload) {
    return btoa(JSON.stringify(payload))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  it('applies the new account cloud data after verification instead of PATCHing the old leftovers', async () => {
    vi.useFakeTimers();
    try {
      installUiMocks();
      const fb = loadFirebaseModule();
      mountAuthDom();
      const engineName = document.createElement('div');
      engineName.id = 'engine-name';
      document.body.appendChild(engineName);

      const unverifiedToken = `h.${base64urlEncode({ email_verified: false })}.s`;
      const verifiedToken = `h.${base64urlEncode({ email_verified: true })}.s`;
      const cloudItems = [{ id: 'B-cloud-data' }];
      const patches = [];
      globalThis.fetch = createRoutedFetch([
        {
          match: (url) => url.includes('accounts:signInWithPassword'),
          respond: async () => jsonResponse(200, {
            idToken: unverifiedToken, expiresIn: '3600', refreshToken: 'b-refresh', localId: 'account-b',
          }),
        },
        {
          match: (url) => url.includes('accounts:lookup'),
          respond: async () => jsonResponse(200, { users: [{ emailVerified: true }] }),
        },
        {
          match: (url) => url.includes('securetoken.googleapis.com'),
          respond: async () => jsonResponse(200, {
            id_token: verifiedToken, expires_in: '3600', refresh_token: 'b-refresh', user_id: 'account-b',
          }),
        },
        {
          match: (url, options = {}) =>
            url.includes('/documents/users/') && (!options.method || options.method === 'GET'),
          respond: async () => jsonResponse(200, {
            updateTime: '2024-06-02T00:00:00.000000000Z',
            fields: { items: { stringValue: JSON.stringify(cloudItems) } },
          }),
        },
        {
          match: (url, options = {}) => url.includes('/documents/users/') && options.method === 'PATCH',
          respond: async (url, options) => {
            patches.push({ url, items: JSON.parse(JSON.parse(options.body).fields.items.stringValue) });
            return jsonResponse(200, { updateTime: '2024-06-03T00:00:00.000000000Z' });
          },
        },
      ]);

      const storage = createMockChromeStorage({
        _fb_refresh: 'a-refresh',
        _fb_uid: 'account-a',
        _fb_email_verified: true,
        _fb_email: 'a@example.com',
        _fb_edit_rev: 2,
        _fb_synced_rev: 1,
        _fb_cloud_sync_ts: new Date('2024-06-01T00:00:00.000Z').getTime(),
        _fb_sync_baseline_uid: 'account-a',
      });
      globalThis.chrome = storage;
      globalThis.items = [{ id: 'A-secret-leftover' }];
      globalThis.customEngines = [];
      globalThis.selectedEngineId = 'google';
      globalThis.clocks = [];
      globalThis.mainGridColumns = 4;
      globalThis.applyWallpaper = () => {};
      globalThis.applyMainGridColumns = () => {};
      globalThis.render = () => {};
      globalThis.getSelectedEngine = () => ({ name: 'Google' });

      await fb._loadAuth();
      await fb._loadCloudSyncTs();
      await fb._loadRevState();

      // 切出 A、登录未验证的 B，再从验证面板完成验证
      await fb.fbSignOut();
      document.getElementById('login-email').value = 'b@example.com';
      document.getElementById('login-password').value = 'password123';
      await fb._handleLogin();
      expect(fb.fbIsSignedIn()).toBe(true);
      expect(fb.fbIsEmailVerified()).toBe(false);

      await fb._handleCheckVerified();

      expect(fb.fbIsEmailVerified()).toBe(true);
      // B 的云端文档必须是权威版本：A 的遗留 items 不得保留，更不得 PATCH 进 B
      expect(globalThis.items).toEqual(cloudItems);
      expect(storage._data._fb_sync_baseline_uid).toBe('account-b');
      await vi.advanceTimersByTimeAsync(2500);   // 让任何被误排的上传跑完
      expect(patches).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

function cleanupDeleteAccountIntercepts() {
  delete globalThis._showDeleteAccountConfirm;
  delete globalThis.fbDeleteAccount;
  delete globalThis.fbIsSignedIn;
  delete globalThis._updateSyncUI;
}

describe('_renderDeleteAccountConfirmBtn', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the confirm button in its initial enabled state', () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();

    fb._renderDeleteAccountConfirmBtn();

    const btn = document.getElementById('delete-account-confirm');
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('dialog.deleteAccount.confirm');
  });

  it('renders the countdown state after _showDeleteAccountConfirm starts the timer', () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();

    fb._showDeleteAccountConfirm();
    const btn = document.getElementById('delete-account-confirm');
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe('dialog.deleteAccount.confirmCountdown');

    fb._closeDeleteAccountModal(false);
  });

  it('does not throw when the confirm button is absent', () => {
    installUiMocks();
    const fb = loadFirebaseModule();

    expect(() => fb._renderDeleteAccountConfirmBtn()).not.toThrow();
  });
});

describe('_showDeleteAccountConfirm', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('unhides the overlay and starts the 5-second countdown', () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();

    const promise = fb._showDeleteAccountConfirm();
    const overlay = document.getElementById('delete-account-overlay');
    const btn = document.getElementById('delete-account-confirm');
    expect(promise).toBeInstanceOf(Promise);
    expect(overlay.classList.contains('hidden')).toBe(false);
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe('dialog.deleteAccount.confirmCountdown');

    fb._closeDeleteAccountModal(false);
  });

  it('counts down to 0 and re-enables the confirm button', async () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();

    fb._showDeleteAccountConfirm();
    const btn = document.getElementById('delete-account-confirm');

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('dialog.deleteAccount.confirm');

    fb._closeDeleteAccountModal(false);
  });

  it('resolves to false when the overlay is absent', async () => {
    installUiMocks();
    const fb = loadFirebaseModule();

    const result = await fb._showDeleteAccountConfirm();
    expect(result).toBe(false);
  });

  it('cancels a prior pending dialog before opening a new one', async () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();

    const first = fb._showDeleteAccountConfirm();
    const second = fb._showDeleteAccountConfirm();

    expect(second).toBeInstanceOf(Promise);
    expect(document.getElementById('delete-account-overlay').classList.contains('hidden')).toBe(false);

    const firstResult = await first;
    expect(firstResult).toBe(false);

    fb._closeDeleteAccountModal(false);
  });
});

describe('_closeDeleteAccountModal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves the pending promise with true and hides the overlay', async () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();

    const promise = fb._showDeleteAccountConfirm();
    fb._closeDeleteAccountModal(true);

    expect(await promise).toBe(true);
    expect(document.getElementById('delete-account-overlay').classList.contains('hidden')).toBe(true);
  });

  it('resolves the pending promise with false and clears the interval', async () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();

    const promise = fb._showDeleteAccountConfirm();
    fb._closeDeleteAccountModal(false);

    expect(await promise).toBe(false);

    const btn = document.getElementById('delete-account-confirm');
    const disabledAfterClose = btn.disabled;
    const textAfterClose = btn.textContent;
    await vi.advanceTimersByTimeAsync(5000);
    expect(btn.disabled).toBe(disabledAfterClose);
    expect(btn.textContent).toBe(textAfterClose);
  });
});

describe('_handleDeleteAccount', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanupDeleteAccountIntercepts();
    vi.useRealTimers();
  });

  it('returns early when the user is not signed in', async () => {
    const { showToast } = installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    globalThis.fbIsSignedIn = vi.fn(() => false);
    globalThis._showDeleteAccountConfirm = vi.fn(async () => true);
    globalThis.fbDeleteAccount = vi.fn();
    globalThis._updateSyncUI = vi.fn();

    await fb._handleDeleteAccount();

    expect(globalThis._showDeleteAccountConfirm).not.toHaveBeenCalled();
    expect(globalThis.fbDeleteAccount).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('returns without deleting when the user cancels', async () => {
    const { showToast } = installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    globalThis.fbIsSignedIn = vi.fn(() => true);
    globalThis._showDeleteAccountConfirm = vi.fn(async () => false);
    globalThis.fbDeleteAccount = vi.fn();
    globalThis._updateSyncUI = vi.fn();

    await fb._handleDeleteAccount();

    expect(globalThis._showDeleteAccountConfirm).toHaveBeenCalledTimes(1);
    expect(globalThis.fbDeleteAccount).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
    expect(globalThis._updateSyncUI).not.toHaveBeenCalled();
  });

  it('toasts success, updates UI and shows pending state when deletion succeeds', async () => {
    const { showToast } = installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    globalThis.fbIsSignedIn = vi.fn(() => true);
    globalThis._showDeleteAccountConfirm = vi.fn(async () => true);
    globalThis.fbDeleteAccount = vi.fn(async () => {});
    globalThis._updateSyncUI = vi.fn();

    await fb._handleDeleteAccount();

    expect(globalThis.fbDeleteAccount).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith('toast.accountDeleted', 'default');
    expect(globalThis._updateSyncUI).toHaveBeenCalledTimes(1);
    const btn = document.getElementById('sync-delete-account-btn');
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe('auth.deleteAccountPending');
  });

  it('toasts an error and resets the button when deletion fails', async () => {
    const { showToast } = installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    globalThis.fbIsSignedIn = vi.fn(() => true);
    globalThis._showDeleteAccountConfirm = vi.fn(async () => true);
    globalThis.fbDeleteAccount = vi.fn(async () => {
      throw new Error('CREDENTIAL_TOO_OLD_LOGIN_AGAIN');
    });
    globalThis._updateSyncUI = vi.fn();

    await fb._handleDeleteAccount();

    expect(globalThis.fbDeleteAccount).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith('auth.deleteAccountError', 'error');
    expect(globalThis._updateSyncUI).not.toHaveBeenCalled();
    const btn = document.getElementById('sync-delete-account-btn');
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('sidebar.sync.deleteAccount');
  });
});

let _fbInitLangchangeListeners = [];
let _origWindowAddEventListener = null;

function cleanupFbInitIntercepts() {
  for (const listener of _fbInitLangchangeListeners) {
    window.removeEventListener('lithium:langchange', listener);
  }
  _fbInitLangchangeListeners = [];
  if (_origWindowAddEventListener) {
    window.addEventListener = _origWindowAddEventListener;
    _origWindowAddEventListener = null;
  }

  delete globalThis._loadAuth;
  delete globalThis._loadRevState;
  delete globalThis._loadCloudSyncTs;
  delete globalThis._updateSyncUI;
  delete globalThis._bindSyncActionButtons;
  delete globalThis._showAuthMode;
  delete globalThis._showLoginOverlay;
  delete globalThis._updateVerifyEmailDisplay;
  delete globalThis._handleLogin;
  delete globalThis._handleSyncLoginClick;
  delete globalThis._closeDeleteAccountModal;
  delete globalThis.fbGetEmail;
  delete globalThis.fbRefreshEmailVerifiedStatus;
  delete globalThis.syncFromCloud;
  delete globalThis._pullAfterSignIn;
  delete globalThis.scheduleSyncToCloud;
  delete globalThis.fbSignOut;
  delete globalThis.showSigninNotice;
  delete window.showSigninNotice;
}

function installFbInitEventTracking() {
  _origWindowAddEventListener = window.addEventListener;
  window.addEventListener = vi.fn((type, listener, options) => {
    if (type === 'lithium:langchange') _fbInitLangchangeListeners.push(listener);
    return _origWindowAddEventListener.call(window, type, listener, options);
  });
}

describe('fbInit', () => {
  afterEach(() => {
    cleanupFbInitIntercepts();
  });

  function setupFbInit() {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    installFbInitEventTracking();

    const _loadAuth = vi.fn(async () => {});
    const _loadRevState = vi.fn(async () => {});
    const _loadCloudSyncTs = vi.fn(async () => {});
    const _updateSyncUI = vi.fn();
    const _bindSyncActionButtons = vi.fn();
    const _showAuthMode = vi.fn();
    const _showLoginOverlay = vi.fn();
    const _updateVerifyEmailDisplay = vi.fn();
    const _handleLogin = vi.fn();
    const _handleSyncLoginClick = vi.fn();
    const _closeDeleteAccountModal = vi.fn();
    const fbGetEmail = vi.fn(() => 'user@example.com');
    const fbRefreshEmailVerifiedStatus = vi.fn(async () => false);
    const syncFromCloud = vi.fn(async () => false);
    const _pullAfterSignIn = vi.fn(async () => {});
    const scheduleSyncToCloud = vi.fn();
    const fbSignOut = vi.fn(async () => {});
    const fbIsSignedIn = vi.fn(() => false);
    const fbIsEmailVerified = vi.fn(() => false);
    const showSigninNotice = vi.fn();

    globalThis._loadAuth = _loadAuth;
    globalThis._loadRevState = _loadRevState;
    globalThis._loadCloudSyncTs = _loadCloudSyncTs;
    globalThis._updateSyncUI = _updateSyncUI;
    globalThis._bindSyncActionButtons = _bindSyncActionButtons;
    globalThis._showAuthMode = _showAuthMode;
    globalThis._showLoginOverlay = _showLoginOverlay;
    globalThis._updateVerifyEmailDisplay = _updateVerifyEmailDisplay;
    globalThis._handleLogin = _handleLogin;
    globalThis._handleSyncLoginClick = _handleSyncLoginClick;
    globalThis._closeDeleteAccountModal = _closeDeleteAccountModal;
    globalThis.fbGetEmail = fbGetEmail;
    globalThis.fbRefreshEmailVerifiedStatus = fbRefreshEmailVerifiedStatus;
    globalThis.syncFromCloud = syncFromCloud;
    globalThis._pullAfterSignIn = _pullAfterSignIn;
    globalThis.scheduleSyncToCloud = scheduleSyncToCloud;
    globalThis.fbSignOut = fbSignOut;
    globalThis.fbIsSignedIn = fbIsSignedIn;
    globalThis.fbIsEmailVerified = fbIsEmailVerified;
    window.showSigninNotice = showSigninNotice;

    return { fb, _loadAuth, _loadRevState, _loadCloudSyncTs, _updateSyncUI, _bindSyncActionButtons, _showAuthMode, _showLoginOverlay, _updateVerifyEmailDisplay, _handleLogin, _handleSyncLoginClick, _closeDeleteAccountModal, fbGetEmail, fbRefreshEmailVerifiedStatus, syncFromCloud, _pullAfterSignIn, scheduleSyncToCloud, fbSignOut, fbIsSignedIn, fbIsEmailVerified, showSigninNotice };
  }

  it('shows signin notice and binds sync action buttons when not signed in', async () => {
    const { fb, _updateSyncUI, _bindSyncActionButtons, _pullAfterSignIn, showSigninNotice } = setupFbInit();

    await fb.fbInit();

    expect(showSigninNotice).toHaveBeenCalledTimes(1);
    expect(_updateSyncUI).toHaveBeenCalled();
    expect(_bindSyncActionButtons).toHaveBeenCalledTimes(1);
    expect(_pullAfterSignIn).not.toHaveBeenCalled();
  });

  it('switches to verify overlay when signed in but email is still not verified', async () => {
    const { fb, _updateSyncUI, _showAuthMode, _showLoginOverlay, _updateVerifyEmailDisplay, fbGetEmail, fbRefreshEmailVerifiedStatus, _pullAfterSignIn, showSigninNotice, fbIsSignedIn, fbIsEmailVerified } = setupFbInit();
    fbIsSignedIn.mockReturnValue(true);
    fbIsEmailVerified.mockReturnValue(false);

    await fb.fbInit();

    expect(fbRefreshEmailVerifiedStatus).toHaveBeenCalledTimes(1);
    expect(_updateSyncUI).toHaveBeenCalled();
    expect(_updateVerifyEmailDisplay).toHaveBeenCalledTimes(1);
    expect(_updateVerifyEmailDisplay).toHaveBeenCalledWith(fbGetEmail());
    expect(_showAuthMode).toHaveBeenCalledTimes(1);
    expect(_showAuthMode).toHaveBeenCalledWith('verify');
    expect(_showLoginOverlay).toHaveBeenCalledTimes(1);
    expect(_pullAfterSignIn).not.toHaveBeenCalled();
    expect(showSigninNotice).not.toHaveBeenCalled();
  });

  it('delegates the startup pull to _pullAfterSignIn and does not schedule an upload itself', async () => {
    const { fb, _pullAfterSignIn, syncFromCloud, scheduleSyncToCloud, fbIsSignedIn, fbIsEmailVerified } = setupFbInit();
    fbIsSignedIn.mockReturnValue(true);
    fbIsEmailVerified.mockReturnValue(true);

    await fb.fbInit();

    expect(_pullAfterSignIn).toHaveBeenCalledTimes(1);
    // fbInit must not talk to the sync layer directly anymore; the pull and
    // the "no cloud data → upload" fallback both live inside _pullAfterSignIn.
    expect(syncFromCloud).not.toHaveBeenCalled();
    expect(scheduleSyncToCloud).not.toHaveBeenCalled();
  });

  it('starts a non-forced startup pull (never forces cloud over local data)', async () => {
    const { fb, _pullAfterSignIn, fbIsSignedIn, fbIsEmailVerified } = setupFbInit();
    fbIsSignedIn.mockReturnValue(true);
    fbIsEmailVerified.mockReturnValue(true);

    await fb.fbInit();

    expect(_pullAfterSignIn).toHaveBeenCalledTimes(1);
    expect(_pullAfterSignIn).toHaveBeenCalledWith();
  });

  it('wires representative auth button event listeners', async () => {
    const { fb, _handleLogin, _handleSyncLoginClick, _closeDeleteAccountModal, _showAuthMode } = setupFbInit();

    // The fixture does not include the sidebar login trigger; add it so the
    // listener can bind without touching the shared fixture helper.
    const syncLoginBtn = document.createElement('button');
    syncLoginBtn.id = 'sync-login-btn';
    document.body.appendChild(syncLoginBtn);

    await fb.fbInit();

    document.getElementById('login-submit-btn').click();
    expect(_handleLogin).toHaveBeenCalledTimes(1);

    syncLoginBtn.click();
    expect(_handleSyncLoginClick).toHaveBeenCalledTimes(1);

    document.getElementById('delete-account-cancel').click();
    expect(_closeDeleteAccountModal).toHaveBeenCalledTimes(1);
    expect(_closeDeleteAccountModal).toHaveBeenCalledWith(false);

    const loginTab = document.querySelector('.auth-tab[data-mode="login"]');
    loginTab.click();
    expect(_showAuthMode).toHaveBeenCalledWith('login');
  });

  it('re-renders dynamic text on lithium:langchange', async () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    mountAuthDom();
    installFbInitEventTracking();

    // Drive the closure-private _pendingVerifyEmail through its public setter.
    fb._updateVerifyEmailDisplay('x@y.com');
    expect(document.getElementById('verify-email-target').textContent).toBe('x@y.com');

    const _updateSyncUI = vi.fn();
    globalThis._updateSyncUI = _updateSyncUI;
    globalThis._loadAuth = vi.fn(async () => {});
    globalThis._loadRevState = vi.fn(async () => {});
    globalThis._loadCloudSyncTs = vi.fn(async () => {});
    globalThis._bindSyncActionButtons = vi.fn();
    globalThis._showAuthMode = vi.fn();
    globalThis._showLoginOverlay = vi.fn();
    globalThis._handleLogin = vi.fn();
    globalThis._handleSyncLoginClick = vi.fn();
    globalThis._closeDeleteAccountModal = vi.fn();
    globalThis.fbRefreshEmailVerifiedStatus = vi.fn(async () => false);
    globalThis.syncFromCloud = vi.fn(async () => true);
    globalThis._pullAfterSignIn = vi.fn(async () => {});
    globalThis.scheduleSyncToCloud = vi.fn();
    globalThis.fbSignOut = vi.fn(async () => {});
    globalThis.fbIsSignedIn = vi.fn(() => true);
    globalThis.fbIsEmailVerified = vi.fn(() => true);
    globalThis.fbGetEmail = vi.fn(() => 'user@example.com');
    window.showSigninNotice = vi.fn();

    await fb.fbInit();
    _updateSyncUI.mockClear();

    window.dispatchEvent(new Event('lithium:langchange'));

    expect(_updateSyncUI).toHaveBeenCalledTimes(1);
    expect(document.getElementById('verify-email-target').textContent).toBe('x@y.com');
  });
});
