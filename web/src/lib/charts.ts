import type { EChartsOption } from 'echarts';
import type { ChartTokens } from './theme';

// ECharts 的 option 型別極其嚴格（字面量會被 widen），這些純樣式輔助函式
// 以 any 回傳，避免與內部聯合型別打架；呼叫端仍以 EChartsOption 收斂。

/** 統一的 tooltip 樣式。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function tooltip(tokens: ChartTokens, extra: Record<string, unknown> = {}): any {
  return {
    backgroundColor: tokens.surface,
    borderColor: tokens.grid,
    borderWidth: 1,
    textStyle: { color: tokens.text, fontSize: 12 },
    extraCssText: 'box-shadow: 0 6px 20px rgba(0,0,0,0.12); border-radius: 8px;',
    ...extra,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function catAxis(tokens: ChartTokens, extra: Record<string, unknown> = {}): any {
  return {
    axisLine: { lineStyle: { color: tokens.baseline } },
    axisTick: { show: false },
    axisLabel: { color: tokens.muted, fontSize: 11 },
    splitLine: { show: false },
    ...extra,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function valAxis(tokens: ChartTokens, extra: Record<string, unknown> = {}): any {
  return {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: tokens.muted, fontSize: 11 },
    splitLine: { lineStyle: { color: tokens.grid, type: 'dashed' } },
    ...extra,
  };
}

export const GRID = { left: 8, right: 16, top: 24, bottom: 8, containLabel: true };

/** 迷你走勢圖（sparkline）option。 */
export function sparkline(values: number[], color: string): EChartsOption {
  return {
    grid: { left: 0, right: 0, top: 2, bottom: 2 },
    xAxis: { type: 'category', show: false, data: values.map((_, i) => i) },
    yAxis: { type: 'value', show: false, scale: true },
    series: [
      {
        type: 'line',
        data: values,
        showSymbol: false,
        smooth: true,
        lineStyle: { width: 1.5, color },
        areaStyle: { color, opacity: 0.12 },
      },
    ],
    tooltip: { show: false },
  };
}
