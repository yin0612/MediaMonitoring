import { useMemo, useState } from 'react';
import type { EChartsOption } from 'echarts';
import { useData } from '../api/useData';
import type { Keyword, KeywordsData, KeywordKind } from '../types/contracts';
import { Chart } from '../components/Chart';
import { Card, EmptyState, ErrorState, HeatBar, LoadingState } from '../components/ui';
import { useChartTokens } from '../lib/theme';
import { GRID, catAxis, tooltip, valAxis } from '../lib/charts';
import { fmtNum, fmtPct, fmtTime } from '../lib/format';
import { sourceShort } from '../lib/sources';
import { PageHeader } from '../components/PageHeader';
import { Icon } from '../components/Icon';

type Filter = 'all' | KeywordKind;

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** 將目前篩選後的關鍵字匯出成 CSV（含 BOM，Excel 可正確顯示中文）。 */
function downloadKeywordsCsv(rows: Keyword[]) {
  const header = ['關鍵字', '類型', '熱度', '24小時聲量', 'V_聲量', 'A_加速度', 'D_多樣性', '來源占比'];
  const lines = rows.map((k) => {
    const c = k.components;
    const shares = Object.entries(k.sourceShare)
      .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
      .map(([s, v]) => `${sourceShort(s as never)}:${Math.round((v ?? 0) * 100)}%`)
      .join(' ');
    return [
      k.term,
      k.kind === 'manual' ? '監測' : '自動',
      k.heat.toFixed(1),
      String(k.mentions24h),
      c.volume.toFixed(3),
      c.acceleration.toFixed(3),
      c.diversity.toFixed(3),
      shares,
    ]
      .map(csvCell)
      .join(',');
  });
  const csv = '﻿' + [header.join(','), ...lines].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `keywords-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const COMPONENT_META = [
  { key: 'volume', label: 'V 聲量', desc: '24 小時命中新聞數（log1p）相對當期最大值' },
  { key: 'acceleration', label: 'A 加速度', desc: '近 6 小時相對前 6 小時的成長；0.5 為持平，低聲量時向持平收斂' },
  { key: 'diversity', label: 'D 來源多樣性', desc: '來源分布熵正規化；跨來源者較高' },
] as const;

export function KeywordsPage() {
  const kw = useData<KeywordsData>('keywords');
  const tokens = useChartTokens();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const keywords = kw.data?.keywords ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return keywords.filter((k) => {
      if (filter !== 'all' && k.kind !== filter) return false;
      if (!q) return true;
      const hay = [k.term, ...(k.aliases ?? [])].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [keywords, filter, query]);
  const selected: Keyword | null =
    filtered.find((k) => k.id === selectedId) ?? filtered[0] ?? null;

  if (kw.error) return (
    <>
      <PageHeader title="關鍵字熱度" description="同時追蹤人工監測詞與系統自動熱詞。熱度為 0–100，由新聞聲量、加速度與來源多樣性三個分量加權，所有分量與權重皆公開可重算。" context={{ label: '資料更新於', at: kw.envelope?.generatedAt ?? null }} />
      <ErrorState error={kw.error} onRetry={kw.reload} />
    </>
  );

  // 排行長條圖
  const top = filtered.slice(0, 12);
  const barOption: EChartsOption = {
    tooltip: tooltip(tokens, { trigger: 'axis', axisPointer: { type: 'shadow' } }),
    grid: { ...GRID, left: 8 },
    xAxis: { type: 'value', min: 0, max: 100, ...valAxis(tokens) },
    yAxis: {
      type: 'category',
      inverse: true,
      data: top.map((k) => k.term),
      ...catAxis(tokens),
      axisLabel: { color: tokens.secondary, fontSize: 12 },
    },
    series: [
      {
        type: 'bar',
        data: top.map((k) => ({
          value: k.heat,
          itemStyle: {
            color: k.heat >= 70 ? tokens.negative : k.heat >= 40 ? '#ec835a' : tokens.accent,
            borderRadius: [0, 4, 4, 0],
          },
        })),
        barWidth: '58%',
        label: { show: true, position: 'right', color: tokens.secondary, fontSize: 11, formatter: '{c}' },
      },
    ],
  };

  return (
    <>
      <PageHeader title="關鍵字熱度" description="同時追蹤人工監測詞與系統自動熱詞。熱度為 0–100，由新聞聲量、加速度與來源多樣性三個分量加權，所有分量與權重皆公開可重算。" context={{ label: '資料更新於', at: kw.envelope?.generatedAt ?? null }} />

      {/* 工具列：篩選 + 搜尋 + 匯出 */}
      <div className="toolbar">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {([
            ['all', '全部'],
            ['manual', '人工監測詞'],
            ['auto', '自動熱詞'],
          ] as [Filter, string][]).map(([f, label]) => (
            <button
              key={f}
              className={`segbtn${filter === f ? ' active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {label}
              {f !== 'all' && (
                <span className="num" style={{ opacity: 0.7 }}>
                  {' '}
                  {keywords.filter((k) => k.kind === f).length}
                </span>
              )}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            className="search"
            type="search"
            placeholder="搜尋關鍵字或別名…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="搜尋關鍵字"
          />
          <button
            className="btn"
            onClick={() => downloadKeywordsCsv(filtered)}
            disabled={filtered.length === 0}
            title="匯出目前篩選結果為 CSV"
          >
            <Icon name="download" size={17} /> 匯出 CSV
          </button>
        </div>
      </div>

      {kw.loading ? (
        <LoadingState />
      ) : filtered.length === 0 ? (
        <EmptyState title="找不到符合的關鍵字" desc="試著調整搜尋文字或篩選條件。" icon="search" />
      ) : (
        <div className="grid cols-2">
          <Card title="熱度排行" hint={`共 ${filtered.length} 個關鍵字`}>
            <Chart option={barOption} height={Math.max(280, top.length * 30)} summary="依熱度排序的關鍵字長條圖，熱度範圍為 0 到 100。" />
          </Card>

          {selected && (
            <Card
              title={
                (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span className={`kind-tag kind-tag--${selected.kind}`}>
                      {selected.kind === 'manual' ? '監測' : '自動'}
                    </span>
                    {selected.term}
                  </span>
                ) as never
              }
              hint={selected.aliases?.length ? `別名：${selected.aliases.join('、')}` : '公式分解'}
            >
              <KeywordDetail keyword={selected} />
            </Card>
          )}
        </div>
      )}

      {/* 完整表格 */}
      {!kw.loading && filtered.length > 0 && (
        <Card title="關鍵字明細" hint="點選任一列查看公式分解" >
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>關鍵字</th>
                  <th>類型</th>
                  <th className="num">熱度</th>
                  <th style={{ width: 140 }}>熱度條</th>
                  <th className="num">24 小時聲量</th>
                  <th>主要來源</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((k) => (
                  <tr
                    key={k.id}
                    onClick={() => setSelectedId(k.id)}
                    style={{
                      cursor: 'pointer',
                      background: selected?.id === k.id ? 'var(--accent-weak)' : undefined,
                    }}
                  >
                    <td style={{ fontWeight: 600 }}>{k.term}</td>
                    <td>
                      <span className={`kind-tag kind-tag--${k.kind}`}>
                        {k.kind === 'manual' ? '監測' : '自動'}
                      </span>
                    </td>
                    <td className="num" style={{ fontWeight: 650 }}>{k.heat.toFixed(0)}</td>
                    <td><HeatBar heat={k.heat} /></td>
                    <td className="num">{fmtNum(k.mentions24h)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {Object.entries(k.sourceShare)
                          .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
                          .slice(0, 2)
                          .map(([s, share]) => (
                            <span key={s} className="small muted">
                              {sourceShort(s as never)} {fmtPct(share ?? 0, 0)}
                            </span>
                          ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

function KeywordDetail({ keyword }: { keyword: Keyword }) {
  const tokens = useChartTokens();
  const c = keyword.components;

  const trendOption: EChartsOption = {
    tooltip: tooltip(tokens, { trigger: 'axis' }),
    grid: { ...GRID, top: 16 },
    xAxis: {
      type: 'category',
      data: keyword.trend.map((p) => fmtTime(p.t)),
      ...catAxis(tokens),
      axisLabel: { color: tokens.muted, fontSize: 10, interval: 3 },
    },
    yAxis: { type: 'value', min: 0, max: 100, ...valAxis(tokens) },
    series: [
      {
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: keyword.trend.map((p) => p.heat),
        lineStyle: { width: 2, color: tokens.accent },
        areaStyle: { color: tokens.accent, opacity: 0.14 },
      },
    ],
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8 }}>
        <span className="stat__value num" style={{ fontSize: 30 }}>{keyword.heat.toFixed(0)}</span>
        <span className="muted small">目前熱度 / 100</span>
      </div>
      <Chart option={trendOption} height={140} summary="所選關鍵字的熱度與聲量時間趨勢。" />

      <div style={{ marginTop: 14 }}>
        <div className="card__hint" style={{ marginBottom: 8 }}>
          NewsHeat = 100 × (0.50·V + 0.33·A + 0.17·D)
        </div>
        {COMPONENT_META.map((m) => {
          const val = c[m.key as keyof typeof c] as number;
          const weight = c.weights[m.key as keyof typeof c.weights];
          return (
            <div key={m.key} style={{ marginBottom: 10 }} title={m.desc}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 3 }}>
                <span style={{ color: 'var(--text-secondary)' }}>{m.label}</span>
                <span className="num muted">
                  {val.toFixed(2)} × 權重 {weight.toFixed(2)}
                </span>
              </div>
              <div className="heatbar">
                <div
                  className="heatbar__fill"
                  style={{
                    width: `${val * 100}%`,
                    background: 'var(--accent)',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
