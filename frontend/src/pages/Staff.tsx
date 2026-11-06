// The staff room (staff work stream): the coaching staff and the medical team as game cards, the
// decisions they bring you, mentoring, the assistant's notes and the staff room's news.
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Ctx } from '../App'
import { money } from '../api'
import { staffApi, type RoleSlot, type StaffCard, type StaffRoomView } from '../api_staff'
import { errText, useI18n } from '../i18n'
import { CountUp, Icon, Loading, PageHead, fmtMoney } from '../ui'
import { DecisionsPanel } from './staff/Decisions'
import { HireDialog, MentorDialog } from './staff/Dialogs'
import { EffectsPanel, MentoringPanel, StaffLogPanel, StaffNotes } from './staff/Notes'
import { MemberCard, VacantCard } from './staff/StaffCard'
import { useStaffAct } from './staff/parts'

export default function Staff({ ctx }: { ctx: Ctx }) {
  const { t } = useI18n()
  const { st } = ctx
  const [room, setRoom] = useState<StaffRoomView | null>(null)
  const [err, setErr] = useState('')
  const [hireRole, setHireRole] = useState<string | null>(null)
  const [mentorFor, setMentorFor] = useState<number | null>(null)
  const load = useCallback(() => staffApi.room(ctx.id).then(r => { setRoom(r); setErr('') }).catch(e => setErr(errText(t, e))), [ctx.id, t])
  // a fresh look after every matchday, signing or answer
  const key = `${st.career.season}:${st.career.day}:${st.club.budget}:${st.squad.length}:${st.coaches?.length ?? 0}`
  useEffect(() => { load() }, [load, key])
  const { busy, act } = useStaffAct(ctx, load)
  const names = useMemo(() => Object.fromEntries((room?.slots ?? []).filter(s => s.coach).map(s => [s.coach!.id, s.coach!.name])), [room])

  if (!room) {
    return (
      <>
        <PageHead icon="staff" eyebrow={t('sr.dec.inbox')} title={t('tab.staff')} />
        {err ? <section className="panel"><p className="muted">{err}</p><button onClick={load}><Icon name="rotate" size={16} /> {t('retry')}</button></section> : <Loading />}
      </>
    )
  }
  const coaching = room.slots.filter(s => s.group !== 'medical')
  const medical = room.slots.filter(s => s.group === 'medical')
  const hireSlot = room.slots.find(s => s.role === hireRole) ?? null
  const mentorCoach = room.slots.find(s => s.coach?.id === mentorFor)?.coach ?? null
  const card = (s: RoleSlot) => s.coach
    ? <MemberCard key={s.role} c={s.coach} slot={s} ctx={ctx} busy={busy || !!st.career.ended}
        onHire={() => setHireRole(s.role)} onMentor={() => setMentorFor(s.coach!.id)}
        onUnmentor={(playerId, name) => act({ action: 'unmentor', playerId }, () => t('sr.mentor.stopped', { name }))}
        onBonus={() => act({ action: 'bonus', coachId: s.coach!.id }, () => t('sr.bonused', { name: s.coach!.name }))}
        onCourse={() => act({ action: 'course', coachId: s.coach!.id }, r => t('sr.coursed', { name: s.coach!.name, n: r.ceil ?? s.coach!.courseCeil }))}
        onFire={() => act({ action: 'fire', coachId: s.coach!.id }, () => t('sr.fired', { name: (s.coach as StaffCard).name }), () => true)} />
    : <VacantCard key={s.role} slot={s} disabled={!!st.career.ended} onHire={() => setHireRole(s.role)} />

  return (
    <>
      <PageHead icon="staff" eyebrow={t('sr.eyebrow', { n: room.filled, m: room.slots.length })} title={t('tab.staff')}>
        <div className="row">
          <span className="chip num" data-tip={t('sr.wagesTip')}><Icon name="wages" size={14} /> {t('sr.wages', { v: money(room.wages) })}</span>
          <span className="chip num"><Icon name="budget" size={14} /> <CountUp v={st.club.budget} fmt={fmtMoney} /></span>
        </div>
      </PageHead>

      <DecisionsPanel ctx={ctx} decisions={room.decisions} after={load} />

      <div className="sr-layout">
        <div className="sr-main">
          <section className="sr-group">
            <div className="sr-grouphead">
              <h3><Icon name="staff" size={18} /> {t('sr.grp.coaching')}</h3>
              <p>{t('sr.grp.coaching.d')}</p>
            </div>
            <div className="sr-cards">{coaching.map(card)}</div>
          </section>
          {medical.length > 0 && (
            <section className="sr-group">
              <div className="sr-grouphead">
                <h3><Icon name="medical" size={18} /> {t('sr.grp.medical')}</h3>
                <p>{t('sr.grp.medical.d')}</p>
                <button className="small" onClick={() => ctx.go('medical')}><Icon name="injury" size={14} /> {t('sr.openMedical')}</button>
              </div>
              <div className="sr-cards">{medical.map(card)}</div>
            </section>
          )}
        </div>
        <aside className="sr-side">
          <StaffNotes room={room} />
          <EffectsPanel room={room} />
          <MentoringPanel room={room} />
          <StaffLogPanel room={room} />
        </aside>
      </div>

      {hireSlot && <HireDialog slot={hireSlot} budget={st.club.budget} busy={busy} act={act} onClose={() => setHireRole(null)} />}
      {mentorCoach && <MentorDialog coach={mentorCoach} youngsters={room.youngsters} names={names} busy={busy} act={act} onClose={() => setMentorFor(null)} />}
    </>
  )
}
