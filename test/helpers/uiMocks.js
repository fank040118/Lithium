import { vi } from 'vitest';

/**
 * Installs the two UI helpers that firebase.js expects from the host page
 * (i18n.js and app.js) but which are not defined by the module itself.
 * Returns the vi.fn references so callers can assert on .mock.calls.
 */
export function installUiMocks() {
  const t = vi.fn((key, vars) => key);
  const showToast = vi.fn((msg, type) => {});
  globalThis.t = t;
  globalThis.showToast = showToast;
  return { t, showToast };
}
