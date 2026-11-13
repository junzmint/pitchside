import { useState } from 'react'
import type { Ctx } from '../App'
import { api, money } from '../api'
import { staffApi } from '../api_staff'
import type { Alert } from '../types'
import { Icon, type IconName } from '../ui'
import { errText, useI18n, type TFn } from '../i18n'
import { WhoTag, whoIn, type MailWho } from './MailTags'
import { LockAnswer, isLockAlert } from './LockXI'

// "Needs your attention" (backend alerts.go): unhappy coaches and players, contracts running out,
// talks waiting for an answer, money trouble, empty staff roles, decisions waiting. Each line has a
// quick fix (a coach's bonus, opening renewal talks) or takes you to the page that sorts it out.

const ICON: Record<string, IconName> = {
  debt: 'budget', coach_unhappy: 'staff', coach_angry: 'staff', coach_retiring: 'staff', coach_contract: 'contract', role_vacant: 'warn',
  staff_cards: 'staff', medical_cards: 'injury', talks_raise: 'chat', talks_renewal: 'contract', player_unrest: 'warn',
  player_contract: 'contract', contracts_many: 'contract', player_unhappy: 'user', players_unhappy: 'users',
  lock_tired: 'fitness', lock_knock: 'injury', lock_morale: 'user', lock_resting: 'lock',
}

export function alertText(t: TFn, a: Alert) {
  return t('al.' + a.key, { name: a.name ?? '', role: a.role ? t('role.' + a.role) : '', n: a.n ?? 0, v: money(a.amount ?? 0), names: (a.names ?? []).join(', ') })
}

/** Who an alert is about, for its tag: a coach, an icon or a squad player (none for money or medical ones). */
function alertWho(a: Alert, squad: Ctx['st']['squad']): MailWho | null {
  if (a.kind === 'coach' || a.key.startsWith('coach_') || a.key === 'role_vacant') return 'coach'
  if (a.kind === 'player' && a.id) return whoIn(squad, a.id)
  return a.key === 'contracts_many' || a.key === 'players_unhappy' ? 'player' : null
}

/** Alerts that matter for the Inbox: those it doesn't already show as cards of their own. */
export const inboxAlerts = (alerts: Alert[] | null | undefined) => (alerts ?? []).filter(a => a.action !== 'talks' && a.key !== 'staff_cards' && a.key !== 'medical_cards')

export function AlertsPanel({ ctx, alerts, max = 6 }: { ctx: Ctx; alerts: Alert[] | null | undefined; max?: number }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState('')
  const [all, setAll] = useState(false)
  const list = alerts ?? []
  if (list.length === 0) return null
  const shown = all ? list : list.slice(0, max)
  const keyOf = (a: Alert, i: number) => `${a.key}-${a.id ?? ''}-${a.role ?? ''}-${i}`
  async function run(a: Alert, k: string) {
    setBusy(k)
    try {
      if (a.action === 'bonus' && a.ready && a.id) {
        await staffApi.act(ctx.id, { action: 'bonus', coachId: a.id })
        ctx.toast(t('al.bonusDone', { name: a.name ?? '' }))
        await ctx.reload()
      } else if (a.action === 'renew' && a.id) {
        await api.renew(ctx.id, a.id)
        ctx.toast(t('ct.talks', { name: a.name ?? '' }))
        await ctx.reload()
      } else {
        const tab = ({ bonus: 'staff', talks: 'inbox', staff: 'staff', medical: 'medical', finance: 'finance', squad: 'squad', renew: 'squad', rest: 'tactics', unrest: 'tactics' } as const)[a.action] ?? 'squad'
        ctx.go(tab)
      }
    } catch (e) { ctx.toast(errText(t, e), true) } finally { setBusy('') }
  }
  const label = (a: Alert) => (a.action === 'bonus' ? (a.ready ? t('al.do.bonus', { v: money(a.amount ?? 0) }) : t('al.do.staff')) : t('al.do.' + a.action))
  return (
    <section className="panel alerts">
      <h3 className="ttl"><Icon name="warn" size={16} /> {t('al.title', { n: list.length })}</h3>
      <ul>
        {shown.map((a, i) => {
          const k = keyOf(a, i)
          const who = alertWho(a, ctx.st.squad)
          return (
            <li key={k} className={'al-' + a.level}>
              <span className="al-ico"><Icon name={ICON[a.key] ?? 'info'} size={16} /></span>
              <span className="al-text">{who && <><WhoTag who={who} role={a.role} />{' '}</>}{alertText(t, a)}</span>
              {isLockAlert(a) ? <LockAnswer ctx={ctx} a={a} />
                : <button className={'small' + (a.level === 'bad' ? ' primary' : '')} disabled={busy === k} onClick={() => run(a, k)}>{label(a)}</button>}
            </li>
          )
        })}
      </ul>
      {list.length > max && <button className="small al-more" onClick={() => setAll(!all)}>{all ? t('al.less') : t('al.more', { n: list.length - max })}</button>}
    </section>
  )
}
