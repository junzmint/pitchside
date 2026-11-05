import { useState } from 'react'
import type { Ctx } from '../App'
import { money } from '../api'
import type { CareerState } from '../types'
import { eventsApi, eventsOf, type Award, type EventReq, type EventsView, type Happening, type LoanMarket, type Prospect } from '../api_events'
import { Abbr, Bar, ConfirmButton, Hint, Icon, Ovr, PlayerCard, PosTag, Seg, Title } from '../ui'
import { showReveal } from '../reveal'
import { errText, useI18n, type TFn } from '../i18n'

// Events work stream: decisions that land in the Inbox (press conferences, playing-time talks,
// youth intake, transfer bids, loans …). Rendered inside the Inbox page.
export function EventsInbox({ ctx }: { ctx: Ctx }) {
  const ev = eventsOf(ctx.st)
  if (!ev || ctx.st.career.ended) return null
  return (
    <div className="events stack">
      <ManagerLevel ev={ev} />
      <PressPanel ctx={ctx} ev={ev} />
      <TalksPanel ctx={ctx} ev={ev} />
      <BidsPanel ctx={ctx} ev={ev} />
      <YouthPanel ctx={ctx} ev={ev} />
      <LoansPanel ctx={ctx} ev={ev} />
      <AwardsPanel ev={ev} />
      <ClubLog ev={ev} />
    </div>
  )
}

/** How many event items are waiting for an answer (adds to the Inbox badge). */
export function eventsCount(st: CareerState): number {
  return eventsOf(st)?.waiting ?? 0
}

/** One line of the day report / club log. */
export function happeningText(t: TFn, h: { key: string; name?: string; amount?: number }) {
  return t('ev.' + h.key, { name: h.name ?? '', v: money(Math.abs(h.amount ?? 0)), n: h.amount ?? 0 })
}

const BAD = ['loss', 'broken', 'timeout', 'wait', 'expired', 'walked', 'breach', 'injury', 'gone']
export function happeningTone(key: string) {
  if (key.startsWith('med_wait')) return 'warn' // a reminder that decisions are waiting, not bad news
  return BAD.some(b => key.includes(b)) ? 'bad' : key.startsWith('talk_new') || key.startsWith('bid_new') || key === 'youth_day' ? 'warn' : 'good'
}

function useAct(ctx: Ctx) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  async function act(body: EventReq, ok?: (r: Awaited<ReturnType<typeof eventsApi.act>>) => string, bad?: boolean) {
    setBusy(true)
    try {
      const r = await eventsApi.act(ctx.id, body)
      if (ok) ctx.toast(ok(r), bad)
      await ctx.reload()
    } catch (e) { ctx.toast(errText(t, e), true) } finally { setBusy(false) }
  }
  return { busy, act }
}

export function ManagerLevel({ ev, compact }: { ev: EventsView; compact?: boolean }) {
  const { t } = useI18n()
  const span = Math.max(1, ev.nextXp - ev.levelXp)
  const into = ev.xp - ev.levelXp
  const pk = ev.perks
  const perks = [
    pk.bidBonus > 0 && t('evp.bid', { p: Math.round(pk.bidBonus * 100) }),
    pk.counterBonus > 0 && t('evp.counter', { p: Math.round(pk.counterBonus * 100) }),
    pk.loanDiscount > 0 && t('evp.loan', { p: Math.round(pk.loanDiscount * 100) }),
    pk.youthBonus > 0 && t('evp.youth', { n: pk.youthBonus }),
  ].filter(Boolean) as string[]
  return (
    <section className={'panel mgrlevel' + (compact ? ' compact' : '')}>
      <div className="row spread">
        <b className="row" style={{ gap: 6 }}><Icon name="legend" size={17} className="gold" /> {t('ev.levelTitle', { n: ev.level })}</b>
        <span className="muted num" style={{ fontSize: 13 }}>{ev.nextXp ? t('ev.xpOf', { x: into, n: span }) : t('ev.xpMax')}</span>
      </div>
      <Bar v={ev.nextXp ? into : 1} max={ev.nextXp ? span : 1} color="var(--accent, #3fcf7a)" />
      {!compact && (
        <span className="muted" style={{ fontSize: 13 }}>
          {perks.length ? t('ev.perks', { list: perks.join(' · ') }) : t('ev.perksNone')} · {t('ev.xpHow')}
        </span>
      )}
    </section>
  )
}

/** The assistant can answer every press conference for you, in the style you pick. */
function PressAutoRow({ ctx, ev }: { ctx: Ctx; ev: EventsView }) {
  const { t } = useI18n()
  const { act } = useAct(ctx)
  return (
    <div className="row spread pressauto">
      <span className="row" style={{ gap: 6 }}><Icon name="staff" size={15} /> <b>{t('press.auto')}</b></span>
      <Seg value={(ev.pressAuto ?? '') as '' | 'bold' | 'calm' | 'deflect'} label={t('press.auto')}
        options={[['', t('press.autoOff')], ['calm', t('press.calm')], ['bold', t('press.bold')], ['deflect', t('press.deflect')]]}
        onChange={v => act({ action: 'press_auto', choice: v }, () => (v ? t('press.autoOn', { a: t('press.' + v) }) : t('press.autoOffDone')))} />
    </div>
  )
}

/** On a day without a press conference: the press assistant setting on its own, so it can be set any time. */
export function PressAutoPanel({ ctx, ev }: { ctx: Ctx; ev: EventsView }) {
  const { t } = useI18n()
  if (ev.today?.press) return null
  return (
    <section className="panel press stack" style={{ gap: 6 }}>
      <b className="row" style={{ gap: 6 }}><Icon name="mic" size={16} /> {t('press.settings')}</b>
      <PressAutoRow ctx={ctx} ev={ev} />
      <span className="muted" style={{ fontSize: 12 }}>{t('press.autoHint')}</span>
    </section>
  )
}

export function PressPanel({ ctx, ev }: { ctx: Ctx; ev: EventsView }) {
  const { t } = useI18n()
  const { busy, act } = useAct(ctx)
  const td = ev.today
  if (!td?.press) return null
  const auto = <PressAutoRow ctx={ctx} ev={ev} />
  if (td.answer) {
    return (
      <section className="panel press done stack" style={{ gap: 8 }}>
        <b className="row" style={{ gap: 6 }}><Icon name="mic" size={16} /> {t('press.title', { opp: td.opponent })}</b>
        <span className="muted" style={{ fontSize: 13 }}>{td.auto ? t('press.autoSaid', { a: t('press.' + td.answer) }) : t('press.said', { a: t('press.' + td.answer) })}</span>
        {td.auto && auto}
      </section>
    )
  }
  return (
    <section className="panel press stack">
      <div className="row spread">
        <Title icon="mic">{t('press.title', { opp: td.opponent })}</Title>
        {td.derby && <span className="chip derby">{t('derby')}</span>}
      </div>
      <p className="muted" style={{ margin: 0 }}>{t('press.q')}</p>
      <div className="grid g3 pressopts">
        {(['bold', 'calm', 'deflect'] as const).map(a => (
          <button key={a} className={'offer pressopt' + (a === 'calm' ? ' rec' : '')} disabled={busy}
            onClick={() => act({ action: 'press', choice: a }, () => t('press.done'))}>
            <b>{t('press.' + a)}</b>
            <span style={{ fontSize: 12 }}>“{t('press.' + a + '.q')}”</span>
            <span className="muted" style={{ fontSize: 12 }}>{t('press.' + a + '.d')}</span>
          </button>
        ))}
      </div>
      {auto}
      <span className="muted" style={{ fontSize: 12 }}>{t('press.autoHint')}</span>
    </section>
  )
}

function TalksPanel({ ctx, ev }: { ctx: Ctx; ev: EventsView }) {
  const { t } = useI18n()
  const { busy, act } = useAct(ctx)
  if (ev.talks.length === 0) return null
  return (
    <section className="panel stack">
      <Title icon="talk">{t('talk.title')}</Title>
      {ev.talks.map(k => (
        <div key={k.id} className="offer">
          <div className="row spread"><b>{k.name} <small className="muted">· {k.role}</small> <Ovr v={k.overall} /></b>
            <span className={'chip' + (k.until - ctx.st.career.day <= 0 ? ' bad' : '')}>{t('dem.left', { n: Math.max(0, k.until - ctx.st.career.day) })}</span></div>
          <span style={{ fontSize: 14 }}>“{t('talk.ask', { n: k.benched })}”</span>
          <div className="row">
            <button className="primary small" disabled={busy} onClick={() => act({ action: 'talk', id: k.id, choice: 'promise' }, () => t('talk.promised', { name: k.name }))}>{t('talk.promise')}</button>
            <button className="small" disabled={busy} onClick={() => act({ action: 'talk', id: k.id, choice: 'wait' }, () => t('talk.waited', { name: k.name }), true)}>{t('talk.wait')}</button>
            <ConfirmButton className="small" label={t('talk.sell')} confirm={t('confirm')} onConfirm={() => act({ action: 'talk', id: k.id, choice: 'sell' }, () => t('talk.listed', { name: k.name }))} />
          </div>
          <span className="muted" style={{ fontSize: 12 }}>{t('talk.help')}</span>
        </div>
      ))}
    </section>
  )
}

function BidsPanel({ ctx, ev }: { ctx: Ctx; ev: EventsView }) {
  const { t } = useI18n()
  const { busy, act } = useAct(ctx)
  if (ev.bids.length === 0) return null
  const res = (r: { outcome?: string; amount?: number }, name: string) =>
    r.outcome === 'sold' ? t('bid.soldTo', { name, v: money(r.amount ?? 0) }) : r.outcome === 'walked' ? t('bid.walkedAway', { name }) : t('bid.rejected', { name })
  return (
    <section className="panel stack">
      <Title icon="handCoins">{t('bid.title')}</Title>
      <div className="grid g2" style={{ gap: 10 }}>
        {ev.bids.map(b => (
          <div key={b.id} className="offer">
            <div className="row spread"><b>{b.name} <small className="muted">· {b.role}</small> <Ovr v={b.overall} /></b>
              <span className="chip">{t('dem.left', { n: Math.max(0, b.until - ctx.st.career.day) })}</span></div>
            <span>{t('bid.from', { club: b.club })}</span>
            <span className="num"><b>{money(b.fee)}</b> <small className="muted">({t('bid.value', { v: money(b.value) })})</small></span>
            {b.listed && <span className="muted" style={{ fontSize: 12 }}>{t('bid.listed')}</span>}
            <div className="row">
              <ConfirmButton className="primary small" label={t('bid.accept')} confirm={t('confirm')} onConfirm={() => act({ action: 'bid', id: b.id, choice: 'accept' }, r => res(r, b.name))} />
              <button className="small" disabled={busy} onClick={() => act({ action: 'bid', id: b.id, choice: 'counter' }, r => res(r, b.name), true)}>{t('bid.counter', { v: money(Math.round(b.fee * 1.2 / 10000) * 10000) })}</button>
              <button className="small" disabled={busy} onClick={() => act({ action: 'bid', id: b.id, choice: 'reject' }, r => res(r, b.name))}>{t('bid.reject')}</button>
            </div>
            <span className="muted" style={{ fontSize: 12 }}>{t('bid.counterHelp', { p: Math.round((0.45 + ev.perks.counterBonus - (b.listed ? 0.1 : 0)) * 100) })}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function YouthFoot({ pr }: { pr: Prospect }) {
  const { t } = useI18n()
  return (
    <>
      <span className="pc-fit youth-est" data-tip={t('youth.est')}><Icon name="up" size={13} /> {t('rv.est')} <b className="num">~{pr.est}</b></span>
      <b className="num pc-val" data-tip={t('rv.wage')}>{t('rv.perWeek', { v: money(pr.player.wage) })}</b>
    </>
  )
}

/** Youth intake day: the prospects arrive as a face-down academy pack; open it, then sign or release. */
function YouthPanel({ ctx, ev }: { ctx: Ctx; ev: EventsView }) {
  const { t } = useI18n()
  const { busy, act } = useAct(ctx)
  const y = ev.youth
  const packKey = y ? `pitchside.youthpack.${ctx.id}.${y.season}` : ''
  const [opened, setOpened] = useState(() => { try { return !!packKey && localStorage.getItem(packKey) === '1' } catch { return true } })
  if (!y || y.prospects.length === 0) return null
  // prospects are not players yet (id 0): each card gets its own id from the prospect, and shows the
  // academy's estimate instead of the true potential (a better academy gives sharper estimates)
  const est = new Map(y.prospects.map(pr => [-pr.id, pr]))
  const card = (pr: Prospect) => ({ ...pr.player, id: -pr.id, potential: pr.est })
  function reveal() {
    if (!y) return
    showReveal({ kind: 'youth', players: y.prospects.map(card), foot: p => { const pr = est.get(p.id); return pr ? <YouthFoot pr={pr} /> : null } })
  }
  function open() {
    try { localStorage.setItem(packKey, '1') } catch { /* storage unavailable */ }
    setOpened(true)
    reveal()
  }
  return (
    <section className="panel stack youthpanel">
      <div className="row spread"><Title icon="youth">{t('youth.title')}</Title>
        <span className="chip"><Icon name="hourglass" size={12} /> {t('dem.left', { n: Math.max(0, y.until - ctx.st.career.day) })}</span></div>
      <Hint text={t('youth.help', { lvl: ctx.st.club.academy })} />
      {!opened ? (
        <div className="ypack">
          <div className="ypack-cards" aria-hidden="true">
            {y.prospects.map((pr, i) => <span key={pr.id} className="ypack-back" style={{ ['--i' as string]: i - (y.prospects.length - 1) / 2 } as React.CSSProperties}><Icon name="youth" size={30} strokeWidth={1.5} /></span>)}
          </div>
          <p>{t('rv.openHint', { n: y.prospects.length })}</p>
          <button className="primary big" data-sfx="flip" onClick={open}><Icon name="youth" size={20} /> {t('rv.open')}</button>
        </div>
      ) : (
        <>
          <div className="cards">
            {y.prospects.map(pr => (
              <PlayerCard key={pr.id} p={card(pr)} foot={<YouthFoot pr={pr} />}>
                <button className="primary small" disabled={busy} onClick={() => act({ action: 'youth', id: pr.id, choice: 'sign' }, () => t('youth.signed', { name: pr.player.name }))}><Icon name="sign" size={14} /> {t('rv.sign')}</button>
                <button className="small" disabled={busy} onClick={() => act({ action: 'youth', id: pr.id, choice: 'release' })}><Icon name="release" size={14} /> {t('youth.release')}</button>
              </PlayerCard>
            ))}
          </div>
          <button className="link setlink" onClick={reveal}><Icon name="replay" size={14} /> {t('rv.again')}</button>
        </>
      )}
    </section>
  )
}

function LoansPanel({ ctx, ev }: { ctx: Ctx; ev: EventsView }) {
  const { t } = useI18n()
  const { busy, act } = useAct(ctx)
  const [market, setMarket] = useState<LoanMarket | null>(null)
  const [open, setOpen] = useState(false)
  const [pick, setPick] = useState(0)
  const st = ctx.st
  const inSeason = st.career.day <= ev.loanWindow
  const xi = new Set(st.club.lineup)
  const loanees = new Set(ev.loanees)
  const outable = st.squad.filter(p => !xi.has(p.id) && !loanees.has(p.id) && p.tag === '' && p.clubId === st.club.id)
    .sort((a, b) => b.overall - a.overall)
  async function browse() {
    setOpen(o => !o)
    if (!market) {
      try { setMarket(await eventsApi.loans(ctx.id)) } catch (e) { ctx.toast(errText(t, e), true) }
    }
  }
  async function borrow(pid: number, name: string) {
    await act({ action: 'loan_in', playerId: pid }, r => t('loan.borrowed', { name, v: money(r.amount ?? 0) }))
    try { setMarket(await eventsApi.loans(ctx.id)) } catch { /* ignore */ }
  }
  return (
    <section className="panel stack loans">
      <div className="row spread">
        <Title icon="rotate">{t('loan.title')}</Title>
        <span className="muted" style={{ fontSize: 13 }}>{inSeason ? t('loan.window', { d: ev.loanWindow }) : t('loan.closed')}</span>
      </div>
      <Hint text={t('loan.help')} />
      <div className="grid g2" style={{ gap: 12 }}>
        <div className="stack" style={{ gap: 6 }}>
          <b>{t('loan.out', { n: ev.loansOut.length, max: ev.maxLoansOut })}</b>
          {ev.loansOut.length === 0 && <span className="muted" style={{ fontSize: 13 }}>{t('loan.none')}</span>}
          {ev.loansOut.map(d => <span key={d.id}>→ {d.name} <small className="muted">· {d.role} · {d.club}</small> <Ovr v={d.overall} /></span>)}
          {inSeason && outable.length > 0 && ev.loansOut.length < ev.maxLoansOut && (
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <select value={pick || outable[0].id} onChange={e => setPick(Number(e.target.value))} style={{ flex: 1, minWidth: 0 }} aria-label={t('loan.pick')}>
                {outable.map(p => <option key={p.id} value={p.id}>{p.name} · {p.role} · {p.overall} · {t('youth.age')} {p.age}</option>)}
              </select>
              <ConfirmButton className="small" label={t('loan.send')} confirm={t('loan.sendConfirm')}
                onConfirm={() => act({ action: 'loan_out', playerId: pick || outable[0].id }, r => t('loan.sent', { name: r.loan?.name ?? '', club: r.loan?.club ?? '', v: money(r.amount ?? 0) }))} />
            </div>
          )}
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <b>{t('loan.in', { n: ev.loansIn.length, max: ev.maxLoansIn })}</b>
          {ev.loansIn.length === 0 && <span className="muted" style={{ fontSize: 13 }}>{t('loan.none')}</span>}
          {ev.loansIn.map(d => <span key={d.id}>← {d.name} <small className="muted">· {d.role} · {d.club}</small> <Ovr v={d.overall} /></span>)}
          {inSeason && <button className="small" onClick={browse}>{open ? t('loan.hide') : t('loan.browse')}</button>}
        </div>
      </div>
      {open && inSeason && (
        market ? (
          <div className="scroll" style={{ maxHeight: 360 }}>
            <table className="compact">
              <thead><tr><th>{t('player')}</th><th><Abbr k="pos" /></th><th className="r"><Abbr k="ovr" /></th><th className="r">{t('youth.age')}</th><th>{t('loan.club')}</th><th className="r">{t('loan.fee')}</th><th className="r">{t('loan.wage')}</th><th /></tr></thead>
              <tbody>
                {market.players.map(c => (
                  <tr key={c.player.id}>
                    <td>{c.player.name}</td>
                    <td><PosTag p={c.player.position} role={c.player.role} /></td>
                    <td className="r"><Ovr v={c.player.overall} /></td>
                    <td className="r num">{c.player.age}</td>
                    <td className="ellip" style={{ maxWidth: 150 }}>{c.club} <small className="muted">{c.league}</small></td>
                    <td className="r num">{money(c.fee)}</td>
                    <td className="r num">{money(c.player.wage)}/{t('wk').trim()}</td>
                    <td className="r"><button className="small primary" disabled={busy || c.fee > st.club.budget || ev.loansIn.length >= ev.maxLoansIn} onClick={() => borrow(c.player.id, c.player.name)}>{t('loan.borrow')}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {market.players.length === 0 && <p className="muted">{t('loan.empty')}</p>}
          </div>
        ) : <p className="muted">{t('wait')}</p>
      )}
    </section>
  )
}

export function awardText(t: TFn, a: Award) {
  return t('award.' + a.kind) + ': ' + a.name + ' (' + a.club + ')' + (a.kind === 'scorer' ? ` · ${a.value} ${t('award.goals')}` : ` · ${a.value.toFixed(2)}`)
}

function AwardsPanel({ ev }: { ev: EventsView }) {
  const { t } = useI18n()
  const shown = ev.awards.filter(a => a.kind !== 'tots').slice(0, 8)
  const tots = ev.awards.filter(a => a.kind === 'tots')
  const lastTots = tots.length ? tots.filter(a => a.season === tots[0].season) : []
  if (shown.length === 0 && lastTots.length === 0) return null
  return (
    <section className="panel stack awards">
      <Title icon="rank">{t('award.title')}</Title>
      <ul className="notes">
        {shown.map((a, i) => <li key={i} className={a.mine ? 'good' : ''}>{t('seasonShort')}{a.season} · {t('dayShort')}{a.day} — {awardText(t, a)}{a.mine ? ' ★' : ''}</li>)}
      </ul>
      {lastTots.length > 0 && (
        <>
          <b>{t('award.totsTitle', { n: lastTots[0].season })}</b>
          <div className="tots">
            {['GK', 'DF', 'MF', 'FW'].map(pos => (
              <div key={pos} className="row" style={{ gap: 6 }}>
                {lastTots.filter(a => a.pos === pos).map(a => <span key={a.playerId} className={'chip' + (a.mine ? ' mine' : '')}>{pos} · {a.name} <small className="muted">{a.club}</small></span>)}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

export function ClubLog({ ev, limit = 12 }: { ev: EventsView; limit?: number }) {
  const { t } = useI18n()
  if (ev.log.length === 0) return null
  return (
    <section className="panel stack clublog">
      <Title icon="news">{t('ev.logTitle')}</Title>
      <ul className="notes">
        {ev.log.slice(0, limit).map((h: Happening, i) => (
          <li key={i} className={happeningTone(h.key)}><span className="muted num" data-tip={`${t('seasonN', { n: h.season })} · ${t('vs.matchday', { d: h.day })}`}>{t('seasonShort')}{h.season} · {t('dayShort')}{h.day}</span> {happeningText(t, h)}</li>
        ))}
      </ul>
      {ev.promises.length > 0 && (
        <span className="muted" style={{ fontSize: 13 }}>{t('promise.open', { list: ev.promises.map(p => t('promise.item', { name: p.name, got: p.got, need: p.need, left: p.left })).join(', ') })}</span>
      )}
    </section>
  )
}
