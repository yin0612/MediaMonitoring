const RANGE_MS = {
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = 90 * DAY_MS;
const WRITE_BATCH_SIZE = 100;

const parseSentiment = (value) => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const queryGroups = (rawQuery) => String(rawQuery || '').split(/\s+OR\s+/i).map((group) => {
  const positives = [];
  const negatives = [];
  let negateNext = false;
  for (const match of group.matchAll(/"([^"]+)"|(\S+)/g)) {
    let token = (match[1] || match[2] || '').trim();
    if (!token || /^AND$/i.test(token)) continue;
    if (/^NOT$/i.test(token)) { negateNext = true; continue; }
    let negative = negateNext;
    negateNext = false;
    if (token.startsWith('-')) { negative = true; token = token.slice(1); }
    if (token) (negative ? negatives : positives).push(token);
  }
  return { positives, negatives };
});

const likeValue = (term) => `%${term.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;

export async function queryHistoricalArticles(db, range, now = Date.now(), rawQuery = '') {
  if (!db || !(range in RANGE_MS)) return [];
  const cutoff = now - RANGE_MS[range];
  const bindings = [cutoff, now + 5 * 60 * 1000];
  const groups = queryGroups(rawQuery);
  const queryPredicate = rawQuery ? groups.map(({ positives, negatives }) => {
    const clauses = [];
    for (const term of positives) {
      bindings.push(likeValue(term));
      clauses.push(`(title || ' ' || excerpt) LIKE ?${bindings.length} ESCAPE '\\' COLLATE NOCASE`);
    }
    for (const term of negatives) {
      bindings.push(likeValue(term));
      clauses.push(`(title || ' ' || excerpt) NOT LIKE ?${bindings.length} ESCAPE '\\' COLLATE NOCASE`);
    }
    return `(${clauses.join(' AND ') || '1=1'})`;
  }).join(' OR ') : '1=1';
  const result = await db.prepare(`
    SELECT id, source_id, title, excerpt, published_at, canonical_url, sentiment_json
    FROM articles
    WHERE published_at >= ?1 AND published_at <= ?2 AND (${queryPredicate})
    ORDER BY published_at DESC
  `).bind(...bindings).all();
  const rows = Array.isArray(result?.results) ? result.results : [];
  return rows.map((row) => ({
    id: String(row.id),
    source: String(row.source_id),
    title: String(row.title),
    excerpt: String(row.excerpt || ''),
    publishedAt: new Date(Number(row.published_at)).toISOString(),
    url: String(row.canonical_url),
    sentiment: parseSentiment(row.sentiment_json),
  }));
}

export async function queryHistoricalCoverage(db, range, now = Date.now()) {
  if (!db || !(range in RANGE_MS)) return { actualFrom: null, actualTo: null, articleCount: 0 };
  const cutoff = now - RANGE_MS[range];
  const row = await db.prepare(`
    SELECT MIN(published_at) AS actual_from, MAX(published_at) AS actual_to, COUNT(*) AS article_count
    FROM articles
    WHERE published_at >= ?1 AND published_at <= ?2
  `).bind(cutoff, now + 5 * 60 * 1000).first();
  return {
    actualFrom: row?.actual_from != null && Number.isFinite(Number(row.actual_from))
      ? new Date(Number(row.actual_from)).toISOString() : null,
    actualTo: row?.actual_to != null && Number.isFinite(Number(row.actual_to))
      ? new Date(Number(row.actual_to)).toISOString() : null,
    articleCount: Number(row?.article_count || 0),
  };
}

const asJson = (value) => (value == null ? null : JSON.stringify(value));

export async function upsertArticles(db, articles, ingestedAt = Date.now()) {
  if (!db || !Array.isArray(articles) || articles.length === 0) return 0;
  const sql = `
    INSERT INTO articles (
      id, source_id, title, excerpt, published_at, canonical_url,
      sentiment_json, provenance_json, ingested_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
    ON CONFLICT DO UPDATE SET
      source_id = excluded.source_id,
      title = excluded.title,
      excerpt = excluded.excerpt,
      published_at = excluded.published_at,
      canonical_url = excluded.canonical_url,
      sentiment_json = excluded.sentiment_json,
      provenance_json = excluded.provenance_json,
      ingested_at = excluded.ingested_at
  `;
  let written = 0;
  for (let offset = 0; offset < articles.length; offset += WRITE_BATCH_SIZE) {
    const statements = articles.slice(offset, offset + WRITE_BATCH_SIZE).map((item) => db.prepare(sql).bind(
      String(item.id),
      String(item.source),
      String(item.title),
      String(item.excerpt || ''),
      Date.parse(item.publishedAt),
      String(item.url),
      asJson(item.sentiment),
      asJson(item.provenance || null),
      ingestedAt,
    ));
    await db.batch(statements);
    written += statements.length;
  }
  return written;
}

export async function pruneHistoricalArticles(db, now = Date.now()) {
  if (!db) return 0;
  const result = await db.prepare('DELETE FROM articles WHERE published_at < ?1')
    .bind(now - RETENTION_MS)
    .run();
  return Number(result?.meta?.changes || 0);
}

const parseJson = (value) => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const rowToArticle = (row) => ({
  id: String(row.id),
  source: String(row.source_id),
  title: String(row.title),
  excerpt: String(row.excerpt || ''),
  publishedAt: new Date(Number(row.published_at)).toISOString(),
  url: String(row.canonical_url),
  sentiment: parseJson(row.sentiment_json),
  provenance: parseJson(row.provenance_json),
});

export async function archivePreviousUtcDay(db, bucket, now = Date.now()) {
  if (!db || !bucket) return { written: false, reason: 'NOT_CONFIGURED' };
  const todayStart = Math.floor(now / DAY_MS) * DAY_MS;
  const dayStart = todayStart - DAY_MS;
  const date = new Date(dayStart).toISOString().slice(0, 10);
  const [year, month, day] = date.split('-');
  const prefix = `archive/v2/${year}/${month}/${day}`;
  const articlesKey = `${prefix}/articles.json.gz`;
  const manifestKey = `${prefix}/manifest.json`;
  if (await bucket.head(manifestKey)) return { written: false, reason: 'EXISTS', key: manifestKey };
  const result = await db.prepare(`
    SELECT id, source_id, title, excerpt, published_at, canonical_url, sentiment_json, provenance_json
    FROM articles
    WHERE published_at >= ?1 AND published_at < ?2
    ORDER BY published_at DESC
  `).bind(dayStart, todayStart).all();
  const items = (Array.isArray(result?.results) ? result.results : []).map(rowToArticle);
  const raw = new TextEncoder().encode(JSON.stringify({ schemaVersion: '2.0.0', date, items }));
  const compressed = await new Response(
    new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip')),
  ).arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', compressed);
  const sha256 = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  await bucket.put(articlesKey, compressed, {
    httpMetadata: { contentType: 'application/json; charset=utf-8', contentEncoding: 'gzip' },
    customMetadata: { date, itemCount: String(items.length) },
  });
  const sources = new Set(items.map((item) => item.source));
  const manifest = {
    schemaVersion: '2.0.0',
    methodVersion: 'public-metadata-archive-v2',
    date,
    object: articlesKey,
    sha256,
    byteLength: compressed.byteLength,
    itemCount: items.length,
    sourceCount: sources.size,
    actualFrom: items.length ? items[items.length - 1].publishedAt : null,
    actualTo: items.length ? items[0].publishedAt : null,
  };
  await bucket.put(manifestKey, JSON.stringify(manifest), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: { date, itemCount: String(items.length), sha256 },
  });
  return { written: true, key: manifestKey, itemCount: items.length };
}

export async function persistSnapshotArticles(env, articles, now = Date.now()) {
  if (!env?.DB) return { written: 0, pruned: 0, archived: false };
  const written = await upsertArticles(env.DB, articles, now);
  const pruned = await pruneHistoricalArticles(env.DB, now);
  const archive = await archivePreviousUtcDay(env.DB, env.ARCHIVE_BUCKET, now);
  return { written, pruned, archived: archive.written };
}
