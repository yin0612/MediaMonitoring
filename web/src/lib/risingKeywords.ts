import type { Keyword } from '../types/contracts';

export interface RisingKeyword {
  term: string;
  currentMentions: number;
  sourceCount: number;
  baseline: number[];
  baselineMedian: number;
  burstScore: number;
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
  // 年齡與性別新聞標題片段過濾（過濾如「歲女」、「歲男」等片段詞）
  '歲女', '歲男', '歲婦', '歲翁', '歲童', '歲幼', '歲男童', '歲女童', '歲高齡', '名男', '名女', '歲的', '幾歲', '男子', '女子', '男童', '女童', '男性', '女性',
]);

function isInvalidRisingTerm(term: string): boolean {
  const lower = term.toLowerCase().trim();
  if (NOISE_STOPWORDS.has(lower)) return true;
  if (/^\d*歲[男女兒婦翁童幼人]/.test(lower) || /歲[男女兒婦翁童幼人]$/.test(lower)) return true;
  if (/\d+歲/.test(lower)) return true;
  if (/(大戰|大展|展覽|大賽|比賽|活動|報導|表示|市場|產業|公司|集團|單位|代表)/.test(lower)) return true;
  return false;
}

/** Use only the pipeline's auditable seven-day same-hour burst evidence. */
export function getRisingKeywords(keywords: Keyword[]): RisingKeyword[] {
  return keywords
    .filter((keyword) => !isInvalidRisingTerm(keyword.term))
    .filter((keyword) => (
      typeof keyword.burstScore === 'number'
      && keyword.burstScore > 0
      && (keyword.burstCurrent ?? 0) >= 5
      && (keyword.burstSourceCount ?? 0) >= 3
      && keyword.burstBaseline?.length === 7
    ))
    .map((keyword) => ({
      term: keyword.term,
      currentMentions: keyword.burstCurrent ?? 0,
      sourceCount: keyword.burstSourceCount ?? 0,
      baseline: keyword.burstBaseline ?? [],
      baselineMedian: keyword.burstBaselineMedian ?? 0,
      burstScore: keyword.burstScore as number,
    }))
    .sort((a, b) => b.burstScore - a.burstScore || b.currentMentions - a.currentMentions || a.term.localeCompare(b.term, 'zh-Hant'))
    .slice(0, 5);
}
