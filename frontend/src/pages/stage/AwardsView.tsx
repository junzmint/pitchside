import { useEffect, useState } from 'react'
import type { Ctx } from '../../App'
import { stageApi, type AwardNight, type AwardPlayer, type AwardsView as View } from '../../api_stage'
import { Badge, Empty, Icon, Loading, PlayerCard } from '../../ui'
import { errText, useI18n } from '../../i18n'
import { AwardArt, gloveStat, ordinal, type AwardKey } from './common'
import { Ceremony } from './Ceremony'

/** Award history: every Golden Ball night of this career, newest first, with a replay of each ceremony. */
export default function AwardsView({ ctx }: { ctx: Ctx }) {
  const { t, lang } = useI18n()
  const [v, setV] = useState<View | null>(null)
  const [replay, setReplay] = useState<AwardNight | null>(null)
  useEffect(() => {
    stageApi.awards(ctx.id).then(setV).catch(e => ctx.toast(errText(t, e), true))
  }, [ctx.id, ctx.st.career.season, ctx.st.career.day])
  if (!v) return <Loading />
  const latest = v.nights[0]
  const mineCount = v.nights.reduce((n, x) => n + [x.ball[0], x.boy[0], x.glove[0], x.boot[0]].filter(e => e?.mine).length + (x.managers[0]?.mine ? 1 : 0), 0)
  const seasonOver = ctx.st.today?.comp === 'offseason'
  return (
    <div className="stack sg-awardsview">
      {!latest ? (
        <section className="panel">
          <Empty icon="legend">{t(seasonOver ? 'aw.emptySoon' : 'aw.empty', { n: ctx.st.career.season })}</Empty>
        </section>
      ) : (
        <section className="panel sg-awhero">
          <div className="sg-awherotext">
            <span className="eyebrow">{t('sg.ball')} · {t('seasonN', { n: latest.season })}</span>
            <h3 className="sg-awname">{latest.ball[0].player.name}</h3>
            <span className="muted">{latest.ball[0].club} · {t('sg.nGoals', { n: latest.ball[0].goals })} · {t('sg.stat.rating')} {latest.ball[0].rating.toFixed(2)}</span>
            {latest.ball[0].mine && <span className="chip special"><Icon name="star" size={13} /> {t('sg.yours')}</span>}
            <div className="row" style={{ gap: 8, marginTop: 6 }}>
              <button className="primary" onClick={() => setReplay(latest)}><Icon name="playNow" size={16} /> {t('sg.replay')}</button>
            </div>
            <span className="muted small">{t('aw.mineTotal', { n: mineCount })}</span>
          </div>
          <div className="sg-awherocard"><AwardArt kind="ball" size={96} /><Winner e={latest.ball[0]} /></div>
        </section>
      )}

      {v.nights.map(n => (
        <section key={n.season} className="panel sg-awseason">
          <div className="row spread">
            <h3>{t('seasonN', { n: n.season })}</h3>
            <button className="small" onClick={() => setReplay(n)}><Icon name="playNow" size={14} /> {t('sg.replay')}</button>
          </div>
          <div className="sg-awgrid">
            <Row kind="ball" e={n.ball[0]} sub={n.ball[0] ? `${n.ball[0].club} · ${t('sg.nGoals', { n: n.ball[0].goals })}` : ''} />
            <Row kind="boy" e={n.boy[0]} sub={n.boy[0] ? `${n.boy[0].club} · ${t('sg.boyAge', { n: n.boy[0].player.age })}` : ''} />
            <Row kind="glove" e={n.glove[0]} sub={n.glove[0] ? `${n.glove[0].club} · ${gloveStat(t, n.glove[0])}` : ''} />
            <Row kind="boot" e={n.boot[0]} sub={n.boot[0] ? `${n.boot[0].club} · ${t('sg.nGoals', { n: n.boot[0].goals })}` : ''} />
            {n.managers[0] && (
              <div className={'sg-awrow' + (n.managers[0].mine ? ' mine' : '')}>
                <AwardArt kind="manager" size={40} />
                <span className="stack" style={{ gap: 1, minWidth: 0 }}>
                  <small className="eyebrow">{t('sg.manager')}</small>
                  <b>{n.managers[0].mine ? t('sg.youAre', { name: n.managers[0].name }) : n.managers[0].name}</b>
                  <small className="muted">{n.managers[0].club} · {t('sg.mgrLine', { pos: ordinal(lang, n.managers[0].pos), exp: ordinal(lang, n.managers[0].expected), d: n.managers[0].division })}</small>
                </span>
                <Badge short={n.managers[0].short} color={n.managers[0].color} color2={n.managers[0].color2} size={30} />
              </div>
            )}
          </div>
          <details className="sg-awtop">
            <summary>{t('sg.topTen')}</summary>
            <ol>
              {n.ball.map(e => (
                <li key={e.rank} className={e.mine ? 'mine' : ''}>
                  <span className="sg-rk num">{e.rank}</span>
                  <Badge short={e.short} color={e.color} color2={e.color2} size={22} />
                  <b>{e.player.name}</b>
                  <small className="muted">{e.club} · {t('sg.nGoals', { n: e.goals })} · {e.rating.toFixed(2)}</small>
                </li>
              ))}
            </ol>
          </details>
        </section>
      ))}
      {replay && <Ceremony night={replay} replay onClose={() => setReplay(null)} />}
    </div>
  )
}

function Row({ kind, e, sub }: { kind: AwardKey; e?: AwardPlayer; sub: string }) {
  const { t } = useI18n()
  if (!e) return null
  return (
    <div className={'sg-awrow' + (e.mine ? ' mine' : '')}>
      <AwardArt kind={kind} size={40} />
      <span className="stack" style={{ gap: 1, minWidth: 0 }}>
        <small className="eyebrow">{t('sg.' + kind)}</small>
        <b>{e.player.name}</b>
        <small className="muted">{sub}</small>
      </span>
      <Badge short={e.short} color={e.color} color2={e.color2} size={30} />
    </div>
  )
}

function Winner({ e }: { e: AwardPlayer }) {
  return <div className="sg-awcard"><PlayerCard p={e.player} /></div>
}
