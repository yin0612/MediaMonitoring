import { describe, expect, it } from 'vitest';
import type { SearchArticle } from '../types/contracts';
import { extractTermStats, matchesAdvancedQuery, sentimentLabelOf } from './analysis';

const article = (title: string, publishedAt: string): SearchArticle => ({
  id: title, source: 'cna', title, excerpt: '', publishedAt,
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

  it('returns frequent and rising terms from article halves', () => {
    const stats = extractTermStats([
      article('台積電法說會展望', '2026-07-22T10:00:00Z'),
      article('台積電先進製程成長', '2026-07-22T11:30:00Z'),
      article('先進製程需求創高', '2026-07-22T11:40:00Z'),
    ], Date.parse('2026-07-22T11:00:00Z'), ['台積電']);
    expect(stats.top.some((term) => term.term === '先進製程')).toBe(true);
    expect(stats.rising.some((term) => term.term === '先進製程')).toBe(true);
  });
});
