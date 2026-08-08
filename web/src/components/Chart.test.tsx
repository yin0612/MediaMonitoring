import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CSSProperties } from 'react';
import { Chart } from './Chart';
import { ThemeProvider } from '../lib/theme';

vi.mock('echarts-for-react', () => ({
  default: ({ style }: { style: CSSProperties }) => <div data-testid="echarts" style={style} />,
}));

describe('Chart', () => {
  it('renders a plain-text summary for non-canvas readers', () => {
    render(
      <ThemeProvider>
        <Chart option={{ series: [] }} summary="近 24 小時台股熱度最高。" />
      </ThemeProvider>,
    );
    expect(screen.getByRole('img', { name: '近 24 小時台股熱度最高。' })).toBeInTheDocument();
    expect(screen.getByText('近 24 小時台股熱度最高。')).toBeInTheDocument();
  });
});
