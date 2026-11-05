// Shared pieces of the world stage: flags, award and trophy art, confetti, sounds, headline texts.
import { Fragment, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { money } from '../../api'
import type { NewsItem } from '../../api_stage'
import type { Lang } from '../../strings'
import type { TFn } from '../../i18n'
import { Badge, Icon, type IconName } from '../../ui'
import { getSettings } from '../../settings'

// ---------------------------------------------------------------- flags

type FlagDraw = (id: string) => ReactNode
const H3 = (a: string, b: string, c: string) => () => <><rect width="30" height="20" fill={b} /><rect width="30" height="6.67" fill={a} /><rect y="13.33" width="30" height="6.67" fill={c} /></>
const V3 = (a: string, b: string, c: string) => () => <><rect width="30" height="20" fill={b} /><rect width="10" height="20" fill={a} /><rect x="20" width="10" height="20" fill={c} /></>
const nordic = (bg: string, cross: string, inner?: string) => () => (
  <>
    <rect width="30" height="20" fill={bg} />
    <rect x="8" width="5" height="20" fill={cross} /><rect y="7.5" width="30" height="5" fill={cross} />
    {inner && <><rect x="9.25" width="2.5" height="20" fill={inner} /><rect y="8.75" width="30" height="2.5" fill={inner} /></>}
  </>
)

const FLAGS: Record<string, FlagDraw> = {
  ES: () => <><rect width="30" height="20" fill="#c60b1e" /><rect y="5" width="30" height="10" fill="#ffc400" /></>,
  EN: () => <><rect width="30" height="20" fill="#fff" /><rect x="12.5" width="5" height="20" fill="#ce1124" /><rect y="7.5" width="30" height="5" fill="#ce1124" /></>,
  BR: () => <><rect width="30" height="20" fill="#009c3b" /><path d="M15 2.2 27.6 10 15 17.8 2.4 10z" fill="#ffdf00" /><circle cx="15" cy="10" r="4.3" fill="#002776" /><path d="M10.9 9.3c2.8-.6 6-.2 8.2 1.3" stroke="#fff" strokeWidth="0.7" fill="none" /></>,
  FR: V3('#0055a4', '#ffffff', '#ef4135'),
  DE: H3('#000000', '#dd0000', '#ffce00'),
  IT: V3('#009246', '#ffffff', '#ce2b37'),
  PT: () => <><rect width="30" height="20" fill="#ff0000" /><rect width="12" height="20" fill="#006600" /><circle cx="12" cy="10" r="4" fill="none" stroke="#ffcc00" strokeWidth="1.3" /><path d="M10.4 8h3.2v3.2a1.6 1.6 0 0 1-3.2 0z" fill="#fff" stroke="#c00" strokeWidth="0.6" /></>,
  AR: () => <><rect width="30" height="20" fill="#74acdf" /><rect y="6.67" width="30" height="6.67" fill="#fff" /><circle cx="15" cy="10" r="2.3" fill="#f6b40e" stroke="#85340a" strokeWidth="0.3" /></>,
  NL: H3('#ae1c28', '#ffffff', '#21468b'),
  BE: V3('#000000', '#fdda24', '#ef3340'),
  UY: () => <>
    <rect width="30" height="20" fill="#fff" />
    {[1, 3, 5, 7].map(i => <rect key={i} y={(i * 20) / 9} width="30" height={20 / 9} fill="#0038a8" />)}
    <rect width="11" height={(20 / 9) * 5} fill="#fff" /><circle cx="5.5" cy="5.5" r="2.7" fill="#fcd116" stroke="#7b3f00" strokeWidth="0.3" />
  </>,
  NG: V3('#008751', '#ffffff', '#008751'),
  JP: () => <><rect width="30" height="20" fill="#fff" /><circle cx="15" cy="10" r="6" fill="#bc002d" /></>,
  KR: () => <>
    <rect width="30" height="20" fill="#fff" />
    <circle cx="15" cy="10" r="5" fill="#0047a0" /><path d="M10 10a5 5 0 0 1 10 0 2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 0-5 0z" fill="#cd2e3a" />
    <g stroke="#000" strokeWidth="0.9"><path d="M4 4.5l3-2.2M4.7 5.4l3-2.2M5.4 6.3l3-2.2" /><path d="M22 2.5l3 2.2M21.3 3.4l3 2.2M20.6 4.3l3 2.2" /><path d="M4 15.5l3 2.2M4.7 14.6l3 2.2M5.4 13.7l3 2.2" /><path d="M22 17.5l3-2.2M21.3 16.6l3-2.2M20.6 15.7l3-2.2" /></g>
  </>,
  AT: H3('#ed2939', '#ffffff', '#ed2939'),
  CH: () => <><rect width="30" height="20" fill="#d52b1e" /><rect x="12.75" y="4" width="4.5" height="12" fill="#fff" /><rect x="9" y="7.75" width="12" height="4.5" fill="#fff" /></>,
  SC: () => <><rect width="30" height="20" fill="#005eb8" /><path d="M0 0l30 20M30 0 0 20" stroke="#fff" strokeWidth="3.2" /></>,
  WA: () => <><rect width="30" height="20" fill="#00b140" /><rect width="30" height="10" fill="#fff" /><circle cx="15" cy="10" r="4.5" fill="#d30731" /></>,
  DK: nordic('#c60c30', '#ffffff'),
  SE: nordic('#006aa7', '#fecc00'),
  NO: nordic('#ba0c2f', '#ffffff', '#00205b'),
  HR: () => <><rect width="30" height="20" fill="#fff" /><rect width="30" height="6.67" fill="#ff0000" /><rect y="13.33" width="30" height="6.67" fill="#171796" /><rect x="12" y="5" width="6" height="7" fill="#fff" stroke="#ff0000" strokeWidth="0.6" /><path d="M12 5h2v2h-2zM16 5h2v2h-2zM14 7h2v2h-2zM12 9h2v2h-2zM16 9h2v2h-2z" fill="#ff0000" /></>,
  RS: H3('#c6363c', '#0c4076', '#ffffff'),
  PL: () => <><rect width="30" height="20" fill="#dc143c" /><rect width="30" height="10" fill="#fff" /></>,
  TR: () => <><rect width="30" height="20" fill="#e30a17" /><circle cx="12" cy="10" r="5" fill="#fff" /><circle cx="13.3" cy="10" r="4" fill="#e30a17" /><path d="M18.5 10l-2.6.85 1.6-2.2v2.7l-1.6-2.2z" fill="#fff" /></>,
  US: () => <>
    <rect width="30" height="20" fill="#fff" />
    {[0, 2, 4, 6, 8, 10, 12].map(i => <rect key={i} y={(i * 20) / 13} width="30" height={20 / 13} fill="#b22234" />)}
    <rect width="13" height={(20 / 13) * 7} fill="#3c3b6e" />
  </>,
  VN: () => <><rect width="30" height="20" fill="#da251d" /><path d="M15 4.5l1.3 4h4.2l-3.4 2.5 1.3 4L15 12.5 11.6 15l1.3-4-3.4-2.5h4.2z" fill="#ffcd00" /></>,
}

/** A nation's flag (falls back to a plain tile with the code). */
export function Flag({ code, size = 22, title }: { code: string; size?: number; title?: string }) {
  const draw = FLAGS[code]
  return (
    <svg className="sg-flag" width={size * 1.5} height={size} viewBox="0 0 30 20" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {draw ? draw(code) : <><rect width="30" height="20" fill="#3a4a5a" /><text x="15" y="13.5" textAnchor="middle" fontSize="8" fontWeight="800" fill="#fff">{code}</text></>}
      <rect width="30" height="20" fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth="0.8" />
    </svg>
  )
}

/** Kit colours of the national teams (for glows and confetti). */
export const NATION_COLORS: Record<string, [string, string]> = {
  ES: ['#c60b1e', '#ffc400'], EN: ['#ffffff', '#ce1124'], BR: ['#ffdf00', '#009c3b'], FR: ['#0055a4', '#ef4135'], DE: ['#ffffff', '#000000'],
  IT: ['#0066cc', '#ffffff'], PT: ['#c8102e', '#006600'], AR: ['#74acdf', '#ffffff'], NL: ['#ff7f00', '#21468b'], BE: ['#ef3340', '#fdda24'],
  UY: ['#5cbfeb', '#ffffff'], NG: ['#008751', '#ffffff'], JP: ['#1d3c8f', '#ffffff'], KR: ['#cd2e3a', '#0047a0'], AT: ['#ed2939', '#ffffff'],
  CH: ['#d52b1e', '#ffffff'], SC: ['#005eb8', '#ffffff'], WA: ['#d30731', '#00b140'], DK: ['#c60c30', '#ffffff'], SE: ['#fecc00', '#006aa7'],
  NO: ['#ba0c2f', '#00205b'], HR: ['#ff0000', '#ffffff'], RS: ['#c6363c', '#0c4076'], PL: ['#ffffff', '#dc143c'], TR: ['#e30a17', '#ffffff'],
}
export const nationColors = (code: string): [string, string] => NATION_COLORS[code] ?? ['#ffd23f', '#38e1ff']

// ---------------------------------------------------------------- award and trophy art

export type AwardKey = 'ball' | 'boy' | 'glove' | 'boot' | 'manager'

/** Award art: the golden ball, the golden boy's ball with a star, the glove, the boot, the manager's plate. */
export function AwardArt({ kind, size = 120 }: { kind: AwardKey; size?: number }) {
  const uid = useMemo(() => 'sg' + Math.random().toString(36).slice(2, 8), [])
  const gold = `url(#${uid}g)`
  const defs = (
    <defs>
      <radialGradient id={uid + 'g'} cx="38%" cy="32%" r="70%">
        <stop offset="0" stopColor="#fffbe0" /><stop offset="0.35" stopColor="#ffd84a" /><stop offset="0.75" stopColor="#d99a0b" /><stop offset="1" stopColor="#7a4e00" />
      </radialGradient>
      <linearGradient id={uid + 'b'} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3b2a12" /><stop offset="1" stopColor="#140d04" /></linearGradient>
    </defs>
  )
  const stand = (
    <>
      <path d="M48 96h24l5 10H43z" fill={gold} />
      <rect x="36" y="106" width="48" height="14" rx="2" fill={`url(#${uid}b)`} stroke="#6b4a14" strokeWidth="1.2" />
      <rect x="46" y="110" width="28" height="5" rx="1" fill="#ffd84a" opacity="0.8" />
    </>
  )
  let art: ReactNode
  switch (kind) {
    case 'ball':
    case 'boy':
      art = (
        <>
          <circle cx="60" cy="54" r="40" fill={gold} stroke="#8a5a00" strokeWidth="1.5" />
          <path d="M60 33l13 9.5-5 15.5H52l-5-15.5z" fill="#b97a06" opacity="0.55" />
          <path d="M60 33V16M73 42.5l15-6M68 58l10 13M52 58l-10 13M47 42.5l-15-6" stroke="#9b6505" strokeWidth="2" opacity="0.5" />
          <ellipse cx="46" cy="36" rx="12" ry="7" fill="#fff" opacity="0.45" transform="rotate(-30 46 36)" />
          {kind === 'boy' && <path d="M60 64l3.6 7.3 8 1.2-5.8 5.6 1.4 8-7.2-3.8-7.2 3.8 1.4-8-5.8-5.6 8-1.2z" fill="#fff8d6" stroke="#8a5a00" strokeWidth="1" />}
          {stand}
        </>
      )
      break
    case 'glove':
      art = (
        <>
          <path d="M34 66V34a6 6 0 0 1 12 0v18-26a6 6 0 0 1 12 0v24-28a6 6 0 0 1 12 0v28-22a6 6 0 0 1 12 0v40c0 18-11 28-26 28S30 90 30 80l-8-14a6 6 0 0 1 10-6z" fill={gold} stroke="#8a5a00" strokeWidth="1.5" />
          <path d="M40 80h40" stroke="#9b6505" strokeWidth="2.5" opacity="0.6" />
          <ellipse cx="52" cy="30" rx="4" ry="9" fill="#fff" opacity="0.4" />
          {stand}
        </>
      )
      break
    case 'boot':
      art = (
        <>
          <path d="M30 30h26v26l26 9c7 2.4 10 7 10 12v9H26a6 6 0 0 1-6-6v-6c9 0 14-6 14-14z" fill={gold} stroke="#8a5a00" strokeWidth="1.5" />
          <path d="M24 92h8M40 92h8M56 92h8M72 92h8" stroke="#9b6505" strokeWidth="4" strokeLinecap="round" />
          <path d="M56 40h-10M56 48h-10" stroke="#9b6505" strokeWidth="2" />
          <ellipse cx="40" cy="38" rx="5" ry="9" fill="#fff" opacity="0.4" />
          {stand}
        </>
      )
      break
    default:
      art = (
        <>
          <path d="M60 12l40 14v26c0 24-17 40-40 46-23-6-40-22-40-46V26z" fill={gold} stroke="#8a5a00" strokeWidth="1.5" />
          <path d="M38 50l10-12 12 10 12-10 10 12-4 16H42z" fill="#fff8d6" stroke="#8a5a00" strokeWidth="1.2" />
          <path d="M44 74h32" stroke="#8a5a00" strokeWidth="3" />
          <ellipse cx="46" cy="30" rx="9" ry="5" fill="#fff" opacity="0.4" transform="rotate(-20 46 30)" />
          {stand}
        </>
      )
  }
  return <svg className="sg-art" width={size} height={size} viewBox="0 0 120 124" aria-hidden="true">{defs}{art}</svg>
}

/** International trophy art: the world's gold trophy with a globe, or the European silver cup. */
export function CupArt({ kind, size = 130 }: { kind: 'world' | 'euro'; size?: number }) {
  const uid = useMemo(() => 'sc' + Math.random().toString(36).slice(2, 8), [])
  const metal = kind === 'world' ? ['#fff6c2', '#ffd23f', '#a8750c'] : ['#ffffff', '#cfd9e6', '#6f7f91']
  const fill = `url(#${uid})`
  return (
    <svg className="sg-art" width={size} height={size} viewBox="0 0 120 130" aria-hidden="true">
      <defs>
        <linearGradient id={uid} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={metal[0]} /><stop offset="0.5" stopColor={metal[1]} /><stop offset="1" stopColor={metal[2]} /></linearGradient>
      </defs>
      {kind === 'world' ? (
        <>
          <circle cx="60" cy="26" r="20" fill={fill} stroke={metal[2]} strokeWidth="1.5" />
          <path d="M44 22c8 4 24 4 32 0M42 32c10 4 26 4 36 0M60 6v40" stroke={metal[2]} strokeWidth="1.4" fill="none" opacity="0.6" />
          <path d="M42 40c-6 14 4 22 8 34s-4 22-4 30h28c0-8-8-18-4-30s14-20 8-34c-6 8-14 10-18 10s-12-2-18-10z" fill={fill} stroke={metal[2]} strokeWidth="1.5" />
          <path d="M50 52c4 8 2 20 0 30M70 52c-4 8-2 20 0 30" stroke={metal[2]} strokeWidth="1.4" fill="none" opacity="0.55" />
          <rect x="42" y="104" width="36" height="8" rx="2" fill="#0f6b3a" />
          <rect x="38" y="112" width="44" height="12" rx="2" fill={fill} stroke={metal[2]} strokeWidth="1.2" />
          <ellipse cx="52" cy="18" rx="6" ry="4" fill="#fff" opacity="0.5" />
        </>
      ) : (
        <>
          <path d="M30 18h60v8c0 30-14 48-30 52-16-4-30-22-30-52z" fill={fill} stroke={metal[2]} strokeWidth="1.5" />
          <path d="M30 24C14 22 12 52 34 58M90 24c16-2 18 28-4 34" stroke={fill} strokeWidth="6" fill="none" strokeLinecap="round" />
          <rect x="54" y="78" width="12" height="20" fill={fill} />
          <path d="M40 98h40l6 12H34z" fill={fill} stroke={metal[2]} strokeWidth="1.2" />
          <rect x="32" y="110" width="56" height="12" rx="2" fill="#1f2d3d" stroke={metal[2]} strokeWidth="1.2" />
          <path d="M38 26h8v24c0 10 3 18 8 24-11-6-16-14-16-24z" fill="#fff" opacity="0.35" />
        </>
      )}
    </svg>
  )
}

// ---------------------------------------------------------------- confetti

export function Confetti({ colors, n = 90, seed }: { colors: string[]; n?: number; seed?: string | number }) {
  const pieces = useMemo(() => Array.from({ length: n }, (_, i) => ({
    left: Math.random() * 100, delay: Math.random() * 2.6, dur: 2.8 + Math.random() * 2.6, size: 6 + Math.random() * 7,
    rot: Math.random() * 360, drift: (Math.random() - 0.5) * 160, color: colors[i % colors.length], round: i % 4 === 0,
  })), [seed, n])
  return (
    <div className="sg-confetti" aria-hidden="true">
      {pieces.map((p, i) => (
        <i key={i} style={{
          left: p.left + '%', width: p.size, height: p.round ? p.size : p.size * 0.45, background: p.color, borderRadius: p.round ? '50%' : 2,
          animationDelay: p.delay + 's', animationDuration: p.dur + 's', ['--rot' as string]: p.rot + 'deg', ['--drift' as string]: p.drift + 'px',
        }} />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- sounds (Web Audio, only when sound is on)

let actx: AudioContext | null = null
function audio(): { ctx: AudioContext; vol: number } | null {
  const s = getSettings()
  if (!s.sound || s.volume <= 0) return null
  try {
    if (!actx) actx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    if (actx.state === 'suspended') void actx.resume()
    return { ctx: actx, vol: s.volume }
  } catch { return null }
}

function tone(ctx: AudioContext, out: AudioNode, freq: number, at: number, dur: number, gain: number, type: OscillatorType = 'sawtooth') {
  const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter()
  o.type = type
  o.frequency.setValueAtTime(freq, at)
  f.type = 'lowpass'
  f.frequency.setValueAtTime(2400, at)
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(gain, at + 0.03)
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  o.connect(f).connect(g).connect(out)
  o.start(at)
  o.stop(at + dur + 0.05)
}

function noise(ctx: AudioContext, out: AudioNode, at: number, dur: number, gain: number, hp = 5000) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur))
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len)
  const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain()
  src.buffer = buf
  f.type = 'highpass'
  f.frequency.value = hp
  g.gain.value = gain
  src.connect(f).connect(g).connect(out)
  src.start(at)
}

/** A short brass fanfare with a cymbal: the big moment. */
export function playFanfare() {
  const a = audio()
  if (!a) return
  const { ctx, vol } = a
  const out = ctx.createGain()
  out.gain.value = 0.22 * vol
  out.connect(ctx.destination)
  const t0 = ctx.currentTime + 0.02
  const notes: [number, number, number][] = [[392, 0, 0.16], [523.25, 0.14, 0.16], [659.25, 0.28, 0.16], [783.99, 0.42, 0.9], [1046.5, 0.42, 0.9]]
  for (const [f, at, d] of notes) {
    tone(ctx, out, f, t0 + at, d, 0.5)
    tone(ctx, out, f / 2, t0 + at, d, 0.25, 'square')
  }
  noise(ctx, out, t0 + 0.42, 1.4, 0.35)
}

/** A rising drum roll before the winner is named. */
export function playDrumRoll(seconds = 1.4) {
  const a = audio()
  if (!a) return
  const { ctx, vol } = a
  const out = ctx.createGain()
  out.gain.value = 0.18 * vol
  out.connect(ctx.destination)
  const t0 = ctx.currentTime + 0.02
  for (let t = 0; t < seconds; t += 0.055) noise(ctx, out, t0 + t, 0.05, 0.25 + 0.6 * (t / seconds), 900)
}

/** A soft swish for each reveal. */
export function playReveal() {
  const a = audio()
  if (!a) return
  const { ctx, vol } = a
  const out = ctx.createGain()
  out.gain.value = 0.12 * vol
  out.connect(ctx.destination)
  const t0 = ctx.currentTime + 0.01
  noise(ctx, out, t0, 0.25, 0.4, 2500)
  tone(ctx, out, 880, t0 + 0.05, 0.25, 0.25, 'triangle')
}

// ---------------------------------------------------------------- keys

/** Enter / Space → next, Escape → skip, while a stage pop-up is open. Presses closer than 220 ms count once. */
export function useStageKeys(onNext: () => void, onSkip: () => void, active = true) {
  const next = useRef(onNext), skip = useRef(onSkip), last = useRef(0)
  next.current = onNext
  skip.current = onSkip
  useEffect(() => {
    if (!active) return
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'Escape') { e.preventDefault(); skip.current(); return }
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault()
        const now = performance.now()
        if (now - last.current < 220) return
        last.current = now
        next.current()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [active])
}

export const reduceMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// ---------------------------------------------------------------- headline texts

/** "16th" in English; the other languages write the number in their own phrase. */
export function ordinal(lang: Lang, n: number) {
  if (lang !== 'en') return String(n)
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'
  return n + s
}

/** Fill a template's {placeholders}; the keys in `bold` come out in bold. */
export function rich(tpl: string, params: Record<string, string | number>, bold: string[] = []): ReactNode {
  const parts = tpl.split(/\{(\w+)\}/)
  return parts.map((p, i) => {
    if (i % 2 === 0) return <Fragment key={i}>{p}</Fragment>
    const v = params[p] ?? `{${p}}`
    return bold.includes(p) ? <b key={i}>{v}</b> : <Fragment key={i}>{v}</Fragment>
  })
}

export interface Headline { key: string; params: Record<string, string | number>; bold: string[]; icon: IconName; tone: string }

/** How a news item reads: template key, its parameters, the icon and the colour of its kind. */
export function headline(t: TFn, lang: Lang, n: NewsItem): Headline {
  const p = n.params ?? {}
  const num = (k: string) => Number(p[k] ?? 0)
  const base: Record<string, string | number> = {
    a: n.from ?? '', b: n.to ?? '', p: n.player ?? '', coach: n.coach ?? '', fee: money(n.fee ?? 0), s: n.season,
    league: String(p.league ?? ''), n: num('n'), left: num('left'), pts: num('pts'), gap: num('gap'),
  }
  const bold = ['a', 'b', 'p', 'coach', 'nation']
  switch (n.kind) {
    case 'transfer':
      return { key: 'nw.transfer', params: { ...base, ovr: n.ovr ?? '' }, bold, icon: 'market', tone: 'transfer' }
    case 'sacked':
      return { key: 'nw.sacked', params: { ...base, a: n.from ?? '', coach: n.coach ?? '', b: n.to ?? '' }, bold, icon: 'fire', tone: 'sacked' }
    case 'award':
      return { key: 'nw.award.' + (n.story ?? 'ball'), params: { ...base, goals: num('goals'), cs: num('cs'), pos: ordinal(lang, num('pos')), exp: ordinal(lang, num('exp')) }, bold, icon: 'legend', tone: 'award' }
    case 'intl': {
      const cup = t('in.' + (p.kind === 'euro' ? 'euro' : 'world'))
      const nation = t('nation.' + String(p.nation ?? ''))
      if (n.story === 'scorer') return { key: 'nw.intl.scorer', params: { ...base, cup, nation }, bold, icon: 'goal', tone: 'intl' }
      const score = String(p.score ?? '') + (p.pens ? ' ' + t('nw.onPens') : '')
      return { key: p.kind === 'euro' ? 'nw.intl.champEuro' : 'nw.intl.champWorld', params: { ...base, cup, nation, runnerUp: t('nation.' + String(p.runnerUp ?? '')), score }, bold: [...bold, 'runnerUp'], icon: 'flag', tone: 'intl' }
    }
  }
  const v = String(p.v ?? '')
  switch (n.story) {
    case 'title': return { key: 'nw.st.title.' + (v || 'lead'), params: base, bold, icon: 'crown', tone: 'title' }
    case 'title_won': return { key: 'nw.st.titleWon', params: base, bold, icon: 'cup', tone: 'title' }
    case 'relegation': return { key: 'nw.st.releg.' + (v || 'gap'), params: base, bold, icon: 'down', tone: 'releg' }
    case 'relegated': return { key: 'nw.st.relegated', params: base, bold, icon: 'down', tone: 'releg' }
    case 'pressure': return { key: 'nw.st.pressure', params: { ...base, pos: ordinal(lang, num('pos')), exp: ordinal(lang, num('exp')) }, bold, icon: 'warn', tone: 'pressure' }
    case 'streak': return { key: v === 'losses' ? 'nw.st.losses' : 'nw.st.wins', params: base, bold, icon: v === 'losses' ? 'down' : 'flame', tone: v === 'losses' ? 'releg' : 'streak' }
    case 'scorers': return { key: 'nw.st.scorers.' + (v || 'lead'), params: { ...base, b: String(p.b ?? '') }, bold, icon: 'goal', tone: 'scorers' }
    case 'giant': {
      const score = String(p.score ?? '') + (p.pens ? ' · ' + t('nw.pens', { s: String(p.pens) }) : '')
      return { key: 'nw.st.giant', params: { ...base, div: num('div'), score, country: t('nation.' + String(p.cup ?? n.league ?? '')) }, bold, icon: 'strength', tone: 'giant' }
    }
    case 'record': return { key: 'nw.st.record', params: { ...base, prev: money(num('prev')) }, bold, icon: 'coins', tone: 'record' }
    case 'champions': return { key: 'nw.st.champions', params: base, bold, icon: 'cup', tone: 'title' }
  }
  return { key: 'nw.st.unknown', params: base, bold, icon: 'info', tone: 'story' }
}

/** A headline as rich text (names in bold). */
export function HeadlineText({ t, lang, n }: { t: TFn; lang: Lang; n: NewsItem }) {
  const h = headline(t, lang, n)
  return <>{rich(t(h.key), h.params, h.bold)}</>
}

/** The clubs of a headline (the flag of the nation for a tournament headline). */
export function NewsCrests({ n, size = 30 }: { n: NewsItem; size?: number }) {
  if (n.kind === 'intl' && n.params?.nation) return <span className="sg-crests"><Flag code={String(n.params.nation)} size={Math.round(size * 0.72)} /></span>
  return (
    <span className="sg-crests">
      {n.fromShort && <Badge short={n.fromShort} color={n.fromColor ?? '#888'} color2={n.fromColor2} size={size} />}
      {n.toShort && <>{n.kind === 'transfer' && <Icon name="next" size={14} />}<Badge short={n.toShort} color={n.toColor ?? '#888'} color2={n.toColor2} size={Math.round(size * (n.kind === 'transfer' ? 1 : 0.78))} /></>}
    </span>
  )
}

/** "Season 2 · Matchday 14" / "Season 2 · Summer". */
export function whenText(t: TFn, n: { season: number; day: number }) {
  return n.day > 0 ? t('nw.when', { s: n.season, d: n.day }) : t('nw.whenSummer', { s: n.season })
}
