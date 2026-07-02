import { describe, it, expect } from 'vitest';
import { loadFirebaseModule } from './helpers/loadFirebaseModule.js';

describe('_normalizeTs', () => {
  it('returns the number for a positive finite value', () => {
    const fb = loadFirebaseModule();
    expect(fb._normalizeTs(500)).toBe(500);
  });

  it('returns 0 for zero', () => {
    const fb = loadFirebaseModule();
    expect(fb._normalizeTs(0)).toBe(0);
  });

  it('returns 0 for a negative value', () => {
    const fb = loadFirebaseModule();
    expect(fb._normalizeTs(-1)).toBe(0);
  });

  it('returns 0 for NaN', () => {
    const fb = loadFirebaseModule();
    expect(fb._normalizeTs(NaN)).toBe(0);
  });

  it('returns 0 for Infinity', () => {
    const fb = loadFirebaseModule();
    expect(fb._normalizeTs(Infinity)).toBe(0);
  });

  it('coerces numeric strings', () => {
    const fb = loadFirebaseModule();
    expect(fb._normalizeTs('123')).toBe(123);
  });

  it('returns 0 for undefined', () => {
    const fb = loadFirebaseModule();
    expect(fb._normalizeTs(undefined)).toBe(0);
  });
});

describe('_rfc3339ToMs', () => {
  it('parses a full RFC3339 timestamp with nanosecond precision', () => {
    const fb = loadFirebaseModule();
    const ms = fb._rfc3339ToMs('2024-01-01T00:00:00.123456789Z');
    expect(ms).toBe(new Date('2024-01-01T00:00:00.123Z').getTime());
  });

  it('parses a timestamp with no fractional seconds', () => {
    const fb = loadFirebaseModule();
    const ms = fb._rfc3339ToMs('2024-01-01T00:00:00Z');
    expect(ms).toBe(new Date('2024-01-01T00:00:00Z').getTime());
  });

  it('returns 0 for null', () => {
    const fb = loadFirebaseModule();
    expect(fb._rfc3339ToMs(null)).toBe(0);
  });

  it('returns 0 for undefined', () => {
    const fb = loadFirebaseModule();
    expect(fb._rfc3339ToMs(undefined)).toBe(0);
  });

  it('returns 0 for a non-string value', () => {
    const fb = loadFirebaseModule();
    expect(fb._rfc3339ToMs(1700000000000)).toBe(0);
  });

  it('returns 0 for a malformed date string', () => {
    const fb = loadFirebaseModule();
    expect(fb._rfc3339ToMs('not-a-date')).toBe(0);
  });
});
