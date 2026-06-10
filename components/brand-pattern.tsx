export function BrandPattern({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`pointer-events-none select-none ${className}`}
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      width="100%"
      height="100%"
    >
      <defs>
        <pattern id="ef-pattern" x="0" y="0" width="160" height="160" patternUnits="userSpaceOnUse">
          <g fill="none" stroke="#9E7A1E" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round">

            {/* ── Row 1 ── */}
            {/* (20,20) Pétala teardrop */}
            <path transform="translate(20,20)" d="M0,-13 C7,-13 12,-7 12,2 C12,9 6,14 0,15 C-6,14 -12,9 -12,2 C-12,-7 -7,-13 0,-13 Z"/>
            {/* (60,20) Círculo */}
            <circle cx="60" cy="20" r="11"/>
            {/* (100,20) Rect arredondado */}
            <rect x="89" y="9" width="22" height="22" rx="5"/>
            {/* (140,20) 4-pétalas (marca Enemeop) */}
            <g transform="translate(140,20)">
              <path d="M-1,-1 Q-1,-12 -12,-12 Q-12,-1 -1,-1 Z"/>
              <path d="M1,-1 Q1,-12 12,-12 Q12,-1 1,-1 Z"/>
              <path d="M-1,1 Q-1,12 -12,12 Q-12,1 -1,1 Z"/>
              <path d="M1,1 Q1,12 12,12 Q12,1 1,1 Z"/>
            </g>

            {/* ── Row 2 ── */}
            {/* (20,60) Diamante arredondado */}
            <path transform="translate(20,60)" d="M0,-13 Q9,-7 13,0 Q9,7 0,13 Q-9,7 -13,0 Q-9,-7 0,-13 Z"/>
            {/* (60,60) Escudo/blob orgânico */}
            <path transform="translate(60,60)" d="M0,-13 C6,-15 13,-7 13,1 C13,9 6,13 0,13 C-6,13 -13,9 -13,1 C-13,-7 -6,-15 0,-13 Z"/>
            {/* (100,60) Chevron direita */}
            <path transform="translate(100,60)" d="M-9,-13 Q1,-6 9,0 Q1,6 -9,13" fill="none"/>
            {/* (140,60) Círculo */}
            <circle cx="140" cy="60" r="11"/>

            {/* ── Row 3 ── */}
            {/* (20,100) 4-pétalas */}
            <g transform="translate(20,100)">
              <path d="M-1,-1 Q-1,-12 -12,-12 Q-12,-1 -1,-1 Z"/>
              <path d="M1,-1 Q1,-12 12,-12 Q12,-1 1,-1 Z"/>
              <path d="M-1,1 Q-1,12 -12,12 Q-12,1 -1,1 Z"/>
              <path d="M1,1 Q1,12 12,12 Q12,1 1,1 Z"/>
            </g>
            {/* (60,100) Rect arredondado */}
            <rect x="49" y="89" width="22" height="22" rx="5"/>
            {/* (100,100) Pétala teardrop */}
            <path transform="translate(100,100)" d="M0,-13 C7,-13 12,-7 12,2 C12,9 6,14 0,15 C-6,14 -12,9 -12,2 C-12,-7 -7,-13 0,-13 Z"/>
            {/* (140,100) Escudo orgânico */}
            <path transform="translate(140,100)" d="M0,-13 C6,-15 13,-7 13,1 C13,9 6,13 0,13 C-6,13 -13,9 -13,1 C-13,-7 -6,-15 0,-13 Z"/>

            {/* ── Row 4 ── */}
            {/* (20,140) Círculo pequeno */}
            <circle cx="20" cy="140" r="8"/>
            {/* (60,140) Pétala teardrop */}
            <path transform="translate(60,140)" d="M0,-13 C7,-13 12,-7 12,2 C12,9 6,14 0,15 C-6,14 -12,9 -12,2 C-12,-7 -7,-13 0,-13 Z"/>
            {/* (100,140) Diamante */}
            <path transform="translate(100,140)" d="M0,-13 Q9,-7 13,0 Q9,7 0,13 Q-9,7 -13,0 Q-9,-7 0,-13 Z"/>
            {/* (140,140) Rect arredondado pequeno */}
            <rect x="131" y="131" width="18" height="18" rx="4"/>

          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#ef-pattern)" opacity="0.07"/>
    </svg>
  );
}
