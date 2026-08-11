interface TurnstileOptions {
  sitekey: string;
  size: 'invisible';
  execution: 'execute';
  callback: (token: string) => void;
  'error-callback': () => void;
  'expired-callback': () => void;
}

interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileOptions): string;
  execute(widgetId: string): void;
  remove(widgetId: string): void;
}

type TurnstileWindow = Window & { turnstile?: TurnstileApi };

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  const current = (window as TurnstileWindow).turnstile;
  if (current) return Promise.resolve(current);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-turnstile-script]');
    const script = existing ?? document.createElement('script');
    const onLoad = () => {
      const api = (window as TurnstileWindow).turnstile;
      if (api) resolve(api);
      else reject(new Error('Turnstile 載入完成但 API 不存在'));
    };
    const onError = () => reject(new Error('Turnstile 驗證服務載入失敗'));
    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });
    if (!existing) {
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.dataset.turnstileScript = 'true';
      document.head.appendChild(script);
    }
  }).catch((error) => {
    scriptPromise = null;
    throw error;
  });
  return scriptPromise;
}

export async function requestTurnstileToken(): Promise<string | undefined> {
  const siteKey = (import.meta.env.VITE_TURNSTILE_SITE_KEY || '').trim();
  if (!siteKey) return undefined;

  const api = await loadTurnstile();
  const host = document.createElement('div');
  host.dataset.turnstileHost = 'true';
  host.hidden = true;
  document.body.appendChild(host);

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let widgetId = '';
    const cleanup = () => {
      if (widgetId) api.remove(widgetId);
      host.remove();
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      cleanup();
      callback();
    };
    const timeoutId = window.setTimeout(
      () => finish(() => reject(new Error('Turnstile 驗證逾時，請再試一次'))),
      20_000,
    );
    widgetId = api.render(host, {
      sitekey: siteKey,
      size: 'invisible',
      execution: 'execute',
      callback: (token) => finish(() => resolve(token)),
      'error-callback': () => finish(() => reject(new Error('Turnstile 驗證失敗，請再試一次'))),
      'expired-callback': () => finish(() => reject(new Error('Turnstile 驗證已過期，請再試一次'))),
    });
    api.execute(widgetId);
  });
}
