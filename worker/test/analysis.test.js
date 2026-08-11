import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildEntities,
  buildKeywords,
  buildTopics,
  extractAutoTerms,
  HEAT_WEIGHTS,
  withSentiment,
} from '../src/analysis.js';

const NOW = Date.parse('2026-07-22T12:00:00Z');
const WATCH = [
  { id: 'tsmc', display: '台積電', anyOf: ['台積電', 'TSMC'], exclude: [] },
  { id: 'typhoon', display: '颱風', anyOf: ['颱風'], exclude: [] },
];

function item(source, title, ageHours, excerpt = '') {
  return {
    source,
    title,
    excerpt,
    url: `https://example.com/${source}/${encodeURIComponent(title)}/${ageHours}`,
    publishedAt: new Date(NOW - ageHours * 3600_000).toISOString(),
  };
}

test('buildKeywords computes bounded heat from real items', () => {
  const items = [
    item('tvbs', '台積電法說會登場', 1),
    item('cna', '台積電資本支出上修', 2),
    item('ltn', 'TSMC 擴廠進度', 3),
    item('udn', '天氣晴朗', 5),
  ];

  const keywords = buildKeywords(items, NOW, 24, WATCH);
  const tsmc = keywords.find((k) => k.term === '台積電');

  assert.equal(tsmc.kind, 'manual');
  assert.equal(tsmc.mentions24h, 3);
  assert.ok(tsmc.heat >= 0 && tsmc.heat <= 100);
  assert.equal(tsmc.trend.length, 24);
  assert.equal(tsmc.trend.reduce((a, p) => a + p.mentions, 0), 3);
  assert.deepEqual(tsmc.components.weights, HEAT_WEIGHTS);
});

test('watch terms stay visible at zero heat without matches', () => {
  const keywords = buildKeywords([item('tvbs', '無關新聞', 1)], NOW, 24, WATCH);
  const typhoon = keywords.find((k) => k.term === '颱風');

  assert.equal(typhoon.heat, 0);
  assert.equal(typhoon.mentions24h, 0);
  assert.deepEqual(typhoon.sourceShare, {});
});

test('keywords only count the last 24 hours', () => {
  const items = [item('tvbs', '台積電舊聞', 30), item('cna', '台積電新訊', 2)];
  const keywords = buildKeywords(items, NOW, 24, WATCH);
  assert.equal(keywords.find((k) => k.term === '台積電').mentions24h, 1);
});

test('keyword burst uses seven prior days at the same hour and exposes evidence', () => {
  const items = [
    ...['cna', 'ltn', 'udn', 'tvbs', 'pts'].map((source, index) => item(source, `台積電當期${index}`, 0.5)),
    ...Array.from({ length: 7 }, (_, index) => item('cna', `台積電基線${index + 1}`, (index + 1) * 24 + 0.5)),
    item('cna', '歷史涵蓋證據', 7 * 24 + 1.5),
  ];

  const tsmc = buildKeywords(items, NOW, 24, WATCH).find((keyword) => keyword.term === '台積電');

  assert.equal(tsmc.burstCurrent, 5);
  assert.equal(tsmc.burstSourceCount, 5);
  assert.deepEqual(tsmc.burstBaseline, [1, 1, 1, 1, 1, 1, 1]);
  assert.equal(tsmc.burstBaselineMedian, 1);
  assert.equal(tsmc.burstScore, 4);
});

test('auto terms skip stopwords, single-source fragments and watch terms', () => {
  const items = [
    item('tvbs', '快訊 電價調漲方案出爐', 1),
    item('cna', '電價調漲衝擊產業', 2),
    item('ltn', '電價調漲今拍板', 3),
    item('udn', '電價調漲影響民生', 4),
    item('ebc', '電價調漲估三讀', 5),
    item('setn', '台積電營收創高', 1),
  ];

  const terms = extractAutoTerms(items, { maxTerms: 5, minDocs: 5, minSources: 3, minLength: 2, stopwords: ['快訊'] }, WATCH);

  assert.ok(terms.includes('電價調漲'));
  assert.ok(terms.every((term) => !term.includes('快訊')));
  assert.ok(terms.every((term) => !term.includes('台積') && !'台積電'.includes(term)));
});

test('buildEntities counts co-occurring documents, no inference', () => {
  const lexicon = [
    { name: '台積電', aliases: ['TSMC'] },
    { name: '經濟部', aliases: [] },
    { name: '行政院', aliases: [] },
  ];
  const items = [
    item('cna', '經濟部與台積電討論電價', 1),
    item('ltn', '經濟部再會 TSMC', 2),
    item('udn', '行政院討論預算', 3),
    item('tvbs', '行政院回應立法院', 4),
  ];

  const graph = buildEntities(items, lexicon);
  const byName = Object.fromEntries(graph.nodes.map((n) => [n.name, n]));

  assert.equal(byName['台積電'].mentions, 2);
  assert.equal(byName['經濟部'].mentions, 2);
  const tsmc = byName['台積電'].id;
  const moea = byName['經濟部'].id;
  assert.ok(
    graph.edges.some((e) => new Set([e.source, e.target]).has(tsmc) && new Set([e.source, e.target]).has(moea) && e.weight === 2),
  );
  assert.ok(graph.nodes.every((n) => !n.name.includes('範例')));
});

test('pipeline sentiment is attached once with traceable matches', () => {
  const publicItem = withSentiment(item('cna', '台股創新高', 1));

  assert.equal(publicItem.sentiment.label, 'positive');
  assert.ok(publicItem.sentiment.score > 0);
  assert.ok(publicItem.sentiment.matched.length > 0);
});

test('topics expose daily timelines and time-window event subclusters', () => {
  const topics = buildTopics([
    item('cna', '台積電半導體投資創新高', 1),
    item('ltn', '台積電法說會看好半導體', 2),
    item('udn', '股市反映經濟成長', 26),
  ]);
  const finance = topics.find((topic) => topic.id === 'finance');

  assert.deepEqual(finance.timeline, [
    { date: '2026-07-21', mentions: 1 },
    { date: '2026-07-22', mentions: 2 },
  ]);
  assert.equal(finance.terms[0], '台積電');
  assert.equal(finance.events[0].date, '2026-07-22');
  assert.equal(finance.events[0].size, 2);
});
