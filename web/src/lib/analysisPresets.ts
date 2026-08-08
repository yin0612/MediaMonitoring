import type { SearchRange } from '../types/contracts';

export interface TopicInput {
  name: string;
  query: string;
}

export interface AnalysisPreset {
  id: 'brand-compare' | 'policy-monitor' | 'noise-filter';
  name: string;
  description: string;
  range: SearchRange;
  topics: readonly TopicInput[];
}

export const ANALYSIS_PRESETS = [
  {
    id: 'brand-compare',
    name: '品牌比較',
    description: '比較兩個品牌在相同時間範圍的聲量、來源與情緒。',
    range: '24h',
    topics: [
      { name: '全聯', query: '全聯' },
      { name: '家樂福', query: '家樂福' },
    ],
  },
  {
    id: 'policy-monitor',
    name: '政策監測',
    description: '追蹤同一政策議題的支持、反對與主管機關訊號。',
    range: '7d',
    topics: [
      { name: '政策全貌', query: '政策 OR 法案' },
      { name: '主管機關', query: '政策 AND 部會' },
      { name: '民間回應', query: '政策 AND 民間' },
    ],
  },
  {
    id: 'noise-filter',
    name: '排除雜訊',
    description: '用精準詞與排除詞縮小結果，適合名稱容易混淆的主題。',
    range: '24h',
    topics: [
      { name: '精準議題', query: '"人工智慧" -課程' },
    ],
  },
] as const satisfies readonly AnalysisPreset[];

export function cloneAnalysisPreset(preset: AnalysisPreset): { topics: TopicInput[]; range: SearchRange } {
  return {
    topics: preset.topics.map((topic) => ({ ...topic })),
    range: preset.range,
  };
}
