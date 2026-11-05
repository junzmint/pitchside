import { useEffect, useMemo, useRef, useState } from 'react'
import type { MatchSetup, User } from '../../types'
import { playApi, type PlayTeam, type PlayTeams } from '../../api_play'
import type { Difficulty, MatchOutcome } from '../../match/engine'
import type { DeviceRef } from '../../match/input'
import { listPads, rawPad, type PadInfo } from '../../match/gamepad'
import { LanHost } from '../../lan/host'
import { useSettings } from '../../settings'
import { Badge, Hint, Icon, Modal, Seg, TabBar, Title } from '../../ui'
import { errText, useI18n } from '../../i18n'
import { PlayLive, type Assign } from './PlayLive'
import { QrCode, addResult, loadRecord, winnerOf, type QuickMode, type QuickRecord } from './bits'

// Quick match: any two clubs of the world (or Legends XIs of the famous clubs), one player against
// the computer, two players on this device, or two players over Wi-Fi. Exhibition only: nothing is
// saved to a career; a small local record keeps wins, draws and losses.

const LAST_KEY = 'pitchside.quick.last'
interface Last { home: string; away: string; mode: QuickMode; len: string; diff: Difficulty; weather: Weather; ko: boolean }
type Weather = 'clear' | 'rain' | 'snow' | 'random'

function loadLast(): Partial<Last> {
  try { return JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}') as Partial<Last> } catch { return {} }
}

export function teamIndex(teams: PlayTeams | null): Map<string, PlayTeam> {
  const m = new Map<string, PlayTeam>()
  if (!teams) return m
  for (const l of teams.leagues) for (const d of l.divisions) for (const tm of d.teams) m.set(tm.key, tm)
  for (const tm of teams.legends) m.set(tm.key, tm)
  return m
}

function defaultAssign(mode: QuickMode, pads: PadInfo[]): Assign {
  if (mode !== 'duo') return [[{ kind: 'kb' }], []]
  const a: Assign = [[], []]
  if (pads[0]) a[0].push({ kind: 'pad', id: pads[0].id, index: pads[0].index })
  if (pads[1]) a[1].push({ kind: 'pad', id: pads[1].id, index: pads[1].index })
  if (pads.length === 0) a[0].push({ kind: 'kb' })
  else if (pads.length === 1) a[1].push({ kind: 'kb' })
  return a
}

export function QuickMatch({ user, startMode }: { user: User; startMode?: QuickMode }) {
  const { t } = useI18n()
  const [settings] = useSettings()
  const last = useMemo(loadLast, [])
  const [teams, setTeams] = useState<PlayTeams | null>(null)
  const [err, setErr] = useState('')
  const [home, setHome] = useState(last.home ?? 'EN:1')
  const [away, setAway] = useState(last.away ?? 'ES:1')
  const [mode, setMode] = useState<QuickMode>(startMode ?? last.mode ?? 'cpu')
  const [len, setLen] = useState(last.len ?? String(settings.matchLength))
  const [diff, setDiff] = useState<Difficulty>(last.diff ?? settings.difficulty)
  const [weather, setWeather] = useState<Weather>(last.weather ?? 'clear')
  const [ko, setKo] = useState(last.ko ?? true)
  const [assign, setAssign] = useState<Assign>(() => defaultAssign(startMode ?? last.mode ?? 'cpu', listPads()))
  const [picker, setPicker] = useState<0 | 1 | null>(null)
  const [stage, setStage] = useState<'lobby' | 'loading' | 'live'>('lobby')
  const [setup, setSetup] = useState<MatchSetup | null>(null)
  const [matchNo, setMatchNo] = useState(0)
  const [record, setRecord] = useState<QuickRecord>(loadRecord)
  const [lan, setLan] = useState<LanHost | null>(null)
  const [, force] = useState(0)

  useEffect(() => { playApi.teams().then(setTeams).catch(e => setErr(errText(t, e))) }, [])
  const byKey = useMemo(() => teamIndex(teams), [teams])
  const H = byKey.get(home), A = byKey.get(away)

  useEffect(() => {
    try { localStorage.setItem(LAST_KEY, JSON.stringify({ home, away, mode, len, diff, weather, ko })) } catch { /* ignore */ }
  }, [home, away, mode, len, diff, weather, ko])

  // the Wi-Fi room lives as long as the lobby (rematches keep the same guest)
  useEffect(() => {
    if (mode !== 'lan') return
    const h = new LanHost()
    setLan(h)
    const off = h.subscribe(() => force(x => x + 1))
    return () => { off(); h.close(); setLan(null) }
  }, [mode])
  const lanRef = useRef(lan)
  lanRef.current = lan
  useEffect(() => {
    if (!lan || !H || !A) return
    lan.setInfo({ state: stage === 'live' ? 'live' : 'lobby', home: lanTeam(H), away: lanTeam(A), mins: Math.round((Number(len) * 2) / 60), host: user.username })
  }, [lan, H, A, stage, len])

  const pickMode = (m: QuickMode) => { setMode(m); setAssign(defaultAssign(m, listPads())) }

  async function start() {
    if (!H || !A) return
    setStage('loading')
    setErr('')
    try {
      const s = await playApi.quick({ home, away, knockout: ko, weather })
      setSetup(s)
      setMatchNo(n => n + 1)
      setStage('live')
    } catch (e) {
      setErr(errText(t, e))
      setStage('lobby')
    }
  }

  const onFullTime = (o: MatchOutcome) => {
    if (!H || !A) return
    setRecord(addResult({ home: H.short, away: A.short, hs: o.homeGoals, as: o.awayGoals, pens: o.pens ?? null, mode, at: Date.now() }))
    const l = lanRef.current
    if (l) l.setInfo({ state: 'ended', home: lanTeam(H), away: lanTeam(A), mins: Math.round((Number(len) * 2) / 60), host: user.username })
  }

  if (stage === 'live' && setup) {
    return (
      <PlayLive key={matchNo} setup={setup} mode={mode} assign={assign} halfSeconds={Number(len)} difficulty={diff} replays lan={lan}
        onFullTime={onFullTime} onRematch={() => { setMatchNo(n => n + 1); lan?.setInfo({ state: 'live', home: lanTeam(H!), away: lanTeam(A!), mins: Math.round((Number(len) * 2) / 60), host: user.username }) }}
        onLeave={() => setStage('lobby')} />
    )
  }

  const p2ready = mode === 'cpu' || (mode === 'duo' ? assign[1].length > 0 : !!lan?.guest)
  return (
    <div className="stack pl-quick">
      {err && <p className="error">{err}</p>}
      <section className="panel stack">
        <div className="pl-pick">
          <TeamSlot side={0} team={H} label={mode === 'cpu' ? t('pl.quick.you') : 'P1'} onPick={() => setPicker(0)} />
          <div className="pl-vsbox">
            <b className="pl-vsmid">VS</b>
            <button className="small" onClick={() => { setHome(away); setAway(home) }} data-tip={t('pl.quick.swapTip')}><Icon name="rotate" size={15} /> {t('pl.quick.swap')}</button>
            <button className="small" disabled={!teams} onClick={() => { const all = [...byKey.keys()]; const a = all[Math.floor(Math.random() * all.length)]; let b = a; while (b === a) b = all[Math.floor(Math.random() * all.length)]; setHome(a); setAway(b) }}>
              <Icon name="icon" size={15} /> {t('pl.quick.random')}
            </button>
          </div>
          <TeamSlot side={1} team={A} label={mode === 'cpu' ? t('pl.quick.cpu') : 'P2'} onPick={() => setPicker(1)} />
        </div>
        <TabBar value={mode} onChange={pickMode} label={t('pl.quick.mode')} options={[
          ['cpu', 'playNow', t('pl.mode.cpu'), t('pl.mode.cpuSub')],
          ['duo', 'gamepad', t('pl.mode.duo'), t('pl.mode.duoSub')],
          ['lan', 'broadcast', t('pl.mode.lan'), t('pl.mode.lanSub')],
        ]} />
        <div className="grid g2 pl-opts">
          <div className="row spread"><b>{t('mp.length')}</b><Seg value={len} options={[['90', t('mp.min', { n: 3 })], ['150', t('mp.min', { n: 5 })], ['240', t('mp.min', { n: 8 })]]} onChange={setLen} /></div>
          {mode === 'cpu' && <div className="row spread"><b>{t('mp.difficulty')}</b><Seg value={diff} options={[['easy', t('mp.easy')], ['normal', t('mp.normal')], ['hard', t('mp.hard')]]} onChange={setDiff} /></div>}
          <div className="row spread"><b>{t('pl.quick.weather')}</b><Seg value={weather} options={[['clear', <Icon key="c" name="sun" size={15} title={t('pl.w.clear')} />], ['rain', <Icon key="r" name="rain" size={15} title={t('pl.w.rain')} />], ['snow', <Icon key="s" name="snow" size={15} title={t('pl.w.snow')} />], ['random', t('pl.w.random')]]} onChange={setWeather} /></div>
          <label className="row lv-check"><input type="checkbox" checked={ko} onChange={e => setKo(e.target.checked)} /> {t('pl.quick.ko')}</label>
        </div>
        {mode === 'duo' && <DuoLobby assign={assign} setAssign={setAssign} names={[H?.name ?? 'P1', A?.name ?? 'P2']} />}
        {mode === 'lan' && lan && <LanPanel lan={lan} />}
        {mode === 'cpu' && <Hint text={t('pl.quick.cpuHint')} />}
        <div className="row pl-startrow">
          <button className="primary big" disabled={!H || !A || stage === 'loading' || home === away} onClick={start}>
            <Icon name="playNow" size={18} /> {stage === 'loading' ? t('wait') : mode === 'lan' && !lan?.guest ? t('pl.quick.startAnyway') : t('pl.quick.start')}
          </button>
          {mode === 'lan' && !lan?.guest && <span className="muted pl-note">{t('pl.quick.startAnywayNote')}</span>}
          {mode === 'duo' && !p2ready && <span className="error pl-note">{t('lv.lobby.p2missing')}</span>}
        </div>
      </section>
      <RecordPanel record={record} />
      {picker != null && teams && (
        <TeamPicker teams={teams} value={picker === 0 ? home : away} other={picker === 0 ? away : home} title={picker === 0 ? t('pl.quick.pickHome') : t('pl.quick.pickAway')}
          onPick={k => { if (picker === 0) setHome(k); else setAway(k); setPicker(null) }} onClose={() => setPicker(null)} />
      )}
    </div>
  )
}

const lanTeam = (tm: PlayTeam) => ({ name: tm.name, short: tm.short, color: tm.color, color2: tm.color2, strength: tm.strength, legends: tm.legends })

function TeamSlot({ side, team, label, onPick }: { side: 0 | 1; team?: PlayTeam; label: string; onPick: () => void }) {
  const { t } = useI18n()
  return (
    <button className={'pl-slot p' + (side + 1)} onClick={onPick}>
      <span className="pl-slotlabel">{label}</span>
      {team ? <>
        <Badge short={team.short} color={team.color} color2={team.color2} size={72} />
        <b className="pl-slotname">{team.name}</b>
        <span className="muted pl-slotmeta">
          <span data-tip={t('pl.quick.strengthTip')}><Icon name="strength" size={13} /> {team.strength}</span>
          <span data-tip={t('pl.quick.formation')}><Icon name="tactics" size={13} /> {team.formation}</span>
          {team.legends && <span className="pl-legtag"><Icon name="legend" size={13} /> {t('pl.quick.legends')}</span>}
        </span>
        {team.stars && team.stars.length > 0 && <small className="muted pl-stars">{team.stars.slice(0, 3).join(' · ')}</small>}
      </> : <span className="muted">{t('loading')}</span>}
      <span className="pl-change"><Icon name="rotate" size={14} /> {t('pl.quick.change')}</span>
    </button>
  )
}

function TeamPicker({ teams, value, other, title, onPick, onClose }: { teams: PlayTeams; value: string; other: string; title: string; onPick: (k: string) => void; onClose: () => void }) {
  const { t } = useI18n()
  const cur = value.startsWith('L:') ? 'LEG' : value.split(':')[0]
  const [tab, setTab] = useState<string>(cur)
  const lg = teams.leagues.find(l => l.code === tab)
  const curDiv = lg ? (lg.divisions.find(d => d.teams.some(x => x.key === value))?.division ?? 1) : 1
  const [div, setDiv] = useState(curDiv)
  const list = tab === 'LEG' ? teams.legends : lg?.divisions.find(d => d.division === div)?.teams ?? []
  return (
    <Modal onClose={onClose} className="pl-picker" label={title}>
      <div className="row spread"><Title icon="club">{title}</Title><button onClick={onClose}><Icon name="close" size={15} /> {t('close')}</button></div>
      <TabBar value={tab} onChange={v => { setTab(v); setDiv(1) }} options={[
        ...teams.leagues.map(l => [l.code, 'league', t('country.' + l.code), l.name] as [string, 'league', string, string]),
        ['LEG', 'legend', t('pl.quick.legends'), t('pl.quick.legendsSub')] as [string, 'legend', string, string],
      ]} />
      {lg && <Seg value={String(div)} options={lg.divisions.map(d => [String(d.division), `${t('divN', { n: d.division })} · ${d.name}`] as [string, string])} onChange={v => setDiv(Number(v))} />}
      {tab === 'LEG' && <p className="muted" style={{ margin: 0 }}>{t('pl.quick.legendsHint')}</p>}
      <div className="grid g3 pl-teamgrid">
        {list.map(tm => (
          <button key={tm.key} className={'clubpick' + (tm.key === value ? ' on' : '')} disabled={tm.key === other} onClick={() => onPick(tm.key)}>
            <Badge short={tm.short} color={tm.color} color2={tm.color2} size={38} />
            <span style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
              <b>{tm.name}</b>
              <small className="muted clubstats"><span data-tip={t('pl.quick.strengthTip')}><Icon name="strength" size={12} /> {tm.strength}</span><span><Icon name="tactics" size={12} /> {tm.formation}</span></small>
              {tm.stars && tm.stars.length > 0 && <small className="muted wrap">{tm.stars.slice(0, 3).join(', ')}</small>}
            </span>
          </button>
        ))}
      </div>
    </Modal>
  )
}

/** Who plays with which controller on this device: pads join with Start / Options, the keyboard is assigned by hand. */
function DuoLobby({ assign, setAssign, names }: { assign: Assign; setAssign: (a: Assign) => void; names: [string, string] }) {
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
      const alive = (d: DeviceRef) => d.kind === 'kb' || list.some(p => p.index === d.index && p.id === d.id)
      if (!a[0].every(alive) || !a[1].every(alive)) { a = [a[0].filter(alive), a[1].filter(alive)]; changed = true }
      for (const p of list) {
        const down = !!rawPad(p.index)?.buttons[9]?.pressed
        const was = prev.get(p.index) ?? down
        prev.set(p.index, down)
        if (!down || was) continue
        // Start on a pad: it moves to the other player (or to the first player without a pad)
        const isP = (d: DeviceRef) => d.kind === 'pad' && d.index === p.index
        const from = a[0].some(isP) ? 0 : a[1].some(isP) ? 1 : -1
        const out: Assign = [a[0].filter(d => !isP(d)), a[1].filter(d => !isP(d))]
        const to: 0 | 1 = from === 0 ? 1 : from === 1 ? 0 : !out[0].some(d => d.kind === 'pad') ? 0 : 1
        out[to].push({ kind: 'pad', id: p.id, index: p.index })
        a = out
        changed = true
      }
      if (changed) setAssign(a)
    }, 100)
    return () => clearInterval(iv)
  }, [])
  const kbSide = assign[0].some(d => d.kind === 'kb') ? '0' : assign[1].some(d => d.kind === 'kb') ? '1' : '-1'
  const moveKb = (v: string) => {
    const out: Assign = [assign[0].filter(d => d.kind !== 'kb'), assign[1].filter(d => d.kind !== 'kb')]
    if (v !== '-1') out[Number(v) as 0 | 1].push({ kind: 'kb' })
    setAssign(out)
  }
  const label = (d: DeviceRef) => d.kind === 'kb' ? t('lv.dev.kb') : `${pads.find(p => p.index === d.index)?.label ?? 'Pad'} #${d.index + 1}`
  return (
    <div className="lv-lobby">
      <p className="muted" style={{ margin: 0 }}>{t('pl.duo.hint')}</p>
      <div className="lv-slots">
        {([0, 1] as const).map(s => (
          <div key={s} className={'lv-slot p' + (s + 1)}>
            <b>P{s + 1} · {names[s]}</b>
            {assign[s].length ? assign[s].map((d, i) => <span key={i} className="lv-dev"><Icon name={d.kind === 'kb' ? 'keyboard' : 'gamepad'} size={13} /> {label(d)}</span>) : <span className="muted">{t('lv.lobby.empty')}</span>}
          </div>
        ))}
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <span className="muted"><Icon name="keyboard" size={14} /> {t('lv.dev.kb')}:</span>
        <Seg value={kbSide} options={[['0', 'P1'], ['1', 'P2'], ['-1', t('lv.lobby.none')]]} onChange={moveKb} />
        <span className="muted"><Icon name="gamepad" size={14} /> {pads.length ? pads.map(p => `${p.label} #${p.index + 1}`).join(', ') : t('lv.lobby.noPads')}</span>
      </div>
    </div>
  )
}

/** The Wi-Fi room: code, the address to open (also as a QR code) and whether player 2 is in. */
export function LanPanel({ lan }: { lan: LanHost }) {
  const { t } = useI18n()
  const local = /^(localhost|127\.|\[::1\])/.test(location.hostname)
  const base = lan.address?.url || (local ? '' : location.origin)
  const addr = base ? `${base}/join` : ''
  const full = base && lan.code ? `${base}/join/${lan.code}` : ''
  const shown = addr.replace(/^https?:\/\//, '')
  return (
    <div className="pl-lan">
      <div className="pl-lancode">
        <span className="muted">{t('pl.lan.code')}</span>
        <b className="num" aria-live="polite">{lan.code || '····'}</b>
        <span className={'pl-lanstate ' + (lan.guest ? 'in' : lan.state === 'open' ? 'wait' : 'off')}>
          {lan.guest ? <><Icon name="check" size={15} /> {t('pl.lan.joined', { dev: t('pl.dev.' + (lan.guestDev || 'unknown')) })}{lan.rtt ? ` · ${lan.rtt} ms` : ''}</>
            : lan.state === 'open' ? <><span className="pl-dots"><i /><i /><i /></span> {t('pl.lan.waiting')}</>
            : lan.state === 'retrying' ? <>{t('pl.lan.retrying')}</>
            : lan.state === 'gone' ? <>{t('pl.lan.gone')}</> : <>{t('pl.join.connecting')}</>}
        </span>
      </div>
      <div className="pl-lanaddr">
        <span className="muted">{t('pl.lan.open')}</span>
        {addr ? <b className="num pl-url">{shown}</b> : <p className="error" style={{ margin: 0 }}>{t('pl.lan.noIp')}</p>}
        <ol className="pl-steps">
          <li>{t('pl.lan.step1')}</li>
          <li>{t('pl.lan.step2')}</li>
          <li>{t('pl.lan.step3', { code: lan.code || '····' })}</li>
        </ol>
      </div>
      {full && <div className="pl-lanqr"><QrCode text={full} size={156} label={t('pl.lan.qr')} /><small className="muted">{t('pl.lan.qr')}</small></div>}
    </div>
  )
}

function RecordPanel({ record }: { record: QuickRecord }) {
  const { t } = useI18n()
  const any = record.w + record.d + record.l + record.p1 + record.p2 + record.draws2 > 0
  return (
    <section className="panel stack pl-record">
      <Title icon="history2">{t('pl.rec.title')}</Title>
      {!any ? <p className="muted" style={{ margin: 0 }}>{t('pl.rec.empty')}</p> : <>
        <div className="row pl-recrow">
          <span className="pl-rec"><small>{t('pl.rec.vsCpu')}</small><b className="num"><i className="good">{record.w}</i> · {record.d} · <i className="bad">{record.l}</i></b><small className="muted">{t('pl.rec.wdl')}</small></span>
          <span className="pl-rec"><small>{t('pl.rec.twoP')}</small><b className="num"><i className="p1">{record.p1}</i> · {record.draws2} · <i className="p2">{record.p2}</i></b><small className="muted">{t('pl.rec.p1p2')}</small></span>
        </div>
        <div className="pl-last">
          {record.last.slice(0, 8).map((r, i) => {
            const w = winnerOf(r)
            const tone = r.mode === 'cpu' ? (w === 1 ? 'W' : w === 2 ? 'L' : 'D') : 'D'
            return <span key={i} className={'pl-lastchip ' + tone} data-tip={t('pl.mode.' + r.mode)}>{r.home} {r.hs}-{r.as} {r.away}{r.pens ? ` (${r.pens[0]}-${r.pens[1]})` : ''}</span>
          })}
        </div>
      </>}
    </section>
  )
}

