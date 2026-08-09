/**
 * 讀取 GitHub Pages 上的靜態公開 JSON。
 * 前端不直接呼叫任何需要憑證的 API；一切資料皆來自建置時寫入的 data/*.json。
 */
import { SUPPORTED_SCHEMA_MAJOR, type Envelope } from '../types/contracts';

export class SchemaVersionError extends Error {
  constructor(
    public readonly file: string,
    public readonly got: string,
  ) {
    super(`不支援的資料版本：${file} 為 ${got}，前端支援主版本 ${SUPPORTED_SCHEMA_MAJOR}`);
    this.name = 'SchemaVersionError';
  }
}

export class DataFetchError extends Error {
  constructor(
    public readonly file: string,
    message: string,
  ) {
    super(message);
    this.name = 'DataFetchError';
  }
}

function majorOf(version: string): number {
  const n = Number.parseInt(version.split('.')[0] ?? '', 10);
  return Number.isNaN(n) ? -1 : n;
}

/** 以 Vite base 為基準組出 Pages 靜態資料檔的完整路徑（備援用）。 */
function pagesUrl(name: string, bypassCache = false): string {
  const base = import.meta.env.BASE_URL || '/';
  const sep = base.endsWith('/') ? '' : '/';
  return `${base}${sep}data/${name}.json${bypassCache ? `?v=${Date.now()}` : ''}`;
}

/** Worker /api/data 端點（由 Cron 每 5 分鐘更新的即時快照）。未設定 API base 時為空。 */
function workerDataUrl(name: string): string | null {
  const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
  return apiBase ? `${apiBase}/api/data?name=${encodeURIComponent(name)}` : null;
}

export interface ManualRefreshResponse {
  status: 'accepted';
  refreshId: string;
  requestedAt: string;
  fast: 'running' | 'completed' | 'failed';
  deep: 'queued' | 'running' | 'completed' | 'failed' | 'unavailable';
}

export interface RefreshStatus {
  refreshId: string;
  requestedAt: string;
  fast: {
    status: 'running' | 'completed' | 'failed';
    generatedAt: string | null;
    error: string | null;
  };
  deep: {
    status: 'queued' | 'running' | 'completed' | 'failed' | 'unavailable';
    generatedAt: string | null;
    error: string | null;
  };
}

export async function fetchRefreshStatus(refreshId: string): Promise<RefreshStatus> {
  const base = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
  const response = await fetch(`${base}/api/refresh/status?id=${encodeURIComponent(refreshId)}`, {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new DataFetchError('refresh', `無法取得更新狀態（HTTP ${response.status}）`);
  }
  return response.json();
}

/** 是否設定了 Worker 網址；未設定時前端不應顯示手動更新入口。 */
export function isManualRefreshConfigured(): boolean {
  return Boolean((import.meta.env.VITE_API_BASE_URL || '').trim());
}

export async function requestManualRefresh(): Promise<ManualRefreshResponse> {
  const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
  if (!apiBase) throw new DataFetchError('refresh', '尚未設定 Cloudflare Worker 網址，無法手動更新');

  let response: Response;
  try {
    response = await fetch(`${apiBase}/api/refresh`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });
  } catch {
    // 網路層失敗（Worker 未部署、DNS 解析不到、CORS 阻擋）。
    // 這時資料本身仍由排程更新，不該讓使用者以為全站故障，故給明確且不嚇人的說明。
    throw new DataFetchError(
      'refresh',
      '手動更新服務目前無法連線，資料仍會依排程自動更新',
    );
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {}
  const payload = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  if (!response.ok) {
    throw new DataFetchError('refresh', `手動更新失敗（HTTP ${response.status}）`);
  }
  if (payload.status !== 'accepted' || typeof payload.refreshId !== 'string') {
    throw new DataFetchError('refresh', '手動更新回應格式不正確');
  }
  return payload as unknown as ManualRefreshResponse;
}

/** 由 Worker KV 提供的即時快照檔名；news-archive（7 天）與 trends 仍走 Pages/各自端點。 */
const WORKER_FILES = new Set(['meta', 'keywords', 'sources', 'recent', 'entities', 'topics']);

function validateEnvelope<T>(name: string, json: unknown): Envelope<T> {
  const env = json as Partial<Envelope<T>>;
  if (
    !env ||
    typeof env.schemaVersion !== 'string' ||
    typeof env.generatedAt !== 'string' ||
    env.data === undefined
  ) {
    throw new DataFetchError(name, `${name} 資料缺少必要外層欄位`);
  }
  if (majorOf(env.schemaVersion) !== SUPPORTED_SCHEMA_MAJOR) {
    throw new SchemaVersionError(name, env.schemaVersion);
  }
  return env as Envelope<T>;
}

async function fetchEnvelope<T>(name: string, url: string, cache: RequestCache): Promise<Envelope<T>> {
  let res: Response;
  try {
    res = await fetch(url, { cache });
  } catch (err) {
    throw new DataFetchError(name, `無法連線取得 ${name}：${(err as Error).message}`);
  }
  if (!res.ok) throw new DataFetchError(name, `讀取 ${name} 失敗（HTTP ${res.status}）`);
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new DataFetchError(name, `${name} 內容不是有效 JSON`);
  }
  return validateEnvelope<T>(name, json);
}

/**
 * 抓取單一資料檔並驗證外殼與 schema 主版本。
 * 若設定了 Worker API base，優先讀 Worker 的即時快照（每 5 分鐘更新）；
 * Worker 尚未產生快照或連線失敗時，改讀 GitHub Pages 靜態檔（last-good）。
 */
export async function fetchData<T>(
  name: string,
  options?: { bypassCache?: boolean },
): Promise<Envelope<T>> {
  const bypassCache = options?.bypassCache ?? false;
  const workerUrl = WORKER_FILES.has(name) ? workerDataUrl(name) : null;
  let workerEnv: Envelope<T> | null = null;
  if (workerUrl) {
    try {
      workerEnv = await fetchEnvelope<T>(name, workerUrl, 'no-store');
    } catch (err) {
      if (err instanceof SchemaVersionError) throw err;
    }
  }

  let pagesEnv: Envelope<T> | null = null;
  try {
    pagesEnv = await fetchEnvelope<T>(name, pagesUrl(name, bypassCache), 'no-cache');
  } catch (err) {
    if (!workerEnv) throw err;
  }

  if (workerEnv && pagesEnv) {
    const workerTime = Date.parse(workerEnv.generatedAt) || 0;
    const pagesTime = Date.parse(pagesEnv.generatedAt) || 0;
    return workerTime >= pagesTime ? workerEnv : pagesEnv;
  }

  return workerEnv ?? (pagesEnv as Envelope<T>);
}

/** 明確讀取 Pages last-good；用於 Worker 搜尋失敗後，避免再讀到截短的 Worker 快照。 */
export async function fetchPagesData<T>(name: string): Promise<Envelope<T>> {
  return fetchEnvelope<T>(name, pagesUrl(name), 'no-cache');
}
