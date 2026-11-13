import type { Chemistry, CoachFit, Player, Pos, SlotChem, Tactic } from './types'
import { onePerPerson, personKeys } from './legendVersions'

// Slot coordinates for a team attacking to the right; mirrors backend game/rating.go.
// x: 0 = own goal line, 1 = opponent goal line. y: 0 = left touchline (top on screen), 1 = right.
export const SLOTS: Record<string, [number, number][]> = {
  '4-4-2': [[0.04, 0.5], [0.22, 0.14], [0.19, 0.38], [0.19, 0.62], [0.22, 0.86], [0.48, 0.14], [0.44, 0.39], [0.44, 0.61], [0.48, 0.86], [0.76, 0.4], [0.76, 0.6]],
  '4-3-3': [[0.04, 0.5], [0.22, 0.14], [0.19, 0.38], [0.19, 0.62], [0.22, 0.86], [0.46, 0.3], [0.36, 0.5], [0.46, 0.7], [0.74, 0.15], [0.8, 0.5], [0.74, 0.85]],
  '4-2-3-1': [[0.04, 0.5], [0.22, 0.14], [0.19, 0.38], [0.19, 0.62], [0.22, 0.86], [0.36, 0.38], [0.36, 0.62], [0.6, 0.16], [0.6, 0.5], [0.6, 0.84], [0.82, 0.5]],
  '3-5-2': [[0.04, 0.5], [0.2, 0.28], [0.18, 0.5], [0.2, 0.72], [0.42, 0.1], [0.47, 0.33], [0.37, 0.5], [0.47, 0.67], [0.42, 0.9], [0.76, 0.4], [0.76, 0.6]],
  '5-3-2': [[0.04, 0.5], [0.27, 0.1], [0.2, 0.3], [0.18, 0.5], [0.2, 0.7], [0.27, 0.9], [0.45, 0.3], [0.42, 0.5], [0.45, 0.7], [0.74, 0.4], [0.74, 0.6]],
}

export const ROLE_CAT: Record<string, Pos> = {
  GK: 'GK', CB: 'DF', LB: 'DF', RB: 'DF', LWB: 'DF', RWB: 'DF',
  DM: 'MF', CM: 'MF', LM: 'MF', RM: 'MF', AM: 'MF', LW: 'FW', RW: 'FW', ST: 'FW',
}

export const ATTRS = ['pace', 'shooting', 'passing', 'dribbling', 'defending', 'physical', 'goalkeeping'] as const

export function overallAs(p: Pick<Player, typeof ATTRS[number]>, cat: Pos): number {
  switch (cat) {
    case 'GK': return p.goalkeeping * 0.82 + p.physical * 0.09 + p.passing * 0.09
    case 'DF': return p.defending * 0.45 + p.physical * 0.2 + p.pace * 0.15 + p.passing * 0.14 + p.dribbling * 0.06
    case 'MF': return p.passing * 0.34 + p.dribbling * 0.2 + p.defending * 0.14 + p.shooting * 0.12 + p.pace * 0.1 + p.physical * 0.1
    default: return p.shooting * 0.4 + p.dribbling * 0.24 + p.pace * 0.2 + p.physical * 0.1 + p.passing * 0.06
  }
}
const ORDER: Record<Pos, number> = { GK: 0, DF: 1, MF: 2, FW: 3 }
// mirrors backend roleCompat
const COMPAT: Record<string, string[]> = { LB: ['LWB'], RB: ['RWB'], LM: ['LW'], RM: ['RW'], LW: ['LM'], RW: ['RM'], CM: ['DM', 'AM'], DM: ['CM'], AM: ['CM'] }
export function roleFits(natural: string | undefined, slot: string) {
  return !natural || natural === slot || (COMPAT[natural] ?? []).includes(slot)
}
/** How well a player suits a slot by his own role alone (backend baseFit). */
export function baseFit(p: Player, role: string): number {
  const cat = ROLE_CAT[role]
  if (cat === p.position) return roleFits(p.role, role) ? 1 : 0.96
  if (cat === 'GK' || p.position === 'GK') return 0.55
  if (p.role && roleFits(p.role, role)) return 1 // a winger on the flank of a midfield four (LW in an LM slot), or the other way round
  return Math.abs(ORDER[cat] - ORDER[p.position]) === 1 ? 0.92 : 0.84
}
/** How well a player suits a slot (backend fitFactor): back towards 1 for a role he has learned or is learning. */
export function fitFactor(p: Player, role: string): number {
  const f = baseFit(p, role)
  if (f >= 1 || p.position === 'GK' || ROLE_CAT[role] === 'GK') return f
  if ((p.known ?? []).some(k => roleFits(k, role))) return 1
  if (p.learning && roleFits(p.learning, role)) return f + (1 - f) * Math.min(100, p.learnPct ?? 0) / 100
  return f
}
/** A player's rating in a slot: position fit, not fitness or morale. In his own role it is the overall the Squad
 *  page shows; the Tactics board shows this number. */
export function slotRating(p: Player, role: string): number {
  return overallAs(p, ROLE_CAT[role]) * fitFactor(p, role)
}
/** His strength in a slot today: the slot rating with fitness and morale (backend Effective), for picking a side. */
export function effective(p: Player, role: string): number {
  return slotRating(p, role) * (0.75 + 0.25 * p.fitness / 100) * (0.97 + 0.06 * p.morale / 100)
}

/** Keep the same eleven but move each to the slot that suits him best: start from the current
 *  order and swap any two players while that raises the team's total effective rating. */
export function arrangeLineup(players: Player[], lineup: number[], roles: string[], fixed?: Set<number>): number[] {
  const byId = new Map(players.map(p => [p.id, p]))
  const out = [...lineup]
  const val = (id: number, slot: number) => { const p = byId.get(id); return p ? effective(p, roles[slot]) : 0 }
  for (let pass = 0; pass < 20; pass++) {
    let improved = false
    for (let i = 0; i < out.length; i++) {
      if (fixed?.has(i)) continue // a locked slot stays as it is
      for (let j = i + 1; j < out.length; j++) {
        if (fixed?.has(j)) continue
        const now = val(out[i], i) + val(out[j], j)
        const swapped = val(out[j], i) + val(out[i], j)
        if (swapped > now + 0.01) { [out[i], out[j]] = [out[j], out[i]]; improved = true }
      }
    }
    if (!improved) break
  }
  return out
}

/** Icon players: legend cards and custom players. */
export const isIcon = (p: Player) => p.tag === 'legend' || p.tag === 'custom'
/** Players who count towards the 50-player cap: icons don't (backend regulars). */
export const regularCount = (squad: Player[]) => squad.filter(p => !isIcon(p)).length

/** Greedy best XI. With preferIcons, legends and custom players win a slot unless someone is clearly (15%+) better.
 *  held: locked starters (slot → player id, backend lineup_lock.go) who keep their slots when they can play; their
 *  other legend versions sit out. */
export function bestLineup(squad: Player[], roles: string[], preferIcons = false, clubName?: string, held?: Map<number, number>): number[] {
  const keyOf = personKeys(squad)
  const fixed = new Map<number, number>() // slot → id of a held player who can play
  const heldPeople = new Set<string>()
  for (const [slot, id] of held ?? []) {
    const p = squad.find(x => x.id === id)
    if (!p || slot >= roles.length || (p.injury > 0 && !p.rushed) || p.resting) continue
    fixed.set(slot, id)
    const k = keyOf(p)
    if (k) heldPeople.add(k)
  }
  const fixedIds = new Set(fixed.values())
  // one version of a legend per match (legendVersions.ts): his club version when fit, otherwise the best-rated one
  const fitOnes = squad.filter(p => p.injury === 0 && !p.resting && !fixedIds.has(p.id) && !(keyOf(p) && heldPeople.has(keyOf(p))))
  const players = onePerPerson(fitOnes, undefined, clubName)
  const used = new Set<number>()
  const out: number[] = new Array(roles.length).fill(-1)
  for (const [slot, id] of fixed) out[slot] = id
  const pri: Record<Pos, number> = { GK: 0, FW: 1, DF: 2, MF: 3 }
  const order = roles.map((_, i) => i).filter(i => !fixed.has(i)).sort((a, b) => pri[ROLE_CAT[roles[a]]] - pri[ROLE_CAT[roles[b]]])
  for (const slot of order) {
    let best = -1, bestR = -1
    for (const p of players) {
      if (used.has(p.id) || p.injury > 0) continue
      const r = effective(p, roles[slot]) * (preferIcons && isIcon(p) ? 1.15 : 1)
      if (r > bestR) { best = p.id; bestR = r }
    }
    if (best >= 0) used.add(best)
    out[slot] = best
  }
  // slot by slot the greedy pass leaves stars out of position (a centre-back at left-back, the left-back in the
  // middle): move the eleven to their best slots, then bring in a bench player wherever he is now the stronger one
  const val = (p: Player, slot: number) => effective(p, roles[slot]) * (preferIcons && isIcon(p) ? 1.15 : 1)
  const locked = new Set(fixed.keys())
  let xi = out.includes(-1) ? out : arrangeLineup(players, out, roles, locked)
  for (let pass = 0; pass < 3 && !xi.includes(-1); pass++) {
    let changed = false
    xi.forEach((id, slot) => {
      if (locked.has(slot)) return
      const cur = players.find(p => p.id === id)
      let bestId = id, bestR = cur ? val(cur, slot) : -1
      for (const p of players) {
        if (xi.includes(p.id) || p.injury > 0) continue
        const r = val(p, slot)
        if (r > bestR + 0.01) { bestId = p.id; bestR = r }
      }
      if (bestId !== id) { xi[slot] = bestId; changed = true }
    })
    if (!changed) break
    xi = arrangeLineup(players, xi, roles, locked)
  }
  return xi
}

function neighbours(formation: string, i: number, j: number) {
  const s = SLOTS[formation]
  const dx = s[i][0] - s[j][0], dy = s[i][1] - s[j][1]
  return Math.hypot(dx * 1.3, dy) < 0.34
}
function sharedPast(a: number[], b: number[], current: number) {
  return a.some(x => x !== current && b.includes(x))
}

/** Mirrors backend TeamChemistry so the lineup screen updates live before saving. */
export function teamChemistry(starters: (Player | undefined)[], formation: string, formWeeks: number, clubId: number, roles: string[], styleTraits: string[] = []): Chemistry {
  const slots: SlotChem[] = roles.map(() => ({ chem: 0, fit: 0, links: 0, together: 0 }))
  let sum = 0
  starters.forEach((p, i) => {
    if (!p) return
    const f = fitFactor(p, roles[i])
    const sc: SlotChem = { fit: f === 1 ? 4 : f >= 0.95 ? 3 : f >= 0.9 ? 2 : 0, links: 0, together: Math.min(3, p.tenure / 4), chem: 0 }
    starters.forEach((q, j) => {
      if (j === i || !q || !neighbours(formation, i, j)) return
      if (q.nation === p.nation) sc.links += 1
      if (sharedPast(p.history ?? [], q.history ?? [], clubId)) sc.links += 1.5
      if (q.traits?.includes('leader')) sc.links += 0.5
    })
    if (styleTraits.some(t => p.traits?.includes(t))) { sc.links += 1; sc.styleFit = true }
    // homecoming: a legend card from this club's own era
    // (only the exact club version; the generic "Icon" card belongs to no club)
    if ((p.tag === 'legend' || p.tag === 'custom') && p.version && p.version !== 'Icon' && p.history?.[0] === clubId) sc.links += 1.5
    sc.links = Math.min(3, sc.links)
    sc.chem = sc.fit + sc.links + sc.together
    slots[i] = sc
    sum += sc.chem
  })
  const familiarity = Math.min(1, formWeeks / 5)
  return { team: Math.round(Math.max(0, Math.min(100, (sum / roles.length) * 8.5 + familiarity * 15))), familiarity, slots }
}

// mirrors backend game/traits.go CoachStyles
export const COACH_STYLES: Record<string, { formations: string[]; mentality: string[]; pressing: string[]; passing: string[]; width: string[]; traits: string[] }> = {
  tiki_taka: { formations: ['4-3-3', '4-2-3-1'], mentality: ['balanced', 'attacking'], pressing: ['high'], passing: ['short'], width: ['normal', 'wide'], traits: ['one_two', 'playmaker', 'flair'] },
  gegenpress: { formations: ['4-2-3-1', '4-3-3'], mentality: ['attacking'], pressing: ['high'], passing: ['mixed', 'direct'], width: [], traits: ['tireless', 'hard_tackler', 'speedster'] },
  counter: { formations: ['4-4-2', '5-3-2', '4-2-3-1'], mentality: ['defensive', 'balanced'], pressing: ['low', 'mid'], passing: ['direct'], width: [], traits: ['speedster', 'poacher', 'long_shot'] },
  catenaccio: { formations: ['5-3-2', '3-5-2', '4-4-2'], mentality: ['defensive'], pressing: ['low', 'mid'], passing: ['mixed', 'short'], width: ['narrow', 'normal'], traits: ['hard_tackler', 'aerial', 'leader'] },
  wing_play: { formations: ['4-4-2', '3-5-2', '4-3-3'], mentality: ['balanced', 'attacking'], pressing: ['mid'], passing: ['mixed', 'direct'], width: ['wide'], traits: ['speedster', 'aerial', 'poacher'] },
  star_power: { formations: [], mentality: ['attacking', 'balanced'], pressing: [], passing: [], width: [], traits: ['flair', 'big_game', 'long_shot'] },
}

const inOrAny = (xs: string[], v: string) => xs.length === 0 || xs.includes(v)

export function coachFit(style: string, coach: string, formation: string, t: Tactic, starters: (Player | undefined)[]): CoachFit {
  const cs = COACH_STYLES[style]
  if (!cs) return { score: 50, style: '', coach: '', formation: 0, tactic: 0, players: 0, fits: 0, prefer: [], misses: [] }
  const f: CoachFit = { score: 0, style, coach, formation: inOrAny(cs.formations, formation) ? 25 : 5, tactic: 0, players: 0, fits: 0, prefer: cs.formations, misses: [] }
  for (const [name, opts, v] of [['mentality', cs.mentality, t.mentality], ['pressing', cs.pressing, t.pressing], ['passing', cs.passing, t.passing], ['width', cs.width, t.width]] as const) {
    if (inOrAny(opts as string[], v)) f.tactic += 10
    else f.misses!.push(name)
  }
  const ps = starters.filter(Boolean) as Player[]
  f.fits = ps.filter(p => cs.traits.some(tr => p.traits?.includes(tr))).length
  if (style === 'star_power') {
    const top = ps.map(p => p.overall).sort((a, b) => b - a).slice(0, 3)
    f.players = Math.round(Math.max(0, Math.min(35, ((top.reduce((a, b) => a + b, 0) / Math.max(1, top.length)) - 70) * 2.5)))
  } else f.players = Math.min(35, f.fits * 7)
  f.score = f.formation + f.tactic + f.players
  return f
}
