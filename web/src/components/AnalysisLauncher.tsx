import type { SearchRange } from '../types/contracts';
import {
  ANALYSIS_PRESETS,
  cloneAnalysisPreset,
  type TopicInput,
} from '../lib/analysisPresets';
import { Icon, type IconName } from './Icon';

const PRESET_ICONS: Record<(typeof ANALYSIS_PRESETS)[number]['id'], IconName> = {
  'brand-compare': 'scale',
  'policy-monitor': 'compass',
  'noise-filter': 'search',
};

const SYNTAX = [
  { token: 'AND', detail: '同時包含' },
  { token: 'OR', detail: '任一詞即可' },
  { token: 'NOT', detail: '排除後一詞' },
  { token: '-排除詞', detail: '快速排除' },
  { token: '"精準詞"', detail: '完整詞組' },
] as const;

export function AnalysisLauncher({
  onApply,
}: {
  onApply: (topics: TopicInput[], range: SearchRange) => void;
}) {
  return (
    <section className="analysis-launcher" aria-labelledby="analysis-launcher-title">
      <div className="analysis-launcher__heading">
        <div>
          <span className="eyebrow">快速開始</span>
          <h2 id="analysis-launcher-title">選擇分析情境</h2>
        </div>
        <p>套用只會填入表單，不會立即送出查詢。</p>
      </div>

      <div className="analysis-presets">
        {ANALYSIS_PRESETS.map((preset) => (
          <button
            className="analysis-preset"
            type="button"
            key={preset.id}
            onClick={() => {
              const cloned = cloneAnalysisPreset(preset);
              onApply(cloned.topics, cloned.range);
            }}
          >
            <span className="analysis-preset__icon"><Icon name={PRESET_ICONS[preset.id]} size={20} /></span>
            <span>
              <strong>{preset.name}</strong>
              <small>{preset.description}</small>
            </span>
            <Icon name="chevronRight" size={18} />
          </button>
        ))}
      </div>

      <div className="analysis-syntax" aria-label="查詢語法提示">
        {SYNTAX.map((item) => (
          <span className="analysis-syntax__item" key={item.token}>
            <code>{item.token}</code>
            <span>{item.detail}</span>
          </span>
        ))}
      </div>
    </section>
  );
}
