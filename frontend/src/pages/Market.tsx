import { useCallback, useEffect, useState } from 'react'
import type { Ctx } from '../App'
import { api, money } from '../api'
import type { DealQuote, LeagueInfo, MarketView, Player, Pos, ScoutRow, Template } from '../types'
import { ATTRS, overallAs } from '../formations'
import {
  ConfirmButton, Loading, Ovr, PosTag, Seg, TagChip, TraitChips, Hint, Abbr, Icon, PageHead, PlayerCard, Title, ViewSwitch, useViewMode, Empty,
  CountUp, fmtMoney, tierOf, rangeFill, TabBar, Portal, useEscape,
} from '../ui'
import { errText, useI18n } from '../i18n'
import { eventsOf } from '../api_events'
import { revealSigning } from '../reveal'

export const MAX_SQUAD = 50

type Tab = 'free' | 'scout' | 'legends' | 'custom'

export default function Market({ ctx }: { ctx: Ctx }) {
  const { t } = useI18n()
  const [tab, setTab] = useState<Tab>('free')
  const [m, setM] = useState<MarketView | null>(null)
  const load = useCallback(() => api.market(ctx.id).then(setM).catch(e => ctx.toast(errText(t, e), true)), [ctx.id, ctx.st.career.day])
  useEffect(() => { load() }, [load])

  return (
    <>
      <PageHead icon="market" eyebrow={t('mk.eyebrow')} title={t('tab.market')}>
        <div className="row">
          <span className="chip num"><Icon name="budget" size={14} /> <CountUp v={ctx.st.club.budget} fmt={fmtMoney} /></span>
          <span className={'chip num' + (ctx.st.squad.length >= MAX_SQUAD ? ' bad' : '')}><Icon name="squad" size={14} /> {t('mk.squad', { n: ctx.st.squad.length })}</span>
        </div>
      </PageHead>
      {ctx.st.squad.length >= MAX_SQUAD && (
        <div className="notice warn row spread">
          <span className="row" style={{ gap: 6 }}><Icon name="warn" size={16} /> {t('mk.fullNote', { n: ctx.st.squad.length })}</span>
          <button className="small" onClick={() => ctx.go('squad')}><Icon name="squad" size={14} /> {t('mk.toSquad')}</button>
        </div>
      )}
      <TabBar value={tab} onChange={setTab} label={t('tab.market')}
        options={[['free', 'buy', t('mk.free')], ['scout', 'scout', t('mk.scout')], ['legends', 'legend', t('mk.legends')], ['custom', 'plus', t('mk.custom')]]} />
      {tab === 'free' && (m ? <FreeAgents ctx={ctx} m={m} reload={load} /> : <Loading />)}
      {tab === 'scout' && <Scout ctx={ctx} />}
      {tab === 'legends' && (m ? <Legends m={m} ctx={ctx} /> : <Loading />)}
      {tab === 'custom' && (m ? <Custom ctx={ctx} m={m} reload={load} /> : <Loading />)}
    </>
  )
}

function FreeAgents({ ctx, m, reload }: { ctx: Ctx; m: MarketView; reload: () => void }) {
  const { t } = useI18n()
  const [pos, setPos] = useState<Pos | 'ALL'>('ALL')
  const [afford, setAfford] = useState(false)
  const [view, setView] = useViewMode('market')
  async function buy(p: Player) {
    try {
      await api.buy(ctx.id, p.id)
      revealSigning(p)
      await Promise.all([reload(), ctx.reload()])
      ctx.toast(t('mk.signed', { name: p.name }))
    } catch (e) { ctx.toast(errText(t, e), true) }
  }
  const list = m.players.filter(p => (pos === 'ALL' || p.position === pos) && (!afford || (p.price || p.value) <= ctx.st.club.budget))
    .sort((a, b) => (b.tag ? 1 : 0) - (a.tag ? 1 : 0)) // legends (and your own designs) first: they only stay a few days
  const full = ctx.st.squad.length >= MAX_SQUAD
  const action = (p: Player) => (
    <ConfirmButton className="primary small" label={<><Icon name="buy" size={14} /> {t('mk.buy')}</>} confirm={t('mk.pay', { v: money(p.price || p.value) })}
      disabled={(p.price || p.value) > ctx.st.club.budget || full}
      title={full ? t('err.squad_full') : (p.price || p.value) > ctx.st.club.budget ? t('err.no_budget') : undefined}
      onConfirm={() => buy(p)} />
  )
  return (
    <section className="panel stack">
      <div className="row spread">
        <Title icon="buy">{t('mk.free')}</Title>
        <div className="row">
          <PosFilter value={pos} onChange={setPos} />
          <label className="row checkrow"><input type="checkbox" checked={afford} onChange={e => setAfford(e.target.checked)} /> <Icon name="budget" size={14} /> {t('mk.affordable')}</label>
          <ViewSwitch value={view} onChange={setView} />
        </div>
      </div>
      <Hint text={t('mk.freeHelp')} />
      {list.length === 0 ? <Empty icon="search">{t('mk.none')}</Empty>
        : view === 'cards' ? (
          <div className="cards">
            {list.map(p => <PlayerCard key={p.id} p={p} flags={<MarketFlags p={p} />}>{action(p)}</PlayerCard>)}
          </div>
        ) : <PlayerTable players={list} action={action} badge={p => <TagChip p={p} />} />}
    </section>
  )
}

function MarketFlags({ p, club }: { p: Player; club?: ScoutRow }) {
  const { t } = useI18n()
  const price = p.price || p.value
  const r = price / Math.max(1, p.value)
  return (
    <span className="pc-flagrow">
      {club && <span className="flag"><Icon name="building" size={12} /> {club.club}</span>}
      {club?.starter && <span className="flag club"><Icon name="apps" size={12} /> {t('starter')}</span>}
      {r < 0.88 && <span className="flag good" data-tip={t('mk.valueIs', { v: money(p.value) })}><Icon name="down" size={12} /> {t('mk.bargain')}</span>}
      {r > 1.25 && <span className="flag bad" data-tip={t('mk.valueIs', { v: money(p.value) })}><Icon name="flame" size={12} /> {t('mk.hype')}</span>}
      {p.injury > 0 && <span className="flag bad"><Icon name="injury" size={12} /> {p.injury}{t('wk')}</span>}
      <span className="flag" data-tip={t('wage')}><Icon name="wages" size={12} /> {money(p.wage)}</span>
      <TagChip p={p} />
      <TraitChips p={p} small />
    </span>
  )
}

function Scout({ ctx }: { ctx: Ctx }) {
  const { t } = useI18n()
  const [league, setLeague] = useState(ctx.st.career.league)
  const [pos, setPos] = useState<Pos | 'ALL'>('ALL')
  const [rows, setRows] = useState<ScoutRow[] | null>(null)
  const [deal, setDeal] = useState<ScoutRow | null>(null)
  const [leagues, setLeagues] = useState<LeagueInfo[]>([])
  const [view, setView] = useViewMode('scout')
  useEffect(() => { api.leagues().then(setLeagues).catch(() => {}) }, [])
  useEffect(() => {
    setRows(null)
    api.scout(ctx.id, league, pos === 'ALL' ? '' : pos).then(setRows).catch(e => ctx.toast(errText(t, e), true))
  }, [ctx.id, league, pos, ctx.st.career.day])
  const approach = (p: Player) => <button className="small" onClick={() => setDeal(rows?.find(r => r.player.id === p.id) ?? null)}><Icon name="chat" size={14} /> {t('mk.approach')}</button>
  return (
    <section className="panel stack">
      <div className="row spread">
        <Title icon="scout">{t('mk.scout')}</Title>
        <div className="row">
          <label className="row" style={{ gap: 6 }}>
            <Icon name="competitions" size={15} />
            <select value={league} onChange={e => setLeague(e.target.value)} aria-label={t('mk.league')}>
              <optgroup label={t('mk.compLeagues')}>
                {leagues.filter(l => !l.world).map(l => <option key={l.code} value={l.code}>{l.name} · {t('country.' + l.code)}</option>)}
              </optgroup>
              <optgroup label={t('mk.worldLeagues')}>
                {leagues.filter(l => l.world).map(l => <option key={l.code} value={l.code}>{l.name} · {t('nation.' + l.code)}</option>)}
              </optgroup>
            </select>
          </label>
          <PosFilter value={pos} onChange={setPos} />
          <ViewSwitch value={view} onChange={setView} />
        </div>
      </div>
      <Hint text={t('mk.scoutHelp')} />
      {!rows ? <Loading /> : rows.length === 0 ? <Empty icon="scout">{t('mk.none')}</Empty> : view === 'cards' ? (
        <div className="cards">
          {rows.map(r => <PlayerCard key={r.player.id} p={r.player} flags={<MarketFlags p={r.player} club={r} />}>{approach(r.player)}</PlayerCard>)}
        </div>
      ) : (
        <PlayerTable players={rows.map(r => r.player)} clubOf={id => rows.find(r => r.player.id === id)} action={approach} />
      )}
      {deal && <Portal><DealDialog ctx={ctx} row={deal} onClose={() => setDeal(null)} /></Portal>}
    </section>
  )
}

function PosFilter({ value, onChange }: { value: Pos | 'ALL'; onChange: (v: Pos | 'ALL') => void }) {
  const { t } = useI18n()
  // the short labels (TM, HV, TV, TĐ) carry their full name as a tooltip
  return <Seg value={value} label={t('lbl.pos')} options={[['ALL', t('all')], ...(['GK', 'DF', 'MF', 'FW'] as Pos[]).map((k): [Pos, JSX.Element] => [k, <span key={k} data-tip={t('posL.' + k)}>{t('pos.' + k)}</span>])]} onChange={onChange} />
}

function PlayerTable({ players, action, badge, clubOf }: {
  players: Player[]; action: (p: Player) => React.ReactNode; badge?: (p: Player) => React.ReactNode; clubOf?: (id: number) => ScoutRow | undefined
}) {
  const { t } = useI18n()
  return (
    <div className="scroll tall">
      <table>
        <thead>
          <tr>
            <th>{t('player')}</th>{clubOf && <th>{t('club')}</th>}<th><Abbr k="pos" /></th><th className="r">{t('age')}</th><th className="r"><Abbr k="ovr" /></th><th className="r"><Abbr k="pot" /></th>
            {ATTRS.map(a => <th key={a} className="r" data-tip={`${t('attr.' + a)}\n${t('attr.' + a + '.d')}`}>{t('attrS.' + a)}</th>)}
            <th className="r">{t('wage')}</th><th className="r">{t('value')}</th><th></th>
          </tr>
        </thead>
        <tbody>
          {players.map(p => {
            const sr = clubOf?.(p.id)
            return (
              <tr key={p.id}>
                <td className="namecell"><div className="pname"><b>{p.name}</b> <span className="muted">· {t('nation.' + p.nation)}</span> {badge ? badge(p) : <TagChip p={p} />} <TraitChips p={p} small />{p.injury > 0 && <span className="inj"><Icon name="injury" size={13} /></span>}</div></td>
                {clubOf && <td className="wrap" style={{ minWidth: 120 }}>{sr?.club}{sr?.starter && <span className="muted"> · {t('starter')}</span>}</td>}
                <td><PosTag p={p.position} role={p.role} /></td>
                <td className="r num">{p.age}</td>
                <td className="r"><Ovr v={p.overall} /></td>
                <td className="r num" style={{ color: p.potential - p.overall >= 8 ? 'var(--good)' : 'var(--muted)' }}>{p.potential}</td>
                {ATTRS.map(a => <td key={a} className="r attr" style={{ color: p[a] >= 80 ? 'var(--good)' : p[a] < 45 ? 'var(--muted)' : undefined }}>{Math.floor(p[a])}</td>)}
                <td className="r num muted">{money(p.wage)}</td>
                <td className="r num"><PriceTag p={p} /></td>
                <td>{action(p)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------- legend catalogue

function Legends({ m, ctx }: { m: MarketView; ctx: Ctx }) {
  const { t } = useI18n()
  const [pos, setPos] = useState<Pos | 'ALL'>('ALL')
  const [q, setQ] = useState('')
  const [onlyMarket, setOnlyMarket] = useState(false)
  const [mine, setMine] = useState(false)
  const clubId = ctx.st.club.id
  const needle = q.trim().toLowerCase()
  // your club's own legends: cards from an era at this club (they come home with +2–3 on every attribute)
  const home = (m.legends ?? []).filter(l => l.clubId === clubId)
  const homeNames = new Map<string, Template[]>()
  for (const l of home) homeNames.set(l.name, [...(homeNames.get(l.name) ?? []), l])
  const homePos = (['GK', 'DF', 'MF', 'FW'] as Pos[]).map(p => [p, new Set(home.filter(l => l.position === p).map(l => l.name)).size] as const)
  const homeSigned = home.filter(l => l.signed).length
  const homeOnMarket = home.filter(l => l.onMarket && !l.signed)
  const byName = new Map<string, Template[]>()
  for (const l of m.legends ?? []) {
    if (mine && l.clubId !== clubId) continue
    if (pos !== 'ALL' && l.position !== pos) continue
    if (needle && !l.name.toLowerCase().includes(needle) && !l.version.toLowerCase().includes(needle)) continue
    if (onlyMarket && !l.onMarket) continue
    byName.set(l.name, [...(byName.get(l.name) ?? []), l])
  }
  return (
    <section className="panel stack">
      <div className="homelegends">
        <div className="row spread">
          <b className="row" style={{ gap: 8 }}><Icon name="home" size={18} /> {t('lg.homeTitle', { club: ctx.st.club.name })}</b>
          <button className={mine ? 'primary small' : 'small'} onClick={() => setMine(!mine)}><Icon name={mine ? 'users' : 'home'} size={14} /> {mine ? t('lg.showAll') : t('lg.showMine')}</button>
        </div>
        {home.length === 0 ? <span className="muted">{t('lg.homeNone')}</span> : (
          <>
            <span className="muted" style={{ fontSize: 13 }}>{t('lg.homeSummary', { n: homeNames.size, c: home.length, s: homeSigned })}</span>
            <div className="row" style={{ gap: 6 }}>
              {homePos.map(([p, n]) => <span key={p} className={'chip' + (n === 0 ? ' bad' : '')}><PosTag p={p} /> {n}</span>)}
            </div>
            {homeOnMarket.length > 0 && <span className="row" style={{ color: 'var(--good)', fontSize: 13, gap: 6 }}><Icon name="star" size={14} /> {t('lg.homeOnMarket', { names: homeOnMarket.map(l => l.name).join(', ') })}</span>}
            <div className="homenames">{[...homeNames.entries()].map(([name, cards]) => (
              <span key={name} className={'chip' + (cards.some(c => c.signed) ? ' special' : '')} data-tip={cards.map(c => `${c.version} · ${c.overall}`).join('\n')}>
                {name} <small className="muted">{t('pos.' + cards[0].position)}</small>
              </span>
            ))}</div>
          </>
        )}
      </div>
      <Hint text={t('lg.help')} />
      <div className="row spread">
        <PosFilter value={pos} onChange={setPos} />
        <div className="row">
          <label className="searchbox"><Icon name="search" size={15} /><input type="search" placeholder={t('lg.search')} aria-label={t('lg.search')} value={q} onChange={e => setQ(e.target.value)} /></label>
          <label className="row checkrow"><input type="checkbox" checked={onlyMarket} onChange={e => setOnlyMarket(e.target.checked)} /> {t('lg.onlyMarket')}</label>
        </div>
      </div>
      <span className="muted">{t('lg.count', { n: byName.size, c: [...byName.values()].reduce((a, x) => a + x.length, 0) })}</span>
      {byName.size === 0 && <Empty icon="legend">{t('mk.none')}</Empty>}
      <div className="grid g3 cards">
        {[...byName.entries()].map(([name, cards]) => {
          const best = Math.max(...cards.map(c => c.overall))
          return (
            <div key={name} className={'legendcard t-' + tierOf(best)}>
              <div className="lg-head">
                <span className={'bigovr small t-' + tierOf(best)}><b className="num">{best}</b></span>
                <div><b>{name}</b><span className="muted">{t('nation.' + cards[0].nation)} · <PosTag p={cards[0].position} /></span></div>
              </div>
              {cards.map(c => (
                <div key={c.id} className="lgver">
                  <span className="ver"><Icon name="star" size={12} /> {c.version}{c.clubId === clubId && <b className="homechip" data-tip={t('icon.home')}> <Icon name="home" size={12} /></b>}</span>
                  <Ovr v={c.overall} />
                  <span className="muted num">{c.age} {t('yrs')} · {money(c.value)}</span>
                  <span className={'chip' + (c.onMarket ? ' special' : '')}>{c.signed ? <><Icon name="check" size={12} /> {t('cu.signed')}</> : c.onMarket ? <><Icon name="buy" size={12} /> {t('cu.onMarket')}</> : <><Icon name="hourglass" size={12} /> {t('cu.waiting')}</>}</span>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- deals

function useQuote(ctx: Ctx, body: object | null) {
  const [q, setQ] = useState<DealQuote | null>(null)
  const key = JSON.stringify(body)
  useEffect(() => {
    if (!body) return
    const h = setTimeout(() => api.quote(ctx.id, body).then(setQ).catch(() => setQ(null)), 220)
    return () => clearTimeout(h)
  }, [key])
  return q
}

function Odds({ q }: { q: DealQuote | null }) {
  const { t } = useI18n()
  if (!q) return <p className="muted">{t('deal.calc')}</p>
  const pct = Math.round(q.chance * 100)
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="eyebrow">{t('deal.chance')}</span>
      <div className="odds"><i style={{ width: pct + '%', background: pct >= 60 ? 'var(--good)' : pct >= 30 ? 'var(--warn)' : 'var(--bad)' }} /><b className="num">{pct}%</b></div>
      <div className="row" style={{ gap: 6 }}>{q.factors.map(f => <span key={f} className={'chip f-' + f}>{t('deal.f.' + f)}</span>)}</div>
      {q.fee > 0 && <span className="muted row" style={{ gap: 6 }}><Icon name="briefcase" size={14} /> {t('deal.fee', { v: money(q.fee) })}</span>}
      {q.blocked && <p className="error">{t('err.' + q.blocked)}</p>}
    </div>
  )
}

function DealDialog({ ctx, row, onClose }: { ctx: Ctx; row: ScoutRow; onClose: () => void }) {
  const { t } = useI18n()
  const p = row.player
  const [type, setType] = useState<'buy' | 'swap'>('buy')
  const [pct, setPct] = useState(100)
  // players on loan from another club can't be part of a swap
  const loanees = new Set(eventsOf(ctx.st)?.loanees ?? [])
  const mine = ctx.st.squad.filter(x => !loanees.has(x.id))
  const [give, setGive] = useState<number>(mine.find(x => x.position === p.position)?.id ?? mine[0]?.id ?? 0)
  const [cash, setCash] = useState(0)
  const [agent, setAgent] = useState(false)
  const [promise, setPromise] = useState(false)
  const [sellOn, setSellOn] = useState(false)
  const [scout, setScout] = useState(false)
  const [give2, setGive2] = useState(0)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<boolean | null>(null)
  const base = p.price || p.value // their asking price this season
  const price = Math.round(base * pct / 100 / 1e4) * 1e4
  const opts = { agent, promise, sellOn, scout }
  const body = type === 'buy'
    ? { type, playerId: p.id, price, ...opts }
    : { type, playerId: p.id, giveId: give, give2Id: give2, price: cash, ...opts }
  const q = useQuote(ctx, body)
  const giveP = ctx.st.squad.find(x => x.id === give)
  useEscape(onClose)

  async function go() {
    setBusy(true)
    try {
      const r = await ctx.run(t('wait.deal'), () => api.deal(ctx.id, body))
      setResult(r.accepted)
      if (r.accepted) revealSigning(p)
      await ctx.reload()
    } catch (e) { ctx.toast(errText(t, e), true) } finally { setBusy(false) }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="card dealcard" onClick={e => e.stopPropagation()}>
        <div className="dealhead">
          <span className={'bigovr t-' + tierOf(p.overall)}><b className="num">{Math.round(p.overall)}</b><PosTag p={p.position} role={p.role} /></span>
          <div style={{ minWidth: 0 }}><span className="eyebrow"><Icon name="building" size={13} /> {row.club}</span><h2>{p.name}</h2>
            <span className="muted">{t('nation.' + p.nation)} · {p.age} {t('yrs')} · {t('lbl.pot')} {p.potential}</span></div>
        </div>
        {result !== null ? (
          <>
            <div className={'verdictbox ' + (result ? 'ok' : 'no')}><Icon name={result ? 'check' : 'close'} size={30} /><p className="big">{result ? t('deal.accepted', { name: p.name }) : t('deal.rejected', { club: row.club })}</p></div>
            <button className="primary" onClick={onClose}>{t('close')}</button>
          </>
        ) : (
          <>
            <Seg value={type} options={[['buy', <><Icon name="money" size={14} /> {t('deal.buy')}</>], ['swap', <><Icon name="market" size={14} /> {t('deal.swap')}</>]]} onChange={setType} />
            {type === 'buy' ? (
              <div className="field">
                <label htmlFor="pr">{t('deal.offer')}: <b className="num gold">{money(price)}</b> <span className="muted">({pct}% {t('deal.ofAsk')} {money(base)})</span></label>
                <input id="pr" type="range" min={60} max={180} step={5} value={pct} style={rangeFill(pct, 60, 180)} onChange={e => setPct(Number(e.target.value))} />
              </div>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="gv">{t('deal.give')}</label>
                  <select id="gv" value={give} onChange={e => setGive(Number(e.target.value))}>
                    {mine.map(x => <option key={x.id} value={x.id}>{x.name} · {t('pos.' + x.position)} {x.overall} · {money(x.value)}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="cs">{cash >= 0 ? t('deal.addCash', { v: money(cash) }) : t('deal.getCash', { v: money(-cash) })}</label>
                  <input id="cs" type="range" min={-Math.round(p.value / 2 / 1e5) * 1e5} max={Math.round(p.value / 1e5) * 1e5} step={100000} value={cash} style={rangeFill(cash, -Math.round(p.value / 2 / 1e5) * 1e5, Math.round(p.value / 1e5) * 1e5)} onChange={e => setCash(Number(e.target.value))} />
                  {giveP && <span className="muted num">{money(giveP.value + (ctx.st.squad.find(x => x.id === give2)?.value ?? 0) + cash)} vs {money(p.value)}</span>}
                </div>
                <div className="field">
                  <label htmlFor="gv2">{t('deal.give2')}</label>
                  <select id="gv2" value={give2} onChange={e => setGive2(Number(e.target.value))}>
                    <option value={0}>{t('deal.none')}</option>
                    {mine.filter(x => x.id !== give).map(x => <option key={x.id} value={x.id}>{x.name} · {x.role} {x.overall} · {money(x.value)}</option>)}
                  </select>
                </div>
              </>
            )}
            <div className="dealopts">
              <b className="row" style={{ gap: 6 }}><Icon name="bonus" size={15} /> {t('deal.boost')}</b>
              <label><input type="checkbox" checked={promise} onChange={e => setPromise(e.target.checked)} /> <Icon name="apps" size={14} /> {t('deal.promise')}</label>
              <label><input type="checkbox" checked={sellOn} onChange={e => setSellOn(e.target.checked)} /> <Icon name="shares" size={14} /> {t('deal.sellOn')}</label>
              <label><input type="checkbox" checked={scout} onChange={e => setScout(e.target.checked)} /> <Icon name="scout" size={14} /> {t('deal.scout', { n: ctx.st.career.tp })}</label>
              <label><input type="checkbox" checked={agent} onChange={e => setAgent(e.target.checked)} /> <Icon name="briefcase" size={14} /> {t('deal.agent')}</label>
            </div>
            <div className="dealfoot">
              <Odds q={q} />
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>{t('deal.oneTry')}</p>
              <div className="row">
                <button className="primary" disabled={busy || !q || !!q.blocked} onClick={go}><Icon name="sign" size={16} /> {busy ? t('wait') : t('deal.submit')}</button>
                <button onClick={onClose}>{t('cancel')}</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export function SellDialog({ ctx, player, onClose }: { ctx: Ctx; player: Player; onClose: () => void }) {
  const { t } = useI18n()
  const [clubs, setClubs] = useState<{ id: number; name: string; color: string; league: string }[]>([])
  const [club, setClub] = useState<number>(0)
  const [pct, setPct] = useState(100)
  const [agent, setAgent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<boolean | null>(null)
  useEffect(() => {
    api.competitions(ctx.id).then(v => {
      const list = v.leagues.flatMap(l => l.table.filter(r => !r.isUser).map(r => ({ id: r.clubId, name: r.name, color: r.color, league: l.code })))
      setClubs(list)
      setClub(list[0]?.id ?? 0)
    })
  }, [ctx.id])
  const base = player.resaleLeft ? Math.min(player.value, player.resaleCap ?? player.value) : player.value // a recent signing goes for at most what you paid
  const price = Math.round(base * pct / 100 / 1e4) * 1e4
  const body = club ? { type: 'sell', playerId: player.id, clubId: club, price, agent } : null
  const q = useQuote(ctx, body)
  useEscape(onClose)
  async function go() {
    if (!body) return
    setBusy(true)
    try {
      const r = await ctx.run(t('wait.deal'), () => api.deal(ctx.id, body))
      setResult(r.accepted)
      await ctx.reload()
    } catch (e) { ctx.toast(errText(t, e), true) } finally { setBusy(false) }
  }
  return (
    <div className="modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="card dealcard" onClick={e => e.stopPropagation()}>
        <div className="dealhead">
          <span className={'bigovr t-' + tierOf(player.overall)}><b className="num">{Math.round(player.overall)}</b><PosTag p={player.position} role={player.role} /></span>
          <div style={{ minWidth: 0 }}><span className="eyebrow"><Icon name="sell" size={13} /> {t('deal.sellTitle')}</span><h2>{player.name}</h2>
            <span className="muted">{t('value')} <b className="num gold">{money(player.value)}</b></span></div>
        </div>
        {!!player.resaleLeft && <p className="warnline"><Icon name="lock" size={14} /> {t('deal.recentCap', { n: player.resaleLeft, v: money(player.resaleCap ?? 0) })}</p>}
        {result !== null ? (
          <>
            <div className={'verdictbox ' + (result ? 'ok' : 'no')}><Icon name={result ? 'check' : 'close'} size={30} /><p className="big">{result ? t('deal.sold', { name: player.name, v: money(price) }) : t('deal.noSale')}</p></div>
            <button className="primary" onClick={onClose}>{t('close')}</button>
          </>
        ) : (
          <>
            <div className="field">
              <label htmlFor="sc">{t('deal.toClub')}</label>
              <select id="sc" value={club} onChange={e => setClub(Number(e.target.value))}>
                {clubs.map(c => <option key={c.id} value={c.id}>{c.league} · {c.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="sp">{t('deal.ask')}: <b className="num gold">{money(price)}</b> <span className="muted">({pct}%)</span></label>
              <input id="sp" type="range" min={50} max={170} step={5} value={pct} style={rangeFill(pct, 50, 170)} onChange={e => setPct(Number(e.target.value))} />
            </div>
            <label className="row checkrow"><input type="checkbox" checked={agent} onChange={e => setAgent(e.target.checked)} /> <Icon name="briefcase" size={14} /> {t('deal.agent')}</label>
            <Odds q={q} />
            <Hint text={t('deal.sellHelp')} />
            <div className="row">
              <button className="primary" disabled={busy || !q || !!q.blocked} onClick={go}><Icon name="sell" size={16} /> {busy ? t('wait') : t('deal.offerTo')}</button>
              <button onClick={onClose}>{t('cancel')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- custom players

const NATIONS = ['EN', 'ES', 'FR', 'DE', 'IT', 'BR', 'AR', 'PT', 'NL', 'BE', 'JP', 'KR', 'NG', 'VN', 'US']

function Custom({ ctx, m, reload }: { ctx: Ctx; m: MarketView; reload: () => void }) {
  const { t } = useI18n()
  const [f, setF] = useState({ name: '', nation: 'EN', age: 20, position: 'FW' as Pos, pace: 75, shooting: 75, passing: 65, dribbling: 72, defending: 35, physical: 68, goalkeeping: 20, potential: 88, clubId: 0 })
  // clubs he can belong to (team colour): yours first, then every club with legends of its own
  const clubOpts = (() => {
    const seen = new Map<number, string>([[ctx.st.club.id, ctx.st.club.name]])
    for (const l of m.legends ?? []) if (l.clubId && l.clubName && !seen.has(l.clubId)) seen.set(l.clubId, l.clubName)
    const [mine, ...rest] = [...seen.entries()]
    return [mine, ...rest.sort((a, b) => a[1].localeCompare(b[1]))]
  })()
  const [busy, setBusy] = useState(false)
  const ovr = Math.round(overallAs(f, f.position))
  const pot = Math.max(f.potential, ovr)
  async function create() {
    setBusy(true)
    try {
      await api.createTemplate(ctx.id, { ...f, clubId: f.clubId || null })
      await reload()
      ctx.toast(t('cu.created', { name: f.name }))
      setF({ ...f, name: '' })
    } catch (e) { ctx.toast(errText(t, e), true) } finally { setBusy(false) }
  }
  // the live preview is an ordinary player card fed with the form values
  const preview: Player = {
    id: 0, clubId: null, templateId: null, name: f.name.trim() || t('cu.namePh'), nation: f.nation, age: f.age, position: f.position,
    pace: f.pace, shooting: f.shooting, passing: f.passing, dribbling: f.dribbling, defending: f.defending, physical: f.physical, goalkeeping: f.goalkeeping,
    potential: pot, fitness: 100, morale: 100, focus: 'balanced', injury: 0, unrest: 0, traits: null, traitsKnown: false, hiddenTraits: 0, tenure: 0, history: [],
    shirt: 0, retired: false, tag: '', role: '', version: '', overall: ovr, value: 0, wage: 0,
  }
  const clubName = clubOpts.find(([id]) => id === f.clubId)?.[1]
  return (
    <div className="stack" style={{ gap: 18 }}>
      <section className="panel creator">
        <div className="cr-form">
          <Title icon="plus">{t('cu.title')}</Title>
          <Hint text={t('cu.help')} />
          <div className="formgrid">
            <div className="field f-2"><label htmlFor="cn"><Icon name="user" size={13} /> {t('cu.name')}</label><input id="cn" value={f.name} maxLength={30} placeholder={t('cu.namePh')} onChange={e => setF({ ...f, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="cna"><Icon name="flag" size={13} /> {t('cu.nation')}</label>
              <select id="cna" value={f.nation} onChange={e => setF({ ...f, nation: e.target.value })}>{NATIONS.map(n => <option key={n} value={n}>{t('nation.' + n)}</option>)}</select>
            </div>
            <div className="field f-wide" data-tip={t('cu.clubHelp')}><label htmlFor="ccl"><Icon name="building" size={13} /> {t('cu.club')}</label>
              <select id="ccl" value={f.clubId} onChange={e => setF({ ...f, clubId: Number(e.target.value) })}>
                <option value={0}>{t('cu.noClub')}</option>
                {clubOpts.map(([id, name]) => <option key={id} value={id}>{name}{id === ctx.st.club.id ? ` (${t('mc.you')})` : ''}</option>)}
              </select>
            </div>
            <div className="field f-wide"><span className="flabel"><Icon name="apps" size={13} /> {t('lbl.pos')}</span>
              <div className="posbtns" role="group" aria-label={t('lbl.pos')}>
                {(['GK', 'DF', 'MF', 'FW'] as Pos[]).map(p => (
                  <button key={p} type="button" className={'posbtn ' + p} aria-pressed={f.position === p} onClick={() => setF({ ...f, position: p })}>
                    <b>{t('pos.' + p)}</b><small>{t('posL.' + p)}</small>
                  </button>
                ))}
              </div>
            </div>
            <div className="field"><label htmlFor="ca"><Icon name="calendar" size={13} /> {t('age')}: <b className="num">{f.age}</b></label><input id="ca" type="range" min={16} max={38} value={f.age} style={rangeFill(f.age, 16, 38)} onChange={e => setF({ ...f, age: Number(e.target.value) })} /></div>
            <div className="field f-2"><label htmlFor="cpo"><Icon name="up" size={13} /> {t('lbl.pot')}: <b className="num">{pot}</b></label><input id="cpo" type="range" min={40} max={99} value={f.potential} style={rangeFill(f.potential, 40, 99)} onChange={e => setF({ ...f, potential: Number(e.target.value) })} /></div>
          </div>
          <div className="attrsliders">
            {ATTRS.map(a => {
              const v = f[a]
              return (
                <div key={a} className="attrslider">
                  <label htmlFor={'ca-' + a}><Icon name={a} size={15} /> {t('attr.' + a)}</label>
                  <input id={'ca-' + a} type="range" min={20} max={95} value={v} onChange={e => setF({ ...f, [a]: Number(e.target.value) })}
                    style={rangeFill(v, 20, 95)} data-tip={`${t('attr.' + a)}\n${t('attr.' + a + '.d')}`} />
                  <b className={'valbadge num ' + (v >= 80 ? 'hi' : v >= 65 ? 'mid' : v < 45 ? 'lo' : '')}>{v}</b>
                </div>
              )
            })}
          </div>
        </div>
        <aside className="cr-preview">
          <span className="eyebrow"><Icon name="eye" size={13} /> {t('cu.preview')}</span>
          <PlayerCard p={preview} foot={<><span className="muted">{t('lbl.ovr')} <b className="num pc-val">{ovr}</b></span><span className="muted" style={{ marginLeft: 'auto' }}>{t('lbl.pot')} <b className="num pc-val">{pot}</b></span></>}
            flags={clubName ? <span className="pc-flagrow"><span className="flag club"><Icon name="building" size={12} /> {clubName}</span></span> : undefined} />
          <button className="primary big" disabled={busy || f.name.trim().length < 2} onClick={create}><Icon name="plus" size={18} /> {t('cu.create')}</button>
          {f.name.trim().length < 2 && <small className="muted">{t('cu.needName')}</small>}
        </aside>
      </section>
      <section className="panel stack">
        <Title icon="users">{t('cu.mine', { n: m.templates.length })}</Title>
        {m.templates.length === 0 && <Empty icon="user">{t('cu.none')}</Empty>}
        <div className="tplcards cards">
          {m.templates.map(tp => (
            <div key={tp.id} className={'tplcard t-' + tierOf(tp.overall)}>
              <Ovr v={tp.overall} />
              <div className="tpl-id">
                <b>{tp.name}</b>
                <span className="muted"><PosTag p={tp.position} /> {t('nation.' + tp.nation)} · {t('age.years', { n: tp.age })} · {money(tp.value)}</span>
                <span className="row" style={{ gap: 4 }}>
                  {tp.clubName && <span className={'chip' + (tp.clubId === ctx.st.club.id ? ' special' : '')} data-tip={t('cu.clubHelp')}><Icon name="home" size={12} /> {tp.clubName}</span>}
                  {tp.signed ? <span className="chip"><Icon name="check" size={12} /> {t('cu.signed')}</span> : tp.onMarket ? <span className="chip special"><Icon name="buy" size={12} /> {t('cu.onMarket')}</span> : <span className="chip"><Icon name="hourglass" size={12} /> {t('cu.waiting')}</span>}
                </span>
              </div>
              {!tp.signed && <ConfirmButton className="small danger" label={<Icon name="trash" size={14} title={t('delete')} />} confirm={t('delete')} onConfirm={async () => { await api.deleteTemplate(ctx.id, tp.id); reload() }} />}
            </div>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>{t('cu.note')}</p>
      </section>
    </div>
  )
}

/** Asking price, flagged when it is far from the player's real value: a bargain or hype. */
function PriceTag({ p }: { p: Player }) {
  const { t } = useI18n()
  const price = p.price || p.value
  const r = price / Math.max(1, p.value)
  return (
    <span data-tip={t('mk.valueIs', { v: money(p.value) })}>
      <b style={{ color: r < 0.88 ? 'var(--good)' : r > 1.25 ? 'var(--bad)' : undefined }}>{money(price)}</b>
      {r < 0.88 && <small className="pricetag good"> {t('mk.bargain')}</small>}
      {r > 1.25 && <small className="pricetag bad"> {t('mk.hype')}</small>}
    </span>
  )
}
