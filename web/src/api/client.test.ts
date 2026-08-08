import { describe, expect, it, vi } from 'vitest';
import { DataFetchError, requestManualRefresh } from './client';

describe('manual refresh API', () => {
  it('posts to the Worker refresh endpoint without exposing credentials', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://worker.example/');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'accepted', retryAfterSeconds: 300 }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestManualRefresh()).resolves.toEqual({ status: 'accepted', retryAfterSeconds: 300 });
    expect(fetchMock).toHaveBeenCalledWith('https://worker.example/api/refresh', {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });

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
