import { useState } from 'react'
import { money } from '../../api'
import { exploreApi, type AchView } from '../../api_explore'
import { errText, useI18n } from '../../i18n'
import type { XCtx } from '../Explore'
import { Ring } from './common'

const GROUPS = ['match', 'glory', 'squad', 'explore', 'career'] as const
const GROUP_ICON: Record<string, string> = { match: '⚽', glory: '🏆', squad: '★', explore: '🧭', career: '💼' }
const TIER_COLOR: Record<string, string> = { bronze: '#d08a4e', silver: '#cfd9e6', gold: 'var(--hot)', platinum: '#9ff3ff' }

export default function Achievements({ ctx, x, refresh }: XCtx) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [popped, setPopped] = useState<string[]>([])
  const ready = x.achievements.filter(a => a.got && !a.claimed)
  const got = x.achievements.filter(a => a.got).length

  async function claim(key = '') {
    setBusy(true)
    try {
      const r = await exploreApi.claim(ctx.id, key)
      setPopped(r.keys)
      window.setTimeout(() => setPopped([]), 1600)
      ctx.toast(t('ex.got', { tp: r.tp, m: r.money ? ` · ${money(r.money)}` : '' }) + (r.titles.length ? ` · 🎖 ${r.titles.map(k => t('ex.title.' + k)).join(', ')}` : ''))
      await refresh()
    } catch (e) { ctx.toast(errText(t, e), true) } finally { setBusy(false) }
  }

  return (
    <>
      <section className="panel ex-achhead">
        <Ring value={got} max={x.achievements.length} size={84} stroke={8}><b className="num">{Math.round(100 * got / Math.max(1, x.achievements.length))}%</b></Ring>
        <div className="stack" style={{ gap: 4, flex: 1 }}>
          <b className="big">{t('ex.achN', { a: got, b: x.achievements.length })}</b>
          <div className="row" style={{ gap: 6 }}>
            {(['bronze', 'silver', 'gold', 'platinum'] as const).map(tr => {
              const all = x.achievements.filter(a => a.tier === tr)
              return <span key={tr} className={'chip ex-tierchip t-' + tr}>{t('ex.tierA.' + tr)} {all.filter(a => a.got).length}/{all.length}</span>
            })}
          </div>
        </div>
        {ready.length > 0 && <button className="primary ex-collectall" disabled={busy} onClick={() => claim('')}>🎁 {t('ex.collectAll', { n: ready.length })}</button>}
      </section>

      {GROUPS.map(g => (
        <section key={g} className="panel">
          <h3>{GROUP_ICON[g]} {t('ex.g.' + g)}</h3>
          <div className="ex-achs">
            {x.achievements.filter(a => a.group === g).map(a => <AchCard key={a.key} a={a} busy={busy} popped={popped.includes(a.key)} onClaim={() => claim(a.key)} />)}
          </div>
        </section>
      ))}
    </>
  )
}

function AchCard({ a, busy, popped, onClaim }: { a: AchView; busy: boolean; popped: boolean; onClaim: () => void }) {
  const { t } = useI18n()
  const locked = a.hidden && !a.got
  const cls = `ex-ach t-${a.tier}${a.got ? ' got' : ''}${a.got && !a.claimed ? ' ready' : ''}${locked ? ' locked' : ''}${popped ? ' popped' : ''}`
  return (
    <div className={cls}>
      <Ring value={a.got ? 1 : a.progress} max={a.got ? 1 : Math.max(1, a.target)} size={58} stroke={5} color={TIER_COLOR[a.tier]}>
        <span className="ex-achicon" aria-hidden="true">{locked ? '?' : a.got ? '✔' : GROUP_ICON[a.group]}</span>
      </Ring>
      <div className="stack" style={{ gap: 2, minWidth: 0, flex: 1 }}>
        <b>{locked ? t('ex.locked') : t('ex.a.' + a.key)}</b>
        <span className="muted small">{locked ? t('ex.lockedD') : t('ex.s.' + a.stat, { n: a.target })}</span>
        {!locked && !a.got && a.target > 1 && <span className="small num">{a.progress}/{a.target}</span>}
        {!locked && (
          <span className="ex-reward small">
            {a.tp > 0 && <span>+{a.tp} TP</span>}
            {a.money > 0 && <span>+{money(a.money)}</span>}
            {a.title && <span data-tip={t('ex.titleReward') + ': ' + t('ex.title.' + a.key)}>🎖 {t('ex.title.' + a.key)}</span>}
          </span>
        )}
        {a.got && a.season > 0 && <span className="muted tiny">{t('ex.unlockedS', { n: a.season })}</span>}
      </div>
      <span className={'ex-tierdot t-' + a.tier} data-tip={t('ex.tierA.' + a.tier)} />
      {a.got && !a.claimed && <button className="primary small" disabled={busy} onClick={onClaim}>{t('ex.collect')}</button>}
      {a.claimed && <span className="muted tiny">{t('ex.collected')}</span>}
    </div>
  )
}
