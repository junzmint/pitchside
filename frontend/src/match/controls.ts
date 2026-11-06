import type { Glyphs } from './frame'
import type { HudCtx, SkillId } from './engine'

// Button glyphs per device and the control lists shown in the HUD and the pause menu.
// Expressions use pad button names (A B X Y LB RB LT RT LS RS START UD LR); glyph() turns them into
// ✕ ○ □ △ L1 … for PlayStation, A B X Y LB … for Xbox, or the keys for the keyboard (which depend on
// whether you are attacking or defending, like the engine's mapping in input.ts).

const PS: Record<string, string> = { A: '✕', B: '○', X: '□', Y: '△', LB: 'L1', RB: 'R1', LT: 'L2', RT: 'R2', START: 'Options', SELECT: 'Share', LS: 'L', RS: 'R', UD: '✚↑↓', LR: '✚←→' }
const XB: Record<string, string> = { A: 'A', B: 'B', X: 'X', Y: 'Y', LB: 'LB', RB: 'RB', LT: 'LT', RT: 'RT', START: '☰', SELECT: '⧉', LS: 'LS', RS: 'RS', UD: '✚↑↓', LR: '✚←→' }
const KB_ATT: Record<string, string> = { A: 'J', B: 'K', X: 'I', Y: 'L', LB: 'Q', RB: 'E', LT: 'Space', RT: 'Shift', START: 'P', SELECT: 'Tab', LS: 'WASD', RS: 'U+WASD', UD: '1 2 3', LR: 'C' }
const KB_DEF: Record<string, string> = { ...KB_ATT, A: 'Q', B: 'K', X: 'L', Y: 'E', LB: 'J', RB: 'I' }

export function glyph(expr: string, g: Glyphs, def = false): string {
  const map = g === 'ps' ? PS : g === 'xbox' ? XB : def ? KB_DEF : KB_ATT
  return expr.replace(/\b(LB|RB|LT|RT|LS|RS|START|SELECT|UD|LR|A|B|X|Y)\b/g, m => map[m] ?? m)
}

/** The buttons a prompt string can mention: {A} {B} … are replaced with this device's glyphs. */
export function glyphParams(g: Glyphs, def = false): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'START', 'LS', 'RS', 'UD', 'LR']) out[k] = glyph(k, g, def)
  return out
}

export interface CtlRow { k: string; b: string }
export type CtlGroup = HudCtx | 'gen'
export const ROWS: Record<CtlGroup, CtlRow[]> = {
  att: [
    { k: 'move', b: 'LS' }, { k: 'sprint', b: 'RT' }, { k: 'pass', b: 'A' }, { k: 'through', b: 'Y' }, { k: 'lob', b: 'X' }, { k: 'shoot', b: 'B' },
    { k: 'passgo', b: 'LB+A' }, { k: 'loftThrough', b: 'LB+Y' }, { k: 'finesse', b: 'RB+B' }, { k: 'chip', b: 'LB+B' }, { k: 'low', b: 'LB+RB+B' },
    { k: 'driven', b: 'RB+A' }, { k: 'lowCross', b: 'RB+X' }, { k: 'earlyCross', b: 'LB+X' }, { k: 'shield', b: 'LT' }, { k: 'skills', b: 'RS' },
    { k: 'knock', b: 'RT+RS↑' }, { k: 'fake', b: 'B → A' }, { k: 'knuckle', b: 'B + Y' }, { k: 'trivela', b: 'B + X' },
  ],
  def: [
    { k: 'contain', b: 'A' }, { k: 'tackle', b: 'B' }, { k: 'slide', b: 'X' }, { k: 'switch', b: 'LB' }, { k: 'switchDir', b: 'RS' },
    { k: 'press', b: 'RB' }, { k: 'jockey', b: 'LT' }, { k: 'rush', b: 'Y' }, { k: 'sprint', b: 'RT' },
  ],
  set: [{ k: 'aim', b: 'LS' }, { k: 'curl', b: 'RS · LB/RB' }, { k: 'spPass', b: 'A' }, { k: 'spCross', b: 'X' }, { k: 'spShot', b: 'B' }, { k: 'spThrough', b: 'Y' }],
  pen: [{ k: 'penAim', b: 'LS' }, { k: 'penShoot', b: 'B' }, { k: 'panenka', b: 'LB+B · X' }, { k: 'stutter', b: 'LT' }],
  keeper: [{ k: 'diveDir', b: 'LS' }, { k: 'diveEarly', b: 'A' }],
  gk: [{ k: 'gkThrow', b: 'A' }, { k: 'gkLong', b: 'X' }, { k: 'move', b: 'LS' }],
  kickoff: [{ k: 'pass', b: 'A' }, { k: 'move', b: 'LS' }],
  none: [],
  gen: [{ k: 'pause', b: 'START' }, { k: 'mentality', b: 'UD' }, { k: 'camera', b: 'LR' }],
}

/** Skill moves: right-stick flicks relative to where the player faces (↑ = forward). */
export const COMBO_ROWS: { id: SkillId; stars: number; seq: string }[] = [
  { id: 'feint', stars: 1, seq: '← / →' },
  { id: 'dragback', stars: 1, seq: '↓' },
  { id: 'knock', stars: 1, seq: '↑' },
  { id: 'stepover', stars: 2, seq: '↑ → (↑ ←)' },
  { id: 'cruyff', stars: 2, seq: '↑ ↓' },
  { id: 'ballroll', stars: 2, seq: '→ → (← ←)' },
  { id: 'roulette', stars: 3, seq: '↓ → (↓ ←)' },
  { id: 'mcgeady', stars: 3, seq: '→ ↑ (← ↑)' },
  { id: 'croqueta', stars: 3, seq: '→ ↓ (← ↓)' },
  { id: 'elastico', stars: 4, seq: '→ ← (← →)' },
  { id: 'rainbow', stars: 5, seq: '↓ ↑ ↑' },
]
