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
  deep: 'queued' | 'running' | 'completed' | 'failed' | 'unavailable' | 'skipped';
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
    status: 'queued' | 'running' | 'completed' | 'failed' | 'unavailable' | 'skipped';
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

export async function requestManualRefresh(turnstileToken?: string): Promise<ManualRefreshResponse> {
  const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
  if (!apiBase) throw new DataFetchError('refresh', '尚未設定 Cloudflare Worker 網址，無法手動更新');

  let response: Response;
  try {
    response = await fetch(`${apiBase}/api/refresh`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ turnstileToken: turnstileToken || null }),
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
  // Worker 對每個 IP 有五分鐘節流；把剩餘秒數講清楚，別讓使用者以為按鈕壞了。
  if (response.status === 429) {
    const retryAfterSeconds =
      typeof payload.retryAfterSeconds === 'number' ? payload.retryAfterSeconds : 300;
    throw new DataFetchError(
      'refresh',
      `剛剛已經觸發過更新，請於 ${retryAfterSeconds} 秒後再試`,
    );
  }
  if (!response.ok) {
    throw new DataFetchError('refresh', `手動更新失敗（HTTP ${response.status}）`);
  }
  if (payload.status !== 'accepted' || typeof payload.refreshId !== 'string') {
    throw new DataFetchError('refresh', '手動更新回應格式不正確');
  }
  return payload as unknown as ManualRefreshResponse;
}

/** 由 Worker KV 提供的即時快照檔名；news-archive（7 天）與 trends 仍走 Pages/各自端點。 */
const WORKER_FILES = new Set(['meta', 'keywords', 'sources', 'recent', 'entities', 'topics', 'events']);

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

async function fetchEnvelope<T>(name: string, url: string, cache: RequestCache, signal?: AbortSignal): Promise<Envelope<T>> {
  let res: Response;
  try {
    res = await fetch(url, { cache, signal });
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
const DATA_CACHE_TTL_MS = 45_000;
const WORKER_DEADLINE_MS = 2_000;
const dataCache = new Map<string, { expiresAt: number; value: Envelope<unknown> }>();
const inFlight = new Map<string, Promise<Envelope<unknown>>>();

function envelopeQuality(name: string, envelope: Envelope<unknown>): number {
  const data = envelope.data as Record<string, unknown>;
  const explicit = data?.quality as Record<string, unknown> | undefined;
  if (typeof explicit?.score === 'number') return explicit.score;
  if (name === 'sources' && Array.isArray(data?.sources)) {
    const values = (data.sources as Array<Record<string, unknown>>)
      .map((source) => source.qualityScore)
      .filter((value): value is number => typeof value === 'number');
    if (values.length) return values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  if (name === 'recent' && Array.isArray(data?.items)) {
    const items = data.items as Array<Record<string, unknown>>;
    const excerptRate = items.length
      ? items.filter((item) => String(item.excerpt || '').trim()).length / items.length
      : 0;
    return Math.min(1, items.length / 120) * 0.7 + excerptRate * 0.3;
  }
  return 0.5;
}

function mergeRecent<T>(workerEnv: Envelope<T>, pagesEnv: Envelope<T>): Envelope<T> {
  const workerData = workerEnv.data as Record<string, unknown>;
  const pagesData = pagesEnv.data as Record<string, unknown>;
  if (!Array.isArray(workerData.items) || !Array.isArray(pagesData.items)) return workerEnv;
  const workerTime = Date.parse(workerEnv.generatedAt) || 0;
  const pagesTime = Date.parse(pagesEnv.generatedAt) || 0;
  const preferredEnv = workerTime >= pagesTime ? workerEnv : pagesEnv;
  const fallbackEnv = preferredEnv === workerEnv ? pagesEnv : workerEnv;
  const preferredData = preferredEnv.data as Record<string, unknown>;
  const fallbackData = fallbackEnv.data as Record<string, unknown>;
  const merged = new Map<string, Record<string, unknown>>();
  for (const item of [...fallbackData.items as unknown[], ...preferredData.items as unknown[]] as Array<Record<string, unknown>>) {
    const url = String(item.url || '').replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();
    const key = url || `${String(item.source)}:${String(item.title).replace(/\s/g, '').toLowerCase()}`;
    merged.set(key, item);
  }
  const items = [...merged.values()]
    .sort((a, b) => Date.parse(String(b.publishedAt)) - Date.parse(String(a.publishedAt)))
    .slice(0, 800);
  return { ...preferredEnv, data: { ...fallbackData, ...preferredData, items } as T };
}

function arbitrate<T>(name: string, workerEnv: Envelope<T>, pagesEnv: Envelope<T>): Envelope<T> {
  if (name === 'recent') return mergeRecent(workerEnv, pagesEnv);
  const workerQuality = envelopeQuality(name, workerEnv as Envelope<unknown>);
  const pagesQuality = envelopeQuality(name, pagesEnv as Envelope<unknown>);
  if (Math.abs(workerQuality - pagesQuality) >= 0.02) {
    return workerQuality > pagesQuality ? workerEnv : pagesEnv;
  }
  const workerTime = Date.parse(workerEnv.generatedAt) || 0;
  const pagesTime = Date.parse(pagesEnv.generatedAt) || 0;
  return workerTime >= pagesTime ? workerEnv : pagesEnv;
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => signal.addEventListener(
      'abort',
      () => reject(new DOMException('Aborted', 'AbortError')),
      { once: true },
    )),
  ]);
}

async function loadData<T>(name: string, bypassCache: boolean): Promise<Envelope<T>> {
  const workerUrl = WORKER_FILES.has(name) ? workerDataUrl(name) : null;
  const workerController = new AbortController();
  const workerTimer = workerUrl
    ? window.setTimeout(() => workerController.abort(), WORKER_DEADLINE_MS)
    : null;
  const workerRequest = workerUrl
    ? fetchEnvelope<T>(name, workerUrl, 'no-store', workerController.signal)
        .finally(() => { if (workerTimer !== null) window.clearTimeout(workerTimer); })
    : Promise.resolve<Envelope<T> | null>(null);
  const pagesRequest = fetchEnvelope<T>(name, pagesUrl(name, bypassCache), 'no-cache');
  const [workerResult, pagesResult] = await Promise.allSettled([workerRequest, pagesRequest]);
  const workerEnv = workerResult.status === 'fulfilled' ? workerResult.value : null;
  const pagesEnv = pagesResult.status === 'fulfilled' ? pagesResult.value : null;
  if (!workerEnv && !pagesEnv) {
    const schemaError = [workerResult, pagesResult]
      .find((result) => result.status === 'rejected' && result.reason instanceof SchemaVersionError);
    if (schemaError?.status === 'rejected') throw schemaError.reason;
    if (pagesResult.status === 'rejected') throw pagesResult.reason;
    if (workerResult.status === 'rejected') throw workerResult.reason;
  }
  if (workerEnv && pagesEnv) return arbitrate(name, workerEnv, pagesEnv);
  return workerEnv ?? (pagesEnv as Envelope<T>);
}

export async function fetchData<T>(
  name: string,
  options?: { bypassCache?: boolean; signal?: AbortSignal },
): Promise<Envelope<T>> {
  const bypassCache = options?.bypassCache ?? false;
  if (bypassCache) dataCache.delete(name);
  const cached = dataCache.get(name);
  if (!bypassCache && cached && cached.expiresAt > Date.now()) {
    return abortable(Promise.resolve(cached.value as Envelope<T>), options?.signal);
  }
  let pending = inFlight.get(name) as Promise<Envelope<T>> | undefined;
  if (!pending || bypassCache) {
    pending = loadData<T>(name, bypassCache).then((value) => {
      dataCache.set(name, { expiresAt: Date.now() + DATA_CACHE_TTL_MS, value });
      return value;
    }).finally(() => {
      if (inFlight.get(name) === pending) inFlight.delete(name);
    });
    inFlight.set(name, pending as Promise<Envelope<unknown>>);
  }
  return abortable(pending, options?.signal);
}

export function __resetDataCacheForTests(): void {
  dataCache.clear();
  inFlight.clear();
}

/** 明確讀取 Pages last-good；用於 Worker 搜尋失敗後，避免再讀到截短的 Worker 快照。 */
export async function fetchPagesData<T>(name: string): Promise<Envelope<T>> {
  return fetchEnvelope<T>(name, pagesUrl(name), 'no-cache');
}
