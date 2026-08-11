import type { Meta } from '../types/contracts';

/** 30 日只有在快照明確證明完整涵蓋時才可由 UI 選取。 */
export function isArchive30dReady(meta: Meta | null | undefined): boolean {
  return (meta?.coverage?.archiveDays ?? 0) >= 30
    && (meta?.coverage?.coveredDays ?? 0) >= 30
    && meta?.coverage?.complete === true;
}
