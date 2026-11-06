// "Bring on first": bench players you mark so that, when changes are made, the assistant brings them on first
// (around minutes 55–70, up to three changes a match) and they improve by playing. The quick sim does it in backend
// autoSubs, the live match in Engine.bringOn; Player.bring is the order they come on in (1 first: whoever has
// waited longest for a game). Strings: strings_bench.ts.
import { useState, type MouseEvent } from 'react'
import type { Ctx } from '../App'
import { api } from '../api'
import { errText, useI18n } from '../i18n'
import type { Player } from '../types'
import { Icon } from '../ui'

export const BRING_MAX = 5 // backend BringMax
export const BRING_FLOOR = 0.6 // backend BringFloor: he stays on the bench below this share of the man he would replace

export const isMarked = (p: Player) => (p.bring ?? 0) > 0
export const bringCount = (squad: Player[]) => squad.filter(isMarked).length

/** Far below every starter in his line: the assistant will not bring him on, so the page says so. */
export function bringTooWeak(p: Player, starters: (Player | undefined)[]): boolean {
  const line = starters.filter((s): s is Player => !!s && s.position === p.position)
  return line.length > 0 && p.overall < Math.min(...line.map(s => s.overall)) * BRING_FLOOR
}

/** Mark or unmark him. compact: the small button of the bench table. */
export function BringToggle({ ctx, p, compact }: { ctx: Ctx; p: Player; compact?: boolean }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const on = isMarked(p)
  const full = !on && bringCount(ctx.st.squad) >= BRING_MAX
  async function flip(e: MouseEvent) {
    e.stopPropagation() // (a bench row assigns the player when clicked)
    setBusy(true)
    try {
      await api.setCare(ctx.id, p.id, { bring: !on })
      await ctx.reload()
      ctx.toast(t(on ? 'bring.unset' : 'bring.set', { name: p.name }))
    } catch (err) { ctx.toast(errText(t, err), true) } finally { setBusy(false) }
  }
  return (
    <button className={'bringbtn' + (on ? ' on' : '') + (compact ? ' small' : '')} aria-pressed={on} disabled={busy || full || !!ctx.st.career.ended}
      data-tip={full ? t('err.bring_max') : t('bring.tip')} onClick={flip}>
      <Icon name="up" size={compact ? 13 : 15} /> {compact ? t('bring.short') : t('bring.on')}
      {on && <b className="num" aria-label={t('bring.order', { n: p.bring ?? 0 })}>{p.bring}</b>}
    </button>
  )
}

/** The small mark next to his name on the squad list and cards. */
export function BringFlag({ p }: { p: Player }) {
  const { t } = useI18n()
  if (!isMarked(p)) return null
  return <span className="flag bring" data-tip={`${t('bring.order', { n: p.bring ?? 0 })} · ${t('bring.tip')}`}><Icon name="up" size={12} /> {t('bring.short')} {p.bring}</span>
}
