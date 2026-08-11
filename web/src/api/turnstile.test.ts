import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestTurnstileToken } from './turnstile';

describe('requestTurnstileToken', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete (window as Window & { turnstile?: unknown }).turnstile;
    document.body.innerHTML = '';
  });

  it('returns undefined when the site key is not configured', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '');
    await expect(requestTurnstileToken()).resolves.toBeUndefined();
  });

  it('executes an invisible widget and resolves its one-time token', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'site-key');
    let callback: ((token: string) => void) | undefined;
    const remove = vi.fn();
    const execute = vi.fn(() => callback?.('one-time-token'));
    (window as Window & { turnstile?: unknown }).turnstile = {
      render: vi.fn((_container: HTMLElement, options: { callback: (token: string) => void }) => {
        callback = options.callback;
        return 'widget-id';
      }),
      execute,
      remove,
    };

    await expect(requestTurnstileToken()).resolves.toBe('one-time-token');
    expect(execute).toHaveBeenCalledWith('widget-id');
    expect(remove).toHaveBeenCalledWith('widget-id');
    expect(document.querySelector('[data-turnstile-host]')).toBeNull();
  });
});
