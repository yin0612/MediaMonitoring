import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { AsyncState } from '../api/useData';
import { clearDataStates, setDataState } from '../test/data';
import { HomePage } from './HomePage';

vi.mock('../api/useData', async () => {
  const actual = await vi.importActual<typeof import('../api/useData')>('../api/useData');
  const data = await import('../test/data');
  return { ...actual, useData: data.useDataMock };
});

function state<T>(data: T | null, error: Error | null = null): AsyncState<T> {
  return { data, envelope: null, loading: false, error, reload: vi.fn() };
}

const fixtures = {
  meta: { status: 'ok' as const, lastFastAt: '2026-07-26T01:00:00Z', lastDeepAt: '2026-07-26T00:50:00Z', methodVersion: 'v2', scheduleDaysUntilPause: null, coverage: { keywordWindowHours: 24, trendBucketMinutes: 60, archiveDays: 7 }, stateRestoreFailed: false },
  keywords: { keywords: [] },
  topics: { stale: false, experimental: true, topics: [] },
  entities: { stale: false, experimental: true, nodes: [], edges: [] },
  recent: { items: [] },
  sources: { sources: [] },
};

function setFixtures(sourceError: Error | null = null) {
  setDataState('meta', state(fixtures.meta));
  setDataState('keywords', state(fixtures.keywords));
  setDataState('topics', state(fixtures.topics));
  setDataState('entities', state(fixtures.entities));
  setDataState('recent', state(fixtures.recent));
  setDataState('sources', state(fixtures.sources, sourceError));
}

describe('HomePage', () => {
  afterEach(() => {
    clearDataStates();
  });

  it('leads with the daily decision brief and links major analysis areas', () => {
    setFixtures();
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    expect(screen.getByRole('region', { name: '今日決策摘要' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: '等待下一批新聞訊號' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '主動搜尋新聞' })).toHaveAttribute('href', '/search');
    expect(screen.queryByRole('heading', { name: '看懂今日台灣新聞脈動' })).not.toBeInTheDocument();
    expect(screen.getByText('資料涵蓋與方法')).toBeInTheDocument();
  });

  it('keeps the homepage sections visible when one dataset fails', () => {
    setFixtures(new Error('來源失敗'));
    render(<MemoryRouter><HomePage /></MemoryRouter>);
    expect(screen.getByRole('region', { name: '熱門關鍵字' })).toBeInTheDocument();
    expect(screen.getByText('資料來源暫時無法載入：來源失敗')).toBeInTheDocument();
  });

  it('marks the decision brief limited when a required dataset fails', () => {
    setFixtures();
    setDataState('sources', state({ sources: [
      { id: 'cna', displayName: '中央社', status: 'ok', lastAttemptAt: null, lastSuccessAt: null, errorCode: null, stale: false, itemCount: 1 },
    ] }));
    setDataState('keywords', state(null, new Error('關鍵字失敗')));

    render(<MemoryRouter><HomePage /></MemoryRouter>);

    expect(screen.getByText('資料受限')).toBeInTheDocument();
    expect(screen.queryByText('資料完整')).not.toBeInTheDocument();
  });
});
