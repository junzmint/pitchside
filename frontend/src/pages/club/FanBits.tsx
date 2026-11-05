// Club life: the fans' face, mood meter and voice (chant, banner or social post).
import { Music, Heart, MessageCircle } from 'lucide-react'
import type { FanVoice, FanNote } from '../../api_club'
import { useI18n, type TFn } from '../../i18n'

export const MOOD_COLORS = ['#ff5a5f', '#ff9a3d', '#ffd23f', '#7ee08a', '#38e1ff']
export const bandOf = (m: number) => (m < 20 ? 0 : m < 40 ? 1 : m < 60 ? 2 : m < 80 ? 3 : 4)

/** A face that morphs with the mood: brows, eyes and mouth follow the number. */
export function FanFace({ mood, size = 72 }: { mood: number; size?: number }) {
  const b = bandOf(mood)
  const col = MOOD_COLORS[b]
  const k = (Math.max(0, Math.min(100, mood)) - 50) / 50 // from -1 to 1
  const curve = 30 * k // mouth curvature
  const open = mood >= 80
  return (
    <svg className={'cl-face b' + b} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <radialGradient id={'clf' + b} cx="38%" cy="32%" r="70%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="45%" stopColor={col} />
          <stop offset="100%" stopColor={col} stopOpacity="0.75" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="29" fill={`url(#clf${b})`} stroke="rgba(0,0,0,0.35)" strokeWidth="2" />
      {/* brows: angry slant when furious, worried when upset */}
      {b === 0 && <path d="M15 20 L27 25 M49 20 L37 25" stroke="#2a0d0d" strokeWidth="3.4" strokeLinecap="round" />}
      {b === 1 && <path d="M17 23 L27 20 M47 23 L37 20" stroke="#2a1606" strokeWidth="2.6" strokeLinecap="round" />}
      {b === 4
        ? <path d="M17 29 Q22 21 27 29 M37 29 Q42 21 47 29" stroke="#062a1a" strokeWidth="3.2" fill="none" strokeLinecap="round" />
        : <><ellipse cx="22" cy="29" rx="3.2" ry={b === 0 ? 2.6 : 4} fill="#111a16" /><ellipse cx="42" cy="29" rx="3.2" ry={b === 0 ? 2.6 : 4} fill="#111a16" /></>}
      {open
        ? <path d={`M18 39 Q32 ${39 + curve * 0.75} 46 39 Z`} fill="#3a0f0f" stroke="#111" strokeWidth="2" strokeLinejoin="round" />
        : <path d={`M19 ${43 - curve * 0.12} Q32 ${43 + curve * 0.5} 45 ${43 - curve * 0.12}`} stroke="#111a16" strokeWidth="3.2" fill="none" strokeLinecap="round" />}
      {b === 4 && <path d="M23 42 Q32 47 41 42" stroke="#ffffff" strokeOpacity="0.9" strokeWidth="2" fill="none" />}
      {b >= 3 && <><circle cx="15" cy="38" r="3.4" fill="#ff7b9c" opacity="0.45" /><circle cx="49" cy="38" r="3.4" fill="#ff7b9c" opacity="0.45" /></>}
    </svg>
  )
}

/** The mood bar from furious to ecstatic, five small faces under it and a pin at the mood. */
export function MoodMeter({ mood }: { mood: number }) {
  const { t } = useI18n()
  const m = Math.max(0, Math.min(100, mood))
  return (
    <div className="cl-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(m)} aria-label={t('cl.fans.mood')}>
      <div className="cl-meter-bar"><i className="cl-pin" style={{ left: `${m}%` }} /></div>
      <div className="cl-meter-faces">
        {[10, 30, 50, 70, 90].map((v, i) => (
          <span key={i} className={bandOf(m) === i ? 'on' : ''} data-tip={t('cl.band.' + i)}><FanFace mood={v} size={22} /></span>
        ))}
      </div>
    </div>
  )
}

/** How many variants a voice line has (cl.v.<key>.0, .1 and so on). */
function variants(t: TFn, key: string) {
  let n = 0
  while (n < 6 && t(`cl.v.${key}.${n}`) !== `cl.v.${key}.${n}`) n++
  return n
}

export function voiceText(t: TFn, v: FanVoice, club: string) {
  const key = /^g\d[a-z]$/.test(v.key) ? v.key.slice(0, 2) : v.key // early saves stored the variant in the key
  const n = variants(t, key)
  if (n === 0) return ''
  return t(`cl.v.${key}.${Math.abs(v.seed) % n}`, { name: v.name ?? '', n: v.n ?? '', club })
}

const HANDLES = ['{s}_ultras', 'true_{s}', '{s}fan1987', '{s}_til_i_die', 'northstand_{s}', '{s}_matchday']

function luma(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16) || 0
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114
}
/** Banner lettering that stays readable on the club colour. */
function inkOn(bg: string, want: string) {
  if (Math.abs(luma(want) - luma(bg)) >= 110) return want
  return luma(bg) > 150 ? '#111111' : '#ffffff'
}

/** What the stands are saying: a chant, a banner or a post on social media. */
export function FanVoiceView({ v, club, short, color, color2 }: { v: FanVoice; club: string; short: string; color: string; color2: string }) {
  const { t } = useI18n()
  const text = voiceText(t, v, club)
  if (!text) return null
  const s = short.toLowerCase().replace(/[^a-z0-9]/g, '') || 'fc'
  if (v.style === 'banner') {
    return (
      <figure className="cl-voice cl-banner" style={{ ['--b1' as string]: color, ['--b2' as string]: color2, ['--ink2' as string]: inkOn(color, color2) }} aria-label={t('cl.voice.banner')}>
        <span className="cl-rope l" aria-hidden="true" /><span className="cl-rope r" aria-hidden="true" />
        <blockquote>{text}</blockquote>
      </figure>
    )
  }
  if (v.style === 'post') {
    const seed = Math.abs(v.seed)
    const handle = '@' + HANDLES[seed % HANDLES.length].replace('{s}', s)
    const likes = 40 + ((seed * 7919) % 2400)
    return (
      <figure className="cl-voice cl-post" aria-label={t('cl.voice.post')}>
        <span className="cl-avatar" style={{ background: color, color: inkOn(color, color2) }} aria-hidden="true">{short.slice(0, 3)}</span>
        <div className="cl-post-body">
          <b className="cl-handle">{handle}</b>
          <blockquote>{text}</blockquote>
          <span className="cl-post-meta" aria-hidden="true"><Heart size={13} /> {likes.toLocaleString()} <MessageCircle size={13} /> {Math.round(likes / 9)}</span>
        </div>
      </figure>
    )
  }
  return (
    <figure className="cl-voice cl-chant" aria-label={t('cl.voice.chant')}>
      <Music size={20} className="cl-note" aria-hidden="true" />
      <blockquote>{text}</blockquote>
      <Music size={16} className="cl-note r" aria-hidden="true" />
    </figure>
  )
}

/** One reason the mood moved, as a small signed chip. */
export function NoteChip({ n }: { n: FanNote }) {
  const { t, lang } = useI18n()
  const loc = lang === 'vi' ? 'vi-VN' : lang === 'ja' ? 'ja-JP' : 'en-GB'
  const v = Math.round(n.v * 10) / 10
  const tone = v > 0 ? 'good' : v < 0 ? 'bad' : ''
  return (
    <span className={'flag cl-note-chip ' + tone}>
      {t('cl.note.' + n.key, { name: n.name ?? '', n: n.n ?? '' })}
      {v !== 0 && <b className="num">{v > 0 ? '+' : '−'}{Math.abs(v).toLocaleString(loc, { maximumFractionDigits: 1 })}</b>}
    </span>
  )
}

/** A tiny line of the mood over the season. */
export function MoodTrend({ trend }: { trend: number[] }) {
  const { t } = useI18n()
  if (trend.length < 2) return null
  const w = 200, h = 40
  const pts = trend.map((v, i) => `${(i / (trend.length - 1)) * w},${h - (v / 100) * h}`).join(' ')
  return (
    <div className="cl-trend" data-tip={t('cl.fans.trend')}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" x2={w} y1={h * 0.2} y2={h * 0.2} className="g80" />
        <line x1="0" x2={w} y1={h * 0.8} y2={h * 0.8} className="g20" />
        <polyline points={pts} fill="none" />
      </svg>
    </div>
  )
}
