// Shared bits of the Explore section: flags, progress rings, trophy art.
import type { ReactNode } from 'react'

/** Flag per region / country code (leagues and world leagues). */
export const FLAG: Record<string, string> = {
  EN: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', SC: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', ES: '🇪🇸', IT: '🇮🇹', DE: '🇩🇪', FR: '🇫🇷', PT: '🇵🇹', NL: '🇳🇱', BE: '🇧🇪', TR: '🇹🇷',
  BR: '🇧🇷', AR: '🇦🇷', US: '🇺🇸', JP: '🇯🇵', NG: '🇳🇬', KR: '🇰🇷', UY: '🇺🇾',
}
export const flag = (code: string) => FLAG[code] ?? '🏳️'

/** Where each region sits on the scouting map (percent of width / height). */
export const MAP_POS: Record<string, [number, number]> = {
  US: [17, 36], BR: [33, 70], AR: [29, 86], SC: [46.5, 17], EN: [47.5, 25], NL: [51, 23], BE: [50, 29], FR: [48, 34],
  DE: [55, 26], PT: [42.5, 41], ES: [45.5, 42], IT: [55, 38], TR: [64, 40], JP: [88, 37],
}

/** A circular progress ring with content in the middle. */
export function Ring({ value, max, size = 56, stroke = 5, color, children }: { value: number; max: number; size?: number; stroke?: number; color?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0
  return (
    <span className="ex-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(140,180,220,0.16)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color ?? 'var(--hot)'} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span className="ex-ring-in">{children}</span>
    </span>
  )
}

export type TrophyKind = 'league' | 'cup' | 'cl' | 'promotion' | 'feat' | 'ach'

const METAL: Record<string, [string, string, string]> = {
  gold: ['#fff6c2', '#ffd23f', '#a8750c'],
  silver: ['#ffffff', '#cfd9e6', '#6f7f91'],
  platinum: ['#effffff0', '#9ff3ff', '#3f9fb8'],
  green: ['#c9ffe0', '#3ee08a', '#11734a'],
}

/** Trophy art: a different piece of silverware per competition. */
export function TrophyIcon({ kind, size = 120, uid = 'x', stars = 0 }: { kind: TrophyKind; size?: number; uid?: string; stars?: number }) {
  const metal = kind === 'cl' ? 'silver' : kind === 'promotion' ? 'green' : kind === 'ach' ? 'platinum' : 'gold'
  const [a, b, c] = METAL[metal]
  const g = `exg-${kind}-${uid}`
  const fill = `url(#${g})`
  const base = (
    <>
      <rect x="54" y="88" width="12" height="16" fill={fill} />
      <rect x="40" y="103" width="40" height="8" rx="2" fill={fill} />
      <rect x="33" y="111" width="54" height="17" rx="3" fill="#2a1d10" stroke="#5a3e1e" strokeWidth="1.5" />
      <rect x="45" y="116" width="30" height="7" rx="1" fill={b} opacity="0.85" />
    </>
  )
  let art: ReactNode
  switch (kind) {
    case 'league':
      art = <>
        <path d="M31 28 C10 26 12 60 36 62" fill="none" stroke={fill} strokeWidth="7" strokeLinecap="round" />
        <path d="M89 28 C110 26 108 60 84 62" fill="none" stroke={fill} strokeWidth="7" strokeLinecap="round" />
        <path d="M30 18 H90 V44 C90 70 76 85 60 89 C44 85 30 70 30 44 Z" fill={fill} stroke={c} strokeWidth="1.5" />
        <path d="M60 32 l4.5 9.2 10 1.4 -7.3 7 1.8 10 -9-4.8 -9 4.8 1.8-10 -7.3-7 10-1.4z" fill="#fffbe6" opacity="0.9" />
        <path d="M36 22 H48 V46 C48 60 52 70 58 78 C44 72 36 60 36 46 Z" fill="#fff" opacity="0.18" />
      </>
      break
    case 'cup':
      art = <>
        <circle cx="60" cy="7" r="4.5" fill={fill} />
        <path d="M40 19 Q60 2 80 19 Z" fill={fill} stroke={c} strokeWidth="1.2" />
        <path d="M39 26 C27 26 27 46 41 50" fill="none" stroke={fill} strokeWidth="5" strokeLinecap="round" />
        <path d="M81 26 C93 26 93 46 79 50" fill="none" stroke={fill} strokeWidth="5" strokeLinecap="round" />
        <path d="M37 20 H83 V40 C83 64 72 82 60 88 C48 82 37 64 37 40 Z" fill={fill} stroke={c} strokeWidth="1.5" />
        <rect x="37" y="34" width="46" height="5" fill={c} opacity="0.35" />
        <path d="M42 24 H50 V44 C50 58 54 68 58 76 C47 70 42 58 42 44 Z" fill="#fff" opacity="0.2" />
      </>
      break
    case 'cl':
      art = <>
        <path d="M38 26 C2 8 -2 74 42 68" fill="none" stroke={fill} strokeWidth="6.5" strokeLinecap="round" />
        <path d="M82 26 C118 8 122 74 78 68" fill="none" stroke={fill} strokeWidth="6.5" strokeLinecap="round" />
        <path d="M35 20 H85 V42 C85 68 73 84 60 89 C47 84 35 68 35 42 Z" fill={fill} stroke={c} strokeWidth="1.5" />
        <path d="M41 24 H51 V46 C51 60 54 70 58 78 C46 72 41 60 41 46 Z" fill="#fff" opacity="0.25" />
        <circle cx="60" cy="48" r="9" fill="none" stroke={c} strokeWidth="2" opacity="0.6" />
      </>
      break
    case 'promotion':
      return (
        <svg className="ex-trophy" width={size} height={size * 140 / 120} viewBox="0 0 120 140" aria-hidden="true">
          <defs><linearGradient id={g} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={a} /><stop offset="0.5" stopColor={b} /><stop offset="1" stopColor={c} /></linearGradient></defs>
          <path d="M60 10 L102 25 V60 C102 92 82 112 60 124 C38 112 18 92 18 60 V25 Z" fill={fill} stroke="#0b3d24" strokeWidth="2" />
          <polyline points="38,74 60,52 82,74" fill="none" stroke="#fff" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
          <polyline points="38,98 60,76 82,98" fill="none" stroke="#fff" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
        </svg>
      )
    default: // feat / ach: a medal on a ribbon
      return (
        <svg className="ex-trophy" width={size} height={size * 140 / 120} viewBox="0 0 120 140" aria-hidden="true">
          <defs><linearGradient id={g} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={a} /><stop offset="0.5" stopColor={b} /><stop offset="1" stopColor={c} /></linearGradient></defs>
          <path d="M34 4 H56 L70 52 H48 Z" fill="var(--club, #c0392b)" />
          <path d="M86 4 H64 L50 52 H72 Z" fill="var(--cyan)" opacity="0.9" />
          <circle cx="60" cy="88" r="36" fill={fill} stroke={c} strokeWidth="3" />
          <circle cx="60" cy="88" r="27" fill="none" stroke="#fff" strokeWidth="2" opacity="0.4" />
          {stars > 0
            ? Array.from({ length: stars }, (_, i) => {
              const x = 60 + (i - (stars - 1) / 2) * 17
              return <path key={i} transform={`translate(${x - 60} 0)`} d="M60 76 l3.6 7.4 8.1 1.2 -5.9 5.7 1.4 8.1 -7.2-3.8 -7.2 3.8 1.4-8.1 -5.9-5.7 8.1-1.2z" fill="#fffbe6" />
            })
            : <path d="M60 70 l5.4 11 12.2 1.8 -8.8 8.6 2.1 12.1 -10.9-5.7 -10.9 5.7 2.1-12.1 -8.8-8.6 12.2-1.8z" fill="#fffbe6" />}
        </svg>
      )
  }
  return (
    <svg className="ex-trophy" width={size} height={size * 140 / 120} viewBox="0 0 120 140" aria-hidden="true">
      <defs><linearGradient id={g} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={a} /><stop offset="0.5" stopColor={b} /><stop offset="1" stopColor={c} /></linearGradient></defs>
      {art}
      {base}
    </svg>
  )
}
