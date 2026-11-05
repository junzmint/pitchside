import type { MedicalView } from '../../api_medical'
import { useI18n } from '../../i18n'
import { Hint, Icon } from '../../ui'
import { Body } from './Body'
import { injKey, type BodyPart } from './kinds'
import { pct, TierChip, tn } from './parts'

/** The injury handbook: every kind, how long it keeps a player out and what it can cost him. */
export function Handbook({ v }: { v: MedicalView }) {
  const { t, lang } = useI18n()
  const tiers = [1, 2, 3, 4]
  return (
    <section className="panel stack">
      <Hint text={t('med.book.hint')} />
      {tiers.map(tier => (
        <div key={tier} className="stack" style={{ gap: 8 }}>
          <span className="eyebrow"><TierChip t={t} tier={tier} /></span>
          <div className="md-book">
            {v.kinds.filter(k => k.tier === tier).map(k => {
              const loss = (k.loss ?? []).map(l => t('attr.' + l.attr)).concat(k.pot[1] > 0 ? [t('med.pot')] : [])
              return (
                <article key={k.key} className={'md-kind t' + k.tier + (k.seen > 0 ? ' seen' : '')}>
                  <Body part={k.part as BodyPart} tier={k.tier} seed={k.key.length} size={70} />
                  <div className="md-kind-txt">
                    <b>{t(injKey(k.key))}</b>
                    <span className="num"><Icon name="clock" size={12} /> {k.min === k.max ? t('med.book.week', { a: k.min }) : t('med.book.weeks', { a: k.min, b: k.max })}</span>
                    <small className="muted">{t(injKey(k.key) + '.d')}</small>
                    <span className="md-kind-tags">
                      {k.dmg > 0 && loss.length > 0
                        ? <span className="flag bad" data-tip={loss.join(', ') + (k.gk ? ` (${t('med.book.gk')})` : '')}><Icon name="down" size={11} /> {t('med.book.dmg', { p: pct(lang, k.dmg) })}</span>
                        : <span className="flag good">{t('med.book.noDmg')}</span>}
                      {k.frag > 0 && <span className="flag warn">{t('med.book.frag', { n: k.frag })}</span>}
                      {k.mis && <span className="flag" data-tip={t('med.book.mis', { kind: t(injKey(k.mis)) })}><Icon name="search" size={11} /> {t(injKey(k.mis) + '.s')}</span>}
                      {k.seen > 0 && <span className="flag club">{tn(t, lang, 'med.book.seen', k.seen)}</span>}
                    </span>
                  </div>
                </article>
              )
            })}
          </div>
        </div>
      ))}
    </section>
  )
}
