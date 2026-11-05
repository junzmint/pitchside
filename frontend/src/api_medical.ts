// API of the "medical" work stream: injuries, treatment and the medical team (backend/game/medical*.go).
import { careerPath, req } from './api'
import type { CareerState, Coach, FixtureView, Pos } from './types'

export interface MedOpt { key: string; weeks?: number; cost?: number; risk?: number; dmg?: number; comp?: number; rec?: boolean }
export type MedCardKind = 'treat' | 'diag' | 'return' | 'warn' | 'knock' | 'flu' | 'wear'
export interface MedCard {
  id: number; kind: MedCardKind; playerId: number; name: string; injury?: string; weeks?: number
  risk?: number; base?: number; wear?: number; rust?: number; frag?: number; why?: string[] | null
  options: MedOpt[]; default: string; due: number; case?: number
}
export interface MedInjured {
  playerId: number; name: string; position: Pos; role: string; overall: number; age: number; shirt: number
  kind: string; tier: number; part: string; weeks: number; total: number; treat: string; source: string; since: number
  setback: number; dmg: number; rushed: boolean; pending: boolean; inject?: MedOpt | null; case?: number
}
export interface MedRisk {
  playerId: number; name: string; position: Pos; role: string; overall: number; age: number; shirt: number
  fitness: number; risk: number; base: number; wear: number; wearLv: number; frag: number; fragK?: string; rust: number
  prone: boolean; injuries: number; conc?: number; last?: string; lastS?: number; starter: boolean
}
export interface MedTeam {
  doctor: Coach | null; physio: Coach | null; fitness: Coach | null; centre: number; nextLvl: number
  prevent: number; rehab: number; misdiag: number; spot: number; comp: number; surgery: number; setback: number; rust: number; ratio: number; perks: string[]
}
export interface LossNote { attr: string; n: number }
export interface MedLine { key: string; playerId?: number; name?: string; kind?: string; was?: string; treat?: string; n?: number; loss?: LossNote[] | null; cost?: number }
export interface MedReport { tick: number; season: number; day: number; out: number; lines: MedLine[] | null }
export interface MedSeason {
  season: number; injuries: number; serious: number; weeks: number; lasting: number; spent: number; saved: number
  divInj: number; divClubs: number; allInj: number; clubs: number; tiers: number[]; allLasting: number; allWorn: number; setbacks: number
}
export interface MedCase {
  id: number; playerId: number; name: string; kind: string; diag?: string; source: string; season: number; day: number; weeks: number
  treat?: string; setbacks?: number; done: boolean; back?: number; loss?: LossNote[] | null; cost?: number; notes?: string[] | null
}
export interface MedNews { season: number; day: number; playerId: number; name: string; clubId: number; club: string; kind: string; weeks: number; overall: number; mine: boolean }
export interface MedKind { key: string; part: string; tier: number; min: number; max: number; frag: number; dmg: number; loss?: { attr: string; lo: number; hi: number }[] | null; pot: [number, number]; gk?: boolean; mis?: string; seen: number }
export interface MedicalView {
  season: number; day: number; tick: number; offseason: boolean; budget: number; next: FixtureView | null
  injured: MedInjured[]; cards: MedCard[]; squad: MedRisk[]; team: MedTeam; reports: MedReport[]
  stats: MedSeason; prev: MedSeason | null; cases: MedCase[]; news: MedNews[]; kinds: MedKind[]; waiting: number
}
export interface MedResult { view: MedicalView; line?: MedLine | null }
export type MedReq = { action: 'card'; id: number; choice: string } | { action: 'inject'; playerId: number }

export const medicalApi = {
  get: (id: number) => req<MedicalView>('GET', careerPath(id) + '/medical'),
  act: (id: number, body: MedReq) => req<MedResult>('POST', careerPath(id) + '/medical', body),
}

/** CareerState.medicalView: the small badge the career state carries. */
export interface MedBadge { waiting: number; injured: number; tick: number }
export function medBadge(st: CareerState): MedBadge | null {
  return ((st as { medicalView?: unknown }).medicalView as MedBadge | null | undefined) ?? null
}

/** Decisions waiting in the medical room (for the menu badge). */
export function medWaiting(st: CareerState): number {
  return st.career.ended ? 0 : medBadge(st)?.waiting ?? 0
}
