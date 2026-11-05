import { useEffect, useState } from 'react'
import type { Ctx } from '../../App'
import { openStage, STAGE_SEEN_EVENT, stageApi, type NewsItem } from '../../api_stage'
import { Icon } from '../../ui'
import { useI18n } from '../../i18n'
import { headline, NewsCrests, rich, whenText } from './common'

const ROTATE_MS = 8000

/**
 * Headlines on the hub: one calm rotating card (it pauses while the pointer or focus is on it) and,
 * on wide screens, the other latest storylines as a short list beside it.
 */
export function StageTicker({ ctx }: { ctx: Ctx }) {
  const { t, lang } = useI18n()
  const { day, season } = ctx.st.career
  const [items, setItems] = useState<NewsItem[] | null>(null)
  const [i, setI] = useState(0)
  const [hold, setHold] = useState(false)
  useEffect(() => {
    const load = () => stageApi.news(ctx.id, 6, ['story', 'award', 'intl']).then(x => { setItems(x); setI(0) }).catch(() => setItems(v => v ?? []))
    load()
    // an awards night or tournament pop-up just closed: its headlines are now in the feed
    window.addEventListener(STAGE_SEEN_EVENT, load)
    return () => window.removeEventListener(STAGE_SEEN_EVENT, load)
  }, [ctx.id, day, season])
  useEffect(() => {
    if (hold || !items || items.length < 2) return
    const id = window.setInterval(() => setI(v => (v + 1) % items.length), ROTATE_MS)
    return () => window.clearInterval(id)
  }, [hold, items])
  if (!items) return null
  const at = Math.min(i, Math.max(0, items.length - 1))
  const cur = items[at]
  const h = cur ? headline(t, lang, cur) : null
  // the next headlines in the rotation (wide screens)
  const queue = [1, 2, 3].map(k => (at + k) % items.length).filter((k, x, all) => k !== at && all.indexOf(k) === x)
  return (
    <section className="panel sg-ticker" aria-label={t('tk.head')} onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)}
      onFocus={() => setHold(true)} onBlur={() => setHold(false)}>
      <div className="sg-tkhead">
        <span className="sg-tklabel"><Icon name="broadcast" size={16} /> {t('tk.head')}</span>
        <button className="link" onClick={() => openStage(ctx.go, 'feed')}>{t('tk.all')} <Icon name="next" size={14} /></button>
      </div>
      {!cur || !h ? <p className="muted sg-tkempty">{t('tk.empty')}</p> : (
        <div className="sg-tkgrid">
          <article key={cur.id} className={'sg-tkitem tone-' + h.tone + (cur.mine ? ' mine' : '')} aria-live="polite">
            <span className="sg-tkicon"><Icon name={h.icon} size={22} /></span>
            <div className="sg-tktext">
              <p>{rich(t(h.key), h.params, h.bold)}</p>
              <small className="muted">{whenText(t, cur)}{cur.mine && <span className="chip mine">{t('nw.mine')}</span>}</small>
            </div>
            <span className="sg-tkcrests"><NewsCrests n={cur} size={34} /></span>
          </article>
          {items.length > 1 && (
            <ol className="sg-tklist" aria-label={t('tk.next')}>
              {queue.map(k => {
                const n = items[k]
                const hh = headline(t, lang, n)
                return (
                  <li key={n.id}>
                    <button onClick={() => setI(k)}>
                      <Icon name={hh.icon} size={14} /> <span>{rich(t(hh.key), hh.params, [])}</span>
                    </button>
                  </li>
                )
              })}
            </ol>
          )}
          {items.length > 1 && (
            <div className="sg-tkdots" role="group" aria-label={t('tk.head')}>
              {items.map((n, k) => <button key={n.id} aria-pressed={k === i} aria-label={t('tk.goTo', { n: k + 1 })} onClick={() => setI(k)} />)}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export default StageTicker
