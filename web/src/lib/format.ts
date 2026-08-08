/** 時間與數字格式化。儲存一律 UTC，顯示一律 Asia/Taipei。 */

const TZ = 'Asia/Taipei';

const dateTimeFmt = new Intl.DateTimeFormat('zh-TW', {
  timeZone: TZ,
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const dateFmt = new Intl.DateTimeFormat('zh-TW', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const timeFmt = new Intl.DateTimeFormat('zh-TW', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return dateTimeFmt.format(d);
}

export function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return dateFmt.format(d);
}

export function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return timeFmt.format(d);
}

/** 相對時間，例如「3 分鐘前」。 */
export function fmtRelative(iso: string | null, now: number = Date.now()): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diff = Math.round((now - t) / 1000);
  if (diff < -300) return '來源時間異常';
  if (diff < 0) return '剛剛';
  if (diff < 60) return `${diff} 秒前`;
  const min = Math.floor(diff / 60);
  if (min < 60) return `${min} 分鐘前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小時前`;
  const day = Math.floor(hr / 24);
  return `${day} 天前`;
}

export function fmtNum(n: number): string {
  return new Intl.NumberFormat('zh-TW').format(n);
}

/** 大數字縮寫：1234 → 1.2K。 */
export function fmtCompact(n: number): string {
  return new Intl.NumberFormat('zh-TW', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function fmtPct(ratio: number, digits = 1): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function fmtFixed(n: number, digits = 1): string {
  return n.toFixed(digits);
}
