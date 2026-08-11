import { useData } from '../api/useData';
import type { Meta, SourcesData } from '../types/contracts';
import { Banner, Card, ErrorState, LoadingState, StatusBadge } from '../components/ui';
import { fmtDateTime, fmtRelative } from '../lib/format';
import { sourceModeLabel } from '../lib/sources';
import { PageHeader } from '../components/PageHeader';
import { Icon, type IconName } from '../components/Icon';

export function MethodPage() {
  const meta = useData<Meta>('meta');
  const sources = useData<SourcesData>('sources');

  if (meta.error) return (
    <>
      <PageHeader title="數據來源" description="資料來源、使用邊界、更新時間、分析版本與研究限制。所有指標都能回到來源與方法，維持可追溯與可重算。" context={{ label: '快照產生於', at: meta.envelope?.generatedAt ?? null }} />
      <ErrorState error={meta.error} onRetry={meta.reload} />
    </>
  );

  const m = meta.data;
  const srcs = sources.data?.sources ?? [];

  return (
    <>
      <PageHeader title="數據來源" description="資料來源、使用邊界、更新時間、分析版本與研究限制。所有指標都能回到來源與方法，維持可追溯與可重算。" context={{ label: '快照產生於', at: meta.envelope?.generatedAt ?? null }} />

      <nav className="method-toc" aria-label="方法頁章節">
        <a href="#status">更新狀態</a>
        <a href="#sources">資料來源</a>
        <a href="#formula">指標公式</a>
        <a href="#glossary">詞彙與 FAQ</a>
        <a href="#limits">限制與邊界</a>
      </nav>

      {m && m.scheduleDaysUntilPause !== null && m.scheduleDaysUntilPause < 60 && (
        <Banner variant="warning" icon="clock">
          <strong>排程健康提醒：</strong>公開 repository 若連續 60 天沒有活動，GitHub 會自動停用排程工作。
          估計約 <strong className="num">{m.scheduleDaysUntilPause}</strong> 天後可能停用，請定期確認 Actions 排程仍啟用。
        </Banner>
      )}
      {m?.stateRestoreFailed && (
        <Banner variant="serious">無法還原上一版公開快照，歷史資料可能不完整（stateRestoreFailed）。</Banner>
      )}
      {sources.error && <Banner variant="warning">資料來源狀態暫時無法載入：{sources.error.message}</Banner>}

      {/* 更新狀態 */}
      <div id="status" className="method-anchor" />
      <Card title="更新狀態">
        {meta.loading ? (
          <LoadingState />
        ) : (
          <div className="grid cols-2" style={{ gap: 14 }}>
            <TimeStat label="快管線（聲量／熱度）" at={m?.lastFastAt ?? null} />
            <TimeStat label="深度分析（情緒／主題／關係）" at={m?.lastDeepAt ?? null} />
          </div>
        )}
        {m && (
          <div className="small muted" style={{ marginTop: 14, display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            <span>方法版本：<strong>{m.methodVersion}</strong></span>
            <span>統計視窗：關鍵字 {m.coverage.keywordWindowHours} 小時 · 趨勢每 {m.coverage.trendBucketMinutes} 分鐘一點 · {m.coverage.complete === false ? '實際資料窗未滿 30 日' : `快照保留 ${m.coverage.archiveDays} 天`}</span>
          </div>
        )}
      </Card>

      {/* 來源健康 */}
      <div style={{ marginTop: 16 }}>
        <div id="sources" className="method-anchor" />
        <Card title="資料來源狀態" hint="任一來源失敗不會阻擋其他來源發布；失敗者標示過期並沿用上次成功資料">
          {sources.loading ? (
            <LoadingState />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>來源</th>
                    <th>狀態</th>
                    <th>取得方式</th>
                    <th>最後嘗試</th>
                    <th>最後成功</th>
                    <th className="num">項目數</th>
                    <th>最新文章</th>
                    <th>摘要率</th>
                    <th>Fallback</th>
                    <th>品質</th>
                    <th>錯誤碼</th>
                  </tr>
                </thead>
                <tbody>
                  {srcs.map((s) => (
                    <tr key={s.id}>
                      <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{s.displayName}</td>
                      <td><StatusBadge status={s.status} /></td>
                      <td className="small" style={{ whiteSpace: 'nowrap' }}>{sourceModeLabel(s.accessMode)}</td>
                      <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{s.lastAttemptAt ? fmtRelative(s.lastAttemptAt) : '—'}</td>
                      <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{s.lastSuccessAt ? fmtRelative(s.lastSuccessAt) : '—'}</td>
                      <td className="num">{s.itemCount}</td>
                      <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{s.newestItemAt ? fmtRelative(s.newestItemAt) : '—'}</td>
                      <td className="num">{s.excerptRate === undefined ? '—' : `${Math.round(s.excerptRate * 100)}%`}</td>
                      <td>{s.fallbackUsed === undefined ? '—' : s.fallbackUsed ? '是' : '否'}</td>
                      <td className="num">{s.qualityScore === undefined ? '—' : Math.round(s.qualityScore * 100)}</td>
                      <td className="small">
                        {s.errorCode ? <code>{s.errorCode}</code> : '—'}
                        {s.dropped && Object.keys(s.dropped).length > 0 && (
                          <span className="muted" style={{ marginLeft: 6 }}>
                            （捨棄 {Object.entries(s.dropped).map(([k, v]) => `${k}×${v}`).join('、')}）
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* 熱度公式 */}
      <div style={{ marginTop: 16 }}>
        <div id="formula" className="method-anchor" />
        <Card title="熱度計算方法">
          <p className="small" style={{ marginTop: 0 }}>每次快照（約每 {m?.coverage.deepScheduleMinutes ?? 15} 分鐘，best effort）由近 24 小時新聞重算，固定落在 0–100：</p>
          <div
            style={{
              background: 'var(--page)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '10px 14px',
              fontFamily: 'ui-monospace, monospace',
              fontSize: 13.5,
              margin: '4px 0 12px',
            }}
          >
            NewsHeat = 100 × (0.50·V + 0.33·A + 0.17·D)
          </div>
          <ul className="small" style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 5 }}>
            <li><strong>V 聲量</strong>：近 24 小時命中新聞數取 log1p 後，除以當期關鍵字最大值。</li>
            <li><strong>A 加速度</strong>：近 6 小時相對前 6 小時的成長；0.5 代表持平，低聲量時向持平收斂。</li>
            <li><strong>D 來源多樣性</strong>：來源分布熵除以 ln(啟用來源數)；只有單一來源時為 0。</li>
          </ul>
        </Card>
      </div>

      <div id="glossary" className="method-anchor" />
      <div style={{ marginTop: 16 }}>
        <Card title="詞彙與常見問題">
          <dl className="method-glossary">
            <div><dt>熱度</dt><dd>以近 24 小時聲量、近 6 小時加速度與來源多樣性加權的 0–100 指標，不是搜尋量或民意比例。</dd></div>
            <div><dt>聲量</dt><dd>符合關鍵字或查詢條件的去重新聞篇數；首頁關鍵字摘要的總和可能因不同關鍵字而重複計數。</dd></div>
            <div><dt>深度分析</dt><dd>由逐篇新聞產生主題、情緒依據與人物／組織共現的管線，可能比快管線晚。</dd></div>
            <div><dt>為什麼資料不是即時？</dt><dd>來源 RSS、擷取、GitHub Actions、Pages 與 Worker 都有延遲，更新只保證 best effort。</dd></div>
            <div><dt>情緒能代表民意嗎？</dt><dd>不能。情緒是可追溯詞典 baseline，未達 macro-F1 0.70 前只供研究參考。</dd></div>
          </dl>
        </Card>
      </div>

      <div id="limits" className="method-anchor" />
      <div style={{ marginTop: 16 }}>
        <Card title="研究限制與資料邊界">
          <div className="grid cols-2" style={{ gap: 12 }}>
            {LIMITS.map((l) => (
              <div key={l.title} style={{ display: 'flex', gap: 10 }}>
                <span className="method-limit__icon"><Icon name={l.icon} size={20} /></span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{l.title}</div>
                  <div className="small muted">{l.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <p className="small muted" style={{ marginTop: 20, textAlign: 'center' }}>
        本快照產生時間：{fmtDateTime(meta.envelope?.generatedAt ?? null)} · 更新採 best effort，不宣稱固定間隔 SLA。
      </p>
    </>
  );
}

function TimeStat({ label, at }: { label: string; at: string | null }) {
  return (
    <div style={{ borderLeft: '3px solid var(--accent)', paddingLeft: 12 }}>
      <div className="small muted">{label}</div>
      <div style={{ fontWeight: 650, fontSize: 15 }}>{fmtRelative(at)}</div>
      <div className="small muted num">{fmtDateTime(at)}</div>
    </div>
  );
}

const LIMITS: { icon: IconName; title: string; desc: string }[] = [
  { icon: 'shield', title: '不代表整體民意', desc: '樣本來自特定公開來源，僅為研究指標，不能推論台灣整體民意。' },
  { icon: 'network', title: '共現不代表關係', desc: '人物／組織共現只表示一起被提到，不代表支持、敵對或因果。' },
  { icon: 'newspaper', title: '來源涵蓋有限', desc: '結果只涵蓋已啟用且成功回應的新聞來源，不等於全網新聞。' },
  { icon: 'clock', title: '排程為 best effort', desc: 'GitHub Actions 排程與 Pages 部署盡力而為，不保證 5 分鐘內完成。' },
  { icon: 'refresh', title: 'RSS 更新有延遲', desc: '來源發布與 RSS 更新時間不同，排程亦採 best effort。' },
  { icon: 'experiment', title: '模型為實驗性', desc: '情緒與 NER 未達 F1 0.70 前標示實驗性，摘要採可追溯的抽取式。' },
  { icon: 'shield', title: '不公開敏感內容', desc: '不重製新聞全文；快照與 log 不含任何 token 或憑證。' },
];
