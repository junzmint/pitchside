import { useEffect, useMemo, useRef, useState } from 'react'
import type { Ctx } from '../../App'
import { badgeOf, exploreApi, type Celebration as Cel } from '../../api_explore'
import { Badge } from '../../ui'
import { useI18n, type TFn } from '../../i18n'
import { TrophyIcon } from './common'

/** The headline of a celebration ("VÔ ĐỊCH CÚP QUỐC GIA!"). */
export function celebrationTitle(t: TFn, c: Pick<Cel, 'kind' | 'key' | 'division'>) {
  switch (c.kind) {
    case 'league': return c.division <= 1 ? t('ex.cel.league1') : t('ex.cel.leagueN', { d: c.division })
    case 'cup': return t('ex.cel.cup')
    case 'cl': return t('ex.cel.cl')
    case 'promotion': return t('ex.cel.promotion')
    case 'feat': return t('ex.cel.feat.' + c.key)
    default: return t('ex.cel.ach')
  }
}

function details(t: TFn, c: Cel): string[] {
  const out: string[] = []
  if (c.kind === 'cup' || c.kind === 'cl') {
    if (c.kind === 'cup' && c.league) out.push(t('ex.cel.cupOf', { c: t('ex.rg.' + c.league) }))
    if (c.opp) out.push(t('ex.cel.final', { score: c.score ?? '', opp: c.opp }) + (c.pens ? ' ' + t('ex.cel.pens') : ''))
    if (c.scorers?.length) out.push(t('ex.cel.scorers', { list: c.scorers.join(', ') }))
  } else if (c.kind === 'league') {
    out.push(`${c.compName}${c.points ? ' · ' + t('ex.cel.points', { n: c.points }) : ''}`)
    if (c.promoted) out.push(t('ex.cel.andUp'))
  } else if (c.kind === 'promotion') {
    out.push(t('ex.cel.toDiv', { name: c.compName }))
  } else if (c.kind === 'feat') {
    out.push(t('ex.cel.featD.' + c.key, { n: c.wins ?? 0 }))
    if (c.allWins) out.push(t('ex.cel.allWins', { n: c.allWins }))
    if (c.points) out.push(t('ex.cel.points', { n: c.points }))
  } else {
    out.push(t('ex.a.' + c.key))
    out.push(t('ex.cel.achHint'))
  }
  return out
}

const CONFETTI = ['#ffd23f', '#fff3b0', '#38e1ff', '#ffffff', '#3ee08a', '#ff5a5f']

/**
 * Congratulations pop-up for a title (cup, continental cup, league, promotion, great seasons and
 * platinum achievements). Shows the pending celebrations from the career state one after another.
 */
export function Celebration({ ctx }: { ctx: Ctx }) {
  const { t } = useI18n()
  const pending = badgeOf(ctx.st.exploreView)?.celebrate ?? []
  const [gone, setGone] = useState<number[]>([])
  const cur = pending.find(c => !gone.includes(c.id))
  const left = pending.filter(c => !gone.includes(c.id)).length
  const btn = useRef<HTMLButtonElement>(null)
  const pieces = useMemo(() => Array.from({ length: 90 }, (_, i) => ({
    left: Math.random() * 100,
    delay: Math.random() * 3,
    dur: 2.8 + Math.random() * 2.6,
    size: 6 + Math.random() * 7,
    rot: Math.random() * 360,
    drift: (Math.random() - 0.5) * 160,
    color: i % 7 === 0 ? (cur?.color ?? '#ffd23f') : CONFETTI[i % CONFETTI.length],
    round: i % 4 === 0,
  })), [cur?.id])
  useEffect(() => { if (cur) btn.current?.focus() }, [cur?.id])
  if (!cur) return null

  async function ack(toRoom: boolean) {
    if (!cur) return
    const id = cur.id
    setGone(g => [...g, id])
    try { await exploreApi.ackCelebration(ctx.id, id) } catch { /* a read-only (ended) career: dismiss it here */ }
    if (toRoom) {
      try { sessionStorage.setItem('pitchside.exploreTab', 'museum') } catch { /* ignore */ }
      ctx.go('explore')
    }
    ctx.reload()
  }

  const stars = cur.kind === 'feat' ? (cur.key === 'treble' || cur.key === 'perfect' ? 3 : cur.key === 'double' ? 2 : 1) : 0
  const color = cur.color || ctx.st.club.color
  const color2 = cur.color2 || ctx.st.club.color2
  return (
    <div className={'modal celebrate k-' + cur.kind} role="dialog" aria-modal="true" aria-labelledby="cel-title" onClick={() => ack(false)}>
      <div className="cel-confetti" aria-hidden="true">
        {pieces.map((p, i) => (
          <i key={i} style={{
            left: p.left + '%', width: p.size, height: p.round ? p.size : p.size * 0.45, background: p.color, borderRadius: p.round ? '50%' : 2,
            animationDelay: p.delay + 's', animationDuration: p.dur + 's', ['--rot' as string]: p.rot + 'deg', ['--drift' as string]: p.drift + 'px',
          }} />
        ))}
      </div>
      <div className="cel-card" onClick={e => e.stopPropagation()}>
        <div className="cel-rays" aria-hidden="true" />
        <span className="eyebrow cel-eyebrow">{t('ex.cel.congrats')}</span>
        <div className="cel-trophy"><TrophyIcon kind={cur.kind} size={150} uid={'cel' + cur.id} stars={stars} /></div>
        <h2 id="cel-title" className="cel-title">{celebrationTitle(t, cur)}</h2>
        <div className="cel-club">
          <Badge short={cur.short || ctx.st.club.short} color={color} color2={color2} size={54} />
          <div className="stack" style={{ gap: 2 }}>
            <b>{cur.club || ctx.st.club.name}</b>
            <span className="muted">{t('seasonN', { n: cur.season })}</span>
          </div>
        </div>
        <div className="cel-lines">
          {details(t, cur).map((l, i) => <span key={i}>{l}</span>)}
        </div>
        <div className="row cel-actions">
          <button ref={btn} className="primary big" onClick={() => ack(false)}>{t('ex.cel.ok')}</button>
          {(cur.kind !== 'ach') && <button onClick={() => ack(true)}>{t('ex.cel.room')}</button>}
        </div>
        {left > 1 && <span className="muted cel-more">{t('ex.cel.more', { n: left - 1 })}</span>}
      </div>
    </div>
  )
}

export default Celebration
