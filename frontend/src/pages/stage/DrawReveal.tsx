import { useEffect, useMemo, useRef, useState } from 'react'
import type { DrawClub, DrawView } from '../../api_stage'
import { Badge, Icon, Portal, visibleColor } from '../../ui'
import { useI18n } from '../../i18n'
import { Flag, playReveal, reduceMotion, useStageKeys } from './common'

// The cup draw: crests tumble in the hat, one ball comes out and opens on the opponent, with his
// strength, home or away and the matchday. Any key, click or Skip jumps to the reveal; it never
// blocks the game (Continue, Escape or a click outside closes it).

export function DrawReveal({ d, day, onClose }: { d: DrawView; day: number; onClose: () => void }) {
  const { t } = useI18n()
  const [phase, setPhase] = useState<'mix' | 'pick' | 'open'>(() => (reduceMotion() ? 'open' : 'mix'))
  const btn = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (phase === 'open') return
    const id = window.setTimeout(() => {
      if (phase === 'mix') setPhase('pick')
      else { setPhase('open'); playReveal() }
    }, phase === 'mix' ? 1500 : 900)
    return () => window.clearTimeout(id)
  }, [phase])
  useEffect(() => { btn.current?.focus({ preventScroll: true }) }, [phase])
  const reveal = () => setPhase('open')
  const next = () => (phase === 'open' ? onClose() : reveal())
  useStageKeys(next, () => (phase === 'open' ? onClose() : reveal()))

  // balls on a ring inside the bowl
  const balls = useMemo(() => d.pot.slice(0, 16).map((c, i, all) => {
    const a = (i / all.length) * Math.PI * 2
    const r = 28 + (i % 3) * 9
    return { c, x: 50 + Math.cos(a) * r, y: 54 + Math.sin(a) * r * 0.55, delay: (i % 5) * 0.12 }
  }), [d.id])
  const comp = d.comp === 'cl' ? t('comp.cl') : `${t('comp.cup')} · ${t('nation.' + d.league)}`
  const left = Math.max(0, d.day - day)
  const diff = (d.me.strength ?? 0) - (d.opp.strength ?? 0)
  const verdict = Math.abs(diff) <= 1 ? 'even' : diff > 0 ? 'fav' : 'under'
  const oppKit = visibleColor(d.opp.color, d.opp.color2)

  return (
    <Portal>
      <div className={'modal sg-draw ph-' + phase} role="dialog" aria-modal="true" aria-labelledby="dr-title" onClick={() => (phase === 'open' ? onClose() : reveal())}>
        <div className="card sg-drawcard" style={{ ['--kit' as string]: oppKit }} onClick={e => { e.stopPropagation(); if (phase !== 'open') reveal() }}>
          <span className="eyebrow">{t('dr.title')}</span>
          <h2 id="dr-title" className="sg-drawtitle">{comp}</h2>
          <span className="chip special">{t('stage.' + d.stage)}</span>

          {phase !== 'open' ? (
            <div className="sg-bowl" aria-label={t('dr.drawing')}>
              <div className="sg-glass" aria-hidden="true" />
              {balls.map(({ c, x, y, delay }) => (
                <span key={c.id} className={'sg-ballc' + (phase === 'pick' && c.id === d.opp.id ? ' picked' : '')} style={{ left: x + '%', top: y + '%', animationDelay: delay + 's' }}>
                  <Badge short={c.short} color={c.color} color2={c.color2} size={30} />
                </span>
              ))}
              <span className="sg-drawing">{t('dr.drawing')}</span>
            </div>
          ) : (
            <div className="sg-tie">
              <Side c={d.home ? d.me : d.opp} label={t('dr.homeSide')} mine={d.home} />
              <span className="sg-vs">VS</span>
              <Side c={d.home ? d.opp : d.me} label={t('dr.awaySide')} mine={!d.home} />
            </div>
          )}

          {phase === 'open' && (
            <>
              <div className="sg-facts">
                <span className={'chip ' + (d.home ? 'good' : '')}><Icon name="stadium" size={14} /> {d.home ? t('dr.home') : t('dr.away')}</span>
                <span className="chip"><Icon name="calendar" size={14} /> {t('dr.day', { d: d.day })} · {left === 0 ? t('dr.today') : t('dr.in', { n: left })}</span>
                <span className={'chip v-' + verdict}>{t('dr.v.' + verdict)}</span>
              </div>
              <div className="sg-strength" data-tip={t('dr.strengthTip')}>
                <span className="muted small">{t('dr.strength')}</span>
                {/* same order as the badges above: home side on the left */}
                <StrengthBar me={d.home ? d.me : d.opp} opp={d.home ? d.opp : d.me} />
              </div>
              {d.ties.length > 1 && (
                <details className="sg-others">
                  <summary>{t('dr.others', { n: d.ties.length - 1 })}</summary>
                  <ul>
                    {d.ties.slice(1).map((x, i) => (
                      <li key={i}><Badge short={x.home.short} color={x.home.color} color2={x.home.color2} size={20} /> {x.home.name} <span className="muted">{t('dr.vs')}</span> {x.away.name} <Badge short={x.away.short} color={x.away.color} color2={x.away.color2} size={20} /></li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
          <div className="row sg-drawbtns">
            {phase !== 'open' && <button onClick={e => { e.stopPropagation(); reveal() }}>{t('dr.skip')}</button>}
            <button ref={btn} className="primary" onClick={e => { e.stopPropagation(); next() }}>{phase === 'open' ? t('dr.continue') : t('dr.reveal')}</button>
          </div>
        </div>
      </div>
    </Portal>
  )
}

function Side({ c, label, mine }: { c: DrawClub; label: string; mine: boolean }) {
  const { t } = useI18n()
  return (
    <div className={'sg-side' + (mine ? ' mine' : ' opp')}>
      <span className="sg-sidebadge"><Badge short={c.short} color={c.color} color2={c.color2} size={mine ? 64 : 84} /></span>
      <b>{c.name}</b>
      <small className="muted"><Flag code={c.league} size={11} /> {t('dr.div', { n: c.division })}</small>
      <small className="sg-sidelabel">{mine ? t('dr.you') : t('dr.opp')} · {label}</small>
    </div>
  )
}

function StrengthBar({ me, opp }: { me: DrawClub; opp: DrawClub }) {
  const a = me.strength ?? 0, b = opp.strength ?? 0
  const share = a + b > 0 ? (a / (a + b)) * 100 : 50
  // exaggerate the difference so a few points are visible
  const w = Math.max(15, Math.min(85, 50 + (share - 50) * 6))
  return (
    <div className="sg-sbar">
      <b className="num">{a}</b>
      <span className="sg-sbartrack"><i style={{ width: w + '%', background: visibleColor(me.color, me.color2) }} /><i style={{ width: 100 - w + '%', background: visibleColor(opp.color, opp.color2) }} /></span>
      <b className="num">{b}</b>
    </div>
  )
}

export default DrawReveal
