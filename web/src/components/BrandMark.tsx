export type BrandMarkSize = 'sm' | 'md' | 'lg';

const SIZE: Record<BrandMarkSize, number> = { sm: 20, md: 30, lg: 48 };

/** News page + radar waves: the shared visual identity for the public site. */
export function BrandMark({ size = 'md', decorative = true }: { size?: BrandMarkSize; decorative?: boolean }) {
  const dimension = SIZE[size];
  return (
    <svg
      className={`brand-mark brand-mark--${size}`}
      data-testid="brand-mark"
      width={dimension}
      height={dimension}
      viewBox="0 0 48 48"
      focusable="false"
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : '媒體輿情監測'}
    >
      <rect width="48" height="48" rx="13" fill="#17324d" />
      <path d="M11 13.5A4.5 4.5 0 0 1 15.5 9h13A4.5 4.5 0 0 1 33 13.5v21a4.5 4.5 0 0 1-4.5 4.5h-13a4.5 4.5 0 0 1-4.5-4.5z" fill="#f7fbff" />
      <path d="M16 16h12M16 21h9M16 26h7" stroke="#2a78d6" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M31 27.5a5.5 5.5 0 0 1 0-7.8M35 31.5a11 11 0 0 1 0-15.8M39 35.5a16.5 16.5 0 0 1 0-23.8" fill="none" stroke="#53d5b6" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="31" cy="23.6" r="2.5" fill="#53d5b6" />
    </svg>
  );
}
