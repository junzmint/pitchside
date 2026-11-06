import { money } from '../../api'
import type { MedInjured, MedicalView } from '../../api_medical'
import { useI18n } from '../../i18n'
import { ConfirmButton, Empty, Icon, Ovr, PosTag } from '../../ui'
import { Body } from './Body'
import { injKey, partOfKind, plannedKind } from './kinds'
import { pct, TierChip, tn } from './parts'

type Act = (id: number) => void

/** The treatment room: every player out, with his injury on a body, the weeks to go and the odds. */
export function TreatmentRoom({ v, busy, onInject, onElite }: { v: MedicalView; busy: boolean; onInject: Act; onElite: Act }) {
  const { t } = useI18n()
  const hurt = v.injured.filter(x => !plannedKind(x.kind))
  const planned = v.injured.filter(x => plannedKind(x.kind))
  return (
    <section className="panel stack md-room">
      {hurt.length === 0 && planned.length === 0 && <Empty icon="check">{t('med.room.empty')}</Empty>}
      {hurt.length > 0 && <div className="md-beds">{hurt.map(x => <BedCard key={x.playerId} x={x} v={v} busy={busy} onInject={onInject} onElite={onElite} />)}</div>}
      {planned.length > 0 && (
        <>
          <span className="eyebrow"><Icon name="clock" size={13} /> {t('med.planned')}</span>
          <div className="md-beds small">{planned.map(x => <BedCard key={x.playerId} x={x} v={v} busy={busy} onInject={onInject} onElite={onElite} />)}</div>
        </>
      )}
    </section>
  )
}

function BedCard({ x, v, busy, onInject, onElite }: { x: MedInjured; v: MedicalView; busy: boolean; onInject: Act; onElite: Act }) {
  const { t, lang } = useI18n()
  const total = Math.max(1, x.total)
  const done = Math.max(0, total - x.weeks)
  const back = v.day + x.weeks
  const backText = v.offseason ? t('med.backSummer') : back > 54 ? t('med.backSummer') : t('med.backOn', { d: back })
  const kind = x.kind || ''
  return (
    <article className={'md-bed t' + x.tier + (x.pending ? ' pending' : '')} data-tip={t(injKey(kind) + '.d')}>
      <div className="md-bed-fig"><Body part={partOfKind(kind)} tier={x.tier} seed={x.playerId} size={104} /></div>
      <div className="md-bed-info">
        <div className="md-bed-who">
          <PosTag p={x.position} role={x.role} />
          <b className="md-bed-name">{x.name}</b>
          <Ovr v={x.overall} />
        </div>
        <div className="md-bed-inj">
          <b>{t(injKey(kind))}</b>
          <TierChip t={t} tier={x.tier} />
        </div>
        <div className="md-prog" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}
          data-tip={t('med.weeksOf', { a: Math.min(total, done + 1), b: total })}>
          {Array.from({ length: Math.min(total, 40) }, (_, i) => <i key={i} className={i < Math.round(done * Math.min(total, 40) / total) ? 'on' : ''} />)}
        </div>
        <div className="md-bed-when">
          <span className="md-left num">{tn(t, lang, 'med.left', x.weeks)}</span>
          <span className="muted">{backText}</span>
        </div>
        <div className="md-chips">
          {x.source && <span className="flag">{t('med.src.' + x.source)}</span>}
          {x.treat ? <span className="flag club"><Icon name="check" size={11} /> {t('med.treat.on', { treat: t('med.opt.' + x.treat) })}</span>
            : x.tier >= 3 ? <span className="flag warn">{t('med.treat.none')}</span> : null}
          {x.setback > 0 && <span className="flag" data-tip={t('med.setback.tip')}>{t('med.setback', { p: pct(lang, x.setback) })}</span>}
          {x.dmg > 0 && <span className={'flag' + (x.dmg >= 0.3 ? ' bad' : '')} data-tip={t('med.dmgRisk.tip')}>{t('med.dmgRisk', { p: pct(lang, x.dmg) })}</span>}
          {x.rushed && <span className="flag warn"><Icon name="injury" size={11} /> {t('rush.on')}</span>}
          {x.pending && <span className="flag warn md-blink"><Icon name="hourglass" size={11} /> {t('med.pending')}</span>}
        </div>
        {x.inject && (
          <span data-tip={t('med.inject.tip', { n: x.inject.weeks ?? 1, m: x.weeks, s: pct(lang, x.inject.risk), d: pct(lang, x.inject.dmg) })}>
            <ConfirmButton className="small" disabled={busy || (x.inject.cost ?? 0) > v.budget}
              label={<><Icon name="bonus" size={13} /> {t('med.inject', { v: money(x.inject.cost ?? 0) })}</>} confirm={t('confirm')} onConfirm={() => onInject(x.playerId)} />
          </span>
        )}
        {x.elite && (
          <span data-tip={(x.elite.cost ?? 0) > v.budget ? t('err.no_budget') : t('med.elite.tip', { n: x.elite.weeks ?? 1, m: x.weeks })}>
            <ConfirmButton className="small md-elite" disabled={busy || (x.elite.cost ?? 0) > v.budget}
              label={<><Icon name="star" size={13} /> {t('med.elite', { v: money(x.elite.cost ?? 0) })}</>}
              confirm={t('med.elite.confirm', { v: money(x.elite.cost ?? 0), n: x.elite.weeks ?? 1 })} onConfirm={() => onElite(x.playerId)} />
          </span>
        )}
      </div>
    </article>
  )
}
