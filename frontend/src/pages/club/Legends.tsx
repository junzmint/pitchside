// Club life: the Legends wall, its portrait cards and the "retire his number?" moment.
import { useState } from 'react'
import { Crown } from 'lucide-react'
import type { Ctx } from '../../App'
import { clubApi, refreshClubLife, useClubLife, type ClubLifeView, type LegendEntry } from '../../api_club'
import { errText, useI18n } from '../../i18n'
import { sfx } from '../../sfx'
import { Empty, Icon, Modal, PosTag, Title } from '../../ui'

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()

/** A legend's portrait card: shirt number, face, years and his numbers for the club. */
export function LegendCard({ le, onHonour, compact }: { le: LegendEntry; onHonour?: (le: LegendEntry) => void; compact?: boolean }) {
  const { t } = useI18n()
  const retired = le.honour === 'retired'
  const years = le.from === le.to ? t('cl.lg.year', { a: le.from }) : t('cl.lg.years', { a: le.from, b: le.to })
  return (
    <article className={'cl-legend' + (retired ? ' gold' : '') + (compact ? ' compact' : '')}>
      {le.shirt > 0 && <span className="cl-legend-no num" aria-hidden="true">{le.shirt}</span>}
      <div className="cl-legend-top">
        <span className={'cl-portrait pos-' + le.position} aria-hidden="true">
          <span>{initials(le.name)}</span>
          {retired && <Crown size={16} className="cl-crown" />}
        </span>
        <div className="cl-legend-id">
          <b className="cl-legend-name">{le.name}</b>
          <span className="row" style={{ gap: 6 }}><PosTag p={le.position} role={le.role} /><span className="muted">{t('nation.' + le.nation)}</span></span>
          <span className="cl-years">{years}</span>
        </div>
      </div>
      <dl className="cl-legend-stats num">
        <div><dt>{t('cl.lg.apps')}</dt><dd>{le.apps}</dd></div>
        <div><dt>{t('cl.lg.goals')}</dt><dd>{le.goals}</dd></div>
        <div><dt>{t('cl.lg.assists')}</dt><dd>{le.assists}</dd></div>
        <div><dt>{t('cl.lg.trophies')}</dt><dd>{le.trophies}</dd></div>
      </dl>
      <div className="row cl-legend-foot">
        <span className={'chip' + (le.reason === 'active' ? ' cl-active' : '')}>{t('cl.lg.reason.' + le.reason)}</span>
        {retired && <span className="chip special"><Icon name="crown" size={12} /> {t('cl.lg.retiredNo', { n: le.shirt })}</span>}
        {le.honour === '' && le.shirt > 0 && onHonour && <button className="small primary" onClick={() => onHonour(le)}>{t('cl.lg.decide')}</button>}
        {(le.reason === 'sold' || le.reason === 'left') && le.honour !== 'retired' && le.shirt > 0 && <span className="muted cl-nohonour">{t('cl.lg.noHonour')}</span>}
      </div>
    </article>
  )
}

const SEEN = 'pitchside.honourSeen.'
function seen(id: number, pid: number) { try { return sessionStorage.getItem(SEEN + id) === String(pid) } catch { return false } }
function markSeen(id: number, pid: number) { try { sessionStorage.setItem(SEEN + id, String(pid)) } catch { /* storage unavailable */ } }

/** The emotional moment: a long-serving player joins the wall; retire his number or keep it. */
export function HonourModal({ ctx, le, onClose }: { ctx: Ctx; le: LegendEntry; onClose: () => void }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  async function answer(choice: 'retire' | 'keep') {
    setBusy(true)
    try {
      await clubApi.act(ctx.id, { action: 'honour', playerId: le.playerId, choice })
      sfx(choice === 'retire' ? 'trophy' : 'confirm')
      ctx.toast(t(choice === 'retire' ? 'cl.lg.retiredToast' : 'cl.lg.keptToast', { n: le.shirt, name: le.name }))
      refreshClubLife()
      await ctx.reload()
      onClose()
    } catch (e) { ctx.toast(errText(t, e), true) } finally { setBusy(false) }
  }
  return (
    <Modal onClose={onClose} className="cl-honour" label={t('cl.lg.honourTitle')}>
      <span className="eyebrow"><Icon name="legend" size={13} /> {t('cl.lg.title')}</span>
      <h3 className="cl-bigtitle">{t('cl.lg.honourTitle')}</h3>
      <LegendCard le={le} />
      <p style={{ margin: 0 }}>{t(le.reason === 'active' ? 'cl.lg.honourBodyActive' : 'cl.lg.honourBody', { name: le.name, apps: le.apps, n: le.shirt })}</p>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button onClick={onClose} disabled={busy}>{t('cl.lg.later')}</button>
        <button onClick={() => answer('keep')} disabled={busy}>{t('cl.lg.keep')}</button>
        <button className="primary" onClick={() => answer('retire')} disabled={busy}><Icon name="crown" size={15} /> {t('cl.lg.retire', { n: le.shirt })}</button>
      </div>
    </Modal>
  )
}

/** Shows the honour popup once per session for a new legend whose number is still undecided. */
export function HonourPrompt({ ctx, v }: { ctx: Ctx; v: ClubLifeView }) {
  const [closed, setClosed] = useState(0)
  const le = v.honour
  if (!le || le.shirt <= 0 || ctx.st.career.ended || seen(ctx.id, le.playerId) || closed === le.playerId) return null
  return <HonourModal ctx={ctx} le={le} onClose={() => { markSeen(ctx.id, le.playerId); setClosed(le.playerId) }} />
}

/** The whole wall. */
export function LegendsWall({ ctx, v, onClose }: { ctx: Ctx; v: ClubLifeView; onClose: () => void }) {
  const { t } = useI18n()
  const [honour, setHonour] = useState<LegendEntry | null>(null)
  return (
    <Modal onClose={onClose} className="cl-wall" label={t('cl.lg.title')}>
      <div className="row spread">
        <div>
          <span className="eyebrow">{ctx.st.club.name}</span>
          <h3 className="cl-bigtitle">{t('cl.lg.title')}</h3>
        </div>
        <button onClick={onClose} aria-label={t('close')}><Icon name="close" size={16} /></button>
      </div>
      <WallBody ctx={ctx} v={v} onHonour={setHonour} />
      {honour && <HonourModal ctx={ctx} le={honour} onClose={() => setHonour(null)} />}
    </Modal>
  )
}

/** Retired numbers, every legend's card and the rule. */
function WallBody({ v, onHonour }: { ctx: Ctx; v: ClubLifeView; onHonour: (le: LegendEntry) => void }) {
  const { t } = useI18n()
  return (
    <>
      <div className="row" style={{ gap: 6 }}>
        <span className="muted">{t('cl.lg.retiredList')}:</span>
        {v.retired.length ? v.retired.map(n => <span key={n} className="cl-shirtno num" data-tip={t('cl.lg.retiredNo', { n })}>{n}</span>) : <span className="muted">{t('cl.lg.noRetired')}</span>}
      </div>
      {v.legends.length === 0 ? <Empty icon="legend">{t('cl.lg.empty')}</Empty> : (
        <div className="cl-wallgrid">
          {v.legends.map(le => <LegendCard key={le.playerId} le={le} onHonour={onHonour} />)}
        </div>
      )}
      {/* the empty wall already explains the rule */}
      {v.legends.length > 0 && <p className="hint"><Icon name="info" size={14} className="i" /><span>{t('cl.lg.rule')}</span></p>}
    </>
  )
}

/** The Legends wall as a page section (for History → Legends: one line, `<LegendsPanel ctx={ctx} />`). */
export function LegendsPanel({ ctx }: { ctx: Ctx }) {
  const { t } = useI18n()
  const v = useClubLife(ctx.st)
  const [honour, setHonour] = useState<LegendEntry | null>(null)
  if (!v) return null
  return (
    <section className="panel stack cl-wallpanel">
      <Title icon="legend">{t('cl.lg.title')}</Title>
      <WallBody ctx={ctx} v={v} onHonour={setHonour} />
      {honour && <HonourModal ctx={ctx} le={honour} onClose={() => setHonour(null)} />}
    </section>
  )
}

/** Hub tile: the newest legend and the retired numbers. */
export function LegendsTile({ ctx, v }: { ctx: Ctx; v: ClubLifeView }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const newest = v.legends[0]
  return (
    <section className="panel tile t-side cl-legtile">
      <div className="row spread">
        <Title icon="legend">{t('cl.lg.title')}</Title>
        {v.legends.length > 0 && <span className="chip num">{t('cl.lg.count', { n: v.legends.length })}</span>}
      </div>
      {newest ? <LegendCard le={newest} compact /> : <Empty icon="legend">{t('cl.lg.empty')}</Empty>}
      {v.retired.length > 0 && (
        <div className="row" style={{ gap: 6 }}>
          <span className="muted" style={{ fontSize: 13 }}>{t('cl.lg.retiredList')}:</span>
          {v.retired.map(n => <span key={n} className="cl-shirtno num" data-tip={t('cl.lg.retiredNo', { n })}>{n}</span>)}
        </div>
      )}
      <button onClick={() => setOpen(true)}><Icon name="legend" size={16} /> {t('cl.lg.open')}</button>
      {open && <LegendsWall ctx={ctx} v={v} onClose={() => setOpen(false)} />}
    </section>
  )
}
