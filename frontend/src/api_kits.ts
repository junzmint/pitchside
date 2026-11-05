// API of the kit room (backend/game/kits.go): see the club's kits, design them, or go back to the defaults.
import { careerPath, req } from './api'
import type { KitDef, KitSet } from './match/engine'

export interface KitPreset { key: string; kit: KitDef }
export interface KitOpp { name: string; short: string; color: string; color2: string; kits: KitSet; home: boolean }
export interface KitsView {
  clubId: number; name: string; short: string; color: string; color2: string
  kits: KitSet; default: KitSet; custom: boolean
  patterns: string[]; palette: string[]; presets: KitPreset[]
  next?: KitOpp | null
}

export const kitApi = {
  get: (id: number) => req<KitsView>('GET', careerPath(id) + '/kits'),
  save: (id: number, kits: KitSet, clubColors: boolean) => req<KitsView>('PUT', careerPath(id) + '/kits', { kits, clubColors }),
  reset: (id: number) => req<KitsView>('DELETE', careerPath(id) + '/kits'),
}
