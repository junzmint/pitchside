import { useEffect, useRef, useState } from 'react'
import { LanLink, lanRoomExists, type LanMessage, type LanState } from '../../lan/client'
import { extrapolate, type GuestDevice, type GuestHud, type InfoMsg } from '../../lan/protocol'
import { TouchPad, type PadState } from '../../lan/TouchPad'
import { InputHub } from '../../match/input'
import { BTN, type FrameState, type InputFrame, type Statics } from '../../match/frame'
import { View, type CamMode } from '../../match/render'
import { MatchAudio } from '../../match/audio'
import type { EngineEvent } from '../../match/engine'
import { useSettings } from '../../settings'
import { LangSwitch, useI18n } from '../../i18n'
import { ConfirmButton, Icon } from '../../ui'
import { gameKey, isTouchDevice, typing } from './keys'
import { KeyRows, TeamTag, WifiIcon, devParams, type Device } from './bits'
import { Shootout, initialCam, saveCam } from './PlayLive'

// The Wi-Fi guest: a phone, tablet or second laptop on the same network joins a match hosted on
// another computer with its four-letter code. No account or career is needed. The host runs the
// match; this page shows the picture it streams and sends back this device's controls (touch pad,
// controller or keyboard). Dropped connections reconnect on their own.

const CODE_CHARS = /[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/g
const MINI_KEY = 'pitchside.minimap'

export default function JoinPage({ initialCode, onExit }: { initialCode: string; onExit: () => void }) {
  const { t } = useI18n()
  const [code, setCode] = useState(initialCode.replace(CODE_CHARS, ''))
  const [joined, setJoined] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const join = async (c = code) => {
    if (c.length !== 4) return
    setBusy(true)
    setErr('')
    const ok = await lanRoomExists(c)
    setBusy(false)
    if (ok === false) { setErr(t('pl.join.noRoom')); return }
    if (ok === null) { setErr(t('pl.join.offline')); return }
    setJoined(c)
  }
  // a link with the code in it (QR code): join straight away
  useEffect(() => { if (initialCode.length === 4) join(initialCode) }, [])

  if (joined) return <GuestMatch code={joined} onLeave={() => { setJoined(''); setErr('') }} onExit={onExit} />

  return (
    <div className="center hero pl-joinwrap">
      <div className="card pl-join">
        <div className="row spread">
          <span className="eyebrow"><WifiIcon size={14} /> {t('pl.join.eyebrow')}</span>
          <LangSwitch />
        </div>
        <h2>{t('pl.join.title')}</h2>
        <p className="muted" style={{ margin: 0 }}>{t('pl.join.lead')}</p>
        <form className="pl-codeform" onSubmit={e => { e.preventDefault(); join() }}>
          <label htmlFor="pl-code">{t('pl.join.code')}</label>
          <input id="pl-code" className="pl-codein num" value={code} maxLength={4} autoFocus autoComplete="off" autoCapitalize="characters" spellCheck={false}
            inputMode="text" placeholder="ABCD" aria-describedby="pl-code-hint"
            onChange={e => { const c = e.target.value.toUpperCase().replace('O', '0').replace(CODE_CHARS, '').slice(0, 4); setCode(c); setErr(''); if (c.length === 4) join(c) }} />
          <small id="pl-code-hint" className="muted">{t('pl.join.codeHint')}</small>
          {err && <p className="error" style={{ margin: 0 }}>{err}</p>}
          <button className="primary big" disabled={code.length !== 4 || busy}><Icon name="playNow" size={18} /> {busy ? t('wait') : t('pl.join.go')}</button>
        </form>
        <ol className="pl-steps">
          <li>{t('pl.join.step1')}</li>
          <li>{t('pl.join.step2')}</li>
          <li>{t('pl.join.step3')}</li>
        </ol>
        <button onClick={onExit}><Icon name="prev" size={15} /> {t('back')}</button>
      </div>
    </div>
  )
}

interface FrameView { sc: [number, number]; min: number; half: number; bn: string; ph: string; so: FrameState['so'] }
interface EndInfo { sc: [number, number]; pens: [number, number] | null; et: boolean }

const ZERO: InputFrame = { x: 0, y: 0, rx: 0, ry: 0, b: 0 }
const r2 = (v: number) => Math.round(v * 100) / 100

function GuestMatch({ code, onLeave, onExit }: { code: string; onLeave: () => void; onExit: () => void }) {
  const { t, lang } = useI18n()
  const [settings, setS] = useSettings()
  const [state, setState] = useState<LanState>('connecting')
  const [hostHere, setHostHere] = useState(false)
  const [info, setInfo] = useState<InfoMsg | null>(null)
  const [hud, setHud] = useState<GuestHud | null>(null)
  const [fv, setFv] = useState<FrameView | null>(null)
  const [ended, setEnded] = useState<EndInfo | null>(null)
  const [haveStatics, setHaveStatics] = useState(false)
  const [rtt, setRtt] = useState(0)
  const [dev, setDev] = useState<Device>(() => (isTouchDevice() ? 'touch' : 'kb'))
  const [showPad, setShowPad] = useState(isTouchDevice)
  const [showKeys, setShowKeys] = useState(true)
  const [camMode, setCamMode] = useState<CamMode>(() => initialCam(settings.camera))
  // the minimap can be hidden (on a portrait phone it is small and sits in the corner anyway)
  const [mini, setMini] = useState(() => { try { return localStorage.getItem(MINI_KEY) !== '0' } catch { return true } })
  const miniRef = useRef(mini)
  miniRef.current = mini
  useEffect(() => { try { localStorage.setItem(MINI_KEY, mini ? '1' : '0') } catch { /* storage unavailable */ } }, [mini])
  const canvas = useRef<HTMLCanvasElement>(null)
  const linkRef = useRef<LanLink | null>(null)
  const viewRef = useRef(new View(camMode))
  const audioRef = useRef<MatchAudio | null>(null)
  const hubRef = useRef<InputHub | null>(null)
  const st = useRef<Statics | null>(null)
  const cur = useRef<{ f: FrameState; at: number; ex: number; ha: boolean } | null>(null)
  const prev = useRef<FrameState | null>(null)
  const ctxRef = useRef<GuestHud['ctx']>('att')
  const touch = useRef<{ s: PadState; at: number; sent: string }>({ s: { x: 0, y: 0, held: [] }, at: 0, sent: '' })
  const devRef = useRef(dev)
  devRef.current = dev
  const soundRef = useRef(settings.sound)
  soundRef.current = settings.sound
  const tRef = useRef(t)
  tRef.current = t

  const changeCam = (c: CamMode | number) => {
    const v = viewRef.current
    if (typeof c === 'number') v.next(c); else v.mode = c
    setCamMode(v.mode)
    saveCam(v.mode)
  }

  useEffect(() => { const a = audioRef.current; if (a) { a.setVolume(settings.volume, settings.sound); a.lang = lang } }, [settings.volume, settings.sound, lang])

  useEffect(() => {
    const audio = new MatchAudio(false, 0)
    audio.setVolume(settings.volume, settings.sound)
    audio.lang = lang
    audioRef.current = audio
    const hub = new InputHub(false, [[{ kind: 'kb' }], []], () => (ctxRef.current === 'def' ? 'def' : ctxRef.current === 'set' ? 'set' : 'att'))
    hub.rumbleOn = settings.rumble
    hubRef.current = hub
    let lastIn = '', lastSent = 0, lastPing = 0, lastRtt = 0, frames = 0, raf = 0, rttSmooth = 0, lastDev: Device = devRef.current
    const hello = () => link.send({ type: 'hello', dev: (devRef.current === 'touch' ? 'touch' : devRef.current) as GuestDevice })
    const link = new LanLink('guest', {
      state: s => setState(s),
      peer: (here, inf) => {
        setHostHere(here)
        if (inf && inf.type === 'info') setInfo(inf as unknown as InfoMsg)
        if (here) hello()
      },
      message: (m: LanMessage) => {
        switch (m.type) {
          case 'info': {
            const inf = m as unknown as InfoMsg
            setInfo(inf)
            if (inf.state !== 'ended') setEnded(null)
            if (inf.state === 'lobby') { cur.current = null; prev.current = null }
            break
          }
          case 'st': st.current = m.st as Statics; setHaveStatics(true); break
          case 'f': {
            const f = m.f as FrameState
            prev.current = cur.current?.f ?? null
            cur.current = { f, at: performance.now(), ex: Number(m.ex) || 0, ha: !!m.ha }
            if (!st.current) hello() // frames but no kits yet (joined mid-match): ask again
            break
          }
          case 'hud': { const h = m.h as GuestHud; ctxRef.current = h.ctx; setHud(h); break }
          case 'ev': {
            const e = m.e as EngineEvent
            audio.event(e)
            const r = e.r?.[1] ?? 0
            if (r > 0) {
              hub.rumble(0, r, r * 0.6, e.k === 'goal' ? 450 : 140)
              if (devRef.current === 'touch' && r >= 0.5 && navigator.vibrate) try { navigator.vibrate(e.k === 'goal' ? [60, 40, 120] : 30) } catch { /* ignore */ }
            }
            break
          }
          case 'end': setEnded({ sc: m.sc as [number, number], pens: (m.pens ?? null) as [number, number] | null, et: !!m.et }); break
          case 'pong': {
            const ms = performance.now() - Number(m.t)
            if (ms >= 0 && ms < 5000) { rttSmooth = rttSmooth ? rttSmooth * 0.7 + ms * 0.3 : ms; setRtt(Math.round(rttSmooth)) }
            break
          }
        }
      },
    }, { code })
    linkRef.current = link

    const send = (m: LanMessage) => { link.send(m); lastSent = performance.now() }
    const sendNeutral = () => { hub.kb.clear(); touch.current = { s: { x: 0, y: 0, held: [] }, at: 0, sent: '' }; send({ type: 'in', ...ZERO }); lastIn = JSON.stringify(ZERO) }
    const cv = canvas.current!
    const ctx2 = cv.getContext('2d')!
    const labels = { replay: tRef.current('lv.replay'), skip: tRef.current('lv.replaySkip') }
    let last = performance.now()
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      // controls → host (touch pad while it is in use, otherwise controllers and keyboard)
      const [f] = hub.poll()
      const tp = touch.current
      const touchLive = tp.s.held.length > 0 || tp.s.x !== 0 || tp.s.y !== 0 || now - tp.at < 400
      if (touchLive) {
        const key = JSON.stringify(tp.s)
        if (key !== tp.sent || now - lastSent > 100) { send({ type: 'tp', x: tp.s.x, y: tp.s.y, h: tp.s.held }); tp.sent = key }
      } else if (f) {
        const q = { x: r2(f.x), y: r2(f.y), rx: r2(f.rx), ry: r2(f.ry), b: f.b }
        const key = JSON.stringify(q)
        if (key !== lastIn || now - lastSent > 100) { send({ type: 'in', ...q }); lastIn = key }
      }
      const g: Device = now - tp.at < 5000 && tp.at > 0 ? 'touch' : hub.glyphs(0)
      if (g !== lastDev && (g !== 'kb' || hub.kb.active > 0 || tp.at === 0)) { lastDev = g; setDev(g) }
      if (now - lastPing > 2000) { lastPing = now; link.send({ type: 'ping', t: now }) }
      if (rttSmooth && now - lastRtt > 5000) { lastRtt = now; link.send({ type: 'rtt', ms: Math.round(rttSmooth) }) }
      // picture
      const dpr = window.devicePixelRatio || 1
      const w = cv.clientWidth, h = cv.clientHeight
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr) }
      const c = cur.current
      if (c && st.current && w > 0) {
        audio.tick(dt, c.ex, c.ha)
        const fr = extrapolate(prev.current, c.f, (now - c.at) / 1000)
        ctx2.setTransform(dpr, 0, 0, dpr, 0, 0)
        viewRef.current.draw(ctx2, w, h, fr, st.current, now, { labels, names: true, mini: miniRef.current })
        if (++frames % 6 === 0) {
          const x = c.f
          setFv(o => (o && o.sc[0] === x.sc[0] && o.sc[1] === x.sc[1] && o.min === x.min && o.half === x.half && o.bn === x.bn && o.ph === x.ph && JSON.stringify(o.so) === JSON.stringify(x.so)
            ? o : { sc: [x.sc[0], x.sc[1]], min: x.min, half: x.half, bn: x.bn, ph: x.ph, so: x.so }))
        }
      }
    }
    raf = requestAnimationFrame(loop)
    const kd = (e: KeyboardEvent) => {
      audio.wake()
      const k = gameKey(e)
      if (!k || typing(e)) return
      e.preventDefault()
      if (e.repeat) return
      if (k === 'KeyC') { changeCam(1); return }
      if (k === 'KeyH') { setShowKeys(v => !v); return }
      if (k === 'KeyM') { setS({ sound: !soundRef.current }); return }
      hub.kb.keyDown(k)
    }
    const ku = (e: KeyboardEvent) => { const k = gameKey(e); if (k) { hub.kb.keyUp(k); e.preventDefault() } }
    const wake = () => audio.wake()
    // this device steps away (screen off, other app): let go of every button and ask the host to pause
    const away = () => { sendNeutral(); if (document.hidden) link.send({ type: 'away' }) }
    const vis = () => { if (document.hidden) away() }
    let lock: { release: () => Promise<void> } | null = null
    const wakeLock = async () => {
      try { lock = await (navigator as unknown as { wakeLock?: { request: (k: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen') ?? null } catch { /* not supported */ }
    }
    wakeLock()
    const visLock = () => { if (!document.hidden) wakeLock() }
    audio.wake()
    window.addEventListener('keydown', kd)
    window.addEventListener('keyup', ku)
    window.addEventListener('pointerdown', wake)
    window.addEventListener('blur', sendNeutral)
    document.addEventListener('visibilitychange', vis)
    document.addEventListener('visibilitychange', visLock)
    return () => {
      cancelAnimationFrame(raf)
      link.close()
      audio.close()
      lock?.release().catch(() => {})
      window.removeEventListener('keydown', kd)
      window.removeEventListener('keyup', ku)
      window.removeEventListener('pointerdown', wake)
      window.removeEventListener('blur', sendNeutral)
      document.removeEventListener('visibilitychange', vis)
      document.removeEventListener('visibilitychange', visLock)
    }
  }, [code])

  // touch changes go out at once (a quick tap could otherwise fall between two frames); the loop resends them
  const onTouch = (s: PadState) => {
    const key = JSON.stringify(s)
    touch.current = { s, at: performance.now(), sent: key }
    linkRef.current?.send({ type: 'tp', x: s.x, y: s.y, h: s.held })
  }
  const tapStart = () => {
    const l = linkRef.current
    if (!l) return
    l.send({ type: 'in', ...ZERO, b: BTN.START })
    window.setTimeout(() => l.send({ type: 'in', ...ZERO }), 90)
  }
  const def = hud?.ctx === 'def'
  const padLabels: Record<string, string> = def
    ? { pass: t('pl.tp.switch'), shoot: t('pl.tp.tackle'), through: t('pl.tp.slide'), lob: t('pl.tp.press'), sprint: t('pl.tp.sprint'), skill: t('pl.tp.skill') }
    : { pass: t('pl.tp.pass'), shoot: t('pl.tp.shoot'), through: t('pl.tp.through'), lob: t('pl.tp.lob'), sprint: t('pl.tp.sprint'), skill: t('pl.tp.skill') }
  const live = !!info && info.state === 'live' && haveStatics && !!fv && !ended
  const me = info?.away, them = info?.home
  const clock = !fv ? '' : fv.half >= 5 ? t('lv.hud.pens') : `${fv.min}'${fv.half >= 3 ? ' ' + t('lv.hud.et') : ''}`
  const statusNote = state === 'retrying' ? t('pl.join.reconnecting') : !hostHere && state === 'open' && info ? t('pl.join.hostLost') : ''

  return (
    <div className={'pl-guest' + (showPad && live ? ' with-pad' : '')}>
      <div className="mhud pl-ghud">
        {live && fv ? (
          <div className="score num">
            <span className="tm"><i className="sw" style={{ background: them?.color }} />{them?.short}</span>
            <span>{fv.sc[0]} - {fv.sc[1]}</span>
            <span className="tm">{me?.short}<i className="sw" style={{ background: me?.color }} /></span>
            <span className="clock" data-tip={fv.half >= 3 && fv.half < 5 ? t('pl.live.etFull') : undefined}>{clock}</span>
          </div>
        ) : <span className="eyebrow"><WifiIcon size={14} /> {t('pl.join.room', { code })}</span>}
        <div className="mbar">
          {live && hud && <span className="pl-p p2" data-tip={t('pl.live.p2')}>P2 {hud.cpu ? t('lv.hud.cpu') : hud.name}</span>}
          {live && hud && !hud.cpu && <span className="stam p2" data-tip={t('stamina')}><i style={{ width: `${hud.st * 100}%` }} /></span>}
          <span className={'pl-ping num' + (rtt > 120 ? ' slow' : '')} data-tip={t('pl.lan.pingTip')}><WifiIcon size={13} /> {rtt ? `${rtt} ms` : '–'}</span>
          {live && <button onClick={() => changeCam(1)} data-tip={`${t('lv.cam.' + camMode)} (C)`} aria-label={t('lv.cam.' + camMode)}><Icon name="camera" size={15} /><span className="pl-bl"> {t('lv.cam.' + camMode)}</span></button>}
          {live && camMode !== 'wide' && <button className="lv-minibtn" aria-pressed={mini} onClick={() => setMini(v => !v)} data-tip={t('lv.m.minimap')} aria-label={t('lv.m.minimap')}><Icon name="tactics" size={15} /><span className="pl-bl"> {t('lv.m.minimap')}</span></button>}
          {live && <button onClick={tapStart} data-tip={hud?.paused ? t('resume') : t('pause')} aria-label={hud?.paused ? t('resume') : t('pause')}><Icon name={hud?.paused ? 'playNow' : 'timer'} size={15} /><span className="pl-bl"> {hud?.paused ? t('resume') : t('pause')}</span></button>}
          {live && isTouchDevice() && <button aria-pressed={showPad} onClick={() => setShowPad(v => !v)} data-tip={t('pl.join.pad')} aria-label={t('pl.join.pad')}><Icon name="tap" size={15} /><span className="pl-bl"> {t('pl.join.pad')}</span></button>}
          <button onClick={() => setS({ sound: !settings.sound })} aria-label={t('lv.m.sound')} data-tip={t('lv.m.sound')}><Icon name={settings.sound ? 'volume' : 'mute'} size={15} /></button>
          <ConfirmButton label={<><Icon name="logout" size={15} /><span className="pl-bl"> {t('pl.join.leave')}</span></>} title={t('pl.join.leave')} confirm={t('pl.join.leaveConfirm')} onConfirm={onLeave} />
        </div>
      </div>
      <div className="mcanvas pl-gcanvas">
        <canvas ref={canvas} aria-label={t('pitch')} />
        {live && hud && <div className="feed">{hud.feed.map((f, i) => <span key={i} style={{ opacity: 1 - i * 0.2 }}>{f}</span>)}</div>}
        {live && showKeys && hud && !hud.paused && !hud.cpu && hud.ctx !== 'none' && dev !== 'touch' && (
          <div className="keys lv-keys"><KeyRows group={hud.ctx} d={dev} max={hud.ctx === 'att' ? 7 : 8} /><span className="lv-row muted"><b>H</b><span>{t('lv.k.hide')}</span></span></div>
        )}
        {live && fv?.so && <Shootout so={fv.so} names={[them?.short ?? '', me?.short ?? '']} />}
        {live && fv?.bn && <div className={'banner' + (fv.ph === 'goal' ? ' lv-goal' : '')}>{fv.bn}</div>}
        {live && hud && !hud.paused && hud.pr && !hud.cpu && <div className="setpiece lv-prompt p2">{t('lv.p.' + hud.pr, devParams(t, dev, hud.ctx === 'def'))}</div>}
        {live && hud?.paused && (
          <div className="overlay pl-gpause"><div className="card">
            <h3>{t('paused')}</h3>
            <p className="muted" style={{ margin: 0 }}>{t('pl.join.pausedBody')}</p>
            <button className="primary" onClick={tapStart}><Icon name="playNow" size={16} /> {t('resume')}</button>
          </div></div>
        )}
        {live && hud?.cpu && !hud.paused && <div className="lv-join">{t('pl.join.cpuPlays')}</div>}
        {statusNote && live && <div className="lv-injury pl-net">{statusNote}</div>}
        {!live && (
          <div className="overlay pl-globby">
            <GuestCard state={state} hostHere={hostHere} info={info} ended={ended} code={code} onLeave={onLeave} onExit={onExit} />
          </div>
        )}
      </div>
      {live && showPad && <TouchPad onChange={onTouch} labels={padLabels} />}
    </div>
  )
}

function GuestCard({ state, hostHere, info, ended, code, onLeave, onExit }: {
  state: LanState; hostHere: boolean; info: InfoMsg | null; ended: EndInfo | null; code: string; onLeave: () => void; onExit: () => void
}) {
  const { t } = useI18n()
  if (state === 'gone') {
    return (
      <div className="card pl-gcard">
        <h3><WifiIcon /> {t('pl.join.goneTitle')}</h3>
        <p className="muted" style={{ margin: 0 }}>{t('pl.join.goneBody')}</p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="primary" onClick={onLeave}>{t('pl.join.another')}</button>
          <button onClick={onExit}><Icon name="prev" size={15} /> {t('back')}</button>
        </div>
      </div>
    )
  }
  const teams = info && (
    <div className="pl-vs">
      <TeamTag {...info.home} sub={`P1 · ${info.host}`} />
      <b className="pl-vsmid">VS</b>
      <TeamTag {...info.away} sub={`P2 · ${t('pl.join.you')}`} />
    </div>
  )
  if (ended && info) {
    const w = ended.sc[0] !== ended.sc[1] ? (ended.sc[0] > ended.sc[1] ? 1 : 2) : ended.pens ? (ended.pens[0] > ended.pens[1] ? 1 : 2) : 0
    return (
      <div className="card pl-gcard">
        <span className="eyebrow">{t('feed.fulltime')}{ended.et ? ` · ${t('lv.hud.aet')}` : ''}</span>
        <div className="pl-ftscore num"><span>{info.home.short}</span><b>{ended.sc[0]} - {ended.sc[1]}</b><span>{info.away.short}</span></div>
        {ended.pens && <p className="num" style={{ margin: 0 }}><b>{t('lv.hud.pensResult', { a: ended.pens[0], b: ended.pens[1] })}</b></p>}
        <h3 style={{ margin: 0 }}>{w === 2 ? t('pl.join.youWon') : w === 1 ? t('pl.join.youLost') : t('pl.ft.draw')}</h3>
        <div className="pl-wait"><span className="pl-dots"><i /><i /><i /></span> {t('pl.join.waitRematch')}</div>
      </div>
    )
  }
  const connecting = state === 'connecting' || state === 'retrying'
  return (
    <div className="card pl-gcard">
      <span className="eyebrow"><WifiIcon size={14} /> {t('pl.join.room', { code })}</span>
      {teams}
      <div className="pl-wait"><span className="pl-dots"><i /><i /><i /></span> {
        connecting ? (state === 'retrying' ? t('pl.join.reconnecting') : t('pl.join.connecting'))
          : !hostHere ? t('pl.join.hostLost')
          : !info ? t('pl.join.waitHost')
          : info.state === 'live' ? t('pl.join.loading')
          : t('pl.join.waitStart', { host: info.host })
      }</div>
      <p className="muted" style={{ margin: 0, textAlign: 'center' }}>{t('pl.join.tip')}</p>
      <button onClick={onLeave}><Icon name="prev" size={15} /> {t('pl.join.leave')}</button>
    </div>
  )
}
