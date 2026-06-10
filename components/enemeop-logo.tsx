interface LogoProps {
  size?: 'sm' | 'md' | 'lg'
  showText?: boolean
}

const sizes = {
  sm: { px: 28, fontSize: 7,  subSize: 5.5, letterSpacing: '0.15em', subSpacing: '0.30em' },
  md: { px: 40, fontSize: 9,  subSize: 7,   letterSpacing: '0.18em', subSpacing: '0.35em' },
  lg: { px: 64, fontSize: 14, subSize: 10,  letterSpacing: '0.18em', subSpacing: '0.40em' },
}

/*
  Flor estilizada Enemeop — 4 pétalas curvas em grade 2×2.
  Cada pétala usa cúbicas bezier:
    - lados internos côncavos (curvam em direção ao centro)
    - canto externo convexo e arredondado
  viewBox 100×100, centro em (50,50).
*/
const PETALS = [
  // pétala superior esquerda
  'M 50,50 C 50,28 42,8 24,8 C 14,8 8,14 8,24 C 8,42 28,50 50,50 Z',
  // pétala superior direita
  'M 50,50 C 50,28 58,8 76,8 C 86,8 92,14 92,24 C 92,42 72,50 50,50 Z',
  // pétala inferior esquerda
  'M 50,50 C 28,50 8,58 8,76 C 8,86 14,92 24,92 C 42,92 50,72 50,50 Z',
  // pétala inferior direita
  'M 50,50 C 72,50 92,58 92,76 C 92,86 86,92 76,92 C 58,92 50,72 50,50 Z',
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
        {PETALS.map((d, i) => (
          <path key={i} d={d} fill="#C9A84C" />
        ))}
        {/* ponto central */}
        <circle cx="50" cy="50" r="4" fill="#C9A84C" />
      </svg>

      {showText && (
        <div className="leading-tight">
          <p
            className="font-bold text-gold"
            style={{ fontSize: s.fontSize, letterSpacing: s.letterSpacing }}
          >
            ENEMEOP
          </p>
          <p
            className="text-text-faint font-semibold"
            style={{ fontSize: s.subSize, letterSpacing: s.subSpacing }}
          >
            FLORES
          </p>
        </div>
      )}
    </div>
  )
}
