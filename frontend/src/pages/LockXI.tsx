// Locked starters (backend lineup_lock.go): a lock keeps a starter in his slot whatever the assistant does (his
// team pick, the fitness and development rotations, automatic substitutions), so you can grind one player's
// ratings and goals. The assistant only advises a rest (alerts lock_tired, lock_knock, lock_morale) and you
// answer: rest him for the next match, or keep him on. Shown in the inbox, on the Tactics page and in the
// pre-match notes. Strings: strings_lock.ts.
import { useState, type CSSProperties } from 'react'
import type { Ctx } from '../App'
import { api } from '../api'
import type { Alert, Player } from '../types'
import { errText, useI18n } from '../i18n'
import { Icon } from '../ui'

export const isLockAlert = (a: Alert) => a.key.startsWith('lock_')
/** The assistant's advice on locked starters (and the reminders about those you rested). */
export const lockAlerts = (alerts?: Alert[] | null) => (alerts ?? []).filter(isLockAlert)
/** How many pieces of advice wait for an answer (rest or keep him on): they count in the inbox. */
export const lockAsks = (alerts?: Alert[] | null) => lockAlerts(alerts).filter(a => a.action === 'rest').length
/** The locked players' ids (backend Care.Locked), in a stable order. */
export const lockedIds = (locked?: Record<string, number> | null) => Object.keys(locked ?? {}).map(Number).sort((a, b) => a - b)

/** The answer buttons of one piece of advice: rest him next match or keep him on; for a rested player, play him
 *  after all. */
export function LockAnswer({ ctx, a }: { ctx: Ctx; a: Alert }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  async function go(how: 'rest' | 'keep' | 'unrest') {
    if (!a.id) return
    setBusy(true)
    try {
      await api.setCare(ctx.id, a.id, how === 'unrest' ? { rest: false } : how === 'rest' ? { rest: true } : { keep: true })
      await ctx.reload()
      ctx.toast(t('lock.' + how + 'Done', { name: a.name ?? '' }))
    } catch (e) { ctx.toast(errText(t, e), true) } finally { setBusy(false) }
  }
  if (a.action === 'unrest') return <button className="small" disabled={busy} onClick={() => go('unrest')}><Icon name="play" size={13} /> {t('al.do.unrest')}</button>
  return (
    <span className="row lockans">
      <button className={'small' + (a.level === 'bad' ? ' primary' : '')} disabled={busy} onClick={() => go('rest')}><Icon name="fitness" size={13} /> {t('al.do.rest')}</button>
      <button className="small" disabled={busy} onClick={() => go('keep')}><Icon name="lock" size={13} /> {t('al.do.keep')}</button>
    </span>
  )
}

/** The advice with its answers, for the Tactics page and the pre-match notes (the inbox shows it among the alerts). */
export function LockTips({ ctx }: { ctx: Ctx }) {
  const { t } = useI18n()
  const list = lockAlerts(ctx.st.alerts)
  if (!list.length) return null
  return (
    <ul className="notes locktips">
      {list.map(a => (
        <li key={a.key + a.id} className={a.level === 'bad' ? 'bad' : a.level === 'warn' ? 'warn' : ''}>
          <span>{t('al.' + a.key, { name: a.name ?? '', n: a.n ?? 0 })}</span>
          <LockAnswer ctx={ctx} a={a} />
        </li>
      ))}
    </ul>
  )
}

/** The padlock on a slot of the tactics board: gold when he is locked in. */
export function LockToggle({ on, name, role, onClick, style }: { on: boolean; name: string; role: string; onClick: () => void; style: CSSProperties }) {
  const { t } = useI18n()
  return (
    <button type="button" className={'slotlock' + (on ? ' on' : '')} style={style} aria-pressed={on} aria-label={`${on ? t('lock.off') : t('lock.on')} · ${name}`}
      data-tip={on ? t('lock.tipOff', { role }) : t('lock.tip', { name, role })} onClick={onClick}>
      <Icon name="lock" size={12} />
    </button>
  )
}

/** A lock flag in squad lists. */
export function LockFlag({ p }: { p: Player }) {
  const { t } = useI18n()
  if (!p.locked) return null
  return <span className="flag lockf" data-tip={t('lock.flagTip')}><Icon name="lock" size={12} /> {t('lock.short')}</span>
}

/** Locked players out injured: covered for now, back in their slot once fit; you can unlock them here (then save).
 *  The ones you rested are in LockTips, with the button that puts them back. */
export function LockAway({ squad, locked, locks, lineup, roles, onUnlock }: {
  squad: Player[]; locked: Record<string, number> | null | undefined; locks: number[]; lineup: number[]; roles: string[]; onUnlock: (id: number) => void
}) {
  const { t } = useI18n()
  const xi = new Set(lineup)
  const away = squad.filter(p => locks.includes(p.id) && locked?.[p.id] != null && !xi.has(p.id) && !p.resting && p.injury > 0)
  if (!away.length) return null
  return (
    <ul className="notes lockaway">
      {away.map(p => {
        const role = roles[locked![p.id]] ?? ''
        return (
          <li key={p.id} className="muted">
            <span><Icon name="injury" size={13} /> {t('lock.away', { name: p.name, n: p.injury, role })}</span>
            <button className="small" onClick={() => onUnlock(p.id)}>{t('lock.off')}</button>
          </li>
        )
      })}
    </ul>
  )
}
