import { describe, expect, it } from 'vitest';
import type { Keyword } from '../types/contracts';
import { getRisingKeywords } from './risingKeywords';

const keywords = [
  { id: 'earthquake', term: '地震', kind: 'auto', burstCurrent: 8, burstSourceCount: 4, burstBaseline: [1, 2, 1, 2, 1, 2, 1], burstBaselineMedian: 1, burstScore: 7 },
  { id: 'rain', term: '豪雨', kind: 'auto', burstCurrent: 4, burstSourceCount: 4, burstBaseline: [0, 0, 0, 0, 0, 0, 0], burstBaselineMedian: 0, burstScore: null },
] as Keyword[];

describe('getRisingKeywords', () => {
  it('uses the precomputed seven-day same-hour baseline evidence', () => {
    const result = getRisingKeywords(keywords);

    expect(result[0]).toMatchObject({
      term: '地震',
      currentMentions: 8,
      sourceCount: 4,
      baselineMedian: 1,
      burstScore: 7,
    });
  });

  it('does not claim a rise when support gates produce a null score', () => {
    expect(getRisingKeywords(keywords).some((item) => item.term === '豪雨')).toBe(false);
  });
});
