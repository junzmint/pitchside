/**
 * Player settings: one small typed store, persisted in localStorage under 'pitchside.settings'.
 *
 *   import { getSettings, setSettings, subscribeSettings, useSettings } from './settings'
 *
 *   getSettings().volume                  // read anywhere (match engine, audio) without React
 *   setSettings({ sound: false })         // partial update: saved and pushed to every subscriber
 *   const off = subscribeSettings(s => …) // listen for changes; call off() to stop
 *   const [s, set] = useSettings()        // React hook: re-renders when a setting changes
 *
 * Fields (defaults in DEFAULT_SETTINGS):
 *   sound       boolean                         sound effects on/off
 *   volume      number 0..1                     effects volume
 *   rumble      boolean                         controller vibration
 *   camera      'tv' | 'broadcast' | 'wide' | 'close'  live-match camera: 'tv' = tilted 3D view from the stand,
 *                                               'broadcast' = top-down, following the ball,
 *                                               'wide' = zoomed out, 'close' = zoomed in
 *   difficulty  'easy' | 'normal' | 'hard'      default difficulty for live matches
 *   matchLength 90 | 150 | 240                  default seconds per half for live matches (3 / 5 / 8 minutes a match)
 *
 * Language is not stored here: it stays in i18n (useI18n().lang / setLang).
 * Changes made in another tab arrive through the 'storage' event.
 */
import { useEffect, useState } from 'react'

export type Camera = 'tv' | 'broadcast' | 'wide' | 'close'
export type Difficulty = 'easy' | 'normal' | 'hard'
export type MatchLength = 90 | 150 | 240

export interface Settings {
  sound: boolean
  volume: number
  rumble: boolean
  camera: Camera
  difficulty: Difficulty
  matchLength: MatchLength
}

export const DEFAULT_SETTINGS: Settings = { sound: true, volume: 0.6, rumble: true, camera: 'tv', difficulty: 'normal', matchLength: 150 }
export const CAMERAS: Camera[] = ['tv', 'broadcast', 'wide', 'close']
export const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard']
export const MATCH_LENGTHS: MatchLength[] = [90, 150, 240]

const KEY = 'pitchside.settings'

function clean(raw: Partial<Settings> | null | undefined): Settings {
  const s = { ...DEFAULT_SETTINGS }
  if (!raw || typeof raw !== 'object') return s
  if (typeof raw.sound === 'boolean') s.sound = raw.sound
  if (typeof raw.volume === 'number' && Number.isFinite(raw.volume)) s.volume = Math.max(0, Math.min(1, raw.volume))
  if (typeof raw.rumble === 'boolean') s.rumble = raw.rumble
  if (CAMERAS.includes(raw.camera as Camera)) s.camera = raw.camera as Camera
  if (DIFFICULTIES.includes(raw.difficulty as Difficulty)) s.difficulty = raw.difficulty as Difficulty
  if (MATCH_LENGTHS.includes(Number(raw.matchLength) as MatchLength)) s.matchLength = Number(raw.matchLength) as MatchLength
  return s
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return clean(JSON.parse(raw))
    // first run: keep the match length / difficulty the pre-match screen remembered so far
    return clean({ matchLength: Number(localStorage.getItem('pitchside.len')) as MatchLength, difficulty: localStorage.getItem('pitchside.diff') as Difficulty })
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

let current: Settings = load()
const listeners = new Set<(s: Settings) => void>()
const emit = () => listeners.forEach(fn => fn(current))

export function getSettings(): Settings {
  return current
}

export function setSettings(patch: Partial<Settings>): Settings {
  current = clean({ ...current, ...patch })
  try { localStorage.setItem(KEY, JSON.stringify(current)) } catch { /* storage unavailable: keep it in memory */ }
  emit()
  return current
}

export function subscribeSettings(fn: (s: Settings) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', e => {
    if (e.key !== KEY) return
    try { current = clean(e.newValue ? JSON.parse(e.newValue) : null) } catch { current = { ...DEFAULT_SETTINGS } }
    emit()
  })
}

/** React hook: the current settings and a setter for partial updates. */
export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [s, setS] = useState(current)
  useEffect(() => {
    setS(current)
    return subscribeSettings(setS)
  }, [])
  return [s, setSettings]
}
