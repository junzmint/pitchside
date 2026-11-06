import { useState } from 'react'
import type { Ctx } from '../App'
import { api, money } from '../api'
import type { Demand } from '../types'
import { ConfirmButton, Icon, rangeFill } from '../ui'
import { errText, useI18n } from '../i18n'
import { MailTags, mailClass, whoIn, type MailWho } from './MailTags'

// Wage demands from players and staff: pay up, haggle, say no, or let them go (contracts have no
// end date, so ending one costs nothing).
export function DemandsPanel({ ctx }: { ctx: Ctx }) {
  const { t } = useI18n()
  const ds = ctx.st.career.contracts?.demands ?? []
  if (ds.length === 0 || ctx.st.career.ended) return null
  return (
    <section className="panel demands">
      <h3 className="ttl" style={{ margin: 0 }}><Icon name="chat" size={16} />{t('dem.title', { n: ds.length })}</h3>
      <p className="hint"><Icon name="info" size={14} className="i" /><span>{t('dem.help')}</span></p>
      <div className="grid g2" style={{ gap: 10, marginTop: 8 }}>
        {ds.map(d => <DemandCard key={d.kind + d.id} d={d} ctx={ctx} />)}
      </div>
    </section>
  )
}

export function DemandCard({ d, ctx }: { d: Demand; ctx: Ctx }) {
  // talks you opened early ("Renew" on the Squad page): his contract still has seasons to run
  const earlyLeft = d.renewal && d.kind === 'player' ? (ctx.st.squad.find(p => p.id === d.id)?.contract ?? 0) : 0
  const { t } = useI18n()
  // the lowest offer worth making (backend offerFloor): his wage, or 70% of a pay cut he already accepts
  const floor = d.ask < d.current ? Math.round(d.ask * 0.7 / 1000) * 1000 : d.current
  const [offer, setOffer] = useState(Math.round((floor + d.ask) / 2 / 1000) * 1000)
  const [busy, setBusy] = useState(false)
  const [years, setYears] = useState(3)
  const left = Math.max(0, d.until - ctx.st.career.day)
  // how likely he is to take the offer (backend AnswerDemand): more the closer to his ask, less after each "no"
  const negotiator = (ctx.st.coaches ?? []).some(c => c.perks?.includes('negotiator'))
  const shown = Math.min(d.ask, Math.max(floor + 1000, offer))
  const share = Math.max(0, Math.min(1, (shown - floor) / Math.max(1, d.ask - floor)))
  let chance = d.easy ? 0.4 + 0.6 * share ** 1.1 - 0.05 * d.tries : 0.1 + 0.85 * share ** 1.4 - 0.1 * d.tries + (negotiator ? 0.08 : 0)
  if (shown >= d.ask) chance = 1
  const cpct = Math.round(Math.max(0, Math.min(1, chance)) * 100)
  const pct = Math.round((d.ask / Math.max(1, d.current) - 1) * 100)
  const final = d.tries >= 2
  // a coach, an icon or a squad player: the tags say which before anything is clicked
  const who: MailWho = d.kind === 'coach' ? 'coach' : whoIn(ctx.st.squad, d.id)
  async function go(action: 'accept' | 'offer' | 'refuse') {
    setBusy(true)
    try {
      const r = await api.answerDemand(ctx.id, { kind: d.kind, id: d.id, action, amount: offer, years })
      if (r.accepted) ctx.toast(t('dem.signed', { name: d.name }))
      else if (r.outcome === 'countered') ctx.toast(t('dem.countered', { name: d.name, v: money(r.demand?.ask ?? d.ask) }), true)
      else if (r.outcome === 'final') ctx.toast(t('dem.final', { name: d.name, v: money(r.demand?.ask ?? d.ask) }), true)
      else ctx.toast(refusalText(t, r.outcome), true)
      await ctx.reload()
    } catch (e) { ctx.toast(errText(t, e), true) } finally { setBusy(false) }
  }
  async function terminate() {
    setBusy(true)
    try {
      if (d.kind === 'player') {
        const r = await api.release(ctx.id, d.id)
        ctx.toast(t('dem.released', { name: d.name, v: money(r.received) }))
      } else {
        await api.fire(ctx.id, d.id)
        ctx.toast(t('dem.fired', { name: d.name }))
      }
      await ctx.reload()
    } catch (e) { ctx.toast(errText(t, e), true) } finally { setBusy(false) }
  }
  return (
    <div className={'demand ' + mailClass(who)}>
      <MailTags who={who} role={d.role} kind={d.renewal ? 'renewal' : 'raise'}>
        <span className={'chip' + (left <= 1 ? ' bad' : '')}><Icon name="hourglass" size={12} /> {t('dem.left', { n: left })}</span>
      </MailTags>
      <div className="dem-head">
        <span className="avatar sm" aria-hidden="true">{d.name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()}<Icon name={d.kind === 'coach' ? 'staff' : 'apps'} size={10} /></span>
        <b>{d.name} <small className="muted">· {d.kind === 'coach' ? t('role.' + d.role) : d.role}</small></b>
      </div>
      <span className="muted" style={{ fontSize: 13 }}>{earlyLeft > 1 ? t('dem.reason.renewalEarly', { n: earlyLeft }) : t('dem.reason.' + d.reason)}</span>
      <div className="dem-ask num"><span className="muted">{money(d.current)}</span><Icon name="next" size={16} /><b>{money(d.ask)}</b><small className="muted">/{t('wk').trim()}</small>{pct >= 0 ? <span className="flag warn">+{pct}%</span> : <span className="flag good" data-tip={t('dem.cutTip')}>{pct}%</span>}</div>
      {d.renewal && (
        <label className="row" style={{ gap: 6 }}>{t('ct.length')}
          <select value={years} onChange={e => setYears(Number(e.target.value))}>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{t('fin.seasons', { n })}</option>)}</select>
        </label>
      )}
      {!final ? (
        <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
          <input type="range" min={floor + 1000} max={d.ask} step={1000} value={Math.min(d.ask, Math.max(floor + 1000, offer))}
            style={{ flex: 1, ...rangeFill(Math.min(d.ask, Math.max(floor + 1000, offer)), floor + 1000, d.ask) }}
            onChange={e => setOffer(Number(e.target.value))} aria-label={t('dem.offer')} />
          <button disabled={busy} onClick={() => go('offer')}><Icon name="chat" size={14} /> {t('dem.offerBtn', { v: money(offer) })}</button>
        </div>
      ) : <span className="muted" style={{ fontSize: 13 }}>{t('dem.noMore')}</span>}
      {!final && (
        <div className="dem-odds" data-tip={t('dem.chanceTip')}>
          <span className="muted">{t('dem.chance')}</span>
          <div className="odds"><i style={{ width: cpct + '%', background: cpct >= 60 ? 'var(--good)' : cpct >= 30 ? 'var(--warn)' : 'var(--bad)' }} /><b className="num">{cpct}%</b></div>
        </div>
      )}
      <div className="row" style={{ gap: 6 }}>
        <button className="primary small" disabled={busy} onClick={() => go('accept')}><Icon name="check" size={14} /> {t('dem.accept', { v: money(d.ask) })}</button>
        <ConfirmButton className="small" label={t(d.renewal ? 'ct.letGo' : 'dem.refuse')} confirm={t(d.renewal ? 'ct.letGoConfirm' : d.kind === 'coach' ? 'dem.refuseCoach' : 'dem.refusePlayer')} onConfirm={() => go('refuse')} />
        <ConfirmButton className="small danger" label={t(d.kind === 'coach' ? 'dem.fire' : 'dem.release')} confirm={t(d.kind === 'coach' ? 'dem.fireConfirm' : 'dem.releaseConfirm', { name: d.name })} onConfirm={terminate} />
      </div>
    </div>
  )
}

export function refusalText(t: (k: string, p?: Record<string, string | number>) => string, note: string) {
  const [name, kind, club] = note.split(':')
  return t('dem.out.' + kind, { name, club: club ?? '' })
}
