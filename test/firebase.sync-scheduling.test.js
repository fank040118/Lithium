import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadFirebaseModule } from './helpers/loadFirebaseModule.js';
import { createMockChromeStorage } from './helpers/mockChromeStorage.js';

afterEach(() => {
  delete globalThis.chrome;
});

// Signs `fb` in via _loadAuth() against a fresh mock chrome.storage.local,
// without touching fetch/network — scheduleSyncToCloud only needs the
// in-memory auth state (_refreshToken/_emailVerified), never the network.
async function signIn(fb, { verified = true } = {}) {
  const storage = createMockChromeStorage({
    _fb_refresh: 'seed-refresh-token',
    _fb_uid: 'test-uid',
    _fb_email_verified: verified,
    _fb_email: 'user@example.com',
  });
  globalThis.chrome = storage;
  await fb._loadAuth();
  return storage;
}

describe('scheduleSyncToCloud', () => {
  it('does not schedule a timer when not signed in', () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();

      fb.scheduleSyncToCloud();

      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not schedule a timer when signed in but the email is not verified', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      await signIn(fb, { verified: false });

      fb.scheduleSyncToCloud();

      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('schedules exactly one timer when signed in and verified, debouncing repeated calls', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      await signIn(fb, { verified: true });

      fb.scheduleSyncToCloud();
      fb.scheduleSyncToCloud();
      fb.scheduleSyncToCloud();

      expect(vi.getTimerCount()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('calls syncToCloud exactly once after the 2000ms debounce window elapses', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      await signIn(fb, { verified: true });
      const syncToCloudMock = vi.fn().mockResolvedValue({ ok: true });
      globalThis.syncToCloud = syncToCloudMock;

      fb.scheduleSyncToCloud();
      await vi.advanceTimersByTimeAsync(2000);

      expect(syncToCloudMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('logs via console.error and does not throw when the scheduled syncToCloud rejects', async () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const fb = loadFirebaseModule();
      await signIn(fb, { verified: true });
      globalThis.syncToCloud = vi.fn().mockRejectedValue(new Error('boom'));

      fb.scheduleSyncToCloud();
      await vi.advanceTimersByTimeAsync(2000);

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0][0]).toContain('scheduled upload failed');
      expect(errorSpy.mock.calls[0][1]).toBeInstanceOf(Error);
    } finally {
      errorSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe('markLocalCloudDataChanged', () => {
  it('persists Date.now() as the local sync timestamp by default and schedules a sync', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
      const fb = loadFirebaseModule();
      await signIn(fb, { verified: true });

      await fb.markLocalCloudDataChanged();

      expect(await fb._loadLocalSyncTs()).toBe(Date.now());
      expect(vi.getTimerCount()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not persist a timestamp when userEdit is false, but still schedules a sync', async () => {
    vi.useFakeTimers();
    try {
      const fb = loadFirebaseModule();
      await signIn(fb, { verified: true });

      await fb.markLocalCloudDataChanged({ userEdit: false });

      expect(await fb._loadLocalSyncTs()).toBe(0);
      expect(vi.getTimerCount()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('still persists the timestamp when not signed in, but does not schedule a sync', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
      const fb = loadFirebaseModule();
      // Storage must exist for _saveLocalSyncTs/_loadLocalSyncTs to persist,
      // but auth is intentionally never loaded so fbIsSignedIn() stays false.
      globalThis.chrome = createMockChromeStorage({});

      await fb.markLocalCloudDataChanged();

      expect(await fb._loadLocalSyncTs()).toBe(Date.now());
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
