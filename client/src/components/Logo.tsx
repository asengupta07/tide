/** Tide mark: a curling wave with a barrel, in a circle. Source of truth is public/logo.svg. */
export function Logo({ size = 22, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden>
      <defs>
        <clipPath id="tide-c"><circle cx="32" cy="32" r="32" /></clipPath>
        <linearGradient id="tide-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8ae6d6" />
          <stop offset="1" stopColor="#2f8f80" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="32" fill="#0b0f14" />
      <g clipPath="url(#tide-c)">
        <path fill="url(#tide-g)" d="M-4 50 C 12 48, 20 40, 28 30 C 34 22, 42 14, 54 16 C 66 18, 68 32, 60 38 C 55 42, 48 40, 46 35 C 44 30, 48 26, 52 28 C 55 29.5, 54 33, 51 33 L 68 33 L 68 70 L -4 70 Z" />
        <circle cx="51" cy="30" r="6.5" fill="#0b0f14" />
        <path fill="none" stroke="#e7ecf1" strokeOpacity="0.9" strokeWidth="2" strokeLinecap="round" d="M4 54 C 12 53, 20 46, 27 38" />
      </g>
    </svg>
  );
}
