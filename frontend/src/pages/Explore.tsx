import { useCallback, useEffect, useState } from 'react'
import type { Ctx } from '../App'
import type { CareerState } from '../types'
import { errText, useI18n } from '../i18n'
import { Loading } from '../ui'
import { money } from '../api'
import { badgeOf, exploreApi, type ExploreFull, type FeedItem } from '../api_explore'
import { Ring } from './explore/common'
import Scouting from './explore/Scouting'
import Achievements from './explore/Achievements'
import Museum from './explore/Museum'
import Career from './explore/Career'
import Album from './explore/Album'
import News from './explore/News'

type XTab = 'scout' | 'ach' | 'museum' | 'career' | 'album' | 'news'
const XTABS: { key: XTab; icon: string }[] = [
  { key: 'scout', icon: '🧭' }, { key: 'ach', icon: '🏅' }, { key: 'museum', icon: '🏆' }, { key: 'career', icon: '💼' }, { key: 'album', icon: '🃏' }, { key: 'news', icon: '📰' },
]
const TAB_KEY = 'pitchside.exploreTab'

export interface XCtx {
  ctx: Ctx
  x: ExploreFull
  /** reload the Explore data (and the career state when the action changed it) */
  refresh: (career?: boolean) => Promise<void>
}

/** One line of the discovery feed (also used for DayReport.discoveries). */
export function feedText(t: (k: string, p?: Record<string, string | number>) => string, e: { key: string; name?: string; amount?: number }) {
  let name = e.name ?? ''
  if (e.key === 'ach') name = t('ex.a.' + name)
  else if (e.key === 'mission_back') name = t('ex.rg.' + name)
  const v = e.key === 'golden_cash' ? money(e.amount ?? 0) : String(e.amount ?? '')
  return t('exd.' + e.key, { name, v })
}

// Explore work stream: scouting missions, discoveries, achievements, trophy room, manager career, legend album.
export default function Explore({ ctx }: { ctx: Ctx }) {
  const { t } = useI18n()
  const [tab, setTabState] = useState<XTab>(() => {
    try {
      const v = sessionStorage.getItem(TAB_KEY)
      if (v && XTABS.some(x => x.key === v)) return v as XTab
    } catch { /* ignore */ }
    return 'scout'
  })
  const setTab = (v: XTab) => {
    setTabState(v)
    try { sessionStorage.setItem(TAB_KEY, v) } catch { /* ignore */ }
  }
  const [x, setX] = useState<ExploreFull | null>(null)
  const load = useCallback(async () => {
    try { setX(await exploreApi.get(ctx.id)) } catch (e) { ctx.toast(errText(t, e), true) }
  }, [ctx.id])
  useEffect(() => { load() }, [load, ctx.st.career.day, ctx.st.career.userClubId, ctx.st.career.season])
  // the celebration pop-up can send us to the trophy room
  useEffect(() => {
    try {
      const v = sessionStorage.getItem(TAB_KEY)
      if (v && v !== tab && XTABS.some(k => k.key === v)) setTabState(v as XTab)
    } catch { /* ignore */ }
  })
  const refresh = useCallback(async (career = true) => {
    await Promise.all([load(), career ? ctx.reload() : Promise.resolve()])
  }, [load, ctx])

  const b = badgeOf(ctx.st.exploreView)
  if (!x) return <Loading />
  const count: Partial<Record<XTab, number>> = { scout: b?.reports ?? 0, ach: b?.unclaimed ?? 0, career: b?.offers ?? 0 }
  const got = x.achievements.filter(a => a.got).length
  const nextTier = x.tiers.find(tr => tr.min > x.manager.rep)

  return (
    <div className="explore">
      <div className="head">
        <div>
          <span className="eyebrow">{t('ex.eyebrow')}</span>
          <h2>{t('tab.explore')}</h2>
        </div>
        <div className="ex-hero">
          <Ring value={x.manager.rep} max={100} size={64} stroke={6} color="var(--hot)"><b className="num">{Math.round(x.manager.rep)}</b></Ring>
          <div className="stack" style={{ gap: 2 }}>
            <span className="muted small">{t('ex.rep')}</span>
            <b className={'ex-tiername t-' + (b?.tier ?? 'unknown')}>{t('ex.tier.' + (b?.tier ?? 'unknown'))}</b>
            <span className={'ex-titlechip' + (x.badge.title ? '' : ' none')}>🎖 {x.badge.title ? t('ex.title.' + x.badge.title) : t('ex.noTitle')}</span>
          </div>
          <div className="ex-herostats">
            <span>🏅 <b className="num">{got}</b>/{x.achievements.length}</span>
            <span>🏆 <b className="num">{x.trophies.length}</b></span>
            <span>🃏 <b className="num">{x.albumOwned}</b>/{x.albumTotal}</span>
            {nextTier && <span className="muted">→ {t('ex.tier.' + nextTier.key)} {nextTier.min}</span>}
          </div>
        </div>
      </div>

      <nav className="ex-tabs" role="tablist">
        {XTABS.map(tb => (
          <button key={tb.key} role="tab" aria-selected={tab === tb.key} className={tab === tb.key ? 'on' : ''} onClick={() => setTab(tb.key)}>
            <span aria-hidden="true">{tb.icon}</span> {t('ex.t.' + tb.key)}
            {(count[tb.key] ?? 0) > 0 && <span className="ex-count num">{count[tb.key]}</span>}
          </button>
        ))}
      </nav>

      <Feed items={x.feed} />

      {tab === 'scout' && <Scouting ctx={ctx} x={x} refresh={refresh} />}
      {tab === 'ach' && <Achievements ctx={ctx} x={x} refresh={refresh} />}
      {tab === 'museum' && <Museum ctx={ctx} x={x} refresh={refresh} />}
      {tab === 'career' && <Career ctx={ctx} x={x} refresh={refresh} />}
      {tab === 'album' && <Album ctx={ctx} x={x} refresh={refresh} />}
      {tab === 'news' && <News ctx={ctx} x={x} refresh={refresh} />}
    </div>
  )
}

function Feed({ items }: { items: FeedItem[] }) {
  const { t } = useI18n()
  if (!items.length) return <p className="ex-feed empty muted">{t('ex.feedEmpty')}</p>
  return (
    <div className="ex-feed" aria-label={t('ex.feed')}>
      <b className="ex-feedlabel">{t('ex.feed')}</b>
      <div className="ex-feedrow">
        {items.slice(0, 8).map((e, i) => (
          <span key={i} className={'ex-feeditem r-' + (e.rarity || 'common')} title={t('seasonN', { n: e.season }) + ' · ' + e.day}>{feedText(t, e)}</span>
        ))}
      </div>
    </div>
  )
}

/** Items in the Explore section that want attention (badge on the menu). */
export function exploreCount(st: CareerState): number {
  return badgeOf(st.exploreView)?.count ?? 0
}
