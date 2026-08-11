import assert from 'node:assert/strict';
import test from 'node:test';

import {
  machineSuggestionFor,
  parseJsonl,
  safeArticleUrl,
  serializeJsonl,
  updateAnnotation,
  validateRows,
} from './annotation-core.mjs';

const sampleRow = {
  sampleId: 'row-001',
  split: 'train',
  doubleAnnotation: true,
  source: 'example-news',
  publishedAt: '2026-08-11T00:00:00Z',
  title: '新聞標題',
  excerpt: '新聞摘要',
  url: 'https://example.com/article',
  annotations: {
    eventCluster: null,
    topics: [],
    entities: [],
    textTone: null,
    target: null,
    targetStance: null,
    annotator1: null,
    annotator2: null,
  },
};

const completedLabels = {
  eventCluster: 'event-fed-cook',
  topics: ['politics', 'finance'],
  entities: ['川普', '聯準會'],
  textTone: 'negative',
  target: '川普',
  targetStance: 'negative',
};

test('parses and serializes JSONL without changing article metadata', () => {
  const rows = parseJsonl(`${JSON.stringify(sampleRow)}\n`);
  const reparsed = parseJsonl(serializeJsonl(rows));

  assert.deepEqual(reparsed, [sampleRow]);
});

test('accepts only HTTP(S) article links from imported files', () => {
  assert.equal(safeArticleUrl('https://example.com/article'), 'https://example.com/article');
  assert.equal(safeArticleUrl('http://example.com/article'), 'http://example.com/article');
  assert.equal(safeArticleUrl('javascript:alert(1)'), null);
  assert.equal(safeArticleUrl('data:text/html,unsafe'), null);
  assert.equal(safeArticleUrl('not a URL'), null);
});

test('writes consensus labels immutably and preserves source metadata', () => {
  const rows = [sampleRow];
  const updated = updateAnnotation(rows, 0, completedLabels, 'consensus');

  assert.deepEqual(rows, [sampleRow]);
  assert.deepEqual(updated[0].annotations.eventCluster, 'event-fed-cook');
  assert.equal(updated[0].source, 'example-news');
  assert.equal(updated[0].url, 'https://example.com/article');
  assert.equal(updated[0].annotations.annotator1, null);
});

test('keeps independent reviewer labels separate on double-annotation rows', () => {
  const reviewerOne = updateAnnotation([sampleRow], 0, completedLabels, 'annotator1');
  const reviewerTwoLabels = { ...completedLabels, textTone: 'neutral' };
  const updated = updateAnnotation(reviewerOne, 0, reviewerTwoLabels, 'annotator2');

  assert.equal(updated[0].annotations.eventCluster, null);
  assert.equal(updated[0].annotations.annotator1.textTone, 'negative');
  assert.equal(updated[0].annotations.annotator2.textTone, 'neutral');
});

test('rejects reviewer labels on rows that do not require double annotation', () => {
  const singleReviewerRow = { ...sampleRow, doubleAnnotation: false };

  assert.throws(
    () => updateAnnotation([singleReviewerRow], 0, completedLabels, 'annotator1'),
    /doubleAnnotation=true/,
  );
});

test('shows a machine suggestion without writing it to official annotations', () => {
  const draft = {
    ...sampleRow,
    machineSuggested: completedLabels,
    provenance: { kind: 'machine-draft', humanVerified: false },
  };
  const rows = [sampleRow];

  assert.deepEqual(machineSuggestionFor(rows[0], [draft]), completedLabels);
  assert.equal(rows[0].annotations.eventCluster, null);
  assert.equal(rows[0].annotations.textTone, null);
});

test('reports the fields still missing from completed annotations', () => {
  const incomplete = validateRows([sampleRow]);
  const complete = validateRows([updateAnnotation([sampleRow], 0, completedLabels, 'consensus')[0]]);

  assert.equal(incomplete.completeRows, 0);
  assert.deepEqual(incomplete.missingByField, {
    eventCluster: 1,
    topics: 1,
    textTone: 1,
    target: 1,
    targetStance: 1,
  });
  assert.equal(complete.completeRows, 1);
  assert.equal(complete.missingRows, 0);
});
