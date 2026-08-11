import type { SearchArticle } from '../types/contracts';

export interface AnalysisExport {
  generatedAt: string;
  actualWindow: { from: string | null; to: string | null };
  schemaVersion: string;
  methodVersion: string;
  filters: Record<string, string>;
  articles: Array<SearchArticle & { topicNames: string[] }>;
}

const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

export function analysisExportCsv(value: AnalysisExport): string {
  const headers = [
    'generatedAt', 'actualFrom', 'actualTo', 'schemaVersion', 'methodVersion',
    'filters', 'topics', 'source', 'publishedAt', 'title', 'url',
  ];
  const rows = value.articles.map((article) => [
    value.generatedAt,
    value.actualWindow.from,
    value.actualWindow.to,
    value.schemaVersion,
    value.methodVersion,
    JSON.stringify(value.filters),
    article.topicNames.join('|'),
    article.source,
    article.publishedAt,
    article.title,
    article.url,
  ]);
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export function downloadText(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
