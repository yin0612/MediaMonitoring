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

const TRENDS_URL = 'https://trends.google.com/trending/rss?geo=TW&hl=zh-TW';
const SNAPSHOT_SCHEMA = '2.1.0';
const SNAPSHOT_KEY = 'snapshot';
const DAY_MS = 86_400_000;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const REFRESH_COOLDOWN_MS = 5 * 60 * 1000;
const SOURCE_HEALTH_MAX_AGE_MS = 30 * 60 * 1000;
const DEEP_SNAPSHOT_MAX_AGE_MS = SOURCE_HEALTH_MAX_AGE_MS;
// Worker 僅保留最近 600 篇做即時合併與逐篇情緒；CPU 較重的
// keywords／entities／topics 統一由 GitHub Actions / Python 產生。
const MAX_ANALYSIS_ITEMS = 600;
// 7 天完整 archive 不由 Worker 提供（CPU/KV 成本），由 Pages 靜態檔與 /api/search 負責。
const DATA_FILES = new Set(['meta', 'keywords', 'sources', 'recent', 'entities', 'topics']);
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

const envelope = (data) => ({ schemaVersion: '2.0.0', generatedAt: new Date().toISOString(), data });

const corsHeaders = (request, env) => {
  const origin = request.headers.get('Origin') || '';
  const allowed = env.ALLOWED_ORIGIN || 'https://chunyu8866.github.io';
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
  const allowed = env.ALLOWED_ORIGIN || 'https://chunyu8866.github.io';
  return origin === allowed || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
};

const json = (request, env, body, status = 200, cacheSeconds = 0) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheSeconds ? `public, max-age=${cacheSeconds}` : 'no-store',
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
          'User-Agent': 'MediaMonitoringDemo/1.0 (+https://chunyu8866.github.io/MediaMonitoringDB/)',
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
  const base = env.ARCHIVE_BASE_URL || 'https://chunyu8866.github.io/MediaMonitoringDB';
  const preferred = range === '7d' ? 'news-archive' : 'recent';
  try {
    const response = await fetch(`${base.replace(/\/$/, '')}/data/${preferred}.json`);
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const body = await response.json();
    return Array.isArray(body?.data?.items) ? body.data.items : [];
  } catch {
    if (preferred === 'news-archive') return [];
    // 舊部署尚未提供 recent 時，才退回完整 archive。
    try {
      const response = await fetch(`${base.replace(/\/$/, '')}/data/news-archive.json`);
      if (!response.ok) return [];
      const body = await response.json();
      return Array.isArray(body?.data?.items) ? body.data.items : [];
    } catch {
      return [];
    }
  }
}

/** 取 Pages recent.json（Actions 產出的近 24 小時清單）補齊 Worker 未即時抓取的 14 家來源。 */
async function pagesRecentItems(env) {
  const base = env.ARCHIVE_BASE_URL || 'https://chunyu8866.github.io/MediaMonitoringDB';
  try {
    const response = await fetch(`${base.replace(/\/$/, '')}/data/recent.json`);
    if (!response.ok) return [];
    const body = await response.json();
    return Array.isArray(body?.data?.items) ? body.data.items : [];
  } catch {
    return [];
  }
}

/** 深度分析由 GitHub Actions/Python 產生；Worker 只搬運公開快照，避免 Free Cron 超過 10 ms CPU。 */
async function pagesSourceStates(env) {
  const base = env.ARCHIVE_BASE_URL || 'https://chunyu8866.github.io/MediaMonitoringDB';
  try {
    const response = await fetch(`${base.replace(/\/$/, '')}/data/sources.json`);
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
    && ['ok', 'stale', 'error'].includes(source.status)
    && typeof source.stale === 'boolean'
    && Object.hasOwn(source, 'lastAttemptAt')
    && trustworthyAttempt(source.lastAttemptAt)
    && ['lastSuccessAt', 'lastCrawlAt'].every(
      (key) => Object.hasOwn(source, key) && nullableTimestamp(source[key]),
    )
    && Object.hasOwn(source, 'errorCode')
    && nullableErrorCode(source.errorCode)
    && (
      (source.status === 'ok' && source.stale === false && source.errorCode === null)
      || (source.status !== 'ok' && source.stale === true)
    )
    && ['official-rss', 'google-news', 'site-listing'].includes(source.accessMode)
  );
}

async function pagesAnalysisEnvelope(env, name) {
  const base = env.ARCHIVE_BASE_URL || 'https://chunyu8866.github.io/MediaMonitoringDB';
  try {
    const response = await fetch(`${base.replace(/\/$/, '')}/data/${name}.json`);
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
  const items = filterAndDedupe([...liveItems, ...archived], input.query, input.range)
    .slice(0, 100)
    .map(withSentiment);
  const enabledCount = NEWS_SOURCES.length;
  const failures = runs.filter((run) => ['error', 'degraded'].includes(run.status)).length;
  const stale = liveItems.length === 0 && archived.length > 0;
  const status = stale ? 'stale' : failures ? 'partial' : 'ok';
  const sourceCounts = Object.fromEntries(
    [...new Set(items.map((item) => item.source))].map((source) => [source, items.filter((item) => item.source === source).length]),
  );
  const data = {
    query: input.query,
    range: input.range,
    status,
    stale,
    metrics: calculateMetrics(items, input.range, Date.now(), enabledCount),
    timeline: timelineFor(items, input.range),
    sourceCounts,
    sources: runs.map(({ items: _items, ...source }) => source),
    items,
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
    const base = env.ARCHIVE_BASE_URL || 'https://chunyu8866.github.io/MediaMonitoringDB';
    try {
      const response = await fetch(`${base.replace(/\/$/, '')}/data/trends.json`);
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

const snapshotEnvelope = (data, generatedAt) => ({ schemaVersion: SNAPSHOT_SCHEMA, generatedAt, data });

// Cron 對每個官方 RSS URL 只嘗試一次，把 subrequest 保持在 Worker 免費層 50 上限以下並預留 redirect 餘裕。
// 29 家完整白名單交給合併的 Pages archive（Actions 以未被限流的 IP 補齊 29 家來源），
// 這些來源標記 viaPages，狀態依合併庫是否有近況決定，避免 Google News 對 Worker 限流。
async function fetchSourceItems(source, attempts = 2) {
  if (!rssUrls(source).length) return { items: [], accessMode: 'google-news', ok: false, errorCode: null, viaPages: true };
  const result = await fetchOfficialItems(source, attempts);
  if (result.ok) return { items: result.items, accessMode: 'official-rss', ok: true, errorCode: null, viaPages: false };
  return { items: [], accessMode: 'official-rss', ok: false, errorCode: result.errorCode || 'FETCH_ERROR', viaPages: false };
}

/** 每 5 分鐘由 Cron 觸發：抓 29 家來源、與上一份快照合併成 7 天滾動庫、重算儀表板並寫入 KV。 */
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
  const [pagesRecent, pagesKeywords, pagesEntities, pagesTopics, pageSourceStates] = await Promise.all([
    pagesRecentItems(env),
    ...['keywords', 'entities', 'topics'].map((name) => pagesAnalysisEnvelope(env, name)),
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
        ok: pageSourceState.status === 'ok' && pageSourceState.stale !== true,
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
    const itemCount = merged.filter((item) => item.source === run.source.id).length;
    const hasRecent = recent24Count(run.source.id) > 0;
    const pageSourceState = run.viaPages && !hasRecent ? pageSourceStates.get(run.source.id) : null;
    if (pagesSourceMapComplete && pageSourceState) {
      return {
        id: run.source.id,
        displayName: run.source.displayName,
        status: pageSourceState.status,
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
    const pageSourceHealthy = pageSourceState?.status === 'ok' && pageSourceState.stale !== true;
    // ok＝Worker 即時抓到官方 RSS，或 Pages archive 有近況／明確回報來源健康；
    // stale＝官方 RSS 本次失敗但合併庫仍有近況；error＝完全沒有資料。
    const sourceStatus = run.ok || (run.viaPages && (hasRecent || pageSourceHealthy)) ? 'ok' : hasRecent ? 'stale' : 'error';
    return {
      id: run.source.id,
      displayName: run.source.displayName,
      status: sourceStatus,
      lastAttemptAt: generatedAt,
      lastSuccessAt: pageSourceState
        ? pageSourceState.lastSuccessAt ?? null
        : sourceStatus === 'ok' ? generatedAt : previousSources.get(run.source.id)?.lastSuccessAt ?? null,
      lastCrawlAt: null,
      accessMode: pageSourceState?.accessMode ?? run.accessMode,
      errorCode: sourceStatus === 'ok' ? null : pageSourceState?.errorCode ?? run.errorCode,
      stale: sourceStatus !== 'ok',
      itemCount,
      dropped: {},
    };
  });
  const healthySourceCount = sources.filter((source) => source.status === 'ok').length;
  const status = healthySourceCount === sources.length ? 'ok' : healthySourceCount ? 'partial' : 'stale';

  const files = {
    recent: snapshotEnvelope({ items: merged.slice(0, 120) }, generatedAt),
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
    sources: snapshotEnvelope({ sources }, generatedAt),
    meta: snapshotEnvelope(
      {
        status,
        lastFastAt: liveItems.length ? generatedAt : previous?.files?.meta?.data?.lastFastAt ?? null,
        lastDeepAt:
          pagesTopics?.generatedAt
          || previous?.files?.meta?.data?.lastDeepAt
          || null,
        methodVersion: 'news-heat-v4-35-sources-worker',
        scheduleDaysUntilPause: null,
        coverage: { keywordWindowHours: 24, trendBucketMinutes: 60, archiveDays: 7 },
        stateRestoreFailed: false,
      },
      generatedAt,
    ),
  };
  await env.SNAPSHOT.put(SNAPSHOT_KEY, JSON.stringify({ generatedAt, files }));
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

async function handleRefresh(request, env, ctx) {
  if (!isAllowedOrigin(request, env)) return json(request, env, { error: 'ORIGIN_NOT_ALLOWED' }, 403);
  if (!env.SNAPSHOT) return json(request, env, { error: 'SNAPSHOT_NOT_CONFIGURED' }, 503);
  if (!env.GITHUB_TOKEN) return json(request, env, { error: 'GITHUB_DISPATCH_NOT_CONFIGURED' }, 503);

  const dispatch = await triggerGitHubActions(env);
  if (!dispatch.ok) return json(request, env, { error: 'GITHUB_DISPATCH_FAILED' }, 503);

  const snapshotJob = buildSnapshot(env).catch(() => {});
  if (ctx?.waitUntil) ctx.waitUntil(snapshotJob);
  else await snapshotJob;
  return json(request, env, { status: 'accepted', retryAfterSeconds: 0 }, 202);
}

const GITHUB_REPO = 'yin0612/MediaMonitoring';
const GITHUB_WORKFLOW = 'deploy-web.yml';

/**
 * 主動踢動 GitHub Actions，取代不可靠的 GitHub 內建 schedule 觸發
 * （public repo 的 schedule 事件常被系統依負載大量合併跳過，實測間隔可達數小時，
 * 與宣告的 cron 值無關）。Worker 自身的 Cron Trigger 穩定每 5 分鐘觸發一次，
 * 藉此把「觸發時機」的可靠性轉嫁給 Cloudflare。需要 env.GITHUB_TOKEN
 * （repo+workflow scope 的 PAT，經 `wrangler secret put` 存入，不進 git）；
 * 未設定時直接跳過，不影響快照本身的產生。
 */
async function triggerGitHubActions(env, automatedRefresh = false) {
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
        'User-Agent': 'MediaMonitoringDemo-Worker/1.0',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify(automatedRefresh
        ? { event_type: 'scheduled-refresh' }
        : { ref: 'main' }),
    });
    return response.ok ? { ok: true } : { ok: false, reason: `HTTP_${response.status}` };
  } catch {
    return { ok: false, reason: 'NETWORK_ERROR' };
  }
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(buildSnapshot(env).catch(() => {}));
    ctx.waitUntil(triggerGitHubActions(env, true));
  },

  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/api/refresh') return handleRefresh(request, env, ctx);
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
    if (url.pathname === '/api/health') return json(request, env, envelope({ status: 'ok' }), 200, 60);
    return json(request, env, { error: 'NOT_FOUND' }, 404);
  },
};
