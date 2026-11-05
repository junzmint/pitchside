// One member of the staff as a game card: portrait, role, skill stars, experience, morale, contract,
// perks, mentees and what you can do with him. A vacant role gets a card too.
import type { Ctx } from '../../App'
import { money } from '../../api'
import { initials, type RoleSlot, type StaffCard } from '../../api_staff'
import { useI18n } from '../../i18n'
import { ConfirmButton, Icon } from '../../ui'
import { Meter, MoraleMeter, PerkChips, Portrait, RoleBadge, SkillLine, StyleChip, TraitChip, roleDoes, roleName, tn } from './parts'

export function MemberCard({ c, slot, ctx, busy, onHire, onMentor, onUnmentor, onBonus, onFire }: {
  c: StaffCard; slot: RoleSlot; ctx: Ctx; busy: boolean
  onHire: () => void; onMentor: () => void; onUnmentor: (playerId: number, name: string) => void; onBonus: () => void; onFire: () => void
}) {
  const { t } = useI18n()
  const st = ctx.st
  const offseason = st.today?.comp === 'offseason'
  const last = c.ends <= st.career.season && !offseason
  const free = c.slots - c.mentees.length
  return (
    <article className={'sr-card r-' + c.role}>
      <div className="sr-top">
        <RoleBadge role={c.role} />
        <span className="sr-rolename">{roleName(t, c.role)}</span>
        {c.levelUp && <span className="sr-ribbon">{t('sr.levelUp')}</span>}
        {c.famous && <span className="sr-ribbon famous">{t('sr.famous')}</span>}
      </div>
      <div className="sr-id">
        <Portrait name={c.name} role={c.role} morale={c.morale} size="lg" />
        <div className="sr-who">
          <span className="sr-name">{c.name}</span>
          <span className="sr-sub">
            <span>{t('nation.' + c.nation)}</span>
            <span>{t('sr.age', { n: c.age })}</span>
            <TraitChip trait={c.trait} />
          </span>
          <span className="sr-sub"><Icon name="history2" size={12} /> {t('sr.seasons', { n: c.seasons })}</span>
        </div>
      </div>
      <SkillLine skill={c.skill} ceil={c.ceil} mood={c.mood} />
      {c.skill < c.ceil && <Meter icon="rocket" label={t('sr.xp')} value={c.xp} max={c.xpNeed} cls="xp" right={`${c.xp}/${c.xpNeed}`} tip={t('sr.xpTip')} />}
      <MoraleMeter morale={c.morale} />
      <div className="sr-meta">
        <span className={'chip' + (last ? ' warn' : '')} data-tip={t('sr.endsTip')}><Icon name="contract" size={12} /> {last ? t('sr.lastYear') : t('sr.ends', { n: c.ends })}</span>
        <span className="chip num"><Icon name="wages" size={12} /> {t('sr.perWeek', { v: money(c.wage) })}</span>
        {c.leaving && <span className="chip bad"><Icon name="release" size={12} /> {t('sr.leaving')}</span>}
        {c.retiring && <span className="chip warn"><Icon name="legend" size={12} /> {t('sr.retiring')}</span>}
        {c.quitRisk && !c.leaving && !c.retiring && <span className="chip bad"><Icon name="warn" size={12} /> {t('sr.quitRisk')}</span>}
      </div>
      {(c.perks.length > 0 || c.style) && <div className="row" style={{ gap: 4 }}><StyleChip style={c.style} /><PerkChips perks={c.perks} /></div>}
      {c.slots > 0 && (
        <div className="sr-mentees">
          <small><Icon name="youth" size={12} /> {t('sr.mentor.slots', { n: c.mentees.length, m: c.slots })}</small>
          {c.mentees.map(m => (
            <span key={m.playerId} className="sr-mentee" data-tip={`${m.name} · ${m.age} · ${m.overall} → ${m.potential}\n${t('sr.mentor.fit.' + m.fit)}`}>
              <i>{initials(m.name)}</i><b>{m.name}</b><em>+{m.boost}%</em>
              <button aria-label={t('sr.mentor.stop')} data-tip={t('sr.mentor.stop')} disabled={busy} onClick={() => onUnmentor(m.playerId, m.name)}><Icon name="close" size={12} /></button>
            </span>
          ))}
          {free > 0 && <button className="sr-slot" disabled={busy} onClick={onMentor}><Icon name="plus" size={12} /> {t('sr.mentor.add')}</button>}
        </div>
      )}
      <div className="sr-actions">
        <button className="small" disabled={busy || c.bonusIn > 0 || st.club.budget < c.bonusCost} onClick={onBonus}
          data-tip={c.bonusIn > 0 ? tn(t, 'sr.bonusWait', c.bonusIn) : t('sr.bonusTip')}>
          <Icon name="bonus" size={14} /> {c.bonusIn > 0 ? tn(t, 'sr.bonusWait', c.bonusIn) : t('sr.bonus', { v: money(c.bonusCost) })}
        </button>
        <button className="small" disabled={busy} onClick={onHire}><Icon name="search" size={14} /> {t('sr.replace')} · {slot.candidates.length}</button>
        <ConfirmButton className="small danger" disabled={busy} label={<><Icon name="fire" size={14} /> {t('sr.fire')}</>} confirm={t('sr.fireConfirm', { name: c.name })} onConfirm={onFire} />
      </div>
    </article>
  )
}

export function VacantCard({ slot, onHire, disabled }: { slot: RoleSlot; onHire: () => void; disabled?: boolean }) {
  const { t } = useI18n()
  return (
    <article className={'sr-card vacant r-' + slot.role}>
      <div className="sr-top">
        <RoleBadge role={slot.role} />
        <span className="sr-rolename">{roleName(t, slot.role)}</span>
      </div>
      <div className="sr-id">
        <span className="sr-portrait lg empty" aria-hidden="true">?</span>
        <div className="sr-who">
          <span className="sr-name" style={{ color: 'var(--warn)' }}>{t('sr.vacant')}</span>
          <span className="sr-sub">{t('sr.vacant.d')}</span>
        </div>
      </div>
      {roleDoes(t, slot.role) && <p className="hint" style={{ margin: 0 }}><Icon name="info" size={14} className="i" /><span>{roleDoes(t, slot.role)}</span></p>}
      <div className="sr-actions">
        <button className="primary" disabled={disabled} onClick={onHire}><Icon name="hire" size={16} /> {tn(t, 'sr.find', slot.candidates.length)}</button>
      </div>
    </article>
  )
}
