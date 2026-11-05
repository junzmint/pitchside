// Club life on the home hub: the Deadline Day banner (top) and the fans and legends tiles.
import type { Ctx } from '../../App'
import { useClubLife, type ClubLifeView, type FanView } from '../../api_club'
import { useI18n } from '../../i18n'
import { CountUp, Icon, Title } from '../../ui'
import { DeadlineBanner } from './Deadline'
import { FanFace, FanVoiceView, MoodMeter, MoodTrend, NoteChip } from './FanBits'
import { HonourPrompt, LegendsTile } from './Legends'
import { tourName } from './Tour'

/** Top of the hub: Deadline Day (when it is today) and the honour popup for a new legend. */
export function ClubHubTop({ ctx }: { ctx: Ctx }) {
  const v = useClubLife(ctx.st)
  if (!v) return null
  return (
    <>
      <DeadlineBanner ctx={ctx} v={v} />
      <HonourPrompt ctx={ctx} v={v} />
    </>
  )
}

/** Hub tiles: the fans (mood, voice, attendance, favourite) and the Legends wall. */
export function ClubHubTiles({ ctx }: { ctx: Ctx }) {
  const v = useClubLife(ctx.st)
  if (!v) return null
  return (
    <>
      <FansTile ctx={ctx} v={v} />
      <LegendsTile ctx={ctx} v={v} />
    </>
  )
}

/** The three ways the mood pays back, as chips with a one-line tooltip each. */
export function FanEffects({ f, noCrowd }: { f: FanView; noCrowd?: boolean }) {
  const { t, lang } = useI18n()
  const loc = lang === 'vi' ? 'vi-VN' : lang === 'ja' ? 'ja-JP' : 'en-GB'
  const x = (n: number, d = 2) => n.toLocaleString(loc, { minimumFractionDigits: d, maximumFractionDigits: d })
  return (
    <div className="cl-effects">
      {!noCrowd && (
        <span className="cl-eff" data-tip={t('cl.fans.attTip')}>
          <Icon name="stadium" size={16} /> <b className="num">{f.attendance.toLocaleString(loc)}</b> <small className="muted num">/ {f.capacity.toLocaleString(loc)}</small>
        </span>
      )}
      <span className={'cl-eff ' + (f.gate > 1.005 ? 'good' : f.gate < 0.995 ? 'bad' : '')} data-tip={t('cl.eff.gateTip')}><Icon name="tickets" size={16} /> {t('cl.eff.gate', { v: x(f.gate) })}</span>
      <span className={'cl-eff ' + (f.merch > 1.005 ? 'good' : f.merch < 0.995 ? 'bad' : '')} data-tip={t('cl.eff.merchTip')}><Icon name="merch" size={16} /> {t('cl.eff.merch', { v: x(f.merch) })}</span>
      <span className={'cl-eff ' + (f.boost > 0 ? 'good' : f.boost < 0 ? 'bad' : 'off')} data-tip={t('cl.eff.boostTip')}>
        <Icon name="home" size={16} /> {f.boost > 0 ? t('cl.eff.boost', { v: x(f.boost, 1) }) : f.boost < 0 ? t('cl.eff.boostNeg', { v: x(Math.abs(f.boost), 1) }) : t('cl.eff.boostNone')}
      </span>
    </div>
  )
}

function FansTile({ ctx, v }: { ctx: Ctx; v: ClubLifeView }) {
  const { t } = useI18n()
  const f = v.fans
  const club = ctx.st.club
  const tour = v.tour
  const chosen = tour?.offers.find(o => o.key === tour.chosen)
  return (
    <section className="panel tile t-match cl-fans">
      <div className="row spread">
        <Title icon="users">{t('cl.fans.title')}</Title>
        {f.delta !== 0 && <span className={'cl-delta num ' + (f.delta > 0 ? 'up' : 'down')}>{f.delta > 0 ? '+' : '−'}{Math.abs(f.delta)}</span>}
      </div>
      <div className="cl-fans-head">
        <span className="cl-face-wrap" data-tip={t('cl.fans.tip')}><FanFace mood={f.mood} size={86} /></span>
        <div className="cl-fans-num">
          <div className="row" style={{ gap: 10, alignItems: 'baseline' }}>
            <b className={'cl-mood num b' + f.band} data-tip={t('cl.fans.tip')}><CountUp v={f.mood} /></b>
            <span className={'cl-band b' + f.band}>{t('cl.band.' + f.band)}</span>
          </div>
          <MoodMeter mood={f.mood} />
        </div>
      </div>
      <FanVoiceView v={f.voice} club={club.name} short={v.short || club.short} color={club.color} color2={club.color2} />
      <FanEffects f={f} />
      <div className="cl-fans-foot">
        {f.fav && (
          <div className="cl-fav" data-tip={t('cl.fans.favTip')}>
            <span className="cl-shirtno num">{f.fav.shirt || '–'}</span>
            <div style={{ minWidth: 0 }}>
              <small className="muted">{t('cl.fans.fav')}</small>
              <b className="cl-wrap">{f.fav.name}</b>
              <small className="muted num">{t('cl.fans.favLine', { apps: f.fav.apps, goals: f.fav.goals, assists: f.fav.assists })}</small>
            </div>
          </div>
        )}
        <MoodTrend trend={f.trend} />
      </div>
      {f.notes.length > 0 && (
        <div className="cl-notes" aria-label={t('cl.fans.why')}>
          {f.notes.slice(0, 6).map((n, i) => <NoteChip key={i} n={n} />)}
        </div>
      )}
      {tour?.open && !tour.chosen && !ctx.st.career.ended && (
        <div className="cl-nudge">
          <Icon name="flag" size={18} />
          <span>{t('cl.tour.nudge')}</span>
          <button className="primary small" onClick={() => ctx.go('match')}>{t('cl.tour.nudgeBtn')}</button>
        </div>
      )}
      {tour?.open && chosen && <span className="chip special" style={{ width: 'fit-content' }}><Icon name="check" size={12} /> {t('cl.tour.picked', { name: tourName(t, chosen) })}</span>}
      {tour?.active && chosen && (
        <span className="chip" style={{ width: 'fit-content', whiteSpace: 'normal' }}>
          <Icon name="hourglass" size={12} /> {t('cl.tour.active', { name: tourName(t, chosen), d: tour.until })}{tour.saved > 0 ? ` · ${t('cl.tour.saved', { n: tour.saved })}` : ''}
        </span>
      )}
    </section>
  )
}
