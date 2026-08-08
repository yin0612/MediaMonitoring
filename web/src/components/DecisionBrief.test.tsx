import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { DecisionBriefModel } from '../lib/decisionBrief';
import { DecisionBrief } from './DecisionBrief';

const model: DecisionBriefModel = {
  eyebrow: '今日決策摘要',
  headline: '台積電正在升溫',
  summary: '近 90 分鐘提及增加 8 篇。',
  confidence: 'good',
  signals: [
    { kind: 'momentum', label: '90 分鐘動能', value: '+8 篇', detail: '台積電近期提及增加', to: '/keywords' },
    { kind: 'topic', label: '主要事件', value: '財經與產業', detail: '42 篇', to: '/topics' },
    { kind: 'coverage', label: '健康來源', value: '24 / 24', detail: '目前來源回應正常', to: '/method' },
  ],
  primaryAction: { to: '/keywords', label: '查看關鍵字趨勢' },
};

describe('DecisionBrief', () => {
  it('renders a concise decision narrative and actionable signals', () => {
    render(<MemoryRouter><DecisionBrief model={model} /></MemoryRouter>);

    expect(screen.getByRole('region', { name: '今日決策摘要' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '台積電正在升溫' })).toBeInTheDocument();
    expect(screen.getByText('資料完整')).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(4);
    expect(screen.getByRole('link', { name: '查看關鍵字趨勢' })).toHaveAttribute('href', '/keywords');
  });

  it('uses honest confidence language for limited data', () => {
    render(<MemoryRouter><DecisionBrief model={{ ...model, confidence: 'limited' }} /></MemoryRouter>);

    expect(screen.getByText('資料受限')).toBeInTheDocument();
  });
});
