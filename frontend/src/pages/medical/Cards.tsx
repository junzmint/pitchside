import { BatteryLow, Footprints, ScanLine, ShieldAlert, Stethoscope, Thermometer, TriangleAlert, type LucideIcon } from 'lucide-react'
import { money } from '../../api'
import type { MedCard, MedicalView } from '../../api_medical'
import { useI18n } from '../../i18n'
import { Icon } from '../../ui'
import { Body } from './Body'
import { injKey, partOfKind, tierOfKind } from './kinds'
import { dec, pct, tn } from './parts'

const CARD_ICON: Record<string, LucideIcon> = {
  treat: Stethoscope, diag: ScanLine, return: Footprints, warn: TriangleAlert, knock: ShieldAlert, flu: Thermometer, wear: BatteryLow,
}

/** A decision the medical department brings to the manager: what happened, the choices with their
 *  odds, the doctor's advice, and what happens if it is left. */
export function DecisionCard({ cd, v, busy, onPick }: { cd: MedCard; v: MedicalView; busy: boolean; onPick: (cd: MedCard, choice: string) => void }) {
  const { t, lang } = useI18n()
  const Ico = CARD_ICON[cd.kind] ?? Stethoscope
  const injury = cd.injury ? t(injKey(cd.injury)) : ''
  const left = Math.max(1, cd.due - v.tick)
  const body = t('med.card.' + cd.kind + '.b', {
    name: cd.name, injury, weeks: cd.weeks ?? 0, risk: pct(lang, cd.risk), base: pct(lang, cd.base),
    wear: dec(lang, cd.wear ?? 0), sharp: pct(lang, 1 - (cd.rust ?? 0)), frag: cd.frag ?? 0,
  })
  const part = cd.injury ? partOfKind(cd.injury) : cd.kind === 'warn' || cd.kind === 'wear' || cd.kind === 'knock' ? 'body' : null
  const tier = cd.injury ? tierOfKind(cd.injury) : cd.kind === 'warn' || cd.kind === 'knock' ? 2 : 1
  return (
    <article className={'md-card k-' + cd.kind}>
      <header className="md-card-head">
        <span className="md-card-ico"><Ico size={22} strokeWidth={2} /></span>
        <div className="md-card-ttl">
          <span className="eyebrow">{t('med.decide')}</span>
          <h4>{t('med.card.' + cd.kind + '.t')}</h4>
        </div>
        {part && <span className="md-card-body"><Body part={part} tier={tier} seed={cd.playerId} size={64} /></span>}
      </header>
      <p className="md-card-text">{body}</p>
      {cd.why?.length ? <p className="md-why"><Icon name="info" size={13} /> {t('med.why', { list: cd.why.map(w => t('med.why.' + w)).join(', ') })}</p> : null}
      <div className="md-opts" style={{ ['--n' as string]: cd.options.length } as React.CSSProperties}>
        {cd.options.map(o => {
          const short = (o.cost ?? 0) > v.budget
          return (
            <button key={o.key} className={'md-opt' + (o.rec ? ' rec' : '')} disabled={busy || short} onClick={() => onPick(cd, o.key)}
              data-tip={short ? t('err.no_budget') : undefined}>
              {o.rec && <span className="md-rec"><Icon name="star" size={11} /> {t('med.advice')}</span>}
              <b>{t('med.opt.' + o.key)}</b>
              <small>{t('med.opt.' + o.key + '.d', { risk: pct(lang, o.risk) })}</small>
              <span className="md-opt-stats">
                {o.weeks != null && <span className="st"><Icon name="clock" size={12} /> {tn(t, lang, 'med.o.weeks', o.weeks)}</span>}
                {(o.cost ?? 0) > 0 ? <span className="st gold"><Icon name="coins" size={12} /> {money(o.cost!)}</span> : cd.kind === 'treat' ? <span className="st good">{t('med.o.free')}</span> : null}
                {cd.kind === 'treat' && o.risk != null && <span className="st" data-tip={t('med.o.setback.tip')}>{t('med.o.setback', { p: pct(lang, o.risk) })}</span>}
                {o.dmg != null && o.dmg > 0 && <span className={'st' + (o.dmg >= 0.3 ? ' bad' : '')} data-tip={t('med.o.dmg.tip')}>{t('med.o.dmg', { p: pct(lang, o.dmg) })}</span>}
                {o.comp != null && <span className="st" data-tip={t('med.o.comp.tip')}>{t('med.o.comp', { p: pct(lang, o.comp) })}</span>}
              </span>
            </button>
          )
        })}
      </div>
      <footer className="md-card-foot">
        <span className={'md-due' + (left <= 1 ? ' now' : '')}><Icon name="hourglass" size={13} /> {left <= 1 ? t('med.due1') : t('med.due', { n: left })}</span>
        <span className="muted">{t('med.default', { opt: t('med.opt.' + cd.default) })}</span>
      </footer>
    </article>
  )
}
