import { Link } from 'react-router-dom';
import type { DecisionBriefModel, DecisionSignalKind } from '../lib/decisionBrief';
import { Badge } from './ui';
import { Icon, type IconName } from './Icon';

const SIGNAL_ICONS: Record<DecisionSignalKind, IconName> = {
  momentum: 'flame',
  topic: 'layers',
  coverage: 'compass',
};

const CONFIDENCE = {
  good: { label: '資料完整', variant: 'good' as const },
  attention: { label: '部分來源異常', variant: 'warning' as const },
  limited: { label: '資料受限', variant: 'serious' as const },
};

export function DecisionBrief({ model }: { model: DecisionBriefModel }) {
  const confidence = CONFIDENCE[model.confidence];
  return (
    <section className={`decision-brief decision-brief--${model.confidence}`} aria-label={model.eyebrow}>
      <div className="decision-brief__main">
        <div className="decision-brief__meta">
          <span className="decision-brief__eyebrow">{model.eyebrow}</span>
          <Badge variant={confidence.variant} dot>{confidence.label}</Badge>
        </div>
        <h1 id="decision-brief-title">
          <Link to={model.primaryAction.to} style={{ color: 'inherit', textDecoration: 'none' }}>
            {model.headline}
          </Link>
        </h1>
        <p>{model.summary}</p>
        <Link className="btn btn--primary decision-brief__action" to={model.primaryAction.to}>
          {model.primaryAction.label}
        </Link>
      </div>

      {model.signals.length > 0 && (
        <div className="decision-brief__signals" aria-label="今日重要訊號">
          {model.signals.map((signal) => (
            <Link className="decision-signal" to={signal.to} key={signal.kind}>
              <span className="decision-signal__icon"><Icon name={SIGNAL_ICONS[signal.kind]} size={18} /></span>
              <span className="decision-signal__content">
                <small>{signal.label}</small>
                <strong>{signal.value}</strong>
                <span>{signal.detail}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
