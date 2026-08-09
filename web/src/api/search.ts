import type {
  Envelope,
  NewsArchiveDay,
  NewsArchiveData,
  NewsArchiveIndexData,
  SearchArticle,
  SearchData,
  SearchMetrics,
  SearchRange,
  TrendsData,
} from '../types/contracts';
import { SUPPORTED_SCHEMA_MAJOR } from '../types/contracts';
import { fetchData, fetchPagesData } from './client';
import { matchesAdvancedQuery } from '../lib/analysis';
import { NEWS_SOURCE_IDS, sourceName } from '../lib/sources';

export interface HeatInput {
  volume: number;
  acceleration: number;
  diversity: number;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** 新聞熱度：聲量 50%、加速度 33%、來源多樣性 17%。 */
export function calculateNewsHeat(input: HeatInput): number {
  return Math.round(
    100 *
      (0.5 * clamp01(input.volume) +
        0.33 * clamp01(input.acceleration) +
        0.17 * clamp01(input.diversity)),
  );
}

function isEnvelope(value: unknown): value is Envelope<unknown> {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.schemaVersion === 'string' &&
    typeof candidate.generatedAt === 'string' &&
    candidate.data !== null &&
    typeof candidate.data === 'object'
  );
}

export function parseSearchResponse(value: unknown): Envelope<SearchData> {
  if (!isEnvelope(value)) throw new Error('搜尋資料格式不相容');
  if (Number.parseInt(value.schemaVersion.split('.')[0] ?? '', 10) !== SUPPORTED_SCHEMA_MAJOR) {
    throw new Error('搜尋資料格式不相容');
  }
  const data = value.data as Partial<SearchData>;
  if (
    typeof data.query !== 'string' ||
    typeof data.range !== 'string' ||
    !['ok', 'partial', 'stale', 'error'].includes(String(data.status)) ||
    typeof data.stale !== 'boolean' ||
    !data.metrics ||
    !Array.isArray(data.timeline) ||
    !Array.isArray(data.sources) ||
    !Array.isArray(data.items)
  ) {
    throw new Error('搜尋資料格式不相容');
  }
  return value as Envelope<SearchData>;
}

export function parseTrendsResponse(value: unknown): Envelope<TrendsData> {
  if (!isEnvelope(value)) throw new Error('趨勢資料格式不相容');
  if (Number.parseInt(value.schemaVersion.split('.')[0] ?? '', 10) !== SUPPORTED_SCHEMA_MAJOR) {
    throw new Error('趨勢資料格式不相容');
  }
  const data = value.data as Partial<TrendsData>;
  const validItems = Array.isArray(data.items) && data.items.every((item) =>
    item &&
    typeof item.title === 'string' &&
    typeof item.approximateTraffic === 'string' &&
    typeof item.publishedAt === 'string' &&
    Array.isArray(item.news) &&
    item.news.every((news) =>
      news &&
      typeof news.title === 'string' &&
      typeof news.source === 'string' &&
      typeof news.url === 'string' &&
      /^https?:\/\//.test(news.url),
    ),
  );
  if (
    data.geo !== 'TW' ||
    (data.source !== 'google-trends-rss' && data.source !== 'google-trends-realtime-and-rss') ||
    !validItems
  ) {
    throw new Error('趨勢資料格式不相容');
  }
  return value as Envelope<TrendsData>;
}

const RANGE_MS: Record<SearchRange, number> = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

const SOURCE_COUNT = NEWS_SOURCE_IDS.length;

export function buildStaticSearchData(
  allItems: SearchArticle[],
  query: string,
  range: SearchRange,
  now = Date.now(),
): SearchData {
  const cutoff = now - RANGE_MS[range];
  const items = allItems
    .filter((item) => Date.parse(item.publishedAt) >= cutoff)
    .filter((item) => matchesAdvancedQuery(`${item.title} ${item.excerpt}`, query.trim()))
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, 100);
  const sourceCounts = Object.fromEntries(
    [...new Set(items.map((item) => item.source))].map((source) => [
      source,
      items.filter((item) => item.source === source).length,
    ]),
  );
  const sourceCount = Object.keys(sourceCounts).length;
  const midpoint = now - RANGE_MS[range] / 2;
  const recent = items.filter((item) => Date.parse(item.publishedAt) >= midpoint).length;
  const previous = items.length - recent;
  const input = {
    volume: clamp01(items.length / SOURCE_COUNT),
    acceleration: items.length === 0
      ? 0
      : clamp01(0.5 + (recent - previous) / (2 * Math.max(1, recent, previous))),
    diversity: clamp01(sourceCount / SOURCE_COUNT),
  };
  const bucketCount = range === '1h' ? 6 : range === '6h' ? 12 : range === '12h' ? 12 : range === '24h' ? 24 : range === '7d' ? 28 : 30;
  const bucketMs = RANGE_MS[range] / bucketCount;
  const timeline = Array.from({ length: bucketCount }, (_, index) => {
    const start = now - RANGE_MS[range] + index * bucketMs;
    const end = start + bucketMs;
    const mentions = items.filter((item) => {
      const timestamp = Date.parse(item.publishedAt);
      return timestamp >= start && timestamp < end;
    }).length;
    return { t: new Date(start).toISOString(), mentions, heat: Math.min(100, mentions * 20) };
  });
  return {
    query: query.trim(),
    range,
    status: 'stale',
    stale: true,
    metrics: { ...input, heat: calculateNewsHeat(input), mentions: items.length, sourceCount },
    timeline,
    sourceCounts,
    sources: NEWS_SOURCE_IDS.map((id) => ({
      id,
      displayName: sourceName(id),
      status: 'stale' as const,
      itemCount: sourceCounts[id as keyof typeof sourceCounts] ?? 0,
      errorCode: 'STATIC_SNAPSHOT',
    })),
    items,
  };
}

export function selectArchiveDays(
  days: NewsArchiveDay[],
  range: SearchRange,
  now = Date.now(),
): NewsArchiveDay[] {
  const cutoff = now - RANGE_MS[range];
  return days.filter((day) => {
    const start = Date.parse(`${day.date}T00:00:00Z`);
    return Number.isFinite(start) && start + 24 * 60 * 60 * 1000 > cutoff && start <= now;
  });
}

async function loadStaticArchive(range: SearchRange): Promise<Envelope<NewsArchiveData>> {
  if (range !== '7d' && range !== '30d') {
    try {
      // 短範圍先讀最多 800 筆的近 24 小時檔，避免下載完整 7/30 天 archive。
      const recent = await fetchPagesData<{ items: SearchArticle[] }>('recent');
      return {
        schemaVersion: recent.schemaVersion,
        generatedAt: recent.generatedAt,
        data: { status: 'stale', stale: true, items: recent.data.items },
      };
    } catch {
      // recent 暫不可用時再走日分檔／舊版完整 archive。
    }
  }
  try {
    const index = await fetchPagesData<NewsArchiveIndexData>('news-archive-index');
    const selected = selectArchiveDays(index.data.days, range);
    const chunks = await Promise.all(
      selected.map((day) => fetchPagesData<NewsArchiveData>(day.file)),
    );
    return {
      schemaVersion: index.schemaVersion,
      generatedAt: index.generatedAt,
      data: {
        status: index.data.status,
        stale: index.data.stale,
        items: chunks.flatMap((chunk) => chunk.data.items),
      },
    };
  } catch {
    // 舊部署尚未提供 manifest 時，保留完整 archive 作相容備援。
    return fetchPagesData<NewsArchiveData>('news-archive');
  }
}

function apiBase(): string {
  return (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
}

export async function searchNews(query: string, range: SearchRange): Promise<Envelope<SearchData>> {
  const q = query.trim();
  if (q.length < 2 || q.length > 50) throw new Error('關鍵字需為 2 至 50 個字元');
  const base = apiBase();
  if (base) {
    try {
      const response = await fetch(`${base}/api/search?q=${encodeURIComponent(q)}&range=${range}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return parseSearchResponse(await response.json());
    } catch {
      // Worker 無法使用時，改讀 GitHub Pages 上一次成功快照。
    }
  }
  const snapshot = await loadStaticArchive(range);
  return {
    schemaVersion: snapshot.schemaVersion,
    generatedAt: snapshot.generatedAt,
    data: buildStaticSearchData(snapshot.data.items, q, range),
  };
}

export async function fetchTrends(): Promise<Envelope<TrendsData>> {
  const base = apiBase();
  if (base) {
    try {
      const response = await fetch(`${base}/api/trends`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return parseTrendsResponse(await response.json());
    } catch {
      // 改用 Pages 的最後成功趨勢快照。
    }
  }
  const snapshot = await fetchData<TrendsData>('trends');
  const parsed = parseTrendsResponse(snapshot);
  return { ...parsed, data: { ...parsed.data, status: 'stale', stale: true } };
}

export type { SearchMetrics };
