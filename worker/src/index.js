import {
  calculateMetrics,
  dedupeSnapshot,
  filterAndDedupe,
  parseGoogleNewsRss,
  parseRss,
  parseTrendsRss,
  timelineFor,
  validateQuery,
} from './core.js';
import { withSentiment } from './analysis.js';
import { NEWS_SOURCES } from './sources.js';
import { persistSnapshotArticles, queryHistoricalArticles, queryHistoricalCoverage } from './storage.js';

const TRENDS_URL = 'https://trends.google.com/trending/rss?geo=TW&hl=zh-TW';
// 正式站身分只在這裡定義一次；wrangler.toml 的 vars 才是部署時的權威值。
// 先前這兩個字串在檔內散落 8 份且殘留舊帳號，var 一漏設就會安靜地去讀別人的站。
const DEFAULT_PAGES_ORIGIN = 'https://yin0612.github.io';
const DEFAULT_ARCHIVE_BASE_URL = `${DEFAULT_PAGES_ORIGIN}/MediaMonitoring`;
const USER_AGENT = `MediaMonitoring/1.0 (+${DEFAULT_ARCHIVE_BASE_URL}/)`;
const archiveBase = (env) => (env.ARCHIVE_BASE_URL || DEFAULT_ARCHIVE_BASE_URL).replace(/\/$/, '');
const SNAPSHOT_SCHEMA = '2.1.0';
const SNAPSHOT_KEY = 'snapshot';
const DAY_MS = 86_400_000;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const REFRESH_COOLDOWN_MS = 5 * 60 * 1000;
const DEEP_REFRESH_COOLDOWN_MS = 15 * 60 * 1000;
const FAST_SCHEDULE_MINUTES = 5;
const DEEP_SCHEDULE_MINUTES = 15;
const RECENT_ITEMS_CAP = 120;
const REFRESH_BODY_MAX_BYTES = 4_096;
const TURNSTILE_ACTION = 'manual_refresh';
const SOURCE_HEALTH_MAX_AGE_MS = 30 * 60 * 1000;
const DEEP_SNAPSHOT_MAX_AGE_MS = SOURCE_HEALTH_MAX_AGE_MS;
// Worker 僅保留最近 600 篇做即時合併與逐篇情緒；CPU 較重的
// keywords／entities／topics 統一由 GitHub Actions / Python 產生。
const MAX_ANALYSIS_ITEMS = 600;
// 搜尋回傳的文章上限。統計不受此限制，一律以全部命中計算（見 handleSearch）。
const MAX_SEARCH_ITEMS = 100;
// 7 天完整 archive 不由 Worker 提供（CPU/KV 成本），由 Pages 靜態檔與 /api/search 負責。
const DATA_FILES = new Set(['meta', 'keywords', 'sources', 'recent', 'entities', 'topics', 'events']);
const googleNewsUrl = (query, range = '24h') => {
  const whenMap = { '1h': '1h', '6h': '6h', '12h': '12h', '24h': '1d', '7d': '7d', '30d': '30d' };
  const when = whenMap[range] || '1d';
  const url = new URL('https://news.google.com/rss/search');
  url.searchParams.set('q', `${query} when:${when}`);
  url.searchParams.set('hl', 'zh-TW');
  url.searchParams.set('gl', 'TW');
  url.searchParams.set('ceid', 'TW:zh-Hant');
  return url.toString();
};

const rssUrls = (source) => (Array.isArray(source.rssUrls) ? source.rssUrls : source.rssUrl ? [source.rssUrl] : []);

async function fetchOfficialItems(source, attempts = 2) {
  const urls = rssUrls(source);
  if (!urls.length) return { items: [], ok: false, errorCode: null };
  const results = await Promise.allSettled(urls.map(async (url) => parseRss(await fetchText(url, attempts), source.id)));
  const parsedFeeds = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
  const items = parsedFeeds.flatMap((result) => result.isFeedDocument ? result.items : []);
  const rejected = results.find((result) => result.status === 'rejected');
  if (items.length) return { items, ok: true, errorCode: rejected?.reason?.message || null };
  if (parsedFeeds.some((result) => result.isFeedDocument && result.entryCount > 0)) {
    return { items: [], ok: false, errorCode: 'NO_VALID_ITEMS' };
  }
  if (parsedFeeds.some((result) => result.isFeedDocument && result.entryCount === 0)) {
    return { items: [], ok: true, errorCode: null };
  }
  return {
    items: [],
    ok: false,
    errorCode: rejected?.reason?.message || 'EMPTY_OR_BAD_FEED',
  };
}

const envelopeTimestamp = (value) => {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
};

const envelopeWindow = (data, generatedAt) => {
  const coverage = data?.coverage;
  const coveredFrom = envelopeTimestamp(coverage?.actualFrom);
  const coveredTo = envelopeTimestamp(coverage?.actualTo);
  if (coveredFrom || coveredTo) return { actualFrom: coveredFrom, actualTo: coveredTo || generatedAt };

  const timestamps = (Array.isArray(data?.items) ? data.items : [])
    .map((item) => Date.parse(String(item?.publishedAt || '')))
    .filter(Number.isFinite);
  return {
    actualFrom: timestamps.length ? new Date(Math.min(...timestamps)).toISOString() : null,
    actualTo: timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : generatedAt,
  };
};

const envelope = (data) => {
  const generatedAt = new Date().toISOString();
  return {
    schemaVersion: '2.0.0',
    generatedAt,
    pipeline: 'worker-live',
    window: envelopeWindow(data, generatedAt),
    quality: { status: data?.status || (data?.stale ? 'stale' : 'available') },
    provenance: { method: 'worker-public-metadata', reproducible: true },
    data,
  };
};

const corsHeaders = (request, env) => {
  const origin = request.headers.get('Origin') || '';
  const allowed = env.ALLOWED_ORIGIN || DEFAULT_PAGES_ORIGIN;
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    'Access-Control-Allow-Origin': origin === allowed || isLocal ? origin : allowed,
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
};

const isAllowedOrigin = (request, env) => {
  const origin = request.headers.get('Origin') || '';
  const allowed = env.ALLOWED_ORIGIN || DEFAULT_PAGES_ORIGIN;
  return origin === allowed || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
};

const securityHeaders = {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

const json = (request, env, body, status = 200, cacheSeconds = 0) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheSeconds ? `public, max-age=${cacheSeconds}` : 'no-store',
      ...securityHeaders,
      ...corsHeaders(request, env),
    },
  });

async function fetchText(url, attempts = 2, timeoutMs = 5_000) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/rss+xml, application/xml, text/xml, */*',
          'Accept-Language': 'zh-TW,zh;q=0.9',
          'User-Agent': USER_AGENT,
        },
      });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 150));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

async function archiveItems(env, range = '24h') {
  const base = archiveBase(env);
  const preferred = ['7d', '30d'].includes(range) ? 'news-archive' : 'recent';
  const load = async (name) => {
    const response = await fetch(`${base}/data/${name}.json`);
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const body = await response.json();
    return {
      items: Array.isArray(body?.data?.items) ? body.data.items : [],
      generatedAt: typeof body?.generatedAt === 'string' ? body.generatedAt : null,
      status: typeof body?.data?.status === 'string' ? body.data.status : 'partial',
      stale: body?.data?.stale !== false,
      file: name,
    };
  };
  const loadDailyArchive = async () => {
    const indexResponse = await fetch(`${base}/data/news-archive-index.json`);
    if (!indexResponse.ok) throw new Error(`HTTP_${indexResponse.status}`);
    const index = await indexResponse.json();
    const days = Array.isArray(index?.data?.days) ? index.data.days : [];
    const requestedDays = range === '30d' ? 30 : 7;
    const cutoff = Date.now() - requestedDays * DAY_MS;
    const selected = days.filter((day) => {
      const timestamp = Date.parse(`${String(day?.date || '')}T23:59:59Z`);
      return Number.isFinite(timestamp) && timestamp >= cutoff - DAY_MS;
    });
    if (!selected.length) throw new Error('EMPTY_ARCHIVE_INDEX');
    const chunks = await Promise.all(selected.map(async (day) => {
      const file = String(day?.file || '').replace(/^\/+/, '');
      const response = await fetch(`${base}/data/${file}.json`);
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      const body = await response.json();
      return {
        items: Array.isArray(body?.data?.items) ? body.data.items : [],
        status: body?.data?.status,
        stale: body?.data?.stale,
        generatedAt: body?.generatedAt,
      };
    }));
    return {
      items: chunks.flatMap((chunk) => chunk.items),
      generatedAt: typeof index?.generatedAt === 'string' ? index.generatedAt : null,
      status: chunks.every((chunk) => chunk.status === 'ok') ? 'ok' : 'partial',
      stale: chunks.some((chunk) => chunk.stale !== false),
      file: 'news-archive-daily',
    };
  };
  try {
    if (preferred === 'news-archive') {
      try {
        return await loadDailyArchive();
      } catch {
        return await load(preferred);
      }
    }
    return await load(preferred);
  } catch {
    if (preferred === 'news-archive') {
      return { items: [], generatedAt: null, status: 'error', stale: true, file: preferred };
    }
    // 舊部署尚未提供 recent 時，才退回完整 archive。
    try {
      return await load('news-archive');
    } catch {
      return { items: [], generatedAt: null, status: 'error', stale: true, file: 'news-archive' };
    }
  }
}

function coverageFromItems(items, now, requestedDays) {
  const timestamps = items
    .map((item) => Date.parse(String(item?.publishedAt || '')))
    .filter(Number.isFinite)
    .filter((timestamp) => timestamp <= now + FUTURE_TOLERANCE_MS);
  const requestedFromMs = now - requestedDays * DAY_MS;
  const coveredDays = new Set(
    timestamps
      .filter((timestamp) => timestamp >= requestedFromMs)
      .map((timestamp) => new Date(timestamp).toISOString().slice(0, 10)),
  ).size;
  return {
    actualFrom: timestamps.length ? new Date(Math.min(...timestamps)).toISOString() : null,
    actualTo: timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null,
    articleCount: items.length,
    coveredDays,
  };
}

function coverageIsComplete(coverage, requestedDays, now) {
  const requestedFromMs = now - requestedDays * DAY_MS;
  const actualFromMs = Date.parse(coverage?.actualFrom || '');
  const actualToMs = Date.parse(coverage?.actualTo || '');
  return coverage?.articleCount > 0
    && coverage.coveredDays >= requestedDays
    && actualFromMs <= requestedFromMs + DAY_MS
    && actualToMs >= now - DAY_MS;
}

/** 取 Pages recent.json（Actions 產出的近 24 小時清單）補齊 Worker 未即時抓取的 14 家來源。 */
async function pagesRecentItems(env) {
  const base = archiveBase(env);
  try {
    const response = await fetch(`${base}/data/recent.json`);
    if (!response.ok) return [];
    const body = await response.json();
    return Array.isArray(body?.data?.items) ? body.data.items : [];
  } catch {
    return [];
  }
}

/** 深度分析由 GitHub Actions/Python 產生；Worker 只搬運公開快照，避免 Free Cron 超過 10 ms CPU。 */
async function pagesSourceStates(env) {
  const base = archiveBase(env);
  try {
    const response = await fetch(`${base}/data/sources.json`);
    if (!response.ok) return new Map();
    const body = await response.json();
    const now = Date.now();
    const generatedAt = Date.parse(body?.generatedAt);
    if (
      typeof body?.schemaVersion !== 'string'
      || !Number.isFinite(generatedAt)
      || generatedAt < now - SOURCE_HEALTH_MAX_AGE_MS
      || generatedAt > now + FUTURE_TOLERANCE_MS
      || !Array.isArray(body?.data?.sources)
    ) {
      return new Map();
    }
    const knownSourceIds = new Set(NEWS_SOURCES.map((source) => source.id));
    const sourceStates = new Map();
    for (const source of body.data.sources) {
      if (
        !isTrustworthyPageSourceState(source, now)
        || !knownSourceIds.has(source.id)
        || sourceStates.has(source.id)
      ) {
        return new Map();
      }
      sourceStates.set(source.id, source);
    }
    return sourceStates;
  } catch {
    return new Map();
  }
}

function isTrustworthyPageSourceState(source, now) {
  const nullableTimestamp = (value) => value === null
    || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
  const trustworthyAttempt = (value) => {
    if (typeof value !== 'string') return false;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp)
      && timestamp >= now - SOURCE_HEALTH_MAX_AGE_MS
      && timestamp <= now + FUTURE_TOLERANCE_MS;
  };
  const nullableErrorCode = (value) => value === null || (typeof value === 'string' && value.length > 0);
  return Boolean(
    source
    && typeof source.id === 'string'
    && source.id.trim()
    && ['ok', 'empty', 'degraded', 'stale', 'error'].includes(source.status)
    && typeof source.stale === 'boolean'
    && Object.hasOwn(source, 'lastAttemptAt')
    && trustworthyAttempt(source.lastAttemptAt)
    && ['lastSuccessAt', 'lastCrawlAt'].every(
      (key) => Object.hasOwn(source, key) && nullableTimestamp(source[key]),
    )
    && Object.hasOwn(source, 'errorCode')
    && nullableErrorCode(source.errorCode)
    && (
      (['ok', 'empty', 'degraded'].includes(source.status) && source.stale === false && source.errorCode === null)
      || (['stale', 'error'].includes(source.status) && source.stale === true)
    )
    && ['official-rss', 'google-news', 'site-listing'].includes(source.accessMode)
  );
}

async function pagesAnalysisEnvelope(env, name) {
  const base = archiveBase(env);
  try {
    const response = await fetch(`${base}/data/${name}.json`);
    if (!response.ok) return null;
    const body = await response.json();
    if (!body?.data || typeof body.schemaVersion !== 'string') return null;
    const timestamp = Date.parse(body.generatedAt);
    const now = Date.now();
    if (
      !Number.isFinite(timestamp)
      || timestamp < now - DEEP_SNAPSHOT_MAX_AGE_MS
      || timestamp > now + FUTURE_TOLERANCE_MS
    ) {
      return staleAnalysisEnvelope(body);
    }
    return body;
  } catch {
    return null;
  }
}

function staleAnalysisEnvelope(envelope) {
  if (!envelope?.data || typeof envelope.data !== 'object') return envelope;
  return { ...envelope, data: { ...envelope.data, stale: true } };
}

async function handleSearch(request, env, url) {
  let input;
  try {
    input = validateQuery(url.searchParams.get('q'), url.searchParams.get('range') || '24h');
  } catch (error) {
    return json(request, env, { error: error.message }, 400);
  }

  const historicalRange = ['7d', '30d'].includes(input.range);
  // Historical ranges are contractually D1-backed. A Pages archive is only a
  // degraded recovery path when the index is unavailable, never a complete
  // substitute that can silently claim full 7/30-day coverage.
  let historicalIndexFailed = historicalRange && !env.DB;
  if (env.DB && historicalRange) {
    try {
      const now = Date.now();
      const [indexed, historicalCoverage] = await Promise.all([
        queryHistoricalArticles(env.DB, input.range, now, input.query),
        queryHistoricalCoverage(env.DB, input.range, now),
      ]);
      const requestedDays = input.range === '30d' ? 30 : 7;
      let historicalItems = indexed;
      let effectiveCoverage = historicalCoverage;
      let pagesArchiveHealthy = true;
      // D1 is authoritative when complete. If it only contains a partial
      // retention window, merge the verified Pages archive for this account;
      // this keeps a successful but incomplete D1 query from hiding history.
      if (env.ARCHIVE_BASE_URL && !coverageIsComplete(historicalCoverage, requestedDays, now)) {
        const pagesArchive = await archiveItems(env, input.range);
        pagesArchiveHealthy = pagesArchive.status === 'ok' && pagesArchive.stale === false;
        if (pagesArchive.items.length) {
          historicalItems = [...indexed, ...pagesArchive.items];
          effectiveCoverage = coverageFromItems(historicalItems, now, requestedDays);
        }
      }
      const matched = filterAndDedupe(historicalItems, input.query, input.range);
      const items = matched.slice(0, MAX_SEARCH_ITEMS).map((item) => (
        item.sentiment ? item : withSentiment(item)
      ));
      const sourceCounts = {};
      for (const item of matched) sourceCounts[item.source] = (sourceCounts[item.source] || 0) + 1;
      const snapshot = await readSnapshot(env);
      const snapshotSources = snapshot?.files?.sources?.data?.sources;
      const sources = Array.isArray(snapshotSources)
        ? snapshotSources
        : NEWS_SOURCES.map((source) => ({
          id: source.id,
          displayName: source.displayName,
          status: 'degraded',
          itemCount: sourceCounts[source.id] || 0,
          errorCode: 'SOURCE_HEALTH_UNAVAILABLE',
        }));
      const requestedFromMs = now - requestedDays * DAY_MS;
      const coverageComplete = pagesArchiveHealthy
        && coverageIsComplete(effectiveCoverage, requestedDays, now);
      return json(request, env, envelope({
        query: input.query,
        range: input.range,
        status: coverageComplete && Array.isArray(snapshotSources) ? 'ok' : 'partial',
        stale: !pagesArchiveHealthy,
        coverage: {
          requestedFrom: new Date(requestedFromMs).toISOString(),
          requestedTo: new Date(now).toISOString(),
          actualFrom: effectiveCoverage.actualFrom,
          actualTo: effectiveCoverage.actualTo,
          complete: coverageComplete,
          articleCount: effectiveCoverage.articleCount,
          coveredDays: effectiveCoverage.coveredDays,
        },
        metrics: calculateMetrics(matched, input.range, now, NEWS_SOURCES.length),
        timeline: timelineFor(matched, input.range, now),
        sourceCounts,
        sources,
        items,
      }));
    } catch (error) {
      historicalIndexFailed = true;
      console.error(JSON.stringify({ event: 'd1_search_failed', range: input.range, error: error?.message }));
    }
  }

  const officialRuns = await Promise.all(
    NEWS_SOURCES.filter((source) => rssUrls(source).length).map(async (source) => {
      const result = await fetchOfficialItems(source);
      return {
        id: source.id,
        displayName: source.displayName,
        status: result.ok ? 'ok' : 'error',
        itemCount: result.items.length,
        errorCode: result.ok ? null : result.errorCode || 'FETCH_ERROR',
        items: result.items,
      };
    }),
  );
  let googleItems = [];
  let googleError = null;
  try {
    googleItems = parseGoogleNewsRss(await fetchText(googleNewsUrl(input.query, input.range), 1, 4_000), NEWS_SOURCES);
  } catch (error) {
    googleError = error.message || 'GOOGLE_NEWS_FETCH_ERROR';
  }
  const officialById = new Map(officialRuns.map((run) => [run.id, run]));
  const runs = NEWS_SOURCES.map((source) => {
    const official = officialById.get(source.id);
    const supplemental = googleItems.filter((item) => item.source === source.id);
    if (!official) {
      return {
        id: source.id,
        displayName: source.displayName,
        status: googleError ? 'error' : 'ok',
        itemCount: supplemental.length,
        errorCode: googleError,
        items: supplemental,
      };
    }
    if (official.status === 'error' && supplemental.length) {
      return { ...official, status: 'degraded', itemCount: supplemental.length, errorCode: official.errorCode, items: supplemental };
    }
    return { ...official, items: [...official.items, ...supplemental], itemCount: official.items.length + supplemental.length };
  });

  const liveItems = runs.flatMap((run) => run.items);
  const archived = await archiveItems(env, input.range);
  // 統計要描述「全部命中」，回傳清單才截斷。先前是先 slice(0,100) 再算 metrics，
  // 命中 300 篇時聲量會顯示 100，是直接錯誤的數字而非取捨。
  // 逐篇情緒只算在實際回傳的那 100 筆，維持 Worker 的 CPU 預算。
  const matched = filterAndDedupe([...liveItems, ...archived.items], input.query, input.range);
  const items = matched.slice(0, MAX_SEARCH_ITEMS).map(withSentiment);
  const enabledCount = NEWS_SOURCES.length;
  const failures = runs.filter((run) => ['error', 'degraded'].includes(run.status)).length;
  const stale = liveItems.length === 0 && archived.items.length > 0;
  const requestedDays = input.range === '30d' ? 30 : 7;
  const responseNow = Date.now();
  const requestedFromMs = responseNow - requestedDays * DAY_MS;
  const coverageTimestamps = [...archived.items, ...liveItems]
    .map((item) => Date.parse(item.publishedAt))
    .filter(Number.isFinite);
  const coveredDays = new Set(
    coverageTimestamps.map((timestamp) => new Date(timestamp).toISOString().slice(0, 10)),
  ).size;
  const actualFromMs = coverageTimestamps.length ? Math.min(...coverageTimestamps) : Number.NaN;
  const actualToMs = coverageTimestamps.length ? Math.max(...coverageTimestamps) : Number.NaN;
  const coverageComplete = historicalRange
    && Number.isFinite(actualFromMs)
    && coveredDays >= requestedDays
    && actualFromMs <= requestedFromMs + DAY_MS
    && actualToMs >= responseNow - DAY_MS;
  const degradedHistory = historicalRange && (
    historicalIndexFailed || !coverageComplete || archived.status !== 'ok' || archived.stale
  );
  const status = historicalIndexFailed
    ? 'partial'
    : stale ? 'stale' : (failures || degradedHistory) ? 'partial' : 'ok';
  const sourceCounts = Object.fromEntries(
    [...new Set(matched.map((item) => item.source))].map((source) => [source, matched.filter((item) => item.source === source).length]),
  );
  const data = {
    query: input.query,
    range: input.range,
    status,
    stale,
    metrics: calculateMetrics(matched, input.range, Date.now(), enabledCount),
    timeline: timelineFor(matched, input.range),
    sourceCounts,
    sources: runs.map(({ items: _items, ...source }) => source),
    items,
    ...(historicalRange ? {
      coverage: {
        requestedFrom: new Date(requestedFromMs).toISOString(),
        requestedTo: new Date(responseNow).toISOString(),
        actualFrom: Number.isFinite(actualFromMs) ? new Date(actualFromMs).toISOString() : null,
        actualTo: Number.isFinite(actualToMs) ? new Date(actualToMs).toISOString() : null,
        complete: coverageComplete && !historicalIndexFailed,
        articleCount: archived.items.length,
        coveredDays,
      },
    } : {}),
  };
  return json(request, env, envelope(data));
}

async function handleTrends(request, env) {
  try {
    const items = parseTrendsRss(await fetchText(TRENDS_URL));
    return json(
      request,
      env,
      envelope({ geo: 'TW', status: 'ok', stale: false, source: 'google-trends-rss', sourceUrl: TRENDS_URL, items }),
      200,
      60,
    );
  } catch {
    const base = archiveBase(env);
    try {
      const response = await fetch(`${base}/data/trends.json`);
      const previous = await response.json();
      previous.data.status = 'stale';
      previous.data.stale = true;
      return json(request, env, previous, 200, 60);
    } catch {
      return json(request, env, { error: 'TRENDS_UNAVAILABLE' }, 503);
    }
  }
}

async function readSnapshot(env) {
  try {
    const raw = await env.SNAPSHOT?.get(SNAPSHOT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const snapshotEnvelope = (data, generatedAt) => ({
  schemaVersion: SNAPSHOT_SCHEMA,
  generatedAt,
  pipeline: 'fast-worker',
  window: envelopeWindow(data, generatedAt),
  quality: { status: data?.status || (data?.stale ? 'stale' : 'available') },
  provenance: { method: 'public-metadata-only', reproducible: true },
  data,
});

// Cron 對每個官方 RSS URL 只嘗試一次，把 subrequest 保持在 Worker 免費層 50 上限以下並預留 redirect 餘裕。
// 完整白名單交給合併的 Pages archive（Actions 以未被限流的 IP 補齊其餘來源），
// 這些來源標記 viaPages，狀態依合併庫是否有近況決定，避免 Google News 對 Worker 限流。
async function fetchSourceItems(source, attempts = 2) {
  if (!rssUrls(source).length) return { items: [], accessMode: 'google-news', ok: false, errorCode: null, viaPages: true };
  const result = await fetchOfficialItems(source, attempts);
  if (result.ok) return { items: result.items, accessMode: 'official-rss', ok: true, errorCode: null, viaPages: false };
  return { items: [], accessMode: 'official-rss', ok: false, errorCode: result.errorCode || 'FETCH_ERROR', viaPages: false };
}

function assessSourceQuality(transportOk, items, accessMode, now) {
  const timestamps = items.map((item) => Date.parse(item.publishedAt)).filter(Number.isFinite);
  const newestMs = timestamps.length ? Math.max(...timestamps) : null;
  const ageHours = newestMs == null ? null : Math.max(0, (now - newestMs) / (60 * 60 * 1000));
  const excerptRate = items.length ? items.filter((item) => String(item.excerpt || '').trim()).length / items.length : 0;
  const fallbackUsed = accessMode !== 'official-rss';
  const qualityComponents = {
    availability: transportOk ? 1 : 0,
    freshness: Number((ageHours == null ? 0 : Math.max(0, 1 - ageHours / 24)).toFixed(3)),
    excerpt: Number(excerptRate.toFixed(3)),
    access: accessMode === 'official-rss' ? 1 : accessMode === 'site-listing' ? 0.75 : 0.6,
  };
  const qualityScore = Number((
    qualityComponents.availability * 0.3
    + qualityComponents.freshness * 0.3
    + qualityComponents.excerpt * 0.25
    + qualityComponents.access * 0.15
  ).toFixed(3));
  let status = 'ok';
  if (!transportOk) status = items.length ? 'degraded' : 'error';
  else if (!items.length) status = 'empty';
  else if (fallbackUsed || excerptRate < 0.6 || ageHours > 6) status = 'degraded';
  return {
    status,
    windowHours: 24,
    newestItemAt: newestMs == null ? null : new Date(newestMs).toISOString(),
    transportOk,
    fallbackUsed,
    officialItemCount: accessMode === 'official-rss' ? items.length : 0,
    fallbackItemCount: fallbackUsed ? items.length : 0,
    excerptRate: Number(excerptRate.toFixed(3)),
    latencyMs: 0,
    qualityScore,
    qualityComponents,
  };
}

/** 每 5 分鐘由 Cron 觸發：抓全部來源、與上一份快照合併成 7 天滾動庫、重算儀表板並寫入 KV。 */
async function buildSnapshot(env) {
  const now = Date.now();
  const generatedAt = new Date(now).toISOString();
  const previous = await readSnapshot(env);
  const previousSources = new Map(
    (previous?.files?.sources?.data?.sources ?? []).map((source) => [source.id, source]),
  );
  // 只處理近 24 小時、上限 600 筆的工作集，控制在免費層 10ms CPU 內。
  //  1. GitHub Pages recent.json 與 sources.json（Actions 產生，≤30 分鐘）
  //  2. Pages 來源證據不完整時，Worker 才直接抓取官方 RSS
  //  3. 上一份 KV 快照的 recent（Worker 自身近況）
  // 7 天完整 archive 不進 KV；搜尋的 7 天範圍仍由 /api/search + Pages 提供。
  const previousRecent = previous?.files?.recent?.data?.items ?? [];
  const [pagesRecent, pagesKeywords, pagesEntities, pagesTopics, pagesEvents, pagesMeta, pageSourceStates] = await Promise.all([
    pagesRecentItems(env),
    ...['keywords', 'entities', 'topics', 'events', 'meta'].map((name) => pagesAnalysisEnvelope(env, name)),
    pagesSourceStates(env),
  ]);
  const pagesSourceMapComplete = NEWS_SOURCES.every((source) => pageSourceStates.has(source.id));
  const pageItemsBySource = new Map();
  if (pagesSourceMapComplete) {
    for (const item of pagesRecent) {
      const sourceItems = pageItemsBySource.get(item.source) ?? [];
      sourceItems.push(item);
      pageItemsBySource.set(item.source, sourceItems);
    }
  }
  const runs = pagesSourceMapComplete
    ? NEWS_SOURCES.map((source) => {
      const pageSourceState = pageSourceStates.get(source.id);
      return {
        source,
        items: pageItemsBySource.get(source.id) ?? [],
        accessMode: pageSourceState.accessMode,
        ok: ['ok', 'empty', 'degraded'].includes(pageSourceState.status) && pageSourceState.stale !== true,
        errorCode: pageSourceState.errorCode,
        viaPages: true,
      };
    })
    : await Promise.all(
      NEWS_SOURCES.map(async (source) => ({ source, ...(await fetchSourceItems(source, 1)) })),
    );
  const liveItems = runs.flatMap((run) => run.items);
  const cutoff = now - DAY_MS;
  const future = now + FUTURE_TOLERANCE_MS;
  const merged = dedupeSnapshot([...liveItems, ...previousRecent, ...pagesRecent])
    .filter((item) => {
      const t = Date.parse(item.publishedAt);
      return t >= cutoff && t <= future;
    })
    .slice(0, MAX_ANALYSIS_ITEMS)
    .map((item) => withSentiment({
      id: item.id,
      source: item.source,
      title: item.title,
      excerpt: item.excerpt || '',
      publishedAt: item.publishedAt,
      url: item.url,
    }));

  const recent24 = merged;
  const recent24Count = (id) => recent24.filter((item) => item.source === id).length;
  const stale = liveItems.length === 0 && merged.length > 0;

  // 熱詞、主題、實體在真實 600–800 篇資料上已超過 Free Cron 10 ms CPU 預算。
  // 依計畫書的降級路徑交給 Actions/Python 計算；Worker 保留即時新聞流與逐篇輕量情緒。
  const sources = runs.map((run) => {
    const sourceItems = merged.filter((item) => item.source === run.source.id);
    const itemCount = sourceItems.length;
    const hasRecent = recent24Count(run.source.id) > 0;
    const pageSourceState = run.viaPages && !hasRecent ? pageSourceStates.get(run.source.id) : null;
    const accessMode = pageSourceState?.accessMode ?? run.accessMode;
    // Score the source's own 24-hour payload before global URL dedupe. A
    // canonical URL can legitimately appear in two publishers' feeds; using
    // the deduped dashboard list would erase one publisher's quality evidence.
    const currentRunItems = run.items.filter((item) => {
      const timestamp = Date.parse(item.publishedAt);
      return Number.isFinite(timestamp) && timestamp >= cutoff && timestamp <= future;
    });
    const qualityItems = currentRunItems.length ? currentRunItems : sourceItems;
    const quality = assessSourceQuality(run.ok, qualityItems, accessMode, now);
    if (pagesSourceMapComplete && pageSourceState) {
      return {
        id: run.source.id,
        displayName: run.source.displayName,
        ...quality,
        lastAttemptAt: pageSourceState.lastAttemptAt,
        lastSuccessAt: pageSourceState.lastSuccessAt,
        lastCrawlAt: pageSourceState.lastCrawlAt,
        accessMode: pageSourceState.accessMode,
        errorCode: pageSourceState.errorCode,
        stale: pageSourceState.stale,
        itemCount,
        dropped: pageSourceState.dropped ?? {},
      };
    }
    const pageSourceHealthy = ['ok', 'empty', 'degraded'].includes(pageSourceState?.status)
      && pageSourceState.stale !== true;
    // ok＝Worker 即時抓到官方 RSS，或 Pages archive 有近況／明確回報來源健康；
    // stale＝官方 RSS 本次失敗但合併庫仍有近況；error＝完全沒有資料。
    const assessed = assessSourceQuality(
      run.ok || (run.viaPages && (hasRecent || pageSourceHealthy)),
      qualityItems,
      accessMode,
      now,
    );
    const sourceStatus = assessed.status;
    return {
      id: run.source.id,
      displayName: run.source.displayName,
      ...assessed,
      lastAttemptAt: generatedAt,
      lastSuccessAt: pageSourceState
        ? pageSourceState.lastSuccessAt ?? null
        : run.ok ? generatedAt : previousSources.get(run.source.id)?.lastSuccessAt ?? null,
      lastCrawlAt: null,
      accessMode,
      errorCode: ['ok', 'empty', 'degraded'].includes(sourceStatus) ? null : pageSourceState?.errorCode ?? run.errorCode,
      stale: ['stale', 'error'].includes(sourceStatus),
      itemCount,
      dropped: {},
    };
  });
  const healthySourceCount = sources.filter((source) => source.status === 'ok').length;
  const serviceableSourceCount = sources.filter((source) => !['stale', 'error'].includes(source.status)).length;
  const status = healthySourceCount === sources.length ? 'ok' : serviceableSourceCount ? 'partial' : 'stale';
  const pagesCoverage = pagesMeta?.data?.coverage;
  const previousCoverage = previous?.files?.meta?.data?.coverage;
  const selectedCoverage = pagesCoverage && typeof pagesCoverage === 'object'
    ? pagesCoverage
    : previousCoverage;
  const archiveCoverage = {
    complete: selectedCoverage?.complete === true,
    coveredDays: Number(selectedCoverage?.coveredDays) || 0,
    actualFrom: selectedCoverage?.actualFrom || null,
    actualTo: selectedCoverage?.actualTo || null,
  };

  const files = {
    recent: snapshotEnvelope({ items: merged.slice(0, RECENT_ITEMS_CAP) }, generatedAt),
    keywords:
      pagesKeywords
      || staleAnalysisEnvelope(previous?.files?.keywords)
      || snapshotEnvelope({ stale: true, keywords: [] }, generatedAt),
    entities:
      pagesEntities
      || staleAnalysisEnvelope(previous?.files?.entities)
      || snapshotEnvelope({ stale: true, experimental: true, nodes: [], edges: [] }, generatedAt),
    topics:
      pagesTopics
      || staleAnalysisEnvelope(previous?.files?.topics)
      || snapshotEnvelope({ stale: true, experimental: true, topics: [] }, generatedAt),
    events:
      pagesEvents
      || staleAnalysisEnvelope(previous?.files?.events)
      || snapshotEnvelope({ stale: true, experimental: true, method: 'title-3gram-jaccard-v1', events: [] }, generatedAt),
    sources: snapshotEnvelope({ sources }, generatedAt),
    meta: snapshotEnvelope(
      {
        status,
        lastFastAt: liveItems.length ? generatedAt : previous?.files?.meta?.data?.lastFastAt ?? null,
        lastDeepAt:
          pagesTopics?.generatedAt
          || previous?.files?.meta?.data?.lastDeepAt
          || null,
        methodVersion: `news-heat-v4-${NEWS_SOURCES.length}-sources-worker`,
        scheduleDaysUntilPause: null,
        coverage: {
          keywordWindowHours: 24,
          trendBucketMinutes: 60,
          fastScheduleMinutes: FAST_SCHEDULE_MINUTES,
          deepScheduleMinutes: DEEP_SCHEDULE_MINUTES,
          archiveDays: 30,
          recentCap: RECENT_ITEMS_CAP,
          ...archiveCoverage,
        },
        stateRestoreFailed: false,
      },
      generatedAt,
    ),
  };
  await env.SNAPSHOT.put(SNAPSHOT_KEY, JSON.stringify({ generatedAt, files }));
  if (env.DB) {
    try {
      await persistSnapshotArticles(env, merged, now);
    } catch (error) {
      console.error(JSON.stringify({ event: 'snapshot_persistence_failed', error: error?.message }));
    }
  }
  return files;
}

async function handleData(request, env, url) {
  const name = url.searchParams.get('name') || '';
  if (!DATA_FILES.has(name)) return json(request, env, { error: 'NOT_FOUND' }, 404);
  const snapshot = await readSnapshot(env);
  const file = snapshot?.files?.[name];
  if (file) return json(request, env, file, 200, 30);
  return json(request, env, { error: 'SNAPSHOT_UNAVAILABLE' }, 503);
}

function createRefreshId() {
  return crypto.randomUUID();
}

const REFRESH_STATE_TTL_SECONDS = 2 * 60 * 60;

const refreshKey = (refreshId, part) => `refresh:${refreshId}:${part}`;

async function writeRefreshPart(env, refreshId, part, value) {
  await env.SNAPSHOT.put(refreshKey(refreshId, part), JSON.stringify(value), {
    expirationTtl: REFRESH_STATE_TTL_SECONDS,
  });
}

const HEALTH_MAX_SNAPSHOT_AGE_MS = 15 * 60 * 1000;

async function handleHealth(request, env) {
  const dependencies = {
    snapshot: { configured: Boolean(env.SNAPSHOT), available: false, ageSeconds: null, sourceStatus: null },
    githubDispatch: { configured: Boolean(env.GITHUB_TOKEN) },
    turnstile: { configured: Boolean(env.TURNSTILE_SECRET_KEY) },
  };
  if (!env.SNAPSHOT) {
    return json(request, env, envelope({
      status: 'error',
      dependencies,
      checks: {
        kv: 'missing',
        sourceHealthy: 0,
        sourceTotal: 0,
        lastDeepAgeSeconds: null,
        lastDispatch: dependencies.githubDispatch.configured ? 'configured' : 'not_configured',
      },
    }), 503, 30);
  }

  const snapshot = await readSnapshot(env);
  const generatedAt = snapshot?.files?.meta?.generatedAt || snapshot?.generatedAt || '';
  const timestamp = Date.parse(generatedAt);
  dependencies.snapshot.available = Boolean(snapshot && Number.isFinite(timestamp));
  dependencies.snapshot.ageSeconds = Number.isFinite(timestamp)
    ? Math.max(0, Math.round((Date.now() - timestamp) / 1000))
    : null;
  dependencies.snapshot.sourceStatus = snapshot?.files?.meta?.data?.status || null;
  const sourceRows = snapshot?.files?.sources?.data?.sources;
  const sourceList = Array.isArray(sourceRows) ? sourceRows : [];
  const lastDeepAt = snapshot?.files?.meta?.data?.lastDeepAt;
  const lastDeepTimestamp = Date.parse(String(lastDeepAt || ''));
  const checks = {
    kv: dependencies.snapshot.available ? 'ok' : 'invalid_snapshot',
    sourceHealthy: sourceList.filter((source) => source?.status === 'ok').length,
    sourceTotal: sourceList.length,
    lastDeepAgeSeconds: Number.isFinite(lastDeepTimestamp)
      ? Math.max(0, Math.round((Date.now() - lastDeepTimestamp) / 1000))
      : null,
    lastDispatch: dependencies.githubDispatch.configured ? 'configured' : 'not_configured',
  };
  const stale = !dependencies.snapshot.available
    || dependencies.snapshot.ageSeconds * 1000 > HEALTH_MAX_SNAPSHOT_AGE_MS;
  if (stale) return json(request, env, envelope({ status: 'error', dependencies, checks }), 503, 30);

  const degraded = dependencies.snapshot.sourceStatus !== 'ok'
    || !dependencies.githubDispatch.configured
    || !dependencies.turnstile.configured;
  return json(request, env, envelope({ status: degraded ? 'degraded' : 'ok', dependencies, checks }), 200, 30);
}

async function readRefreshPart(env, refreshId, part) {
  const raw = await env.SNAPSHOT.get(refreshKey(refreshId, part));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error(JSON.stringify({ event: 'refresh_state_parse_failed', refreshId, part, error: error?.message }));
    return null;
  }
}

async function runFastRefresh(env, refreshId) {
  try {
    const files = await buildSnapshot(env);
    const generatedAt = files?.meta?.generatedAt || new Date().toISOString();
    await writeRefreshPart(env, refreshId, 'fast', { status: 'completed', generatedAt, error: null });
  } catch (error) {
    await writeRefreshPart(env, refreshId, 'fast', {
      status: 'failed', generatedAt: null, error: error?.message || 'FAST_REFRESH_FAILED',
    });
  }
}

async function runDeepRefresh(env, refreshId) {
  if (!env.GITHUB_TOKEN) return;
  const result = await triggerGitHubActions(env, false, refreshId);
  if (!result.ok) {
    await writeRefreshPart(env, refreshId, 'deep', {
      status: 'failed', generatedAt: null, error: result.reason,
    });
    return;
  }
  await writeRefreshPart(env, refreshId, 'deep', { status: 'queued', generatedAt: null, error: null });
}

/**
 * 每個來源 IP 五分鐘只允許手動觸發一次。
 * 一次手動更新會拉 37 家 RSS 並踢一輪 GitHub Actions（Python 管線＋前端建置＋
 * gh-pages 強制推送），公開站台若不設節流，單一使用者連點就能把 Actions 額度
 * 與 KV 寫入吃光。KV 為最終一致，極短時間內的連點仍可能漏掉一次；這是節流，
 * 不是安全控制。
 */
async function refreshCooldown(env, request) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (!ip) return { key: null, retryAfterSeconds: 0 };

  // KV has no compare-and-set operation. When D1 is available, claim the
  // per-IP slot with the same atomic lock primitive used by deep refreshes.
  // The raw client address is hashed so it is never persisted in D1.
  if (env.DB) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const name = `manual-ip:${hash.slice(0, 32)}`;
    const now = Date.now();
    try {
      const result = await env.DB.prepare(`
        INSERT INTO refresh_locks (name, claimed_at) VALUES (?1, ?2)
        ON CONFLICT(name) DO UPDATE SET claimed_at = excluded.claimed_at
        WHERE refresh_locks.claimed_at <= ?3
      `).bind(name, now, now - REFRESH_COOLDOWN_MS).run();
      if (Number(result?.meta?.changes || 0) > 0) {
        return { key: null, retryAfterSeconds: 0 };
      }
      return { key: null, retryAfterSeconds: Math.ceil(REFRESH_COOLDOWN_MS / 1000) };
    } catch (error) {
      console.error(JSON.stringify({ event: 'refresh_cooldown_lock_failed', error: error?.message }));
      return { key: null, retryAfterSeconds: 0, error: 'REFRESH_RATE_LIMIT_UNAVAILABLE' };
    }
  }

  const key = `refresh-cooldown:${ip}`;
  const raw = await env.SNAPSHOT.get(key);
  const startedAt = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(startedAt)) return { key, retryAfterSeconds: 0 };
  const elapsed = Date.now() - startedAt;
  if (elapsed < 0 || elapsed >= REFRESH_COOLDOWN_MS) return { key, retryAfterSeconds: 0 };
  return { key, retryAfterSeconds: Math.ceil((REFRESH_COOLDOWN_MS - elapsed) / 1000) };
}

async function verifyTurnstile(request, env) {
  if (!env.TURNSTILE_SECRET_KEY) return { ok: false, status: 503, error: 'TURNSTILE_NOT_CONFIGURED' };
  const contentLength = Number.parseInt(request.headers.get('Content-Length') || '0', 10);
  if (Number.isFinite(contentLength) && contentLength > REFRESH_BODY_MAX_BYTES) {
    return { ok: false, status: 413, error: 'REQUEST_TOO_LARGE' };
  }
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
    return { ok: false, status: 415, error: 'JSON_REQUIRED' };
  }
  let payload;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > REFRESH_BODY_MAX_BYTES) {
      return { ok: false, status: 413, error: 'REQUEST_TOO_LARGE' };
    }
    payload = JSON.parse(rawBody);
  } catch {
    return { ok: false, status: 403, error: 'TURNSTILE_REQUIRED' };
  }
  const token = typeof payload?.turnstileToken === 'string' ? payload.turnstileToken.trim() : '';
  if (!token || token.length > 2_048) return { ok: false, status: 403, error: 'TURNSTILE_REQUIRED' };
  const mode = payload?.mode === undefined ? 'fast' : payload?.mode;
  if (mode !== 'fast' && mode !== 'deep') {
    return { ok: false, status: 400, error: 'INVALID_REFRESH_MODE' };
  }

  const form = new URLSearchParams({
    secret: env.TURNSTILE_SECRET_KEY,
    response: token,
  });
  const remoteIp = request.headers.get('CF-Connecting-IP') || '';
  if (remoteIp) form.set('remoteip', remoteIp);
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (!response.ok) return { ok: false, status: 503, error: 'TURNSTILE_UNAVAILABLE' };
    const result = await response.json();
    const expectedHostname = new URL(env.ALLOWED_ORIGIN || DEFAULT_PAGES_ORIGIN).hostname;
    return result?.success && result.action === TURNSTILE_ACTION && result.hostname === expectedHostname
      ? { ok: true, mode }
      : { ok: false, status: 403, error: 'TURNSTILE_FAILED' };
  } catch (error) {
    console.error(JSON.stringify({ event: 'turnstile_verification_failed', error: error?.message }));
    return { ok: false, status: 503, error: 'TURNSTILE_UNAVAILABLE' };
  }
}

async function claimDeepRefreshSlot(env) {
  if (!env.GITHUB_TOKEN) return { claimed: false, reason: 'GITHUB_TOKEN_NOT_CONFIGURED' };
  if (!env.DB) return { claimed: false, reason: 'DEEP_REFRESH_LOCK_NOT_CONFIGURED' };
  const now = Date.now();
  try {
    const result = await env.DB.prepare(`
      INSERT INTO refresh_locks (name, claimed_at) VALUES ('manual-deep', ?1)
      ON CONFLICT(name) DO UPDATE SET claimed_at = excluded.claimed_at
      WHERE refresh_locks.claimed_at <= ?2
    `).bind(now, now - DEEP_REFRESH_COOLDOWN_MS).run();
    return Number(result?.meta?.changes || 0) > 0
      ? { claimed: true, reason: null }
      : { claimed: false, reason: 'DEEP_REFRESH_RATE_LIMITED' };
  } catch (error) {
    console.error(JSON.stringify({ event: 'deep_refresh_lock_failed', error: error?.message }));
    return { claimed: false, reason: 'DEEP_REFRESH_LOCK_FAILED' };
  }
}

async function handleRefresh(request, env, ctx) {
  if (!isAllowedOrigin(request, env)) return json(request, env, { error: 'ORIGIN_NOT_ALLOWED' }, 403);
  if (!env.SNAPSHOT) return json(request, env, { error: 'SNAPSHOT_NOT_CONFIGURED' }, 503);
  const turnstile = await verifyTurnstile(request, env);
  if (!turnstile.ok) return json(request, env, { error: turnstile.error }, turnstile.status);

  const { key: cooldownKey, retryAfterSeconds, error: cooldownError } = await refreshCooldown(env, request);
  if (cooldownError) return json(request, env, { error: cooldownError }, 503);
  if (retryAfterSeconds > 0) {
    return json(request, env, { error: 'REFRESH_COOLDOWN', retryAfterSeconds }, 429);
  }
  if (cooldownKey) {
    await env.SNAPSHOT.put(cooldownKey, String(Date.now()), {
      expirationTtl: Math.ceil(REFRESH_COOLDOWN_MS / 1000),
    });
  }

  const refreshId = createRefreshId();
  const requestedAt = new Date().toISOString();
  const deepClaim = turnstile.mode === 'deep'
    ? await claimDeepRefreshSlot(env)
    : { claimed: false, reason: 'DEEP_NOT_REQUESTED' };
  const dispatchDeep = deepClaim.claimed;
  const deepUnavailable = [
    'GITHUB_TOKEN_NOT_CONFIGURED',
    'DEEP_REFRESH_LOCK_NOT_CONFIGURED',
    'DEEP_REFRESH_LOCK_FAILED',
  ].includes(deepClaim.reason) && turnstile.mode === 'deep';

  const state = {
    refreshId,
    requestedAt,
    fast: { status: 'running', generatedAt: null, error: null },
    deep: {
      status: dispatchDeep ? 'queued' : (deepUnavailable ? 'unavailable' : 'skipped'),
      generatedAt: null,
      error: deepClaim.reason,
    },
  };

  await Promise.all([
    writeRefreshPart(env, refreshId, 'meta', { refreshId, requestedAt }),
    writeRefreshPart(env, refreshId, 'fast', state.fast),
    writeRefreshPart(env, refreshId, 'deep', state.deep),
  ]);

  const fastJob = runFastRefresh(env, refreshId);
  const deepJob = dispatchDeep ? runDeepRefresh(env, refreshId) : Promise.resolve();

  if (ctx?.waitUntil) {
    ctx.waitUntil(fastJob.catch((error) => console.error(JSON.stringify({ event: 'fast_refresh_failed', refreshId, error: error?.message }))));
    ctx.waitUntil(deepJob.catch((error) => console.error(JSON.stringify({ event: 'deep_refresh_failed', refreshId, error: error?.message }))));
  }

  return json(
    request,
    env,
    {
      status: 'accepted',
      refreshId,
      requestedAt,
      fast: state.fast.status,
      deep: state.deep.status,
    },
    202,
  );
}

async function handleRefreshStatus(request, env, url) {
  const refreshId = url.searchParams.get('id');
  if (!refreshId) return json(request, env, { error: 'REFRESH_ID_REQUIRED' }, 400);

  const [meta, fast, deep] = await Promise.all([
    readRefreshPart(env, refreshId, 'meta'),
    readRefreshPart(env, refreshId, 'fast'),
    readRefreshPart(env, refreshId, 'deep'),
  ]);
  if (!meta) return json(request, env, { error: 'REFRESH_NOT_FOUND' }, 404);
  if (!fast || !deep) return json(request, env, { error: 'REFRESH_STATE_INCOMPLETE' }, 503);

  return json(request, env, { ...meta, fast, deep }, 200);
}

async function secureTokenEqual(actual, expected) {
  const encoder = new TextEncoder();
  const [actualHash, expectedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(actual)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const left = new Uint8Array(actualHash);
  const right = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function handleRefreshCallback(request, env) {
  if (!env.SNAPSHOT) return json(request, env, { error: 'SNAPSHOT_NOT_CONFIGURED' }, 503);
  if (!env.REFRESH_CALLBACK_TOKEN) return json(request, env, { error: 'CALLBACK_NOT_CONFIGURED' }, 503);
  const authorization = request.headers.get('Authorization') || '';
  const expected = `Bearer ${env.REFRESH_CALLBACK_TOKEN}`;
  if (!(await secureTokenEqual(authorization, expected))) {
    return json(request, env, { error: 'UNAUTHORIZED' }, 401);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json(request, env, { error: 'INVALID_JSON' }, 400);
  }
  const refreshId = typeof payload?.refreshId === 'string' ? payload.refreshId : '';
  const status = payload?.status;
  if (!/^[A-Za-z0-9-]{1,80}$/.test(refreshId) || !['completed', 'failed'].includes(status)) {
    return json(request, env, { error: 'INVALID_CALLBACK' }, 400);
  }
  const meta = await readRefreshPart(env, refreshId, 'meta');
  if (!meta) return json(request, env, { error: 'REFRESH_NOT_FOUND' }, 404);
  const generatedAt = status === 'completed'
    ? (Number.isFinite(Date.parse(payload?.generatedAt)) ? new Date(payload.generatedAt).toISOString() : new Date().toISOString())
    : null;
  const error = status === 'failed' ? String(payload?.error || 'DEEP_REFRESH_FAILED').slice(0, 160) : null;
  await writeRefreshPart(env, refreshId, 'deep', { status, generatedAt, error });
  return json(request, env, { status: 'accepted', refreshId }, 200);
}

const GITHUB_REPO = 'yin0612/MediaMonitoring';
const GITHUB_WORKFLOW = 'refresh-data.yml';

/**
 * 主動踢動 GitHub Actions，取代不可靠的 GitHub 內建 schedule 觸發
 * （public repo 的 schedule 事件常被系統依負載大量合併跳過，實測間隔可達數小時，
 * 與宣告的 cron 值無關）。Worker 自身的 Cron Trigger 穩定每 5 分鐘觸發一次，
 * 藉此把「觸發時機」的可靠性轉嫁給 Cloudflare。需要 env.GITHUB_TOKEN
 * （repo+workflow scope 的 PAT，經 `wrangler secret put` 存入，不進 git）；
 * 未設定時直接跳過，不影響快照本身的產生。
 */
async function triggerGitHubActions(env, automatedRefresh = false, refreshId = null) {
  if (!env.GITHUB_TOKEN) return { ok: false, reason: 'NOT_CONFIGURED' };
  try {
    const endpoint = automatedRefresh
      ? `https://api.github.com/repos/${GITHUB_REPO}/dispatches`
      : `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${GITHUB_WORKFLOW}/dispatches`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      // Cron 觸發沒有 refreshId 可回報，就不要塞 client_payload: { refreshId: null }。
      body: JSON.stringify(automatedRefresh
        ? { event_type: 'scheduled-refresh', ...(refreshId ? { client_payload: { refreshId } } : {}) }
        : { ref: 'main', inputs: refreshId ? { refresh_id: refreshId } : {} }),
    });
    return response.ok ? { ok: true } : { ok: false, reason: `HTTP_${response.status}` };
  } catch {
    return { ok: false, reason: 'NETWORK_ERROR' };
  }
}

export default {
  async scheduled(event, env, ctx) {
    const deepCron = event?.cron === '2,17,32,47 * * * *';
    if (deepCron) {
      ctx.waitUntil((async () => {
        const claim = await claimDeepRefreshSlot(env);
        if (!claim.claimed) {
          console.warn(JSON.stringify({ event: 'scheduled_deep_dispatch_skipped', reason: claim.reason }));
          return;
        }
        const result = await triggerGitHubActions(env, true);
        if (!result.ok) console.error(JSON.stringify({ event: 'scheduled_deep_dispatch_failed', reason: result.reason }));
      })());
      return;
    }
    ctx.waitUntil(buildSnapshot(env).catch((error) => {
      console.error(JSON.stringify({ event: 'scheduled_fast_refresh_failed', error: error?.message }));
    }));
  },

  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/api/refresh/callback') return handleRefreshCallback(request, env);
    if (request.method === 'POST' && url.pathname === '/api/refresh') return handleRefresh(request, env, ctx);
    if (request.method === 'GET' && url.pathname === '/api/refresh/status') return handleRefreshStatus(request, env, url);
    if (!['GET', 'HEAD'].includes(request.method)) return json(request, env, { error: 'METHOD_NOT_ALLOWED' }, 405);
    // KV snapshots are refreshed manually; bypass the edge cache for data so the next read sees it.
    const cacheable = request.method === 'GET' && url.pathname === '/api/trends';
    const origin = request.headers.get('Origin') || '';
    const localRequest = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const cache = cacheable && !localRequest ? globalThis.caches?.default : null;
    if (cache) {
      const cached = await cache.match(request);
      if (cached) return cached;
    }
    let response;
    if (url.pathname === '/api/search') response = await handleSearch(request, env, url);
    else if (url.pathname === '/api/trends') response = await handleTrends(request, env);
    else if (url.pathname === '/api/data') response = await handleData(request, env, url);
    if (response) {
      if (cache && response.ok) ctx?.waitUntil(cache.put(request, response.clone()));
      return response;
    }
    if (url.pathname === '/api/health') return handleHealth(request, env);
    return json(request, env, { error: 'NOT_FOUND' }, 404);
  },
};
