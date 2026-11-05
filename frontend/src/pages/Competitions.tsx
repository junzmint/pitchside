import { useEffect, useMemo, useState } from 'react'
import type { Ctx } from '../App'
import { api } from '../api'
import type { Club, CompetitionsView, FixtureView, Player, TableRow, TeamRating } from '../types'
import { ClubDot, Ovr, PosTag, Score, ScoreNote, Loading, Hint, Abbr, Icon, PageHead, Title, KoRoad, koPath, CUP_STAGES as CUP, CL_KO_STAGES, Empty, Badge, Modal } from '../ui'
import { errText, useI18n } from '../i18n'

type View = 'league' | 'cup' | 'cl'
const CUP_STAGES = CUP
const CL_KO = CL_KO_STAGES
// the home hub can open a given competition
function initialView(): View {
  try {
    const v = sessionStorage.getItem('pitchside.compView')
    if (v === 'league' || v === 'cup' || v === 'cl') return v
  } catch { /* ignore */ }
  return 'league'
}

export default function Competitions({ ctx }: { ctx: Ctx }) {
  const { t } = useI18n()
  const [v, setV] = useState<CompetitionsView | null>(null)
  const [view, setView] = useState<View>(initialView)
  useEffect(() => { try { sessionStorage.removeItem('pitchside.compView') } catch { /* ignore */ } }, [])
  const [table, setTable] = useState<string>('')
  const [club, setClub] = useState<{ club: Club; players: Player[]; rating: TeamRating; coach: string } | null>(null)

  useEffect(() => {
    api.competitions(ctx.id).then(x => { setV(x); setTable(tb => tb || `${x.league}-${x.division}`) }).catch(e => ctx.toast(errText(t, e), true))
  }, [ctx.id, ctx.st.career.day, ctx.st.career.season])
  async function open(id: number) {
    try { setClub(await api.club(ctx.id, id)) } catch (e) { ctx.toast(errText(t, e), true) }
  }
  if (!v) return <Loading />
  const ownKey = `${v.league}-${v.division}`
  const lt = v.leagues.find(l => l.code === table) ?? v.leagues.find(l => l.code === ownKey)!
  const lt0 = v.leagues.find(l => l.code === ownKey)
  const cupPath = koPath(CUP_STAGES, v.fixtures.filter(f => f.comp === 'cup'), ctx.st.club.id)
  const clPath = koPath(CL_KO, v.fixtures.filter(f => f.comp === 'cl' && !f.stage.startsWith('G')), ctx.st.club.id)

  return (
    <>
      <PageHead icon="competitions" eyebrow={t('seasonN', { n: v.season })} title={t('tab.competitions')} />
      <div className="comptabs bigtabs" role="tablist">
        {(['league', 'cup', 'cl'] as View[]).map(k => (
          <button key={k} role="tab" aria-selected={view === k} aria-pressed={view === k} className={'c-' + k} onClick={() => setView(k)}>
            <Icon name={k === 'league' ? 'league' : k === 'cup' ? 'cup' : 'continental'} size={24} strokeWidth={1.8} />
            <span><b>{t('comp.' + k)}</b><small>{k === 'league' ? lt0?.name : k === 'cup' ? t('cp.cupTitle', { league: t('country.' + v.league) }) : v.userInCl ? t('cp.clInShort') : t('hub.notQualified')}</small></span>
          </button>
        ))}
      </div>

      {view === 'league' && (
        <div className="grid g2" style={{ alignItems: 'start' }}>
          <section className="panel stack">
            <div className="row spread">
              <Title icon="league">{lt.name}</Title>
              <select value={lt.code} onChange={e => setTable(e.target.value)} aria-label={t('cp.pickLeague')}>
                {['EN', 'ES', 'IT', 'DE'].map(c => (
                  <optgroup key={c} label={t('country.' + c)}>
                    {v.leagues.filter(l => l.country === c).map(l => <option key={l.code} value={l.code}>{t('divN', { n: l.division })} · {l.name}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <LeagueTable rows={lt.table} division={lt.division} promote={v.promote} clSpots={v.clSpots} onOpen={open} />
            <div className="row legendrow">
              {lt.division === 1 && <span><i className="zone cl" />{t('cp.zoneCl', { n: v.clSpots })}</span>}
              {lt.division > 1 && <span><i className="zone up" />{t('cp.zoneUp', { n: v.promote })}</span>}
              {lt.division < 3 && <span><i className="zone down" />{t('cp.zoneDown', { n: v.promote })}</span>}
            </div>
          </section>
          <section className="panel">
            <Title icon="calendar" className="mb8">{t('cp.ourFixtures')}</Title>
            <Rounds fixtures={v.fixtures.filter(f => f.comp === 'league')} current={v.calendar[v.day - 1]?.round ?? 1} />
          </section>
        </div>
      )}

      {view === 'cup' && (
        <section className="panel stack">
          <Title icon="cup">{t('cp.cupTitle', { league: t('country.' + v.league) })}</Title>
          <Hint text={t('cp.cupHelp')} />
          <span className="eyebrow">{t('cp.yourPath')}</span>
          <KoRoad path={cupPath} clubId={ctx.st.club.id} />
          <KnockoutRounds stages={CUP_STAGES} fixtures={v.fixtures.filter(f => f.comp === 'cup')} />
        </section>
      )}

      {view === 'cl' && (
        <>
          <section className="panel stack">
            <Title icon="continental">{t('comp.cl')}</Title>
            <p className={'compstatus ' + (v.userInCl ? 'next' : 'muted')} style={{ margin: 0 }}><Icon name={v.userInCl ? 'check' : 'lock'} size={16} /> {v.userInCl ? t('cp.clIn') : t('cp.clOut', { n: v.clSpots })}</p>
            <div className="grid g4">
              {Object.keys(v.groups).sort().map(g => (
                <div key={g} className={'groupbox' + ((v.groups[g] ?? []).some(r => r.isUser) ? ' mine' : '')}>
                  <b>{t('stage.' + g)}</b>
                  <MiniTable rows={v.groups[g] ?? []} onOpen={open} />
                </div>
              ))}
            </div>
          </section>
          <section className="panel stack">
            <Title icon="cup">{t('cp.knockout')}</Title>
            {v.userInCl && <><span className="eyebrow">{t('cp.yourPath')}</span><KoRoad path={clPath} clubId={ctx.st.club.id} /></>}
            <KnockoutRounds stages={CL_KO} fixtures={v.fixtures.filter(f => f.comp === 'cl' && !f.stage.startsWith('G'))} />
          </section>
        </>
      )}

      {club && (
        <Modal onClose={() => setClub(null)} label={club.club.name} style={{ width: 'min(620px, 100%)', maxHeight: '85vh', overflow: 'auto' }}>
            <div className="row spread" style={{ flexWrap: 'nowrap' }}>
              <div className="row clubpop-head" style={{ gap: 14, flexWrap: 'nowrap', minWidth: 0 }}><Badge short={club.club.short} color={club.club.color} color2={club.club.color2} size={88} /><h2>{club.club.name}</h2></div>
              <button onClick={() => setClub(null)} aria-label={t('close')}><Icon name="close" size={18} /></button>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <span className="chip"><Icon name="tactics" size={13} /> {club.club.formation}</span>
              <span className="chip"><Icon name="head" size={13} /> {club.coach}</span>
              <span className="chip num" data-tip={t('rating.attack')}><Icon name="attack" size={13} /> {Math.round(club.rating.attack)}</span>
              <span className="chip num" data-tip={t('rating.midfield')}><Icon name="midfield" size={13} /> {Math.round(club.rating.midfield)}</span>
              <span className="chip num" data-tip={t('rating.defense')}><Icon name="defense" size={13} /> {Math.round(club.rating.defense)}</span>
            </div>
            <table className="compact"><tbody>
              {[...club.players].sort((a, b) => b.overall - a.overall).map(p => (
                <tr key={p.id}>
                  <td>{p.name}{club.club.lineup.includes(p.id) && <span className="muted"> · {t('starter')}</span>}{p.injury > 0 && <span className="inj"> <Icon name="injury" size={12} /></span>}</td>
                  <td><PosTag p={p.position} role={p.role} /></td><td className="num r">{p.age}</td><td className="r"><Ovr v={p.overall} /></td>
                </tr>
              ))}
            </tbody></table>
        </Modal>
      )}
    </>
  )
}

function zoneOf(i: number, n: number, division: number, promote: number, clSpots: number) {
  if (division === 1 && i < clSpots) return 'cl'
  if (division > 1 && i < promote) return 'up'
  if (division < 3 && i >= n - promote) return 'down'
  return ''
}

function LeagueTable({ rows, division, promote, clSpots, onOpen }: { rows: TableRow[]; division: number; promote: number; clSpots: number; onOpen: (id: number) => void }) {
  const { t } = useI18n()
  return (
    <div className="scroll tall">
      <table className="num compact">
        <thead><tr><th>#</th><th>{t('club')}</th><th className="r"><Abbr k="tbl.p" /></th><th className="r"><Abbr k="tbl.w" /></th><th className="r"><Abbr k="tbl.d" /></th><th className="r"><Abbr k="tbl.l" /></th><th className="r"><Abbr k="tbl.gd" /></th><th className="r"><Abbr k="pts" /></th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.clubId} className={(r.isUser ? 'me ' : '') + 'click z-' + zoneOf(i, rows.length, division, promote, clSpots)} onClick={() => onOpen(r.clubId)}
              tabIndex={-1} onKeyDown={e => e.key === 'Enter' && onOpen(r.clubId)}>
              <td><span className="rk">{i + 1}</span></td>
              <td><span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><ClubDot color={r.color} />{r.isUser ? <b>{r.name}</b> : r.name}</span></td>
              <td className="r">{r.p}</td><td className="r">{r.w}</td><td className="r">{r.d}</td><td className="r">{r.l}</td>
              <td className={'r ' + (r.gf - r.ga > 0 ? 'gd-pos' : r.gf - r.ga < 0 ? 'gd-neg' : '')}>{r.gf - r.ga > 0 ? '+' : ''}{r.gf - r.ga}</td>
              <td className="r ptscell"><b>{r.pts}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function MiniTable({ rows, onOpen }: { rows: TableRow[]; onOpen: (id: number) => void }) {
  const { t } = useI18n()
  return (
    <table className="num compact">
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.clubId} className={(r.isUser ? 'me ' : '') + 'click' + (i < 2 ? ' z-up' : '')} onClick={() => onOpen(r.clubId)}>
            <td><span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><ClubDot color={r.color} />{r.name}</span></td>
            <td className="r muted">{r.p}</td>
            <td className="r"><b>{r.pts}</b></td>
          </tr>
        ))}
        {rows.length === 0 && <tr><td className="muted">{t('tbd')}</td></tr>}
      </tbody>
    </table>
  )
}

function Rounds({ fixtures, current }: { fixtures: FixtureView[]; current: number }) {
  const { t } = useI18n()
  const days = useMemo(() => [...new Set(fixtures.map(f => f.day))].sort((a, b) => a - b), [fixtures])
  const [round, setRound] = useState(Math.max(1, Math.min(days.length, current)))
  const day = days[round - 1]
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row">
        <button className="small" disabled={round <= 1} onClick={() => setRound(round - 1)} aria-label="‹"><Icon name="prev" size={16} /></button>
        <select value={round} onChange={e => setRound(Number(e.target.value))} aria-label={t('round', { n: '' })}>
          {days.map((_, i) => <option key={i} value={i + 1}>{t('round', { n: i + 1 })}</option>)}
        </select>
        <button className="small" disabled={round >= days.length} onClick={() => setRound(round + 1)} aria-label="›"><Icon name="next" size={16} /></button>
      </div>
      <table className="compact num"><tbody>
        {fixtures.filter(f => f.day === day).map(f => (
          <tr key={f.id} className={f.isUser ? 'me' : ''}>
            <td className="r" style={{ width: '42%' }}>{f.home}</td>
            <td style={{ textAlign: 'center', width: 80 }}><Score f={f} /></td>
            <td>{f.away}</td>
          </tr>
        ))}
      </tbody></table>
    </div>
  )
}

function KnockoutRounds({ stages, fixtures }: { stages: string[]; fixtures: FixtureView[] }) {
  const { t } = useI18n()
  const reached = stages.filter(s => fixtures.some(f => f.stage === s))
  const mine = [...fixtures].reverse().find(f => f.isUser)
  const [stage, setStage] = useState(mine?.stage ?? reached[reached.length - 1] ?? stages[0])
  const list = fixtures.filter(f => f.stage === stage).sort((a, b) => Number(b.isUser) - Number(a.isUser))
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="seg" role="group">
        {stages.map(s => (
          <button key={s} aria-pressed={stage === s} disabled={!reached.includes(s)} onClick={() => setStage(s)}>
            {t('stage.' + s)} {fixtures.some(f => f.stage === s && f.isUser) && <Icon name="star" size={12} />}
          </button>
        ))}
      </div>
      {list.length === 0 && <Empty icon="hourglass">{t('tbd')}</Empty>}
      <div className="grid g3">
        {list.map(f => {
          const w = f.played ? (f.homeGoals! > f.awayGoals! || (f.homeGoals === f.awayGoals && f.pensHome) ? 'h' : 'a') : ''
          return (
            <div key={f.id} className={'bmatch' + (f.isUser ? ' me' : '')}>
              <span className={w === 'h' ? 'win' : w ? 'lose' : ''}><ClubDot color={f.homeColor} /> {f.home}<b className="num">{f.played ? f.homeGoals : ''}</b></span>
              <span className={w === 'a' ? 'win' : w ? 'lose' : ''}><ClubDot color={f.awayColor} /> {f.away}<b className="num">{f.played ? f.awayGoals : ''}</b></span>
              <ScoreNote f={f} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
