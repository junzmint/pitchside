import { Fragment, useState, type ReactNode } from 'react'
import type { Ctx } from '../App'
import { api, money } from '../api'
import type { Player } from '../types'
import { ATTRS, regularCount } from '../formations'
import { tierOf, Bar, ConfirmButton, Ovr, PosTag, Seg, TagChip, TraitChips, Abbr, Icon, PageHead, PlayerCard, Title, ViewSwitch, useViewMode, Empty, Portal, Modal } from '../ui'
import type { Pos } from '../types'
import { errText, useI18n } from '../i18n'
import { SellDialog } from './Market'
import { eventsOf } from '../api_events'
import { MentorFlag } from './staff/MentorFlag'
import { DemandCard } from './Demands'
import { HomeMark } from '../LegendBits'
import { clubApi, refreshClubLife, useClubLife } from '../api_club'
import { BringFlag, BringToggle, bringTooWeak, isMarked } from './BringOn'
import { LockFlag } from './LockXI'

type Sort = 'shirt' | 'overall' | 'potential' | 'age' | 'fitness' | 'value'

export default function Squad({ ctx }: { ctx: Ctx }) {
  const { t } = useI18n()
  const { st } = ctx
  const [sort, setSort] = useState<Sort>('shirt')
  const [open, setOpen] = useState<number | null>(null)
  const [selling, setSelling] = useState<Player | null>(null)
  const [intensity, setIntensity] = useState(st.career.training.intensity)
  const [view, setView] = useViewMode('squad')
  const [pos, setPos] = useState<Pos | 'ALL'>('ALL')

  async function setTraining(next: string, focus: Record<string, string> = {}) {
    try {
      await api.training(ctx.id, next, focus)
      await ctx.reload()
    } catch (e) { ctx.toast(errText(t, e), true) }
  }

  async function careAct(fn: () => Promise<unknown>): Promise<boolean> {
    try { await fn(); await ctx.reload(); return true } catch (e) { ctx.toast(errText(t, e), true); return false }
  }
  async function release(p: Player) {
    try {
      const r = await api.release(ctx.id, p.id)
      await ctx.reload()
      ctx.toast(t('sq.released', { name: p.name, v: money(r.received) }))
    } catch (e) { ctx.toast(errText(t, e), true) }
  }

  const rows = [...st.squad].filter(p => pos === 'ALL' || p.position === pos).sort((a, b) => sort === 'shirt' ? a.shirt - b.shirt : sort === 'age' ? a.age - b.age : (b[sort] as number) - (a[sort] as number))
  const xi = new Set(st.club.lineup)
  const slotOf = new Map(st.club.lineup.map((id, i) => [id, st.formations[st.club.formation]?.[i]]))
  const coach = (role: string) => st.coaches?.find(c => c.role === role)?.skill ?? 0
  const injured = st.squad.filter(p => p.injury > 0).length
  const openP = open != null ? st.squad.find(p => p.id === open) ?? null : null
  // open contract talks (renewals and raises): negotiated right in the player's panel, not only in the Inbox
  const talks = (id: number) => st.career.contracts?.demands?.find(d => d.kind === 'player' && d.id === id)
  const openTalks = openP ? talks(openP.id) : undefined
  async function renew(p: Player) {
    if (await careAct(() => api.renew(ctx.id, p.id))) {
      setOpen(p.id) // the negotiation shows in his panel
      ctx.toast(t('ct.talks', { name: p.name }))
    }
  }
  // events stream: players borrowed from another club can't be sold, released or renewed; listed ones are up for sale
  const ev = eventsOf(st)
  const loanee = new Set(ev?.loanees ?? [])
  const listed = new Set(ev?.listed ?? [])
  const flagsOf = (p: Player) => <PlayerFlags p={p} slot={xi.has(p.id) ? slotOf.get(p.id) ?? '' : null} loanee={loanee.has(p.id)} listed={listed.has(p.id)} clubName={st.club.name} />

  return (
    <>
      <PageHead icon="squad" eyebrow={t(regularCount(st.squad) < st.squad.length ? 'sq.countIcons' : 'sq.count', { n: regularCount(st.squad), i: st.squad.length - regularCount(st.squad), inj: injured })} title={t('tab.squad')}>
        <div className="row">
          <span className="chip num tpchip" data-tip={t('tp.help')}><Icon name="tp" size={14} /> {t('tp.have', { n: st.career.tp })}</span>
          <span className="muted"><Icon name="training" size={14} /> {t('sq.intensity')}</span>
          <Seg value={intensity} options={[['light', t('intensity.light')], ['normal', t('intensity.normal')], ['hard', t('intensity.hard')]]}
            onChange={v => { setIntensity(v); setTraining(v) }} />
          <label className="row" style={{ gap: 6 }} data-tip={t('rot.help')}>
            <span className="muted"><Icon name="rotate" size={14} /> {t('rot.label')}</span>
            <select value={st.career.care?.rotate ?? 0} onChange={e => careAct(() => api.setRotation(ctx.id, Number(e.target.value)))}>
              <option value={0}>{t('rot.off')}</option>
              {[50, 60, 70].map(n => <option key={n} value={n}>{t('rot.below', { n })}</option>)}
            </select>
          </label>
        </div>
      </PageHead>

      <details className="panel helpbox" style={{ fontSize: 13 }}>
        <summary><Icon name="info" size={15} /> {t('sq.guide')}</summary>
        <div className="grid g3">
          <div><b><Icon name="training" size={14} /> {t('sq.how')}</b><p className="muted" style={{ margin: '4px 0 0' }}>{t('sq.howBody')}</p></div>
          <div><b><Icon name="staff" size={14} /> {t('sq.coaches')}</b><p className="muted" style={{ margin: '4px 0 0' }}>{t('sq.coachesBody', { a: coach('attack'), d: coach('defense'), f: coach('fitness'), g: coach('goalkeeping') })}</p></div>
          <div><b><Icon name="injury" size={14} /> {t('sq.risk')}</b><p className="muted" style={{ margin: '4px 0 0' }}>{t('sq.riskBody')}</p></div>
        </div>
      </details>

      <section className="panel">
        <div className="row spread" style={{ marginBottom: 12 }}>
          <Title icon="squad">{t('sq.list')}</Title>
          <div className="row">
            <Seg value={pos} options={[['ALL', t('all')], ...(['GK', 'DF', 'MF', 'FW'] as Pos[]).map((k): [Pos, ReactNode] => [k, <span key={k} data-tip={t('posL.' + k)}>{t('pos.' + k)}</span>])]} onChange={setPos} label={t('lbl.pos')} />
            <span className="muted"><Icon name="filter" size={14} /> {t('sortBy')}</span>
            <select value={sort} onChange={e => setSort(e.target.value as Sort)} aria-label={t('sortBy')}>
              <option value="shirt">{t('sort.shirt')}</option><option value="overall">{t('lbl.ovr')}</option><option value="potential">{t('lbl.pot')}</option>
              <option value="age">{t('age')}</option><option value="fitness">{t('fitness')}</option><option value="value">{t('value')}</option>
            </select>
            <ViewSwitch value={view} onChange={setView} />
          </div>
        </div>
        {rows.length === 0 && <Empty icon="squad">{t('mk.none')}</Empty>}
        {view === 'cards' ? (
          <div className="cards">
            {rows.map(p => (
              <PlayerCard key={p.id} p={p} onOpen={() => setOpen(p.id)} flags={flagsOf(p)} />
            ))}
          </div>
        ) : (
        <div className="scroll tall">
          <table>
            <thead>
              <tr>
                <th>#</th><th>{t('player')}</th><th><Abbr k="pos" /></th><th className="r">{t('age')}</th><th className="r"><Abbr k="ovr" /></th><th className="r"><Abbr k="pot" /></th>
                {ATTRS.map(a => <th key={a} className="r" data-tip={`${t('attr.' + a)}\n${t('attr.' + a + '.d')}`}>{t('attrS.' + a)}</th>)}
                <th>{t('fitness')}</th><th title={t('load.help')}>{t('load.title')}</th><th>{t('sq.focus')}</th><th className="r">{t('value')}</th><th>{t('ct.col')}</th><th className="r">{t('ct.wage')}</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(p => (
                <Fragment key={p.id}>
                  <tr className="click" onClick={() => setOpen(open === p.id ? null : p.id)} style={{ opacity: p.injury > 0 ? 0.6 : 1 }}>
                    <td className="num">{p.shirt}</td>
                    <td className="namecell"><div className="pname">
                      <b>{p.name}</b> <TagChip p={p} /> <HomeMark p={p} clubName={st.club.name} /> <TraitChips p={p} small /> <MentorFlag p={p} /> <BringFlag p={p} starter={xi.has(p.id)} /> <LockFlag p={p} />
                      {p.injury > 0 && <span className="inj"><Icon name="injury" size={13} /> {p.injury}{t('wk')}</span>}
                      {p.injury === 1 && (
                        <button className={'small rush' + (p.rushed ? ' on' : '')} title={t('rush.help')}
                          onClick={e => { e.stopPropagation(); careAct(() => api.setCare(ctx.id, p.id, { load: p.load ?? '', rush: !p.rushed })) }}>
                          {p.rushed ? t('rush.on') : t('rush.off')}
                        </button>
                      )}
                      {p.unrest > 0 && <span className="unrest" data-tip={t('sq.unrestHint')}><Icon name="warn" size={12} /> {t('sq.unrest', { n: Math.max(0, 4 - p.unrest) })}</span>}
                      {xi.has(p.id) && <span className="slotchip">{t('starter')} · {slotOf.get(p.id)}</span>}
                    </div></td>
                    <td><PosTag p={p.position} role={p.role} /></td>
                    <td className="r num">{p.age}</td>
                    <td className="r"><Ovr v={p.overall} /></td>
                    <td className="r num muted">{p.potential}</td>
                    {ATTRS.map(a => <td key={a} className="r attr" style={{ color: p[a] >= 80 ? 'var(--good)' : p[a] < 45 ? 'var(--muted)' : undefined }}>{Math.floor(p[a])}</td>)}
                    <td style={{ width: 80 }} title={`${Math.round(p.fitness)}%`}><Bar v={p.fitness} color={p.fitness < 60 ? 'var(--bad)' : p.fitness < 75 ? '#e0b23a' : undefined} /></td>
                    <td onClick={e => e.stopPropagation()}>
                      <select value={p.load ?? ''} aria-label={t('load.title')} className={p.load ? 'loadsel ' + p.load : 'loadsel'}
                        onChange={e => careAct(() => api.setCare(ctx.id, p.id, { load: e.target.value }))}>
                        <option value="">{t('load.team')}</option>
                        <option value="rest">{t('load.rest')}</option>
                        <option value="recovery">{t('load.recovery')}</option>
                        <option value="intense">{t('load.intense')}</option>
                      </select>
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <select value={p.focus} aria-label={t('sq.focus')} onChange={e => setTraining(intensity, { [p.id]: e.target.value })}>
                        <option value="balanced">{t('sq.balanced')}</option>
                        {ATTRS.map(a => <option key={a} value={a}>{t('attr.' + a)}</option>)}
                      </select>
                    </td>
                    <td className="r num"><b>{money(p.value)}</b></td>
                    <td className="ctcell" onClick={e => e.stopPropagation()}>
                      <span className={p.contract === 1 ? 'ctleft last' : 'ctleft'}>{p.contract === -1 ? '∞ ' + t('ct.permanent') : t('ct.left', { n: p.contract ?? 0 })}</span>
                      {talks(p.id) ? <button className="small ctnegobtn" onClick={() => setOpen(p.id)}><Icon name="chat" size={13} /> {t('ct.negotiating')}</button>
                        : !loanee.has(p.id) && p.contract != null && p.contract >= 1 && p.contract <= 2 && <button className="small" onClick={() => renew(p)}>{t('ct.renew')}</button>}
                    </td>
                    <td className="r num" data-tip={p.market && p.market > p.wage ? t('sq.marketWage', { v: money(p.market) }) : undefined}>{money(p.wage)}{p.market && p.market >= p.wage * 1.2 ? <Icon name="up" size={13} className="warnc" /> : ''}</td>
                    <td onClick={e => e.stopPropagation()}>
                      <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                        {loanee.has(p.id) ? <span className="flag" data-tip={t('sq.loaneeHint')}><Icon name="rotate" size={12} /> {t('sq.loanee')}</span> : <>
                        <button className="small" onClick={() => setSelling(p)}><Icon name="sell" size={13} /> {t('sq.sell')}</button>
                        <ConfirmButton className="small danger" label={<><Icon name="release" size={13} /> {t('sq.release')}</>} confirm={t('sq.releaseFor', { v: money(Math.floor(p.value * 0.7 / 1e4) * 1e4) })} onConfirm={() => release(p)} /></>}
                      </div>
                    </td>
                  </tr>
                  {open === p.id && view === 'table' && (
                    <tr className="detailrow">
                      <td colSpan={20} style={{ whiteSpace: 'normal' }}><PlayerDetail p={p} ctx={ctx} /></td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </section>
      {view === 'cards' && openP && (
        <Modal className="sheet" onClose={() => setOpen(null)} label={openP.name}>
            <div className="row spread" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
              <div className="sheethead">
                <span className={'bigovr t-' + tierOf(openP.overall)}><b className="num">{Math.round(openP.overall)}</b><PosTag p={openP.position} role={openP.role} /></span>
                <div><span className="eyebrow">#{openP.shirt} · {t('posL.' + openP.position)}</span><h2>{openP.name}</h2>{flagsOf(openP)}</div>
              </div>
              <button onClick={() => setOpen(null)} aria-label={t('close')}><Icon name="close" size={18} /></button>
            </div>
            <div className="sheetctl">
              <label className="field"><span className="muted"><Icon name="fitness" size={14} /> {t('load.title')}</span>
                <select value={openP.load ?? ''} aria-label={t('load.title')} className={openP.load ? 'loadsel ' + openP.load : 'loadsel'}
                  onChange={e => careAct(() => api.setCare(ctx.id, openP.id, { load: e.target.value }))}>
                  <option value="">{t('load.team')}</option><option value="rest">{t('load.rest')}</option><option value="recovery">{t('load.recovery')}</option><option value="intense">{t('load.intense')}</option>
                </select>
              </label>
              <label className="field"><span className="muted"><Icon name="training" size={14} /> {t('sq.focus')}</span>
                <select value={openP.focus} aria-label={t('sq.focus')} onChange={e => setTraining(intensity, { [openP.id]: e.target.value })}>
                  <option value="balanced">{t('sq.balanced')}</option>
                  {ATTRS.map(a => <option key={a} value={a}>{t('attr.' + a)}</option>)}
                </select>
              </label>
              <div className="field"><span className="muted"><Icon name="contract" size={14} /> {t('ct.col')}</span>
                <span className="row" style={{ gap: 6 }}>
                  <b className={openP.contract === 1 ? 'ctleft last' : ''}>{openP.contract === -1 ? '∞ ' + t('ct.permanent') : t('ct.left', { n: openP.contract ?? 0 })}</b>
                  {openTalks ? <span className="chip warn"><Icon name="chat" size={13} /> {t('ct.negotiating')}</span>
                    : !loanee.has(openP.id) && openP.contract != null && openP.contract >= 1 && openP.contract <= 2 && <button className="small" onClick={() => renew(openP)}>{t('ct.renew')}</button>}
                </span>
              </div>
              <ShirtPicker ctx={ctx} p={openP} />
              <div className="field"><span className="muted"><Icon name="up" size={14} /> {t('bring.on')}</span>
                <span className="row" style={{ gap: 6 }}><BringToggle ctx={ctx} p={openP} />
                  {isMarked(openP) && (xi.has(openP.id) ? <small className="muted">{t('bring.starter')}</small>
                    : bringTooWeak(openP, st.club.lineup.map(id => st.squad.find(q => q.id === id))) && <small className="warnc">{t('bring.weak')}</small>)}</span>
              </div>
              <div className="field"><span className="muted"><Icon name="wages" size={14} /> {t('ct.wage')}</span><b className="num">{money(openP.wage)}{openP.market && openP.market >= openP.wage * 1.2 ? <span data-tip={t('sq.marketWage', { v: money(openP.market) })}> <Icon name="up" size={14} className="warnc" /></span> : ''}</b></div>
              <div className="field"><span className="muted"><Icon name="money" size={14} /> {t('value')}</span><b className="num gold">{money(openP.value)}</b></div>
            </div>
            {openTalks && <div className="ctnego"><DemandCard d={openTalks} ctx={ctx} /></div>}
            <PlayerDetail p={openP} ctx={ctx} />
            <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
              {openP.injury === 1 && (
                <button className={'rush' + (openP.rushed ? ' on' : '')} data-tip={t('rush.help')} onClick={() => careAct(() => api.setCare(ctx.id, openP.id, { load: openP.load ?? '', rush: !openP.rushed }))}>
                  <Icon name="injury" size={15} /> {openP.rushed ? t('rush.on') : t('rush.off')}
                </button>
              )}
              {loanee.has(openP.id) ? <span className="hint"><Icon name="info" size={14} className="i" /><span>{t('sq.loaneeHint')}</span></span> : <>
                <button onClick={() => { setSelling(openP); setOpen(null) }}><Icon name="sell" size={15} /> {t('sq.sell')}</button>
                <ConfirmButton className="danger" label={<><Icon name="release" size={15} /> {t('sq.release')}</>} confirm={t('sq.releaseFor', { v: money(Math.floor(openP.value * 0.7 / 1e4) * 1e4) })} onConfirm={() => { setOpen(null); release(openP) }} />
              </>}
            </div>
        </Modal>
      )}
      {selling && <Portal><SellDialog ctx={ctx} player={selling} onClose={() => setSelling(null)} /></Portal>}
    </>
  )
}

/** His shirt number: any free one, or a teammate's (they swap); numbers the club retired are locked. A number you
 *  pick stays through the automatic tidying at the start of each season. */
function ShirtPicker({ ctx, p }: { ctx: Ctx; p: Player }) {
  const { t } = useI18n()
  const life = useClubLife(ctx.st)
  const [busy, setBusy] = useState(false)
  const wearer = new Map(ctx.st.squad.filter(x => x.id !== p.id).map(x => [x.shirt, x] as const))
  const retired = new Map<number, { name: string; id: number }>()
  for (const n of life?.retired ?? []) retired.set(n, { name: '', id: 0 })
  for (const le of life?.legends ?? []) if (le.honour === 'retired' && retired.has(le.shirt)) retired.set(le.shirt, { name: le.name, id: le.playerId })
  async function pick(n: number) {
    if (n === p.shirt || busy) return
    setBusy(true)
    try {
      const r = await clubApi.act(ctx.id, { action: 'shirt', playerId: p.id, shirt: n })
      refreshClubLife()
      await ctx.reload()
      // whoever had to move (the one who wore it takes the old number, or one that suits him better)
      const others = (r.moved ?? []).filter(m => m.id !== p.id)
      ctx.toast(others.length ? t('sq.shirtSwapped', { name: p.name, n, others: others.map(m => t('sq.shirtTo', { name: m.name, n: m.shirt })).join(', ') }) : t('sq.shirtSet', { name: p.name, n }))
    } catch (e) { ctx.toast(errText(t, e), true) } finally { setBusy(false) }
  }
  return (
    <label className="field" data-tip={t('sq.shirtTip')}><span className="muted"><Icon name="kit" size={14} /> {t('sq.shirt')}</span>
      <select value={p.shirt} disabled={busy} aria-label={t('sq.shirt')} onChange={e => void pick(Number(e.target.value))}>
        {[...Array.from({ length: 99 }, (_, i) => i + 1), ...(p.shirt > 99 ? [p.shirt] : [])].map(n => {
          const who = wearer.get(n), ret = retired.get(n)
          const locked = !!ret && ret.id !== p.id
          const note = n === p.shirt ? '' : locked ? ` · ${t('sq.shirtRetired')}${ret.name ? ' · ' + ret.name : ''}` : who ? ` · ${t('sq.shirtSwap', { name: who.name })}` : ''
          return <option key={n} value={n} disabled={locked}>{n}{note}</option>
        })}
      </select>
    </label>
  )
}

/** Status flags under a player card: starter slot, injury, unrest, contract, legend. */
function PlayerFlags({ p, slot, loanee, listed, clubName }: { p: Player; slot: string | null; loanee?: boolean; listed?: boolean; clubName: string }) {
  const { t } = useI18n()
  return (
    <span className="pc-flagrow">
      {loanee && <span className="flag" data-tip={t('sq.loaneeHint')}><Icon name="rotate" size={12} /> {t('sq.loanee')}</span>}
      {listed && <span className="flag warn"><Icon name="sell" size={12} /> {t('sq.listed')}</span>}
      {slot != null && <span className="flag club"><Icon name="apps" size={12} /> {slot || t('starter')}</span>}
      {p.injury > 0 && <span className="flag bad" data-inj={p.injKind || undefined} data-tip={p.injKind ? `${t('inj.' + p.injKind)}: ${t('inj.' + p.injKind + '.d')}` : undefined}><Icon name="injury" size={12} /> {p.injKind ? `${t('inj.' + p.injKind + '.s')} · ` : ''}{p.injury}{t('wk')}</span>}
      {p.unrest > 0 && <span className="flag bad" data-tip={t('sq.unrestHint')}><Icon name="warn" size={12} /> {t('sq.unrest', { n: Math.max(0, 4 - p.unrest) })}</span>}
      {p.contract === 1 && <span className="flag warn"><Icon name="contract" size={12} /> {t('ct.left', { n: 1 })}</span>}
      {p.load && <span className="flag">{t('load.' + p.load)}</span>}
      <BringFlag p={p} starter={slot != null} />
      <LockFlag p={p} />
      <MentorFlag p={p} />
      <TagChip p={p} />
      <HomeMark p={p} clubName={clubName} />
      <TraitChips p={p} small />
    </span>
  )
}

// legends cost double (they don't age, but improve slowly)
const attrCost = (v: number, legend = false) => (1 + Math.max(0, Math.floor((v - 50) / 10))) * (legend ? 2 : 1)
const potCost = (pot: number, legend = false) => (5 + Math.max(0, Math.floor((pot - 80) / 3))) * (legend ? 2 : 1)
// an extra limit break after the season's free one: the same TP plus money, more each time (club.go ExtraBreakFee)
export const extraBreakFee = (value: number, done = 0) => Math.round(Math.max(500_000, Math.min(15_000_000, value * 0.04)) * (done + 1) / 10_000) * 10_000
// potential is a guide, not a wall: past it an upgrade may not take (club.go UpgradeChance, same numbers)
export const upgradeChance = (p: Player, legend = false) => {
  const over = p.overall - p.potential
  if (over < 0) return 1
  return legend ? Math.max(0.3, 0.85 - 0.06 * over) : Math.max(0.15, 0.75 - 0.1 * over)
}

export function PlayerDetail({ p, ctx }: { p: Player; ctx?: Ctx }) {
  const legend = p.tag === 'legend' || p.tag === 'custom'
  const freeBreak = p.tag === 'legend' // legend cards break their limit at any level (still once a season)
  const farFromLimit = !freeBreak && p.overall < p.potential - 2
  const { t } = useI18n()
  const tp = ctx?.st.career.tp ?? 0
  const chance = upgradeChance(p, legend)
  async function up(what: string) {
    if (!ctx) return
    try {
      if (what === '__reveal') await api.revealTraits(ctx.id, p.id)
      else {
        const r = await api.upgradePlayer(ctx.id, p.id, what)
        if (r?.failed) ctx.toast(t('up.failed'), true)
        else if (what === 'potential_extra') ctx.toast(t('up.extraDone', { pot: r.player.potential, v: money(r.fee ?? 0) }))
      }
      await ctx.reload()
    } catch (e) { ctx.toast(errText(t, e), true) }
  }
  const potCap = legend ? 110 : 99
  const canBreak = !(p.age > 30 && !legend) && p.potential < potCap && !farFromLimit
  const fee = extraBreakFee(p.value, p.extraBreaks ?? 0)
  const budget = ctx?.st.club.budget ?? 0
  return (
    <div className="grid g3" style={{ padding: '6px 0' }}>
      <div className="stack" style={{ gap: 4 }}>
        <b>{p.name}</b>
        <span className="muted">{t('nation.' + p.nation)} · {legend ? t('up.ageless') : `${p.age} ${t('yrs')}`} · {t('lbl.pot')} {p.potential}</span>
        {!legend && <span className={'devchip d-' + (p.dev || 'hidden')} title={t('dev.help')}>{t('devc.' + (p.dev || 'hidden'))}</span>}
        {ctx && <span className="muted num">{t('sq.appsSeason', { n: p.apps ?? 0 })}</span>}
        {!legend && p.age <= 23 && p.overall < p.potential && <span className="muted growhint"><Icon name="match" size={13} /> {t('sq.growHint')}</span>}
        <span className="muted">{t('wage')} {money(p.wage)}/{t('wk').trim()} · {t('morale')} {Math.round(p.morale)}</span>
        <span className="muted">{t('sq.tenure', { n: p.tenure })}</span>
        <div className="stack" style={{ gap: 4, marginTop: 6 }}>
          <b>{t('trait.title')}</b>
          {p.traits?.length ? p.traits.map(x => <span key={x} style={{ fontSize: 13 }}><span className={'trait t-' + x}>{t('trait.' + x)}</span> {t('trait.' + x + '.d')}</span>)
            : p.hiddenTraits ? (
              <span className="row" style={{ gap: 6 }}>
                <span className="muted" style={{ fontSize: 13 }}>{t('trait.hiddenN', { n: p.hiddenTraits })}</span>
                {ctx && <button className="small" disabled={tp < 1} onClick={() => up('__reveal')}><Icon name="search" size={13} /> {t('trait.reveal')}</button>}
              </span>
            ) : <span className="muted" style={{ fontSize: 13 }}>{t('trait.none')}</span>}
        </div>
        {ctx && (
          <div className="stack" style={{ gap: 6, marginTop: 6 }}>
            <b>{t('up.title')}</b>
            <span className="muted" style={{ fontSize: 12 }}>{t('up.help', { n: tp })}</span>
            <button className="small" disabled={(p.age > 30 && !legend) || p.potential >= (legend ? 110 : 99) || tp < potCost(p.potential, legend) || farFromLimit || !!p.brokeLimit} onClick={() => up('potential')}>
              <Icon name="up" size={14} /> {t('up.potential', { c: potCost(p.potential, legend) })}
            </button>
            {p.age > 30 && !legend && <span className="muted" style={{ fontSize: 12 }}>{t('up.tooOld')}</span>}
            {p.brokeLimit ? <span className="muted" style={{ fontSize: 12 }}>{t('up.brokeThisSeason')}</span>
              : farFromLimit && !(p.age > 30 && !legend) && <span className="muted" style={{ fontSize: 12 }}>{t('up.notAtLimit')}</span>}
            {p.brokeLimit && canBreak && (
              <>
                <ConfirmButton className="small" disabled={tp < potCost(p.potential, legend) || budget < fee}
                  label={<><Icon name="up" size={14} /> {t('up.extra', { c: potCost(p.potential, legend), v: money(fee) })}</>}
                  confirm={t('up.extraConfirm', { c: potCost(p.potential, legend), v: money(fee) })} onConfirm={() => up('potential_extra')} />
                <span className="muted" style={{ fontSize: 12 }}>{t('up.extraHelp', { n: p.extraBreaks ?? 0 })}</span>
              </>
            )}
            {freeBreak && !p.brokeLimit && p.potential < 110 && <span className="muted" style={{ fontSize: 12 }}>{t('lgv.breakFree')}</span>}
            {legend && <span className="muted" style={{ fontSize: 12 }}>{t('up.legend')}</span>}
          </div>
        )}
      </div>
      <div className="stack" style={{ gap: 5, gridColumn: 'span 2' }}>
        {ATTRS.map(a => (
          <div key={a} className="row" style={{ flexWrap: 'nowrap' }}>
            <span style={{ width: 104, display: 'inline-flex', gap: 6, alignItems: 'center' }}><Icon name={a} size={14} /> {t('attr.' + a)}</span>
            <div style={{ flex: 1 }}><Bar v={p[a]} color={p.focus === a ? 'var(--club)' : undefined} /></div>
            <b className="num" style={{ width: 40, textAlign: 'right' }}>{p[a].toFixed(1)}</b>
            {ctx && (
              <button className="small upbtn" title={chance < 1 ? t('up.chance', { n: Math.round(chance * 100), c: attrCost(p[a], legend) }) : t('up.attr', { c: attrCost(p[a], legend) })}
                disabled={tp < attrCost(p[a], legend) || p[a] >= (legend ? 110 : 99)}
                onClick={() => up(a)}><Icon name="plus" size={12} />1 · {attrCost(p[a], legend)}<Icon name="tp" size={12} />{chance < 1 && <small className="upchance"> {Math.round(chance * 100)}%</small>}</button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
