import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
// @ts-expect-error The frontend tsconfig omits Node types; Vitest provides this built-in at test runtime.
import { readFileSync } from 'node:fs';
import type { NavGroup, NavItem } from './Layout';
import { TopNavigation } from './TopNavigation';

const appleCssUrl = new URL(['..', 'styles', 'apple.css'].join('/'), import.meta.url);
const appleCss = readFileSync(appleCssUrl, 'utf8') as string;

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

describe('TopNavigation', () => {
  it('flattens Home and every group into exactly nine route links', () => {
    render(
      <MemoryRouter initialEntries={['/topics']}>
        <TopNavigation groups={groups} home={home} />
      </MemoryRouter>,
    );

    const navigation = screen.getByRole('navigation', { name: '主導覽' });
    const links = within(navigation).getAllByRole('link');
    expect(links).toHaveLength(9);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/', '/search', '/recent', '/analysis', '/overview', '/keywords', '/topics', '/entities', '/method',
    ]);
    expect(within(navigation).getByRole('link', { name: '主題分類' })).toHaveClass('active');
  });

  it('keeps an outline focus-ring contract on the active route', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <TopNavigation groups={groups} home={home} />
      </MemoryRouter>,
    );

    const activeHome = screen.getByRole('link', { name: '首頁' });
    activeHome.focus();

    expect(activeHome).toHaveFocus();
    expect(activeHome).toHaveClass('active');
    expect(activeHome).toHaveAttribute('data-focus-ring', 'outline');

    const activeRule = appleCss.match(/\.topnav__link\.active\s*\{([^}]*)\}/)?.[1] ?? '';
    const focusRule = appleCss.match(/\.topnav__link\[data-focus-ring=['"]outline['"]\]:focus-visible\s*\{([^}]*)\}/)?.[1] ?? '';
    const activeShadow = activeRule.match(/box-shadow\s*:\s*([^;]+);/i)?.[1].trim().toLowerCase();
    const focusOutline = focusRule.match(/outline\s*:\s*([^;]+);/i)?.[1].trim().toLowerCase();
    expect(activeShadow).toBeTruthy();
    expect(activeShadow).not.toBe('none');
    expect(focusOutline).toBeTruthy();
    expect(focusOutline).not.toBe('none');
  });
});
