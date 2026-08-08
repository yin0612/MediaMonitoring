import type { ReactNode } from 'react';
import { EmptyState, ErrorState, LoadingState } from './ui';

export function DataSection({
  title,
  loading,
  error,
  onRetry,
  isEmpty,
  emptyTitle = '目前沒有資料',
  emptyDesc,
  children,
}: {
  title: string;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  isEmpty: boolean;
  emptyTitle?: string;
  emptyDesc?: string;
  children: ReactNode;
}) {
  return (
    <section className="data-section" aria-label={title}>
      {loading ? <LoadingState label={'載入' + title + '…'} /> : error ? <ErrorState error={error} onRetry={onRetry} /> : isEmpty ? <EmptyState title={emptyTitle} desc={emptyDesc} /> : children}
    </section>
  );
}
