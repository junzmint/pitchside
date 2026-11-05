// The live match "protocol": pitch geometry, controller buttons, the per-side input frame and the
// compact render frame. Everything here is plain data, so a network layer can send an InputFrame
// from a second device to the host and FrameState/Statics back for rendering there (see render.ts).

export const L = 105
export const W = 68
export const CY = W / 2
export const GOAL_HALF = 3.66
export const GOAL_H = 2.44
export const BOX_D = 16.5
export const BOX_HW = 20.16

/** Controller buttons in "standard gamepad" order. The keyboard maps its keys onto the same set. */
export const BTN = {
  A: 1 << 0, // ✕ / A
  B: 1 << 1, // ○ / B
  X: 1 << 2, // □ / X
  Y: 1 << 3, // △ / Y
  LB: 1 << 4, // L1 / LB
  RB: 1 << 5, // R1 / RB
  LT: 1 << 6, // L2 / LT
  RT: 1 << 7, // R2 / RT
  SELECT: 1 << 8, // Share / View
  START: 1 << 9, // Options / Menu
  L3: 1 << 10,
  R3: 1 << 11,
  UP: 1 << 12,
  DOWN: 1 << 13,
  LEFT: 1 << 14,
  RIGHT: 1 << 15,
  SKILL: 1 << 16, // keyboard / touch: hold and tap directions = right-stick flicks
} as const

export type Glyphs = 'kb' | 'ps' | 'xbox' | 'touch'
/** What the buttons mean right now for a side: attacking, defending or taking a set piece. */
export type Ctx = 'att' | 'def' | 'set'

/** One side's input, sampled once per frame. Sticks are -1..1 (y down), b is a BTN bitmask. */
export interface InputFrame { x: number; y: number; rx: number; ry: number; b: number }

export interface InputSource {
  readonly key: string // stable identity: 'kb', 'pad:<index>', 'net:<peer>'
  readonly label: string
  readonly glyphs: Glyphs
  /** performance.now() of the last real input (used to show the right button glyphs) */
  active: number
  /** Latest state, or null when the device is gone. Taps shorter than a frame are latched until the next poll. */
  poll(): InputFrame | null
  rumble?(strong: number, weak: number, ms: number): void
}

export type Phase = 'kickoff' | 'play' | 'dead' | 'restart' | 'goal' | 'replay' | 'half' | 'shootout' | 'end'

// player flags in FrameState.pl
export const F_GK = 1, F_DOWN = 2, F_SLIDE = 4, F_DIVE = 8, F_JUMP = 16, F_SKILL = 32, F_YELLOW = 64, F_SPRINT = 128
export const F_CTRL0 = 256, F_CTRL1 = 512, F_BEATEN = 1024, F_CELEB = 2048, F_HANDS = 4096, F_KICK = 8192
/** stride of FrameState.pl: id, x, y, face, speed, flags, anim (run-cycle phase) */
export const PL = 7

export interface Overlay {
  pw: [number, number] // charge power per side, 0 = not charging
  aim: [number[] | null, number[] | null] // set-piece reticle per side: [x, y, curl (1/m), mode 0 pass / 1 lob / 2 shot, peak height]
  tgt: [number, number] // highlighted pass receiver id per side (-1 = none)
  off: number // offside line x (world) while a human side attacks, -1 = hidden
  fl: string // flash text (skill move, "SAVE!", …)
  fx: number; fy: number; fa: number // flash position and alpha
}

export interface FrameState {
  t: number // match clock in seconds of play
  ph: Phase
  half: number // 1-2, 3-4 = extra time, 5 = shoot-out
  min: number
  sc: [number, number]
  bn: string // banner
  cam: [number, number] // camera target
  ball: [number, number, number] // x, y, z
  bs: number // ball spin (curl) for the spin effect
  owner: number // ball owner id or -1
  pl: number[]
  so?: { k: [number[], number[]]; turn: number } // shoot-out kicks (1 scored, 0 missed) and whose turn
  sk: number // screen shake 0..1
  wf: number // white flash 0..1
  nr: number // net ripple 0..1 (seconds since the ball hit the net, mapped)
  celeb: number // celebration intensity 0..1 (confetti)
  ct: number // team celebrating (0/1)
  ov?: Overlay
  rp?: boolean // replay frame
  sl?: boolean // slow motion
  // added in wave 2 (all optional, so older peers still render)
  wo?: number // walk-out before kick-off, 0..1 progress (camera close on the line-up)
  cel?: [number, number, number] // goal celebration: scorer id, kind (1 knee slide, 2 aeroplane, 3 backflip, 4 point to the sky), seconds
  ex?: number // crowd excitement 0..1
}

/** A team's kit as drawn: shirt (c1) and trim (c2), keeper shirt, shirt pattern, shorts and socks. */
export interface Kit { c1: string; c2: string; gk: string; pat?: string; sh?: string; so?: string }
export interface Statics {
  kit: [Kit, Kit]
  names: [string, string]
  shorts: [string, string]
  pl: Record<number, { n: string; s: number; t: 0 | 1 }> // name, shirt, team
  weather: '' | 'rain' | 'snow' | 'wind'
  home: 0 | 1 // which team is the home side (crowd)
  night?: boolean // floodlit continental night
}
