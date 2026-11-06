import { useEffect, useRef, useState } from 'react'
import type { MatchSetup } from '../../types'
import { Engine, type Difficulty, type EngineEvent, type HudState, type MatchOutcome, type Side } from '../../match/engine'
import { InputHub, type DeviceRef } from '../../match/input'
import type { Glyphs } from '../../match/frame'
import { CAMS, View, type CamMode } from '../../match/render'
import { MatchAudio } from '../../match/audio'
import { AwayWatch, MatchClock, keepRunning } from '../../match/loop'
import { setSettings, useSettings, type Camera } from '../../settings'
import { ConfirmButton, Icon, Seg } from '../../ui'
import { useI18n } from '../../i18n'
import type { LanHost } from '../../lan/host'
import { gameKey, typing } from './keys'
import { KeyRows, WifiIcon, devParams } from './bits'
import { MatchTouch, RotateHint, enterGameScreen, isTouchDevice, leaveGameScreen, touchParams, usePortrait } from '../../match/touch'

// The live screen of a quick match: one player against the computer, two players on this device,
// or player 2 on another device over Wi-Fi (this browser runs the only engine and streams the
// picture). Built on the same engine, input hub, renderer and sound as the career's live match;
// nothing here is saved.

export type Assign = [DeviceRef[], DeviceRef[]]
export type LiveMode = 'cpu' | 'duo' | 'lan'

const CAM_KEY = 'pitchside.cam'
export function initialCam(fallback: Camera): CamMode {
  try { const c = localStorage.getItem(CAM_KEY) as CamMode | null; if (c && CAMS.includes(c)) return c } catch { /* ignore */ }
  return fallback
}
export function saveCam(c: CamMode) {
  try { localStorage.setItem(CAM_KEY, c) } catch { /* ignore */ }
  setSettings({ camera: c })
}

export function PlayLive({ setup, mode, assign, halfSeconds, difficulty, replays, lan, onFullTime, onRematch, onLeave }: {
  setup: MatchSetup; mode: LiveMode; assign: Assign; halfSeconds: number; difficulty: Difficulty; replays: boolean; lan?: LanHost | null
  onFullTime: (o: MatchOutcome) => void; onRematch: () => void; onLeave: () => void
}) {
  const { t, lang } = useI18n()
  const [settings, setS] = useSettings()
  const canvas = useRef<HTMLCanvasElement>(null)
  const engRef = useRef<Engine | null>(null)
  const hubRef = useRef<InputHub | null>(null)
  const viewRef = useRef<View>(new View(initialCam(settings.camera)))
  const audioRef = useRef<MatchAudio | null>(null)
  const [hud, setHud] = useState<HudState | null>(null)
  const [done, setDone] = useState<MatchOutcome | null>(null)
  const [glyphs, setGlyphs] = useState<[Glyphs, Glyphs]>(['kb', 'kb'])
  const [camMode, setCamMode] = useState<CamMode>(viewRef.current.mode)
  const [showKeys, setShowKeys] = useState(true)
  const [lost, setLost] = useState<'' | 'lan' | 'pad'>('')
  const lostRef = useRef(lost)
  lostRef.current = lost
  const [padLabel, setPadLabel] = useState('')
  const [back, setBack] = useState(false)
  /** sides the computer plays while nobody is at this device, and the clock running through missed time */
  const [awaySides, setAwaySides] = useState<[boolean, boolean]>([false, false])
  const [catching, setCatching] = useState(false)
  const [, force] = useState(0)
  const tRef = useRef(t)
  tRef.current = t
  const fullRef = useRef(onFullTime)
  fullRef.current = onFullTime
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const home = setup.home, away = setup.away

  const changeCam = (d: number | CamMode) => {
    const v = viewRef.current
    if (typeof d === 'number') v.next(d); else v.mode = d
    setCamMode(v.mode)
    saveCam(v.mode)
  }

  useEffect(() => { const a = audioRef.current; if (a) { a.setVolume(settings.volume, settings.sound); a.lang = lang } if (hubRef.current) hubRef.current.rumbleOn = settings.rumble }, [settings.volume, settings.sound, settings.rumble, lang])
  // the lobby screen re-renders on Wi-Fi changes; so do we (P2 chip, ping)
  useEffect(() => lan?.subscribe(() => force(x => x + 1)), [lan])

  useEffect(() => {
    const audio = new MatchAudio(!!setup.derby, setup.userIsHome ? 0 : 1)
    audio.setVolume(settings.volume, settings.sound)
    audio.lang = lang
    audioRef.current = audio
    let hub: InputHub | null = null
    const clock = new MatchClock()
    const onEvent = (e: EngineEvent) => {
      if (e.k === 'cam') { changeCam(e.v ?? 1); return }
      lan?.event(e)
      if (clock.quiet) return // running through time the page missed: no burst of sound
      audio.event(e)
      if (e.r && hub) for (const s of [0, 1] as const) if (e.r[s] > 0) hub.rumble(s, e.r[s], e.r[s] * 0.6, e.k === 'goal' ? 450 : 140)
    }
    const p2 = mode === 'duo' ? assign[1].length > 0 : mode === 'lan' ? !!lan?.guest : false
    const eng = new Engine(setup, {
      halfSeconds, difficulty, replays, onEvent, t: (k, p) => tRef.current(k, p), humans: [true, p2],
    }, o => { setDone(o); lan?.end(o); fullRef.current(o) })
    engRef.current = eng
    hub = new InputHub(mode === 'duo', mode === 'duo' ? assign : [[{ kind: 'kb' }], []], side => eng.contextOf(side))
    hub.rumbleOn = settings.rumble
    hubRef.current = hub
    // a Wi-Fi guest plays on his own device: only this device's sides go to the computer while nobody is here
    const gone = new AwayWatch(eng, hub, s => !(mode === 'lan' && s === 1))
    hub.onDisconnect = (side, label) => {
      if (eng.phase === 'end' || gone.sides[side]) return
      eng.pause('disconnect')
      setPadLabel(`P${side + 1} · ${label}`)
      setLost('pad')
    }
    hub.onJoin = side => {
      if (mode === 'duo' && side === 1 && !eng.human[1]) eng.setHuman(1, true)
      setLost(l => (l === 'pad' ? '' : l))
    }
    if (mode === 'lan' && lan) {
      lan.bind(eng, hub)
      lan.onGuest = here => {
        if (eng.phase === 'end') return
        if (here) {
          if (!eng.human[1]) eng.setHuman(1, true)
          if (lostRef.current === 'lan') {
            // P2 is back: a moment to get ready, then play on
            setLost('')
            setBack(true)
            window.setTimeout(() => { setBack(false); if (eng.paused && eng.pauseReason === 'disconnect') eng.resume() }, 1800)
          }
        } else if (eng.human[1]) {
          eng.pause('disconnect')
          setLost('lan')
        }
      }
    }
    if (import.meta.env.DEV) (window as unknown as { __eng: Engine }).__eng = eng
    const cv = canvas.current!
    const ctx2 = cv.getContext('2d')!
    let frames = 0, wasPaused = false, hudAt = 0
    const labels = { replay: tRef.current('lv.replay'), skip: tRef.current('lv.replaySkip') }
    const showAway = () => setAwaySides(a => (a[0] === gone.sides[0] && a[1] === gone.sides[1] ? a : [gone.sides[0], gone.sides[1]]))
    const tail = (dt: number) => {
      if (eng.paused !== wasPaused) { wasPaused = eng.paused; if (wasPaused) audio.suspend(); else audio.resume() }
      const [ex, homeAtt] = eng.excitement()
      audio.tick(Math.min(dt, 0.1), ex, homeAtt)
    }
    const frame = (now: number) => {
      const dpr = window.devicePixelRatio || 1
      const w = cv.clientWidth, h = cv.clientHeight
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr) }
      const dt = clock.delta(now)
      // the set-piece camera turns the sticks with the picture (up = towards the goal); a Wi-Fi guest's are turned on
      // his own device
      const [p0, p1] = hub!.poll()
      const v = viewRef.current
      const f0 = v.stick(p0), f1 = mode === 'lan' ? p1 : v.stick(p1)
      eng.setInput(0, f0)
      eng.setInput(1, f1)
      gone.check() // back at the keys or the controller: your side is yours again
      clock.run(eng, dt, 1, true, 12)
      tail(dt)
      ctx2.setTransform(dpr, 0, 0, dpr, 0, 0)
      viewRef.current.draw(ctx2, w, h, eng.frameState(), eng.statics(), now, { labels, names: true, setPiece: true })
      lan?.tick(now)
      frames++
      if (frames % 6 === 0) {
        setHud(eng.hud())
        setGlyphs(g => { const a = hub!.glyphs(0), b = hub!.glyphs(1); return g[0] === a && g[1] === b ? g : [a, b] })
        showAway()
        setCatching(clock.catchingUp)
      }
    }
    // no animation frames (the page is hidden, the window minimised or on another desktop): the match goes on without
    // a picture here; a Wi-Fi guest still plays and still gets the picture
    const idle = (now: number) => {
      const dt = clock.delta(now)
      eng.setInput(0, null)
      eng.setInput(1, mode === 'lan' ? hub!.pollRemote()[1] : null)
      clock.run(eng, dt, 1, mode === 'lan' && !!lan?.guest, 100)
      tail(dt)
      lan?.tick(now)
      if (now - hudAt > 250) { hudAt = now; setHud(eng.hud()); showAway() }
    }
    const stopLoop = keepRunning(frame, idle, mode === 'lan' ? 16 : 50)
    const kd = (e: KeyboardEvent) => {
      audio.wake()
      const k = gameKey(e)
      if (!k || typing(e)) return
      if (eng.paused) {
        if (k === 'Escape' || k === 'KeyP') { e.preventDefault(); if (eng.pauseReason !== 'disconnect') eng.resume() }
        return
      }
      e.preventDefault()
      if (e.repeat) return
      if (k === 'KeyC') { changeCam(1); return }
      if (k === 'KeyH') { setShowKeys(v => !v); return }
      if (k === 'KeyM') { setS({ sound: !settingsRef.current.sound }); return }
      if (k === 'Digit1' || k === 'Digit2' || k === 'Digit3') { eng.setMentality(hub!.kb.side, k === 'Digit1' ? 'defensive' : k === 'Digit2' ? 'balanced' : 'attacking'); return }
      if (k === 'Enter' && eng.phase === 'replay') { eng.skipReplay(); return }
      hub!.kb.keyDown(k)
    }
    const ku = (e: KeyboardEvent) => { const k = gameKey(e); if (k) { hub!.kb.keyUp(k); if (!eng.paused) e.preventDefault() } }
    const wake = () => audio.wake()
    // looking away doesn't pause (only the pause button does): the computer plays this device's sides until you're
    // back, and a Wi-Fi guest plays on
    const blur = () => { hub!.kb.clear(); gone.leave(); showAway() }
    const vis = () => { if (document.hidden) blur() }
    audio.wake()
    document.addEventListener('visibilitychange', vis)
    window.addEventListener('keydown', kd)
    window.addEventListener('keyup', ku)
    window.addEventListener('pointerdown', wake)
    window.addEventListener('blur', blur)
    return () => {
      stopLoop()
      audio.close()
      if (lan) { lan.unbind(); lan.onGuest = () => {} }
      window.removeEventListener('keydown', kd)
      window.removeEventListener('keyup', ku)
      window.removeEventListener('pointerdown', wake)
      window.removeEventListener('blur', blur)
      document.removeEventListener('visibilitychange', vis)
    }
  }, [setup, halfSeconds, difficulty])

  const eng = engRef.current
  const duo = mode !== 'cpu'
  const menuOpen = !!hud?.paused && (hud.pauseReason === 'user' || hud.pauseReason === 'menu') && !done
  // phones and tablets: an on-screen pad for P1, and the match waits while the device is held upright
  const [touch] = useState(isTouchDevice)
  const portrait = usePortrait()
  const [padOn, setPadOn] = useState(true)
  const usingPad = glyphs[0] === 'ps' || glyphs[0] === 'xbox'
  const showPad = touch && padOn && !done && !usingPad
  const rotate = touch && portrait && !done
  useEffect(() => {
    if (!eng) return
    if (rotate && !eng.paused) eng.pause('rotate')
    else if (!rotate && eng.paused && eng.pauseReason === 'rotate') eng.resume()
  }, [rotate, eng, hud?.paused])
  const leave = () => { leaveGameScreen(); onLeave() }
  const params = (s: Side) => (glyphs[s] === 'touch' ? touchParams(t, hud!.sides[s].ctx === 'def') : devParams(t, glyphs[s], hud!.sides[s].ctx === 'def'))
  const reds = (s: Side) => hud?.cards.filter(c => c.team === s && c.kind === 'r').length ?? 0
  const clock = !hud ? "0'" : hud.half >= 5 ? t('lv.hud.pens') : `${hud.minute}'${hud.half >= 3 ? ' ' + t('lv.hud.et') : ''}`
  // P1's prompts always; P2's only when P2 sits at this screen (on Wi-Fi the guest's own device shows them)
  const prompts = ([0, 1] as const).filter(s => hud?.human[s] && hud.sides[s].prompt && (s === 0 || mode === 'duo'))
  const p2Label = mode === 'lan' ? (lan?.guest ? (hud?.human[1] ? hud.sides[1].name : t('lv.hud.cpu')) : t('pl.lan.waitingShort')) : hud?.human[1] ? hud.sides[1].name : t('lv.hud.cpu')
  const resume = () => eng?.resume()

  return (
    <div className="matchwrap pl-live">
      <div className="mhud">
        <div className="score num">
          <span className="tm"><i className="sw" style={{ background: hud?.colors[0] ?? home.club.color }} />{home.club.short}{reds(0) > 0 && <i className="lv-red">{'▮'.repeat(reds(0))}</i>}</span>
          <span>{hud?.score[0] ?? 0} - {hud?.score[1] ?? 0}</span>
          <span className="tm">{reds(1) > 0 && <i className="lv-red">{'▮'.repeat(reds(1))}</i>}{away.club.short}<i className="sw" style={{ background: hud?.colors[1] ?? away.club.color }} /></span>
          <span className="clock" data-tip={hud && hud.half >= 3 && hud.half < 5 ? t('pl.live.etFull') : undefined}>{clock}</span>
        </div>
        <div className="mbar">
          <span className="pl-p p1" data-tip={t('pl.live.p1')}>P1 {hud?.sides[0].name}</span>
          <span className="stam" data-tip={t('stamina')}><i style={{ width: `${(hud?.sides[0].stamina ?? 1) * 100}%` }} /></span>
          {duo && <>
            <span className="pl-p p2" data-tip={t('pl.live.p2')}>{mode === 'lan' && <WifiIcon size={14} />} P2 {p2Label}</span>
            {hud?.human[1] && <span className="stam p2" data-tip={t('stamina')}><i style={{ width: `${(hud?.sides[1].stamina ?? 1) * 100}%` }} /></span>}
            {mode === 'lan' && lan?.guest && lan.rtt > 0 && <span className="pl-ping num" data-tip={t('pl.lan.pingTip')}>{lan.rtt} ms</span>}
          </>}
          <span className="num">{t('possession')} {hud?.poss ?? 50}% · {t('shots')} {hud?.stats.shots[0] ?? 0}-{hud?.stats.shots[1] ?? 0}</span>
          <button data-tip="C" onClick={() => changeCam(1)}><Icon name="camera" size={15} /> {t('lv.cam.' + camMode)}</button>
          {touch && <button className={'lv-padbtn' + (showPad ? ' on' : '')} onClick={() => setPadOn(!showPad)} aria-pressed={showPad} data-tip={t('touch.padTip')}>✋ {t('touch.pad')}</button>}
          {touch && !document.fullscreenElement && <button className="lv-fsbtn" onClick={() => void enterGameScreen()} data-tip={t('touch.fullTip')}>⛶</button>}
          <button disabled={!!lost || !!done} onClick={() => { if (!eng) return; if (eng.paused) resume(); else eng.pause('menu') }}>{hud?.paused ? t('resume') : t('pause')}</button>
          <ConfirmButton label={t('mp.leave')} confirm={t('pl.live.leaveConfirm')} onConfirm={leave} />
        </div>
      </div>
      <div className="mcanvas">
        <canvas ref={canvas} tabIndex={0} aria-label={t('pitch')} />
        <div className="feed">{hud?.feed.map((f, i) => <span key={i} style={{ opacity: 1 - i * 0.14 }}>{f}</span>)}</div>
        {showKeys && !showPad && hud && hud.sides[0].ctx !== 'none' && !hud.paused && (
          <div className="keys lv-keys">
            <KeyRows group={hud.sides[0].ctx} d={glyphs[0]} max={hud.sides[0].ctx === 'att' ? 8 : 9} />
            {mode === 'duo' && hud.human[1] && hud.sides[1].ctx !== 'none' && <><i className="p2">P2</i><KeyRows group={hud.sides[1].ctx} d={glyphs[1]} max={6} /></>}
            <span className="lv-row muted"><b>H</b><span>{t('lv.k.hide')}</span></span>
          </div>
        )}
        {hud?.so && <Shootout so={hud.so} names={[home.club.short, away.club.short]} />}
        {hud?.banner && <div className={'banner' + (hud.phase === 'goal' ? ' lv-goal' : '')}>{hud.banner}</div>}
        {!hud?.paused && prompts.map(s => (
          <div key={s} className={'setpiece lv-prompt p' + (s + 1) + (prompts.length > 1 ? ' two' : '')}>
            {duo && <b>P{s + 1} </b>}{t('lv.p.' + hud!.sides[s].prompt, params(s))}
          </div>
        ))}
        {!hud?.paused && mode === 'duo' && hud && !hud.human[1] && !awaySides[1] && <div className="lv-join">{t('lv.hud.p2join')}</div>}
        {(awaySides[0] || awaySides[1]) && hud && !hud.paused && !done && (
          <div className="lv-join lv-away">{mode === 'duo' && <b>{awaySides.flatMap((a, s) => (a ? [`P${s + 1}`] : [])).join(' · ')} · </b>}{t('lv.away')}</div>
        )}
        {catching && !done && <div className="setpiece">⏩ {t('lv.catchUp')}</div>}
        {back && <div className="setpiece pl-back"><WifiIcon /> {t('pl.lan.back')}</div>}
        {menuOpen && eng && (
          <PauseCard eng={eng} hud={hud!} g={glyphs[0]} camMode={camMode} onCam={changeCam} onResume={resume} onLeave={leave} showKeys={showKeys} setShowKeys={setShowKeys} />
        )}
        {hud?.paused && hud.pauseReason === 'disconnect' && lost && eng && !done && (
          <div className="overlay">
            <div className="card pl-lost">
              {lost === 'lan' ? <>
                <h3><WifiIcon /> {t('pl.lan.lostTitle')}</h3>
                <p className="muted">{t('pl.lan.lostBody', { code: lan?.code ?? '' })}</p>
                <div className="pl-wait"><span className="pl-dots"><i /><i /><i /></span> {t('pl.lan.waiting')}</div>
                <div className="row" style={{ justifyContent: 'center' }}>
                  <button className="primary" onClick={() => { eng.setHuman(1, false); setLost(''); resume() }}><Icon name="playNow" size={15} /> {t('pl.lan.cpuTakes')}</button>
                  <ConfirmButton label={t('mp.leave')} confirm={t('pl.live.leaveConfirm')} onConfirm={leave} />
                </div>
              </> : <>
                <h3><Icon name="gamepad" /> {t('pl.live.padLost')}</h3>
                <p className="muted">{t('pl.live.padLostBody', { pad: padLabel })}</p>
                <div className="row" style={{ justifyContent: 'center' }}>
                  {mode === 'duo' && <button onClick={() => { eng.setHuman(1, false); setLost(''); resume() }}>{t('lv.disc.cpu')}</button>}
                  <button className="primary" onClick={() => { setLost(''); resume() }}>{t('mp.backToMatch')}</button>
                </div>
              </>}
            </div>
          </div>
        )}
        {showPad && hud && !menuOpen && !lost && (
          <MatchTouch hub={hubRef.current} side={0} ctxOf={s => engRef.current?.contextOf(s) ?? 'att'} def={hud.sides[0].ctx === 'def'} />
        )}
        {rotate && <RotateHint onLeave={leave} />}
        {done && (
          <div className="overlay">
            <div className="card pl-ft">
              <span className="eyebrow">{t('pl.quick.title')}</span>
              <h3>{t('feed.fulltime')}{done.extraTime ? ` · ${t('lv.hud.aet')}` : ''}</h3>
              <div className="pl-ftscore num">
                <span>{home.club.short}</span><b>{done.homeGoals} - {done.awayGoals}</b><span>{away.club.short}</span>
              </div>
              {done.pens && <p className="num" style={{ margin: 0 }}><b>{t('lv.hud.pensResult', { a: done.pens[0], b: done.pens[1] })}</b></p>}
              <p className="muted" style={{ margin: 0 }}>{ftLine(t, done, mode, home.club.name, away.club.name)}</p>
              <div className="row" style={{ justifyContent: 'center' }}>
                <button className="primary" onClick={onRematch}><Icon name="replay" size={16} /> {t('pl.ft.rematch')}</button>
                <button onClick={leave}><Icon name="prev" size={16} /> {t('pl.ft.back')}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ftLine(t: (k: string, p?: Record<string, string | number>) => string, o: MatchOutcome, mode: LiveMode, home: string, away: string) {
  const w = o.homeGoals !== o.awayGoals ? (o.homeGoals > o.awayGoals ? 1 : 2) : o.pens ? (o.pens[0] > o.pens[1] ? 1 : 2) : 0
  if (mode === 'cpu') return w === 1 ? t('pl.ft.youWin') : w === 2 ? t('pl.ft.youLose') : t('pl.ft.draw')
  return w === 0 ? t('pl.ft.draw') : t('pl.ft.wins', { p: w === 1 ? 'P1' : 'P2', team: w === 1 ? home : away })
}

export function Shootout({ so, names }: { so: { k: [number[], number[]]; turn: number }; names: [string, string] }) {
  const n = Math.max(5, so.k[0].length, so.k[1].length)
  return (
    <div className="lv-so">
      {([0, 1] as const).map(s => (
        <div key={s} className={'lv-so-row' + (so.turn === s ? ' turn' : '')}>
          <b>{names[s]}</b>
          {Array.from({ length: n }, (_, i) => <i key={i} className={so.k[s][i] === 1 ? 'in' : so.k[s][i] === 0 ? 'out' : ''}>{so.k[s][i] === 1 ? '✓' : so.k[s][i] === 0 ? '✗' : '·'}</i>)}
          <span className="num">{so.k[s].reduce((a, b) => a + b, 0)}</span>
        </div>
      ))}
    </div>
  )
}

function PauseCard({ eng, hud, g, camMode, onCam, onResume, onLeave, showKeys, setShowKeys }: {
  eng: Engine; hud: HudState; g: Glyphs; camMode: CamMode; onCam: (c: CamMode) => void; onResume: () => void; onLeave: () => void
  showKeys: boolean; setShowKeys: (v: boolean) => void
}) {
  const { t } = useI18n()
  const [settings, setS] = useSettings()
  const [dev, setDev] = useState<Glyphs>(g)
  const st = hud.stats
  return (
    <div className="overlay lv-menu">
      <div className="card pl-pause">
        <div className="row spread">
          <h3 style={{ margin: 0 }}>{t('lv.m.title')} · <span className="num">{eng.shorts[0]} {hud.score[0]}-{hud.score[1]} {eng.shorts[1]}</span></h3>
          <button className="primary" onClick={onResume}><Icon name="playNow" size={15} /> {t('mp.backToMatch')}</button>
        </div>
        <p className="muted num" style={{ margin: 0 }}>{t('possession')} {hud.poss}% · {t('shots')} {st.shots[0]}-{st.shots[1]} · {t('lv.st.onTarget')} {st.onTarget[0]}-{st.onTarget[1]}</p>
        <div className="row spread"><b>{t('lv.pre.camera')}</b><Seg value={camMode} options={CAMS.map(c => [c, t('lv.cam.' + c)] as [CamMode, string])} onChange={onCam} /></div>
        <div className="row spread"><b>{t('lv.m.sound')}</b><Seg value={settings.sound ? 'on' : 'off'} options={[['on', t('lv.m.on')], ['off', t('lv.m.off')]]} onChange={v => setS({ sound: v === 'on' })} /></div>
        <label className="row lv-check"><input type="checkbox" checked={showKeys} onChange={e => setShowKeys(e.target.checked)} /> {t('lv.m.showKeys')}</label>
        <div className="row spread"><b>{t('lv.m.controls')}</b><Seg value={dev} options={[['kb', <Icon key="k" name="keyboard" size={15} />], ['ps', 'PlayStation'], ['xbox', 'Xbox']]} onChange={setDev} /></div>
        <div className="lv-ctlgrid wide">
          <div><i>{t('ctl.attack')}</i><KeyRows group="att" d={dev} /></div>
          <div><i>{t('ctl.defend')}</i><KeyRows group="def" d={dev} /><i>{t('lv.m.general')}</i><KeyRows group="gen" d={dev} /></div>
          <div><i>{t('lv.m.setPieces')}</i><KeyRows group="set" d={dev} /><i>{t('lv.m.penalties')}</i><KeyRows group="pen" d={dev} /></div>
        </div>
        <div className="row"><ConfirmButton label={t('mp.leave')} confirm={t('pl.live.leaveConfirm')} onConfirm={onLeave} /></div>
      </div>
    </div>
  )
}
