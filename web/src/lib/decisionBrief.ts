import type { HomeInputs } from './home';
import { getRisingKeywords } from './risingKeywords';

export type DecisionConfidence = 'good' | 'attention' | 'limited';
export type DecisionSignalKind = 'momentum' | 'topic' | 'coverage';

export interface DecisionSignal {
  kind: DecisionSignalKind;
  label: string;
  value: string;
  detail: string;
  to: string;
}

export interface DecisionBriefModel {
  eyebrow: string;
  headline: string;
  summary: string;
  confidence: DecisionConfidence;
  signals: DecisionSignal[];
  primaryAction: { to: string; label: string };
}

export interface DecisionDataAvailability {
  meta: boolean;
  keywords: boolean;
  topics: boolean;
  recent: boolean;
  sources: boolean;
}

const ALL_DATA_AVAILABLE: DecisionDataAvailability = {
  meta: true,
  keywords: true,
  topics: true,
  recent: true,
  sources: true,
};

function sourceCoverage(input: HomeInputs) {
  const enabled = input.sources.sources.filter((source) => source.status !== 'disabled');
  const healthy = enabled.filter((source) => source.status === 'ok' && !source.stale);
  return { enabled: enabled.length, healthy: healthy.length };
}

function confidenceOf(
  input: HomeInputs,
  enabled: number,
  healthy: number,
  requiredDataAvailable: boolean,
): DecisionConfidence {
  const deepDataLimited = input.keywords.stale === true || input.topics.stale || input.meta?.stateRestoreFailed;
  if (!requiredDataAvailable || !input.meta || enabled === 0 || deepDataLimited || input.meta.status === 'stale' || input.meta.status === 'error') {
    return 'limited';
  }
  if (healthy < enabled || input.meta.status === 'partial') return 'attention';
  return 'good';
}

export function buildDecisionBrief(
  input: HomeInputs,
  generatedAt?: string | null,
  availability: DecisionDataAvailability = ALL_DATA_AVAILABLE,
): DecisionBriefModel {
  const keywords = [...input.keywords.keywords].sort((a, b) => b.heat - a.heat);
  const topics = [...input.topics.topics].sort((a, b) => b.size - a.size);
  const activeKeywords = keywords.filter((k) => k.heat > 0 || (k.mentions24h ?? 0) > 0);
  const activeTopics = topics.filter((t) => (t.size ?? 0) > 0);
  const topKeyword = activeKeywords[0] ?? null;
  const topTopic = activeTopics[0] ?? null;
  const coverage = sourceCoverage(input);
  const requiredDataAvailable = Object.values(availability).every(Boolean);
  const confidence = confidenceOf(input, coverage.enabled, coverage.healthy, requiredDataAvailable);

  const referenceTime = generatedAt ?? input.meta?.lastFastAt ?? '';
  const rising = getRisingKeywords(input.recent.items, keywords, referenceTime, 90)[0] ?? null;

  if (!rising && !topKeyword && !topTopic && input.recent.items.length === 0) {
    return {
      eyebrow: '今日決策摘要',
      headline: '等待下一批新聞訊號',
      summary: requiredDataAvailable
        ? '快照更新後，這裡會整理最值得注意的關鍵字、事件與資料涵蓋狀態。'
        : '部分必要資料尚未取得；資料恢復後，這裡會整理優先訊號。',
      confidence: 'limited',
      signals: [],
      primaryAction: { to: '/search', label: '主動搜尋新聞' },
    };
  }

  const deepDataLimited = !requiredDataAvailable || input.keywords.stale === true || input.topics.stale;
  const signals: DecisionSignal[] = [];

  if (topKeyword) {
    signals.push({
      kind: 'momentum',
      label: rising ? '90 分鐘動能' : '最高關鍵字熱度',
      value: rising ? `+${rising.delta} 篇` : `${Math.round(topKeyword.heat)}`,
      detail: rising ? `${rising.term}・共 ${rising.recentMentions} 篇報導` : `${topKeyword.term}・24 小時 ${topKeyword.mentions24h} 篇`,
      to: `/search?q=${encodeURIComponent(rising ? rising.term : topKeyword.term)}`,
    });
  }

  if (topTopic) {
    signals.push({
      kind: 'topic',
      label: '主要事件',
      value: topTopic.label,
      detail: `${topTopic.size} 篇・${topTopic.terms.slice(0, 3).join('、')}`,
      to: '/topics',
    });
  }

  signals.push({
    kind: 'coverage',
    label: '健康來源',
    value: `${coverage.healthy} / ${coverage.enabled}`,
    detail: coverage.enabled === 0
      ? '尚未取得來源狀態'
      : coverage.enabled === coverage.healthy
        ? '目前來源回應正常'
        : `${coverage.enabled - coverage.healthy} 個來源需留意`,
    to: '/method',
  });

  const headline = rising
    ? `「${rising.term}」議題近期聲量升溫`
    : topKeyword
      ? `「${topKeyword.term}」為目前最高熱度關鍵字`
      : topTopic
        ? `「${topTopic.label}」最受新聞關注`
        : '即時新聞動態監測中';

  const baseSummary = rising
    ? `近 90 分鐘共有 ${rising.recentMentions} 篇新聞共同提及「${rising.term}」（較前一時段增加 ${rising.delta} 篇）；目前最大事件為${topTopic?.label ?? '尚待分類'}。`
    : topKeyword
      ? `${topKeyword.term}目前熱度 ${Math.round(topKeyword.heat)}，24 小時命中 ${topKeyword.mentions24h} 篇。`
      : topTopic
        ? `${topTopic.label}目前累積 ${topTopic.size} 篇相關新聞。`
        : '系統正在持續監測 37 家新聞媒體。資料快照更新後，此處將自動呈現最新議題。';

  const activeTerm = rising ? rising.term : topKeyword?.term || '';
  const primaryAction = activeTerm
    ? { to: `/search?q=${encodeURIComponent(activeTerm)}`, label: `即時搜尋「${activeTerm}」新聞` }
    : topTopic
      ? { to: '/topics', label: '查看事件脈絡' }
      : { to: '/search', label: '主動搜尋新聞' };

  return {
    eyebrow: '今日決策摘要',
    headline,
    summary: !requiredDataAvailable
      ? `${baseSummary} 部分必要資料尚未取得，以下訊號僅供方向判讀。`
      : deepDataLimited
        ? `${baseSummary} 深度分析資料延遲，以下訊號僅供方向判讀。`
        : baseSummary,
    confidence,
    signals: signals.slice(0, 3),
    primaryAction,
  };
}
