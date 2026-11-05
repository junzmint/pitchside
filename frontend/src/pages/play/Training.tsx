import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../api'
import { playApi, type DrillReward } from '../../api_play'
import type { CareerSummary } from '../../types'
import { DRILLS, DrillRun, drillDef, medalOf, type DrillDef, type DrillId, type Mark } from '../../match/drills'
import { InputHub, RemoteSource } from '../../match/input'
import { View } from '../../match/render'
import { MatchAudio } from '../../match/audio'
import { CY, GOAL_H, GOAL_HALF, type Glyphs } from '../../match/frame'
import { TouchPad, type PadState } from '../../lan/TouchPad'
import { useSettings } from '../../settings'
import { ConfirmButton, Icon, Title } from '../../ui'
import { useI18n } from '../../i18n'
import { gameKey, isTouchDevice, typing } from './keys'
import { KeyRows, devParams, type Device } from './bits'
import { initialCam, saveCam } from './PlayLive'

// Training ground: five short skill challenges (dribble slalom, shooting targets, free kicks,
// penalties, crossing and heading) with bronze, silver and gold, plus free practice against a keeper.
// Best scores stay on this device. In a career, a gold medal earns a small bonus (+1 TP) at most once
// per matchday; the server keeps count.

const BEST_KEY = 'pitchside.drills'
const CAREER_KEY = 'pitchside.drills.career'
type Bests = Partial<Record<DrillId, { best: number; medal: number }>>

function loadBests(): Bests {
  try { return JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}') as Bests } catch { return {} }
}
function saveBest(id: DrillId, score: number, medal: number): { bests: Bests; record: boolean } {
  const b = loadBests()
  const cur = b[id]
  const record = !cur || score > cur.best
  if (record) b[id] = { best: score, medal: Math.max(medal, cur?.medal ?? 0) }
  else if (medal > (cur?.medal ?? 0)) b[id] = { best: cur!.best, medal }
  try { localStorage.setItem(BEST_KEY, JSON.stringify(b)) } catch { /* storage unavailable */ }
  return { bests: b, record }
}

export const MEDALS = ['', 'bronze', 'silver', 'gold'] as const

export function Medal({ m, size = 22, title }: { m: number; size?: number; title?: string }) {
  if (!m) return null
  return <span className={'pl-medal m' + m} style={{ width: size, height: size }} data-tip={title} aria-label={title}><Icon name="legend" size={Math.round(size * 0.66)} /></span>
}

export function Training({ careerId }: { careerId: number | null }) {
  const { t } = useI18n()
  const [bests, setBests] = useState<Bests>(loadBests)
  const [playing, setPlaying] = useState<DrillId | null>(null)
  const [careers, setCareers] = useState<CareerSummary[]>([])
  const [career, setCareer] = useState<number>(() => careerId ?? (Number(localStorage.getItem(CAREER_KEY)) || 0))
  const [reward, setReward] = useState<DrillReward | null>(null)
  const [me, setMe] = useState('')
  useEffect(() => {
    api.careers().then(cs => { setCareers(cs.filter(c => !c.ended)); if (!careerId && career && !cs.some(c => c.id === career && !c.ended)) setCareer(0) }).catch(() => {})
    api.me().then(u => setMe(u.username)).catch(() => {})
  }, [])
  useEffect(() => {
    try { localStorage.setItem(CAREER_KEY, String(career)) } catch { /* ignore */ }
    setReward(null)
    if (career) playApi.drillReward(career).then(setReward).catch(() => setReward(null))
  }, [career])
  const club = careers.find(c => c.id === career)

  if (playing) {
    return (
      <DrillScreen id={playing} name={me || t('pl.dr.you')} color={club ? [club.color, club.color2] : undefined} short={club?.short} career={club ? { id: club.id, name: club.clubName } : null}
        reward={reward} onReward={setReward} onExit={() => { setBests(loadBests()); setPlaying(null) }} onBest={setBests} />
    )
  }
  const golds = DRILLS.filter(d => d.medals && (bests[d.id]?.medal ?? 0) >= 3).length
  return (
    <div className="stack pl-training">
      <section className="panel stack">
        <div className="row spread">
          <Title icon="training">{t('pl.dr.title')}</Title>
          <span className="pl-golds" data-tip={t('pl.dr.goldsTip')}><Medal m={3} size={20} /> {golds} / {DRILLS.filter(d => d.medals).length}</span>
        </div>
        <p className="muted" style={{ margin: 0 }}>{t('pl.dr.lead')}</p>
        <div className="pl-drills">
          {DRILLS.map(d => <DrillCard key={d.id} def={d} best={bests[d.id]} onPlay={() => setPlaying(d.id)} />)}
        </div>
      </section>
      <section className="panel stack pl-bonus">
        <Title icon="tp">{t('pl.dr.bonusTitle')}</Title>
        <p className="muted" style={{ margin: 0 }}>{t('pl.dr.bonusBody')}</p>
        {careers.length > 0 ? (
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <label htmlFor="pl-career"><b>{t('pl.dr.bonusFor')}</b></label>
            <select id="pl-career" value={career} onChange={e => setCareer(Number(e.target.value))} disabled={!!careerId}>
              <option value={0}>{t('pl.dr.noCareer')}</option>
              {careers.map(c => <option key={c.id} value={c.id}>{c.clubName} · {t('seasonN', { n: c.season })}</option>)}
            </select>
            {career > 0 && reward && (reward.available
              ? <span className="pl-bonusok"><Icon name="check" size={15} /> {t('pl.dr.bonusReady', { n: reward.reward })}</span>
              : <span className="muted">{t('pl.dr.bonusUsed', { n: reward.nextIn || 1 })}</span>)}
          </div>
        ) : <p className="muted" style={{ margin: 0 }}>{t('pl.dr.bonusNoCareer')}</p>}
      </section>
    </div>
  )
}

function DrillCard({ def, best, onPlay }: { def: DrillDef; best?: { best: number; medal: number }; onPlay: () => void }) {
  const { t } = useI18n()
  const m = best?.medal ?? 0
  return (
    <button className={'pl-drill' + (def.medals ? '' : ' free')} onClick={onPlay}>
      <span className="pl-drillico"><Icon name={def.icon} size={26} /></span>
      <span className="pl-drilltxt">
        <b>{t('pl.dr.' + def.id)}</b>
        <small className="muted">{t('pl.dr.' + def.id + '.d')}</small>
        {def.medals ? (
          <span className="pl-thr">
            {def.medals.map((v, i) => <span key={i} className={'pl-thrv m' + (i + 1) + (m >= i + 1 ? ' got' : '')} data-tip={t('pl.dr.medal' + (i + 1))}><Medal m={i + 1} size={16} /> {v}</span>)}
            <span className="pl-best">{best ? t('pl.dr.best', { n: best.best }) : t('pl.dr.noBest')}</span>
          </span>
        ) : <span className="pl-thr"><span className="pl-best">{t('pl.dr.freeNote')}</span></span>}
      </span>
      <span className="pl-drillgo"><Icon name="playNow" size={18} /></span>
    </button>
  )
}

// ------------------------------------------------------------------------------------------------ the challenge screen

function DrillScreen({ id, name, color, short, career, reward, onReward, onExit, onBest }: {
  id: DrillId; name: string; color?: [string, string]; short?: string; career: { id: number; name: string } | null
  reward: DrillReward | null; onReward: (r: DrillReward) => void; onExit: () => void; onBest: (b: Bests) => void
}) {
  const { t, lang } = useI18n()
  const [settings, setS] = useSettings()
  const def = drillDef(id)
  const canvas = useRef<HTMLCanvasElement>(null)
  const runRef = useRef<DrillRun | null>(null)
  const viewRef = useRef(new View(initialCam(settings.camera)))
  const touchSrc = useRef<RemoteSource | null>(null)
  const [hud, setHud] = useState({ phase: 'ready', score: 0, tries: 0, left: def.secs, count: 3, note: '', noteT: 0, gain: 0, paused: false, prompt: '', ctx: 'att' as string })
  const [dev, setDev] = useState<Device>(() => (isTouchDevice() ? 'touch' : 'kb'))
  const [result, setResult] = useState<{ score: number; medal: number; record: boolean; bonus: '' | 'granted' | 'used' | 'error' } | null>(null)
  const [shot, setShot] = useState<DrillRun['shotAt']>(null)
  const [, force] = useState(0)
  const tRef = useRef(t)
  tRef.current = t
  const rewardRef = useRef(reward)
  rewardRef.current = reward
  const soundRef = useRef(settings.sound)
  soundRef.current = settings.sound

  useEffect(() => {
    const audio = new MatchAudio(false, 0)
    audio.setVolume(settings.volume, settings.sound)
    audio.lang = lang
    const run = new DrillRun(id, { name, color, short, t: (k, p) => tRef.current(k, p), onEvent: e => { if (e.k !== 'cam') audio.event(e) } })
    runRef.current = run
    const hub = new InputHub(false, [[{ kind: 'kb' }], []], s => run.eng.contextOf(s))
    hub.rumbleOn = settings.rumble
    const touch = new RemoteSource('touch', 'Touch', 'xbox', s => run.eng.contextOf(s), 0)
    touchSrc.current = touch
    hub.attach(0, touch)
    let touchAt = 0
    const origSet = touch.setNamed.bind(touch)
    touch.setNamed = (x, y, h) => { touchAt = performance.now(); origSet(x, y, h) }
    if (import.meta.env.DEV) (window as unknown as { __drill: DrillRun }).__drill = run
    const cv = canvas.current!
    const ctx2 = cv.getContext('2d')!
    let raf = 0, last = performance.now(), acc = 0, frames = 0, finished = false, prevPhase = run.phase
    const labels = { replay: tRef.current('lv.replay'), skip: tRef.current('lv.replaySkip') }
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const dpr = window.devicePixelRatio || 1
      const w = cv.clientWidth, h = cv.clientHeight
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr) }
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const [f0] = hub.poll()
      // Start / A on a pad starts the challenge from the intro card
      if (run.phase === 'ready' && f0 && (f0.b & (1 | 512))) { audio.wake(); run.start() }
      run.eng.setInput(0, f0)
      acc += dt
      let n = 0
      while (acc >= 1 / 60 && n < 8) { run.step(1 / 60); acc -= 1 / 60; n++ }
      if (n >= 8) acc = 0
      const [ex, homeAtt] = run.eng.excitement()
      audio.tick(dt, run.phase === 'run' ? ex * 0.6 : 0.1, homeAtt)
      ctx2.setTransform(dpr, 0, 0, dpr, 0, 0)
      const view = viewRef.current
      view.draw(ctx2, w, h, run.frame(), run.eng.statics(), now, { labels, names: false })
      drawMarks(ctx2, view, run.marks, now)
      if (run.phase !== prevPhase) { prevPhase = run.phase; if (run.phase === 'count') audio.wake() }
      if (++frames % 5 === 0) {
        const sh = run.eng.hud().sides[0]
        setHud({ phase: run.phase, score: run.score, tries: run.tries, left: run.left, count: Math.ceil(run.count), note: run.note, noteT: run.noteT, gain: run.gain, paused: run.eng.paused && run.phase === 'run', prompt: sh.prompt, ctx: sh.ctx })
        setShot(s => (s === run.shotAt ? s : run.shotAt))
        const g: Device = now - touchAt < 4000 && touchAt > 0 ? 'touch' : hub.glyphs(0) as Glyphs
        setDev(d => (d === g ? d : g))
      }
      if (run.phase === 'done' && !finished) {
        finished = true
        const medal = medalOf(def, run.score)
        const { bests, record } = def.medals ? saveBest(id, run.score, medal) : { bests: loadBests(), record: false }
        onBest(bests)
        setResult({ score: run.score, medal, record, bonus: '' })
        if (medal === 3 && career && rewardRef.current?.available) {
          playApi.claimDrill(career.id, id, run.score)
            .then(r => { onReward(r); setResult(x => x && { ...x, bonus: r.granted ? 'granted' : 'used' }) })
            .catch(() => setResult(x => x && { ...x, bonus: 'error' }))
        }
      }
      if (run.phase !== 'done') finished = false
    }
    raf = requestAnimationFrame(frame)
    const kd = (e: KeyboardEvent) => {
      audio.wake()
      const k = gameKey(e)
      if (!k || typing(e)) return
      e.preventDefault()
      if (e.repeat) return
      if (run.phase === 'ready' && (k === 'Enter' || k === 'Space' || k === 'KeyJ')) { run.start(); return }
      if (run.phase === 'done' && (k === 'Enter' || k === 'KeyR')) { setResult(null); run.eng.resume(); run.start(); return }
      if (k === 'KeyR' && run.phase === 'run') { run.eng.resume(); run.start(); return }
      if (k === 'KeyC') { const v = viewRef.current; v.next(1); saveCam(v.mode); force(x => x + 1); return }
      if (k === 'KeyM') { setS({ sound: !soundRef.current }); return }
      if (run.eng.paused && (k === 'Escape' || k === 'KeyP')) { run.eng.resume(); return }
      hub.kb.keyDown(k)
    }
    const ku = (e: KeyboardEvent) => { const k = gameKey(e); if (k) { hub.kb.keyUp(k); e.preventDefault() } }
    const blur = () => { hub.kb.clear(); if (run.phase === 'run' && !run.eng.paused) run.eng.pause('user') }
    const vis = () => { if (document.hidden) blur() }
    const wake = () => audio.wake()
    window.addEventListener('keydown', kd)
    window.addEventListener('keyup', ku)
    window.addEventListener('blur', blur)
    window.addEventListener('pointerdown', wake)
    document.addEventListener('visibilitychange', vis)
    return () => {
      cancelAnimationFrame(raf)
      audio.close()
      window.removeEventListener('keydown', kd)
      window.removeEventListener('keyup', ku)
      window.removeEventListener('blur', blur)
      window.removeEventListener('pointerdown', wake)
      document.removeEventListener('visibilitychange', vis)
    }
  }, [id])

  const run = runRef.current
  const again = () => { if (!run) return; setResult(null); run.eng.resume(); run.start() }
  const onTouch = (s: PadState) => touchSrc.current?.setNamed(s.x, s.y, s.held)
  const def2 = hud.ctx === 'def'
  const padLabels: Record<string, string> = { pass: t('pl.tp.pass'), shoot: t('pl.tp.shoot'), through: t('pl.tp.through'), lob: t('pl.tp.lob'), sprint: t('pl.tp.sprint'), skill: t('pl.tp.skill') }
  const timed = def.secs > 0
  const clock = timed ? `${Math.floor(Math.ceil(hud.left) / 60)}:${String(Math.ceil(hud.left) % 60).padStart(2, '0')}` : ''
  const medalNow = medalOf(def, hud.score)
  const scoreLabel = def.id === 'freekick' || def.id === 'penalty' || def.id === 'free' ? t('pl.dr.goals') : t('pl.dr.points')

  return (
    <div className={'matchwrap pl-drillwrap' + (dev === 'touch' && isTouchDevice() ? ' with-pad' : '')}>
      <div className="mhud pl-dhud">
        <div className="pl-dtitle"><Icon name={def.icon} size={18} /> <b>{t('pl.dr.' + id)}</b></div>
        <div className="mbar">
          <span className="pl-dstat"><small>{scoreLabel}</small><b className="num">{hud.score}</b></span>
          {def.tries > 0 && <span className="pl-dstat"><small>{t('pl.dr.tries')}</small><b className="num">{Math.min(hud.tries + (hud.phase === 'run' ? 1 : 0), def.tries)} / {def.tries}</b></span>}
          {timed && <span className={'pl-dstat' + (hud.left < 10 && hud.phase === 'run' ? ' hot' : '')}><small>{t('pl.dr.time')}</small><b className="num">{clock}</b></span>}
          {def.medals && <span className="pl-dmedals">{def.medals.map((v, i) => <span key={i} className={'pl-thrv m' + (i + 1) + (medalNow >= i + 1 ? ' got' : '')} data-tip={t('pl.dr.medal' + (i + 1))}><Medal m={i + 1} size={16} /> {v}</span>)}</span>}
          <button onClick={() => { const v = viewRef.current; v.next(1); saveCam(v.mode); force(x => x + 1) }} data-tip="C"><Icon name="camera" size={15} /> {t('lv.cam.' + viewRef.current.mode)}</button>
          {hud.phase === 'run' && <button onClick={() => run && (run.eng.paused ? run.eng.resume() : run.eng.pause('menu'))}>{hud.paused ? t('resume') : t('pause')}</button>}
          <ConfirmButton label={t('pl.dr.quit')} confirm={t('pl.dr.quitConfirm')} onConfirm={onExit} />
        </div>
      </div>
      <div className="mcanvas">
        <canvas ref={canvas} tabIndex={0} aria-label={t('pitch')} />
        {id === 'targets' && run && <GoalBoard marks={run.marks} shot={shot} />}
        {hud.phase === 'run' && !hud.paused && (
          <div className="keys lv-keys pl-dkeys">
            {def.keys.map(k => <KeyRows key={k.group} group={k.group} d={dev} only={k.only} />)}
          </div>
        )}
        {hud.phase === 'run' && !hud.paused && hud.prompt && <div className="setpiece lv-prompt p1">{t('lv.p.' + hud.prompt, devParams(t, dev, hud.ctx === 'def'))}</div>}
        {hud.noteT > 0 && hud.note && hud.phase !== 'ready' && (
          <div key={hud.note + hud.score + hud.tries} className={'pl-note-pop ' + (['goal', 'header', 'target', 'bonus', 'gate'].includes(hud.note) ? 'good' : 'bad')}>
            {t('pl.dr.note.' + hud.note)}{hud.gain > 0 && ['goal', 'header', 'target', 'bonus', 'gate'].includes(hud.note) ? ` +${hud.gain}` : ''}
          </div>
        )}
        {hud.phase === 'count' && <div className="pl-count num" key={hud.count}>{hud.count}</div>}
        {hud.phase === 'ready' && (
          <div className="overlay">
            <div className="card pl-intro">
              <span className="eyebrow"><Icon name={def.icon} size={14} /> {t('pl.dr.title')}</span>
              <h2>{t('pl.dr.' + id)}</h2>
              <p style={{ margin: 0 }}>{t('pl.dr.' + id + '.how')}</p>
              {def.medals && (
                <div className="pl-intromedals">
                  {def.medals.map((v, i) => <span key={i} className={'pl-thrv m' + (i + 1)}><Medal m={i + 1} size={20} /> {t('pl.dr.medal' + (i + 1))}: <b className="num">{v}</b></span>)}
                </div>
              )}
              <div className="pl-introkeys">
                <b>{t('pl.dr.controls')}</b>
                <div className="lv-ctlgrid">{def.keys.map(k => <div key={k.group}><KeyRows group={k.group} d={dev} only={k.only} /></div>)}</div>
                {dev === 'kb' && <small className="muted">{t('pl.dr.kbNote')}</small>}
              </div>
              <div className="row" style={{ justifyContent: 'center' }}>
                <button className="primary big" onClick={() => run?.start()}><Icon name="playNow" size={18} /> {t('pl.dr.start')}</button>
                <button onClick={onExit}><Icon name="prev" size={15} /> {t('back')}</button>
              </div>
            </div>
          </div>
        )}
        {hud.paused && hud.phase === 'run' && (
          <div className="overlay">
            <div className="card pl-gcard">
              <h3>{t('paused')}</h3>
              <div className="row" style={{ justifyContent: 'center' }}>
                <button className="primary" onClick={() => run?.eng.resume()}><Icon name="playNow" size={15} /> {t('resume')}</button>
                <button onClick={again}><Icon name="replay" size={15} /> {t('pl.dr.restart')}</button>
                <button onClick={onExit}><Icon name="prev" size={15} /> {t('pl.dr.quit')}</button>
              </div>
            </div>
          </div>
        )}
        {result && hud.phase === 'done' && (
          <div className="overlay">
            <div className="card pl-result">
              <span className="eyebrow">{t('pl.dr.' + id)}</span>
              {result.medal > 0 ? <Medal m={result.medal} size={72} title={t('pl.dr.medal' + result.medal)} /> : <span className="pl-nomedal"><Icon name="training" size={40} /></span>}
              <h2>{result.medal ? t('pl.dr.won' + result.medal) : def.medals ? t('pl.dr.noMedal') : t('pl.dr.freeDone')}</h2>
              <div className="pl-ftscore num"><b>{result.score}</b><span>{scoreLabel}</span></div>
              {result.record && <p className="pl-record-new"><Icon name="star" size={15} /> {t('pl.dr.record')}</p>}
              {def.medals && result.medal < 3 && <p className="muted" style={{ margin: 0 }}>{t('pl.dr.nextMedal', { n: def.medals[result.medal], medal: t('pl.dr.medal' + (result.medal + 1)) })}</p>}
              {result.bonus === 'granted' && career && <p className="pl-bonusok"><Icon name="tp" size={16} /> {t('pl.dr.bonusGot', { n: reward?.reward ?? 1, club: career.name })}</p>}
              {result.bonus === 'used' && <p className="muted" style={{ margin: 0 }}>{t('pl.dr.bonusUsed', { n: reward?.nextIn || 1 })}</p>}
              {result.bonus === 'error' && <p className="error" style={{ margin: 0 }}>{t('pl.dr.bonusError')}</p>}
              <div className="row" style={{ justifyContent: 'center' }}>
                <button className="primary" onClick={again}><Icon name="replay" size={16} /> {t('pl.dr.again')}</button>
                <button onClick={onExit}><Icon name="prev" size={16} /> {t('pl.dr.other')}</button>
              </div>
            </div>
          </div>
        )}
      </div>
      {isTouchDevice() && hud.phase === 'run' && <TouchPad onChange={onTouch} labels={def2 ? { ...padLabels, pass: t('pl.tp.switch'), shoot: t('pl.tp.tackle') } : padLabels} />}
    </div>
  )
}

/** The goal seen from the front: the four corner targets and where the last shot went. */
function GoalBoard({ marks, shot }: { marks: Mark[]; shot: DrillRun['shotAt'] }) {
  const { t } = useI18n()
  const gw = GOAL_HALF * 2, gh = GOAL_H
  const W = 220, H = Math.round(W * (gh + 0.5) / (gw + 0.8))
  const sx = (y: number) => ((y - (CY - GOAL_HALF - 0.4)) / (gw + 0.8)) * W
  const sz = (z: number) => H - ((z + 0.1) / (gh + 0.5)) * H
  const fresh = shot && performance.now() - shot.at < 6000
  const tg = useMemo(() => marks.filter((m): m is Extract<Mark, { k: 'target' }> => m.k === 'target'), [marks])
  return (
    <div className="pl-board" aria-label={t('pl.dr.board')}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('pl.dr.board')}>
        <rect x={sx(CY - GOAL_HALF)} y={sz(gh)} width={sx(CY + GOAL_HALF) - sx(CY - GOAL_HALF)} height={sz(0) - sz(gh)} fill="rgba(255,255,255,0.06)" />
        {tg.map((m, i) => (
          <g key={i} opacity={m.hit > 0 ? 0.25 : 1}>
            <rect x={sx(m.y0)} y={sz(m.z1)} width={sx(m.y1) - sx(m.y0)} height={sz(m.z0) - sz(m.z1)} fill={m.pts >= 5 ? 'rgba(255,210,63,0.75)' : 'rgba(56,225,255,0.6)'} stroke="#fff" strokeWidth={1.5} />
            <text x={(sx(m.y0) + sx(m.y1)) / 2} y={(sz(m.z0) + sz(m.z1)) / 2 + 5} textAnchor="middle" fontSize="14" fontWeight="800" fill="#0b1118">+{m.pts}</text>
          </g>
        ))}
        <path d={`M${sx(CY - GOAL_HALF)} ${sz(0)} V${sz(gh)} H${sx(CY + GOAL_HALF)} V${sz(0)}`} fill="none" stroke="#fff" strokeWidth={4} strokeLinejoin="round" />
        <line x1={0} y1={sz(0)} x2={W} y2={sz(0)} stroke="rgba(255,255,255,0.4)" strokeWidth={2} />
        {fresh && shot && <circle cx={Math.max(4, Math.min(W - 4, sx(shot.y)))} cy={Math.max(4, Math.min(H - 4, sz(shot.z)))} r={6} fill={shot.on ? '#3ee08a' : '#ff5a5f'} stroke="#fff" strokeWidth={2} />}
      </svg>
    </div>
  )
}

/** Slalom gates on the grass: two cones each, the next one lit up. */
function drawMarks(ctx: CanvasRenderingContext2D, view: View, marks: Mark[], now: number) {
  const proj = view['proj']
  if (typeof proj !== 'function') return
  for (const m of marks) {
    if (m.k !== 'gate') continue
    const col = m.state === 'next' ? '#ffd23f' : m.state === 'done' ? '#3ee08a' : m.state === 'missed' ? '#ff5a5f' : '#ff8a3d'
    const a = proj(m.x, m.y - m.half, 0), b = proj(m.x, m.y + m.half, 0)
    if (m.state === 'next') {
      ctx.save()
      ctx.strokeStyle = 'rgba(255,210,63,' + (0.45 + 0.35 * Math.sin(now / 180)) + ')'
      ctx.lineWidth = Math.max(2, a[2] * 0.25)
      ctx.setLineDash([a[2] * 0.6, a[2] * 0.4])
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke()
      ctx.restore()
    }
    for (const yy of [m.y - m.half, m.y + m.half]) {
      const base = proj(m.x, yy, 0), top = proj(m.x, yy, 0.75)
      const r = Math.max(3, base[2] * 0.28)
      ctx.fillStyle = col
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(base[0] - r, base[1]); ctx.lineTo(top[0], Math.min(top[1], base[1] - r * 1.6)); ctx.lineTo(base[0] + r, base[1]); ctx.closePath()
      ctx.fill(); ctx.stroke()
    }
  }
}
