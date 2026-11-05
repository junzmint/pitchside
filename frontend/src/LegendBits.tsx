import type { Player } from './types'
import { Icon } from './icons'
import { useI18n, type TFn } from './i18n'
import { isClubVersion, versionLabel, type LegendMerge } from './legendVersions'

/** The small home mark of a club version (his card from an era at this club, clubName): he is picked first.
 *  focusable={false} inside buttons (the line-up board), where the tooltip comes from the button itself. */
export function HomeMark({ p, clubName, size = 12, focusable = true }: { p: Player; clubName: string; size?: number; focusable?: boolean }) {
  const { t } = useI18n()
  if (!isClubVersion(p, clubName)) return null
  const tip = `${t('lgv.home')}\n${t('icon.home')}`
  return focusable
    ? <b className="homechip lgv-home" data-tip={tip} tabIndex={0} aria-label={t('lgv.home')}><Icon name="home" size={size} /></b>
    : <b className="homechip lgv-home" title={t('lgv.home')}><Icon name="home" size={size} /></b>
}

/** On the market: signing him merges him with another version of himself at your club. */
export function MergeChip({ partner }: { partner?: Player }) {
  const { t } = useI18n()
  if (!partner) return null
  const name = versionLabel(partner)
  return (
    <span className="flag gold lgv-merge" data-tip={t('lgv.willMergeTip', { name })} tabIndex={0}>
      <Icon name="up" size={12} /> {t('lgv.willMerge', { name })}
    </span>
  )
}

/** The toast after a signing that merged a legend version with his modern self. */
export function mergeText(t: TFn, m: LegendMerge): string {
  return `${t('lgv.merged', { name: m.name })} · ${t('lgv.mergedStats', { a: m.ovrBefore, b: m.ovrAfter, p: m.potBefore, q: m.potAfter })}`
}
