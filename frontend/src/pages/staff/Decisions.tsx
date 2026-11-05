// Decision cards: what the staff bring to you, each choice with its consequences, a countdown and the
// default that applies if you do not answer. Shown on the Staff page and in the Inbox.
import { useState } from 'react'
import type { Ctx } from '../../App'
import { api, money } from '../../api'
import { coachRaises, staffOf, type StaffDecision } from '../../api_staff'
import { errText, useI18n } from '../../i18n'
import type { Demand } from '../../types'
import { Badge, ConfirmButton, Icon, Title } from '../../ui'
import { refusalText } from '../Demands'
import { FxChips, KIND_ICON, Portrait, choiceLabel, decBody, decTitle, roleName, tn, useStaffAct } from './parts'

// choices that cost money or cannot be undone ask once more
const CONFIRM = new Set(['release', 'letgo', 'hire', 'persuade', 'book'])

export function DecisionCard({ d, ctx, after }: { d: StaffDecision; ctx: Ctx; after?: () => Promise<unknown> | void }) {
  const { t } = useI18n()
  const { busy, act } = useStaffAct(ctx, after)
  const season = ctx.st.career.season
  const def = d.choices.find(c => c.key === d.default)
  const soon = d.left <= 1
  return (
    <article className={`sr-dec k-${d.kind}${soon ? ' urgent' : ''}`}>
      <div className="sr-dec-head">
        <span className="sr-kind"><Icon name={KIND_ICON[d.kind] ?? 'staff'} size={18} /></span>
        <h4>{decTitle(t, d)}</h4>
        <span className={'sr-due' + (soon ? ' soon' : '')}><Icon name="hourglass" size={12} /> {tn(t, 'sr.dec.left', d.left)}</span>
      </div>
      <div className="sr-faces">
        {d.kind === 'famous' ? <Portrait name={d.coach} role="head" size="sm" /> : <Portrait name={d.coach} role={d.role} size="sm" />}
        <span className="lbl"><b>{d.coach}</b><small>{roleName(t, d.role)}</small></span>
        {d.kind === 'clash' && d.other && (
          <>
            <span className="vs">vs</span>
            <Portrait name={d.other} role={d.otherRole ?? 'head'} size="sm" />
            <span className="lbl"><b>{d.other}</b><small>{roleName(t, d.otherRole ?? 'head')}</small></span>
          </>
        )}
        {d.kind === 'poach' && d.club && (
          <>
            <Icon name="next" size={16} />
            <Badge short={d.club.short} color={d.club.color} color2={d.club.color2} size={34} />
            <span className="lbl"><b>{d.club.name}</b></span>
          </>
        )}
      </div>
      <p className="sr-body">{decBody(t, d)}</p>
      {d.kind === 'prospect' && ctx.st.career.care?.autoXi && <span className="flag warn"><Icon name="warn" size={12} /> {t('sr.d.prospect.auto')}</span>}
      <div className="sr-choices">
        {d.choices.map(c => {
          const label = <><Icon name={c.key === d.default ? 'clock' : 'check'} size={14} /> {choiceLabel(t, d, c.key)}</>
          const go = () => act({ action: 'decide', id: d.id, choice: c.key }, undefined, r => r.success === false || ['poach_release', 'renew_letgo'].includes(r.outcome))
          return (
            <div key={c.key} className={'sr-choice' + (c.key === d.default ? ' def' : '')}>
              {CONFIRM.has(c.key)
                ? <ConfirmButton className={c.key === 'release' || c.key === 'letgo' ? 'small danger' : 'primary small'} disabled={busy} label={label} confirm={t('confirm')} onConfirm={go} />
                : <button className={c.key === d.default ? 'small' : 'primary small'} disabled={busy} onClick={go}>{label}</button>}
              <FxChips d={d} c={c} season={season} />
            </div>
          )
        })}
      </div>
      {def && <span className="sr-default"><Icon name="clock" size={12} /> {t('sr.dec.default', { c: choiceLabel(t, d, def.key) })}</span>}
    </article>
  )
}

/** A coach's wage demand (contracts.go): agree or refuse here, haggle in the inbox. */
export function RaiseCard({ dm, ctx, after }: { dm: Demand; ctx: Ctx; after?: () => Promise<unknown> | void }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const left = Math.max(0, dm.until - ctx.st.career.day)
  async function go(action: 'accept' | 'refuse') {
    setBusy(true)
    try {
      const r = await api.answerDemand(ctx.id, { kind: 'coach', id: dm.id, action })
      ctx.toast(r.accepted ? t('dem.signed', { name: dm.name }) : refusalText(t, r.outcome), !r.accepted)
      await Promise.all([ctx.reload(), after?.()])
    } catch (e) { ctx.toast(errText(t, e), true) } finally { setBusy(false) }
  }
  return (
    <article className={'sr-dec k-raise' + (left <= 1 ? ' urgent' : '')}>
      <div className="sr-dec-head">
        <span className="sr-kind"><Icon name="wages" size={18} /></span>
        <h4>{t('sr.raise.t', { name: dm.name })}</h4>
        <span className={'sr-due' + (left <= 1 ? ' soon' : '')}><Icon name="hourglass" size={12} /> {tn(t, 'sr.dec.left', left)}</span>
      </div>
      <div className="sr-faces">
        <Portrait name={dm.name} role={dm.role} size="sm" />
        <span className="lbl"><b>{dm.name}</b><small>{roleName(t, dm.role)}</small></span>
      </div>
      <p className="sr-body">{t('sr.raise.b', { w: money(dm.current), v: money(dm.ask) })}</p>
      <div className="row" style={{ gap: 6 }}>
        <button className="primary small" disabled={busy} onClick={() => go('accept')}><Icon name="check" size={14} /> {t('sr.raise.accept', { v: money(dm.ask) })}</button>
        <ConfirmButton className="small" disabled={busy} label={t('sr.raise.refuse')} confirm={t('dem.refuseCoach')} onConfirm={() => go('refuse')} />
        <button className="small" onClick={() => ctx.go('inbox')}><Icon name="chat" size={14} /> {t('sr.raise.haggle')}</button>
      </div>
    </article>
  )
}

/** The staff room's open cards in the Inbox (mount with one line in Inbox.tsx). */
export function StaffInbox({ ctx }: { ctx: Ctx }) {
  const { t } = useI18n()
  const ds = staffOf(ctx.st)?.decisions ?? []
  if (ctx.st.career.ended || ds.length === 0) return null
  return (
    <section className="panel stack">
      <div className="row spread">
        <Title icon="staff">{t('sr.dec.inbox')} · {t('sr.dec.title')}</Title>
        <button className="small" onClick={() => ctx.go('staff')}><Icon name="next" size={14} /> {t('sr.dec.open')}</button>
      </div>
      <div className="sr-decs">{ds.map(d => <DecisionCard key={d.id} d={d} ctx={ctx} />)}</div>
    </section>
  )
}

/** The decisions block at the top of the Staff page: staff cards and coach wage demands. */
export function DecisionsPanel({ ctx, decisions, after }: { ctx: Ctx; decisions: StaffDecision[]; after: () => Promise<unknown> | void }) {
  const { t } = useI18n()
  const raises = coachRaises(ctx.st)
  const n = decisions.length + raises.length
  if (n === 0 || ctx.st.career.ended) return null
  return (
    <section className="panel stack">
      <Title icon="board">{t('sr.dec.title')} ({n})</Title>
      <p className="hint"><Icon name="info" size={14} className="i" /><span>{t('sr.dec.help')}</span></p>
      <div className="sr-decs">
        {decisions.map(d => <DecisionCard key={d.id} d={d} ctx={ctx} after={after} />)}
        {raises.map(dm => <RaiseCard key={'r' + dm.id} dm={dm} ctx={ctx} after={after} />)}
      </div>
    </section>
  )
}
