import { describe, expect, it } from 'vitest';
import { analysisExportCsv } from './exportAnalysis';

describe('analysis export', () => {
  it('includes provenance, actual window, filters and multi-topic tags in CSV', () => {
    const csv = analysisExportCsv({
      generatedAt: '2026-08-11T12:00:00Z',
      actualWindow: { from: '2026-08-01T00:00:00Z', to: '2026-08-11T12:00:00Z' },
      schemaVersion: '2.1.0',
      methodVersion: 'news-heat-v5',
      filters: { source: 'cna' },
      articles: [{
        id: '1', source: 'cna', title: '標題,含逗號', excerpt: '',
        publishedAt: '2026-08-11T10:00:00Z', url: 'https://example.com/1', sentiment: null,
        topicNames: ['台積電', '半導體'],
      }],
    });
    expect(csv).toContain('actualFrom');
    expect(csv).toContain('台積電|半導體');
    expect(csv).toContain('"標題,含逗號"');
  });
});
