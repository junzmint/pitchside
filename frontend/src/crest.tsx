import { useId } from 'react'

// Club crests drawn as SVG, chosen deterministically from the club's short name and colours, so
// the same club always wears the same crest on every page: a shield shape, a kit pattern, a band
// with the short name, an optional star or ball, a metal rim with a bevel and a soft shine.
// Small sizes (HUD, knockout road, lists) drop the emblem and grow the lettering to stay readable.

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15
  return h >>> 0
}

function rgb(hex: string): [number, number, number] {
  let s = (hex || '').replace('#', '').trim()
  if (s.length === 3) s = s.split('').map(c => c + c).join('')
  const n = parseInt(s, 16)
  if (!Number.isFinite(n) || s.length !== 6) return [58, 74, 64]
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const luma = (hex: string) => { const [r, g, b] = rgb(hex); return r * 0.299 + g * 0.587 + b * 0.114 }
function mix(a: string, b: string, k: number) {
  const x = rgb(a), y = rgb(b)
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * k))
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('')
}

export type CrestShape = 'heater' | 'round' | 'angular' | 'square' | 'peaked'
export type CrestPattern = 'stripes' | 'halves' | 'sash' | 'hoops' | 'chevron' | 'quarters' | 'plain'
type Emblem = 'star' | 'stars3' | 'ball' | 'none'
type Rim = 'gold' | 'silver' | 'kit'

const SHAPES: CrestShape[] = ['heater', 'round', 'angular', 'square', 'peaked']
const PATTERNS: CrestPattern[] = ['stripes', 'halves', 'sash', 'hoops', 'chevron', 'quarters', 'plain']
const EMBLEMS: Emblem[] = ['star', 'ball', 'none', 'stars3', 'star', 'ball']
const RIMS: Rim[] = ['gold', 'silver', 'kit', 'gold']

// all shapes sit in a 100×100 box, centred on x = 50
const PATH: Record<CrestShape, string> = {
  heater: 'M12 8H88V45C88 70 72 87 50 97C28 87 12 70 12 45Z',
  round: 'M6 52A44 44 0 1 0 94 52A44 44 0 1 0 6 52Z',
  angular: 'M50 4L90 14V57L50 97L10 57V14Z',
  square: 'M28 8H72Q92 8 92 28V72Q92 92 72 92H28Q8 92 8 72V28Q8 8 28 8Z',
  peaked: 'M50 3C62 11 76 12 90 9V50C90 74 72 89 50 97C28 89 10 74 10 50V9C24 12 38 11 50 3Z',
}
// where the name band sits (its vertical centre) for each shape
const BAND_Y: Record<CrestShape, number> = { heater: 47, round: 52, angular: 51, square: 50, peaked: 49 }

export interface CrestLook { shape: CrestShape; pattern: CrestPattern; emblem: Emblem; rim: Rim; band: 'dark' | 'kit' }

/** The crest a club wears (stable for its short name and colours). */
export function crestLook(short: string, color: string, color2?: string): CrestLook {
  const h = hash(`${short.toUpperCase()}|${color.toLowerCase()}|${(color2 ?? '').toLowerCase()}`)
  return {
    shape: SHAPES[h % SHAPES.length],
    pattern: PATTERNS[(h >>> 4) % PATTERNS.length],
    emblem: EMBLEMS[(h >>> 9) % EMBLEMS.length],
    rim: RIMS[(h >>> 13) % RIMS.length],
    band: (h >>> 17) % 3 === 0 ? 'kit' : 'dark',
  }
}

function star(cx: number, cy: number, r: number) {
  const pts: string[] = []
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rr = i % 2 ? r * 0.45 : r
    pts.push(`${(cx + Math.cos(a) * rr).toFixed(2)},${(cy + Math.sin(a) * rr).toFixed(2)}`)
  }
  return pts.join(' ')
}

function Pattern({ p, c2 }: { p: CrestPattern; c2: string }) {
  switch (p) {
    case 'stripes': return <g fill={c2}>{[15, 35, 55, 75].map(x => <rect key={x} x={x} y={0} width={10} height={100} />)}</g>
    case 'halves': return <rect x={50} y={0} width={50} height={100} fill={c2} />
    case 'sash': return <polygon points="-8,12 12,-8 108,88 88,108" fill={c2} />
    case 'hoops': return <g fill={c2}>{[4, 22, 70, 88].map(y => <rect key={y} x={0} y={y} width={100} height={9} />)}</g>
    case 'chevron': return <polygon points="0,10 50,38 100,10 100,26 50,54 0,26" fill={c2} />
    case 'quarters': return <g fill={c2}><rect x={50} y={0} width={50} height={50} /><rect x={0} y={50} width={50} height={50} /></g>
    default: return null
  }
}

function Ball({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  const k = r / 10
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="#ffffff" stroke="#0b1218" strokeWidth={1.6} />
      <path d={`M${cx} ${cy - 4.3 * k}l${4.1 * k} ${3 * k}-${1.6 * k} ${4.8 * k}h-${5 * k}l-${1.6 * k}-${4.8 * k}z`} fill="#0b1218" />
      <path d={`M${cx} ${cy - 4.3 * k}V${cy - 10 * k}M${cx + 4.1 * k} ${cy - 1.3 * k}l${5.4 * k}-${1.8 * k}M${cx + 2.5 * k} ${cy + 3.5 * k}l${3.4 * k} ${4.6 * k}M${cx - 2.5 * k} ${cy + 3.5 * k}l-${3.4 * k} ${4.6 * k}M${cx - 4.1 * k} ${cy - 1.3 * k}l-${5.4 * k}-${1.8 * k}`}
        stroke="#0b1218" strokeWidth={1.1} fill="none" />
    </g>
  )
}

/** A club crest of `size` pixels. Readable from about 20 px, detailed from about 60 px. */
export function Crest({ short, color, color2, size = 44, className }: { short: string; color: string; color2?: string; size?: number; className?: string }) {
  const uid = 'cr' + useId().replace(/[^a-zA-Z0-9]/g, '')
  const look = crestLook(short, color, color2)
  const small = size < 40
  const c1 = color || '#3a4a40'
  let c2 = color2 || (luma(c1) > 150 ? '#14202b' : '#ffffff')
  if (Math.abs(luma(c1) - luma(c2)) < 26) c2 = luma(c1) > 128 ? mix(c1, '#000000', 0.55) : mix(c1, '#ffffff', 0.7)
  // the name band: a dark shade of the main colour, or the second colour on some crests
  const lightKit = luma(c1) > 200
  let band = look.band === 'kit' || lightKit ? c2 : mix(c1, '#05090d', 0.45)
  if (lightKit && luma(band) > 170) band = '#1b2733'
  const ink = luma(band) > 150 ? (!small && luma(c1) < 100 ? c1 : '#10161c') : '#ffffff'
  const rimStops = look.rim === 'silver' ? ['#ffffff', '#b9c4cf', '#5d6b78']
    : look.rim === 'kit' && Math.abs(luma(c2) - luma(c1)) > 60 ? [mix(c2, '#ffffff', 0.45), c2, mix(c2, '#000000', 0.45)]
      : ['#fff3b0', '#e2b33a', '#7a5a10']
  const path = PATH[look.shape]
  const by = BAND_Y[look.shape]
  const bh = small ? 42 : 27
  const text = short.toUpperCase().slice(0, 4)
  const n = [...text].length
  const fs = small ? ({ 1: 50, 2: 46, 3: 39, 4: 31 } as Record<number, number>)[n] ?? 31 : ({ 1: 38, 2: 34, 3: 28, 4: 23 } as Record<number, number>)[n] ?? 23
  const emblem = small ? 'none' : look.emblem
  return (
    <svg className={'crest-svg' + (className ? ' ' + className : '')} width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={short}>
      <defs>
        <clipPath id={uid + 'c'}><path d={path} /></clipPath>
        <linearGradient id={uid + 'r'} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor={rimStops[0]} /><stop offset="0.45" stopColor={rimStops[1]} /><stop offset="1" stopColor={rimStops[2]} />
        </linearGradient>
        <linearGradient id={uid + 's'} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.42" /><stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={uid + 'd'} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.55" stopColor="#000000" stopOpacity="0" /><stop offset="1" stopColor="#000000" stopOpacity="0.32" />
        </linearGradient>
      </defs>
      <g clipPath={`url(#${uid}c)`}>
        <rect x={0} y={0} width={100} height={100} fill={c1} />
        <Pattern p={look.pattern} c2={c2} />
        {look.pattern === 'plain' && <path d={path} fill="none" stroke={c2} strokeWidth={small ? 5 : 3.2} transform="translate(50 52) scale(0.8) translate(-50 -52)" />}
        {emblem === 'star' && <polygon points={star(50, by - bh / 2 - 13, 9.5)} fill="#ffd23f" stroke="#3a2a00" strokeWidth={1.2} strokeLinejoin="round" />}
        {emblem === 'stars3' && [[36, 3], [50, 0], [64, 3]].map(([x, dy]) => <polygon key={x} points={star(x, by - bh / 2 - 10 - dy, 5.6)} fill="#ffd23f" stroke="#3a2a00" strokeWidth={0.9} strokeLinejoin="round" />)}
        {emblem === 'ball' && <Ball cx={50} cy={by + bh / 2 + 15} r={9} />}
        <rect x={0} y={by - bh / 2} width={100} height={bh} fill={band} />
        <rect x={0} y={by - bh / 2 - 1.4} width={100} height={2.6} fill={`url(#${uid}r)`} />
        <rect x={0} y={by + bh / 2 - 1.2} width={100} height={2.6} fill={`url(#${uid}r)`} />
        <text x={50} y={by + 0.5} textAnchor="middle" dominantBaseline="central" fontSize={fs} fontWeight={800} fill={ink}
          stroke={ink === '#ffffff' ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.25)'} strokeWidth={small ? 2.4 : 1.6} paintOrder="stroke"
          style={{ fontFamily: 'var(--display)', fontStyle: 'italic', letterSpacing: n >= 4 ? 0 : 0.6 }}>{text}</text>
        <path d="M-2 -2H102V38Q50 54 -2 40Z" fill={`url(#${uid}s)`} />
        <rect x={0} y={0} width={100} height={100} fill={`url(#${uid}d)`} />
        <path d={path} fill="none" stroke={`url(#${uid}r)`} strokeWidth={small ? 11 : 8} />
        <path d={path} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth={1.2} transform={`translate(50 52) scale(${small ? 0.89 : 0.92}) translate(-50 -52)`} />
      </g>
      <path d={path} fill="none" stroke="#05090d" strokeWidth={small ? 3.4 : 2.4} strokeLinejoin="round" />
    </svg>
  )
}
