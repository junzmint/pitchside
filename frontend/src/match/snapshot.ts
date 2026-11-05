// A live match in progress is kept in localStorage so the player can continue it (or forfeit) later.
import type { GoalRec, PStat } from './engine'

export interface CardRec { id: number; team: 0 | 1; kind: 'y' | 'r'; minute: number }

export interface Snapshot {
  fixtureId: number
  score: [number, number]
  shots: [number, number]
  possT: [number, number]
  scorers: number[]
  assists: number[]
  elapsed: number
  half: number // 1-2, 3-4 extra time, 5 penalty shoot-out
  minute: number
  mentality: 'defensive' | 'balanced' | 'attacking'
  stamina: Record<number, number>
  subs?: { out: number; in: number; minute: number; team?: 0 | 1 }[]
  halfSeconds: number
  difficulty: 'easy' | 'normal' | 'hard'
  // added with the 2025 live-match update (all optional so older saves still load)
  mentality1?: 'defensive' | 'balanced' | 'attacking'
  cards?: CardRec[]
  stats?: Record<string, [number, number]>
  extraTime?: boolean
  so?: { k: [number[], number[]]; turn: 0 | 1; first: 0 | 1 }
  mode?: 'play' | 'watch' | 'duo'
  // added with the wave-2 post-match screen
  pstats?: PStat[]
  goals?: GoalRec[]
}

const key = (careerId: number) => `pitchside.live.${careerId}`

export function saveSnapshot(careerId: number, s: Snapshot) {
  try { localStorage.setItem(key(careerId), JSON.stringify(s)) } catch { /* storage unavailable */ }
}

export function loadSnapshot(careerId: number, fixtureId: number): Snapshot | null {
  try {
    const raw = localStorage.getItem(key(careerId))
    if (!raw) return null
    const s = JSON.parse(raw) as Snapshot
    return s.fixtureId === fixtureId ? s : null
  } catch {
    return null
  }
}

export function clearSnapshot(careerId: number) {
  try { localStorage.removeItem(key(careerId)) } catch { /* ignore */ }
}
