import { PL, type FrameState, type Statics } from '../match/frame'
import type { EngineEvent, HudCtx, HudState } from '../match/engine'

// Messages between the host (runs the match engine) and the guest (renders frames, sends input).
// Every message is a JSON object whose first key is "type" (the relay keeps the last "info").
//
// host → guest
//   info  lobby card: the two teams, state lobby | live | ended (also sent again after a reconnect)
//   st    Statics (kits, names), once per match and again whenever the guest (re)joins
//   f     one FrameState, about 30 per second, with the crowd excitement for the guest's sound
//   hud   what the guest's HUD needs (its player, context, prompt, pause state), ~6 per second
//   ev    an EngineEvent (sounds, rumble, commentary)
//   end   the final score
//   pong  answer to a ping (round-trip time)
// guest → host
//   hello (re)joined: please send statics and the current picture; dev = its input device
//   in    a controller / keyboard frame (BTN bitmask, sticks -1..1)
//   tp    the touch pad: stick and the named buttons held
//   ping  latency probe; rtt reports the measured round trip back to the host's lobby
//   away  this device's screen went off / it switched apps: the host pauses

/** The guest plays team 1 (player 2). */
export const GUEST_SIDE = 1 as const

export interface LanTeam { name: string; short: string; color: string; color2: string; strength?: number; legends?: boolean }
export type LanPhase = 'lobby' | 'live' | 'ended'
export type GuestDevice = 'touch' | 'kb' | 'ps' | 'xbox'

export interface InfoMsg { type: 'info'; state: LanPhase; home: LanTeam; away: LanTeam; mins: number; host: string }
export interface GuestHud {
  name: string; st: number; ctx: HudCtx; pr: string; paused: boolean; why: string; ment: string
  cpu: boolean; inj: string; ended: boolean; feed: string[]; poss: number; shots: [number, number]
}

export function guestHud(h: HudState): GuestHud {
  const s = h.sides[GUEST_SIDE]
  return {
    name: s.name, st: Math.round(s.stamina * 100) / 100, ctx: s.ctx, pr: s.prompt, paused: h.paused, why: h.pauseReason,
    ment: h.mentality[GUEST_SIDE], cpu: !h.human[GUEST_SIDE], inj: s.injured, ended: h.ended, feed: h.feed.slice(0, 3),
    poss: 100 - h.poss, shots: [h.stats.shots[0], h.stats.shots[1]],
  }
}

export type HostMsg =
  | InfoMsg
  | { type: 'st'; st: Statics }
  | { type: 'f'; f: FrameState; ex: number; ha: boolean }
  | { type: 'hud'; h: GuestHud }
  | { type: 'ev'; e: EngineEvent }
  | { type: 'end'; sc: [number, number]; pens: [number, number] | null; et: boolean }
  | { type: 'pong'; t: number }

export type GuestMsg =
  | { type: 'hello'; dev: GuestDevice }
  | { type: 'in'; x: number; y: number; rx: number; ry: number; b: number }
  | { type: 'tp'; x: number; y: number; h: string[] }
  | { type: 'ping'; t: number }
  | { type: 'rtt'; ms: number }
  | { type: 'away' }

/**
 * Smooth 30 Hz frames on a 60 Hz screen: carry players and the ball on along their last motion
 * for at most `ahead` seconds (one frame interval). Teleports (restarts, replays) are not carried.
 */
export function extrapolate(prev: FrameState | null, cur: FrameState, ahead: number): FrameState {
  if (!prev || ahead <= 0 || cur.rp || prev.rp || cur.ph !== prev.ph || (cur.ph !== 'play' && cur.ph !== 'goal')) return cur
  const dt = cur.t - prev.t
  if (dt <= 0.001 || dt > 0.2) return cur
  const k = Math.min(ahead, 0.05) / dt * (cur.sl ? 0.35 : 1)
  const pl = cur.pl.slice()
  if (prev.pl.length === pl.length) {
    for (let i = 0; i < pl.length; i += PL) {
      if (prev.pl[i] !== pl[i]) continue
      const dx = pl[i + 1] - prev.pl[i + 1], dy = pl[i + 2] - prev.pl[i + 2]
      if (dx * dx + dy * dy > 4) continue // a jump: placed, not running
      pl[i + 1] += dx * k
      pl[i + 2] += dy * k
      const da = pl[i + 6] - prev.pl[i + 6]
      if (da > 0 && da < 5) pl[i + 6] += da * k
    }
  }
  const b = cur.ball, pb = prev.ball
  const bx = b[0] - pb[0], by = b[1] - pb[1], bz = b[2] - pb[2]
  const ball: [number, number, number] = bx * bx + by * by > 9 ? b : [b[0] + bx * k, b[1] + by * k, Math.max(0, b[2] + bz * k)]
  return { ...cur, pl, ball }
}
