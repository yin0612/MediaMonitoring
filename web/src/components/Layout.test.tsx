import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Layout } from './Layout';
import { ThemeProvider } from '../lib/theme';

vi.mock('../api/useData', () => ({
  DATA_REFRESH_EVENT: 'media-monitoring:refresh',
  useData: () => ({ data: null, loading: false, error: null, envelope: null, reload: vi.fn() }),
}));

vi.mock('../api/client', () => ({
  isManualRefreshConfigured: () => false,
  requestManualRefresh: vi.fn(),
}));

describe('Layout', () => {
  afterEach(() => vi.clearAllMocks());

  it('renders top navigation between the brand and utilities without a sidebar', () => {
    const { container } = render(<ThemeProvider><MemoryRouter initialEntries={['/topics']}><Layout /></MemoryRouter></ThemeProvider>);
    expect(screen.getByRole('link', { name: '跳至主要內容' })).toHaveAttribute('href', '#main-content');
    expect(screen.getByRole('link', { name: '媒體輿情監測 - 回首頁' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: '主題分類' })).toHaveAttribute('href', '/topics');
    const appbar = container.querySelector('.appbar');
    const brand = container.querySelector('.appbar__brand');
    const desktopNavigation = screen.getByRole('navigation', { name: '主導覽' });
    const themeToggle = screen.getByRole('button', { name: '切換主題' });
    expect(appbar).toContainElement(desktopNavigation);
    expect(brand).not.toBeNull();
    expect(brand!.compareDocumentPosition(desktopNavigation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(desktopNavigation.compareDocumentPosition(themeToggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(desktopNavigation).getAllByRole('link')).toHaveLength(8);
    expect(container.querySelector('aside.sidebar')).not.toBeInTheDocument();
    const mobileNavigation = screen.getByRole('navigation', { name: '行動版主導覽' });
    const main = container.querySelector('main');
    expect(mobileNavigation).toBeInTheDocument();
    expect(main).toHaveAttribute('id', 'main-content');
    expect(mobileNavigation.compareDocumentPosition(main!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    const mobileSheet = screen.getByRole('dialog', { name: '所有功能' });
    expect(mobileSheet).toBeInTheDocument();
    expect(within(mobileSheet).getByRole('link', { name: '數據來源' })).toHaveAttribute('href', '/method');
    expect(main?.closest('.layout')).toHaveAttribute('inert');
    expect(screen.getByTestId('brand-mark')).toBeInTheDocument();
    expect(container.querySelector('a[href*="github.com"]')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('GitHub 原始碼')).not.toBeInTheDocument();
  });
});
