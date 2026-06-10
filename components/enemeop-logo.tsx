interface LogoProps {
  size?: 'sm' | 'md' | 'lg'
  showText?: boolean
}

const sizes = {
  sm: { mark: 32, rx: 6,  gap: 2.5, sq: 11, dot: 2.2, fontSize: 7,  subSize: 5.5, letterSpacing: '0.15em', subSpacing: '0.30em' },
  md: { mark: 44, rx: 8,  gap: 3.5, sq: 15, dot: 3,   fontSize: 9,  subSize: 7,   letterSpacing: '0.18em', subSpacing: '0.35em' },
  lg: { mark: 64, rx: 11, gap: 5,   sq: 22, dot: 4,   fontSize: 14, subSize: 10,  letterSpacing: '0.18em', subSpacing: '0.40em' },
}

export function EnumeopLogo({ size = 'md', showText = true }: LogoProps) {
  const s = sizes[size]
  const half = s.mark / 2
  const offset = s.gap / 2 + s.sq / 2

  return (
    <div className="flex items-center gap-3 select-none">
      {/* Marca: 4 quadrados arredondados + ponto central */}
      <svg
        width={s.mark}
        height={s.mark}
        viewBox={`0 0 ${s.mark} ${s.mark}`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {/* superior esquerdo */}
        <rect
          x={half - offset - s.sq}
          y={half - offset - s.sq}
          width={s.sq}
          height={s.sq}
          rx={s.rx}
          fill="#C9A84C"
        />
        {/* superior direito */}
        <rect
          x={half + offset}
          y={half - offset - s.sq}
          width={s.sq}
          height={s.sq}
          rx={s.rx}
          fill="#C9A84C"
        />
        {/* inferior esquerdo */}
        <rect
          x={half - offset - s.sq}
          y={half + offset}
          width={s.sq}
          height={s.sq}
          rx={s.rx}
          fill="#C9A84C"
        />
        {/* inferior direito */}
        <rect
          x={half + offset}
          y={half + offset}
          width={s.sq}
          height={s.sq}
          rx={s.rx}
          fill="#C9A84C"
        />
        {/* ponto central */}
        <circle cx={half} cy={half} r={s.dot} fill="#C9A84C" />
      </svg>

      {showText && (
        <div className="leading-tight">
          <p
            className="font-bold text-gold tracking-widest"
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
