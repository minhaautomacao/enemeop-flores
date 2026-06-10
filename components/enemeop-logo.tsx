interface LogoProps {
  size?: 'sm' | 'md' | 'lg'
  showText?: boolean
}

const sizes = {
  sm: { px: 28, fontSize: 7,  subSize: 5.5, letterSpacing: '0.15em', subSpacing: '0.30em' },
  md: { px: 40, fontSize: 9,  subSize: 7,   letterSpacing: '0.18em', subSpacing: '0.35em' },
  lg: { px: 64, fontSize: 14, subSize: 10,  letterSpacing: '0.18em', subSpacing: '0.40em' },
}

// 4 squircles separados em grade 2×2 — variante B (rx médio, gap ~8px)
// viewBox 100×100
const SQUARES = [
  { x: 4,  y: 4  },
  { x: 54, y: 4  },
  { x: 4,  y: 54 },
  { x: 54, y: 54 },
]

export function EnumeopLogo({ size = 'md', showText = true }: LogoProps) {
  const s = sizes[size]

  return (
    <div className="flex items-center gap-3 select-none">
      <svg
        width={s.px}
        height={s.px}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {SQUARES.map(({ x, y }, i) => (
          <rect key={i} x={x} y={y} width="42" height="42" rx="10" fill="#C9A84C" />
        ))}
        <circle cx="50" cy="50" r="3" fill="#C9A84C" />
      </svg>

      {showText && (
        <div className="leading-tight">
          <p className="font-bold text-gold" style={{ fontSize: s.fontSize, letterSpacing: s.letterSpacing }}>
            ENEMEOP
          </p>
          <p className="text-text-faint font-semibold" style={{ fontSize: s.subSize, letterSpacing: s.subSpacing }}>
            FLORES
          </p>
        </div>
      )}
    </div>
  )
}
