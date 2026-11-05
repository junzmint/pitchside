import { useEffect, useState } from 'react'
import type { Ctx } from '../App'
import { api } from '../api'
import type { StatLine, StatsView } from '../types'
import { PosTag, Seg, Loading, Icon, PageHead, Title, Kpi, CountUp, Empty, type IconName } from '../ui'
import { errText, useI18n } from '../i18n'

export default function Stats({ ctx }: { ctx: Ctx }) {
  const { t } = useI18n()
  const [season, setSeason] = useState(ctx.st.career.season)
  const [comp, setComp] = useState('all')
  const [v, setV] = useState<StatsView | null>(null)
  useEffect(() => { api.stats(ctx.id, season, comp).then(setV).catch(e => ctx.toast(errText(t, e), true)) }, [ctx.id, season, comp, ctx.st.career.day])
  const seasons = Array.from({ length: ctx.st.career.season }, (_, i) => ctx.st.career.season - i)
  const squad = v?.squad ?? []
  const goals = squad.reduce((a, l) => a + l.goals, 0)
  const assists = squad.reduce((a, l) => a + l.assists, 0)
  const rated = squad.filter(l => l.apps > 0)
  const avg = rated.length ? rated.reduce((a, l) => a + l.rating * l.apps, 0) / Math.max(1, rated.reduce((a, l) => a + l.apps, 0)) : 0
  const maxGa = Math.max(1, ...squad.map(l => l.goals + l.assists))

  return (
    <>
      <PageHead icon="stats" eyebrow={t('seasonN', { n: season })} title={t('tab.stats')}>
        <div className="row">
          <label className="row" style={{ gap: 6 }}>
            <Icon name="calendar" size={15} />
            <select value={season} onChange={e => setSeason(Number(e.target.value))} aria-label={t('season')}>
              {seasons.map(s => <option key={s} value={s}>{t('seasonN', { n: s })}</option>)}
            </select>
          </label>
          <Seg value={comp} label={t('stats.comp')} onChange={setComp} options={[
            ['all', t('all')], ['league', <><Icon name="league" size={14} /> {t('comp.league')}</>], ['cup', <><Icon name="cup" size={14} /> {t('comp.cup')}</>],
            ['cl', <><Icon name="continental" size={14} /> {t('comp.cl')}</>], ['friendly', <><Icon name="sponsor" size={14} /> {t('comp.friendly')}</>],
          ]} />
        </div>
      </PageHead>
      {!v ? <Loading /> : (
        <>
          <div className="kpis">
            <Kpi icon="goal" label={t('stats.goals')} tone="good"><CountUp v={goals} /></Kpi>
            <Kpi icon="assist" label={t('stats.assists')}><CountUp v={assists} /></Kpi>
            <Kpi icon="rating" label={t('stats.avg')} tone="gold"><CountUp v={avg * 100} fmt={n => (n / 100).toFixed(2)} /></Kpi>
            <Kpi icon="cleanSheet" label={t('stats.cs')}><CountUp v={Math.max(0, ...squad.filter(l => l.position === 'GK').map(l => l.cs))} /></Kpi>
          </div>
          <div className="grid g3" style={{ alignItems: 'start' }}>
            <Leaders icon="goal" title={t('stats.goals')} rows={v.goals ?? []} val={l => l.goals} clubId={ctx.st.club.id} />
            <Leaders icon="assist" title={t('stats.assists')} rows={v.assists ?? []} val={l => l.assists} clubId={ctx.st.club.id} />
            <Leaders icon="rating" title={t('stats.rating')} rows={v.ratings ?? []} val={l => l.rating.toFixed(2)} clubId={ctx.st.club.id} />
          </div>
          <section className="panel">
            <Title icon="squad" className="mb8">{t('stats.squad', { club: ctx.st.club.name })}</Title>
            {!squad.length ? <Empty icon="stats">{t('noGamesYet')}</Empty> : (
              <div className="scroll tall">
                <table className="num">
                  <thead><tr>
                    <th>{t('player')}</th><th>{t('lbl.pos')}</th><th className="r">{t('stats.apps')}</th><th className="r">{t('stats.g')}</th><th className="r">{t('stats.a')}</th>
                    <th>{t('stats.ga')}</th><th className="r">{t('stats.avg')}</th><th className="r">{t('stats.cs')}</th>
                  </tr></thead>
                  <tbody>
                    {squad.map(l => (
                      <tr key={l.playerId}>
                        <td><b>{l.name}</b>{l.retired && <span className="muted"> · {t('retired')}</span>}</td><td><PosTag p={l.position} /></td>
                        <td className="r">{l.apps}</td><td className="r">{l.goals}</td><td className="r">{l.assists}</td>
                        <td style={{ minWidth: 120 }}><span className="gabar" data-tip={`${t('stats.g')} ${l.goals} · ${t('stats.a')} ${l.assists}`}>
                          <i className="g" style={{ width: (l.goals / maxGa) * 100 + '%' }} /><i className="a" style={{ width: (l.assists / maxGa) * 100 + '%' }} /><b>{l.goals + l.assists}</b>
                        </span></td>
                        <td className="r"><span className={'ratechip ' + (l.rating >= 7.5 ? 'hi' : l.rating < 6.3 ? 'lo' : '')}>{l.rating.toFixed(2)}</span></td>
                        <td className="r">{l.cs}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  )
}

/** Leaderboard: the leader on a gold podium card, the chasers in a list. */
function Leaders({ icon, title, rows, val, clubId }: { icon: IconName; title: string; rows: StatLine[]; val: (l: StatLine) => string | number; clubId: number }) {
  const { t } = useI18n()
  const [top, ...rest] = rows
  return (
    <section className="panel stack">
      <Title icon={icon}>{title}</Title>
      {!top ? <Empty icon={icon}>{t('noGamesYet')}</Empty> : (
        <>
          <div className={'leader' + (top.clubId === clubId ? ' mine' : '')}>
            <span className="medal num">1</span>
            <div><b>{top.name}</b><small className="muted">{top.club} · {top.apps} {t('stats.appsShort')}</small></div>
            <span className="lval num">{val(top)}</span>
          </div>
          <ol className="chasers">
            {rest.map((l, i) => (
              <li key={l.playerId} className={l.clubId === clubId ? 'mine' : ''}>
                <span className={'rk num' + (i < 2 ? ' m' + (i + 2) : '')}>{i + 2}</span>
                <span className="who"><b>{l.name}</b><small className="muted">{l.club} · {l.apps} {t('stats.appsShort')}</small></span>
                <b className="num">{val(l)}</b>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  )
}
