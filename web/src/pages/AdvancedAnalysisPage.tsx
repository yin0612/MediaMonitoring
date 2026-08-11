import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type { EChartsOption } from 'echarts';
import { searchNews } from '../api/search';
import { Chart } from '../components/Chart';
import { Badge, Banner, Card, EmptyState, LoadingState, SourceTag, StatTile } from '../components/ui';
import { extractTermStats, sentimentLabelOf } from '../lib/analysis';
import { GRID, catAxis, tooltip, valAxis } from '../lib/charts';
import { fmtDateTime, fmtNum, fmtTime } from '../lib/format';
import { REFRESH_INTERVALS } from '../lib/refresh';
import { SOURCE_META } from '../lib/sources';
import { useChartTokens } from '../lib/theme';
import type { Envelope, SearchArticle, SearchData, SearchRange } from '../types/contracts';
import { PageHeader } from '../components/PageHeader';
import { DATA_REFRESH_EVENT } from '../api/refreshCoordinator';
import { AnalysisLauncher } from '../components/AnalysisLauncher';
import type { TopicInput } from '../lib/analysisPresets';
import { analysisExportCsv, downloadText, type AnalysisExport } from '../lib/exportAnalysis';

interface TopicResult extends TopicInput { response?: Envelope<SearchData>; error?: string }
interface SavedAnalysis { name: string; topics: TopicInput[]; range: SearchRange }
const SAVED_ANALYSES_KEY = 'media-monitoring.saved-analyses.v1';

function loadSavedAnalyses(): SavedAnalysis[] {
  try {
    const value = JSON.parse(localStorage.getItem(SAVED_ANALYSES_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

const INITIAL_TOPICS: TopicInput[] = [
  { name: '台積電', query: '台積電' },
  { name: '聯發科', query: '聯發科' },
  { name: '', query: '' },
];
const RANGES: { value: SearchRange; label: string }[] = [
  { value: '1h', label: '1 小時' },
  { value: '6h', label: '6 小時' },
  { value: '12h', label: '12 小時' },
  { value: '24h', label: '24 小時' },
  { value: '7d', label: '7 日' },
  { value: '30d', label: '30 日' },
];
const SERIES_COLORS = ['#3578e5', '#e46d92', '#22a06b'];
const SENTIMENT_LABEL = { positive: '正面', neutral: '中立', negative: '負面' } as const;

export function AdvancedAnalysisPage() {
  const [topics, setTopics] = useState<TopicInput[]>(INITIAL_TOPICS);
  const [range, setRange] = useState<SearchRange>('7d');
  const [results, setResults] = useState<TopicResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [topicFilter, setTopicFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [sentimentFilter, setSentimentFilter] = useState('all');
  const [savedName, setSavedName] = useState('');
  const [savedAnalyses, setSavedAnalyses] = useState<SavedAnalysis[]>(loadSavedAnalyses);
  const tokens = useChartTokens();

  const runAnalysis = useCallback(async (background = false) => {
    const active = topics
      .map((topic) => ({ name: topic.name.trim() || topic.query.trim(), query: topic.query.trim() }))
      .filter((topic) => topic.query);
    if (active.length === 0) { setFormError('請至少設定一個主題。'); return; }
    if (active.some((topic) => topic.query.length < 2 || topic.query.length > 50)) {
      setFormError('每個查詢需為 2 至 50 個字元。'); return;
    }
    if (!background) setLoading(true);
    setFormError(null);
    const settled = await Promise.all(active.map(async (topic): Promise<TopicResult> => {
      try { return { ...topic, response: await searchNews(topic.query, range) }; }
      catch (error) { return { ...topic, error: (error as Error).message }; }
    }));
    setResults(settled);
    setLastUpdatedAt(Date.now());
    setLoading(false);
  }, [range, topics]);

  useEffect(() => {
    if (results.length === 0) return undefined;
    const refresh = () => {
      if (document.visibilityState === 'visible') void runAnalysis(true);
    };
    const onGlobalRefresh = () => {
      void runAnalysis(true);
    };
    const timer = window.setInterval(refresh, REFRESH_INTERVALS.search);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener(DATA_REFRESH_EVENT, onGlobalRefresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener(DATA_REFRESH_EVENT, onGlobalRefresh);
    };
  }, [results.length, runAnalysis]);

  function submit(event: FormEvent) { event.preventDefault(); void runAnalysis(); }
  function updateTopic(index: number, field: keyof TopicInput, value: string) {
    setTopics((current) => current.map((topic, itemIndex) => itemIndex === index ? { ...topic, [field]: value } : topic));
  }
  function applyPreset(presetTopics: TopicInput[], presetRange: SearchRange) {
    const nextTopics = [...presetTopics.map((topic) => ({ ...topic }))];
    while (nextTopics.length < 3) nextTopics.push({ name: '', query: '' });
    setTopics(nextTopics.slice(0, 3));
    setRange(presetRange);
    setResults([]);
    setFormError(null);
    setLastUpdatedAt(null);
    setTopicFilter('all');
    setSourceFilter('all');
    setSentimentFilter('all');
  }

  function saveAnalysis() {
    const name = savedName.trim();
    if (!name) { setFormError('請先輸入分析名稱。'); return; }
    const value = { name, topics, range };
    const next = [...savedAnalyses.filter((item) => item.name !== name), value];
    setSavedAnalyses(next);
    localStorage.setItem(SAVED_ANALYSES_KEY, JSON.stringify(next));
    setSavedName('');
    setFormError(null);
  }

  const successful = results.filter((result) => result.response);
  const articleMap = new Map<string, SearchArticle & { topicNames: string[] }>();
  for (const result of successful) {
    for (const article of result.response?.data.items ?? []) {
      const key = article.url.replace(/[?#].*$/, '') || `${article.source}:${article.id}`;
      const existing = articleMap.get(key);
      if (existing) {
        if (!existing.topicNames.includes(result.name)) existing.topicNames.push(result.name);
      } else {
        articleMap.set(key, { ...article, topicNames: [result.name] });
      }
    }
  }
  const allArticles = [...articleMap.values()];
  const sources = [...new Set(allArticles.map((item) => item.source))];
  const filteredArticles = allArticles.filter((item) => {
    const sentiment = sentimentLabelOf(item.sentiment);
    return (topicFilter === 'all' || item.topicNames.includes(topicFilter))
      && (sourceFilter === 'all' || item.source === sourceFilter)
      && (sentimentFilter === 'all' || sentiment === sentimentFilter);
  });

  const buildExport = (): AnalysisExport => {
    const coverages = successful.map((item) => item.response?.data.coverage).filter(Boolean);
    const generatedValues = successful.map((item) => item.response?.generatedAt || '').sort();
    const actualToValues = coverages
      .map((value) => value?.actualTo)
      .filter((value): value is string => Boolean(value))
      .sort();
    const generatedAt = generatedValues[generatedValues.length - 1] || new Date().toISOString();
    return {
      generatedAt,
      actualWindow: {
        from: coverages.map((value) => value?.actualFrom).filter((value): value is string => Boolean(value)).sort()[0] ?? null,
        to: actualToValues[actualToValues.length - 1] ?? null,
      },
      schemaVersion: successful[0]?.response?.schemaVersion ?? 'unknown',
      methodVersion: 'search-analysis-v2',
      filters: { range, topic: topicFilter, source: sourceFilter, sentiment: sentimentFilter },
      articles: filteredArticles,
    };
  };

  function exportResults(format: 'json' | 'csv') {
    const value = buildExport();
    const stamp = value.generatedAt.slice(0, 10);
    if (format === 'json') downloadText(`media-analysis-${stamp}.json`, `${JSON.stringify(value, null, 2)}\n`, 'application/json');
    else downloadText(`media-analysis-${stamp}.csv`, analysisExportCsv(value), 'text/csv;charset=utf-8');
  }

  const volumeOption = useMemo<EChartsOption>(() => ({
    color: SERIES_COLORS,
    tooltip: tooltip(tokens, { trigger: 'axis', axisPointer: { type: 'shadow' } }),
    grid: GRID,
    xAxis: { type: 'category', data: successful.map((item) => item.name), ...catAxis(tokens) },
    yAxis: { type: 'value', minInterval: 1, ...valAxis(tokens) },
    series: [{ type: 'bar', data: successful.map((item) => item.response?.data.metrics.mentions ?? 0), barMaxWidth: 46 }],
  }), [successful, tokens]);

  const timelineOption = useMemo<EChartsOption>(() => ({
    color: SERIES_COLORS,
    tooltip: tooltip(tokens, { trigger: 'axis' }),
    legend: { data: successful.map((item) => item.name), textStyle: { color: tokens.secondary } },
    grid: { ...GRID, top: 48 },
    xAxis: {
      type: 'category',
      data: successful[0]?.response?.data.timeline.map((point) => fmtTime(point.t)) ?? [],
      ...catAxis(tokens),
    },
    yAxis: { type: 'value', minInterval: 1, ...valAxis(tokens) },
    series: successful.map((item) => ({
      name: item.name, type: 'line', smooth: true, showSymbol: false,
      data: item.response?.data.timeline.map((point) => point.mentions) ?? [],
    })),
  }), [successful, tokens]);

  const sourceOption = useMemo<EChartsOption>(() => {
    const names = [...new Set(successful.flatMap((item) => Object.keys(item.response?.data.sourceCounts ?? {})))];
    return {
      color: SERIES_COLORS,
      tooltip: tooltip(tokens, { trigger: 'axis', axisPointer: { type: 'shadow' } }),
      legend: { data: successful.map((item) => item.name), textStyle: { color: tokens.secondary } },
      grid: { ...GRID, top: 48 },
      xAxis: { type: 'value', minInterval: 1, ...valAxis(tokens) },
      yAxis: { type: 'category', data: names, ...catAxis(tokens) },
      series: successful.map((item) => ({
        name: item.name, type: 'bar', stack: 'source',
        data: names.map((source) => item.response?.data.sourceCounts[source as keyof SearchData['sourceCounts']] ?? 0),
      })),
    };
  }, [successful, tokens]);

  const sentimentOption = useMemo<EChartsOption>(() => ({
    color: ['#22a06b', '#8a9099', '#df4b5f'],
    tooltip: tooltip(tokens, { trigger: 'axis', axisPointer: { type: 'shadow' } }),
    legend: { data: ['正面', '中立', '負面'], textStyle: { color: tokens.secondary } },
    grid: { ...GRID, top: 48 },
    xAxis: { type: 'value', minInterval: 1, ...valAxis(tokens) },
    yAxis: { type: 'category', data: successful.map((item) => item.name), ...catAxis(tokens) },
    series: (['positive', 'neutral', 'negative'] as const).map((sentiment) => ({
      name: SENTIMENT_LABEL[sentiment], type: 'bar', stack: 'sentiment',
      data: successful.map((item) => (item.response?.data.items ?? []).filter((article) =>
        sentimentLabelOf(article.sentiment) === sentiment).length,
      ),
    })),
  }), [successful, tokens]);

  return (
    <div>
      <PageHeader title="進階分析工作台" description="比較最多三個新聞主題；支援 AND、OR、NOT、-排除詞與「雙引號精準詞」。本頁只分析你指定的新聞查詢結果。" />

      <AnalysisLauncher onApply={applyPreset} />

      <Card title="比較主題" hint="只分析指定新聞監測來源">
        <form className="analysis-form" onSubmit={submit}>
          {topics.map((topic, index) => (
            <div className="analysis-topic-row" key={index}>
              <span className="analysis-topic-index" style={{ background: SERIES_COLORS[index] }}>{index + 1}</span>
              <input value={topic.name} onChange={(event) => updateTopic(index, 'name', event.target.value)} placeholder={`主題 ${index + 1} 名稱`} aria-label={`主題 ${index + 1} 名稱`} />
              <input value={topic.query} onChange={(event) => updateTopic(index, 'query', event.target.value)} placeholder={'例如：台積電 AND "法說會" -徵才'} aria-label={`主題 ${index + 1} 查詢`} maxLength={50} />
            </div>
          ))}
          <div className="analysis-actions">
            <select value={range} onChange={(event) => setRange(event.target.value as SearchRange)} aria-label="分析時間範圍">
              {RANGES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <button className="btn search-submit" type="submit" disabled={loading}>{loading ? '分析中…' : '開始分析'}</button>
            <input value={savedName} onChange={(event) => setSavedName(event.target.value)} placeholder="分析名稱" aria-label="分析名稱" />
            <button className="btn" type="button" onClick={saveAnalysis}>儲存查詢</button>
            {savedAnalyses.length > 0 && (
              <select aria-label="載入已儲存分析" defaultValue="" onChange={(event) => {
                const saved = savedAnalyses.find((item) => item.name === event.target.value);
                if (saved) applyPreset(saved.topics, saved.range);
              }}>
                <option value="" disabled>載入已儲存分析</option>
                {savedAnalyses.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
              </select>
            )}
            {lastUpdatedAt && <span className="small muted">最後更新：{fmtDateTime(new Date(lastUpdatedAt).toISOString())}・每 30 秒刷新</span>}
          </div>
        </form>
        {formError && <p className="form-error" role="alert">{formError}</p>}
      </Card>

      {loading && <LoadingState label="正在分析多個新聞主題…" />}
      {!loading && results.some((result) => result.error) && (
        <Banner variant="warning">部分主題無法取得：{results.filter((item) => item.error).map((item) => item.name).join('、')}。其他結果仍可使用。</Banner>
      )}
      {!loading && successful.some((result) => result.response?.data.coverage?.complete === false) && (
        <Banner variant="warning">歷史索引尚未覆蓋完整的所選期間；圖表與匯出只代表回應中標示的實際資料窗。</Banner>
      )}
      {!loading && successful.length > 0 && (
        <div className="analysis-results">
          <div className="grid cols-4">
            <StatTile label="比較主題" value={successful.length} sub="最多 3 組" />
            <StatTile label="新聞總量" value={fmtNum(allArticles.length)} sub={`範圍：${range}`} />
            <StatTile label="獨立來源" value={sources.length} sub="跨主題去重來源" />
            <StatTile label="更新模式" value="30 秒" sub="分頁隱藏時暫停" />
          </div>
          <div className="grid cols-2">
            <Card title="主題聲量比較" hint="相符新聞篇數"><Chart option={volumeOption} height={300} summary="比較各主題相符新聞篇數。" /></Card>
            <Card title="聲量時間軸" hint="各主題依查詢範圍分桶"><Chart option={timelineOption} height={300} summary="顯示各主題在所選時間範圍的新聞聲量變化。" /></Card>
            <Card title="來源分布" hint="各媒體相符新聞數"><Chart option={sourceOption} height={320} summary="比較各新聞來源的相符新聞數。" /></Card>
            <Card title="實驗性情緒比例" hint="標題與短摘要字典判讀，非人工標註"><Chart option={sentimentOption} height={320} summary="顯示各主題的正面、中立與負面詞典判讀比例，非人工標註結果。" /></Card>
          </div>

          <div className="grid cols-3 analysis-terms">
            {successful.map((result) => {
              const items = result.response?.data.items ?? [];
              const timestamps = items.map((item) => Date.parse(item.publishedAt)).filter(Number.isFinite);
              const midpoint = timestamps.length ? (Math.min(...timestamps) + Math.max(...timestamps)) / 2 : Date.now();
              const stats = extractTermStats(items, midpoint, [result.query, result.name]);
              return (
                <Card key={result.name} title={`${result.name} 關聯詞`} hint="TOP 詞頻／近期升溫">
                  <h3 className="analysis-subtitle">熱門關聯詞</h3>
                  <div className="term-cloud">{stats.top.map((term) => <span key={term.term}>{term.term} <b>{term.count}</b></span>)}</div>
                  <h3 className="analysis-subtitle">近期升溫詞</h3>
                  <div className="term-cloud rising">{stats.rising.map((term) => <span key={term.term}>{term.term} <b>+{term.change}</b></span>)}</div>
                </Card>
              );
            })}
          </div>

          <Card title="相關新聞" hint="顯示來源 RSS 時間；點擊標題追溯原文">
            <div className="analysis-filters">
              <select value={topicFilter} onChange={(event) => setTopicFilter(event.target.value)} aria-label="依主題篩選">
                <option value="all">全部主題</option>{successful.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
              </select>
              <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} aria-label="依來源篩選">
                <option value="all">全部來源</option>{sources.map((source) => <option key={source} value={source}>{SOURCE_META[source]?.name ?? source}</option>)}
              </select>
              <select value={sentimentFilter} onChange={(event) => setSentimentFilter(event.target.value)} aria-label="依情緒篩選">
                <option value="all">全部情緒</option><option value="positive">正面</option><option value="neutral">中立</option><option value="negative">負面</option>
              </select>
              <span className="small muted">{filteredArticles.length} 則</span>
              <button className="btn" type="button" onClick={() => exportResults('csv')}>匯出 CSV</button>
              <button className="btn" type="button" onClick={() => exportResults('json')}>匯出 JSON</button>
            </div>
            {filteredArticles.length === 0 ? <EmptyState title="沒有符合篩選條件的新聞" desc="請調整主題、來源或情緒篩選。" /> : (
              <div className="news-list">
                {filteredArticles.map((item, index) => {
                  const sentiment = sentimentLabelOf(item.sentiment);
                  return (
                    <article className="news-item" key={`${item.id}-${index}`}>
                      <div className="news-item__meta">
                        {item.topicNames.map((topicName) => <Badge variant="muted" key={topicName}>{topicName}</Badge>)}<SourceTag id={item.source} />
                        <span>{sentiment ? SENTIMENT_LABEL[sentiment] : '未判讀'}</span><span>{fmtDateTime(item.publishedAt)}</span>
                      </div>
                      <h3><a href={item.url} target="_blank" rel="noreferrer noopener">{item.title}</a></h3>
                      {(() => {
                        const clean = (item.excerpt || '')
                          .replace(/<[^>]+>/g, '')
                          .replace(/https?:\/\/\S+/g, '')
                          .trim();
                        const isValid = clean.length > 0 && !clean.startsWith('<a') && !clean.startsWith('http') && clean !== item.title;
                        return isValid ? <p>{clean}</p> : null;
                      })()}
                    </article>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
