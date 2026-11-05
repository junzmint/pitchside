import type { Player } from './types'

// Legend versions (mirrors backend game/legend_versions.go):
// - a legend card is one era ("version") of a person; a modern player can be the same person (same name once
//   case, spacing and accents are ignored); custom designs are nobody but themselves;
// - one version of a person per match: the club version (his card from an era at this club) when he is fit,
//   otherwise the best-rated one;
// - signing a version while his modern self is at the club merges them (the answer carries `merged`).

/** The answer's note when a legend version and his modern self merged at your club. */
export interface LegendMerge {
  legend: Player
  name: string
  absorbed: string
  ovrBefore: number
  ovrAfter: number
  potBefore: number
  potAfter: number
  signed: 'legend' | 'modern'
}

const SPECIAL: Record<string, string> = { đ: 'd', ð: 'd', ø: 'o', ł: 'l', ı: 'i', ß: 'ss', æ: 'ae', œ: 'oe', þ: 'th' }

/** A name with case, spacing and accents ignored ("Vini  Juniór" → "vini junior"). */
export function foldName(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[đðøłıßæœþ]/g, c => SPECIAL[c] ?? c).replace(/\s+/g, ' ').trim()
}

/** Who a player is across versions, within a list of players: legend cards, and the modern players who are the
 *  same person as one of the cards in it ("" for everyone else). */
export function personKeys(players: Player[]): (p: Player | undefined) => string {
  const legends = new Set(players.filter(p => p.tag === 'legend').map(p => foldName(p.name)))
  return p => {
    if (!p || p.tag === 'custom') return ''
    const k = foldName(p.name)
    return legends.has(k) ? k : ''
  }
}

/** His card from an era at the club (clubName) he plays for: the card's label names that club ("Real Madrix '24");
 *  never the Icon card. Without a club name, the first club in his history stands in for it. */
export const isClubVersion = (p: Player, clubName?: string) =>
  p.tag === 'legend' && !!p.version && p.version !== 'Icon' && p.clubId != null &&
  (clubName ? p.version.startsWith(clubName + " '") : p.history?.[0] === p.clubId)

const fit = (p: Player) => p.injury === 0 || !!p.rushed

/** Of two versions of one person (at the club clubName), a is the one to play. */
export function betterVersion(a: Player, b: Player, clubName?: string): boolean {
  if (fit(a) !== fit(b)) return fit(a)
  if ((a.injury === 0) !== (b.injury === 0)) return a.injury === 0 // fully fit before rushed back
  const ha = isClubVersion(a, clubName), hb = isClubVersion(b, clubName)
  if (ha !== hb) return ha
  if (a.overall !== b.overall) return a.overall > b.overall
  return a.id < b.id
}

/** Keeps only the version that plays of each person; everyone else stays, in order. */
export function onePerPerson(players: Player[], keyOf = personKeys(players), clubName?: string): Player[] {
  const best = new Map<string, Player>()
  for (const p of players) {
    const k = keyOf(p)
    if (!k) continue
    const cur = best.get(k)
    if (!cur || betterVersion(p, cur, clubName)) best.set(k, p)
  }
  return players.filter(p => { const k = keyOf(p); return !k || best.get(k) === p })
}

/** Two versions of one person in a line-up (the server refuses it: err.legend_twice). */
export function twoVersions(ids: number[], byId: Map<number, Player>, keyOf: (p: Player | undefined) => string): boolean {
  const seen = new Map<string, number>()
  for (const id of ids) {
    const k = keyOf(byId.get(id))
    if (!k) continue
    const prev = seen.get(k)
    if (prev !== undefined && prev !== id) return true
    seen.set(k, id)
  }
  return false
}

/** Whom a player would merge with at your club if you signed him: a legend card with his modern self in your
 *  squad, a modern player with the version of him that plays (none for anyone else, or for borrowed players). */
export function mergesWith(p: Player, squad: Player[], borrowed: Set<number> = new Set(), clubName?: string): Player | undefined {
  if (p.tag === 'custom' || squad.some(x => x.id === p.id)) return undefined
  const k = foldName(p.name)
  const same = squad.filter(x => !borrowed.has(x.id) && foldName(x.name) === k)
  if (p.tag === 'legend') return same.filter(x => x.tag === '').sort((a, b) => b.overall - a.overall)[0]
  return same.filter(x => x.tag === 'legend').sort((a, b) => (betterVersion(a, b, clubName) ? -1 : 1))[0]
}

/** "Name (version)" of a legend card, the name of anyone else. */
export const versionLabel = (p: Player) => (p.tag === 'legend' && p.version ? `${p.name} (${p.version})` : p.name)
