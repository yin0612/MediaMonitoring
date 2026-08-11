import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SearchArticle } from '../types/contracts';
import {
  buildStaticSearchData,
  calculateNewsHeat,
  fetchTrends,
  parseSearchResponse,
  parseTrendsResponse,
  searchNews,
  selectArchiveDays,
} from './search';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('calculateNewsHeat', () => {
  it('uses only volume, acceleration, and source diversity', () => {
    expect(calculateNewsHeat({ volume: 1, acceleration: 0.5, diversity: 0 })).toBe(67);
  });

  it('clamps every component to zero through one hundred', () => {
    expect(calculateNewsHeat({ volume: 2, acceleration: -1, diversity: 1 })).toBe(67);
  });
});

describe('static snapshot fallback', () => {
  it('uses the small recent snapshot for ranges up to 24 hours', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    const requested: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      requested.push(String(input));
      return new Response(JSON.stringify({
        schemaVersion: '2.1.0',
        generatedAt: '2026-07-22T12:00:00Z',
        data: {
          items: [{
            id: '1',
            source: 'cna',
            title: '台積電公布法說會資訊',
            excerpt: '摘要',
            publishedAt: new Date().toISOString(),
            url: 'https://example.com/1',
            sentiment: null,
          }],
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));

    await searchNews('台積電', '24h');

    expect(requested.some((url) => url.endsWith('/data/recent.json'))).toBe(true);
    expect(requested.some((url) => url.endsWith('/data/news-archive.json'))).toBe(false);
  });

  it('reads recent directly from Pages after Worker search fails', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://worker.example');
    const requested: string[] = [];
    const now = Date.now();
    const article = (id: string, publishedAt: number) => ({
      id,
      source: 'cna',
      title: `台積電新聞 ${id}`,
      excerpt: '',
      publishedAt: new Date(publishedAt).toISOString(),
      url: `https://example.com/${id}`,
      sentiment: null,
    });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requested.push(url);
      if (url.startsWith('https://worker.example/api/search')) {
        return new Response('', { status: 503 });
      }
      if (url.startsWith('https://worker.example/api/data?name=recent')) {
        return Response.json({
          schemaVersion: '2.1.0',
          generatedAt: new Date().toISOString(),
          data: { items: [article('worker-truncated', now - 180_000)] },
        });
      }
      if (url.endsWith('/data/recent.json')) {
        return Response.json({
          schemaVersion: '2.1.0',
          generatedAt: new Date().toISOString(),
          data: {
            items: [
              article('pages-1', now - 120_000),
              article('pages-2', now - 60_000),
            ],
          },
        });
      }
      return new Response('', { status: 404 });
    }));

    const result = await searchNews('台積電', '24h');

    expect(result.data.items.map((item) => item.id)).toEqual(['pages-2', 'pages-1']);
    expect(requested.some((url) => url.includes('/api/data?name=recent'))).toBe(false);
    expect(requested.some((url) => url.endsWith('/data/recent.json'))).toBe(true);
  });

  it('loads only the daily chunks needed by the requested range', () => {
    const days = [
      { date: '2026-07-22', count: 10, file: 'news-archive/2026-07-22' },
      { date: '2026-07-21', count: 20, file: 'news-archive/2026-07-21' },
      { date: '2026-07-20', count: 30, file: 'news-archive/2026-07-20' },
    ];

    expect(selectArchiveDays(days, '24h', Date.parse('2026-07-22T12:00:00Z'))).toHaveLength(2);
    expect(selectArchiveDays(days, '7d', Date.parse('2026-07-22T12:00:00Z'))).toHaveLength(3);
  });

  it('filters the last-good archive without claiming it is live', () => {
    const data = buildStaticSearchData(
      [
        {
          id: '1',
          source: 'cna',
          title: '台積電公布法說會資訊',
          excerpt: '摘要',
          publishedAt: '2026-07-22T11:30:00Z',
          url: 'https://example.com/1',
          sentiment: null,
        },
        {
          id: '2',
          source: 'ltn',
          title: '天氣快訊',
          excerpt: '摘要',
          publishedAt: '2026-07-22T11:20:00Z',
          url: 'https://example.com/2',
          sentiment: null,
        },
      ],
      '台積電',
      '24h',
      Date.parse('2026-07-22T12:00:00Z'),
    );

    expect(data.status).toBe('stale');
    expect(data.stale).toBe(true);
    expect(data.items).toHaveLength(1);
  });

  it('marks an incomplete 30-day static archive with an explicit coverage window', () => {
    const now = Date.parse('2026-07-22T12:00:00Z');
    const data = buildStaticSearchData([{
      id: '1', source: 'cna', title: '台積電十日前新聞', excerpt: '',
      publishedAt: '2026-07-12T12:00:00Z', url: 'https://example.com/1', sentiment: null,
    }], '台積電', '30d', now);

    expect(data.status).toBe('stale');
    expect(data.coverage).toMatchObject({
      requestedFrom: '2026-06-22T12:00:00.000Z',
      requestedTo: '2026-07-22T12:00:00.000Z',
      actualFrom: '2026-07-12T12:00:00.000Z',
      actualTo: '2026-07-12T12:00:00.000Z',
      coveredDays: 1,
      complete: false,
    });
  });

  it('returns zero heat when no article matches', () => {
    const data = buildStaticSearchData([], '不存在詞', '24h', Date.parse('2026-07-22T12:00:00Z'));
    expect(data.metrics.mentions).toBe(0);
    expect(data.metrics.heat).toBe(0);
  });

  it('validates the Taiwan trends source identity', () => {
    expect(() =>
      parseTrendsResponse({
        schemaVersion: '2.0.0',
        generatedAt: '2026-07-22T00:00:00Z',
        data: { geo: 'US', source: 'other', items: [] },
      }),
    ).toThrow('趨勢資料格式不相容');
  });

  it('rejects malformed Google Trends related-news metadata', () => {
    expect(() => parseTrendsResponse({
      schemaVersion: '2.0.0',
      generatedAt: '2026-07-22T00:00:00Z',
      data: {
        geo: 'TW', source: 'google-trends-rss', status: 'ok', stale: false,
        sourceUrl: 'https://trends.google.com/',
        items: [{
          title: 'short selling', approximateTraffic: '200+', publishedAt: '2026-07-22T00:00:00Z',
          news: [{ title: 'news', source: 'publisher' }],
        }],
      },
    })).toThrow('趨勢資料格式不相容');
  });
});

describe('fetchTrends', () => {
  it('combines Pages realtime topics with the current Worker RSS topics', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://worker.example');
    const requested: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requested.push(url);
      if (url === 'https://worker.example/api/trends') {
        return Response.json({
          schemaVersion: '2.0.0',
          generatedAt: '2026-08-09T14:40:00Z',
          data: {
            geo: 'TW',
            status: 'ok',
            stale: false,
            source: 'google-trends-rss',
            sourceUrl: 'https://trends.google.com/trending/rss?geo=TW&hl=zh-TW',
            items: [{
              title: 'Worker 最新 RSS',
              approximateTraffic: '500+',
              publishedAt: '2026-08-09T14:30:00Z',
              news: [],
            }],
          },
        });
      }
      if (url.endsWith('/data/trends.json')) {
        return Response.json({
          schemaVersion: '2.1.0',
          generatedAt: '2026-08-09T14:39:00Z',
          data: {
            geo: 'TW',
            status: 'ok',
            stale: false,
            source: 'google-trends-realtime-and-rss',
            sourceUrl: 'https://trends.google.com/trending?geo=TW&hl=zh-TW',
            items: [
              {
                title: 'Pages 網頁即時榜',
                approximateTraffic: '10,000+',
                publishedAt: '',
                isRealtime: true,
                news: [],
              },
              {
                title: 'Pages 較舊 RSS',
                approximateTraffic: '200+',
                publishedAt: '2026-08-09T14:20:00Z',
                isRealtime: false,
                news: [],
              },
            ],
          },
        });
      }
      return new Response('', { status: 404 });
    }));

    const result = await fetchTrends();

    expect(requested).toEqual(expect.arrayContaining([
      'https://worker.example/api/trends',
      '/data/trends.json',
    ]));
    expect(requested).toHaveLength(2);
    expect(result.data.source).toBe('google-trends-realtime-and-rss');
    expect(result.data.sourceUrl).toBe('https://trends.google.com/trending?geo=TW&hl=zh-TW');
    expect(result.data.items.map((item) => item.title)).toEqual([
      'Pages 網頁即時榜',
      'Worker 最新 RSS',
    ]);
    expect(result.data.stale).toBe(false);
  });
});

describe('parseSearchResponse', () => {
  it('accepts a partial response and preserves failed source details', () => {
    const parsed = parseSearchResponse({
        schemaVersion: '2.0.0',
      generatedAt: '2026-07-22T00:00:00Z',
      data: {
        query: '台積電',
        range: '24h',
        status: 'partial',
        stale: false,
        metrics: {
          heat: 72,
          mentions: 4,
          sourceCount: 2,
          volume: 0.8,
          acceleration: 0.6,
          diversity: 0.4,
        },
        timeline: [],
        sourceCounts: { cna: 2, ltn: 2 },
        sources: [
          { id: 'cna', displayName: '中央社', status: 'ok', itemCount: 2, errorCode: null },
          { id: 'tvbs', displayName: 'TVBS', status: 'error', itemCount: 0, errorCode: 'HTTP_403' },
        ],
        items: [],
      },
    });

    expect(parsed.data.status).toBe('partial');
    expect(parsed.data.sources[1].errorCode).toBe('HTTP_403');
  });

  it('rejects malformed payloads instead of guessing fields', () => {
    expect(() => parseSearchResponse({ data: { query: '台積電' } })).toThrow('搜尋資料格式不相容');
  });

  it('rejects a different schema major version', () => {
    expect(() =>
      parseSearchResponse({
        schemaVersion: '1.9.0',
        generatedAt: '2026-07-22T00:00:00Z',
        data: {
          query: '台積電', range: '24h', status: 'ok', stale: false, metrics: {},
          timeline: [], sources: [], items: [],
        },
      }),
    ).toThrow('搜尋資料格式不相容');
  });
});

describe('search statistics describe every match, not just the returned page', () => {
  const sources: SearchArticle['source'][] = ['tvbs', 'cna', 'ltn', 'udn'];
  // minutesAgo 從 1 起算：時間桶是半開區間 [start, end)，剛好等於 now 的項目
  // 不屬於任何一桶，而真實新聞的發布時間一律在過去。
  const article = (index: number, minutesAgo: number): SearchArticle => ({
    id: `a${index}`,
    source: sources[index % sources.length],
    title: `颱風動態 ${index}`,
    excerpt: '',
    publishedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    url: `https://example.com/${index}`,
    sentiment: null,
  });

  it('reports the true mention count when matches exceed the 100-item page', () => {
    // 先前先 slice(0,100) 再算 metrics，命中 250 篇時聲量會顯示 100。
    const items = Array.from({ length: 250 }, (_, i) => article(i, i + 1));

    const data = buildStaticSearchData(items, '颱風', '24h');

    expect(data.items).toHaveLength(100);
    expect(data.metrics.mentions).toBe(250);
    expect(data.timeline.reduce((sum, point) => sum + point.mentions, 0)).toBe(250);
    // sourceCounts 也要涵蓋全部命中，而不是前 100 筆。
    expect(Object.values(data.sourceCounts).reduce((a, b) => a + b, 0)).toBe(250);
  });

  it('still reports honest numbers when matches fit inside one page', () => {
    const items = [article(0, 5), article(1, 10)];

    const data = buildStaticSearchData(items, '颱風', '24h');

    expect(data.metrics.mentions).toBe(2);
    expect(data.metrics.sourceCount).toBe(2);
  });
});
