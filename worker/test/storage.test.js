import test from 'node:test';
import assert from 'node:assert/strict';

import { archivePreviousUtcDay, pruneHistoricalArticles, queryHistoricalArticles, upsertArticles } from '../src/storage.js';

const article = (id, publishedAt) => ({
  id,
  source: 'cna',
  title: `headline ${id}`,
  excerpt: 'summary',
  publishedAt,
  url: `https://example.com/${id}`,
  sentiment: { label: 'neutral', score: 0, matched: [] },
});

test('upsertArticles writes canonical article rows through D1 batch', async () => {
  const calls = [];
  const db = {
    prepare(sql) {
      return { bind: (...args) => ({ sql, args }) };
    },
    async batch(statements) {
      calls.push(...statements);
      return statements.map(() => ({ success: true }));
    },
  };
  await upsertArticles(db, [article('a1', '2026-08-10T12:00:00Z')], 1786363200000);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /ON CONFLICT\(id\) DO UPDATE/);
  assert.deepEqual(calls[0].args.slice(0, 7), [
    'a1', 'cna', 'headline a1', 'summary', 1786363200000, 'https://example.com/a1',
    JSON.stringify({ label: 'neutral', score: 0, matched: [] }),
  ]);
});

test('queryHistoricalArticles applies the boolean query in D1 without a silent row cap', async () => {
  let statement;
  let bindings;
  const db = {
    prepare(sql) {
      statement = sql;
      return { bind: (...args) => ({ all: async () => { bindings = args; return { results: [] }; } }) };
    },
  };
  await queryHistoricalArticles(db, '30d', Date.parse('2026-08-11T00:00:00Z'), '台積電 NOT 股價');
  assert.match(statement, /LIKE \?3/);
  assert.match(statement, /NOT LIKE \?4/);
  assert.doesNotMatch(statement, /LIMIT\s+10000/i);
  assert.deepEqual(bindings.slice(2), ['%台積電%', '%股價%']);
});

test('pruneHistoricalArticles removes only records older than 90 days', async () => {
  let bound = null;
  const db = {
    prepare(sql) {
      assert.match(sql, /DELETE FROM articles WHERE published_at < \?1/);
      return { bind: (value) => ({ run: async () => { bound = value; } }) };
    },
  };
  const now = Date.parse('2026-08-11T00:00:00Z');
  await pruneHistoricalArticles(db, now);
  assert.equal(bound, now - 90 * 24 * 60 * 60 * 1000);
});

test('archivePreviousUtcDay writes one immutable R2 object and skips an existing day', async () => {
  const rows = [{
    id: 'a1', source_id: 'cna', title: 'headline', excerpt: '',
    published_at: Date.parse('2026-08-10T12:00:00Z'), canonical_url: 'https://example.com/a1',
    sentiment_json: null, provenance_json: '{"accessMode":"official-rss"}',
  }];
  const binds = [];
  const db = {
    prepare(sql) {
      assert.match(sql, /published_at >= \?1 AND published_at < \?2/);
      return { bind: (...args) => ({ all: async () => { binds.push(args); return { results: rows }; } }) };
    },
  };
  const puts = [];
  let exists = false;
  const bucket = {
    head: async () => (exists ? { key: 'archive/2026-08-10.json' } : null),
    put: async (key, body, options) => { puts.push({ key, body, options }); exists = true; },
  };
  const now = Date.parse('2026-08-11T08:00:00Z');
  const first = await archivePreviousUtcDay(db, bucket, now);
  const second = await archivePreviousUtcDay(db, bucket, now);
  assert.equal(first.written, true);
  assert.equal(second.written, false);
  assert.deepEqual(binds[0], [Date.parse('2026-08-10T00:00:00Z'), Date.parse('2026-08-11T00:00:00Z')]);
  assert.equal(puts[0].key, 'archive/v2/2026/08/10/articles.json.gz');
  assert.equal(puts[0].options.httpMetadata.contentEncoding, 'gzip');
  assert.equal(puts[1].key, 'archive/v2/2026/08/10/manifest.json');
  const manifest = JSON.parse(puts[1].body);
  assert.equal(manifest.date, '2026-08-10');
  assert.equal(manifest.itemCount, 1);
  assert.equal(manifest.sourceCount, 1);
  assert.match(manifest.sha256, /^[a-f0-9]{64}$/);
});
