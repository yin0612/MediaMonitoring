import { describe, expect, it, vi } from 'vitest';
import { DataFetchError, requestManualRefresh } from './client';

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

    await expect(requestManualRefresh()).resolves.toEqual(accepted);
    expect(fetchMock).toHaveBeenCalledWith('https://worker.example/api/refresh', {
      method: 'POST',
      headers: { Accept: 'application/json' },
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
