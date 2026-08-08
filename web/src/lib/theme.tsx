import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemePref = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

interface ThemeCtx {
  pref: ThemePref;
  resolved: ResolvedTheme;
  cycle: () => void;
}

const Ctx = createContext<ThemeCtx | null>(null);
const KEY = 'opinion-theme';

function readStoredPreference(): ThemePref {
  try {
    const saved = window.localStorage.getItem(KEY);
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
  } catch {
    return 'system';
  }
}

function storePreference(pref: ThemePref) {
  try {
    window.localStorage.setItem(KEY, pref);
  } catch {
    // 私密瀏覽或嵌入環境可能禁止儲存；主題仍可在本次工作階段運作。
  }
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPref] = useState<ThemePref>(() => {
    return readStoredPreference();
  });
  const [sys, setSys] = useState<ResolvedTheme>(systemTheme);

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return undefined;
    const onChange = () => setSys(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolved: ResolvedTheme = pref === 'system' ? sys : pref;

  useEffect(() => {
    const root = document.documentElement;
    if (pref === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', pref);
    storePreference(pref);
  }, [pref]);

  const value = useMemo<ThemeCtx>(
    () => ({
      pref,
      resolved,
      cycle: () => setPref((p) => (p === 'system' ? 'light' : p === 'light' ? 'dark' : 'system')),
    }),
    [pref, resolved],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTheme 必須在 ThemeProvider 內使用');
  return ctx;
}

/** ECharts 在 canvas 上無法解析 CSS 變數，需讀取實際計算值。 */
export interface ChartTokens {
  theme: ResolvedTheme;
  text: string;
  secondary: string;
  muted: string;
  grid: string;
  baseline: string;
  surface: string;
  series: string[];
  positive: string;
  neutral: string;
  negative: string;
  accent: string;
}

function readVar(styles: CSSStyleDeclaration, name: string): string {
  return styles.getPropertyValue(name).trim();
}

/** 依目前主題讀取調色盤實際值，供 ECharts 使用。 */
export function useChartTokens(): ChartTokens {
  const { resolved } = useTheme();
  return useMemo<ChartTokens>(() => {
    const s = getComputedStyle(document.documentElement);
    return {
      theme: resolved,
      text: readVar(s, '--text-primary') || '#0b0b0b',
      secondary: readVar(s, '--text-secondary') || '#52514e',
      muted: readVar(s, '--text-muted') || '#898781',
      grid: readVar(s, '--grid') || '#e1e0d9',
      baseline: readVar(s, '--baseline') || '#c3c2b7',
      surface: readVar(s, '--surface-1') || '#fcfcfb',
      accent: readVar(s, '--accent') || '#2a78d6',
      positive: readVar(s, '--sent-positive') || '#0ca30c',
      neutral: readVar(s, '--sent-neutral') || '#898781',
      negative: readVar(s, '--sent-negative') || '#d03b3b',
      series: [
        readVar(s, '--series-1'),
        readVar(s, '--series-2'),
        readVar(s, '--series-3'),
        readVar(s, '--series-4'),
        readVar(s, '--series-5'),
        readVar(s, '--series-6'),
        readVar(s, '--series-7'),
        readVar(s, '--series-8'),
      ].filter(Boolean),
    };
  }, [resolved]);
}
