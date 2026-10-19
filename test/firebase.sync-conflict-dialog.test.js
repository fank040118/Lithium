import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadFirebaseModule } from './helpers/loadFirebaseModule.js';
import { mountAuthDom } from './helpers/authDomFixture.js';
import { installUiMocks } from './helpers/uiMocks.js';
import { jsonResponse } from './helpers/mockFetch.js';
import { setupSignedInFirebase, firestoreGetRoute } from './helpers/setupSignedInFirebase.js';
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

function setup() {
  const mocks = installUiMocks();
  const fb = loadFirebaseModule();
  mountAuthDom();
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

  it('shows the unknown label when a time is 0', () => {
    const { fb } = setup();
    fb._renderSyncConflictDialog({ ...INFO, localEditTime: 0 });
    expect(field('local', 'time').textContent).toBe('dialog.syncConflict.unknownTime');
  });
});

describe('_openSyncConflictDialog', () => {
  it('open twice re-renders a single overlay', () => {
    const { fb, t } = setup();
    fb._openSyncConflictDialog({ ...INFO, localShortcutCount: 36 });
    fb._openSyncConflictDialog({ ...INFO, localShortcutCount: 7 });
    expect(document.querySelectorAll('#sync-conflict-overlay').length).toBe(1);
    expect($('sync-conflict-overlay').classList.contains('hidden')).toBe(false);
    const lastShortcuts = t.mock.calls.filter(c => c[0] === 'dialog.syncConflict.shortcuts' && c[1].count !== 12);
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
    globalThis._loadCloudSyncTs = vi.fn(async () => {});
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
    ['firestore', 'toast.syncFailed'],
    [undefined, 'toast.syncFailed'],
  ])('maps %s to %s', (code, key) => {
    const { fb } = setup();
    expect(fb._syncErrorToastKey(code)).toBe(key);
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

  it('local upload failure tells user to retry', async () => {
    const { fb, t, showToast, updateSpy } = arrange({ ok: false, code: 'network' });
    await fb._handleConflictChoice('local');
    expect(hidden()).toBe(true);
    expect(t).toHaveBeenCalledWith('toast.syncConflictLocalUploadFailed', { reason: 'toast.syncNetworkFailed' });
    expect(showToast).toHaveBeenCalledWith('toast.syncConflictLocalUploadFailed', 'error');
    expect(updateSpy).toHaveBeenCalled();
  });

  it('cloud failure with the conflict cleared closes with a plain error toast, not the local-upload hint', async () => {
    const { fb, t, showToast } = arrange({ ok: false, code: 'network' });
    await fb._handleConflictChoice('cloud');
    expect(hidden()).toBe(true);
    expect(t).not.toHaveBeenCalledWith('toast.syncConflictLocalUploadFailed', expect.anything());
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
    globalThis._loadCloudSyncTs = vi.fn(async () => {});
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

describe('sync-conflict i18n keys', () => {
  it('toast keys exist in zh and en', async () => {
    const fs = await import('node:fs');
    for (const f of ['i18n.zh.js', 'i18n.en.js']) {
      const src = fs.readFileSync(`${process.cwd()}/${f}`, 'utf8');
      expect(src).toContain('syncConflictCloudGone');
      expect(src).toContain('syncConflictLocalUploadFailed');
    }
  });
});
