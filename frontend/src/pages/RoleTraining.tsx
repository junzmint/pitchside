// Position training (backend role_training.go): a player learns a role that is not his own, e.g. a winger learning
// to play up front. Every day of training brings him closer, minutes played there more, a role in another line
// comes more slowly; once learned he plays it like his own (no rating lost there). Strings: strings_lock.ts (rt.*).
import { useState } from 'react'
import type { Ctx } from '../App'
import { api } from '../api'
import type { Player } from '../types'
import { ROLE_CAT, baseFit } from '../formations'
import { errText, useI18n } from '../i18n'
import { Bar, ConfirmButton, Hint, Icon } from '../ui'

const OUTFIELD = ['LB', 'CB', 'RB', 'DM', 'CM', 'AM', 'LM', 'RM', 'LW', 'ST', 'RW']
const LINE: Record<string, number> = { DF: 1, MF: 2, FW: 3 }
// mirrors backend LearnDaily, MaxKnown and learnSpeed
const LEARN_DAILY = 2.5
const MAX_KNOWN = 3
const speed = (p: Player, role: string) => { const d = Math.abs((LINE[ROLE_CAT[role]] ?? 0) - (LINE[p.position] ?? 0)); return d === 0 ? 1 : d === 1 ? 0.6 : 0.4 }

export function RoleTraining({ ctx, p }: { ctx: Ctx; p: Player }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const known = p.known ?? []
  // roles he does not already play as his own (his natural role and its neighbours), nor has learned
  // the nearest first: his own line, then the next one
  const options = OUTFIELD.filter(r => baseFit(p, r) < 1 && !known.includes(r)).sort((a, b) => speed(p, b) - speed(p, a))
  const [pick, setPick] = useState(options[0] ?? '')
  if (p.position === 'GK' || ctx.st.career.ended) return null
  async function send(body: { learn?: string; forget?: string }, ok: string) {
    setBusy(true)
    try {
      await api.setCare(ctx.id, p.id, body)
      await ctx.reload()
      ctx.toast(ok)
    } catch (e) { ctx.toast(errText(t, e), true) } finally { setBusy(false) }
  }
  const role = options.includes(pick) ? pick : options[0] ?? ''
  const days = role ? Math.ceil(100 / (LEARN_DAILY * speed(p, role))) : 0
  return (
    <div className="stack roletrain" style={{ gap: 6, marginTop: 6 }}>
      <span className="row" style={{ gap: 6 }}><b>{t('rt.title')}</b><Hint text={t('rt.help')} /></span>
      {known.length > 0 && (
        <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span className="muted" style={{ fontSize: 12 }}>{t('rt.known')}</span>
          {known.map(k => (
            <ConfirmButton key={k} className="small rt-known" label={<><Icon name="check" size={12} /> {k}</>} title={t('rt.forgetTip', { role: k })}
              confirm={t('rt.forget', { role: k })} onConfirm={() => send({ forget: k }, t('rt.forgot', { name: p.name, role: k }))} />
          ))}
        </span>
      )}
      {p.learning ? (
        <div className="stack" style={{ gap: 4 }}>
          <span className="row spread" style={{ fontSize: 13 }}><span>{t('rt.learning', { role: p.learning })}</span><b className="num">{Math.floor(p.learnPct ?? 0)}%</b></span>
          <Bar v={p.learnPct ?? 0} />
          <ConfirmButton className="small" label={t('rt.stop')} confirm={t('rt.stopConfirm')} onConfirm={() => send({ learn: '' }, t('rt.stopped', { name: p.name }))} />
        </div>
      ) : known.length >= MAX_KNOWN ? (
        <span className="muted" style={{ fontSize: 12 }}>{t('rt.max')}</span>
      ) : options.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
            <select value={role} onChange={e => setPick(e.target.value)} aria-label={t('rt.pick')} style={{ minWidth: 0 }}>
              {options.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <button className="small" disabled={busy || !role} onClick={() => send({ learn: role }, t('rt.started', { name: p.name, role }))}>
              <Icon name="training" size={13} /> {t('rt.start', { role })}
            </button>
          </span>
          <span className="muted" style={{ fontSize: 12 }}>{t('rt.eta', { d: days })}</span>
        </div>
      )}
    </div>
  )
}
