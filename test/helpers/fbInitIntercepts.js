import { vi } from 'vitest';

// Shared by every test that calls the real fbInit(): it registers window and
// document listeners with no cleanup and installs the default onSyncConflict hook, both
// of which would otherwise leak into later tests.
let _fbInitLangchangeListeners = [];
let _origWindowAddEventListener = null;
let _fbInitDocumentListeners = [];
let _origDocumentAddEventListener = null;

export function cleanupFbInitIntercepts() {
  for (const listener of _fbInitLangchangeListeners) {
    window.removeEventListener('lithium:langchange', listener);
  }
  _fbInitLangchangeListeners = [];
  if (_origWindowAddEventListener) {
    window.addEventListener = _origWindowAddEventListener;
    _origWindowAddEventListener = null;
  }
  // Document listeners (fbInit's Escape dispatcher, or app.js's handlers when a
  // test also loads it) close over that module load's state; a leaked one
  // would act on the next test's DOM.
  for (const [type, listener, options] of _fbInitDocumentListeners) {
    document.removeEventListener(type, listener, options);
  }
  _fbInitDocumentListeners = [];
  if (_origDocumentAddEventListener) {
    document.addEventListener = _origDocumentAddEventListener;
    _origDocumentAddEventListener = null;
  }

  delete globalThis._loadAuth;
  delete globalThis._loadRevState;
  delete globalThis._loadCloudBaseline;
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
  delete globalThis.fbIsSignedIn;
  delete globalThis.fbIsEmailVerified;
  delete globalThis.onSyncConflict;
  delete globalThis.fbGetSyncConflict;
  delete globalThis.showSigninNotice;
  delete window.showSigninNotice;
}

export function installFbInitEventTracking() {
  _origWindowAddEventListener = window.addEventListener;
  window.addEventListener = vi.fn((type, listener, options) => {
    if (type === 'lithium:langchange') _fbInitLangchangeListeners.push(listener);
    return _origWindowAddEventListener.call(window, type, listener, options);
  });
  _origDocumentAddEventListener = document.addEventListener;
  document.addEventListener = vi.fn((type, listener, options) => {
    _fbInitDocumentListeners.push([type, listener, options]);
    return _origDocumentAddEventListener.call(document, type, listener, options);
  });
}
