import { Link } from 'react-router-dom';
import { useData } from '../api/useData';
import type { EntitiesData, KeywordsData, Meta, RecentData, SourcesData, TopicsData } from '../types/contracts';
import { DataSection } from '../components/DataSection';
import { Banner, Card, Freshness, HeatBar, SourceTag, StatTile } from '../components/ui';
import { buildHomeSnapshot } from '../lib/home';
import { displayExcerpt } from '../lib/recent';
import { fmtCompact, fmtDateTime, fmtNum, fmtRelative, formatMethodVersion } from '../lib/format';
import { buildDecisionBrief } from '../lib/decisionBrief';
import { DecisionBrief } from '../components/DecisionBrief';

const EMPTY_KEYWORDS: KeywordsData = { keywords: [] };
const EMPTY_TOPICS: TopicsData = { stale: false, experimental: true, topics: [] };
const EMPTY_ENTITIES: EntitiesData = { stale: false, experimental: true, nodes: [], edges: [] };
const EMPTY_RECENT: RecentData = { items: [] };
const EMPTY_SOURCES: SourcesData = { sources: [] };

export function HomePage() {
  const meta = useData<Meta>('meta');
  const keywords = useData<KeywordsData>('keywords');
  const topics = useData<TopicsData>('topics');
  const entities = useData<EntitiesData>('entities');
  const recent = useData<RecentData>('recent');
  const sources = useData<SourcesData>('sources');
  const homeInput = {
    meta: meta.data,
    keywords: keywords.data ?? EMPTY_KEYWORDS,
    topics: topics.data ?? EMPTY_TOPICS,
    entities: entities.data ?? EMPTY_ENTITIES,
    recent: recent.data ?? EMPTY_RECENT,
    sources: sources.data ?? EMPTY_SOURCES,
  };
  const snapshot = buildHomeSnapshot(homeInput);
  const decisionBrief = buildDecisionBrief(
    homeInput,
    meta.envelope?.generatedAt ?? meta.data?.lastFastAt,
    {
      meta: !meta.loading && !meta.error && meta.data !== null,
      keywords: !keywords.loading && !keywords.error && keywords.data !== null,
      topics: !topics.loading && !topics.error && topics.data !== null,
      recent: !recent.loading && !recent.error && recent.data !== null,
      sources: !sources.loading && !sources.error && sources.data !== null,
    },
  );

  return (
    <>
      <DecisionBrief model={decisionBrief} />

      {(meta.data?.stateRestoreFailed || meta.data?.status === 'error') && (
        <Banner variant="serious">
          快照狀態不完整；系統已保留可用資料。完整狀態請見{' '}
          <Link to="/method">數據來源</Link>。
        </Banner>
      )}
      {sources.error && <Banner variant="warning">資料來源暫時無法載入：{sources.error.message}</Banner>}

      <div className="grid cols-4 home-stats" aria-label="資料摘要">
        <StatTile label="啟用來源" value={fmtNum(snapshot.sourceCount)} sub={'正常 ' + snapshot.healthySourceCount + ' 個'} icon="newspaper" />
        <StatTile label="24 小時關鍵字命中量" value={fmtCompact(snapshot.keywordMentionCount24h)} sub="不同關鍵字可能重複計數" icon="message" />
        <StatTile label="最高熱度" value={snapshot.topKeyword ? snapshot.topKeyword.heat.toFixed(0) : '—'} sub={snapshot.topKeyword?.term ?? '等待資料'} icon="flame" />
        <StatTile label="最近更新" value={fmtRelative(snapshot.meta?.lastFastAt ?? null)} sub={formatMethodVersion(snapshot.meta?.methodVersion)} icon="clock" />
      </div>

      <div className="home-section-grid">
        <DataSection title="熱門關鍵字" loading={keywords.loading} error={keywords.error} onRetry={keywords.reload} isEmpty={snapshot.topKeywords.length === 0} emptyTitle="目前沒有熱門關鍵字" emptyDesc="資料更新後會在這裡顯示監測詞與自動熱詞。">
          <Card title="熱門關鍵字" hint="近 24 小時熱度 0–100" right={<Link className="small" to="/keywords">查看全部 →</Link>}>
            <div className="home-keyword-list">
              {snapshot.topKeywords.slice(0, 6).map((keyword, index) => (
                <div className="home-keyword-row" key={keyword.id}>
                  <span className="num muted">{index + 1}</span>
                  <span className={'kind-tag kind-tag--' + keyword.kind}>{keyword.kind === 'manual' ? '監測' : '自動'}</span>
                  <strong>{keyword.term}</strong>
                  <HeatBar heat={keyword.heat} />
                </div>
              ))}
            </div>
          </Card>
        </DataSection>

        <DataSection title="主要事件" loading={topics.loading} error={topics.error} onRetry={topics.reload} isEmpty={snapshot.topTopics.length === 0} emptyTitle="目前沒有主題資料">
          <Card title="主要事件" hint={topics.data?.experimental ? '詞典分析，僅供研究參考' : undefined} right={<Link className="small" to="/topics">查看全部 →</Link>}>
            <div className="home-topic-list">
              {snapshot.topTopics.map((topic) => (
                <Link className="home-topic-row" to="/topics" key={topic.id}>
                  <span><strong>{topic.label}</strong><small>{topic.size} 篇 · {topic.terms.slice(0, 3).join('、')}</small></span>
                  <span className="sentiment-mini" aria-label={'正向 ' + Math.round(topic.sentiment.positive * 100) + '%，中立 ' + Math.round(topic.sentiment.neutral * 100) + '%，負向 ' + Math.round(topic.sentiment.negative * 100) + '%'}>
                    <i style={{ width: topic.sentiment.positive * 100 + '%' }} />
                    <b style={{ width: topic.sentiment.neutral * 100 + '%' }} />
                    <em style={{ width: topic.sentiment.negative * 100 + '%' }} />
                  </span>
                </Link>
              ))}
            </div>
          </Card>
        </DataSection>
      </div>

      <div className="home-section-grid">
        <DataSection title="最新新聞" loading={recent.loading} error={recent.error} onRetry={recent.reload} isEmpty={snapshot.recentItems.length === 0} emptyTitle="目前沒有近期新聞">
          <Card title="最新新聞" hint="點擊標題開啟原文" right={<Link className="small" to="/recent">查看全部 →</Link>}>
            <div className="home-news-list">
              {snapshot.recentItems.map((item) => (
                <a className="home-news-row" href={item.url} target="_blank" rel="noreferrer noopener" key={item.id}>
                  <span><SourceTag id={item.source} /> · {fmtRelative(item.publishedAt)}</span>
                  <strong>{item.title}</strong>
                  <small>{displayExcerpt(item.excerpt)}</small>
                </a>
              ))}
            </div>
          </Card>
        </DataSection>

        <DataSection title="組織" loading={entities.loading} error={entities.error} onRetry={entities.reload} isEmpty={snapshot.topEntities.length === 0} emptyTitle="目前沒有實體資料">
          <Card title="組織" hint="共現不代表支持、反對或因果" right={<Link className="small" to="/entities">查看網絡 →</Link>}>
            <div className="home-entity-list">
              {snapshot.topEntities.map((entity) => (
                <Link className="home-entity-row" to="/entities" key={entity.id}>
                  <span className={'entity-type entity-type--' + entity.type.toLowerCase()}>{entity.type === 'PERSON' ? '人' : '組'}</span>
                  <strong>{entity.name}</strong>
                  <span className="num muted">{entity.mentions} 篇</span>
                </Link>
              ))}
            </div>
          </Card>
        </DataSection>
      </div>

      <Card title="資料涵蓋與方法" hint="先了解資料，再解讀數字">
        <div className="home-method">
          <div>
            <strong>35 個公開新聞來源 · {snapshot.meta?.coverage.archiveDays ?? 7} 天封存</strong>
            <p>首頁摘要與分析頁都會標示資料時間、來源異常及實驗性限制。情緒是可追溯的詞典 baseline，不是模型準確度保證。</p>
          </div>
          <div className="home-method__actions">
            <Freshness at={snapshot.meta?.lastDeepAt ?? null} label="深度分析" />
            <Link className="btn" to="/method">查看數據來源</Link>
          </div>
        </div>
        {snapshot.meta && <p className="small muted">快照產生時間：{fmtDateTime(snapshot.meta.lastFastAt)}</p>}
      </Card>
    </>
  );
}
