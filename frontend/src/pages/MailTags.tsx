// Inbox mail tags: who a mail is about (a squad player, an icon, someone on the staff) and what it is (a club
// bidding for him, a raise, a new contract …), as two coloured tags at the top of the card, and the card's left
// edge in the colour of who it is about. A bid for an icon never looks like a bid for a squad player, nor a
// coach's raise like a player's. Strings: strings_mail.ts. Styles: game.css (".mtag", ".mail").
import type { ReactNode } from 'react'
import { useI18n } from '../i18n'
import type { Player } from '../types'
import { Icon, type IconName } from '../ui'

export type MailWho = 'player' | 'icon' | 'custom' | 'coach'
export type MailKind = 'bid' | 'raise' | 'renewal' | 'talk' | 'retire' | 'clash' | 'camp' | 'signing' | 'prospect' | 'famous' | 'shop'

const KIND_ICON: Record<MailKind, IconName> = {
  bid: 'handCoins', raise: 'wages', renewal: 'contract', talk: 'talk', retire: 'legend', clash: 'derby',
  camp: 'training', signing: 'buy', prospect: 'youth', famous: 'star', shop: 'icon',
}
// staff who are not coaches get their own word on the tag
const NOT_COACH = new Set(['physio', 'doctor', 'scout'])

/** Who a player is on the tags: an icon (a legend card), one you designed, or a squad player. */
export function whoOf(p: Pick<Player, 'tag'> | null | undefined): MailWho {
  return p?.tag === 'legend' ? 'icon' : p?.tag === 'custom' ? 'custom' : 'player'
}

/** The same, for a mail that names the player by id (bids, talks and wage demands do). */
export const whoIn = (squad: Player[], id: number): MailWho => whoOf(squad.find(p => p.id === id))

/** The card class that colours its left edge: "mail w-player", "mail w-icon" or "mail w-coach". */
export const mailClass = (who: MailWho) => 'mail w-' + (who === 'custom' ? 'icon' : who)

export function WhoTag({ who, role }: { who: MailWho; role?: string }) {
  const { t } = useI18n()
  const staff = who === 'coach'
  const look = who === 'custom' ? 'icon' : who
  const label = staff ? t('mt.who.' + (role && NOT_COACH.has(role) ? role : 'coach')) : t('mt.who.' + who)
  return (
    <span className={'mtag who w-' + look} data-tip={t('mt.who.' + look + '.d')}>
      <Icon name={staff ? 'staff' : look === 'icon' ? 'star' : 'user'} size={14} /> {label}
    </span>
  )
}

export function KindTag({ kind }: { kind: MailKind }) {
  const { t } = useI18n()
  const k = 'mt.' + kind + '.d'
  const tip = t(k)
  return <span className={'mtag kind k-' + kind} data-tip={tip === k ? undefined : tip}><Icon name={KIND_ICON[kind]} size={14} /> {t('mt.' + kind)}</span>
}

/** The tags at the top of a mail: who, what, and on the right whatever the card adds (its countdown). */
export function MailTags({ who, role, kind, children }: { who: MailWho; role?: string; kind: MailKind; children?: ReactNode }) {
  return (
    <div className="mailtags">
      <WhoTag who={who} role={role} />
      <KindTag kind={kind} />
      {children ? <span className="mt-end">{children}</span> : null}
    </div>
  )
}
