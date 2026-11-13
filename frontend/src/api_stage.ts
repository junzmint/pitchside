// API and types of the "stage" work stream: Golden Ball night, the summer international tournament,
// cup draw ceremonies and the world news feed (backend/game/stage*.go, world_ai.go).
import { careerPath, req } from './api'
import type { Player } from './types'

/** One line of world news. kind story | award | intl carry `story` and `params` for the headline text. */
export interface NewsItem {
  id: number; season: number; day: number
  kind: 'transfer' | 'sacked' | 'story' | 'award' | 'intl'
  story?: string; params?: Record<string, string | number | boolean>
  player?: string; playerId?: number; ovr?: number; age?: number
  from?: string; fromId?: number; to?: string; toId?: number; fee?: number; coach?: string
  league?: string; big?: boolean; mine?: boolean
  fromShort?: string; fromColor?: string; fromColor2?: string; toShort?: string; toColor?: string; toColor2?: string
}

export interface AwardPlayer {
  rank: number; player: Player
  clubId: number; club: string; short: string; color: string; color2: string; league: string; division: number
  pos: number; trophies: string[]
  apps: number; goals: number; assists: number; cs: number; rating: number; score: number; mine?: boolean
  /** keepers: the goals he let in, and a game as the Golden Glove counts them (watched and played matches at the
   *  quick sim's expected goals); older award nights have neither */
  conceded?: number; gaRate?: number
}

export interface AwardManager {
  rank: number; name: string; nation: string
  clubId: number; club: string; short: string; color: string; color2: string; league: string; division: number
  pos: number; expected: number; trophies: string[]; score: number; mine?: boolean
}

export interface AwardEffect {
  award: 'ball' | 'boy' | 'glove' | 'boot'; playerId: number; name: string
  valueBefore?: number; valueAfter?: number; ovrBefore?: number; ovrAfter?: number; morale: boolean; rep?: number; mine?: boolean
}

export interface AwardNight {
  season: number
  ball: AwardPlayer[]; boy: AwardPlayer[]; glove: AwardPlayer[]; boot: AwardPlayer[]
  managers: AwardManager[]; effects: AwardEffect[]; userClub: number; players: number
}

export interface IntlPlayer {
  id: number; name: string; nation: string; pos: string; role: string; age: number; ovr: number
  clubId: number; club: string; short: string; color: string; color2: string; tag?: string; mine?: boolean
  apps: number; goals: number; assists: number; rating: number; result?: string
}
export interface IntlTeam { nation: string; strength: number; group: string; pot: number; result: string; formation: string; squad: IntlPlayer[]; mine: number }
export interface IntlGoal { playerId: number; name: string; side: 0 | 1; assist?: string; mine?: boolean }
export interface IntlMatch { stage: string; round: number; home: string; away: string; hg: number; ag: number; et?: boolean; ph?: number; pa?: number; goals: IntlGoal[]; mine?: boolean }
export interface IntlRow { nation: string; p: number; w: number; d: number; l: number; gf: number; ga: number; pts: number }
export interface IntlBoost { playerId: number; name: string; nation: string; before: number; after: number; mine?: boolean }

export interface Tournament {
  season: number; kind: 'world' | 'euro'; edition: number
  teams: IntlTeam[]; groups: Record<string, IntlRow[]>; matches: IntlMatch[]
  champion: string; runnerUp: string; final: IntlMatch | null
  scorers: IntlPlayer[]; best: IntlPlayer | null; mine: IntlPlayer[]
  effects: { tired: number; fitMin: number; fitMax: number; moraleUp: number; moraleDown: number; boosted: IntlBoost[] }
  userClub: number
}

export interface DrawClub { id: number; name: string; short: string; color: string; color2: string; league: string; division: number; strength?: number; mine?: boolean }
export interface DrawView {
  id: number; season: number; day: number; comp: 'cup' | 'cl'; stage: string; league: string
  home: boolean; me: DrawClub; opp: DrawClub; pot: DrawClub[]; ties: { home: DrawClub; away: DrawClub }[]
}

export interface StagePending { ceremony: AwardNight | null; tournament: Tournament | null; draw: DrawView | null }

export interface IntlBrief { season: number; kind: 'world' | 'euro'; edition: number; champion: string; runnerUp: string; score: string; scorer: string; goals: number; mine: number }
export interface AwardsView { nights: AwardNight[]; next: { kind: '' | 'world' | 'euro'; season: number }; cups: IntlBrief[] }

const c = careerPath

export const stageApi = {
  pending: (id: number) => req<StagePending>('GET', `${c(id)}/stage/pending`),
  ack: (id: number, kind: 'ceremony' | 'tournament' | 'draw', ref: number) => req('POST', `${c(id)}/stage/ack`, { kind, id: ref }),
  awards: (id: number) => req<AwardsView>('GET', `${c(id)}/stage/awards`),
  night: (id: number, season: number) => req<AwardNight>('GET', `${c(id)}/stage/awards/${season}`),
  tournament: (id: number, season = 0) => req<Tournament>('GET', `${c(id)}/stage/tournament/${season}`),
  news: (id: number, limit = 120, kinds?: string[]) => req<NewsItem[]>('GET', `${c(id)}/news?limit=${limit}${kinds?.length ? `&kind=${kinds.join(',')}` : ''}`),
}

/** Fired on window when a stage pop-up has been seen (its headlines may now show in the feed). */
export const STAGE_SEEN_EVENT = 'pitchside:stage-seen'

/** Open Explore → News on one of its tabs (feed | awards | intl). */
export const STAGE_TAB_KEY = 'pitchside.stageTab'
export function openStage(go: (t: 'explore') => void, tab: 'feed' | 'awards' | 'intl') {
  try {
    sessionStorage.setItem('pitchside.exploreTab', 'news')
    sessionStorage.setItem(STAGE_TAB_KEY, tab)
  } catch { /* ignore */ }
  go('explore')
}
