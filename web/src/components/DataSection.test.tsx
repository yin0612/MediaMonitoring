import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DataSection } from './DataSection';

describe('DataSection', () => {
  it('renders a retryable error without rendering children', () => {
    render(
      <DataSection title="測試資料" loading={false} error={new Error('載入失敗')} onRetry={vi.fn()} isEmpty={false}>
        <div>不應出現</div>
      </DataSection>,
    );
    expect(screen.getByRole('button', { name: '重新載入' })).toBeInTheDocument();
    expect(screen.queryByText('不應出現')).not.toBeInTheDocument();
  });

  it('renders an empty state after loading and before children', () => {
    render(
      <DataSection title="測試資料" loading={false} error={null} onRetry={vi.fn()} isEmpty>
        <div>不應出現</div>
      </DataSection>,
    );
    expect(screen.getByText('目前沒有資料')).toBeInTheDocument();
    expect(screen.queryByText('不應出現')).not.toBeInTheDocument();
  });
});
