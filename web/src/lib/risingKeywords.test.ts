import { describe, expect, it } from 'vitest';
import type { Keyword, RecentItem } from '../types/contracts';
import { getRisingKeywords } from './risingKeywords';

const NOW = '2026-07-26T12:00:00Z';
const keywords = [
  { id: 'earthquake', term: '地震', kind: 'auto' },
  { id: 'rain', term: '豪雨', kind: 'auto' },
] as Keyword[];

function item(id: string, publishedAt: string, title: string): RecentItem {
  return { id, source: 'cna', title, excerpt: '', publishedAt, url: `https://example.com/${id}` };
}

describe('getRisingKeywords', () => {
  it('compares two half-open 90-minute windows and deduplicates a term per article', () => {
    const result = getRisingKeywords([
      item('recent-1', '2026-07-26T11:30:00Z', '地震 地震'),
      item('recent-2', '2026-07-26T11:00:00Z', '地震與豪雨'),
      item('previous-1', '2026-07-26T10:00:00Z', '地震'),
      item('boundary', '2026-07-26T08:59:00Z', '地震'),
    ], keywords, NOW, 90);

    expect(result[0]).toMatchObject({
      term: '地震',
      recentMentions: 2,
      previousMentions: 1,
      delta: 1,
      changePercent: 100,
    });
  });

  it('labels a term as new when the previous window has zero mentions', () => {
    const result = getRisingKeywords([
      item('recent-1', '2026-07-26T11:30:00Z', '豪雨'),
      item('recent-2', '2026-07-26T11:00:00Z', '豪雨'),
    ], keywords, NOW, 90);

    expect(result[0]).toMatchObject({ term: '豪雨', recentMentions: 2, previousMentions: 0, changePercent: null });
  });

  it('excludes non-rising terms and sorts by delta then recent mentions', () => {
    const result = getRisingKeywords([
      item('recent-1', '2026-07-26T11:30:00Z', '地震'),
      item('previous-1', '2026-07-26T10:00:00Z', '地震'),
    ], keywords, NOW, 90);

    expect(result).toEqual([]);
  });
});
