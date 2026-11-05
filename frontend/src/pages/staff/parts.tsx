// Small building blocks of the staff room: portraits, skill stars, meters, chips and the effect list of a choice.
import { useState } from 'react'
import { money } from '../../api'
import { MOOD_FACE, initials, moodBand, roleIcon, staffApi, type Fit, type StaffChoice, type StaffDecision, type StaffFx, type StaffReq, type StaffResult, type StaffTrait } from '../../api_staff'
import type { Ctx } from '../../App'
import { errText, useI18n, type TFn } from '../../i18n'
import { Icon, type IconName } from '../../ui'

/** A count in words: uses the key's '#1' variant (English singular) when there is one. */
export function tn(t: TFn, key: string, n: number, params: Record<string, string | number> = {}) {
  const p = { ...params, n }
  if (n === 1) {
    const s = t(key + '#1', p)
    if (s !== key + '#1') return s
  }
  return t(key, p)
}

/** Role name, falling back to the raw key for a role this build has no words for yet. */
export function roleName(t: TFn, role: string) {
  const k = 'role.' + role
  const s = t(k)
  return s === k ? role.charAt(0).toUpperCase() + role.slice(1) : s
}
export function roleDoes(t: TFn, role: string) {
  const k = 'role.' + role + '.does'
  const s = t(k)
  return s === k ? '' : s
}

export function Portrait({ name, role, morale, size }: { name: string; role: string; morale?: number; size?: 'sm' | 'lg' }) {
  const band = morale != null ? moodBand(morale) : 0
  return (
    <span className={`sr-portrait r-${role}${size ? ' ' + size : ''}${band === 5 || band === 1 ? ' m' + band : ''}`} aria-hidden="true">
      {initials(name)}
      <Icon name={roleIcon(role)} size={size === 'sm' ? 10 : 12} />
      {band ? <span className="face">{MOOD_FACE[band]}</span> : null}
    </span>
  )
}

export function RoleBadge({ role }: { role: string }) {
  return <span className={'sr-rolebadge r-' + role}><Icon name={roleIcon(role)} size={18} /></span>
}

/** Five stars, four skill points each (a half star for two); faint stars show how far he can still grow. */
export function Stars({ skill, ceil }: { skill: number; ceil?: number }) {
  return (
    <span className="sr-stars" aria-hidden="true">
      {[0, 1, 2, 3, 4].map(i => {
        const full = skill >= (i + 1) * 4
        const half = !full && skill >= i * 4 + 2
        const reach = !full && !half && (ceil ?? 0) >= i * 4 + 2
        return <Icon key={i} name="star" size={15} className={full ? 'on' : half ? 'half' : reach ? 'ceil' : ''} />
      })}
    </span>
  )
}

export function SkillLine({ skill, ceil, mood }: { skill: number; ceil: number; mood?: number }) {
  const { t } = useI18n()
  return (
    <div className="sr-skill" data-tip={t('sr.skillTip', { s: skill, c: ceil })}>
      <Stars skill={skill + (mood ?? 0)} ceil={ceil} />
      <span className="sr-skillnum num">{skill}<small>/20</small></span>
      {mood ? <span className={'sr-moodtag ' + (mood > 0 ? 'up' : 'down')}>{t(mood > 0 ? 'sr.mood.up' : 'sr.mood.down')}</span> : null}
      <span className="sr-ceil">{ceil > skill ? <><Icon name="up" size={12} /> {t('sr.ceil', { n: ceil })}</> : <><Icon name="crown" size={12} /> {t('sr.atBest')}</>}</span>
    </div>
  )
}

export function Meter({ icon, label, value, max, cls, right, tip }: { icon: IconName; label: string; value: number; max: number; cls: string; right: string; tip?: string }) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100))
  return (
    <div className="sr-meter" data-tip={tip}>
      <span><Icon name={icon} size={13} /> {label}</span>
      <div className={'sr-bar ' + cls}><i style={{ width: pct + '%' }} /></div>
      <b>{right}</b>
    </div>
  )
}

export function MoraleMeter({ morale }: { morale: number }) {
  const { t } = useI18n()
  const band = moodBand(morale)
  return <Meter icon="flame" label={t('sr.morale')} value={morale} max={100} cls={'mor m' + band} right={`${MOOD_FACE[band]} ${morale} · ${t('sr.mood.' + band)}`} tip={t('sr.moraleTip')} />
}

export function TraitChip({ trait }: { trait: StaffTrait }) {
  const { t } = useI18n()
  return <span className={'sr-trait t-' + trait} data-tip={t('sr.trait.' + trait + '.d')} tabIndex={0}>{t('sr.trait.' + trait)}</span>
}

export function PerkChips({ perks }: { perks?: string[] }) {
  const { t } = useI18n()
  if (!perks?.length) return null
  return <span className="sr-perks">{perks.map(p => <span key={p} className="perkchip" data-tip={t('perk.' + p + '.d')} tabIndex={0}><Icon name="bonus" size={11} /> {t('perk.' + p)}</span>)}</span>
}

export function StyleChip({ style }: { style?: string }) {
  const { t } = useI18n()
  if (!style) return null
  return <span className="stylechip" data-tip={t('style.' + style + '.d')} tabIndex={0}>{t('style.' + style)}</span>
}

/** How well a coach's speciality suits a position (same rule as mentorFit in staff_life.go). */
export function fitOf(role: string, pos: string): Fit {
  if (role === 'attack') return pos === 'FW' || pos === 'MF' ? 'full' : 'half'
  if (role === 'defense') return pos === 'DF' ? 'full' : pos === 'MF' ? 'good' : 'half'
  if (role === 'goalkeeping') return pos === 'GK' ? 'full' : 'half'
  return 'good'
}

// ---------------------------------------------------------------- decision cards: words and effects

export const KIND_ICON: Record<string, IconName> = {
  renew: 'contract', retire: 'legend', poach: 'transferOut', clash: 'derby', camp: 'training', signing: 'buy', prospect: 'youth', famous: 'star', raise: 'wages',
}

const signed = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(Math.round(v))

export function decParams(t: TFn, d: StaffDecision): Record<string, string | number> {
  return {
    name: d.coach, other: d.other ?? '', player: d.player ?? '', club: d.club?.name ?? '',
    v: money(d.amount ?? 0), w: money(d.wage ?? 0), role: roleName(t, d.role),
    pos: d.kind === 'signing' && d.value ? t('posL.' + d.value) : '',
    style: d.kind === 'famous' && d.value ? t('style.' + d.value) : '',
    ...(d.nums ?? {}),
  }
}

export function decTitle(t: TFn, d: StaffDecision) {
  const k = d.kind === 'clash' || d.kind === 'camp' ? `sr.d.${d.kind}.${d.topic}.t` : `sr.d.${d.kind}.t`
  return t(k, decParams(t, d))
}

export function decBody(t: TFn, d: StaffDecision) {
  let k = d.kind === 'clash' || d.kind === 'camp' ? `sr.d.${d.kind}.${d.topic}.b` : `sr.d.${d.kind}.b`
  if (d.kind === 'clash' && d.topic === 'tactics') k += d.role === 'attack' ? '.up' : '.down'
  return t(k, decParams(t, d))
}

export function choiceLabel(t: TFn, d: StaffDecision, key: string) {
  switch (key) {
    case 'assistant': return t('sr.c.side', { name: d.coach })
    case 'head': return t('sr.c.side', { name: d.other ?? '' })
    case 'book': return t('sr.c.book', { v: money(d.amount ?? 0) })
    case 'hire': return t('sr.c.hire', { v: money(d.amount ?? 0) })
    case 'promise': return d.kind === 'prospect' ? t('sr.c.minutes', { need: d.nums?.need ?? 2, of: d.nums?.of ?? 4 }) : t('sr.c.promise')
    case 'refuse': return d.kind === 'signing' ? t('sr.c.notnow') : t('sr.c.refuse')
  }
  return t('sr.c.' + key)
}

function fxView(t: TFn, x: StaffFx, d: StaffDecision, season: number): { text: string; tone: string; icon?: IconName; face?: string } {
  const v = x.v ?? 0
  switch (x.k) {
    case 'morale': case 'pmorale': return { text: `${x.name ?? ''} ${signed(v)}`, tone: v >= 0 ? 'good' : 'bad', face: v >= 0 ? '😊' : '😠' }
    case 'squad': return { text: t('sr.fx.squad', { v: signed(v) }), tone: v >= 0 ? 'good' : 'bad', face: v >= 0 ? '😊' : '😠' }
    case 'fitness': return { text: t('sr.fx.fitness', { v: signed(v) }), tone: v >= 0 ? 'good' : 'bad', icon: 'fitness' }
    case 'growth': return { text: t('sr.fx.growth', { v, who: x.name ?? t('sr.who.' + (x.pos || 'all')), n: x.days ?? 0 }), tone: 'good', icon: 'up' }
    case 'money': return { text: (v > 0 ? '+' : '') + money(v), tone: v >= 0 ? 'good' : 'bad', icon: 'coins' }
    case 'wage': return { text: t('sr.fx.wage', { v: money(v) }), tone: 'gold', icon: 'wages' }
    case 'years': return { text: t('sr.fx.years', { n: season + v }), tone: '', icon: 'contract' }
    case 'addyear': return { text: t('sr.fx.addyear'), tone: '', icon: 'contract' }
    case 'letgo': return { text: t('sr.fx.letgo'), tone: 'bad', icon: 'release' }
    case 'retire': return { text: t('sr.fx.retire'), tone: '', icon: 'legend' }
    case 'stay': return { text: t('sr.fx.stay'), tone: 'good', icon: 'check' }
    case 'leave': return { text: t('sr.fx.leave', { name: x.name ?? '', club: x.str ?? '' }), tone: 'bad', icon: 'transferOut' }
    case 'tactic': return { text: t('sr.fx.tactic', { v: t('tac.mentality.' + (x.str ?? 'balanced')) }), tone: '', icon: 'tactics' }
    case 'promise': {
      const kind = d.kind === 'signing' ? 'signing' : 'minutes'
      return { text: t('sr.fx.promise.' + kind, { n: x.days ?? 0, name: kind === 'signing' ? d.coach : (x.name ?? ''), v }), tone: 'gold', icon: 'sign' }
    }
    case 'hire': return { text: t('sr.fx.hire', { name: x.name ?? '' }), tone: 'good', icon: 'hire' }
    case 'replace': return { text: t('sr.fx.replace', { name: x.name ?? '' }), tone: '', icon: 'release' }
  }
  return { text: x.k, tone: '' }
}

export function FxChips({ d, c, season }: { d: StaffDecision; c: StaffChoice; season: number }) {
  const { t } = useI18n()
  const chip = (x: StaffFx, i: number) => {
    const f = fxView(t, x, d, season)
    return <span key={i} className={'sr-fx ' + f.tone}>{f.icon ? <Icon name={f.icon} size={11} /> : f.face ? <span aria-hidden="true">{f.face}</span> : null} {f.text}</span>
  }
  const fx = c.fx ?? []
  return (
    <span className="sr-fxs">
      {c.chance ? <span className="sr-fx chance"><Icon name="rotate" size={11} /> {t('sr.fx.chance', { n: c.chance })}</span> : null}
      {fx.map(chip)}
      {fx.length === 0 && d.kind === 'famous' && <span className="sr-fx bad"><Icon name="transferOut" size={11} /> {t('sr.fx.famousGone')}</span>}
      {fx.length === 0 && d.kind !== 'famous' && <span className="sr-fx">{t('sr.fx.none')}</span>}
      {c.fail?.length ? <><span className="sep">{t('sr.fx.fail')}</span>{c.fail.map((x, i) => chip(x, 100 + i))}</> : null}
    </span>
  )
}

/** The toast after an answer. */
export function outcomeText(t: TFn, r: StaffResult) {
  const p = { name: r.name ?? '', other: r.other ?? '', v: money(Math.abs(r.amount ?? 0)) }
  if (r.outcome === 'poach_counter') return t(r.success ? 'sr.out.poach_counter.ok' : 'sr.out.poach_counter.fail', p)
  const k = 'sr.out.' + r.outcome
  const s = t(k, p)
  return s === k ? '' : s
}

/** Post a staff action, toast the result, refresh the career (and the staff room). */
export function useStaffAct(ctx: Ctx, after?: () => Promise<unknown> | void) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  async function act(body: StaffReq, ok?: (r: StaffResult) => string, bad?: (r: StaffResult) => boolean, done?: () => void) {
    setBusy(true)
    try {
      const r = await staffApi.act(ctx.id, body)
      done?.() // (a dialog closes at once; the career reload below takes a moment)
      const msg = ok ? ok(r) : outcomeText(t, r)
      if (msg) ctx.toast(msg, bad ? bad(r) : false)
      await Promise.all([ctx.reload(), after?.()])
      return r
    } catch (e) {
      ctx.toast(errText(t, e), true)
      return null
    } finally { setBusy(false) }
  }
  return { busy, act }
}
