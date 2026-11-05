// API of the "club" work stream: the fans, the pre-season tour, Deadline Day and the Legends wall
// (backend/game/club_*.go). One shared fetch per career and matchday feeds every club-life widget.
import { useEffect, useState } from 'react'
import { careerPath, req } from './api'
import type { Bid } from './api_events'
import type { CareerState, Player, Pos } from './types'

export type VoiceStyle = 'chant' | 'banner' | 'post'
export interface FanVoice { style: VoiceStyle; key: string; name?: string; n?: number; seed: number }
export interface FanNote { key: string; v: number; name?: string; n?: number }
export interface FavView { id: number; name: string; shirt: number; position: Pos; role: string; overall: number; apps: number; goals: number; assists: number; nation: string }
export interface FanView {
  mood: number; delta: number; band: number; voice: FanVoice; notes: FanNote[]
  attendance: number; lastGate: number; capacity: number; fill: number
  gate: number; merch: number; boost: number; ticket: string; ticketFans: number
  fav: FavView | null; trend: number[]; form: string
}
export type TourKey = 'far' | 'local' | 'camp'
export interface TourOffer { key: TourKey; place: string; money: number; fans: number; morale: number; chem: number; tired: number; merch: number; recover: number; shield: number; days: number }
export interface TourView { season: number; offers: TourOffer[]; chosen: string; open: boolean; active: boolean; until: number; saved: number }
export interface Bargain {
  playerId: number; name: string; position: Pos; role: string; overall: number; potential: number; age: number; nation: string
  clubId: number; club: string; short: string; color: string; color2: string; full: number; price: number; reason: string; sold: boolean
}
export interface DeadlineDeal { id: number; player?: string; ovr?: number; age?: number; from?: string; to?: string; fee?: number; big?: boolean }
export interface DeadlineView { window: '' | 'summer' | 'winter'; day: number; active: boolean; bargains: Bargain[]; bids: Bid[]; deals: DeadlineDeal[]; squadFull: boolean; next: number }
export interface LegendEntry {
  playerId: number; name: string; nation: string; position: Pos; role: string; shirt: number; from: number; to: number
  apps: number; goals: number; assists: number; trophies: number; overall: number; reason: 'active' | 'retired' | 'sold' | 'left'; tag?: string
  season: number; honour: '' | 'retired' | 'kept' | 'none'
}
export interface ClubLifeView {
  season: number; day: number; offseason: boolean; budget: number; short: string
  fans: FanView; tour: TourView | null; deadline: DeadlineView | null
  legends: LegendEntry[]; retired: number[]; honour: LegendEntry | null; waiting: number
}
export interface ClubResult { outcome?: string; amount?: number; name?: string; shirt?: number; player?: Player }
export type ClubReq =
  | { action: 'tour'; key: TourKey }
  | { action: 'bargain'; playerId: number }
  | { action: 'honour'; playerId: number; choice: 'retire' | 'keep' }

export const clubApi = {
  get: (id: number) => req<ClubLifeView>('GET', careerPath(id) + '/clublife'),
  act: (id: number, body: ClubReq) => req<ClubResult>('POST', careerPath(id) + '/clublife', body),
}

// ---------------------------------------------------------------- one shared fetch

const inflight = new Map<string, Promise<ClubLifeView>>()
const latest = new Map<number, { key: string; v: ClubLifeView }>()
const listeners = new Set<() => void>()
let stamp = 0

function keyOf(st: CareerState) {
  return `${st.career.id}:${st.career.season}:${st.career.day}:${st.club.budget}:${st.squad.length}:${st.career.ticket}:${stamp}`
}

function load(id: number, key: string): Promise<ClubLifeView> {
  let p = inflight.get(key)
  if (!p) {
    p = clubApi.get(id).then(v => { latest.set(id, { key, v }); return v })
    p.catch(() => inflight.delete(key))
    inflight.set(key, p)
    if (inflight.size > 12) inflight.delete(inflight.keys().next().value as string)
  }
  return p
}

/** Fetch again everywhere (after an action). */
export function refreshClubLife() {
  stamp++
  listeners.forEach(f => f())
}

/** The club-life view for the open career: shared by every widget, refreshed each matchday. */
export function useClubLife(st: CareerState): ClubLifeView | null {
  const [, bump] = useState(0)
  useEffect(() => {
    const f = () => bump(n => n + 1)
    listeners.add(f)
    return () => { listeners.delete(f) }
  }, [])
  const key = keyOf(st)
  const id = st.career.id
  const [v, setV] = useState<ClubLifeView | null>(() => latest.get(id)?.v ?? null)
  useEffect(() => {
    let alive = true
    load(id, key).then(x => { if (alive) setV(x) }).catch(() => { /* the hub stays usable without it */ })
    return () => { alive = false }
  }, [id, key])
  return v
}

/** Decisions waiting in club life (the tour pick, a legend's shirt number) for inbox badges. */
export function clubWaiting(st: CareerState): number {
  const l = latest.get(st.career.id)
  if (!l || l.v.season !== st.career.season || l.v.day !== st.career.day) return 0
  return l.v.waiting
}
