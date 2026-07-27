interface LogoProps {
  size?: number;
  withWordmark?: boolean;
}

// Ikon Alpha: chevron A + kilau. Bounding box internal 0..118 (lebar), 0..90 (tinggi).
export function AlphaMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 118 92" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="alphaGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5b8cff" />
          <stop offset="1" stopColor="#2f5fe0" />
        </linearGradient>
      </defs>
      <path d="M0 88 L48 6 C51 1 58 1 61 6 L88 57 L69 57 L56 31 L21 88 Z" fill="url(#alphaGrad)" />
      <path d="M29 54 L63 54 L52 75 L40 75 Z" fill="url(#alphaGrad)" />
      <path d="M101 22 l4.5 12 12 4.5 -12 4.5 -4.5 12 -4.5 -12 -12 -4.5 12 -4.5 Z" fill="#7aa0ff" />
    </svg>
  );
}

// Ikon dalam kotak rounded (buat sidebar). Ikon di-center presisi.
export function AlphaBadge({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 160 160" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="alphaGradB" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5b8cff" />
          <stop offset="1" stopColor="#2f5fe0" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="160" height="160" rx="38" fill="var(--raised)" />
      <g transform="translate(21.5,36)">
        <path d="M0 88 L48 6 C51 1 58 1 61 6 L88 57 L69 57 L56 31 L21 88 Z" fill="url(#alphaGradB)" />
        <path d="M29 54 L63 54 L52 75 L40 75 Z" fill="url(#alphaGradB)" />
        <path d="M101 22 l4.5 12 12 4.5 -12 4.5 -4.5 12 -4.5 -12 -12 -4.5 12 -4.5 Z" fill="#7aa0ff" />
      </g>
    </svg>
  );
}

export default function Logo({ size = 30, withWordmark = true }: LogoProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <AlphaMark size={size} />
      {withWordmark && (
        <div>
          <div style={{ fontSize: 15.5, fontWeight: 700, letterSpacing: '-0.01em' }}>Alpha</div>
          <div style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--mono)', letterSpacing: '.06em' }}>
            CONTENT LAUNCH
          </div>
        </div>
      )}
    </div>
  );
}
