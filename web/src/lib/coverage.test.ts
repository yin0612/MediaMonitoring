import { describe, expect, it } from 'vitest';
import { isArchive30dReady } from './coverage';

describe('archive coverage gate', () => {
  it('requires explicit complete coverage before enabling 30d', () => {
    expect(isArchive30dReady(null)).toBe(false);
    expect(isArchive30dReady({ coverage: { archiveDays: 30 } } as never)).toBe(false);
    expect(isArchive30dReady({ coverage: { archiveDays: 30, complete: false } } as never)).toBe(false);
    expect(isArchive30dReady({ coverage: { archiveDays: 30, coveredDays: 30, complete: true } } as never)).toBe(true);
  });

  it('does not enable 30d when the archive has endpoint dates but missing days', () => {
    expect(isArchive30dReady({ coverage: { archiveDays: 30, coveredDays: 2, complete: true } } as never)).toBe(false);
  });
});
