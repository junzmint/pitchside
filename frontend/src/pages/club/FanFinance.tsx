// Club life on the Finance page, next to the ticket price: the fans' mood, the crowd and what the
// ticket price does to both.
import type { Ctx } from '../../App'
import { useClubLife } from '../../api_club'
import { useI18n } from '../../i18n'
import { Bar, Title } from '../../ui'
import { FanEffects } from './ClubHub'
import { FanFace, MOOD_COLORS } from './FanBits'

export function FanFinance({ ctx }: { ctx: Ctx }) {
  const { t, lang } = useI18n()
  const v = useClubLife(ctx.st)
  if (!v) return null
  const f = v.fans
  const loc = lang === 'vi' ? 'vi-VN' : lang === 'ja' ? 'ja-JP' : 'en-GB'
  const tk = f.ticket || 'normal'
  const tone = f.ticketFans > 0 ? 'good' : f.ticketFans < 0 ? 'bad' : ''
  return (
    <section className="panel stack cl-finfans">
      <Title icon="users">{t('cl.fin.title')}</Title>
      <div className="row" style={{ gap: 12, flexWrap: 'nowrap' }}>
        <span data-tip={t('cl.fans.tip')}><FanFace mood={f.mood} size={48} /></span>
        <div className="stack" style={{ gap: 4, flex: 1, minWidth: 0 }}>
          <b>{t('cl.fans.mood')}: <span className="num" style={{ color: MOOD_COLORS[f.band] }}>{f.mood}</span> · {t('cl.band.' + f.band)}</b>
          <span className="muted num" style={{ fontSize: 13 }} data-tip={t('cl.fans.attTip')}>
            {t('cl.fans.attendance')}: {t('cl.fans.seats', { a: f.attendance.toLocaleString(loc), c: f.capacity.toLocaleString(loc) })}
          </span>
          <Bar v={f.fill * 100} color={MOOD_COLORS[f.band]} />
        </div>
      </div>
      <span className={'flag ' + tone} style={{ width: 'fit-content', whiteSpace: 'normal' }}>{t('cl.fin.ticket.' + tk, { v: Math.abs(f.ticketFans).toLocaleString(loc) })}</span>
      <FanEffects f={f} noCrowd />
      {f.lastGate > 0 && <span className="muted num" style={{ fontSize: 13 }}>{t('cl.fans.lastGate', { n: f.lastGate.toLocaleString(loc) })}</span>}
      <span className="muted" style={{ fontSize: 13 }}>{t('cl.fin.help')}</span>
    </section>
  )
}
