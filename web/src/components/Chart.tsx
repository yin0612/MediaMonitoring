import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, GraphChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsOption } from 'echarts';
import { useTheme } from '../lib/theme';

echarts.use([
  BarChart,
  GraphChart,
  LineChart,
  PieChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

interface Props {
  option: EChartsOption;
  height?: number | string;
  /** 圖表容器的額外 class。 */
  className?: string;
  /** 提供給 canvas 以外讀者的文字摘要。 */
  summary?: string;
}

/**
 * Render ECharts through its imperative API instead of the React wrapper.
 *
 * The wrapper's CommonJS/ESM interop is not stable in Vite production builds:
 * some versions expose the component constructor as a module object, which
 * React then rejects with error #130. Calling ECharts directly keeps the
 * production bundle's value boundary explicit and also lets us dispose the
 * instance deterministically when a route unmounts.
 */
export function Chart({ option, height = 300, className, summary }: Props) {
  const { resolved } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof echarts.init> | null>(null);
  const reducedMotion = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const chart = echarts.init(container, resolved, { renderer: 'canvas' });
    chartRef.current = chart;
    chart.setOption(reducedMotion ? { ...option, animation: false } : option, true);

    const resize = () => chart.resize();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    observer?.observe(container);
    window.addEventListener('resize', resize);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', resize);
      chart.dispose();
      if (chartRef.current === chart) chartRef.current = null;
    };
  }, [option, reducedMotion, resolved]);

  const chart = (
    <div
      ref={containerRef}
      data-testid="echarts"
      className={className}
      style={{ height, width: '100%' }}
    />
  );
  if (!summary) return chart;
  return (
    <figure className="chart-figure">
      <div role="img" aria-label={summary}>{chart}</div>
      <figcaption className="chart-summary">{summary}</figcaption>
    </figure>
  );
}
