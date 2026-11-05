import type { Tactic } from '../types'

/**
 * How a team's AI plays: every knob the team AI reads lives here, so a coach philosophy, a difficulty
 * preset or an arcade "opponent style" only has to produce one of these objects.
 * The base comes from the club's tactic; `coachStyle` (setup.<side>.coachFit.style) nudges it.
 * Wave-2 hook: tune or extend PHILOSOPHY below (tiki_taka, gegenpress, counter, catenaccio, wing_play,
 * star_power, …) or pass a fully custom style to `new Engine(..., { styles: [a, b] })`.
 */
export interface TeamStyle {
  id: string
  tempo: number // decision speed multiplier (>1 = quicker decisions)
  pressMen: number // extra (or fewer) players pressing the ball
  pressHeight: number // metres the out-of-possession block moves up (+) or drops (-)
  lineHeight: number // metres the back line steps up (+) or drops (-)
  shortPass: number // 0..1 love of short passing (tiki-taka triangles, one-touch)
  direct: number // 0..1 love of forward / long balls
  cross: number // 0..1 willingness to cross from wide areas
  dribble: number // bonus for taking players on
  longShot: number // bonus for shooting from distance
  width: number // width multiplier in possession
  runs: number // forward-run frequency multiplier
  firstTime: number // 0..1 chance of a first-time pass when pressed
  counter: number // 0..1 urge to go forward fast right after winning the ball
  star: number // 0..1 bias to feed the best player
  tackle: number // tackle eagerness multiplier
}

const PHILOSOPHY: Record<string, Partial<TeamStyle>> = {
  tiki_taka: { shortPass: 0.95, direct: 0.15, firstTime: 0.55, tempo: 1.15, runs: 0.9, dribble: -0.05 },
  gegenpress: { pressMen: 2, pressHeight: 8, lineHeight: 5, tempo: 1.1, counter: 0.6, tackle: 1.25 },
  counter: { direct: 0.85, counter: 0.9, lineHeight: -6, pressHeight: -6, runs: 1.3 },
  catenaccio: { lineHeight: -10, pressHeight: -8, pressMen: -1, runs: 0.7, direct: 0.6, tackle: 1.1 },
  wing_play: { cross: 0.9, width: 1.15, runs: 1.15 },
  star_power: { star: 0.7, dribble: 0.15, longShot: 0.1 },
}

export function styleFor(tac: Tactic, coachStyle?: string): TeamStyle {
  const s: TeamStyle = {
    id: coachStyle ?? '',
    tempo: 1,
    pressMen: tac.pressing === 'high' ? 1 : tac.pressing === 'low' ? -1 : 0,
    pressHeight: tac.pressing === 'high' ? 6 : tac.pressing === 'low' ? -6 : 0,
    lineHeight: tac.mentality === 'attacking' ? 3 : tac.mentality === 'defensive' ? -4 : 0,
    shortPass: tac.passing === 'short' ? 0.8 : tac.passing === 'direct' ? 0.2 : 0.5,
    direct: tac.passing === 'direct' ? 0.8 : tac.passing === 'short' ? 0.2 : 0.5,
    cross: tac.width === 'wide' ? 0.7 : tac.width === 'narrow' ? 0.3 : 0.5,
    dribble: 0,
    longShot: tac.mentality === 'attacking' ? 0.08 : 0,
    width: tac.width === 'wide' ? 1.13 : tac.width === 'narrow' ? 0.85 : 1,
    runs: tac.mentality === 'attacking' ? 1.2 : tac.mentality === 'defensive' ? 0.8 : 1,
    firstTime: tac.passing === 'short' ? 0.35 : 0.2,
    counter: tac.passing === 'direct' ? 0.5 : 0.3,
    star: 0,
    tackle: tac.pressing === 'high' ? 1.1 : 1,
  }
  const ph = coachStyle ? PHILOSOPHY[coachStyle] : undefined
  if (ph) {
    // a philosophy pulls halfway towards its own values (the club's tactic still matters)
    for (const k of Object.keys(ph) as (keyof TeamStyle)[]) {
      const v = ph[k]
      if (typeof v === 'number' && typeof s[k] === 'number') (s[k] as number) = ((s[k] as number) + v) / 2 + (k === 'pressMen' ? v / 2 : 0)
    }
  }
  return s
}

// ------------------------------------------------------------------------------------------------ readable styles
/** The headline of a team's play style (shown before kick-off and in the pause menu). */
export type StyleKey = 'tiki' | 'press' | 'counter' | 'direct' | 'wing' | 'bus' | 'star' | 'balanced'

export function styleKey(s: TeamStyle, tac: Tactic): StyleKey {
  const cand: [StyleKey, number][] = [
    ['tiki', (s.shortPass - 0.62) * 4 + (s.id === 'tiki_taka' ? 1 : 0)],
    ['press', (s.pressHeight - 3) / 3 + s.pressMen * 0.35 + (s.id === 'gegenpress' ? 1 : 0)],
    ['counter', (s.counter - 0.45) * 3 + (s.id === 'counter' ? 1 : 0) + (tac.mentality === 'defensive' ? 0.25 : 0)],
    ['direct', (s.direct - 0.6) * 3],
    ['wing', (s.cross - 0.62) * 3 + (s.id === 'wing_play' ? 1 : 0)],
    ['bus', (-s.lineHeight - 6) / 3 + (s.id === 'catenaccio' ? 1 : 0)],
    ['star', s.star * 1.6 + (s.id === 'star_power' ? 0.4 : 0)],
  ]
  let best: [StyleKey, number] = ['balanced', 0.3]
  for (const c of cand) if (c[1] > best[1]) best = c
  return best[0]
}

/** Two or three plain-word traits, most telling first (keys of lv.trait.*). */
export function styleTraits(s: TeamStyle, tac: Tactic): string[] {
  const t: [string, number][] = [
    ['short', s.shortPass - 0.6],
    ['long', s.direct - 0.6],
    ['cross', s.cross - 0.62],
    ['press', (s.pressHeight - 3) / 8 + s.pressMen * 0.1],
    ['deep', (-s.lineHeight - 3) / 10],
    ['highLine', (s.lineHeight - 2) / 8],
    ['fast', s.counter - 0.5],
    ['shots', s.longShot * 3],
    ['runs', (s.runs - 1.05) * 1.5],
    ['dribble', s.dribble * 3],
    ['star', s.star - 0.25],
  ]
  if (tac.mentality === 'attacking') t.push(['attack', 0.12])
  const same: Record<StyleKey, string> = { tiki: 'short', press: 'press', counter: 'fast', direct: 'long', wing: 'cross', bus: 'deep', star: 'star', balanced: '' }
  const head = same[styleKey(s, tac)]
  const out = t.filter(x => x[1] > 0.05 && x[0] !== head).sort((a, b) => b[1] - a[1]).map(x => x[0])
  // never "high press" and "sits deep", or "short passes" and "long balls", in one breath
  const clash: [string, string][] = [['press', 'deep'], ['highLine', 'deep'], ['short', 'long'], ['attack', 'deep']]
  const pressing = head === 'press' || out.includes('press'), deepHead = head === 'deep'
  const kept: string[] = []
  for (const k of out) {
    if (clash.some(([a, b]) => (k === b && (kept.includes(a) || (a === 'press' && pressing) || head === a)) || (k === a && (kept.includes(b) || head === b)))) continue
    if (k === 'deep' && pressing) continue
    if (deepHead && (k === 'press' || k === 'highLine')) continue
    kept.push(k)
    if (kept.length === 3) break
  }
  return kept
}

/** "Plays tiki-taka: short passes, high press" */
export function styleLine(t: (k: string) => string, s: TeamStyle, tac: Tactic): string {
  const traits = styleTraits(s, tac)
  return t('lv.style.' + styleKey(s, tac)) + (traits.length ? ': ' + traits.map(k => t('lv.trait.' + k)).join(', ') : '')
}
