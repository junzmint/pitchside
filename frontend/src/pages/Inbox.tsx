import { useState } from 'react'
import type { Ctx } from '../App'
import { api, money } from '../api'
import type { CareerState, ChanceCard } from '../types'
import { ConfirmButton, Icon, PageHead, Title, Empty } from '../ui'
import { errText, useI18n } from '../i18n'
import { DemandsPanel } from './Demands'
import { IconPickPanel } from './IconPick'
import { EventsInbox, eventsCount } from './EventsInbox'
import { ClubInbox } from './club/ClubInbox'
import { clubWaiting } from '../api_club'
import { staffCount } from '../api_staff'
import { AlertsPanel, inboxAlerts } from './Alerts'
import { StaffInbox } from './staff/Decisions'

/** How many things in the inbox are waiting for an answer. */
export function inboxCount(st: CareerState) {
  const c = st.career
  const ip = c.iconPick
  const icon = ip && ip.season === c.season && !ip.done && (ip.options?.length ?? 0) > 0 && c.day >= ip.day && c.day <= ip.until ? 1 : 0
  return (c.contracts?.demands?.length ?? 0) + (c.commercial?.offers?.length ?? 0) + (c.commercial?.pending ? 1 : 0)
    + (c.commercial?.takeover?.status === 'offer' ? 1 : 0) + icon + eventsCount(st) + clubWaiting(st) + staffCount(st)
}

/** A board-game style card: orange "Chance", blue "Community chest". */
export function CardFace({ cd, children }: { cd: ChanceCard; children?: React.ReactNode }) {
  const { t } = useI18n()
  return (
    <div className={'chancecard ' + cd.deck}>
      <span className="deck"><Icon name={cd.deck === 'chance' ? 'flame' : 'card'} size={14} /> {t('card.deck.' + cd.deck)}</span>
      <b>{t('card.' + cd.key)}</b>
      <span className="muted" style={{ fontSize: 13 }}>{t('card.' + cd.key + '.d', { v: money(Math.abs(cd.amount)) })}</span>
      {!cd.choice || cd.result ? <span className={'num amt ' + (cd.net >= 0 ? 'up' : 'down')}>{cd.net >= 0 ? '+' : '−'}{money(Math.abs(cd.net))}</span> : null}
      {cd.result && cd.choice && <span className="chip">{t('card.res.' + cd.result)}</span>}
      {children}
    </div>
  )
}

export default function Inbox({ ctx }: { ctx: Ctx }) {
  const { t } = useI18n()
  const { st } = ctx
  const cm = st.career.commercial
  const [busy, setBusy] = useState(false)
  async function act(body: Parameters<typeof api.comAct>[1], ok?: string) {
    setBusy(true)
    try {
      const r = await api.comAct(ctx.id, body)
      if (r.card) ctx.toast(`${t('card.' + r.card.key)}: ${t('card.res.' + (r.card.result ?? ''))} (${r.card.net >= 0 ? '+' : '−'}${money(Math.abs(r.card.net))})`, r.card.net < 0)
      else if (ok) ctx.toast(ok)
      await ctx.reload()
    } catch (e) { ctx.toast(errText(t, e), true) } finally { setBusy(false) }
  }
  const n = inboxCount(st)
  const to = cm?.takeover
  return (
    <>
      <PageHead icon="inbox" eyebrow={t('inbox.eyebrow', { n })} title={t('tab.inbox')} />
      {n === 0 && <section className="panel"><Empty icon="inbox">{t('inbox.empty')}</Empty></section>}
      <AlertsPanel ctx={ctx} alerts={inboxAlerts(st.alerts)} max={5} />

      <IconPickPanel ctx={ctx} />
      <EventsInbox ctx={ctx} />
      <ClubInbox ctx={ctx} />
      <StaffInbox ctx={ctx} />

      {cm?.pending && (
        <section className="panel stack">
          <Title icon="card">{t('inbox.card')}</Title>
          <CardFace cd={cm.pending}>
            <span className="muted" style={{ fontSize: 12 }}>{t('dem.left', { n: Math.max(0, (cm.pending.until ?? 0) - st.career.day) })} · {t('inbox.cardAuto')}</span>
            <div className="row">
              <button className="primary" disabled={busy} onClick={() => act({ action: 'card', choice: 'a' })}><Icon name="check" size={16} /> {t('card.' + cm.pending.key + '.a')}</button>
              <button disabled={busy} onClick={() => act({ action: 'card', choice: 'b' })}>{t('card.' + cm.pending.key + '.b')}</button>
            </div>
          </CardFace>
        </section>
      )}

      {to?.status === 'offer' && (
        <section className="panel stack takeover">
          <Title icon="briefcase">{t('to.title')}</Title>
          <p style={{ margin: 0 }}>{t('to.offer', { name: to.investor, v: money(to.amount), goal: t('goal.' + to.goal), s: to.deadline })}</p>
          <span className="muted" style={{ fontSize: 13 }}>{t('to.risk', { v: money(to.amount / 2) })} · {t('dem.left', { n: Math.max(0, to.until - st.career.day) })}</span>
          <div className="row">
            <ConfirmButton className="primary" label={<><Icon name="handCoins" size={16} /> {t('to.accept', { v: money(to.amount) })}</>} confirm={t('confirm')} onConfirm={() => act({ action: 'takeover', choice: 'accept' }, t('to.accepted'))} />
            <button disabled={busy} onClick={() => act({ action: 'takeover', choice: 'decline' }, t('to.declined'))}>{t('to.decline')}</button>
          </div>
        </section>
      )}

      {(cm?.offers?.length ?? 0) > 0 && (
        <section className="panel stack">
          <Title icon="sponsor">{t('inbox.offers')}</Title>
          <div className="grid g2" style={{ gap: 10 }}>
            {cm!.offers!.map(o => {
              const cur = cm?.sponsors?.[o.slot]
              return (
                <div key={o.id} className="offer">
                  <div className="row spread"><b className="row" style={{ gap: 8 }}><Icon name="sponsor" size={18} /> {o.sponsor.name}</b><span className="chip">{t('slot.' + o.slot)}</span></div>
                  <div className="offer-money num"><span><small>{t('fin.weeklyPay')}</small><b>{money(o.sponsor.weekly)}</b></span><span><small>{t('fin.signing')}</small><b>{money(o.sponsor.signing)}</b></span></div>
                  <span className="muted" style={{ fontSize: 13 }}>{t('fin.target')}: {t('goal.' + o.sponsor.target)} (+{money(o.sponsor.targetBonus)}) · {t('fin.seasons', { n: o.sponsor.seasonsLeft })}</span>
                  {cur ? <span className="flag warn"><Icon name="warn" size={12} /> {t('inbox.replaces', { name: cur.name, w: money(cur.weekly), v: money(cur.exit) })}</span> : <span className="flag good"><Icon name="check" size={12} /> {t('inbox.freeSlot')}</span>}
                  <span className="muted row" style={{ fontSize: 12, gap: 5 }}><Icon name="hourglass" size={12} /> {t('dem.left', { n: Math.max(0, o.until - st.career.day) })}</span>
                  <div className="row">
                    <button className="primary small" disabled={busy} onClick={() => act({ action: 'accept_offer', offer: o.id }, t('fin.signed'))}><Icon name="sign" size={14} /> {t('fin.sign')}</button>
                    <button className="small" disabled={busy} onClick={() => act({ action: 'decline_offer', offer: o.id })}>{t('to.decline')}</button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      <DemandsPanel ctx={ctx} />

      {to && to.status === 'active' && (
        <section className="panel"><b className="row" style={{ gap: 6, display: 'inline-flex' }}><Icon name="briefcase" size={16} /> {t('to.activeTitle', { name: to.investor })}</b> <span className="muted">{t('to.active', { goal: t('goal.' + to.goal), s: to.deadline, v: money(to.amount / 2) })}</span></section>
      )}
    </>
  )
}
