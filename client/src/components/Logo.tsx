/** Tide mark: a curling wave with a barrel and a dither texture deepening toward the bottom. Source: public/logo.svg. */
export function Logo({ size = 22, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden>
      <defs>
        <clipPath id="tide-c"><circle cx="32" cy="32" r="32" /></clipPath>
        <clipPath id="tide-w"><path clipRule="evenodd" d="M-4 50 C 12 48, 20 40, 28 30 C 34 22, 42 14, 54 16 C 66 18, 68 32, 60 38 C 55 42, 48 40, 46 35 C 44 30, 48 26, 52 28 C 55 29.5, 54 33, 51 33 L 68 33 L 68 70 L -4 70 Z" /></clipPath>
        <linearGradient id="tide-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8ae6d6" /><stop offset="1" stopColor="#2f8f80" /></linearGradient>
        <linearGradient id="tide-fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0.25" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#fff" stopOpacity="0.9" /></linearGradient>
        <mask id="tide-m"><rect width="64" height="64" fill="url(#tide-fade)" /></mask>
        <pattern id="tide-d" width="2.6" height="2.6" patternUnits="userSpaceOnUse"><rect x="0.8" y="0.8" width="1.1" height="1.1" fill="#0b0f14" /></pattern>
      </defs>
      <circle cx="32" cy="32" r="32" fill="#0b0f14" />
      <g clipPath="url(#tide-c)">
        <g clipPath="url(#tide-w)">
          <rect width="64" height="64" fill="url(#tide-g)" />
          <rect width="64" height="64" fill="url(#tide-d)" mask="url(#tide-m)" opacity="0.75" />
        </g>
        <circle cx="51" cy="30" r="6.5" fill="#0b0f14" />
        <path fill="none" stroke="#e7ecf1" strokeOpacity="0.9" strokeWidth="2" strokeLinecap="round" d="M4 54 C 12 53, 20 46, 27 38" />
      </g>
    </svg>
  );
}
