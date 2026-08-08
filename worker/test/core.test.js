import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateMetrics,
  filterAndDedupe,
  normalizePublishedAt,
  matchesQuery,
  parseGoogleNewsRss,
  parseRss,
  parseTrendsRss,
  validateQuery,
} from '../src/core.js';
import { NEWS_SOURCES } from '../src/sources.js';

const EXPECTED_SOURCE_IDS = [
  'tvbs', 'ebc', 'setn', 'ftv', 'cti', 'era', 'nexttv', 'pts', 'ttv', 'cts', 'udn', 'ltn', 'cna',
  'moneyudn', 'ctee', 'anue', 'wealth', 'businessweekly', 'thenewslens', 'reporter',
  'newtalk', 'nownews', 'nextapple', 'ettoday',
  'rti', 'technews', 'taipeitimes', 'coolloud', 'tfc',
  'moneydj', 'businesstoday', 'bnext', 'managertoday', 'chinatimes', 'ctwant',
];

test('news source registry contains exactly the requested 35 publishers', () => {
  assert.deepEqual(NEWS_SOURCES.map((source) => source.id), EXPECTED_SOURCE_IDS);
  assert.equal(new Set(NEWS_SOURCES.flatMap((source) => source.domains)).size >= 35, true);
});

test('new official RSS sources retain their required domains and feed URLs', () => {
  const byId = Object.fromEntries(NEWS_SOURCES.map((source) => [source.id, source]));
  assert.deepEqual(byId.rti.domains, ['rti.org.tw', 'www.rti.org.tw']);
  assert.equal(byId.rti.rssUrl, 'https://www.rti.org.tw/rss');
  assert.deepEqual(byId.technews.domains, ['technews.tw', 'finance.technews.tw']);
  assert.equal(byId.technews.rssUrl, 'https://technews.tw/feed/');
  assert.deepEqual(byId.taipeitimes.domains, ['taipeitimes.com', 'www.taipeitimes.com']);
  assert.equal(byId.taipeitimes.rssUrl, 'https://www.taipeitimes.com/xml/index.rss');
  assert.deepEqual(byId.coolloud.domains, ['coolloud.org.tw', 'www.coolloud.org.tw']);
  assert.equal(byId.coolloud.rssUrl, 'https://www.coolloud.org.tw/rss.xml');
  assert.deepEqual(byId.tfc.domains, ['tfc-taiwan.org.tw', 'www.tfc-taiwan.org.tw']);
  assert.equal(byId.tfc.rssUrl, 'https://tfc-taiwan.org.tw/feed/');
});

test('parseGoogleNewsRss keeps only allowlisted publishers and normalizes source ids', () => {
  const xml = `<rss><channel>
    <item><guid>a</guid><title>台積電三立新聞</title>
      <link>https://news.google.com/rss/articles/a</link>
      <pubDate>Wed, 22 Jul 2026 08:00:00 GMT</pubDate>
      <description>三立短摘要</description><source url="https://www.setn.com">三立新聞網</source>
    </item>
    <item><guid>b</guid><title>不在白名單</title>
      <link>https://news.google.com/rss/articles/b</link>
      <pubDate>Wed, 22 Jul 2026 08:00:00 GMT</pubDate>
      <source url="https://example.com">未知媒體</source>
    </item>
  </channel></rss>`;

  const items = parseGoogleNewsRss(xml, NEWS_SOURCES);

  assert.equal(items.length, 1);
  assert.equal(items[0].source, 'setn');
  assert.equal(items[0].title, '台積電三立新聞');
  assert.equal('content' in items[0], false);
});

test('validateQuery accepts 2 to 50 characters and known ranges', () => {
  assert.deepEqual(validateQuery(' 台積電 ', '24h'), { query: '台積電', range: '24h' });
  assert.deepEqual(validateQuery('台積電', '12h'), { query: '台積電', range: '12h' });
  assert.deepEqual(validateQuery('台積電', '30d'), { query: '台積電', range: '30d' });
  assert.throws(() => validateQuery('台', '24h'), /INVALID_QUERY/);
  assert.throws(() => validateQuery('台積電', '90d'), /INVALID_RANGE/);
});

test('matchesQuery supports AND, OR, NOT, minus exclusions, and quoted phrases', () => {
  assert.equal(matchesQuery('台積電法說會展望成長', '台積電 AND "法說會"'), true);
  assert.equal(matchesQuery('聯發科新品發表', '台積電 OR 聯發科'), true);
  assert.equal(matchesQuery('台積電股價下跌', '台積電 NOT 股價'), false);
  assert.equal(matchesQuery('台積電徵才消息', '台積電 -徵才'), false);
});

test('parseRss keeps only public metadata and canonicalizes URLs', () => {
  const xml = `<?xml version="1.0"?><rss><channel><item>
    <guid>story-1</guid><title><![CDATA[台積電法說會]]></title>
    <description><![CDATA[<p>營運展望摘要</p>]]></description>
    <link>https://example.com/story?utm_source=rss</link>
    <pubDate>Wed, 22 Jul 2026 08:00:00 GMT</pubDate>
  </item></channel></rss>`;

  const { items } = parseRss(xml, 'cna');

  assert.equal(items[0].url, 'https://example.com/story');
  assert.equal(items[0].excerpt, '營運展望摘要');
  assert.equal('content' in items[0], false);
});

test('normalizes Taiwan local time mislabeled as GMT when it lands in the future', () => {
  const now = Date.parse('2026-07-22T15:00:00Z');
  assert.equal(normalizePublishedAt('Wed, 22 Jul 2026 21:43:00 GMT', now), '2026-07-22T13:43:00.000Z');
});

test('parseRss discards items without a valid publication time', () => {
  const xml = '<rss><channel><item><guid>x</guid><title>無時間新聞</title><link>https://example.com/x</link></item></channel></rss>';
  const result = parseRss(xml, 'cna');
  assert.deepEqual(result.items, []);
  assert.equal(result.isFeedDocument, true);
  assert.equal(result.entryCount, 1);
});

test('parseRss exposes valid empty RSS and Atom structure', () => {
  for (const xml of [
    '<?xml version="1.0"?><rss version="2.0"><channel><title>Empty RSS</title></channel></rss>',
    '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Empty Atom</title></feed>',
    `<?xml version="1.0"?>
      <!DOCTYPE atom:feed>
      <!-- namespace, CDATA, processing instruction, and self-closing tag -->
      <atom:feed xmlns:atom="http://www.w3.org/2005/Atom">
        <atom:title><![CDATA[Empty <feed>]]></atom:title>
        <?feed-check complete?>
        <atom:link href="https://example.com/feed" />
      </atom:feed>`,
  ]) {
    const result = parseRss(xml, 'cna');
    assert.deepEqual(result.items, []);
    assert.equal(result.isFeedDocument, true);
    assert.equal(result.entryCount, 0);
  }
});

test('parseRss recognizes RSS 1.0 RDF and uses dc:date publication timestamps', () => {
  const xml = `<?xml version="1.0"?>
    <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <channel rdf:about="https://www.taipeitimes.com/"><title>Taipei Times</title></channel>
      <item rdf:about="https://www.taipeitimes.com/News/front/archives/2026/08/06/1">
        <title>RDF headline</title>
        <link>https://www.taipeitimes.com/News/front/archives/2026/08/06/1</link>
        <description>RDF summary</description>
        <dc:date>2026-08-06T08:00:00+08:00</dc:date>
      </item>
    </rdf:RDF>`;

  const result = parseRss(xml, 'taipeitimes');

  assert.equal(result.isFeedDocument, true);
  assert.equal(result.entryCount, 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].publishedAt, '2026-08-06T00:00:00.000Z');
});

test('parseRss rejects structural probes even when valid items are present', () => {
  const item = `<item><title>Valid item</title><link>https://example.com/valid</link>
    <pubDate>Thu, 06 Aug 2026 00:00:00 GMT</pubDate></item>`;
  for (const xml of [
    `<rss><channel>${item}<meta><nested></meta></nested></channel></rss>`,
    `<rss><channel>${item}</channel></rss><feed><title>Second root</title></feed>`,
    `<rss><channel><title>Channel</title></channel>${item}</rss>`,
    `<rss><!-- <channel>fake</channel> --><wrapper>${item}</wrapper></rss>`,
    `<html>${item}</html>`,
    `<rss><channel>${item}</channel>`,
    `text before root<rss><channel>${item}</channel></rss>`,
    `<rss><channel>${item}</channel></rss>text after root`,
  ]) {
    const result = parseRss(xml, 'cna');
    assert.equal(result.isFeedDocument, false);
  }
});

test('parseRss counts self-closing item and entry tags without counting self-closing links', () => {
  const rss = parseRss('<rss><channel><title>RSS</title><link /><item /></channel></rss>', 'cna');
  assert.equal(rss.isFeedDocument, true);
  assert.equal(rss.entryCount, 1);
  assert.deepEqual(rss.items, []);

  const atom = parseRss('<feed><title>Atom</title><link href="https://example.com" /><entry /></feed>', 'cna');
  assert.equal(atom.isFeedDocument, true);
  assert.equal(atom.entryCount, 1);
  assert.deepEqual(atom.items, []);

  const emptyAtom = parseRss('<feed><title>Atom</title><link href="https://example.com" /></feed>', 'cna');
  assert.equal(emptyAtom.isFeedDocument, true);
  assert.equal(emptyAtom.entryCount, 0);
});

test('parseRss rejects crossed or misnested closed-root RSS and Atom documents', () => {
  for (const xml of [
    '<rss><channel><title>Broken</channel></title></rss>',
    '<feed><title><subtitle>Broken</title></subtitle></feed>',
  ]) {
    const result = parseRss(xml, 'cna');
    assert.deepEqual(result.items, []);
    assert.equal(result.isFeedDocument, false);
    assert.equal(result.entryCount, 0);
  }
});

test('parseRss keeps malformed documents distinguishable from feeds with unusable entries', () => {
  const malformed = parseRss('<rss><channel><title>truncated', 'cna');
  assert.equal(malformed.isFeedDocument, false);
  assert.equal(malformed.entryCount, 0);

  const nonFeed = parseRss('<html><body>blocked</body></html>', 'cna');
  assert.equal(nonFeed.isFeedDocument, false);
  assert.equal(nonFeed.entryCount, 0);

  const unusable = parseRss(
    '<rss><channel><item><title>Missing URL and time</title></item></channel></rss>',
    'cna',
  );
  assert.equal(unusable.isFeedDocument, true);
  assert.equal(unusable.entryCount, 1);
  assert.deepEqual(unusable.items, []);
});

test('filterAndDedupe corrects a future timestamp restored from an old snapshot', () => {
  const now = Date.parse('2026-07-22T15:00:00Z');
  const items = [{ id: 'old', source: 'setn', title: '委內瑞拉雙震', excerpt: '', publishedAt: '2026-07-22T21:43:00Z', url: 'https://example.com/story' }];
  const result = filterAndDedupe(items, '委內瑞拉', '24h', now);
  assert.equal(result[0].publishedAt, '2026-07-22T13:43:00.000Z');
});

test('calculateMetrics uses 50/33/17 news-only heat weights', () => {
  const now = Date.parse('2026-07-22T12:00:00Z');
  const items = [
    { source: 'cna', publishedAt: '2026-07-22T11:50:00Z' },
    { source: 'ltn', publishedAt: '2026-07-22T11:40:00Z' },
  ];

  const metrics = calculateMetrics(items, '1h', now, 4);

  assert.equal(metrics.mentions, 2);
  assert.equal(metrics.sourceCount, 2);
  assert.equal(metrics.heat, 67);
});

test('calculateMetrics returns zero heat for zero news volume', () => {
  assert.equal(calculateMetrics([], '24h', Date.now(), 5).heat, 0);
});

test('parseTrendsRss reads Taiwan Trending Now RSS and preserves all related news', () => {
  const xml = `<rss xmlns:ht="https://trends.google.com/trending/rss"><channel><item>
    <title>台灣 颱風</title><ht:approx_traffic>20,000+</ht:approx_traffic>
    <pubDate>Wed, 22 Jul 2026 08:00:00 GMT</pubDate>
    <ht:news_item><ht:news_item_title>颱風最新動態</ht:news_item_title>
    <ht:news_item_url>https://example.com/1</ht:news_item_url>
    <ht:news_item_source>中央社</ht:news_item_source></ht:news_item>
    <ht:news_item><ht:news_item_title>不在白名單</ht:news_item_title>
    <ht:news_item_url>https://unknown.example/2</ht:news_item_url>
    <ht:news_item_source>未知</ht:news_item_source></ht:news_item>
  </item></channel></rss>`;

  const result = parseTrendsRss(xml);

  assert.equal(result[0].title, '台灣颱風');
  assert.equal(result[0].approximateTraffic, '20,000+');
  assert.equal(result[0].news[0].source, '中央社');
  assert.equal(result[0].news.length, 2);
});
