import type { PStat, Side } from './engine'

// Player ratings for the post-match screen, from what each player actually did in the live match.
// A 5-minute match has few events per player, so the weights are generous: a goal is worth about a point,
// a clean sheet or a win lifts the whole side, cards and loose passes pull a player down.

export interface Rated extends PStat { rating: number; mins: number }

const DEF = new Set(['CB', 'LB', 'RB', 'LWB', 'RWB'])

export function rateMatch(ps: PStat[], score: [number, number], endMinute: number): Rated[] {
  const out: Rated[] = []
  for (const r of ps) {
    const team = r.team as Side
    const opp = team === 0 ? 1 : 0
    const end = r.outMin ?? endMinute
    const mins = Math.max(0, end - r.inMin)
    const share = Math.min(1, Math.max(0.15, mins / 90))
    let v = 6.2
    v += r.g * 0.95 + Math.max(0, r.g - 1) * 0.2
    v += r.a * 0.7
    v += r.ot * 0.18 + Math.max(0, r.sh - r.ot) * 0.03
    v += r.pk * 0.035 - Math.max(0, r.ps - r.pk) * 0.07
    v += r.tk * 0.22 + r.int * 0.14 + r.sk * 0.06
    v += r.sv * 0.4
    v -= r.fo * 0.08 + r.y * 0.35 + r.r * 1.6
    const conceded = score[opp]
    if (r.gk) v += conceded === 0 ? 0.6 : -conceded * 0.3
    else if (DEF.has(r.pos)) v += conceded === 0 ? 0.3 : -conceded * 0.15
    const diff = score[team] - score[opp]
    v += diff > 0 ? 0.35 : diff < 0 ? -0.3 : 0
    // a few minutes off the bench stay close to the average; the very top is hard to reach
    v = 6.2 + (v - 6.2) * (0.55 + 0.45 * share)
    if (v > 8.4) v = 8.4 + (v - 8.4) * 0.55
    out.push({ ...r, mins, rating: Math.round(Math.max(3, Math.min(10, v)) * 10) / 10 })
  }
  return out
}

/** Man of the match: the best rating, the winning side breaking ties (and nudged a little). */
export function manOfTheMatch(rated: Rated[], score: [number, number]): Rated | null {
  let best: Rated | null = null, bs = -1
  const win: Side | -1 = score[0] > score[1] ? 0 : score[1] > score[0] ? 1 : -1
  for (const r of rated) {
    if (r.mins < 10 && r.g === 0) continue
    const s = r.rating + (r.team === win ? 0.25 : 0) + r.g * 0.05
    if (s > bs) { bs = s; best = r }
  }
  return best
}

export function ratingTone(v: number): 'top' | 'good' | 'ok' | 'poor' {
  return v >= 8 ? 'top' : v >= 7 ? 'good' : v >= 6 ? 'ok' : 'poor'
}
