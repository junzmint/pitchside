import { careerPath, req } from './api'
import type { MatchSetup } from './types'

// API of the modes work stream (backend/routes_play.go): quick-match teams and setups, training rewards.

export interface PlayTeam {
  key: string // "EN:0" = league club, "L:EN:1" = Legends XI
  league: string
  division: number
  name: string
  short: string
  color: string
  color2: string
  strength: number
  formation: string
  stars: string[] | null
  legends: boolean
  kits?: import('./match/engine').KitSet
}
export interface PlayLeague { code: string; name: string; country: string; divisions: { division: number; name: string; teams: PlayTeam[] }[] }
export interface PlayTeams { leagues: PlayLeague[]; legends: PlayTeam[] }

export interface QuickReq { home: string; away: string; knockout?: boolean; weather?: 'clear' | 'rain' | 'snow' | 'random' }

/** Training ground reward state of a career: whether today's gold bonus is still there. */
export interface DrillReward { available: boolean; season: number; day: number; tp: number; reward: number; nextIn?: number }

let teamsCache: Promise<PlayTeams> | null = null

export const playApi = {
  teams: () => (teamsCache ??= req<PlayTeams>('GET', '/play/teams').catch(e => { teamsCache = null; throw e })),
  quick: (body: QuickReq) => req<MatchSetup>('POST', '/play/quick', body),
  drillReward: (careerId: number) => req<DrillReward>('GET', careerPath(careerId) + '/play/drill'),
  claimDrill: (careerId: number, drill: string, score: number) =>
    req<DrillReward & { granted: boolean }>('POST', careerPath(careerId) + '/play/drill', { drill, score }),
}
