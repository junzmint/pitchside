import type { CareerState, CareerSummary, Club, Chemistry, CompetitionsView, DayReport, DealQuote, FinanceView, HistoryView, LeagueInfo, MarketView, MatchSetup, Player, Quest, ScoutRow, StatsView, Tactic, TeamRating, User, AgeNote, Demand, CommercialView, ChanceCard } from './types'
import type { LegendMerge } from './legendVersions'

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message)
  }
}

let onUnauthorized: () => void = () => {}
export function setUnauthorizedHandler(fn: () => void) { onUnauthorized = fn }

export async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch('/api' + path, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let data: any = null
  try { data = await res.json() } catch { /* empty */ }
  if (res.status === 401 && !path.startsWith('/auth')) onUnauthorized()
  if (!res.ok) throw new ApiError(data?.code ?? 'server', data?.error ?? `HTTP ${res.status}`, res.status)
  return data as T
}

const c = (id: number) => `/careers/${id}`
/** A headline move of the summer transfer window (a world news item). */
export interface SummerMove { player?: string; ovr?: number; age?: number; from?: string; to?: string; fee?: number }
/** Career path prefix for API modules of other work streams (api_events.ts, api_explore.ts). */
export const careerPath = c

export const api = {
  me: () => req<User>('GET', '/auth/me'),
  login: (username: string, password: string) => req<User>('POST', '/auth/login', { username, password }),
  register: (username: string, password: string) => req<User>('POST', '/auth/register', { username, password }),
  logout: () => req('POST', '/auth/logout'),

  leagues: () => req<LeagueInfo[]>('GET', '/leagues'),
  careers: () => req<CareerSummary[]>('GET', '/careers'),
  newCareer: (body: { league: string; clubIndex: number; division?: number; custom?: { name: string; short: string; color: string; color2: string } }) =>
    req<{ id: number }>('POST', '/careers', body),
  deleteCareer: (id: number) => req('DELETE', c(id)),

  state: (id: number) => req<CareerState>('GET', c(id)),
  lineup: (id: number, formation: string, lineup: number[], tactic: Tactic) => req('PUT', c(id) + '/lineup', { formation, lineup, tactic }),
  training: (id: number, intensity: string, focus: Record<string, string>) => req('PUT', c(id) + '/training', { intensity, focus }),

  market: (id: number) => req<MarketView>('GET', c(id) + '/market'),
  buy: (id: number, pid: number) => req<{ player?: Player; merged?: LegendMerge } | null>('POST', `${c(id)}/players/${pid}/buy`),
  release: (id: number, pid: number) => req<{ received: number }>('POST', `${c(id)}/players/${pid}/release`),
  createTemplate: (id: number, body: object) => req('POST', c(id) + '/templates', body),
  deleteTemplate: (id: number, tid: number) => req('DELETE', `${c(id)}/templates/${tid}`),
  scout: (id: number, league: string, pos: string) => req<ScoutRow[]>('GET', `${c(id)}/scout?league=${league}&pos=${pos}`),
  quote: (id: number, body: object) => req<DealQuote>('POST', c(id) + '/deals/quote', body),
  deal: (id: number, body: object) => req<DealQuote & { accepted: boolean; merged?: LegendMerge }>('POST', c(id) + '/deals', body),
  hire: (id: number, cid: number) => req('POST', `${c(id)}/coaches/${cid}/hire`),
  fire: (id: number, cid: number) => req('POST', `${c(id)}/coaches/${cid}/fire`),

  competitions: (id: number, lite = false) => req<CompetitionsView>('GET', c(id) + '/competitions' + (lite ? '?lite=1' : '')),
  club: (id: number, club: number) => req<{ club: Club; players: Player[]; rating: TeamRating; chemistry: Chemistry; coach: string }>('GET', `${c(id)}/clubs/${club}`),
  stats: (id: number, season: number, comp: string) => req<StatsView>('GET', `${c(id)}/stats?season=${season}&comp=${comp}`),
  history: (id: number) => req<HistoryView>('GET', c(id) + '/history'),

  finance: (id: number) => req<FinanceView>('GET', c(id) + '/finance'),
  sponsor: (id: number, index: number) => req('POST', c(id) + '/sponsor', { index }),
  quests: (id: number) => req<Quest[]>('GET', c(id) + '/quests'),
  claim: (id: number, qid: number) => req<{ reward: number }>('POST', `${c(id)}/quests/${qid}/claim`),

  setCare: (id: number, pid: number, body: { load?: string; rush?: boolean }) => req('PUT', `${c(id)}/players/${pid}/care`, body),
  setRotation: (id: number, threshold: number) => req('PUT', c(id) + '/rotation', { threshold }),
  setAutoXi: (id: number, on: boolean) => req('PUT', c(id) + '/autoxi', { on }),
  upgradeFacility: (id: number, kind: string) => req('POST', `${c(id)}/facilities/${kind}`),
  setTicket: (id: number, price: string) => req('PUT', c(id) + '/ticket', { price }),
  takeLoan: (id: number, amount: number) => req('POST', c(id) + '/loan', { amount }),
  repayLoan: (id: number) => req('POST', c(id) + '/loan/repay'),
  buyTP: (id: number, n: number) => req('POST', c(id) + '/tp', { n }),
  revealTraits: (id: number, pid: number) => req<Player>('POST', `${c(id)}/players/${pid}/reveal`),
  upgradePlayer: (id: number, pid: number, what: string) => req<{ player: Player; tp: number }>('POST', `${c(id)}/players/${pid}/upgrade`, { what }),
  match: (id: number) => req<MatchSetup>('GET', c(id) + '/match'),
  play: (id: number, body: object) => req<DayReport>('POST', c(id) + '/play', body),
  friendly: (id: number, opponentId: number) => req('POST', c(id) + '/friendly', { opponentId }),
  newSeason: (id: number) => req<{ retired: string[] | null; aged: AgeNote[] | null; expired: string[] | null; regens: string[] | null; promoted?: string[] | null; transfers?: SummerMove[] | null }>('POST', c(id) + '/new-season'),
  pickIcon: (id: number, templateId: number) => req<(Player & { merged?: LegendMerge }) | null>('POST', c(id) + '/icon-pick', { templateId }),
  commercial: (id: number) => req<CommercialView>('GET', c(id) + '/commercial'),
  comAct: (id: number, body: { action: string; slot?: string; index?: number; offer?: number; choice?: string; amount?: number }) => req<{ card?: ChanceCard; ask?: number; outcome?: string }>('POST', c(id) + '/commercial', body),
  renew: (id: number, pid: number) => req('POST', `${c(id)}/players/${pid}/renew`),
  answerDemand: (id: number, body: { kind: string; id: number; action: 'accept' | 'offer' | 'refuse'; amount?: number; years?: number }) =>
    req<{ accepted: boolean; outcome: string; demand?: Demand }>('POST', c(id) + '/demands', body),
}

export const money = (v: number) => {
  const a = Math.abs(v)
  const s = a >= 1e6 ? (a / 1e6).toFixed(a >= 1e8 ? 0 : 1).replace(/\.0$/, '') + 'M' : a >= 1e3 ? Math.round(a / 1e3) + 'K' : String(a)
  return (v < 0 ? '−' : '') + '€' + s
}
