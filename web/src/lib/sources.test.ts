import { describe, expect, it } from 'vitest';

import { NEWS_SOURCE_IDS, SOURCE_META, sourceModeLabel } from './sources';

const EXPECTED_SOURCE_IDS = [
  'tvbs', 'ebc', 'setn', 'ftv', 'cti', 'era', 'nexttv', 'pts', 'ttv', 'cts', 'udn',
  'ltn', 'cna', 'moneyudn', 'ctee', 'anue', 'wealth', 'businessweekly', 'thenewslens',
  'reporter', 'newtalk', 'nownews', 'nextapple', 'ettoday',
  'rti', 'technews', 'taipeitimes', 'coolloud', 'tfc',
  'moneydj', 'businesstoday', 'bnext', 'managertoday', 'chinatimes', 'ctwant',
];

describe('news source registry', () => {
  it('contains exactly the configured publishers', () => {
    expect(NEWS_SOURCE_IDS).toEqual(EXPECTED_SOURCE_IDS);
    expect(Object.keys(SOURCE_META)).not.toContain('mirror');
    expect(Object.keys(SOURCE_META)).not.toContain('currents');
  });

  it('renders stable labels and distinct series slots for the five new publishers', () => {
    expect(SOURCE_META.rti).toMatchObject({ name: '中央廣播電臺', short: '央廣', series: 6 });
    expect(SOURCE_META.technews).toMatchObject({ name: '科技新報', short: '科技新報', series: 7 });
    expect(SOURCE_META.taipeitimes).toMatchObject({ name: 'Taipei Times', short: '北時', series: 0 });
    expect(SOURCE_META.coolloud).toMatchObject({ name: '苦勞網', short: '苦勞網', series: 1 });
    expect(SOURCE_META.tfc).toMatchObject({ name: '台灣事實查核中心', short: '事實查核', series: 2 });
  });

  it('shows the actual acquisition mode in Traditional Chinese', () => {
    expect(sourceModeLabel('official-rss')).toBe('官方 RSS');
    expect(sourceModeLabel('google-news')).toBe('Google News 補充');
    expect(sourceModeLabel('site-listing')).toBe('官網低頻');
  });
});
