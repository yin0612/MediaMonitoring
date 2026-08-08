import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Banner, Card, EmptyState, ErrorState, StatTile } from './ui';

describe('Card', () => {
  it('keeps card controls in a dedicated responsive action area', () => {
    const { container } = render(
      <Card
        title="熱度趨勢（前 5 名）"
        right={<button type="button">24 小時</button>}
      >
        圖表
      </Card>,
    );

    expect(screen.getByRole('heading', { name: '熱度趨勢（前 5 名）' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '24 小時' })).toBeInTheDocument();
    expect(container.querySelector('.card__actions')).toContainElement(
      screen.getByRole('button', { name: '24 小時' }),
    );
  });

  it('supports surface tones and local SVG state icons', () => {
    const { container } = render(
      <>
        <Card tone="subtle">次要內容</Card>
        <StatTile label="趨勢" value="12" icon="trendUp" />
        <Banner variant="warning">需要留意</Banner>
        <EmptyState icon="inbox" />
        <ErrorState error={new Error('離線')} />
      </>,
    );

    expect(container.querySelector('.card--subtle')).toBeInTheDocument();
    expect(container.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(4);
  });
});
