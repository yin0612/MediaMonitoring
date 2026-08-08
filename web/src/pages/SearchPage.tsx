import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type { EChartsOption } from 'echarts';
import { fetchTrends, searchNews } from '../api/search';
import { Chart } from '../components/Chart';
import { Badge, Banner, Card, EmptyState, LoadingState, SourceTag, StatTile } from '../components/ui';
import { GRID, catAxis, tooltip, valAxis } from '../lib/charts';
import { fmtDateTime, fmtNum, fmtTime } from '../lib/format';
import { useChartTokens } from '../lib/theme';
import { nextRefreshSeconds, REFRESH_INTERVALS, searchArticlesToTrendNews } from '../lib/refresh';
import type { Envelope, SearchData, SearchRange, TrendItem, TrendsData } from '../types/contracts';

const RANGES: { value: SearchRange; label: string }[] = [
  { value: '1h', label: '1 小時' },
  { value: '6h', label: '6 小時' },
  { value: '12h', label: '12 小時' },
  { value: '24h', label: '24 小時' },
  { value: '7d', label: '7 日' },
  { value: '30d', label: '30 日' },
];

export function SearchPage() {
  const [query, setQuery] = useState('');
  const [range, setRange] = useState<SearchRange>('7d');
  const [result, setResult] = useState<Envelope<SearchData> | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [trends, setTrends] = useState<Envelope<TrendsData> | null>(null);
  const [trendsError, setTrendsError] = useState<string | null>(null);
  const [selectedTrend, setSelectedTrend] = useState<TrendItem | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [trendNewsLoading, setTrendNewsLoading] = useState(false);
  const [trendNewsFallback, setTrendNewsFallback] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [countdown, setCountdown] = useState(30);
  const tokens = useChartTokens();

  const loadTrends = useCallback(async () => {
    try {
      setTrends(await fetchTrends());
      setTrendsError(null);
    } catch (error) {
      setTrendsError((error as Error).message);
    }
  }, []);

  useEffect(() => {
    void loadTrends();
    const refresh = () => {
      if (document.visibilityState === 'visible') void loadTrends();
    };
    const timer = window.setInterval(refresh, REFRESH_INTERVALS.trends);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [loadTrends]);

  const runSearch = useCallback(async (term: string, trend: TrendItem | null = null, background = false, targetRange?: SearchRange) => {
    const activeRange = targetRange ?? range;
    const normalized = term.trim();
    if (normalized.length < 2 || normalized.length > 50) {
      setSearchError('請輸入 2 至 50 個字元的關鍵字。');
      return;
    }
    setQuery(normalized);
    setSelectedTrend(trend);
    if (background) setRefreshing(true);
    else setSearching(true);
    setSearchError(null);
    try {
      const response = await searchNews(normalized, activeRange);
      setResult(response);
      setLastUpdatedAt(Date.now());
      return response;
    } catch (error) {
      if (!background) setResult(null);
      setSearchError((error as Error).message);
      return null;
    } finally {
      if (background) setRefreshing(false);
      else setSearching(false);
    }
  }, [range]);

  useEffect(() => {
    if (!result) return undefined;
    const refresh = () => {
      if (document.visibilityState === 'visible' && !searching && !refreshing) {
        void runSearch(result.data.query, selectedTrend, true);
      }
    };
    const timer = window.setInterval(refresh, REFRESH_INTERVALS.search);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [refreshing, result, runSearch, searching, selectedTrend]);

  useEffect(() => {
    if (!lastUpdatedAt) return undefined;
    const tick = () => setCountdown(nextRefreshSeconds(lastUpdatedAt));
    tick();
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
  }, [lastUpdatedAt]);

  function submit(event: FormEvent) {
    event.preventDefault();
    void runSearch(query);
  }

  async function selectTrend(item: TrendItem) {
    setSelectedTrend(item);
    setTrendNewsFallback(false);
    const searchRequest = runSearch(item.title, item);
    if (item.news.length > 0) return;
    setTrendNewsLoading(true);
    try {
      const response = await searchRequest;
      const news = searchArticlesToTrendNews(response?.data.items ?? []);
      setSelectedTrend((current) => current?.title === item.title ? { ...current, news } : current);
      setTrendNewsFallback(true);
    } catch (error) {
      setSearchError(`相關新聞暫時無法載入：${(error as Error).message}`);
    } finally {
      setTrendNewsLoading(false);
    }
  }

  const timelineOption = useMemo<EChartsOption>(() => ({
    color: [tokens.accent],
    tooltip: tooltip(tokens, { trigger: 'axis' }),
    grid: GRID,
    xAxis: {
      type: 'category',
      data: result?.data.timeline.map((point) => fmtTime(point.t)) ?? [],
      ...catAxis(tokens),
    },
    yAxis: { type: 'value', minInterval: 1, ...valAxis(tokens) },
    series: [{
      name: '新聞篇數',
      type: 'line',
      smooth: true,
      showSymbol: false,
      areaStyle: { opacity: 0.14 },
      data: result?.data.timeline.map((point) => point.mentions) ?? [],
    }],
  }), [result, tokens]);

  const sourceOption = useMemo<EChartsOption>(() => {
    const entries = Object.entries(result?.data.sourceCounts ?? {}).sort((a, b) => b[1] - a[1]);
    return {
      color: [tokens.accent],
      tooltip: tooltip(tokens, { trigger: 'axis', axisPointer: { type: 'shadow' } }),
      grid: GRID,
      xAxis: { type: 'value', minInterval: 1, ...valAxis(tokens) },
      yAxis: { type: 'category', data: entries.map(([source]) => source), ...catAxis(tokens) },
      series: [{ type: 'bar', data: entries.map(([, count]) => count), barMaxWidth: 26 }],
    };
  }, [result, tokens]);

  return (
    <div>
      <section className="search-hero">
        <Badge variant="accent">公開新聞資料</Badge>
        <h1>搜尋關鍵字，查看新聞聲量與熱度</h1>
        <p>即時查詢啟用的官方新聞 RSS；Worker 不可用時會改讀 GitHub Pages 最後快照並清楚標示。</p>
        <form className="search-form" onSubmit={submit}>
          <label className="sr-only" htmlFor="news-query">新聞關鍵字</label>
          <input
            id="news-query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="例如：台積電、颱風、立法院"
            minLength={2}
            maxLength={50}
          />
          <select
            value={range}
            onChange={(event) => {
              const nextRange = event.target.value as SearchRange;
              setRange(nextRange);
              if (query.trim().length >= 2) {
                void runSearch(query, selectedTrend, false, nextRange);
              }
            }}
            aria-label="搜尋時間範圍"
          >
            {RANGES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <button className="btn search-submit" type="submit" disabled={searching}>
            {searching ? '搜尋中…' : '搜尋新聞'}
          </button>
        </form>
        {searchError && <p className="form-error" role="alert">{searchError}</p>}
      </section>

      <section className="trends-section" aria-labelledby="trends-title">
        <div className="section-row">
          <div>
            <h2 id="trends-title">台灣 Google 熱門搜尋</h2>
            <p>
              官方 Trending Now RSS 本次提供 {trends?.data.items.length ?? 0} 筆，非完整 Google Trends 圖表；本站每 2 分鐘檢查更新。
              {trends && <> <a href={trends.data.sourceUrl} target="_blank" rel="noreferrer noopener">查看資料源</a></>}
            </p>
          </div>
          {trends && <Badge variant={trends.data.stale ? 'warning' : 'good'} dot>{trends.data.stale ? '快照' : 'RSS 更新'}</Badge>}
        </div>
        {trendsError ? (
          <Banner variant="warning">Google Trends 目前無法載入：{trendsError}</Banner>
        ) : !trends ? (
          <LoadingState label="讀取台灣熱門搜尋…" />
        ) : (
          <div className="trend-chips">
            {trends.data.items.slice(0, 12).map((item) => (
              <button key={`${item.title}-${item.publishedAt}`} type="button" onClick={() => void selectTrend(item)}>
                <strong>{item.title}</strong>
                <span>{item.approximateTraffic || '未提供搜尋量'} · {item.news.length ? `${item.news.length} 則新聞` : '點擊載入新聞'}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {selectedTrend && (
        <section className="trend-detail" aria-labelledby="trend-detail-title">
          <div className="section-row">
            <div>
              <Badge variant="accent">Google Trends 相關內容</Badge>
              <h2 id="trend-detail-title">「{selectedTrend.title}」熱門搜尋資訊</h2>
              <p>約略搜尋量：<strong>{selectedTrend.approximateTraffic || '未提供'}</strong>・開始時間：{fmtDateTime(selectedTrend.publishedAt)}</p>
            </div>
            {trends && <a href={trends.data.sourceUrl} target="_blank" rel="noreferrer noopener">開啟 Google Trends RSS</a>}
          </div>
          <Card title="Google Trends 相關新聞" hint={trendNewsFallback ? 'Trends 未附新聞，已重用 35 家媒體即時搜尋結果；不重複計入熱度' : '由 Google Trends RSS 提供；不納入下方 35 家媒體熱度統計'}>
            {trendNewsLoading ? (
              <LoadingState label="正在即時搜尋相關新聞…" />
            ) : selectedTrend.news.length === 0 ? (
              <EmptyState title="Google Trends 未附相關新聞" desc="仍可查看下方 35 家媒體的關鍵字搜尋結果。" />
            ) : (
              <div className="trend-news-list">
                {selectedTrend.news.map((news) => (
                  <article className="trend-news-item" key={`${news.url}-${news.title}`}>
                    <span>{news.source || '未標示來源'}</span>
                    <h3><a href={news.url} target="_blank" rel="noreferrer noopener">{news.title}</a></h3>
                  </article>
                ))}
              </div>
            )}
          </Card>
        </section>
      )}

      {searching && <LoadingState label="正在比對新聞來源…" />}
      {result && !searching && (
        <section className="search-results" aria-live="polite">
          <div className="section-row">
            <div>
              <h2>「{result.data.query}」分析結果</h2>
              <p>資料產生時間：{fmtDateTime(result.generatedAt)}</p>
            </div>
            <Badge variant={result.data.stale ? 'warning' : result.data.status === 'partial' ? 'serious' : 'good'} dot>
              {result.data.stale ? '最後快照' : result.data.status === 'partial' ? '部分來源異常' : '即時來源'}
            </Badge>
            <button className="btn" type="button" disabled={refreshing} onClick={() => void runSearch(result.data.query, selectedTrend, true)}>
              {refreshing ? '更新中…' : `立即更新（${countdown} 秒）`}
            </button>
          </div>
          {result.data.stale && (
            <Banner variant="warning">目前顯示最後成功快照，不代表此刻完整新聞結果。</Banner>
          )}
          <div className="grid cols-4">
            <StatTile label="新聞熱度" value={result.data.metrics.heat} sub="0–100（新聞限定）" />
            <StatTile label="相關新聞" value={fmtNum(result.data.metrics.mentions)} sub={`範圍：${range}`} />
            <StatTile label="來源數" value={result.data.metrics.sourceCount} sub="去重後獨立來源" />
            <StatTile label="加速度" value={`${Math.round(result.data.metrics.acceleration * 100)}%`} sub="前後半區間比較" />
          </div>
          {result.data.items.length === 0 ? (
            <EmptyState title="這個範圍沒有相符新聞" desc="可換關鍵字、放寬時間，或稍後再試。" />
          ) : (
            <>
              <div className="grid cols-2">
                <Card title="新聞聲量趨勢" hint="依所選時間範圍分桶"><Chart option={timelineOption} height={280} summary="目前查詢的新聞聲量時間趨勢。" /></Card>
                <Card title="來源分布" hint="相符新聞篇數"><Chart option={sourceOption} height={280} summary="目前查詢的相符新聞來源分布。" /></Card>
              </div>
              <Card title="相關新聞" hint="點擊標題開啟原文">
                <div className="news-list">
                  {result.data.items.map((item) => (
                    <article key={item.id} className="news-item">
                      <div className="news-item__meta">
                        <SourceTag id={item.source} />
                        <span>{fmtDateTime(item.publishedAt)}</span>
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
                  ))}
                </div>
              </Card>
            </>
          )}
        </section>
      )}
    </div>
  );
}
