import { useCallback, useEffect, useState } from 'react'
import type { Ctx } from '../App'
import { api, money } from '../api'
import type { CommercialView, FinanceView, Quest, SharesInfo } from '../types'
import { CardFace } from './Inbox'
import { Bar, ConfirmButton, Loading, Seg, Hint, Icon, FIN_ICON, Kpi, CountUp, fmtMoney, PageHead, Title, Pips, Empty, rangeFill, StadiumArt, type IconName } from '../ui'
import { errText, useI18n } from '../i18n'
import { FanFinance } from './club/FanFinance'

const QUEST_ICON: Record<string, IconName> = { beat_stronger: 'attack', clean_sheets: 'cleanSheet', goals_match: 'goal', goals_total: 'goal', hattrick: 'match', high_rating: 'rating', live_wins: 'playNow', sign_young: 'hire', win_away: 'flame', win_cup_match: 'prize', win_streak: 'flame' }
const INCOME = ['shares_sold', 'tickets', 'tv', 'ads', 'merch', 'sponsor', 'sponsor_bonus', 'hot_bonus', 'sponsor_target', 'board_reward', 'takeover', 'card', 'signing_bonus', 'friendly_fee', 'prize', 'quest', 'transfer_out', 'forced_sale', 'loan', 'derby_gate', 'loan_fee_out', 'achievement', 'golden', 'tour']
const COSTS = ['wages', 'staff', 'dividend', 'shares_bought', 'upkeep', 'board_fine', 'sponsor_exit', 'takeover_exit', 'loan_payment', 'loan_repay', 'facility', 'tp_buy', 'transfer_in', 'staff_hire', 'agent_fee', 'swap_cash', 'loan_fee_in', 'loan_breach', 'scouting', 'tour_cost']

export default function Finance({ ctx }: { ctx: Ctx }) {
  const { t } = useI18n()
  const [f, setF] = useState<FinanceView | null>(null)
  const [quests, setQuests] = useState<Quest[]>([])
  const [cv, setCv] = useState<CommercialView | null>(null)
  const load = useCallback(() => {
    api.finance(ctx.id).then(setF).catch(e => ctx.toast(errText(t, e), true))
    api.commercial(ctx.id).then(setCv).catch(() => {})
    api.quests(ctx.id).then(setQuests).catch(() => {})
  }, [ctx.id, ctx.st.career.day])
  useEffect(() => { load() }, [load])

  async function act(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn()
      load()
      await ctx.reload()
      ctx.toast(ok)
    } catch (e) { ctx.toast(errText(t, e), true) }
  }

  async function claim(q: Quest) {
    try {
      const r = await api.claim(ctx.id, q.id)
      load()
      await ctx.reload()
      ctx.toast(t('q.claimed', { v: money(r.reward) }))
    } catch (e) { ctx.toast(errText(t, e), true) }
  }

  if (!f) return <Loading />
  const income = INCOME.map(k => [k, f.totals[k] ?? 0] as const).filter(([, v]) => v !== 0)
  const costs = COSTS.map(k => [k, f.totals[k] ?? 0] as const).filter(([, v]) => v !== 0)
  const totalIn = income.reduce((a, [, v]) => a + v, 0)
  const totalOut = costs.reduce((a, [, v]) => a + v, 0)
  const maxAbs = Math.max(1, ...income.map(([, v]) => Math.abs(v)), ...costs.map(([, v]) => Math.abs(v)))

  return (
    <>
      <PageHead icon="finance" eyebrow={t('seasonN', { n: ctx.st.career.season })} title={t('tab.finance')} />

      <div className="kpis">
        <Kpi icon="budget" label={t('budget')} tone={f.budget < 0 ? 'bad' : 'gold'}><CountUp v={f.budget} fmt={fmtMoney} /></Kpi>
        <Kpi icon="wages" label={t('fin.weeklyCost')}>−<CountUp v={f.wages + f.staff} fmt={fmtMoney} /></Kpi>
        <Kpi icon="up" label={t('fin.totalIn')} tone="good">+<CountUp v={totalIn} fmt={fmtMoney} /></Kpi>
        <Kpi icon="down" label={t('fin.totalOut')} tone="bad"><CountUp v={totalOut} fmt={fmtMoney} /></Kpi>
        <Kpi icon="total" label={t('rep.net')} tone={totalIn + totalOut >= 0 ? 'good' : 'bad'}>{totalIn + totalOut >= 0 ? '+' : ''}<CountUp v={totalIn + totalOut} fmt={fmtMoney} /></Kpi>
      </div>

      <div className="grid g2" style={{ alignItems: 'start' }}>
        <section className="panel stack">
          <Title icon="quest">{t('quests')}</Title>
          <Hint text={t('q.help')} />
          {quests.length === 0 && <Empty icon="quest">{t('q.none')}</Empty>}
          {quests.map(q => (
            <div key={q.id} className={'quest' + (q.status === 'done' ? ' done' : '')}>
              <span className="qico"><Icon name={q.status === 'done' ? 'check' : QUEST_ICON[q.kind] ?? 'quest'} size={20} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b>{t('quest.' + q.kind, { n: q.target })}</b>
                <div className="row" style={{ flexWrap: 'nowrap' }}><div style={{ flex: 1 }}><Bar v={q.progress} max={q.target} color="var(--club)" /></div><span className="num muted">{q.progress}/{q.target}</span></div>
              </div>
              {q.status === 'done'
                ? <button className="primary" onClick={() => claim(q)}><Icon name="handCoins" size={16} /> {t('q.claim', { v: money(q.reward) })}</button>
                : <b className="num reward"><Icon name="coins" size={15} /> {money(q.reward)}</b>}
            </div>
          ))}
        </section>

        <section className="panel stack">
          <div className="row spread"><Title icon="board">{t('board.title')}</Title>{cv?.board && <span className={'chip' + (cv.board.result === 'met' ? ' special' : '')}>{cv.board.result ? t('board.' + cv.board.result) : t('board.open')}</span>}</div>
          {cv?.board && (
            <>
              <div className="boardgoal">
                <Icon name="quest" size={34} strokeWidth={1.6} />
                <div><b>{t('goal.' + cv.board.goal)}</b><span className="num">{t('board.now', { p: cv.position || '–', e: cv.expected })}</span></div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <span className="flag good"><Icon name="prize" size={12} /> +{money(cv.board.reward)}</span>
                <span className="flag bad"><Icon name="fine" size={12} /> −{money(cv.board.fine)}</span>
              </div>
            </>
          )}
          <div className="row spread" data-tip={t('fin.merchHelp')}><span className="row" style={{ gap: 6 }}><Icon name="merch" size={16} /> {t('fin.merch')}</span><b className="num" style={{ color: 'var(--hot)' }}>{money(cv?.merch ?? 0)}/{t('wk').trim()}</b></div>
          {cv?.takeover && cv.takeover.status === 'active' && <span className="chip"><Icon name="briefcase" size={13} /> {t('to.activeTitle', { name: cv.takeover.investor })} · {t('goal.' + cv.takeover.goal)} · {t('seasonN', { n: cv.takeover.deadline })}</span>}
          <details className="helpbox earn">
            <summary><Icon name="info" size={15} /> {t('fin.howEarn')}</summary>
            <ul className="iconlist">
              {([['tickets', 'tickets'], ['tv', 'tv'], ['ads', 'ads'], ['prize', 'prize'], ['friendly', 'handCoins']] as [string, IconName][]).map(([k, ic]) => <li key={k}><Icon name={ic} size={16} /><span>{t('fin.h.' + k)}</span></li>)}
            </ul>
          </details>
        </section>
      </div>

      <section className="panel stack">
        <Title icon="sponsor">{t('fin.sponsors')}</Title>
        <Hint text={t('fin.sponsorsHelp')} />
        <div className="grid g3">
          {cv?.slots.map(sl => (
            <div key={sl.slot} className="sponsorslot">
              <div className="row spread"><b className="slotname"><Icon name={sl.sponsor ? 'verified' : 'plus'} size={15} /> {t('slot.' + sl.slot)}</b>{sl.sponsor && <span className="chip">{t('sp.' + sl.sponsor.kind)}</span>}</div>
              {sl.sponsor ? (
                <>
                  <b style={{ fontSize: 17 }}>{sl.sponsor.name}</b>
                  <div className="kv num" style={{ fontSize: 13 }}>
                    <span>{t('fin.weeklyPay')}</span><b>{money(sl.sponsor.weekly)}</b>
                    <span>{t('fin.winBonus')}</span><b>{money(sl.sponsor.winBonus)}</b>
                    <span>{t('fin.goalBonus')}</span><b>{money(sl.sponsor.goalBonus)}</b>
                    <span>{t('fin.target')}</span><b>{t('goal.' + sl.sponsor.target)} +{money(sl.sponsor.targetBonus)}</b>
                    {sl.sponsor.minPos > 0 && <><span>{t('fin.clause')}</span><b style={{ color: sl.sponsor.strikes ? 'var(--bad)' : undefined }}>{t('fin.clauseV', { p: sl.sponsor.minPos })}{sl.sponsor.strikes ? <> · <Icon name="warn" size={13} /> {sl.sponsor.strikes}/3</> : null}</b></>}
                    <span>{t('fin.left')}</span><b>{t('fin.seasons', { n: sl.sponsor.seasonsLeft })}</b>
                  </div>
                  <ConfirmButton className="small danger" label={t('fin.cancel', { v: money(sl.sponsor.exit) })} confirm={t('fin.cancelConfirm', { v: money(sl.sponsor.exit) })}
                    onConfirm={() => act(() => api.comAct(ctx.id, { action: 'cancel', slot: sl.slot }), t('fin.cancelled'))} />
                </>
              ) : (
                <>
                  <span className="flag warn" style={{ width: 'fit-content' }}><Icon name="warn" size={12} /> {t('fin.slotEmpty')}</span>
                  {(sl.offers ?? []).map((o, i) => (
                    <div key={i} className="offer small">
                      <div className="row spread"><b>{o.name}</b><span className="chip">{t('sp.' + o.kind)}</span></div>
                      <span className="num">{money(o.weekly)}/{t('wk').trim()} · {t('fin.signing')} {money(o.signing)}</span>
                      <span className="muted num" style={{ fontSize: 12 }}>{t('fin.target')}: {t('goal.' + o.target)} +{money(o.targetBonus)}{o.minPos ? ` · ${t('fin.clauseV', { p: o.minPos })}` : ''} · {t('fin.seasons', { n: o.seasonsLeft })}</span>
                      <button className="primary small" onClick={() => act(() => api.comAct(ctx.id, { action: 'sign', slot: sl.slot, index: i }), t('fin.signed'))}><Icon name="sign" size={14} /> {t('fin.sign')}</button>
                    </div>
                  ))}
                </>
              )}
            </div>
          ))}
        </div>
      </section>

      {(cv?.log.length ?? 0) > 0 && (
        <section className="panel stack">
          <Title icon="card">{t('fin.cards')}</Title>
          <div className="cardlog">{cv!.log.map((cd, i) => <CardFace key={i} cd={cd} />)}</div>
        </section>
      )}

      <section className="panel stack">
        <div className="row spread">
          <Title icon="facility">{t('dev.title')}</Title>
          <span className="chip num"><Icon name="upkeep" size={13} /> {t('dev.upkeep', { v: money(f.upkeep) })}</span>
        </div>
        <StadiumArt stadium={f.facilities.find(x => x.kind === 'stadium')?.level ?? 1} training={f.facilities.find(x => x.kind === 'training')?.level ?? 1}
          academy={f.facilities.find(x => x.kind === 'academy')?.level ?? 1} medical={f.facilities.find(x => x.kind === 'medical')?.level ?? 1} color={ctx.st.club.color} color2={ctx.st.club.color2} />
        <Hint text={t('sa.hint')} />
        <div className="grid g4 cards facgrid">
          {f.facilities.map(fc => (
            <div key={fc.kind} className={'facility' + (fc.next > 0 ? '' : ' maxed')}>
              <div className="fac-art"><Icon name={fc.kind} size={44} strokeWidth={1.5} /><span className="fac-lvl num">{fc.level}</span></div>
              <b>{t('dev.' + fc.kind)}</b>
              <div className="row spread"><Pips n={fc.level} max={fc.max} big /><span className="lvl num">{t('dev.level', { n: fc.level, m: fc.max })}</span></div>
              <Hint text={t('dev.' + fc.kind + '.does', { n: fc.level })} />
              {fc.level > 1 && (fc.until ?? 0) > 0 && (() => {
                // how long the level holds: calm while there is time, a warning in its last season
                const left = (fc.until ?? 0) - ctx.st.career.season
                const tone = left >= 2 ? 'good' : left === 1 ? 'warn' : 'bad'
                return <span className={'flag ' + tone} style={{ whiteSpace: 'normal' }}><Icon name="hourglass" size={12} /> {left <= 0 ? t('dev.holdsLast') : t('dev.holds', { n: fc.level, s: fc.until ?? 0 })}</span>
              })()}
              {fc.next > 0
                ? <ConfirmButton className="primary small" label={<><Icon name="up" size={14} /> {t('dev.upgrade', { v: money(fc.next) })}</>} confirm={t('confirm')} disabled={fc.next > f.budget}
                    onConfirm={() => act(() => api.upgradeFacility(ctx.id, fc.kind), t('dev.upgraded'))} />
                : <span className="chip special"><Icon name="crown" size={13} /> {t('dev.max')}</span>}
              {(fc.renew ?? 0) > 0 && (
                <ConfirmButton className={'small' + (fc.next > 0 ? '' : ' primary')} label={<><Icon name="upkeep" size={14} /> {t('dev.renovate', { v: money(fc.renew ?? 0) })}</>}
                  confirm={t('dev.renovateConfirm', { n: 3 })} disabled={(fc.renew ?? 0) > f.budget}
                  onConfirm={() => act(() => api.renovateFacility(ctx.id, fc.kind), t('dev.renovated', { n: 3 }))} />
              )}
            </div>
          ))}
        </div>
      </section>

      <div className="grid g3" style={{ alignItems: 'start' }}>
        <section className="panel stack">
          <Title icon="tickets">{t('tk.title')}</Title>
          <Seg value={f.ticket || 'normal'} options={[['low', t('tk.low')], ['normal', t('tk.normal')], ['high', t('tk.high')]]}
            onChange={v => act(() => api.setTicket(ctx.id, v), t('saved'))} />
          <span className="muted" style={{ fontSize: 13 }}>{t('tk.help')}</span>
        </section>
        <FanFinance ctx={ctx} />{/* club stream: the fans' mood and the crowd, next to the ticket price */}
        <section className="panel stack">
          <Title icon="loan">{t('ln.title')}</Title>
          {f.loan ? (
            <>
              <div className="kv num">
                <span>{t('ln.amount')}</span><b>{money(f.loan.amount)}</b>
                <span>{t('ln.weekly')}</span><b>−{money(f.loan.weekly)}</b>
                <span>{t('ln.left')}</span><b>{t('ln.weeks', { n: f.loan.weeksLeft })}</b>
              </div>
              <ConfirmButton className="small" label={t('ln.repay', { v: money(f.loan.weekly * f.loan.weeksLeft) })} confirm={t('confirm')}
                disabled={f.loan.weekly * f.loan.weeksLeft > f.budget} onConfirm={() => act(() => api.repayLoan(ctx.id), t('ln.repaid'))} />
            </>
          ) : (
            <>
              <span className="muted" style={{ fontSize: 13 }}>{t('ln.help2')}</span>
              <div className="loanopts">
                {(f.loanOptions ?? []).map(o => (
                  <div key={o.amount} className="loanopt">
                    <b className="num">{money(o.amount)}</b>
                    <span className="muted num">{Math.round(o.rate * 100)}% · −{money(o.weekly)}/{t('wk').trim()} · {t('ln.weeks', { n: o.weeks })}</span>
                    <ConfirmButton className="small" label={<><Icon name="handCoins" size={13} /> {t('ln.borrow')}</>} confirm={t('ln.take', { v: money(o.amount) })} onConfirm={() => act(() => api.takeLoan(ctx.id, o.amount), t('ln.taken'))} />
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
        {f.shares && <SharesPanel ctx={ctx} sv={f.shares} reload={load} />}
        <section className="panel stack">
          <Title icon="tp">{t('tp.title')}</Title>
          <div className="tpbig num"><Icon name="tp" size={30} /> <CountUp v={f.tp} /> <small>TP</small></div>
          <span className="muted" style={{ fontSize: 13 }}>{t('tp.help')}</span>
          <span className="muted" style={{ fontSize: 13 }}>{t('tp.left', { n: f.tpBuyLeft ?? 0, m: f.tpBuyMax ?? 30 })}</span>
          <div className="row">
            {[1, 5, 10].map(n => (
              <button key={n} className="small" disabled={n * f.tpPrice > f.budget || n > (f.tpBuyLeft ?? 0)} onClick={() => act(() => api.buyTP(ctx.id, n), t('tp.bought', { n }))}>
                <Icon name="plus" size={12} />{n} <Icon name="tp" size={12} /> · {money(n * f.tpPrice)}
              </button>
            ))}
          </div>
        </section>
      </div>

      <div className="grid g2" style={{ alignItems: 'start' }}>
        <section className="panel stack">
          <Title icon="receipt">{t('fin.season')}</Title>
          {totalIn - totalOut !== 0 && (
            <div className="cashsplit" aria-hidden="true">
              <i className="in" style={{ flex: Math.max(1, totalIn) }} /><i className="out" style={{ flex: Math.max(1, -totalOut) }} />
            </div>
          )}
          <div className="ledger">
            {income.length === 0 && costs.length === 0 && <Empty icon="receipt">{t('noGamesYet')}</Empty>}
            {income.map(([k, v]) => <Line key={k} k={k} label={t('fin.' + k)} v={v} max={maxAbs} />)}
            {income.length > 0 && <div className="ledger-total"><span><Icon name="up" size={15} /> {t('fin.totalIn')}</span><b className="num" style={{ color: 'var(--good)' }}>+{money(totalIn)}</b></div>}
            {costs.map(([k, v]) => <Line key={k} k={k} label={t('fin.' + k)} v={v} max={maxAbs} />)}
            {costs.length > 0 && <div className="ledger-total"><span><Icon name="down" size={15} /> {t('fin.totalOut')}</span><b className="num" style={{ color: 'var(--bad)' }}>{money(totalOut)}</b></div>}
            <div className="ledger-total big"><span><Icon name="total" size={16} /> {t('rep.net')}</span><b className="num" style={{ color: totalIn + totalOut >= 0 ? 'var(--good)' : 'var(--bad)' }}>{totalIn + totalOut >= 0 ? '+' : ''}{money(totalIn + totalOut)}</b></div>
          </div>
        </section>
        <section className="panel">
          <Title icon="clock" className="mb8">{t('fin.recent')}</Title>
          {f.entries.length === 0 && <Empty icon="receipt">{t('noGamesYet')}</Empty>}
          <div className="txlist">
            {f.entries.map((e, i) => (
              <div key={i} className={'tx ' + (e.amount < 0 ? 'neg' : 'pos')}>
                <span className="txico"><Icon name={FIN_ICON[e.kind] ?? 'coins'} size={15} /></span>
                <span className="txname">{t('fin.' + e.kind)}<small className="muted">{e.day > 54 ? t('offseason') : `${t('dayShort')}${e.day}`}</small></span>
                <b className="num">{e.amount > 0 ? '+' : ''}{money(e.amount)}</b>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  )
}

function Line({ k, label, v, max }: { k: string; label: string; v: number; max: number }) {
  return (
    <div className={'ledger-line ' + (v < 0 ? 'neg' : 'pos')}>
      <span><Icon name={FIN_ICON[k] ?? 'coins'} size={15} /> {label}</span>
      <div className="bar"><i style={{ width: `${(Math.abs(v) / max) * 100}%`, background: v < 0 ? 'var(--bad)' : 'var(--good)' }} /></div>
      <b className="num">{v > 0 ? '+' : ''}{money(v)}</b>
    </div>
  )
}

function SharesPanel({ ctx, sv, reload }: { ctx: Ctx; sv: SharesInfo; reload: () => void }) {
  const { t } = useI18n()
  const [offer, setOffer] = useState(sv.ask || sv.fair)
  const [ask, setAsk] = useState(sv.ask)
  async function run(body: Parameters<typeof api.comAct>[1], ok?: string) {
    try {
      const r = await api.comAct(ctx.id, body) as { ask?: number; outcome?: string }
      if (r.ask) { setAsk(r.ask); if (!offer || offer < r.ask * 0.8) setOffer(Math.round(r.ask * 0.9 / 1e5) * 1e5) }
      if (r.outcome === 'bought') ctx.toast(t('sh.bought'))
      else if (r.outcome === 'countered') ctx.toast(t('sh.countered', { v: money(r.ask ?? 0) }), true)
      else if (r.outcome === 'final') ctx.toast(t('sh.final', { v: money(r.ask ?? 0) }), true)
      else if (ok) ctx.toast(ok)
      reload()
      await ctx.reload()
    } catch (e) { ctx.toast(errText(t, e), true) }
  }
  return (
    <section className="panel stack">
      <Title icon="shares">{t('sh.title')}</Title>
      <span className="muted" style={{ fontSize: 13 }}>{t('sh.help')}</span>
      <div className="kv num">
        <span>{t('sh.valuation')}</span><b>{money(sv.valuation)}</b>
        <span>{t('sh.sold')}</span><b style={{ color: sv.sold ? 'var(--warn)' : undefined }}>{sv.sold}%</b>
        <span>{t('sh.dividend')}</span><b>{Math.round(sv.dividend * 100)}% {t('sh.ofRevenue')}</b>
        <span>{t('sh.raised')}</span><b>{money(sv.raised)}</b>
      </div>
      <div className="row">
        <ConfirmButton className="small" disabled={sv.sold + 10 > 49} label={t('sh.sell', { v: money(sv.sellPrice) })} confirm={t('sh.sellConfirm')}
          onConfirm={() => run({ action: 'sell_shares' }, t('sh.soldOk'))} />
      </div>
      {sv.sold > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <b>{t('sh.buyTitle')}</b>
          {ask ? <span className="num">{t('sh.ask', { v: money(ask), f: money(sv.fair) })}{sv.tries ? ` · ${t('sh.tries', { n: 3 - sv.tries })}` : ''}</span>
            : <button className="small" onClick={() => run({ action: 'buyback', amount: 0 })}>{t('sh.quote')}</button>}
          {ask > 0 && (
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input type="range" min={Math.round(sv.fair * 0.9)} max={ask} step={100000} value={Math.min(ask, Math.max(Math.round(sv.fair * 0.9), offer))} onChange={e => setOffer(Number(e.target.value))} style={{ flex: 1, ...rangeFill(Math.min(ask, Math.max(Math.round(sv.fair * 0.9), offer)), Math.round(sv.fair * 0.9), ask) }} aria-label={t('dem.offer')} />
              <button className="primary small" onClick={() => run({ action: 'buyback', amount: offer })}>{t('dem.offerBtn', { v: money(offer) })}</button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
