import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/index.js';
import { NEWS_SOURCES } from '../src/sources.js';

test('health endpoint returns schema v2 and localhost CORS', async () => {
  const env = { SNAPSHOT: memoryKv(), GITHUB_TOKEN: 'configured', TURNSTILE_SECRET_KEY: 'configured' };
  const generatedAt = new Date().toISOString();
  await env.SNAPSHOT.put('snapshot', JSON.stringify({
    generatedAt,
    files: { meta: { generatedAt, data: { status: 'ok', lastFastAt: generatedAt } } },
  }));
  const request = new Request('https://worker.example/api/health', {
    headers: { Origin: 'http://localhost:5173' },
  });
  const response = await worker.fetch(request, env);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'http://localhost:5173');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
  assert.match(response.headers.get('Content-Security-Policy'), /default-src 'none'/);
  assert.equal(body.schemaVersion, '2.0.0');
  assert.equal(body.data.status, 'ok');
  assert.equal(body.data.dependencies.snapshot.available, true);
  assert.equal(body.data.dependencies.githubDispatch.configured, true);
  assert.equal(body.data.dependencies.turnstile.configured, true);
});

test('health endpoint returns 503 when snapshot storage is missing or stale', async () => {
  const missingBinding = await worker.fetch(new Request('https://worker.example/api/health'), {});
  assert.equal(missingBinding.status, 503);
  assert.equal((await missingBinding.json()).data.status, 'error');

  const env = { SNAPSHOT: memoryKv() };
  const unavailable = await worker.fetch(new Request('https://worker.example/api/health'), env);
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).data.dependencies.snapshot.available, false);

  const generatedAt = new Date(Date.now() - 16 * 60 * 1000).toISOString();
  await env.SNAPSHOT.put('snapshot', JSON.stringify({
    generatedAt,
    files: { meta: { generatedAt, data: { status: 'ok', lastFastAt: generatedAt } } },
  }));
  const stale = await worker.fetch(new Request('https://worker.example/api/health'), env);
  assert.equal(stale.status, 503);
  assert.equal((await stale.json()).data.status, 'error');
});

test('health endpoint reports a serviceable partial snapshot as degraded', async () => {
  const env = { SNAPSHOT: memoryKv() };
  const generatedAt = new Date().toISOString();
  await env.SNAPSHOT.put('snapshot', JSON.stringify({
    generatedAt,
    files: { meta: { generatedAt, data: { status: 'partial', lastFastAt: generatedAt } } },
  }));
  const response = await worker.fetch(new Request('https://worker.example/api/health'), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.data.status, 'degraded');
  assert.equal(body.data.dependencies.snapshot.sourceStatus, 'partial');
});

test('search endpoint rejects an invalid query before upstream requests', async () => {
  const response = await worker.fetch(new Request('https://worker.example/api/search?q=台&range=24h'), {});
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'INVALID_QUERY' });
});

test('non-read methods are rejected', async () => {
  const response = await worker.fetch(new Request('https://worker.example/api/health', { method: 'POST' }), {});
  assert.equal(response.status, 405);
});

test('manual refresh schedules a Cloudflare snapshot and dispatches GitHub Actions', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes('api.github.com')) return new Response(null, { status: 204 });
    return new Response(`<rss><channel><item><guid>manual-${calls.length}</guid>
      <title>Manual refresh item</title><link>https://news.example/story</link>
      <pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`);
  };

  const env = { SNAPSHOT: memoryKv(), GITHUB_TOKEN: 'test-token' };
  const pending = [];
  try {
    const response = await worker.fetch(
      new Request('https://worker.example/api/refresh', {
        method: 'POST',
        headers: {
          Origin: 'https://yin0612.github.io',
          'CF-Connecting-IP': '203.0.113.10',
        },
      }),
      env,
      { waitUntil: (promise) => pending.push(promise) },
    );

    assert.equal(response.status, 202);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://yin0612.github.io');
    assert.match(response.headers.get('Access-Control-Allow-Methods'), /POST/);
    const body = await response.json();
    assert.equal(body.status, 'accepted');
    assert.ok(body.refreshId);
    assert.equal(body.fast, 'running');
    assert.equal(body.deep, 'queued');
    const dispatch = calls.find(({ url }) => url.includes('api.github.com'));
    assert.ok(dispatch, 'expected a manual GitHub Actions dispatch');
    assert.equal(
      dispatch.url,
      'https://api.github.com/repos/yin0612/MediaMonitoring/actions/workflows/refresh-data.yml/dispatches',
    );
    assert.deepEqual(JSON.parse(dispatch.init.body), {
      ref: 'main',
      inputs: { refresh_id: body.refreshId },
    });

    await Promise.all(pending);
    assert.ok(await env.SNAPSHOT.get('snapshot'));
    assert.ok(await env.SNAPSHOT.get(`refresh:${body.refreshId}:meta`));
    assert.equal(
      JSON.parse(await env.SNAPSHOT.get(`refresh:${body.refreshId}:fast`)).status,
      'completed',
    );
    assert.equal(
      JSON.parse(await env.SNAPSHOT.get(`refresh:${body.refreshId}:deep`)).status,
      'queued',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('manual refresh enforces origin and a per-IP cooldown', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('api.github.com')) return new Response(null, { status: 204 });
    return new Response('<rss><channel></channel></rss>');
  };

  const env = { SNAPSHOT: memoryKv(), GITHUB_TOKEN: 'test-token' };
  const request = (origin, ip) => new Request('https://worker.example/api/refresh', {
    method: 'POST',
    headers: { Origin: origin, 'CF-Connecting-IP': ip },
  });
  const pending = [];
  try {
    const forbidden = await worker.fetch(request('https://evil.example', '203.0.113.11'), env, { waitUntil: () => {} });
    assert.equal(forbidden.status, 403);

    const first = await worker.fetch(request('https://yin0612.github.io', '203.0.113.11'), env, {
      waitUntil: (promise) => pending.push(promise),
    });
    assert.equal(first.status, 202);

    const second = await worker.fetch(request('https://yin0612.github.io', '203.0.113.11'), env, {
      waitUntil: () => {},
    });
    assert.equal(second.status, 429);
    const cooled = await second.json();
    assert.equal(cooled.error, 'REFRESH_COOLDOWN');
    assert.ok(cooled.retryAfterSeconds > 0 && cooled.retryAfterSeconds <= 300);

    // 節流以來源 IP 為單位，不應波及其他使用者。
    const otherClient = await worker.fetch(request('https://yin0612.github.io', '203.0.113.99'), env, {
      waitUntil: (promise) => pending.push(promise),
    });
    assert.equal(otherClient.status, 202);
  } finally {
    await Promise.all(pending);
    globalThis.fetch = originalFetch;
  }
});

// 沒有 GITHUB_TOKEN 只代表深度分析（Actions/Python）無法觸發；Worker 自己的快速
// 更新仍會重抓 RSS 並產生新快照，使用者確實會拿到新新聞。因此這裡要照常受理，
// 但把 deep 明確標成 unavailable，不能整個拒絕、也不能假裝深度分析成功。
test('manual refresh still runs the fast path when GitHub dispatch is not configured', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('<rss><channel></channel></rss>');
  const env = { SNAPSHOT: memoryKv() };
  const pending = [];
  try {
    const response = await worker.fetch(
      new Request('https://worker.example/api/refresh', {
        method: 'POST',
        headers: { Origin: 'https://yin0612.github.io', 'CF-Connecting-IP': '203.0.113.12' },
      }),
      env,
      { waitUntil: (promise) => pending.push(promise) },
    );

    assert.equal(response.status, 202);
    const body = await response.json();
    assert.equal(body.status, 'accepted');
    assert.equal(body.fast, 'running');
    assert.equal(body.deep, 'unavailable');

    await Promise.all(pending);
    const deep = JSON.parse(await env.SNAPSHOT.get(`refresh:${body.refreshId}:deep`));
    const fast = JSON.parse(await env.SNAPSHOT.get(`refresh:${body.refreshId}:fast`));
    assert.equal(deep.status, 'unavailable');
    assert.equal(deep.error, 'GITHUB_TOKEN_NOT_CONFIGURED');
    assert.equal(fast.status, 'completed');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('refresh status endpoint returns correct schema', async () => {
  const env = { SNAPSHOT: memoryKv() };
  const requestedAt = new Date().toISOString();
  const generatedAt = new Date().toISOString();
  await env.SNAPSHOT.put('refresh:12345:meta', JSON.stringify({ refreshId: '12345', requestedAt }));
  await env.SNAPSHOT.put('refresh:12345:fast', JSON.stringify({ status: 'completed', generatedAt, error: null }));
  await env.SNAPSHOT.put('refresh:12345:deep', JSON.stringify({ status: 'queued', generatedAt: null, error: null }));
  const request = new Request('https://worker.example/api/refresh/status?id=12345');
  const response = await worker.fetch(request, env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.refreshId, '12345');
  assert.equal(body.fast.status, 'completed');
  assert.equal(body.deep.status, 'queued');
  assert.equal(body.requestedAt, requestedAt);
});

test('manual refresh requires a valid Turnstile token when protection is configured', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    return Response.json({ success: true });
  };
  const env = {
    SNAPSHOT: memoryKv(),
    GITHUB_TOKEN: 'test-token',
    TURNSTILE_SECRET_KEY: 'turnstile-secret',
  };
  try {
    const missing = await worker.fetch(new Request('https://worker.example/api/refresh', {
      method: 'POST',
      headers: { Origin: 'https://yin0612.github.io', 'CF-Connecting-IP': '203.0.113.31' },
    }), env, { waitUntil: () => {} });
    assert.equal(missing.status, 403);
    assert.deepEqual(await missing.json(), { error: 'TURNSTILE_REQUIRED' });
    assert.equal(calls.length, 0);

    const pending = [];
    const accepted = await worker.fetch(new Request('https://worker.example/api/refresh', {
      method: 'POST',
      headers: {
        Origin: 'https://yin0612.github.io',
        'CF-Connecting-IP': '203.0.113.31',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ turnstileToken: 'verified-client-token' }),
    }), env, { waitUntil: (promise) => pending.push(promise) });
    assert.equal(accepted.status, 202);
    assert.ok(calls.includes('https://challenges.cloudflare.com/turnstile/v0/siteverify'));
    await Promise.all(pending);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('manual refresh rejects a failed Turnstile verification', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (String(input).includes('turnstile')) return Response.json({ success: false, 'error-codes': ['invalid-input-response'] });
    throw new Error('GitHub must not be called');
  };
  const env = {
    SNAPSHOT: memoryKv(),
    GITHUB_TOKEN: 'test-token',
    TURNSTILE_SECRET_KEY: 'turnstile-secret',
  };
  try {
    const response = await worker.fetch(new Request('https://worker.example/api/refresh', {
      method: 'POST',
      headers: {
        Origin: 'https://yin0612.github.io',
        'CF-Connecting-IP': '203.0.113.32',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ turnstileToken: 'bad-token' }),
    }), env, { waitUntil: () => {} });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'TURNSTILE_FAILED' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('refresh callback completes deep analysis without overwriting fast state', async () => {
  const env = { SNAPSHOT: memoryKv(), REFRESH_CALLBACK_TOKEN: 'callback-secret' };
  const requestedAt = new Date().toISOString();
  await env.SNAPSHOT.put('refresh:callback-1:meta', JSON.stringify({ refreshId: 'callback-1', requestedAt }));
  await env.SNAPSHOT.put('refresh:callback-1:fast', JSON.stringify({
    status: 'completed', generatedAt: requestedAt, error: null,
  }));
  await env.SNAPSHOT.put('refresh:callback-1:deep', JSON.stringify({
    status: 'queued', generatedAt: null, error: null,
  }));

  const denied = await worker.fetch(new Request('https://worker.example/api/refresh/callback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong' },
    body: JSON.stringify({ refreshId: 'callback-1', status: 'completed', generatedAt: requestedAt }),
  }), env);
  assert.equal(denied.status, 401);

  const accepted = await worker.fetch(new Request('https://worker.example/api/refresh/callback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer callback-secret' },
    body: JSON.stringify({ refreshId: 'callback-1', status: 'completed', generatedAt: requestedAt }),
  }), env);
  assert.equal(accepted.status, 200);

  const status = await worker.fetch(
    new Request('https://worker.example/api/refresh/status?id=callback-1'),
    env,
  );
  const body = await status.json();
  assert.equal(body.fast.status, 'completed');
  assert.equal(body.deep.status, 'completed');
  assert.equal(body.deep.generatedAt, requestedAt);
});

test('24h search merges Google News results with the low-frequency Pages snapshot', async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  // 相對「現在」取時間，避免硬編日期隨系統時鐘推進而跌出 24 小時窗口。
  const recentPubDate = new Date(Date.now() - 60 * 60 * 1000).toUTCString();
  const archivedPublishedAt = new Date(Date.now() - 90 * 60 * 1000).toISOString();
  globalThis.fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    if (url.includes('news.google.com/rss/search')) {
      return new Response(`<rss><channel><item><guid>g1</guid><title>台積電三立快訊</title>
        <link>https://news.google.com/rss/articles/g1</link>
        <pubDate>${recentPubDate}</pubDate>
        <source url="https://www.setn.com">三立新聞網</source></item></channel></rss>`);
    }
    if (url.endsWith('/data/recent.json')) {
      return Response.json({ data: { items: [{
        id: 'archive-ebc-1', source: 'ebc', title: '台積電東森追蹤', excerpt: '',
        publishedAt: archivedPublishedAt, url: 'https://news.ebc.net.tw/news/1', sentiment: null,
      }] } });
    }
    if (url.endsWith('/data/news-archive.json')) return new Response('', { status: 500 });
    return new Response('<rss><channel></channel></rss>');
  };

  try {
    const response = await worker.fetch(
      new Request('https://worker.example/api/search?q=台積電&range=24h'),
      { ARCHIVE_BASE_URL: 'https://pages.example' },
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(body.data.sources.length, 37);
    assert.deepEqual(new Set(body.data.items.map((item) => item.source)), new Set(['setn', 'ebc']));
    assert.ok(requested.some((url) => url.endsWith('/data/recent.json')));
    assert.ok(!requested.some((url) => url.endsWith('/data/news-archive.json')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('30d search reads historical articles from D1 without live RSS fanout', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    throw new Error(`unexpected network request: ${String(input)}`);
  };
  const publishedAt = Date.now() - 20 * 24 * 60 * 60 * 1000;
  const env = {
    DB: queryOnlyD1([{
      id: 'd1-old-article',
      source_id: 'cna',
      title: '台積電二十天前的重大投資案',
      excerpt: '歷史索引資料',
      published_at: publishedAt,
      canonical_url: 'https://www.cna.com.tw/news/afe/1.aspx',
      sentiment_json: null,
    }]),
  };
  try {
    const response = await worker.fetch(
      new Request('https://worker.example/api/search?q=台積電&range=30d'),
      env,
    );
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.data.range, '30d');
    assert.equal(body.data.metrics.mentions, 1);
    assert.equal(body.data.items[0].id, 'd1-old-article');
    assert.equal(body.data.coverage.actualFrom, new Date(publishedAt).toISOString());
    assert.equal(body.data.coverage.actualTo, new Date(publishedAt).toISOString());
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function memoryKv() {
  const store = new Map();
  return { get: async (key) => store.get(key) ?? null, put: async (key, value) => void store.set(key, value), _store: store };
}

async function runScheduled(env) {
  const pending = [];
  const ctx = { waitUntil: (promise) => pending.push(promise) };
  await worker.scheduled({ cron: '*/5 * * * *' }, env, ctx);
  await Promise.all(pending);
}

function queryOnlyD1(rows) {
  return {
    prepare: () => ({
      bind: () => ({ all: async () => ({ success: true, results: rows }) }),
    }),
  };
}

test('Cloudflare fast and deep cron triggers have separate responsibilities', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('api.github.com')) return new Response(null, { status: 204 });
    if (url.endsWith('/data/recent.json')) return Response.json({ data: { items: [] } });
    if (url.endsWith('/data/sources.json')) return new Response('', { status: 503 });
    if (['keywords', 'entities', 'topics'].some((name) => url.endsWith(`/data/${name}.json`))) {
      return new Response('', { status: 503 });
    }
    return new Response('<rss><channel></channel></rss>');
  };
  const env = { SNAPSHOT: memoryKv(), GITHUB_TOKEN: 'test-token' };
  try {
    const fastPending = [];
    await worker.scheduled({ cron: '*/5 * * * *' }, env, { waitUntil: (promise) => fastPending.push(promise) });
    await Promise.all(fastPending);
    assert.ok(await env.SNAPSHOT.get('snapshot'));
    assert.equal(calls.some((url) => url.includes('api.github.com')), false);

    calls.length = 0;
    const deepPending = [];
    await worker.scheduled({ cron: '2,17,32,47 * * * *' }, env, { waitUntil: (promise) => deepPending.push(promise) });
    await Promise.all(deepPending);
    assert.deepEqual(calls, ['https://api.github.com/repos/yin0612/MediaMonitoring/dispatches']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const freshTimestamp = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();

const pagesSourceState = (overrides) => ({
  id: 'era',
  displayName: '年代新聞',
  status: 'ok',
  lastAttemptAt: freshTimestamp(),
  lastSuccessAt: '2000-01-01T00:00:00.000Z',
  lastCrawlAt: '2000-01-01T00:00:00.000Z',
  accessMode: 'google-news',
  errorCode: null,
  stale: false,
  itemCount: 0,
  dropped: {},
  ...overrides,
});

const installPagesSourceHealthFetch = (sourceState, recentItems = [], generatedAt = freshTimestamp()) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/data/recent.json')) return Response.json({ data: { items: recentItems } });
    if (url.endsWith('/data/sources.json')) {
      return Response.json({
        schemaVersion: '2.1.0',
        generatedAt,
        data: { sources: [sourceState] },
      });
    }
    if (['keywords', 'entities', 'topics'].some((name) => url.endsWith(`/data/${name}.json`))) {
      return new Response('', { status: 503 });
    }
    return new Response('<rss><channel></channel></rss>');
  };
  return originalFetch;
};

test('Pages-first scheduled snapshot skips official RSS for complete fresh source evidence', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const officialUrls = new Set(
    NEWS_SOURCES.flatMap((source) => source.rssUrls || (source.rssUrl ? [source.rssUrl] : [])),
  );
  const recentItem = {
    id: 'era-pages-first-1',
    source: 'era',
    title: 'Pages recent item remains usable',
    excerpt: '',
    publishedAt: freshTimestamp(-60_000),
    url: 'https://www.eracom.com.tw/story/pages-first-1',
  };
  const pageStates = NEWS_SOURCES.map((source) => pagesSourceState({
    id: source.id,
    displayName: source.displayName,
    accessMode: source.rssUrl || source.rssUrls ? 'official-rss' : 'google-news',
  }));
  Object.assign(pageStates.find((source) => source.id === 'cti'), {
    status: 'error',
    stale: true,
    errorCode: 'HTTP_403',
  });
  Object.assign(pageStates.find((source) => source.id === 'era'), {
    status: 'stale',
    stale: true,
    errorCode: 'ARCHIVE_STALE',
  });
  Object.assign(pageStates.find((source) => source.id === 'ttv'), {
    status: 'stale',
    stale: true,
    errorCode: 'ARCHIVE_STALE',
  });

  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/data/recent.json')) return Response.json({ data: { items: [recentItem] } });
    if (url.endsWith('/data/sources.json')) {
      return Response.json({
        schemaVersion: '2.1.0',
        generatedAt: freshTimestamp(),
        data: { sources: pageStates },
      });
    }
    if (['keywords', 'entities', 'topics'].some((name) => url.endsWith(`/data/${name}.json`))) {
      return new Response('', { status: 503 });
    }
    if (officialUrls.has(url)) throw new Error(`unexpected official RSS fetch: ${url}`);
    return new Response('', { status: 503 });
  };

  const env = { SNAPSHOT: memoryKv(), ARCHIVE_BASE_URL: 'https://pages.example' };
  try {
    await runScheduled(env);
    const sources = await (await worker.fetch(new Request('https://worker.example/api/data?name=sources'), env)).json();
    const meta = await (await worker.fetch(new Request('https://worker.example/api/data?name=meta'), env)).json();
    const byId = new Map(sources.data.sources.map((source) => [source.id, source]));

    assert.equal(calls.filter((url) => officialUrls.has(url)).length, 0);
    assert.deepEqual(sources.data.sources.map((source) => source.id), NEWS_SOURCES.map((source) => source.id));
    assert.equal(byId.get('tvbs').status, 'empty');
    assert.equal(byId.get('tvbs').itemCount, 0);
    assert.equal(byId.get('cti').status, 'error');
    assert.equal(byId.get('cti').stale, true);
    assert.equal(byId.get('cti').errorCode, 'HTTP_403');
    assert.equal(byId.get('era').status, 'degraded');
    assert.equal(byId.get('era').stale, false);
    assert.equal(byId.get('era').itemCount, 1);
    assert.equal(byId.get('era').errorCode, null);
    assert.equal(byId.get('ttv').status, 'error');
    assert.equal(byId.get('ttv').stale, true);
    assert.equal(byId.get('ttv').errorCode, 'ARCHIVE_STALE');
    assert.equal(meta.data.status, 'partial');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Pages-first scheduled snapshot falls back to official RSS for an incomplete source map', async () => {
  const originalFetch = globalThis.fetch;
  const officialUrls = NEWS_SOURCES.flatMap(
    (source) => source.rssUrls || (source.rssUrl ? [source.rssUrl] : []),
  );
  const calls = [];
  const incompleteStates = NEWS_SOURCES.slice(0, -1).map((source) => pagesSourceState({
    id: source.id,
    displayName: source.displayName,
    accessMode: source.rssUrl || source.rssUrls ? 'official-rss' : 'google-news',
  }));
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/data/recent.json')) return Response.json({ data: { items: [] } });
    if (url.endsWith('/data/sources.json')) {
      return Response.json({
        schemaVersion: '2.1.0',
        generatedAt: freshTimestamp(),
        data: { sources: incompleteStates },
      });
    }
    if (['keywords', 'entities', 'topics'].some((name) => url.endsWith(`/data/${name}.json`))) {
      return new Response('', { status: 503 });
    }
    return new Response('<rss><channel><title>Empty</title></channel></rss>');
  };

  try {
    await runScheduled({ SNAPSHOT: memoryKv(), ARCHIVE_BASE_URL: 'https://pages.example' });
    for (const url of officialUrls) {
      assert.equal(calls.filter((call) => call === url).length, 1, `fallback request count for ${url}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const completePageSourceStates = () => NEWS_SOURCES.map((source) => pagesSourceState({
  id: source.id,
  displayName: source.displayName,
  accessMode: source.rssUrl || source.rssUrls ? 'official-rss' : 'google-news',
}));

async function assertPagesEvidenceFallsBack(pageStates) {
  const originalFetch = globalThis.fetch;
  const officialUrls = NEWS_SOURCES.flatMap(
    (source) => source.rssUrls || (source.rssUrl ? [source.rssUrl] : []),
  );
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/data/recent.json')) return Response.json({ data: { items: [] } });
    if (url.endsWith('/data/sources.json')) {
      return Response.json({
        schemaVersion: '2.1.0',
        generatedAt: freshTimestamp(),
        data: { sources: pageStates },
      });
    }
    if (['keywords', 'entities', 'topics'].some((name) => url.endsWith(`/data/${name}.json`))) {
      return new Response('', { status: 503 });
    }
    return new Response('<rss><channel><title>Empty</title></channel></rss>');
  };

  try {
    await runScheduled({ SNAPSHOT: memoryKv(), ARCHIVE_BASE_URL: 'https://pages.example' });
    for (const url of officialUrls) {
      assert.equal(calls.filter((call) => call === url).length, 1, `fallback request count for ${url}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('Pages-first rejects contradictory source status evidence and falls back to official RSS', async (t) => {
  const cases = [
    { name: 'ok source marked stale', overrides: { status: 'ok', stale: true, errorCode: null } },
    { name: 'ok source carries an error code', overrides: { status: 'ok', stale: false, errorCode: 'HTTP_500' } },
    { name: 'stale source marked fresh', overrides: { status: 'stale', stale: false, errorCode: 'ARCHIVE_STALE' } },
    { name: 'error source marked fresh', overrides: { status: 'error', stale: false, errorCode: 'HTTP_500' } },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      const pageStates = completePageSourceStates();
      Object.assign(pageStates[0], fixture.overrides);
      await assertPagesEvidenceFallsBack(pageStates);
    });
  }
});

test('Pages-first rejects duplicate source IDs and falls back to official RSS', async () => {
  const pageStates = completePageSourceStates();
  pageStates.push({ ...pageStates[0] });
  await assertPagesEvidenceFallsBack(pageStates);
});

test('Pages-first rejects unknown source IDs and falls back to official RSS', async () => {
  const pageStates = completePageSourceStates();
  pageStates.push(pagesSourceState({ id: 'unknown-source', displayName: 'Unknown source' }));
  await assertPagesEvidenceFallsBack(pageStates);
});

test('Pages source health identifies successful zero-item evidence as empty', async () => {
  const expected = pagesSourceState();
  const originalFetch = installPagesSourceHealthFetch(expected);
  const env = { SNAPSHOT: memoryKv(), ARCHIVE_BASE_URL: 'https://pages.example/' };
  try {
    await runScheduled(env);
    const body = await (await worker.fetch(new Request('https://worker.example/api/data?name=sources'), env)).json();
    const era = body.data.sources.find((source) => source.id === 'era');

    assert.equal(era.status, 'empty');
    assert.equal(era.stale, false);
    assert.equal(era.itemCount, 0);
    assert.equal(era.lastSuccessAt, expected.lastSuccessAt);
    assert.equal(era.errorCode, null);
    assert.equal(era.accessMode, expected.accessMode);
    assert.equal(era.transportOk, true);
    assert.equal(era.fallbackUsed, true);
    assert.equal(era.excerptRate, 0);
    assert.equal(typeof era.qualityScore, 'number');
    assert.deepEqual(Object.keys(era.qualityComponents).sort(), ['access', 'availability', 'excerpt', 'freshness']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('scheduled distinguishes valid empty official RSS from feed errors', async (t) => {
  const cases = [
    {
      name: 'valid empty feed',
      xml: '<?xml version="1.0"?><rss version="2.0"><channel><title>Empty</title></channel></rss>',
      status: 'empty',
      errorCode: null,
      itemCount: 0,
    },
    {
      name: 'valid RSS 1.0 RDF feed with dc:date',
      xml: `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/">
        <channel><title>Taipei Times</title></channel>
        <item><title>RDF headline</title><link>https://www.taipeitimes.com/News/front/archives/2026/08/06/1</link>
        <dc:date>${freshTimestamp(-60_000)}</dc:date></item></rdf:RDF>`,
      status: 'degraded',
      errorCode: null,
    },
    {
      name: 'malformed non-feed',
      xml: '<html><body>blocked</body></html>',
      status: 'error',
      errorCode: 'EMPTY_OR_BAD_FEED',
      itemCount: 0,
    },
    {
      name: 'misnested closed-root feed',
      xml: '<rss><channel><title>Broken</channel></title></rss>',
      status: 'error',
      errorCode: 'EMPTY_OR_BAD_FEED',
      itemCount: 0,
    },
    ...[
      {
        name: 'valid item with crossed tags',
        body: '<channel>__ITEM__<meta><nested></meta></nested></channel>',
      },
      {
        name: 'valid item with two roots',
        body: '<channel>__ITEM__</channel></rss><feed><title>Second root</title></feed><rss>',
      },
      {
        name: 'valid item outside channel',
        body: '<channel><title>Channel</title></channel>__ITEM__',
      },
      {
        name: 'valid item with channel only in comment',
        body: '<!-- <channel>fake</channel> --><wrapper>__ITEM__</wrapper>',
      },
    ].map(({ name, body }) => {
      const item = `<item><title>Valid item</title><link>https://example.com/${encodeURIComponent(name)}</link>
        <pubDate>${freshTimestamp(-60_000)}</pubDate></item>`;
      return {
        name,
        xml: `<rss>${body.replace('__ITEM__', item)}</rss>`,
        status: 'error',
        errorCode: 'EMPTY_OR_BAD_FEED',
        itemCount: 0,
      };
    }),
    {
      name: 'self-closing entry',
      xml: '<feed><title>Atom</title><link href="https://example.com" /><entry /></feed>',
      status: 'error',
      errorCode: 'NO_VALID_ITEMS',
      itemCount: 0,
    },
    {
      name: 'feed with unusable entries',
      xml: '<rss><channel><item><title>Missing URL and time</title></item></channel></rss>',
      status: 'error',
      errorCode: 'NO_VALID_ITEMS',
      itemCount: 0,
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (input) => {
        const url = String(input);
        if (url.endsWith('/data/recent.json')) return Response.json({ data: { items: [] } });
        if (url.endsWith('/data/sources.json')) return new Response('', { status: 503 });
        if (['keywords', 'entities', 'topics'].some((name) => url.endsWith(`/data/${name}.json`))) {
          return new Response('', { status: 503 });
        }
        return new Response(fixture.xml);
      };
      const env = { SNAPSHOT: memoryKv(), ARCHIVE_BASE_URL: 'https://pages.example' };
      try {
        await runScheduled(env);
        const body = await (await worker.fetch(new Request('https://worker.example/api/data?name=sources'), env)).json();
        const rti = body.data.sources.find((source) => source.id === 'rti');
        assert.equal(rti.status, fixture.status);
        assert.equal(rti.errorCode, fixture.errorCode);
        if (fixture.itemCount !== undefined) assert.equal(rti.itemCount, fixture.itemCount);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  }
});

test('Pages source health preserves true error evidence when no recent items exist', async () => {
  const expected = pagesSourceState({
    status: 'error',
    stale: true,
    errorCode: 'HTTP_403',
    lastSuccessAt: '2026-08-05T23:00:00.000Z',
  });
  const originalFetch = installPagesSourceHealthFetch(expected);
  const env = { SNAPSHOT: memoryKv(), ARCHIVE_BASE_URL: 'https://pages.example' };
  try {
    await runScheduled(env);
    const body = await (await worker.fetch(new Request('https://worker.example/api/data?name=sources'), env)).json();
    const era = body.data.sources.find((source) => source.id === 'era');

    assert.equal(era.status, 'error');
    assert.equal(era.stale, true);
    assert.equal(era.itemCount, 0);
    assert.equal(era.lastSuccessAt, expected.lastSuccessAt);
    assert.equal(era.errorCode, expected.errorCode);
    assert.equal(era.accessMode, expected.accessMode);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Pages source health marks an existing recent-item fallback as degraded', async () => {
  const pageError = pagesSourceState({
    status: 'error',
    stale: true,
    errorCode: 'HTTP_403',
    lastSuccessAt: '2026-08-05T23:00:00.000Z',
  });
  const recentItem = {
    id: 'era-recent-1',
    source: 'era',
    title: 'Recent Pages archive item',
    excerpt: '',
    publishedAt: new Date().toISOString(),
    url: 'https://www.eracom.com.tw/story/1',
  };
  const originalFetch = installPagesSourceHealthFetch(pageError, [recentItem]);
  const env = { SNAPSHOT: memoryKv(), ARCHIVE_BASE_URL: 'https://pages.example' };
  try {
    await runScheduled(env);
    const body = await (await worker.fetch(new Request('https://worker.example/api/data?name=sources'), env)).json();
    const era = body.data.sources.find((source) => source.id === 'era');

    assert.equal(era.status, 'degraded');
    assert.equal(era.stale, false);
    assert.equal(era.itemCount, 1);
    assert.notEqual(era.lastSuccessAt, pageError.lastSuccessAt);
    assert.equal(era.errorCode, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Pages source health falls back safely when sources evidence is unavailable or malformed', async (t) => {
  for (const fixture of [
    { name: 'unavailable', response: () => new Response('', { status: 503 }) },
    { name: 'malformed', response: () => new Response('{bad json') },
  ]) {
    await t.test(fixture.name, async () => {
      const originalFetch = globalThis.fetch;
      let requestedSources = false;
      globalThis.fetch = async (input) => {
        const url = String(input);
        if (url.endsWith('/data/sources.json')) {
          requestedSources = true;
          return fixture.response();
        }
        if (url.endsWith('/data/recent.json')) return Response.json({ data: { items: [] } });
        if (['keywords', 'entities', 'topics'].some((name) => url.endsWith(`/data/${name}.json`))) {
          return new Response('', { status: 503 });
        }
        return new Response('<rss><channel></channel></rss>');
      };
      const env = { SNAPSHOT: memoryKv(), ARCHIVE_BASE_URL: 'https://pages.example' };
      try {
        await runScheduled(env);
        const body = await (await worker.fetch(new Request('https://worker.example/api/data?name=sources'), env)).json();
        const era = body.data.sources.find((source) => source.id === 'era');
        assert.equal(requestedSources, true);
        assert.equal(era.status, 'error');
        assert.equal(era.stale, true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  }
});

test('Pages source health rejects envelopes and records missing trustworthy health fields', async (t) => {
  const cases = [
    {
      name: 'missing envelope metadata',
      body: { data: { sources: [{ id: 'era', status: 'ok' }] } },
    },
    {
      name: 'missing record health fields',
      body: {
        schemaVersion: '2.1.0',
        generatedAt: freshTimestamp(),
        data: { sources: [{ id: 'era', status: 'ok' }] },
      },
    },
    {
      name: 'invalid nullable timestamp',
      body: {
        schemaVersion: '2.1.0',
        generatedAt: freshTimestamp(),
        data: { sources: [pagesSourceState({ lastSuccessAt: 'not-a-timestamp' })] },
      },
    },
    {
      name: 'invalid access mode',
      body: {
        schemaVersion: '2.1.0',
        generatedAt: freshTimestamp(),
        data: { sources: [pagesSourceState({ accessMode: 'untrusted-proxy' })] },
      },
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (input) => {
        const url = String(input);
        if (url.endsWith('/data/sources.json')) return Response.json(fixture.body);
        if (url.endsWith('/data/recent.json')) return Response.json({ data: { items: [] } });
        if (['keywords', 'entities', 'topics'].some((name) => url.endsWith(`/data/${name}.json`))) {
          return new Response('', { status: 503 });
        }
        return new Response('<rss><channel></channel></rss>');
      };
      const env = { SNAPSHOT: memoryKv(), ARCHIVE_BASE_URL: 'https://pages.example' };
      try {
        await runScheduled(env);
        const body = await (await worker.fetch(new Request('https://worker.example/api/data?name=sources'), env)).json();
        const era = body.data.sources.find((source) => source.id === 'era');
        assert.equal(era.status, 'error');
        assert.equal(era.stale, true);
        assert.equal(era.lastSuccessAt, null);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  }
});

test('Pages source health rejects ancient envelopes and ancient attempts', async (t) => {
  const ancient = '2000-01-01T00:00:00.000Z';
  const cases = [
    {
      name: 'ancient envelope',
      sourceState: pagesSourceState(),
      generatedAt: ancient,
    },
    {
      name: 'ancient last attempt',
      sourceState: pagesSourceState({ lastAttemptAt: ancient }),
      generatedAt: freshTimestamp(),
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      const originalFetch = installPagesSourceHealthFetch(fixture.sourceState, [], fixture.generatedAt);
      const env = { SNAPSHOT: memoryKv(), ARCHIVE_BASE_URL: 'https://pages.example' };
      try {
        await runScheduled(env);
        const body = await (await worker.fetch(new Request('https://worker.example/api/data?name=sources'), env)).json();
        const era = body.data.sources.find((source) => source.id === 'era');
        assert.equal(era.status, 'error');
        assert.equal(era.stale, true);
        assert.equal(era.lastSuccessAt, null);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  }
});

test('scheduled meta status is partial when every transport is healthy but content is empty', async () => {
  const originalFetch = globalThis.fetch;
  const pageStates = NEWS_SOURCES.map((source) => pagesSourceState({
    id: source.id,
    displayName: source.displayName,
    accessMode: source.rssUrl || source.rssUrls ? 'official-rss' : 'google-news',
  }));
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/data/recent.json')) return Response.json({ data: { items: [] } });
    if (url.endsWith('/data/sources.json')) {
      return Response.json({
        schemaVersion: '2.1.0',
        generatedAt: freshTimestamp(),
        data: { sources: pageStates },
      });
    }
    if (['keywords', 'entities', 'topics'].some((name) => url.endsWith(`/data/${name}.json`))) {
      return new Response('', { status: 503 });
    }
    return new Response('<rss><channel><title>Empty</title></channel></rss>');
  };
  const env = { SNAPSHOT: memoryKv(), ARCHIVE_BASE_URL: 'https://pages.example' };
  try {
    await runScheduled(env);
    const sources = await (await worker.fetch(new Request('https://worker.example/api/data?name=sources'), env)).json();
    const meta = await (await worker.fetch(new Request('https://worker.example/api/data?name=meta'), env)).json();
    assert.equal(sources.data.sources.every((source) => source.status === 'empty'), true);
    assert.equal(meta.data.status, 'partial');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('scheduled subrequest budget uses one attempt per official URL and keeps redirect headroom', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('api.github.com')) return new Response(null, { status: 204 });
    return new Response('', { status: 503 });
  };
  const env = { SNAPSHOT: memoryKv(), GITHUB_TOKEN: 'test-token' };
  const officialUrls = NEWS_SOURCES.flatMap((source) => source.rssUrls || (source.rssUrl ? [source.rssUrl] : []));
  const pagesReadCount = 6;
  const dispatchCount = 0;
  const safeThreshold = 40;
  try {
    await runScheduled(env);
    for (const url of officialUrls) {
      assert.equal(calls.filter((call) => call === url).length, 1, `scheduled retry budget for ${url}`);
    }
    assert.equal(calls.length, officialUrls.length + pagesReadCount + dispatchCount);
    assert.ok(calls.length <= safeThreshold, `${calls.length} scheduled subrequests exceed ${safeThreshold}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('scheduled build writes a snapshot that /api/data serves per file', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/data/recent.json')) {
      return Response.json({ data: { items: [] } });
    }
    if (url.endsWith('/data/keywords.json')) {
      return Response.json({
        schemaVersion: '2.1.0',
        generatedAt: new Date().toISOString(),
        data: { stale: false, keywords: [{ id: 'pages-only', term: 'Pages 熱詞', kind: 'auto', mentions24h: 9 }] },
      });
    }
    if (url.endsWith('/data/entities.json')) {
      return Response.json({
        schemaVersion: '2.1.0',
        generatedAt: new Date().toISOString(),
        data: { stale: false, experimental: true, nodes: [], edges: [] },
      });
    }
    if (url.endsWith('/data/topics.json')) {
      return Response.json({
        schemaVersion: '2.1.0',
        generatedAt: new Date().toISOString(),
        data: { stale: false, experimental: true, topics: [] },
      });
    }
    if (url.includes('news.google.com/rss/search')) {
      const domain = new URL(url).searchParams.get('q').match(/site:(\S+)/)[1];
      return new Response(`<rss><channel><item><guid>g-${domain}</guid>
        <title>台積電擴廠與經濟部會談 - 中央社</title>
        <link>https://news.google.com/rss/articles/${domain}</link>
        <pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`);
    }
    // 官方 RSS 來源
    return new Response(`<rss><channel><item><guid>rss-1</guid>
      <title>台積電法說會登場</title><link>https://news.pts.org.tw/article/1</link>
      <pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`);
  };
  const env = { SNAPSHOT: memoryKv() };
  try {
    const pending = [];
    const ctx = { waitUntil: (promise) => pending.push(promise) };
    await worker.scheduled({}, env, ctx);
    await Promise.all(pending);

    const meta = await (await worker.fetch(new Request('https://worker.example/api/data?name=meta'), env)).json();
    assert.equal(meta.schemaVersion, '2.1.0');
    assert.ok(['ok', 'partial'].includes(meta.data.status));

    const sources = await (await worker.fetch(new Request('https://worker.example/api/data?name=sources'), env)).json();
    assert.equal(sources.data.sources.length, 37);

    const keywords = await (await worker.fetch(new Request('https://worker.example/api/data?name=keywords'), env)).json();
    assert.equal(keywords.data.keywords[0].id, 'pages-only');

    const bad = await worker.fetch(new Request('https://worker.example/api/data?name=secrets'), env);
    assert.equal(bad.status, 404);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('scheduled marks expired Pages analysis as stale', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/data/recent.json')) return Response.json({ data: { items: [] } });
    if (url.endsWith('/data/keywords.json')) {
      return Response.json({
        schemaVersion: '2.1.0',
        generatedAt: '2000-01-01T00:00:00Z',
        data: { stale: false, keywords: [{ id: 'expired', term: '過期熱詞', kind: 'auto', mentions24h: 1 }] },
      });
    }
    if (url.endsWith('/data/entities.json')) {
      return Response.json({
        schemaVersion: '2.1.0',
        generatedAt: '2000-01-01T00:00:00Z',
        data: { stale: false, experimental: true, nodes: [], edges: [] },
      });
    }
    if (url.endsWith('/data/topics.json')) {
      return Response.json({
        schemaVersion: '2.1.0',
        generatedAt: '2000-01-01T00:00:00Z',
        data: { stale: false, experimental: true, topics: [] },
      });
    }
    return new Response('<rss><channel></channel></rss>');
  };
  const env = { SNAPSHOT: memoryKv() };
  try {
    await runScheduled(env);
    const keywords = await (await worker.fetch(new Request('https://worker.example/api/data?name=keywords'), env)).json();
    assert.equal(keywords.data.keywords[0].id, 'expired');
    assert.equal(keywords.data.stale, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('scheduled marks reused deep analysis stale when Pages fetch fails', async () => {
  const originalFetch = globalThis.fetch;
  let deepAvailable = true;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/data/recent.json')) return Response.json({ data: { items: [] } });
    if (['keywords', 'entities', 'topics'].some((name) => url.endsWith(`/data/${name}.json`))) {
      if (!deepAvailable) return new Response('', { status: 503 });
      const name = url.match(/\/data\/([^.]+)\.json$/)[1];
      const payload = name === 'keywords'
        ? { stale: false, keywords: [{ id: 'last-good', term: '保留熱詞', kind: 'auto', mentions24h: 2 }] }
        : name === 'entities'
          ? { stale: false, experimental: true, nodes: [], edges: [] }
          : { stale: false, experimental: true, topics: [] };
      return Response.json({
        schemaVersion: '2.1.0',
        generatedAt: new Date().toISOString(),
        data: payload,
      });
    }
    return new Response('<rss><channel></channel></rss>');
  };
  const env = { SNAPSHOT: memoryKv() };
  try {
    await runScheduled(env);
    deepAvailable = false;
    await runScheduled(env);
    const keywords = await (await worker.fetch(new Request('https://worker.example/api/data?name=keywords'), env)).json();
    assert.equal(keywords.data.keywords[0].id, 'last-good');
    assert.equal(keywords.data.stale, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('scheduled dispatches GitHub Actions when a token is configured', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes('news.google.com/rss/search') || url.includes('api.github.com')) {
      return new Response(url.includes('api.github.com') ? '' : '<rss><channel></channel></rss>', {
        status: url.includes('api.github.com') ? 204 : 200,
      });
    }
    return new Response('<rss><channel></channel></rss>');
  };
  const env = { SNAPSHOT: memoryKv(), GITHUB_TOKEN: 'test-token' };
  try {
    const pending = [];
    await worker.scheduled({ cron: '2,17,32,47 * * * *' }, env, { waitUntil: (p) => pending.push(p) });
    await Promise.all(pending);

    const dispatch = calls.find((c) => c.url.includes('api.github.com'));
    assert.ok(dispatch, 'expected a call to the GitHub Actions dispatch endpoint');
    assert.equal(
      dispatch.url,
      'https://api.github.com/repos/yin0612/MediaMonitoring/dispatches',
    );
    assert.equal(dispatch.init.method, 'POST');
    assert.equal(dispatch.init.headers.Authorization, 'Bearer test-token');
    assert.deepEqual(JSON.parse(dispatch.init.body), { event_type: 'scheduled-refresh' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('scheduled skips the GitHub dispatch call when no token is configured', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    return new Response('<rss><channel></channel></rss>');
  };
  const env = { SNAPSHOT: memoryKv() };
  try {
    const pending = [];
    await worker.scheduled({}, env, { waitUntil: (p) => pending.push(p) });
    await Promise.all(pending);

    assert.ok(!calls.some((url) => url.includes('api.github.com')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('api/data returns 503 before the first snapshot exists', async () => {
  const response = await worker.fetch(new Request('https://worker.example/api/data?name=keywords'), { SNAPSHOT: memoryKv() });
  assert.equal(response.status, 503);
});

test('trends endpoint preserves related news from publishers outside the 29-source registry', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(`<rss xmlns:ht="https://trends.google.com/trending/rss"><channel><item>
    <title>short selling</title><ht:approx_traffic>200+</ht:approx_traffic>
    <pubDate>Wed, 22 Jul 2026 12:00:00 GMT</pubDate>
    <ht:news_item><ht:news_item_title>Daily market report</ht:news_item_title>
    <ht:news_item_url>https://external.example/story/1</ht:news_item_url>
    <ht:news_item_source>External Finance</ht:news_item_source></ht:news_item>
  </item></channel></rss>`);
  try {
    const response = await worker.fetch(new Request('https://worker.example/api/trends'), {});
    const body = await response.json();
    assert.equal(body.data.items[0].news.length, 1);
    assert.equal(body.data.items[0].news[0].source, 'External Finance');
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=60');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 搜尋統計必須描述全部命中，只有回傳清單截斷。先前是先 slice(0,100) 再算 metrics，
// 命中 250 篇時聲量會顯示 100，是錯誤的數字而非取捨。前端 fallback 有對應測試。
test('search metrics count every match while the payload stays capped', async () => {
  const originalFetch = globalThis.fetch;
  const pubDate = new Date(Date.now() - 30 * 60 * 1000).toUTCString();
  const archived = Array.from({ length: 250 }, (_, i) => ({
    id: `arch-${i}`,
    source: ['tvbs', 'cna', 'ltn', 'udn'][i % 4],
    title: `颱風動態 ${i}`,
    excerpt: '',
    publishedAt: new Date(Date.now() - (i + 1) * 60 * 1000).toISOString(),
    url: `https://news.example/typhoon/${i}`,
    sentiment: null,
  }));
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/data/recent.json')) return Response.json({ data: { items: archived } });
    if (url.includes('news.google.com')) return new Response('<rss><channel></channel></rss>');
    return new Response(`<rss><channel><item><guid>x</guid><title>無關</title>
      <link>https://news.example/other</link><pubDate>${pubDate}</pubDate></item></channel></rss>`);
  };
  try {
    const response = await worker.fetch(
      new Request('https://worker.example/api/search?q=颱風&range=24h'),
      { ARCHIVE_BASE_URL: 'https://pages.example' },
    );
    const { data } = await response.json();

    assert.equal(data.items.length, 100, '回傳清單應維持 100 筆上限');
    assert.equal(data.metrics.mentions, 250, 'metrics 應反映全部命中');
    const timelineTotal = data.timeline.reduce((sum, point) => sum + point.mentions, 0);
    assert.equal(timelineTotal, 250, 'timeline 應涵蓋全部命中');
    const sourceTotal = Object.values(data.sourceCounts).reduce((a, b) => a + b, 0);
    assert.equal(sourceTotal, 250, 'sourceCounts 應涵蓋全部命中');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
