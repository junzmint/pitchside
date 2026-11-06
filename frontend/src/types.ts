export type Pos = 'GK' | 'DF' | 'MF' | 'FW'
export type Attr = 'pace' | 'shooting' | 'passing' | 'dribbling' | 'defending' | 'physical' | 'goalkeeping'
export type Comp = 'league' | 'cup' | 'cl' | 'friendly'

export interface Player {
  id: number
  clubId: number | null
  templateId: number | null
  name: string
  nation: string
  age: number
  position: Pos
  pace: number
  shooting: number
  passing: number
  dribbling: number
  defending: number
  physical: number
  goalkeeping: number
  potential: number
  fitness: number
  morale: number
  focus: Attr | 'balanced'
  injury: number
  unrest: number
  traits: string[] | null
  traitsKnown: boolean
  hiddenTraits: number
  tenure: number
  history: number[]
  shirt: number
  retired: boolean
  tag: '' | 'legend' | 'custom'
  role: string
  version: string
  overall: number
  value: number
  wage: number
  load?: '' | 'rest' | 'recovery' | 'intense'
  rushed?: boolean
  /** medical stream: the kind of his injury (what the club doctor diagnosed) */
  injKind?: string
  market?: number
  contract?: number
  dev?: '' | 'flop' | 'slow' | 'normal' | 'fast' | 'wonder'
  price?: number
  /** 0..0.3 of lost match sharpness after an injury */
  rust?: number
  /** recent signing: the most other clubs pay for him, and for how many more matchdays */
  resaleCap?: number
  resaleLeft?: number
  /** he broke his limit with TP this season (once a season) */
  brokeLimit?: boolean
  /** appearances for your club this season (all competitions) */
  apps?: number
}

export interface Tactic {
  mentality: 'defensive' | 'balanced' | 'attacking'
  pressing: 'low' | 'mid' | 'high'
  passing: 'short' | 'mixed' | 'direct'
  width: 'narrow' | 'normal' | 'wide'
}

export interface Club {
  id: number
  league: string
  name: string
  short: string
  color: string
  color2: string
  isUser: boolean
  budget: number
  reputation: number
  formation: string
  tactic: Tactic
  lineup: number[]
  formWeeks: number
  division: number
  stadium: number
  trainLvl: number
  academy: number
  medical: number
  deals: number
  /** home, away and third kits (career view and match setup) */
  kits?: import('./match/engine').KitSet
}

export interface Coach {
  id: number
  clubId: number | null
  name: string
  nation: string
  role: 'head' | 'attack' | 'defense' | 'fitness' | 'goalkeeping' | 'physio' | 'doctor' | 'scout'
  style: string
  skill: number
  price: number
  wage: number
  market?: number
  perks?: string[]
}

export interface TeamRating { attack: number; midfield: number; defense: number; overall: number }
export interface SlotChem { chem: number; fit: number; links: number; together: number; styleFit?: boolean }
export interface CoachFit { score: number; style: string; coach: string; formation: number; tactic: number; players: number; fits: number; prefer: string[] | null; misses: string[] | null }
export interface Chemistry { team: number; familiarity: number; slots: SlotChem[] }

export interface FixtureView {
  id: number
  day: number
  comp: Comp
  league: string
  stage: string
  homeId: number
  awayId: number
  home: string
  away: string
  homeShort: string
  awayShort: string
  homeColor: string
  awayColor: string
  homeColor2?: string
  awayColor2?: string
  homeGoals: number | null
  awayGoals: number | null
  pensHome: boolean | null
  /** knockout ties: went to extra time; shoot-out kicks scored (null when there was none) */
  extraTime?: boolean
  pensH?: number | null
  pensA?: number | null
  played: boolean
  isUser: boolean
  season?: number
}

export interface TableRow {
  clubId: number; name: string; short: string; color: string
  p: number; w: number; d: number; l: number; gf: number; ga: number; pts: number; isUser: boolean
}

export interface CalDay { comp: Comp; stage: string; round: number }

export interface Loan { amount: number; weekly: number; weeksLeft: number }

export interface Sponsor {
  name: string; kind: 'safe' | 'balanced' | 'performance'
  weekly: number; winBonus: number; goalBonus: number; signing: number; seasonsLeft: number
}

export interface CareerState {
  alerts?: Alert[]
  eventsView?: unknown
  exploreView?: unknown
  hotBonus: HotBonus | null
  career: { id: number; userClubId: number; league: string; season: number; day: number; training: { intensity: 'light' | 'normal' | 'hard' }; sponsor: Sponsor | null; streak: number; tp: number; ticket: string; loan: Loan | null; ended: string; care: Care; contracts: { demands: Demand[] | null }; iconPick: IconPick | null; commercial: { offers: ComOffer[] | null; pending: ChanceCard | null; board: BoardGoal | null; takeover: Takeover | null; sponsors: Record<string, SponsorDeal> | null } }

  leagueName: string
  division: number
  promote: number
  divisions: number
  clSpots: number
  club: Club
  squad: Player[]
  coaches: Coach[] | null
  table: TableRow[]
  today: { day: number; comp: Comp | 'offseason'; stage: string; round: number; friendliesLeft: number; fixture: FixtureView | null } | null
  recent: FixtureView[] | null
  rating: TeamRating
  chemistry: Chemistry
  coachFit: CoachFit
  weeklyWages: number
  seasonDays: number
  claimable: number
  formations: Record<string, string[]>
}

export interface SideSetup {
  club: Club
  starters: Player[]
  roles: string[]
  bench: Player[]
  headCoach: number
  rating: TeamRating
  chemistry: Chemistry
  coachFit: CoachFit
  rotated: SwapNote[] | null
  congested: boolean
  perks?: string[]
  /** squad players who cannot play today (injured, not cleared to play), longest out first; the pre-match team sheet shows them */
  unavailable?: Player[]
}

export interface SwapNote { out: string; in: string; outFit: number; inFit: number; minute?: number }
export interface Demand { kind: 'player' | 'coach'; id: number; name: string; role: string; current: number; ask: number; until: number; tries: number; reason: 'improved' | 'star' | 'senior' | 'coach' | 'renewal'; easy?: boolean; renewal?: boolean }
export interface IconOption { templateId: number; name: string; position: Pos; overall: number; version: string; price: number; home: boolean }
export interface IconPick { season: number; day: number; until: number; done: boolean; options: IconOption[] | null }
export interface SponsorDeal { name: string; kind: 'safe' | 'balanced' | 'performance'; slot: string; weekly: number; winBonus: number; goalBonus: number; signing: number; seasonsLeft: number; target: string; targetBonus: number; minPos: number; exit: number; strikes: number }
export interface ComOffer { id: number; slot: string; sponsor: SponsorDeal; until: number }
export interface ChanceCard { key: string; deck: 'chance' | 'chest'; amount: number; choice: boolean; until?: number; result?: string; net: number; season: number; day: number }
export interface BoardGoal { season: number; goal: string; reward: number; fine: number; result?: string }
export interface Takeover { investor: string; amount: number; goal: string; deadline: number; status: string; until: number }
export interface CommercialView { slots: { slot: string; sponsor: SponsorDeal | null; offers: SponsorDeal[] | null }[]; offers: ComOffer[]; pending: ChanceCard | null; log: ChanceCard[]; board: BoardGoal | null; takeover: Takeover | null; merch: number; position: number; expected: number }
export interface HotBonus { kind: string; amount: number; brand: string }
export interface ComEvent { key: string; name?: string; amount?: number }
export interface SharesInfo { sold: number; raised: number; valuation: number; sellPrice: number; ask: number; fair: number; tries: number; dividend: number }
export interface LoanOption { amount: number; weeks: number; rate: number; weekly: number; total: number }
export interface AgeNote { name: string; age: number; before: number; after: number }
export interface Care { load: Record<string, string> | null; rush: Record<string, boolean> | null; rotate: number; autoXi?: boolean }

export interface MatchSetup { fixture: FixtureView; home: SideSetup; away: SideSetup; userIsHome: boolean; knockout: boolean
  /** events stream: clear | rain | snow | heat, stable per fixture */
  weather?: 'clear' | 'rain' | 'snow' | 'heat'
  /** events stream: the user's derby against the club's fixed rival */
  derby?: boolean }

export interface DayReport {
  alerts?: Alert[]
  day: number
  comp: Comp
  stage: string
  fixture: FixtureView | null
  events: { playerId: number; name: string; clubId: number; assistId: number; assist: string }[] | null
  stats: { possHome: number; shotsHome: number; shotsAway: number }
  ratings: { playerId: number; name: string; rating: number }[] | null
  others: FixtureView[] | null
  injuries: { name: string; weeks: number; playerId?: number; kind?: string; tier?: number }[] | null
  changes: { playerId: number; name: string; before: number; after: number; played?: boolean }[] | null
  money: { kind: string; amount: number }[] | null
  budget: number
  quests: string[] | null
  unrest: string[] | null
  tp: number
  youth: string
  departures: { name: string; club: string; fee: number }[] | null
  gameOver?: boolean
  subs: SwapNote[] | null
  rotated: SwapNote[] | null
  congested: boolean
  demands: string[] | null
  refusals: string[] | null
  iconPick?: boolean
  card?: ChanceCard | null
  commercial?: ComEvent[] | null
  /** events stream: press, squad life, awards, loans, bids … (render with t('ev.' + key, { name, v: money(|amount|), n: amount })) */
  happenings?: ComEvent[] | null
  /** explore stream: scouting reports, finds, achievements, job offers, golden events (render with feedText(t, e) from pages/Explore) */
  discoveries?: ComEvent[] | null
  seasonEnd?: { season: number; division: number; move: '' | 'up' | 'down'; position: number; cup: string; cl: string; prize: number; champions: Record<string, string>; qualified: boolean }
  /** club stream: the fans after today (the "Fans: 😊 72 (+4)" line also arrives in happenings); voice text via voiceText() in pages/club/FanBits */
  fans?: { mood: number; delta: number; band: number; gate?: number; voice: { style: 'chant' | 'banner' | 'post'; key: string; name?: string; n?: number; seed: number }; notes: { key: string; v: number; name?: string; n?: number }[] | null }
}

export interface Template {
  id: number; kind: 'custom' | 'legend'; name: string; nation: string; age: number; position: Pos
  pace: number; shooting: number; passing: number; dribbling: number; defending: number; physical: number; goalkeeping: number
  potential: number; signed: boolean; overall: number; value: number; onMarket: boolean
  version: string; clubId: number | null; clubName: string
  /** where the card plays: a legend version's role in his era ("RW", "ST"…), anyone else's from his numbers */
  role: string
}

export interface MarketView { players: Player[]; coaches: Coach[]; templates: Template[]; legends: Template[]; budget: number; squad: number }

export interface ScoutRow { player: Player; club: string; clubId: number; league: string; starter: boolean }

export interface DealQuote { chance: number; fee: number; value: number; factors: string[]; blocked?: string }

export interface CompetitionsView {
  season: number
  day: number
  calendar: CalDay[]
  league: string
  division: number
  promote: number
  clSpots: number
  leagues: { code: string; country: string; division: number; name: string; table: TableRow[] }[]
  fixtures: FixtureView[]
  groups: Record<string, TableRow[]>
  userInCl: boolean
}

export interface StatLine {
  playerId: number; name: string; position: Pos; club: string; clubId: number
  apps: number; goals: number; assists: number; rating: number; cs: number; retired: boolean
}
export interface StatsView { season: number; comp: string; goals: StatLine[]; assists: StatLine[]; ratings: StatLine[]; squad: StatLine[] }

export interface SeasonRecord {
  season: number; clubName: string; leaguePos: number; points: number; cup: string; cl: string; prize: number
  summary: { division?: number; league?: string; move?: string; champions?: Record<string, string>; topScorer?: string; topScorerGoals?: number; bestPlayer?: string; bestRating?: number }
}
export interface Legend extends StatLine { tier: 'legend' | 'icon'; reasons: string[] }
export interface HistoryView {
  seasons: SeasonRecord[]
  matches: FixtureView[]
  scorers: StatLine[]
  apps: StatLine[]
  legends: Legend[]
  totals: Record<string, number>
}

export interface FinanceView {
  loanOptions: LoanOption[] | null
  shares: SharesInfo | null
  budget: number
  sponsor: Sponsor | null
  offers: Sponsor[] | null
  totals: Record<string, number>
  entries: { day: number; kind: string; amount: number }[]
  wages: number
  staff: number
  facilities: { kind: 'stadium' | 'training' | 'academy' | 'medical'; level: number; max: number; next: number; wear: number; renew?: number; until?: number }[]
  upkeep: number
  ticket: 'low' | 'normal' | 'high'
  loan: Loan | null
  loanAmounts: number[]
  loanWeeks: number
  tp: number
  tpPrice: number
  tpBuyLeft: number
  tpBuyMax: number
}

export interface Quest { id: number; kind: string; target: number; progress: number; reward: number; status: 'active' | 'done' | 'claimed' }

export interface LeagueInfo {
  world: boolean; code: string; name: string; country: string
  divisions: { division: number; name: string; clubs: LeagueInfo['clubs'] }[]
  clubs: { index: number; name: string; short: string; color: string; color2: string; strength: number; budget: number; formation: string; coach: string; stars: string[] | null }[]
}

export interface CareerSummary {
  id: number; league: string; season: number; day: number; clubName: string; short: string; color: string; color2: string; budget: number; updatedAt: string
  ended: string
}

export interface User { id: number; username: string }

/** Something that needs the manager (backend alerts.go). */
export interface Alert {
  key: string
  level: 'bad' | 'warn' | 'info'
  kind?: 'player' | 'coach'
  id?: number
  name?: string
  role?: string
  n?: number
  amount?: number
  names?: string[]
  action: 'bonus' | 'renew' | 'talks' | 'staff' | 'medical' | 'squad' | 'finance'
  ready?: boolean
}
