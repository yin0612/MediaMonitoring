import { describe, expect, it } from 'vitest';
import type { SearchArticle } from '../types/contracts';
import { extractTermStats, matchesAdvancedQuery, sentimentLabelOf } from './analysis';

const article = (title: string, publishedAt: string, source: SearchArticle['source'] = 'cna'): SearchArticle => ({
  id: `${source}-${title}-${publishedAt}`, source, title, excerpt: '', publishedAt,
  url: `https://example.com/${encodeURIComponent(title)}`, sentiment: null,
});

describe('advanced query semantics', () => {
  it('supports AND, OR, NOT, minus exclusions, and quoted phrases', () => {
    expect(matchesAdvancedQuery('台積電法說會展望', '台積電 AND "法說會"')).toBe(true);
    expect(matchesAdvancedQuery('聯發科新品發表', '台積電 OR 聯發科')).toBe(true);
    expect(matchesAdvancedQuery('台積電股價下跌', '台積電 NOT 股價')).toBe(false);
    expect(matchesAdvancedQuery('台積電徵才', '台積電 -徵才')).toBe(false);
  });
});

describe('transparent analysis statistics', () => {
  it('reads the pipeline sentiment without recomputing it in the browser', () => {
    expect(sentimentLabelOf({ label: 'positive', score: 1, matched: [] })).toBe('positive');
    expect(sentimentLabelOf('negative')).toBe('negative');
    expect(sentimentLabelOf(null)).toBe(null);
  });

  it('does not call a low-support one-source increase rising', () => {
    const stats = extractTermStats([
      article('台積電法說會展望', '2026-07-22T10:00:00Z'),
      article('台積電先進製程成長', '2026-07-22T11:30:00Z'),
      article('先進製程需求創高', '2026-07-22T11:40:00Z'),
    ], Date.parse('2026-07-22T11:00:00Z'), ['台積電']);
    expect(stats.top.some((term) => term.term === '先進製程')).toBe(true);
    expect(stats.rising.some((term) => term.term === '先進製程')).toBe(false);
  });

  it('uses the same one-hour slot on seven prior days and exposes the evidence', () => {
    const items = [
      ...Array.from({ length: 7 }, (_, index) => article(
        `先進製程基準${index + 1}`,
        new Date(Date.parse('2026-07-22T12:00:00Z') - (index + 1) * 24 * 60 * 60 * 1000 - 30 * 60 * 1000).toISOString(),
        'cna',
      )),
      article('歷史涵蓋證據', '2026-07-15T10:00:00Z', 'cna'),
      article('先進製程展望一', '2026-07-22T11:10:00Z', 'cna'),
      article('先進製程展望二', '2026-07-22T11:20:00Z', 'udn'),
      article('先進製程展望三', '2026-07-22T11:30:00Z', 'ltn'),
      article('先進製程展望四', '2026-07-22T11:40:00Z', 'cna'),
      article('先進製程展望五', '2026-07-22T11:50:00Z', 'udn'),
    ];
    const stats = extractTermStats(items, Date.parse('2026-07-22T12:00:00Z'));
    const rising = stats.rising.find((term) => term.term === '先進製程');
    expect(rising).toMatchObject({
      current: 5,
      sourceCount: 3,
      baseline: [1, 1, 1, 1, 1, 1, 1],
      baselineMedian: 1,
      change: 4,
      burstScore: 4,
    });
  });
});
