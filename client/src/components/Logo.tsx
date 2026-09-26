/** Tide mark: a swell curling into a crest, in a circle. Source of truth is public/logo.svg. */
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
        <path fill="url(#tide-g)" d="M-2 48 C 10 48, 18 42, 24 36 C 30 40, 36 44, 44 44 C 52 44, 58 42, 66 40 L 66 66 L -2 66 Z" />
        <path fill="none" stroke="url(#tide-g)" strokeWidth="10" strokeLinecap="round" d="M22 38 C 26 22, 46 10, 57 20 C 65 28, 58 40, 48 38 C 42 37, 42 30, 47 29 C 50 28, 52 31, 50 33" />
      </g>
    </svg>
  );
}
