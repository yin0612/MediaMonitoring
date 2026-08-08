import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/main';

const routes = ['/', '/search', '/recent', '/analysis', '/overview', '/keywords', '/topics', '/entities', '/method'];
const ROUTE_TIMEOUT = 8_000;

describe('public route smoke test', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  for (const route of routes) {
    it('renders ' + route + ' without an uncaught route error', async () => {
      window.location.hash = route === '/' ? '#/' : '#' + route;
      const { container } = render(<App />);
      await waitFor(() => expect(container.querySelectorAll('main')).toHaveLength(1), { timeout: ROUTE_TIMEOUT });
      await waitFor(() => expect(container.querySelectorAll('h1')).toHaveLength(1), { timeout: ROUTE_TIMEOUT });
      const topNavigation = screen.getByRole('navigation', { name: '主導覽' });
      expect(within(topNavigation).getAllByRole('link')).toHaveLength(8);
      expect(container.querySelector('aside.sidebar')).not.toBeInTheDocument();
      expect(screen.getByRole('navigation', { name: '行動版主導覽' }).compareDocumentPosition(container.querySelector('main')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(container.querySelector('.mobile-nav')).not.toBeInTheDocument();
      if (route === '/') expect(container.querySelector('.decision-brief')).toBeInTheDocument();
      if (route === '/analysis') expect(container.querySelector('.analysis-launcher')).toBeInTheDocument();
    }, ROUTE_TIMEOUT + 2_000);
  }
});
