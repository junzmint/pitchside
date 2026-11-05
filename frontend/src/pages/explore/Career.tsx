import { exploreApi } from '../../api_explore'
import { Badge, Hint } from '../../ui'
import { errText, useI18n } from '../../i18n'
import type { XCtx } from '../Explore'
import { Ring, flag } from './common'

export default function Career({ ctx, x, refresh }: XCtx) {
  const { t } = useI18n()
  const rep = x.manager.rep
  const stints = x.manager.stints ?? []
  const titleKeys = x.achievements.filter(a => a.title)

  async function wear(key: string) {
    try { await exploreApi.title(ctx.id, key); await refresh() } catch (e) { ctx.toast(errText(t, e), true) }
  }

  return (
    <>
      <section className="panel ex-ladderpanel">
        <h3>{t('ex.ladder')}</h3>
        <div className="ex-ladderrow">
          <Ring value={rep} max={100} size={120} stroke={10}>
            <b className="num" style={{ fontSize: 30 }}>{Math.round(rep)}</b>
            <span className="tiny muted">/100</span>
          </Ring>
          <ol className="ex-ladder">
            {x.tiers.slice().reverse().map(tr => (
              <li key={tr.key} className={(rep >= tr.min ? 'reached' : '') + (x.badge.tier === tr.key ? ' current' : '')}>
                <span className="num">{tr.min}</span><b>{t('ex.tier.' + tr.key)}</b>
              </li>
            ))}
          </ol>
        </div>
        <p style={{ margin: '8px 0 0' }}>{t('ex.reach', { n: x.reach, c: x.clubRep })}</p>
        <Hint text={t('ex.repHint')} />
      </section>


      <section className="panel">
        <h3>{t('ex.stints')}</h3>
        <div className="ex-stints">
          {stints.slice().reverse().map((s, i) => (
            <div key={i} className={'ex-stint' + (!s.closed ? ' now' : '')}>
              <Badge short={s.short} color={s.color} color2={s.color2} size={40} />
              <div className="stack" style={{ gap: 1 }}>
                <b>{s.club}</b>
                <span className="muted small">{flag(s.league)} {t('ex.stint', { a: s.from, b: s.closed ? s.to : t('ex.now') })} · {t('ex.trophiesN', { n: s.trophies })}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <h3>🎖 {t('ex.titles')}</h3>
        <Hint text={t('ex.titlesHint')} />
        <div className="ex-titles">
          {titleKeys.map(a => {
            const owned = x.titles.includes(a.key)
            const on = x.badge.title === a.key
            return (
              <div key={a.key} className={'ex-title' + (owned ? ' owned' : '') + (on ? ' on' : '')}>
                <b>{t('ex.title.' + a.key)}</b>
                <span className="muted tiny">{t('ex.a.' + a.key)}</span>
                {owned && (on
                  ? <button className="small" onClick={() => wear('')}>{t('ex.unequip')}</button>
                  : <button className="small primary" onClick={() => wear(a.key)}>{t('ex.equip')}</button>)}
                {on && <span className="chip good">{t('ex.equipped')}</span>}
              </div>
            )
          })}
        </div>
      </section>
    </>
  )
}
