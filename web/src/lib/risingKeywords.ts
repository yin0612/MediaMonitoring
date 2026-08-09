import type { Keyword, RecentItem } from '../types/contracts';

export interface RisingKeyword {
  term: string;
  recentMentions: number;
  previousMentions: number;
  delta: number;
  changePercent: number | null;
}

function timestamp(value: Date | string): number {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

const NOISE_STOPWORDS = new Set([
  // 財經與版型雜訊
  '億元', '萬元', '美元', '台幣', '新台幣', '億美', '億台幣', '百萬', '千萬', '近億',
  '月營收', '營收', '年增', '月增', '季增', '累積營收', '獲利', '淨利', '毛利率', '營業額', '財報', '盈餘', '每股盈餘', '每股', 'eps', '稅後',
  '新高', '新低', '創下', '暴漲', '暴跌', '飆漲', '重挫', '漲停', '跌停', '大漲', '大跌', '亮眼', '表現', '挑戰', '突破', '衝破', '雙增', '三增', '亮麗',
  '股價', '概念股', '法說會', '投信', '自營商', '買超', '賣超', '籌碼', '目標價', '評等',
  // 行政區劃與通用地名（排除作為獨立升溫事件詞）
  '台北', '北市', '北市府', '台北市', '新北', '新北市', '台中', '中市', '中市府', '台中市', '台南', '台南市', '南市',
  '高雄', '高市', '高市府', '高雄市', '桃園', '桃市', '桃園市', '新竹', '竹市', '竹縣', '基隆', '基市', '宜蘭', '花蓮', '台東',
  '屏東', '嘉義', '彰化', '南投', '雲林', '苗栗', '縣府', '市府', '全台', '全縣', '全市', '台灣', '國內', '國外', '中央', '地方',
  // 通用非事件連載詞（過濾如「標準」、「相關」、「大戰」等動能雜訊）
  '標準', '相關', '目前', '未來', '最新', '現場', '影響', '宣佈', '宣布', '推出', '指出', '強調', '進行', '出現', '持續', '說明', '呼籲', '提出',
  '大戰', '大展', '展覽', '大賽', '比賽', '活動', '報導', '表示', '市場', '產業', '公司', '集團', '單位', '代表',
]);

/** Compare the latest and preceding half-open time windows using existing keyword terms. */
export function getRisingKeywords(
  items: RecentItem[],
  keywords: Keyword[],
  now: Date | string,
  windowMinutes = 90,
): RisingKeyword[] {
  const end = timestamp(now);
  const windowMs = Math.max(1, windowMinutes) * 60_000;
  if (!Number.isFinite(end)) return [];

  const recentStart = end - windowMs;
  const previousStart = recentStart - windowMs;
  const counts = new Map<string, { recent: number; previous: number }>();
  const terms = keywords
    .map((keyword) => keyword.term.trim())
    .filter((term) => Boolean(term) && !NOISE_STOPWORDS.has(term.toLowerCase()));

  for (const item of items) {
    const published = timestamp(item.publishedAt);
    if (!Number.isFinite(published) || published < previousStart || published >= end) continue;
    const bucket = published >= recentStart ? 'recent' : 'previous';
    const haystack = `${item.title} ${item.excerpt}`.toLocaleLowerCase('zh-TW');
    const matched = new Set(terms.filter((term) => haystack.includes(term.toLocaleLowerCase('zh-TW'))));
    for (const term of matched) {
      const count = counts.get(term) ?? { recent: 0, previous: 0 };
      count[bucket] += 1;
      counts.set(term, count);
    }
  }

  return [...counts.entries()]
    .map(([term, count]) => {
      const delta = count.recent - count.previous;
      return {
        term,
        recentMentions: count.recent,
        previousMentions: count.previous,
        delta,
        changePercent: count.previous > 0 ? Math.round((delta / count.previous) * 100) : null,
      };
    })
    .filter((item) => item.recentMentions >= 2 && item.delta > 0)
    .sort((a, b) => b.delta - a.delta || b.recentMentions - a.recentMentions || a.term.localeCompare(b.term, 'zh-Hant'))
    .slice(0, 5);
}
