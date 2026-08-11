import { fetchRefreshStatus, type RefreshStatus } from './client';

export const DATA_REFRESH_EVENT = 'media-monitoring:refresh';
export const REFRESH_POLL_INTERVAL_MS = 2_000;
export const REFRESH_POLL_TIMEOUT_MS = 180_000;

export interface RefreshEventDetail {
  reason: 'manual' | 'interval' | 'visibility';
  refreshId?: string;
  requestedAt?: string;
  bypassCache?: boolean;
}

export function dispatchGlobalRefresh(detail: RefreshEventDetail) {
  window.dispatchEvent(
    new CustomEvent<RefreshEventDetail>(DATA_REFRESH_EVENT, {
      detail,
    }),
  );
}

interface PollRefreshOptions {
  fetchStatus?: (refreshId: string) => Promise<RefreshStatus>;
  sleep?: (milliseconds: number) => Promise<void>;
  onStatus?: (status: RefreshStatus) => void;
}

const defaultSleep = (milliseconds: number) => new Promise<void>((resolve) => {
  window.setTimeout(resolve, milliseconds);
});

export async function pollRefreshStatus(
  refreshId: string,
  options: PollRefreshOptions = {},
): Promise<RefreshStatus> {
  const fetchStatus = options.fetchStatus ?? fetchRefreshStatus;
  const sleep = options.sleep ?? defaultSleep;
  const attempts = Math.ceil(REFRESH_POLL_TIMEOUT_MS / REFRESH_POLL_INTERVAL_MS);
  let latest: RefreshStatus | null = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    latest = await fetchStatus(refreshId);
    options.onStatus?.(latest);
    const fastTerminal = latest.fast.status === 'completed' || latest.fast.status === 'failed';
    const deepTerminal = ['completed', 'failed', 'unavailable', 'skipped'].includes(latest.deep.status);
    if (fastTerminal && deepTerminal) return latest;
    if (attempt + 1 < attempts) await sleep(REFRESH_POLL_INTERVAL_MS);
  }

  return latest as RefreshStatus;
}
