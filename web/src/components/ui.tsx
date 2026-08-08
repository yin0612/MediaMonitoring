import type { ReactNode } from 'react';
import type { SourceId, SourceStatus } from '../types/contracts';
import { STATUS_LABEL, sourceColor, sourceShort } from '../lib/sources';
import { fmtRelative } from '../lib/format';
import { Icon, type IconName } from './Icon';

export function Badge({
  variant = 'muted',
  children,
  dot = false,
}: {
  variant?: 'good' | 'warning' | 'serious' | 'critical' | 'muted' | 'accent';
  children: ReactNode;
  dot?: boolean;
}) {
  const dotColor =
    variant === 'good'
      ? 'var(--status-good)'
      : variant === 'warning'
        ? 'var(--status-warning)'
        : variant === 'serious'
          ? 'var(--status-serious)'
          : variant === 'critical'
            ? 'var(--status-critical)'
            : 'var(--text-muted)';
  return (
    <span className={`badge badge--${variant}`}>
      {dot && <span className="dot" style={{ background: dotColor }} />}
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: SourceStatus }) {
  const s = STATUS_LABEL[status];
  return (
    <Badge variant={s.variant as never} dot>
      {s.label}
    </Badge>
  );
}

export function SourceTag({ id, withDot = true }: { id: SourceId; withDot?: boolean }) {
  return (
    <span className="src-tag" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      {withDot && <span className="dot" style={{ background: sourceColor(id) }} />}
      {sourceShort(id)}
    </span>
  );
}

/** 熱度數值 + 進度條，顏色依熱度分段。 */
export function HeatBar({ heat }: { heat: number }) {
  const clamped = Math.max(0, Math.min(100, heat));
  const color =
    clamped >= 70 ? 'var(--status-critical)' : clamped >= 40 ? 'var(--status-serious)' : 'var(--accent)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', width: '100%', minWidth: 0 }}>
      <div className="heatbar">
        <div className="heatbar__fill" style={{ width: `${clamped}%`, background: color }} />
      </div>
    </div>
  );
}

/** 資料新鮮度顯示。 */
export function Freshness({ at, label = '更新於' }: { at: string | null; label?: string }) {
  return (
    <span className="small muted" title={at ?? undefined}>
      {label} {fmtRelative(at)}
    </span>
  );
}

export function Card({
  title,
  hint,
  children,
  right,
  tone = 'default',
}: {
  title?: string;
  hint?: string;
  children: ReactNode;
  right?: ReactNode;
  tone?: 'default' | 'elevated' | 'subtle';
}) {
  return (
    <div className={`card card--${tone}`}>
      {(title || right) && (
        <div className="card__head">
          <div>
            {title && <h2 className="card__title">{title}</h2>}
            {hint && <div className="card__hint">{hint}</div>}
          </div>
          {right && <div className="card__actions">{right}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

export function StatTile({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className="card stat">
      <span className="stat__label">
        {icon && <span className="stat__icon"><Icon name={icon} size={18} /></span>}
        {label}
      </span>
      <span className="stat__value num">{value}</span>
      {sub && <span className="stat__sub">{sub}</span>}
    </div>
  );
}

// ── 狀態畫面 ────────────────────────────────────────────────────────────────

export function LoadingState({ label = '載入資料中…' }: { label?: string }) {
  return (
    <div className="state">
      <div className="state__icon state__icon--loading"><Icon name="refresh" size={28} /></div>
      <div className="state__title">{label}</div>
    </div>
  );
}

export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div className="grid cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card">
          <div className="skeleton" style={{ height: 12, width: '55%', marginBottom: 12 }} />
          <div className="skeleton" style={{ height: 30, width: '70%' }} />
        </div>
      ))}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  const isSchema = error.name === 'SchemaVersionError';
  return (
    <div className="state">
      <div className="state__icon"><Icon name={isSchema ? 'archive' : 'warning'} size={28} /></div>
      <div className="state__title">{isSchema ? '資料版本不相容' : '無法載入資料'}</div>
      <div className="state__desc">{error.message}</div>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          重新載入
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  title = '目前沒有資料',
  desc,
  icon = 'inbox',
}: {
  title?: string;
  desc?: string;
  icon?: IconName;
}) {
  return (
    <div className="state">
      <div className="state__icon"><Icon name={icon} size={28} /></div>
      <div className="state__title">{title}</div>
      {desc && <div className="state__desc">{desc}</div>}
    </div>
  );
}

export function Banner({
  variant = 'info',
  icon,
  children,
}: {
  variant?: 'info' | 'warning' | 'serious';
  icon?: IconName;
  children: ReactNode;
}) {
  const defaultIcon: IconName = variant === 'warning' ? 'warning' : variant === 'serious' ? 'alert' : 'info';
  return (
    <div className={`banner banner--${variant}`}>
      <span className="banner__ico"><Icon name={icon ?? defaultIcon} size={20} /></span>
      <div>{children}</div>
    </div>
  );
}
