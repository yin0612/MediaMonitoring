import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AnalysisLauncher } from './AnalysisLauncher';

describe('AnalysisLauncher', () => {
  it('shows decision presets and every supported query token', () => {
    render(<AnalysisLauncher onApply={vi.fn()} />);

    expect(screen.getByRole('button', { name: /品牌比較/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /政策監測/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /排除雜訊/ })).toBeInTheDocument();
    for (const token of ['AND', 'OR', 'NOT', '-排除詞', '"精準詞"']) {
      expect(screen.getByText(token)).toBeInTheDocument();
    }
  });

  it('returns a cloned preset without starting analysis', () => {
    const onApply = vi.fn();
    render(<AnalysisLauncher onApply={onApply} />);

    fireEvent.click(screen.getByRole('button', { name: /品牌比較/ }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(
      [{ name: '全聯', query: '全聯' }, { name: '家樂福', query: '家樂福' }],
      '24h',
    );
  });
});
