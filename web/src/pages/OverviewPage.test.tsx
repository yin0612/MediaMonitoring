import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { AsyncState } from '../api/useData';
import { clearDataStates, setDataState } from '../test/data';
import { OverviewPage } from './OverviewPage';
import { ThemeProvider } from '../lib/theme';

vi.mock('../api/useData', async () => {
  const actual = await vi.importActual<typeof import('../api/useData')>('../api/useData');
  const data = await import('../test/data');
  return { ...actual, useData: data.useDataMock };
});

vi.mock('../components/Chart', () => ({ Chart: () => <div data-testid="chart" /> }));

function state<T>(data: T, error: Error | null = null): AsyncState<T> {
  return { data, envelope: { schemaVersion: '2.1.0', generatedAt: '2026-07-26T12:00:00Z', data }, loading: false, error, reload: vi.fn() };
}

const keyword = (term: string) => ({
  id: term,
  term,
  kind: 'auto' as const,
  heat: 80,
  mentions24h: 2,
  components: { volume: 0, acceleration: 0, diversity: 0, weights: { volume: 0.5, acceleration: 0.33, diversity: 0.17 } },
  sourceShare: {},
  trend: Array.from({ length: 24 }, (_, i) => ({ t: `2026-07-26T${String(i).padStart(2, '0')}:00:00Z`, heat: 1, mentions: 1 })),
});

describe('OverviewPage', () => {
  afterEach(() => clearDataStates());

  it('shows rising keywords and keeps the heatbar visual-only', () => {
    setDataState('meta', state({ status: 'ok', lastFastAt: '2026-07-26T12:00:00Z', lastDeepAt: null, methodVersion: 'v2', scheduleDaysUntilPause: null, coverage: { keywordWindowHours: 24, trendBucketMinutes: 60, archiveDays: 7 }, stateRestoreFailed: false }));
    setDataState('keywords', state({ keywords: [keyword('地震')] }));
    setDataState('sources', state({ sources: [] }));
    setDataState('recent', state({ items: [
      { id: 'a', source: 'cna', title: '地震', excerpt: '', publishedAt: '2026-07-26T11:30:00Z', url: '#' },
      { id: 'b', source: 'cna', title: '地震', excerpt: '', publishedAt: '2026-07-26T11:00:00Z', url: '#' },
    ] }));

    render(<ThemeProvider><MemoryRouter><OverviewPage /></MemoryRouter></ThemeProvider>);
    expect(screen.getByRole('heading', { name: '近期升溫關鍵字' })).toBeInTheDocument();
    expect(screen.getAllByText('地震').length).toBeGreaterThan(0);
    expect(screen.getByText('+2 篇')).toBeInTheDocument();
    expect(screen.getByText('新出現')).toBeInTheDocument();
    expect(screen.queryByText('80', { selector: '.heatbar__value' })).not.toBeInTheDocument();
  });
});
