import { useCallback, useEffect, useRef, useState } from 'react'
import { api, money, setUnauthorizedHandler } from './api'
import type { CareerState, User } from './types'
import { Badge, BusyOverlay, CountUp, Icon, Loading, TooltipLayer, fmtMoney, type IconName } from './ui'
import { errText, useI18n } from './i18n'
import { SettingsButton } from './pages/Settings'
import { eventsOf } from './api_events'
import Auth from './pages/Auth'
import Saves from './pages/Saves'
import Overview from './pages/Overview'
import MatchCentre from './pages/MatchCentre'
import Tactics from './pages/Tactics'
import Squad from './pages/Squad'
import Market from './pages/Market'
import Staff from './pages/Staff'
import MedicalRoom from './pages/medical/MedicalRoom'
import KitRoom from './pages/kits/KitRoom'
import Competitions from './pages/Competitions'
import Stats from './pages/Stats'
import Finance from './pages/Finance'
import History from './pages/History'
import Inbox, { inboxCount } from './pages/Inbox'
import Explore, { exploreCount } from './pages/Explore'
import { Celebration } from './pages/explore/Celebration'
import { StageHost } from './pages/stage/StageHost'
import { useGamepadNav } from './gamepadNav'
import MatchPage from './pages/MatchPage'
import { installSfx, sfx } from './sfx'
import { RevealHost } from './reveal'
import { Tour } from './pages/onboarding/Tour'
import { HelpHost, openHowTo } from './pages/onboarding/HowToPlay'
import { badgeOf } from './api_explore'
import { medWaiting } from './api_medical'
import { staffWaiting } from './api_staff'
import { usePlayView } from './pages/play/PlayRoot'
import { parsePlayRoute } from './pages/play/route'

const TABS = ['overview', 'inbox', 'explore', 'match', 'tactics', 'squad', 'market', 'staff', 'medical', 'competitions', 'stats', 'finance', 'history', 'kits'] as const
export type Tab = (typeof TABS)[number]
// The menu works like a game's: six big sections, each with its own pages.
const GROUPS: { key: string; icon: IconName; tabs: Tab[] }[] = [
  { key: 'home', icon: 'home', tabs: ['overview'] },
  { key: 'inbox', icon: 'inbox', tabs: ['inbox'] },
  { key: 'play', icon: 'play', tabs: ['match', 'competitions', 'stats'] },
  { key: 'team', icon: 'team', tabs: ['tactics', 'squad', 'staff', 'medical'] },
  { key: 'market', icon: 'market', tabs: ['market'] },
  { key: 'club', icon: 'club', tabs: ['finance', 'history', 'kits'] },
  { key: 'explore', icon: 'explore', tabs: ['explore'] },
]
const TAB_ICON: Record<Tab, IconName> = { overview: 'overview', inbox: 'inbox', explore: 'explore', match: 'match', tactics: 'tactics', squad: 'squad', market: 'market', staff: 'staff', medical: 'injury', competitions: 'competitions', stats: 'stats', finance: 'finance', history: 'history', kits: 'kit' }

export interface Ctx {
  /** Run a slow action behind a "please wait" overlay. */
  run: <T>(message: string, fn: () => Promise<T>) => Promise<T>
  id: number
  st: CareerState
  reload: () => Promise<void>
  toast: (msg: string, err?: boolean) => void
  go: (t: Tab) => void
  /** Open the live match: play it yourself (default) or watch the computer play it at full length. */
  play: (mode?: 'play' | 'watch') => void
}

function luma(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16)
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114
}
function textOn(hex: string) { return luma(hex) > 150 ? '#111' : '#fff' }
// near-white kits (e.g. Real Madrix) vanish on white panels: fall back to the second colour
function accentOf(c1: string, c2: string) {
  if (luma(c1) < 215) return c1
  if (luma(c2) < 215) return c2
  return '#3a4a40'
}

const CAREER_KEY = 'pitchside.career'

export default function App() {
  const { t } = useI18n()
  const padOn = useGamepadNav()
  useEffect(() => {
    let el = document.getElementById('padhint')
    if (!padOn) { el?.remove(); return }
    if (!el) { el = document.createElement('div'); el.id = 'padhint'; document.body.appendChild(el) }
    el.textContent = t('pad.hint')
  }, [padOn, t])
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [id, setId] = useState<number | null>(() => {
    const v = Number(sessionStorage.getItem(CAREER_KEY))
    return v > 0 ? v : null
  })
  const [st, setSt] = useState<CareerState | null>(null)
  const [tab, setTab] = useState<Tab>(() => (TABS as readonly string[]).includes(location.hash.slice(1)) ? location.hash.slice(1) as Tab : 'overview')
  const [match, setMatch] = useState<false | 'play' | 'watch'>(false)
  const [seenOver, setSeenOver] = useState(false)
  const [msg, setMsg] = useState<{ text: string; err: boolean } | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const lastInbox = useRef(-1)
  const lastTab = useRef<Record<string, Tab>>({})
  const run = useCallback(async <T,>(message: string, fn: () => Promise<T>) => {
    setBusy(message)
    try { return await fn() } finally { setBusy(null) }
  }, [])

  useEffect(() => installSfx(), [])
  useEffect(() => {
    setUnauthorizedHandler(() => { setUser(null); setSt(null) })
    api.me().then(setUser).catch(() => setUser(null))
  }, [])

  const toast = useCallback((text: string, err = false) => {
    if (err) sfx('error')
    setMsg({ text, err })
    window.setTimeout(() => setMsg(m => (m?.text === text ? null : m)), 3500)
  }, [])

  const reload = useCallback(async () => {
    if (!id) return
    try {
      setSt(await api.state(id))
      setLoadErr('')
    } catch (e) {
      setLoadErr(errText(t, e))
    }
  }, [id, t])

  useEffect(() => { if (user && id) reload() }, [user, id, reload])
  // a short message when something new lands in the inbox (no pop-ups over the page)
  useEffect(() => {
    if (!st) { lastInbox.current = -1; return }
    const n = inboxCount(st)
    if (lastInbox.current >= 0 && n > lastInbox.current) toast(t('inbox.new', { n }))
    lastInbox.current = n
  }, [st])
  const celIds = (badgeOf(st?.exploreView)?.celebrate ?? []).map(c => c.id).join(',')
  const heard = useRef(new Set<string>())
  useEffect(() => {
    if (!celIds || match) return
    const fresh = celIds.split(',').filter(c => !heard.current.has(id + ':' + c))
    if (fresh.length) { sfx('trophy'); fresh.forEach(c => heard.current.add(id + ':' + c)) }
  }, [celIds, match, id])
  const lvl = st ? (eventsOf(st)?.level ?? 0) : 0
  const lastLvl = useRef({ id: 0, lvl: 0 })
  useEffect(() => {
    if (!lvl || !id) return
    if (lastLvl.current.id === id && lvl > lastLvl.current.lvl) sfx('levelup')
    lastLvl.current = { id, lvl }
  }, [lvl, id])
  // (not while a play screen is open: a reload on #play/… would otherwise be thrown back to the hub once the career loads)
  useEffect(() => { if (st && !parsePlayRoute()) location.hash = tab }, [tab, st])
  // a page opens at its top: the window would otherwise keep the previous page's scroll (the match centre opened mid-page)
  useEffect(() => { const m = document.querySelector('.shell > main'); if (m && m.getBoundingClientRect().top < 0) m.scrollIntoView() }, [tab])
  useEffect(() => {
    const onHash = () => {
      const h = location.hash.slice(1)
      if ((TABS as readonly string[]).includes(h)) setTab(h as Tab)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  useEffect(() => {
    if (!st) return
    const accent = accentOf(st.club.color, st.club.color2)
    document.documentElement.style.setProperty('--club', accent)
    document.documentElement.style.setProperty('--club-ink', textOn(accent))
    document.title = `${st.club.name} · Pitchside`
  }, [st])

  function openCareer(cid: number | null) {
    if (cid) sessionStorage.setItem(CAREER_KEY, String(cid))
    else sessionStorage.removeItem(CAREER_KEY)
    setSt(null)
    setId(cid)
    setTab('overview')
  }

  async function logout() {
    try { await api.logout() } catch { /* ignore */ }
    openCareer(null)
    setUser(null)
  }

  const playView = usePlayView(user, id); if (playView) return playView // modes stream: #play/… hub, /join Wi-Fi guest (pages/play/PlayRoot.tsx)
  if (user === undefined) return <div className="center"><Loading /></div>
  // a fresh login starts from the saves list: the remembered career may belong to another account
  if (!user) return <><Auth onLogin={u => { openCareer(null); setUser(u) }} /><HelpHost /></>
  if (!id) return <><Saves user={user} onOpen={openCareer} onLogout={logout} /><HelpHost /></>
  if (!st) {
    return (
      <div className="center">
        <div className="card">
          {loadErr ? (
            <>
              <h2>{t('loadFailed')}</h2>
              <p className="muted">{loadErr}</p>
              <div className="row">
                <button className="primary" onClick={reload}><Icon name="rotate" size={16} /> {t('retry')}</button>
                <button onClick={() => openCareer(null)}><Icon name="saves" size={16} /> {t('backToSaves')}</button>
              </div>
            </>
          ) : <Loading />}
        </div>
      </div>
    )
  }

  const ctx: Ctx = { id, st, reload, toast, go: setTab, play: (mode = 'play') => setMatch(mode), run }
  const inboxN = inboxCount(st)
  const group = GROUPS.find(g => g.tabs.includes(tab)) ?? GROUPS[0]
  lastTab.current[group.key] = tab
  const { club, career } = st
  const offseason = st.today?.comp === 'offseason'

  return (
    <div className="shell">
      <aside className="rail">
        <div className="crest">
          <Badge short={club.short} color={club.color} color2={club.color2} size={60} />
          <div><b>{club.name}</b><small>{st.leagueName}</small></div>
        </div>
        <div className="seasonbox">
          <span className="eyebrow"><Icon name="calendar" size={13} /> {t('seasonN', { n: career.season })}</span>
          <b>{offseason ? t('offseason') : t('dayOf', { d: career.day, n: st.seasonDays })}</b>
          <div className="seasonbar"><i style={{ width: `${Math.min(100, ((career.day - 1) / st.seasonDays) * 100)}%` }} /></div>
        </div>
        <div className="meta">
          <span>{t('budget')}</span>
          <div className={'money num' + (club.budget < 0 ? ' neg' : '')}><Icon name="coins" size={20} /><CountUp v={club.budget} fmt={fmtMoney} /></div>
          <span><Icon name="wages" size={13} /> {t('wagesPerWeek', { v: money(st.weeklyWages) })}</span>
        </div>
        <nav className="tabs">
          {GROUPS.map(g => {
            const badge = g.key === 'inbox' ? inboxN : g.key === 'club' ? st.claimable : g.key === 'explore' ? exploreCount(st) : g.key === 'team' ? staffWaiting(st) + medWaiting(st) : 0
            const live = g.key === 'play' && st.today?.fixture && !st.today.fixture.played
            return (
              <button key={g.key} data-grp={g.key} aria-current={g.tabs.includes(tab)} onClick={() => setTab(lastTab.current[g.key] ?? g.tabs[0])}>
                <Icon name={g.icon} size={20} className="ti" /><span className="tl">{t('grp.' + g.key)}</span>
                {badge > 0 && <span className="dot">{badge}</span>}
                {live && <span className="dot live" />}
              </button>
            )
          })}
        </nav>
        <footer>
          <div className="railacct">
            <span className="who"><Icon name="user" size={14} /> {user.username}</span>
            <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
              <button className="gearbtn helpbtn" onClick={openHowTo} aria-label={t('ht.title')} data-tip={t('ht.title')}><Icon name="help" size={18} /></button>
              <SettingsButton label account={{ username: user.username, onSaves: () => openCareer(null), onLogout: logout }} />
            </span>
          </div>
        </footer>
      </aside>
      <main>
        {career.ended && (
          <div className="notice over row spread">
            <span><Icon name="lock" size={16} /> <b>{t('over.title')}</b> · {t('over.' + career.ended, { n: st.squad.length, s: career.season })} {t('over.readonly')}</span>
            <button className="small" onClick={() => openCareer(null)}>{t('over.saves')}</button>
          </div>
        )}
        <Hud ctx={ctx} />
        {group.tabs.length > 1 && (
          <nav className="subtabs" aria-label={t('grp.' + group.key)}>
            {group.tabs.map(k => (
              <button key={k} aria-current={tab === k} onClick={() => setTab(k)}>
                <Icon name={TAB_ICON[k]} size={18} /> {t('tab.' + k)}
                {k === 'finance' && st.claimable > 0 && <span className="dot">{st.claimable}</span>}
                {k === 'medical' && medWaiting(st) > 0 && <span className="dot">{medWaiting(st)}</span>}
                {k === 'staff' && staffWaiting(st) > 0 && <span className="dot">{staffWaiting(st)}</span>}
              </button>
            ))}
          </nav>
        )}
        <div className="page" key={tab}>
        {tab === 'overview' && <Overview ctx={ctx} />}
        {tab === 'inbox' && <Inbox ctx={ctx} />}
        {tab === 'explore' && <Explore ctx={ctx} />}
        {tab === 'match' && <MatchCentre ctx={ctx} />}
        {tab === 'tactics' && <Tactics ctx={ctx} />}
        {tab === 'squad' && <Squad ctx={ctx} />}
        {tab === 'market' && <Market ctx={ctx} />}
        {tab === 'staff' && <Staff ctx={ctx} />}
        {tab === 'medical' && <MedicalRoom ctx={ctx} />}
        {tab === 'competitions' && <Competitions ctx={ctx} />}
        {tab === 'stats' && <Stats ctx={ctx} />}
        {tab === 'finance' && <Finance ctx={ctx} />}
        {tab === 'history' && <History ctx={ctx} />}
        {tab === 'kits' && <KitRoom ctx={ctx} />}
        </div>
      </main>
      {match && <MatchPage ctx={ctx} initialMode={match} onClose={() => { setMatch(false); setTab('match'); reload() }} />}
      {!match && <Celebration ctx={ctx} />}
      {!match && <StageHost ctx={ctx} />}{/* stage stream: Golden Ball night, summer tournament, cup draws */}
      {career.ended && !seenOver && (
        <div className="modal" role="dialog" aria-modal="true" onClick={() => setSeenOver(true)}>
          <div className="card overcard" onClick={e => e.stopPropagation()} style={{ width: 'min(480px, 100%)' }}>
            <span className="eyebrow"><Icon name="lock" size={13} /> {t('seasonN', { n: career.season })}</span>
            <h2>{t('over.title')}</h2>
            <p>{t('over.' + career.ended, { n: st.squad.length, s: career.season })}</p>
            <p className="muted">{t('over.hint')}</p>
            <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setSeenOver(true)}><Icon name="eye" size={16} /> {t('over.look')}</button>
              <button className="primary" onClick={() => openCareer(null)}><Icon name="saves" size={16} /> {t('over.saves')}</button>
            </div>
          </div>
        </div>
      )}
      {msg && <div className={'toast' + (msg.err ? ' err' : '')} role="status"><Icon name={msg.err ? 'warn' : 'check'} size={18} /><span>{msg.text}</span></div>}
      {busy && <BusyOverlay message={busy} />}
      <Tour ready={!match && !career.ended} />
      <RevealHost />
      <HelpHost />
      <TooltipLayer />
    </div>
  )
}


/** The game HUD: league standing, chemistry, points, squad and the next fixture with a play button. */
function Hud({ ctx }: { ctx: Ctx }) {
  const { t } = useI18n()
  const { st } = ctx
  const pos = st.table.findIndex(r => r.isUser) + 1
  const row = st.table[pos - 1]
  const fx = st.today?.fixture
  const live = fx && !fx.played && !st.career.ended
  const ev = eventsOf(st)
  return (
    <div className="hud">
      <div className="hud-stats">
      <HudStat icon="rank" label={t('hud.pos')}>{pos > 0 ? `#${pos}` : '–'}</HudStat>
      <HudStat icon="points" label={t('pts')}><CountUp v={row?.pts ?? 0} /></HudStat>
      <HudStat icon="chemistry" label={t('chemistry')}><CountUp v={st.chemistry.team} /></HudStat>
      <HudStat icon="tp" label="TP" tip={t('tp.full')} tone="gold"><CountUp v={st.career.tp} /></HudStat>
      <HudStat icon="squad" label={t('hud.squad')}>{st.squad.length}<small>/50</small></HudStat>
      {ev && typeof ev.level === 'number' && (
        <div className="stat lvl" data-tip={`${t('ev.levelTitle', { n: ev.level })}\n${ev.nextXp ? t('ev.xpOf', { x: ev.xp - ev.levelXp, n: Math.max(1, ev.nextXp - ev.levelXp) }) : t('ev.xpMax')}`}>
          <Icon name="legend" size={18} className="hi" />
          <span><small>{t('hud.level')}</small><b className="gold"><CountUp v={ev.level} /></b>
            <i className="xpbar"><b style={{ width: `${ev.nextXp ? Math.min(100, ((ev.xp - ev.levelXp) / Math.max(1, ev.nextXp - ev.levelXp)) * 100) : 100}%` }} /></i></span>
        </div>
      )}
      <HudStat icon="budget" label={t('budget')} tone={st.club.budget < 0 ? 'bad' : 'gold'}><CountUp v={st.club.budget} fmt={fmtMoney} /></HudStat>
      </div>
      {live ? (
        <div className="next">
          <span className="vs" data-tip={`${fx.home} – ${fx.away}`}><Badge short={fx.homeShort} color={fx.homeColor} color2={fx.homeColor2} size={36} /><i>vs</i><Badge short={fx.awayShort} color={fx.awayColor} color2={fx.awayColor2} size={36} /></span>
          <button className="primary" data-tour="play" onClick={() => ctx.go('match')}><Icon name="playNow" size={16} /> {t('hud.play')}</button>
        </div>
      ) : (
        <div className="next"><button className="primary" data-tour="play" disabled={!!st.career.ended} onClick={() => ctx.go('match')}><Icon name="next" size={16} /> {t('hud.continue')}</button></div>
      )}
    </div>
  )
}

function HudStat({ icon, label, children, tone, tip }: { icon: IconName; label: string; children: React.ReactNode; tone?: 'gold' | 'bad'; tip?: string }) {
  return (
    <div className="stat" data-tip={tip}>
      <Icon name={icon} size={18} className="hi" />
      <span><small>{label}</small><b className={tone}>{children}</b></span>
    </div>
  )
}
