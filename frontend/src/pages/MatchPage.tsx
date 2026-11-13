import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Ctx } from '../App'
import { api, money } from '../api'
import type { DayReport, MatchSetup } from '../types'
import { Engine, defaultAssists, edgeFromOdds, takeSnapshot, type Assists, type Difficulty, type EngineEvent, type HudState, type MatchOutcome, type Side, chooseKits, kitSetOf, type KitChoice, type KitSet } from '../match/engine'
import { KitSVG } from '../kit'
import { MatchTouch, RotateHint, enterGameScreen, isTouchDevice, leaveGameScreen, touchParams, usePortrait } from '../match/touch'
import { clearSnapshot, loadSnapshot, saveSnapshot, type Snapshot } from '../match/snapshot'
import { InputHub, KB_CODES, type DeviceRef } from '../match/input'
import { listPads, rawPad, type PadInfo } from '../match/gamepad'
import { BTN, type Glyphs } from '../match/frame'
import { CAMS, View, type CamMode } from '../match/render'
import { MatchAudio } from '../match/audio'
import { AwayWatch, MatchClock, keepRunning } from '../match/loop'
import { COMBO_ROWS, ROWS, glyph, glyphParams, type CtlGroup } from '../match/controls'
import { PostMatch } from '../match/PostMatch'
import { manOfTheMatch, rateMatch } from '../match/ratings'
import { CelebPicker, FitBars, Intro, Scoreboard, SubTip, TIP_S, TIRED, benchOrder, staminaTone, suggestSub, type SubTipData } from '../match/Presentation'
import { subTipDue } from '../match/tips'
import { Tutorial, markTutorialSeen, tutorialSeen } from '../match/Tutorial'
import { styleFor, styleLine } from '../match/style'
import { setSettings, useSettings, type Camera } from '../settings'
import { refusalText } from './Demands'
import { happeningText, happeningTone } from './EventsInbox'
import { feedText } from './Explore'
import { Badge, Bar, ConfirmButton, Icon, Ovr, PosTag, Seg, useStageLabel, Hint } from '../ui'
import { alertText } from './Alerts'
import { OppSheetButton } from './OppSheet'
import { errText, useI18n } from '../i18n'

type Stage = 'pre' | 'live' | 'saving' | 'report'
export type PlayMode = 'play' | 'watch' | 'duo'
type Assign = [DeviceRef[], DeviceRef[]]

// Keyboard layouts and Vietnamese input methods (Telex/VNI, EVKey, OpenKey…) don't always send a
// usable KeyboardEvent.code, so fall back to the character and then the legacy keyCode.
const BY_CHAR: Record<string, string> = {
  w: 'KeyW', 'ư': 'KeyW', a: 'KeyA', s: 'KeyS', d: 'KeyD', 'đ': 'KeyD', j: 'KeyJ', k: 'KeyK', l: 'KeyL', i: 'KeyI', p: 'KeyP', q: 'KeyQ', e: 'KeyE',
  u: 'KeyU', c: 'KeyC', h: 'KeyH', m: 'KeyM', f: 'KeyF', t: 'KeyT', '1': 'Digit1', '2': 'Digit2', '3': 'Digit3', '4': 'Digit4', ' ': 'Space', arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight', shift: 'ShiftLeft', escape: 'Escape', enter: 'Enter', tab: 'Tab',
}
const BY_KEYCODE: Record<number, string> = {
  87: 'KeyW', 65: 'KeyA', 83: 'KeyS', 68: 'KeyD', 74: 'KeyJ', 75: 'KeyK', 76: 'KeyL', 73: 'KeyI', 80: 'KeyP', 81: 'KeyQ', 69: 'KeyE', 85: 'KeyU',
  67: 'KeyC', 72: 'KeyH', 77: 'KeyM', 70: 'KeyF', 84: 'KeyT', 49: 'Digit1', 50: 'Digit2', 51: 'Digit3', 52: 'Digit4', 37: 'ArrowLeft', 38: 'ArrowUp',
  39: 'ArrowRight', 40: 'ArrowDown', 16: 'ShiftLeft', 32: 'Space', 27: 'Escape', 13: 'Enter', 9: 'Tab',
}
const UI_KEYS = new Set(['Digit1', 'Digit2', 'Digit3', 'Digit4', 'KeyC', 'KeyH', 'KeyM', 'KeyF', 'KeyT', 'Enter'])
/** pass, shoot, through ball, lob: the keys that take a kick-off */
const KICK_KEYS = new Set(['KeyJ', 'KeyK', 'KeyL', 'KeyI'])
function gameKey(e: KeyboardEvent): string | null {
  if (KB_CODES.has(e.code) || UI_KEYS.has(e.code)) return e.code
  const byChar = BY_CHAR[(e.key ?? '').toLowerCase()]
  if (byChar) return byChar
  return BY_KEYCODE[e.keyCode] ?? null
}

const CAM_KEY = 'pitchside.cam'
function initialCam(fallback: Camera): CamMode {
  try { const c = localStorage.getItem(CAM_KEY) as CamMode | null; if (c && CAMS.includes(c)) return c } catch { /* ignore */ }
  return fallback
}
function saveCam(c: CamMode) {
  try { localStorage.setItem(CAM_KEY, c) } catch { /* ignore */ }
  setSettings({ camera: c })
}
const pref = (k: string, d: boolean) => { try { const v = localStorage.getItem(k); return v == null ? d : v === '1' } catch { return d } }
/** Beginner help, remembered per difficulty (defaults: easy and normal all on, hard only auto-switch). */
function loadAssists(d: Difficulty): Assists {
  const def = defaultAssists(d)
  try { const v = JSON.parse(localStorage.getItem('pitchside.assist.' + d) ?? 'null'); if (v && typeof v === 'object') return { pass: v.pass ?? def.pass, shot: v.shot ?? def.shot, switch: v.switch ?? def.switch } } catch { /* ignore */ }
  return def
}
function saveAssists(d: Difficulty, a: Assists) { try { localStorage.setItem('pitchside.assist.' + d, JSON.stringify(a)) } catch { /* ignore */ } }

/** Three toggles for the beginner help (pass, shot, auto-switch). */
function AssistToggles({ value, onChange }: { value: Assists; onChange: (a: Assists) => void }) {
  const { t } = useI18n()
  return (
    <div className="lv-assists">
      {(['pass', 'shot', 'switch'] as const).map(k => (
        <button key={k} aria-pressed={value[k]} data-tip={t('lv.as.' + k + 'Tip')} onClick={() => onChange({ ...value, [k]: !value[k] })}>
          <i>{value[k] ? '✓' : ''}</i>{t('lv.as.' + k)}
        </button>
      ))}
    </div>
  )
}
/** Career matches have no easy level: the result counts, so playing it can't be easier than simulating it (easy
 *  stays for quick matches). A saved easy setting plays a career match on normal. */
const careerDiff = (d: Difficulty): Difficulty => (d === 'easy' ? 'normal' : d)
const setPref = (k: string, v: boolean) => { try { localStorage.setItem(k, v ? '1' : '0') } catch { /* ignore */ } }

/** Players a substitution tip was already shown for (once for being tired, once for being hurt), kept for the
 *  fixture in this tab so a reload or a resumed match doesn't show the same tips again. */
type TipSeen = { tired: Set<number>; hurt: Set<number>; bring: Set<number> }
function loadTips(key: string, fresh: boolean): TipSeen {
  try {
    if (fresh) sessionStorage.removeItem(key)
    else { const v = JSON.parse(sessionStorage.getItem(key) ?? 'null'); if (v) return { tired: new Set(v.tired ?? []), hurt: new Set(v.hurt ?? []), bring: new Set(v.bring ?? []) } }
  } catch { /* storage unavailable */ }
  return { tired: new Set(), hurt: new Set(), bring: new Set() }
}
function saveTips(key: string, s: TipSeen) {
  try { sessionStorage.setItem(key, JSON.stringify({ tired: [...s.tired], hurt: [...s.hurt], bring: [...s.bring] })) } catch { /* storage unavailable */ }
}

function defaultAssign(mode: PlayMode, pads: PadInfo[]): Assign {
  if (mode !== 'duo') return [[{ kind: 'kb' }], []]
  const a: Assign = [[], []]
  if (pads[0]) a[0].push({ kind: 'pad', id: pads[0].id, index: pads[0].index })
  if (pads[1]) a[1].push({ kind: 'pad', id: pads[1].id, index: pads[1].index })
  if (pads.length === 0) a[0].push({ kind: 'kb' })
  else if (pads.length === 1) a[1].push({ kind: 'kb' })
  return a
}

export default function MatchPage({ ctx, onClose, initialMode = 'play' }: { ctx: Ctx; onClose: () => void; initialMode?: 'play' | 'watch' }) {
  const { t } = useI18n()
  const stageLabel = useStageLabel()
  const [settings] = useSettings()
  const [setup, setSetup] = useState<MatchSetup | null>(null)
  const [stage, setStage] = useState<Stage>('pre')
  const [mode, setMode] = useState<PlayMode>(initialMode)
  const [len, setLen] = useState(() => String(settings.matchLength))
  const [diff, setDiff] = useState<Difficulty>(() => careerDiff(settings.difficulty))
  const [assists, setAssists] = useState<Assists>(() => loadAssists(careerDiff(settings.difficulty)))
  useEffect(() => { setAssists(loadAssists(diff)) }, [diff])
  const [cam, setCam] = useState<CamMode>(() => initialCam(settings.camera))
  const [replays, setReplays] = useState(() => pref('pitchside.replays', true))
  const [assign, setAssign] = useState<Assign>(() => defaultAssign(initialMode, listPads()))
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [kitPick, setKitPick] = useState<KitChoice>('auto') // which of your kits to wear (auto: home unless it clashes)
  const [report, setReport] = useState<DayReport | null>(null)
  const [live, setLive] = useState<LiveSummary | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    api.match(ctx.id).then(s => {
      setSetup(s)
      const sn = loadSnapshot(ctx.id, s.fixture.id)
      if (sn) {
        const m = sn.mode ?? 'play'
        setSnap(sn)
        setLen(String(sn.halfSeconds))
        setDiff(careerDiff(sn.difficulty))
        setMode(m)
        setAssign(defaultAssign(m, listPads()))
        setStage('live') // continue straight away
      }
    }).catch(e => setErr(errText(t, e)))
  }, [ctx.id])
  useEffect(() => { setPref('pitchside.replays', replays) }, [replays])

  async function submit(body: object) {
    setStage('saving')
    try {
      const r = await ctx.run(t('wait.saveMatch'), () => api.play(ctx.id, body))
      clearSnapshot(ctx.id)
      setReport(r)
      setStage('report')
    } catch (e) {
      setErr(errText(t, e))
      setStage('pre')
    }
  }

  if (!setup) {
    return (
      <div className="matchwrap"><div className="overlay"><div className="card">
        <p>{err || t('mp.entering')}</p>
        <button onClick={onClose}>{t('back')}</button>
      </div></div></div>
    )
  }
  const { home, away } = setup
  const pickMode = (m: PlayMode) => { setMode(m); setAssign(defaultAssign(m, listPads())) }

  return (
    <div className="matchwrap">
      {stage === 'live' ? (
        <LiveMatch setup={setup} halfSeconds={Number(len)} difficulty={diff} assists={assists} snapshot={snap} careerId={ctx.id} mode={mode} assign={assign} kitPick={kitPick}
          cam={cam} replays={replays} onCam={c => { setCam(c); saveCam(c) }}
          onEnd={(o, sum) => { leaveGameScreen(); setLive(sum); submit({ mode: 'live', ...o, ratings: sum.byId }) }} onLeave={() => { leaveGameScreen(); onClose() }} />
      ) : (
        <div className="overlay">
          {stage === 'report' && report ? <Report r={report} clubId={ctx.st.club.id} onClose={onClose} live={live} /> : (
            <div className="card lv-pre" style={{ width: 'min(720px, 100%)' }}>
              <span className="eyebrow">{stageLabel(setup.fixture.comp, setup.fixture.stage === 'GA' || setup.fixture.stage === 'GB' ? 'G' : setup.fixture.stage)}</span>
              <div className="vs">
                <div className="side"><Badge short={home.club.short} color={home.club.color} color2={home.club.color2} /><b>{home.club.name}</b><span className="muted">{home.club.formation} · {t('chemistry')} {home.chemistry.team}</span></div>
                <div className="mid">VS</div>
                <div className="side"><Badge short={away.club.short} color={away.club.color} color2={away.club.color2} /><b>{away.club.name}</b><span className="muted">{away.club.formation} · {t('chemistry')} {away.chemistry.team}</span></div>
              </div>
              {(() => {
                // the kits both sides will wear: yours as picked, theirs changes if the colours clash
                const user = setup.userIsHome ? home : away, cpu = setup.userIsHome ? away : home
                const sets: [KitSet, KitSet] = [kitSetOf(user.club), kitSetOf(cpu.club)]
                const r = chooseKits(sets, setup.userIsHome ? 0 : 1, [kitPick, 'auto'])
                return (
                  <div className="lv-kitpick">
                    <b>{t('kit.pick')}</b>
                    <Seg value={kitPick} options={[['auto', t('kit.auto')], ['home', t('kit.home')], ['away', t('kit.away')], ['third', t('kit.third')]]} onChange={setKitPick} />
                    <div className="kits2">
                      <KitSVG kit={r[0].kit} size={58} number={10} title={t('kit.youWear', { kit: t('kit.' + r[0].which) })} />
                      <small>VS</small>
                      <KitSVG kit={r[1].kit} size={58} number={10} title={t('kit.theyWear', { team: cpu.club.name, kit: t('kit.' + r[1].which) })} />
                    </div>
                  </div>
                )
              })()}
              {(() => { const opp = setup.userIsHome ? away : home; return <p className="lv-oppstyle"><b>{t('lv.m.oppStyle')} · {opp.club.name}</b><br />{styleLine(t, styleFor(opp.club.tactic, opp.coachFit?.style), opp.club.tactic)}</p> })()}
              <OppSheetButton setup={setup} kitPick={kitPick} small />{/* their formation, XI, bench and injuries */}
              <div className="row spread"><b>{t('lv.pre.mode')}</b>
                <Seg value={mode} options={[['play', t('lv.pre.play')], ['watch', t('lv.pre.watch')], ['duo', t('lv.pre.duo')]]} onChange={pickMode} />
              </div>
              <div className="row spread"><b>{t('mp.length')}</b><Seg value={len} options={[['90', t('mp.min', { n: 3 })], ['150', t('mp.min', { n: 5 })], ['240', t('mp.min', { n: 8 })]]} onChange={setLen} /></div>
              <div className="row spread"><b data-tip={t('mp.noEasy')}>{t('mp.difficulty')}</b><Seg value={diff} options={[['normal', t('mp.normal')], ['hard', t('mp.hard')]]} onChange={setDiff} /></div>
              {settings.difficulty === 'easy' && <Hint text={t('mp.noEasy')} />}
              {mode !== 'watch' && <div className="row spread"><b>{t('lv.as.title')}</b><AssistToggles value={assists} onChange={a => { setAssists(a); saveAssists(diff, a) }} /></div>}
              <div className="row spread"><b>{t('lv.pre.camera')}</b><Seg value={cam} options={CAMS.map(c => [c, t('lv.cam.' + c)] as [CamMode, string])} onChange={c => { setCam(c); saveCam(c) }} /></div>
              <label className="row lv-check"><input type="checkbox" checked={replays} onChange={e => setReplays(e.target.checked)} /> {t('lv.pre.replays')}</label>
              {mode === 'duo' && <Lobby assign={assign} setAssign={setAssign} setup={setup} />}
              {mode === 'watch' ? <Hint text={t('lv.pre.watchNote')} /> : <Hint text={t('mp.aiNote')} />}
              <Hint text={t(mode === 'watch' ? 'lv.pre.awayWatch' : 'lv.pre.awayPlay')} />
              {setup.knockout && <Hint text={t('lv.pre.knockoutNote')} />}
              {mode !== 'watch' && <ControlsCard />}
              {err && <p className="error">{err}</p>}
              <div className="row">
                <button className="primary" disabled={stage === 'saving'} onClick={() => { void enterGameScreen(); setStage('live') }}>{mode === 'watch' ? t('lv.pre.startWatch') : mode === 'duo' ? t('lv.pre.startDuo') : t('mc.playLive')}</button>
                <button disabled={stage === 'saving'} onClick={() => submit({ mode: 'sim' })}>{stage === 'saving' ? t('wait') : t('mc.quickSim')}</button>
                <button onClick={onClose}>{t('back')}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ 2-player lobby
function claimPad(a: Assign, p: PadInfo): Assign {
  const isP = (d: DeviceRef) => d.kind === 'pad' && d.index === p.index
  const from = a[0].some(isP) ? 0 : a[1].some(isP) ? 1 : -1
  const out: Assign = [a[0].filter(d => !isP(d)), a[1].filter(d => !isP(d))]
  const hasPad = (s: DeviceRef[]) => s.some(d => d.kind === 'pad')
  const to: 0 | 1 = from === 0 ? 1 : from === 1 ? 0 : !hasPad(out[0]) ? 0 : 1
  if (hasPad(out[to])) {
    const moved = out[to].filter(d => d.kind === 'pad')
    out[to] = out[to].filter(d => d.kind !== 'pad')
    out[to === 0 ? 1 : 0].push(...moved)
  }
  out[to].push({ kind: 'pad', id: p.id, index: p.index })
  return out
}

function Lobby({ assign, setAssign, setup }: { assign: Assign; setAssign: (a: Assign) => void; setup: MatchSetup }) {
  const { t } = useI18n()
  const [pads, setPads] = useState<PadInfo[]>(() => listPads())
  const ref = useRef(assign)
  ref.current = assign
  useEffect(() => {
    const prev = new Map<number, boolean>()
    const iv = window.setInterval(() => {
      const list = listPads()
      setPads(old => (old.length === list.length && old.every((p, i) => p.index === list[i].index && p.id === list[i].id) ? old : list))
      let a = ref.current
      let changed = false
      // forget controllers that are gone
      const alive = (d: DeviceRef) => d.kind === 'kb' || list.some(p => p.index === d.index && p.id === d.id)
      if (!a[0].every(alive) || !a[1].every(alive)) { a = [a[0].filter(alive), a[1].filter(alive)]; changed = true }
      for (const p of list) {
        const st = !!rawPad(p.index)?.buttons[9]?.pressed
        const was = prev.get(p.index) ?? st // a button held when we start watching doesn't count
        prev.set(p.index, st)
        if (st && !was) { a = claimPad(a, p); changed = true }
      }
      if (changed) setAssign(a)
    }, 100)
    return () => clearInterval(iv)
  }, [])
  const user = setup.userIsHome ? setup.home : setup.away
  const opp = setup.userIsHome ? setup.away : setup.home
  const kbSide = assign[0].some(d => d.kind === 'kb') ? 0 : assign[1].some(d => d.kind === 'kb') ? 1 : -1
  const moveKb = (side: -1 | 0 | 1) => {
    const out: Assign = [assign[0].filter(d => d.kind !== 'kb'), assign[1].filter(d => d.kind !== 'kb')]
    if (side !== -1) out[side].push({ kind: 'kb' })
    setAssign(out)
  }
  const label = (d: DeviceRef) => d.kind === 'kb' ? `⌨ ${t('lv.dev.kb')}` : `🎮 ${pads.find(p => p.index === d.index)?.label ?? 'Pad'} #${d.index + 1}`
  const glyphOf = (d: DeviceRef): Glyphs => d.kind === 'kb' ? 'kb' : pads.find(p => p.index === d.index)?.glyphs ?? 'xbox'
  return (
    <div className="lv-lobby">
      <p className="muted" style={{ margin: 0 }}>{t('lv.lobby.hint')}</p>
      <div className="lv-slots">
        {([0, 1] as const).map(s => (
          <div key={s} className={'lv-slot p' + (s + 1)}>
            <b>P{s + 1} · {(s === 0 ? user : opp).club.name}</b>
            {assign[s].length ? assign[s].map((d, i) => <span key={i} className={'lv-dev g-' + glyphOf(d)}>{label(d)}</span>) : <span className="muted">{t('lv.lobby.empty')}</span>}
          </div>
        ))}
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <span className="muted">⌨ {t('lv.dev.kb')}:</span>
        <Seg value={String(kbSide)} options={[['0', 'P1'], ['1', 'P2'], ['-1', t('lv.lobby.none')]]} onChange={v => moveKb(Number(v) as -1 | 0 | 1)} />
        <span className="muted">🎮 {pads.length ? pads.map(p => `${p.label} #${p.index + 1}`).join(', ') : t('lv.lobby.noPads')}</span>
      </div>
      {!assign[1].length && <p className="error" style={{ margin: 0 }}>{t('lv.lobby.p2missing')}</p>}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ controls lists
function CtlList({ group, g, max }: { group: CtlGroup; g: Glyphs; max?: number }) {
  const { t } = useI18n()
  const rows = ROWS[group].slice(0, max ?? 99)
  const def = group === 'def'
  return (
    <>{rows.map(r => <span key={r.k} className="lv-row"><b>{glyph(r.b, g, def)}</b><span>{t('lv.k.' + r.k)}</span></span>)}</>
  )
}

function ControlsCard() {
  const { t } = useI18n()
  const [g, setG] = useState<Glyphs>(() => listPads()[0]?.glyphs ?? 'kb')
  return (
    <div className="lv-ctlcard">
      <div className="row spread"><b>{t('lv.m.controls')}</b><Seg value={g} options={[['kb', t('lv.dev.kb')], ['ps', 'PlayStation'], ['xbox', 'Xbox']]} onChange={setG} /></div>
      <div className="lv-ctlgrid">
        <div><i>{t('ctl.attack')}</i><CtlList group="att" g={g} max={10} /></div>
        <div><i>{t('ctl.defend')}</i><CtlList group="def" g={g} /><i>{t('lv.m.general')}</i><CtlList group="gen" g={g} /></div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ the live match
type MenuTab = 'stats' | 'tactics' | 'camera' | 'sound' | 'controls' | 'skills'

function LiveMatch({ setup, halfSeconds, difficulty, assists, snapshot, careerId, mode: mode0, assign, kitPick, cam, replays, onCam, onEnd, onLeave }: {
  setup: MatchSetup; halfSeconds: number; difficulty: Difficulty; assists: Assists; snapshot: Snapshot | null; careerId: number; mode: PlayMode; assign: Assign; kitPick: KitChoice
  cam: CamMode; replays: boolean; onCam: (c: CamMode) => void; onEnd: (o: MatchOutcome, live: LiveSummary) => void; onLeave: () => void
}) {
  const { t, lang } = useI18n()
  const [settings, setS] = useSettings()
  const canvas = useRef<HTMLCanvasElement>(null)
  const engRef = useRef<Engine | null>(null)
  const hubRef = useRef<InputHub | null>(null)
  const viewRef = useRef<View>(new View(cam))
  const audioRef = useRef<MatchAudio | null>(null)
  const [hud, setHud] = useState<HudState | null>(null)
  const [done, setDone] = useState<MatchOutcome | null>(null)
  const [saving, setSaving] = useState(false)
  // the first live match you play starts with the tutorial (replay it from the pause menu)
  const [tut, setTut] = useState(() => mode0 === 'play' && !snapshot && !tutorialSeen())
  const [mode, setMode] = useState<PlayMode>(mode0)
  const modeRef = useRef(mode0)
  modeRef.current = mode
  const [glyphs, setGlyphs] = useState<[Glyphs, Glyphs]>(['kb', 'kb'])
  const [subsFor, setSubsFor] = useState<Side | null>(null)
  const [tab, setTab] = useState<MenuTab>('stats')
  const [disc, setDisc] = useState<{ side: Side; label: string } | null>(null)
  const [speed, setSpeed] = useState(1)
  const speedRef = useRef(1)
  speedRef.current = speed
  const [skipping, setSkipping] = useState(false)
  /** sides the computer plays while nobody is at this device (P1, P2), and the clock running through missed time */
  const [awaySides, setAwaySides] = useState<[boolean, boolean]>([false, false])
  const [catching, setCatching] = useState(false)
  const [showKeys, setShowKeys] = useState(() => pref('pitchside.keys', true))
  const [names, setNames] = useState(() => pref('pitchside.names', true))
  const namesRef = useRef(names)
  namesRef.current = names
  const [mini, setMini] = useState(() => pref('pitchside.minimap', true))
  const miniRef = useRef(mini)
  miniRef.current = mini
  const [tts, setTts] = useState(() => pref('pitchside.tts', false))
  const [camMode, setCamMode] = useState<CamMode>(cam)
  // the set-piece camera is on (its own prompts, less clutter on screen)
  const [spOn, setSpOn] = useState(false)
  // substitution tips: one at a time, each player at most once for being tired and once for being hurt
  const [tip, setTip] = useState<SubTipData | null>(null)
  const tipRef = useRef<SubTipData | null>(null)
  tipRef.current = tip
  const acceptTipRef = useRef<() => void>(() => {})
  const tipKey = `pitchside.tips.${careerId}.${setup.fixture.id}`
  const tipped = useRef<TipSeen | null>(null)
  if (!tipped.current) tipped.current = loadTips(tipKey, !snapshot)
  /** match clock when the last tip went away: the next one for a tired player waits a little (an injury doesn't) */
  const tipGone = useRef(-1e9)
  const hideTip = () => { tipGone.current = engRef.current?.clock ?? 0; setTip(null) }
  const [subPre, setSubPre] = useState<{ out: number; in: number } | null>(null)
  /** where the bench was opened from: closing it goes back there (the match, or the pause menu) */
  const [subsFrom, setSubsFrom] = useState<'hud' | 'menu'>('hud')
  const user = setup.userIsHome ? setup.home : setup.away
  const cpu = setup.userIsHome ? setup.away : setup.home
  const tRef = useRef(t)
  tRef.current = t
  const onCamRef = useRef(onCam)
  onCamRef.current = onCam

  const changeCam = (d: number | CamMode) => {
    const v = viewRef.current
    if (typeof d === 'number') v.next(d); else v.mode = d
    setCamMode(v.mode)
    onCamRef.current(v.mode)
  }

  useEffect(() => { const a = audioRef.current; if (a) { a.setVolume(settings.volume, settings.sound); a.lang = lang } hubRef.current && (hubRef.current.rumbleOn = settings.rumble) }, [settings.volume, settings.sound, settings.rumble, lang])
  useEffect(() => { if (audioRef.current) audioRef.current.tts = tts; setPref('pitchside.tts', tts) }, [tts])
  useEffect(() => { setPref('pitchside.keys', showKeys) }, [showKeys])
  useEffect(() => { setPref('pitchside.names', names) }, [names])
  useEffect(() => { setPref('pitchside.minimap', mini) }, [mini])

  useEffect(() => {
    const twoP = mode0 === 'duo'
    const audio = new MatchAudio(!!(setup as MatchSetup & { derby?: boolean }).derby, setup.userIsHome ? 0 : 1)
    audio.setVolume(settings.volume, settings.sound)
    audio.lang = lang
    audio.tts = tts
    audioRef.current = audio
    let hub: InputHub | null = null
    const clock = new MatchClock()
    const onEvent = (e: EngineEvent) => {
      if (e.k === 'cam') { changeCam(e.v ?? 1); return }
      if (clock.quiet) return // running through time the page missed: no burst of sound
      audio.event(e)
      if (e.r && hub) for (const s of [0, 1] as const) if (e.r[s] > 0) hub.rumble(s, e.r[s], e.r[s] * 0.6, e.k === 'goal' ? 450 : 140)
    }
    const eng = new Engine(setup, {
      halfSeconds, difficulty, snapshot, replays, onEvent, t: (k, p) => tRef.current(k, p), assists, kitPick: [kitPick, 'auto'],
      humans: mode0 === 'watch' ? [false, false] : [true, twoP && assign[1].length > 0],
      // the two sides as strong as the quick simulation has them, so watching turns out like simulating
      edge: setup.odds ? edgeFromOdds(setup.odds, setup.userIsHome, halfSeconds) : undefined,
    }, o => setDone(o))
    engRef.current = eng
    if (!snapshot) eng.beginIntro()
    if (tutRef.current) eng.setTutorial(true)
    hub = new InputHub(twoP, assign, side => eng.contextOf(side))
    hub.rumbleOn = settings.rumble
    hubRef.current = hub
    const away = new AwayWatch(eng, hub)
    hub.onDisconnect = (side, label) => {
      if (modeRef.current === 'watch' || eng.phase === 'end' || away.sides[side]) return
      eng.pause('disconnect')
      setDisc({ side, label })
    }
    hub.onJoin = side => {
      if (modeRef.current === 'duo' && side === 1 && !eng.human[1]) eng.setHuman(1, true)
      setDisc(d => (d && d.side === side ? null : d))
    }
    if (import.meta.env.DEV) (window as unknown as { __eng: Engine }).__eng = eng
    const cv = canvas.current!
    const ctx2 = cv.getContext('2d')!
    let frames = 0, wasPaused = false, endFrames = 0, hudAt = 0, savedAt = performance.now()
    let prevB = 0, prevB1 = 0
    let ffPort: MessagePort | null = null // set while "skip to end" runs
    const persist = () => { if (eng.phase !== 'end') saveSnapshot(careerId, takeSnapshot(eng, setup.fixture.id, modeRef.current)) }
    const labels = { replay: tRef.current('lv.replay'), skip: tRef.current('lv.replaySkip') }
    const speed = () => (modeRef.current === 'watch' ? speedRef.current : 1)
    const showAway = () => setAwaySides(a => (a[0] === away.sides[0] && a[1] === away.sides[1] ? a : [away.sides[0], away.sides[1]]))
    /** sound, and a snapshot every few seconds: the same whether the page shows or not */
    const tail = (now: number, dt: number) => {
      if (eng.paused !== wasPaused) { wasPaused = eng.paused; if (wasPaused) audio.suspend(); else audio.resume() }
      const [ex, homeAtt] = eng.excitement()
      audio.tick(Math.min(dt, 0.1), ex, homeAtt)
      if (now - savedAt > 3000) { savedAt = now; persist() }
    }
    const frame = (now: number) => {
      const dpr = window.devicePixelRatio || 1
      const w = cv.clientWidth, h = cv.clientHeight
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr) }
      const dt = clock.delta(now)
      // the set-piece camera turns the sticks with the picture (up = towards the goal); other cameras: as they are
      const view = viewRef.current
      const [r0, r1] = hub!.poll()
      const f0 = view.stick(r0), f1 = view.stick(r1)
      // watching: the pad drives the viewer controls below, not the (computer-controlled) teams
      const watching = modeRef.current === 'watch'
      eng.setInput(0, watching ? null : f0)
      eng.setInput(1, watching ? null : f1)
      away.check() // back at the keys or the controller: your side is yours again
      const pr0 = f0 ? f0.b & ~prevB : 0, pr1 = f1 ? f1.b & ~prevB1 : 0
      if (modeRef.current === 'watch' && f0) {
        // viewer controls on a pad: Start pause · ✚←→ camera · R1 speed · △/Y take control
        const pr = pr0
        if (pr & BTN.START) { if (eng.paused) eng.resume(); else eng.pause('menu') }
        if (pr & BTN.RIGHT) changeCam(1)
        if (pr & BTN.LEFT) changeCam(-1)
        if (pr & BTN.RB) setSpeed(s => (s >= 4 ? 1 : s * 2))
        if (pr & BTN.Y && !eng.paused) takeControl()
        if (pr & (BTN.A | BTN.B) && eng.phase === 'replay') eng.skipReplay()
      }
      // Select / Share / View (Tab on the keyboard) takes up a substitution tip
      if (!eng.paused) for (const [s, pr] of [[0, pr0], [1, pr1]] as const) if (pr & BTN.SELECT && tipRef.current?.side === s) acceptTipRef.current()
      prevB = f0?.b ?? 0
      prevB1 = f1?.b ?? 0
      // "skip to end" runs on its own (see skipToEnd); the picture just follows
      if (!ffPort) clock.run(eng, dt, speed(), true, 12)
      tail(now, dt)
      if (eng.phase === 'end') endFrames++
      ctx2.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (endFrames < 90) view.draw(ctx2, w, h, eng.frameState(), eng.statics(), now, { labels, names: namesRef.current, mini: miniRef.current, setPiece: true })
      frames++
      if (frames % 6 === 0) {
        setHud(eng.hud())
        setSpOn(view.setPiece)
        setGlyphs(g => { const n0 = hub!.glyphs(0), n1 = hub!.glyphs(1); return g[0] === n0 && g[1] === n1 ? g : [n0, n1] })
        showAway()
        setCatching(clock.catchingUp)
      }
    }
    // no animation frames (the page is hidden, the window minimised or on another desktop): the match goes on without
    // a picture, and nobody is at the controls
    const idle = (now: number) => {
      const dt = clock.delta(now)
      eng.setInput(0, null)
      eng.setInput(1, null)
      if (!ffPort) clock.run(eng, dt, speed(), false, 100)
      tail(now, dt)
      if (now - hudAt > 250) { hudAt = now; setHud(eng.hud()); showAway() }
    }
    const stopLoop = keepRunning(frame, idle)
    // "Skip to end": the rest of the match runs through the engine in 40 ms slices, one after another (a message
    // channel, not the animation frame, which a hidden or background window slows to a crawl), so it takes well
    // under a second on a normal machine and the page stays responsive meanwhile
    const stopSkip = () => { if (ffPort) { ffPort.close(); ffPort = null; setSkipping(false) } }
    const skipToEnd = () => {
      if (ffPort || eng.phase === 'end') return
      const ch = new MessageChannel()
      ffPort = ch.port1
      setSkipping(true)
      const run = () => {
        if (!ffPort) return
        if (eng.paused) { window.setTimeout(run, 120); return } // the menu was opened meanwhile: carry on after it
        const t0 = performance.now()
        while (eng.phase !== 'end' && performance.now() - t0 < 40) eng.fastForward(240)
        if (eng.phase === 'end') { stopSkip(); ch.port2.close() } else ch.port2.postMessage(0)
      }
      ch.port1.onmessage = run
      run()
    }
    skipToRef.current = skipToEnd
    const takeControl = () => {
      if (modeRef.current !== 'watch') return
      stopSkip()
      eng.setHuman(0, true)
      eng.fast = false
      setMode('play')
      setSpeed(1)
    }
    takeRef.current = takeControl
    const kd = (e: KeyboardEvent) => {
      audio.wake()
      const k = gameKey(e)
      if (!k) return
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return
      if (eng.paused) {
        // menus: only Esc / P resume; leave the other keys to the buttons
        if (k === 'Escape' || k === 'KeyP') { e.preventDefault(); eng.resume(); setSubsFor(null); setSubPre(null) }
        return
      }
      e.preventDefault()
      if (e.repeat) return
      if (eng.intro) {
        eng.endIntro()
        // the walk-out says "press any button to kick off": pass, shoot, through ball and lob take the kick-off
        // with this same press (before, the first J only ended the walk-out and a second one was needed)
        if (KICK_KEYS.has(k)) hub!.kb.keyDown(k)
        return
      }
      if (eng.celebPick() != null && /^Digit[1-4]$/.test(k)) { eng.celebrate(Number(k.slice(5))); return }
      if (k === 'Digit4') return
      if (modeRef.current === 'watch') {
        if (k === 'KeyP' || k === 'Escape' || k === 'Space') eng.pause('menu')
        else if (k === 'KeyC') changeCam(1)
        else if (k === 'KeyF') setSpeed(s => (s >= 4 ? 1 : s * 2))
        else if (k === 'KeyT') takeControl()
        else if (k === 'Enter' || k === 'KeyJ') eng.skipReplay()
        else if (k === 'KeyM') setS({ sound: !settingsRef.current.sound })
        return
      }
      if (k === 'KeyC') { changeCam(1); return }
      if (k === 'KeyH') { setShowKeys(v => !v); return }
      if (k === 'KeyM') { setS({ sound: !settingsRef.current.sound }); return }
      if (k === 'Digit1' || k === 'Digit2' || k === 'Digit3') { eng.setMentality(hub!.kb.side, k === 'Digit1' ? 'defensive' : k === 'Digit2' ? 'balanced' : 'attacking'); return }
      if (k === 'Enter' && eng.phase === 'replay') { eng.skipReplay(); return }
      hub!.kb.keyDown(k)
    }
    const ku = (e: KeyboardEvent) => { const k = gameKey(e); if (k) { hub!.kb.keyUp(k); if (!eng.paused) e.preventDefault() } }
    const wake = () => audio.wake()
    // looking away doesn't pause (only the pause button does): the computer plays your side until you're back
    const blur = () => { hub!.kb.clear(); away.leave(); showAway(); persist() }
    const vis = () => { if (document.hidden) blur() }
    audio.wake()
    document.addEventListener('visibilitychange', vis)
    window.addEventListener('keydown', kd)
    window.addEventListener('keyup', ku)
    window.addEventListener('pointerdown', wake)
    window.addEventListener('blur', blur)
    window.addEventListener('pagehide', persist)
    return () => {
      persist()
      stopLoop()
      if (ffPort) { ffPort.close(); ffPort = null }
      audio.close()
      window.removeEventListener('keydown', kd)
      window.removeEventListener('keyup', ku)
      window.removeEventListener('pointerdown', wake)
      window.removeEventListener('blur', blur)
      window.removeEventListener('pagehide', persist)
      document.removeEventListener('visibilitychange', vis)
    }
  }, [setup, halfSeconds, difficulty])
  const takeRef = useRef<() => void>(() => {})
  const skipToRef = useRef<() => void>(() => {})
  const tutRef = useRef(tut)
  tutRef.current = tut
  const endTutorial = () => { setTut(false); markTutorialSeen(); engRef.current?.setTutorial(false) }
  const startTutorial = () => { setTut(true); engRef.current?.setTutorial(true); engRef.current?.resume(); setSubsFor(null) }
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  const eng = engRef.current
  const duo = mode === 'duo'
  const watch = mode === 'watch'
  const menuOpen = !!hud?.paused && (hud.pauseReason === 'user' || hud.pauseReason === 'menu') && !done
  // phones and tablets: an on-screen pad, and the match waits while the device is held upright
  const [touch] = useState(isTouchDevice)
  const portrait = usePortrait()
  const [padOn, setPadOn] = useState(true)
  const usingPad = glyphs[0] === 'ps' || glyphs[0] === 'xbox' // a controller took over: the pad steps aside
  const showPad = touch && padOn && !watch && !done && !usingPad
  const rotate = touch && portrait && !done
  useEffect(() => {
    if (!eng) return
    if (rotate && !eng.paused) eng.pause('rotate')
    else if (!rotate && eng.paused && eng.pauseReason === 'rotate') eng.resume()
  }, [rotate, eng, hud?.paused])
  const params = (s: Side) => (glyphs[s] === 'touch' ? touchParams(t, hud!.sides[s].ctx === 'def') : glyphParams(glyphs[s], hud!.sides[s].ctx === 'def'))
  // (the HUD is refreshed at once, so the pause menu doesn't flash up for a few frames on the way back)
  const resume = () => { eng?.resume(); setSubsFor(null); setSubPre(null); if (eng) setHud(eng.hud()) }
  /** the bench for a side; pre: a player to take off and one to bring on, already picked (a substitution tip) */
  const openSubs = (s: Side, pre: { out: number; in: number } | null = null, from: 'hud' | 'menu' = 'hud') => {
    if (!eng) return
    eng.pause('menu'); setSubPre(pre); setSubsFrom(from); setSubsFor(s)
  }
  acceptTipRef.current = () => { const tp = tipRef.current; if (!tp) return; hideTip(); openSubs(tp.side, { out: tp.out, in: tp.in }) }
  const prompts = ([0, 1] as const).filter(s => hud?.human[s] && hud.sides[s].prompt && !hud.intro)
  // behind the ball the stick reads left / right on the screen, so the penalty prompts say ←→ instead of ↑↓
  const promptKey = (p: string) => (spOn && (p === 'penTake' || p === 'penKeep') ? p + 'Sp' : p)
  useEffect(() => {
    // a tip when a player (yours, or P2's in a two-player match) tires below 45% or gets hurt: shown once, gone after
    // TIP_S seconds of play, never while a set piece (or its prompt), a replay, a shoot-out or the tutorial is on screen
    const e = engRef.current
    if (!hud || !e) return
    if (tip) {
      const stale = !e.teams[tip.side].some(p => p.data.id === tip.out) || !e.bench[tip.side].some(b => b.id === tip.in)
        || hud.subsLeft[tip.side] <= 0 || !!hud.so || hud.half >= 5 || !!done || e.clock - tip.at > TIP_S
      if (stale) hideTip()
      return
    }
    if (hud.paused || hud.intro || done || hud.so || hud.half >= 5 || spOn || tut || prompts.length || hud.phase === 'replay' || hud.phase === 'end') return
    const seen = tipped.current!
    const rested = e.clock - tipGone.current > 20
    for (const s of [0, 1] as Side[]) {
      if (!hud.human[s] || hud.subsLeft[s] <= 0) continue
      // a starter you locked in (Player.locked) gets no "tired" tip: he plays on unless he is hurt (match/tips.ts)
      const due = subTipDue(e, s, seen, rested, TIRED)
      for (const p of due) {
        const y = suggestSub(e, s, p)
        if (!y) continue
        ;(p.injured ? seen.hurt : seen.tired).add(p.data.id)
        saveTips(tipKey, seen)
        setTip({ side: s, out: p.data.id, in: y.id, outName: p.data.name, inName: y.name, pct: Math.round(p.stamina * 100), hurt: p.injured, at: e.clock })
        return
      }
    }
    // around the hour: a bench player you marked to bring on (Player.bring), once each, for the most tired man in
    // his line, the same choice the computer makes when it plays for you (Engine.bringFor)
    const min = e.minute()
    if (!rested || min < 58 || min > 78) return
    for (const s of [0, 1] as Side[]) {
      if (!hud.human[s] || hud.subsLeft[s] <= 0) continue
      const marked = e.bench[s].filter(b => (b.bring ?? 0) > 0 && b.injury === 0 && b.fitness >= 55 && !seen.bring.has(b.id))
        .sort((a, b) => (a.bring ?? 0) - (b.bring ?? 0))
      for (const b of marked) {
        const p = e.bringFor(s, b)
        if (!p) continue
        seen.bring.add(b.id)
        saveTips(tipKey, seen)
        setTip({ side: s, out: p.data.id, in: b.id, outName: p.data.name, inName: b.name, pct: Math.round(p.stamina * 100), hurt: false, bring: true, at: e.clock })
        return
      }
    }
  }, [hud])

  return (
    <>
      <div className="mhud">
        <div className="mbar">
          <button className="lv-subsbtn" disabled={!hud || !!done} onClick={() => openSubs(0)} data-tip={t('lv.fit.tip')} aria-label={`${t('mp.subs')} (${hud?.subsLeft[0] ?? 5})`}>
            <span>⇄ <span className="lv-subsword">{t('mp.subs')} </span>({hud?.subsLeft[0] ?? 5})</span>
            {eng && hud && <FitBars eng={eng} side={0} />}
          </button>
          {watch ? (
            <>
              <span className="lv-watch">👁 {t('lv.w.watching')}</span>
              <Seg value={String(speed)} options={[['1', '1×'], ['2', '2×'], ['4', '4×']]} onChange={v => setSpeed(Number(v))} />
              <button onClick={() => takeRef.current()}>🎮 {t('lv.w.take')}</button>
              <ConfirmButton label={`⏭ ${t('lv.w.skip')}`} confirm={t('lv.w.skipConfirm')} disabled={!!done || skipping} onConfirm={() => skipToRef.current()} />
            </>
          ) : (
            <>
              <span className="lv-p p1">P1 {hud?.sides[0].name}</span>
              {hud?.sides[0].sig && <span className="lv-sig" data-tip={t('lv.hud.sigTip', { move: t('lv.sk.' + hud.sides[0].sig) })}>★ {t('lv.sk.' + hud.sides[0].sig)}</span>}
              <span className="stam" title={t('stamina')}><i style={{ width: `${(hud?.sides[0].stamina ?? 1) * 100}%` }} /></span>
              {duo && <><span className="lv-p p2">P2 {hud?.human[1] ? hud.sides[1].name : t('lv.hud.cpu')}</span><span className="stam p2" title={t('stamina')}><i style={{ width: `${(hud?.sides[1].stamina ?? 1) * 100}%` }} /></span></>}
              {duo && hud?.human[1] && eng && !done && (
                <button className="lv-subsbtn p2" onClick={() => openSubs(1)} data-tip={t('lv.fit.tip')} aria-label={`${t('mp.subs')} P2`}>⇄ <FitBars eng={eng} side={1} /></button>
              )}
              <span>{t('ctl.mentalityShort')}: <b>{t('tac.mentality.' + (hud?.mentality[0] ?? 'balanced'))}</b></span>
            </>
          )}
          <span className="num">{t('possession')} {hud?.poss ?? 50}% · {t('shots')} {hud?.stats.shots[0] ?? 0}-{hud?.stats.shots[1] ?? 0}</span>
          <button title="C" onClick={() => changeCam(1)}>🎥 {t('lv.cam.' + camMode)}</button>
          {touch && !watch && <button className={'lv-padbtn' + (showPad ? ' on' : '')} onClick={() => setPadOn(!showPad)} aria-pressed={showPad} data-tip={t('touch.padTip')}>✋ {t('touch.pad')}</button>}
          {touch && !document.fullscreenElement && <button className="lv-fsbtn" onClick={() => void enterGameScreen()} data-tip={t('touch.fullTip')}>⛶</button>}
          <button onClick={() => { if (!eng) return; if (eng.paused) resume(); else eng.pause('menu') }}>{hud?.paused ? t('resume') : t('pause')}</button>
          <ConfirmButton label={t('mp.leave')} confirm={t('mp.leaveConfirm')} onConfirm={onLeave} />
        </div>
      </div>
      <div className="mcanvas">
        <canvas ref={canvas} tabIndex={0} aria-label={t('pitch')} />
        {hud && eng && !hud.intro && <Scoreboard hud={hud} eng={eng} />}
        {!hud?.intro && !spOn && <div className="feed lv-feed">{hud?.feed.map((f, i) => <span key={i} style={{ opacity: 1 - i * 0.14 }}>{f}</span>)}</div>}
        {hud?.intro && eng && <Intro eng={eng} setup={setup} onStart={() => eng.endIntro()} />}
        {hud && eng && hud.celebPick != null && !watch && !hud.paused && <CelebPicker eng={eng} g={glyphs[hud.celebPick]} duo={duo} side={hud.celebPick} />}
        {/* kept mounted while hidden, so a pause, a replay or a set piece doesn't send the tutorial back to its first step */}
        {tut && hud && eng && !hud.intro && !watch && !done && (
          <div className="lv-tutwrap" hidden={hud.paused || hud.phase === 'replay' || spOn}><Tutorial eng={eng} hud={hud} g={glyphs[0]} onClose={endTutorial} /></div>
        )}
        {showKeys && !watch && !showPad && !spOn && hud && !hud.intro && hud.sides[0].ctx !== 'none' && (
          <div className="keys lv-keys">
            <CtlList group={hud.sides[0].ctx} g={glyphs[0]} max={hud.sides[0].ctx === 'att' ? 8 : 9} />
            {duo && hud.human[1] && hud.sides[1].ctx !== 'none' && <><i className="p2">P2</i><CtlList group={hud.sides[1].ctx} g={glyphs[1]} max={6} /></>}
            <span className="lv-row muted"><b>H</b><span>{t('lv.k.hide')}</span></span>
          </div>
        )}
        {hud?.so && <Shootout so={hud.so} names={[user.club.short, cpu.club.short]} />}
        {hud?.banner && <div className={'banner' + (hud.phase === 'goal' ? ' lv-goal' : '')}>{hud.banner}</div>}
        {!hud?.paused && prompts.map(s => (
          <div key={s} className={'setpiece lv-prompt p' + (s + 1) + (prompts.length > 1 ? ' two' : '') + (spOn ? ' sp' : '')}>
            {duo && <b>P{s + 1} </b>}{t('lv.p.' + promptKey(hud!.sides[s].prompt), params(s))}
          </div>
        ))}
        {tip && hud && eng && !hud.paused && !spOn && !done && !prompts.length && (
          <SubTip tip={tip} g={glyphs[tip.side]} duo={duo} left={1 - (eng.clock - tip.at) / TIP_S} onSub={() => acceptTipRef.current()} onClose={hideTip} />
        )}
        {!hud?.paused && duo && hud && !hud.human[1] && !awaySides[1] && <div className="lv-join">{t('lv.hud.p2join')}</div>}
        {(awaySides[0] || awaySides[1]) && hud && !hud.paused && !done && (
          <div className="lv-join lv-away">{duo && <b>{awaySides.flatMap((a, s) => (a ? [`P${s + 1}`] : [])).join(' · ')} · </b>}{t('lv.away')}</div>
        )}
        {skipping && <div className="setpiece">{t('lv.w.skipping')}</div>}
        {catching && !skipping && !done && <div className="setpiece">⏩ {t('lv.catchUp')}</div>}
        {menuOpen && subsFor == null && eng && (
          <PauseMenu eng={eng} hud={hud!} tab={tab} setTab={setTab} duo={duo} watch={watch} glyph={glyphs[0]} camMode={camMode} onCam={changeCam}
            onResume={resume} onSubs={s => openSubs(s, null, 'menu')} onLeave={onLeave} tts={tts} setTts={setTts} names={names} setNames={setNames} mini={mini} setMini={setMini} showKeys={showKeys} setShowKeys={setShowKeys}
            onTutorial={startTutorial} difficulty={difficulty} />
        )}
        {subsFor != null && eng && (
          <SubsPanel key={subPre ? `${subPre.out}:${subPre.in}` : 'subs'} eng={eng} side={subsFor} duo={duo || watch} pre={subPre}
            onSide={s => { setSubPre(null); setSubsFor(s) }} onClose={() => { if (subsFrom === 'menu') { setSubPre(null); setSubsFor(null) } else resume() }} />
        )}
        {hud?.paused && hud.pauseReason === 'disconnect' && disc && eng && !done && (
          <div className="overlay">
            <div className="card" style={{ alignItems: 'center', textAlign: 'center', width: 'min(520px, 100%)' }}>
              <h3>🎮 {t('lv.disc.title', { p: `P${disc.side + 1}` })}</h3>
              <p className="muted">{t('lv.disc.body', { pad: disc.label })}</p>
              <div className="row" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
                {disc.side === 1 && <button onClick={() => { eng.setHuman(1, false); setDisc(null); resume() }}>{t('lv.disc.cpu')}</button>}
                {hubRef.current && !hubRef.current.slots[disc.side === 0 ? 1 : 0].includes(hubRef.current.kb) && (
                  <button onClick={() => { hubRef.current!.attach(disc.side, hubRef.current!.kb); setDisc(null); resume() }}>⌨ {t('lv.disc.kb')}</button>
                )}
                <button className="primary" onClick={() => { setDisc(null); resume() }}>{t('mp.backToMatch')}</button>
              </div>
            </div>
          </div>
        )}
        {showPad && hud && !hud.intro && !menuOpen && subsFor == null && (
          <MatchTouch hub={hubRef.current} side={0} ctxOf={s => engRef.current?.contextOf(s) ?? 'att'} def={hud.sides[0].ctx === 'def'} />
        )}
        {done && eng && <PostMatch eng={eng} setup={setup} done={done} cam={camMode} saving={saving} onSave={() => { if (saving) return; setSaving(true); onEnd(done, liveSummary(eng)) }} />}
        {rotate && <RotateHint onLeave={onLeave} />}
      </div>
    </>
  )
}

function Shootout({ so, names }: { so: NonNullable<HudState['so']>; names: [string, string] }) {
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

function PauseMenu({ eng, hud, tab, setTab, duo, watch, glyph: g, camMode, onCam, onResume, onSubs, onLeave, tts, setTts, names, setNames, mini, setMini, showKeys, setShowKeys, onTutorial, difficulty }: {
  eng: Engine; hud: HudState; tab: MenuTab; setTab: (t: MenuTab) => void; duo: boolean; watch: boolean; glyph: Glyphs; camMode: CamMode; onCam: (c: CamMode) => void
  onResume: () => void; onSubs: (s: Side) => void; onLeave: () => void; tts: boolean; setTts: (v: boolean) => void; names: boolean; setNames: (v: boolean) => void
  mini: boolean; setMini: (v: boolean) => void
  showKeys: boolean; setShowKeys: (v: boolean) => void; onTutorial: () => void; difficulty: Difficulty
}) {
  const { t } = useI18n()
  const [settings, setS] = useSettings()
  const [dev, setDev] = useState<Glyphs>(g)
  const [, force] = useState(0)
  const st = hud.stats
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)
  // home on the left, like the scoreboard
  const H: Side = eng.homeTeam, A: Side = H === 0 ? 1 : 0
  const two = (f: (s: Side) => string | number): [string, string] => [String(f(H)), String(f(A))]
  const rows: [string, string, string][] = [
    [t('possession'), ...two(s => `${s === 0 ? hud.poss : 100 - hud.poss}%`)],
    [t('shots'), ...two(s => st.shots[s])],
    [t('lv.st.onTarget'), ...two(s => st.onTarget[s])],
    [t('lv.st.passes'), ...two(s => `${pct(st.passOk[s], st.passes[s])}%`)],
    [t('lv.st.corners'), ...two(s => st.corners[s])],
    [t('lv.st.fouls'), ...two(s => st.fouls[s])],
    [t('lv.st.offsides'), ...two(s => st.offsides[s])],
    [t('lv.st.cards'), ...two(s => `🟨${st.yellows[s]} 🟥${st.reds[s]}`)],
    [t('lv.st.saves'), ...two(s => st.saves[s])],
  ]
  const tabs: MenuTab[] = ['stats', 'tactics', 'camera', 'sound', 'controls', 'skills']
  return (
    <div className="overlay lv-menu">
      <div className="card" style={{ width: 'min(760px, 100%)', maxHeight: '90%', overflow: 'auto' }}>
        <div className="row spread">
          <h3 style={{ margin: 0 }}>⏸ {t('lv.m.title')} · <span className="num">{eng.shorts[H]} {hud.score[H]}-{hud.score[A]} {eng.shorts[A]}</span></h3>
          <button className="primary" onClick={onResume}>{t('mp.backToMatch')}</button>
        </div>
        <p className="lv-oppstyle"><b>{t('lv.m.oppStyle')} · {eng.names[1]}</b><br />{styleLine(t, eng.styles[1], eng.tactics[1])}</p>
        <div className="lv-tabs">
          {tabs.map(x => <button key={x} aria-pressed={tab === x} onClick={() => setTab(x)}>{t('lv.m.' + x)}</button>)}
          <button onClick={() => onSubs(0)} disabled={hud.subsLeft[0] <= 0}>⇄ {t('mp.subs')}{duo ? ' P1' : ''}</button>
          {(duo || watch) && <button onClick={() => onSubs(1)} disabled={hud.subsLeft[1] <= 0}>⇄ {t('mp.subs')} {duo ? 'P2' : eng.shorts[1]}</button>}
        </div>
        {tab === 'stats' && (
          <table className="compact num lv-stats"><tbody>
            <tr><th>{eng.shorts[H]}{H === 0 ? <i className="lv-sb-you p1" role="img" aria-label={t('lv.sb.you')} /> : null}</th><th /><th>{eng.shorts[A]}{A === 0 ? <i className="lv-sb-you p1" role="img" aria-label={t('lv.sb.you')} /> : null}</th></tr>
            {rows.map(r => <tr key={r[0]}><td>{r[1]}</td><td className="muted">{r[0]}</td><td>{r[2]}</td></tr>)}
          </tbody></table>
        )}
        {tab === 'tactics' && (
          <div className="stack" style={{ gap: 10 }}>
            {([0, 1] as const).filter(s => s === 0 || duo).map(s => (
              <div key={s} className="row spread"><b>{duo ? `P${s + 1} · ` : ''}{t('ctl.mentalityShort')}</b>
                <Seg value={hud.mentality[s]} options={(['defensive', 'balanced', 'attacking'] as const).map(m => [m, t('tac.mentality.' + m)] as [typeof m, string])}
                  onChange={m => { eng.setMentality(s, m); force(x => x + 1) }} />
              </div>
            ))}
            <p className="muted" style={{ margin: 0 }}>{t('lv.m.tacticsHint')}</p>
          </div>
        )}
        {tab === 'camera' && (
          <div className="stack" style={{ gap: 10 }}>
            <Seg value={camMode} options={CAMS.map(c => [c, t('lv.cam.' + c)] as [CamMode, string])} onChange={onCam} />
            <label className="row lv-check"><input type="checkbox" checked={names} onChange={e => setNames(e.target.checked)} /> {t('lv.m.names')}</label>
            <label className="row lv-check"><input type="checkbox" checked={mini} onChange={e => setMini(e.target.checked)} /> {t('lv.m.minimapShow')}</label>
            <label className="row lv-check"><input type="checkbox" checked={eng.replays} onChange={e => { eng.replays = e.target.checked; setPref('pitchside.replays', e.target.checked); force(x => x + 1) }} /> {t('lv.pre.replays')}</label>
            <label className="row lv-check"><input type="checkbox" checked={showKeys} onChange={e => setShowKeys(e.target.checked)} /> {t('lv.m.showKeys')}</label>
          </div>
        )}
        {tab === 'sound' && (
          <div className="stack" style={{ gap: 10 }}>
            <div className="row spread"><b>{t('lv.m.sound')}</b><Seg value={settings.sound ? 'on' : 'off'} options={[['on', t('lv.m.on')], ['off', t('lv.m.off')]]} onChange={v => setS({ sound: v === 'on' })} /></div>
            <div className="row spread"><b>{t('lv.m.volume')}</b>
              <span className="row" style={{ gap: 6 }}>
                <button onClick={() => setS({ volume: Math.max(0, Math.round((settings.volume - 0.1) * 10) / 10) })}>−</button>
                <span className="num" style={{ minWidth: 42, textAlign: 'center' }}>{Math.round(settings.volume * 100)}%</span>
                <button onClick={() => setS({ volume: Math.min(1, Math.round((settings.volume + 0.1) * 10) / 10) })}>+</button>
              </span>
            </div>
            <div className="row spread"><b>{t('lv.m.rumble')}</b><Seg value={settings.rumble ? 'on' : 'off'} options={[['on', t('lv.m.on')], ['off', t('lv.m.off')]]} onChange={v => setS({ rumble: v === 'on' })} /></div>
            <div className="row spread"><b>{t('lv.m.tts')}</b><Seg value={tts ? 'on' : 'off'} options={[['on', t('lv.m.on')], ['off', t('lv.m.off')]]} onChange={v => setTts(v === 'on')} /></div>
            <p className="muted" style={{ margin: 0 }}>{t('lv.m.ttsHint')}</p>
          </div>
        )}
        {tab === 'controls' && (
          <div className="stack" style={{ gap: 8 }}>
            {!watch && (
              <div className="row spread" style={{ flexWrap: 'wrap', gap: 8 }}>
                <b>{t('lv.as.title')}</b>
                <AssistToggles value={eng.assist} onChange={a => { eng.assist = a; saveAssists(difficulty, a); force(x => x + 1) }} />
              </div>
            )}
            {!watch && <button onClick={onTutorial}>{t('lv.tut.replay')}</button>}
            <Seg value={dev} options={[['kb', t('lv.dev.kb')], ['ps', 'PlayStation'], ['xbox', 'Xbox']]} onChange={setDev} />
            <div className="lv-ctlgrid wide">
              <div><i>{t('ctl.attack')}</i><CtlList group="att" g={dev} /></div>
              <div><i>{t('ctl.defend')}</i><CtlList group="def" g={dev} /><i>{t('lv.m.general')}</i><CtlList group="gen" g={dev} /></div>
              <div><i>{t('lv.m.setPieces')}</i><CtlList group="set" g={dev} /><i>{t('lv.m.penalties')}</i><CtlList group="pen" g={dev} /><CtlList group="keeper" g={dev} /><i>{t('lv.m.keeper')}</i><CtlList group="gk" g={dev} /></div>
            </div>
          </div>
        )}
        {tab === 'skills' && (
          <div className="stack" style={{ gap: 6 }}>
            <SignatureList eng={eng} />
            <p className="muted" style={{ margin: 0 }}>{t('lv.m.skillsHint', { rs: dev === 'kb' ? 'U + WASD' : glyph('RS', dev) })}</p>
            <Seg value={dev} options={[['kb', t('lv.dev.kb')], ['ps', 'PlayStation'], ['xbox', 'Xbox']]} onChange={setDev} />
            <table className="compact lv-combos"><tbody>
              {COMBO_ROWS.map(c => (
                <tr key={c.id}><td><b>{t('lv.sk.' + c.id)}</b></td><td className="lv-stars">{'★'.repeat(c.stars)}<span className="muted">{'★'.repeat(5 - c.stars)}</span></td>
                  <td className="num">{(dev === 'kb' ? 'U + ' : glyph('RS', dev) + ' ') + c.seq}{c.id === 'knock' ? ` (+${glyph('RT', dev)})` : ''}</td></tr>
              ))}
              <tr><td><b>{t('lv.sk.fakeshot')}</b></td><td className="lv-stars">★<span className="muted">★★★★</span></td><td className="num">{glyph('B', dev)} → {glyph('A', dev)}</td></tr>
            </tbody></table>
          </div>
        )}
        <div className="row" style={{ marginTop: 10 }}>
          <ConfirmButton label={t('mp.leave')} confirm={t('mp.leaveConfirm')} onConfirm={onLeave} />
        </div>
      </div>
    </div>
  )
}

/** The icons (legends, custom players) on the pitch and their signature moves. */
function SignatureList({ eng }: { eng: Engine }) {
  const { t } = useI18n()
  const icons = eng.players.filter(p => p.sig)
  if (!icons.length) return <p className="muted" style={{ margin: 0 }}>{t('lv.m.sigNone')}</p>
  return (
    <div className="lv-sigs">
      <b>{t('lv.m.signatures')}</b>
      {icons.map(p => <span key={p.data.id}>★ {p.data.name} <span className="muted">({eng.shorts[p.team]})</span>: <b>{t('lv.sk.' + p.sig)}</b></span>)}
      <small className="muted">{t('lv.m.sigHint')}</small>
    </div>
  )
}

function SubsPanel({ eng, side, duo, pre, onSide, onClose }: {
  eng: Engine; side: Side; duo: boolean; pre?: { out: number; in: number } | null; onSide: (s: Side) => void; onClose: () => void
}) {
  const { t } = useI18n()
  // a substitution tip opens the bench with both players picked: one press of the big button makes the change
  const [out, setOut] = useState<number | null>(pre?.out ?? null)
  const [pick, setPick] = useState<number | null>(pre?.in ?? null)
  const [, force] = useState(0)
  const onPitch = [...eng.teams[side]].sort((a, b) => Number(b.injured) - Number(a.injured) || a.stamina - b.stamina)
  const outP = onPitch.find(p => p.data.id === out)
  const bench = benchOrder(eng.bench[side], outP)
  const sugg = outP ? suggestSub(eng, side, outP)?.id ?? null : null
  const pickP = bench.find(p => p.id === pick) ?? null
  const left = eng.subsLeft(side)
  const pct = (v: number) => Math.round(v * 100)
  const swap = (inId: number) => { if (out != null && eng.substitute(side, out, inId)) { setOut(null); setPick(null); force(x => x + 1) } }
  const chooseOut = (id: number) => {
    setOut(id)
    const p = eng.teams[side].find(q => q.data.id === id)
    setPick(p ? suggestSub(eng, side, p)?.id ?? null : null)
  }
  return (
    <div className="overlay subs" onKeyDown={e => e.stopPropagation()}>
      <div className="card" style={{ width: 'min(760px, 100%)', maxHeight: '86%', overflow: 'auto' }}>
        <div className="row spread">
          <h3 style={{ margin: 0 }}>⇄ {t('mp.subs')} · {eng.shorts[side]} · {t('mp.subsLeft', { n: left })}</h3>
          <span className="row" style={{ gap: 6 }}>
            {duo && <button onClick={() => { setOut(null); setPick(null); onSide(side === 0 ? 1 : 0) }}>⇆ {eng.shorts[side === 0 ? 1 : 0]}</button>}
            <button className={outP && pickP && left > 0 ? '' : 'primary'} onClick={onClose}>{t('mp.backToMatch')}</button>
          </span>
        </div>
        {outP && pickP && left > 0 ? (
          <button className="primary lv-subgo" onClick={() => swap(pickP.id)}>
            ⇄ {t('lv.subs.do', { in: pickP.name, out: outP.data.name })}
            <small>{pct(outP.stamina)}% → {Math.round(pickP.fitness)}%</small>
          </button>
        ) : (
          <p className="muted" style={{ margin: '4px 0 8px', fontSize: 13 }}>{out == null ? t('mp.pickOut') : t('mp.pickIn', { name: outP?.data.name ?? '' })}</p>
        )}
        <div className="grid g2" style={{ gap: 12 }}>
          <div>
            <b>{t('mp.onPitch')}</b>
            <table className="compact lv-subs"><tbody>
              {onPitch.map(p => (
                <tr key={p.data.id} className={'click' + (out === p.data.id ? ' sel' : '')} onClick={() => chooseOut(p.data.id)}>
                  <td><PosTag p={p.data.position} role={p.role} /></td>
                  <td>
                    {p.data.name}{p.yellow ? ' 🟨' : ''}
                    {p.injured ? <em className="lv-tag inj">✚ {t('lv.subs.hurt')}</em> : !p.isGK && p.stamina < TIRED ? <em className="lv-tag low">{t('lv.subs.tired')}</em> : null}
                  </td>
                  <td className="r num" style={{ width: 80 }}><Bar v={pct(p.stamina)} /></td>
                  <td className={'r num lv-pct ' + staminaTone(p)}>{pct(p.stamina)}%</td>
                </tr>
              ))}
            </tbody></table>
          </div>
          <div>
            <b>{t('mp.bench')}</b>
            <table className="compact lv-subs"><tbody>
              {bench.map(p => (
                <tr key={p.id} className={(out != null && left > 0 ? 'click' : '') + (pick === p.id ? ' sel' : '')} style={{ opacity: out == null ? 0.6 : 1 }}
                  onClick={() => swap(p.id)}>
                  <td><PosTag p={p.position} role={p.role} /></td>
                  <td>{p.name}{sugg === p.id && <em className="lv-tag pick">★ {t('lv.subs.pick')}</em>}{(p.bring ?? 0) > 0 && <em className="lv-tag bring" data-tip={t('bring.tip')}>⬆ {t('bring.short')}</em>}</td>
                  <td className="r"><Ovr v={p.overall} /></td>
                  <td className={'r num lv-pct ' + staminaTone({ stamina: p.fitness / 100, injured: p.injury > 0 })}>{Math.round(p.fitness)}%</td>
                </tr>
              ))}
              {bench.length === 0 && <tr><td className="muted">{t('mp.noBench')}</td></tr>}
            </tbody></table>
          </div>
        </div>
      </div>
    </div>
  )
}

const RES_ORDER = ['tickets', 'tv', 'ads', 'sponsor', 'sponsor_bonus', 'friendly_fee', 'prize', 'wages', 'staff']

/** What the matchday report takes from the live match itself, so it says exactly what the full-time screen said:
 *  every goal (own goals too) and the same live ratings and man of the match. */
export interface LiveSummary {
  goals: { minute: number; home: boolean; scorer: string; assist: string; og: boolean; pen: boolean }[]
  /** the user's players, best first */
  ratings: { playerId: number; name: string; rating: number }[]
  mom: { playerId: number; name: string; rating: number; mine: boolean } | null
  /** every player's live rating by id (sent with the result) */
  byId: Record<number, number>
}

export function liveSummary(eng: Engine): LiveSummary {
  const rated = rateMatch(eng.playerStats(), eng.score, eng.minute())
  const mom = manOfTheMatch(rated, eng.score)
  const byId: Record<number, number> = {}
  for (const r of rated) byId[r.id] = r.rating
  return {
    goals: eng.goalLog.map(g => ({ minute: g.minute, home: g.team === eng.homeTeam, scorer: g.scorer, assist: g.assist, og: g.og, pen: g.pen })),
    ratings: rated.filter(r => r.team === 0).sort((a, b) => b.rating - a.rating).map(r => ({ playerId: r.id, name: r.name, rating: r.rating })),
    mom: mom ? { playerId: mom.id, name: mom.name, rating: mom.rating, mine: mom.team === 0 } : null,
    byId,
  }
}

/** Day-report happenings by kind, so each kind sits under its own heading. */
function happeningKind(key: string): 'fans' | 'awards' | 'club' {
  if (key.startsWith('fans_')) return 'fans'
  if (key.startsWith('award_') || key.startsWith('trophy_') || key === 'level_up' || key === 'perks' || key === 'legend_wall' || key === 'shirt_retired') return 'awards'
  return 'club'
}

function RepGroup({ title, children }: { title: string; children: ReactNode }) {
  return <section className="lv-rgroup"><h4>{title}</h4>{children}</section>
}

const tone = (v: 'good' | 'bad' | 'warn' | undefined) => (v ? { color: `var(--${v})` } : undefined)

export function Report({ r, clubId, onClose, live }: { r: DayReport; clubId: number; onClose: () => void; live?: LiveSummary | null }) {
  const { t } = useI18n()
  const stage = useStageLabel()
  const f = r.fixture
  let verdict = ''
  const userHome = !!f && f.homeId === clubId
  if (f) {
    const gf = userHome ? f.homeGoals! : f.awayGoals!
    const ga = userHome ? f.awayGoals! : f.homeGoals!
    const pensWon = f.pensHome != null && f.pensHome === userHome
    verdict = gf > ga ? t('rep.win') : gf < ga ? t('rep.loss') : f.pensHome != null ? (pensWon ? t('rep.pensWin') : t('rep.pensLoss')) : t('rep.draw')
  }
  const money_ = [...(r.money ?? [])].sort((a, b) => RES_ORDER.indexOf(a.kind) - RES_ORDER.indexOf(b.kind))
  const net = money_.reduce((a, m) => a + m.amount, 0)
  const opp = (mine: boolean) => (mine ? '' : ` (${t('rep.opp')})`)
  // the goals, adding up to the score: from the live match when it was played live (minutes, own goals, penalties);
  // otherwise the stored scorers, with a goal nobody is credited with (an own goal) filled in for its side
  const goals: ReactNode[] = []
  if (live && f && live.goals.length === (f.homeGoals ?? 0) + (f.awayGoals ?? 0)) {
    for (const [i, g] of [...live.goals].sort((a, b) => a.minute - b.minute).entries()) {
      const mine = g.home === userHome
      goals.push(
        <li key={'l' + i}>⚽ <b className="num">{g.minute}'</b> <b>{g.og ? (g.scorer ? t('lv.rep.ogBy', { name: g.scorer }) : t('lv.rep.og')) : g.scorer}</b>
          {g.pen ? ` (${t('lv.post.pen')})` : ''}{g.assist && !g.og ? ` · ${t('feed.assist', { name: g.assist })}` : ''}{opp(mine)}</li>,
      )
    }
  } else if (f) {
    const evs = r.events ?? []
    evs.forEach((e, i) => goals.push(<li key={'e' + i}>⚽ <b>{e.name}</b>{e.assist ? ` · ${t('feed.assist', { name: e.assist })}` : ''}{opp(e.clubId === clubId)}</li>))
    for (const [side, n] of [[f.homeId, f.homeGoals ?? 0], [f.awayId, f.awayGoals ?? 0]] as const) {
      for (let k = evs.filter(e => e.clubId === side).length; k < n; k++) goals.push(<li key={'o' + side + k}>⚽ <b>{t('lv.rep.og')}</b>{opp(side === clubId)}</li>)
    }
  }
  const ratings = live ? live.ratings : r.ratings ?? []
  const mom = live?.mom ?? null
  // the rest of the day, each kind under its own heading
  const happen = (kind: ReturnType<typeof happeningKind>) => (r.happenings ?? []).filter(h => happeningKind(h.key) === kind)
    .map((h, i) => <span key={kind + i} style={tone(happeningTone(h.key) === 'bad' ? 'bad' : happeningTone(h.key) === 'warn' ? 'warn' : 'good')}>✦ {happeningText(t, h)}</span>)
  const subs = [...(r.subs ?? [])].sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0))
  const commercial = (r.commercial ?? []).filter(e => e.key !== 'board_set')
  const groups: [string, ReactNode[]][] = [
    ['lv.rep.match', [
      subs.length ? <i key="sh">{t('rep.subs')}</i> : null,
      ...subs.map((x, i) => <span key={'s' + i}><b className="num">{x.minute ?? 0}'</b> {t('lv.rep.subLine', { in: x.in, out: x.out })}{x.bring ? <span className="bringrep"> ⬆ {t('bring.rep')}</span> : null}</span>),
      r.rotated?.length ? <i key="rh">{t('rep.rotated')}</i> : null,
      ...(r.rotated ?? []).map((x, i) => <span key={'r' + i}>↻ {t(x.why === 'dev' ? 'lv.rep.devLine' : 'lv.rep.rotLine', { in: x.in, out: x.out, fit: x.outFit })}</span>),
      r.congested ? <span key="cg" className="muted">{t('rep.congested')}</span> : null,
      r.injuries?.length ? <i key="ih">{t('rep.injuries')}</i> : null,
      ...(r.injuries ?? []).map((x, i) => <span key={'i' + i} style={tone('bad')} data-inj={x.kind || undefined} data-tip={x.kind ? t('inj.' + x.kind + '.d') : undefined}>✚ {x.name}{x.kind ? ` · ${t('inj.' + x.kind)}` : ''} · {x.weeks} {t('wk')}</span>),
    ]],
    ['lv.rep.business', [
      ...commercial.map((e, i) => <span key={'c' + i} style={tone((e.amount ?? 0) < 0 || e.key.includes('left') || e.key.includes('failed') || e.key.includes('missed') ? 'bad' : 'good')}>✉ {t('com.' + e.key, { name: e.key === 'facility_worn' ? t('dev.' + e.name) : e.key.startsWith('board') || e.key.startsWith('card') ? t((e.key.startsWith('card') ? 'card.' : 'goal.') + e.name) : e.name ?? '', v: money(Math.abs(e.amount ?? 0)) })}</span>),
      r.card ? <span key="card" style={tone(r.card.choice ? 'warn' : r.card.amount >= 0 ? 'good' : 'bad')}>🃏 {t('card.' + r.card.key)}{r.card.choice ? ` · ${t('inbox.choose')}` : ` ${r.card.amount >= 0 ? '+' : '−'}${money(Math.abs(r.card.amount))}`}</span> : null,
    ]],
    ['lv.rep.fans', happen('fans')],
    ['lv.rep.awards', happen('awards')],
    ['al.titleShort', (r.alerts ?? []).filter(a => a.level !== 'info').slice(0, 5).map((a, i) => <span key={'al' + i} style={tone(a.level === 'bad' ? 'bad' : 'warn')}>⚠ {alertText(t, a)}</span>)],
    ['lv.rep.club', [...happen('club'), r.iconPick ? <span key="icon" style={tone('good')}>★ {t('icon.opened')}</span> : null]],
    ['lv.rep.players', [
      r.demands?.length ? <i key="dh">{t('rep.demands')}</i> : null,
      ...(r.demands ?? []).map(n => <span key={'d' + n} style={tone('warn')}>💬 {n}</span>),
      r.refusals?.length ? <i key="fh">{t('rep.refusals')}</i> : null,
      ...(r.refusals ?? []).map(n => <span key={'f' + n} style={tone('bad')}>{refusalText(t, n)}</span>),
      r.unrest?.length ? <i key="uh">{t('rep.unrest')}</i> : null,
      ...(r.unrest ?? []).map(n => <span key={'u' + n} style={tone('bad')}>✋ {n}</span>),
      r.departures?.length ? <i key="xh">{t('rep.departures')}</i> : null,
      ...(r.departures ?? []).map(d => <span key={'x' + d.name} style={tone('bad')}>→ {d.name} · {d.club} (+{money(d.fee)})</span>),
      r.youth ? <i key="yh">{t('rep.youth')}</i> : null,
      r.youth ? <span key="y" style={tone('good')}>★ {r.youth}</span> : null,
    ]],
    ['lv.rep.explore', (r.discoveries ?? []).map((d, i) => <span key={'e' + i} style={tone('good')}>🔭 {feedText(t, d)}</span>)],
    ['rep.quests', (r.quests ?? []).map(q => <span key={q} style={tone('good')}>✓ {t('quest.' + q, { n: '' })}</span>)],
  ]
  // (a sub-heading is only added together with its lines, so a group with anything in it has real lines)
  const shown = groups.map(([k, items]) => [k, items.filter(Boolean)] as const).filter(([, items]) => items.length > 0)
  return (
    <div className="card lv-report" style={{ width: 'min(820px, 100%)' }}>
      <span className="eyebrow">{t('rep.title', { d: r.day })} · {stage(r.comp, r.stage)}</span>
      {f ? (
        <h2 className="num" style={{ fontSize: 30 }}>{verdict}: {f.home} {f.homeGoals} - {f.awayGoals} {f.away}</h2>
      ) : <h2>{t('rep.noMatch')}</h2>}
      {goals.length > 0 && <ul className="notes" style={{ margin: 0 }}>{goals}</ul>}
      {f && <p className="muted num" style={{ margin: 0 }}>{t('possession')} {f.homeShort} {r.stats.possHome}% · {t('shots')} {r.stats.shotsHome} - {r.stats.shotsAway}</p>}
      <div className="grid g3" style={{ gap: 12 }}>
        {(ratings.length > 0 || mom) && (
          <div>
            <b>{t('rep.ratings')}</b>
            {mom && <p className="lv-rmom">★ {t('lv.post.mom')}: <b>{mom.name}</b>{opp(mom.mine)} <b className="num">{mom.rating.toFixed(1)}</b></p>}
            <table className="compact num"><tbody>
              {ratings.slice(0, 5).map(x => <tr key={x.playerId}><td>{x.name}{mom?.playerId === x.playerId ? ' ★' : ''}</td><td className="r"><b style={{ color: x.rating >= 7.5 ? 'var(--good)' : x.rating < 6 ? 'var(--bad)' : undefined }}>{x.rating.toFixed(1)}</b></td></tr>)}
            </tbody></table>
          </div>
        )}
        <div>
          <b>{t('rep.money')}</b>
          <table className="compact num"><tbody>
            {money_.map((m, i) => <tr key={i}><td>{t('fin.' + m.kind)}</td><td className="r" style={{ color: m.amount < 0 ? 'var(--bad)' : 'var(--good)' }}>{m.amount > 0 ? '+' : ''}{money(m.amount)}</td></tr>)}
            <tr><td><b>{t('rep.net')}</b></td><td className="r"><b>{net > 0 ? '+' : ''}{money(net)}</b></td></tr>
          </tbody></table>
          <span className="muted">{t('rep.budgetNow', { v: money(r.budget) })}</span>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <b>{t('rep.training')}</b>
          {r.changes?.length ? r.changes.slice(0, 5).map(c => <span key={c.playerId}>{c.played && <span data-tip={t('rep.playedTip')}><Icon name="match" size={13} /> </span>}{c.name}: {c.before} → <b style={{ color: c.after > c.before ? 'var(--good)' : 'var(--bad)' }}>{c.after}</b></span>) : <span className="muted">{t('rep.noChange')}</span>}
          {r.tp ? <span className="tpline">＋{r.tp} TP</span> : null}
        </div>
      </div>
      {shown.length > 0 && <div className="lv-rgroups">{shown.map(([k, items]) => <RepGroup key={k} title={t(k)}>{items}</RepGroup>)}</div>}
      {r.others && r.others.length > 0 && (
        <div>
          <b>{t('rep.others')}</b>
          <table className="compact num"><tbody>
            {r.others.map(o => <tr key={o.id}><td className="r">{o.home}</td><td style={{ textAlign: 'center' }}><b>{o.homeGoals} - {o.awayGoals}</b>{o.pensHome != null && <small className="muted"> ({t('pens')})</small>}</td><td>{o.away}</td></tr>)}
          </tbody></table>
        </div>
      )}
      {r.seasonEnd && (
        <div className="panel" style={{ borderColor: 'var(--club)' }}>
          <b>{t('rep.seasonEnd', { n: r.seasonEnd.season })}</b>
          <p style={{ margin: '4px 0 0' }}>
            {t('rep.seasonLine', { p: r.seasonEnd.position, cup: t('ko.' + (r.seasonEnd.cup || 'none')), cl: t('ko.' + (r.seasonEnd.cl || 'none')), prize: money(r.seasonEnd.prize) })}
            {' '}{r.seasonEnd.move === 'up' ? t('rep.promoted') : r.seasonEnd.move === 'down' ? t('rep.relegated') : ''}
            {' '}{r.seasonEnd.qualified ? t('rep.qualified') : ''}
          </p>
          <p className="muted" style={{ margin: '4px 0 0' }}>{t('rep.offseasonNext')}</p>
        </div>
      )}
      <button className="primary" onClick={onClose}>{t('continue')}</button>
    </div>
  )
}
