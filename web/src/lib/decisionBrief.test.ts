import { describe, expect, it } from 'vitest';
import type { HomeInputs } from './home';
import { buildDecisionBrief } from './decisionBrief';

const now = '2026-08-06T12:00:00Z';

const baseInput: HomeInputs = {
  meta: {
    status: 'ok',
    lastFastAt: now,
    lastDeepAt: now,
    methodVersion: 'v3',
    scheduleDaysUntilPause: 30,
    coverage: { keywordWindowHours: 24, trendBucketMinutes: 60, archiveDays: 7, sourceCount: 37 },
    stateRestoreFailed: false,
  },
  keywords: {
    keywords: [{
      id: 'tsmc',
      term: '台積電',
      kind: 'manual',
      heat: 88,
      mentions24h: 24,
      burstCurrent: 8,
      burstSourceCount: 4,
      burstBaseline: [1, 1, 2, 1, 2, 1, 1],
      burstBaselineMedian: 1,
      burstScore: 7,
      components: {
        volume: 0.9,
        acceleration: 0.8,
        diversity: 0.7,
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
      label: '財經與產業',
      terms: ['台積電'],
      size: 42,
      summarySentences: [],
      sentiment: { positive: 0.2, neutral: 0.6, negative: 0.2 },
      articles: [],
    }],
  },
  entities: { stale: false, experimental: true, nodes: [], edges: [] },
  recent: {
    items: [
      { id: '1', source: 'cna', title: '台積電法說會釋出新展望', excerpt: '', publishedAt: '2026-08-06T11:40:00Z', url: 'https://example.com/1' },
      { id: '2', source: 'ltn', title: '台積電供應鏈持續升溫', excerpt: '', publishedAt: '2026-08-06T11:10:00Z', url: 'https://example.com/2' },
    ],
  },
  sources: {
    sources: [
      { id: 'cna', displayName: '中央社', status: 'ok', lastAttemptAt: now, lastSuccessAt: now, errorCode: null, stale: false, itemCount: 12 },
      { id: 'ltn', displayName: '自由時報', status: 'ok', lastAttemptAt: now, lastSuccessAt: now, errorCode: null, stale: false, itemCount: 9 },
    ],
  },
};

describe('buildDecisionBrief', () => {
  it('prioritizes a rising keyword and returns three actionable signals', () => {
    const result = buildDecisionBrief(baseInput, now);

    expect(result).toMatchObject({
      confidence: 'good',
      headline: '「台積電」議題近期聲量升溫',
      primaryAction: { to: '/search?q=%E5%8F%B0%E7%A9%8D%E9%9B%BB', label: '即時搜尋「台積電」新聞' },
    });
    expect(result.summary).toContain('前 7 日同時段中位數 1');
    expect(result.signals.map((signal) => signal.kind)).toEqual(['momentum', 'topic', 'coverage']);
  });

  it('falls back to the hottest keyword when nothing is rising', () => {
    const result = buildDecisionBrief({
      ...baseInput,
      keywords: {
        keywords: baseInput.keywords.keywords.map((keyword) => ({ ...keyword, burstScore: null })),
      },
      recent: { items: [] },
    }, now);

    expect(result.headline).toBe('「台積電」為目前最高熱度關鍵字');
    expect(result.summary).toContain('熱度 88');
    expect(result.primaryAction.to).toBe('/search?q=%E5%8F%B0%E7%A9%8D%E9%9B%BB');
  });

  it('uses limited confidence and explicit wording for stale analysis', () => {
    const result = buildDecisionBrief({
      ...baseInput,
      keywords: { ...baseInput.keywords, stale: true },
      topics: { ...baseInput.topics, stale: true },
    }, now);

    expect(result.confidence).toBe('limited');
    expect(result.summary).toContain('深度分析資料延遲');
  });

  it('handles zero sources without dividing by zero', () => {
    const result = buildDecisionBrief({ ...baseInput, sources: { sources: [] } }, now);

    expect(result.confidence).toBe('limited');
    expect(result.signals.find((signal) => signal.kind === 'coverage')).toMatchObject({
      value: '0 / 0',
      detail: '尚未取得來源狀態',
      to: '/method',
    });
  });

  it('cannot claim good confidence when a required dataset is unavailable', () => {
    const result = buildDecisionBrief(baseInput, now, {
      meta: true,
      keywords: false,
      topics: true,
      recent: true,
      sources: true,
    });

    expect(result.confidence).toBe('limited');
    expect(result.summary).toContain('部分必要資料尚未取得');
  });

  it('returns an actionable empty state when no analysis data exists', () => {
    const result = buildDecisionBrief({
      ...baseInput,
      meta: null,
      keywords: { keywords: [] },
      topics: { stale: false, experimental: true, topics: [] },
      recent: { items: [] },
      sources: { sources: [] },
    }, null);

    expect(result.headline).toBe('等待下一批新聞訊號');
    expect(result.signals).toEqual([]);
    expect(result.primaryAction).toEqual({ to: '/search', label: '主動搜尋新聞' });
  });

  it('cannot label a fully loaded but empty snapshot as complete', () => {
    const result = buildDecisionBrief({
      ...baseInput,
      keywords: { keywords: [] },
      topics: { stale: false, experimental: true, topics: [] },
      recent: { items: [] },
      sources: { sources: [baseInput.sources.sources[0]] },
    }, now);

    expect(result.confidence).toBe('limited');
    expect(result.headline).toBe('等待下一批新聞訊號');
  });
});
