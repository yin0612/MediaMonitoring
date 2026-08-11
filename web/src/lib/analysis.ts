import type { ArticleSentiment, SearchArticle } from '../types/contracts';

export interface TermStat { term: string; count: number; change: number; burstScore: number | null }

const STOPWORDS = new Set(['新聞', '表示', '指出', '今天', '目前', '相關', '最新', '台灣', '報導', '消息']);

function queryGroups(rawQuery: string): { positives: string[]; negatives: string[] }[] {
  return rawQuery.split(/\s+OR\s+/i).map((group) => {
    const positives: string[] = [];
    const negatives: string[] = [];
    let negateNext = false;
    for (const match of group.matchAll(/"([^"]+)"|(\S+)/g)) {
      let token = (match[1] || match[2] || '').trim();
      if (!token || /^AND$/i.test(token)) continue;
      if (/^NOT$/i.test(token)) { negateNext = true; continue; }
      let negative = negateNext;
      negateNext = false;
      if (token.startsWith('-')) { negative = true; token = token.slice(1); }
      if (token) (negative ? negatives : positives).push(token.toLocaleLowerCase('zh-TW'));
    }
    return { positives, negatives };
  });
}

export function matchesAdvancedQuery(text: string, query: string): boolean {
  const haystack = text.toLocaleLowerCase('zh-TW');
  return queryGroups(query).some(({ positives, negatives }) =>
    positives.every((term) => haystack.includes(term)) && negatives.every((term) => !haystack.includes(term)),
  );
}

/** 只讀取管線結果；不在瀏覽器維護第二份情緒詞典。 */
export function sentimentLabelOf(
  sentiment: ArticleSentiment | ArticleSentiment['label'] | null,
): ArticleSentiment['label'] | null {
  if (typeof sentiment === 'string') return sentiment;
  return sentiment?.label ?? null;
}

// Segmenter 只建立一次：extractTermStats 會對每篇文章呼叫 words()，
// 原本在函式內建構，比較三個主題時會重複建立數百個實例。
const SEGMENTER = new (Intl as unknown as {
  Segmenter: new (locale: string, options: { granularity: 'word' }) => {
    segment: (value: string) => Iterable<{ segment: string; isWordLike?: boolean }>;
  };
}).Segmenter('zh-TW', { granularity: 'word' });

function words(text: string): string[] {
  const base = [...SEGMENTER.segment(text)]
    .filter((part) => part.isWordLike)
    .map((part) => part.segment.trim())
    .filter((word) => word.length >= 2 && !STOPWORDS.has(word));
  const compounds = base.slice(0, -1)
    .map((word, index) => `${word}${base[index + 1]}`)
    .filter((word) => /^[\u3400-\u9fff]{4,8}$/.test(word));
  return [...base, ...compounds];
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

function robustBurstScore(current: number, baseline: number[], sourceCount: number): number | null {
  if (current < 5 || sourceCount < 3 || baseline.length < 7) return null;
  const center = median(baseline);
  const mad = median(baseline.map((value) => Math.abs(value - center)));
  return Math.round(((current - center) / Math.max(1, 1.4826 * mad)) * 1_000) / 1_000;
}

export function extractTermStats(items: SearchArticle[], midpoint: number, excluded: string[] = []): { top: TermStat[]; rising: TermStat[] } {
  const excludedSet = new Set(excluded.map((term) => term.toLocaleLowerCase('zh-TW')));
  const timestamps = items.map((item) => Date.parse(item.publishedAt)).filter(Number.isFinite);
  const windowStart = timestamps.length ? Math.min(...timestamps) : midpoint;
  const windowEnd = timestamps.length ? Math.max(...timestamps) : midpoint;
  const bucketMs = Math.max(1, (windowEnd - windowStart) / 8);
  const counts = new Map<string, { buckets: number[]; currentSources: Set<string> }>();
  for (const item of items) {
    const timestamp = Date.parse(item.publishedAt);
    const bucket = windowEnd === windowStart
      ? 7
      : Math.max(0, Math.min(7, Math.floor((timestamp - windowStart) / bucketMs)));
    for (const term of new Set(words(`${item.title} ${item.excerpt}`))) {
      if (excludedSet.has(term.toLocaleLowerCase('zh-TW'))) continue;
      const value = counts.get(term) ?? { buckets: new Array(8).fill(0), currentSources: new Set<string>() };
      value.buckets[bucket] += 1;
      if (bucket === 7) value.currentSources.add(item.source);
      counts.set(term, value);
    }
  }
  const values = [...counts.entries()].map(([term, value]) => {
    const baseline = value.buckets.slice(0, 7);
    const current = value.buckets[7];
    const center = median(baseline);
    return {
      term,
      count: value.buckets.reduce((sum, count) => sum + count, 0),
      change: current - center,
      burstScore: robustBurstScore(current, baseline, value.currentSources.size),
    };
  });
  return {
    top: [...values].sort((a, b) => b.count - a.count || b.change - a.change).slice(0, 10),
    rising: values
      .filter((item) => item.burstScore !== null && item.burstScore > 0)
      .sort((a, b) => (b.burstScore ?? 0) - (a.burstScore ?? 0) || b.count - a.count)
      .slice(0, 10),
  };
}
