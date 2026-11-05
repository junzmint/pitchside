import { ClipboardList, Newspaper } from 'lucide-react'
import { money } from '../../api'
import type { MedCase, MedicalView } from '../../api_medical'
import { useI18n } from '../../i18n'
import { Empty, Icon, Kpi } from '../../ui'
import { Body } from './Body'
import { injKey, partOfKind, tierOfKind } from './kinds'
import { dec, lineText, lineTone, lossText, TierChip, tn } from './parts'

/** The season in numbers, the weekly reports, the case files and serious injuries elsewhere. */
export function FilesPanel({ v }: { v: MedicalView }) {
  const { t, lang } = useI18n()
  const s = v.stats
  const avg = s.divClubs > 0 ? s.divInj / s.divClubs : 0
  const inSquad = new Set([...v.squad.map(x => x.playerId), ...v.injured.map(x => x.playerId)])
  const byPlayer = new Map<number, MedCase[]>()
  for (const c of v.cases) {
    const l = byPlayer.get(c.playerId) ?? []
    l.push(c)
    byPlayer.set(c.playerId, l)
  }
  return (
    <div className="stack">
      <section className="panel stack">
        <h3 className="ttl"><Icon name="stats" size={16} />{t('med.season', { n: s.season || v.season })}</h3>
        <div className="md-kpis">
          <Kpi icon="injury" label={t('med.k.injuries')} tone={s.injuries > avg * 1.3 ? 'bad' : 'good'}
            tip={[t('med.k.avg', { v: dec(lang, avg) }), v.prev ? t('med.k.prev', { v: v.prev.injuries }) : ''].filter(Boolean).join('\n')}>
            <span className="num">{s.injuries}</span><small className="md-kpi-sub">{t('med.k.avg', { v: dec(lang, avg) })}</small>
          </Kpi>
          <Kpi icon="calendar" label={t('med.k.weeks')} tip={t('med.k.weeks.tip')}><span className="num">{s.weeks}</span></Kpi>
          <Kpi icon="warn" label={t('med.k.serious')} tone={s.serious > 0 ? 'bad' : undefined}><span className="num">{s.serious}</span></Kpi>
          <Kpi icon="down" label={t('med.k.lasting')} tone={s.lasting > 0 ? 'bad' : undefined}><span className="num">{s.lasting}</span></Kpi>
          <Kpi icon="coins" label={t('med.k.spent')} tone="gold"><span className="num">{money(s.spent)}</span></Kpi>
          <Kpi icon="check" label={t('med.k.saved')} tone="cyan"><span className="num">{s.saved}</span></Kpi>
        </div>
      </section>

      <section className="panel stack">
        <h3 className="ttl"><ClipboardList size={16} />{t('med.report')}</h3>
        {v.reports.length === 0 ? <Empty icon="info">{t('med.report.quiet')}</Empty> : (
          <ol className="md-reports">
            {v.reports.map(r => (
              <li key={r.tick}>
                <span className="md-rep-day num">{t('med.report.day', { d: Math.min(r.day, 54) })}</span>
                <span className="md-rep-out">{t('med.report.out', { n: r.out })}</span>
                {(r.lines ?? []).length === 0 ? <span className="muted">{t('med.report.quiet')}</span> : (
                  <ul>{(r.lines ?? []).map((l, i) => <li key={i} className={lineTone(l.key)}>{lineText(t, lang, l)}</li>)}</ul>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="panel stack">
        <h3 className="ttl"><Icon name="history2" size={16} />{t('med.history')}</h3>
        {byPlayer.size === 0 ? <Empty icon="info">{t('med.cases.empty')}</Empty> : (
          <div className="md-files">
            {[...byPlayer.entries()].map(([pid, cs]) => (
              <div key={pid} className={'md-file' + (inSquad.has(pid) ? '' : ' former')}>
                <div className="md-file-head">
                  <Body part={partOfKind(cs[0].kind)} tier={tierOfKind(cs[0].kind)} seed={pid} size={44} />
                  <b>{cs[0].name}</b>
                  {!inSquad.has(pid) && <span className="flag">{t('med.former')}</span>}
                  <span className="muted num">×{cs.length}</span>
                </div>
                <ul>
                  {cs.map(c => (
                    <li key={c.id}>
                      <span className="md-case-kind"><b>{t(injKey(c.kind))}</b> <TierChip t={t} tier={tierOfKind(c.kind)} /></span>
                      <span className="muted">{t('med.case.when', { s: c.season, d: Math.min(c.day, 54) })} · {t('med.src.' + c.source)} · {tn(t, lang, 'med.o.weeks', c.weeks)}</span>
                      <span className="md-case-tags">
                        <span className={'flag' + (c.done ? ' good' : ' warn')}>{c.done ? t('med.case.done') : t('med.case.open')}</span>
                        {c.treat && <span className="flag">{t('med.opt.' + c.treat)}</span>}
                        {(c.notes ?? []).map(n => <span key={n} className={'flag' + (n === 'complication' || n === 'misdiag' || n === 'aggravated' ? ' bad' : '')}>{t('med.note.' + n)}</span>)}
                        {(c.setbacks ?? 0) > 0 && <span className="flag bad">{tn(t, lang, 'med.case.setbacks', c.setbacks ?? 0)}</span>}
                        {(c.loss?.length ?? 0) > 0 && <span className="flag bad"><Icon name="down" size={11} /> {lossText(t, c.loss)}</span>}
                        {(c.cost ?? 0) > 0 && <span className="flag gold">{t('med.case.cost', { v: money(c.cost!) })}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel stack">
        <h3 className="ttl"><Newspaper size={16} />{t('med.league')}</h3>
        {v.news.length === 0 ? <Empty icon="info">{t('med.league.empty')}</Empty> : (
          <ul className="md-news">
            {v.news.map(n => (
              <li key={n.playerId + ':' + n.day} className={n.mine ? 'mine' : ''}>
                <Body part={partOfKind(n.kind)} tier={tierOfKind(n.kind)} seed={n.playerId} size={36} />
                <span><b>{n.name}</b> <span className="muted">· {n.club} · {n.overall}</span></span>
                <span><b className={'md-t' + tierOfKind(n.kind)}>{t(injKey(n.kind))}</b> · {tn(t, lang, 'med.o.weeks', n.weeks)}</span>
                {n.mine && <span className="flag club">{t('med.league.mine')}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
