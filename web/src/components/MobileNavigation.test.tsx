import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NavGroup, NavItem } from './Layout';
import { MobileNavigation } from './MobileNavigation';

const home: NavItem = { to: '/', label: '首頁', icon: 'layout', end: true };
const groups: NavGroup[] = [
  { label: '探索新聞', items: [
    { to: '/search', label: '新聞搜尋', icon: 'search' },
    { to: '/recent', label: '近期新聞', icon: 'newspaper' },
    { to: '/analysis', label: '進階分析', icon: 'scale' },
  ] },
  { label: '輿情分析', items: [
    { to: '/overview', label: '資料總覽', icon: 'layout' },
    { to: '/keywords', label: '關鍵字熱度', icon: 'flame' },
    { to: '/topics', label: '主題分類', icon: 'layers' },
    { to: '/entities', label: '組織', icon: 'network' },
  ] },
  { label: '資料說明', items: [{ to: '/method', label: '數據來源', icon: 'compass' }] },
];

function renderNavigation() {
  return render(<MemoryRouter><MobileNavigation groups={groups} home={home} /></MemoryRouter>);
}

describe('MobileNavigation', () => {
  let mediaListener: ((event: MediaQueryListEvent) => void) | null;

  beforeEach(() => {
    mediaListener = null;
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      media: '(max-width: 1100px)',
      onchange: null,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => { mediaListener = listener; },
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => true,
    })));
  });

  it('uses the 1100px compact breakpoint', () => {
    renderNavigation();

    expect(window.matchMedia).toHaveBeenCalledWith('(max-width: 1100px)');
  });

  afterEach(() => {
    document.body.style.overflow = '';
    vi.unstubAllGlobals();
  });

  it('shows four primary controls and exposes every route in the more sheet', () => {
    renderNavigation();

    expect(screen.getByRole('navigation', { name: '行動版主導覽' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '首頁' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: '搜尋' })).toHaveAttribute('href', '/search');
    expect(screen.getByRole('link', { name: '總覽' })).toHaveAttribute('href', '/overview');
    expect(screen.getByRole('button', { name: '更多' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '更多' }));

    expect(screen.getByRole('dialog', { name: '所有功能' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '近期新聞' })).toHaveAttribute('href', '/recent');
    expect(screen.getByRole('link', { name: '進階分析' })).toHaveAttribute('href', '/analysis');
    expect(screen.getByRole('link', { name: '關鍵字熱度' })).toHaveAttribute('href', '/keywords');
    expect(screen.getByRole('link', { name: '主題分類' })).toHaveAttribute('href', '/topics');
    expect(screen.getByRole('link', { name: '組織' })).toHaveAttribute('href', '/entities');
    expect(screen.getByRole('link', { name: '數據來源' })).toHaveAttribute('href', '/method');
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('closes from Escape, the close control, and a selected route', () => {
    renderNavigation();
    const more = screen.getByRole('button', { name: '更多' });

    fireEvent.click(more);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '所有功能' })).not.toBeInTheDocument();

    fireEvent.click(more);
    fireEvent.click(screen.getByRole('button', { name: '關閉功能選單' }));
    expect(screen.queryByRole('dialog', { name: '所有功能' })).not.toBeInTheDocument();

    fireEvent.click(more);
    fireEvent.click(screen.getByRole('link', { name: '主題分類' }));
    expect(screen.queryByRole('dialog', { name: '所有功能' })).not.toBeInTheDocument();
  });

  it('moves focus into the modal, traps Tab, and restores the trigger', () => {
    renderNavigation();
    const more = screen.getByRole('button', { name: '更多' });
    more.focus();
    fireEvent.click(more);

    const dialog = screen.getByRole('dialog', { name: '所有功能' });
    const close = within(dialog).getByRole('button', { name: '關閉功能選單' });
    const links = within(dialog).getAllByRole('link');
    expect(close).toHaveFocus();

    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(links[links.length - 1]).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(close).toHaveFocus();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(more).toHaveFocus();
  });

  it('closes and unlocks scrolling when the viewport leaves mobile width', () => {
    renderNavigation();
    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    expect(document.body.style.overflow).toBe('hidden');

    act(() => mediaListener?.({ matches: false } as MediaQueryListEvent));

    expect(screen.queryByRole('dialog', { name: '所有功能' })).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');
  });
});
