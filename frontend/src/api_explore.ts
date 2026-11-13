// API of the "explore" work stream: scouting missions, discoveries, achievements, trophy room, manager career.
import { careerPath, req } from './api'
import type { Player, Pos, StatLine } from './types'

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary'
export type AchTier = 'bronze' | 'silver' | 'gold' | 'platinum'

export interface Celebration {
  id: number; kind: 'cup' | 'cl' | 'league' | 'promotion' | 'feat' | 'ach'; key: string; season: number; day: number
  club: string; short: string; color: string; color2: string; league: string; division: number; compName: string
  opp?: string; score?: string; pens?: boolean; scorers?: string[]; points?: number; promoted?: boolean
  /** perfect season: the league games won (all of them), and every competitive game when all were won too */
  wins?: number; allWins?: number
}

/** CareerState.exploreView */
export interface ExploreBadge {
  count: number; unclaimed: number; reports: number; out: number; offers: number
  title: string; rep: number; tier: string; celebrate: Celebration[]
}

export interface Region { code: string; country: string; name: string; world: boolean; days: number; cost: number; clubs: number; visits: number; finds: number; home: boolean }
export interface ScoutInfo { id: number; name: string; skill: number; eye: boolean; busy: boolean }
export interface Mission {
  id: number; region: string; pos: string; focus: string; scoutId: number; scout: string; skill: number; eye: boolean
  season: number; day: number; days: number; left: number; cost: number; finds: number[] | null; best: string; seen: boolean
}
export interface Find {
  playerId: number; name: string; nation: string; pos: Pos; role: string; age: number; ovr: number; pot: number; dev: string; traits: string[] | null
  club: string; clubId: number; value: number; ask: number; rarity: Rarity; tags: string[] | null; region: string; mission: number
  season: number; day: number; star: boolean; signed: boolean; golden: boolean
  player: Player | null; nowClub: string; nowClubId: number
  /** a player who joined your club leaves the log, so there is no 'yours' */
  status: 'club' | 'free' | 'retired' | 'gone'
  /** matchdays before this unstarred report fades from the log (0 on the shortlist: it stays) */
  left: number
}
export interface AchView {
  key: string; group: string; tier: AchTier; hidden: boolean; stat: string; target: number; tp: number; money: number; title: boolean
  progress: number; got: boolean; claimed: boolean; season: number
}
export interface MatchRec { gf: number; ga: number; opp: string; club: string; season: number; comp: string }
export interface HaulRec { name: string; n: number; season: number }
export interface TrophyItem {
  kind: 'league' | 'cup' | 'cl' | 'promotion'; season: number; club: string; short?: string; color?: string; color2?: string
  league: string; division: number; opp?: string; score?: string; pens?: boolean; scorers?: string[]; points?: number
}
export interface SeasonLine { season: number; club: string; league: string; division: number; pos: number; points: number; cup: string; cl: string; move: string }
export interface HallItem { playerId: number; name: string; version: string; tag: string; position: Pos; apps: number; goals: number; rating: number }
export interface Stint { clubId: number; club: string; short: string; color: string; color2: string; league: string; division: number; from: number; to: number; closed: boolean; trophies: number }
export interface JobOffer { clubId: number; club: string; short: string; color: string; color2: string; league: string; division: number; reputation: number; budget: number; until: number; mid: boolean }
export interface FeedItem { key: string; name?: string; amount?: number; season: number; day: number; rarity?: string }

export interface ExploreFull {
  badge: ExploreBadge
  regions: Region[]
  scouts: ScoutInfo[]
  missions: Mission[]
  finds: Find[]
  /** ScoutFindDays: matchdays an unstarred report stays in the log */
  findDays: number
  focus: string[]
  achievements: AchView[]
  stats: Record<string, number>
  run: { season: number; streak: number; unbeaten: number; goals: number; clean: number }
  records: { bigWin: MatchRec | null; bigLoss: MatchRec | null; mostGoals: MatchRec | null; haul: HaulRec | null; bestOvr: HaulRec | null }
  trophies: TrophyItem[]
  seasons: SeasonLine[]
  scorers: StatLine[]
  apps: StatLine[]
  hall: HallItem[]
  manager: { rep: number; stints: Stint[] | null; offers: JobOffer[]; declined: number }
  tiers: { key: string; min: number }[]
  reach: number
  clubRep: number
  titles: string[]
  feed: FeedItem[]
  albumOwned: number
  albumTotal: number
  budget: number
  tp: number
  season: number
  day: number
}

export interface AlbumCard { name: string; version: string; pos: Pos; nation: string; ovr: number; owned: number }

const e = (id: number) => careerPath(id) + '/explore'

export const exploreApi = {
  get: (id: number) => req<ExploreFull>('GET', e(id)),
  album: (id: number) => req<{ cards: AlbumCard[]; owned: number }>('GET', e(id) + '/album'),
  mission: (id: number, body: { region: string; pos: string; focus: string; scoutId: number }) => req<Mission>('POST', e(id) + '/missions', body),
  seen: (id: number) => req('POST', e(id) + '/seen'),
  star: (id: number, pid: number) => req('POST', `${e(id)}/finds/${pid}/star`),
  claim: (id: number, key = '') => req<{ tp: number; money: number; titles: string[]; keys: string[] }>('POST', e(id) + '/claim', { key }),
  title: (id: number, key: string) => req('POST', e(id) + '/title', { key }),
  ackCelebration: (id: number, celebrationId: number) => req('POST', e(id) + '/celebrations/ack', { id: celebrationId }),
}

/** The explore part of the career state (safe when the field is missing). */
export function badgeOf(view: unknown): ExploreBadge | null {
  const b = view as ExploreBadge | null | undefined
  return b && typeof b === 'object' && 'count' in b ? b : null
}
