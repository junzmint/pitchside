import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { Ctx } from '../App'
import { api } from '../api'
import type { Player, Tactic } from '../types'
import { COACH_STYLES, SLOTS, arrangeLineup, bestLineup, isIcon, coachFit, fitFactor, roleFits, slotRating, teamChemistry } from '../formations'
import { Bar, Ovr, PosTag, Seg, TagChip, TraitChips, Hint, Abbr, Icon } from '../ui'
import { errText, useI18n } from '../i18n'
import { eventsApi, eventsOf } from '../api_events'
import { personKeys, twoVersions } from '../legendVersions'
import { HomeMark } from '../LegendBits'
import { BRING_MAX, BringList, BringToggle, bringCount, bringTooWeak, isMarked } from './BringOn'
import { DevRotation } from './DevRotation'
import { LockAway, LockFlag, LockTips, LockToggle, lockedIds } from './LockXI'

/** What the page saves: every change is saved at once (persist), so nothing waits for a button. */
type Draft = { formation: string; lineup: number[]; tactic: Tactic; locks: number[] }

/** A sorted copy of the locked ids with ids added (on) or removed. */
function withLocks(cur: number[], ids: number[], on: boolean) {
  const next = new Set(cur)
  for (const id of ids) if (id > 0) { if (on) next.add(id); else next.delete(id) }
  return [...next].sort((a, b) => a - b)
}

function chemColor(c: number) {
  return c >= 7 ? '#3fcf7a' : c >= 5 ? '#e8c547' : '#ef6a55'
}

export default function Tactics({ ctx }: { ctx: Ctx }) {
  const { t } = useI18n()
  const { st } = ctx
  const autoXi = !!st.career.care?.autoXi
  const [formation, setFormation] = useState(st.club.formation)
  const [lineup, setLineup] = useState<number[]>(st.club.lineup)
  const [tactic, setTactic] = useState<Tactic>(st.club.tactic)
  const [sel, setSel] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  // locked starters (pages/LockXI.tsx): kept in their slots by the assistant, the rotations and the substitutions
  const savedLocks = lockedIds(st.career.care?.locked)
  const [locks, setLocks] = useState<number[]>(savedLocks)
  // every change is saved at once (persist): a change made while one is being saved waits in `pending` and goes
  // next; `tick` brings the server's answer back in after each round (the assistant may have re-picked the XI)
  const pending = useRef<Draft | null>(null)
  const busy = useRef(false)
  const [tick, setTick] = useState(0)
  // what the server has changed (a save, a match, the assistant switch): show it, unless a change is on its way
  const saved = `${st.club.formation}|${st.club.lineup.join(',')}|${JSON.stringify(st.club.tactic)}|${savedLocks.join(',')}`
  useEffect(() => {
    if (busy.current || pending.current) return
    setFormation(st.club.formation); setLineup(st.club.lineup); setTactic(st.club.tactic); setLocks(savedLocks); setSel(null)
  }, [saved, tick])
  const roles = st.formations[formation]
  const byId = useMemo(() => new Map(st.squad.map(p => [p.id, p])), [st.squad])
  const keyOf = useMemo(() => personKeys(st.squad), [st.squad]) // legend versions: one per match
  const lockSet = new Set(locks)
  const held = new Map(lineup.map((id, slot) => [slot, id] as [number, number]).filter(([, id]) => lockSet.has(id))) // slot → locked starter
  const heldSlots = new Set(held.keys())
  const starters = lineup.map(id => byId.get(id))
  const formWeeks = formation === st.club.formation ? st.club.formWeeks : 0
  const head = st.coaches?.find(c => c.role === 'head')
  const style = head?.style ?? ''
  const chem = teamChemistry(starters, formation, formWeeks, st.club.id, roles, COACH_STYLES[style]?.traits ?? [])
  const fit = coachFit(style, head?.name ?? '', formation, tactic, starters)

  /** Save the page as it now is (formation, eleven, playing style, locks). Changes made meanwhile go next. */
  async function persist(d: Draft) {
    pending.current = d
    if (busy.current) return
    busy.current = true
    setSaving(true)
    const was = { autoXi, formation: st.club.formation, lineup: st.club.lineup.join() }
    let autoOff = false
    try {
      while (pending.current) {
        const cur: Draft = pending.current
        pending.current = null
        // a hand-picked eleven (same formation, nothing locked) switches the assistant off on the server: say so
        autoOff = autoOff || (was.autoXi && cur.locks.length === 0 && cur.formation === was.formation && cur.lineup.join() !== was.lineup)
        await api.lineup(ctx.id, cur.formation, cur.lineup, cur.tactic, cur.locks)
        if (!pending.current) await ctx.reload()
      }
      if (autoOff) ctx.toast(`${t('saved')} · ${t('tac.autoXiOff')}`)
    } catch (e) {
      pending.current = null
      ctx.toast(errText(t, e), true)
      await ctx.reload().catch(() => undefined)
    } finally {
      busy.current = false
      setSaving(false)
      setTick(n => n + 1)
    }
  }
  /** Change the page and save it at once. */
  function apply(over: Partial<Draft>) {
    const d: Draft = { formation, lineup, tactic, locks, ...over }
    setFormation(d.formation); setLineup(d.lineup); setTactic(d.tactic); setLocks(d.locks); setSel(null)
    void persist(d)
  }

  function changeFormation(f: string) {
    const keep = lineup.map(id => byId.get(id)).filter(Boolean) as Player[]
    apply({ formation: f, lineup: bestLineup(keep.length === 11 ? keep : st.squad, st.formations[f], false, st.club.name) })
  }

  function assign(pid: number) {
    if (sel === null) return
    const p = byId.get(pid)
    if (p && p.injury > 0 && !p.rushed) return ctx.toast(t('err.injured'), true)
    const next = [...lineup]
    const before = next[sel]
    const other = next.indexOf(pid)
    if (other >= 0) next[other] = next[sel]
    next[sel] = pid
    if (twoVersions(next, byId, keyOf)) return ctx.toast(t('err.legend_twice'), true) // another version of him already starts
    let ls = locks
    if (other < 0) ls = withLocks(ls, [before], false) // the man he replaced left the side: no lock for a substitute
    // the assistant picks the team: a player you place yourself is locked in, or he would move him again
    if (autoXi) ls = withLocks(ls, other >= 0 ? [pid, before] : [pid], true)
    apply({ lineup: next, locks: ls })
  }

  function clickSlot(i: number) {
    if (sel === null) return setSel(i)
    if (sel === i) return setSel(null)
    const next = [...lineup]
    ;[next[sel], next[i]] = [next[i], next[sel]]
    apply({ lineup: next, locks: autoXi ? withLocks(locks, [next[sel], next[i]], true) : locks })
  }

  async function toggleAuto() {
    try {
      await api.setAutoXi(ctx.id, !autoXi)
      await ctx.reload()
      ctx.toast(!autoXi ? t('tac.autoXiOn') : t('tac.autoXiOff'))
    } catch (e) {
      ctx.toast(errText(t, e), true)
    }
  }

  const xi = new Set(lineup)
  const bench = st.squad.filter(p => !xi.has(p.id))
  // legend versions: a player whose other version is in the XI can't be on the bench either
  const startingPeople = new Set(lineup.map(id => keyOf(byId.get(id))).filter(Boolean))
  const otherStarts = (p: typeof st.squad[number]) => !xi.has(p.id) && startingPeople.has(keyOf(p))
  const selRole = sel !== null ? roles[sel] : null
  const list = selRole ? [...st.squad].sort((a, b) => (a.injury > 0 && !a.rushed ? 1 : 0) - (b.injury > 0 && !b.rushed ? 1 : 0) || slotRating(b, selRole) - slotRating(a, selRole)) : bench
  const weak = roles.map((r, i) => ({ r, i, c: chem.slots[i], p: starters[i] })).filter(x => x.p && x.c.chem < 5)

  return (
    <>
      <div className="head">
        <div><span className="eyebrow">{t('tac.eyebrow')}</span><h2>{t('tab.tactics')}</h2></div>
        <div className="row">
          <button onClick={() => apply({ lineup: bestLineup(st.squad, roles, false, st.club.name, held) })}>{t('tac.auto')}</button>
          <button data-tip={t('tac.arrangeHint')} onClick={() => apply({ lineup: arrangeLineup(st.squad, lineup, roles, heldSlots) })}>⇅ {t('tac.arrange')}</button>
          {st.squad.some(isIcon) && (
            <button title={t('tac.iconsHint')} onClick={() => apply({ lineup: bestLineup(st.squad, roles, true, st.club.name, held) })}>★ {t('tac.icons')}</button>
          )}
          <span className={'chip savestate' + (saving ? ' busy' : '')} role="status" data-tip={t('tac.autosaveTip')}>
            {saving ? t('tac.saving') : <><Icon name="check" size={13} /> {t('tac.autosaved')}</>}
          </span>
        </div>
      </div>

      <button className={'toggle autoxi' + (autoXi ? ' on' : '')} role="switch" aria-checked={autoXi} data-tip={t('tac.autoXiTip')} onClick={toggleAuto} disabled={!!st.career.ended}>
        <Icon name="board" size={18} /><span>{t('tac.autoXi')}</span>
        <i className="sw" aria-hidden="true"><b /></i><small>{autoXi ? t('set.on') : t('set.off')}</small>
      </button>
      <DevRotation ctx={ctx} />

      <div className="grid g2" style={{ alignItems: 'start' }}>
        <section className="panel stack">
          <div className="row spread">
            <h3>{t('tac.formation')}</h3>
            <Seg value={formation} options={Object.keys(SLOTS).map(f => [f, f] as [string, string])} onChange={changeFormation} />
          </div>
          <div className="chembar">
            <div className="row spread"><b>{t('chemistry')}: <span className="num">{chem.team}</span>/100</b><span className="muted" style={{ fontSize: 12 }}>{t('tac.familiar', { p: Math.round(chem.familiarity * 100) })}</span></div>
            <Bar v={chem.team} />
          </div>
          <div className="board">
            {roles.map((role, i) => {
              const [sx, sy] = SLOTS[formation][i]
              const p = byId.get(lineup[i])
              const fit = p ? fitFactor(p, role) : 1
              const c = chem.slots[i]
              const at = { left: `${6 + sy * 88}%`, top: `${88 - ((sx - 0.04) / 0.78) * 78}%` }
              const locked = !!p && lockSet.has(p.id)
              return (
                <Fragment key={i}>
                <button className={'slot' + (sel === i ? ' sel' : '') + (p && isIcon(p) ? ' icon' : '') + (locked ? ' locked' : '')} onClick={() => clickSlot(i)}
                  style={at} data-tip={p ? t('tac.slotTip', { name: p.name, role, n: Math.round(slotRating(p, role)), f: Math.round(p.fitness), m: Math.round(p.morale) }) : undefined}>
                  <span className="dot" style={p && isIcon(p) ? undefined : { background: st.club.color, color: st.club.color2, borderColor: st.club.color2 }}>
                    {p ? Math.round(slotRating(p, role)) : '?'}
                    {p && <i className="chemdot" style={{ background: chemColor(c.chem) }} title={`${t('chemistry')} ${c.chem.toFixed(1)}/10`} />}
                  </span>
                  {p && <i className="fitbar" data-v={p.fitness < 55 ? 'bad' : p.fitness < 75 ? 'mid' : 'good'} aria-hidden="true"><b style={{ width: `${Math.max(4, Math.min(100, p.fitness))}%` }} /></i>}
                  <span className="nm">{p && isIcon(p) ? '★ ' : ''}{p ? p.name : t('empty')}{p && <HomeMark p={p} clubName={st.club.name} size={10} focusable={false} />}</span>
                  <span className={'rl' + (fit < 1 ? ' warn' : '')}>{role}{p && fit < 1 ? ` · ${t('tac.natural')} ${p.role}` : ''}{p && p.learning && fit < 1 && roleFits(p.learning, role) ? ` · ${t('rt.learningShort', { pct: Math.floor(p.learnPct ?? 0) })}` : ''}</span>
                </button>
                {p && <LockToggle on={locked} name={p.name} role={role} style={at} onClick={() => apply({ locks: withLocks(locks, [p.id], !locked) })} />}
                </Fragment>
              )
            })}
          </div>
          <Hint text={t('tac.help')} />
          <div className="row spread lockbar">
            <span className={'chip lockcount' + (locks.length ? ' on' : '')}><Icon name="lock" size={13} /> {t('lock.count', { n: locks.length })}</span>
          </div>
          <Hint text={autoXi ? t('lock.autoHint') : t('lock.help')} />
          <LockAway squad={st.squad} locked={st.career.care?.locked} locks={locks} lineup={lineup} roles={st.formations[st.club.formation] ?? roles} onUnlock={id => apply({ locks: withLocks(locks, [id], false) })} />
          <LockTips ctx={ctx} />
        </section>

        <div className="stack" style={{ gap: 16 }}>
          <section className="panel stack">
            <div className="row spread">
              <h3>{t('fit.title')}</h3>
              <b className="num fitscore" data-v={fit.score >= 75 ? 'good' : fit.score < 50 ? 'bad' : 'mid'}>{head ? `${fit.score}/100` : '—'}</b>
            </div>
            {head ? (
              <>
                <span>{head.name} · <span className="stylechip">{t('style.' + style)}</span></span>
                <span className="muted" style={{ fontSize: 13 }}>{t('style.' + style + '.d')}</span>
                <Bar v={fit.score} />
                <div className="fitparts num">
                  <span>{t('fit.formation')}</span><b>{fit.formation}/25</b>
                  <span>{t('fit.tactic')}</span><b>{fit.tactic}/40</b>
                  <span>{style === 'star_power' ? t('fit.stars') : t('fit.players', { n: fit.fits })}</span><b>{fit.players}/35</b>
                </div>
                <ul className="notes">
                  {fit.formation < 25 && fit.prefer?.length ? <li className="warn">{t('fit.wantForm', { f: fit.prefer.join(', ') })}</li> : null}
                  {fit.misses?.map(m => <li key={m} className="warn">{t('fit.miss', { what: t('tac.' + m), want: (COACH_STYLES[style] as Record<string, string[]>)[m].map(v => t(`tac.${m}.${v}`)).join(' / ') })}</li>)}
                  {style !== 'star_power' && <li>{t('fit.traitsWanted', { list: COACH_STYLES[style].traits.map(x => t('trait.' + x)).join(', ') })}</li>}
                  <li className="muted">{t('fit.effect')}</li>
                </ul>
              </>
            ) : <p className="muted" style={{ margin: 0 }}>{t('fit.noCoach')}</p>}
          </section>

          <CaptainPanel ctx={ctx} />

          <section className="panel stack">
            <h3>{t('tac.chemTitle')}</h3>
            <Hint text={t('tac.chemHelp')} />
            {weak.length ? (
              <ul className="notes">
                {weak.map(x => (
                  <li key={x.i} className="warn">
                    <b>{x.r}</b> {x.p!.name}: {x.c.chem.toFixed(1)}/10 — {[
                      x.c.fit < 4 ? t('tac.why.fit') : '',
                      x.c.links < 1 ? t('tac.why.links') : '',
                      x.c.together < 1.5 ? t('tac.why.new') : '',
                    ].filter(Boolean).join(', ')}
                  </li>
                ))}
              </ul>
            ) : <p style={{ margin: 0, color: 'var(--good)' }}>{t('tac.chemGood')}</p>}
          </section>

          <section className="panel stack">
            <h3>{t('tac.style')}</h3>
            <TacticRow label={t('tac.mentality')} hint={t('tac.mentality.hint')} value={tactic.mentality}
              options={[['defensive', t('tac.mentality.defensive')], ['balanced', t('tac.mentality.balanced')], ['attacking', t('tac.mentality.attacking')]]} onChange={v => apply({ tactic: { ...tactic, mentality: v } })} />
            <TacticRow label={t('tac.pressing')} hint={t('tac.pressing.hint')} value={tactic.pressing}
              options={[['low', t('tac.pressing.low')], ['mid', t('tac.pressing.mid')], ['high', t('tac.pressing.high')]]} onChange={v => apply({ tactic: { ...tactic, pressing: v } })} />
            <TacticRow label={t('tac.passing')} hint={t('tac.passing.hint')} value={tactic.passing}
              options={[['short', t('tac.passing.short')], ['mixed', t('tac.passing.mixed')], ['direct', t('tac.passing.direct')]]} onChange={v => apply({ tactic: { ...tactic, passing: v } })} />
            <TacticRow label={t('tac.width')} hint={t('tac.width.hint')} value={tactic.width}
              options={[['narrow', t('tac.width.narrow')], ['normal', t('tac.width.normal')], ['wide', t('tac.width.wide')]]} onChange={v => apply({ tactic: { ...tactic, width: v } })} />
          </section>

          <section className="panel">
            <div className="row spread" style={{ marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>{selRole ? t('tac.pickFor', { role: selRole }) : t('tac.bench', { n: bench.length })}</h3>
              <span className={'chip bringcount' + (bringCount(st.squad) ? ' on' : '')}><Icon name="up" size={13} /> {t('bring.count', { n: bringCount(st.squad), max: BRING_MAX })}</span>
            </div>
            {!selRole && <Hint text={t('bring.help')} />}
            {!selRole && <BringList ctx={ctx} starters={xi} />}
            <div className="scroll">
              <table className="compact">
                <thead><tr><th>{t('player')}</th><th><Abbr k="pos" /></th><th className="r"><Abbr k="ovr" /></th>{selRole && <th className="r">{t('tac.atRole', { role: selRole })}</th>}<th>{t('fitness')}</th></tr></thead>
                <tbody>
                  {list.map(p => (
                    <tr key={p.id} className={selRole && (p.injury === 0 || p.rushed) ? 'click' : ''} onClick={() => selRole && assign(p.id)} style={{ opacity: p.injury > 0 && !p.rushed ? 0.5 : 1 }}>
                      <td className="namecell"><div className="pname">{p.shirt}. {p.name} <TagChip p={p} /> <HomeMark p={p} clubName={st.club.name} /> <TraitChips p={p} small />{otherStarts(p) && <span className="flag warn" data-tip={t('lgv.otherStartsTip')}><Icon name="legend" size={12} /> {t('lgv.otherStarts')}</span>}{p.injury > 0 && <span className="inj"> ✚ {p.injury}{t('wk')}{p.rushed ? ' · ' + t('rush.on') : ''}</span>}{xi.has(p.id) ? <span className="slotchip">{t('starter')} · {roles[lineup.indexOf(p.id)]}</span> : null}<LockFlag p={p} />{p.resting && <span className="flag rest" data-tip={t('lock.restingTip')}><Icon name="fitness" size={12} /> {t('lock.resting')}</span>}
                        {!selRole && !xi.has(p.id) && <span className="bringcell"><BringToggle ctx={ctx} p={p} compact />
                          {isMarked(p) && bringTooWeak(p, starters) && <span className="flag warn" data-tip={t('bring.weak')}><Icon name="warn" size={12} /> {t('bring.weakShort')}</span>}</span>}</div></td>
                      <td><PosTag p={p.position} role={p.role} /></td>
                      <td className="r"><Ovr v={p.overall} /></td>
                      {selRole && <td className="r num"><b style={{ color: fitFactor(p, selRole) < 1 ? 'var(--warn)' : undefined }}>{Math.round(slotRating(p, selRole))}</b></td>}
                      <td style={{ width: 90 }}><Bar v={p.fitness} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </>
  )
}

function TacticRow<T extends string>({ label, hint, value, options, onChange }: { label: string; hint: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="row spread"><b>{label}</b><Seg value={value} options={options} onChange={onChange} label={label} /></div>
      <span className="muted" style={{ fontSize: 12 }}>{hint}</span>
    </div>
  )
}

/** Club captain: chemistry when he starts, a steadier dressing room after defeats (more for a natural leader). */
function CaptainPanel({ ctx }: { ctx: Ctx }) {
  const { t } = useI18n()
  const ev = eventsOf(ctx.st)
  const loanees = new Set(ev?.loanees ?? [])
  const squad = ctx.st.squad.filter(p => p.clubId === ctx.st.club.id)
  const isLeader = (p: Player) => (p.traits ?? []).includes('leader')
  const sorted = [...squad].sort((a, b) => Number(isLeader(b)) - Number(isLeader(a)) || b.overall - a.overall)
  const cur = ev?.captain ?? 0
  const [pick, setPick] = useState(cur || sorted[0]?.id || 0)
  const [busy, setBusy] = useState(false)
  if (!ev || ctx.st.career.ended) return null
  const captain = squad.find(p => p.id === cur)
  async function appoint() {
    setBusy(true)
    try {
      await eventsApi.act(ctx.id, { action: 'captain', playerId: pick })
      await ctx.reload()
      ctx.toast(t('cap.set', { name: squad.find(p => p.id === pick)?.name ?? '' }))
    } catch (e) { ctx.toast(errText(t, e), true) } finally { setBusy(false) }
  }
  return (
    <section className="panel stack captain">
      <div className="row spread">
        <h3 style={{ margin: 0 }}>©️ {t('cap.title')}</h3>
        {captain ? <b>{captain.name}{isLeader(captain) ? ' · ' + t('trait.leader') : ''}</b> : <span className="muted">{t('cap.noneShort')}</span>}
      </div>
      <span className="muted" style={{ fontSize: 13 }}>{t('cap.help')}</span>
      {captain && !lineupHas(ctx.st.club.lineup, captain.id) && <span style={{ color: 'var(--warn)', fontSize: 13 }}>{t('cap.notStarting')}</span>}
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <select value={pick} onChange={e => setPick(Number(e.target.value))} style={{ flex: 1, minWidth: 0 }} aria-label={t('cap.title')}>
          {sorted.map(p => <option key={p.id} value={p.id}>{isLeader(p) ? '★ ' : ''}{p.name} · {p.role} · {p.overall}{loanees.has(p.id) ? ' · ' + t('loan.tag') : ''}</option>)}
        </select>
        <button className="primary small" disabled={busy || pick === cur || !pick} onClick={appoint}>{t('cap.appoint')}</button>
      </div>
    </section>
  )
}

function lineupHas(lineup: number[], id: number) { return lineup.includes(id) }
