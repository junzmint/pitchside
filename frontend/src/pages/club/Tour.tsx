// Club life: the pre-season tour. Three cards, each with its effects in icons and numbers.
import { useState, type ReactNode } from 'react'
import { Bus, Mountain, Plane, Smile, BatteryLow, Shirt, HeartPulse, ShieldCheck, Link2, Coins, Flame } from 'lucide-react'
import type { Ctx } from '../../App'
import { money } from '../../api'
import { clubApi, refreshClubLife, useClubLife, type TourOffer, type TourView } from '../../api_club'
import { errText, useI18n, type TFn } from '../../i18n'
import { sfx } from '../../sfx'
import { ConfirmButton, Icon } from '../../ui'

export const tourName = (t: TFn, o: TourOffer) => (o.key === 'far' ? t('cl.tour.far.' + (o.place || 'asia')) : t('cl.tour.' + o.key))

const ART: Record<string, ReactNode> = { far: <Plane size={30} />, local: <Bus size={30} />, camp: <Mountain size={30} /> }

/** One effect line: an icon, the words, good or bad. */
function Fx({ icon, tone, children }: { icon: ReactNode; tone: 'good' | 'bad'; children: ReactNode }) {
  return <li className={'cl-fx ' + tone}><span className="cl-fx-ico" aria-hidden="true">{icon}</span><span>{children}</span></li>
}

function effects(t: TFn, o: TourOffer) {
  const out: ReactNode[] = []
  if (o.money > 0) out.push(<Fx key="m" icon={<Coins size={16} />} tone="good">{t('cl.te.money', { v: money(o.money) })}</Fx>)
  if (o.money < 0) out.push(<Fx key="m" icon={<Coins size={16} />} tone="bad">{t('cl.te.cost', { v: money(o.money) })}</Fx>)
  if (o.fans) out.push(<Fx key="f" icon={<Smile size={16} />} tone="good">{t('cl.te.fans', { n: o.fans })}</Fx>)
  if (o.morale) out.push(<Fx key="o" icon={<Flame size={16} />} tone="good">{t('cl.te.morale', { n: o.morale })}</Fx>)
  if (o.chem) out.push(<Fx key="c" icon={<Link2 size={16} />} tone="good">{t('cl.te.chem', { n: o.chem })}</Fx>)
  if (o.merch) out.push(<Fx key="s" icon={<Shirt size={16} />} tone="good">{t('cl.te.merch', { n: o.merch, d: o.days })}</Fx>)
  if (o.recover) out.push(<Fx key="r" icon={<HeartPulse size={16} />} tone="good">{t('cl.te.recover', { n: o.recover, d: o.days })}</Fx>)
  if (o.shield) out.push(<Fx key="i" icon={<ShieldCheck size={16} />} tone="good">{t('cl.te.shield', { n: o.shield, d: o.days })}</Fx>)
  if (o.tired) out.push(<Fx key="t" icon={<BatteryLow size={16} />} tone="bad">{t('cl.te.tired', { n: o.tired })}</Fx>)
  return out
}

function TourCard({ o, tour, budget, busy, onPick }: { o: TourOffer; tour: TourView; budget: number; busy: boolean; onPick: () => void }) {
  const { t } = useI18n()
  const chosen = tour.chosen === o.key
  const poor = o.money < 0 && budget < -o.money
  return (
    <div className={'cl-tourcard k-' + o.key + (chosen ? ' chosen' : tour.chosen ? ' dim' : '')}>
      <div className="cl-tour-art" aria-hidden="true">{ART[o.key]}</div>
      <b className="cl-tour-name">{tourName(t, o)}</b>
      <span className="muted cl-tour-d">{t(o.key === 'far' ? 'cl.tour.far.' + (o.place || 'asia') + '.d' : 'cl.tour.' + o.key + '.d')}</span>
      <ul className="cl-fxlist">{effects(t, o)}</ul>
      {chosen ? <span className="chip special cl-tour-chosen"><Icon name="check" size={13} /> {t('cl.tour.chosen')}</span>
        : !tour.chosen && tour.open && (
          <ConfirmButton className="primary small" disabled={busy || poor} label={t('cl.tour.choose')} confirm={t('confirm')} onConfirm={onPick} />
        )}
      {!tour.chosen && poor && <span className="flag bad">{t('cl.tour.noMoney')}</span>}
    </div>
  )
}

/** The off-season choice (mounted in the Match Centre's off-season panel). */
export function TourPicker({ ctx }: { ctx: Ctx }) {
  const { t } = useI18n()
  const v = useClubLife(ctx.st)
  const [busy, setBusy] = useState(false)
  const tour = v?.tour
  if (!v || !tour?.open || ctx.st.career.ended) return null
  async function pick(o: TourOffer) {
    setBusy(true)
    try {
      await clubApi.act(ctx.id, { action: 'tour', key: o.key })
      sfx(o.money > 0 ? 'cash' : 'confirm')
      ctx.toast(t('cl.tour.booked', { name: tourName(t, o) }))
      refreshClubLife()
      await ctx.reload()
    } catch (e) { ctx.toast(errText(t, e), true) } finally { setBusy(false) }
  }
  return (
    <div className="cl-tour stack">
      <div className="row spread">
        <b className="cl-tour-title"><Plane size={18} aria-hidden="true" /> {t('cl.tour.title')}</b>
        {tour.chosen && <span className="chip special">{t('cl.tour.picked', { name: tourName(t, tour.offers.find(o => o.key === tour.chosen) ?? tour.offers[0]) })}</span>}
      </div>
      {!tour.chosen && <span className="muted" style={{ fontSize: 13 }}>{t('cl.tour.pick')}</span>}
      <div className="cl-tourgrid">
        {tour.offers.map(o => <TourCard key={o.key} o={o} tour={tour} budget={v.budget} busy={busy} onPick={() => pick(o)} />)}
      </div>
    </div>
  )
}
