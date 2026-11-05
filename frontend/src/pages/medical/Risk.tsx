import { Activity, BatteryMedium, Repeat2, Zap } from 'lucide-react'
import type { MedicalView, MedRisk } from '../../api_medical'
import { useI18n } from '../../i18n'
import { Empty, Hint, Icon, PosTag } from '../../ui'
import { injKey } from './kinds'
import { dec, LEVEL_KEY, LEVEL_TONE, Meter, pct, riskLevel, tn, wearLevel } from './parts'

/** The doctor's risk board: every fit player's chance of getting hurt in the next match, his body
 *  wear, match sharpness and fragile spell. */
export function RiskBoard({ v }: { v: MedicalView }) {
  const { t } = useI18n()
  const rows = [...v.squad].sort((a, b) => b.risk - a.risk || b.wear - a.wear)
  return (
    <section className="panel stack md-riskb">
      <Hint text={t('med.risk.hint')} />
      {rows.length === 0 ? <Empty icon="users">{t('med.room.empty')}</Empty> : (
        <div className="md-risklist">{rows.map(x => <RiskRow key={x.playerId} x={x} />)}</div>
      )}
    </section>
  )
}

function RiskRow({ x }: { x: MedRisk }) {
  const { t, lang } = useI18n()
  const lvl = riskLevel(x.risk, x.base)
  const times = x.base > 0 ? x.risk / x.base : 1
  const wl = wearLevel(x.wear)
  const sharp = 1 - x.rust
  return (
    <div className={'md-riskrow l' + lvl}>
      <span className="md-shirt num" data-tip={t(LEVEL_KEY[lvl])}>{x.shirt || '–'}</span>
      <span className="md-rr-who">
        <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><PosTag p={x.position} role={x.role} /><b>{x.name}</b></span>
        <span className="md-rr-tags">
          {x.starter && <span className="flag club">{t('med.starter')}</span>}
          {x.prone && <span className="flag bad" data-tip={t('med.prone.tip')}>{t('med.prone')}</span>}
          {x.frag > 0 && <span className="flag warn" data-tip={tn(t, lang, 'med.frag.tip', x.frag, { injury: t(injKey(x.fragK)) })}><Repeat2 size={11} /> {tn(t, lang, 'med.frag', x.frag)}</span>}
          <span className="muted md-rr-file" data-tip={[x.last ? t('med.lastSerious', { injury: t(injKey(x.last)), s: x.lastS ?? 0 }) : '', x.conc ? tn(t, lang, 'med.conc', x.conc) : ''].filter(Boolean).join('\n') || undefined}>
            {x.injuries > 0 ? tn(t, lang, 'med.file', x.injuries) : t('med.file0')}
          </span>
        </span>
      </span>
      <span className="md-rr-m" data-tip={`${t('med.c.risk')}: ${pct(lang, x.risk)} · ${t('med.vsFresh', { x: dec(lang, times) })}`}>
        <small><Activity size={12} /> {t('med.c.risk')}</small>
        <Meter v={Math.min(1, x.risk / 0.08)} tone={LEVEL_TONE[lvl]} />
        <b className={'num ' + LEVEL_TONE[lvl]}>{pct(lang, x.risk)}</b>
      </span>
      <span className="md-rr-m" data-tip={`${t('fitness')}: ${Math.round(x.fitness)}%`}>
        <small><Icon name="fitness" size={12} /> {t('fitness')}</small>
        <Meter v={x.fitness / 100} tone={x.fitness < 60 ? 'bad' : x.fitness < 75 ? 'warn' : 'good'} />
        <b className="num">{Math.round(x.fitness)}%</b>
      </span>
      <span className="md-rr-m" data-tip={t('med.wear.tip')}>
        <small><BatteryMedium size={12} /> {t('med.c.wear')}</small>
        <span className="md-wear">{[0, 1, 2, 3, 4, 5, 6].map(i => <i key={i} className={x.wear >= (i + 1) * 2 ? 'on w' + wearLevel((i + 1) * 2) : x.wear > i * 2 ? 'half' : ''} />)}</span>
        <b className={'num' + (wl >= 2 ? ' bad' : wl === 1 ? ' warn' : '')}>{t('med.wear.' + wl)}</b>
      </span>
      <span className="md-rr-m" data-tip={t('med.sharp.tip')}>
        <small><Zap size={12} /> {t('med.c.sharp')}</small>
        <Meter v={sharp} tone={sharp < 0.9 ? 'bad' : sharp < 0.97 ? 'warn' : 'cyan'} />
        <b className="num">{pct(lang, sharp)}</b>
      </span>
    </div>
  )
}
