import { useEffect, useMemo, useState } from 'react'
import type { Ctx } from '../App'
import { api } from '../api'
import type { Player, Tactic } from '../types'
import { COACH_STYLES, ROLE_CAT, SLOTS, arrangeLineup, bestLineup, isIcon, coachFit, effective, fitFactor, teamChemistry } from '../formations'
import { Bar, Ovr, PosTag, Seg, TagChip, TraitChips, Hint, Abbr, Icon } from '../ui'
import { errText, useI18n } from '../i18n'
import { eventsApi, eventsOf } from '../api_events'
import { personKeys, twoVersions } from '../legendVersions'
import { HomeMark } from '../LegendBits'
import { BRING_MAX, BringToggle, bringCount, bringTooWeak, isMarked } from './BringOn'

function chemColor(c: number) {
  return c >= 7 ? '#3fcf7a' : c >= 5 ? '#e8c547' : '#ef6a55'
}

export default function Tactics({ ctx }: { ctx: Ctx }) {
  const { t } = useI18n()
  const { st } = ctx
  const [formation, setFormation] = useState(st.club.formation)
  const [lineup, setLineup] = useState<number[]>(st.club.lineup)
  const [tactic, setTactic] = useState<Tactic>(st.club.tactic)
  const [sel, setSel] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  // the saved line-up changed on the server (the assistant switch picks a new XI): show it instead of the stale
  // local copy, which would otherwise look like unsaved changes and put the old XI back when saved
  const saved = `${st.club.formation}|${st.club.lineup.join(',')}|${JSON.stringify(st.club.tactic)}`
  useEffect(() => { setFormation(st.club.formation); setLineup(st.club.lineup); setTactic(st.club.tactic); setSel(null) }, [saved])
  const roles = st.formations[formation]
  const byId = useMemo(() => new Map(st.squad.map(p => [p.id, p])), [st.squad])
  const keyOf = useMemo(() => personKeys(st.squad), [st.squad]) // legend versions: one per match
  const dirty = formation !== st.club.formation || JSON.stringify(lineup) !== JSON.stringify(st.club.lineup) || JSON.stringify(tactic) !== JSON.stringify(st.club.tactic)
  const starters = lineup.map(id => byId.get(id))
  const formWeeks = formation === st.club.formation ? st.club.formWeeks : 0
  const head = st.coaches?.find(c => c.role === 'head')
  const style = head?.style ?? ''
  const chem = teamChemistry(starters, formation, formWeeks, st.club.id, roles, COACH_STYLES[style]?.traits ?? [])
  const fit = coachFit(style, head?.name ?? '', formation, tactic, starters)

  function changeFormation(f: string) {
    const keep = lineup.map(id => byId.get(id)).filter(Boolean) as Player[]
    setFormation(f)
    setLineup(bestLineup(keep.length === 11 ? keep : st.squad, st.formations[f], false, st.club.name))
    setSel(null)
  }

  function assign(pid: number) {
    if (sel === null) return
    const p = byId.get(pid)
    if (p && p.injury > 0 && !p.rushed) return ctx.toast(t('err.injured'), true)
    const next = [...lineup]
    const other = next.indexOf(pid)
    if (other >= 0) next[other] = next[sel]
    next[sel] = pid
    if (twoVersions(next, byId, keyOf)) return ctx.toast(t('err.legend_twice'), true) // another version of him already starts
    setLineup(next)
    setSel(null)
  }

  function clickSlot(i: number) {
    if (sel === null) return setSel(i)
    if (sel === i) return setSel(null)
    const next = [...lineup]
    ;[next[sel], next[i]] = [next[i], next[sel]]
    setLineup(next)
    setSel(null)
  }

  const autoXi = !!st.career.care?.autoXi
  async function toggleAuto() {
    try {
      await api.setAutoXi(ctx.id, !autoXi)
      await ctx.reload()
      ctx.toast(!autoXi ? t('tac.autoXiOn') : t('tac.autoXiOff'))
    } catch (e) {
      ctx.toast(errText(t, e), true)
    }
  }

  async function save() {
    setSaving(true)
    try {
      // a hand-picked eleven (same formation) switches the assistant off on the server: say so
      const autoOff = autoXi && formation === st.club.formation && lineup.join() !== st.club.lineup.join()
      await api.lineup(ctx.id, formation, lineup, tactic)
      await ctx.reload()
      ctx.toast(autoOff ? `${t('saved')} · ${t('tac.autoXiOff')}` : t('saved'))
    } catch (e) {
      ctx.toast(errText(t, e), true)
    } finally {
      setSaving(false)
    }
  }

  const xi = new Set(lineup)
  const bench = st.squad.filter(p => !xi.has(p.id))
  // legend versions: a player whose other version is in the XI can't be on the bench either
  const startingPeople = new Set(lineup.map(id => keyOf(byId.get(id))).filter(Boolean))
  const otherStarts = (p: typeof st.squad[number]) => !xi.has(p.id) && startingPeople.has(keyOf(p))
  const selRole = sel !== null ? roles[sel] : null
  const list = selRole ? [...st.squad].sort((a, b) => (a.injury > 0 && !a.rushed ? 1 : 0) - (b.injury > 0 && !b.rushed ? 1 : 0) || effective(b, selRole) - effective(a, selRole)) : bench
  const weak = roles.map((r, i) => ({ r, i, c: chem.slots[i], p: starters[i] })).filter(x => x.p && x.c.chem < 5)

  return (
    <>
      <div className="head">
        <div><span className="eyebrow">{t('tac.eyebrow')}</span><h2>{t('tab.tactics')}</h2></div>
        <div className="row">
          <button onClick={() => { setLineup(bestLineup(st.squad, roles, false, st.club.name)); setSel(null) }}>{t('tac.auto')}</button>
          <button data-tip={t('tac.arrangeHint')} onClick={() => { setLineup(arrangeLineup(st.squad, lineup, roles)); setSel(null) }}>⇅ {t('tac.arrange')}</button>
          {st.squad.some(isIcon) && (
            <button title={t('tac.iconsHint')} onClick={() => { setLineup(bestLineup(st.squad, roles, true, st.club.name)); setSel(null) }}>★ {t('tac.icons')}</button>
          )}
          <button className="primary" disabled={!dirty || saving} onClick={save}>{saving ? t('wait') : dirty ? t('saveChanges') : t('saved')}</button>
        </div>
      </div>

      <button className={'toggle autoxi' + (autoXi ? ' on' : '')} role="switch" aria-checked={autoXi} data-tip={t('tac.autoXiTip')} onClick={toggleAuto} disabled={!!st.career.ended}>
        <Icon name="board" size={18} /><span>{t('tac.autoXi')}</span>
        <i className="sw" aria-hidden="true"><b /></i><small>{autoXi ? t('set.on') : t('set.off')}</small>
      </button>

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
              return (
                <button key={i} className={'slot' + (sel === i ? ' sel' : '') + (p && isIcon(p) ? ' icon' : '')} onClick={() => clickSlot(i)}
                  style={{ left: `${6 + sy * 88}%`, top: `${88 - ((sx - 0.04) / 0.78) * 78}%` }}>
                  <span className="dot" style={p && isIcon(p) ? undefined : { background: st.club.color, color: st.club.color2, borderColor: st.club.color2 }}>
                    {p ? Math.round(effective(p, role)) : '?'}
                    {p && <i className="chemdot" style={{ background: chemColor(c.chem) }} title={`${t('chemistry')} ${c.chem.toFixed(1)}/10`} />}
                  </span>
                  <span className="nm">{p && isIcon(p) ? '★ ' : ''}{p ? p.name : t('empty')}{p && <HomeMark p={p} clubName={st.club.name} size={10} focusable={false} />}</span>
                  <span className={'rl' + (fit < 1 ? ' warn' : '')}>{role}{p && fit < 1 ? ` · ${t('tac.natural')} ${p.role}` : ''}</span>
                </button>
              )
            })}
          </div>
          <Hint text={t('tac.help')} />
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
              options={[['defensive', t('tac.mentality.defensive')], ['balanced', t('tac.mentality.balanced')], ['attacking', t('tac.mentality.attacking')]]} onChange={v => setTactic({ ...tactic, mentality: v })} />
            <TacticRow label={t('tac.pressing')} hint={t('tac.pressing.hint')} value={tactic.pressing}
              options={[['low', t('tac.pressing.low')], ['mid', t('tac.pressing.mid')], ['high', t('tac.pressing.high')]]} onChange={v => setTactic({ ...tactic, pressing: v })} />
            <TacticRow label={t('tac.passing')} hint={t('tac.passing.hint')} value={tactic.passing}
              options={[['short', t('tac.passing.short')], ['mixed', t('tac.passing.mixed')], ['direct', t('tac.passing.direct')]]} onChange={v => setTactic({ ...tactic, passing: v })} />
            <TacticRow label={t('tac.width')} hint={t('tac.width.hint')} value={tactic.width}
              options={[['narrow', t('tac.width.narrow')], ['normal', t('tac.width.normal')], ['wide', t('tac.width.wide')]]} onChange={v => setTactic({ ...tactic, width: v })} />
          </section>

          <section className="panel">
            <div className="row spread" style={{ marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>{selRole ? t('tac.pickFor', { role: selRole }) : t('tac.bench', { n: bench.length })}</h3>
              <span className={'chip bringcount' + (bringCount(st.squad) ? ' on' : '')}><Icon name="up" size={13} /> {t('bring.count', { n: bringCount(st.squad), max: BRING_MAX })}</span>
            </div>
            {!selRole && <Hint text={t('bring.help')} />}
            <div className="scroll">
              <table className="compact">
                <thead><tr><th>{t('player')}</th><th><Abbr k="pos" /></th><th className="r"><Abbr k="ovr" /></th>{selRole && <th className="r">{t('tac.atRole', { role: selRole })}</th>}<th>{t('fitness')}</th></tr></thead>
                <tbody>
                  {list.map(p => (
                    <tr key={p.id} className={selRole && (p.injury === 0 || p.rushed) ? 'click' : ''} onClick={() => selRole && assign(p.id)} style={{ opacity: p.injury > 0 && !p.rushed ? 0.5 : 1 }}>
                      <td className="namecell"><div className="pname">{p.shirt}. {p.name} <TagChip p={p} /> <HomeMark p={p} clubName={st.club.name} /> <TraitChips p={p} small />{otherStarts(p) && <span className="flag warn" data-tip={t('lgv.otherStartsTip')}><Icon name="legend" size={12} /> {t('lgv.otherStarts')}</span>}{p.injury > 0 && <span className="inj"> ✚ {p.injury}{t('wk')}{p.rushed ? ' · ' + t('rush.on') : ''}</span>}{xi.has(p.id) ? <span className="slotchip">{t('starter')} · {roles[lineup.indexOf(p.id)]}</span> : null}
                        {!selRole && !xi.has(p.id) && <span className="bringcell"><BringToggle ctx={ctx} p={p} compact />
                          {isMarked(p) && bringTooWeak(p, starters) && <span className="flag warn" data-tip={t('bring.weak')}><Icon name="warn" size={12} /> {t('bring.weakShort')}</span>}</span>}</div></td>
                      <td><PosTag p={p.position} role={p.role} /></td>
                      <td className="r"><Ovr v={p.overall} /></td>
                      {selRole && <td className="r num"><b style={{ color: ROLE_CAT[selRole] === p.position ? undefined : 'var(--warn)' }}>{Math.round(effective(p, selRole))}</b></td>}
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
