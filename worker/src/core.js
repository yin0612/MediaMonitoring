const RANGE_MS = {
  '1h': 3_600_000,
  '6h': 21_600_000,
  '12h': 43_200_000,
  '24h': 86_400_000,
  '7d': 604_800_000,
  '30d': 2_592_000_000,
};
const compactCjkSpaces = (value) => value.replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, '$1');
const TAIWAN_OFFSET_MS = 8 * 60 * 60 * 1_000;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1_000;

export function normalizePublishedAt(rawDate, now = Date.now()) {
  let timestamp = Date.parse(rawDate);
  if (Number.isNaN(timestamp)) return null;
  if (timestamp > now + FUTURE_TOLERANCE_MS) {
    const corrected = timestamp - TAIWAN_OFFSET_MS;
    if (corrected <= now + FUTURE_TOLERANCE_MS) timestamp = corrected;
  }
  if (timestamp > now + FUTURE_TOLERANCE_MS) return null;
  return new Date(timestamp).toISOString();
}

const decodeXml = (value = '') =>
  value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const extract = (block, tag) => {
  const escaped = tag.replace(':', '\\:');
  const match = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
  return decodeXml(match?.[1] || '');
};

const tagAttribute = (block, tag, attribute) => {
  const escaped = tag.replace(':', '\\:');
  const match = block.match(new RegExp(`<${escaped}[^>]*\\s${attribute}=["']([^"']+)["'][^>]*>`, 'i'));
  return decodeXml(match?.[1] || '');
};

const canonicalUrl = (raw) => {
  try {
    const url = new URL(raw);
    [...url.searchParams.keys()].forEach((key) => {
      if (key.toLowerCase().startsWith('utm_') || ['fbclid', 'gclid', 'ref', 'source'].includes(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    });
    url.hash = '';
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/$/, '');
    return url.toString();
  } catch {
    return '';
  }
};

const entryBlocks = (xml) => ['item', 'entry'].flatMap((tag) => (
  xml.match(new RegExp(`<((?:[A-Za-z_][\\w.-]*:)?${tag})(?:\\s[^>]*)?>[\\s\\S]*?<\\/\\1>`, 'gi')) || []
));

const XML_TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE(?:(?:"[^"]*"|'[^']*'|\[[\s\S]*?\]|[^>]))*>|<\/[A-Za-z_][A-Za-z0-9_.:-]*\s*>|<[A-Za-z_][A-Za-z0-9_.:-]*(?:(?:[^<>"']|"[^"<]*"|'[^'<]*'))*>/gi;
const localNameCache = new Map();
const localXmlName = (name) => {
  let local = localNameCache.get(name);
  if (!local) {
    local = name.slice(name.lastIndexOf(':') + 1).toLowerCase();
    if (localNameCache.size < 256) localNameCache.set(name, local);
  }
  return local;
};

const scanXmlStructure = (xml) => {
  if (typeof xml !== 'string') return null;
  const stack = [];
  let cursor = 0;
  let rootName = '';
  let rootType = '';
  let rootClosed = false;
  let hasRssChannel = false;
  let entryCount = 0;
  let invalidPlacement = false;
  let doctypeSeen = false;
  let activeEntryName = '';
  let activeEntryStart = -1;
  const blocks = [];

  XML_TOKEN.lastIndex = 0;
  let match;
  while ((match = XML_TOKEN.exec(xml)) !== null) {
    const gapStart = cursor === 0 && xml.charCodeAt(0) === 0xfeff ? 1 : cursor;
    const strayOpening = xml.indexOf('<', gapStart);
    if ((strayOpening >= 0 && strayOpening < match.index)
      || (!stack.length && /\S/.test(xml.slice(gapStart, match.index)))) return null;
    const token = match[0];
    cursor = match.index + token.length;

    if (token.startsWith('<!--')) continue;
    if (token.startsWith('<![CDATA[')) {
      if (!stack.length) return null;
      continue;
    }
    if (token.startsWith('<?')) continue;
    if (/^<!DOCTYPE\b/i.test(token)) {
      if (rootName || stack.length || doctypeSeen) return null;
      doctypeSeen = true;
      continue;
    }
    if (token.startsWith('</')) {
      const name = token.slice(2, -1).trim();
      if (stack.pop() !== name) return null;
      if (name === activeEntryName) {
        blocks.push(xml.slice(activeEntryStart, cursor));
        activeEntryName = '';
        activeEntryStart = -1;
      }
      if (!stack.length) rootClosed = true;
      continue;
    }

    const nameEnd = token.search(/[\s/>]/);
    if (nameEnd < 2) return null;
    const name = token.slice(1, nameEnd);
    const selfClosing = token[token.length - 2] === '/';
    if (!stack.length) {
      if (rootName || rootClosed) return null;
      rootName = name;
      rootType = localXmlName(name);
    }
    const nameType = localXmlName(name);
    if (nameType === 'channel' && ['rss', 'rdf'].includes(rootType)) {
      const directChannel = stack.length === 1 && stack[0] === rootName;
      if (!directChannel || hasRssChannel) invalidPlacement = true;
      else hasRssChannel = true;
    }
    if (nameType === 'item') {
      entryCount += 1;
      const parentType = stack.length ? localXmlName(stack[stack.length - 1]) : '';
      const rssItem = rootType === 'rss' && stack.length === 2 && parentType === 'channel' && stack[0] === rootName;
      const rdfItem = rootType === 'rdf' && (
        (stack.length === 1 && stack[0] === rootName)
        || (stack.length === 2 && parentType === 'channel' && stack[0] === rootName)
      );
      if (!rssItem && !rdfItem) invalidPlacement = true;
      else if (!selfClosing) {
        activeEntryName = name;
        activeEntryStart = match.index;
      }
    } else if (nameType === 'entry') {
      entryCount += 1;
      if (!(rootType === 'feed' && stack.length === 1 && stack[0] === rootName)) invalidPlacement = true;
      else if (!selfClosing) {
        activeEntryName = name;
        activeEntryStart = match.index;
      }
    }
    if (selfClosing) {
      if (!stack.length) rootClosed = true;
    } else {
      stack.push(name);
    }
  }

  const trailingStart = cursor === 0 && xml.charCodeAt(0) === 0xfeff ? 1 : cursor;
  if (xml.indexOf('<', trailingStart) >= 0
    || (!stack.length && /\S/.test(xml.slice(trailingStart)))) return null;
  if (!rootName || !rootClosed || stack.length || invalidPlacement) return null;
  return { rootName: rootType, hasRssChannel, entryCount, blocks };
};

const isFeedStructure = (structure) => structure?.rootName === 'feed'
  || (['rss', 'rdf'].includes(structure?.rootName) && structure.hasRssChannel);

const linkOf = (block) => {
  const text = extract(block, 'link');
  if (text) return text;
  const href = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i)?.[1];
  return decodeXml(href || '');
};

export function validateQuery(rawQuery, rawRange = '24h') {
  const query = String(rawQuery || '').trim();
  const range = String(rawRange || '24h');
  if (query.length < 2 || query.length > 50) throw new Error('INVALID_QUERY');
  if (!(range in RANGE_MS)) throw new Error('INVALID_RANGE');
  return { query, range };
}

export function matchesQuery(text, rawQuery) {
  const haystack = String(text || '').toLocaleLowerCase('zh-TW');
  const groups = String(rawQuery || '').split(/\s+OR\s+/i);
  return groups.some((group) => {
    const positives = [];
    const negatives = [];
    let negateNext = false;
    for (const match of group.matchAll(/"([^"]+)"|(\S+)/g)) {
      let token = (match[1] || match[2] || '').trim();
      if (!token || /^AND$/i.test(token)) continue;
      if (/^NOT$/i.test(token)) {
        negateNext = true;
        continue;
      }
      let negative = negateNext;
      negateNext = false;
      if (token.startsWith('-')) {
        negative = true;
        token = token.slice(1);
      }
      if (!token) continue;
      (negative ? negatives : positives).push(token.toLocaleLowerCase('zh-TW'));
    }
    return positives.every((term) => haystack.includes(term)) && negatives.every((term) => !haystack.includes(term));
  });
}

export function parseRss(xml, source) {
  const structure = scanXmlStructure(xml);
  const blocks = structure?.blocks ?? [];
  const items = blocks
    .slice(0, 20)
    .map((block, index) => {
      const title = extract(block, 'title');
      const url = canonicalUrl(linkOf(block));
      const rawDate = extract(block, 'pubDate')
        || extract(block, 'published')
        || extract(block, 'updated')
        || extract(block, 'dc:date');
      const publishedAt = normalizePublishedAt(rawDate);
      if (!title || !url || !publishedAt) return null;
      return {
        id: `${source}-${extract(block, 'guid') || extract(block, 'id') || index}`,
        source,
        title: title.slice(0, 200),
        excerpt: (extract(block, 'description') || extract(block, 'summary')).slice(0, 140),
        publishedAt,
        url,
        sentiment: null,
      };
    })
    .filter(Boolean);
  return {
    items,
    isFeedDocument: isFeedStructure(structure),
    entryCount: structure?.entryCount ?? blocks.length,
  };
}

export function googleNewsSiteUrl(domain) {
  const url = new URL('https://news.google.com/rss/search');
  url.searchParams.set('q', `site:${domain} when:1d`);
  url.searchParams.set('hl', 'zh-TW');
  url.searchParams.set('gl', 'TW');
  url.searchParams.set('ceid', 'TW:zh-Hant');
  return url.toString();
}

/** 解析單一媒體的 Google News `site:網域` feed；移除「 - 媒體名」尾綴，全部歸屬該來源。 */
export function parseGoogleNewsForSource(xml, source, now = Date.now()) {
  const names = new Set([source.displayName, ...(source.aliases || [])].map((value) => value.replace(/\s+/g, '')));
  return entryBlocks(xml)
    .slice(0, 40)
    .map((block, index) => {
      let title = extract(block, 'title');
      const cut = title.lastIndexOf(' - ');
      if (cut > 0 && names.has(title.slice(cut + 3).replace(/\s+/g, ''))) title = title.slice(0, cut);
      const url = canonicalUrl(linkOf(block));
      const rawDate = extract(block, 'pubDate') || extract(block, 'published') || extract(block, 'updated');
      const publishedAt = normalizePublishedAt(rawDate, now);
      if (!title || !url || !publishedAt) return null;
      return {
        id: `gnews-${source.id}-${extract(block, 'guid') || extract(block, 'id') || index}`,
        source: source.id,
        title: title.slice(0, 200),
        excerpt: '',
        publishedAt,
        url,
        sentiment: null,
      };
    })
    .filter(Boolean);
}

/** 兩層去重：canonical URL，再依（來源, 壓空白標題）；標題層偏好非 Google News 轉址的原文。 */
export function dedupeSnapshot(items) {
  const byUrl = new Map();
  for (const item of [...items].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))) {
    const key = canonicalUrl(item.url);
    if (key && !byUrl.has(key)) byUrl.set(key, item);
  }
  const isOriginal = (item) => !item.url.includes('news.google.com');
  const byTitle = new Map();
  for (const item of byUrl.values()) {
    const key = `${item.source}:${item.title.replace(/\s+/g, '').toLocaleLowerCase('zh-TW')}`;
    const kept = byTitle.get(key);
    if (!kept || (isOriginal(item) && !isOriginal(kept))) byTitle.set(key, item);
  }
  return [...byTitle.values()].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

export function parseGoogleNewsRss(xml, sources) {
  return entryBlocks(xml)
    .slice(0, 100)
    .map((block, index) => {
      const sourceName = extract(block, 'source');
      const sourceUrl = tagAttribute(block, 'source', 'url');
      const normalizedName = sourceName.replace(/\s+/g, '').toLocaleLowerCase('zh-TW');
      let hostname = '';
      try {
        hostname = new URL(sourceUrl).hostname.toLowerCase();
      } catch {
        hostname = '';
      }
      const source = sources.find((candidate) =>
        candidate.domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
          || candidate.aliases.some((alias) => alias.replace(/\s+/g, '').toLocaleLowerCase('zh-TW') === normalizedName),
      );
      const title = extract(block, 'title');
      const url = canonicalUrl(linkOf(block));
      const rawDate = extract(block, 'pubDate') || extract(block, 'published') || extract(block, 'updated');
      const publishedAt = normalizePublishedAt(rawDate);
      if (!source || !title || !url || !publishedAt) return null;
      return {
        id: `google-news-${source.id}-${extract(block, 'guid') || index}`,
        source: source.id,
        title: title.slice(0, 200),
        excerpt: '',
        publishedAt,
        url,
        sentiment: null,
      };
    })
    .filter(Boolean);
}

export function parseTrendsRss(xml) {
  return entryBlocks(xml)
    .slice(0, 20)
    .map((block) => {
      const news = (block.match(/<ht:news_item(?:\s[^>]*)?>[\s\S]*?<\/ht:news_item>/gi) || [])
        .map((newsBlock) => ({
          title: extract(newsBlock, 'ht:news_item_title'),
          source: extract(newsBlock, 'ht:news_item_source'),
          url: canonicalUrl(extract(newsBlock, 'ht:news_item_url')),
        }))
        .filter((item) => {
          if (!item.title || !item.url) return false;
          return true;
        });
      const timestamp = Date.parse(extract(block, 'pubDate'));
      return {
        title: compactCjkSpaces(extract(block, 'title')),
        approximateTraffic: extract(block, 'ht:approx_traffic'),
        publishedAt: Number.isNaN(timestamp) ? '' : new Date(timestamp).toISOString(),
        news,
      };
    })
    .filter((item) => item.title);
}

const clamp01 = (value) => Math.min(1, Math.max(0, value));

/**
 * 搜尋結果的熱度。
 *
 * 注意：這**不是**關鍵字熱度榜用的公式。兩者權重相同（0.50/0.33/0.17），但分量定義不同：
 *   - 搜尋（本函式與前端 buildStaticSearchData）：volume = 命中數 / 來源數，
 *     diversity = 命中來源數 / 來源數。
 *   - 關鍵字榜（analysis.js buildKeywords / analysis.py build_keywords）：
 *     volume = log1p(命中數) / log1p(當期最大值)，diversity = 來源分布熵 / ln(來源數)。
 *
 * 已知飽和特性：呼叫端會先 `.slice(0, 100)` 再計算，因此 mentions 上限為 100，
 * 且命中數達到來源數（37）時 volume 就固定為 1.0，熱門查詢之間會失去區辨力。
 * 前端 fallback 採用相同公式與相同切片，兩條路徑數字一致（無 parity 問題）。
 * 要改變這個定義會直接改動使用者看到的數字，屬於產品決策，不應在重構中順手調整。
 *
 * enabledSourceCount 為必填：它是 volume 與 diversity 的分母。
 * 先前預設為 6（實際來源 37），一旦被沿用就會把熱度嚴重高估且不會報錯。
 * core.js 刻意不引入 sources.js 以保持純函式，因此改為缺少即拋錯，而非猜一個值。
 */
export function calculateMetrics(items, range, now = Date.now(), enabledSourceCount) {
  if (!Number.isFinite(enabledSourceCount) || enabledSourceCount < 1) {
    throw new TypeError('calculateMetrics 需要明確的 enabledSourceCount（≥1）');
  }
  if (items.length === 0) {
    return { heat: 0, mentions: 0, sourceCount: 0, volume: 0, acceleration: 0, diversity: 0 };
  }
  const windowMs = RANGE_MS[range];
  const midpoint = now - windowMs / 2;
  const recent = items.filter((item) => Date.parse(item.publishedAt) >= midpoint).length;
  const previous = Math.max(0, items.length - recent);
  const acceleration = clamp01(0.5 + (recent - previous) / (2 * Math.max(1, recent, previous)));
  const volume = clamp01(items.length / Math.max(1, enabledSourceCount));
  const sourceCount = new Set(items.map((item) => item.source)).size;
  const diversity = clamp01(sourceCount / Math.max(1, enabledSourceCount));
  const heat = Math.round(100 * (0.5 * volume + 0.33 * acceleration + 0.17 * diversity));
  return { heat, mentions: items.length, sourceCount, volume, acceleration, diversity };
}

export function filterAndDedupe(items, query, range, now = Date.now()) {
  const cutoff = now - RANGE_MS[range];
  const selected = items
    .map((item) => {
      const publishedAt = normalizePublishedAt(item.publishedAt, now);
      return publishedAt ? { ...item, publishedAt } : null;
    })
    .filter(Boolean)
    .filter((item) => Date.parse(item.publishedAt) >= cutoff)
    .filter((item) => matchesQuery(`${item.title} ${item.excerpt || ''}`, query))
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const seen = new Set();
  return selected.filter((item) => {
    const key = canonicalUrl(item.url);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function timelineFor(items, range, now = Date.now()) {
  const bucketCount = range === '1h' ? 6 : range === '6h' ? 12 : range === '12h' ? 12 : range === '24h' ? 24 : range === '7d' ? 28 : 30;
  const bucketMs = RANGE_MS[range] / bucketCount;
  return Array.from({ length: bucketCount }, (_, index) => {
    const start = now - RANGE_MS[range] + index * bucketMs;
    const end = start + bucketMs;
    const mentions = items.filter((item) => {
      const timestamp = Date.parse(item.publishedAt);
      return timestamp >= start && timestamp < end;
    }).length;
    return { t: new Date(start).toISOString(), mentions, heat: Math.min(100, mentions * 20) };
  });
}
