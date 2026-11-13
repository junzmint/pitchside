import { useEffect, useMemo, useRef, useState } from 'react'
import { money } from '../../api'
import type { AwardManager, AwardNight, AwardPlayer } from '../../api_stage'
import { Badge, Icon, PlayerCard, Portal, visibleColor } from '../../ui'
import { useI18n } from '../../i18n'
import { AwardArt, Confetti, Flag, gloveStat, ordinal, playDrumRoll, playFanfare, playReveal, reduceMotion, useStageKeys, type AwardKey } from './common'

// Golden Ball night: a dark stage with spotlights. The smaller awards first (Golden Boot, Golden
// Glove, Golden Boy, Manager of the Year), then the Golden Ball's top ten from 10 to 1, the winner's
// big moment, and a summary. Next: button, Enter, Space or the controller's A; Escape skips.

type Step = { k: 'intro' } | { k: 'award'; award: 'boot' | 'glove' | 'boy' } | { k: 'manager' } | { k: 'ball'; i: number } | { k: 'winner' } | { k: 'summary' }

function stepsOf(n: AwardNight): Step[] {
  const s: Step[] = [{ k: 'intro' }]
  if (n.boot.length) s.push({ k: 'award', award: 'boot' })
  if (n.glove.length) s.push({ k: 'award', award: 'glove' })
  if (n.boy.length) s.push({ k: 'award', award: 'boy' })
  if (n.managers.length) s.push({ k: 'manager' })
  for (let i = n.ball.length - 1; i >= 1; i--) s.push({ k: 'ball', i })
  if (n.ball.length) s.push({ k: 'winner' })
  s.push({ k: 'summary' })
  return s
}

const CONFETTI = ['#ffd23f', '#fff3b0', '#ffffff', '#ffb000', '#38e1ff']

export function Ceremony({ night, onClose, onHistory, replay }: { night: AwardNight; onClose: () => void; onHistory?: () => void; replay?: boolean }) {
  const { t, lang } = useI18n()
  const steps = useMemo(() => stepsOf(night), [night])
  const [i, setI] = useState(0)
  const [drum, setDrum] = useState(false) // the pause before the winner is named
  const nextBtn = useRef<HTMLButtonElement>(null)
  const step = steps[Math.min(i, steps.length - 1)]
  const atEnd = step.k === 'summary'

  useEffect(() => { nextBtn.current?.focus({ preventScroll: true }) }, [i, drum])
  // the winner: a drum roll, then the name, the trophy, confetti and the fanfare
  useEffect(() => {
    if (step.k !== 'winner') return
    if (reduceMotion()) { setDrum(false); playFanfare(); return }
    setDrum(true)
    playDrumRoll(1.5)
    const id = window.setTimeout(() => { setDrum(false); playFanfare() }, 1600)
    return () => window.clearTimeout(id)
  }, [step.k])

  const next = () => {
    if (drum) { setDrum(false); playFanfare(); return }
    if (atEnd) { onClose(); return }
    const n = steps[i + 1]
    if (n && n.k !== 'winner' && n.k !== 'summary') playReveal()
    setI(v => Math.min(steps.length - 1, v + 1))
  }
  const skip = () => {
    if (atEnd) { onClose(); return }
    setDrum(false)
    setI(steps.length - 1)
  }
  useStageKeys(next, skip)

  const winner = night.ball[0]
  const ballEffect = night.effects.find(e => e.award === 'ball')
  const progress = Math.round((i / Math.max(1, steps.length - 1)) * 100)
  const revealed = step.k === 'ball' ? night.ball.slice(step.i).reverse() : step.k === 'winner' && !drum ? [...night.ball].reverse() : []
  const glow = step.k === 'ball' ? night.ball[step.i] : step.k === 'winner' && !drum ? winner : step.k === 'award' ? night[step.award][0] : null

  return (
    <Portal>
      <div className={'modal sg-night' + (step.k === 'winner' && !drum ? ' won' : '') + (drum ? ' drum' : '')} role="dialog" aria-modal="true" aria-labelledby="sg-title"
        style={glow ? { ['--glow' as string]: visibleColor(glow.color, glow.color2) } : undefined}
        onClick={e => { if (!e.nativeEvent.isTrusted) skip() /* the controller's B button */ }}>
        <div className="sg-lights" aria-hidden="true"><i /><i /><i /></div>
        <div className="sg-floor" aria-hidden="true" />
        {step.k === 'winner' && !drum && <Confetti colors={[...CONFETTI, visibleColor(winner.color, winner.color2)]} seed={night.season} />}
        <div className="sg-inner" onClick={e => e.stopPropagation()}>
          <header className="sg-head">
            <span className="eyebrow">{t('seasonN', { n: night.season })}{replay ? ` · ${t('sg.replayTag')}` : ''}</span>
            <h2 id="sg-title" className="sg-title">{t('sg.night')}</h2>
          </header>

          <main className="sg-main" key={i + (drum ? 'd' : '')}>
            {step.k === 'intro' && (
              <div className="sg-intro">
                <div className="sg-float"><AwardArt kind="ball" size={150} /></div>
                <p className="sg-lead">{t('sg.intro', { n: night.players.toLocaleString(lang === 'vi' ? 'vi-VN' : lang === 'ja' ? 'ja-JP' : 'en-GB') })}</p>
                <ul className="sg-agenda">
                  {(['boot', 'glove', 'boy', 'manager', 'ball'] as AwardKey[]).map(k => (
                    <li key={k}><AwardArt kind={k} size={34} /><span><b>{t('sg.' + k)}</b><small>{t('sg.' + k + '.d')}</small></span></li>
                  ))}
                </ul>
              </div>
            )}
            {step.k === 'award' && <AwardReveal kind={step.award} list={night[step.award]} night={night} />}
            {step.k === 'manager' && <ManagerReveal list={night.managers} />}
            {step.k === 'ball' && (
              <div className="sg-ballstep">
                <BallReveal e={night.ball[step.i]} />
                <Board list={revealed} current={night.ball[step.i].rank} />
              </div>
            )}
            {step.k === 'winner' && (drum ? (
              <div className="sg-drum">
                <span className="sg-drumball"><AwardArt kind="ball" size={120} /></span>
                <p className="sg-lead big">{t('sg.drum')}</p>
              </div>
            ) : (
              <div className="sg-ballstep">
                <WinnerMoment e={winner} effect={ballEffect} />
                <Board list={revealed} current={1} />
              </div>
            ))}
            {step.k === 'summary' && <Summary night={night} />}
          </main>

          <footer className="sg-foot">
            <div className="sg-progress" aria-hidden="true"><i style={{ width: progress + '%' }} /></div>
            <span className="sg-keys muted">{atEnd ? '' : t('sg.keys')}</span>
            <div className="row sg-btns">
              {atEnd ? (
                <>
                  {onHistory && <button onClick={onHistory}><Icon name="history2" size={16} /> {t('sg.history')}</button>}
                  <button ref={nextBtn} className="primary big" onClick={onClose}>{t('sg.close')}</button>
                </>
              ) : (
                <>
                  <button onClick={skip}>{t('sg.skip')}</button>
                  <button ref={nextBtn} className="primary big" onClick={next}>
                    {step.k === 'intro' ? t('sg.start') : drum ? t('sg.reveal') : steps[i + 1]?.k === 'summary' ? t('sg.toSummary') : t('sg.next')} <Icon name="next" size={18} />
                  </button>
                </>
              )}
            </div>
          </footer>
        </div>
      </div>
    </Portal>
  )
}

type StatKey = 'apps' | 'goals' | 'assists' | 'ga' | 'cs' | 'rating'

function StatLine({ e, show }: { e: AwardPlayer; show?: StatKey[] }) {
  const { t } = useI18n()
  const keys: StatKey[] = show ?? (e.player.position === 'GK' ? (e.gaRate != null ? ['apps', 'ga', 'cs', 'rating'] : ['apps', 'cs', 'rating'])
    : e.player.position === 'DF' ? ['apps', 'goals', 'cs', 'rating'] : ['apps', 'goals', 'assists', 'rating'])
  const icon = { apps: 'apps', goals: 'goal', assists: 'assist', ga: 'defense', cs: 'cleanSheet', rating: 'rating' } as const
  const val = { apps: e.apps, goals: e.goals, assists: e.assists, ga: e.gaRate?.toFixed(2) ?? '', cs: e.cs, rating: e.rating.toFixed(2) }
  // watched and played matches count on the simulation's scale: "≈" marks a converted number, the tip gives the real one
  const real = e.real
  const asPlayed: Partial<Record<StatKey, string>> = real ? { goals: String(real.goals), assists: String(real.assists), cs: String(real.cs), rating: real.rating.toFixed(2) } : {}
  return (
    <span className="sg-stats">
      {keys.map(k => {
        const r = asPlayed[k]
        const conv = r != null && r !== String(val[k])
        return (
          <span key={k} data-tip={t('sg.stat.' + k) + (conv ? '\n' + t('sg.realVal', { v: r }) : '')}>
            <Icon name={icon[k]} size={14} /><b className="num">{conv ? '≈' : ''}{val[k]}</b><small>{t('sg.statS.' + k)}</small>
          </span>
        )
      })}
      {real && (
        <span tabIndex={0} data-tip={t('sg.convTip', { g: real.goals, a: real.assists, cs: real.cs, r: real.rating.toFixed(2) })}>
          <Icon name="info" size={13} /><small>{t('sg.conv')}</small>
        </span>
      )}
    </span>
  )
}

function ClubLine({ e }: { e: { club: string; short: string; color: string; color2: string; division: number; league: string; pos: number; trophies: string[] } }) {
  const { t, lang } = useI18n()
  return (
    <div className="sg-club">
      <Badge short={e.short} color={e.color} color2={e.color2} size={40} />
      <span className="stack" style={{ gap: 2, minWidth: 0 }}>
        <b>{e.club}</b>
        <small className="muted"><Flag code={e.league} size={11} /> {t('sg.finished', { pos: ordinal(lang, e.pos), d: e.division })}</small>
      </span>
      {e.trophies.length > 0 && <span className="sg-trophies">{e.trophies.map(k => <span key={k} className={'chip tr-' + k}>{t('sg.tr.' + k)}</span>)}</span>}
    </div>
  )
}

function Card({ e }: { e: AwardPlayer }) {
  const { t } = useI18n()
  return (
    <div className={'sg-card' + (e.mine ? ' mine' : '')} style={{ ['--kit' as string]: visibleColor(e.color, e.color2), ['--kit2' as string]: e.color2 }}>
      {e.mine && <span className="sg-ribbon"><Icon name="star" size={13} /> {t('sg.yours')}</span>}
      <PlayerCard p={e.player} foot={<StatLine e={e} />} />
      <ClubLine e={e} />
    </div>
  )
}

function AwardReveal({ kind, list, night }: { kind: 'boot' | 'glove' | 'boy'; list: AwardPlayer[]; night: AwardNight }) {
  const { t } = useI18n()
  const w = list[0]
  const eff = night.effects.find(x => x.award === kind)
  const rest = list.slice(1)
  return (
    <div className="sg-award">
      <div className="sg-awardhead">
        <AwardArt kind={kind} size={84} />
        <div className="stack" style={{ gap: 4 }}>
          <h3 className="sg-awardname">{t('sg.' + kind)}</h3>
          <span className="muted">{t('sg.' + kind + '.d')}</span>
        </div>
      </div>
      <Card e={w} />
      <div className="sg-effects">
        {kind === 'boot' && (
          <span className="chip special" tabIndex={w.real ? 0 : undefined} data-tip={w.real ? t('sg.realGoals', { n: w.real.goals }) : undefined}>
            <Icon name="goal" size={14} /> {w.real && w.real.goals !== w.goals ? '≈' : ''}{t('sg.bootGoals', { n: w.goals })}
          </span>
        )}
        {kind === 'glove' && w.gaRate != null && (
          <span className="chip special" tabIndex={0} data-tip={t('sg.gaTip', { n: w.conceded ?? 0, apps: w.apps })}><Icon name="defense" size={14} /> {t('sg.gloveGa', { n: w.gaRate.toFixed(2) })}</span>
        )}
        {kind === 'glove' && <span className={'chip' + (w.gaRate == null ? ' special' : '')}><Icon name="cleanSheet" size={14} /> {t('sg.gloveCs', { n: w.cs })}</span>}
        {kind === 'boy' && <span className="chip special"><Icon name="up" size={14} /> {t('sg.boyAge', { n: w.player.age })}</span>}
        {eff?.morale && <span className="chip"><Icon name="flame" size={14} /> {t('sg.morale')}</span>}
      </div>
      {rest.length > 0 && <p className="muted sg-runners">{t('sg.runnersUp', { list: rest.map(r => `${r.player.name} (${kind === 'boot' ? t('sg.nGoals', { n: r.goals }) : kind === 'glove' ? gloveStat(t, r) : r.club})`).join(', ') })}</p>}
    </div>
  )
}

function ManagerReveal({ list }: { list: AwardManager[] }) {
  const { t, lang } = useI18n()
  const shown = [...list].reverse()
  return (
    <div className="sg-award">
      <div className="sg-awardhead">
        <AwardArt kind="manager" size={84} />
        <div className="stack" style={{ gap: 4 }}>
          <h3 className="sg-awardname">{t('sg.manager')}</h3>
          <span className="muted">{t('sg.manager.d')}</span>
        </div>
      </div>
      <ol className="sg-mgrs">
        {shown.map((m, k) => (
          <li key={m.rank} className={(m.rank === 1 ? 'top ' : '') + (m.mine ? 'mine' : '')} style={{ animationDelay: `${k * 0.32}s`, ['--kit' as string]: visibleColor(m.color, m.color2) }}>
            <span className="sg-rk num">{m.rank}</span>
            <Badge short={m.short} color={m.color} color2={m.color2} size={34} />
            <span className="stack" style={{ gap: 1, minWidth: 0 }}>
              <b>{m.mine ? t('sg.youAre', { name: m.name }) : m.name} {m.nation && <Flag code={m.nation} size={11} />}</b>
              <small className="muted">{m.club} · {t('sg.mgrLine', { pos: ordinal(lang, m.pos), exp: ordinal(lang, m.expected), d: m.division })}</small>
              {m.trophies.length > 0 && <span className="sg-trophies">{m.trophies.map(k2 => <span key={k2} className={'chip tr-' + k2}>{t('sg.tr.' + k2)}</span>)}</span>}
            </span>
            {m.rank === 1 && <Icon name="crown" size={22} className="gold" />}
          </li>
        ))}
      </ol>
    </div>
  )
}

function BallReveal({ e }: { e: AwardPlayer }) {
  const { t } = useI18n()
  return (
    <div className="sg-reveal">
      <span className="sg-bigrank num" aria-hidden="true">{e.rank}</span>
      <div className="sg-revealcol">
        <span className="sg-ranklabel">{t('sg.rank', { n: e.rank })}</span>
        <Card e={e} />
      </div>
    </div>
  )
}

function WinnerMoment({ e, effect }: { e: AwardPlayer; effect?: AwardNight['effects'][number] }) {
  const { t } = useI18n()
  const pct = effect?.valueBefore && effect.valueAfter ? Math.round((effect.valueAfter / effect.valueBefore - 1) * 100) : 0
  return (
    <div className="sg-reveal sg-winner">
      <span className="sg-trophy"><AwardArt kind="ball" size={150} /></span>
      <div className="sg-revealcol">
      <span className="sg-ranklabel gold">{t('sg.winner')}</span>
      <Card e={e} />
      <div className="sg-effects">
        {pct > 0 && <span className="chip special" data-tip={t('sg.valueTip')}><Icon name="up" size={14} /> {t('sg.value', { p: pct, a: money(effect!.valueBefore!), b: money(effect!.valueAfter!) })}</span>}
        {effect?.ovrBefore != null && effect.ovrAfter != null && effect.ovrAfter > effect.ovrBefore && <span className="chip"><Icon name="star" size={14} /> {t('sg.ovr', { a: effect.ovrBefore, b: effect.ovrAfter })}</span>}
        {effect?.morale && <span className="chip"><Icon name="flame" size={14} /> {t('sg.morale')}</span>}
        {(effect?.rep ?? 0) > 0 && <span className="chip special"><Icon name="crown" size={14} /> {t('sg.rep')}</span>}
      </div>
      {e.mine && <p className="sg-lead">{t('sg.mineWon', { name: e.player.name })}</p>}
      </div>
    </div>
  )
}

/** The top ten as it is revealed, best last. */
function Board({ list, current }: { list: AwardPlayer[]; current: number }) {
  const { t } = useI18n()
  if (!list.length) return null
  return (
    <ol className="sg-board" aria-label={t('sg.topTen')}>
      {list.map(e => (
        <li key={e.rank} className={(e.rank === current ? 'cur ' : '') + (e.mine ? 'mine ' : '') + (e.rank === 1 ? 'first' : '')}>
          <span className="sg-rk num">{e.rank}</span>
          <Badge short={e.short} color={e.color} color2={e.color2} size={26} />
          <span className="stack" style={{ gap: 0, minWidth: 0 }}>
            <b>{e.player.name}</b>
            <small className="muted">{e.club}</small>
          </span>
          {e.mine && <Icon name="star" size={14} className="gold" />}
        </li>
      ))}
    </ol>
  )
}

function Summary({ night }: { night: AwardNight }) {
  const { t, lang } = useI18n()
  const mine = night.ball.filter(b => b.mine)
  const tile = (kind: AwardKey, name: string, sub: string, e?: { short: string; color: string; color2: string; mine?: boolean }) => (
    <div className={'sg-tile' + (e?.mine ? ' mine' : '') + (kind === 'ball' ? ' main' : '')}>
      <AwardArt kind={kind} size={kind === 'ball' ? 70 : 48} />
      <span className="stack" style={{ gap: 2, minWidth: 0 }}>
        <small className="eyebrow">{t('sg.' + kind)}</small>
        <b>{name}</b>
        <small className="muted">{sub}</small>
      </span>
      {e && <Badge short={e.short} color={e.color} color2={e.color2} size={34} />}
    </div>
  )
  const w = night.ball[0]
  const m = night.managers[0]
  return (
    <div className="sg-summary">
      <h3 className="sg-awardname">{t('sg.summary')}</h3>
      <div className="sg-tiles">
        {w && tile('ball', w.player.name, `${w.club} · ${t('sg.nGoals', { n: w.goals })} · ${w.rating.toFixed(2)}`, w)}
        {night.boy[0] && tile('boy', night.boy[0].player.name, `${night.boy[0].club} · ${t('sg.boyAge', { n: night.boy[0].player.age })}`, night.boy[0])}
        {night.glove[0] && tile('glove', night.glove[0].player.name, `${night.glove[0].club} · ${gloveStat(t, night.glove[0])}`, night.glove[0])}
        {night.boot[0] && tile('boot', night.boot[0].player.name, `${night.boot[0].club} · ${t('sg.nGoals', { n: night.boot[0].goals })}`, night.boot[0])}
        {m && tile('manager', m.mine ? t('sg.youAre', { name: m.name }) : m.name, `${m.club} · ${t('sg.mgrLine', { pos: ordinal(lang, m.pos), exp: ordinal(lang, m.expected), d: m.division })}`, m)}
      </div>
      <div className="sg-top10">
        <b className="eyebrow">{t('sg.topTen')}</b>
        <ol>
          {night.ball.map(e => (
            <li key={e.rank} className={e.mine ? 'mine' : ''}>
              <span className="sg-rk num">{e.rank}</span>
              <Badge short={e.short} color={e.color} color2={e.color2} size={22} />
              <b>{e.player.name}</b>
              <small className="muted">{e.club}</small>
              <small className="num sg-pts" data-tip={t('sg.scoreTip')}>{e.score.toFixed(1)}</small>
            </li>
          ))}
        </ol>
      </div>
      <p className={'sg-minenote' + (mine.length ? ' good' : ' muted')}>
        {mine.length ? t('sg.mineTop', { list: mine.map(x => `${x.player.name} (${t('sg.rank', { n: x.rank })})`).join(', ') }) : t('sg.noneMine')}
      </p>
    </div>
  )
}

export default Ceremony
