import { describe, expect, it, vi } from 'vitest';
import { __resetDataCacheForTests, DataFetchError, fetchData, requestManualRefresh } from './client';

describe('manual refresh API', () => {
  it('posts to the Worker refresh endpoint without exposing credentials', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://worker.example/');
    const accepted = {
      status: 'accepted',
      refreshId: 'b8c1f6e2-0000-4000-8000-000000000000',
      requestedAt: '2026-08-09T08:00:00.000Z',
      fast: 'running',
      deep: 'queued',
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(accepted), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestManualRefresh('turnstile-token')).resolves.toEqual(accepted);
    expect(fetchMock).toHaveBeenCalledWith('https://worker.example/api/refresh', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ turnstileToken: 'turnstile-token', mode: 'fast' }),
    });

    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('rejects a malformed acceptance instead of reporting a refresh that never started', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://worker.example');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'accepted' }), { status: 202 }),
    ));

    await expect(requestManualRefresh()).rejects.toBeInstanceOf(DataFetchError);

    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('converts Worker errors into a user-facing DataFetchError', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://worker.example');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'REFRESH_COOLDOWN', retryAfterSeconds: 120 }), { status: 429 }),
    ));

    await expect(requestManualRefresh()).rejects.toMatchObject({
      name: 'DataFetchError',
      file: 'refresh',
      message: expect.stringContaining('120'),
    });

    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('fails clearly when the Worker URL is not configured', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '');
    await expect(requestManualRefresh()).rejects.toBeInstanceOf(DataFetchError);
    vi.unstubAllEnvs();
  });
});

describe('data arbitration and request coordination', () => {
  it('keeps the older but materially higher-quality source snapshot', async () => {
    __resetDataCacheForTests();
    vi.stubEnv('VITE_API_BASE_URL', 'https://worker.example');
    const envelope = (generatedAt: string, qualityScore: number, marker: string) => ({
      schemaVersion: '2.1.0',
      generatedAt,
      data: { marker, sources: [{ id: 'cna', qualityScore }] },
    });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => Response.json(
      String(input).includes('worker.example')
        ? envelope('2026-08-11T12:00:00Z', 0.3, 'worker')
        : envelope('2026-08-11T11:55:00Z', 0.9, 'pages'),
    )));

    const result = await fetchData<{ marker: string; sources: unknown[] }>('sources', { bypassCache: true });
    expect(result.data.marker).toBe('pages');
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('deduplicates simultaneous reads of the same file', async () => {
    __resetDataCacheForTests();
    vi.stubEnv('VITE_API_BASE_URL', '');
    const fetchMock = vi.fn(async () => Response.json({
      schemaVersion: '2.1.0', generatedAt: '2026-08-11T12:00:00Z', data: { keywords: [] },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([fetchData('keywords'), fetchData('keywords')]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('starts Pages immediately and falls back when the Worker exceeds its deadline', async () => {
    vi.useFakeTimers();
    __resetDataCacheForTests();
    vi.stubEnv('VITE_API_BASE_URL', 'https://worker.example');
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('worker.example')) {
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        });
      }
      return Promise.resolve(Response.json({
        schemaVersion: '2.1.0', generatedAt: '2026-08-11T12:00:00Z', data: { marker: 'pages' },
      }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const pending = fetchData<{ marker: string }>('keywords', { bypassCache: true });
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2_500);
    await expect(pending).resolves.toMatchObject({ data: { marker: 'pages' } });

    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('merges recent snapshots by item freshness with auditable merged metadata', async () => {
    __resetDataCacheForTests();
    vi.stubEnv('VITE_API_BASE_URL', 'https://worker.example');
    const recent = (generatedAt: string, marker: string, items: unknown[]) => ({
      schemaVersion: '2.1.0', generatedAt, pipeline: marker,
      quality: { status: marker === 'pages' ? 'partial' : 'ok', score: 0.8 },
      provenance: { method: `${marker}-snapshot`, reproducible: true },
      data: { marker, items },
    });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => Response.json(
      String(input).includes('worker.example')
        ? recent('2026-08-11T12:00:00Z', 'worker', [
          { id: 'duplicate-worker', source: 'cna', title: 'duplicate', excerpt: 'worker-old', publishedAt: '2026-08-11T10:00:00Z', url: 'https://example.com/story' },
        ])
        : recent('2026-08-11T11:00:00Z', 'pages', [
          { id: 'duplicate-pages', source: 'cna', title: 'duplicate', excerpt: 'pages-new', publishedAt: '2026-08-11T11:30:00Z', url: 'https://example.com/story' },
          { id: 'pages-unique', source: 'ltn', title: 'unique', excerpt: 'unique', publishedAt: '2026-08-11T09:00:00Z', url: 'https://example.com/unique' },
        ]),
    )));

    const result = await fetchData<{ marker: string; items: Array<{ excerpt: string }> }>('recent', { bypassCache: true });
    expect(result.data.marker).toBe('worker');
    expect(result.data.items.map((item) => item.excerpt)).toEqual(['pages-new', 'unique']);
    expect(result.generatedAt).toBe('2026-08-11T12:00:00Z');
    expect(result.pipeline).toBe('merged-worker-pages');
    expect(result.provenance).toEqual({ method: 'canonical-url-newer-merge', reproducible: true });
    expect(result.window).toEqual({ actualFrom: '2026-08-11T09:00:00.000Z', actualTo: '2026-08-11T11:30:00.000Z' });
    expect(result.quality?.status).toBe('degraded');
    expect(result.quality?.score).toBeGreaterThan(0);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('returns a healthy Worker snapshot when Pages exceeds its deadline', async () => {
    vi.useFakeTimers();
    __resetDataCacheForTests();
    vi.stubEnv('VITE_API_BASE_URL', 'https://worker.example');
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('worker.example')) {
        return Promise.resolve(Response.json({
          schemaVersion: '2.1.0', generatedAt: '2026-08-11T12:00:00Z', data: { marker: 'worker' },
        }));
      }
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    }));

    const pending = fetchData<{ marker: string }>('keywords', { bypassCache: true });
    await vi.advanceTimersByTimeAsync(4_000);
    await expect(pending).resolves.toMatchObject({ data: { marker: 'worker' } });

    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
});
