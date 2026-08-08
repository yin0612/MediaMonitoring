import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../lib/theme';
import { AdvancedAnalysisPage } from './AdvancedAnalysisPage';
import { searchNews } from '../api/search';

vi.mock('../api/search', () => ({ searchNews: vi.fn() }));

describe('AdvancedAnalysisPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('applies a preset to the form without performing a search', () => {
    render(
      <ThemeProvider>
        <MemoryRouter><AdvancedAnalysisPage /></MemoryRouter>
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /品牌比較/ }));

    expect(screen.getByRole('textbox', { name: '主題 1 名稱' })).toHaveValue('全聯');
    expect(screen.getByRole('textbox', { name: '主題 1 查詢' })).toHaveValue('全聯');
    expect(screen.getByRole('textbox', { name: '主題 2 名稱' })).toHaveValue('家樂福');
    expect(screen.getByRole('combobox', { name: '分析時間範圍' })).toHaveValue('24h');
    expect(searchNews).not.toHaveBeenCalled();
  });
});
