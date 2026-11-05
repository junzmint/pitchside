// A player's mentor, as a flag under his card or name (Squad page).
import { mentorOf } from '../../api_staff'
import { useI18n } from '../../i18n'
import type { Player } from '../../types'
import { Icon } from '../../ui'

export function MentorFlag({ p }: { p: Player }) {
  const { t } = useI18n()
  const m = mentorOf(p)
  if (!m) return null
  return (
    <span className="flag mentor" data-tip={t('sr.mentor.tip', { coach: m.coach, n: m.boost })} tabIndex={0}>
      <Icon name="youth" size={12} /> {t('sr.mentor.flag', { n: m.boost })}
    </span>
  )
}
