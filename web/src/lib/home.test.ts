import { describe, expect, it } from 'vitest';
import { buildHomeSnapshot, type HomeInputs } from './home';

const baseInput: HomeInputs = {
  meta: {
    status: 'ok',
    lastFastAt: '2026-07-26T01:00:00Z',
    lastDeepAt: '2026-07-26T00:50:00Z',
    methodVersion: 'v2',
    scheduleDaysUntilPause: 30,
    coverage: { keywordWindowHours: 24, trendBucketMinutes: 60, archiveDays: 7, sourceCount: 37 },
    stateRestoreFailed: false,
  },
  keywords: {
    keywords: [{
      id: 'k1',
      term: '台股',
      kind: 'manual',
      heat: 88,
      mentions24h: 12,
      components: {
        volume: 1,
        acceleration: 0.5,
        diversity: 0.5,
        weights: { volume: 0.5, acceleration: 0.33, diversity: 0.17 },
      },
      sourceShare: {},
      trend: [],
    }],
  },
  topics: {
    stale: false,
    experimental: true,
    topics: [{
      id: 'finance',
      label: '財經',
      terms: ['台股'],
      size: 12,
      summarySentences: [],
      sentiment: { positive: 0.2, neutral: 0.5, negative: 0.3 },
      articles: [],
    }],
  },
  entities: {
    stale: false,
    experimental: true,
    nodes: [{ id: 'person-1', name: '甲', type: 'PERSON', mentions: 4 }],
    edges: [],
  },
  recent: { items: [] },
  sources: {
    sources: [{
      id: 'cna',
      displayName: '中央社',
      status: 'ok',
      lastAttemptAt: null,
      lastSuccessAt: null,
      errorCode: null,
      stale: false,
      itemCount: 4,
    }],
  },
};

describe('buildHomeSnapshot', () => {
  it('summarizes counts without changing source data', () => {
    const result = buildHomeSnapshot(baseInput);
    expect(result.sourceCount).toBe(1);
    expect(result.keywordMentionCount24h).toBe(12);
    expect(result.topKeyword?.term).toBe('台股');
    expect(result.topTopic?.label).toBe('財經');
  });

  it('returns null cards for empty datasets and counts stale sources', () => {
    const result = buildHomeSnapshot({
      ...baseInput,
      meta: null,
      keywords: { keywords: [] },
      topics: { stale: true, experimental: true, topics: [] },
      entities: { stale: true, experimental: true, nodes: [], edges: [] },
      sources: {
        sources: [{
          ...baseInput.sources.sources[0],
          status: 'stale',
          stale: true,
          errorCode: 'TIMEOUT',
          itemCount: 0,
        }],
      },
    });
    expect(result.topKeyword).toBeNull();
    expect(result.topTopic).toBeNull();
    expect(result.staleSourceCount).toBe(1);
  });
});
