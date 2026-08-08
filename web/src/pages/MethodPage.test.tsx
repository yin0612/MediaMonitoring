import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MethodPage } from './MethodPage';
import { clearDataStates, setDataState } from '../test/data';
import type { AsyncState } from '../api/useData';

vi.mock('../api/useData', async () => {
  const actual = await vi.importActual<typeof import('../api/useData')>('../api/useData');
  const data = await import('../test/data');
  return { ...actual, useData: data.useDataMock };
});

function state<T>(data: T | null, error: Error | null = null): AsyncState<T> {
  return { data, envelope: null, loading: false, error, reload: vi.fn() };
}

describe('MethodPage', () => {
  afterEach(() => clearDataStates());

  it('exposes the documentation sections and limitations', () => {
    setDataState('meta', state({
      status: 'ok' as const,
      lastFastAt: '2026-07-26T01:00:00Z',
      lastDeepAt: '2026-07-26T00:50:00Z',
      methodVersion: 'v2',
      scheduleDaysUntilPause: null,
      coverage: { keywordWindowHours: 24, trendBucketMinutes: 60, archiveDays: 7 },
      stateRestoreFailed: false,
    }));
    setDataState('sources', state({ sources: [] }));
    render(<MethodPage />);
    expect(screen.getByRole('heading', { level: 1, name: '數據來源' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '詞彙與 FAQ' })).toHaveAttribute('href', '#glossary');
    expect(screen.getByRole('heading', { name: '詞彙與常見問題' })).toBeInTheDocument();
    expect(screen.getByText('共現不代表關係')).toBeInTheDocument();
  });
});
