/**
 * 介面圖示：統一的 inline SVG 圖示家族。
 *
 * 依 ui-ux-pro-max 的專業規則：結構性圖示不得使用 emoji（跨平台字體不一致、
 * 無法用設計 token 控制顏色與尺寸）。此處採 Lucide 風格：24×24 網格、
 * 1.75px 統一線寬、round linecap、currentColor 著色，因此能自動跟隨主題。
 */
export type IconName =
  | 'search'
  | 'scale'
  | 'newspaper'
  | 'layout'
  | 'flame'
  | 'layers'
  | 'network'
  | 'compass'
  | 'refresh'
  | 'home'
  | 'menu'
  | 'close'
  | 'chevronRight'
  | 'alert'
  | 'archive'
  | 'checkCircle'
  | 'clock'
  | 'download'
  | 'experiment'
  | 'info'
  | 'inbox'
  | 'message'
  | 'shield'
  | 'trendUp'
  | 'warning'
  | 'sun'
  | 'moon'
  | 'monitor';

const PATHS: Record<IconName, JSX.Element> = {
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" />
    </>
  ),
  scale: (
    <>
      <path d="M12 4v16M6 8h12" />
      <path d="m4 14 2-6 2 6a2.5 2.5 0 0 1-4 0Z" />
      <path d="m16 14 2-6 2 6a2.5 2.5 0 0 1-4 0Z" />
    </>
  ),
  newspaper: (
    <>
      <path d="M4 5h13v14H5.5A1.5 1.5 0 0 1 4 17.5Z" />
      <path d="M17 8h3v9.5a1.5 1.5 0 0 1-3 0Z" />
      <path d="M7 9h7M7 13h7M7 16h4" />
    </>
  ),
  layout: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M4 10h16M10 10v10" />
    </>
  ),
  flame: (
    <>
      <path d="M12 3s5 4.2 5 9a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 1.5.8 2.5 1.8 2.5 1.3 0 1.7-1.4 1.2-3-.3-1.2-.6-2.6 0-4Z" />
    </>
  ),
  layers: (
    <>
      <path d="m12 4 8 4-8 4-8-4Z" />
      <path d="m4 12 8 4 8-4" />
      <path d="m4 16 8 4 8-4" />
    </>
  ),
  network: (
    <>
      <circle cx="12" cy="5" r="2.2" />
      <circle cx="5" cy="18" r="2.2" />
      <circle cx="19" cy="18" r="2.2" />
      <path d="M10.6 6.8 6.4 15.9M13.4 6.8l4.2 9.1M7.2 18h9.6" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m14.8 9.2-1.6 4.4-4.4 1.6 1.6-4.4Z" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11a8 8 0 0 0-13.7-5.2L4 8" />
      <path d="M4 4v4h4" />
      <path d="M4 13a8 8 0 0 0 13.7 5.2L20 16" />
      <path d="M20 20v-4h-4" />
    </>
  ),
  home: (
    <>
      <path d="m4 11 8-7 8 7" />
      <path d="M6 10v10h12V10M10 20v-6h4v6" />
    </>
  ),
  menu: <path d="M5 7h14M5 12h14M5 17h14" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  alert: (
    <>
      <path d="M12 3 2.8 20h18.4Z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  archive: (
    <>
      <path d="M4 7h16v13H4Z" />
      <path d="M3 4h18v4H3ZM9 12h6" />
    </>
  ),
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 2.5 2.5L16 9" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12M7.5 10.5 12 15l4.5-4.5" />
      <path d="M5 20h14" />
    </>
  ),
  experiment: (
    <>
      <path d="M9 3h6M10 3v5l-5 9a2.5 2.5 0 0 0 2.2 3.7h9.6A2.5 2.5 0 0 0 19 17l-5-9V3" />
      <path d="M7.5 15h9" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7h.01" />
    </>
  ),
  inbox: (
    <>
      <path d="M4 5h16v14H4Z" />
      <path d="M4 14h4l2 3h4l2-3h4" />
    </>
  ),
  message: (
    <>
      <path d="M4 5h16v12H9l-5 4Z" />
      <path d="M8 9h8M8 13h5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 20 6v5c0 5-3.3 8.2-8 10-4.7-1.8-8-5-8-10V6Z" />
      <path d="m8.5 12 2.2 2.2 4.8-5" />
    </>
  ),
  trendUp: <path d="m4 17 6-6 4 4 6-8M15 7h5v5" />,
  warning: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6M12 17h.01" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />,
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M9 20h6M12 16v4" />
    </>
  ),
};

interface Props {
  name: IconName;
  /** 像素尺寸，對應 icon token：sm 16 / md 20 / lg 24。 */
  size?: number;
  className?: string;
}

export function Icon({ name, size = 20, className }: Props) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
