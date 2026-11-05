// Club life: Deadline Day, the last day of a transfer window. Late bids for your players (the
// events stream's bid list), panic sales for today only and the computer's last-minute deals.
import { useState } from 'react'
import type { Ctx } from '../../App'
import { money } from '../../api'
import { clubApi, refreshClubLife, type Bargain, type ClubLifeView } from '../../api_club'
import { eventsApi } from '../../api_events'
import { errText, useI18n } from '../../i18n'
import { revealSigning } from '../../reveal'
import { sfx } from '../../sfx'
import { versionLabel } from '../../legendVersions'
import { Badge, ConfirmButton, Icon, Ovr, PosTag } from '../../ui'

/** A stadium clock stuck at one minute to midnight. */
function DeadlineClock() {
  return (
    <svg className="cl-clock" viewBox="0 0 64 64" width="76" height="76" aria-hidden="true">
      <circle cx="32" cy="32" r="29" className="face" />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2
        return <line key={i} x1={32 + Math.sin(a) * 23} y1={32 - Math.cos(a) * 23} x2={32 + Math.sin(a) * 27} y2={32 - Math.cos(a) * 27} className={i === 0 ? 'tick twelve' : 'tick'} />
      })}
      <line x1="32" y1="32" x2="31.2" y2="15" className="hour" />
      <line x1="32" y1="32" x2="30" y2="8" className="minute" />
      <line x1="32" y1="36" x2="32" y2="7" className="second" />
      <circle cx="32" cy="32" r="2.6" className="hub" />
    </svg>
  )
}

export function DeadlineBanner({ ctx, v }: { ctx: Ctx; v: ClubLifeView }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const d = v.deadline
  if (!d?.active || ctx.st.career.ended) return null
  async function run<T>(fn: () => Promise<T>, ok: (r: T) => string, bad?: (r: T) => boolean) {
    setBusy(true)
    try {
      const r = await fn()
      ctx.toast(ok(r), bad?.(r))
      refreshClubLife()
      await ctx.reload()
    } catch (e) { ctx.toast(errText(t, e), true) } finally { setBusy(false) }
  }
  const bidRes = (r: { outcome?: string; amount?: number }, name: string) =>
    r.outcome === 'sold' ? t('bid.soldTo', { name, v: money(r.amount ?? 0) }) : r.outcome === 'walked' ? t('bid.walkedAway', { name }) : t('bid.rejected', { name })
  return (
    <section className="panel cl-deadline" aria-label={t('cl.dl.title')}>
      <div className="cl-dl-head">
        <DeadlineClock />
        <div className="cl-dl-titles">
          <span className="eyebrow">{t('cl.dl.window.' + (d.window || 'winter'))} · {t('cl.dl.when', { d: d.day })}</span>
          <h3 className="cl-bigtitle">{t('cl.dl.title')}</h3>
          <b className="cl-dl-sub">{t('cl.dl.sub')}</b>
        </div>
        <span className="cl-dl-time num" aria-hidden="true">23<i>:</i>59</span>
      </div>
      <div className="cl-dl-cols">
        <div className="cl-dl-col">
          <h4><Icon name="handCoins" size={16} /> {t('cl.dl.bids')}</h4>
          {d.bids.length === 0 && <p className="muted cl-empty">{t('cl.dl.noBids')}</p>}
          {d.bids.map(b => (
            <div key={b.id} className="cl-dl-card">
              <div className="row spread"><b>{b.name} <Ovr v={b.overall} /></b><span className="muted">{b.role}</span></div>
              <span>{t('bid.from', { club: b.club })}</span>
              <span className="num"><b className="gold">{money(b.fee)}</b> <small className="muted">({t('bid.value', { v: money(b.value) })})</small></span>
              <div className="row">
                <ConfirmButton className="primary small" label={t('bid.accept')} confirm={t('confirm')} disabled={busy}
                  onConfirm={() => run(() => eventsApi.act(ctx.id, { action: 'bid', id: b.id, choice: 'accept' }), r => bidRes(r, b.name))} />
                <button className="small" disabled={busy} onClick={() => run(() => eventsApi.act(ctx.id, { action: 'bid', id: b.id, choice: 'counter' }), r => bidRes(r, b.name), r => r.outcome !== 'sold')}>
                  {t('bid.counter', { v: money(Math.round(b.fee * 1.2 / 10000) * 10000) })}
                </button>
                <button className="small" disabled={busy} onClick={() => run(() => eventsApi.act(ctx.id, { action: 'bid', id: b.id, choice: 'reject' }), r => bidRes(r, b.name))}>{t('bid.reject')}</button>
              </div>
            </div>
          ))}
        </div>
        <div className="cl-dl-col">
          <h4><Icon name="flame" size={16} /> {t('cl.dl.bargains')}</h4>
          {d.bargains.length === 0 && <p className="muted cl-empty">{t('cl.dl.noBargains')}</p>}
          {d.bargains.map(b => <BargainCard key={b.playerId} b={b} budget={v.budget} full={d.squadFull} busy={busy}
            onBuy={() => run(async () => {
              const r = await clubApi.act(ctx.id, { action: 'bargain', playerId: b.playerId })
              sfx('cash')
              if (r.player) revealSigning(r.player)
              return r
            }, r => r.player?.tag === 'legend' // legend versions: the bargain merged into a legend version of him you own
              ? t('lgv.merged', { name: versionLabel(r.player) })
              : t('cl.dl.signed', { name: r.name ?? b.name, n: r.shirt ?? '' }))} />)}
        </div>
        <div className="cl-dl-col">
          <h4><Icon name="transferIn" size={16} /> {t('cl.dl.deals')}</h4>
          {d.deals.length === 0 && <p className="muted cl-empty">{t('cl.dl.noDeals')}</p>}
          <ul className="cl-dl-news">
            {d.deals.map((n, i) => (
              <li key={n.id || i}>
                <b>{n.player}</b>{n.ovr ? <span className="muted num"> · {n.ovr}</span> : null}
                <span className="cl-route">{t('cl.dl.dealLine', { from: n.from ?? '', to: n.to ?? '' })}</span>
                <b className="num gold">{money(n.fee ?? 0)}</b>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

function BargainCard({ b, budget, full, busy, onBuy }: { b: Bargain; budget: number; full: boolean; busy: boolean; onBuy: () => void }) {
  const { t } = useI18n()
  const off = Math.round((1 - b.price / Math.max(1, b.full)) * 100)
  const poor = budget < b.price
  return (
    <div className={'cl-dl-card cl-bargain' + (b.sold ? ' sold' : '')}>
      <span className="cl-today"><Icon name="hourglass" size={12} /> {t('cl.dl.todayOnly')}</span>
      <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
        <Badge short={b.short} color={b.color} color2={b.color2} size={34} />
        <div style={{ minWidth: 0 }}>
          <b className="cl-wrap">{b.name} <Ovr v={b.overall} /></b>
          <span className="row muted" style={{ gap: 6, fontSize: 12 }}><PosTag p={b.position} role={b.role} /> {t('cl.dl.age', { n: b.age })} · {t('cl.dl.potential', { n: b.potential })}</span>
        </div>
      </div>
      <span className="muted" style={{ fontSize: 13 }}>{t('cl.dl.reason.' + b.reason, { club: b.club })}</span>
      <div className="row cl-price">
        <s className="muted num">{t('cl.dl.was', { v: money(b.full) })}</s>
        <b className="num cl-now">{money(b.price)}</b>
        <span className="flag good num">−{off}%</span>
      </div>
      {b.sold ? <span className="chip special"><Icon name="check" size={12} /> {t('cl.dl.bought')}</span>
        : <ConfirmButton className="primary small" disabled={busy || poor || full} label={<><Icon name="sign" size={14} /> {t('cl.dl.buy', { v: money(b.price) })}</>}
            confirm={t('confirm')} onConfirm={onBuy} />}
      {!b.sold && poor && <span className="flag bad">{t('cl.dl.noMoney')}</span>}
      {!b.sold && full && <span className="flag bad">{t('cl.dl.squadFull')}</span>}
    </div>
  )
}
