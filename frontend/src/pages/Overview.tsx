import { useEffect, useRef, useState } from 'react'
import type { Ctx } from '../App'
import { api, money } from '../api'
import type { CompetitionsView, FixtureView, Quest, TableRow } from '../types'
import { Badge, Bar, ClubDot, ResultChip, resultOf, useStageLabel, Abbr, CountUp, Icon, PageHead, Title, fmtMoney, type IconName, koPath, KoRoad, CUP_STAGES, CL_KO_STAGES, type KoPath, Empty } from '../ui'
import type { Tab } from '../App'
import { useI18n } from '../i18n'
import { ClubHubTop, ClubHubTiles } from './club/ClubHub'
import { StageTicker } from './stage/Ticker'
import { StadiumArt } from '../stadium'

const COMP_OF: Record<string, IconName> = { league: 'league', cup: 'cup', cl: 'continental', friendly: 'sponsor' }
const QUICK: [Tab, IconName, string][] = [['squad', 'squad', 'squad'], ['tactics', 'tactics', 'xi'], ['market', 'market', 'budget'], ['staff', 'staff', 'staff']]

// The home hub: the next match front and centre, then the club at a glance.
export default function Overview({ ctx }: { ctx: Ctx }) {
  const { t } = useI18n()
  const stage = useStageLabel()
  const { st, id } = ctx
  const [comp, setComp] = useState<CompetitionsView | null>(null)
  const [quests, setQuests] = useState<Quest[]>([])

  useEffect(() => {
    api.competitions(id, true).then(setComp).catch(() => {})
    api.quests(id).then(setQuests).catch(() => {})
  }, [id, st.career.day, st.career.season])
  // the season path scrolls sideways: keep today's matchday in view (late in the season it sits far to the right)
  const strip = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = strip.current, cur = el?.querySelector<HTMLElement>('.d.cur')
    if (el && cur) el.scrollLeft += cur.getBoundingClientRect().left - el.getBoundingClientRect().left - el.clientWidth / 2 + cur.offsetWidth / 2
  }, [comp, st.career.day])

  const club = st.club
  const pos = st.table.findIndex(r => r.isUser) + 1
  const row = st.table[pos - 1]
  const injured = st.squad.filter(p => p.injury > 0)
  const tired = st.squad.filter(p => p.injury === 0 && p.fitness < 65)
  const byDay = new Map<number, FixtureView>()
  ;(comp?.fixtures ?? []).filter(f => f.isUser).forEach(f => byDay.set(f.day, f))
  const fx = st.today?.fixture
  const offseason = st.today?.comp === 'offseason'
  const n = st.table.length
  const zone = (i: number) => st.division === 1 && i < st.clSpots ? 'cl' : st.division > 1 && i < st.promote ? 'up' : st.division < st.divisions && i >= n - st.promote ? 'down' : ''

  return (
    <>
      <PageHead icon="home" badge={<Badge short={club.short} color={club.color} color2={club.color2} size={64} />} eyebrow={<>{t('seasonN', { n: st.career.season })} · {offseason ? t('offseason') : t('dayOf', { d: st.career.day, n: st.seasonDays })}</>} title={t('tab.overview')} />

      <div className="hub">
        <ClubHubTop ctx={ctx} />{/* club stream: Deadline Day banner, a new legend's shirt number */}
        {/* next match */}
        <section className="panel tile matchtile t-match">
          <span className="comp"><Icon name={COMP_OF[fx?.comp ?? st.today?.comp ?? 'league'] ?? 'calendar'} size={15} /> {fx ? `${t('hub.next')} · ${stage(fx.comp, fx.stage)}` : offseason ? t('offseason') : stage(st.today?.comp ?? 'league', st.today?.stage ?? 'R', st.today?.round)}</span>
          {fx ? (
            <div className="faceoff">
              <div className="team"><Badge short={fx.homeShort} color={fx.homeColor} color2={fx.homeColor2} size={112} /><b>{fx.home}</b><span className="muted">{t('home')}</span></div>
              <div className="vsmark">VS</div>
              <div className="team"><Badge short={fx.awayShort} color={fx.awayColor} color2={fx.awayColor2} size={112} /><b>{fx.away}</b><span className="muted">{t('away')}</span></div>
            </div>
          ) : (
            <div className="faceoff">
              <div className="team"><Badge short={club.short} color={club.color} color2={club.color2} size={112} /><b>{club.name}</b></div>
              <div />
              <div className="team"><span className="muted" style={{ fontSize: 16 }}>{offseason ? t('hub.offseason') : t('hub.noMatch')}</span></div>
            </div>
          )}
          <div className="actions">
            {fx && !fx.played && !st.career.ended && <button className="primary big" onClick={() => ctx.play()}><Icon name="playNow" size={20} /> {t('mc.playLive')}</button>}
            <button className={fx ? '' : 'primary big'} onClick={() => ctx.go('match')}><Icon name="match" size={fx ? 16 : 20} /> {t('toMatchCentre')}</button>
            <button onClick={() => ctx.go('tactics')}><Icon name="tactics" size={16} /> {t('mc.editLineup')}</button>
          </div>
        </section>

        {/* standing */}
        <section className="panel tile t-side">
          <Title icon="rank">{t('hub.position')}</Title>
          <div className="standing">
            <div className="big-num num">{pos > 0 ? <CountUp v={pos} /> : '–'}<small> / {st.table.length}</small></div>
            <div className="standing-side">
              <span className="muted">{st.leagueName}</span>
              <b className="num gold"><Icon name="points" size={16} /> <CountUp v={row?.pts ?? 0} /> {t('pts')}</b>
            </div>
          </div>
          <div className="wdl num">
            <span className="w" data-tip={t('tbl.w.full')}><b>{row?.w ?? 0}</b><small>{t('tbl.w')}</small></span>
            <span className="d" data-tip={t('tbl.d.full')}><b>{row?.d ?? 0}</b><small>{t('tbl.d')}</small></span>
            <span className="l" data-tip={t('tbl.l.full')}><b>{row?.l ?? 0}</b><small>{t('tbl.l')}</small></span>
          </div>
          <div className="row">
            <span className="muted"><Icon name="form" size={14} /> {t('form')}</span>
            <span className="formdots">{(st.recent ?? []).map(f => <ResultChip key={f.id} f={f} clubId={club.id} />)}</span>
            {!st.recent?.length && <span className="muted">{t('noGamesYet')}</span>}
          </div>
        </section>

        <StageTicker ctx={ctx} />{/* stage stream: world headlines */}
        {/* season path */}
        <section className="panel tile">
          <Title icon="calendar">{t('hub.season')}</Title>
          <div className="season-strip" ref={strip}>
            {(comp?.calendar ?? []).map((d, i) => {
              const day = i + 1
              const f = byDay.get(day)
              const res = f?.played ? resultOf(f, club.id) : null
              const cls = ['d', 'c-' + d.comp, day < st.career.day ? 'past' : '', day === st.career.day ? 'cur' : '', res ?? '', !f && day <= st.career.day ? 'none' : ''].join(' ')
              const title = `${day} · ${stage(d.comp, d.stage, d.round)}${f ? ` · ${f.home} – ${f.away}${f.played ? ` ${f.homeGoals}-${f.awayGoals}` : ''}` : ''}`
              return <span key={day} className={cls} data-tip={title}>{day}<small>{res ? t('res.' + res) : f ? '•' : ''}</small></span>
            })}
          </div>
        </section>

        {/* quick menu */}
        <nav className="navtiles" aria-label={t('hub.quick')}>
          {QUICK.map(([tab, icon, sub]) => (
            <button key={tab} className="navtile" onClick={() => ctx.go(tab)}>
              <Icon name={icon} size={30} strokeWidth={1.6} />
              <b>{t('tab.' + tab)}</b>
              <small>{sub === 'squad' ? t('hub.qSquad', { n: st.squad.length, i: injured.length }) : sub === 'xi' ? st.club.formation : sub === 'budget' ? money(club.budget) : t('hub.qStaff', { n: st.coaches?.length ?? 0 })}</small>
            </button>
          ))}
        </nav>

        {/* team strength */}
        <section className="panel tile t-third">
          <Title icon="strength">{t('hub.squad')}</Title>
          {(['attack', 'midfield', 'defense'] as const).map(k => (
            <div key={k} className="ratrow">
              <span><Icon name={k} size={15} /> {t('rating.' + k)}</span>
              <Bar v={st.rating[k] - 45} max={45} color="var(--club)" />
              <b className="num"><CountUp v={Math.round(st.rating[k])} /></b>
            </div>
          ))}
          <div className="ratrow">
            <span><Icon name="chemistry" size={15} /> {t('chemistry')}</span>
            <Bar v={st.chemistry.team} />
            <b className="num"><CountUp v={st.chemistry.team} /></b>
          </div>
          <div className="alerts">
            {club.budget < 0 && <span className="flag bad"><Icon name="warn" size={13} /> {t('debtWarn', { n: st.squad.filter(p => p.unrest > 0).length })}</span>}
            {injured.length > 0 && <span className="flag bad" data-tip={injured.map(p => `${p.name} (${p.injury}${t('wk')})`).join('\n')}><Icon name="injury" size={13} /> {t('hub.injured', { n: injured.length })}</span>}
            {tired.length > 0 && <span className="flag warn"><Icon name="fitness" size={13} /> {t('tiredList', { n: tired.length })}</span>}
            {injured.length === 0 && tired.length === 0 && <span className="flag good"><Icon name="check" size={13} /> {t('allFit')}</span>}
            <button className="flag" onClick={() => ctx.go('squad')}><Icon name="training" size={13} /> {t('trainingNow', { v: t('intensity.' + st.career.training.intensity) })}</button>
          </div>
        </section>

        {/* money */}
        <section className="panel tile t-third">
          <div className="row spread"><Title icon="finance">{t('tab.finance')}</Title><button className="link" onClick={() => ctx.go('finance')}>{t('details')}</button></div>
          <div className="big-num num" style={{ fontSize: 44, color: club.budget < 0 ? 'var(--bad)' : 'var(--hot)' }}><CountUp v={club.budget} fmt={fmtMoney} /></div>
          <div className="kv num">
            <span><Icon name="wages" size={14} /> {t('weeklyWages')}</span><b>−{money(st.weeklyWages)}</b>
            <span><Icon name="sponsor" size={14} /> {t('fin.sponsors')}</span>
            <b>{Object.keys(st.career.commercial?.sponsors ?? {}).length}/5 {Object.keys(st.career.commercial?.sponsors ?? {}).length < 5 && <button className="primary small" onClick={() => ctx.go('finance')}>{t('pickSponsor')}</button>}</b>
            {st.career.commercial?.board && <><span><Icon name="board" size={14} /> {t('board.title')}</span><b>{t('goal.' + st.career.commercial.board.goal)}</b></>}
          </div>
        </section>

        {/* quests */}
        <section className="panel tile t-third">
          <div className="row spread"><Title icon="quest">{t('quests')}</Title><button className="link" onClick={() => ctx.go('finance')}>{t('details')}</button></div>
          {quests.map(q => (
            <div key={q.id} className="stack" style={{ gap: 4 }}>
              <div className="row spread" style={{ flexWrap: 'nowrap' }}>
                <span>{t('quest.' + q.kind, { n: q.target })}</span>
                <b className="num" style={{ color: q.status === 'done' ? 'var(--good)' : 'var(--hot)', whiteSpace: 'nowrap' }}>{q.status === 'done' && <Icon name="check" size={14} />} {money(q.reward)}</b>
              </div>
              <Bar v={q.progress} max={q.target} color={q.status === 'done' ? 'var(--good)' : 'var(--cyan)'} />
            </div>
          ))}
        </section>

        <ClubHubTiles ctx={ctx} />{/* club stream: fans and the Legends wall */}

        {/* competitions: league table, cup road, continental group and knockouts */}
        <CompTile ctx={ctx} comp={comp} zone={zone} />

        {/* the ground: grows with the facilities */}
        <GroundTile ctx={ctx} />
      </div>
    </>
  )
}

/** Your ground at night: the stands, roof and floodlights follow the facility levels. */
function GroundTile({ ctx }: { ctx: Ctx }) {
  const { t } = useI18n()
  const c = ctx.st.club
  const levels: [string, IconName, number][] = [['stadium', 'stadium', c.stadium], ['training', 'training', c.trainLvl], ['academy', 'academy', c.academy], ['medical', 'medical', c.medical]]
  return (
    <section className="panel tile groundtile">
      <div className="row spread"><Title icon="stadium">{t('hub.ground')}</Title><button className="link" onClick={() => ctx.go('finance')}>{t('hub.upgrade')}</button></div>
      <div className="ground-body">
        <StadiumArt stadium={c.stadium} training={c.trainLvl} academy={c.academy} medical={c.medical} color={c.color} color2={c.color2} className="ground-art" />
        <div className="ground-levels">
          {levels.map(([k, icon, lvl]) => (
            <div key={k} className="ground-level">
              <Icon name={icon} size={18} />
              <span>{t('dev.' + k)}</span>
              <b className="num">{t('hub.level', { n: lvl })}</b>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

type CompKey = 'league' | 'cup' | 'cl'
const COMP_ICON: Record<CompKey, IconName> = { league: 'league', cup: 'cup', cl: 'continental' }

/** Every competition the club is in, at a glance: league table, cup road, continental group and knockouts. */
function CompTile({ ctx, comp, zone }: { ctx: Ctx; comp: CompetitionsView | null; zone: (i: number) => string }) {
  const { t } = useI18n()
  const { st } = ctx
  const clubId = st.club.id
  const [tab, setTab] = useState<CompKey>('league')
  const pos = st.table.findIndex(r => r.isUser) + 1
  const fixtures = comp?.fixtures ?? []
  const cup = koPath(CUP_STAGES, fixtures.filter(f => f.comp === 'cup'), clubId)
  const clKo = koPath(CL_KO_STAGES, fixtures.filter(f => f.comp === 'cl' && !f.stage.startsWith('G')), clubId)
  const group = comp ? Object.entries(comp.groups).find(([, rows]) => rows.some(r => r.isUser)) : undefined
  const groupGames = fixtures.filter(f => f.comp === 'cl' && f.stage.startsWith('G'))
  const groupDone = groupGames.length > 0 && groupGames.every(f => f.played)
  const nextGroup = groupGames.filter(f => !f.played).sort((a, b) => a.day - b.day)[0]
  const groupRank = group ? group[1].findIndex(r => r.isUser) + 1 : 0
  const outInGroup = groupDone && groupRank > 2 && !clKo.started
  const inCl = !!comp?.userInCl
  // the first matchday of a stage still to come, from the season calendar
  const dayOf = (c: string, stages?: string[]) => {
    const i = (comp?.calendar ?? []).findIndex((d, k) => k + 1 >= st.career.day && d.comp === c && (!stages || stages.includes(d.stage)))
    return i >= 0 ? i + 1 : 0
  }
  const status = (p: KoPath, c: string, stages: string[]) => {
    if (p.winner) return { cls: 'win', icon: 'cup' as IconName, text: t('hub.winner') }
    if (p.out) return { cls: 'out', icon: 'close' as IconName, text: t('hub.out', { stage: t('stage.' + p.out) }) }
    if (p.nextFixture) {
      const f = p.nextFixture
      return { cls: 'next', icon: 'playNow' as IconName, text: `${t('hub.nextRound', { stage: t('stage.' + p.next) })} · ${f.homeId === clubId ? f.away : f.home} · ${t('hub.day', { d: f.day })}` }
    }
    if (p.next) {
      const d = dayOf(c, [p.next])
      return { cls: 'next', icon: 'next' as IconName, text: `${t('hub.through', { stage: t('stage.' + p.next) })}${d ? ` · ${t('hub.day', { d })}` : ''}` }
    }
    const d = dayOf(c, stages)
    return { cls: '', icon: 'hourglass' as IconName, text: d ? t('hub.startsDay', { d }) : t('tbd') }
  }
  const cupStatus = status(cup, 'cup', CUP_STAGES)
  const clStatus = !inCl ? { cls: 'muted', icon: 'lock' as IconName, text: t('hub.notQualified') }
    : outInGroup ? { cls: 'out', icon: 'close' as IconName, text: t('hub.out', { stage: t('ko.G') }) }
      : clKo.started ? status(clKo, 'cl', CL_KO_STAGES)
        : { cls: 'next', icon: 'users' as IconName, text: [group ? `${t('stage.' + group[0])} · #${groupRank}` : t('ko.G'), nextGroup ? `${t('vs')} ${nextGroup.homeId === clubId ? nextGroup.away : nextGroup.home} · ${t('hub.day', { d: nextGroup.day })}` : ''].filter(Boolean).join(' · ') }
  const sub: Record<CompKey, string> = {
    league: pos > 0 ? `#${pos} · ${st.table[pos - 1]?.pts ?? 0} ${t('pts')}` : '–',
    cup: cup.winner ? t('ko.W') : cup.out ? t('hub.outShort') : cup.next ? t('stage.' + cup.next) : cup.started ? '' : t('hub.notStarted'),
    cl: !inCl ? '–' : clStatus.cls === 'out' ? t('hub.outShort') : clKo.winner ? t('ko.W') : clKo.next ? t('stage.' + clKo.next) : group ? `${t('stage.' + group[0])} · #${groupRank}` : t('ko.G'),
  }
  function full() {
    try { sessionStorage.setItem('pitchside.compView', tab) } catch { /* ignore */ }
    ctx.go('competitions')
  }
  return (
    <section className="panel tile comptile">
      <div className="row spread">
        <Title icon="competitions">{t('hub.comps')}</Title>
        <button className="small" onClick={full}>{t('hub.fullView')} <Icon name="next" size={14} /></button>
      </div>
      <div className="comptabs" role="tablist" aria-label={t('hub.comps')}>
        {(['league', 'cup', 'cl'] as CompKey[]).map(k => (
          <button key={k} role="tab" aria-selected={tab === k} aria-pressed={tab === k} className={'c-' + k} onClick={() => setTab(k)}>
            <Icon name={COMP_ICON[k]} size={22} strokeWidth={1.8} />
            <span><b>{k === 'league' ? st.leagueName : t('comp.' + k)}</b><small>{sub[k]}</small></span>
          </button>
        ))}
      </div>
      {!comp && tab !== 'league' ? <Empty icon="hourglass">{t('loading')}</Empty> : tab === 'league' ? (
        <LeagueMini rows={st.table} zone={zone} />
      ) : tab === 'cup' ? (
        <div className="compbody">
          <div className={'compstatus ' + cupStatus.cls}><Icon name={cupStatus.icon} size={18} /> {cupStatus.text}</div>
          <KoRoad path={cup} clubId={clubId} />
        </div>
      ) : (
        <div className="compbody">
          <div className={'compstatus ' + clStatus.cls}><Icon name={clStatus.icon} size={18} /> {clStatus.text}</div>
          {!inCl ? <Empty icon="continental">{t('cp.clOut', { n: comp?.clSpots ?? 0 })}</Empty> : (
            <div className="clsplit">
              {group && (
                <div className="groupbox">
                  <b>{t('stage.' + group[0])}</b>
                  <table className="num compact">
                    <thead><tr><th>#</th><th>{t('club')}</th><th className="r"><Abbr k="tbl.p" /></th><th className="r"><Abbr k="tbl.gd" /></th><th className="r"><Abbr k="pts" /></th></tr></thead>
                    <tbody>
                      {group[1].map((r, i) => (
                        <tr key={r.clubId} className={(r.isUser ? 'me ' : '') + (i < 2 ? 'z-up' : '')}>
                          <td><span className="rk">{i + 1}</span></td>
                          <td><span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><ClubDot color={r.color} />{r.isUser ? <b>{r.name}</b> : r.name}</span></td>
                          <td className="r">{r.p}</td>
                          <td className="r">{r.gf - r.ga > 0 ? '+' : ''}{r.gf - r.ga}</td>
                          <td className="r ptscell"><b>{r.pts}</b></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="stack" style={{ gap: 6, minWidth: 0 }}>
                <span className="eyebrow">{t('cp.knockout')}</span>
                <KoRoad path={clKo} clubId={clubId} />
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/** The league table in a short scroll box that opens on the user's row. */
function LeagueMini({ rows, zone }: { rows: TableRow[]; zone: (i: number) => string }) {
  const { t } = useI18n()
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = box.current
    const me = el?.querySelector<HTMLElement>('tr.me')
    if (el && me) el.scrollTop = Math.max(0, me.offsetTop - el.clientHeight / 2)
  }, [])
  return (
    <div className="scroll leaguemini" ref={box}>
      <table className="num compact">
        <thead><tr><th>#</th><th>{t('club')}</th><th className="r"><Abbr k="tbl.p" /></th><th className="r"><Abbr k="tbl.w" />-<Abbr k="tbl.d" />-<Abbr k="tbl.l" /></th><th className="r"><Abbr k="tbl.gd" /></th><th className="r"><Abbr k="pts" /></th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.clubId} className={(r.isUser ? 'me ' : '') + 'z-' + zone(i)}>
              <td><span className="rk">{i + 1}</span></td>
              <td><span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><ClubDot color={r.color} />{r.isUser ? <b>{r.name}</b> : r.name}</span></td>
              <td className="r">{r.p}</td>
              <td className="r">{r.w}-{r.d}-{r.l}</td>
              <td className={'r ' + (r.gf - r.ga > 0 ? 'gd-pos' : r.gf - r.ga < 0 ? 'gd-neg' : '')}>{r.gf - r.ga > 0 ? '+' : ''}{r.gf - r.ga}</td>
              <td className="r ptscell"><b>{r.pts}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
