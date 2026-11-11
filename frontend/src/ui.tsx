import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { FixtureView, Player } from './types'
import { useI18n, type TFn } from './i18n'
import { Icon, type IconName } from './icons'
import { money } from './api'
import { Crest } from './crest'

export { Icon, FIN_ICON, type IconName } from './icons'
export { Crest } from './crest'
export { StadiumArt } from './stadium'

function luma(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16)
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114
}
/** A club colour that stays visible on light surfaces: near-white kits fall back to their second colour. */
export function visibleColor(c1: string, c2?: string) {
  if (luma(c1) < 215) return c1
  if (c2 && luma(c2) < 215) return c2
  return '#3a4a40'
}

export function ovrColor(v: number) {
  if (v >= 85) return '#127a4a'
  if (v >= 78) return '#2f9a45'
  if (v >= 70) return '#7c9a28'
  if (v >= 62) return '#c08a1c'
  return '#b5552f'
}

/** Rating shield, tiered like collectible cards: bronze, silver, gold, rare gold, elite, and icon (100+). */
export function Ovr({ v }: { v: number }) {
  return <span className={'ovr num t-' + tierOf(v)} style={{ background: ovrColor(v) }}>{Math.round(v)}</span>
}

/** Detailed position (LB, CM, ST…) coloured by line; falls back to the line when unknown. */
export function PosTag({ p, role }: { p: Player['position']; role?: string }) {
  const { t } = useI18n()
  return <span className={`pos ${p}`} data-tip={role ? `${role}: ${t('role.' + role)}` : t('posL.' + p)}>{role || t('pos.' + p)}</span>
}

export function Bar({ v, max = 100, color }: { v: number; max?: number; color?: string }) {
  const pct = Math.max(0, Math.min(100, (v / max) * 100))
  const c = color ?? (pct > 75 ? 'var(--good)' : pct > 50 ? 'var(--warn)' : 'var(--bad)')
  return <div className="bar"><i style={{ width: pct + '%', background: c }} /></div>
}

/** A club crest (generated SVG, the same for a club on every page; see crest.tsx). */
export function Badge({ short, color, color2, size = 44 }: { short: string; color: string; color2?: string; size?: number }) {
  return (
    <span className={'badge' + (size >= 72 ? ' big' : size < 40 ? ' small' : '')} style={{ width: size, height: size }}>
      <Crest short={short} color={color} color2={color2} size={size} />
    </span>
  )
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, ReactNode][]; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} aria-pressed={v === value} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  )
}

/** Inline confirmation instead of a dialog. */
export function ConfirmButton({ label, confirm, onConfirm, className, disabled, title }: {
  label: ReactNode; confirm: ReactNode; onConfirm: () => void; className?: string; disabled?: boolean; title?: string
}) {
  const { t } = useI18n()
  const [ask, setAsk] = useState(false)
  if (!ask) return <button className={className} disabled={disabled} title={title} onClick={e => { e.stopPropagation(); setAsk(true) }}>{label}</button>
  return (
    <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }} onClick={e => e.stopPropagation()}>
      <button className={className ?? 'primary'} onClick={() => { setAsk(false); onConfirm() }}>{confirm}</button>
      <button onClick={() => setAsk(false)}>{t('cancel')}</button>
    </span>
  )
}

export function resultOf(f: FixtureView, clubId: number): 'W' | 'D' | 'L' | null {
  if (f.homeGoals == null || f.awayGoals == null) return null
  const gf = f.homeId === clubId ? f.homeGoals : f.awayGoals
  const ga = f.homeId === clubId ? f.awayGoals : f.homeGoals
  if (gf === ga && f.pensHome != null) return (f.pensHome === (f.homeId === clubId)) ? 'W' : 'L'
  return gf > ga ? 'W' : gf < ga ? 'L' : 'D'
}

export function ResultChip({ f, clubId }: { f: FixtureView; clubId: number }) {
  const { t } = useI18n()
  const r = resultOf(f, clubId)
  if (!r) return null
  return <span className={`res ${r}`} title={`${f.homeShort} ${f.homeGoals}-${f.awayGoals} ${f.awayShort}`}>{t('res.' + r)}</span>
}

export function Score({ f }: { f: FixtureView }) {
  const { t } = useI18n()
  if (!f.played) return <span className="muted">–</span>
  return (
    <b className="num">
      {f.homeGoals} - {f.awayGoals}
      {f.pensH != null && f.pensA != null ? <small className="muted" data-tip={t('score.pensTip')}> ({t('score.pens', { h: f.pensH, a: f.pensA })})</small>
        : f.pensHome != null ? <small className="muted"> ({t('pens')} {f.pensHome ? f.homeShort : f.awayShort})</small>
        : f.extraTime ? <small className="muted" data-tip={t('score.aetTip')}> ({t('score.aet')})</small> : null}
    </b>
  )
}

/** "League · R3", "Cup · Semi-final", "Continental · Group A" */
export function useStageLabel() {
  const { t } = useI18n()
  return (comp: string, stage: string, round?: number) => {
    const c = t('comp.' + comp)
    if (comp === 'league') return round ? `${c} · ${t('round', { n: round })}` : c
    if (comp === 'friendly') return c
    // a group-stage day without its matchday number reads "Group stage", not "Group stage · MD" with nothing after it
    if (stage === 'G' && !round) return `${c} · ${t('stage.G0')}`
    return `${c} · ${t('stage.' + (stage === 'G' && round ? 'G' : stage), { n: round ?? '' })}`
  }
}

/** "Legend · Real Madrix '14" / "Custom" chip. */
export function TagChip({ p }: { p: { tag?: string; version?: string; age?: number } }) {
  const { t } = useI18n()
  // a legend's age tells which version of him this is (the same player comes in several eras)
  const label = p.tag === 'legend' ? `${t('tag.legend')}${p.version ? ` · ${p.version}` : ''}${p.age ? ` · ${t('age.years', { n: p.age })}` : ''}` : p.tag === 'custom' ? `${t('tag.legend')} · ${t('tag.custom')}` : ''
  if (label) return <span className="chip legendtag" data-tip={`${label}\n${t('tag.legendHint')}`} tabIndex={0}><Icon name="star" size={12} /> {label}</span>
  return null
}

export function BusyOverlay({ message }: { message: string }) {
  return (
    <div className="busy" role="alert" aria-live="assertive" aria-busy="true">
      <div className="busycard"><Icon name="play" size={30} className="spinball" /><b>{message}</b></div>
    </div>
  )
}

export function Loading({ text }: { text?: string }) {
  const { t } = useI18n()
  // after a few seconds, say why it takes so long and for how long it has been waiting (the server answers slowly
  // when the computer is busy with other work), instead of a spinner that looks stuck
  const [sec, setSec] = useState(0)
  useEffect(() => {
    const t0 = Date.now()
    const iv = window.setInterval(() => setSec(Math.floor((Date.now() - t0) / 1000)), 1000)
    return () => window.clearInterval(iv)
  }, [])
  return (
    <p className="loading" role="status">
      <Icon name="play" size={20} className="spinball" />
      <span>{text ?? t('loading')}{sec >= 4 && <small className="loading-slow">{t('loadingSlow', { n: sec })}</small>}</span>
    </p>
  )
}

/** Player traits; unrevealed ones show as "?". */
// the attribute each trait builds on, shown in its tooltip
const TRAIT_ATTR: Record<string, keyof Player> = { speedster: 'pace', poacher: 'shooting', long_shot: 'shooting', playmaker: 'passing', one_two: 'passing',
  flair: 'dribbling', hard_tackler: 'defending', aerial: 'physical', tireless: 'physical', reflexes: 'goalkeeping' }

export function TraitChips({ p, small }: { p: Pick<Player, 'traits' | 'hiddenTraits'> & Partial<Player>; small?: boolean }) {
  const { t } = useI18n()
  if (p.traits?.length) {
    return <span className={'traits' + (small ? ' small' : '')}>{p.traits.map(x => {
      const a = TRAIT_ATTR[x]
      const v = a ? p[a] : undefined
      const tip = `${t('trait.' + x)}\n${t('trait.' + x + '.d')}${a && typeof v === 'number' ? `\n${t('attr.' + String(a))}: ${Math.round(v)}` : ''}`
      return <span key={x} className={'trait t-' + x} data-tip={tip} tabIndex={0}>{t('trait.' + x)}</span>
    })}</span>
  }
  if (p.hiddenTraits) return <span className={'traits' + (small ? ' small' : '')}><span className="trait hidden" data-tip={t('trait.hiddenHint')} tabIndex={0}>? ×{p.hiddenTraits}</span></span>
  return null
}

/** Empty state: a big faint icon over one short line. */
export function Empty({ children, icon = 'info' }: { children: ReactNode; icon?: IconName }) {
  return <div className="emptystate"><Icon name={icon} size={34} strokeWidth={1.5} /><span>{children}</span></div>
}

export function ClubDot({ color }: { color: string }) {
  return <i style={{ width: 10, height: 10, borderRadius: 2, background: color, display: 'inline-block', flex: 'none', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.15)' }} />
}

/** One floating tooltip for every element with data-tip (hover or keyboard focus). It lives on the
 *  body, so clipped panels and scrolling tables can't cut it off. */
export function TooltipLayer() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; below: boolean } | null>(null)
  useEffect(() => {
    const show = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.('[data-tip]') as HTMLElement | null
      if (!el) return
      const r = el.getBoundingClientRect()
      const below = r.top < 120
      setTip({ text: el.dataset.tip ?? '', x: Math.min(window.innerWidth - 150, Math.max(150, r.left + r.width / 2)), y: below ? r.bottom + 8 : r.top - 8, below })
    }
    const hide = (e: Event) => { if ((e.target as Element | null)?.closest?.('[data-tip]')) setTip(null) }
    document.addEventListener('mouseover', show)
    document.addEventListener('focusin', show)
    document.addEventListener('mouseout', hide)
    document.addEventListener('focusout', hide)
    window.addEventListener('scroll', () => setTip(null), true)
    return () => {
      document.removeEventListener('mouseover', show); document.removeEventListener('focusin', show)
      document.removeEventListener('mouseout', hide); document.removeEventListener('focusout', hide)
    }
  }, [])
  if (!tip?.text) return null
  return <div className={'tiplayer' + (tip.below ? ' below' : '')} style={{ left: tip.x, top: tip.y }} role="tooltip">{tip.text}</div>
}

/** Help text: small, muted, always shown in full (never clamped). */
/** " (Penalties 4–3)" / " (After extra time)" for tooltips and plain-text titles. */
export function scoreNoteText(t: TFn, f: { extraTime?: boolean; pensH?: number | null; pensA?: number | null; pensHome?: boolean | null }) {
  if (f.pensH != null && f.pensA != null) return ` (${t('score.pens', { h: f.pensH, a: f.pensA })})`
  if (f.pensHome != null) return ` (${t('pens')})`
  return f.extraTime ? ` (${t('score.aet')})` : ''
}

/** "After extra time" / "Penalties 4–3" beside a knockout score (nothing for a normal result). */
export function ScoreNote({ f }: { f: { extraTime?: boolean; pensH?: number | null; pensA?: number | null; pensHome?: boolean | null } }) {
  const { t } = useI18n()
  if (f.pensH != null && f.pensA != null) return <small className="scorenote pens" data-tip={t('score.pensTip')}>{t('score.pens', { h: f.pensH, a: f.pensA })}</small>
  if (f.pensHome != null) return <small className="scorenote pens" data-tip={t('score.pensTip')}>{t('pens')}</small>
  if (f.extraTime) return <small className="scorenote" data-tip={t('score.aetTip')}>{t('score.aet')}</small>
  return null
}

export function Hint({ text }: { text: string }) {
  return <p className="hint"><Icon name="info" size={14} className="i" /><span>{text}</span></p>
}

/** A short label with its full meaning in a tooltip (abbreviations in table headers and the like). */
export function Abbr({ k }: { k: string }) {
  const { t } = useI18n()
  return <span className="abbr" data-tip={t(k + '.full')}>{t(k)}</span>
}

/** Animate a number from its previous value (0 on first show) to the new one. */
export function useCountUp(target: number, ms = 650) {
  const [v, setV] = useState(0)
  const from = useRef(0)
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const start = from.current
    if (reduce || start === target) { setV(target); from.current = target; return }
    const t0 = performance.now()
    let raf = 0
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms)
      const e = 1 - Math.pow(1 - k, 3)
      setV(start + (target - start) * e)
      if (k < 1) raf = requestAnimationFrame(step)
      else from.current = target
    }
    raf = requestAnimationFrame(step)
    return () => { cancelAnimationFrame(raf); from.current = target }
  }, [target, ms])
  return v
}

/** A number that counts up when it appears or changes. `fmt` formats it (money, decimals…).
 *  When it changes later it also pops (green going up, red going down). */
export function CountUp({ v, fmt, className }: { v: number; fmt?: (n: number) => string; className?: string }) {
  const n = useCountUp(v)
  const prev = useRef(v)
  const [pop, setPop] = useState<{ k: number; up: boolean } | null>(null)
  useEffect(() => {
    if (prev.current !== v) setPop(p => ({ k: (p?.k ?? 0) + 1, up: v > prev.current }))
    prev.current = v
  }, [v])
  return <span key={pop?.k ?? 0} className={'num' + (className ? ' ' + className : '') + (pop ? (pop.up ? ' pop up' : ' pop down') : '')}>{fmt ? fmt(n) : Math.round(n)}</span>
}
export const fmtMoney = (n: number) => money(Math.round(n))

/** Section title with an icon. Renders an h3 so panel styling keeps working. */
export function Title({ icon, children, className }: { icon: IconName; children: ReactNode; className?: string }) {
  return <h3 className={'ttl' + (className ? ' ' + className : '')}><Icon name={icon} size={16} />{children}</h3>
}

/** A labelled number with an icon: the building block of HUDs and summary strips. */
export function Kpi({ icon, label, children, tone, tip }: { icon: IconName; label: ReactNode; children: ReactNode; tone?: 'gold' | 'good' | 'bad' | 'cyan'; tip?: string }) {
  return (
    <div className={'kpi' + (tone ? ' ' + tone : '')} data-tip={tip}>
      <Icon name={icon} size={20} />
      <div><small>{label}</small><b>{children}</b></div>
    </div>
  )
}

/** Level pips (facilities, coach skill). */
export function Pips({ n, max, big }: { n: number; max: number; big?: boolean }) {
  return <span className={'pips' + (big ? ' big' : '')} aria-hidden="true">{Array.from({ length: max }, (_, i) => <i key={i} className={i < n ? 'on' : ''} />)}</span>
}

export function tierOf(v: number) {
  const r = Math.round(v)
  return r >= 100 ? 'icon' : r >= 90 ? 'elite' : r >= 85 ? 'rare' : r >= 75 ? 'gold' : r >= 65 ? 'silver' : 'bronze'
}

const FACE_OUT = ['pace', 'shooting', 'passing', 'dribbling', 'defending', 'physical'] as const
const FACE_GK = ['goalkeeping', 'physical', 'passing', 'pace', 'defending', 'dribbling'] as const

/** Collectible-style player card: rating shield, position, name and six face stats as mini bars. */
export function PlayerCard({ p, onOpen, flags, children, selected, foot }: {
  p: Player; onOpen?: () => void; flags?: ReactNode; children?: ReactNode; selected?: boolean; foot?: ReactNode
}) {
  const { t } = useI18n()
  const face = p.position === 'GK' ? FACE_GK : FACE_OUT
  const tier = tierOf(p.overall)
  const fit = Math.round(p.fitness)
  return (
    <div className={'pcard t-' + tier + (p.injury > 0 ? ' hurt' : '') + (selected ? ' sel' : '')} role={onOpen ? 'button' : undefined} tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen} onKeyDown={onOpen ? e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onOpen() } } : undefined}>
      <div className="pc-head">
        <div className="pc-rate"><b className="num" data-tip={`${t('lbl.ovr')}: ${Math.round(p.overall)}`}>{Math.round(p.overall)}</b><PosTag p={p.position} role={p.role} /></div>
        <div className="pc-id">
          <b className="pc-name">{p.name}</b>
          <small>{t('nation.' + p.nation)} · {p.tag === 'legend' || p.tag === 'custom' ? <Icon name="star" size={11} /> : `${p.age} ${t('yrs')}`}</small>
          <small className="pc-pot" data-tip={t('pot.full')}><Icon name="up" size={12} /> {p.potential}</small>
        </div>
        {p.shirt > 0 && <span className="pc-shirt num">{p.shirt}</span>}
      </div>
      <div className="pc-attrs">
        {face.map(a => {
          const v = Math.floor(p[a])
          return (
            <div key={a} className="pc-attr" data-tip={`${t('attr.' + a)}: ${v}`}>
              <span>{t('attrS.' + a)}</span>
              <i><b style={{ width: Math.max(4, Math.min(100, v)) + '%' }} className={v >= 80 ? 'hi' : v >= 65 ? 'mid' : v < 45 ? 'lo' : ''} /></i>
              <em className="num">{v}</em>
            </div>
          )
        })}
      </div>
      {flags && <div className="pc-flags">{flags}</div>}
      <div className="pc-foot">
        {foot ?? <>
          <span className="pc-fit" data-tip={`${t('fitness')}: ${fit}%`}><Icon name="fitness" size={13} /><i><b style={{ width: fit + '%', background: fit < 60 ? 'var(--bad)' : fit < 75 ? 'var(--warn)' : 'var(--good)' }} /></i></span>
          <b className="num pc-val">{money(p.price || p.value)}</b>
        </>}
      </div>
      {children && <div className="pc-act" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>{children}</div>}
    </div>
  )
}

/** Grid/list switch stored per page in localStorage. */
export function useViewMode(key: string, initial: 'cards' | 'table' = 'cards') {
  const k = 'pitchside.view.' + key
  const [v, setV] = useState<'cards' | 'table'>(() => {
    try { const s = localStorage.getItem(k); if (s === 'cards' || s === 'table') return s } catch { /* ignore */ }
    return initial
  })
  const set = (n: 'cards' | 'table') => { setV(n); try { localStorage.setItem(k, n) } catch { /* ignore */ } }
  return [v, set] as const
}
export function ViewSwitch({ value, onChange }: { value: 'cards' | 'table'; onChange: (v: 'cards' | 'table') => void }) {
  const { t } = useI18n()
  return (
    <div className="seg iconseg" role="group" aria-label={t('view.label')}>
      <button aria-pressed={value === 'cards'} onClick={() => onChange('cards')} data-tip={t('view.cards')} aria-label={t('view.cards')}><Icon name="grid" size={16} /></button>
      <button aria-pressed={value === 'table'} onClick={() => onChange('table')} data-tip={t('view.table')} aria-label={t('view.table')}><Icon name="list" size={16} /></button>
    </div>
  )
}

/** Page header: emblem icon, eyebrow line, big italic title and optional controls on the right. */
export function PageHead({ icon, eyebrow, title, children, badge }: { icon: IconName; eyebrow?: ReactNode; title: ReactNode; children?: ReactNode; badge?: ReactNode }) {
  return (
    <div className="head">
      <div className="headline">
        {badge ? <span className="pagehead-badge">{badge}</span> : <Icon name={icon} size={28} className="pagehead-ico" />}
        <div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2></div>
      </div>
      {children}
    </div>
  )
}

/** Style for a range input so the game slider skin can paint the filled part of the track. */
export function rangeFill(v: number, min: number, max: number) {
  return { ['--fill' as string]: `${Math.max(0, Math.min(100, ((v - min) / Math.max(1, max - min)) * 100))}%` } as React.CSSProperties
}

// ---------------------------------------------------------------- knockout paths (cup / continental)

export const CUP_STAGES = ['R1', 'R32', 'R16', 'QF', 'SF', 'F']
export const CL_KO_STAGES = ['R16', 'QF', 'SF', 'F']

export interface KoStep { stage: string; f: FixtureView | null; res: 'W' | 'D' | 'L' | null; state: 'won' | 'lost' | 'next' | 'todo' | 'bye' | 'out' }
export interface KoPath { steps: KoStep[]; out: string | null; winner: boolean; next: string | null; nextFixture: FixtureView | null; started: boolean }

/** The user's road through a knockout competition: rounds won, the round they went out in, the next round. */
export function koPath(stages: string[], fixtures: FixtureView[], clubId: number): KoPath {
  const mine = fixtures.filter(f => f.homeId === clubId || f.awayId === clubId)
  const byStage = new Map(mine.map(f => [f.stage, f]))
  const first = stages.findIndex(s => byStage.has(s))
  if (first < 0) return { steps: stages.map(stage => ({ stage, f: null, res: null, state: 'todo' })), out: null, winner: false, next: null, nextFixture: null, started: false }
  let out: string | null = null
  let next: string | null = null
  let nextFixture: FixtureView | null = null
  let winner = false
  const steps = stages.map((stage, i): KoStep => {
    const f = byStage.get(stage) ?? null
    if (out) return { stage, f: null, res: null, state: 'out' }
    if (i < first) return { stage, f: null, res: null, state: 'bye' }
    if (!f || !f.played) {
      if (!next) { next = stage; nextFixture = f }
      return { stage, f, res: null, state: next === stage ? 'next' : 'todo' }
    }
    const res = resultOf(f, clubId)
    if (res === 'L') { out = stage; return { stage, f, res, state: 'lost' } }
    if (i === stages.length - 1 && res === 'W') winner = true
    return { stage, f, res, state: 'won' }
  })
  return { steps, out, winner, next: winner ? null : next, nextFixture, started: true }
}

/** The knockout road drawn as stage nodes with the opponent's crest and the score, ending in the trophy. */
export function KoRoad({ path, clubId }: { path: KoPath; clubId: number }) {
  const { t } = useI18n()
  return (
    <ol className="koroad">
      {path.steps.map(s => {
        const f = s.f
        const home = f ? f.homeId === clubId : false
        const opp = f ? (home ? { short: f.awayShort, color: f.awayColor, color2: f.awayColor2, name: f.away } : { short: f.homeShort, color: f.homeColor, color2: f.homeColor2, name: f.home }) : null
        const gf = f ? (home ? f.homeGoals : f.awayGoals) : null
        const ga = f ? (home ? f.awayGoals : f.homeGoals) : null
        const tip = f ? `${t('stage.' + s.stage)}\n${f.home} ${f.played ? `${f.homeGoals}-${f.awayGoals}` : '–'} ${f.away}${scoreNoteText(t, f)}` : `${t('stage.' + s.stage)}${s.state === 'bye' ? `\n${t('hub.bye')}` : ''}`
        return (
          <li key={s.stage} className={'ko ' + s.state} data-tip={tip} tabIndex={f ? 0 : undefined}>
            <span className="ko-stage">{t('stage.' + s.stage)}</span>
            <span className="ko-node">
              {opp ? <Badge short={opp.short} color={opp.color} color2={opp.color2} size={30} />
                : <Icon name={s.state === 'bye' ? 'next' : s.state === 'out' ? 'close' : s.state === 'next' ? 'hourglass' : 'lock'} size={15} />}
            </span>
            <span className="ko-res num">
              {f?.played ? <>{gf}-{ga}{f.pensH != null && f.pensA != null ? <small> {t('pensShort')} {home ? f.pensH : f.pensA}-{home ? f.pensA : f.pensH}</small> : f.pensHome != null ? <small> {t('pensShort')}</small> : null}</> : s.state === 'bye' ? t('hub.bye') : s.state === 'next' ? (f ? t('vs') : t('tbd')) : '·'}
            </span>
          </li>
        )
      })}
      <li className={'ko trophy' + (path.winner ? ' won' : '')} data-tip={path.winner ? t('ko.W') : t('stage.F')}>
        <span className="ko-stage">{path.winner ? t('ko.W') : ''}</span>
        <span className="ko-node"><Icon name="cup" size={20} /></span>
        <span className="ko-res" />
      </li>
    </ol>
  )
}

/** Game-style tab bar for switching the mode of a page: equal-width buttons with an icon and an optional sub-line. */
export function TabBar<T extends string>({ value, options, onChange, label }: { value: T; options: [T, IconName, ReactNode, ReactNode?][]; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="modetabs" role="tablist" aria-label={label} style={{ ['--n' as string]: options.length } as React.CSSProperties}>
      {options.map(([k, icon, text, sub]) => (
        <button key={k} role="tab" aria-selected={value === k} aria-pressed={value === k} onClick={() => onChange(k)}>
          <Icon name={icon} size={22} strokeWidth={1.8} /><span><b>{text}</b>{sub != null && <small>{sub}</small>}</span>
        </button>
      ))}
    </div>
  )
}

/** Render a dialog on <body>: panels use backdrop-filter, which would otherwise trap a fixed-position overlay inside them. */
export function Portal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body)
}

/** Close a dialog with the Escape key. */
export function useEscape(onClose: () => void) {
  const ref = useRef(onClose)
  ref.current = onClose
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') ref.current() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
}

/** A dialog on <body>: dimmed backdrop (click or Escape closes it) and a card. */
export function Modal({ onClose, className, style, children, label }: { onClose: () => void; className?: string; style?: React.CSSProperties; children: ReactNode; label?: string }) {
  useEscape(onClose)
  return (
    <Portal>
      <div className="modal" role="dialog" aria-modal="true" aria-label={label} onClick={onClose}>
        <div className={'card' + (className ? ' ' + className : '')} style={style} onClick={e => e.stopPropagation()}>{children}</div>
      </div>
    </Portal>
  )
}
