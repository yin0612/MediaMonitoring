import { describe, expect, it } from 'vitest';
import { ANALYSIS_PRESETS, cloneAnalysisPreset } from './analysisPresets';

describe('analysis presets', () => {
  it('defines three valid decision scenarios', () => {
    expect(ANALYSIS_PRESETS.map((preset) => preset.id)).toEqual([
      'brand-compare',
      'policy-monitor',
      'noise-filter',
    ]);
    for (const preset of ANALYSIS_PRESETS) {
      expect(preset.name).not.toBe('');
      expect(preset.description).not.toBe('');
      expect(['1h', '6h', '24h', '7d']).toContain(preset.range);
      expect(preset.topics.length).toBeGreaterThanOrEqual(1);
      expect(preset.topics.length).toBeLessThanOrEqual(3);
      for (const topic of preset.topics) {
        expect(topic.name).not.toBe('');
        expect(topic.query).not.toBe('');
      }
    }
  });

  it('returns mutable copies without altering the preset catalog', () => {
    const preset = ANALYSIS_PRESETS[0];
    const cloned = cloneAnalysisPreset(preset);
    cloned.topics[0].name = '已修改';
    cloned.topics.push({ name: '新主題', query: '新主題' });

    expect(preset.topics[0].name).not.toBe('已修改');
    expect(preset.topics).toHaveLength(2);
  });
});
