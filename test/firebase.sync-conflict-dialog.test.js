import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadFirebaseModule } from './helpers/loadFirebaseModule.js';
import { mountAuthDom } from './helpers/authDomFixture.js';
import { installUiMocks } from './helpers/uiMocks.js';
import { jsonResponse } from './helpers/mockFetch.js';
import {
  setupSignedInFirebase, firestoreGetRoute, firestorePatchRoute, TEST_UID,
} from './helpers/setupSignedInFirebase.js';
import { loadAppModule } from './helpers/loadAppModule.js';
import { installAppDomFixture } from './helpers/appDomFixture.js';
import { cleanupFbInitIntercepts, installFbInitEventTracking } from './helpers/fbInitIntercepts.js';

const INFO = {
  isAccountSwitch: false,
  localShortcutCount: 36,
  localFolderCount: 4,
  cloudShortcutCount: 12,
  cloudFolderCount: 2,
  localEditTime: new Date(2026, 0, 5, 9, 7).getTime(),
  cloudUpdateTime: new Date(2026, 9, 18, 21, 30).getTime(),
  trigger: 'sign-in',
};

// Local state with `shortcuts` links at the top level and `folders` empty
// folders: the dialog recounts the local side from `items` on every render (D4).
function localItems(shortcuts, folders) {
  const list = [];
  for (let i = 0; i < shortcuts; i += 1) list.push({ id: `s${i}`, type: 'link' });
  for (let i = 0; i < folders; i += 1) list.push({ id: `f${i}`, type: 'folder', children: [] });
  return list;
}

// The free variables _buildSyncSnapshot / the local recount read (app.js
// owns them in production).
function installSyncGlobals() {
  globalThis.items = localItems(INFO.localShortcutCount, INFO.localFolderCount);
  globalThis.customEngines = [];
  globalThis.selectedEngineId = 'google';
  globalThis.clocks = [];
  globalThis.mainGridColumns = 4;
}

function deleteSyncGlobals() {
  for (const k of ['items', 'customEngines', 'selectedEngineId', 'clocks', 'mainGridColumns']) {
    delete globalThis[k];
  }
}

function setup() {
  const mocks = installUiMocks();
  const fb = loadFirebaseModule();
  mountAuthDom();
  installSyncGlobals();
  globalThis.fbGetEmail = vi.fn(() => 'user@example.com');
  globalThis.fbGetSyncConflict = vi.fn(() => ({ ...INFO }));
  return { fb, ...mocks };
}

const $ = (id) => document.getElementById(id);
const field = (side, name) => $(`sync-conflict-${side}`).querySelector(`[data-field=${name}]`);

afterEach(() => {
  cleanupFbInitIntercepts();
  delete globalThis.onSyncConflict;
  delete globalThis.fbGetEmail;
  delete globalThis.fbGetSyncConflict;
  delete globalThis.fbResolveSyncConflict;
  delete globalThis.fbIsSignedIn;
  delete globalThis.fbSignOut;
  deleteSyncGlobals();
  document.body.innerHTML = '';
});

describe('_formatConflictTime', () => {
  it('formats as zero-padded month-day HH:MM through the dictionary template', () => {
    const { fb, t } = setup();
    fb._formatConflictTime(new Date(2026, 0, 5, 9, 7).getTime());
    expect(t).toHaveBeenCalledWith('dialog.syncConflict.timeFormat', { month: '01', day: '05', time: '09:07' });
  });

  it.each([0, NaN, undefined])('returns the unknown label for %s', (v) => {
    const { fb } = setup();
    expect(fb._formatConflictTime(v)).toBe('dialog.syncConflict.unknownTime');
  });
});

describe('_renderSyncConflictDialog', () => {
  it('renders the same-account variant', () => {
    const { fb, t } = setup();
    fb._renderSyncConflictDialog({ ...INFO, isAccountSwitch: false });
    expect($('sync-conflict-text').textContent).toBe('dialog.syncConflict.text');
    expect($('sync-conflict-account-warn').classList.contains('hidden')).toBe(true);
    expect(field('cloud', 'label').textContent).toBe('dialog.syncConflict.cloudLabel');
    expect(field('local', 'label').textContent).toBe('dialog.syncConflict.localLabel');
    expect(field('local', 'timeLabel').textContent).toBe('dialog.syncConflict.localTimeLabel');
    expect(field('cloud', 'timeLabel').textContent).toBe('dialog.syncConflict.cloudTimeLabel');
    expect(t).toHaveBeenCalledWith('dialog.syncConflict.shortcuts', { count: 36 });
    expect(t).toHaveBeenCalledWith('dialog.syncConflict.folders', { count: 4 });
    expect(t).toHaveBeenCalledWith('dialog.syncConflict.shortcuts', { count: 12 });
    expect(t).toHaveBeenCalledWith('dialog.syncConflict.folders', { count: 2 });
  });

  it('renders the account-switch variant with the current email', () => {
    const { fb, t } = setup();
    fb._renderSyncConflictDialog({ ...INFO, isAccountSwitch: true });
    expect($('sync-conflict-text').textContent).toBe('dialog.syncConflict.textSwitch');
    expect($('sync-conflict-account-warn').classList.contains('hidden')).toBe(false);
    expect(t).toHaveBeenCalledWith('dialog.syncConflict.accountWarn', { email: 'user@example.com' });
    expect(field('cloud', 'label').textContent).toBe('dialog.syncConflict.cloudLabelCurrent');
  });

  it('falls back to the no-email warning when the email is missing', () => {
    const { fb, t } = setup();
    globalThis.fbGetEmail = vi.fn(() => null);
    fb._renderSyncConflictDialog({ ...INFO, isAccountSwitch: true });
    expect($('sync-conflict-account-warn').textContent).toBe('dialog.syncConflict.accountWarnNoEmail');
    expect(t).not.toHaveBeenCalledWith('dialog.syncConflict.accountWarn', expect.anything());
  });

  it('shows the sign-out row only on account switch', () => {
    const { fb } = setup();
    fb._renderSyncConflictDialog({ ...INFO, isAccountSwitch: false });
    expect($('sync-conflict-signout-row').classList.contains('hidden')).toBe(true);
    fb._renderSyncConflictDialog({ ...INFO, isAccountSwitch: true });
    expect($('sync-conflict-signout-row').classList.contains('hidden')).toBe(false);
  });

  it.each(['not-found', 'empty'])('explains a cloud that was deleted or emptied (cloudState %s)', (cloudState) => {
    const { fb } = setup();
    fb._renderSyncConflictDialog({ ...INFO, cloudState, cloudShortcutCount: 0, cloudFolderCount: 0 });
    // Replaces the overwrite wording instead of contradicting it.
    expect($('sync-conflict-text').textContent).toBe('dialog.syncConflict.cloudAbsent');
  });

  it('cloud-absent replaces the account-switch text too', () => {
    const { fb } = setup();
    fb._renderSyncConflictDialog({ ...INFO, isAccountSwitch: true, cloudState: 'not-found' });
    expect($('sync-conflict-text').textContent).toBe('dialog.syncConflict.cloudAbsent');
  });

  it('does not show the cloud-absent hint for a document cloud, nor after the cloud comes back', () => {
    const { fb } = setup();
    fb._renderSyncConflictDialog({ ...INFO, cloudState: 'doc' });
    expect($('sync-conflict-text').textContent).toBe('dialog.syncConflict.text');
    fb._renderSyncConflictDialog({ ...INFO, cloudState: 'not-found' });
    fb._renderSyncConflictDialog({ ...INFO, cloudState: 'doc' });
    expect($('sync-conflict-text').textContent).toBe('dialog.syncConflict.text');
  });

  it('shows the unknown label when a time is 0', () => {
    const { fb } = setup();
    // The local time comes from the module's last-edit time (0 in a fresh load).
    fb._renderSyncConflictDialog({ ...INFO });
    expect(field('local', 'time').textContent).toBe('dialog.syncConflict.unknownTime');
    fb._renderSyncConflictDialog({ ...INFO, cloudUpdateTime: 0 });
    expect(field('cloud', 'time').textContent).toBe('dialog.syncConflict.unknownTime');
  });
});

describe('_openSyncConflictDialog', () => {
  it('open twice re-renders a single overlay', () => {
    const { fb, t } = setup();
    fb._openSyncConflictDialog({ ...INFO, cloudShortcutCount: 12 });
    fb._openSyncConflictDialog({ ...INFO, cloudShortcutCount: 7 });
    expect(document.querySelectorAll('#sync-conflict-overlay').length).toBe(1);
    expect($('sync-conflict-overlay').classList.contains('hidden')).toBe(false);
    const lastShortcuts = t.mock.calls.filter(c => c[0] === 'dialog.syncConflict.shortcuts' && c[1].count !== 36);
    expect(lastShortcuts[lastShortcuts.length - 1][1]).toEqual({ count: 7 });
  });

  it('focuses the use-local button and clears a stale error on open', () => {
    const { fb } = setup();
    $('sync-conflict-error').textContent = 'old';
    $('sync-conflict-error').classList.remove('hidden');
    $('sync-conflict-use-local').disabled = true;
    $('sync-conflict-use-cloud').disabled = true;
    fb._openSyncConflictDialog({ ...INFO });
    expect(document.activeElement.id).toBe('sync-conflict-use-local');
    expect($('sync-conflict-error').classList.contains('hidden')).toBe(true);
    expect($('sync-conflict-error').textContent).toBe('');
    expect($('sync-conflict-use-local').disabled).toBe(false);
    expect($('sync-conflict-use-cloud').disabled).toBe(false);
  });

  it('close hides the overlay', () => {
    const { fb } = setup();
    fb._openSyncConflictDialog({ ...INFO });
    fb._closeSyncConflictDialog();
    expect($('sync-conflict-overlay').classList.contains('hidden')).toBe(true);
  });
});

describe('closes when pending cleared', () => {
  it('_updateSyncUI hides an open dialog once no conflict is pending', () => {
    const { fb } = setup();
    fb._openSyncConflictDialog({ ...INFO });
    globalThis.fbGetSyncConflict = vi.fn(() => null);
    fb._updateSyncUI();
    expect($('sync-conflict-overlay').classList.contains('hidden')).toBe(true);
  });

  it('closes even when the sidebar status element is absent', () => {
    const { fb } = setup();
    fb._openSyncConflictDialog({ ...INFO });
    globalThis.fbGetSyncConflict = vi.fn(() => null);
    $('sync-status-text').remove();
    fb._updateSyncUI();
    expect($('sync-conflict-overlay').classList.contains('hidden')).toBe(true);
  });

  it('leaves the dialog open while the conflict is still pending', () => {
    const { fb } = setup();
    fb._openSyncConflictDialog({ ...INFO });
    fb._updateSyncUI();
    expect($('sync-conflict-overlay').classList.contains('hidden')).toBe(false);
  });
});

describe('re-renders on langchange', () => {
  it('re-renders with the remembered info while open', () => {
    const { fb, t } = setup();
    fb._openSyncConflictDialog({ ...INFO });
    t.mockClear();
    fb._refreshSyncConflictDialogOnLangChange();
    expect(t).toHaveBeenCalledWith('dialog.syncConflict.text');
  });

  it('re-renders the inline error line in the new language', () => {
    const { fb, t } = setup();
    fb._openSyncConflictDialog({ ...INFO });
    fb._setConflictError('network');
    expect($('sync-conflict-error').textContent).toBe('toast.syncNetworkFailed');
    $('sync-conflict-error').textContent = 'stale-language text';
    t.mockClear();
    fb._refreshSyncConflictDialogOnLangChange();
    expect(t).toHaveBeenCalledWith('toast.syncNetworkFailed');
    expect($('sync-conflict-error').textContent).toBe('toast.syncNetworkFailed');
  });

  it('re-renders an inline cloud-changed error in the new language', () => {
    const { fb, t } = setup();
    fb._openSyncConflictDialog({ ...INFO });
    fb._setConflictError('cloud-changed');
    expect($('sync-conflict-error').textContent).toBe('dialog.syncConflict.cloudChanged');
    $('sync-conflict-error').textContent = 'stale-language text';
    t.mockClear();
    fb._refreshSyncConflictDialogOnLangChange();
    expect(t).toHaveBeenCalledWith('dialog.syncConflict.cloudChanged');
    expect($('sync-conflict-error').textContent).toBe('dialog.syncConflict.cloudChanged');
  });

  it('re-renders the cloud-absent hint in the new language', () => {
    const { fb, t } = setup();
    fb._openSyncConflictDialog({ ...INFO, cloudState: 'not-found' });
    $('sync-conflict-text').textContent = 'stale-language text';
    t.mockClear();
    window.dispatchEvent(new Event('lithium:langchange'));
    fb._refreshSyncConflictDialogOnLangChange();
    expect(t).toHaveBeenCalledWith('dialog.syncConflict.cloudAbsent');
    expect($('sync-conflict-text').textContent).toBe('dialog.syncConflict.cloudAbsent');
  });

  it('does not resurrect an error after close or re-open', () => {
    const { fb } = setup();
    fb._openSyncConflictDialog({ ...INFO });
    fb._setConflictError('network');
    fb._closeSyncConflictDialog();
    fb._openSyncConflictDialog({ ...INFO });
    fb._refreshSyncConflictDialogOnLangChange();
    expect($('sync-conflict-error').textContent).toBe('');
    expect($('sync-conflict-error').classList.contains('hidden')).toBe(true);
  });

  it('does nothing while closed', () => {
    const { fb, t } = setup();
    fb._openSyncConflictDialog({ ...INFO });
    fb._closeSyncConflictDialog();
    t.mockClear();
    fb._refreshSyncConflictDialogOnLangChange();
    expect(t).not.toHaveBeenCalledWith('dialog.syncConflict.text');
  });
});

describe('fbInit integration', () => {
  function stubInitDeps() {
    installFbInitEventTracking();
    globalThis._loadAuth = vi.fn(async () => {});
    globalThis._loadRevState = vi.fn(async () => {});
    globalThis._loadCloudBaseline = vi.fn(async () => {});
    globalThis._bindSyncActionButtons = vi.fn();
    globalThis.fbIsSignedIn = vi.fn(() => false);
    window.showSigninNotice = vi.fn();
  }

  it('installs _openSyncConflictDialog as the onSyncConflict hook', async () => {
    const { fb } = setup();
    stubInitDeps();
    expect(globalThis.onSyncConflict).toBeUndefined();
    await fb.fbInit();
    expect(globalThis.onSyncConflict).toBe(fb._openSyncConflictDialog);
  });

  it('does not overwrite a preexisting hook', async () => {
    const { fb } = setup();
    stubInitDeps();
    const preset = vi.fn();
    globalThis.onSyncConflict = preset;
    await fb.fbInit();
    expect(globalThis.onSyncConflict).toBe(preset);
  });

  it('re-renders an open dialog when lithium:langchange fires', async () => {
    const { fb, t } = setup();
    stubInitDeps();
    await fb.fbInit();
    fb._openSyncConflictDialog({ ...INFO });
    t.mockClear();
    window.dispatchEvent(new Event('lithium:langchange'));
    expect(t).toHaveBeenCalledWith('dialog.syncConflict.text');
  });
});

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

describe('_syncErrorToastKey', () => {
  it.each([
    ['auth', 'toast.syncAuthFailed'],
    ['network', 'toast.syncNetworkFailed'],
    ['quota', 'toast.syncQuotaFailed'],
    ['payload-too-large', 'toast.syncPayloadTooLarge'],
    ['storage-read-only', 'toast.syncStorageReadOnly'],
    ['storage-unavailable', 'toast.syncStorageUnavailable'],
    ['baseline-cleared', 'toast.syncBaselineCleared'],
    ['retry-exhausted', 'toast.syncRetryExhausted'],
    ['cloud-changed', 'toast.syncFailed'],
    ['firestore', 'toast.syncFailed'],
    [undefined, 'toast.syncFailed'],
  ])('maps %s to %s', (code, key) => {
    const { fb } = setup();
    expect(fb._syncErrorToastKey(code)).toBe(key);
  });
});

describe('_conflictErrorKey', () => {
  it.each([
    ['cloud-changed', 'dialog.syncConflict.cloudChanged'],
    ['payload-too-large', 'dialog.syncConflict.payloadTooLarge'],
    ['retry-exhausted', 'toast.syncRetryExhausted'],
    ['storage-unavailable', 'toast.syncStorageUnavailable'],
    ['baseline-cleared', 'toast.syncBaselineCleared'],
    ['storage-read-only', 'toast.syncStorageReadOnly'],
    ['network', 'toast.syncNetworkFailed'],
    ['auth', 'toast.syncAuthFailed'],
    ['quota', 'toast.syncQuotaFailed'],
    ['firestore', 'toast.syncFailed'],
    [undefined, 'toast.syncFailed'],
  ])('maps %s to %s', (code, key) => {
    const { fb } = setup();
    expect(fb._conflictErrorKey(code)).toBe(key);
  });
});

describe('_handleConflictChoice', () => {
  // Opens the dialog with the conflict pending; `pendingAfter` is what
  // fbGetSyncConflict() reports once the resolve settled.
  function arrange(result, { pendingAfter = false, signedIn = true } = {}) {
    const ctx = setup();
    globalThis.fbIsSignedIn = vi.fn(() => signedIn);
    globalThis.fbResolveSyncConflict = vi.fn(async () => {
      globalThis.fbGetSyncConflict = vi.fn(() => (pendingAfter ? { ...INFO } : null));
      if (result instanceof Error) throw result;
      return result;
    });
    ctx.fb._openSyncConflictDialog({ ...INFO });
    ctx.updateSpy = vi.fn();
    globalThis._updateSyncUI = ctx.updateSpy;
    return ctx;
  }
  const hidden = () => $('sync-conflict-overlay').classList.contains('hidden');

  afterEach(() => { delete globalThis._updateSyncUI; });

  it('local success closes and toasts uploaded', async () => {
    const { fb, showToast, updateSpy } = arrange({ ok: true });
    await fb._handleConflictChoice('local');
    expect(globalThis.fbResolveSyncConflict).toHaveBeenCalledWith('local');
    expect(hidden()).toBe(true);
    expect(showToast).toHaveBeenCalledWith('toast.syncUploaded', 'default');
    expect(updateSpy).toHaveBeenCalled();
  });

  it('cloud success closes and toasts downloaded', async () => {
    const { fb, showToast } = arrange({ ok: true });
    await fb._handleConflictChoice('cloud');
    expect(hidden()).toBe(true);
    expect(showToast).toHaveBeenCalledWith('toast.syncDownloaded', 'default');
  });

  it('no-cloud-data closes and toasts the cloud-gone notice', async () => {
    const { fb, showToast } = arrange({ ok: true, code: 'no-cloud-data' });
    await fb._handleConflictChoice('cloud');
    expect(hidden()).toBe(true);
    expect(showToast).toHaveBeenCalledWith('toast.syncConflictCloudGone', 'default');
  });

  it('no-conflict closes silently', async () => {
    const { fb, showToast, updateSpy } = arrange({ ok: false, code: 'no-conflict' });
    await fb._handleConflictChoice('local');
    expect(hidden()).toBe(true);
    expect(showToast).not.toHaveBeenCalled();
    expect(updateSpy).toHaveBeenCalled();
  });

  it.each(['storage-read-only', 'session-changed', 'not-signed-in'])(
    'signed out mid-resolve (%s) closes silently', async (code) => {
      const { fb, showToast } = arrange({ ok: false, code }, { pendingAfter: true, signedIn: false });
      await fb._handleConflictChoice('local');
      expect(hidden()).toBe(true);
      expect(showToast).not.toHaveBeenCalled();
    });

  it('local failure with the conflict still pending keeps the dialog open with an inline error', async () => {
    const { fb, showToast, updateSpy } = arrange({ ok: false, code: 'network' }, { pendingAfter: true });
    await fb._handleConflictChoice('local');
    expect(hidden()).toBe(false);
    expect($('sync-conflict-error').classList.contains('hidden')).toBe(false);
    expect($('sync-conflict-error').textContent).toBe('toast.syncNetworkFailed');
    expect($('sync-conflict-use-local').disabled).toBe(false);
    expect($('sync-conflict-use-cloud').disabled).toBe(false);
    expect($('sync-conflict-signout').disabled).toBe(false);
    // (I1) the defer link comes back too: the controls are recomputed after
    // the resolving flag was cleared, not re-enabled while it is still set.
    expect($('sync-conflict-defer').disabled).toBe(false);
    expect(showToast).not.toHaveBeenCalled();
    expect(updateSpy).toHaveBeenCalled();
  });

  // payload-too-large is left out on purpose: its inline handling depends on
  // the size recheck (D6) and is covered separately (stage 3).
  it.each([
    ['cloud-changed', 'dialog.syncConflict.cloudChanged'],
    ['retry-exhausted', 'toast.syncRetryExhausted'],
    ['storage-unavailable', 'toast.syncStorageUnavailable'],
    ['baseline-cleared', 'toast.syncBaselineCleared'],
    ['storage-read-only', 'toast.syncStorageReadOnly'],
  ])('choose-local code %s shows %s inline and keeps the dialog open', async (code, key) => {
    const { fb, showToast } = arrange({ ok: false, code }, { pendingAfter: true });
    await fb._handleConflictChoice('local');
    expect(hidden()).toBe(false);
    expect($('sync-conflict-error').textContent).toBe(key);
    expect($('sync-conflict-error').classList.contains('hidden')).toBe(false);
    expect($('sync-conflict-use-local').disabled).toBe(false);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('session-changed closes silently even while a conflict is still reported and the user is signed in', async () => {
    const { fb, showToast } = arrange({ ok: false, code: 'session-changed' }, { pendingAfter: true });
    await fb._handleConflictChoice('local');
    expect(hidden()).toBe(true);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('cloud-empty import failure (pending already cleared) closes with a plain error toast', async () => {
    const { fb, showToast } = arrange({ ok: false, code: 'network' });
    await fb._handleConflictChoice('cloud');
    expect(hidden()).toBe(true);
    expect(showToast).toHaveBeenCalledWith('toast.syncNetworkFailed', 'error');
  });

  it('cloud-empty import hitting the size limit toasts the generic size message, not the dialog text', async () => {
    const { fb, showToast } = arrange({ ok: false, code: 'payload-too-large' });
    await fb._handleConflictChoice('cloud');
    expect(hidden()).toBe(true);
    expect(showToast).toHaveBeenCalledWith('toast.syncPayloadTooLarge', 'error');
  });

  it('cloud failure with the conflict cleared closes with a plain error toast', async () => {
    const { fb, showToast } = arrange({ ok: false, code: 'network' });
    await fb._handleConflictChoice('cloud');
    expect(hidden()).toBe(true);
    expect(showToast).toHaveBeenCalledWith('toast.syncNetworkFailed', 'error');
  });

  it('still pending on failure keeps the dialog open with an inline error', async () => {
    const { fb, showToast, updateSpy } = arrange({ ok: false, code: 'network' }, { pendingAfter: true });
    await fb._handleConflictChoice('cloud');
    expect(hidden()).toBe(false);
    expect($('sync-conflict-error').classList.contains('hidden')).toBe(false);
    expect($('sync-conflict-error').textContent).toBe('toast.syncNetworkFailed');
    expect($('sync-conflict-use-local').disabled).toBe(false);
    expect($('sync-conflict-use-cloud').disabled).toBe(false);
    expect(showToast).not.toHaveBeenCalled();
    expect(updateSpy).toHaveBeenCalled();
  });

  it('a throwing resolve is treated as a firestore failure', async () => {
    const { fb } = arrange(new Error('boom'), { pendingAfter: true });
    await fb._handleConflictChoice('local');
    expect($('sync-conflict-error').textContent).toBe('toast.syncFailed');
    expect($('sync-conflict-use-local').disabled).toBe(false);
  });

  it('double click resolves once and keeps controls disabled while pending', async () => {
    const { fb } = arrange({ ok: true });
    const d = deferred();
    globalThis.fbResolveSyncConflict = vi.fn(() => d.promise);
    const p1 = fb._handleConflictChoice('cloud');
    const p2 = fb._handleConflictChoice('cloud');
    expect(globalThis.fbResolveSyncConflict).toHaveBeenCalledTimes(1);
    expect($('sync-conflict-use-local').disabled).toBe(true);
    expect($('sync-conflict-use-cloud').disabled).toBe(true);
    expect($('sync-conflict-signout').disabled).toBe(true);
    // A late notification must not re-enable anything while resolving.
    fb._openSyncConflictDialog({ ...INFO });
    expect($('sync-conflict-use-local').disabled).toBe(true);
    expect($('sync-conflict-use-cloud').disabled).toBe(true);
    expect($('sync-conflict-signout').disabled).toBe(true);
    globalThis.fbGetSyncConflict = vi.fn(() => null);
    d.resolve({ ok: true });
    await Promise.all([p1, p2]);
    expect(globalThis.fbResolveSyncConflict).toHaveBeenCalledTimes(1);
  });

  it('a notification during a resolve refreshes the cloud counts but leaves the controls disabled (spec §10.3)', async () => {
    const { fb, t } = arrange({ ok: true });
    const d = deferred();
    globalThis.fbResolveSyncConflict = vi.fn(() => d.promise);
    const p = fb._handleConflictChoice('local');
    t.mockClear();
    fb._openSyncConflictDialog({ ...INFO, cloudShortcutCount: 99, cloudFolderCount: 5 });
    expect(t).toHaveBeenCalledWith('dialog.syncConflict.shortcuts', { count: 99 });
    expect(t).toHaveBeenCalledWith('dialog.syncConflict.folders', { count: 5 });
    expect($('sync-conflict-use-local').disabled).toBe(true);
    expect($('sync-conflict-use-cloud').disabled).toBe(true);
    globalThis.fbGetSyncConflict = vi.fn(() => null);
    d.resolve({ ok: true });
    await p;
  });

  it('clears the resolving flag after the dialog was closed mid-resolve', async () => {
    const { fb } = arrange({ ok: true });
    await fb._handleConflictChoice('local');
    globalThis.fbGetSyncConflict = vi.fn(() => ({ ...INFO }));
    fb._openSyncConflictDialog({ ...INFO });
    expect($('sync-conflict-use-local').disabled).toBe(false);
    expect($('sync-conflict-use-cloud').disabled).toBe(false);
    expect($('sync-conflict-signout').disabled).toBe(false);
    expect(document.activeElement.id).toBe('sync-conflict-use-local');
  });

  it('clears the resolving flag when resolve throws', async () => {
    const { fb } = arrange(new Error('boom'), { pendingAfter: true });
    await fb._handleConflictChoice('local');
    fb._openSyncConflictDialog({ ...INFO });
    expect($('sync-conflict-use-cloud').disabled).toBe(false);
  });
});

describe('conflict dialog button wiring (real fbInit)', () => {
  async function init(fb) {
    installFbInitEventTracking();
    globalThis._loadAuth = vi.fn(async () => {});
    globalThis._loadRevState = vi.fn(async () => {});
    globalThis._loadCloudBaseline = vi.fn(async () => {});
    globalThis._bindSyncActionButtons = vi.fn();
    globalThis.fbIsSignedIn = vi.fn(() => true);
    window.showSigninNotice = vi.fn();
    await fb.fbInit();
  }

  it('choice buttons call fbResolveSyncConflict with their side', async () => {
    const { fb } = setup();
    await init(fb);
    globalThis.fbResolveSyncConflict = vi.fn(async () => ({ ok: false, code: 'no-conflict' }));
    $('sync-conflict-use-local').click();
    await Promise.resolve();
    expect(globalThis.fbResolveSyncConflict).toHaveBeenLastCalledWith('local');
    await vi.waitFor(() => expect($('sync-conflict-overlay').classList.contains('hidden')).toBe(true));
    fb._openSyncConflictDialog({ ...INFO });
    $('sync-conflict-use-cloud').click();
    expect(globalThis.fbResolveSyncConflict).toHaveBeenLastCalledWith('cloud');
  });

  it('sign-out link calls fbSignOut once', async () => {
    const { fb } = setup();
    await init(fb);
    globalThis.fbSignOut = vi.fn(async () => {});
    $('sync-conflict-signout').click();
    expect(globalThis.fbSignOut).toHaveBeenCalledTimes(1);
  });

  it('sign-out link is inert while a choice is resolving', async () => {
    const { fb } = setup();
    await init(fb);
    const d = deferred();
    globalThis.fbResolveSyncConflict = vi.fn(() => d.promise);
    globalThis.fbSignOut = vi.fn(async () => {});
    $('sync-conflict-use-local').click();
    expect($('sync-conflict-signout').disabled).toBe(true);
    $('sync-conflict-signout').click();
    expect(globalThis.fbSignOut).not.toHaveBeenCalled();
    d.resolve({ ok: false, code: 'no-conflict' });
  });

  it('double click on sign-out calls fbSignOut once and re-enables afterwards', async () => {
    const { fb } = setup();
    await init(fb);
    const d = deferred();
    globalThis.fbSignOut = vi.fn(() => d.promise);
    $('sync-conflict-signout').click();
    expect($('sync-conflict-signout').disabled).toBe(true);
    $('sync-conflict-signout').click(); // disabled buttons ignore click()
    expect(globalThis.fbSignOut).toHaveBeenCalledTimes(1);
    d.resolve();
    await vi.waitFor(() => expect($('sync-conflict-signout').disabled).toBe(false));
  });

  it('a failing sign-out toasts, re-enables the link and does not throw', async () => {
    const { fb, showToast } = setup();
    await init(fb);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    globalThis.fbSignOut = vi.fn(async () => { throw new Error('boom'); });
    $('sync-conflict-signout').click();
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledWith('toast.syncFailed', 'error'));
    expect($('sync-conflict-signout').disabled).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('real sign-out from the conflict dialog', () => {
  afterEach(() => {
    delete globalThis.chrome;
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
    delete globalThis.isStorageLoadFailed;
    delete globalThis.t;
    delete globalThis.showToast;
  });

  it('closes the dialog, clears the pending conflict and leaves local data and counters untouched', async () => {
    installUiMocks();
    const fb = loadFirebaseModule();
    const cloudFields = {
      items: fb._toFV(JSON.stringify([{ id: 'cloud' }])),
      engines: fb._toFV(JSON.stringify([])),
      selected_engine: fb._toFV('google'),
      clocks: fb._toFV(JSON.stringify([])),
      grid_columns: fb._toFV(4),
    };
    const { storage } = await setupSignedInFirebase(fb, {
      extraRoutes: [firestoreGetRoute(async () => jsonResponse(200, {
        updateTime: '2024-06-02T00:00:00.000000000Z', fields: cloudFields,
      }))],
    });
    // setupSignedInFirebase replaces the body; mount the dialog DOM afterwards.
    mountAuthDom();
    // fbInit is not run here, so wire the hook and the buttons by hand.
    globalThis.onSyncConflict = fb._openSyncConflictDialog;
    fb._bindSyncConflictButtons();

    const localItems = [{ id: 'local-only' }];
    globalThis.items = localItems;
    await fb.markLocalCloudDataChanged();
    await fb.syncFromCloud();
    expect(fb.fbGetSyncConflict()).not.toBeNull();
    expect($('sync-conflict-overlay').classList.contains('hidden')).toBe(false);

    const before = { rev: storage._data._fb_edit_rev, ts: storage._data._fb_local_edit_ts };
    expect(before.ts).toBeGreaterThan(0);

    // Reveal the sign-out link (account-switch variant only) and click it.
    $('sync-conflict-signout-row').classList.remove('hidden');
    $('sync-conflict-signout').click();
    await vi.waitFor(() => expect($('sync-conflict-overlay').classList.contains('hidden')).toBe(true));

    expect(fb.fbGetSyncConflict()).toBeNull();
    expect(globalThis.items).toBe(localItems);
    expect(globalThis.items).toEqual([{ id: 'local-only' }]);
    expect(storage._data._fb_edit_rev).toBe(before.rev);
    expect(storage._data._fb_local_edit_ts).toBe(before.ts);
  });
});

// ── Stage 2: "Decide later" (defer), Escape, local recount ───────────────
const isHidden = (id) => $(id).classList.contains('hidden');
const pressEscape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

// fbInit with its storage/auth dependencies stubbed: installs the hook, the
// button bindings and the document-level Escape dispatcher.
async function initStubbed(fb, { signedIn = true } = {}) {
  installFbInitEventTracking();
  globalThis._loadAuth = vi.fn(async () => {});
  globalThis._loadRevState = vi.fn(async () => {});
  globalThis._loadCloudBaseline = vi.fn(async () => {});
  globalThis._bindSyncActionButtons = vi.fn();
  globalThis.fbIsSignedIn = vi.fn(() => signedIn);
  window.showSigninNotice = vi.fn();
  await fb.fbInit();
}

const CLOUD_UPDATE_TIME = '2024-06-02T00:00:00.000000000Z';

// Real module, signed in, local dirty, cloud different: the real fbInit's
// startup pull records the conflict and opens the dialog through the default
// hook. Every PATCH is recorded (none may be sent while the conflict is open).
async function realConflict({ extraRoutes = [] } = {}) {
  const mocks = installUiMocks();
  const fb = loadFirebaseModule();
  const patches = [];
  const { storage } = await setupSignedInFirebase(fb, {
    extraRoutes: [
      ...extraRoutes,
      firestoreGetRoute(async () => jsonResponse(200, {
        updateTime: CLOUD_UPDATE_TIME,
        fields: {
          items: fb._toFV(JSON.stringify([{ id: 'cloud' }])),
          engines: fb._toFV(JSON.stringify([])),
          selected_engine: fb._toFV('google'),
          clocks: fb._toFV(JSON.stringify([])),
          grid_columns: fb._toFV(4),
        },
      })),
      firestorePatchRoute(async (url) => {
        patches.push(url);
        return jsonResponse(200, { updateTime: '2024-06-03T00:00:00.000000Z' });
      }),
    ],
  });
  mountAuthDom();
  globalThis.items = [{ id: 'local-only' }];
  storage._data._fb_edit_rev = 3;
  storage._data._fb_synced_rev = 2;
  installFbInitEventTracking();
  delete globalThis.onSyncConflict;
  window.showSigninNotice = vi.fn();
  await fb.fbInit();
  return { fb, storage, patches, ...mocks };
}

function cleanupRealModule() {
  for (const k of ['chrome', 'fetch', 'applyWallpaper', 'applyMainGridColumns', 'render',
    'getSelectedEngine', 'isStorageLoadFailed', '_showDeleteAccountConfirm']) {
    delete globalThis[k];
  }
  delete window.showSigninNotice;
}

describe('defer ("Decide later")', () => {
  afterEach(cleanupRealModule);

  it('(1) hides the dialog and keeps the conflict pending; hint, status and the auto-upload pause stay', async () => {
    const { fb } = await realConflict();
    expect(isHidden('sync-conflict-overlay')).toBe(false);
    $('sync-conflict-defer').click();
    expect(isHidden('sync-conflict-overlay')).toBe(true);
    expect(fb.fbGetSyncConflict()).not.toBeNull();
    // Regression: these never depended on the dialog being visible.
    expect(isHidden('sync-conflict-hint')).toBe(false);
    expect($('sync-status-text').classList.contains('is-conflict')).toBe(true);
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    try {
      fb.scheduleSyncToCloud();
      expect(setTimeoutSpy).not.toHaveBeenCalled();
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  // One case is enough: _openSyncConflictDialog never reads `trigger` (there
  // is no deferred flag and no trigger whitelist, D1). The real Upload path
  // is covered by the next case.
  it('(2) a later notification reopens a deferred dialog, whatever its trigger', () => {
    const { fb } = setup();
    fb._bindSyncConflictButtons();
    fb._openSyncConflictDialog({ ...INFO });
    $('sync-conflict-defer').click();
    expect(isHidden('sync-conflict-overlay')).toBe(true);
    fb._openSyncConflictDialog({ ...INFO, trigger: 'manual-pull' });
    expect(isHidden('sync-conflict-overlay')).toBe(false);
  });

  it('(2) after a defer, the sidebar Upload reopens the dialog without sending a PATCH (real fbInit)', async () => {
    const { fb, patches } = await realConflict();
    $('sync-conflict-defer').click();
    expect(isHidden('sync-conflict-overlay')).toBe(true);
    await fb._handleSyncBtn('upload');
    expect(isHidden('sync-conflict-overlay')).toBe(false);
    expect(patches).toEqual([]);
    expect(fb.fbGetSyncConflict()).not.toBeNull();
  });

  it('(3, I2) reopening shows the current local counts and edit time; the cloud side is unchanged', async () => {
    const { fb } = await realConflict();
    globalThis.t = vi.fn((key, vars) => (vars ? `${key}|${JSON.stringify(vars)}` : key));
    $('sync-conflict-defer').click();

    globalThis.items = [
      { id: 'a' }, { id: 'b' },
      { id: 'f', type: 'folder', children: [{ id: 'c' }] },
    ];
    const editTs = new Date(2026, 10, 12, 8, 5).getTime();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(editTs);
    try {
      await fb.markLocalCloudDataChanged();
    } finally {
      nowSpy.mockRestore();
    }
    await fb._handleSyncBtn('upload');

    expect(isHidden('sync-conflict-overlay')).toBe(false);
    expect(field('local', 'shortcuts').textContent).toBe('dialog.syncConflict.shortcuts|{"count":3}');
    expect(field('local', 'folders').textContent).toBe('dialog.syncConflict.folders|{"count":1}');
    expect(field('local', 'time').textContent)
      .toBe('dialog.syncConflict.timeFormat|{"month":"11","day":"12","time":"08:05"}');
    expect(field('cloud', 'shortcuts').textContent).toBe('dialog.syncConflict.shortcuts|{"count":1}');
    expect(field('cloud', 'folders').textContent).toBe('dialog.syncConflict.folders|{"count":0}');
    expect(field('cloud', 'time').textContent)
      .toBe(fb._formatConflictTime(Date.parse('2024-06-02T00:00:00Z')));
    // UI only: the pending record keeps the counts it was recorded with.
    expect(fb.fbGetSyncConflict().localShortcutCount).toBe(1);
  });

  it('(3, N-e) falls back to the recorded local side when items is not available', () => {
    const { fb, t } = setup();
    delete globalThis.items;
    fb._openSyncConflictDialog({ ...INFO });
    expect(isHidden('sync-conflict-overlay')).toBe(false);
    expect(t).toHaveBeenCalledWith('dialog.syncConflict.shortcuts', { count: 36 });
    expect(t).toHaveBeenCalledWith('dialog.syncConflict.folders', { count: 4 });
    expect(t).toHaveBeenCalledWith('dialog.syncConflict.timeFormat', { month: '01', day: '05', time: '09:07' });
  });

  it('(5) while a choice is resolving the link is disabled and neither it nor Escape closes the dialog', async () => {
    const { fb } = setup();
    await initStubbed(fb);
    fb._openSyncConflictDialog({ ...INFO });
    const d = deferred();
    globalThis.fbResolveSyncConflict = vi.fn(() => d.promise);
    $('sync-conflict-use-local').click();
    expect($('sync-conflict-defer').disabled).toBe(true);
    $('sync-conflict-defer').click();
    fb._deferSyncConflictDialog(); // the handler itself refuses too, not only the disabled button
    pressEscape();
    expect(isHidden('sync-conflict-overlay')).toBe(false);
    // The choice lands as usual; here it fails and keeps the conflict pending.
    d.resolve({ ok: false, code: 'network' });
    await vi.waitFor(() => expect($('sync-conflict-defer').disabled).toBe(false));
    expect(isHidden('sync-conflict-overlay')).toBe(false);
    expect($('sync-conflict-use-local').disabled).toBe(false);
    $('sync-conflict-defer').click();
    expect(isHidden('sync-conflict-overlay')).toBe(true);
  });

  it('(6, M4) a re-render during the sign-out await keeps the link disabled; it comes back afterwards', async () => {
    const { fb } = setup();
    await initStubbed(fb);
    fb._openSyncConflictDialog({ ...INFO, isAccountSwitch: true });
    const d = deferred();
    globalThis.fbSignOut = vi.fn(() => d.promise);
    $('sync-conflict-signout').click();
    expect($('sync-conflict-signout').disabled).toBe(true);
    fb._openSyncConflictDialog({ ...INFO, isAccountSwitch: true });
    fb._refreshSyncConflictDialogOnLangChange();
    expect($('sync-conflict-signout').disabled).toBe(true);
    d.resolve();
    await vi.waitFor(() => expect($('sync-conflict-signout').disabled).toBe(false));
  });

  it('(6b, B1) while signing out both choices are disabled and a choice is refused even when called directly', async () => {
    const { fb } = setup();
    await initStubbed(fb);
    fb._openSyncConflictDialog({ ...INFO, isAccountSwitch: true });
    const d = deferred();
    globalThis.fbSignOut = vi.fn(() => d.promise);
    globalThis.fbResolveSyncConflict = vi.fn(async () => ({ ok: true }));
    $('sync-conflict-signout').click();
    expect($('sync-conflict-use-local').disabled).toBe(true);
    expect($('sync-conflict-use-cloud').disabled).toBe(true);
    // The defer link stays usable: signing out is not a choice in flight.
    expect($('sync-conflict-defer').disabled).toBe(false);
    $('sync-conflict-use-local').click();
    await fb._handleConflictChoice('local'); // N-c: the second line of defence
    expect(globalThis.fbResolveSyncConflict).not.toHaveBeenCalled();
    d.resolve();
    await vi.waitFor(() => expect($('sync-conflict-use-local').disabled).toBe(false));
    expect($('sync-conflict-use-cloud').disabled).toBe(false);
  });

  it('(6b, N-b) while a choice is resolving the sign-out link stays disabled across a re-render and does nothing', async () => {
    const { fb } = setup();
    await initStubbed(fb);
    fb._openSyncConflictDialog({ ...INFO, isAccountSwitch: true });
    const d = deferred();
    globalThis.fbResolveSyncConflict = vi.fn(() => d.promise);
    globalThis.fbSignOut = vi.fn(async () => {});
    $('sync-conflict-use-local').click();
    fb._openSyncConflictDialog({ ...INFO, isAccountSwitch: true });
    expect($('sync-conflict-signout').disabled).toBe(true);
    $('sync-conflict-signout').click();
    expect(globalThis.fbSignOut).not.toHaveBeenCalled();
    globalThis.fbGetSyncConflict = vi.fn(() => null);
    d.resolve({ ok: false, code: 'no-conflict' });
    await vi.waitFor(() => expect(isHidden('sync-conflict-overlay')).toBe(true));
  });

  it('(6b, N-b) the sign-out handler itself refuses while a choice is resolving, even with the link force-enabled', async () => {
    const { fb } = setup();
    await initStubbed(fb);
    fb._openSyncConflictDialog({ ...INFO, isAccountSwitch: true });
    const d = deferred();
    globalThis.fbResolveSyncConflict = vi.fn(() => d.promise);
    globalThis.fbSignOut = vi.fn(async () => {});
    $('sync-conflict-use-local').click();
    // Bypass the disabled attribute so the click reaches the handler.
    $('sync-conflict-signout').disabled = false;
    $('sync-conflict-signout').click();
    expect(globalThis.fbSignOut).not.toHaveBeenCalled();
    globalThis.fbGetSyncConflict = vi.fn(() => null);
    d.resolve({ ok: false, code: 'no-conflict' });
    await vi.waitFor(() => expect(isHidden('sync-conflict-overlay')).toBe(true));
  });

  it('(6b) the sign-out handler does not re-enter while a sign-out is already running', async () => {
    const { fb } = setup();
    await initStubbed(fb);
    fb._openSyncConflictDialog({ ...INFO, isAccountSwitch: true });
    const d = deferred();
    globalThis.fbSignOut = vi.fn(() => d.promise);
    $('sync-conflict-signout').click();
    $('sync-conflict-signout').disabled = false;
    $('sync-conflict-signout').click();
    expect(globalThis.fbSignOut).toHaveBeenCalledTimes(1);
    d.resolve();
    await vi.waitFor(() => expect($('sync-conflict-signout').disabled).toBe(false));
  });

  it('(7) defer after an inline error closes the dialog; reopening shows no error', () => {
    const { fb } = setup();
    fb._bindSyncConflictButtons();
    fb._openSyncConflictDialog({ ...INFO });
    fb._setConflictError('network');
    expect(isHidden('sync-conflict-error')).toBe(false);
    $('sync-conflict-defer').click();
    expect(isHidden('sync-conflict-overlay')).toBe(true);
    fb._openSyncConflictDialog({ ...INFO });
    expect($('sync-conflict-error').textContent).toBe('');
    expect(isHidden('sync-conflict-error')).toBe(true);
  });
});

describe('Escape on the conflict dialog', () => {
  afterEach(cleanupRealModule);

  it('(8) defers a visible dialog, keeps the conflict pending and stops later keydown listeners', async () => {
    const { fb } = await realConflict();
    const sentinel = vi.fn();
    document.addEventListener('keydown', sentinel);
    pressEscape();
    expect(isHidden('sync-conflict-overlay')).toBe(true);
    expect(fb.fbGetSyncConflict()).not.toBeNull();
    expect(sentinel).not.toHaveBeenCalled();
  });

  it('(8) does not defer (nor swallow the key) while the dialog is closed', async () => {
    const { fb } = setup();
    await initStubbed(fb);
    const deferSpy = vi.fn();
    globalThis._deferSyncConflictDialog = deferSpy;
    const sentinel = vi.fn();
    document.addEventListener('keydown', sentinel);
    pressEscape();
    expect(deferSpy).not.toHaveBeenCalled();
    expect(sentinel).toHaveBeenCalledTimes(1);
  });

  it('(8) with the delete-account dialog also open, one Escape only defers the conflict dialog', async () => {
    const { fb } = setup();
    await initStubbed(fb);
    const confirm = fb._showDeleteAccountConfirm();
    fb._openSyncConflictDialog({ ...INFO });
    pressEscape();
    expect(isHidden('sync-conflict-overlay')).toBe(true);
    expect(isHidden('delete-account-overlay')).toBe(false);
    // The next Escape reaches the delete-account dialog as before.
    pressEscape();
    expect(isHidden('delete-account-overlay')).toBe(true);
    await expect(confirm).resolves.toBe(false);
  });

  it('(10c, N5) real order — app.js central handler first, firebase.js dispatcher second: one Escape defers only the conflict dialog', async () => {
    vi.useFakeTimers();
    try {
      installAppDomFixture();
      installUiMocks();
      installFbInitEventTracking(); // also removes app.js's keydown listener afterwards
      loadAppModule();
      globalThis.setupEventListeners();
      const fb = loadFirebaseModule();
      installSyncGlobals();
      globalThis.fbGetEmail = vi.fn(() => 'user@example.com');
      globalThis.fbGetSyncConflict = vi.fn(() => ({ ...INFO }));
      globalThis._loadAuth = vi.fn(async () => {});
      globalThis._loadRevState = vi.fn(async () => {});
      globalThis._loadCloudBaseline = vi.fn(async () => {});
      globalThis._bindSyncActionButtons = vi.fn();
      globalThis.fbIsSignedIn = vi.fn(() => false);
      window.showSigninNotice = vi.fn();
      await fb.fbInit();

      $('edit-overlay').classList.remove('hidden');
      fb._openSyncConflictDialog({ ...INFO });
      pressEscape();
      expect(isHidden('sync-conflict-overlay')).toBe(true);
      expect(isHidden('edit-overlay')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('focus after a defer (D7, M3)', () => {
  afterEach(cleanupRealModule);

  it('(9) opened from the sidebar Upload button: focus falls back to the sidebar handle', async () => {
    const { fb } = await realConflict();
    $('sync-conflict-defer').click();
    $('sync-upload-btn').focus();
    await fb._handleSyncBtn('upload');
    expect(isHidden('sync-conflict-overlay')).toBe(false);
    $('sync-conflict-defer').click();
    expect(document.activeElement.id).toBe('left-sidebar-handle');
  });

  it('(9) returns focus to the element focused before opening while it is still usable', () => {
    const { fb } = setup();
    fb._bindSyncConflictButtons();
    const probe = document.createElement('button');
    probe.id = 'probe';
    document.body.appendChild(probe);
    probe.focus();
    fb._openSyncConflictDialog({ ...INFO });
    expect(document.activeElement.id).toBe('sync-conflict-use-local');
    // A re-notification while open must not overwrite the remembered element.
    fb._openSyncConflictDialog({ ...INFO });
    $('sync-conflict-defer').click();
    expect(document.activeElement.id).toBe('probe');
  });

  it('(9) falls back to the sidebar handle when the remembered element is gone or disabled', () => {
    const { fb } = setup();
    fb._bindSyncConflictButtons();
    const probe = document.createElement('button');
    document.body.appendChild(probe);
    probe.focus();
    fb._openSyncConflictDialog({ ...INFO });
    probe.remove();
    $('sync-conflict-defer').click();
    expect(document.activeElement.id).toBe('left-sidebar-handle');

    const probe2 = document.createElement('button');
    document.body.appendChild(probe2);
    probe2.focus();
    fb._openSyncConflictDialog({ ...INFO });
    probe2.disabled = true;
    $('left-sidebar-handle').blur();
    $('sync-conflict-defer').click();
    expect(document.activeElement.id).toBe('left-sidebar-handle');
  });
});

describe('ways out after a defer', () => {
  afterEach(cleanupRealModule);

  it('(10, M5) deleting the account clears the conflict; the dialog stays closed and the hint hides', async () => {
    const { fb, showToast } = await realConflict({
      extraRoutes: [
        {
          match: (url, options = {}) => url.includes(`/documents/users/${TEST_UID}/data/settings`) && options.method === 'DELETE',
          respond: async () => jsonResponse(200, {}),
        },
        { match: (url) => url.includes('accounts:delete'), respond: async () => jsonResponse(200, {}) },
      ],
    });
    $('sync-conflict-defer').click();
    globalThis._showDeleteAccountConfirm = vi.fn(async () => true);
    await fb._handleDeleteAccount();
    expect(showToast).toHaveBeenCalledWith('toast.accountDeleted', 'default');
    expect(fb.fbGetSyncConflict()).toBeNull();
    expect(isHidden('sync-conflict-overlay')).toBe(true);
    expect(isHidden('sync-conflict-hint')).toBe(true);
  });

  it('(10b, N5) defer, sign out, sign in again, new conflict: the dialog reappears', async () => {
    const { fb, storage } = await realConflict();
    $('sync-conflict-defer').click();
    await fb.fbSignOut();
    expect(fb.fbGetSyncConflict()).toBeNull();
    expect(isHidden('sync-conflict-overlay')).toBe(true);

    Object.assign(storage._data, {
      _fb_refresh: 'seed-refresh-token',
      _fb_uid: TEST_UID,
      _fb_email_verified: true,
      _fb_email: 'user@example.com',
    });
    await fb._loadAuth();
    await fb._pullAfterSignIn({ trigger: 'sign-in' });
    expect(fb.fbGetSyncConflict()).not.toBeNull();
    expect(isHidden('sync-conflict-overlay')).toBe(false);
  });
});

describe('defer i18n', () => {
  afterEach(() => {
    delete window.I18N;
  });

  function loadDict(fs, file) {
    const store = {};
    const prev = window.I18N;
    window.I18N = { register: (lang, dict) => { store[lang] = dict; } };
    try {
      new Function(fs.readFileSync(`${process.cwd()}/${file}`, 'utf8'))();
    } finally {
      if (prev === undefined) delete window.I18N; else window.I18N = prev;
    }
    return Object.values(store)[0];
  }

  it('(12) defer and the revised conflict hint use the approved wording; the page placeholder matches zh', async () => {
    const fs = await import('node:fs');
    const zh = loadDict(fs, 'i18n.zh.js');
    const en = loadDict(fs, 'i18n.en.js');
    expect(zh.dialog.syncConflict.defer).toBe('稍后处理');
    expect(en.dialog.syncConflict.defer).toBe('Decide later');
    expect(zh.sidebar.sync.conflictHint).toBe('本地与云端不一致，自动同步已暂停。点「上传」重新打开选择窗口。');
    expect(en.sidebar.sync.conflictHint).toBe('Local and cloud data differ, so auto-sync is paused. Click Upload to choose again.');
    const html = fs.readFileSync(`${process.cwd()}/newtab.html`, 'utf8');
    expect(html).toContain(
      '<button type="button" id="sync-conflict-defer" class="forgot-password-btn sync-conflict-defer" data-i18n="dialog.syncConflict.defer">稍后处理</button>');
    expect(html).toContain(
      'data-i18n="sidebar.sync.conflictHint">本地与云端不一致，自动同步已暂停。点「上传」重新打开选择窗口。</p>');
  });

  it('(I-1) footer order: "Decide later" comes before the sign-out row in the page and both fixtures', async () => {
    const fs = await import('node:fs');
    const html = fs.readFileSync(`${process.cwd()}/newtab.html`, 'utf8');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const check = (root) => {
      const defer = root.querySelector('#sync-conflict-defer');
      const row = root.querySelector('#sync-conflict-signout-row');
      expect(defer.parentElement).toBe(row.parentElement);
      expect(defer.parentElement.classList.contains('sync-conflict-footer')).toBe(true);
      expect(defer.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    };
    check(doc);
    mountAuthDom();
    check(document);
    installAppDomFixture();
    check(document);
  });

  it('(12) the defer link text follows a language change', async () => {
    const fs = await import('node:fs');
    mountAuthDom();
    for (const f of ['i18n.js', 'i18n.zh.js', 'i18n.en.js']) {
      new Function(fs.readFileSync(`${process.cwd()}/${f}`, 'utf8'))();
    }
    window.I18N.setLang('en');
    expect($('sync-conflict-defer').textContent).toBe('Decide later');
    window.I18N.setLang('zh-CN');
    expect($('sync-conflict-defer').textContent).toBe('稍后处理');
  });
});

describe('sync-conflict i18n keys', () => {
  it('conflict keys exist in zh and en; the unreachable local-upload-failed key is gone', async () => {
    const fs = await import('node:fs');
    for (const f of ['i18n.zh.js', 'i18n.en.js']) {
      const src = fs.readFileSync(`${process.cwd()}/${f}`, 'utf8');
      for (const key of [
        'syncConflictCloudGone', 'syncStorageUnavailable', 'syncBaselineCleared',
        'syncRetryExhausted', 'syncUpToDate', 'cloudChanged', 'cloudAbsent', 'payloadTooLarge',
        'defer', 'cloudEmpty', 'cloudAbsentTooLarge',
      ]) {
        expect(src).toContain(`${key}:`);
      }
      expect(src).not.toContain('syncConflictLocalUploadFailed');
    }
  });
});

// ── Stage 3: disabled states (cloudAbsent / payloadTooLarge) ──────────────
// One link whose name alone pushes the upload body past FB_PAYLOAD_MAX_BYTES.
const HUGE_ITEMS = () => [{ id: 'huge', type: 'link', name: 'x'.repeat(100000), url: 'https://example.com' }];
// The button is disabled because of the dialog state (not just a busy flag):
// native disabled, aria-disabled and a description of why.
function expectStateDisabled(id, describedBy) {
  expect($(id).disabled).toBe(true);
  expect($(id).getAttribute('aria-disabled')).toBe('true');
  expect($(id).getAttribute('aria-describedby')).toBe(describedBy);
}
function expectUsable(id) {
  expect($(id).disabled).toBe(false);
  expect($(id).hasAttribute('aria-disabled')).toBe(false);
  expect($(id).hasAttribute('aria-describedby')).toBe(false);
}

describe('disabled states: cloud absent (D5)', () => {
  it.each(['not-found', 'empty'])('(1) cloudState %s: use-cloud disabled with aria, cloud card empty, focus on use-local', (cloudState) => {
    const { fb } = setup();
    fb._openSyncConflictDialog({ ...INFO, cloudState, cloudShortcutCount: 0, cloudFolderCount: 0 });
    expectStateDisabled('sync-conflict-use-cloud', 'sync-conflict-cloud-empty');
    expectUsable('sync-conflict-use-local');
    expect($('sync-conflict-cloud').classList.contains('is-empty')).toBe(true);
    expect($('sync-conflict-local').classList.contains('is-empty')).toBe(false);
    expect(field('cloud', 'empty').id).toBe('sync-conflict-cloud-empty');
    expect(field('cloud', 'empty').textContent).toBe('dialog.syncConflict.cloudEmpty');
    expect(isHidden('sync-conflict-cloud-empty')).toBe(false);
    expect($('sync-conflict-text').textContent).toBe('dialog.syncConflict.cloudAbsent');
    expect(isHidden('sync-conflict-limit')).toBe(true);
    expect(document.activeElement.id).toBe('sync-conflict-use-local');
  });

  it('(2) a failed choose-local that leaves the conflict pending keeps use-cloud disabled and re-enables use-local', async () => {
    const { fb } = setup();
    globalThis.fbIsSignedIn = vi.fn(() => true);
    globalThis.fbResolveSyncConflict = vi.fn(async () => ({ ok: false, code: 'network' }));
    globalThis._updateSyncUI = vi.fn();
    try {
      fb._openSyncConflictDialog({ ...INFO, cloudState: 'not-found' });
      await fb._handleConflictChoice('local');
      expect(isHidden('sync-conflict-overlay')).toBe(false);
      expect($('sync-conflict-error').textContent).toBe('toast.syncNetworkFailed');
      expectStateDisabled('sync-conflict-use-cloud', 'sync-conflict-cloud-empty');
      expectUsable('sync-conflict-use-local');
      expect($('sync-conflict-defer').disabled).toBe(false);
    } finally {
      delete globalThis._updateSyncUI;
    }
  });

  it('(3) the cloud coming back as a document re-enables use-cloud and drops the empty state', () => {
    const { fb } = setup();
    fb._openSyncConflictDialog({ ...INFO, cloudState: 'not-found' });
    fb._openSyncConflictDialog({ ...INFO, cloudState: 'doc' });
    expectUsable('sync-conflict-use-cloud');
    expect($('sync-conflict-cloud').classList.contains('is-empty')).toBe(false);
    expect(isHidden('sync-conflict-cloud-empty')).toBe(true);
    expect($('sync-conflict-text').textContent).toBe('dialog.syncConflict.text');
  });

  it('closing the dialog leaves no state-disabled control behind', () => {
    const { fb } = setup();
    globalThis.items = HUGE_ITEMS();
    fb._openSyncConflictDialog({ ...INFO, cloudState: 'not-found' });
    fb._closeSyncConflictDialog();
    fb._applyConflictControls();
    expectUsable('sync-conflict-use-local');
    expectUsable('sync-conflict-use-cloud');
  });
});

describe('disabled states: local payload too large (D6)', () => {
  it('(5) _isPayloadTooLarge: 90000 characters is within the limit, 90001 is over', () => {
    const { fb } = setup();
    expect(fb._isPayloadTooLarge('x'.repeat(90000))).toBe(false);
    expect(fb._isPayloadTooLarge('x'.repeat(90001))).toBe(true);
  });

  it('(5) _localPayloadTooLarge reads the in-memory snapshot', () => {
    const { fb } = setup();
    expect(fb._localPayloadTooLarge()).toBe(false);
    globalThis.items = HUGE_ITEMS();
    expect(fb._localPayloadTooLarge()).toBe(true);
  });

  it('(5) opening with oversized local data: use-local disabled with aria, persistent limit note, focus on use-cloud', () => {
    const { fb } = setup();
    globalThis.items = HUGE_ITEMS();
    fb._openSyncConflictDialog({ ...INFO });
    expectStateDisabled('sync-conflict-use-local', 'sync-conflict-limit');
    expectUsable('sync-conflict-use-cloud');
    expect(isHidden('sync-conflict-limit')).toBe(false);
    expect($('sync-conflict-limit').textContent).toBe('dialog.syncConflict.payloadTooLarge');
    expect($('sync-conflict-limit').hasAttribute('role')).toBe(false);
    expect(isHidden('sync-conflict-error')).toBe(true);
    expect($('sync-conflict-text').textContent).toBe('dialog.syncConflict.text');
    expect(document.activeElement.id).toBe('sync-conflict-use-cloud');
  });

  it('(6, I4) a network failure on use-cloud shows the inline error next to the limit note; reopening clears only the error', async () => {
    const { fb } = setup();
    globalThis.items = HUGE_ITEMS();
    globalThis.fbIsSignedIn = vi.fn(() => true);
    globalThis.fbResolveSyncConflict = vi.fn(async () => ({ ok: false, code: 'network' }));
    globalThis._updateSyncUI = vi.fn();
    try {
      fb._openSyncConflictDialog({ ...INFO });
      await fb._handleConflictChoice('cloud');
      expect(isHidden('sync-conflict-error')).toBe(false);
      expect($('sync-conflict-error').textContent).toBe('toast.syncNetworkFailed');
      expect(isHidden('sync-conflict-limit')).toBe(false);
      expect($('sync-conflict-limit').textContent).toBe('dialog.syncConflict.payloadTooLarge');
      // A later notification while open, then a defer and a fresh open.
      fb._openSyncConflictDialog({ ...INFO });
      expect(isHidden('sync-conflict-error')).toBe(true);
      expect(isHidden('sync-conflict-limit')).toBe(false);
      fb._deferSyncConflictDialog();
      fb._openSyncConflictDialog({ ...INFO });
      expect($('sync-conflict-error').textContent).toBe('');
      expect(isHidden('sync-conflict-error')).toBe(true);
      expect(isHidden('sync-conflict-limit')).toBe(false);
      expectStateDisabled('sync-conflict-use-local', 'sync-conflict-limit');
    } finally {
      delete globalThis._updateSyncUI;
    }
  });

  it('(7, I4) langchange re-renders the limit note in the new language', () => {
    const { fb, t } = setup();
    globalThis.items = HUGE_ITEMS();
    fb._openSyncConflictDialog({ ...INFO });
    $('sync-conflict-limit').textContent = 'stale-language text';
    t.mockClear();
    fb._refreshSyncConflictDialogOnLangChange();
    expect(t).toHaveBeenCalledWith('dialog.syncConflict.payloadTooLarge');
    expect($('sync-conflict-limit').textContent).toBe('dialog.syncConflict.payloadTooLarge');
    expect(isHidden('sync-conflict-limit')).toBe(false);
  });

  it('(7, I4) langchange re-renders the cloud empty line in the new language', () => {
    const { fb, t } = setup();
    fb._openSyncConflictDialog({ ...INFO, cloudState: 'empty' });
    $('sync-conflict-cloud-empty').textContent = 'stale-language text';
    t.mockClear();
    fb._refreshSyncConflictDialogOnLangChange();
    expect(t).toHaveBeenCalledWith('dialog.syncConflict.cloudEmpty');
    expect($('sync-conflict-cloud-empty').textContent).toBe('dialog.syncConflict.cloudEmpty');
  });

  describe('(8) choose-local returning payload-too-large (fallback, m-9)', () => {
    function arrangeTooLarge() {
      const ctx = setup();
      globalThis.fbIsSignedIn = vi.fn(() => true);
      globalThis.fbResolveSyncConflict = vi.fn(async () => ({ ok: false, code: 'payload-too-large' }));
      globalThis._updateSyncUI = vi.fn();
      // Small enough when the dialog opens; grown before the choice lands.
      ctx.fb._openSyncConflictDialog({ ...INFO });
      expect(document.activeElement.id).toBe('sync-conflict-use-local');
      return ctx;
    }
    afterEach(() => { delete globalThis._updateSyncUI; });

    it('size recheck true: no inline error, limit note shown, use-local disabled, focus on use-cloud', async () => {
      const { fb, showToast } = arrangeTooLarge();
      globalThis.items = HUGE_ITEMS();
      await fb._handleConflictChoice('local');
      expect(isHidden('sync-conflict-overlay')).toBe(false);
      expect(isHidden('sync-conflict-error')).toBe(true);
      expect($('sync-conflict-error').textContent).toBe('');
      expect(isHidden('sync-conflict-limit')).toBe(false);
      expectStateDisabled('sync-conflict-use-local', 'sync-conflict-limit');
      expectUsable('sync-conflict-use-cloud');
      expect(document.activeElement.id).toBe('sync-conflict-use-cloud');
      expect(showToast).not.toHaveBeenCalled();
    });

    it('size recheck true also clears an older inline error', async () => {
      const { fb } = arrangeTooLarge();
      fb._setConflictError('network');
      globalThis.items = HUGE_ITEMS();
      await fb._handleConflictChoice('local');
      expect(isHidden('sync-conflict-error')).toBe(true);
      expect(isHidden('sync-conflict-limit')).toBe(false);
    });

    it('size recheck false: falls back to the inline error so the failure is never silent', async () => {
      const { fb } = arrangeTooLarge();
      globalThis._localPayloadTooLarge = vi.fn(() => false);
      await fb._handleConflictChoice('local');
      expect(globalThis._localPayloadTooLarge).toHaveBeenCalled();
      expect(isHidden('sync-conflict-error')).toBe(false);
      expect($('sync-conflict-error').textContent).toBe('dialog.syncConflict.payloadTooLarge');
      expect(isHidden('sync-conflict-limit')).toBe(true);
      expectUsable('sync-conflict-use-local');
    });

    it('after trimming, the next notification hides the limit note and re-enables use-local', async () => {
      const { fb } = arrangeTooLarge();
      globalThis.items = HUGE_ITEMS();
      await fb._handleConflictChoice('local');
      globalThis.items = localItems(3, 1);
      fb._openSyncConflictDialog({ ...INFO });
      expect(isHidden('sync-conflict-limit')).toBe(true);
      expectUsable('sync-conflict-use-local');
      expectUsable('sync-conflict-use-cloud');
    });
  });

  it('(8b) a throwing snapshot counts as not too large and the dialog still opens', () => {
    const { fb } = setup();
    globalThis._buildSyncSnapshot = vi.fn(() => { throw new Error('boom'); });
    expect(fb._localPayloadTooLarge()).toBe(false);
    fb._openSyncConflictDialog({ ...INFO });
    expect(isHidden('sync-conflict-overlay')).toBe(false);
    expectUsable('sync-conflict-use-local');
    expect(isHidden('sync-conflict-limit')).toBe(true);
  });
});

describe('disabled states: cloud absent and too large together (D6, Q2)', () => {
  it('(9) both choices disabled, body text explains, limit note hidden, focus on defer; defer and sign-out stay usable', () => {
    const { fb } = setup();
    globalThis.items = HUGE_ITEMS();
    fb._openSyncConflictDialog({ ...INFO, isAccountSwitch: true, cloudState: 'not-found' });
    expectStateDisabled('sync-conflict-use-cloud', 'sync-conflict-cloud-empty');
    expectStateDisabled('sync-conflict-use-local', 'sync-conflict-text');
    expect($('sync-conflict-text').textContent).toBe('dialog.syncConflict.cloudAbsentTooLarge');
    expect(isHidden('sync-conflict-limit')).toBe(true);
    expect(document.activeElement.id).toBe('sync-conflict-defer');
    expect($('sync-conflict-defer').disabled).toBe(false);
    expect($('sync-conflict-signout').disabled).toBe(false);
    expect(isHidden('sync-conflict-signout-row')).toBe(false);
    expect($('sync-conflict-use-local').hasAttribute('title')).toBe(false);
    expect($('sync-conflict-use-cloud').hasAttribute('title')).toBe(false);
  });

  it('(9) the defer link still closes the dialog in that state', () => {
    const { fb } = setup();
    globalThis.items = HUGE_ITEMS();
    fb._openSyncConflictDialog({ ...INFO, cloudState: 'empty' });
    fb._bindSyncConflictButtons();
    $('sync-conflict-defer').click();
    expect(isHidden('sync-conflict-overlay')).toBe(true);
  });
});

describe('disabled states: markup and wording', () => {
  it('page and both fixtures carry the cloud empty line and a non-alert limit note', async () => {
    const fs = await import('node:fs');
    const html = fs.readFileSync(`${process.cwd()}/newtab.html`, 'utf8');
    const check = (root) => {
      const empty = root.querySelector('#sync-conflict-cloud [data-field="empty"]');
      expect(empty?.id).toBe('sync-conflict-cloud-empty');
      expect(empty.classList.contains('hidden')).toBe(true);
      expect(root.querySelector('#sync-conflict-local [data-field="empty"]')).toBeNull();
      const limit = root.querySelector('#sync-conflict-limit');
      expect(limit?.tagName).toBe('P');
      expect(limit.hasAttribute('role')).toBe(false);
      expect(limit.classList.contains('hidden')).toBe(true);
      // Above the buttons, next to the inline error line.
      const actions = root.querySelector('.sync-conflict-actions');
      expect(limit.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    };
    check(new DOMParser().parseFromString(html, 'text/html'));
    mountAuthDom();
    check(document);
    installAppDomFixture();
    check(document);
  });

  it('cloudEmpty, cloudAbsent, payloadTooLarge and cloudAbsentTooLarge use the approved wording', async () => {
    const fs = await import('node:fs');
    const load = (file) => {
      const store = {};
      const prev = window.I18N;
      window.I18N = { register: (lang, dict) => { store[lang] = dict; } };
      try {
        new Function(fs.readFileSync(`${process.cwd()}/${file}`, 'utf8'))();
      } finally {
        if (prev === undefined) delete window.I18N; else window.I18N = prev;
      }
      return Object.values(store)[0].dialog.syncConflict;
    };
    const zh = load('i18n.zh.js');
    const en = load('i18n.en.js');
    expect(zh.cloudEmpty).toBe('云端暂无数据');
    expect(en.cloudEmpty).toBe('No data in the cloud');
    expect(zh.cloudAbsent).toBe('云端数据已被删除或清空，可使用本地数据重新上传。');
    expect(en.cloudAbsent).toBe('The cloud data has been deleted or cleared. You can upload the local data again.');
    expect(zh.payloadTooLarge).toBe('本地数据超出 100KB 上传上限，无法使用本地。可先「稍后处理」精简自定义图标，再重新打开本窗口并选「使用本地」，或改选「使用云端」。');
    expect(en.payloadTooLarge).toBe('Local data exceeds the 100 KB upload limit, so it can\'t be kept. Choose "Decide later", trim custom icons, then reopen this dialog and choose Use local, or choose "Use cloud".');
    expect(zh.cloudAbsentTooLarge).toBe('云端数据已被删除或清空，但本地数据超出上传上限。可先「稍后处理」精简自定义图标，再重新打开并选「使用本地」。');
    expect(en.cloudAbsentTooLarge).toBe('The cloud data has been deleted or cleared, but the local data exceeds the upload limit. Choose "Decide later", trim custom icons, then reopen this dialog and choose Use local.');
  });
});
