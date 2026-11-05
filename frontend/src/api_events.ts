// API and types of the "events" work stream (club life).
import { careerPath, req } from './api'
import type { CareerState, Player } from './types'

export type Weather = 'clear' | 'rain' | 'snow' | 'heat'
export interface Talk { id: number; playerId: number; name: string; role: string; overall: number; benched: number; until: number }
export interface Promise_ { playerId: number; name: string; need: number; got: number; left: number }
export interface Bid { id: number; playerId: number; name: string; role: string; overall: number; value: number; clubId: number; club: string; fee: number; until: number; listed: boolean }
export interface Prospect { id: number; player: Player; est: number }
export interface YouthIntake { season: number; until: number; prospects: Prospect[] }
export interface LoanDeal { id: number; playerId: number; name: string; role: string; overall: number; clubId: number; club: string; season: number; fee: number; wage: number; years: number; appsAt: number }
export interface Award { season: number; day: number; kind: 'potm' | 'best' | 'scorer' | 'young' | 'tots'; playerId: number; name: string; club: string; clubId: number; pos: string; value: number; mine: boolean }
export interface PressConf { fixtureId: number; answer: string; opponent: string; result?: string; season: number; day: number }
export interface Happening { season: number; day: number; key: string; name?: string; amount?: number }
export interface ManagerPerks { bidBonus: number; counterBonus: number; loanDiscount: number; youthBonus: number }
export interface EventsView {
  level: number; xp: number; levelXp: number; nextXp: number; perks: ManagerPerks
  captain: number; captainName: string
  rival: { id: number; name: string; short: string; color: string; color2: string; division: number; city: boolean } | null
  today: { fixtureId: number; derby: boolean; weather: Weather; press: boolean; answer: string; auto?: boolean; opponent: string } | null
  weather: Record<string, Weather>; derbies: number[]
  talks: Talk[]; promises: Promise_[]; bids: Bid[]; youth: YouthIntake | null
  loansOut: LoanDeal[]; loansIn: LoanDeal[]; loanees: number[]; listed: number[]
  awards: Award[]; pressLog: PressConf[]; log: Happening[]; pressAuto?: '' | 'bold' | 'calm' | 'deflect'
  nextBreak: number; breakDays: number[]; youthDay: number; loanWindow: number; maxLoansOut: number; maxLoansIn: number
  waiting: number
}
export interface LoanCand { player: Player; club: string; clubId: number; league: string; fee: number }
export interface LoanMarket { players: LoanCand[]; budget: number; open: boolean; loansIn: number; loansOut: number; squad: number }
export interface EventResult { outcome?: string; amount?: number; loan?: LoanDeal }

export type EventReq =
  | { action: 'press'; choice: 'bold' | 'calm' | 'deflect' }
  | { action: 'press_auto'; choice: '' | 'bold' | 'calm' | 'deflect' }
  | { action: 'talk'; id: number; choice: 'promise' | 'wait' | 'sell' }
  | { action: 'youth'; id: number; choice: 'sign' | 'release' }
  | { action: 'bid'; id: number; choice: 'accept' | 'reject' | 'counter' }
  | { action: 'loan_out' | 'loan_in' | 'captain'; playerId: number }

export const eventsApi = {
  act: (id: number, body: EventReq) => req<EventResult>('POST', careerPath(id) + '/events', body),
  loans: (id: number) => req<LoanMarket>('GET', careerPath(id) + '/events/loans'),
}

/** The events part of the career state (null on an old save before the first load). */
export function eventsOf(st: CareerState): EventsView | null {
  return (st.eventsView as EventsView | null | undefined) ?? null
}

export const WEATHER_ICON: Record<Weather, string> = { clear: '☀', rain: '🌧', snow: '❄', heat: '🔥' }
