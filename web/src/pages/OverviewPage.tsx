import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { EChartsOption } from 'echarts';
import { useData } from '../api/useData';
import type { KeywordsData, Meta, RecentData, SourcesData } from '../types/contracts';
import { Chart } from '../components/Chart';
import {
  Banner,
  Card,
  ErrorState,
  Freshness,
  HeatBar,
  LoadingState,
  SkeletonCards,
  SourceTag,
  StatTile,
} from '../components/ui';
import { useChartTokens } from '../lib/theme';
import { GRID, catAxis, sparkline, tooltip, valAxis } from '../lib/charts';
import { fmtCompact, fmtNum, fmtRelative, fmtTime } from '../lib/format';
import { sourceShort, sourceColorValue } from '../lib/sources';
import { displayExcerpt, getRecentItems } from '../lib/recent';
import { getRisingKeywords } from '../lib/risingKeywords';
import type { SourceId } from '../types/contracts';
import { PageHeader } from '../components/PageHeader';

export function OverviewPage() {
  const meta = useData<Meta>('meta');
  const kw = useData<KeywordsData>('keywords');
  const sources = useData<SourcesData>('sources');
  const recent = useData<RecentData>('recent');
  const tokens = useChartTokens();
  // 趨勢時間範圍（點數；每點 1 小時）：6=6h、12=12h、24=24h
  const [rangePoints, setRangePoints] = useState(24);

  const err = kw.error || meta.error;
  if (err) return (
    <>
      <PageHeader title="資料總覽" description="即時關鍵字熱度、聲量與來源分布的完整視圖。資料由公開來源產生靜態快照，更新採 best effort，不保證固定間隔。" context={{ label: '快照更新於', at: meta.envelope?.generatedAt ?? null }} />
      <ErrorState error={err} onRetry={() => { kw.reload(); meta.reload(); }} />
    </>
  );

  const keywords = kw.data?.keywords ?? [];
  const staleSources = (sources.data?.sources ?? []).filter((s) => s.stale);
  const topN = keywords.slice(0, 5);

  const totalMentions = keywords.reduce((a, k) => a + k.mentions24h, 0);
  const hottest = keywords[0];
  const recentItems = getRecentItems(recent.data?.items ?? [], 7);
  const risingKeywords = getRisingKeywords(keywords);

  // 熱度趨勢（前 5 詞多線）；依所選時間範圍取尾段
  const sliceTail = <T,>(arr: T[]) => arr.slice(-rangePoints);
  const labelInterval = rangePoints <= 6 ? 0 : rangePoints <= 12 ? 1 : 2;
  const trendOption: EChartsOption = {
    color: tokens.series,
    tooltip: tooltip(tokens, { trigger: 'axis' }),
    legend: {
      top: 0,
      textStyle: { color: tokens.secondary, fontSize: 12 },
      icon: 'roundRect',
      itemWidth: 12,
      itemHeight: 4,
    },
    grid: { ...GRID, top: 40 },
    xAxis: {
      type: 'category',
      data: sliceTail(topN[0]?.trend ?? []).map((p) => fmtTime(p.t)),
      ...catAxis(tokens),
      axisLabel: { color: tokens.muted, fontSize: 11, interval: labelInterval },
    },
    yAxis: { type: 'value', min: 0, max: 100, ...valAxis(tokens) },
    series: topN.map((k) => ({
      name: k.term,
      type: 'line',
      smooth: true,
      showSymbol: false,
      lineStyle: { width: 2 },
      data: sliceTail(k.trend).map((p) => p.heat),
    })),
  };

  const RANGES: [number, string][] = [
    [6, '6 小時'],
    [12, '12 小時'],
    [24, '24 小時'],
  ];

  // 來源聲量占比（近 24 小時，跨所有關鍵字加總）；只列前 10 名，其餘併入「其他」
  const srcAgg: Record<string, number> = {};
  keywords.forEach((k) =>
    Object.entries(k.sourceShare).forEach(([s, share]) => {
      srcAgg[s] = (srcAgg[s] ?? 0) + (share ?? 0) * k.mentions24h;
    }),
  );
  const srcRanked = Object.entries(srcAgg)
    .map(([s, v]) => ({
      name: sourceShort(s as SourceId),
      value: Math.round(v),
      itemStyle: { color: sourceColorValue(s as SourceId, tokens) },
    }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value);
  const othersValue = srcRanked.slice(10).reduce((a, d) => a + d.value, 0);
  const srcData = [
    ...srcRanked.slice(0, 10),
    ...(othersValue > 0 ? [{ name: '其他', value: othersValue, itemStyle: { color: tokens.muted } }] : []),
  ];
  const donutOption: EChartsOption = {
    tooltip: tooltip(tokens, { trigger: 'item', formatter: '{b}：{c}（{d}%）' }),
    legend: {
      type: 'scroll',
      bottom: 0,
      textStyle: { color: tokens.secondary, fontSize: 12 },
      icon: 'circle',
      pageIconColor: tokens.secondary,
      pageTextStyle: { color: tokens.muted },
    },
    series: [
      {
        type: 'pie',
        radius: ['50%', '72%'],
        center: ['50%', '42%'],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: tokens.surface, borderWidth: 2 },
        label: { show: false },
        data: srcData,
      },
    ],
  };

  return (
    <>
      <PageHeader title="資料總覽" description="即時關鍵字熱度、聲量與來源分布的完整視圖。資料由公開來源產生靜態快照，更新採 best effort，不保證固定間隔。" context={{ label: '快照更新於', at: meta.envelope?.generatedAt ?? null }} />

      <Banner variant="info" icon="experiment">
        此頁呈現公開新聞快照；資料更新狀態與來源限制請以「數據來源」頁為準。
      </Banner>

      {staleSources.length > 0 && (
        <Banner variant="warning">
          有 {staleSources.length} 個來源資料過期（{staleSources.map((s) => sourceShort(s.id)).join('、')}）。
          系統沿用上次成功資料並標示，其他來源不受影響。詳見{' '}
          <Link to="/method">數據來源</Link>。
        </Banner>
      )}

      {/* Stat tiles */}
      {kw.loading || meta.loading ? (
        <SkeletonCards count={4} />
      ) : (
        <div className="grid cols-4">
          <StatTile
            label="追蹤關鍵字"
            value={fmtNum(keywords.length)}
            sub={`${keywords.filter((k) => k.kind === 'manual').length} 監測詞 · ${keywords.filter((k) => k.kind === 'auto').length} 自動熱詞`}
            icon="flame"
          />
          <StatTile
            label="最高熱度"
            value={hottest ? hottest.heat.toFixed(0) : '—'}
            sub={hottest ? hottest.term : undefined}
            icon="trendUp"
          />
          <StatTile
            label="24 小時總聲量"
            value={fmtCompact(totalMentions)}
            sub="所有關鍵字命中新聞數合計"
            icon="message"
          />
          <StatTile
            label="快管線更新"
            value={fmtRelative(meta.data?.lastFastAt ?? null)}
            sub={`深度分析 ${fmtRelative(meta.data?.lastDeepAt ?? null)}`}
            icon="clock"
          />
        </div>
      )}

      {/* Trend + sources */}
      <div className="grid wide-left" style={{ marginTop: 16 }}>
        <Card
          title="熱度趨勢（前 5 名）"
          hint="每小時一點 · 0–100"
          right={
            <div style={{ display: 'flex', gap: 4 }}>
              {RANGES.map(([pts, label]) => (
                <button
                  key={pts}
                  className={`segbtn${rangePoints === pts ? ' active' : ''}`}
                  style={{ padding: '3px 10px', fontSize: 12.5 }}
                  onClick={() => setRangePoints(pts)}
                >
                  {label}
                </button>
              ))}
            </div>
          }
        >
          {kw.loading ? <LoadingState /> : <Chart option={trendOption} height={300} summary="前五名關鍵字在所選時間範圍的熱度趨勢。" />}
        </Card>
        <Card title="來源聲量占比" hint="近 24 小時命中新聞">
          {kw.loading ? <LoadingState /> : <Chart option={donutOption} height={300} summary="近 24 小時關鍵字命中量的新聞來源占比。" />}
        </Card>
      </div>

      {/* Hot list + recent */}
      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <div className="overview-hot-stack">
          <Card
            title="即時熱詞排行"
            right={<Link to="/keywords" className="small">查看全部 →</Link>}
          >
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {keywords.slice(0, 8).map((k, i) => (
                <div className="overview-hot-row" key={k.id} style={{ borderBottom: i < 7 ? '1px solid var(--border)' : 'none' }}>
                  <span className="num muted" style={{ fontSize: 13 }}>{i + 1}</span>
                  <span className="overview-hot-term">
                    <span className={`kind-tag kind-tag--${k.kind}`}>
                      {k.kind === 'manual' ? '監測' : '自動'}
                    </span>
                    <span className="overview-hot-term__name">{k.term}</span>
                  </span>
                  <span className="overview-hot-sparkline">
                    <Chart
                      option={sparkline(k.trend.map((p) => p.heat), tokens.series[i % tokens.series.length])}
                      height={26}
                      summary={k.term + ' 的近 24 小時熱度趨勢。'}
                    />
                  </span>
                  <span className="overview-hot-heat"><HeatBar heat={k.heat} /></span>
                </div>
              ))}
            </div>
          </Card>

          <Card title="近期升溫關鍵字" hint="最近 1 小時 vs 前 7 日同時段 median/MAD；至少 5 篇、3 家來源">
            {recent.loading ? <LoadingState label="分析近期新聞中…" /> : recent.error ? (
              <div className="state state--compact">近期新聞暫時無法載入，升溫分析稍後再試。</div>
            ) : risingKeywords.length === 0 ? (
              <div className="state state--compact">目前沒有明顯升溫詞</div>
            ) : (
              <div className="rising-keyword-list">
                {risingKeywords.map((item) => (
                  <div className="rising-keyword-row" key={item.term}>
                    <strong>{item.term}</strong>
                    <span className="rising-keyword-count">當期 {item.currentMentions} 篇／{item.sourceCount} 家</span>
                    <span className="rising-keyword-delta">基線中位 {item.baselineMedian}</span>
                    <span className="rising-keyword-percent">burst {item.burstScore.toFixed(1)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <Card
          title="近期內容"
          hint="點擊開啟原文"
          right={
            <span>
              <Freshness at={recent.envelope?.generatedAt ?? null} />
              <Link to="/recent" className="small">查看全部 →</Link>
            </span>
          }
        >
          {recent.loading ? (
            <LoadingState />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {recentItems.map((it) => (
                <a
                  className="recent-preview-item"
                  key={it.id}
                  href={it.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  style={{
                    display: 'block',
                    padding: '9px 0',
                    borderBottom: '1px solid var(--border)',
                    color: 'inherit',
                    textDecoration: 'none',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <SourceTag id={it.source} />
                    <span className="small muted">· {fmtRelative(it.publishedAt)}</span>
                  </div>
                  <div className="recent-preview-item__title">{it.title}</div>
                  <div className={`small muted recent-preview-item__excerpt${it.excerpt.trim() ? '' : ' recent-item__excerpt--missing'}`}>
                    {displayExcerpt(it.excerpt)}
                  </div>
                </a>
              ))}
            </div>
          )}
        </Card>
      </div>

    </>
  );
}
