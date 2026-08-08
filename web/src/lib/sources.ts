import type { SourceId, SourceStatus, GlobalStatus } from '../types/contracts';
import type { ChartTokens } from './theme';

export interface SourceMeta {
  id: SourceId;
  name: string;
  short: string;
  /** 分類色 slot（0–7）；null 代表使用 muted 灰。 */
  series: number | null;
  /** 是否為新聞來源（用於聚合與說明）。 */
  news: boolean;
}

// 顏色依「來源身分」固定指定（非依排名），維持全站一致。
export const SOURCE_META: Record<SourceId, SourceMeta> = {
  tvbs: { id: 'tvbs', name: 'TVBS', short: 'TVBS', series: 0, news: true },
  ebc: { id: 'ebc', name: '東森新聞', short: '東森', series: 1, news: true },
  setn: { id: 'setn', name: '三立新聞', short: '三立', series: 2, news: true },
  ftv: { id: 'ftv', name: '民視新聞', short: '民視', series: 3, news: true },
  cti: { id: 'cti', name: '中天新聞', short: '中天', series: 4, news: true },
  era: { id: 'era', name: '年代新聞', short: '年代', series: 5, news: true },
  nexttv: { id: 'nexttv', name: '壹電視', short: '壹電視', series: 6, news: true },
  pts: { id: 'pts', name: '公視新聞', short: '公視', series: 7, news: true },
  ttv: { id: 'ttv', name: '台視新聞', short: '台視', series: 2, news: true },
  cts: { id: 'cts', name: '華視新聞', short: '華視', series: 5, news: true },
  udn: { id: 'udn', name: 'UDN', short: 'UDN', series: 0, news: true },
  ltn: { id: 'ltn', name: '自由時報', short: '自由', series: 1, news: true },
  cna: { id: 'cna', name: '中央社', short: '中央社', series: 2, news: true },
  moneyudn: { id: 'moneyudn', name: '經濟日報', short: '經濟日報', series: 3, news: true },
  ctee: { id: 'ctee', name: '工商時報', short: '工商', series: 4, news: true },
  anue: { id: 'anue', name: '鉅亨網', short: '鉅亨', series: 5, news: true },
  wealth: { id: 'wealth', name: '財訊', short: '財訊', series: 6, news: true },
  businessweekly: { id: 'businessweekly', name: '商業週刊', short: '商周', series: 7, news: true },
  thenewslens: { id: 'thenewslens', name: '關鍵評論網', short: '關鍵評論', series: 0, news: true },
  reporter: { id: 'reporter', name: '報導者', short: '報導者', series: 1, news: true },
  newtalk: { id: 'newtalk', name: '新頭殼', short: '新頭殼', series: 2, news: true },
  nownews: { id: 'nownews', name: 'NOWNEWS', short: 'NOWNEWS', series: 3, news: true },
  nextapple: { id: 'nextapple', name: '壹蘋新聞網', short: '壹蘋', series: 4, news: true },
  ettoday: { id: 'ettoday', name: 'ETtoday', short: 'ETtoday', series: 5, news: true },
  rti: { id: 'rti', name: '中央廣播電臺', short: '央廣', series: 6, news: true },
  technews: { id: 'technews', name: '科技新報', short: '科技新報', series: 7, news: true },
  taipeitimes: { id: 'taipeitimes', name: 'Taipei Times', short: '北時', series: 0, news: true },
  coolloud: { id: 'coolloud', name: '苦勞網', short: '苦勞網', series: 1, news: true },
  tfc: { id: 'tfc', name: '台灣事實查核中心', short: '事實查核', series: 2, news: true },
  moneydj: { id: 'moneydj', name: 'MoneyDJ 理財網', short: 'MoneyDJ', series: 3, news: true },
  businesstoday: { id: 'businesstoday', name: '今周刊', short: '今周刊', series: 4, news: true },
  bnext: { id: 'bnext', name: '數位時代', short: '數位時代', series: 5, news: true },
  managertoday: { id: 'managertoday', name: '經理人', short: '經理人', series: 6, news: true },
  chinatimes: { id: 'chinatimes', name: '中時新聞網', short: '中時', series: 7, news: true },
  ctwant: { id: 'ctwant', name: 'CTWANT', short: 'CTWANT', series: 0, news: true },
  mnews: { id: 'mnews', name: '鏡新聞', short: '鏡新聞', series: 1, news: true },
  mirrormedia: { id: 'mirrormedia', name: '鏡週刊', short: '鏡週刊', series: 2, news: true },
};

/** 依顯示順序排列的新聞來源。 */
export const NEWS_SOURCE_IDS: SourceId[] = (Object.values(SOURCE_META) as SourceMeta[])
  .filter((m) => m.news)
  .map((m) => m.id);

export function sourceName(id: SourceId): string {
  return SOURCE_META[id]?.name ?? id;
}

export function sourceShort(id: SourceId): string {
  return SOURCE_META[id]?.short ?? id;
}

export function sourceModeLabel(mode?: 'official-rss' | 'google-news' | 'site-listing'): string {
  if (mode === 'official-rss') return '官方 RSS';
  if (mode === 'site-listing') return '官網低頻';
  return 'Google News 補充';
}

/** 回傳 CSS 變數字串（供一般 UI 使用）。 */
export function sourceColor(id: SourceId): string {
  const s = SOURCE_META[id]?.series;
  return s == null ? 'var(--text-muted)' : `var(--series-${s + 1})`;
}

/** 回傳已解析的實際色值（供 ECharts canvas 使用）。 */
export function sourceColorValue(id: SourceId, tokens: ChartTokens): string {
  const s = SOURCE_META[id]?.series;
  if (s == null) return tokens.muted;
  return tokens.series[s] ?? tokens.muted;
}

/** 狀態 → 徽章樣式與中文標籤。 */
export const STATUS_LABEL: Record<SourceStatus, { label: string; variant: string }> = {
  ok: { label: '正常', variant: 'good' },
  stale: { label: '資料過期', variant: 'warning' },
  degraded: { label: '降級', variant: 'serious' },
  error: { label: '錯誤', variant: 'critical' },
  disabled: { label: '停用', variant: 'muted' },
};

export const GLOBAL_STATUS_LABEL: Record<GlobalStatus, { label: string; variant: string }> = {
  ok: { label: '運作正常', variant: 'good' },
  partial: { label: '部分來源異常', variant: 'warning' },
  stale: { label: '資料延遲', variant: 'serious' },
  error: { label: '系統異常', variant: 'critical' },
};
