import type { MatchRec, TrophyItem } from '../../api_explore'
import { PosTag, TagChip } from '../../ui'
import { useI18n } from '../../i18n'
import type { XCtx } from '../Explore'
import { TrophyIcon, flag } from './common'

function trophyName(t: (k: string, p?: Record<string, string | number>) => string, tr: TrophyItem) {
  switch (tr.kind) {
    case 'league': return t('ex.tr.league', { d: t('divN', { n: tr.division }) })
    case 'cup': return t('ex.tr.cup')
    case 'cl': return t('ex.tr.cl')
    default: return t('ex.tr.promotion')
  }
}

export default function Museum({ x }: XCtx) {
  const { t } = useI18n()
  const r = x.records
  const match = (m: MatchRec | null) => m
    ? <><b className="num">{m.gf}-{m.ga}</b> <span>{t('ex.vs', { o: m.opp })}</span><span className="muted tiny">{m.club} · {t('ex.inS', { n: m.season })} · {t('comp.' + m.comp)}</span></>
    : <span className="muted">{t('ex.none')}</span>
  const counts = (['cl', 'league', 'cup', 'promotion'] as const).map(k => [k, x.trophies.filter(tr => tr.kind === k).length] as const)

  return (
    <>
      <section className="panel ex-cabinet">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>🏆 {t('ex.cabinet')}</h3>
          <div className="row" style={{ gap: 6 }}>
            {counts.filter(([, n]) => n > 0).map(([k, n]) => <span key={k} className="chip">{t('ex.tr.' + k, { d: '' }).trim()} ×{n}</span>)}
          </div>
        </div>
        {x.trophies.length === 0 ? (
          <div className="ex-shelf empty">
            <div className="ex-ghost"><TrophyIcon kind="league" size={90} uid="ghost" /></div>
            <p className="muted">{t('ex.noTrophies')}</p>
          </div>
        ) : (
          <div className="ex-shelf">
            {x.trophies.map((tr, i) => (
              <div key={i} className={'ex-plinth k-' + tr.kind} tabIndex={0}
                data-tip={[trophyName(t, tr), tr.club, tr.opp ? t('ex.cel.final', { opp: tr.opp, score: tr.score ?? '' }) + (tr.pens ? ' ' + t('ex.cel.pens') : '') : '', tr.scorers?.length ? t('ex.cel.scorers', { list: tr.scorers.join(', ') }) : '', tr.points ? t('ex.cel.points', { n: tr.points }) : ''].filter(Boolean).join('\n')}>
                <TrophyIcon kind={tr.kind} size={78} uid={'m' + i} />
                <b>{trophyName(t, tr)}</b>
                <span className="small">{flag(tr.league)} {tr.club}</span>
                <span className="muted tiny">{t('seasonN', { n: tr.season })}{tr.score ? ` · ${tr.score}${tr.pens ? ' (p)' : ''}` : ''}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <h3>{t('ex.records')}</h3>
        <div className="ex-records">
          <div className="ex-rec"><span className="eyebrow">{t('ex.rec.bigWin')}</span>{match(r.bigWin)}</div>
          <div className="ex-rec"><span className="eyebrow">{t('ex.rec.bigLoss')}</span>{match(r.bigLoss)}</div>
          <div className="ex-rec"><span className="eyebrow">{t('ex.rec.mostGoals')}</span>{match(r.mostGoals)}</div>
          <div className="ex-rec"><span className="eyebrow">{t('ex.rec.haul')}</span>{r.haul ? <><b>{r.haul.name}</b><span>{t('ex.goalsN', { n: r.haul.n })}</span><span className="muted tiny">{t('ex.inS', { n: r.haul.season })}</span></> : <span className="muted">{t('ex.none')}</span>}</div>
          <div className="ex-rec"><span className="eyebrow">{t('ex.rec.bestOvr')}</span>{r.bestOvr ? <><b>{r.bestOvr.name}</b><span className="num">{r.bestOvr.n}</span><span className="muted tiny">{t('ex.inS', { n: r.bestOvr.season })}</span></> : <span className="muted">{t('ex.none')}</span>}</div>
          <div className="ex-rec"><span className="eyebrow">{t('ex.rec.streak')}</span><b className="num">{x.stats.streak ?? 0}</b><span className="muted tiny">{t('ex.gamesN', { n: x.stats.streak ?? 0 })}</span></div>
          <div className="ex-rec"><span className="eyebrow">{t('ex.rec.unbeaten')}</span><b className="num">{x.stats.unbeaten ?? 0}</b><span className="muted tiny">{t('ex.gamesN', { n: x.stats.unbeaten ?? 0 })}</span></div>
          <div className="ex-rec"><span className="eyebrow">{t('ex.rec.seasonGoals')}</span><b className="num">{x.stats.season_goals ?? 0}</b><span className="muted tiny">{t('ex.goalsN', { n: x.stats.season_goals ?? 0 })}</span></div>
          <div className="ex-rec"><span className="eyebrow">{t('ex.rec.clean')}</span><b className="num">{x.stats.clean_season ?? 0}</b></div>
        </div>
      </section>

      <div className="grid g2" style={{ alignItems: 'start' }}>
        <section className="panel">
          <h3>{t('ex.topScorers')}</h3>
          <ol className="ex-podium">
            {x.scorers.map((l, i) => <li key={l.playerId} className={'p' + (i + 1)}><span className="ex-medal">{i + 1}</span><span className="grow">{l.name}{l.retired && <span className="muted"> · {t('retired')}</span>}</span><PosTag p={l.position} /><b className="num">{l.goals}</b></li>)}
            {x.scorers.length === 0 && <li className="muted">{t('noGamesYet')}</li>}
          </ol>
        </section>
        <section className="panel">
          <h3>{t('ex.mostApps')}</h3>
          <ol className="ex-podium">
            {x.apps.map((l, i) => <li key={l.playerId} className={'p' + (i + 1)}><span className="ex-medal">{i + 1}</span><span className="grow">{l.name}{l.retired && <span className="muted"> · {t('retired')}</span>}</span><PosTag p={l.position} /><b className="num">{l.apps}</b></li>)}
            {x.apps.length === 0 && <li className="muted">{t('noGamesYet')}</li>}
          </ol>
        </section>
      </div>

      <section className="panel">
        <h3>🏛 {t('ex.hall')}</h3>
        {x.hall.length === 0 && <p className="muted" style={{ margin: 0 }}>{t('ex.hallEmpty')}</p>}
        <div className="ex-hall">
          {x.hall.map(h => (
            <div key={h.playerId} className="ex-frame">
              <TagChip p={{ tag: h.tag, version: h.version }} />
              <b>{h.name}</b>
              <PosTag p={h.position} />
              <span className="small num">{t('ex.hallLine', { a: h.apps, g: h.goals })} · {h.rating.toFixed(2)}</span>
            </div>
          ))}
        </div>
      </section>

      {x.seasons.length > 0 && (
        <section className="panel">
          <h3>{t('ex.journey')}</h3>
          <div className="ex-journey">
            {x.seasons.map(s => (
              <div key={s.season} className={'ex-step' + (s.pos === 1 ? ' champ' : '') + (s.move === 'up' ? ' up' : s.move === 'down' ? ' down' : '')}>
                <span className="muted tiny">{t('seasonN', { n: s.season })}</span>
                <b className="num">{s.pos === 1 ? '🏆' : '#' + s.pos}</b>
                <span className="tiny">{flag(s.league)} {t('divN', { n: s.division })}{s.move === 'up' ? ' ↑' : s.move === 'down' ? ' ↓' : ''}</span>
                <span className="tiny muted">{s.club}</span>
                <span className="tiny">{s.cup === 'W' ? '🏆 ' : ''}{t('ko.' + (s.cup || 'none'))}{s.cl ? ` · ${s.cl === 'W' ? '🏆 ' : ''}${t('ko.' + s.cl)}` : ''}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  )
}
