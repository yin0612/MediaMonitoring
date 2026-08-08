import { describe, expect, it } from 'vitest';
import { fmtRelative } from './format';

describe('fmtRelative', () => {
  it('does not present a clearly future publication time as just now', () => {
    const now = Date.parse('2026-07-22T15:00:00Z');
    expect(fmtRelative('2026-07-22T21:43:00Z', now)).toBe('來源時間異常');
  });
});
