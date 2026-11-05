import { useEffect, useState } from 'react'
import type { Ctx } from '../App'
import { api } from '../api'
import type { HistoryView, StatLine } from '../types'
import { PosTag, Loading, Hint, Abbr, Icon, PageHead, Title, Kpi, CountUp, Empty, TabBar, fmtMoney, type IconName } from '../ui'
import { errText, useI18n } from '../i18n'
import { FixtureList } from './MatchCentre'
import { LegendsPanel } from './club/Legends'

export default function History({ ctx }: { ctx: Ctx }) {
  const { t } = useI18n()
  const [h, setH] = useState<HistoryView | null>(null)
  const [tab, setTab] = useState<'seasons' | 'matches' | 'records' | 'legends'>('seasons')
  const [season, setSeason] = useState(0)
  useEffect(() => { api.history(ctx.id).then(setH).catch(e => ctx.toast(errText(t, e), true)) }, [ctx.id, ctx.st.career.day])
  if (!h) return <Loading />
  const tt = h.totals
  const matches = season ? h.matches.filter(m => m.season === season) : h.matches

  return (
    <>
      <PageHead icon="history" eyebrow={ctx.st.club.name} title={t('tab.history')} />
      <div className="kpis">
        <Kpi icon="cup" label={t('hi.trophies')} tone="gold" tip={t('hi.trophyLine', { l: tt.leagueTitles ?? 0, c: tt.cups ?? 0, e: tt.cl ?? 0 })}><CountUp v={(tt.leagueTitles ?? 0) + (tt.cups ?? 0) + (tt.cl ?? 0)} /></Kpi>
        <Kpi icon="form" label={t('hi.record')} tip={t('hi.played', { n: tt.played ?? 0 })}>{tt.won ?? 0}-{tt.drawn ?? 0}-{tt.lost ?? 0}</Kpi>
        <Kpi icon="goal" label={t('hi.goals')} tone="good" tip={t('hi.goalsLine')}>{tt.goalsFor ?? 0} : {tt.goalsAgainst ?? 0}</Kpi>
        <Kpi icon="legend" label={t('hi.legends')}><CountUp v={h.legends.length} /></Kpi>
      </div>
      <div className="trophyrow">
        <span className="tro"><Icon name="league" size={18} /> {t('comp.league')} <b className="num">{tt.leagueTitles ?? 0}</b></span>
        <span className="tro"><Icon name="cup" size={18} /> {t('comp.cup')} <b className="num">{tt.cups ?? 0}</b></span>
        <span className="tro"><Icon name="continental" size={18} /> {t('comp.cl')} <b className="num">{tt.cl ?? 0}</b></span>
      </div>
      <TabBar value={tab} onChange={setTab} label={t('tab.history')} options={[
        ['seasons', 'calendar', t('hi.seasons')], ['matches', 'match', t('hi.matches')], ['records', 'rank', t('hi.records')], ['legends', 'legend', t('hi.legends')],
      ]} />

      {tab === 'seasons' && (
        <section className="panel">
          {h.seasons.length === 0 ? <Empty icon="calendar">{t('hi.noSeasons')}</Empty> : (
            <div className="scroll tall">
              <table>
                <thead><tr><th>{t('season')}</th><th className="r">{t('hi.pos')}</th><th className="r"><Abbr k="pts" /></th><th>{t('comp.cup')}</th><th>{t('comp.cl')}</th><th>{t('hi.topScorer')}</th><th>{t('hi.bestPlayer')}</th><th className="r">{t('fin.prize')}</th><th>{t('hi.champions')}</th></tr></thead>
                <tbody>
                  {h.seasons.map(s => (
                    <tr key={s.season}>
                      <td><b>{t('seasonN', { n: s.season })}</b></td>
                      <td className="r num">{s.leaguePos === 1 && <Icon name="cup" size={14} className="gold" />} <span className="rk">{s.leaguePos}</span>{s.summary.division ? <span className="muted"> · {t('divN', { n: s.summary.division })}</span> : null}{s.summary.move === 'up' ? <Icon name="up" size={14} className="goodc" /> : s.summary.move === 'down' ? <Icon name="down" size={14} className="badc" /> : null}</td>
                      <td className="r num ptscell"><b>{s.points}</b></td>
                      <td>{s.cup === 'W' && <Icon name="cup" size={14} className="gold" />} {t('ko.' + (s.cup || 'none'))}</td>
                      <td>{s.cl === 'W' && <Icon name="cup" size={14} className="gold" />} {t('ko.' + (s.cl || 'none'))}</td>
                      <td>{s.summary.topScorer ? <><Icon name="goal" size={13} /> {s.summary.topScorer} <b className="num">({s.summary.topScorerGoals})</b></> : '–'}</td>
                      <td>{s.summary.bestPlayer ? <><Icon name="star" size={13} /> {s.summary.bestPlayer} <b className="num">({s.summary.bestRating?.toFixed(2)})</b></> : '–'}</td>
                      <td className="r num">{fmtMoney(s.prize)}</td>
                      <td className="muted" style={{ whiteSpace: 'normal', fontSize: 12, minWidth: 220 }}>{t('comp.cl')}: {s.summary.champions?.cl ?? '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === 'matches' && (
        <section className="panel">
          <div className="row" style={{ marginBottom: 8 }}>
            <Icon name="calendar" size={15} />
            <select value={season} onChange={e => setSeason(Number(e.target.value))} aria-label={t('season')}>
              <option value={0}>{t('hi.allSeasons')}</option>
              {[...new Set(h.matches.map(m => m.season!))].map(s => <option key={s} value={s}>{t('seasonN', { n: s })}</option>)}
            </select>
            <span className="muted">{t('hi.nMatches', { n: matches.length })}</span>
          </div>
          <div className="scroll"><FixtureList fixtures={matches} clubId={ctx.st.club.id} /></div>
        </section>
      )}

      {tab === 'records' && (
        <div className="grid g2" style={{ alignItems: 'start' }}>
          <RecordTable icon="goal" title={t('hi.allTimeScorers')} rows={h.scorers} val={l => l.goals} />
          <RecordTable icon="apps" title={t('hi.allTimeApps')} rows={h.apps} val={l => l.apps} />
        </div>
      )}

      {tab === 'legends' && <LegendsPanel ctx={ctx} />}
      {tab === 'legends' && (
        <section className="panel stack">
          <Hint text={t('hi.legendRules')} />
          {h.legends.length === 0 && <Empty icon="legend">{t('hi.noLegends')}</Empty>}
          <div className="grid g3 cards">
            {h.legends.map(l => (
              <div key={l.playerId} className={'legend ' + l.tier}>
                <span className="eyebrow"><Icon name={l.tier === 'legend' ? 'crown' : 'icon'} size={14} /> {t('hi.tier.' + l.tier)}</span>
                <b>{l.name}</b>
                <span className="row" style={{ gap: 6 }}><PosTag p={l.position} />{l.retired && <span className="muted">{t('retired')}</span>}</span>
                <span className="num">{t('hi.legendLine', { a: l.apps, g: l.goals, as: l.assists, r: l.rating.toFixed(2) })}</span>
                <span className="muted" style={{ fontSize: 12 }}>{l.reasons.map(r => t('hi.why.' + r)).join(' · ')}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  )
}

function RecordTable({ icon, title, rows, val }: { icon: IconName; title: string; rows: StatLine[]; val: (l: StatLine) => number }) {
  const { t } = useI18n()
  return (
    <section className="panel">
      <Title icon={icon} className="mb8">{title}</Title>
      <table className="compact num"><tbody>
        {rows.map((l, i) => (
          <tr key={l.playerId}><td><span className="rk">{i + 1}</span></td><td>{l.name}{l.retired && <span className="muted"> · {t('retired')}</span>}</td><td><PosTag p={l.position} /></td><td className="r ptscell"><b>{val(l)}</b></td></tr>
        ))}
      </tbody></table>
      {rows.length === 0 && <Empty icon={icon}>{t('noGamesYet')}</Empty>}
    </section>
  )
}
