import { describe, it, expect, afterEach, vi } from 'vitest';
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
