import { describe, it, expect } from 'vitest';
import { createMockChromeStorage } from './mockChromeStorage.js';

describe('createMockChromeStorage', () => {
  it('returns only requested keys that exist', async () => {
    const storage = createMockChromeStorage({ a: 1, b: 2 });
    const result = await storage.storage.local.get(['a', 'c']);
    expect(result).toEqual({ a: 1 });
  });

  it('set merges values and get reflects them', async () => {
    const storage = createMockChromeStorage();
    await storage.storage.local.set({ x: 'hello' });
    const result = await storage.storage.local.get(['x']);
    expect(result).toEqual({ x: 'hello' });
  });

  it('remove deletes keys', async () => {
    const storage = createMockChromeStorage({ a: 1 });
    await storage.storage.local.remove(['a']);
    const result = await storage.storage.local.get(['a']);
    expect(result).toEqual({});
  });
});
