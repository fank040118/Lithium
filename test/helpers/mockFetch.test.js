import { describe, it, expect } from 'vitest';
import { createRoutedFetch, jsonResponse } from './mockFetch.js';

describe('createRoutedFetch', () => {
  it('dispatches to the first matching route', async () => {
    const fetchMock = createRoutedFetch([
      { match: (url) => url.includes('/a'), respond: async () => jsonResponse(200, { from: 'a' }) },
      { match: (url) => url.includes('/b'), respond: async () => jsonResponse(200, { from: 'b' }) },
    ]);
    const res = await fetchMock('https://example.com/b');
    const body = await res.json();
    expect(body).toEqual({ from: 'b' });
  });

  it('throws when no route matches', async () => {
    const fetchMock = createRoutedFetch([]);
    await expect(fetchMock('https://example.com/unknown')).rejects.toThrow('no route matched');
  });
});
