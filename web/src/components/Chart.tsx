import ReactEChartsCore from 'echarts-for-react/lib/core';
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
  /** 無資料時顯示的替代內容。 */
  className?: string;
  /** 提供給不使用 canvas 的讀者與輔助科技的文字摘要。 */
  summary?: string;
}

/** 統一的 ECharts 容器：自動處理主題重繪與 RWD 尺寸。 */
export function Chart({ option, height = 300, className, summary }: Props) {
  const { resolved } = useTheme();
  const reducedMotion = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const chart = (
    <ReactEChartsCore
      echarts={echarts}
      // 主題切換時以 key 強制重新初始化，確保座標軸與文字顏色更新
      key={resolved}
      option={reducedMotion ? { ...option, animation: false } : option}
      notMerge
      lazyUpdate
      style={{ height, width: '100%' }}
      className={className}
      opts={{ renderer: 'canvas' }}
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
