import { Link } from 'react-router-dom';
import { useData } from '../api/useData';
import { Card, EmptyState, ErrorState, Freshness, LoadingState, SourceTag } from '../components/ui';
import { fmtRelative } from '../lib/format';
import { displayExcerpt, getRecentItems } from '../lib/recent';
import type { RecentData } from '../types/contracts';
import { PageHeader } from '../components/PageHeader';

export function RecentPage() {
  const recent = useData<RecentData>('recent');

  if (recent.error) return (
    <>
      <PageHeader title="近期新聞" description="集中查看最新新聞快照；每則僅保留來源、短摘要與原文連結，點擊標題即可追溯。" context={{ label: '快照更新於', at: recent.envelope?.generatedAt ?? null }} />
      <ErrorState error={recent.error} onRetry={recent.reload} />
    </>
  );

  const items = getRecentItems(recent.data?.items ?? []);

  return (
    <>
      <PageHeader title="近期新聞" description="集中查看最新新聞快照；每則僅保留來源、短摘要與原文連結，點擊標題即可追溯。" context={{ label: '快照更新於', at: recent.envelope?.generatedAt ?? null }} />

      <Card
        title="近期內容"
        hint={`${items.length} 則新聞・來源快照`}
        right={<Freshness at={recent.envelope?.generatedAt ?? null} />}
      >
        {recent.loading ? (
          <LoadingState label="載入近期新聞中…" />
        ) : items.length === 0 ? (
          <EmptyState title="目前沒有近期新聞" desc="資料更新後會在此顯示最新來源快照。" />
        ) : (
          <div className="recent-list">
            {items.map((item) => (
              <a
                className="recent-item"
                key={item.id}
                href={item.url}
                target="_blank"
                rel="noreferrer noopener"
              >
                <div className="recent-item__meta">
                  <SourceTag id={item.source} />
                  <span className="small muted">{fmtRelative(item.publishedAt)}</span>
                </div>
                <h2>{item.title}</h2>
                <p className={!item.excerpt.trim() ? 'recent-item__excerpt--missing' : undefined}>
                  {displayExcerpt(item.excerpt)}
                </p>
              </a>
            ))}
          </div>
        )}
      </Card>

      <p className="page-footnote">
        想查看關鍵詞與主題分析？<Link to="/analysis">回到進階分析工作台 →</Link>
      </p>
    </>
  );
}
