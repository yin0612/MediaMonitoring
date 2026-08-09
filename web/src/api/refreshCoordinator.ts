export const DATA_REFRESH_EVENT = 'media-monitoring:refresh';

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
