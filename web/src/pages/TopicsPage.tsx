import type { Topic, TopicsData } from '../types/contracts';
import { useData } from '../api/useData';
import { Banner, Card, EmptyState, ErrorState, Freshness, LoadingState, SourceTag } from '../components/ui';
import { fmtRelative } from '../lib/format';
import { sourceShort } from '../lib/sources';
import { PageHeader } from '../components/PageHeader';

function SentimentBar({ s }: { s: Topic['sentiment'] }) {
  const seg = [
    { v: s.positive, c: 'var(--sent-positive)', label: '正向' },
    { v: s.neutral, c: 'var(--sent-neutral)', label: '中立' },
    { v: s.negative, c: 'var(--sent-negative)', label: '負向' },
  ];
  return (
    <div>
      <div style={{ display: 'flex', height: 10, borderRadius: 999, overflow: 'hidden', gap: 2 }}>
        {seg.map((x) => (
          <div key={x.label} style={{ width: `${x.v * 100}%`, background: x.c }} title={`${x.label} ${(x.v * 100).toFixed(0)}%`} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 14, marginTop: 6 }}>
        {seg.map((x) => (
          <span key={x.label} className="small" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span className="dot" style={{ background: x.c }} />
            <span className="muted">{x.label}</span>
            <span className="num" style={{ fontWeight: 600 }}>{(x.v * 100).toFixed(0)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * 正／負向依據：顯示「為什麼被判為這個情緒」——命中的情緒詞 + 可回溯的代表文章。
 * 讓比例數字可以被檢驗，而不是一個無法追問的結論。
 */
function EvidenceBlock({ topic }: { topic: Topic }) {
  const groups = [
    { key: 'positive' as const, label: '正向依據', color: 'var(--sent-positive)', rows: topic.evidence?.positive ?? [] },
    { key: 'negative' as const, label: '負向依據', color: 'var(--sent-negative)', rows: topic.evidence?.negative ?? [] },
  ].filter((group) => group.rows.length > 0);

  if (groups.length === 0) return null;

  return (
    <div className="evidence">
      <div className="card__hint evidence__caption">
        判讀依據：以公開情緒詞典比對標題與短摘要，下列為命中詞與代表文章（可點擊追溯原文）
      </div>
      <div className="evidence__cols">
        {groups.map((group) => (
          <section key={group.key} className="evidence__group">
            <h4 className="evidence__title">
              <span className="dot" style={{ background: group.color }} />
              {group.label}
            </h4>
            <ul className="evidence__list">
              {group.rows.map((row, index) => (
                <li key={index} className="evidence__item">
                  <a href={row.url} target="_blank" rel="noreferrer noopener" className="evidence__link">
                    {row.title}
                  </a>
                  <div className="evidence__terms">
                    <SourceTag id={row.source} />
                    {row.terms.map((term) => (
                      <span key={term} className="evidence__term" style={{ borderColor: group.color }}>
                        {term}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function TopicActivity({ topic }: { topic: Topic }) {
  const timeline = topic.timeline ?? [];
  const max = Math.max(1, ...timeline.map((point) => point.mentions));
  if (timeline.length === 0) return null;
  return (
    <section className="topic-activity" aria-label={`${topic.label}每日聲量`}>
      <div className="card__hint">每日聲量（UTC）</div>
      <div className="topic-activity__bars">
        {timeline.map((point) => (
          <div
            key={point.date}
            className="topic-activity__bar"
            style={{ height: `${Math.max(8, (point.mentions / max) * 48)}px` }}
            title={`${point.date}：${point.mentions} 篇`}
          />
        ))}
      </div>
      <div className="topic-activity__range small muted">
        <span>{timeline[0]?.date}</span>
        <span>{timeline[timeline.length - 1]?.date}</span>
      </div>
    </section>
  );
}

function EventClusters({ topic }: { topic: Topic }) {
  const events = topic.events ?? [];
  if (events.length === 0) return null;
  return (
    <section className="topic-events">
      <div className="card__hint">近期次事件（依日期與主要命中詞切分）</div>
      <div className="topic-events__list">
        {events.map((event) => (
          <article className="topic-event" key={event.id}>
            <div className="topic-event__head">
              <strong>{event.label}</strong>
              <span className="small muted">{event.date} · {event.size} 篇</span>
            </div>
            <div className="topic-event__terms">
              {event.terms.map((term) => <span className="chip" key={term}>{term}</span>)}
            </div>
            {event.articles[0] && (
              <a href={event.articles[0].url} target="_blank" rel="noreferrer noopener">
                {event.articles[0].title}
              </a>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function TopicCard({ topic }: { topic: Topic }) {
  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
        <div>
          <h3 style={{ fontSize: 16 }}>{topic.label}</h3>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {topic.terms.map((t) => (
              <span key={t} className="chip">{t}</span>
            ))}
          </div>
        </div>
        <span className="badge badge--muted num" style={{ flex: 'none' }}>{topic.size} 篇</span>
      </div>

      <div style={{ margin: '14px 0' }}>
        <SentimentBar s={topic.sentiment} />
      </div>

      <EvidenceBlock topic={topic} />
      <TopicActivity topic={topic} />
      <EventClusters topic={topic} />

      <div style={{ marginTop: 14 }}>
        <div className="card__hint" style={{ marginBottom: 6 }}>來源標題或 RSS 短摘要片段（可點擊追溯）</div>
        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {topic.summarySentences.map((s, i) => (
            <li key={i} style={{ fontSize: 13.5 }}>
              {s.text}{' '}
              <a href={s.url} target="_blank" rel="noreferrer noopener" className="small">
                （{sourceShort(s.source)}）
              </a>
            </li>
          ))}
        </ul>
      </div>

      <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        <div className="card__hint" style={{ marginBottom: 6 }}>代表內容</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {topic.articles.map((a, i) => (
            <a
              className="topic-article"
              key={i}
              href={a.url}
              target="_blank"
              rel="noreferrer noopener"
              style={{ color: 'inherit', textDecoration: 'none' }}
            >
              <SourceTag id={a.source} />
              <span className="topic-article__title">
                {a.title}
              </span>
              <span className="small muted topic-article__time">{fmtRelative(a.publishedAt)}</span>
            </a>
          ))}
        </div>
      </div>
    </Card>
  );
}

export function TopicsPage() {
  const t = useData<TopicsData>('topics');

  if (t.error) return (
    <>
      <PageHeader title="主題分類" description="以可檢查的關鍵詞規則將新聞快照分組。文字只取自來源標題或 RSS 短摘要，連結直接對應該筆新聞。" context={{ label: '深度分析更新於', at: t.envelope?.generatedAt ?? null }} />
      <ErrorState error={t.error} onRetry={t.reload} />
    </>
  );

  const topics = t.data?.topics ?? [];

  return (
    <>
      <PageHeader title="主題分類" description="以可檢查的關鍵詞規則將新聞快照分組。文字只取自來源標題或 RSS 短摘要，連結直接對應該筆新聞。" context={{ label: '深度分析更新於', at: t.envelope?.generatedAt ?? null }} />

      {t.data?.experimental && (
        <Banner variant="warning" icon="experiment">
          <strong>實驗性 baseline：</strong>
          主題與次事件為可檢查的關鍵詞規則；情緒為詞典法、非模型判讀，尚未達成 macro-F1 0.70 驗證門檻，僅供研究參考。
        </Banner>
      )}
      {t.data?.stale && (
        <Banner variant="serious">深度分析為過期資料，沿用上次成功結果；即時聲量與熱度仍持續更新。</Banner>
      )}

      {t.loading ? (
        <LoadingState label="載入主題分析中…" />
      ) : topics.length === 0 ? (
        <EmptyState title="尚無主題" desc="累積足夠內容後，深度管線會產生主題聚類與摘要。" icon="archive" />
      ) : (
        <>
          <div style={{ textAlign: 'right', marginBottom: 10 }}>
            <Freshness at={t.envelope?.generatedAt ?? null} label="深度分析更新於" />
          </div>
          <div className="grid cols-2">
            {topics.map((topic) => (
              <TopicCard key={topic.id} topic={topic} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
