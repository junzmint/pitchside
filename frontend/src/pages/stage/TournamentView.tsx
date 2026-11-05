import { useEffect, useState } from 'react'
import type { Ctx } from '../../App'
import { stageApi, type AwardsView, type IntlMatch, type IntlTeam, type Tournament } from '../../api_stage'
import { Abbr, Badge, Empty, Icon, Loading, TabBar } from '../../ui'
import { errText, useI18n } from '../../i18n'
import { CupArt, Flag, nationColors } from './common'

type Tab = 'bracket' | 'groups' | 'scorers' | 'mine'

/** The summer tournament page: champion, bracket, groups, top scorers and the user's players. */
export default function TournamentView({ ctx }: { ctx: Ctx }) {
  const { t } = useI18n()
  const [info, setInfo] = useState<AwardsView | null>(null)
  const [season, setSeason] = useState(0)
  const [tour, setTour] = useState<Tournament | null | undefined>(undefined)
  const [tab, setTab] = useState<Tab>('bracket')
  useEffect(() => {
    stageApi.awards(ctx.id).then(v => { setInfo(v); if (v.cups[0]) setSeason(s => s || v.cups[0].season) }).catch(e => ctx.toast(errText(t, e), true))
  }, [ctx.id, ctx.st.career.season])
  useEffect(() => {
    if (!info) return
    if (!info.cups.length) { setTour(null); return }
    setTour(undefined)
    stageApi.tournament(ctx.id, season).then(setTour).catch(() => setTour(null))
  }, [info, season, ctx.id])
  if (!info || tour === undefined) return <Loading />
  const next = info.next
  const nextLine = next.kind ? t('in.next', { cup: t('in.' + next.kind), n: next.season }) : ''
  if (!tour) {
    return (
      <section className="panel stack">
        <Empty icon="flag">{t('in.none')} {nextLine}</Empty>
      </section>
    )
  }
  const byNation = new Map(tour.teams.map(x => [x.nation, x]))
  const [c1, c2] = nationColors(tour.champion)
  const f = tour.final
  return (
    <div className="stack sg-tourview">
      {info.cups.length > 1 && (
        <div className="row sg-tourpick" role="group" aria-label={t('in.pick')}>
          {info.cups.map(c => (
            <button key={c.season} className={'small' + (c.season === tour.season ? ' primary' : '')} onClick={() => setSeason(c.season)}>
              <Flag code={c.champion} size={12} /> {t('in.' + c.kind)} · {t('in.summer', { n: c.season })}
            </button>
          ))}
        </div>
      )}
      <section className="panel sg-tourhero" style={{ ['--n1' as string]: c1, ['--n2' as string]: c2 }}>
        <CupArt kind={tour.kind} size={96} />
        <div className="stack" style={{ gap: 4, minWidth: 0 }}>
          <span className="eyebrow">{t('in.' + tour.kind)} · {t('in.edition', { n: tour.edition })} · {t('in.summer', { n: tour.season })}</span>
          <h3 className="sg-tourchamp"><Flag code={tour.champion} size={30} /> {t(tour.kind === 'euro' ? 'in.champEuro' : 'in.champWorld', { nation: t('nation.' + tour.champion) })}</h3>
          {f && <span>{t('in.final', { m: `${t('nation.' + f.home)} ${f.hg}-${f.ag} ${t('nation.' + f.away)}${note(t, f)}` })}</span>}
          <span className="muted">
            {tour.scorers[0] && <>{t('in.topScorer', { p: tour.scorers[0].name, nation: t('nation.' + tour.scorers[0].nation), n: tour.scorers[0].goals })} · </>}
            {tour.best && t('in.best', { p: tour.best.name, nation: t('nation.' + tour.best.nation) })}
          </span>
          {nextLine && <small className="muted">{nextLine}</small>}
        </div>
      </section>

      <TabBar<Tab> value={tab} onChange={setTab} label={t('in.title')} options={[
        ['bracket', 'competitions', t('in.t.bracket')],
        ['groups', 'users', t('in.t.groups')],
        ['scorers', 'goal', t('in.t.scorers')],
        ['mine', 'star', t('in.t.mine'), String(tour.mine.length)],
      ]} />

      {tab === 'bracket' && <Bracket tour={tour} byNation={byNation} />}
      {tab === 'groups' && <Groups tour={tour} byNation={byNation} />}
      {tab === 'scorers' && <Scorers tour={tour} />}
      {tab === 'mine' && <Mine tour={tour} />}
    </div>
  )
}

function note(t: (k: string, p?: Record<string, string | number>) => string, m: IntlMatch) {
  if (m.ph != null && m.pa != null) return ` (${t('in.pens', { a: m.ph, b: m.pa })})`
  return m.et ? ` (${t('in.aet')})` : ''
}

function MineDot({ team }: { team?: IntlTeam }) {
  const { t } = useI18n()
  if (!team?.mine) return null
  return <span className="sg-minedot" data-tip={t('in.mineMark', { n: team.mine })}><Icon name="star" size={11} />{team.mine}</span>
}

function TeamRow({ nation, goals, win, byNation }: { nation: string; goals: number; win: boolean; byNation: Map<string, IntlTeam> }) {
  const { t } = useI18n()
  return (
    <div className={'sg-brow' + (win ? ' win' : '')}>
      <Flag code={nation} size={16} />
      <span className="sg-bname">{t('nation.' + nation)}</span>
      <MineDot team={byNation.get(nation)} />
      <b className="num">{goals}</b>
    </div>
  )
}

function MatchBox({ m, byNation }: { m: IntlMatch; byNation: Map<string, IntlTeam> }) {
  const { t } = useI18n()
  const homeWin = m.hg > m.ag || (m.hg === m.ag && m.ph != null && m.pa != null && m.ph > m.pa)
  const tip = m.goals.map(g => `${g.name}${g.assist ? ` (${g.assist})` : ''}`).join('\n')
  return (
    <div className={'sg-bmatch' + (m.mine ? ' mine' : '')} data-tip={tip || undefined} tabIndex={tip ? 0 : undefined}>
      <TeamRow nation={m.home} goals={m.hg} win={homeWin} byNation={byNation} />
      <TeamRow nation={m.away} goals={m.ag} win={!homeWin} byNation={byNation} />
      {(m.et || m.ph != null) && <small className="muted sg-bnote">{m.ph != null && m.pa != null ? t('in.pens', { a: m.ph, b: m.pa }) : t('in.aet')}</small>}
    </div>
  )
}

function Bracket({ tour, byNation }: { tour: Tournament; byNation: Map<string, IntlTeam> }) {
  const { t } = useI18n()
  const rounds = ['R16', 'QF', 'SF', 'F'].map(s => ({ s, ms: tour.matches.filter(m => m.stage === s) })).filter(r => r.ms.length)
  return (
    <section className="panel stack">
      <p className="muted small" style={{ margin: 0 }}><Icon name="star" size={12} /> {t('in.bracketHint')}</p>
      <div className="sg-bracket" style={{ ['--cols' as string]: rounds.length + 1 }}>
        {rounds.map(r => (
          <div key={r.s} className="sg-bcol">
            <b className="eyebrow">{t('in.s.' + r.s)}</b>
            <div className="sg-bcolin">{r.ms.map((m, i) => <MatchBox key={i} m={m} byNation={byNation} />)}</div>
          </div>
        ))}
        <div className="sg-bcol champ">
          <b className="eyebrow">{t('in.r.W')}</b>
          <div className="sg-bcolin">
            <div className="sg-bchamp"><CupArt kind={tour.kind} size={56} /><Flag code={tour.champion} size={26} /><b>{t('nation.' + tour.champion)}</b><MineDot team={byNation.get(tour.champion)} /></div>
          </div>
        </div>
      </div>
    </section>
  )
}

function Groups({ tour, byNation }: { tour: Tournament; byNation: Map<string, IntlTeam> }) {
  const { t } = useI18n()
  const keys = Object.keys(tour.groups).sort()
  return (
    <div className="sg-groups">
      {keys.map(g => (
        <section key={g} className="panel">
          <h3>{t('in.group', { g: g.slice(1) })}</h3>
          <table className="compact num">
            <thead><tr><th>#</th><th>{t('in.team')}</th><th className="r"><Abbr k="tbl.p" /></th><th className="r"><Abbr k="tbl.gd" /></th><th className="r"><Abbr k="pts" /></th></tr></thead>
            <tbody>
              {tour.groups[g].map((r, i) => (
                <tr key={r.nation} className={i < 2 ? 'z-up' : ''}>
                  <td><span className="rk">{i + 1}</span></td>
                  <td><span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><Flag code={r.nation} size={13} /> {t('nation.' + r.nation)} <MineDot team={byNation.get(r.nation)} /></span></td>
                  <td className="r">{r.p}</td>
                  <td className="r">{r.gf - r.ga > 0 ? '+' : ''}{r.gf - r.ga}</td>
                  <td className="r ptscell"><b>{r.pts}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="sg-gmatches">
            {tour.matches.filter(m => m.stage === g).map((m, i) => (
              <li key={i} className={m.mine ? 'mine' : ''}><Flag code={m.home} size={11} /> {t('nation.' + m.home)} <b className="num">{m.hg}-{m.ag}</b> {t('nation.' + m.away)} <Flag code={m.away} size={11} /></li>
            ))}
          </ul>
        </section>
      ))}
      <p className="muted small" style={{ gridColumn: '1 / -1', margin: 0 }}>{t('in.groupTip')}</p>
    </div>
  )
}

function Scorers({ tour }: { tour: Tournament }) {
  const { t } = useI18n()
  return (
    <section className="panel">
      <table className="compact num">
        <thead><tr><th>#</th><th>{t('in.player')}</th><th>{t('in.team')}</th><th>{t('in.club')}</th><th className="r" data-tip={t('sg.stat.goals')}><Icon name="goal" size={14} /></th><th className="r" data-tip={t('sg.stat.assists')}><Icon name="assist" size={14} /></th><th className="r" data-tip={t('sg.stat.apps')}><Icon name="apps" size={14} /></th></tr></thead>
        <tbody>
          {tour.scorers.map((p, i) => (
            <tr key={p.id} className={p.mine ? 'me' : ''}>
              <td><span className="rk">{i + 1}</span></td>
              <td>{p.mine ? <b>{p.name}</b> : p.name}</td>
              <td><span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><Flag code={p.nation} size={12} /> {t('nation.' + p.nation)}</span></td>
              <td><span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><Badge short={p.short} color={p.color} color2={p.color2} size={20} /> {p.club}</span></td>
              <td className="r"><b>{p.goals}</b></td>
              <td className="r">{p.assists}</td>
              <td className="r">{p.apps}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {tour.effects.boosted.length > 0 && (
        <p className="muted small" style={{ marginBottom: 0 }}><Icon name="up" size={13} /> {t('in.boosted', { list: tour.effects.boosted.map(b => b.name).join(', ') })}</p>
      )}
    </section>
  )
}

function Mine({ tour }: { tour: Tournament }) {
  const { t } = useI18n()
  if (!tour.mine.length) return <section className="panel"><Empty icon="users">{t('in.mineNone')}</Empty></section>
  return (
    <section className="panel stack">
      <p className="muted" style={{ margin: 0 }}>{t('in.tired', { a: tour.effects.fitMin, b: tour.effects.fitMax })} {t('in.moraleNote')}</p>
      <div className="sg-minegrid">
        {tour.mine.map(p => (
          <div key={p.id} className={'sg-mineplayer r-' + (p.result ?? 'G')}>
            <Flag code={p.nation} size={22} />
            <span className="stack" style={{ gap: 1, minWidth: 0 }}>
              <b>{p.name}</b>
              <small className="muted">{t('nation.' + p.nation)} · {t('posL.' + p.pos)} · <span data-tip={t('lbl.ovr')}>{p.ovr}</span></small>
            </span>
            <span className={'chip res-' + (p.result ?? 'G')}>{t('in.r.' + (p.result ?? 'G'))}</span>
            <span className="sg-minestats num">
              <span data-tip={t('sg.stat.apps')}><Icon name="apps" size={13} /> {p.apps}</span>
              <span data-tip={t('sg.stat.goals')}><Icon name="goal" size={13} /> {p.goals}</span>
              <span data-tip={t('sg.stat.assists')}><Icon name="assist" size={13} /> {p.assists}</span>
              <span data-tip={t('sg.stat.rating')}><Icon name="rating" size={13} /> {p.apps ? p.rating.toFixed(2) : '–'}</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
