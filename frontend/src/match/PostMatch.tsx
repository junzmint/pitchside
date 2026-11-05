import { useEffect, useMemo, useRef, useState } from 'react'
import type { MatchSetup } from '../types'
import type { Engine, Highlight, MatchOutcome, Side } from './engine'
import { View, type CamMode } from './render'
import { manOfTheMatch, rateMatch, ratingTone, type Rated } from './ratings'
import { ROLE_CAT } from '../formations'
import { Badge, PosTag } from '../ui'
import { Icon } from '../icons'
import { useI18n } from '../i18n'

// The final-whistle screen: score and verdict, the man of the match, a goals timeline, match stats as bars,
// ratings for both teams and the goals again from the replay buffer. "Save result" sends the usual body.

type Tab = 'summary' | 'ratings' | 'stats'

const luma = (hex: string) => { const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16); return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 }
/** A kit colour that stays visible on the dark match surface (a navy kit falls back to its second colour). */
export function onDark(c1: string, c2?: string) { return luma(c1) > 62 ? c1 : c2 && luma(c2) > 62 ? c2 : '#8fa194' }

export function PostMatch({ eng, setup, done, cam, onSave, saving }: {
  eng: Engine; setup: MatchSetup; done: MatchOutcome; cam: CamMode; onSave: () => void; saving?: boolean
}) {
  const { t } = useI18n()
  const [tab, setTab] = useState<Tab>('summary')
  const [watching, setWatching] = useState(false)
  const rated = useMemo(() => rateMatch(eng.playerStats(), eng.score, eng.minute()), [eng])
  const mom = useMemo(() => manOfTheMatch(rated, eng.score), [rated, eng])
  const H: Side = eng.homeTeam, A: Side = H === 0 ? 1 : 0
  const st = eng.stats
  const kitRaw = eng.statics().kit
  const kit = kitRaw.map(k => ({ c1: onDark(k.c1, k.c2), c2: k.c2 })) as { c1: string; c2: string }[]
  const club = (s: Side) => (s === 0) === setup.userIsHome ? setup.home.club : setup.away.club
  const us = eng.score[0], them = eng.score[1]
  const pens = eng.pensResult
  const verdict = us > them || (pens && pens[0] > pens[1]) ? 'win' : us < them || (pens && pens[0] < pens[1]) ? 'loss' : 'draw'
  const clips = eng.highlights
  const tot = eng.possT[0] + eng.possT[1] || 1
  const poss: [number, number] = [Math.round((eng.possT[0] / tot) * 100), 0]
  poss[1] = 100 - poss[0]
  const pct = (s: Side) => (st.passes[s] ? Math.round((st.passOk[s] / st.passes[s]) * 100) : 0)
  const rows: { k: string; v: [number, number]; fmt?: (n: number) => string }[] = [
    { k: 'possession', v: poss, fmt: n => n + '%' },
    { k: 'shots', v: st.shots },
    { k: 'lv.st.onTarget', v: st.onTarget },
    { k: 'lv.st.passCount', v: st.passes },
    { k: 'lv.st.passes', v: [pct(0), pct(1)], fmt: n => n + '%' },
    { k: 'lv.st.tackles', v: st.tackles },
    { k: 'lv.st.fouls', v: st.fouls },
    { k: 'lv.st.corners', v: st.corners },
    { k: 'lv.st.yellows', v: st.yellows },
    { k: 'lv.st.reds', v: st.reds },
    { k: 'lv.st.saves', v: st.saves },
    { k: 'lv.st.offsides', v: st.offsides },
  ]
  useEffect(() => {
    // Enter saves, H plays the highlights (keys only while this screen shows)
    const kd = (e: KeyboardEvent) => {
      if (watching) return
      if (e.key === 'Enter' && !saving) { e.preventDefault(); onSave() }
      else if ((e.key === 'h' || e.key === 'H') && clips.length) setWatching(true)
    }
    window.addEventListener('keydown', kd)
    return () => window.removeEventListener('keydown', kd)
  }, [watching, saving, clips.length])

  if (watching && clips.length) return <HighlightsPlayer clips={clips} eng={eng} cam={cam} onDone={() => setWatching(false)} />

  const end = eng.half >= 3 ? 120 : 90
  return (
    <div className="overlay lv-post" role="dialog" aria-label={t('lv.post.title')}>
      <div className="lv-post-card">
        <header className="lv-post-head">
          <span className="eyebrow">{t('feed.fulltime')}{done.extraTime ? ` · ${t('lv.hud.aet')}` : ''}</span>
          <div className="lv-post-score">
            <TeamHead side={H} name={club(H).name} short={club(H).short} color={club(H).color} color2={club(H).color2} />
            <b className="num">{eng.score[H]}<i>-</i>{eng.score[A]}</b>
            <TeamHead side={A} name={club(A).name} short={club(A).short} color={club(A).color} color2={club(A).color2} />
          </div>
          {pens && <p className="num lv-post-pens">{t('lv.hud.pensResult', { a: pens[H], b: pens[A] })}</p>}
          <div className={'lv-verdict ' + verdict}>{t('lv.post.' + verdict)}</div>
        </header>
        <div className="lv-tabs lv-post-tabs" role="tablist">
          {(['summary', 'ratings', 'stats'] as Tab[]).map(x => <button key={x} role="tab" aria-pressed={tab === x} onClick={() => setTab(x)}>{t('lv.post.tab.' + x)}</button>)}
        </div>
        <div className="lv-post-body">
          {tab === 'summary' && (
            <>
              {mom && <MomCard r={mom} color={kit[mom.team as Side].c1} color2={kit[mom.team as Side].c2} club={club(mom.team as Side).name} />}
              <Timeline eng={eng} H={H} end={end} />
              {eng.signatures.length > 0 && (
                <p className="lv-post-sigs"><Icon name="star" size={15} /> {t('lv.post.sigs')}: {eng.signatures.map(s => `${s.minute}' ${eng.statics().pl[s.id]?.n ?? ''} (${t('lv.sk.' + s.move)})`).join(' · ')}</p>
              )}
              <div className="lv-bars">{rows.slice(0, 6).map(r => <StatBar key={r.k} label={t(r.k)} a={r.v[H]} b={r.v[A]} fmt={r.fmt} ca={kit[H].c1} cb={kit[A].c1} />)}</div>
            </>
          )}
          {tab === 'stats' && <div className="lv-bars">{rows.map(r => <StatBar key={r.k} label={t(r.k)} a={r.v[H]} b={r.v[A]} fmt={r.fmt} ca={kit[H].c1} cb={kit[A].c1} />)}</div>}
          {tab === 'ratings' && (
            <div className="lv-ratings">
              {[H, A].map(s => (
                <div key={s} className="lv-rate-col">
                  <b className="lv-rate-team"><i style={{ background: kit[s].c1 }} />{club(s).name}</b>
                  {rated.filter(r => r.team === s).map(r => <RateRow key={r.id} r={r} mom={mom?.id === r.id} />)}
                </div>
              ))}
            </div>
          )}
        </div>
        <footer className="lv-post-foot">
          <button disabled={!clips.length} onClick={() => setWatching(true)} data-tip={clips.length ? undefined : t('lv.post.noClips')}>
            <Icon name="replay" size={16} /> {t('lv.post.highlights', { n: clips.length })}
          </button>
          <button className="primary" disabled={saving} onClick={onSave}><Icon name="check" size={16} /> {t('mp.save')}</button>
        </footer>
      </div>
    </div>
  )
}

function TeamHead({ name, short, color, color2 }: { side: Side; name: string; short: string; color: string; color2: string }) {
  return (
    <span className="lv-post-team">
      <Badge short={short} color={color} color2={color2} size={56} />
      <span>{name}</span>
    </span>
  )
}

function MomCard({ r, color, color2, club }: { r: Rated; color: string; color2: string; club: string }) {
  const { t } = useI18n()
  const facts: [string, number | string][] = []
  if (r.g) facts.push(['lv.post.f.goals', r.g])
  if (r.a) facts.push(['lv.post.f.assists', r.a])
  if (r.sv) facts.push(['lv.post.f.saves', r.sv])
  if (r.tk) facts.push(['lv.post.f.tackles', r.tk])
  if (r.int) facts.push(['lv.post.f.interceptions', r.int])
  if (r.sh) facts.push(['lv.post.f.shots', `${r.ot}/${r.sh}`])
  if (r.ps) facts.push(['lv.post.f.passes', `${r.pk}/${r.ps}`])
  if (r.sk) facts.push(['lv.post.f.skills', r.sk])
  return (
    <div className="lv-mom" style={{ ['--c1' as string]: color, ['--c2' as string]: color2 }}>
      <div className="lv-mom-badge"><Icon name="star" size={22} /><span>{t('lv.post.mom')}</span></div>
      <div className="lv-mom-main">
        <span className="lv-mom-shirt num">{r.shirt}</span>
        <div className="lv-mom-who">
          <b>{r.name}</b>
          <span><PosTag p={ROLE_CAT[r.pos] ?? 'MF'} role={r.pos} /> {club}{r.icon ? <> · <span className="lv-icon-tag">{t('lv.post.icon')}</span></> : null}</span>
        </div>
        <span className="lv-mom-rating num" data-tip={t('lv.post.ratingTip')}>{r.rating.toFixed(1)}</span>
      </div>
      {facts.length > 0 && <div className="lv-mom-facts">{facts.slice(0, 5).map(([k, v]) => <span key={k}>{t(k)} <b className="num">{v}</b></span>)}</div>}
    </div>
  )
}

function Timeline({ eng, H, end }: { eng: Engine; H: Side; end: number }) {
  const { t } = useI18n()
  const goals = eng.goalLog
  const reds = eng.cards.filter(c => c.kind === 'r')
  const names = eng.statics().pl
  if (!goals.length && !reds.length) return <p className="muted lv-nogoals">{t('lv.post.noGoals')}</p>
  const pos = (m: number) => `${Math.max(1, Math.min(99, (m / end) * 100))}%`
  return (
    <div className="lv-timeline" aria-label={t('lv.post.timeline')}>
      <div className="lv-tl-track">
        <i className="lv-tl-half" style={{ left: pos(45) }} />
        {end > 90 && <i className="lv-tl-half" style={{ left: pos(90) }} />}
        {goals.map((g, i) => (
          <span key={'g' + i} className={'lv-tl-ev ' + (g.team === H ? 'top' : 'bot')} style={{ left: pos(g.minute) }}>
            <Icon name="goal" size={14} />
            <em><b className="num">{g.minute}'</b> {g.scorer}{g.og ? ` (${t('lv.post.og')})` : g.pen ? ` (${t('lv.post.pen')})` : ''}</em>
          </span>
        ))}
        {reds.map((c, i) => (
          <span key={'r' + i} className={'lv-tl-ev red ' + (c.team === H ? 'top' : 'bot')} style={{ left: pos(c.minute) }}>
            <i className="lv-card-r" />
            <em><b className="num">{c.minute}'</b> {names[c.id]?.n ?? ''}</em>
          </span>
        ))}
      </div>
      <ul className="lv-goal-list">
        {goals.map((g, i) => (
          <li key={i} className={g.team === H ? 'home' : 'away'}>
            <b className="num">{g.minute}'</b> {g.scorer}
            {g.og ? <span className="muted"> ({t('lv.post.og')})</span> : g.pen ? <span className="muted"> ({t('lv.post.pen')})</span> : null}
            {g.assist && !g.og ? <span className="muted"> · {t('feed.assist', { name: g.assist })}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

function StatBar({ label, a, b, fmt, ca, cb }: { label: string; a: number; b: number; fmt?: (n: number) => string; ca: string; cb: string }) {
  const sum = a + b
  const pa = sum > 0 ? (a / sum) * 100 : 50
  const f = fmt ?? ((n: number) => String(n))
  return (
    <div className="lv-bar">
      <span className={'num' + (a > b ? ' lead' : '')}>{f(a)}</span>
      <span className="lv-bar-label">{label}</span>
      <span className={'num' + (b > a ? ' lead' : '')}>{f(b)}</span>
      <div className="lv-bar-track">
        <i style={{ width: pa + '%', background: ca }} />
        <i style={{ width: 100 - pa + '%', background: cb }} />
      </div>
    </div>
  )
}

function RateRow({ r, mom }: { r: Rated; mom: boolean }) {
  const { t } = useI18n()
  return (
    <div className={'lv-rate' + (mom ? ' mom' : '') + (r.inMin > 0 ? ' sub' : '')}>
      <PosTag p={ROLE_CAT[r.pos] ?? 'MF'} role={r.pos} />
      <span className="lv-rate-name">
        {r.name}
        {r.inMin > 0 && <small className="muted"> {t('lv.post.on', { n: r.inMin })}</small>}
      </span>
      <span className="lv-rate-ev">
        {Array.from({ length: r.g }, (_, i) => <Icon key={'g' + i} name="goal" size={13} title={t('lv.post.f.goals')} />)}
        {Array.from({ length: r.a }, (_, i) => <Icon key={'a' + i} name="assist" size={13} title={t('lv.post.f.assists')} />)}
        {r.y > 0 && r.r === 0 && <i className="lv-card-y" data-tip={t('lv.st.yellows')} />}
        {r.r > 0 && <i className="lv-card-r" data-tip={t('lv.st.reds')} />}
        {mom && <Icon name="star" size={13} title={t('lv.post.mom')} />}
      </span>
      <span className={'lv-rating num ' + ratingTone(r.rating)} data-tip={t('lv.post.ratingTip')}>{r.rating.toFixed(1)}</span>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ highlights
function HighlightsPlayer({ clips, eng, cam, onDone }: { clips: Highlight[]; eng: Engine; cam: CamMode; onDone: () => void }) {
  const { t } = useI18n()
  const cv = useRef<HTMLCanvasElement>(null)
  const [i, setI] = useState(0)
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  const next = () => { if (i + 1 < clips.length) setI(i + 1); else doneRef.current() }
  const nextRef = useRef(next)
  nextRef.current = next
  useEffect(() => {
    const canvas = cv.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const view = new View(cam)
    const clip = clips[i]
    const labels = { replay: t('lv.post.hlLabel'), skip: t('lv.post.hlSkipHint') }
    let raf = 0, pos = 0, last = performance.now()
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const near = Math.abs(pos - clip.goalAt) < 24
      pos += dt * 30 * (near ? 0.45 : 0.9)
      if (pos >= clip.frames.length - 1) { nextRef.current(); return }
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth, h = canvas.clientHeight
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr) }
      const f = clip.frames[Math.floor(pos)]
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      view.draw(ctx, w, h, { ...f, rp: true, ph: 'replay', bn: '', sl: near }, eng.statics(), now, { labels, names: true })
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [i, clips, cam])
  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); doneRef.current() }
      else if (e.key === 'Enter' || e.key === ' ' || e.key === 'j' || e.key === 'J') { e.preventDefault(); nextRef.current() }
    }
    window.addEventListener('keydown', kd)
    return () => window.removeEventListener('keydown', kd)
  }, [])
  const g = clips[i].goal
  return (
    <div className="lv-hl">
      <canvas ref={cv} aria-label={t('lv.post.hlLabel')} />
      <div className="lv-hl-cap">
        <span className="lv-hl-n num">{t('lv.post.hlGoal', { i: i + 1, n: clips.length })}</span>
        <b><span className="num">{g.minute}'</span> {g.scorer}{g.og ? ` (${t('lv.post.og')})` : g.pen ? ` (${t('lv.post.pen')})` : ''}</b>
        {g.assist && !g.og && <span className="muted">{t('feed.assist', { name: g.assist })}</span>}
        <span className="lv-hl-team" style={{ background: eng.statics().kit[g.team].c1 }}>{eng.shorts[g.team]}</span>
      </div>
      <div className="lv-hl-btns">
        {i + 1 < clips.length && <button onClick={next}><Icon name="next" size={16} /> {t('lv.post.hlNext')}</button>}
        <button className="primary" onClick={() => doneRef.current()}><Icon name="skip" size={16} /> {t('lv.post.hlBack')}</button>
      </div>
    </div>
  )
}
