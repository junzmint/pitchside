import { useEffect, useState } from 'react'
import { money } from '../../api'
import { STAGE_TAB_KEY, stageApi, type NewsItem } from '../../api_stage'
import { errText, useI18n } from '../../i18n'
import { Icon, Loading, TabBar } from '../../ui'
import type { XCtx } from '../Explore'
import { headline, NewsCrests, rich, whenText } from '../stage/common'
import AwardsView from '../stage/AwardsView'
import TournamentView from '../stage/TournamentView'

// The world around the club (stage stream): the news feed (AI transfers and sackings from
// world_ai.go, storylines, awards and tournaments from stage*.go), the Golden Ball history and the
// summer international tournament.
export type { NewsItem } from '../../api_stage'
export const newsApi = { list: (id: number, limit = 120) => stageApi.news(id, limit) }

type Tab = 'feed' | 'awards' | 'intl'
type Filter = 'big' | 'story' | 'transfer' | 'sacked' | 'award' | 'all'

function readTab(): Tab | null {
  try {
    const v = sessionStorage.getItem(STAGE_TAB_KEY)
    if (v === 'feed' || v === 'awards' || v === 'intl') return v
  } catch { /* ignore */ }
  return null
}

export default function News({ ctx }: XCtx) {
  const { t } = useI18n()
  const [tab, setTabState] = useState<Tab>(() => readTab() ?? 'feed')
  const setTab = (v: Tab) => {
    setTabState(v)
    try { sessionStorage.setItem(STAGE_TAB_KEY, v) } catch { /* ignore */ }
  }
  // a pop-up (awards night, tournament) can send us to one of the tabs
  useEffect(() => {
    const v = readTab()
    if (v && v !== tab) setTabState(v)
  })
  return (
    <div className="stack sg-news">
      <TabBar<Tab> value={tab} onChange={setTab} label={t('ex.t.news')} options={[
        ['feed', 'broadcast', t('nw.tab.feed'), t('nw.tab.feedSub')],
        ['awards', 'legend', t('nw.tab.awards'), t('nw.tab.awardsSub')],
        ['intl', 'flag', t('nw.tab.intl'), t('nw.tab.intlSub')],
      ]} />
      {tab === 'feed' && <Feed ctx={ctx} />}
      {tab === 'awards' && <AwardsView ctx={ctx} />}
      {tab === 'intl' && <TournamentView ctx={ctx} />}
    </div>
  )
}

function Feed({ ctx }: { ctx: XCtx['ctx'] }) {
  const { t } = useI18n()
  const [items, setItems] = useState<NewsItem[] | null>(null)
  const [filter, setFilter] = useState<Filter>('big')
  useEffect(() => {
    stageApi.news(ctx.id, 160).then(setItems).catch(e => ctx.toast(errText(t, e), true))
  }, [ctx.id, ctx.st.career.day, ctx.st.career.season])
  if (!items) return <Loading />
  const keep = (n: NewsItem) => {
    switch (filter) {
      case 'all': return true
      case 'big': return !!n.big || !!n.mine
      case 'story': return n.kind === 'story'
      case 'award': return n.kind === 'award' || n.kind === 'intl'
      default: return n.kind === filter
    }
  }
  const shown = items.filter(keep)
  const hero = shown.find(n => n.kind !== 'transfer' && n.kind !== 'sacked') ?? shown[0]
  const rest = shown.filter(n => n !== hero)
  // grouped by matchday, newest first
  const groups: { label: string; items: NewsItem[] }[] = []
  for (const n of rest) {
    const label = whenText(t, n)
    const g = groups[groups.length - 1]
    if (g && g.label === label) g.items.push(n)
    else groups.push({ label, items: [n] })
  }
  const windowOpen = ctx.st.career.day >= 24 && ctx.st.career.day <= 29
  return (
    <section className="panel stack sg-feed">
      <div className="row spread">
        <h3 className="ttl"><Icon name="broadcast" size={16} /> {t('news.title')}</h3>
        <span className={'chip' + (windowOpen ? ' special' : '')}>{windowOpen ? t('news.windowOpen') : t('news.windowNext')}</span>
      </div>
      <div className="row sg-filters" role="group" aria-label={t('nw.filter')}>
        {(['big', 'story', 'transfer', 'sacked', 'award', 'all'] as Filter[]).map(f => (
          <button key={f} className={'small' + (filter === f ? ' primary' : '')} aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {t(f === 'story' ? 'nw.f.story' : f === 'award' ? 'nw.f.award' : 'news.f.' + f)}
          </button>
        ))}
      </div>
      {shown.length === 0 && <p className="muted" style={{ margin: 0 }}>{filter === 'story' ? t('tk.empty') : t('news.empty')}</p>}
      {hero && <Hero n={hero} />}
      {groups.map(g => (
        <div key={g.label} className="sg-daygroup">
          <span className="sg-daylabel">{g.label}</span>
          <div className="sg-items">{g.items.map(n => <Item key={n.id} n={n} />)}</div>
        </div>
      ))}
    </section>
  )
}

function Hero({ n }: { n: NewsItem }) {
  const { t, lang } = useI18n()
  const h = headline(t, lang, n)
  return (
    <article className={'sg-hero tone-' + h.tone + (n.mine ? ' mine' : '')} style={{ ['--kit' as string]: n.fromColor ?? 'var(--club)' }}>
      <span className="sg-heroicon"><Icon name={h.icon} size={30} /></span>
      <div className="stack" style={{ gap: 6, minWidth: 0 }}>
        <span className="eyebrow">{t('nw.hero')} · {whenText(t, n)}{n.mine && <span className="chip mine">{t('nw.mine')}</span>}</span>
        <p className="sg-herotext">{rich(t(h.key), h.params, h.bold)}</p>
        {n.kind === 'transfer' && <span className="muted">{n.ovr ? `${n.ovr} · ` : ''}{n.age ? t('news.age', { n: n.age }) : ''}</span>}
      </div>
      <NewsCrests n={n} size={44} />
    </article>
  )
}

function Item({ n }: { n: NewsItem }) {
  const { t, lang } = useI18n()
  const h = headline(t, lang, n)
  return (
    <article className={'sg-item tone-' + h.tone + (n.big ? ' big' : '') + (n.mine ? ' mine' : '')}>
      <span className="sg-itemicon"><Icon name={h.icon} size={18} /></span>
      <div className="sg-itemtext">
        <p>{rich(t(h.key), h.params, h.bold)}</p>
        <small className="muted">
          {n.kind === 'transfer' && <>{n.ovr ? `${n.ovr} · ` : ''}{n.age ? t('news.age', { n: n.age }) : ''}</>}
          {n.kind === 'sacked' && n.to && t('news.successor', { coach: n.to })}
          {n.mine && <span className="chip mine">{t('nw.mine')}</span>}
        </small>
      </div>
      {n.kind === 'transfer' && <b className="num sg-fee">{money(n.fee ?? 0)}</b>}
      <NewsCrests n={n} />
    </article>
  )
}
