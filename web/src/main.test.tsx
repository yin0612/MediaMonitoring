import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './main';

describe('App routes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the formal homepage when data is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    window.location.hash = '#/';
    render(<App />);
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
    await waitFor(() => expect(screen.getByRole('heading', { name: '等待下一批新聞訊號' })).toBeInTheDocument());
  });
});
