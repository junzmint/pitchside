import { HeartPulse, Hospital, ScanLine, Stethoscope, Waves, Scissors, BriefcaseMedical, type LucideIcon } from 'lucide-react'
import type { Ctx } from '../../App'
import { api, money } from '../../api'
import type { MedTeam } from '../../api_medical'
import type { Coach } from '../../types'
import { errText, useI18n } from '../../i18n'
import { ConfirmButton, Icon } from '../../ui'
import { dec, pct } from './parts'

/** The medical team: the doctor, the physio and the fitness coach with what each is worth in
 *  numbers, and the medical centre with what every level adds. */
export function TeamPanel({ ctx, team, onChange }: { ctx: Ctx; team: MedTeam; onChange: () => void }) {
  const { t, lang } = useI18n()
  const fit = team.fitness?.skill ?? 0
  return (
    <div className="stack">
      <div className="md-staff">
        <StaffCard ctx={ctx} role="doctor" icon={BriefcaseMedical} c={team.doctor} lines={[
          t('med.eff.misdiag', { p: pct(lang, team.misdiag) }),
          t('med.eff.comp', { p: pct(lang, team.comp) }),
          t('med.eff.surgery', { p: pct(lang, team.surgery) }),
          t('med.eff.spot', { p: pct(lang, team.spot) }),
          t('med.eff.warn', { x: dec(lang, team.ratio) }),
        ]} />
        <StaffCard ctx={ctx} role="physio" icon={Stethoscope} c={team.physio} lines={[
          t('med.eff.rehab', { p: pct(lang, team.rehab) }),
          t('med.eff.setback', { p: pct(lang, team.setback) }),
        ]} />
        <StaffCard ctx={ctx} role="fitness" icon={HeartPulse} c={team.fitness} lines={[
          t('med.eff.fitPrevent', { p: pct(lang, Math.min(20, fit) * 0.008) }),
          t('med.eff.sharp'),
        ]} />
      </div>
      <div className="md-prevent">
        <Icon name="defense" size={18} />
        <span>{t('med.eff.prevent', { p: pct(lang, team.prevent) })}</span>
        {team.perks.length > 0 && <span className="perks">{team.perks.map(p => <span key={p} className="perkchip" data-tip={t('perk.' + p + '.d')}><Icon name="bonus" size={11} /> {t('perk.' + p)}</span>)}</span>}
      </div>
      <Centre ctx={ctx} team={team} onChange={onChange} />
    </div>
  )
}

function StaffCard({ ctx, role, icon: Ico, c, lines }: { ctx: Ctx; role: string; icon: LucideIcon; c: Coach | null; lines: string[] }) {
  const { t } = useI18n()
  return (
    <section className={'panel md-staffcard' + (c ? '' : ' vacant')}>
      <header>
        <span className="md-staff-ico"><Ico size={24} /></span>
        <div>
          <span className="eyebrow">{t('role.' + role)}</span>
          <b className="md-staff-name">{c ? c.name : t('med.vacant')}</b>
        </div>
        {c && <span className="md-stars" data-tip={`${c.skill}/20`}>{[0, 1, 2, 3, 4].map(i => <Icon key={i} name="star" size={13} className={i < Math.round(c.skill / 4) ? 'on' : ''} />)}<b className="num">{c.skill}</b></span>}
      </header>
      <p className="muted md-staff-does">{t('role.' + role + '.does')}</p>
      {c ? (
        <>
          {(c.perks?.length ?? 0) > 0 && <span className="perks">{c.perks!.map(p => <span key={p} className="perkchip" data-tip={t('perk.' + p + '.d')}><Icon name="bonus" size={11} /> {t('perk.' + p)}</span>)}</span>}
          <ul className="md-effects">{lines.map((l, i) => <li key={i}><Icon name="check" size={12} /> {l}</li>)}</ul>
        </>
      ) : (
        <>
          <p className="md-vacant-txt"><Icon name="warn" size={14} /> {t('med.vacant.' + role)}</p>
          <button className="small" onClick={() => ctx.go('staff')}><Icon name="hire" size={14} /> {t('med.toStaff')}</button>
        </>
      )}
    </section>
  )
}

const FAC_ICON: LucideIcon[] = [Hospital, HeartPulse, ScanLine, Waves, Scissors]

function Centre({ ctx, team, onChange }: { ctx: Ctx; team: MedTeam; onChange: () => void }) {
  const { t } = useI18n()
  async function upgrade() {
    try {
      await api.upgradeFacility(ctx.id, 'medical')
      ctx.toast(t('med.centre.upgraded'))
      await ctx.reload()
      onChange()
    } catch (e) { ctx.toast(errText(t, e), true) }
  }
  return (
    <section className="panel stack md-centre">
      <div className="row spread">
        <h3 className="ttl"><Icon name="medical" size={16} />{t('med.centre')}</h3>
        {team.nextLvl > 0
          ? <ConfirmButton className="primary small" label={<><Icon name="up" size={14} /> {t('dev.upgrade', { v: money(team.nextLvl) })}</>} confirm={t('confirm')}
              disabled={team.nextLvl > ctx.st.club.budget} onConfirm={upgrade} />
          : <span className="chip special"><Icon name="crown" size={13} /> {t('med.centre.max')}</span>}
      </div>
      <ol className="md-levels">
        {FAC_ICON.map((Ico, i) => {
          const lvl = i + 1
          const on = team.centre >= lvl
          return (
            <li key={lvl} className={on ? 'on' : team.centre + 1 === lvl ? 'next' : ''}>
              <span className="md-lvl-ico"><Ico size={22} /><b className="num">{lvl}</b></span>
              <b>{t('med.fac.' + lvl + '.n')}</b>
              <small>{t('med.fac.' + lvl)}</small>
              {!on && <Icon name="lock" size={13} className="md-lock" />}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
