// Dialogs of the staff room: today's candidates for a role, and the young players a coach can mentor.
import { useState } from 'react'
import { money } from '../../api'
import { initials, type CandidateView, type RoleSlot, type StaffCard, type StaffReq, type StaffResult, type YoungView } from '../../api_staff'
import { useI18n } from '../../i18n'
import type { Pos } from '../../types'
import { ConfirmButton, Empty, Icon, Modal, PosTag, Seg } from '../../ui'
import { PerkChips, Portrait, RoleBadge, Stars, StyleChip, TraitChip, fitOf, roleDoes, roleName, tn } from './parts'

type Act = (body: StaffReq, ok?: (r: StaffResult) => string, bad?: (r: StaffResult) => boolean, done?: () => void) => Promise<StaffResult | null>

export function HireDialog({ slot, budget, busy, act, onClose }: { slot: RoleSlot; budget: number; busy: boolean; act: Act; onClose: () => void }) {
  const { t } = useI18n()
  const cur = slot.coach
  return (
    <Modal onClose={onClose} className={'sr-modal r-' + slot.role} label={t('sr.hire.title', { role: roleName(t, slot.role) })}>
      <div className="sr-modal-head">
        <RoleBadge role={slot.role} />
        <h3>{t('sr.hire.title', { role: roleName(t, slot.role) })}</h3>
        <button className="small" onClick={onClose} aria-label={t('cancel')}><Icon name="close" size={16} /></button>
      </div>
      {roleDoes(t, slot.role) && <p className="hint" style={{ margin: 0 }}><Icon name="info" size={14} className="i" /><span>{roleDoes(t, slot.role)}</span></p>}
      {cur && <p className="muted" style={{ margin: 0, fontSize: 13 }}><Icon name="rotate" size={13} /> {t('sr.hire.current', { name: cur.name })}</p>}
      {slot.candidates.length === 0
        ? <Empty icon="users">{t('sr.hire.none')}</Empty>
        : <div className="sr-cands">{slot.candidates.map(c => <Candidate key={c.id} c={c} budget={budget} busy={busy} act={act} onDone={onClose} />)}</div>}
      <span className="muted" style={{ fontSize: 12 }}><Icon name="clock" size={12} /> {t('sr.hire.refresh')}</span>
    </Modal>
  )
}

function Candidate({ c, budget, busy, act, onDone }: { c: CandidateView; budget: number; busy: boolean; act: Act; onDone: () => void }) {
  const { t } = useI18n()
  const [years, setYears] = useState<'1' | '2' | '3'>('2')
  const short = c.price > budget
  return (
    <article className={'sr-cand r-' + c.role + (c.famous ? ' famous' : '')}>
      <div className="sr-id">
        <Portrait name={c.name} role={c.role} />
        <div className="sr-who">
          <span className="sr-name">{c.name}</span>
          <span className="sr-sub"><span>{t('nation.' + c.nation)}</span><span>{t('sr.age', { n: c.age })}</span><TraitChip trait={c.trait} /></span>
          {c.famous && <span className="sr-ribbon famous">{t('sr.famous')}</span>}
        </div>
      </div>
      <div className="sr-skill" data-tip={t('sr.skillTip', { s: c.skill, c: c.ceil })}>
        <Stars skill={c.skill} ceil={c.ceil} />
        <span className="sr-skillnum num">{c.skill}<small>/20</small></span>
        {c.ceil > c.skill && <span className="sr-ceil"><Icon name="up" size={12} /> {t('sr.hire.growTo', { n: c.ceil })}</span>}
      </div>
      {(c.perks.length > 0 || c.style) && <div className="row" style={{ gap: 4 }}><StyleChip style={c.style} /><PerkChips perks={c.perks} /></div>}
      {c.slots > 0 && <span className="muted" style={{ fontSize: 12 }}><Icon name="youth" size={12} /> {tn(t, 'sr.hire.room', c.slots)}</span>}
      <div className="sr-money num">
        <span>{t('sr.hire.fee')}<b>{money(c.price)}</b></span>
        <span>{t('sr.hire.wage')}<b>{t('sr.perWeek', { v: money(c.wage) })}</b></span>
      </div>
      <div className="sr-hirerow">
        <span className="muted" style={{ fontSize: 12 }} data-tip={t('sr.hire.yearsTip')}><Icon name="contract" size={12} /> {t('sr.hire.years')}</span>
        <Seg value={years} onChange={setYears} options={[['1', t('sr.years.1')], ['2', t('sr.years.2')], ['3', t('sr.years.3')]]} label={t('sr.hire.years')} />
      </div>
      <ConfirmButton className="primary small" disabled={busy || short} title={short ? t('sr.hire.noMoney') : undefined}
        label={<><Icon name="sign" size={14} /> {short ? t('sr.hire.noMoney') : t('sr.hire.btn', { v: money(c.price) })}</>} confirm={t('confirm')}
        onConfirm={() => act({ action: 'hire', coachId: c.id, years: Number(years) }, () => t('sr.hire.done', { name: c.name }), undefined, onDone)} />
    </article>
  )
}

export function MentorDialog({ coach, youngsters, names, busy, act, onClose }: {
  coach: StaffCard; youngsters: YoungView[]; names: Record<number, string>; busy: boolean; act: Act; onClose: () => void
}) {
  const { t } = useI18n()
  const rows = [...youngsters].sort((a, b) => (b.boosts[String(coach.id)] ?? 0) - (a.boosts[String(coach.id)] ?? 0))
  return (
    <Modal onClose={onClose} className={'sr-modal r-' + coach.role} style={{ width: 'min(720px, 100%)' }} label={t('sr.mentor.pick', { name: coach.name })}>
      <div className="sr-modal-head">
        <Portrait name={coach.name} role={coach.role} morale={coach.morale} size="sm" />
        <h3>{t('sr.mentor.pick', { name: coach.name })}</h3>
        <button className="small" onClick={onClose} aria-label={t('cancel')}><Icon name="close" size={16} /></button>
      </div>
      <p className="hint" style={{ margin: 0 }}><Icon name="info" size={14} className="i" /><span>{t('sr.mentor.help')}</span></p>
      {rows.length === 0 ? <Empty icon="youth">{t('sr.mentor.none')}</Empty> : (
        <div className="sr-picks">
          {rows.map(y => {
            const boost = y.boosts[String(coach.id)] ?? 0
            const mine = y.mentor === coach.id
            return (
              <div key={y.id} className={'sr-pick' + (mine ? ' mine' : '')}>
                <span className="sr-ini">{initials(y.name)}</span>
                <div className="who">
                  <b>{y.name}</b>
                  <small>
                    <PosTag p={y.position as Pos} role={y.role} /> {t('sr.age', { n: y.age })} · {y.overall} → {y.potential}
                    {y.starter && <span className="flag club">{t('sr.mentor.starter')}</span>}
                    {y.mentor > 0 && !mine && <span className="flag">{t('sr.mentor.has', { name: names[y.mentor] ?? '' })}</span>}
                  </small>
                </div>
                <span className="gain"><b>+{boost}%</b>{t('sr.mentor.fit.' + fitOf(coach.role, y.position))}</span>
                <button className="primary small" disabled={busy || mine}
                  onClick={() => act({ action: 'mentor', coachId: coach.id, playerId: y.id }, r => t('sr.mentor.done', { coach: coach.name, name: y.name, n: r.amount ?? boost }), undefined, onClose)}>
                  <Icon name="youth" size={14} /> {t('sr.mentor.pickBtn')}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </Modal>
  )
}
