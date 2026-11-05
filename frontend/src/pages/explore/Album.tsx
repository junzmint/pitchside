import { useEffect, useMemo, useState } from 'react'
import { exploreApi, type AlbumCard } from '../../api_explore'
import { Hint, Loading, PosTag } from '../../ui'
import { errText, useI18n } from '../../i18n'
import type { XCtx } from '../Explore'
import { Ring, flag } from './common'

const PAGE = 40

export default function Album({ ctx, x }: XCtx) {
  const { t } = useI18n()
  const [cards, setCards] = useState<AlbumCard[] | null>(null)
  const [q, setQ] = useState('')
  const [owned, setOwned] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  useEffect(() => { exploreApi.album(ctx.id).then(a => setCards(a.cards)).catch(e => ctx.toast(errText(t, e), true)) }, [ctx.id, x.albumOwned])

  // one row per legend, his card versions side by side
  const groups = useMemo(() => {
    const m = new Map<string, AlbumCard[]>()
    for (const c of cards ?? []) {
      if (q && !c.name.toLowerCase().includes(q.toLowerCase())) continue
      if (!m.has(c.name)) m.set(c.name, [])
      m.get(c.name)!.push(c)
    }
    let out = [...m.entries()].map(([name, cs]) => ({ name, cards: cs, got: cs.filter(c => c.owned > 0).length }))
    if (owned) out = out.filter(g => g.got > 0)
    return out.sort((a, b) => b.got - a.got || Math.max(...b.cards.map(c => c.ovr)) - Math.max(...a.cards.map(c => c.ovr)))
  }, [cards, q, owned])

  if (!cards) return <Loading />
  const total = cards.length
  const have = cards.filter(c => c.owned > 0).length
  return (
    <>
      <section className="panel ex-albumhead">
        <Ring value={have} max={total} size={84} stroke={8}><b className="num">{have}</b></Ring>
        <div className="stack" style={{ gap: 6, flex: 1 }}>
          <b className="big">{t('ex.albumN', { a: have, b: total })}</b>
          <div className="ex-albumbar"><i style={{ width: `${(100 * have / Math.max(1, total)).toFixed(1)}%` }} /></div>
          <Hint text={t('ex.albumHint')} />
        </div>
      </section>
      <section className="panel">
        <div className="row" style={{ marginBottom: 10 }}>
          <input type="search" placeholder={t('ex.search')} value={q} onChange={e => { setQ(e.target.value); setLimit(PAGE) }} aria-label={t('ex.search')} />
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={owned} onChange={e => setOwned(e.target.checked)} /> {t('ex.onlyOwned')}</label>
        </div>
        <div className="ex-album">
          {groups.slice(0, limit).map(g => (
            <div key={g.name} className={'ex-legend' + (g.got ? ' has' : '')}>
              <div className="ex-legendhead">
                <b>{flag(g.cards[0].nation)} {g.name}</b>
                <PosTag p={g.cards[0].pos} />
                <span className="muted tiny num">{g.got}/{g.cards.length}</span>
              </div>
              <div className="ex-cards">
                {g.cards.map(c => (
                  <div key={c.version} className={'ex-card' + (c.owned ? ' owned' : '') + (c.version === 'Icon' ? ' icon' : '')}
                    data-tip={`${c.name} · ${c.version}\n${c.owned ? t('ex.ownedS', { n: c.owned }) : t('ex.notOwned')}`} tabIndex={0}>
                    <span className="ex-cardovr num">{c.owned ? Math.round(c.ovr) : '?'}</span>
                    <span className="ex-cardver">{c.version}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        {groups.length > limit && <button style={{ marginTop: 10 }} onClick={() => setLimit(l => l + PAGE)}>{t('ex.more')} ({groups.length - limit})</button>}
      </section>
    </>
  )
}
