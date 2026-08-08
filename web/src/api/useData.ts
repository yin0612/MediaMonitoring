import { useEffect, useRef, useState } from 'react';
import type { Envelope } from '../types/contracts';
import { fetchData } from './client';

/** 靜態 JSON 的自動刷新間隔；快照由 GitHub Actions 產生，過短只是浪費請求。 */
export const DATA_REFRESH_MS = 90_000;
export const DATA_REFRESH_EVENT = 'media-monitoring:refresh';

export interface AsyncState<T> {
  loading: boolean;
  error: Error | null;
  /** 完整外殼（含 generatedAt）。 */
  envelope: Envelope<T> | null;
  data: T | null;
  reload: () => void;
}

/**
 * 讀取單一資料檔並暴露 loading / error / data 狀態。
 * 頁面可見時每 90 秒靜默重新抓取（不閃 loading），切到背景分頁時暫停。
 */
export function useData<T>(name: string, refreshMs: number = DATA_REFRESH_MS): AsyncState<T> {
  const [envelope, setEnvelope] = useState<Envelope<T> | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const hasData = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const load = (silent: boolean) => {
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      fetchData<T>(name)
        .then((env) => {
          if (cancelled) return;
          hasData.current = true;
          setEnvelope(env);
          setError(null);
        })
        .catch((err: Error) => {
          if (cancelled) return;
          // 靜默刷新失敗時保留畫面上的舊資料，只在初次載入失敗時顯示錯誤。
          if (!silent || !hasData.current) {
            setError(err);
            setEnvelope(null);
          }
        })
        .finally(() => {
          if (!cancelled && !silent) setLoading(false);
        });
    };

    load(false);
    const onManualRefresh = () => load(true);
    window.addEventListener(DATA_REFRESH_EVENT, onManualRefresh);
    const timer = refreshMs > 0
      ? setInterval(() => {
          if (document.visibilityState === 'visible') load(true);
        }, refreshMs)
      : null;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      window.removeEventListener(DATA_REFRESH_EVENT, onManualRefresh);
    };
  }, [name, nonce, refreshMs]);

  return {
    loading,
    error,
    envelope,
    data: envelope?.data ?? null,
    reload: () => setNonce((n) => n + 1),
  };
}
