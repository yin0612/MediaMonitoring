import fs from 'node:fs';
import path from 'node:path';

const [inputArg, outputArg] = process.argv.slice(2);
if (!inputArg || !outputArg) throw new Error('usage: node build-seed-sql.mjs <archive.json|archive-directory> <output.sql>');

const inputPath = path.resolve(inputArg);
const inputStat = fs.statSync(inputPath);
const inputFiles = inputStat.isDirectory()
  ? fs.readdirSync(inputPath)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => path.join(inputPath, name))
  : [inputPath];
const items = inputFiles
  .flatMap((file) => {
    const input = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(input?.data?.items) ? input.data.items : [];
  })
  .filter((item) => item && item.url && Number.isFinite(Date.parse(item.publishedAt)))
  .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));

const canonical = (url) => {
  try {
    const parsed = new URL(String(url));
    parsed.hash = '';
    for (const key of [...parsed.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('utm_') || ['fbclid', 'gclid', 'ref', 'source'].includes(key.toLowerCase())) {
        parsed.searchParams.delete(key);
      }
    }
    parsed.pathname = parsed.pathname.replace(/\/$/, '') || '/';
    return parsed.toString();
  } catch {
    return String(url);
  }
};
const uniqueItems = [...new Map(items.map((item) => [canonical(item.url), item])).values()];
const quote = (value) => value == null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
const ingestedAt = Date.now();
const statements = uniqueItems
  .filter((item) => item.id && item.source && item.title && item.url && Number.isFinite(Date.parse(item.publishedAt)))
  .map((item) => `INSERT INTO articles (
    id, source_id, title, excerpt, published_at, canonical_url,
    sentiment_json, provenance_json, ingested_at
  ) VALUES (
    ${quote(item.id)}, ${quote(item.source)}, ${quote(item.title)}, ${quote(item.excerpt || '')},
    ${Date.parse(item.publishedAt)}, ${quote(item.url)}, ${quote(item.sentiment ? JSON.stringify(item.sentiment) : null)},
    ${quote(JSON.stringify({ pipeline: 'pages-backfill', source: item.source }))}, ${ingestedAt}
  ) ON CONFLICT DO UPDATE SET
    source_id=excluded.source_id, title=excluded.title, excerpt=excluded.excerpt,
    published_at=excluded.published_at, canonical_url=excluded.canonical_url,
    sentiment_json=excluded.sentiment_json, provenance_json=excluded.provenance_json,
    ingested_at=excluded.ingested_at;`);

fs.writeFileSync(path.resolve(outputArg), `PRAGMA foreign_keys=ON;\n${statements.join('\n')}\n`, 'utf8');
console.log(`generated ${statements.length} D1 upserts`);
