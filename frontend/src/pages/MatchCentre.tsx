import { useEffect, useState, type ReactNode } from 'react'
import type { Ctx } from '../App'
import { api, money, type SummerMove } from '../api'
import type { CompetitionsView, DayReport, FixtureView, MatchSetup, Player, SideSetup, AgeNote, TeamRating } from '../types'
import { Badge, ClubDot, ConfirmButton, Icon, Modal, PageHead, PosTag, ResultChip, Score, Title, resultOf, tierOf, useStageLabel, type IconName } from '../ui'
import { errText, useI18n } from '../i18n'
import { loadSnapshot, clearSnapshot, type Snapshot } from '../match/snapshot'
import { Report } from './MatchPage'
import { eventsOf, type EventsView, type Weather } from '../api_events'
import { ClubLog, ManagerLevel, PressAutoPanel, PressPanel } from './EventsInbox'
import { sfx } from '../sfx'
import { TourPicker } from './club/Tour'
import { PlayCard } from './play/PlayCard'
import { OppSheetButton } from './OppSheet'
import { LockTips, lockAlerts } from './LockXI'
import { keyPlayers } from '../formations'

export const WX_ICON: Record<Weather, IconName> = { clear: 'sun', rain: 'rain', snow: 'snow', heat: 'heat' }
const COMP_ICON: Record<string, IconName> = { league: 'league', cup: 'cup', cl: 'continental', friendly: 'sponsor' }

export default function MatchCentre({ ctx }: { ctx: Ctx }) {
  const { t } = useI18n()
  const stage = useStageLabel()
  const { st, id } = ctx
  const today = st.today
  const fx = today?.fixture ?? null
  const [setup, setSetup] = useState<MatchSetup | null>(null)
  const [comp, setComp] = useState<CompetitionsView | null>(null)
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<DayReport | null>(null)
  const [summer, setSummer] = useState<{ aged: AgeNote[]; retired: string[]; expired: string[]; regens: string[]; promoted: string[]; transfers: SummerMove[] } | null>(null)
  const snap = fx ? loadSnapshot(id, fx.id) : null
  const ev = eventsOf(st)
  const pre = !!fx && !fx.played

  // the odds come from the backend's own match model: ask again when the line-up, the tactics or the press answer change
  const setupKey = `${st.club.formation}|${JSON.stringify(st.club.tactic)}|${st.club.lineup.join(',')}|${ev?.today?.answer ?? ''}`
  useEffect(() => { setSetup(null) }, [id, fx?.id]) // a new fixture: no stale odds while the next ones load
  useEffect(() => {
    if (pre) api.match(id).then(setSetup).catch(() => {})
  }, [id, fx?.id, pre, st.career.day, st.career.season, setupKey])
  useEffect(() => {
    // before a match the full view also gives the opponent's recent results
    api.competitions(id, !pre).then(setComp).catch(() => {})
  }, [id, fx?.id, st.career.day, st.career.season])

  async function playDay(mode: string) {
    setBusy(true)
    try {
      if (fx) clearSnapshot(id)
      const msg = mode === 'forfeit' ? t('wait.forfeit') : fx ? t('wait.sim') : t('wait.simDay')
      const r = await ctx.run(msg, () => api.play(id, { mode }))
      // final whistle, and a little jingle for a win
      if (r.fixture) { sfx('whistle'); if (resultOf(r.fixture, st.club.id) === 'W') window.setTimeout(() => sfx('levelup'), 650) }
      setReport(r)
    } catch (e) {
      ctx.toast(errText(t, e), true)
    } finally {
      setBusy(false)
    }
  }

  async function friendly(oppId: number) {
    try {
      await ctx.run(t('wait.generic'), async () => { await api.friendly(id, oppId); await ctx.reload() })
    } catch (e) { ctx.toast(errText(t, e), true) }
  }

  async function newSeason() {
    setBusy(true)
    try {
      const r = await ctx.run(t('wait.newSeason'), async () => { const x = await api.newSeason(id); await ctx.reload(); return x })
      ctx.toast(r.retired?.length ? t('newSeasonRetired', { names: r.retired.join(', ') }) : t('newSeasonStarted'))
      if (r.aged?.length || r.retired?.length || r.expired?.length || r.regens?.length || r.promoted?.length || r.transfers?.length) setSummer({ aged: r.aged ?? [], retired: r.retired ?? [], expired: r.expired ?? [], regens: r.regens ?? [], promoted: r.promoted ?? [], transfers: (r.transfers ?? []).slice(0, 6) })
    } catch (e) { ctx.toast(errText(t, e), true) } finally { setBusy(false) }
  }

  const upcoming = (comp?.fixtures ?? []).filter(f => f.isUser && !f.played && f.day > st.career.day).slice(0, 5)
  const recent = (comp?.fixtures ?? []).filter(f => f.isUser && f.played).slice(-5).reverse()

  return (
    <>
      <PageHead icon="match" title={t('tab.match')}
        eyebrow={<>{t('seasonN', { n: st.career.season })} · {today?.comp === 'offseason' ? t('offseason') : t('dayOf', { d: st.career.day, n: st.seasonDays })}</>}>
        {today && today.comp !== 'offseason' && <span className="chip"><Icon name={COMP_ICON[today.comp] ?? 'calendar'} size={14} /> {stage(today.comp, today.stage, today.round)}</span>}
      </PageHead>

      {snap && pre && (
        <section className="panel resume">
          <div>
            <b>{t('resume.title')}</b>
            <p className="muted" style={{ margin: 0 }}>{t('resume.body', { min: snap.minute, a: snap.score[0], b: snap.score[1] })}</p>
          </div>
          <div className="row">
            <button className="primary" onClick={() => ctx.play(snap.mode === 'watch' ? 'watch' : undefined)}><Icon name="playNow" size={16} /> {t('resume.continue')}</button>
            <ConfirmButton className="danger" label={t('resume.forfeit')} confirm={t('resume.forfeitConfirm')} onConfirm={() => playDay('forfeit')} />
          </div>
        </section>
      )}

      {today?.comp === 'offseason' && !fx && (
        <section className="panel stack offpanel">
          <Title icon="calendar">{t('off.title', { n: st.career.season })}</Title>
          <p className="muted" style={{ margin: 0 }}>{t('off.body', { n: today.friendliesLeft })}</p>
          <div className="row">
            <button className="primary big" disabled={busy} onClick={newSeason}><Icon name="rocket" size={18} /> {t('off.start', { n: st.career.season + 1 })}</button>
          </div>
          <TourPicker ctx={ctx} />{/* club stream: the pre-season tour (optional) */}
          {today.friendliesLeft > 0 && comp && (
            <div className="grid g2">
              {comp.leagues.map(l => (
                <div key={l.code}>
                  <b>{l.name}</b>
                  <table className="compact"><tbody>
                    {l.table.filter(r => !r.isUser).map(r => (
                      <tr key={r.clubId}>
                        <td><span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><ClubDot color={r.color} />{r.name}</span></td>
                        <td className="r"><button className="small" onClick={() => friendly(r.clubId)}><Icon name="handCoins" size={13} /> {t('off.invite')}</button></td>
                      </tr>
                    ))}
                  </tbody></table>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {today && today.comp !== 'offseason' && !fx && (
        <section className="panel stack">
          <Title icon="calendar">{t('mc.noMatchTitle')}</Title>
          <p className="muted" style={{ margin: 0 }}>{t('mc.noMatchBody', { comp: stage(today.comp, today.stage, today.round) })}</p>
          <div className="row"><button className="primary big" disabled={busy} onClick={() => playDay('sim')}><Icon name="sim" size={18} /> {busy ? t('wait') : t('mc.simDay')}</button></div>
        </section>
      )}

      {fx && pre && (
        <>
          <VsScreen ctx={ctx} fx={fx} setup={setup} comp={comp} ev={ev} snap={snap} busy={busy} onSim={() => playDay('sim')} />
          {ev && <PressPanel ctx={ctx} ev={ev} />}
          {ev && <PressAutoPanel ctx={ctx} ev={ev} />}
          {setup && <PreMatchNotes setup={setup} ctx={ctx} />}
        </>
      )}

      <div className="grid g2" style={{ alignItems: 'start' }}>
        <section className="panel">
          <Title icon="calendar" className="mb8">{t('mc.upcoming')}</Title>
          <FixtureList fixtures={upcoming} clubId={st.club.id} ev={ev} />
          {comp && upcoming.length === 0 && <p className="muted" style={{ margin: 0 }}>{t('mc.noneUpcoming')}</p>}
        </section>
        <section className="panel">
          <Title icon="history" className="mb8">{t('mc.recent')}</Title>
          <FixtureList fixtures={recent} clubId={st.club.id} />
          {comp && recent.length === 0 && <p className="muted" style={{ margin: 0 }}>{t('noGamesYet')}</p>}
        </section>
      </div>

      {/* quick match, Wi-Fi two-player and the training ground (gold medals: +1 TP once per matchday) */}
      <PlayCard />

      {ev && !st.career.ended && <ClubLife ev={ev} day={st.career.day} season={st.career.season} />}

      {summer && (
        <Modal onClose={() => setSummer(null)} style={{ width: 'min(520px, 100%)', maxHeight: '85vh', overflow: 'auto' }} label={t('age.title')}>
          <span className="eyebrow">{t('seasonN', { n: st.career.season })}</span>
          <h2>{t('age.title')}</h2>
          <p className="muted" style={{ marginTop: 0 }}>{t('age.help')}</p>
          {summer.aged.length > 0 && (
            <table className="compact num"><tbody>
              {summer.aged.map(a => <tr key={a.name}><td>{a.name}</td><td className="muted">{t('age.years', { n: a.age })}</td><td className="r">{a.before} → <b style={{ color: 'var(--bad)' }}>{a.after}</b></td></tr>)}
            </tbody></table>
          )}
          {summer.retired.length > 0 && <p><b>{t('age.retired')}</b> {summer.retired.join(', ')}</p>}
          {summer.expired.length > 0 && <p><b>{t('ct.expired')}</b> {summer.expired.join(', ')}</p>}
          {summer.regens.length > 0 && <p><b>{t('regen.title')}</b> {summer.regens.join(', ')}</p>}
          {summer.promoted.length > 0 && <p><b>{t('ns.promoted')}</b> {summer.promoted.join(', ')}</p>}
          {summer.transfers.length > 0 && (
            <div className="stack" style={{ gap: 4 }}>
              <b>{t('ns.transfers')}</b>
              {summer.transfers.map((m, i) => <span key={i} className="muted">{m.player}{m.ovr ? ` (${m.ovr})` : ''}: {m.from} → <b>{m.to}</b> · {money(m.fee ?? 0)}</span>)}
            </div>
          )}
          <button className="primary" onClick={() => setSummer(null)}>{t('continue')}</button>
        </Modal>
      )}
      {report && (
        <div className="matchwrap"><div className="overlay">
          {/* the report lists the day's club happenings itself (✦ lines), so no second card here */}
          <Report r={report} clubId={st.club.id} onClose={() => { setReport(null); ctx.reload() }} />
        </div></div>
      )}
    </>
  )
}

export function FixtureList({ fixtures, clubId, ev }: { fixtures: FixtureView[]; clubId: number; ev?: EventsView | null }) {
  const stage = useStageLabel()
  const { t } = useI18n()
  return (
    <div className="fxl">
      {fixtures.map(f => {
        const wx = !f.played ? ev?.weather[String(f.id)] : undefined
        const r = f.played && (f.homeId === clubId || f.awayId === clubId) ? resultOf(f, clubId) : null
        return (
          <div key={f.id} className={'fxr' + (r ? ' r-' + r : '')}>
            <span className="fxr-meta">
              <span className="num" data-tip={`${f.season ? t('seasonN', { n: f.season }) + ' · ' : ''}${t('vs.matchday', { d: f.day })}`}>{f.season ? `${t('seasonShort')}${f.season} · ` : ''}{t('dayShort')}{f.day}</span>
              <span>{stage(f.comp, f.stage)}</span>
              {wx && <span className="wxicon" data-tip={t('wx.' + wx)}><Icon name={WX_ICON[wx]} size={14} /></span>}
              {ev?.derbies.includes(f.id) && <span className="derbytag" data-tip={t('derby')}><Icon name="derby" size={14} /></span>}
            </span>
            <span className="fxr-team h">{f.homeId === clubId ? <b>{f.home}</b> : <span>{f.home}</span>}<Badge short={f.homeShort} color={f.homeColor} color2={f.homeColor2} size={26} /></span>
            <span className="fxr-score"><Score f={f} /></span>
            <span className="fxr-team a"><Badge short={f.awayShort} color={f.awayColor} color2={f.awayColor2} size={26} />{f.awayId === clubId ? <b>{f.away}</b> : <span>{f.away}</span>}</span>
            <span className="fxr-res">{f.played && <ResultChip f={f} clubId={clubId} />}</span>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------- pre-match "VS" screen

/** The last five results of a club this season, oldest first. */
function formOf(fixtures: FixtureView[], clubId: number) {
  return fixtures.filter(f => f.played && (f.homeId === clubId || f.awayId === clubId)).sort((a, b) => a.day - b.day).slice(-5)
}

function luma(hex: string) {
  const n = parseInt((hex || '#000').replace('#', ''), 16)
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114
}
/** A club colour that still glows on the dark stage (near-black kits use their second colour). */
function glowOf(c1: string, c2?: string) {
  if (luma(c1) >= 45) return c1
  if (c2 && luma(c2) >= 45) return c2
  return '#9aa7b4'
}

function VsScreen({ ctx, fx, setup, comp, ev, snap, busy, onSim }: {
  ctx: Ctx; fx: FixtureView; setup: MatchSetup | null; comp: CompetitionsView | null; ev: EventsView | null; snap: Snapshot | null; busy: boolean; onSim: () => void
}) {
  const { t } = useI18n()
  const stage = useStageLabel()
  const { st } = ctx
  const wx = setup?.weather ?? ev?.today?.weather
  const derby = setup?.derby ?? ev?.today?.derby
  const fixtures = comp?.fixtures ?? []
  const H = setup?.home, A = setup?.away
  // the quick simulation's own odds (backend MatchOdds): the same model that plays the match when you simulate it
  const odds = setup?.odds ? [setup.odds.home, setup.odds.draw, setup.odds.away] : null
  const oddsTip = setup?.odds ? `${t('vs.chanceTip')}\n${t('vs.xg', { h: setup.odds.homeXg.toFixed(1), a: setup.odds.awayXg.toFixed(1) })}` : t('vs.chanceTip')
  const round = fx.comp === 'league' ? st.today?.round : undefined
  const sides = [
    { key: 'home', id: fx.homeId, name: fx.home, short: fx.homeShort, color: fx.homeColor, color2: fx.homeColor2, s: H },
    { key: 'away', id: fx.awayId, name: fx.away, short: fx.awayShort, color: fx.awayColor, color2: fx.awayColor2, s: A },
  ] as const
  return (
    <section className="vsx" aria-label={`${fx.home} – ${fx.away}`}
      style={{ ['--hc' as string]: glowOf(fx.homeColor, fx.homeColor2), ['--ac' as string]: glowOf(fx.awayColor, fx.awayColor2) } as React.CSSProperties}>
      <div className="vsx-bg" aria-hidden="true"><i className="h" /><i className="a" /><i className="rays" /></div>
      <div className="vsx-top">
        <span className="vsx-comp"><Icon name={COMP_ICON[fx.comp] ?? 'calendar'} size={16} /> {stage(fx.comp, fx.stage === 'GA' || fx.stage === 'GB' ? 'G' : fx.stage, round)}</span>
        <div className="vsx-flags">
          <span className="vsx-flag"><Icon name="calendar" size={15} /> {t('vs.matchday', { d: fx.day })}</span>
          {wx && <span className={'vsx-flag wx ' + wx} data-tip={`${t('wx.' + wx)}\n${t('wx.' + wx + '.d')}`} tabIndex={0}><Icon name={WX_ICON[wx]} size={16} /> {t('wx.' + wx)}</span>}
          {derby && <span className="vsx-flag derby" data-tip={`${t('derby')}\n${t('derby.tip')}`} tabIndex={0}><Icon name="derby" size={16} /> {t('derby')}</span>}
          {setup?.knockout && <span className="vsx-flag ko" data-tip={t('mc.knockout')} tabIndex={0}><Icon name="cup" size={16} /> {t('vs.knockout')}</span>}
        </div>
      </div>

      <div className="vsx-main">
        {sides.map((sd, i) => {
          const mine = sd.id === st.club.id
          const form = formOf(fixtures, sd.id)
          return (
            <div key={sd.key} className={'vsx-side ' + sd.key + (mine ? ' me' : '')}>
              <div className="vsx-crest"><Badge short={sd.short} color={sd.color} color2={sd.color2} size={128} />{mine && <em className="vsx-you"><Icon name="user" size={12} /> {t('vs.you')}</em>}</div>
              <b className="vsx-name">{sd.name}</b>
              <span className="vsx-tag">{i === 0 ? t('home') : t('away')}</span>
              <span className="vsx-form" aria-label={t('vs.form')} data-tip={t('vs.form')}>
                {comp ? Array.from({ length: 5 }, (_, k) => {
                  const f = form[k - (5 - form.length)]
                  const r = f ? resultOf(f, sd.id) : null
                  return r && f ? <span key={k} className={'res ' + r} data-tip={`${t('tbl.' + r.toLowerCase() + '.full')}\n${f.home} ${f.homeGoals}-${f.awayGoals} ${f.away}`}>{t('res.' + r)}</span> : <span key={k} className="res none">·</span>
                }) : null}
              </span>
            </div>
          )
        })}
        <div className="vsx-mid" aria-hidden="true"><span className="vsx-vs">VS</span></div>
      </div>

      {odds && (
        <div className="vsx-odds" data-tip={oddsTip} tabIndex={0}>
          <span className="eyebrow"><Icon name="rating" size={13} /> {t('vs.chance')}</span>
          <div className="vsx-oddsbar">
            <i className="h" style={{ flexGrow: Math.max(odds[0], 1) }}>{odds[0] >= 12 && <b className="num">{odds[0]}%</b>}</i>
            <i className="d" style={{ flexGrow: Math.max(odds[1], 1) }}>{odds[1] >= 12 && <b className="num">{odds[1]}%</b>}</i>
            <i className="a" style={{ flexGrow: Math.max(odds[2], 1) }}>{odds[2] >= 12 && <b className="num">{odds[2]}%</b>}</i>
          </div>
          <div className="vsx-oddslbl">
            <span>{t('vs.win', { c: fx.home })} <b className="num">{odds[0]}%</b></span>
            <span>{t('vs.draw')} <b className="num">{odds[1]}%</b></span>
            <span>{t('vs.win', { c: fx.away })} <b className="num">{odds[2]}%</b></span>
          </div>
        </div>
      )}

      {setup && H && A && (
        <div className="vsx-body">
          {/* under the opponent's key players: their whole team sheet (formation, XI on a pitch, bench, injuries) */}
          <KeyPlayers players={H.starters} roles={H.roles} side="home">{!setup.userIsHome && <OppSheetButton setup={setup} />}</KeyPlayers>
          <StrengthBars H={H} A={A} />
          <KeyPlayers players={A.starters} roles={A.roles} side="away">{setup.userIsHome && <OppSheetButton setup={setup} />}</KeyPlayers>
        </div>
      )}

      {st.hotBonus && <p className="hotbonus vsx-hot"><Icon name="flame" size={16} /> {t('hot.offer', { brand: st.hotBonus.brand, what: t('hot.' + st.hotBonus.kind), v: money(st.hotBonus.amount) })}</p>}

      <div className="vsx-actions">
        <button className="primary vsx-go" data-sfx="whistle" onClick={() => ctx.play(snap?.mode === 'watch' ? 'watch' : undefined)}>
          <Icon name="playNow" size={24} /><span><b>{snap ? t('resume.continue') : t('mc.playLive')}</b><small>{snap ? t('vs.resumeHint', { min: snap.minute }) : t('vs.playHint')}</small></span>
        </button>
        {!snap && (
          <button className="vsx-alt" data-sfx="whistle" onClick={() => ctx.play('watch')}>
            <Icon name="watch" size={22} /><span><b>{t('vs.watch')}</b><small>{t('vs.watchHint')}</small></span>
          </button>
        )}
        {!snap && (
          <button className="vsx-alt" disabled={busy} onClick={onSim}>
            <Icon name="sim" size={22} /><span><b>{busy ? t('wait') : t('mc.quickSim')}</b><small>{t('vs.simHint')}</small></span>
          </button>
        )}
      </div>
      <div className="vsx-foot"><button className="link" onClick={() => ctx.go('tactics')}><Icon name="tactics" size={15} /> {t('mc.editLineup')}</button></div>
    </section>
  )
}

function KeyPlayers({ players, roles, side, children }: { players: Player[]; roles: string[]; side: 'home' | 'away'; children?: ReactNode }) {
  const { t } = useI18n()
  const top = keyPlayers(players, roles)
  return (
    <div className={'vsx-keys ' + side}>
      <span className="eyebrow"><Icon name="star" size={13} /> {t('vs.key')}</span>
      {top.map(p => (
        <div key={p.id} className={'vsx-pc t-' + tierOf(p.overall)}>
          <span className="vsx-pc-ovr num" data-tip={`${t('lbl.ovr')}: ${Math.round(p.overall)}`}>{Math.round(p.overall)}</span>
          <span className="vsx-pc-id"><b>{p.name}</b><small><PosTag p={p.position} role={p.role} /> {t('nation.' + p.nation)}</small></span>
        </div>
      ))}
      {children}
    </div>
  )
}

function StrengthBars({ H, A }: { H: SideSetup; A: SideSetup }) {
  const { t } = useI18n()
  const rate = (v: number) => Math.max(5, Math.min(100, ((v - 45) / 45) * 100))
  const pct = (v: number) => Math.max(3, Math.min(100, v))
  const rows: [string, string, number, number, (v: number) => number][] = [
    ...(['attack', 'midfield', 'defense', 'overall'] as (keyof TeamRating)[]).map(k => [k, t('rating.' + k), Math.round(H.rating[k]), Math.round(A.rating[k]), rate] as [string, string, number, number, (v: number) => number]),
    ['chem', t('chemistry'), H.chemistry.team, A.chemistry.team, pct],
    ['fit', t('fit.short'), H.coachFit?.score ?? 0, A.coachFit?.score ?? 0, pct],
  ]
  return (
    <div className="vsx-bars">
      <span className="eyebrow"><Icon name="strength" size={13} /> {t('mc.compare')}</span>
      {rows.map(([k, label, hv, av, f], i) => (
        <div key={k} className="vsx-bar" style={{ ['--d' as string]: `${0.05 + i * 0.03}s` } as React.CSSProperties}>
          <b className={'num' + (hv > av ? ' up' : '')}>{hv}</b>
          <i className="l"><em style={{ width: f(hv) + '%' }} /></i>
          <span data-tip={k === 'fit' ? t('fit.title') : undefined}>{label}</span>
          <i className="r"><em style={{ width: f(av) + '%' }} /></i>
          <b className={'num' + (av > hv ? ' up' : '')}>{av}</b>
        </div>
      ))}
    </div>
  )
}

/** What to look out for before kick-off: our weak spots and how the opponent plays. */
function PreMatchNotes({ setup, ctx }: { setup: MatchSetup; ctx: Ctx }) {
  const { t } = useI18n()
  const me = setup.userIsHome ? setup.home : setup.away
  const them = setup.userIsHome ? setup.away : setup.home
  const weak = me.starters.map((p, i) => ({ p, role: me.roles[i], c: me.chemistry.slots[i] })).filter(x => x.p && x.c && x.c.chem < 5)
  // a locked starter the assistant has advice on gets that line (with its answers) instead of the plain warning
  const advised = new Set(lockAlerts(ctx.st.alerts).map(a => a.id))
  const tiredMine = me.starters.filter(p => p && p.fitness < 70 && !advised.has(p.id))
  const rushedMine = me.starters.filter(p => p?.rushed && !advised.has(p.id))
  const benchFresh = me.bench.filter(p => p.fitness >= 70).length
  const verdict = me.rating.overall - them.rating.overall
  return (
    <section className="panel stack prenotes">
      <Title icon="board">{t('vs.notes')}</Title>
      <div className="grid g2" style={{ gap: 14 }}>
        <div className="stack" style={{ gap: 8 }}>
          <b>{t('mc.ourIssues')}</b>
          <ul className="notes">
            {weak.map(x => <li key={x.p.id} className="warn">{t('mc.weakChem', { role: x.role, name: x.p.name, c: x.c.chem.toFixed(1) })}</li>)}
            {me.congested && <li className="warn">{t('mc.congested')}</li>}
            {tiredMine.map(p => <li key={'t' + p.id} className={p.fitness < 55 ? 'bad' : 'warn'}>{t(p.fitness < 55 ? 'mc.tiredRisk' : 'mc.tired', { name: p.name, f: Math.round(p.fitness) })}</li>)}
            {rushedMine.map(p => <li key={'r' + p.id} className="bad">{t('mc.rushed', { name: p.name })}</li>)}
            {(me.rotated ?? []).map(x => <li key={'o' + x.out} className="good">{t(x.why === 'dev' ? 'mc.devLine' : 'mc.rotatedLine', { out: x.out, of: x.outFit, in: x.in, if: x.inFit })}</li>)}
            {weak.length === 0 && tiredMine.length === 0 && rushedMine.length === 0 && advised.size === 0 && !me.congested && <li className="good">{t('mc.noIssues')}</li>}
          </ul>
          <LockTips ctx={ctx} />
          {(tiredMine.length > 0 || me.congested) && <span className="muted" style={{ fontSize: 13 }}>{t('mc.fitTip', { n: benchFresh })}</span>}
        </div>
        <div className="stack" style={{ gap: 8 }}>
          <p className="verdict" data-v={verdict > 2 ? 'fav' : verdict < -2 ? 'dog' : 'even'}>
            {verdict > 2 ? t('mc.fav') : verdict < -2 ? t('mc.dog') : t('mc.even')}
          </p>
          {them.coachFit?.style && <span className="muted" style={{ fontSize: 13 }}>{t('mc.theirCoach', { name: them.coachFit.coach, style: t('style.' + them.coachFit.style) })}</span>}
          <span className="muted" style={{ fontSize: 13 }}>
            {t('mc.theyPlay', { f: them.club.formation, m: t('tac.mentality.' + them.club.tactic.mentality), p: t('tac.pressing.' + them.club.tactic.pressing), s: t('tac.passing.' + them.club.tactic.passing) })}
          </span>
        </div>
      </div>
    </section>
  )
}

/** Rival, manager level, what's coming up and the latest club news. */
function ClubLife({ ev, day, season }: { ev: EventsView; day: number; season: number }) {
  const { t } = useI18n()
  const upcoming: string[] = []
  if (ev.nextBreak && day <= 54) upcoming.push(t('ev.nextBreak', { d: ev.nextBreak }))
  if (day <= ev.youthDay) upcoming.push(t('ev.nextYouth', { d: ev.youthDay }))
  return (
    <div className="grid g2 clublife" style={{ alignItems: 'start' }}>
      <div className="stack" style={{ gap: 12 }}>
        <ManagerLevel ev={ev} />
        <section className="panel stack">
          {ev.rival && (
            <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
              <Badge short={ev.rival.short} color={ev.rival.color} color2={ev.rival.color2} size={44} />
              <span><b><Icon name="derby" size={14} /> {t('rival.title')}:</b> {ev.rival.name} <span className="muted" style={{ fontSize: 12 }}>{ev.rival.city ? t('rival.city') : t('rival.rep')}</span></span>
            </div>
          )}
          <span className="muted" style={{ fontSize: 13 }}>{t('rival.help')}</span>
          {upcoming.length > 0 && <span className="muted" style={{ fontSize: 13 }}>{upcoming.join(' · ')}</span>}
          {ev.captainName ? <span className="row" style={{ gap: 6 }}><Icon name="crown" size={15} className="gold" /> {t('cap.is', { name: ev.captainName })}</span> : <span className="muted" style={{ fontSize: 13 }}>{t('cap.none')}</span>}
        </section>
      </div>
      <ClubLog ev={ev} limit={8} season={season} />
    </div>
  )
}
