import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/index.js';
import { NEWS_SOURCES } from '../src/sources.js';

test('health endpoint returns schema v2 and localhost CORS', async () => {
  const request = new Request('https://worker.example/api/health', {
    headers: { Origin: 'http://localhost:5173' },
  });
  const response = await worker.fetch(request, {});
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'http://localhost:5173');
  assert.equal(body.schemaVersion, '2.0.0');
  assert.equal(body.data.status, 'ok');
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
          Origin: 'https://chunyu8866.github.io',
          'CF-Connecting-IP': '203.0.113.10',
        },
      }),
      env,
      { waitUntil: (promise) => pending.push(promise) },
    );

    assert.equal(response.status, 202);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://chunyu8866.github.io');
    assert.match(response.headers.get('Access-Control-Allow-Methods'), /POST/);
    assert.deepEqual(await response.json(), { status: 'accepted', retryAfterSeconds: 0 });
    const dispatch = calls.find(({ url }) => url.includes('api.github.com'));
    assert.ok(dispatch, 'expected a manual GitHub Actions dispatch');
    assert.equal(
      dispatch.url,
      'https://api.github.com/repos/yin0612/MediaMonitoring/actions/workflows/deploy-web.yml/dispatches',
    );
    assert.deepEqual(JSON.parse(dispatch.init.body), { ref: 'main' });

    await Promise.all(pending);
    assert.ok(await env.SNAPSHOT.get('snapshot'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('manual refresh enforces origin without cooldown', async () => {
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

    const first = await worker.fetch(request('https://chunyu8866.github.io', '203.0.113.11'), env, {
      waitUntil: (promise) => pending.push(promise),
    });
    assert.equal(first.status, 202);

    const second = await worker.fetch(request('https://chunyu8866.github.io', '203.0.113.11'), env, {
      waitUntil: () => {},
    });
    assert.equal(second.status, 202);
  } finally {
    await Promise.all(pending);
    globalThis.fetch = originalFetch;
  }
});

test('manual refresh reports missing GitHub configuration instead of claiming success', async () => {
  const response = await worker.fetch(
    new Request('https://worker.example/api/refresh', {
      method: 'POST',
      headers: { Origin: 'https://chunyu8866.github.io', 'CF-Connecting-IP': '203.0.113.12' },
    }),
    { SNAPSHOT: memoryKv() },
    { waitUntil: () => {} },
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'GITHUB_DISPATCH_NOT_CONFIGURED' });
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
    assert.equal(body.data.sources.length, 35);
    assert.deepEqual(new Set(body.data.items.map((item) => item.source)), new Set(['setn', 'ebc']));
    assert.ok(requested.some((url) => url.endsWith('/data/recent.json')));
    assert.ok(!requested.some((url) => url.endsWith('/data/news-archive.json')));
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
  await worker.scheduled({}, env, ctx);
  await Promise.all(pending);
}

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
    assert.equal(byId.get('tvbs').status, 'ok');
    assert.equal(byId.get('tvbs').itemCount, 0);
    assert.equal(byId.get('cti').status, 'error');
    assert.equal(byId.get('cti').stale, true);
    assert.equal(byId.get('cti').errorCode, 'HTTP_403');
    assert.equal(byId.get('era').status, 'ok');
    assert.equal(byId.get('era').stale, false);
    assert.equal(byId.get('era').itemCount, 1);
    assert.equal(byId.get('era').errorCode, null);
    assert.equal(byId.get('ttv').status, 'stale');
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

test('Pages source health preserves healthy zero-item evidence in scheduled snapshots', async () => {
  const expected = pagesSourceState();
  const originalFetch = installPagesSourceHealthFetch(expected);
  const env = { SNAPSHOT: memoryKv(), ARCHIVE_BASE_URL: 'https://pages.example/' };
  try {
    await runScheduled(env);
    const body = await (await worker.fetch(new Request('https://worker.example/api/data?name=sources'), env)).json();
    const era = body.data.sources.find((source) => source.id === 'era');

    assert.equal(era.status, 'ok');
    assert.equal(era.stale, false);
    assert.equal(era.itemCount, 0);
    assert.equal(era.lastSuccessAt, expected.lastSuccessAt);
    assert.equal(era.errorCode, null);
    assert.equal(era.accessMode, expected.accessMode);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('scheduled treats valid empty official RSS as healthy without weakening feed errors', async (t) => {
  const cases = [
    {
      name: 'valid empty feed',
      xml: '<?xml version="1.0"?><rss version="2.0"><channel><title>Empty</title></channel></rss>',
      status: 'ok',
      errorCode: null,
      itemCount: 0,
    },
    {
      name: 'valid RSS 1.0 RDF feed with dc:date',
      xml: `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/">
        <channel><title>Taipei Times</title></channel>
        <item><title>RDF headline</title><link>https://www.taipeitimes.com/News/front/archives/2026/08/06/1</link>
        <dc:date>${freshTimestamp(-60_000)}</dc:date></item></rdf:RDF>`,
      status: 'ok',
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

test('Pages source health does not override the existing recent-item fallback', async () => {
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

    assert.equal(era.status, 'ok');
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

test('scheduled meta status is derived from finalized healthy-empty source states', async () => {
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
    assert.equal(sources.data.sources.every((source) => source.status === 'ok'), true);
    assert.equal(meta.data.status, 'ok');
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
  const pagesReadCount = 5;
  const dispatchCount = 1;
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
    assert.equal(sources.data.sources.length, 35);

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
    await worker.scheduled({}, env, { waitUntil: (p) => pending.push(p) });
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
