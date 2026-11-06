// API and types of the "staff" work stream: the staff room (backend/game/staff_*.go).
import { careerPath, req } from './api'
import type { IconName } from './icons'
import type { CareerState, Demand, Player } from './types'

export type StaffTrait = 'loyal' | 'ambitious' | 'teacher' | 'fiery' | 'calm'
export type Fit = 'full' | 'good' | 'half'

export interface MenteeView { playerId: number; name: string; position: string; role: string; age: number; overall: number; potential: number; boost: number; fit: Fit }
export interface StaffCard {
  id: number; name: string; nation: string; role: string; style?: string
  skill: number; mood: number; ceil: number; perks: string[]; age: number; trait: StaffTrait
  morale: number; xp: number; xpNeed: number; ends: number; wage: number; market: number
  seasons: number; since: number; leaving: boolean; retiring: boolean; levelUp: boolean
  bonusIn: number; bonusCost: number; slots: number; mentees: MenteeView[]; famous: boolean; quitRisk: boolean
  /** at or past his ceiling: each point takes three times the experience */
  pastPeak: boolean
  /** advanced course: open, done this season, or "" when it would not help */
  course: '' | 'open' | 'done'; courseCost: number; courseCeil: number
}
export interface CandidateView {
  id: number; name: string; nation: string; role: string; style?: string; skill: number; ceil: number; perks: string[]
  age: number; trait: StaffTrait; price: number; wage: number; famous: boolean; slots: number
}
export interface RoleSlot { role: string; group: 'coaching' | 'medical'; coach: StaffCard | null; candidates: CandidateView[] }

/** One effect of a choice (see StaffFx in staff_decisions.go). */
export interface StaffFx { k: string; id?: number; name?: string; v?: number; pos?: string; days?: number; to?: number; str?: string }
export interface StaffChoice { key: string; fx: StaffFx[]; chance?: number; fail?: StaffFx[] }
export interface StaffClubTag { id: number; name: string; short: string; color: string; color2: string; rep: number }
export type DecisionKind = 'renew' | 'retire' | 'poach' | 'clash' | 'camp' | 'signing' | 'prospect' | 'famous'
export interface StaffDecision {
  id: number; kind: DecisionKind; topic?: string
  coachId: number; coach: string; role: string; otherId?: number; other?: string; otherRole?: string
  playerId?: number; player?: string; club?: StaffClubTag
  amount?: number; wage?: number; value?: string; nums?: Record<string, number>
  choices: StaffChoice[]; default: string; until: number; left: number
}
export interface StaffVerdict { key: string; tip: string; season: number; day: number; comp: string; opp: string; gf: number; ga: number; coach: string; coachId: number; best?: string; bestScore?: number }
export interface ReportLine { id: number; name: string; position: string; v: number; n: number; age?: number }
export interface StaffReport { verdict: StaffVerdict | null; style?: string; inForm: ReportLine[]; rest: ReportLine[]; minutes: ReportLine[]; improved: ReportLine[]; since: number }
export interface YoungView { id: number; name: string; position: string; role: string; age: number; overall: number; potential: number; mentor: number; boosts: Record<string, number>; starter: boolean }
export interface PromiseView { kind: 'signing' | 'minutes'; coach: string; player?: string; pos?: string; need?: number; got?: number; left: number }
export interface BoostView { key: string; pos?: string; player?: string; v: number; left: number }
export interface StaffLog { season: number; day: number; key: string; name?: string; amount?: number }
export interface StaffRoomView {
  season: number; day: number; tick: number; offseason: boolean; budget: number; wages: number; filled: number
  slots: RoleSlot[]; decisions: StaffDecision[]; raises: Demand[]; report: StaffReport; youngsters: YoungView[]
  promises: PromiseView[]; boosts: BoostView[]; log: StaffLog[]; ready: boolean
}
export interface StaffResult { outcome: string; name?: string; other?: string; amount?: number; chance?: number; success?: boolean; ceil?: number }
export type StaffReq =
  | { action: 'decide'; id: number; choice: string }
  | { action: 'mentor'; coachId: number; playerId: number }
  | { action: 'unmentor'; playerId: number }
  | { action: 'hire'; coachId: number; years: number }
  | { action: 'fire' | 'bonus' | 'course'; coachId: number }

export const staffApi = {
  room: (id: number) => req<StaffRoomView>('GET', careerPath(id) + '/staff'),
  act: (id: number, body: StaffReq) => req<StaffResult>('POST', careerPath(id) + '/staff', body),
}

/** The open cards, carried on the career state (CareerState.staffView) for badges and the inbox. */
export interface StaffBadge { waiting: number; urgent: number; decisions: StaffDecision[] | null }
export function staffOf(st: CareerState): StaffBadge | null {
  return (st as CareerState & { staffView?: StaffBadge | null }).staffView ?? null
}
/** Staff cards waiting for an answer (the inbox count). */
export function staffCount(st: CareerState): number {
  return st.career.ended ? 0 : (staffOf(st)?.waiting ?? 0)
}
/** Coach wage demands (contracts.go): answered in the inbox, shown in the staff room too. */
export function coachRaises(st: CareerState): Demand[] {
  return (st.career.contracts?.demands ?? []).filter(d => d.kind === 'coach')
}
/** Everything the staff room is waiting on (the Team menu badge). */
export function staffWaiting(st: CareerState): number {
  return st.career.ended ? 0 : staffCount(st) + coachRaises(st).length
}

/** A player's mentor, when a coach mentors him (Player.mentor, set by the staff room). */
export interface MentorTag { coachId: number; coach: string; role: string; boost: number }
export function mentorOf(p: Player): MentorTag | null {
  return (p as Player & { mentor?: MentorTag | null }).mentor ?? null
}

const ROLE_ICON: Record<string, IconName> = {
  head: 'head', attack: 'attack', defense: 'defense', fitness: 'fitness', goalkeeping: 'goalkeeping', physio: 'physio', scout: 'scout', doctor: 'medical',
}
export function roleIcon(role: string): IconName { return ROLE_ICON[role] ?? 'staff' }

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

/** Morale band 1..5 (5: delighted … 1: wants out). */
export function moodBand(m: number) {
  return m >= 80 ? 5 : m >= 60 ? 4 : m >= 40 ? 3 : m > 25 ? 2 : 1
}
export const MOOD_FACE = ['', '😠', '😟', '😐', '🙂', '😄']
