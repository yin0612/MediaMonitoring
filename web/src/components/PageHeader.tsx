import type { ReactNode } from 'react';
import { Freshness } from './ui';

export function PageHeader({
  title,
  description,
  context,
  actions,
}: {
  title: string;
  description: string;
  context?: { label: string; at: string | null };
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header__copy">
        <h1 className="page-header__title">{title}</h1>
        <p className="page-header__description">{description}</p>
        {context && <Freshness at={context.at} label={context.label} />}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  );
}
