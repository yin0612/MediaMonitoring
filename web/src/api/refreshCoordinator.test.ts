import { describe, expect, it, vi } from 'vitest';
import type { RefreshStatus } from './client';
import { pollRefreshStatus } from './refreshCoordinator';

const queuedStatus: RefreshStatus = {
  refreshId: 'refresh-1',
  requestedAt: '2026-08-11T00:00:00.000Z',
  fast: { status: 'completed', generatedAt: '2026-08-11T00:00:10.000Z', error: null },
  deep: { status: 'queued', generatedAt: null, error: null },
};

describe('pollRefreshStatus', () => {
  it('keeps polling for the full 180-second workflow window', async () => {
    const fetchStatus = vi.fn().mockResolvedValue(queuedStatus);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await pollRefreshStatus('refresh-1', { fetchStatus, sleep });

    expect(result).toEqual(queuedStatus);
    expect(fetchStatus).toHaveBeenCalledTimes(90);
    expect(sleep).toHaveBeenCalledTimes(89);
    expect(sleep).toHaveBeenCalledWith(2_000);
  });

  it('stops as soon as both fast and deep reach terminal states', async () => {
    const completed: RefreshStatus = {
      ...queuedStatus,
      deep: { status: 'completed', generatedAt: '2026-08-11T00:01:00.000Z', error: null },
    };
    const fetchStatus = vi.fn()
      .mockResolvedValueOnce(queuedStatus)
      .mockResolvedValueOnce(completed);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(pollRefreshStatus('refresh-1', { fetchStatus, sleep })).resolves.toEqual(completed);
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });
});
