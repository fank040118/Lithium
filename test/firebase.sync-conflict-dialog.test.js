import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadFirebaseModule } from './helpers/loadFirebaseModule.js';
import { mountAuthDom } from './helpers/authDomFixture.js';
import { installUiMocks } from './helpers/uiMocks.js';
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
