import { useId } from 'react'
import type { KitDef } from './match/engine'

// A kit drawn as a little game card graphic: shirt (with its pattern, collar and cuffs), shorts and
// socks. The patterns match the ones painted on the pitch (match/render.ts paintPattern).

export const KIT_PATTERNS = ['plain', 'stripes', 'pinstripes', 'hoops', 'halves', 'quarters', 'sash', 'chevron', 'sleeves', 'centre', 'band'] as const
export type KitPattern = (typeof KIT_PATTERNS)[number]

function lum(hex: string) {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16)
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
}
/** Text that reads on a colour. */
export const inkOn = (hex: string) => (lum(hex) > 0.6 ? '#141821' : '#ffffff')

// the shirt's body box (the pattern area) in the 100 × 150 view box
const BX = 24, BY = 8, BW = 52, BH = 86

function Pattern({ pat, trim }: { pat: string; trim: string }) {
  switch (pat) {
    case 'stripes': return <>{[1, 3].map(i => <rect key={i} x={BX + (i * BW) / 5} y={BY - 4} width={BW / 5} height={BH + 8} fill={trim} />)}</>
    case 'pinstripes': return <>{[1, 2, 3, 4, 5, 6].map(i => <rect key={i} x={BX + (i * BW) / 7 - 0.8} y={BY - 4} width={1.6} height={BH + 8} fill={trim} />)}</>
    case 'hoops': return <>{[1, 3].map(i => <rect key={i} x={0} y={BY + (i * BH) / 5} width={100} height={BH / 5} fill={trim} />)}</>
    case 'halves': return <rect x={50} y={0} width={50} height={110} fill={trim} />
    case 'quarters': return <><rect x={50} y={0} width={50} height={BY + BH / 2} fill={trim} /><rect x={0} y={BY + BH / 2} width={50} height={60} fill={trim} /></>
    case 'sash': return <polygon points={`${BX + 2},${BY - 4} ${BX + 21},${BY - 4} ${BX + BW + 2},${BY + BH + 4} ${BX + BW - 19},${BY + BH + 4}`} fill={trim} />
    case 'chevron': return <polygon points={`${BX - 4},${BY - 2} 50,${BY + BH * 0.42} ${BX + BW + 4},${BY - 2} ${BX + BW + 4},${BY + 15} 50,${BY + BH * 0.42 + 17} ${BX - 4},${BY + 15}`} fill={trim} />
    case 'centre': return <rect x={50 - BW * 0.14} y={BY - 4} width={BW * 0.28} height={BH + 8} fill={trim} />
    case 'band': return <rect x={0} y={BY + BH * 0.28} width={100} height={BH * 0.2} fill={trim} />
  }
  return null
}

const BODY = 'M36 6 Q50 15 64 6 L76 10 L76 92 Q50 98 24 92 L24 10 Z'
const SLEEVE_L = 'M24 10 L36 6 L36 8 L24 34 L16 48 L2 41 L13 15 Z'
const SLEEVE_R = 'M76 10 L64 6 L64 8 L76 34 L84 48 L98 41 L87 15 Z'

export function KitSVG({ kit, size = 120, number, title, className }: { kit: KitDef; size?: number; number?: number | string; title?: string; className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const clip = 'kb' + uid
  const sleeve = kit.pattern === 'sleeves' ? kit.trim : kit.shirt
  const ink = inkOn(kit.shirt)
  return (
    <svg viewBox="0 0 100 150" width={size * 0.667} height={size} className={'kitsvg ' + (className ?? '')} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <defs>
        <clipPath id={clip}><path d={BODY} /></clipPath>
        <linearGradient id={'sh' + uid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.18" /><stop offset="0.55" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity="0.22" />
        </linearGradient>
      </defs>
      {/* socks */}
      {[30, 58].map(x => (
        <g key={x}>
          <path d={`M${x} 124 h12 v20 q0 4 -4 4 h-8 q-3 0 -3 -3 z`} fill={kit.socks} stroke="rgba(0,0,0,.25)" strokeWidth="0.8" />
          <rect x={x} y={127} width={12} height={3} fill={kit.trim} opacity={0.9} />
        </g>
      ))}
      {/* shorts */}
      <path d="M27 98 L73 98 L76 120 L54 122 L50 110 L46 122 L24 120 Z" fill={kit.shorts} stroke="rgba(0,0,0,.25)" strokeWidth="0.8" />
      <path d="M27 98 L24 120" stroke={kit.trim} strokeWidth="2.2" /><path d="M73 98 L76 120" stroke={kit.trim} strokeWidth="2.2" />
      {/* sleeves with cuffs */}
      <path d={SLEEVE_L} fill={sleeve} stroke="rgba(0,0,0,.25)" strokeWidth="0.8" />
      <path d={SLEEVE_R} fill={sleeve} stroke="rgba(0,0,0,.25)" strokeWidth="0.8" />
      <path d="M16 48 L2 41" stroke={kit.pattern === 'sleeves' ? kit.shirt : kit.trim} strokeWidth="3" strokeLinecap="round" />
      <path d="M84 48 L98 41" stroke={kit.pattern === 'sleeves' ? kit.shirt : kit.trim} strokeWidth="3" strokeLinecap="round" />
      {/* body and pattern */}
      <path d={BODY} fill={kit.shirt} />
      <g clipPath={`url(#${clip})`}><Pattern pat={kit.pattern} trim={kit.trim} /></g>
      <path d={BODY} fill={`url(#sh${uid})`} stroke="rgba(0,0,0,.3)" strokeWidth="0.8" />
      {/* collar */}
      <path d="M36 6 Q50 15 64 6" fill="none" stroke={kit.trim} strokeWidth="3.2" strokeLinecap="round" />
      {number != null && (
        <text x="50" y="62" textAnchor="middle" fontFamily='"Saira Condensed", sans-serif' fontWeight="800" fontSize="26" fill={ink}
          stroke={ink === '#ffffff' ? 'rgba(0,0,0,.35)' : 'rgba(255,255,255,.35)'} strokeWidth="0.8">{number}</text>
      )}
    </svg>
  )
}
