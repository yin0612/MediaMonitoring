export const REFRESH_INTERVALS = {
  search: 30_000,
  trends: 120_000,
} as const;

import type { SearchArticle, TrendNewsItem } from '../types/contracts';
import { SOURCE_META } from './sources';

export function nextRefreshSeconds(lastUpdatedAt: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((lastUpdatedAt + REFRESH_INTERVALS.search - now) / 1_000));
}

export function searchArticlesToTrendNews(items: SearchArticle[]): TrendNewsItem[] {
  return items.map((item) => ({
    title: item.title,
    source: SOURCE_META[item.source]?.name ?? item.source,
    url: item.url,
    publishedAt: item.publishedAt,
  }));
}
