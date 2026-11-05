import { useEffect, useRef, useState } from 'react'
import type { MatchSetup } from '../types'
import type { Engine, HudState, Side } from './engine'
import type { Glyphs } from './frame'
import { glyph } from './controls'
import { styleLine } from './style'
import { onDark } from './PostMatch'
import { Badge, useStageLabel } from '../ui'
import { Icon, type IconName } from '../icons'
import { useI18n } from '../i18n'

// Match presentation on top of the canvas: the walk-out before kick-off, the TV scoreboard with its goal flash,
// and the celebration buttons after a goal.

// ------------------------------------------------------------------------------------------------ walk-out
/** Seconds the walk-out stays up before kick-off (any button or a tap starts the match sooner). */
const INTRO_S = 5

export function Intro({ eng, setup, onStart }: { eng: Engine; setup: MatchSetup; onStart: () => void }) {
  const { t } = useI18n()
  const stage = useStageLabel()
  const startRef = useRef(onStart)
  startRef.current = onStart
  const [left, setLeft] = useState(INTRO_S)
  useEffect(() => {
    const t0 = performance.now()
    const iv = window.setInterval(() => {
      const l = INTRO_S - (performance.now() - t0) / 1000
      setLeft(l)
      if (l <= 0) { window.clearInterval(iv); startRef.current() }
    }, 100)
    return () => window.clearInterval(iv)
  }, [])
  const f = setup.fixture
  const userHome = setup.userIsHome
  const side = (home: boolean) => {
    const s = home ? setup.home : setup.away
    const team: Side = home === userHome ? 0 : 1
    return { s, team }
  }
  const weather = setup.weather ?? 'clear'
  const wIcon: IconName = weather === 'rain' ? 'rain' : weather === 'snow' ? 'snow' : weather === 'heat' ? 'heat' : 'sun'
  const opp: Side = 1
  const notes: { icon: IconName; text: string }[] = [{ icon: wIcon, text: t('lv.intro.weather.' + weather) }]
  if (f.comp === 'cl') notes.push({ icon: 'continental', text: t('lv.intro.night') })
  if (setup.derby) notes.push({ icon: 'derby', text: t('lv.intro.derby') })
  for (const s of [0, 1] as Side[]) if (eng.kitChanged[s]) notes.push({ icon: 'info', text: t('lv.intro.kit', { team: eng.names[s] }) })
  for (const p of eng.players.filter(q => q.sig).slice(0, 3)) notes.push({ icon: 'star', text: t('lv.intro.sig', { name: p.data.name, move: t('lv.sk.' + p.sig) }) })
  return (
    <div className="lv-intro" onClick={() => startRef.current()} role="dialog" aria-label={t('lv.intro.start')}>
      <div className="lv-intro-head">
      <span className="eyebrow">{stage(f.comp, f.stage === 'GA' || f.stage === 'GB' ? 'G' : f.stage)}</span>
      <div className="lv-intro-teams">
        {[true, false].map(home => {
          const { s, team } = side(home)
          return (
            <div key={String(home)} className={'lv-intro-team ' + (home ? 'home' : 'away')} style={{ ['--c1' as string]: onDark(eng.colors[team][0], eng.colors[team][1]) }}>
              <Badge short={s.club.short} color={s.club.color} color2={s.club.color2} size={84} />
              <b>{s.club.name}</b>
              <span className="lv-intro-sub">{t(home ? 'lv.intro.home' : 'lv.intro.away')} · {s.club.formation} · {t('lv.intro.rating', { n: Math.round(eng.avgRating[team]) })}</span>
            </div>
          )
        })}
        <span className="lv-intro-vs">VS</span>
      </div>
      </div>
      <div className="lv-intro-foot">
      <p className="lv-intro-style"><Icon name="tactics" size={16} /> <span><b>{eng.names[opp]}:</b> {styleLine(t, eng.styles[opp], eng.tactics[opp])}</span></p>
      <div className="lv-intro-notes">{notes.map((n, i) => <span key={i}><Icon name={n.icon} size={15} /> {n.text}</span>)}</div>
      <div className="lv-intro-go">
        <span>{t('lv.intro.start')}</span>
        <i style={{ width: `${Math.max(0, Math.min(100, (left / INTRO_S) * 100))}%` }} />
      </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ scoreboard
export function Scoreboard({ hud, eng }: { hud: HudState; eng: Engine }) {
  const { t } = useI18n()
  const [flash, setFlash] = useState<{ team: Side; text: string; key: number } | null>(null)
  const seen = useRef(hud.goals.length)
  useEffect(() => {
    if (hud.goals.length > seen.current) {
      const g = hud.goals[hud.goals.length - 1]
      setFlash({ team: g.team, text: `${g.minute}' ${g.scorer}${g.og ? ` (${t('lv.post.og')})` : g.pen ? ` (${t('lv.post.pen')})` : ''}`, key: hud.goals.length })
      const tm = window.setTimeout(() => setFlash(null), 5200)
      seen.current = hud.goals.length
      return () => window.clearTimeout(tm)
    }
    seen.current = hud.goals.length
  }, [hud.goals.length])
  const kit = eng.statics().kit
  const reds = (s: Side) => hud.cards.filter(c => c.team === s && c.kind === 'r').length
  const clock = hud.half >= 5 ? t('lv.hud.pens') : `${hud.minute}'`
  // home on the left, as on a TV scoreboard; a dot marks your side (P1 yellow, P2 blue in a two-player match)
  const order: Side[] = [eng.homeTeam, eng.homeTeam === 0 ? 1 : 0]
  const you = (s: Side) => (s === 0 ? 'p1' : hud.human[1] ? 'p2' : '')
  return (
    <div className="lv-sb" aria-live="polite">
      <div className="lv-sb-row">
        {order.map((s, i) => (
          <span key={s} className={'lv-sb-team ' + (i === 0 ? 'left' : 'right') + (flash?.team === s ? ' scored' : '')}>
            <i className="lv-sb-kit" style={{ background: kit[s].c1, borderColor: kit[s].c2 }} />
            <b>{eng.shorts[s]}</b>
            {you(s) && <i className={'lv-sb-you ' + you(s)} role="img" aria-label={s === 0 ? t('lv.sb.you') : 'P2'} />}
            {reds(s) > 0 && <em className="lv-sb-red" data-tip={t('lv.st.reds')}>{Array.from({ length: reds(s) }, (_, k) => <i key={k} />)}</em>}
            <span key={hud.score[s]} className="lv-sb-goals num">{hud.score[s]}</span>
          </span>
        ))}
        <span className="lv-sb-clock num">{clock}{hud.half === 3 || hud.half === 4 ? <small> {t('lv.hud.et')}</small> : null}</span>
      </div>
      {flash && (
        <div key={flash.key} className="lv-sb-goal" style={{ ['--c1' as string]: onDark(kit[flash.team].c1, kit[flash.team].c2) }}>
          <b>{t('lv.sb.goal')}</b><span>{eng.shorts[flash.team]} · {flash.text}</span>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ celebrations
export const CELEBS = [1, 2, 3, 4] as const
const CEL_PAD = ['A', 'B', 'X', 'Y']
export function CelebPicker({ eng, g, duo, side }: { eng: Engine; g: Glyphs; duo: boolean; side: Side }) {
  const { t } = useI18n()
  return (
    <div className="lv-cel" role="group" aria-label={t('lv.cel.title')}>
      <b>{duo ? `P${side + 1} · ` : ''}{t('lv.cel.title')}</b>
      <div className="lv-cel-btns">
        {CELEBS.map((k, i) => (
          <button key={k} onClick={() => eng.celebrate(k)}>
            <kbd>{g === 'kb' ? String(k) : glyph(CEL_PAD[i], g)}</kbd> {t('lv.cel.' + k)}
          </button>
        ))}
      </div>
      <small>{t('lv.cel.auto')}</small>
    </div>
  )
}
