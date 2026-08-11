// 關鍵字熱度與 ORG 共現的 Worker 端計算，與 src/opinion_pipeline/analysis.py 對齊。
// 全部為可重算的字面統計（計數、log、熵），符合「Worker 只做輕量統計」的邊界。
import { AUTO_TERMS, ENTITY_LEXICON, SENTIMENT_LEXICON, WATCH_TERMS } from './generated-config.js';

export const HEAT_WEIGHTS = { volume: 0.5, acceleration: 0.33, diversity: 0.17 };
const KEYWORD_WINDOW_MS = 24 * 60 * 60 * 1000;
const TREND_BUCKETS = 24;
// 碎片升級參數，與 src/opinion_pipeline/analysis.py 保持一致
const PROMOTE_RATIO = 0.6;
const MAX_PROMOTE_STEPS = 4;
const CJK_RUN = /[㐀-鿿]+/g;

const clamp01 = (value) => Math.min(1, Math.max(0, value));
// 中文不受大小寫影響，只需折疊 ASCII；用 toLowerCase 取代 locale-aware 版本以大幅降低 CPU。
const casefold = (value) => String(value || '').toLowerCase();
const searchTextOf = (item) => `${item.title || ''} ${item.excerpt || ''}`;
// 每筆項目的折疊後文字只計算一次（WeakMap 快取，不污染項目本體）。
const _foldCache = new WeakMap();
function foldOf(item) {
  let value = _foldCache.get(item);
  if (value === undefined) {
    value = casefold(searchTextOf(item));
    _foldCache.set(item, value);
  }
  return value;
}

function matchesFolded(haystack, anyOfFolded, excludeFolded) {
  if (excludeFolded.some((term) => term && haystack.includes(term))) return false;
  return anyOfFolded.some((term) => term && haystack.includes(term));
}

function entropyDiversity(shareValues, enabledSourceCount) {
  if (shareValues.length <= 1 || enabledSourceCount <= 1) return 0;
  const entropy = -shareValues.reduce((acc, p) => (p > 0 ? acc + p * Math.log(p) : acc), 0);
  return clamp01(entropy / Math.log(enabledSourceCount));
}

export function extractAutoTerms(items, cfg = AUTO_TERMS, watchTerms = WATCH_TERMS) {
  const minDocs = Math.max(2, cfg.minDocs);
  const minSources = Math.max(1, cfg.minSources);
  const minLength = cfg.minLength;
  const stopwords = cfg.stopwords || [];
  const watchVocab = watchTerms.flatMap((entry) => [entry.display, ...(entry.anyOf || [])]).filter(Boolean);

  const docCount = new Map();
  const gramDocs = new Map();
  const gramSources = new Map();
  items.forEach((item, docId) => {
    const grams = new Set();
    for (const run of item.title.match(CJK_RUN) || []) {
      for (let size = minLength; size <= 6; size += 1) {
        for (let start = 0; start + size <= run.length; start += 1) grams.add(run.slice(start, start + size));
      }
    }
    for (const gram of grams) {
      docCount.set(gram, (docCount.get(gram) || 0) + 1);
      if (!gramDocs.has(gram)) gramDocs.set(gram, new Set());
      gramDocs.get(gram).add(docId);
      if (!gramSources.has(gram)) gramSources.set(gram, new Set());
      gramSources.get(gram).add(item.source);
    }
  });

  // 依長度分桶，讓支配／升級判斷只掃可能的候選，避免對整張 gram 表做 O(n²) 比對。
  const gramsByLength = new Map();
  for (const gram of docCount.keys()) {
    if (!gramsByLength.has(gram.length)) gramsByLength.set(gram.length, []);
    gramsByLength.get(gram.length).push(gram);
  }
  const blockedCache = new Map();
  const blocked = (gram) => {
    if (!blockedCache.has(gram)) {
      blockedCache.set(
        gram,
        stopwords.some((stop) => gram.includes(stop))
          || watchVocab.some((vocab) => gram.includes(vocab) || vocab.includes(gram)),
      );
    }
    return blockedCache.get(gram);
  };
  // 若某個「更長且被封鎖」的詞涵蓋本詞 ≥80% 的文件，本詞只是它的碎片（如「目標」←「目標價」）。
  const dominatedByBlocked = (gram) => {
    const threshold = 0.8 * docCount.get(gram);
    for (let length = gram.length + 1; length <= 6; length += 1) {
      for (const cand of gramsByLength.get(length) || []) {
        if (cand.includes(gram) && docCount.get(cand) >= threshold && blocked(cand)) return true;
      }
    }
    return false;
  };
  const eligible = (gram) =>
    (docCount.get(gram) || 0) >= minDocs &&
    (gramSources.get(gram)?.size || 0) >= minSources &&
    !blocked(gram) &&
    !dominatedByBlocked(gram);

  // 碎片升級：反覆往外擴一個字，直到沒有夠支配性的父字串。
  // 與 analysis.py 的 promote() 對齊（PROMOTE_RATIO / MAX_PROMOTE_STEPS）。
  const promote = (gram) => {
    let current = gram;
    for (let step = 0; step < MAX_PROMOTE_STEPS; step += 1) {
      const threshold = PROMOTE_RATIO * docCount.get(current);
      let best = null;
      for (const cand of gramsByLength.get(current.length + 1) || []) {
        const count = docCount.get(cand);
        if (!cand.includes(current)) continue;
        if (count < threshold || !eligible(cand)) continue;
        // 與 Python 相同的決勝規則：先比文件數，再比字串序，確保兩端輸出一致
        if (best === null || count > docCount.get(best) || (count === docCount.get(best) && cand > best)) {
          best = cand;
        }
      }
      if (best === null) break;
      current = best;
    }
    return current;
  };

  const redundant = (gram, chosen) =>
    chosen.some((kept) => {
      if (gram.includes(kept) || kept.includes(gram)) return true;
      const a = gramDocs.get(gram);
      const b = gramDocs.get(kept);
      let overlap = 0;
      for (const doc of a) if (b.has(doc)) overlap += 1;
      return overlap >= 0.6 * Math.min(a.size, b.size);
    });

  const ranked = [...docCount.keys()]
    .filter(eligible)
    .sort((a, b) => docCount.get(b) - docCount.get(a) || b.length - a.length || (a < b ? -1 : 1));

  const chosen = [];
  for (const gram of ranked) {
    if (chosen.length >= cfg.maxTerms) break;
    const term = promote(gram);
    if (!redundant(term, chosen)) chosen.push(term);
  }
  return chosen;
}

// enabledSourceCount 為必填，理由同 core.js 的 calculateMetrics：它是 diversity 的分母。
// 先前預設 24，實際來源 37，沿用預設值會靜默產出偏高的熱度。
export function buildKeywords(items, now = Date.now(), enabledSourceCount, watchTerms = WATCH_TERMS) {
  if (!Number.isFinite(enabledSourceCount) || enabledSourceCount < 1) {
    throw new TypeError('buildKeywords 需要明確的 enabledSourceCount（≥1）');
  }
  const windowStart = now - KEYWORD_WINDOW_MS;
  const recent = items.filter((item) => Date.parse(item.publishedAt) >= windowStart);
  const autoTerms = extractAutoTerms(recent);

  const definitions = [];
  for (const entry of watchTerms) {
    const display = String(entry.display || '').trim();
    if (!display) continue;
    const anyOf = (entry.anyOf && entry.anyOf.length ? entry.anyOf : [display]).map(String);
    definitions.push({
      id: `watch-${entry.id || display}`,
      term: display,
      kind: 'manual',
      anyOf,
      exclude: (entry.exclude || []).map(String),
      aliases: anyOf.filter((term) => term !== display),
    });
  }
  autoTerms.forEach((term, index) =>
    definitions.push({ id: `auto-${index + 1}`, term, kind: 'auto', anyOf: [term], exclude: [], aliases: [] }),
  );

  const bucketMs = KEYWORD_WINDOW_MS / TREND_BUCKETS;
  const computed = definitions.map((definition) => {
    const anyOf = definition.anyOf.map(casefold);
    const exclude = definition.exclude.map(casefold);
    const matched = recent.filter((item) => matchesFolded(foldOf(item), anyOf, exclude));
    const sourceCounts = {};
    for (const item of matched) sourceCounts[item.source] = (sourceCounts[item.source] || 0) + 1;
    const total = matched.length;
    const share = {};
    if (total) for (const [src, count] of Object.entries(sourceCounts)) share[src] = Math.round((count / total) * 1000) / 1000;
    const buckets = new Array(TREND_BUCKETS).fill(0);
    for (const item of matched) {
      const index = Math.min(TREND_BUCKETS - 1, Math.floor((Date.parse(item.publishedAt) - windowStart) / bucketMs));
      buckets[index] += 1;
    }
    const recent6 = buckets.slice(-6).reduce((a, b) => a + b, 0);
    const previous6 = buckets.slice(-12, -6).reduce((a, b) => a + b, 0);
    let acceleration = 0;
    if (total) {
      const raw = clamp01(0.5 + (recent6 - previous6) / (2 * Math.max(1, recent6, previous6)));
      acceleration = 0.5 + (raw - 0.5) * Math.min(1, total / 10);
    }
    return { definition, matched: total, share, buckets, acceleration };
  });

  const maxMentions = Math.max(0, ...computed.map((entry) => entry.matched));
  const maxBucket = Math.max(0, ...computed.flatMap((entry) => entry.buckets));
  const keywords = computed.map((entry) => {
    const { definition } = entry;
    const total = entry.matched;
    const volume = maxMentions && total ? clamp01(Math.log1p(total) / Math.log1p(maxMentions)) : 0;
    const diversity = entropyDiversity(Object.values(entry.share), enabledSourceCount);
    const heat =
      Math.round(
        100 *
          (HEAT_WEIGHTS.volume * volume + HEAT_WEIGHTS.acceleration * entry.acceleration + HEAT_WEIGHTS.diversity * diversity) *
          10,
      ) / 10;
    const keyword = {
      id: definition.id,
      term: definition.term,
      kind: definition.kind,
      heat,
      mentions24h: total,
      components: {
        volume: Math.round(volume * 1000) / 1000,
        acceleration: Math.round(entry.acceleration * 1000) / 1000,
        diversity: Math.round(diversity * 1000) / 1000,
        weights: { ...HEAT_WEIGHTS },
      },
      sourceShare: entry.share,
      trend: entry.buckets.map((count, index) => ({
        t: new Date(windowStart + index * bucketMs).toISOString(),
        mentions: count,
        heat: maxBucket ? Math.round((100 * count) / maxBucket * 10) / 10 : 0,
      })),
    };
    if (definition.aliases.length) keyword.aliases = definition.aliases;
    return keyword;
  });

  keywords.sort((a, b) => b.heat - a.heat || b.mentions24h - a.mentions24h || (a.term < b.term ? -1 : 1));
  return keywords;
}

const TOPIC_DEFINITIONS = [
  ['finance', '財經與產業', ['台積電', '半導體', '股市', '經濟', '產業']],
  ['weather', '天氣與防災', ['颱風', '豪雨', '氣象', '地震', '防災']],
  ['politics', '政治與公共政策', ['立法院', '立委', '行政院', '總統', '預算', '政黨']],
  ['society', '社會與生活', ['社會', '交通', '醫療', '健康', '教育', '食安']],
  ['world', '國際與兩岸', ['美國', '中國', '國際', '兩岸', '日本', '歐洲']],
  ['entertainment', '娛樂與影視', ['娛樂', '明星', '藝人', '演唱會', '影視', '電影', '金曲', '八卦', '韓流', '劇集', '男星', '女星', '歌王', '歌后', '票房', '追劇', '節目', '主持人', '金馬', '金鐘']],
];

const TICKER_NOISE = ['盤中速報', '盤後速報', '近5分K', '三大法人買賣超', '融資融券增減'];
const isTickerNoise = (item) => TICKER_NOISE.some((marker) => searchTextOf(item).includes(marker));

function topicBreakdown(id, terms, matched) {
  const counts = new Map(
    terms.map((term) => [term, matched.filter((item) => foldOf(item).includes(casefold(term))).length]),
  );
  const rankedTerms = terms
    .filter((term) => counts.get(term) > 0)
    .sort((a, b) => counts.get(b) - counts.get(a) || terms.indexOf(a) - terms.indexOf(b));

  const daily = new Map();
  const buckets = new Map();
  for (const item of matched) {
    const date = new Date(item.publishedAt).toISOString().slice(0, 10);
    daily.set(date, (daily.get(date) || 0) + 1);
    const haystack = foldOf(item);
    const anchor = rankedTerms.find((term) => haystack.includes(casefold(term))) || rankedTerms[0];
    const key = `${date}\0${anchor}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(item);
  }

  const timeline = [...daily.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, mentions]) => ({ date, mentions }));
  const events = [...buckets.entries()].map(([key, eventItems]) => {
    const [date, anchor] = key.split('\0');
    const eventTerms = rankedTerms
      .map((term) => ({
        term,
        count: eventItems.filter((item) => foldOf(item).includes(casefold(term))).length,
      }))
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.count - a.count || rankedTerms.indexOf(a.term) - rankedTerms.indexOf(b.term))
      .slice(0, 3)
      .map((entry) => entry.term);
    const clean = eventItems.filter((item) => !isTickerNoise(item));
    const preferred = (clean.length ? clean : eventItems)
      .slice()
      .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
    return {
      id: `${id}-${date}-${terms.indexOf(anchor) + 1}`,
      date,
      label: anchor,
      size: eventItems.length,
      terms: eventTerms,
      articles: preferred.slice(0, 3).map((item) => ({
        title: item.title,
        source: item.source,
        url: item.url,
        publishedAt: item.publishedAt,
      })),
    };
  });
  events.sort((a, b) =>
    (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)
      || b.size - a.size
      || (a.label < b.label ? 1 : -1),
  );
  return { rankedTerms, timeline, events: events.slice(0, 8) };
}

export function buildTopics(items) {
  const topics = [];
  for (const [id, label, terms] of TOPIC_DEFINITIONS) {
    const folded = terms.map(casefold);
    const matched = items.filter((item) => {
      const haystack = foldOf(item);
      return folded.some((term) => haystack.includes(term));
    });
    if (!matched.length) continue;
    const clean = matched.filter((item) => !isTickerNoise(item));
    const preferred = clean.length ? clean : matched;
    const summaries = [];
    for (const item of preferred) {
      const text = (item.excerpt || '').trim() || (item.title || '').trim();
      if (text) summaries.push({ text, source: item.source, url: item.url });
      if (summaries.length === 2) break;
    }
    // 逐篇詞典法情緒，彙總成主題分布並保留正／負向依據（與 sentiment.py 對齊）
    const judged = matched.map((item) => ({ item, verdict: classifySentiment(searchTextOf(item)) }));
    const { rankedTerms, timeline, events } = topicBreakdown(id, terms, matched);
    const evidence = { positive: [], negative: [] };
    for (const { item, verdict } of judged) {
      const bucket = verdict.label;
      if ((bucket === 'positive' || bucket === 'negative') && evidence[bucket].length < 3 && verdict.matched.length) {
        evidence[bucket].push({
          title: item.title,
          source: item.source,
          url: item.url,
          terms: verdict.matched.slice(0, 3).map((entry) => entry.term),
        });
      }
    }

    topics.push({
      id,
      label,
      terms: rankedTerms,
      size: matched.length,
      sentiment: aggregateSentiment(judged.map(({ verdict }) => verdict.label)),
      evidence,
      timeline,
      events,
      summarySentences: summaries,
      articles: preferred.slice(0, 5).map((item) => ({
        title: item.title,
        source: item.source,
        url: item.url,
        publishedAt: item.publishedAt,
      })),
    });
  }
  return topics;
}

const MIN_NODE_MENTIONS = 2;
const MIN_EDGE_WEIGHT = 2;
// 分型別配額，與 analysis.py 一致：ORG 提及數天然較高，共用單一上限會擠掉 PERSON
const MAX_ORG_NODES = 24;
const MAX_PERSON_NODES = 16;
// 邊鍵值分隔字元：名稱可能含空白（英文人名），用空白串接會在還原時裂解，
// 故改用不會出現在名稱中的 NUL 字元。
const PAIR_SEP = '\0';

export function buildEntities(items, lexicon = ENTITY_LEXICON) {
  const folded = lexicon.map((entry) => ({
    name: entry.name,
    type: entry.type || 'ORG',
    terms: [entry.name, ...(entry.aliases || [])].map(casefold),
  }));
  const types = new Map(folded.map((entry) => [entry.name, entry.type]));
  const mentions = new Map();
  const pairDocs = new Map();
  for (const item of items) {
    const haystack = foldOf(item);
    const present = folded.filter((entry) => entry.terms.some((term) => haystack.includes(term))).map((entry) => entry.name);
    present.sort();
    for (const name of present) mentions.set(name, (mentions.get(name) || 0) + 1);
    for (let i = 0; i < present.length; i += 1) {
      for (let j = i + 1; j < present.length; j += 1) {
        const key = `${present[i]}${PAIR_SEP}${present[j]}`;
        pairDocs.set(key, (pairDocs.get(key) || 0) + 1);
      }
    }
  }

  const eligible = [...mentions.entries()].filter(([, count]) => count >= MIN_NODE_MENTIONS);
  const kept = [];
  for (const [type, quota] of [
    ['ORG', MAX_ORG_NODES],
    ['PERSON', MAX_PERSON_NODES],
  ]) {
    eligible
      .filter(([name]) => (types.get(name) || 'ORG') === type)
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, quota)
      .forEach(([name]) => kept.push(name));
  }
  kept.sort((a, b) => mentions.get(b) - mentions.get(a) || (a < b ? -1 : 1));

  const nodeIds = new Map(
    kept.map((name, index) => [name, `${(types.get(name) || 'ORG') === 'PERSON' ? 'person' : 'org'}-${index + 1}`]),
  );
  const nodes = kept.map((name) => ({
    id: nodeIds.get(name),
    name,
    type: types.get(name) || 'ORG',
    mentions: mentions.get(name),
  }));
  const edges = [...pairDocs.entries()]
    .map(([key, weight]) => {
      const [left, right] = key.split(PAIR_SEP);
      return { left, right, weight };
    })
    .filter((edge) => edge.weight >= MIN_EDGE_WEIGHT && nodeIds.has(edge.left) && nodeIds.has(edge.right))
    .sort((a, b) => b.weight - a.weight || (a.left < b.left ? -1 : 1))
    .map((edge) => {
      const totalDocs = Math.max(1, items.length);
      const pxy = edge.weight / totalDocs;
      const px = mentions.get(edge.left) / totalDocs;
      const py = mentions.get(edge.right) / totalDocs;
      const npmi = edge.weight < totalDocs
        ? Math.log(pxy / (px * py)) / Math.max(1e-9, -Math.log(pxy))
        : 1;
      return {
        source: nodeIds.get(edge.left),
        target: nodeIds.get(edge.right),
        weight: edge.weight,
        jaccard: Math.round((edge.weight / (mentions.get(edge.left) + mentions.get(edge.right) - edge.weight)) * 1000) / 1000,
        npmi: Math.round(npmi * 1000) / 1000,
      };
    });
  return { nodes, edges };
}


// ── 詞典法情緒（與 src/opinion_pipeline/sentiment.py 對齊）──────────────────
// 只做字面比對，回傳命中詞作為「依據」，可完整重算與解釋。
export function classifySentiment(text, lexicon = SENTIMENT_LEXICON) {
  if (!text) return { label: 'neutral', score: 0, matched: [] };
  const negated = (index) => {
    const start = Math.max(0, index - lexicon.negationWindow);
    const window = text.slice(start, index);
    return lexicon.negations.some((neg) => window.includes(neg));
  };
  let positive = 0;
  let negative = 0;
  const matched = [];
  for (const [polarity, table] of [
    ['positive', lexicon.positive],
    ['negative', lexicon.negative],
  ]) {
    for (const { term, weight } of table) {
      // 只取第一次出現，與 sentiment.py 的 text.find 對齊（parity 要求）。
      // 同詞多次且極性不一致時不會被完整反映，這是刻意的 baseline 限制。
      const index = text.indexOf(term);
      if (index < 0) continue;
      let effective = polarity;
      if (negated(index)) effective = polarity === 'positive' ? 'negative' : 'positive';
      if (effective === 'positive') positive += weight;
      else negative += weight;
      matched.push({ term, polarity: effective, weight });
    }
  }
  const total = positive + negative;
  if (!total) return { label: 'neutral', score: 0, matched: [] };
  const score = Math.round(((positive - negative) / total) * 1000) / 1000;
  const label = positive > negative ? 'positive' : negative > positive ? 'negative' : 'neutral';
  matched.sort((a, b) => b.weight - a.weight || (a.term < b.term ? -1 : 1));
  return { label, score, matched: matched.slice(0, 6) };
}

/** 在管線端附加一次情緒判讀；前端僅讀取此欄位，不維護第二套詞典。 */
export function withSentiment(item) {
  return { ...item, sentiment: classifySentiment(searchTextOf(item)) };
}

export function aggregateSentiment(labels) {
  if (!labels.length) return { positive: 0, neutral: 1, negative: 0 };
  const total = labels.length;
  const counts = {
    positive: labels.filter((label) => label === 'positive').length,
    negative: labels.filter((label) => label === 'negative').length,
  };
  counts.neutral = total - counts.positive - counts.negative;
  const ratios = {};
  for (const key of ['positive', 'neutral', 'negative']) {
    ratios[key] = Math.round((counts[key] / total) * 1000) / 1000;
  }
  // 補回捨入誤差，確保三者總和恰為 1
  const drift = Math.round((1 - (ratios.positive + ratios.neutral + ratios.negative)) * 1000) / 1000;
  if (drift) {
    const dominant = ['positive', 'neutral', 'negative'].reduce((a, b) => (ratios[a] >= ratios[b] ? a : b));
    ratios[dominant] = Math.round((ratios[dominant] + drift) * 1000) / 1000;
  }
  return ratios;
}
