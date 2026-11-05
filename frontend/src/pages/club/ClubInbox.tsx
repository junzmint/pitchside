// Club life in the Inbox: the decisions waiting in club life (the summer tour, a legend's shirt
// number). Deadline Day bids already land in the events stream's bid list.
// Mount with one line in Inbox.tsx: `<ClubInbox ctx={ctx} />`; add `clubWaiting(st)` (api_club.ts)
// to inboxCount for the badge.
import { useState } from 'react'
import type { Ctx } from '../../App'
import { useClubLife } from '../../api_club'
import { useI18n } from '../../i18n'
import { Icon, Title } from '../../ui'
import { HonourChoices, HonourModal, LegendCard } from './Legends'

export function ClubInbox({ ctx }: { ctx: Ctx }) {
  const { t } = useI18n()
  const v = useClubLife(ctx.st)
  const [open, setOpen] = useState(false)
  if (!v || ctx.st.career.ended) return null
  const tour = v.tour?.open && !v.tour.chosen
  const le = v.honour && v.honour.shirt > 0 ? v.honour : null
  if (!tour && !le) return null
  return (
    <section className="panel stack">
      <Title icon="club">{t('cl.fans.title')} · {t('cl.lg.title')}</Title>
      {tour && (
        <div className="cl-nudge">
          <Icon name="flag" size={18} />
          <span>{t('cl.tour.nudge')}</span>
          <button className="primary small" onClick={() => ctx.go('match')}>{t('cl.tour.nudgeBtn')}</button>
        </div>
      )}
      {le && (
        <div className="stack" style={{ gap: 8 }}>
          <LegendCard le={le} compact />
          <span className="muted" style={{ fontSize: 13 }}>{t('cl.lg.decideHint', { n: le.shirt })}</span>
          <HonourChoices ctx={ctx} le={le} onMore={() => setOpen(true)} />
        </div>
      )}
      {le && open && <HonourModal ctx={ctx} le={le} onClose={() => setOpen(false)} />}
    </section>
  )
}
