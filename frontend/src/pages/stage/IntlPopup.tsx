import { useEffect, useRef } from 'react'
import type { Tournament } from '../../api_stage'
import { Icon, Portal } from '../../ui'
import { useI18n } from '../../i18n'
import { Confetti, CupArt, Flag, nationColors, playFanfare, useStageKeys } from './common'

/** Who won the summer's tournament and how the user's players did (shown when the new season starts). */
export function IntlPopup({ tour, onClose, onOpen }: { tour: Tournament; onClose: () => void; onOpen: () => void }) {
  const { t } = useI18n()
  const btn = useRef<HTMLButtonElement>(null)
  useEffect(() => { btn.current?.focus({ preventScroll: true }); playFanfare() }, [])
  useStageKeys(onClose, onClose)
  const cup = t('in.' + tour.kind)
  const champ = t('nation.' + tour.champion)
  const [c1, c2] = nationColors(tour.champion)
  const f = tour.final
  const fin = f ? `${t('nation.' + f.home)} ${f.hg}-${f.ag} ${t('nation.' + f.away)}${f.ph != null && f.pa != null ? ` (${t('in.pens', { a: f.ph, b: f.pa })})` : f.et ? ` (${t('in.aet')})` : ''}` : ''
  const top = tour.scorers[0]
  const mineScorers = tour.mine.filter(p => p.goals > 0).slice(0, 3)
  const mineWon = tour.mine.filter(p => p.result === 'W')
  return (
    <Portal>
      <div className="modal sg-intlpop" role="dialog" aria-modal="true" aria-labelledby="ip-title" onClick={onClose}>
        <Confetti colors={[c1, c2, '#ffd23f', '#ffffff']} n={70} seed={tour.season} />
        <div className="card sg-ipcard" style={{ ['--n1' as string]: c1, ['--n2' as string]: c2 }} onClick={e => e.stopPropagation()}>
          <span className="eyebrow">{cup} · {t('in.edition', { n: tour.edition })} · {t('in.summer', { n: tour.season })}</span>
          <div className="sg-ipart"><CupArt kind={tour.kind} size={120} /><Flag code={tour.champion} size={44} /></div>
          <h2 id="ip-title" className="sg-iptitle">{t(tour.kind === 'euro' ? 'in.champEuro' : 'in.champWorld', { nation: champ })}</h2>
          {fin && <p className="sg-ipline">{t('in.final', { m: fin })}</p>}
          {top && <p className="sg-ipline"><Icon name="goal" size={15} /> {t('in.topScorer', { p: top.name, nation: t('nation.' + top.nation), n: top.goals })}</p>}
          {tour.best && <p className="sg-ipline"><Icon name="star" size={15} /> {t('in.best', { p: tour.best.name, nation: t('nation.' + tour.best.nation) })}</p>}
          <div className="sg-ipmine">
            <b className="eyebrow">{t('in.t.mine')}</b>
            {tour.mine.length === 0 ? <span className="muted">{t('in.mineNone')}</span> : (
              <>
                {mineWon.length > 0 && <span className="good"><Icon name="cup" size={15} /> {t('in.mineWon', { list: mineWon.map(p => p.name).join(', '), nation: t('nation.' + mineWon[0].nation) })}</span>}
                {mineScorers.map(p => <span key={p.id}><Flag code={p.nation} size={12} /> {t(p.goals === 1 ? 'in.mineGoal1' : 'in.mineGoals', { p: p.name, n: p.goals })}</span>)}
                <span className="muted">{t('in.mineCount', { n: tour.mine.length })} · {t('in.tired', { a: tour.effects.fitMin, b: tour.effects.fitMax })}</span>
              </>
            )}
          </div>
          <div className="row sg-ipbtns">
            <button onClick={onOpen}><Icon name="competitions" size={16} /> {t('in.open')}</button>
            <button ref={btn} className="primary" onClick={onClose}>{t('dr.continue')}</button>
          </div>
        </div>
      </div>
    </Portal>
  )
}

export default IntlPopup
