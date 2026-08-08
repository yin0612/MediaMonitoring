import type { EntitiesData, KeywordsData, Meta, RecentData, SourcesData, TopicsData } from '../types/contracts';

export interface HomeInputs {
  meta: Meta | null;
  keywords: KeywordsData;
  topics: TopicsData;
  entities: EntitiesData;
  recent: RecentData;
  sources: SourcesData;
}

export interface HomeSnapshot {
  sourceCount: number;
  healthySourceCount: number;
  staleSourceCount: number;
  keywordMentionCount24h: number;
  topKeyword: KeywordsData['keywords'][number] | null;
  topKeywords: KeywordsData['keywords'];
  topTopic: TopicsData['topics'][number] | null;
  topTopics: TopicsData['topics'];
  topEntities: EntitiesData['nodes'];
  recentItems: RecentData['items'];
  meta: Meta | null;
}

export function buildHomeSnapshot(input: HomeInputs): HomeSnapshot {
  const sources = input.sources.sources;
  const keywords = [...input.keywords.keywords].sort((a, b) => b.heat - a.heat);
  const topics = [...input.topics.topics].sort((a, b) => b.size - a.size);
  const entities = [...input.entities.nodes].sort((a, b) => b.mentions - a.mentions);
  const activeKeywords = keywords.filter((k) => k.heat > 0 || (k.mentions24h ?? 0) > 0);
  const activeTopics = topics.filter((t) => (t.size ?? 0) > 0);
  return {
    sourceCount: sources.filter((source) => source.status !== 'disabled').length,
    healthySourceCount: sources.filter((source) => !source.stale && source.status === 'ok').length,
    staleSourceCount: sources.filter((source) => source.stale || source.status !== 'ok').length,
    keywordMentionCount24h: keywords.reduce((sum, keyword) => sum + keyword.mentions24h, 0),
    topKeyword: activeKeywords[0] ?? null,
    topKeywords: keywords.slice(0, 8),
    topTopic: activeTopics[0] ?? null,
    topTopics: topics.slice(0, 4),
    topEntities: entities.slice(0, 6),
    recentItems: input.recent.items.slice(0, 6),
    meta: input.meta,
  };
}
