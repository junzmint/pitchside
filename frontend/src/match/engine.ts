import type { Player, Tactic } from '../types'
import { ROLE_CAT, SLOTS } from '../formations'
import {
  BOX_D, BOX_HW, BTN, CY, F_BEATEN, F_CELEB, F_CTRL0, F_CTRL1, F_DIVE, F_DOWN, F_GK, F_HANDS, F_JUMP, F_KICK, F_SKILL, F_SLIDE,
  F_SPRINT, F_YELLOW, GOAL_H, GOAL_HALF, L, W, type Ctx, type FrameState, type InputFrame, type Overlay, type Phase, type Statics,
} from './frame'
import type { CardRec, Snapshot } from './snapshot'
import { styleFor, type TeamStyle } from './style'

export { L, W }
export type { Phase }

// ------------------------------------------------------------------------------------------------
// Live match engine: fixed 60 Hz simulation of a top-down football match.
// Team 0 is always player 1's club (home or away, see setup.userIsHome); team 1 is the opponent,
// driven by the CPU or by player 2 (local pad / keyboard, or a remote InputSource later).
// Inputs arrive as one InputFrame per side (setInput); output is hud() for the React HUD and
// frameState() + statics() for render.ts (also what a second device would render).
// ------------------------------------------------------------------------------------------------

export type Difficulty = 'easy' | 'normal' | 'hard'
export type RestartKind = 'kickoff' | 'throw' | 'corner' | 'goalkick' | 'free' | 'penalty'
export type PauseReason = '' | 'user' | 'menu' | 'disconnect'
export type Side = 0 | 1
type Mentality = Tactic['mentality']
export type ShotKind = 'normal' | 'finesse' | 'chip' | 'driven' | 'header' | 'volley' | 'pen' | 'panenka' | 'fk'
type PassKind = 'ground' | 'driven' | 'through' | 'lofted' | 'loftThrough' | 'cross' | 'lowCross' | 'earlyCross' | 'throw' | 'longThrow' | 'goalkick' | 'header' | 'knock' | 'skill' | 'clear'
type HumanPass = 'pass' | 'driven' | 'passgo' | 'through' | 'loftThrough' | 'lob' | 'lowCross' | 'earlyCross'
export type SkillId = 'feint' | 'dragback' | 'knock' | 'stepover' | 'ballroll' | 'roulette' | 'mcgeady' | 'elastico' | 'rainbow' | 'fakeshot'

/** Right-stick combos, relative to where the player faces: F forward, B back, S side, O the opposite side. */
export const SKILLS: { id: SkillId; seq: string[]; stars: number; dur: number }[] = [
  { id: 'rainbow', seq: ['B', 'F', 'F'], stars: 5, dur: 0.62 },
  { id: 'elastico', seq: ['S', 'O'], stars: 4, dur: 0.45 },
  { id: 'roulette', seq: ['B', 'S'], stars: 3, dur: 0.6 },
  { id: 'mcgeady', seq: ['S', 'F'], stars: 3, dur: 0.5 },
  { id: 'ballroll', seq: ['S', 'S'], stars: 2, dur: 0.55 },
  { id: 'stepover', seq: ['F', 'S'], stars: 2, dur: 0.55 },
  { id: 'dragback', seq: ['B'], stars: 1, dur: 0.42 },
  { id: 'feint', seq: ['S'], stars: 1, dur: 0.34 },
  { id: 'knock', seq: ['F'], stars: 1, dur: 0 },
]
const FAKESHOT = { id: 'fakeshot' as SkillId, seq: [] as string[], stars: 1, dur: 0.36 }

/** Moves an icon can make his own (two stars and up). */
const SIG_MOVES: SkillId[] = ['stepover', 'ballroll', 'roulette', 'mcgeady', 'elastico', 'rainbow']
/** A legend's or custom player's favourite skill move, always the same for the same name (null for everyone else). */
export function signatureOf(p: { tag?: string; name: string }): SkillId | null {
  if (p.tag !== 'legend' && p.tag !== 'custom') return null
  let h = 7
  for (const ch of p.name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return SIG_MOVES[h % SIG_MOVES.length]
}

export interface EngineEvent {
  k: 'kick' | 'pass' | 'shot' | 'head' | 'tackle' | 'foul' | 'whistle' | 'goal' | 'post' | 'save' | 'miss' | 'card' | 'skill' | 'cam'
    | 'chance' | 'hush' | 'so' | 'net' | 'injury'
  v?: number // strength 0..1 (whistle: 1 short, 2 half time, 3 full time)
  s?: string // sub-kind (pass kind, card colour, …)
  side?: Side // team the event favours (scorer, fouled side, …)
  r?: [number, number] // controller rumble per side 0..1
  say?: string // short line for spoken commentary
}

/** One kit: a shirt pattern in two colours (shirt + trim), shorts and socks (backend kits.go). */
export interface KitDef { pattern: string; shirt: string; trim: string; shorts: string; socks: string }
export interface KitSet { home: KitDef; away: KitDef; third: KitDef }
/** Which kit a side wears: 'auto' = home, or the first one that doesn't clash with the other side. */
export type KitChoice = 'auto' | 'home' | 'away' | 'third'
export interface EngineClub { name: string; short: string; color: string; color2: string; formation: string; tactic: Tactic; kits?: KitSet | null }
export interface EngineSide {
  club: EngineClub
  starters: Player[]
  roles: string[]
  bench?: Player[] | null
  headCoach?: number
  chemistry?: { team: number } | null
  coachFit?: { score: number; style?: string } | null
  perks?: string[] | null
}
/** Everything the engine needs: two sides and a few flags (a career MatchSetup fits as is, so do arcade matches). */
export interface EngineSetup {
  home: EngineSide
  away: EngineSide
  userIsHome: boolean // team 0 (player 1) is the home side
  knockout?: boolean // level after 90' → extra time, then penalties
  fixture?: { id?: number; comp?: string }
  weather?: string
  derby?: boolean
}

export interface EngineOpts {
  halfSeconds: number
  difficulty: Difficulty
  t: (key: string, params?: Record<string, string | number>) => string
  snapshot?: Snapshot | null
  /** who has a person at the controls: [team 0, team 1]; default [true, false]. Watch mode: [false, false] */
  humans?: [boolean, boolean]
  replays?: boolean
  onEvent?: (e: EngineEvent) => void
  styles?: [TeamStyle, TeamStyle] // wave-2 hook: custom AI styles per team
  seed?: number
  /** beginner help for the people playing (default: by difficulty, see defaultAssists) */
  assists?: Assists
  /** the kit each team wears [team 0, team 1]; default auto (home kit unless it clashes) */
  kitPick?: [KitChoice, KitChoice]
}

/** Beginner help: pass assist (aim at the best open teammate the stick points to), shot assist (keep the aim inside
 *  the posts, a little less error), auto-switch (control jumps to the defender nearest the ball). */
export interface Assists { pass: boolean; shot: boolean; switch: boolean }
export function defaultAssists(d: Difficulty): Assists {
  return d === 'hard' ? { pass: false, shot: false, switch: true } : { pass: true, shot: true, switch: true }
}
/** What the person at team 0 has done so far (the first-match tutorial watches these). */
export interface HumanActs { moved: number; passes: number; through: number; shots: number; tackles: number; switches: number }

export interface SubMade { out: number; in: number; minute: number; team?: 0 | 1 }
export interface MatchOutcome {
  homeGoals: number
  awayGoals: number
  scorers: number[]
  assists: number[]
  possHome: number
  shotsHome: number
  shotsAway: number
  subs: SubMade[]
  extraTime?: boolean
  pens?: [number, number] | null
}
export const MAX_SUBS = 5

export interface Stats {
  shots: [number, number]; onTarget: [number, number]; fouls: [number, number]; corners: [number, number]; offsides: [number, number]
  yellows: [number, number]; reds: [number, number]; passes: [number, number]; passOk: [number, number]; saves: [number, number]
  tackles: [number, number]
}
/** One player's match: goals, assists, shots (on target), passes (completed), tackles won, interceptions, saves, fouls,
 *  cards, skill moves pulled off and the minutes he came on / went off (null = finished the match). */
export interface PStat {
  id: number; team: Side; name: string; pos: string; shirt: number; icon: boolean; gk: boolean
  g: number; a: number; sh: number; ot: number; ps: number; pk: number; tk: number; int: number; sv: number; fo: number; y: number; r: number; sk: number
  inMin: number; outMin: number | null
}
/** A goal as it happened (the post-match timeline and highlights). */
export interface GoalRec { minute: number; team: Side; scorer: string; assist: string; og: boolean; pen: boolean; id: number }
/** The recorded clip of a goal, replayable with render.ts View (frames at 30 per second). */
export interface Highlight { frames: FrameState[]; goalAt: number; goal: GoalRec }
export type HudCtx = 'att' | 'def' | 'set' | 'pen' | 'keeper' | 'gk' | 'kickoff' | 'none'
export interface SideHud { name: string; stamina: number; power: number; ctx: HudCtx; prompt: string; injured: string; sig: SkillId | '' }
export interface HudState {
  score: [number, number]
  minute: number
  half: number
  phase: Phase
  banner: string
  paused: boolean
  pauseReason: PauseReason
  feed: string[]
  colors: [string, string]
  mentality: [Mentality, Mentality]
  sides: [SideHud, SideHud]
  human: [boolean, boolean]
  stats: Stats
  poss: number
  subsLeft: [number, number]
  cards: CardRec[]
  extraTime: boolean
  so: { k: [number[], number[]]; turn: Side; first: Side } | null
  ended: boolean
  /** the walk-out before kick-off is on */
  intro: boolean
  /** a person's side scored: show the celebration buttons for that side */
  celebPick: Side | null
  /** goals so far (for the scoreboard's goal flash) */
  goals: GoalRec[]
}

// ------------------------------------------------------------------------------------------------ helpers
let rnd: () => number = Math.random
function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const gauss = () => {
  let u = 0, v = 0
  while (u === 0) u = rnd()
  while (v === 0) v = rnd()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const hyp = Math.hypot
const r2 = (v: number) => Math.round(v * 100) / 100
export function angDiff(a: number, b: number) {
  let d = a - b
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return d
}

type Attr7 = { pace: number; shooting: number; passing: number; dribbling: number; defending: number; physical: number; goalkeeping: number }
type AttrKey = keyof Attr7
interface SkillState { id: SkillId; t: number; dur: number; s: number; ok: boolean; fx: number; fy: number; f0: number; done: boolean; stars: number }

export class MP {
  x = 0; y = 0; vx = 0; vy = 0; tx = 0; ty = 0; face = 0
  faceLock: number | null = null
  stamina: number
  stun = 0; tackleCd = 0; beatenT = 0
  runT = 0; runX = 0; runY = 0
  receiveT = 0; rx = 0; ry = 0
  holdT = 0
  sprint = false
  slideT = 0; slideA = 0; slideDone = false
  diveT = 0; diveV = 0
  jumpT = 0; burstT = 0; kickT = 0
  skill: SkillState | null = null
  yellow = false; fouls = 0; injured = false
  anim = 0
  supT = 0; supX = 0; supY = 0
  mark: MP | null = null
  hold = false; spX = 0; spY = 0
  /** a keeper who already went early at a penalty (he guesses only once) */
  committed = false
  celebrate = false
  jockey = false; shield = false; pressing = false
  isGK: boolean
  cat: string
  readonly traits: Set<string>
  readonly s: Attr7
  readonly ageTire: number
  /** legend or custom player: skill moves come off more often, and one of them is his signature */
  readonly icon: boolean
  readonly sig: SkillId | null

  constructor(readonly team: Side, public idx: number, public role: string, readonly data: Player, boost: number, extra: Partial<Attr7> = {}) {
    this.cat = ROLE_CAT[role] ?? data.position
    this.traits = new Set(data.traits ?? [])
    this.isGK = role === 'GK'
    // icons (legends, custom players) can be pushed past 99 — up to 110 — and that shows on the pitch
    const icon = data.tag === 'legend' || data.tag === 'custom'
    this.icon = icon
    this.sig = signatureOf(data)
    const cap = icon ? 110 : 99
    const b = (k: AttrKey, v: number) => clamp(v + boost + (extra[k] ?? 0), 10, cap)
    this.s = {
      pace: b('pace', data.pace), shooting: b('shooting', data.shooting), passing: b('passing', data.passing), dribbling: b('dribbling', data.dribbling),
      defending: b('defending', data.defending), physical: b('physical', data.physical), goalkeeping: b('goalkeeping', data.goalkeeping),
    }
    this.ageTire = icon ? 1 : 1 + 0.03 * Math.max(0, data.age - 30)
    if (this.cat !== data.position) {
      const f = this.isGK || data.position === 'GK' ? 0.6 : 0.92
      for (const k of Object.keys(this.s) as AttrKey[]) this.s[k] *= f
    }
    this.stamina = clamp(data.fitness / 100, 0.35, 1)
    this.face = team === 0 ? 0 : Math.PI
  }
  baseSpeed() { return 5.3 + this.s.pace * 0.037 + (this.traits.has('speedster') ? 0.45 : 0) }
  maxSpeed() {
    return this.baseSpeed() * (0.7 + 0.3 * this.stamina) * (this.stun > 0 ? 0.45 : 1) * (this.beatenT > 0 ? 0.5 : 1) * (this.burstT > 0 ? 1.1 : 1) * (this.injured ? 0.75 : 1)
  }
}

interface ShotInfo { team: Side; by: MP; gkTried: boolean; t: number; kind: ShotKind; dist: number; great: boolean; counted: boolean; minD: number }
interface PassInfo { from: MP; to: MP | null; kind: PassKind; t: number }
interface Ball {
  x: number; y: number; z: number; vx: number; vy: number; vz: number; spin: number
  owner: MP | null; last: MP | null; kicker: MP | null; kickCd: number; tried: Set<MP>
  shot: ShotInfo | null; pass: PassInfo | null; off: MP[] | null; offTeam: Side
  inNet: boolean; hands: boolean; fixed: boolean
}
interface Flick { d: 'F' | 'B' | 'S'; s: number; t: number }
type Queued = { act: HumanPass | 'shoot'; t: number; power: number; sk: ShotKind }

/** Per-side controller state: edges, charges, combos, set-piece aim. */
class Ctl {
  x = 0; y = 0; rx = 0; ry = 0
  latch = 0; now = 0; prev = 0; fresh = false
  held = 0; pr = 0; rl = 0
  charge: { kind: 'shot' | 'spCross' | 'spShot' | 'pen'; t0: number; mods: number } | null = null
  rsArmed = true
  lastKb: [number, number] = [0, 0]
  flicks: Flick[] = []
  comboAt = 0
  queued: Queued | null = null
  aim: { x: number; y: number; curl: number } | null = null
  pen: { run: boolean; released: boolean; power: number; chip: boolean; stut: number; stutUsed: boolean } | null = null
  switchCd = 0
  oneTwo: { runner: MP; until: number } | null = null
  tgt: MP | null = null
  pressCall = false
  rush = false
  reset() {
    this.charge = null; this.queued = null; this.aim = null; this.pen = null; this.oneTwo = null; this.flicks = []; this.tgt = null
    this.pressCall = false; this.rush = false
  }
}

interface Shootout { order: [number[], number[]]; n: [number, number]; k: [number[], number[]]; turn: Side; first: Side; wait: number; live: boolean; t: number; done: boolean }

/** How the computer's side plays at each difficulty (decision time s, tackles per second when close, pass error,
 *  shot error, keeper factor, extra pressers, attribute shift). Difficulty only ever shapes the computer's side. */
interface AiPreset { decide: number; tackleRate: number; err: number; shot: number; gk: number; press: number; boost: number }
const DIFF: Record<Difficulty, AiPreset> = {
  easy: { decide: 0.62, tackleRate: 0.75, err: 1.4, shot: 1.32, gk: 0.84, press: -1, boost: -5 },
  normal: { decide: 0.42, tackleRate: 1.3, err: 1, shot: 1, gk: 0.95, press: 0, boost: 0 },
  hard: { decide: 0.28, tackleRate: 1.95, err: 0.78, shot: 0.84, gk: 1.08, press: 1, boost: 4 },
}
/** A person's own team (the teammates the computer moves for you): a little help on easy, never a handicap. */
const HELP: Record<Difficulty, AiPreset> = {
  easy: { decide: 0.42, tackleRate: 1.7, err: 0.9, shot: 1, gk: 1.08, press: 0, boost: 2 },
  normal: { decide: 0.42, tackleRate: 1.35, err: 1, shot: 1, gk: 1, press: 0, boost: 0 },
  hard: { decide: 0.42, tackleRate: 1.3, err: 1, shot: 1, gk: 0.98, press: 0, boost: 0 },
}
/** Share of the gap in average rating the weaker XI makes up: the better team still wins most, the other one still plays. */
const PARITY = 0.4
/** Tackle bonus for the player a person controls (easy is forgiving, hard is not). */
const HUMAN_TACKLE: Record<Difficulty, number> = { easy: 0.12, normal: 0.03, hard: -0.03 }
/** Skill-move bonus for the player a person controls. */
const HUMAN_SKILL: Record<Difficulty, number> = { easy: 0.12, normal: 0.05, hard: 0 }
/** Kick-off (radius of the centre circle 9.15 m): where the side not kicking off lines up, the line nobody of
 *  that side may cross before the ball is played, and how far from halfway everyone else stays. */
const KO_WAIT = 10.2, KO_STAY = 9.45, KO_LINE = 0.3

const COMMENT_VARIANTS: Record<string, number> = {
  kickoff: 2, shotWide: 3, shotOver: 2, save: 3, tipOver: 2, blocked: 2, post: 2, bar: 2, tackle: 2, foul: 2, yellow: 2, red: 1, secondYellow: 1, corner: 2,
  freeKick: 2, penalty: 2, penScored: 2, penSaved: 2, penMissed: 2, offside: 2, skill: 2, header: 2, chance: 2, longShot: 2,
  advantage: 1, fumble: 1, injury: 1, derby: 1, weather: 1, extraTime: 1, shootout: 1, catch: 2, clear: 1, oneTwo: 1, cross: 2, signature: 2,
}

// ------------------------------------------------------------------------------------------------ engine
export class Engine {
  players: MP[] = []
  teams: [MP[], MP[]] = [[], []]
  tactics: [Tactic, Tactic]
  styles: [TeamStyle, TeamStyle]
  formations: [string, string]
  colors: [[string, string], [string, string]]
  /** goalkeeper shirts, picked so they clash with neither outfield kit */
  gkKits: [string, string] = ['#2fd0c4', '#c8e04a']
  /** true when a side changed into its alternate kit (shown in the intro) */
  kitChanged: [boolean, boolean] = [false, false]
  /** the full kits worn [team 0, team 1] (pattern, shorts, socks) */
  kits: [KitDef, KitDef]
  names: [string, string]
  shorts: [string, string]
  ball: Ball = {
    x: L / 2, y: CY, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, owner: null, last: null, kicker: null, kickCd: 0, tried: new Set(),
    shot: null, pass: null, off: null, offTeam: 0, inNet: false, hands: false, fixed: false,
  }
  score: [number, number] = [0, 0]
  possT: [number, number] = [0, 0]
  scorers: number[] = []
  assists: number[] = []
  stats: Stats = {
    shots: [0, 0], onTarget: [0, 0], fouls: [0, 0], corners: [0, 0], offsides: [0, 0], yellows: [0, 0], reds: [0, 0], passes: [0, 0], passOk: [0, 0], saves: [0, 0],
    tackles: [0, 0],
  }
  cards: CardRec[] = []
  /** per-player match record, by player id */
  pstats = new Map<number, PStat>()
  goalLog: GoalRec[] = []
  /** signature moves pulled off by icons (for the post-match screen) */
  signatures: { id: number; team: Side; move: SkillId; minute: number }[] = []
  private lastSig = new Map<number, number>()
  /** clips of the goals scored while the match was drawn (not during "skip to end") */
  highlights: Highlight[] = []
  private pendingGoal: GoalRec | null = null
  /** the last shot while nobody has had the ball since: a shot the keeper or a defender only gets a touch to
   *  still counts for the shooter if it goes in (a real own goal is a defender's own clearance, pass or header) */
  private shotBy: { p: MP; at: number; shot: ShotInfo } | null = null
  lastPass: { p: MP; t: number } | null = null
  feed: string[] = []
  phase: Phase = 'kickoff'
  phaseT = 0
  restartKind: RestartKind = 'kickoff'
  restartTeam: Side = 0
  setTaker: MP | null = null
  direct = false
  pending: { kind: RestartKind; team: Side; x: number; y: number; indirect: boolean } | null = null
  half = 1
  elapsed = 0
  clock = 0
  tick = 0
  paused = false
  pauseReason: PauseReason = ''
  human: [boolean, boolean]
  ctrl: [MP | null, MP | null] = [null, null]
  ctl: [Ctl, Ctl] = [new Ctl(), new Ctl()]
  cam = { x: L / 2, y: CY }
  decideT: [number, number] = [0, 0]
  extraTime = false
  so: Shootout | null = null
  pensResult: [number, number] | null = null
  weather: Statics['weather'] = ''
  derby = false
  fast = false // "skip to end": no celebrations, replays or slow motion
  replays: boolean
  bench: [Player[], Player[]] = [[], []]
  subs: SubMade[] = []
  boosts: [number, number] = [0, 0]
  extras: [Partial<Attr7>, Partial<Attr7>] = [{}, {}]
  bigGame = false
  lastConceded: Side = 0
  /** clock time each side last won the ball back (counter-attacks) */
  wonAt: [number, number] = [-99, -99]
  slowmo = 0
  // juice
  shake = 0; whiteFlash = 0; netT = 0; celebT = 0; celebTeam: Side = 0
  banner = ''; bannerT = 0
  flash = ''; flashT = 0; flashX = 0; flashY = 0
  // replay
  rec: FrameState[] = []
  rp: { frames: FrameState[]; i: number; goalAt: number } | null = null
  homeTeam: Side
  assist: Assists
  /** the tutorial is running: the computer plays the easy way until it ends */
  tutorial = false
  acts: HumanActs = { moved: 0, passes: 0, through: 0, shots: 0, tackles: 0, switches: 0 }
  ai: [AiPreset, AiPreset] = [{ ...DIFF.normal }, { ...DIFF.normal }]
  /** quality (0..1) and chemistry (0..1) of each XI: scales the AI's reactions on top of the difficulty preset */
  private aiQ: [{ q: number; chem: number }, { q: number; chem: number }] = [{ q: 0.5, chem: 0.5 }, { q: 0.5, chem: 0.5 }]
  /** average rating of each starting XI */
  avgRating: [number, number] = [70, 70]
  private onEnd: (o: MatchOutcome) => void
  private ended = false
  private t: EngineOpts['t']
  private cpuSubCheck: [number, number] = [0, 0]
  private supNext: [number, number] = [0, 0]
  private lagBall = [{ x: L / 2, y: CY }, { x: L / 2, y: CY }]
  private markNext: [number, number] = [0, 0]
  private statics_: Statics
  private lastBallZ = 0
  private sayT = 0

  constructor(readonly setup: EngineSetup, readonly opts: EngineOpts, onEnd: (o: MatchOutcome) => void) {
    this.onEnd = onEnd
    this.t = opts.t
    if (opts.seed != null) rnd = mulberry32(opts.seed)
    else rnd = Math.random
    this.human = opts.humans ? [...opts.humans] as [boolean, boolean] : [true, false]
    this.assist = { ...(opts.assists ?? defaultAssists(opts.difficulty)) }
    this.replays = opts.replays ?? true
    const user = setup.userIsHome ? setup.home : setup.away
    const cpu = setup.userIsHome ? setup.away : setup.home
    this.homeTeam = setup.userIsHome ? 0 : 1
    this.tactics = [{ ...user.club.tactic }, { ...cpu.club.tactic }]
    this.styles = opts.styles ?? [styleFor(user.club.tactic, user.coachFit?.style), styleFor(cpu.club.tactic, cpu.coachFit?.style)]
    this.formations = [user.club.formation, cpu.club.formation]
    this.names = [user.club.name, cpu.club.name]
    this.shorts = [user.club.short, cpu.club.short]
    // kits: the home side wears its home kit, the away side the first of its kits that doesn't clash
    // (or whatever the players picked); keepers get a colour of their own
    const sets: [KitSet, KitSet] = [kitSetOf(user.club), kitSetOf(cpu.club)]
    const worn = chooseKits(sets, this.homeTeam as Side, opts.kitPick ?? ['auto', 'auto'])
    this.kits = [worn[0].kit, worn[1].kit]
    this.colors = [[worn[0].kit.shirt, worn[0].kit.trim], [worn[1].kit.shirt, worn[1].kit.trim]]
    this.kitChanged = [worn[0].which !== 'home', worn[1].which !== 'home']
    this.gkKits = pickKeeperKits(this.colors)
    const w = (setup.weather ?? '').toLowerCase()
    this.weather = w.includes('snow') ? 'snow' : w.includes('rain') || w.includes('storm') ? 'rain' : w.includes('wind') ? 'wind' : ''
    this.derby = !!setup.derby
    const comp = setup.fixture?.comp ?? 'friendly'
    this.bigGame = comp !== 'league' && comp !== 'friendly'
    this.bench = [[...(user.bench ?? [])], [...(cpu.bench ?? [])]]
    const avgOf = (side: EngineSide) => { const ps = side.starters.filter(Boolean); return ps.reduce((a, p) => a + p.overall, 0) / Math.max(1, ps.length) }
    this.avgRating = [avgOf(user), avgOf(cpu)]
    // the weaker XI raises its game (so an underdog still attacks), and difficulty shifts the computer's side only
    const gap = this.avgRating[0] - this.avgRating[1]
    const parity = [gap < 0 ? -gap * PARITY : 0, gap > 0 ? gap * PARITY : 0]
    const diffBoost = [this.human[1] ? 0 : HELP[opts.difficulty].boost, this.human[1] ? 0 : DIFF[opts.difficulty].boost]
    ;[user, cpu].forEach((side, t) => {
      // head coach, chemistry, coach fit and leaders lift every player; big-game players rise in cups
      const starters = side.starters.filter(Boolean)
      const leaders = Math.min(2, starters.filter(p => p.traits?.includes('leader')).length)
      const boost = (side.headCoach ?? 10) * 0.16 + ((side.chemistry?.team ?? 50) - 50) / 14 + ((side.coachFit?.score ?? 50) - 50) / 18 + leaders * 0.6
        + parity[t] + diffBoost[t]
      this.boosts[t] = boost
      const perks = new Set(side.perks ?? [])
      const ex: Partial<Attr7> = {}
      const addEx = (k: AttrKey, v: number) => { ex[k] = (ex[k] ?? 0) + v }
      if (perks.has('finishing')) addEx('shooting', 2)
      if (perks.has('set_piece')) { addEx('shooting', 1); addEx('defending', 1) }
      if (perks.has('organiser')) addEx('defending', 2)
      if (perks.has('shot_stopper')) addEx('goalkeeping', 3)
      if (perks.has('motivator')) for (const k of ['pace', 'shooting', 'passing', 'dribbling', 'defending', 'physical', 'goalkeeping'] as const) addEx(k, 0.8)
      if (perks.has('big_match') && this.bigGame) for (const k of ['shooting', 'passing', 'dribbling', 'defending'] as const) addEx(k, 1.5)
      this.extras[t] = ex
      side.starters.forEach((p, i) => {
        if (!p) return
        const m = new MP(t as Side, i, side.roles[i] ?? p.position, p, boost + (this.bigGame && p.traits?.includes('big_game') ? 2 : 0), ex)
        this.players.push(m)
        this.teams[t].push(m)
      })
    })
    // the computer's reactions and accuracy scale with the quality and chemistry of its own XI;
    // difficulty only shifts that baseline, and only for the side the computer plays against a person
    this.aiQ = [user, cpu].map((side, t) => ({ q: clamp((this.avgRating[t] - 60) / 30, 0, 1), chem: (side.chemistry?.team ?? 50) / 100 })) as Engine['aiQ']
    this.refreshAI()
    this.statics_ = this.buildStatics()
    for (const p of this.players) this.pstat(p)
    const snap = opts.snapshot
    if (snap) {
      this.score = [...snap.score]; this.stats.shots = [...snap.shots]; this.possT = [...snap.possT]
      this.scorers = [...snap.scorers]; this.assists = [...snap.assists]
      this.elapsed = snap.elapsed; this.half = snap.half; this.tactics[0].mentality = snap.mentality
      if (snap.mentality1) this.tactics[1].mentality = snap.mentality1
      if (snap.stats) Object.assign(this.stats, JSON.parse(JSON.stringify(snap.stats)))
      this.extraTime = !!snap.extraTime || this.half > 2
      for (const s of snap.subs ?? []) this.substitute(s.team ?? 0, s.out, s.in, s.minute, true)
      for (const p of this.players) if (snap.stamina[p.data.id] != null) p.stamina = snap.stamina[p.data.id]
      for (const r of snap.pstats ?? []) this.pstats.set(r.id, { ...r })
      if (snap.goals) this.goalLog = snap.goals.map(g => ({ ...g }))
      for (const c of snap.cards ?? []) {
        this.cards.push({ ...c })
        const p = this.players.find(q => q.data.id === c.id)
        if (!p) continue
        if (c.kind === 'y') p.yellow = true
        else this.sendOff(p, true)
      }
      if (snap.so && this.half >= 5) {
        this.startShootout(snap.so)
      } else {
        this.kickoff(1)
        this.log(this.t('feed.resumed'))
      }
    } else {
      this.kickoff(0)
      if (this.derby) this.say('derby', { a: this.names[0], b: this.names[1] })
      if (this.weather === 'rain' || this.weather === 'snow') this.say('weather')
    }
  }

  // ------------------------------------------------------------------------------------------------ helpers
  ownX(t: Side, x: number) { return t === 0 ? x : L - x }
  ownY(t: Side, y: number) { return t === 0 ? y : W - y }
  dir(t: Side) { return t === 0 ? 1 : -1 }
  world(t: Side, ox: number, oy: number): [number, number] { return t === 0 ? [ox, oy] : [L - ox, W - oy] }
  goalX(t: Side) { return t === 0 ? L : 0 } // goal this team attacks
  ownGoalX(t: Side) { return t === 0 ? 0 : L }
  opp(t: Side): Side { return t === 0 ? 1 : 0 }
  gk(t: Side) { return this.teams[t].find(p => p.isGK) }
  now() { return this.elapsed + this.half * 1000 }
  inOwnBox(t: Side, x: number, y: number) { return this.ownX(t, x) < BOX_D && Math.abs(y - CY) < BOX_HW }
  halfLen(h = this.half) { return h <= 2 ? this.opts.halfSeconds : this.opts.halfSeconds / 3 }
  minute() {
    const h = this.half
    if (h >= 5) return 120
    const len = this.halfLen(h)
    const span = h <= 2 ? 45 : 15
    const start = h === 1 ? 0 : h === 2 ? 45 : h === 3 ? 90 : 105
    return Math.min(start + span, start + Math.floor((this.elapsed / len) * span))
  }
  log(s: string) {
    this.feed.unshift(`${this.minute()}' ${s}`)
    this.feed.length = Math.min(this.feed.length, 6)
  }
  /** Commentary line with a random variant: strings lv.c.<key>.<n> */
  say(key: string, params: Record<string, string | number> = {}) {
    if (this.fast) return
    const n = COMMENT_VARIANTS[key] ?? 1
    this.log(this.t(`lv.c.${key}.${1 + Math.floor(rnd() * n)}`, params))
  }
  emit(e: EngineEvent) { if (!this.fast) this.opts.onEvent?.(e) }
  setBanner(s: string, secs = 1.6) { this.banner = s; this.bannerT = secs }
  setFlash(s: string, x: number, y: number, secs = 1.1) { this.flash = s; this.flashT = secs; this.flashX = x; this.flashY = y }
  pressure(p: MP) {
    let m = 99
    for (const o of this.teams[this.opp(p.team)]) m = Math.min(m, hyp(o.x - p.x, o.y - p.y))
    return m
  }
  nearestOpp(t: Side, x: number, y: number) {
    let m = 99
    for (const o of this.teams[this.opp(t)]) m = Math.min(m, hyp(o.x - x, o.y - y))
    return m
  }
  nearestOf(t: Side, x: number, y: number) {
    let best: MP | null = null, bd = 1e9
    for (const p of this.teams[t]) { const d = hyp(p.x - x, p.y - y); if (d < bd) { bd = d; best = p } }
    return best
  }
  /** Safety margin (m) of a pass lane: how far the closest opponent stays from the ball's path,
   *  allowing for the time he has to close in before the ball gets there. < 0 = it will be cut out. */
  laneOpen(fx: number, fy: number, tx: number, ty: number, t: Side, speed = 16, skipGK = false) {
    let m = 6
    const dx = tx - fx, dy = ty - fy, len2 = dx * dx + dy * dy || 1, len = Math.sqrt(len2)
    for (const o of this.teams[this.opp(t)]) {
      if (skipGK && o.isGK) continue
      const u = clamp(((o.x - fx) * dx + (o.y - fy) * dy) / len2, 0, 1)
      const px = fx + dx * u, py = fy + dy * u
      m = Math.min(m, hyp(o.x - px, o.y - py) - 1 - ((u * len) / speed) * 3.2)
    }
    return m
  }
  /** Offside line for team t's attackers, in t's own coordinates: the second-last defender or the ball. */
  offsideLine(t: Side) {
    let a = 0, b = 0 // deepest and second deepest opponents (own coords of t)
    for (const o of this.teams[this.opp(t)]) {
      const x = this.ownX(t, o.x)
      if (x > a) { b = a; a = x } else if (x > b) b = x
    }
    return Math.max(b, this.ownX(t, this.ball.x))
  }
  /** The match record of a player on the pitch (created the first time). */
  pstat(p: MP): PStat {
    let r = this.pstats.get(p.data.id)
    if (!r) {
      r = { id: p.data.id, team: p.team, name: p.data.name, pos: p.isGK ? 'GK' : p.role, shirt: p.data.shirt, icon: p.data.tag === 'legend' || p.data.tag === 'custom', gk: p.isGK,
        g: 0, a: 0, sh: 0, ot: 0, ps: 0, pk: 0, tk: 0, int: 0, sv: 0, fo: 0, y: 0, r: 0, sk: 0, inMin: 0, outMin: null }
      this.pstats.set(p.data.id, r)
    }
    return r
  }
  /** Every player who took part, in team order (starters, then subs). */
  playerStats(): PStat[] { return [...this.pstats.values()].map(r => ({ ...r })) }
  aerial(p: MP) { return p.s.physical + (p.traits.has('aerial') ? 15 : 0) + (p.cat === 'FW' ? 3 : 0) + (p.role === 'CB' ? 5 : 0) }

  // ------------------------------------------------------------------------------------------------ substitutions
  subsLeft(t: Side) { return MAX_SUBS - this.subs.filter(s => (s.team ?? 0) === t).length }

  /** Swap a player on the pitch for one from the bench: the new man takes the same spot and role. */
  substitute(t: Side, outId: number, inId: number, minute = this.minute(), quiet = false): boolean {
    if (this.subsLeft(t) <= 0) return false
    const old = this.teams[t].find(p => p.data.id === outId)
    const bi = this.bench[t].findIndex(p => p.id === inId)
    if (!old || bi < 0) return false
    const pl = this.bench[t][bi]
    this.bench[t].splice(bi, 1)
    const m = new MP(t, old.idx, old.isGK ? 'GK' : old.role, pl, this.boosts[t] + (this.bigGame && pl.traits?.includes('big_game') ? 2 : 0), this.extras[t])
    m.x = old.x; m.y = old.y; m.tx = old.tx; m.ty = old.ty; m.face = old.face; m.hold = old.hold; m.spX = old.spX; m.spY = old.spY
    this.players[this.players.indexOf(old)] = m
    this.teams[t][this.teams[t].indexOf(old)] = m
    if (this.ctrl[t] === old) this.ctrl[t] = m
    if (this.setTaker === old) this.setTaker = m
    const b = this.ball
    if (b.owner === old) b.owner = m
    if (b.last === old) b.last = m
    if (b.kicker === old) b.kicker = m
    b.tried.delete(old)
    if (b.off) b.off = b.off.filter(p => p !== old)
    if (this.lastPass?.p === old) this.lastPass = null
    for (const p of this.players) if (p.mark === old) p.mark = null
    this.subs.push({ out: outId, in: inId, minute, team: t })
    this.pstat(old).outMin = minute
    this.pstat(m).inMin = minute
    this.statics_.pl[pl.id] = { n: pl.name, s: pl.shirt, t }
    if (!quiet) this.log(this.t('feed.sub', { in: pl.name, out: old.data.name }))
    return true
  }

  /** The computer brings on fresh legs for tired (or injured) players. */
  cpuSubs(t: Side) {
    if (this.subsLeft(t) <= 0) return
    const min = this.minute()
    const inj = this.teams[t].find(p => p.injured && p !== this.ball.owner)
    if (!inj && (min < 55 || min === this.cpuSubCheck[t] || min % 4 !== 0)) return
    if (!inj) this.cpuSubCheck[t] = min
    const tired = inj ?? this.teams[t].filter(p => !p.isGK && p.stamina < (min > 75 ? 0.68 : 0.6) && p !== this.ball.owner).sort((a, b) => a.stamina - b.stamina)[0]
    if (!tired) return
    const want = tired.isGK ? 'GK' : tired.cat
    const cand = this.bench[t].filter(p => p.position === want && p.fitness >= 55).sort((a, b) => b.overall - a.overall)[0]
      ?? this.bench[t].filter(p => (tired.isGK ? p.position === 'GK' : p.position !== 'GK') && p.fitness >= 55).sort((a, b) => b.overall - a.overall)[0]
    if (cand && (inj || cand.overall >= tired.data.overall - 10)) this.substitute(t, tired.data.id, cand.id)
  }

  // ------------------------------------------------------------------------------------------------ input
  /** One frame of input for a side (null = nobody there). Taps between two updates are kept. */
  setInput(side: Side, f: InputFrame | null) {
    const c = this.ctl[side]
    if (!f) { c.x = c.y = c.rx = c.ry = 0; c.now = 0; return }
    c.x = f.x; c.y = f.y; c.rx = f.rx; c.ry = f.ry
    c.latch |= f.b // everything pressed since the last update, so a quick tap is never lost
    c.now = f.b
    c.fresh = true
  }
  /** Hand a side to a person (true) or to the computer (false), e.g. "take control" or a lost controller. */
  setHuman(side: Side, on: boolean) {
    if (this.human[side] === on) return
    this.human[side] = on
    this.refreshAI()
    const c = this.ctl[side]
    c.reset()
    c.prev = c.now
    if (!on) { this.ctrl[side] = null; return }
    const b = this.ball
    this.ctrl[side] = b.owner?.team === side ? b.owner : this.bestDefender(side, null)
  }
  /** Team 0 (the user's club) always plays the helper preset; team 1 the difficulty preset unless a person has it. */
  /** Start or stop the tutorial (the computer side plays like on easy meanwhile). */
  setTutorial(on: boolean) { this.tutorial = on; this.refreshAI() }
  private refreshAI() {
    for (const t of [0, 1] as Side[]) {
      const base = t === 1 && !this.human[1] ? DIFF[this.tutorial ? 'easy' : this.opts.difficulty] : HELP[this.opts.difficulty]
      const { q, chem } = this.aiQ[t]
      this.ai[t] = {
        ...base,
        decide: base.decide * (1.16 - 0.28 * q) * (1.06 - 0.12 * chem),
        tackleRate: base.tackleRate * (0.85 + 0.3 * q),
        err: base.err * (1.16 - 0.3 * q) * (1.06 - 0.12 * chem),
        gk: base.gk * (0.96 + 0.08 * q),
      }
    }
  }
  private consume(side: Side) {
    const c = this.ctl[side]
    const b = c.fresh ? c.latch : c.now
    c.latch = 0
    c.fresh = false
    c.pr = b & ~c.prev
    c.rl = c.prev & ~b
    c.held = b
    c.prev = b
  }
  pause(reason: PauseReason = 'user') {
    if (this.phase === 'end') return
    this.paused = true
    this.pauseReason = reason
    for (const c of this.ctl) { c.charge = null; c.pen = null }
  }
  resume() {
    this.paused = false
    this.pauseReason = ''
    for (const c of this.ctl) { c.prev = c.now; c.latch = 0; c.fresh = false }
  }
  setMentality(side: Side, m: Mentality) {
    this.tactics[side].mentality = m
    this.log(this.t('feed.ment.' + m) + (this.human[0] && this.human[1] ? ` (${this.shorts[side]})` : ''))
  }
  private shiftMentality(side: Side, d: number) {
    const order: Mentality[] = ['defensive', 'balanced', 'attacking']
    const i = clamp(order.indexOf(this.tactics[side].mentality) + d, 0, 2)
    if (order[i] !== this.tactics[side].mentality) this.setMentality(side, order[i])
  }
  /** What the buttons mean for a side right now (the keyboard maps keys with this). */
  contextOf(side: Side): Ctx {
    const b = this.ball
    if (this.phase === 'restart' && this.restartTeam === side && this.ctrl[side] === this.setTaker && this.restartKind !== 'kickoff') return 'set'
    if (b.owner) return b.owner.team === side ? 'att' : 'def'
    if (b.last && b.last.team === side && (b.pass || b.shot || hyp(b.vx, b.vy) > 2)) return 'att'
    const p = this.ctrl[side]
    if (p && b.pass?.to === p) return 'att'
    return 'def'
  }

  // ------------------------------------------------------------------------------------------------ phases
  formationSpot(p: MP, D: number, F: number, width: number, shiftY: number): [number, number] {
    const sl = SLOTS[this.formations[p.team]]?.[p.idx] ?? [0.5, 0.5]
    const ox = clamp(D + ((sl[0] - 0.19) / (0.8 - 0.19)) * (F - D), 3, L - 3)
    const oy = clamp(CY + (sl[1] - 0.5) * width + shiftY, 2, W - 2)
    return this.world(p.team, ox, oy)
  }

  private resetMoment() {
    const b = this.ball
    this.shotBy = null
    b.vx = b.vy = b.vz = 0; b.z = 0; b.spin = 0; b.shot = null; b.pass = null; b.off = null; b.inNet = false; b.hands = false
    b.tried.clear(); b.kickCd = 0; b.owner = null; b.fixed = false
    for (const p of this.players) {
      p.hold = false; p.committed = false; p.slideT = 0; p.diveT = 0; p.skill = null; p.stun = 0; p.beatenT = 0; p.runT = 0; p.receiveT = 0
      p.celebrate = false; p.jumpT = 0; p.burstT = 0; p.supT = 0; p.mark = null; p.pressing = false
    }
    for (const c of this.ctl) c.reset()
  }

  kickoff(t: Side) {
    this.resetMoment()
    this.lastPass = null
    for (const p of this.players) {
      const [x, y] = p.isGK ? this.world(p.team, 2, CY) : this.formationSpot(p, 16, 46, 50, 0)
      p.x = p.team === 0 ? Math.min(x, L / 2 - 1.5) : Math.max(x, L / 2 + 1.5)
      p.y = y
      // the side not kicking off waits outside the centre circle
      if (p.team !== t) [p.x, p.y] = this.outsideCircle(p.x, p.y, KO_WAIT)
      p.vx = p.vy = 0; p.tx = p.x; p.ty = p.y; p.face = p.team === 0 ? 0 : Math.PI
    }
    const taker = this.teams[t].filter(p => !p.isGK).sort((a, b) => hyp(a.x - L / 2, a.y - CY) - hyp(b.x - L / 2, b.y - CY))[0] ?? this.teams[t][0]
    taker.x = L / 2 - this.dir(t) * 0.7
    taker.y = CY
    taker.face = t === 0 ? 0 : Math.PI
    this.ball.x = L / 2; this.ball.y = CY
    this.giveBall(taker, 'set')
    this.ball.fixed = true
    this.ball.x = L / 2; this.ball.y = CY
    this.phase = 'kickoff'
    this.restartKind = 'kickoff'
    this.restartTeam = t
    this.setTaker = taker
    this.phaseT = this.fast ? 0.05 : 1.2
    for (const s of [0, 1] as Side[]) if (this.human[s]) this.ctrl[s] = s === t ? taker : this.bestDefender(s, null)
  }

  /** The point (x, y) pushed out to radius r from the centre spot (unchanged when it is already outside). */
  private outsideCircle(x: number, y: number, r: number): [number, number] {
    const dx = x - L / 2, dy = y - CY, d = hyp(dx, dy)
    if (d >= r) return [x, y]
    if (d < 0.01) return [L / 2 - r, y]
    return [L / 2 + (dx / d) * r, CY + (dy / d) * r]
  }

  /** Until the kick-off is taken everyone stays in his own half, and the side not kicking off stays outside
   *  the centre circle (also the player a person moves; he slides along the line instead of walking in). */
  private kickoffShape() {
    const kt = this.restartTeam
    for (const p of this.players) {
      if (p === this.setTaker) continue
      if (p.team === 0 ? p.x > L / 2 - KO_LINE : p.x < L / 2 + KO_LINE) {
        p.x = p.team === 0 ? L / 2 - KO_LINE : L / 2 + KO_LINE
        if (p.team === 0 ? p.vx > 0 : p.vx < 0) p.vx = 0
      }
      if (p.team === kt) continue
      const dx = p.x - L / 2, dy = p.y - CY, d = hyp(dx, dy)
      if (d >= KO_STAY) continue
      const ux = d > 0.01 ? dx / d : p.team === 0 ? -1 : 1, uy = d > 0.01 ? dy / d : 0
      p.x = L / 2 + ux * KO_STAY; p.y = CY + uy * KO_STAY
      const vr = p.vx * ux + p.vy * uy
      if (vr < 0) { p.vx -= vr * ux; p.vy -= vr * uy }
    }
  }

  /** The ball is dead (out, foul, offside): a short pause, then the restart. */
  stoppage(kind: RestartKind, team: Side, x: number, y: number, indirect = false) {
    const b = this.ball
    if (b.owner) { b.owner = null; b.vx *= 0.2; b.vy *= 0.2 }
    b.shot = null; b.pass = null; b.off = null
    this.shotBy = null
    this.pending = { kind, team, x, y, indirect }
    this.phase = 'dead'
    this.phaseT = this.fast ? 0.05 : kind === 'throw' ? 0.6 : kind === 'goalkick' ? 0.9 : kind === 'penalty' ? 1.7 : 1.0
    for (const c of this.ctl) { c.charge = null; c.queued = null }
    if (kind === 'corner') { this.stats.corners[team]++; this.say('corner', { team: this.shorts[team] }) }
  }

  restart(kind: RestartKind, a: Side, x: number, y: number, indirect = false) {
    this.resetMoment()
    const b = this.ball
    const d = this.opp(a)
    const out = this.teams[a].filter(p => !p.isGK)
    const pick = (list: MP[], f: (p: MP) => number) => list.reduce((best, p) => (f(p) > f(best) ? p : best), list[0])
    const near = (list: MP[], px: number, py: number) => list.reduce((best, p) => (hyp(p.x - px, p.y - py) < hyp(best.x - px, best.y - py) ? p : best), list[0])
    const ox = this.ownX(a, x), oy = this.ownY(a, y)
    const dGoal = hyp(L - ox, CY - oy)
    const direct = kind === 'free' && !indirect && ox > 70 && dGoal < 33 && Math.abs(oy - CY) < dGoal * 0.8 + 1
    let taker: MP | undefined
    if (kind === 'goalkick') taker = this.gk(a) ?? out[0]
    else if (!out.length) taker = this.teams[a][0]
    else if (kind === 'corner') taker = pick(out, p => p.s.passing - (p.role === 'CB' ? 25 : 0) - (p.role === 'ST' ? 10 : 0))
    else if (kind === 'penalty') taker = this.so ? this.soTaker(a) : pick(out, p => p.s.shooting + (p.traits.has('big_game') ? 4 : 0) - (p.injured ? 30 : 0))
    else if (direct) taker = pick(out, p => p.s.shooting * 0.55 + p.s.passing * 0.45 + (p.traits.has('long_shot') ? 4 : 0))
    else taker = near(out, x, y)
    if (!taker) return this.kickoff(a)
    this.restartKind = kind
    this.restartTeam = a
    this.setTaker = taker
    this.direct = direct
    const gx = this.goalX(a)
    const face = kind === 'throw' ? (y < CY ? Math.PI / 2 : -Math.PI / 2) : kind === 'goalkick' ? (a === 0 ? 0 : Math.PI)
      : kind === 'corner' ? Math.atan2(CY - y, (a === 0 ? L - 11 : 11) - x) : Math.atan2(CY - y, gx - x)
    const back = kind === 'penalty' ? 1.8 : direct ? 1.6 : 0.65
    taker.x = x - Math.cos(face) * back; taker.y = y - Math.sin(face) * back
    if (kind === 'throw') { taker.x = x; taker.y = y < CY ? -0.35 : W + 0.35 }
    taker.vx = taker.vy = 0; taker.face = face; taker.tx = taker.x; taker.ty = taker.y
    b.x = x; b.y = y
    this.giveBall(taker, 'set')
    b.x = x; b.y = y; b.fixed = true
    const put = (p: MP, px: number, py: number, hold = true) => {
      const [wx, wy] = this.world(a, px, py)
      p.x = clamp(wx + (rnd() - 0.5) * 0.4, -1, L + 1); p.y = clamp(wy + (rnd() - 0.5) * 0.4, 0.5, W - 0.5)
      p.vx = p.vy = 0; p.tx = p.x; p.ty = p.y; p.spX = p.x; p.spY = p.y; p.hold = hold
      p.face = Math.atan2(b.y - p.y, b.x - p.x)
    }
    const gkD = this.gk(d)
    const defs = this.teams[d].filter(p => !p.isGK)
    const others = out.filter(p => p !== taker)
    if (kind === 'corner') {
      const s = oy < CY ? 1 : -1
      const spots: [number, number][] = [[L - 5.5, CY - s * 1.5], [L - 2.8, CY - s * 4.2], [L - 4.5, CY + s * 4.5], [L - 11, CY + s * 0.5], [L - 8.5, CY + s * 7.5], [L - 15.5, CY - s * 4]]
      const att = [...others].sort((p, q) => this.aerial(q) - this.aerial(p))
      const keep = this.tactics[a].mentality === 'attacking' ? 1 : this.tactics[a].mentality === 'defensive' ? 3 : 2
      const nBox = Math.max(0, Math.min(spots.length, att.length - keep))
      const boxers = att.slice(0, nBox)
      boxers.forEach((p, i) => put(p, spots[i][0], spots[i][1]))
      att.slice(nBox).forEach((p, i) => put(p, L / 2 - 6, CY + (i % 2 ? 9 : -9) * (1 + Math.floor(i / 2) * 0.6)))
      if (gkD) put(gkD, L - 0.5, CY - s * 0.6)
      const used = new Set<MP>()
      const [npx, npy] = this.world(a, L - 1, CY - s * (GOAL_HALF - 0.4))
      const np = defs.length ? near(defs, npx, npy) : undefined
      if (np) { put(np, L - 0.9, CY - s * (GOAL_HALF - 0.5)); used.add(np) }
      for (const p of boxers) {
        const free = defs.filter(q => !used.has(q))
        if (!free.length) break
        const m = near(free, p.x, p.y)
        used.add(m)
        const px = this.ownX(a, p.x), py = this.ownY(a, p.y)
        put(m, Math.min(L - 0.7, px + 1.0), py + (CY - py) * 0.12)
      }
      let i = 0
      for (const q of defs) if (!used.has(q)) { put(q, i < 2 ? L - 18 : L / 2 - 4, CY + (i % 2 ? 6 : -6)); i++ }
    } else if (kind === 'free' && direct) {
      const aimY = CY + (oy < CY ? -1 : 1) * 1.2
      const ang = Math.atan2(aimY - oy, L - ox)
      const n = Math.min(defs.length, dGoal < 20 ? 4 : dGoal < 26 ? 3 : 2)
      const wcx = ox + Math.cos(ang) * 9.15, wcy = oy + Math.sin(ang) * 9.15
      const [wwx, wwy] = this.world(a, wcx, wcy)
      const wall = [...defs].sort((p, q) => hyp(p.x - wwx, p.y - wwy) - hyp(q.x - wwx, q.y - wwy)).slice(0, n)
      wall.forEach((p, i) => { const o = (i - (n - 1) / 2) * 0.72; put(p, wcx - Math.sin(ang) * o, wcy + Math.cos(ang) * o) })
      if (gkD) put(gkD, L - 0.6, CY + (oy < CY ? 1 : -1) * 1.0)
      const lurk = [...others].sort((p, q) => q.s.shooting + this.aerial(q) - p.s.shooting - this.aerial(p)).slice(0, 3)
      lurk.forEach((p, i) => put(p, L - 12.5, CY + (i - 1) * 6 + (oy < CY ? 2 : -2)))
      const used = new Set<MP>(wall)
      for (const p of lurk) {
        const free = defs.filter(q => !used.has(q))
        if (!free.length) break
        const m = near(free, p.x, p.y)
        used.add(m)
        put(m, L - 11.3, this.ownY(a, p.y) + 0.7)
      }
    } else if (kind === 'penalty') {
      if (gkD) put(gkD, L - 0.25, CY)
      if (this.so) {
        // shoot-out: everyone else waits in the centre circle
        for (const side of [0, 1] as Side[]) this.teams[side].filter(p => p !== taker && p !== gkD).forEach((p, i) => {
          p.x = L / 2 + (side === 0 ? -1.2 : 1.2); p.y = CY - 9 + i * 1.8; p.vx = p.vy = 0; p.tx = p.x; p.ty = p.y; p.spX = p.x; p.spY = p.y; p.hold = true
          p.face = side === 0 ? 0 : Math.PI
        })
      } else {
        const rest = this.players.filter(p => p !== taker && p !== gkD && !(p.isGK && p.team === a))
        rest.forEach((p, i) => put(p, L - 21 - (i & 1) * 2.2, CY + ((i >> 1) - (rest.length >> 2)) * 3.2))
        const ownGk = this.gk(a)
        if (ownGk) put(ownGk, 20, CY, false)
      }
    } else if (kind === 'goalkick') {
      for (const p of defs) {
        const px = this.ownX(a, p.x), py = this.ownY(a, p.y)
        if (px < BOX_D + 1 && Math.abs(py - CY) < BOX_HW + 1) put(p, BOX_D + 2 + rnd() * 4, clamp(py, 6, W - 6), false)
      }
    } else {
      // throw-ins and free kicks: opponents back off (2 m for throws, 9.15 m otherwise)
      const r = kind === 'throw' ? 2.5 : 9.2
      for (const p of this.teams[d]) {
        const dd = hyp(p.x - x, p.y - y)
        if (dd < r && !p.isGK) {
          const ang = Math.atan2(p.y - y, p.x - x)
          p.x = clamp(x + Math.cos(ang) * r, 1, L - 1); p.y = clamp(y + Math.sin(ang) * r, 1, W - 1)
          if (hyp(p.x - x, p.y - y) < r - 0.5) p.x = clamp(x - this.dir(a) * r, 1, L - 1)
        }
      }
    }
    this.phase = 'restart'
    this.phaseT = this.fast ? 0.05 : ({ throw: 0.9, corner: 2.0, goalkick: 1.3, free: direct ? 2.4 : 1.3, penalty: this.so ? 1.7 : 2.0, kickoff: 1.2 } as const)[kind]
    if (kind === 'penalty' || direct) this.emit({ k: 'hush', v: kind === 'penalty' ? 1 : 0.6 })
    if (kind === 'free') this.say('freeKick', { team: this.shorts[a] })
    // set-piece reticle for a person taking it
    if (this.human[a] && this.ctrl[a] === taker) {
      let ax: number, ay: number
      if (kind === 'corner') [ax, ay] = this.world(a, L - 10, oy < CY ? CY - 0.8 : CY + 0.8)
      else if (kind === 'penalty') [ax, ay] = [gx, CY]
      else if (direct) [ax, ay] = this.world(a, L, CY + (oy < CY ? 1 : -1) * 2.4)
      else {
        const m = others.length ? near(others, x, y) : null
        ;[ax, ay] = m ? [m.x, m.y] : this.world(a, clamp(ox + 15, 2, L - 2), oy)
      }
      this.ctl[a].aim = { x: ax, y: ay, curl: 0 }
    }
    if (this.human[d]) {
      const c = this.ctl[d]
      const tgt = this.ctl[a].aim ?? { x, y }
      const cand = this.teams[d].filter(p => !p.isGK)
      const m = cand.length ? near(cand, tgt.x, tgt.y) : null
      if (m) this.ctrl[d] = m
      c.reset()
    }
  }

  // ------------------------------------------------------------------------------------------------ update
  /** Walk-out before kick-off: both teams lined up on the halfway line, facing the main camera. */
  intro = false
  private introT = 0
  beginIntro() {
    if (this.half !== 1 || this.elapsed > 0) return
    this.intro = true
    this.introT = 0
    for (const t of [0, 1] as Side[]) this.teams[t].forEach((p, i) => {
      p.x = L / 2 + (t === 0 ? -1 : 1) * (1.4 + i * 1.2); p.y = CY + 5
      p.vx = p.vy = 0; p.tx = p.x; p.ty = p.y; p.face = Math.PI / 2; p.hold = true
    })
    this.ball.x = L / 2; this.ball.y = CY
    this.cam.x = L / 2; this.cam.y = CY + 3
  }
  /** End the walk-out (any button, the intro screen timing out, or a click): players take their kick-off spots. */
  endIntro() {
    if (!this.intro) return
    this.intro = false
    this.kickoff(0)
    this.say('kickoff')
  }

  update(dt: number) {
    if (this.phase === 'end') return
    this.consume(0); this.consume(1)
    if (this.intro) {
      const face = BTN.A | BTN.B | BTN.X | BTN.Y
      const by = ([0, 1] as Side[]).find(s => this.ctl[s].pr & (face | BTN.START))
      if (by == null) {
        this.introT += dt
        this.clock += dt
        if (this.introT > 30) this.endIntro()
        this.juice(dt)
        return
      }
      this.endIntro()
      // the walk-out says "press any button to kick off": a face button also takes the kick-off (this same
      // press runs through the kick-off below), so the first press of pass is never lost; Start only ends it
      if (!(this.ctl[by].pr & face)) return
    }
    if (this.paused) {
      for (const s of [0, 1] as Side[]) if (this.ctl[s].pr & BTN.START) { this.resume(); break }
      return
    }
    // Start pauses in every phase (play and set pieces handle it themselves; in replays it skips)
    if (this.phase === 'dead' || this.phase === 'goal' || this.phase === 'half' || this.phase === 'shootout') {
      for (const s of [0, 1] as Side[]) if (this.human[s] && (this.ctl[s].pr & BTN.START)) { this.pause('user'); return }
    }
    let sdt = dt
    if (this.slowmo > 0 && !this.fast) { this.slowmo -= dt; sdt = dt * 0.35 }
    this.clock += sdt
    this.tick++
    this.juice(dt)
    switch (this.phase) {
      case 'play': this.updPlay(sdt); break
      case 'dead': this.updDead(sdt); break
      case 'kickoff': case 'restart': this.updRestart(sdt); break
      case 'goal': this.updGoal(sdt); break
      case 'replay': this.updReplay(dt); break
      case 'half': this.updHalf(sdt); break
      case 'shootout': this.updShootout(sdt); break
    }
    this.record()
  }

  private juice(dt: number) {
    this.shake = Math.max(0, this.shake - dt * 1.8)
    this.whiteFlash = Math.max(0, this.whiteFlash - dt * 2.5)
    this.celebT = Math.max(0, this.celebT - dt * 0.35)
    if (this.netT > 0) this.netT = Math.max(0, this.netT - dt * 0.8)
    this.bannerT = Math.max(0, this.bannerT - dt)
    this.flashT = Math.max(0, this.flashT - dt)
    this.sayT = Math.max(0, this.sayT - dt)
  }

  private updPlay(dt: number) {
    if (this.so) { this.updSoKick(dt); return }
    this.elapsed += dt
    if (this.checkHalfEnd()) return
    const b = this.ball
    if (b.owner) this.possT[b.owner.team] += dt
    else if (b.last) this.possT[b.last.team] += dt
    for (const t of [0, 1] as Side[]) if (!this.human[t]) this.cpuSubs(t)
    this.teamAI(0)
    this.teamAI(1)
    for (const s of [0, 1] as Side[]) {
      if (!this.human[s]) continue
      this.humanTick(s, dt)
      if (this.paused || this.phase !== 'play') return
    }
    this.aiCarriers(dt)
    if (this.phase !== 'play') return
    for (const p of this.players) {
      if (p.skill) { this.updSkill(p, dt); continue }
      if (p.slideT > 0) { this.updSlide(p, dt); continue }
      if (p.diveT > 0) { this.updDive(p, dt); continue }
      if (p === this.ctrl[0] || p === this.ctrl[1]) continue
      this.steer(p, dt, b.owner === p)
    }
    if (this.phase !== 'play') return
    this.integrate(dt)
    this.ballPhysics(dt)
    if (this.phase !== 'play') return
    this.aiTackles(dt)
    if (this.phase !== 'play') return
    this.checkBounds()
    if (this.tick % 15 === 0) for (const s of [0, 1] as Side[]) if (this.human[s] && this.ball.owner?.team !== s && this.assist.switch) this.autoSwitch(s, false)
    this.updateCam(dt)
  }

  private checkHalfEnd(): boolean {
    const len = this.halfLen()
    if (this.elapsed < len) return false
    const b = this.ball
    const over = this.elapsed - len
    const box = (Math.abs(b.y - CY) < BOX_HW + 2) && (b.x < BOX_D + 3 || b.x > L - BOX_D - 3)
    if ((b.shot || box) && over < 7) return false
    this.endOfHalf()
    return true
  }

  private endOfHalf() {
    const level = this.score[0] === this.score[1]
    if (this.half === 1 || this.half === 3) {
      this.phase = 'half'
      this.phaseT = this.fast ? 0.05 : this.half === 1 ? 3 : 2.2
      this.setBanner(this.t(this.half === 1 ? 'feed.halftime' : 'lv.b.etHalf'), 3)
      this.emit({ k: 'whistle', v: 2, say: this.t('lv.tts.half') })
      return
    }
    if (this.half === 2 && this.setup.knockout && level) {
      this.extraTime = true
      this.phase = 'half'
      this.phaseT = this.fast ? 0.05 : 3
      this.setBanner(this.t('lv.b.extraTime'), 3)
      this.say('extraTime')
      this.emit({ k: 'whistle', v: 2, say: this.t('lv.tts.extraTime') })
      return
    }
    if (this.half === 4 && level) { this.emit({ k: 'whistle', v: 2 }); this.startShootout(null); return }
    this.finish()
  }

  private updHalf(dt: number) {
    this.phaseT -= dt
    this.moveAll(dt)
    if (this.phaseT > 0) return
    this.half++
    this.elapsed = 0
    this.banner = ''
    for (const p of this.players) p.stamina = Math.min(1, p.stamina + (this.half === 2 ? 0.08 : 0.04)) // a breather
    this.kickoff(this.half % 2 === 0 ? 1 : 0)
  }

  private moveAll(dt: number) {
    for (const p of this.players) { if (p.slideT > 0) this.updSlide(p, dt); else this.accel(p, 0, 0, dt) }
    this.integrate(dt)
    this.ballPhysics(dt)
    this.updateCam(dt)
  }

  private updDead(dt: number) {
    this.elapsed += dt
    this.phaseT -= dt
    this.moveAll(dt)
    const b = this.ball
    if (b.x < -3 || b.x > L + 3 || b.y < -3 || b.y > W + 3) { b.vx *= 0.8; b.vy *= 0.8; b.x = clamp(b.x, -3, L + 3); b.y = clamp(b.y, -3, W + 3) }
    if (this.phaseT > 0) return
    const r = this.pending
    this.pending = null
    if (!r) { this.phase = 'play'; return }
    this.restart(r.kind, r.team, r.x, r.y, r.indirect)
  }

  private updRestart(dt: number) {
    if (this.so) this.so.t += dt
    else if (this.phase !== 'kickoff') this.elapsed += dt
    this.phaseT -= dt
    const a = this.restartTeam, taker = this.setTaker
    this.teamAI(0)
    this.teamAI(1)
    const humanTaker = !!taker && this.human[a] && this.ctrl[a] === taker
    for (const s of [0, 1] as Side[]) {
      if (!this.human[s]) continue
      if (s === a && humanTaker && this.restartKind !== 'kickoff') this.humanSetPiece(s, dt)
      else if (this.restartKind === 'penalty' && s !== a) this.humanKeeperWait(s)
      else this.humanTick(s, dt)
      if (this.paused || (this.phase !== 'restart' && this.phase !== 'kickoff')) return
    }
    for (const p of this.players) {
      if (p === taker) { if (!(humanTaker && this.ctl[a].pen?.run)) { p.vx = p.vy = 0 } continue }
      if (p.diveT > 0) { this.updDive(p, dt); continue }
      if ((p === this.ctrl[0] || p === this.ctrl[1]) && !(this.so)) continue
      this.steer(p, dt, false)
    }
    // a CPU penalty taker runs up in the last moment
    if (this.restartKind === 'penalty' && taker && !humanTaker && this.phaseT < 0.55) {
      const b = this.ball
      const d = hyp(b.x - taker.x, b.y - taker.y)
      if (d > 0.6) { taker.vx = (b.x - taker.x) / d * 4; taker.vy = (b.y - taker.y) / d * 4 }
    }
    this.integrate(dt)
    if (this.phase === 'kickoff') this.kickoffShape()
    this.updateCam(dt)
    if (!humanTaker && this.phaseT <= 0) this.cpuSetPiece()
    else if (humanTaker && this.phaseT < -15) this.cpuSetPiece() // nobody at the controls
  }

  // ------------------------------------------------------------------------------------------------ human control
  private humanTick(side: Side, dt: number) {
    const c = this.ctl[side]
    if (c.pr & BTN.START) { this.pause('user'); return }
    if (c.pr & BTN.UP) this.shiftMentality(side, 1)
    if (c.pr & BTN.DOWN) this.shiftMentality(side, -1)
    if (c.pr & BTN.LEFT) this.emit({ k: 'cam', v: -1, side })
    if (c.pr & BTN.RIGHT) this.emit({ k: 'cam', v: 1, side })
    c.switchCd = Math.max(0, c.switchCd - dt)
    let p = this.ctrl[side]
    if (!p || !this.teams[side].includes(p)) { p = this.bestDefender(side, null); this.ctrl[side] = p }
    if (!p) return
    const b = this.ball
    p.jockey = false; p.shield = false
    const restart = this.phase === 'restart' || this.phase === 'kickoff'
    const has = b.owner === p
    // human keeper with the ball in his hands / at his feet: distribution
    const flick = this.readFlick(c)
    if (flick != null) {
      if (has && !p.skill && !restart && !p.isGK) this.pushFlick(c, p, flick)
      else if (!has) this.switchDir(side, flick)
    }
    if (has && !restart) this.resolveCombo(side, p)
    if (restart && !has) {
      // waiting for the other side's set piece: move and switch only
      if (c.pr & BTN.LB) this.switchNearest(side)
      this.moveHuman(side, p, dt, 'def')
      return
    }
    if (this.phase === 'kickoff' && has && (hyp(c.x, c.y) > 0.3 || (c.pr & (BTN.A | BTN.B | BTN.X | BTN.Y)))) {
      this.phase = 'play'
      b.fixed = false
      for (const q of this.players) q.hold = false
      // pass with the stick idle: to the nearest teammate, as the computer kicks off (everyone else is behind the
      // ball, so "straight ahead" rolled it into the other half and gave it away)
      if (hyp(c.x, c.y) <= 0.3 && (c.pr & BTN.A) && !(c.held & (BTN.LB | BTN.RB))) {
        const m = this.teams[side].filter(q => q !== p && !q.isGK).sort((x, y) => hyp(x.x - b.x, x.y - b.y) - hyp(y.x - b.x, y.y - b.y))[0]
        if (m) { this.passTo(p, m, 'ground', this.assist.pass ? 0.85 : 1); if (side === 0) this.acts.passes++; return }
      }
    }
    const ctx = this.contextOf(side)
    if (ctx === 'att') this.attackButtons(side, p, has)
    else this.defendButtons(side, p)
    if (this.phase !== 'play' && this.phase !== 'kickoff') return
    p = this.ctrl[side]
    if (!p) return
    if (b.owner === p && this.tick % 4 === 0) {
      const mag = hyp(c.x, c.y)
      c.tgt = mag > 0.3 ? this.pickTarget(p, Math.atan2(c.y, c.x), 'ground') : null
    } else if (b.owner !== p) c.tgt = null
    this.moveHuman(side, p, dt, ctx)
  }

  private attackButtons(side: Side, p: MP, has: boolean) {
    const c = this.ctl[side], prs = c.pr
    const mods = c.held & (BTN.LB | BTN.RB)
    if (has && c.charge?.kind === 'shot' && (prs & BTN.A)) {
      // fake shot: cancel the shot with pass
      c.charge = null
      const side_ = this.stickSide(c, p)
      this.startSkill(p, 'fakeshot', side_)
      return
    }
    if (prs & BTN.A) this.act(side, p, has, mods & BTN.RB ? 'driven' : mods & BTN.LB ? 'passgo' : 'pass')
    else if (prs & BTN.Y) this.act(side, p, has, mods & BTN.LB ? 'loftThrough' : 'through')
    else if (prs & BTN.X) this.act(side, p, has, mods & BTN.RB ? 'lowCross' : mods & BTN.LB ? 'earlyCross' : 'lob')
    if (prs & BTN.B) c.charge = { kind: 'shot', t0: this.clock, mods: c.held }
    if (c.charge?.kind === 'shot' && (c.rl & BTN.B)) {
      const pw = clamp(this.chargePower(c), 0.12, 1)
      const m = c.charge.mods | c.held
      const sk: ShotKind = (m & BTN.LB) && (m & BTN.RB) ? 'driven' : m & BTN.RB ? 'finesse' : m & BTN.LB ? 'chip' : 'normal'
      c.charge = null
      const own = this.ball.owner === p
      if (own && p.isGK) this.clearBall(p) // a keeper's "shot" is a long kick
      else if (own) this.humanShoot(side, p, pw, sk, false)
      else if (this.reachable(p)) this.humanShoot(side, p, pw, this.ball.z > 0.45 ? 'volley' : sk, true)
      else c.queued = { act: 'shoot', t: this.clock, power: pw, sk }
    }
    // keeper with the ball: kick it long with B if not charging
  }

  private act(side: Side, p: MP, has: boolean, kind: HumanPass) {
    const c = this.ctl[side]
    if (has) { this.humanPass(side, p, kind, false); return }
    if (this.reachable(p)) { this.humanPass(side, p, kind, true); return }
    c.queued = { act: kind, t: this.clock, power: 0.6, sk: 'normal' }
  }

  private reachable(p: MP) {
    const b = this.ball
    if (b.owner || b.inNet) return false
    if (b.kicker === p && b.kickCd > 0) return false
    return hyp(b.x - p.x, b.y - p.y) < 1.35 && b.z < 1.1
  }

  private defendButtons(side: Side, p: MP) {
    const c = this.ctl[side], prs = c.pr
    if (prs & BTN.LB) this.switchNearest(side)
    p = this.ctrl[side] ?? p
    if (prs & BTN.B) { this.tackle(p); if (side === 0) this.acts.tackles++ }
    if (prs & BTN.X) {
      const b = this.ball
      const d = hyp(b.x - p.x, b.y - p.y)
      const a = d < 5 ? Math.atan2(b.y + b.vy * 0.25 - p.y, b.x + b.vx * 0.25 - p.x) : hyp(c.x, c.y) > 0.3 ? Math.atan2(c.y, c.x) : p.face
      this.startSlide(p, a)
    }
    c.pressCall = !!(c.held & BTN.RB)
    c.rush = !!(c.held & BTN.Y)
  }

  private chargePower(c: Ctl) { return c.charge ? Math.min(1, (this.clock - c.charge.t0) * 1.1) : 0 }

  /** Right stick (pads) or skill key + direction (keyboard): returns the flick angle or null. */
  private readFlick(c: Ctl): number | null {
    const m = hyp(c.rx, c.ry)
    if (m < 0.35) c.rsArmed = true
    if (c.rsArmed && m > 0.72) { c.rsArmed = false; return Math.atan2(c.ry, c.rx) }
    if (c.held & BTN.SKILL) {
      const kx = Math.sign(c.x), ky = Math.sign(c.y)
      const changed = (kx !== c.lastKb[0] || ky !== c.lastKb[1]) && (kx !== 0 || ky !== 0)
      c.lastKb = [kx, ky]
      if (changed) return Math.atan2(ky, kx)
    } else c.lastKb = [Math.sign(c.x), Math.sign(c.y)]
    return null
  }

  private stickSide(c: Ctl, p: MP) {
    if (hyp(c.x, c.y) < 0.3) return rnd() < 0.5 ? -1 : 1
    return angDiff(Math.atan2(c.y, c.x), p.face) >= 0 ? 1 : -1
  }

  private pushFlick(c: Ctl, p: MP, a: number) {
    const d = angDiff(a, p.face)
    const ad = Math.abs(d)
    const tok: Flick = ad <= 0.87 ? { d: 'F', s: 0, t: this.clock } : ad >= 2.27 ? { d: 'B', s: 0, t: this.clock } : { d: 'S', s: d > 0 ? 1 : -1, t: this.clock }
    // sprint + forward flick = knock-on, at once
    if (tok.d === 'F' && (c.held & BTN.RT) && c.flicks.length === 0) { this.knockOn(p, true, a); return }
    c.flicks = c.flicks.filter(f => this.clock - f.t < 0.7)
    c.flicks.push(tok)
    if (c.flicks.length > 3) c.flicks.shift()
    c.comboAt = this.clock + (comboPending(c.flicks) ? 0.2 : 0)
  }

  private resolveCombo(side: Side, p: MP) {
    const c = this.ctl[side]
    if (!c.flicks.length || this.clock < c.comboAt) return
    const toks = c.flicks
    c.flicks = []
    for (let n = Math.min(3, toks.length); n >= 1; n--) {
      const suf = toks.slice(toks.length - n)
      for (const k of SKILLS) {
        if (k.seq.length !== n) continue
        const s = matchCombo(k.seq, suf)
        if (s === null) continue
        if (k.id === 'knock') this.knockOn(p, false, p.face)
        else this.startSkill(p, k.id, s || (rnd() < 0.5 ? -1 : 1))
        return
      }
    }
  }

  private switchNearest(side: Side) {
    const c = this.ctl[side]
    const cur = this.ctrl[side]
    const best = this.bestDefender(side, cur)
    if (best) { this.ctrl[side] = best; c.switchCd = 0.6; if (side === 0) this.acts.switches++ }
  }

  private switchDir(side: Side, a: number) {
    const cur = this.ctrl[side]
    if (!cur) return
    let best: MP | null = null, bs = 1e9
    for (const p of this.teams[side]) {
      if (p === cur || p.isGK) continue
      const dx = p.x - cur.x, dy = p.y - cur.y, d = hyp(dx, dy)
      const diff = Math.abs(angDiff(Math.atan2(dy, dx), a))
      if (diff > 0.85) continue
      const s = d * (1 + diff)
      if (s < bs) { bs = s; best = p }
    }
    if (best) { this.ctrl[side] = best; this.ctl[side].switchCd = 0.6 }
  }

  bestDefender(side: Side, exclude: MP | null): MP | null {
    const b = this.ball
    const tx = b.x + b.vx * 0.35, ty = b.y + b.vy * 0.35
    let best: MP | null = null, bs = 1e9
    for (const p of this.teams[side]) {
      if (p.isGK || p === exclude) continue
      const t = hyp(p.x - tx, p.y - ty) / p.maxSpeed()
      if (t < bs) { bs = t; best = p }
    }
    return best
  }

  autoSwitch(side: Side, force: boolean) {
    if (!this.human[side]) return
    const c = this.ctl[side]
    if (c.switchCd > 0 && !force) return
    const cur = this.ctrl[side]
    // our own pass, cross or lob still in the air: stay on the man it is meant for (so you can head your own cross)
    const b0 = this.ball
    if (!force && !b0.owner && b0.pass && b0.pass.from.team === side && b0.pass.to && b0.pass.to !== b0.pass.from && this.teams[side].includes(b0.pass.to)) {
      if (cur !== b0.pass.to) { this.ctrl[side] = b0.pass.to; c.switchCd = 0.3 }
      return
    }
    const best = this.bestDefender(side, null)
    if (!best || best === cur) return
    if (!force && cur) {
      const b = this.ball
      const dc = hyp(cur.x - b.x, cur.y - b.y), db = hyp(best.x - b.x, best.y - b.y)
      if (dc < db + 12) return
    }
    this.ctrl[side] = best
    c.switchCd = 0.4
  }

  private moveHuman(side: Side, p: MP, dt: number, ctx: Ctx) {
    const c = this.ctl[side], b = this.ball
    if (p.skill || p.slideT > 0 || p.diveT > 0) return
    let ix = c.x, iy = c.y
    if (c.held & BTN.SKILL) { ix = 0; iy = 0 }
    const sprint = !!(c.held & BTN.RT)
    const has = b.owner === p
    const ms = p.maxSpeed()
    const mag = Math.min(1, hyp(ix, iy))
    if (ctx === 'def' && (c.held & BTN.A) && b.owner && b.owner.team !== side) {
      // contain: close the carrier down, staying goal-side
      const o = b.owner
      const ga = Math.atan2(CY - o.y, this.ownGoalX(side) - o.x)
      const tx = o.x + Math.cos(ga) * 2.2 + o.vx * 0.12, ty = o.y + Math.sin(ga) * 2.2 + o.vy * 0.12
      const dx = tx - p.x, dy = ty - p.y, d = hyp(dx, dy)
      const sp = Math.min(ms * (sprint ? 0.95 : 0.78), d * 2.5)
      if (d > 0.05) this.accel(p, (dx / d) * sp, (dy / d) * sp, dt, 1.3)
      p.faceLock = Math.atan2(o.y - p.y, o.x - p.x)
      p.jockey = true
      p.sprint = sprint
      return
    }
    // assisted reception: with the stick idle, the intended receiver runs onto the ball by himself
    if (mag < 0.15 && !has && !b.owner && p.receiveT > 0 && b.pass?.to === p) {
      const [tx, ty] = this.interceptPoint(p)
      const dx = tx - p.x, dy = ty - p.y, d = hyp(dx, dy)
      const sp = Math.min(ms * (d > 4 ? 1 : 0.8), d * 3)
      if (d > 0.1) this.accel(p, (dx / d) * sp, (dy / d) * sp, dt)
      else this.accel(p, 0, 0, dt)
      p.sprint = d > 4
      return
    }
    const jockey = ctx === 'def' && !!(c.held & BTN.LT)
    const shield = has && !!(c.held & BTN.LT)
    let f = sprint ? 1 : 0.72
    if (has) f *= Math.min(1, 0.82 + p.s.dribbling * 0.0012)
    if (shield) f = 0.42
    if (jockey) f = 0.56
    if (c.charge) f *= 0.6
    if (p.isGK && has && b.hands) f = Math.min(f, 0.5)
    const sp = ms * f * mag
    if (mag > 0.05) this.accel(p, (ix / hyp(ix, iy)) * sp, (iy / hyp(ix, iy)) * sp, dt, jockey ? 1.6 : has ? 0.9 + p.s.dribbling / 500 : 1)
    if (side === 0 && mag > 0.3) this.acts.moved += hyp(p.vx, p.vy) * dt
    else this.accel(p, 0, 0, dt, jockey ? 1.6 : 1)
    p.sprint = sprint && mag > 0.2
    if (jockey && b.owner) { p.faceLock = Math.atan2(b.owner.y - p.y, b.owner.x - p.x); p.jockey = true }
    if (shield) {
      const o = this.nearestOf(this.opp(side), p.x, p.y)
      if (o && hyp(o.x - p.x, o.y - p.y) < 4) p.faceLock = Math.atan2(p.y - o.y, p.x - o.x)
      p.shield = true
    }
    // a keeper holding the ball in his hands stays in his area (aiCarriers plays it after a while)
    if (p.isGK && has && b.hands) {
      if (this.ownX(side, p.x) > BOX_D - 0.8) { p.x = this.world(side, BOX_D - 0.8, 0)[0]; p.vx = 0 }
      if (Math.abs(p.y - CY) > BOX_HW - 0.8) { p.y = CY + Math.sign(p.y - CY) * (BOX_HW - 0.8); p.vy = 0 }
    }
  }

  // ------------------------------------------------------------------------------------------------ human set pieces
  private humanSetPiece(side: Side, dt: number) {
    const c = this.ctl[side], p = this.setTaker!, b = this.ball, kind = this.restartKind
    if (c.pr & BTN.START) { this.pause('user'); return }
    if (!c.aim) c.aim = { x: this.goalX(side), y: CY, curl: 0 }
    const aim = c.aim
    if (kind === 'penalty') { this.humanPenalty(side, dt); return }
    aim.x = clamp(aim.x + c.x * dt * 24, -0.5, L + 0.5)
    aim.y = clamp(aim.y + c.y * dt * 24, 0.5, W - 0.5)
    if (Math.abs(c.rx) > 0.3) aim.curl = clamp(c.rx, -1, 1)
    if (c.pr & BTN.LB) aim.curl = clamp(aim.curl - 0.34, -1, 1)
    if (c.pr & BTN.RB) aim.curl = clamp(aim.curl + 0.34, -1, 1)
    if (kind !== 'throw') p.faceLock = Math.atan2(aim.y - b.y, aim.x - b.x)
    if (c.pr & BTN.A) { this.spPass(p, aim.x, aim.y, 'ground'); return }
    if ((c.pr & BTN.Y) && kind !== 'throw') { this.spPass(p, aim.x, aim.y, 'through'); return }
    if (c.pr & BTN.X) c.charge = { kind: 'spCross', t0: this.clock, mods: 0 }
    if ((c.pr & BTN.B) && kind === 'free') c.charge = { kind: 'spShot', t0: this.clock, mods: 0 }
    if (c.charge && (c.rl & (c.charge.kind === 'spCross' ? BTN.X : BTN.B))) {
      const pw = this.chargePower(c)
      const k = c.charge.kind
      c.charge = null
      if (k === 'spCross') this.spLob(p, aim.x, aim.y, pw, aim.curl * 0.045)
      else this.spShot(p, aim.y, pw, aim.curl * 0.045)
    }
  }

  private humanPenalty(side: Side, dt: number) {
    const c = this.ctl[side], p = this.setTaker!, b = this.ball
    const aim = c.aim!
    aim.x = this.goalX(side)
    // the reticle stays inside the posts: a firm, well-placed kick should beat a keeper who guesses wrong
    aim.y = clamp(aim.y + c.y * dt * 4.5, CY - GOAL_HALF + 0.6, CY + GOAL_HALF - 0.6)
    if (!c.pen) c.pen = { run: false, released: false, power: 0, chip: false, stut: 0, stutUsed: false }
    const pen = c.pen
    if (!pen.run && (c.pr & BTN.B)) { pen.run = true; c.charge = { kind: 'pen', t0: this.clock, mods: c.held } }
    if (!pen.run && (c.pr & BTN.X)) { pen.run = true; pen.released = true; pen.chip = true; pen.power = 0.5 } // lob button: Panenka
    if (!pen.run) { p.vx = p.vy = 0; return }
    if ((c.pr & BTN.LT) && !pen.stutUsed && !pen.released) { pen.stutUsed = true; pen.stut = 0.45 }
    if (c.charge && (c.rl & BTN.B)) {
      pen.power = this.chargePower(c)
      pen.chip = pen.chip || !!((c.held | c.charge.mods) & BTN.LB)
      pen.released = true
      c.charge = null
    }
    const d = hyp(b.x - p.x, b.y - p.y)
    if (pen.stut > 0) { pen.stut -= dt; p.vx *= 0.8; p.vy *= 0.8 }
    else if (d > 0.62) { const sp = 3.6; p.vx = (b.x - p.x) / d * sp; p.vy = (b.y - p.y) / d * sp }
    else { p.vx = p.vy = 0 }
    // a nervy keeper may go early when the taker is about to strike
    const gk = this.gk(this.opp(side))
    if (gk && gk.diveT <= 0 && !this.human[gk.team] && d < 1.3 && !gk.committed && rnd() < (pen.stutUsed ? 0.04 : 0.012) * (1.4 - gk.s.goalkeeping / 120) * 60 * dt) {
      gk.committed = true // so it only happens once
      this.dive(gk, rnd() < 0.5 ? -1 : 1)
    }
    if (d <= 0.7 && pen.released) {
      this.penaltyKick(p, pen.power, aim.y, pen.chip)
      c.pen = null
    }
  }

  /** The keeper's side during a penalty: press a face button to go early, otherwise the stick at the kick decides. */
  private humanKeeperWait(side: Side) {
    const c = this.ctl[side]
    if (c.pr & BTN.START) { this.pause('user'); return }
    const gk = this.gk(side)
    if (!gk || gk.diveT > 0) return
    if (c.pr & (BTN.A | BTN.B | BTN.X | BTN.Y | BTN.LB | BTN.RB)) {
      const dirY = Math.abs(c.y) > 0.3 ? Math.sign(c.y) : 0
      if (dirY) this.dive(gk, dirY)
      gk.committed = true
    }
  }

  private spPass(p: MP, ax: number, ay: number, kind: 'ground' | 'through') {
    const t = p.team
    const kindR = this.restartKind
    const mates = this.teams[t].filter(m => m !== p)
    let best: MP | null = null, bd = 9
    for (const m of mates) { const d = hyp(m.x - ax, m.y - ay); if (d < bd) { bd = d; best = m } }
    if (kindR === 'throw') { this.pass(p, best ? best.x + best.vx * 0.3 : ax, best ? best.y + best.vy * 0.3 : ay, 'throw', { target: best, exempt: true }); return }
    if (best && kind === 'through') { const [tx, ty] = this.throughPoint(p, best, false); this.pass(p, tx, ty, 'through', { target: best, exempt: kindR === 'goalkick' }); return }
    this.pass(p, best ? best.x : ax, best ? best.y : ay, 'ground', { target: best, exempt: kindR === 'goalkick' || kindR === 'corner' })
  }

  private spLob(p: MP, ax: number, ay: number, power: number, curl: number) {
    const t = p.team, kindR = this.restartKind
    let best: MP | null = null, bd = 7
    for (const m of this.teams[t]) { if (m === p) continue; const d = hyp(m.x - ax, m.y - ay); if (d < bd) { bd = d; best = m } }
    if (power > 0.95) { const dx = ax - this.ball.x, dy = ay - this.ball.y; ax += dx * 0.18; ay += dy * 0.18 } // overhit
    const kind: PassKind = kindR === 'throw' ? 'longThrow' : kindR === 'goalkick' ? 'goalkick' : kindR === 'corner' || (this.ownX(t, ax) > L - 22) ? 'cross' : 'lofted'
    this.pass(p, ax, ay, kind, { target: best, curl, power, exempt: kindR !== 'free' })
  }

  private spShot(p: MP, aimY: number, power: number, curl: number) {
    this.shoot(p, power, clamp(aimY, CY - GOAL_HALF - 0.5, CY + GOAL_HALF + 0.5), 'fk', curl)
  }

  penaltyKick(p: MP, power: number, aimY: number, chip: boolean) {
    const gk = this.gk(this.opp(p.team))
    this.shoot(p, power, chip ? CY + (aimY - CY) * 0.12 : aimY, chip ? 'panenka' : 'pen')
    if (gk && gk.diveT <= 0 && !gk.committed) {
      if (this.human[gk.team]) {
        const c = this.ctl[gk.team]
        if (Math.abs(c.y) > 0.35) this.dive(gk, Math.sign(c.y))
      } else {
        // the computer guesses; a good keeper sometimes reads the taker
        const read = rnd() < (Math.min(gk.s.goalkeeping, 110) - 50) / 400
        const r = rnd()
        const side = read ? Math.sign(aimY - gk.y) || 1 : r < 0.42 ? -1 : r < 0.84 ? 1 : 0
        if (side) this.dive(gk, side)
      }
    }
    if (gk) gk.committed = false
  }

  dive(gk: MP, dir: number) {
    gk.diveT = 0.55
    gk.diveV = dir * (4 + Math.min(gk.s.goalkeeping, 110) / 45)
    gk.face = dir > 0 ? Math.PI / 2 : -Math.PI / 2
  }

  // ------------------------------------------------------------------------------------------------ human passing & shooting
  private humanPass(side: Side, p: MP, kind: HumanPass, first: boolean) {
    const c = this.ctl[side]
    const mag = hyp(c.x, c.y)
    const a = mag > 0.3 ? Math.atan2(c.y, c.x) : p.face
    const err = (first ? 1.22 : 1) * (this.assist.pass ? 0.85 : 1)
    if (side === 0) { if (kind === 'through' || kind === 'loftThrough') this.acts.through++; else if (kind === 'pass' || kind === 'driven' || kind === 'passgo') this.acts.passes++ }
    const t = p.team
    const ox = this.ownX(t, p.x), oy = this.ownY(t, p.y)
    const wide = Math.abs(oy - CY) > 12 && ox > 60
    switch (kind) {
      case 'pass': case 'driven': case 'passgo': {
        const m = this.pickTarget(p, a, 'ground')
        if (m) this.passTo(p, m, kind === 'driven' ? 'driven' : 'ground', err)
        else this.passSpace(p, a, kind === 'driven' ? 20 : 14, 'ground', err)
        if (kind === 'passgo') {
          const [rx, ry] = this.world(t, clamp(ox + 14, 0, L - 6), clamp(oy + (CY - oy) * 0.25, 4, W - 4))
          p.runT = 2.8; p.runX = rx; p.runY = ry
          c.oneTwo = { runner: p, until: this.clock + 3.5 }
          if (rnd() < 0.3) this.say('oneTwo', { name: p.data.name })
        }
        break
      }
      case 'through': case 'loftThrough': {
        const m = this.pickTarget(p, a, 'through')
        if (m) { const [tx, ty] = this.throughPoint(p, m, kind === 'loftThrough'); this.pass(p, tx, ty, kind, { target: m, err }) }
        else this.passSpace(p, a, kind === 'loftThrough' ? 24 : 18, kind, err)
        break
      }
      default: {
        if ((wide || kind !== 'lob') && ox > 55) {
          const m = this.crossTarget(p, mag > 0.3 ? a : null)
          const ck: PassKind = kind === 'lob' ? 'cross' : kind
          if (m) { const [tx, ty] = this.crossPoint(m); this.pass(p, tx, ty, ck, { target: m, err }) }
          else { const [tx, ty] = this.world(t, L - 8, CY); this.pass(p, tx, ty, ck, { err }) }
          if (rnd() < 0.4) this.say('cross', { name: p.data.name })
        } else {
          const m = this.pickTarget(p, a, 'lob')
          if (m) this.passTo(p, m, 'lofted', err)
          else this.passSpace(p, a, 24, 'lofted', err)
        }
      }
    }
  }

  private humanAimY(side: Side) {
    const c = this.ctl[side]
    if (Math.abs(c.y) > 0.25) return CY + clamp(c.y, -1, 1) * (this.assist.shot ? 2.7 : 3.45)
    const gk = this.gk(this.opp(side))
    return gk && gk.y < CY ? CY + 2.6 : CY - 2.6
  }

  private humanShoot(side: Side, p: MP, power: number, kind: ShotKind, first: boolean) {
    const c = this.ctl[side]
    if (side === 0) this.acts.shots++
    let aimY = this.humanAimY(side)
    if (kind === 'finesse' && Math.abs(c.y) <= 0.25) aimY = CY + (p.y < CY ? 1 : -1) * 2.8
    if (kind === 'chip' && Math.abs(c.y) <= 0.25) aimY = CY + (rnd() - 0.5) * 2
    this.shoot(p, power, aimY, first && this.lastBallZ > 0.45 && kind === 'normal' ? 'volley' : kind)
  }

  /** Best teammate in a direction: angle, distance, space and runs count. */
  pickTarget(p: MP, a: number, mode: 'ground' | 'through' | 'lob'): MP | null {
    const c = this.ctl[p.team]
    // pass assist: a wider cone, and an open lane counts (the free man, not the marked one)
    const assist = !this.human[p.team] || this.assist.pass
    let best: MP | null = null, bs = -1e9
    const line = this.offsideLine(p.team)
    for (const m of this.teams[p.team]) {
      if (m === p) continue
      const dx = m.x - p.x, dy = m.y - p.y, d = hyp(dx, dy)
      if (d < 2.5) continue
      const diff = Math.abs(angDiff(Math.atan2(dy, dx), a))
      const tol = (mode === 'through' ? 0.95 : d < 14 ? 1.15 : 0.8) + (assist ? 0.3 : -0.15)
      if (diff > tol) continue
      let s = Math.cos(diff) * 2.4 - d / (mode === 'lob' ? 75 : 34) + Math.min(this.pressure(m), 8) / 12 - (m.isGK ? 1.3 : 0)
      if (mode === 'through') s += (this.ownX(p.team, m.x) - this.ownX(p.team, p.x)) / 40 + (m.runT > 0 ? 0.5 : 0)
      if (c.oneTwo && c.oneTwo.runner === m && this.clock < c.oneTwo.until) s += 1.6
      const mo = this.ownX(p.team, m.x)
      if (mo > L / 2 && mo > line + 0.3) s -= 0.35
      if (assist && mode !== 'lob') s += clamp(this.laneOpen(p.x, p.y, m.x, m.y, p.team), -1.5, 3) * 0.3
      if (s > bs) { bs = s; best = m }
    }
    return best
  }

  private crossTarget(p: MP, a: number | null): MP | null {
    const t = p.team
    let best: MP | null = null, bs = -1e9
    for (const m of this.teams[t]) {
      if (m === p || m.isGK) continue
      const ox = this.ownX(t, m.x), oy = this.ownY(t, m.y)
      if (ox < L - 24 || Math.abs(oy - CY) > 16) continue
      let s = this.aerial(m) / 40 + Math.min(this.pressure(m), 5) / 5 - Math.abs(oy - CY) / 20 + (ox > L - 12 ? 0.4 : 0)
      if (a != null) s += Math.cos(angDiff(Math.atan2(m.y - p.y, m.x - p.x), a)) * 1.5
      if (s > bs) { bs = s; best = m }
    }
    return best
  }

  private crossPoint(m: MP): [number, number] {
    const t = m.team
    const [gx, gy] = [this.goalX(t), CY]
    const a = Math.atan2(gy - m.y, gx - m.x)
    return [clamp(m.x + Math.cos(a) * 1.4 + m.vx * 0.4, 1, L - 1), clamp(m.y + Math.sin(a) * 1.4 + m.vy * 0.4, 1, W - 1)]
  }

  throughPoint(p: MP, m: MP, loft: boolean): [number, number] {
    const t = p.team
    let dx: number, dy: number
    if (m.runT > 0) { dx = m.runX - m.x; dy = m.runY - m.y } else { dx = this.dir(t); dy = (CY - m.y) * 0.02 }
    const n = hyp(dx, dy) || 1
    dx /= n; dy /= n
    const lead = clamp(5 + hyp(m.vx, m.vy) * 0.7, 5, 11) + (loft ? 3 : 0)
    let ax = m.x + dx * lead + m.vx * 0.3
    const ay = clamp(m.y + dy * lead + m.vy * 0.3, 2, W - 2)
    // not into the keeper's arms: stop short of the six-yard box
    if (this.ownX(t, ax) > L - 8) ax = this.world(t, L - 8, 0)[0]
    return [clamp(ax, 2, L - 2), ay]
  }

  passTo(p: MP, m: MP, kind: PassKind, err = 1) {
    let ax = m.x, ay = m.y
    if (kind === 'through' || kind === 'loftThrough') [ax, ay] = this.throughPoint(p, m, kind === 'loftThrough')
    else if (kind === 'cross' || kind === 'lowCross' || kind === 'earlyCross') [ax, ay] = this.crossPoint(m)
    else {
      const d0 = hyp(m.x - p.x, m.y - p.y)
      const tt = d0 / (kind === 'lofted' ? 20 : 17)
      ax = m.x + m.vx * tt * 0.8
      ay = m.y + m.vy * tt * 0.8
    }
    this.pass(p, ax, ay, kind, { target: m, err })
  }

  private passSpace(p: MP, a: number, dist: number, kind: PassKind, err: number) {
    const ax = clamp(p.x + Math.cos(a) * dist, 1, L - 1), ay = clamp(p.y + Math.sin(a) * dist, 1, W - 1)
    let best: MP | null = null, bd = 1e9
    for (const m of this.teams[p.team]) { if (m === p || m.isGK) continue; const d = hyp(m.x - ax, m.y - ay); if (d < bd) { bd = d; best = m } }
    this.pass(p, ax, ay, kind, { target: bd < 16 ? best : null, err })
  }

  // ------------------------------------------------------------------------------------------------ the ball
  kick(p: MP, vx: number, vy: number, vz: number, spin = 0, z0 = 0) {
    const b = this.ball
    b.owner = null; b.hands = false; b.fixed = false
    b.vx = vx; b.vy = vy; b.vz = vz; b.spin = spin
    b.z = Math.max(z0, vz > 0 ? 0.02 : 0)
    b.kicker = p; b.last = p; b.kickCd = 0.25; b.tried.clear(); b.shot = null; b.pass = null; b.off = null; b.inNet = false
    p.holdT = 0; p.kickT = 0.22
    if (this.phase === 'restart' || this.phase === 'kickoff') {
      this.phase = 'play'
      if (!this.so) for (const q of this.players) q.hold = false
      // a shoot-out kick gets its own 3.2 s from the moment it is struck, however long the taker lined it up
      else this.so.t = 0
    }
  }

  pass(p: MP, ax: number, ay: number, kind: PassKind, o: { target?: MP | null; err?: number; curl?: number; power?: number; exempt?: boolean } = {}) {
    const b = this.ball, t = p.team
    ax = clamp(ax, 0.5, L - 0.5); ay = clamp(ay, 0.5, W - 0.5)
    const dx = ax - b.x, dy = ay - b.y, d = Math.max(0.5, hyp(dx, dy))
    const pr = this.pressure(p)
    const ps = Math.min(p.s.passing, 110)
    const vision = p.traits.has('playmaker') ? 0.75 : p.traits.has('one_two') && (kind === 'ground' || kind === 'driven') && d < 20 ? 0.8 : 1
    const turn = Math.abs(angDiff(Math.atan2(dy, dx), p.face))
    let sigma = (1 - ps / 110) * 0.16 * (o.err ?? 1) * (pr < 2.2 ? 1.45 : 1) * vision * (1 + (1 - p.stamina) * 0.4) * (turn > 1.9 && kind !== 'throw' && kind !== 'longThrow' ? 1.35 : 1)
    if (kind === 'cross' || kind === 'lowCross' || kind === 'earlyCross') sigma *= 0.9
    if (kind === 'throw' || kind === 'longThrow') sigma *= 0.6
    if (kind === 'clear') sigma = 0.35
    const curl = o.curl ?? 0
    if ((kind === 'cross' || kind === 'lowCross' || kind === 'earlyCross') && this.phase === 'play' && pr < 1.7 && rnd() < 0.34) {
      // the defender closing him down gets a block in: the ball flies off him behind or over the line
      const blocker = this.nearestOf(this.opp(t), p.x, p.y)
      if (blocker) {
        const out = Math.abs(p.y - CY) > 20 && rnd() < 0.4
        const side = p.y < CY ? -1 : 1
        const a = (out ? Math.atan2(side, this.dir(t) * 0.3) : Math.atan2(side * 0.48, this.dir(t) * 0.88)) + gauss() * 0.25
        this.kick(p, Math.cos(a) * (8 + rnd() * 4), Math.sin(a) * (8 + rnd() * 4), 2 + rnd() * 2)
        b.last = blocker; b.kicker = blocker; b.kickCd = 0.2
        this.stats.passes[t]++
        this.emit({ k: 'tackle', v: 0.5 })
        if (rnd() < 0.5) this.say('blocked', { name: blocker.data.name })
        return
      }
    }
    const ang = Math.atan2(dy, dx) - (curl * d) / 2 + gauss() * sigma
    let speed: number, vz = 0, z0 = 0
    const pw = o.power ?? 0.5
    switch (kind) {
      case 'ground': speed = clamp(d * 0.95 + 6, 9, 26); break
      case 'driven': speed = clamp(d * 1.05 + 9, 13, 30); break
      case 'through': speed = clamp(d * 0.9 + 4.5, 9, 25); break
      case 'lofted': case 'loftThrough': case 'goalkick': case 'clear': {
        const T = (kind === 'lofted' ? 0.75 : kind === 'clear' ? 1.1 : 0.9) + d / (kind === 'goalkick' ? 30 : 34)
        speed = (d / T) * 0.97
        vz = (9.8 * T) / 2
        break
      }
      case 'cross': { speed = clamp(d * 0.55 + 8, 13, 23) * (0.8 + pw * 0.4); const T = d / speed; vz = (1.7 + 4.9 * T * T) / T; break }
      case 'earlyCross': { speed = clamp(d * 0.6 + 10, 16, 26); const T = d / speed; vz = (1.4 + 4.9 * T * T) / T; break }
      case 'lowCross': speed = clamp(d * 0.8 + 9, 16, 28); vz = 1.3; break
      case 'throw': { z0 = 1.9; speed = clamp(d * 0.9 + 3, 6, 15); const T = d / speed; vz = (0.4 - z0 + 4.9 * T * T) / T; break }
      case 'longThrow': { z0 = 1.9; speed = clamp(d * 0.7 + 6, 10, 19); const T = d / speed; vz = (1.2 - z0 + 4.9 * T * T) / T; break }
      case 'header': { z0 = Math.max(1, b.z); speed = clamp(d * 0.8 + 4, 6, 16); const T = d / speed; vz = (0.3 - z0 + 4.9 * T * T) / T; break }
      default: speed = clamp(d * 0.95 + 4, 6, 18)
    }
    speed *= 1 + gauss() * sigma * 0.4
    if (kind !== 'throw' && kind !== 'longThrow') p.face = ang
    const target = o.target ?? null
    this.kick(p, Math.cos(ang) * speed, Math.sin(ang) * speed, vz, curl, z0)
    b.pass = { from: p, to: target, kind, t: this.clock }
    if (!o.exempt) this.markOffside(p)
    if (target) {
      const air = speed > 0 ? d / speed : 1
      target.receiveT = air + 1.2; target.rx = ax; target.ry = ay
    }
    this.lastPass = { p, t: this.now() }
    if (kind !== 'clear' && kind !== 'header') { this.stats.passes[t]++; if (kind !== 'knock' && kind !== 'skill') this.pstat(p).ps++ }
    if (this.human[t] && target) { this.ctrl[t] = target; this.ctl[t].switchCd = 0.3; this.ctl[t].tgt = null }
    const long = kind === 'lofted' || kind === 'loftThrough' || kind === 'goalkick' || kind === 'clear' || kind === 'longThrow' || kind.endsWith('ross')
    this.emit({ k: 'pass', v: clamp(speed / 28, 0.15, 1), s: long ? 'long' : kind })
  }

  shoot(p: MP, power: number, aimY: number, kind: ShotKind, curlIn = 0) {
    const b = this.ball, t = p.team
    const gx = this.goalX(t)
    const z0 = kind === 'header' || kind === 'volley' ? Math.max(b.z, kind === 'header' ? 1.5 : 0.5) : 0
    const dx = gx - b.x, dy = aimY - b.y, dist = Math.max(1, hyp(dx, dy))
    const sh = Math.min(p.s.shooting, 110)
    const pr = this.pressure(p)
    let sigma = (1 - sh / 115) * 0.1 + power * power * 0.035 + (dist > 25 ? 0.025 : 0) + (pr < 1.8 ? 0.035 : 0)
    sigma *= 1 + (1 - p.stamina) * 0.45
    const turn = Math.abs(angDiff(Math.atan2(dy, dx), p.face))
    if (turn > 1.7 && kind !== 'header' && kind !== 'pen' && kind !== 'panenka' && kind !== 'fk') sigma *= 1 + (turn - 1.7) * 0.45
    if (p.traits.has('long_shot') && dist > 20) sigma *= 0.7
    if (p.traits.has('poacher') && dist < 14) sigma *= 0.65
    if (this.bigGame && p.traits.has('big_game')) sigma *= 0.9
    let speed = 16 + power * 18 * (0.62 + sh / 260) + Math.max(0, dist - 18) * 0.25 + (p.traits.has('long_shot') && dist > 20 ? 2.5 : 0)
    let zT: number
    let spin = curlIn
    const miss = 1 - sh / 110
    switch (kind) {
      case 'driven': speed *= 1.07; sigma *= 1.08; zT = 0.12 + power * 0.45 + Math.abs(gauss()) * 0.25 * miss; break
      case 'finesse': speed *= 0.8; sigma *= 0.82; zT = 0.5 + power * 1.0 + gauss() * 0.35 * miss; spin = finesseSpin(b.x, b.y, gx, aimY, power); break
      case 'chip': speed = clamp(dist * 0.62 + 4, 9, 18); sigma *= 0.9; zT = 0.7 + power * 1.6 + gauss() * 0.3; break
      case 'volley': sigma *= 1.35; zT = 0.4 + power * 1.6 + gauss() * 0.6 * miss; break
      case 'header': {
        const hs = (sh * 0.45 + Math.min(p.s.physical, 110) * 0.35 + (p.traits.has('aerial') ? 18 : 0)) / 100
        sigma = (1.15 - hs) * 0.14 + (pr < 1.5 ? 0.03 : 0)
        speed = 10 + Math.min(p.s.physical, 110) * 0.06 + hyp(b.vx, b.vy) * 0.2
        zT = 0.2 + Math.abs(gauss()) * 0.6 + Math.max(0, 1 - hs) * 0.8
        break
      }
      case 'pen': {
        const nerve = (p.traits.has('big_game') ? 0.75 : 1) * (this.so && this.so.k[0].length >= 5 ? 1.15 : 1)
        sigma = ((1 - sh / 115) * 0.04 + power * power * 0.02) * nerve
        speed = 19 + power * 13 * (0.6 + sh / 250)
        zT = 0.15 + power * 2.0 + gauss() * 0.22 * (1 - sh / 115) * nerve
        break
      }
      case 'panenka': sigma = 0.02; speed = 10.5; zT = 1.4 + gauss() * 0.15; break
      case 'fk': speed = 16 + power * 9 + sh * 0.02; sigma = (1 - sh / 115) * 0.08 + power * power * 0.03 + 0.012; zT = 0.6 + power * 1.9 + gauss() * 0.3 * miss; break
      default: zT = 0.25 + power * 1.5 + gauss() * 0.5 * miss + (power > 0.95 ? 1.4 : 0)
    }
    sigma = Math.max(0.004, sigma)
    if (!(this.human[t] && this.ctrl[t] === p)) sigma *= this.ai[t].shot
    else if (this.assist.shot && kind !== 'pen' && kind !== 'panenka') sigma *= 0.8
    const ang = Math.atan2(dy, dx) - (spin * dist) / 2 + gauss() * sigma
    const T = Math.max(0.15, dist / speed)
    const vz = Math.max(kind === 'header' ? -3 : 0.3, (zT - z0 + 4.9 * T * T) / T)
    if (kind !== 'header') p.face = ang
    this.kick(p, Math.cos(ang) * speed, Math.sin(ang) * speed, vz, spin, z0)
    const great = dist > 22 || kind === 'volley' || (kind === 'finesse' && dist > 16) || kind === 'chip' || (kind === 'header' && dist > 9) || kind === 'panenka'
    const shot: ShotInfo = { team: t, by: p, gkTried: false, t: this.clock, kind, dist, great, counted: false, minD: 99 }
    b.shot = shot
    this.shotBy = { p, at: this.clock, shot }
    if (!this.so) {
      this.stats.shots[t]++
      this.pstat(p).sh++
      this.markOffside(p)
    }
    const r: [number, number] = [0, 0]
    r[t] = 0.35 + power * 0.5
    this.emit({ k: kind === 'header' ? 'head' : 'shot', v: clamp(speed / 32, 0.3, 1), s: kind, r, side: t })
    if (!this.so && !this.fast) {
      if (dist > 24 && rnd() < 0.5) this.say('longShot', { name: p.data.name })
      else if (dist < 13 && kind !== 'pen' && kind !== 'panenka') { this.emit({ k: 'chance', side: t }); if (rnd() < 0.5) this.say('chance', { name: p.data.name }) }
    }
  }

  private markOffside(p: MP) {
    const t = p.team, b = this.ball
    const line = this.offsideLine(t)
    let off: MP[] | null = null
    for (const m of this.teams[t]) {
      if (m === p) continue
      const ox = this.ownX(t, m.x)
      if (ox > L / 2 && ox > line + 0.25) (off ??= []).push(m)
    }
    b.off = off
    b.offTeam = t
  }

  private callOffside(p: MP) {
    const t = p.team
    this.stats.offsides[t]++
    this.say('offside', { name: p.data.name })
    this.emit({ k: 'whistle', v: 1 })
    this.ball.off = null
    this.setFlash(this.t('lv.f.offside'), p.x, p.y, 1.2)
    this.stoppage('free', this.opp(t), clamp(p.x, 1, L - 1), clamp(p.y, 1, W - 1), true)
  }

  private ballPhysics(dt: number) {
    const b = this.ball
    if (b.owner) return
    b.kickCd = Math.max(0, b.kickCd - dt)
    const px = b.x, py = b.y, pz = b.z
    if (b.spin !== 0) {
      const sp = hyp(b.vx, b.vy)
      if (sp > 0.5) {
        const a = b.spin * sp * dt, c = Math.cos(a), s = Math.sin(a)
        const vx = b.vx * c - b.vy * s
        b.vy = b.vx * s + b.vy * c
        b.vx = vx
      }
    }
    if (b.z > 0 || b.vz > 0) {
      b.vz -= 9.8 * dt
      b.z += b.vz * dt
      const drag = 1 - (this.weather === 'wind' ? 0.08 : 0.05) * dt
      b.vx *= drag; b.vy *= drag
      if (this.weather === 'wind') b.vy += 0.35 * dt
      if (b.z <= 0) {
        b.z = 0
        if (b.vz < -2) {
          b.vz = -b.vz * (this.weather === 'rain' ? 0.32 : this.weather === 'snow' ? 0.25 : 0.45)
          const keep = this.weather === 'rain' ? 0.9 : this.weather === 'snow' ? 0.7 : 0.8
          b.vx *= keep; b.vy *= keep; b.spin *= 0.4
        } else { b.vz = 0; b.spin *= 0.3 }
      }
    } else {
      const fr = this.weather === 'rain' ? 0.75 : this.weather === 'snow' ? 1.45 : 1
      const k = Math.exp(-0.95 * fr * dt)
      b.vx *= k; b.vy *= k
      b.spin *= Math.exp(-3 * dt)
      if (hyp(b.vx, b.vy) < 0.2) { b.vx = 0; b.vy = 0 }
    }
    b.x += b.vx * dt
    b.y += b.vy * dt
    if (b.inNet) { this.netPhysics(dt); return }
    if (this.phase !== 'play') return
    if ((px <= L && b.x > L) || (px >= 0 && b.x < 0)) { if (this.goalLine(px, py, pz)) return }
    this.saveCheck()
    if (!b.owner && this.phase === 'play') this.controlStep()
  }

  private goalLine(px: number, py: number, pz: number): boolean {
    const b = this.ball
    const lineX = b.x > L ? L : 0
    const f = (lineX - px) / (b.x - px || 1e-6)
    const yc = py + (b.y - py) * f, zc = pz + (b.z - pz) * f
    const off = Math.abs(yc - CY)
    const R = 0.11
    const attacking: Side = lineX === L ? 0 : 1
    if (off < GOAL_HALF - R && zc < GOAL_H - R) { this.scoreGoal(attacking); return true }
    const postHit = Math.abs(off - GOAL_HALF) < R + 0.06 && zc < GOAL_H + 0.06
    const barHit = off < GOAL_HALF + 0.06 && Math.abs(zc - GOAL_H) < R + 0.06
    if (postHit && off < GOAL_HALF && zc < GOAL_H && rnd() < 0.4) { this.scoreGoal(attacking); return true } // in off the post
    if (postHit || barHit) {
      b.x = lineX + (lineX === L ? -0.15 : 0.15)
      b.vx = -b.vx * 0.5
      if (postHit) b.vy += Math.sign(off - GOAL_HALF || 1) * Math.sign(yc - CY || 1) * (1.5 + rnd() * 2)
      if (barHit) b.vz = zc < GOAL_H ? -Math.abs(b.vz) * 0.5 - 1 : Math.abs(b.vz) * 0.5 + 1
      b.spin = 0
      const shooter = b.shot?.by
      if (b.shot) this.say(postHit ? 'post' : 'bar', { name: shooter?.data.name ?? '' })
      const r: [number, number] = [0, 0]
      if (shooter) r[shooter.team] = 0.7
      this.emit({ k: 'post', v: 1, r, side: shooter?.team })
      this.shake = Math.max(this.shake, 0.35)
      if (this.so) { this.soResult(false); return true }
      b.shot = null
      return true
    }
    return false
  }

  private netPhysics(dt: number) {
    const b = this.ball
    const back = b.x > L / 2 ? L + 1.8 : -1.8
    const inX = b.x > L / 2 ? b.x > back : b.x < back
    if (inX) { b.x = back; b.vx = -b.vx * 0.15 }
    if (Math.abs(b.y - CY) > GOAL_HALF - 0.12) { b.y = CY + Math.sign(b.y - CY) * (GOAL_HALF - 0.12); b.vy = -b.vy * 0.2 }
    if (b.z > GOAL_H - 0.1) { b.z = GOAL_H - 0.1; b.vz = -Math.abs(b.vz) * 0.2 }
    const k = Math.exp(-3.5 * dt)
    b.vx *= k; b.vy *= k
  }

  private saveCheck() {
    const b = this.ball
    const sh = b.shot
    if (!sh || sh.gkTried) return
    const gk = this.gk(this.opp(sh.team))
    if (!gk || gk.stun > 0.3) return
    const diving = gk.diveT > 0
    const reach = 0.85 + (Math.min(gk.s.goalkeeping, 110) / 100) * 1.3 + (diving ? 0.45 : 0)
    const zMax = diving ? 2.15 : 2.6
    const now = hyp(b.x - gk.x, b.y - gk.y)
    // judge the save at the ball's closest point to him, not when it first comes into reach
    const nx = b.x + b.vx / 60
    const crossing = (b.x <= L && nx > L) || (b.x >= 0 && nx < 0)
    if (now <= reach && b.z <= zMax && now < sh.minD - 0.004 && !crossing && now > 0.3) { sh.minD = now; return }
    if (now > reach && sh.minD > reach) return
    if (b.z > zMax) return
    const d = Math.min(now, sh.minD)
    sh.gkTried = true
    const speed = hyp(b.vx, b.vy)
    const gkMul = this.ai[gk.team].gk
    const stretch = d / reach
    let p = (0.42 + (Math.min(gk.s.goalkeeping, 110) / 100) * 0.58 - (speed - 18) / 45 - stretch * stretch * 0.55) * gkMul + (gk.traits.has('reflexes') ? 0.08 : 0)
    if (sh.dist < 11) p -= (11 - sh.dist) * 0.03 // point blank
    if (sh.kind === 'finesse') p -= 0.05
    if (sh.kind === 'header') p += 0.1
    if (sh.kind === 'panenka') p += 0.35
    if (sh.kind === 'pen') p -= 0.2 // from 11 m a firm kick beats most dives, even the right way
    if (b.z > 1.9) p -= 0.08
    if (gk.beatenT > 0) p -= 0.3
    p = clamp(p, 0.06, 0.95)
    if (rnd() >= p) { b.tried.add(gk); return } // beaten: it's past him
    this.stats.saves[gk.team]++
    if (!this.so) { this.pstat(gk).sv++; if (!sh.counted && this.teams[sh.team].includes(sh.by)) this.pstat(sh.by).ot++ }
    if (!sh.counted) { sh.counted = true; this.stats.onTarget[sh.team]++ }
    const r: [number, number] = [0, 0]
    r[gk.team] = 0.5
    this.emit({ k: 'save', v: clamp(speed / 30, 0.3, 1), side: gk.team, r })
    if ((speed < 21 && !diving && rnd() < 0.65) || speed < 14) {
      this.giveBall(gk, 'hands')
      if (this.so) { this.soResult(false, true); return }
      this.say('catch', { name: gk.data.name })
      return
    }
    // parry: tipped over the bar for a corner, pushed out to the side, or back into play
    const lineD = Math.abs(gk.x - this.ownGoalX(gk.team))
    const r0 = rnd()
    if (!this.so && lineD < 3.5 && speed > 16 && r0 < 0.4) {
      // up and slowly on, timed so it is well above the bar when it crosses the line (~0.75 s)
      b.vx = -this.dir(gk.team) * Math.max(0.4, lineD / 0.75); b.vy = (b.y - CY) * 0.25 + gauss() * 1.2; b.vz = 8.6 + rnd() * 0.8
      b.z = Math.max(b.z, 0.3)
      this.say('tipOver', { name: gk.data.name })
    } else {
      if (r0 < 0.64) { b.vx *= 0.45; b.vy = Math.sign(b.y - gk.y || 1) * (6 + rnd() * 5) }
      else { b.vx = -b.vx * 0.25 + this.dir(gk.team) * 3; b.vy = (rnd() < 0.5 ? -1 : 1) * (5 + rnd() * 6) }
      b.vz = 1.5 + rnd() * 2.5
      this.say('save', { name: gk.data.name })
    }
    b.spin = 0
    b.last = gk; b.kicker = gk; b.kickCd = 0.3; b.shot = null; b.tried.clear(); b.off = null; b.pass = null
    this.setFlash(this.t('lv.f.save'), gk.x, gk.y, 1)
    if (this.so) this.soResult(false, true)
  }

  private controlStep() {
    const b = this.ball
    const high = b.z > 1.15
    const cands: MP[] = []
    let best: MP | null = null, bestD = 99
    // teammates let a fresh pass run on to its target
    const fresh = b.pass && b.pass.to && this.clock - b.pass.t < 0.8 && hyp(b.vx, b.vy) > 5 ? b.pass : null
    for (const p of this.players) {
      if (p.stun > 0.05 || p.slideT > 0 || b.tried.has(p)) continue
      if (b.kickCd > 0 && p === b.kicker) continue
      if (fresh && p.team === fresh.from.team && p !== fresh.to) continue
      if (b.shot && p.team === b.shot.team && hyp(b.vx, b.vy) > 8) continue // let your own team's shot through
      if (this.so && !p.isGK) continue
      if (p.isGK && b.shot && !b.shot.gkTried && b.shot.team !== p.team) continue
      if (p.diveT > 0 && !p.isGK) continue
      const box = p.isGK && this.inOwnBox(p.team, b.x, b.y)
      const d = hyp(b.x - p.x, b.y - p.y)
      const block = !!b.shot && b.shot.team !== p.team && !p.isGK
      const reach = box ? 1.25 + p.s.goalkeeping / 260 : block ? 0.62 : (high ? 0.95 : 0.85) + p.s.dribbling / 280 + (high && p.traits.has('aerial') ? 0.2 : 0)
      const zMax = box ? 2.75 : block ? 1.6 : 1.85 + p.s.physical / 250 + (p.traits.has('aerial') ? 0.3 : 0)
      if (d < reach && b.z < zMax) { cands.push(p); if (d < bestD) { bestD = d; best = p } }
    }
    if (!best) return
    if (high && cands.length > 1) best = this.aerialDuel(cands)
    const p = best
    const box = p.isGK && this.inOwnBox(p.team, b.x, b.y)
    if (high && !box) { this.header(p); return }
    if (box) {
      const fromOpp = !!b.last && b.last.team !== p.team
      const crowd = this.teams[this.opp(p.team)].filter(o => hyp(o.x - p.x, o.y - p.y) < 2.5).length
      const prob = b.z > 1.2 ? clamp(0.72 + p.s.goalkeeping / 400 - crowd * 0.08, 0.3, 0.96) : 0.97
      if (rnd() < prob) { this.giveBall(p, fromOpp ? 'hands' : 'control'); if (fromOpp && b.z > 1.2 && rnd() < 0.4) this.say('catch', { name: p.data.name }); return }
      // punch clear
      const a = Math.atan2(CY - p.y, this.goalX(p.team) - p.x) + gauss() * 0.7
      this.kick(p, Math.cos(a) * 14, Math.sin(a) * 14, 4)
      this.emit({ k: 'kick', v: 0.6 })
      return
    }
    const speed = hyp(b.vx, b.vy)
    const friendly = !!b.last && b.last.team === p.team
    let prob = friendly ? clamp(1.25 - speed / 30 + p.s.dribbling / 220, 0.45, 1) : clamp(0.95 - speed / 26 + p.s.defending / 150, 0.1, 0.96)
    if (b.z > 0.5) prob *= 0.85
    if (b.shot && b.shot.team !== p.team) prob *= 0.25 // a block mostly deflects
    if (this.weather === 'rain') prob -= 0.05
    const t = p.team
    const human = this.human[t] && this.ctrl[t] === p
    if (human && this.ctl[t].queued && this.clock - this.ctl[t].queued!.t < 0.8) prob = 1 // first-time strike
    if (rnd() < prob) {
      if (b.last && b.last.team !== t && human) this.log(this.t('feed.intercept', { name: p.data.name }))
      this.giveBall(p)
    } else {
      b.tried.add(p)
      const a = Math.atan2(b.vy, b.vx) + gauss() * (b.shot ? 0.8 : 0.5)
      const s = speed * (b.shot ? 0.5 : 0.65)
      if (b.shot && b.shot.team !== t) {
        b.vz = Math.abs(gauss()) * 3
        this.emit({ k: 'tackle', v: 0.3 })
        if (s < 10) b.shot = null // killed: the keeper may now just pick it up
      }
      b.vx = Math.cos(a) * s; b.vy = Math.sin(a) * s
      if (b.last && b.last.team !== t) { b.off = null; b.pass = null }
      b.last = p
    }
  }

  private aerialDuel(cands: MP[]): MP {
    const b = this.ball
    let best = cands[0], bs = -1e9
    for (const p of cands) {
      const d = hyp(b.x - p.x, b.y - p.y)
      const s = Math.min(p.s.physical, 110) * 0.55 + (p.traits.has('aerial') ? 14 : 0) + (p.cat === 'DF' && this.ownX(p.team, p.x) < 30 ? 3 : 0) - d * 14 + rnd() * 22
      if (s > bs) { bs = s; best = p }
    }
    for (const p of cands) if (p !== best) { p.jumpT = 0.4; p.stun = Math.max(p.stun, 0.12) }
    return best
  }

  private header(p: MP) {
    const b = this.ball, t = p.team
    if (b.off && b.offTeam === t && b.off.includes(p)) { this.callOffside(p); return }
    p.jumpT = 0.42
    this.lastBallZ = b.z
    const human = this.human[t] && this.ctrl[t] === p
    const c = this.ctl[t]
    const q = human && c.queued && this.clock - c.queued.t < 0.8 ? c.queued : null
    const ox = this.ownX(t, p.x)
    const attBox = ox > L - 18 && Math.abs(p.y - CY) < 18
    const wantShot = human ? q?.act === 'shoot' || c.charge?.kind === 'shot' : attBox && rnd() < 0.85
    if (wantShot && ox > L - 28) {
      const aimY = human ? this.humanAimY(t) : this.aiAimY(t)
      c.charge = null; c.queued = null
      this.shoot(p, 0.55 + Math.min(p.s.physical, 110) / 300, aimY, 'header')
      if (!this.fast && rnd() < 0.45) this.say('header', { name: p.data.name })
      return
    }
    if (human && q && q.act !== 'shoot') {
      c.queued = null
      const a = hyp(c.x, c.y) > 0.3 ? Math.atan2(c.y, c.x) : p.face
      const m = this.pickTarget(p, a, 'ground')
      const [ax, ay] = m ? [m.x, m.y] : [p.x + Math.cos(a) * 10, p.y + Math.sin(a) * 10]
      this.pass(p, ax, ay, 'header', { target: m })
      this.emit({ k: 'head', v: 0.4 })
      return
    }
    if (ox < 16 && Math.abs(p.y - CY) < 14 && !human && rnd() < 0.32) {
      // under pressure in the six-yard area: head it behind for a corner
      const a = Math.atan2((p.y < CY ? -1 : 1) * (0.7 + rnd() * 0.5), -this.dir(t) * 0.7)
      this.kick(p, Math.cos(a) * 9, Math.sin(a) * 9, 3.5)
      b.last = p
      this.emit({ k: 'head', v: 0.6 })
      return
    }
    if (ox < 35) {
      // clearance header: away from goal, towards the flank
      const a = (t === 0 ? 0 : Math.PI) + (p.y < CY ? -0.6 : 0.6) * rnd() + gauss() * 0.3
      this.kick(p, Math.cos(a) * (12 + Math.min(p.s.physical, 110) / 15), Math.sin(a) * (12 + p.s.physical / 15), 4.5)
      b.last = p
      this.emit({ k: 'head', v: 0.6 })
      if (rnd() < 0.15) this.say('clear', { name: p.data.name })
      return
    }
    if (rnd() < 0.55 + p.s.dribbling / 300) { this.giveBall(p); return } // cushioned down
    // flick-on to the nearest teammate ahead
    let m: MP | null = null, bd = 1e9
    for (const q2 of this.teams[t]) {
      if (q2 === p || q2.isGK) continue
      const ahead = this.ownX(t, q2.x) - ox
      const d = hyp(q2.x - p.x, q2.y - p.y)
      if (ahead > -3 && d < 22 && d < bd) { bd = d; m = q2 }
    }
    const [ax, ay] = m ? [m.x, m.y] : this.world(t, ox + 10, this.ownY(t, p.y))
    this.pass(p, ax, ay, 'header', { target: m })
    this.emit({ k: 'head', v: 0.4 })
  }

  private aiAimY(t: Side) {
    const gk = this.gk(this.opp(t))
    const side = gk && gk.y < CY ? 1 : -1
    return CY + side * (1.4 + rnd() * 1.8)
  }

  giveBall(p: MP, how: 'control' | 'hands' | 'tackle' | 'set' = 'control') {
    const b = this.ball
    if (how === 'control' && b.off && b.offTeam === p.team && b.off.includes(p)) { this.callOffside(p); return }
    if (this.so && how !== 'set') { this.soResult(false, p.isGK); return }
    if (b.pass && b.pass.from.team === p.team && b.pass.from !== p && how === 'control' && b.pass.kind !== 'knock' && b.pass.kind !== 'skill') { this.stats.passOk[p.team]++; this.pstat(b.pass.from).pk++ }
    else if (b.pass && b.pass.from.team !== p.team && how === 'control' && !this.so) this.pstat(p).int++
    this.lastBallZ = b.z
    const prev = b.last
    b.owner = p; b.last = p
    this.shotBy = null
    b.shot = null; b.z = 0; b.vz = 0; b.spin = 0; b.pass = null; b.off = null; b.tried.clear(); b.inNet = false
    b.hands = how === 'hands' && p.isGK
    p.holdT = 0
    p.receiveT = 0
    if (this.lastPass && this.lastPass.p.team === p.team && this.lastPass.p !== p && prev === this.lastPass.p) this.lastPass = { p: this.lastPass.p, t: this.now() }
    else if (this.lastPass && this.lastPass.p.team !== p.team) this.lastPass = null
    const t = p.team, o = this.opp(t)
    if (prev && prev.team !== t && how !== 'set') this.wonAt[t] = this.clock
    if (how === 'set') { if (this.human[t]) { this.ctrl[t] = p; this.ctl[t].tgt = null } return }
    if (this.human[o] && this.assist.switch) this.autoSwitch(o, true)
    if (this.human[t]) {
      this.ctrl[t] = p
      const c = this.ctl[t]
      c.tgt = null
      const q = c.queued
      if (q && this.clock - q.t < 0.8) {
        c.queued = null
        if (q.act === 'shoot') this.humanShoot(t, p, q.power, q.sk, true)
        else this.humanPass(t, p, q.act, true)
        return
      }
      c.queued = null
    } else {
      const pressured = this.pressure(p) < 3
      const st = this.styles[t]
      this.decideT[t] = pressured && rnd() < st.firstTime ? 0.06 + rnd() * 0.1 : (this.ai[t].decide / st.tempo) * (0.5 + rnd() * 0.5)
    }
  }

  /** Knock the ball on (sprint + forward flick): a big touch into space and a burst of pace. */
  knockOn(p: MP, far: boolean, a: number) {
    const b = this.ball
    if (b.owner !== p) return
    const v = far ? 10.5 : 6
    const vx = Math.cos(a) * v + p.vx * 0.25, vy = Math.sin(a) * v + p.vy * 0.25
    this.kick(p, vx, vy, 0)
    b.kickCd = 0.18
    b.pass = { from: p, to: p, kind: 'knock', t: this.clock }
    p.burstT = far ? 1.0 : 0.6
    p.receiveT = 1.6
    p.rx = p.x + vx * 0.9; p.ry = p.y + vy * 0.9
    this.emit({ k: 'kick', v: 0.35 })
  }

  private loose(from: MP, a: number, v = 5) {
    const b = this.ball
    b.owner = null; b.hands = false; b.fixed = false
    b.vx = Math.cos(a) * v; b.vy = Math.sin(a) * v; b.vz = 0; b.spin = 0
    b.last = from; b.kicker = from; b.kickCd = 0.15; b.tried.clear(); b.pass = null; b.off = null; b.shot = null
  }

  // ------------------------------------------------------------------------------------------------ tackles, fouls, cards
  tackle(def: MP) {
    if (def.tackleCd > 0 || def.stun > 0 || def.beatenT > 0 || def.slideT > 0) return
    def.tackleCd = 0.55
    const b = this.ball, c = b.owner
    if (!c || c.team === def.team) {
      // no carrier: poke a loose ball away
      if (!c && !b.inNet && hyp(b.x - def.x, b.y - def.y) < 1.5 && b.z < 1) {
        const ctl = this.ctl[def.team]
        const a = this.human[def.team] && this.ctrl[def.team] === def && hyp(ctl.x, ctl.y) > 0.3 ? Math.atan2(ctl.y, ctl.x) : def.team === 0 ? 0 : Math.PI
        this.kick(def, Math.cos(a) * 12, Math.sin(a) * 12, 2)
        this.emit({ k: 'kick', v: 0.5 })
      }
      return
    }
    if (b.hands) return
    const dB = hyp(b.x - def.x, b.y - def.y), dC = hyp(c.x - def.x, c.y - def.y)
    const behind = Math.cos(c.face - Math.atan2(c.y - def.y, c.x - def.x)) > 0.35
    if (dB > 1.6 && dC > 1.25) { def.stun = 0.18; return }
    const immune = !!c.skill && c.skill.ok && c.skill.t > 0.05 && c.skill.t < c.skill.dur - 0.05
    let p = 0.44 + (Math.min(def.s.defending, 110) - Math.min(c.s.dribbling, 110)) / 150 + (def.traits.has('hard_tackler') ? 0.08 : 0) - (c.traits.has('flair') ? 0.08 : 0)
      + (dB < dC ? 0.12 : -0.05) - (behind ? 0.15 : 0) + (def.jockey ? 0.08 : 0) - (c.shield && behind ? 0.18 : 0)
      + (this.human[def.team] && this.ctrl[def.team] === def ? HUMAN_TACKLE[this.opts.difficulty] : 0)
    if (immune) p = 0.03
    p = clamp(p, 0.05, 0.9)
    const r: [number, number] = [0, 0]
    r[def.team] = 0.45; r[c.team] = 0.45
    this.emit({ k: 'tackle', v: 0.6, r })
    if (rnd() < p) {
      c.stun = 0.35
      if (Math.abs(c.y - CY) > 25 && rnd() < 0.55) this.loose(def, Math.atan2(c.y < CY ? -1 : 1, (rnd() - 0.5) * 1.2) + gauss() * 0.3, 6 + rnd() * 3) // poked out for a throw
      else if (rnd() < 0.55) this.giveBall(def, 'tackle')
      else this.loose(def, Math.atan2(def.y - c.y, def.x - c.x) + gauss() * 0.8)
      this.stats.tackles[def.team]++
      this.pstat(def).tk++
      if (this.human[def.team] && this.ctrl[def.team] === def) this.log(this.t('feed.tackle', { name: def.data.name }))
    } else {
      def.stun = 0.38
      if (dC < 1.2) {
        const fp = 0.1 + (behind ? 0.24 : 0) + (def.traits.has('hothead') ? 0.1 : 0) + (this.derby ? 0.03 : 0) - Math.min(def.s.defending, 100) / 700
        if (rnd() < fp) this.foul(def, c, 'tackle', behind, true)
      }
    }
  }

  startSlide(p: MP, a: number) {
    if (p.slideT > 0 || p.stun > 0 || p.tackleCd > 0 || p.isGK) return
    p.slideT = 0.55; p.slideA = a; p.slideDone = false; p.tackleCd = 1.2
    const sp = Math.max(hyp(p.vx, p.vy), 6.5) + 1
    p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp
    p.face = a
    this.emit({ k: 'tackle', v: 0.3 })
  }

  private updSlide(p: MP, dt: number) {
    p.slideT -= dt
    const k = Math.exp(-2.2 * dt)
    p.vx *= k; p.vy *= k
    if (!p.slideDone && this.phase === 'play') {
      const b = this.ball
      const fx = p.x + Math.cos(p.slideA) * 0.7, fy = p.y + Math.sin(p.slideA) * 0.7
      const c = b.owner
      const dBall = hyp(b.x - fx, b.y - fy)
      if (dBall < 0.9 && b.z < 0.6 && !b.hands) {
        p.slideDone = true
        if (c && c.team !== p.team) {
          const behind = Math.cos(c.face - Math.atan2(c.y - p.y, c.x - p.x)) > 0.35
          const immune = !!c.skill && c.skill.ok
          const pr = clamp(0.62 + (Math.min(p.s.defending, 110) - Math.min(c.s.dribbling, 110)) / 90 + (p.traits.has('hard_tackler') ? 0.08 : 0) - (c.traits.has('flair') ? 0.06 : 0) - (immune ? 0.3 : 0), 0.15, 0.92)
          const r: [number, number] = [0, 0]
          r[p.team] = 0.6; r[c.team] = 0.6
          this.emit({ k: 'tackle', v: 0.9, r })
          if (rnd() < pr) {
            c.stun = 0.45
            this.stats.tackles[p.team]++
            this.pstat(p).tk++
            const out = Math.abs(c.y - CY) > 23 && rnd() < 0.55 ? Math.atan2(c.y < CY ? -1 : 1, Math.cos(p.slideA) * 0.8) : p.slideA
            this.loose(p, out + gauss() * 0.4, 7 + rnd() * 3)
            if (behind && rnd() < 0.3) this.foul(p, c, 'slide', true, false)
            else if (this.human[p.team] && this.ctrl[p.team] === p) this.say('tackle', { name: p.data.name })
          } else if (rnd() < 0.55 + (behind ? 0.35 : 0)) this.foul(p, c, 'slide', behind, false)
        } else if (!c) {
          this.loose(p, p.slideA + gauss() * 0.3, 8)
        }
      } else if (c && c.team !== p.team && hyp(c.x - p.x, c.y - p.y) < 0.9) {
        p.slideDone = true
        const behind = Math.cos(c.face - Math.atan2(c.y - p.y, c.x - p.x)) > 0.35
        if (rnd() < 0.85) this.foul(p, c, 'slide', behind, true)
      }
    }
    if (p.slideT <= 0) { p.slideT = 0; p.stun = 0.5 }
  }

  private updDive(p: MP, dt: number) {
    p.diveT -= dt
    p.vx *= Math.exp(-6 * dt)
    p.vy = p.diveV
    p.diveV *= Math.exp(-3.2 * dt)
    if (p.diveT <= 0) { p.diveT = 0; p.stun = 0.45; p.vy *= 0.2 }
  }

  private isDogso(def: MP, vic: MP) {
    const a = vic.team
    const ox = this.ownX(a, vic.x)
    if (ox < 70 || hyp(L - ox, CY - this.ownY(a, vic.y)) > 30) return false
    for (const o of this.teams[def.team]) {
      if (o === def || o.isGK) continue
      if (this.ownX(a, o.x) > ox && Math.abs(o.y - vic.y) < 10) return false
    }
    return true
  }

  foul(def: MP, vic: MP, kind: 'tackle' | 'slide', behind: boolean, keptBall: boolean) {
    const t = def.team, a = vic.team
    this.stats.fouls[t]++
    this.pstat(def).fo++
    def.fouls++
    const vx = vic.x, vy = vic.y
    const inBox = this.inOwnBox(t, vx, vy)
    const dogso = this.isDogso(def, vic)
    let py = kind === 'slide' ? (behind ? 0.6 : 0.25) : behind ? 0.18 : 0.05
    if (def.traits.has('hothead')) py += 0.15
    if (this.derby) py += 0.05
    if (def.fouls >= 3 && !def.yellow) py = 1
    let pr = kind === 'slide' && behind ? 0.1 : 0
    if (dogso && !inBox) pr = kind === 'slide' || behind ? 0.75 : 0.45
    if (dogso && inBox) py = Math.max(py, 0.8)
    const card: '' | 'y' | 'r' = rnd() < pr ? 'r' : rnd() < py ? 'y' : ''
    const r: [number, number] = [0, 0]
    r[a] = 0.4
    this.emit({ k: 'foul', v: 1, side: a, r })
    if (kind === 'slide' && rnd() < (behind ? 0.1 : 0.04)) {
      vic.injured = true
      this.say('injury', { name: vic.data.name })
      this.emit({ k: 'injury', side: a })
    }
    const adv = !inBox && keptBall && this.ball.owner === vic && this.ownX(a, vx) > 45 && card !== 'r' && this.phase === 'play'
    if (adv) { this.say('advantage'); this.setBanner(this.t('lv.b.advantage'), 1.2) } else {
      this.emit({ k: 'whistle', v: 1 })
      this.say('foul', { name: def.data.name })
    }
    if (card) this.book(def, card)
    if (adv || this.phase !== 'play') return
    if (inBox) {
      this.say('penalty', { team: this.shorts[a] })
      this.setBanner(this.t('lv.b.penalty'), 1.6)
      this.emit({ k: 'whistle', v: 1, say: this.t('lv.tts.penalty') })
      this.stoppage('penalty', a, this.world(a, L - 11, CY)[0], CY)
    } else this.stoppage('free', a, clamp(vx, 1, L - 1), clamp(vy, 1, W - 1))
  }

  book(p: MP, card: 'y' | 'r') {
    const t = p.team
    const minute = this.minute()
    if (card === 'y' && p.yellow) {
      this.cards.push({ id: p.data.id, team: t, kind: 'y', minute })
      this.stats.yellows[t]++
      this.say('secondYellow', { name: p.data.name })
      card = 'r'
    } else if (card === 'y') {
      p.yellow = true
      this.pstat(p).y++
      this.stats.yellows[t]++
      this.cards.push({ id: p.data.id, team: t, kind: 'y', minute })
      this.say('yellow', { name: p.data.name })
      this.setBanner(`🟨 ${p.data.name}`, 1.4)
      this.emit({ k: 'card', s: 'y', side: t })
      return
    }
    this.stats.reds[t]++
    this.pstat(p).r++
    this.pstat(p).outMin = minute
    this.cards.push({ id: p.data.id, team: t, kind: 'r', minute })
    this.say('red', { name: p.data.name })
    this.setBanner(`🟥 ${p.data.name}`, 1.8)
    this.emit({ k: 'card', s: 'r', side: t, say: this.t('lv.tts.red', { name: p.data.name }) })
    this.sendOff(p)
  }

  /** A sent-off player leaves the pitch; a keeper is replaced in goal by the outfielder nearest it. */
  sendOff(p: MP, quiet = false) {
    const t = p.team
    const b = this.ball
    this.players = this.players.filter(q => q !== p)
    this.teams[t] = this.teams[t].filter(q => q !== p)
    if (b.owner === p) { b.owner = null; b.hands = false }
    if (b.last === p) b.last = null
    if (b.kicker === p) b.kicker = null
    if (b.off) b.off = b.off.filter(q => q !== p)
    b.tried.delete(p)
    if (this.lastPass?.p === p) this.lastPass = null
    for (const q of this.players) if (q.mark === p) q.mark = null
    if (this.setTaker === p) this.setTaker = null
    if (p.isGK && this.teams[t].length) {
      const gx = this.ownGoalX(t)
      const q = [...this.teams[t]].sort((a, c) => Math.abs(a.x - gx) - Math.abs(c.x - gx))[0]
      q.isGK = true; q.role = 'GK'; q.cat = 'GK'
      if (!quiet) this.log(this.t('lv.c.inGoal', { name: q.data.name }))
    }
    if (this.ctrl[t] === p) this.ctrl[t] = this.human[t] ? this.bestDefender(t, null) : null
  }

  // ------------------------------------------------------------------------------------------------ skill moves
  startSkill(p: MP, id: SkillId, s: number) {
    const def = id === 'fakeshot' ? FAKESHOT : SKILLS.find(k => k.id === id)
    if (!def || this.ball.owner !== p || p.skill) return
    const drib = Math.min(p.s.dribbling, 110)
    const sig = p.sig === id
    const chance = clamp(0.55 + (drib - (50 + 8 * def.stars)) / 35 + (p.traits.has('flair') ? 0.15 : 0) - (p.stamina < 0.4 ? 0.1 : 0)
      + (p.icon ? 0.18 : 0) + (sig ? 0.12 : 0) + (this.human[p.team] && this.ctrl[p.team] === p ? HUMAN_SKILL[this.opts.difficulty] : 0), 0.12, p.icon ? 0.97 : 0.95)
    const ok = rnd() < chance
    const fx = Math.cos(p.face), fy = Math.sin(p.face)
    p.skill = { id, t: 0, dur: def.dur, s: s || 1, ok, fx, fy, f0: p.face, done: false, stars: def.stars }
    if (!ok) return
    this.pstat(p).sk++
    let near = false
    for (const o of this.teams[this.opp(p.team)]) {
      const dx = o.x - p.x, dy = o.y - p.y, d = hyp(dx, dy)
      if (d < 5 && dx * fx + dy * fy > -1) {
        o.beatenT = Math.max(o.beatenT, (0.3 + 0.1 * def.stars) * (1 - Math.min(o.s.defending, 110) / 260) * (o.jockey ? 0.5 : 1) * (sig ? 1.4 : 1))
        if (d < 4) near = true
      }
      if (id === 'fakeshot' && o.isGK && d < 16) o.beatenT = Math.max(o.beatenT, 0.45 * (1 - o.s.goalkeeping / 250))
    }
    const human = this.human[p.team] && this.ctrl[p.team] === p
    const move = this.t('lv.sk.' + id)
    if (sig && !this.fast && this.clock - (this.lastSig.get(p.data.id) ?? -99) > 25) {
      this.lastSig.set(p.data.id, this.clock)
      // an icon's trademark: the banner, a slow-motion moment and a line from the commentator
      this.setBanner(this.t('lv.sig.banner', { move }), 1.7)
      this.setFlash(this.t('lv.sig.flash', { move, name: p.data.name }), p.x, p.y, 1.5)
      this.slowmo = 0.6
      this.whiteFlash = Math.max(this.whiteFlash, 0.3)
      this.signatures.push({ id: p.data.id, team: p.team, move: id, minute: this.minute() })
      this.say('signature', { name: p.data.name, move })
      this.emit({ k: 'skill', v: 1, side: p.team, s: 'sig', say: this.t('lv.tts.signature', { name: p.data.name, move }) })
      return
    }
    if (def.stars >= 2 || near) this.setFlash(p.icon ? this.t('lv.sig.flash', { move, name: p.data.name }) : move, p.x, p.y, 1.1)
    if (near && def.stars >= 3 && (human || def.stars >= 4 || p.icon) && !this.fast) { this.slowmo = 0.45; this.whiteFlash = Math.max(this.whiteFlash, 0.25) }
    this.emit({ k: 'skill', v: def.stars / 5, side: p.team })
    if (near && def.stars >= 3 && rnd() < 0.5) this.say('skill', { name: p.data.name, move })
  }

  private updSkill(p: MP, dt: number) {
    const k = p.skill!
    const b = this.ball
    if (b.owner !== p && !(k.id === 'rainbow' && k.done)) { p.skill = null; return }
    k.t += dt
    const u = Math.min(1, k.t / k.dur)
    const fx = k.fx, fy = k.fy, rx = -fy * k.s, ry = fx * k.s
    let vx = 0, vy = 0, face = k.f0
    switch (k.id) {
      case 'feint': vx = rx * 3.8 * (1 - u) + fx * 2.6; vy = ry * 3.8 * (1 - u) + fy * 2.6; break
      case 'dragback': { const g = u < 0.5 ? (1 - 2 * u) * 2 : -(u - 0.5) * 6; vx = fx * g; vy = fy * g; if (u >= 0.5) face = k.f0 + Math.PI; break }
      case 'stepover': { const sw = Math.sin(u * Math.PI * 2) * 1.6; vx = fx * 1.5 - rx * sw; vy = fy * 1.5 - ry * sw; break }
      case 'ballroll': vx = rx * 3.2 + fx * 0.5; vy = ry * 3.2 + fy * 0.5; break
      case 'roulette': vx = rx * 3 + fx; vy = ry * 3 + fy; face = k.f0 + u * Math.PI * 2 * k.s; break
      case 'mcgeady': vx = rx * 2.5 * (1 - u) + fx * 3.5 * u; vy = ry * 2.5 * (1 - u) + fy * 3.5 * u; face = k.f0 + Math.sin(u * Math.PI) * 2.2 * k.s; break
      case 'elastico': { const g = u < 0.4 ? -1.5 : 4.5; vx = fx * 1.5 + rx * g; vy = fy * 1.5 + ry * g; break }
      case 'rainbow': {
        vx = fx * (3 + u * 3); vy = fy * (3 + u * 3)
        if (!k.done && u >= 0.25 && b.owner === p) {
          k.done = true
          const v = k.ok ? 7 : 4.5
          this.kick(p, fx * v + p.vx * 0.3, fy * v + p.vy * 0.3, k.ok ? 5.4 : 3.4)
          b.kickCd = 0.35
          b.pass = { from: p, to: p, kind: 'skill', t: this.clock }
          p.receiveT = 1.6; p.rx = p.x + fx * 7; p.ry = p.y + fy * 7
        }
        break
      }
      case 'fakeshot': vx = rx * 2.6 + fx * 0.6; vy = ry * 2.6 + fy * 0.6; break
      default: break
    }
    p.faceLock = face
    p.vx = vx; p.vy = vy
    if (!k.ok && k.id !== 'rainbow' && u > 0.45 && b.owner === p) {
      // botched: the ball runs loose
      p.skill = null
      this.loose(p, k.f0 + gauss() * 1.1, 4.5)
      b.kickCd = 0.3
      p.stun = 0.25
      if (this.human[p.team] && this.ctrl[p.team] === p) this.say('fumble', { name: p.data.name })
      return
    }
    if (u >= 1) {
      p.skill = null
      let ex = fx, ey = fy, sp = 5.5
      switch (k.id) {
        case 'dragback': ex = -fx; ey = -fy; sp = 3.5; break
        case 'stepover': case 'elastico': case 'feint': ex = fx * 0.6 + rx * 0.8; ey = fy * 0.6 + ry * 0.8; sp = 6.5; break
        case 'ballroll': ex = rx * 0.7 + fx * 0.7; ey = ry * 0.7 + fy * 0.7; break
        case 'roulette': case 'mcgeady': ex = fx * 0.8 + rx * 0.6; ey = fy * 0.8 + ry * 0.6; sp = 6; break
        default: break
      }
      const n = hyp(ex, ey) || 1
      p.vx = (ex / n) * sp; p.vy = (ey / n) * sp
      p.face = Math.atan2(p.vy, p.vx)
      p.burstT = k.id === 'fakeshot' || k.id === 'dragback' ? 0.3 : 0.55
    }
  }

  private skillBall(p: MP): [number, number] {
    const k = p.skill!
    const u = Math.min(1, k.t / k.dur)
    const fx = k.fx, fy = k.fy, rx = -fy * k.s, ry = fx * k.s
    switch (k.id) {
      case 'dragback': { const o = 0.6 - 1.1 * Math.min(1, u / 0.6); return [fx * o, fy * o] }
      case 'ballroll': return [rx * 0.32 + fx * 0.18, ry * 0.32 + fy * 0.18]
      case 'elastico': { const o = u < 0.4 ? -0.55 * (u / 0.4) : -0.55 + ((u - 0.4) / 0.6) * 1.15; return [fx * 0.45 + rx * o, fy * 0.45 + ry * o] }
      case 'roulette': case 'mcgeady': return [Math.cos(p.face) * 0.5, Math.sin(p.face) * 0.5]
      case 'feint': return [fx * 0.5 + rx * 0.15 * u, fy * 0.5 + ry * 0.15 * u]
      case 'fakeshot': return [fx * 0.45 + rx * 0.35 * u, fy * 0.45 + ry * 0.35 * u]
      case 'rainbow': { const o = 0.35 - 0.6 * u; return [fx * o, fy * o] }
      default: return [fx * 0.55, fy * 0.55]
    }
  }

  // ------------------------------------------------------------------------------------------------ goals, replays
  private goalFrame = 0
  private celebLeader: MP | null = null

  private scoreGoal(t: Side) {
    const b = this.ball
    b.inNet = true
    this.netT = 1
    if (this.so) { this.soResult(true); return }
    const sh = b.shot
    if (sh && !sh.counted && sh.team === t) { sh.counted = true; this.stats.onTarget[t]++; if (this.teams[t].includes(sh.by)) this.pstat(sh.by).ot++ }
    this.score[t]++
    let k = b.kicker
    // deflected in, or the keeper fumbled it: the shooter's goal
    const sb = this.shotBy
    if ((!k || k.team !== t) && sb && sb.p.team === t && this.clock - sb.at < 3 && this.teams[t].includes(sb.p)) {
      k = sb.p
      if (!sb.shot.counted) { sb.shot.counted = true; this.stats.onTarget[t]++; this.pstat(k).ot++ } // it was on target after all
    }
    this.shotBy = null
    let who = ''
    let scorer: MP | null = null
    let assist: MP | null = null
    if (k && k.team === t) {
      scorer = k
      this.scorers.push(k.data.id)
      this.pstat(k).g++
      who = k.data.name
      const lp = this.lastPass
      const as = lp && lp.p.team === t && lp.p !== k && this.now() - lp.t < 12 ? lp.p : null
      assist = as
      this.assists.push(as ? as.data.id : 0)
      if (as) { who += ` (${this.t('feed.assist', { name: as.data.name })})`; this.pstat(as).a++ }
    } else who = this.t('feed.og')
    this.pendingGoal = {
      minute: this.minute(), team: t, scorer: scorer?.data.name ?? k?.data.name ?? '', assist: assist?.data.name ?? '', og: !scorer,
      pen: sh?.kind === 'pen' || sh?.kind === 'panenka', id: scorer?.data.id ?? 0,
    }
    this.goalLog.push(this.pendingGoal)
    this.lastPass = null
    this.log(this.t('feed.goal', { team: this.shorts[t], who }))
    this.setBanner(this.t('feed.goalBanner', { who }), 3.2)
    this.lastConceded = this.opp(t)
    this.phase = 'goal'
    this.phaseT = this.fast ? 0.05 : 3.4
    this.shake = 1; this.whiteFlash = 0.75; this.celebT = 1; this.celebTeam = t
    if (sh?.great && !this.fast) this.slowmo = 0.8
    for (const c of this.ctl) c.reset()
    this.celebLeader = scorer
    this.celebKind = 0
    if (scorer) {
      scorer.celebrate = true
      scorer.tx = this.goalX(t) === L ? L - 2 : 2
      scorer.ty = scorer.y < CY ? 2 : W - 2
      for (const p of this.teams[t]) if (p !== scorer && !p.isGK && hyp(p.x - scorer.x, p.y - scorer.y) < 32) p.celebrate = true
    }
    const r: [number, number] = [0, 0]
    r[t] = 1; r[this.opp(t)] = 0.25
    this.emit({ k: 'goal', side: t, v: sh?.great ? 1 : 0.8, r, say: this.t('lv.tts.goal', { team: this.names[t], name: scorer?.data.name ?? '' }) })
    this.goalFrame = this.rec.length
  }

  /** Pick a goal celebration for the scorer (1 knee slide, 2 aeroplane, 3 backflip, 4 point to the sky). */
  celebrate(kind: number) {
    if (this.phase !== 'goal' || this.celebKind || !this.celebLeader || kind < 1 || kind > 4) return
    this.celebKind = kind
    this.celebAt = this.clock
    this.phaseT = Math.max(this.phaseT, 2.6) // time to enjoy it
    const p = this.celebLeader
    if (kind === 1) { const a = p.face; p.vx = Math.cos(a) * 7; p.vy = Math.sin(a) * 7 }
  }
  /** The scorer's team is a person's side and nothing was picked yet: the celebration buttons show. */
  celebPick(): Side | null {
    if (this.phase !== 'goal' || this.celebKind || !this.celebLeader || this.fast) return null
    const t = this.celebLeader.team
    return this.human[t] ? t : null
  }
  celebKind = 0
  private celebAt = 0

  private updGoal(dt: number) {
    this.phaseT -= dt
    const lead = this.celebLeader
    // the scorer's celebration: a pad's face buttons pick one; otherwise the computer chooses after a moment
    if (lead && !this.celebKind && !this.fast) {
      const c = this.ctl[lead.team]
      if (this.human[lead.team]) {
        const k = c.pr & BTN.A ? 1 : c.pr & BTN.B ? 2 : c.pr & BTN.X ? 3 : c.pr & BTN.Y ? 4 : 0
        if (k) this.celebrate(k)
      }
      const wait = this.human[lead.team] ? 1.6 : 0.6
      if (!this.celebKind && 3.4 - this.phaseT > wait) this.celebrate(1 + ((lead.data.id * 7 + this.score[lead.team]) % 4))
    }
    for (const p of this.players) {
      if (p.slideT > 0) { this.updSlide(p, dt); continue }
      if (p === lead && this.celebKind) { this.celebMove(p, dt); continue }
      if (p.celebrate) {
        if (p !== lead && lead) { p.tx = lead.x + ((p.idx % 3) - 1) * 1.3; p.ty = lead.y + (((p.idx >> 1) % 3) - 1) * 1.3 }
        this.steer(p, dt, false)
      } else {
        const [hx, hy] = p.isGK ? this.world(p.team, 3, CY) : this.formationSpot(p, 20, 46, 46, 0)
        p.tx = hx; p.ty = hy
        const dx = hx - p.x, dy = hy - p.y, d = hyp(dx, dy)
        if (d > 0.5) this.accel(p, (dx / d) * 2.2, (dy / d) * 2.2, dt); else this.accel(p, 0, 0, dt)
      }
    }
    this.integrate(dt)
    this.ballPhysics(dt)
    this.updateCam(dt)
    if (this.phaseT > 0) return
    // keep the clip for the post-match highlights (and the replay right now)
    let clip: Highlight | null = null
    if (!this.fast && this.goalFrame > 30 && this.pendingGoal) {
      const end = Math.min(this.rec.length, this.goalFrame + 34)
      const start = Math.max(0, this.goalFrame - 150)
      clip = { frames: this.rec.slice(start, end), goalAt: this.goalFrame - start, goal: this.pendingGoal }
      this.highlights.push(clip)
    }
    this.pendingGoal = null
    if (this.replays && clip) this.startReplay(clip)
    else this.kickoff(this.lastConceded)
  }

  private celebMove(p: MP, dt: number) {
    const k = this.celebKind, u = this.clock - this.celebAt
    if (k === 1) { const f = Math.exp(-2.2 * dt); p.vx *= f; p.vy *= f } // knee slide: glide to a stop
    else if (k === 2) {
      // aeroplane: a wide banked loop
      const a = p.face + dt * 2.4
      this.accel(p, Math.cos(a) * 6.5, Math.sin(a) * 6.5, dt, 1.6)
      p.faceLock = Math.atan2(p.vy, p.vx)
    } else { this.accel(p, 0, 0, dt, 2); if (k === 3 && u > 0.2 && u < 1.0) p.jumpT = Math.max(p.jumpT, 0.05) }
    p.x = clamp(p.x, -1, L + 1); p.y = clamp(p.y, 0, W)
  }

  private startReplay(clip: Highlight) {
    this.rp = { frames: clip.frames, i: 0, goalAt: clip.goalAt }
    this.phase = 'replay'
  }

  /** Watch mode / mouse: skip the replay. */
  skipReplay() { if (this.phase === 'replay') { this.rp = null; this.kickoff(this.lastConceded) } }

  private updReplay(dt: number) {
    const rp = this.rp
    if (!rp) { this.kickoff(this.lastConceded); return }
    const near = Math.abs(rp.i - rp.goalAt) < 24
    rp.i += dt * 30 * (near ? 0.4 : 0.85)
    // any action button skips (the keyboard sends J as "switch" (LB) when the other side scored)
    const skip = ([0, 1] as Side[]).some(s => this.human[s] && (this.ctl[s].pr & (BTN.A | BTN.B | BTN.X | BTN.Y | BTN.LB | BTN.RB | BTN.START)))
    if (skip || rp.i >= rp.frames.length - 1) { this.rp = null; this.kickoff(this.lastConceded) }
  }

  private record() {
    if (this.fast) return
    const ph = this.phase
    if (ph === 'replay' || ph === 'half' || ph === 'shootout' || ph === 'end') return
    if (ph === 'goal' && this.rec.length - this.goalFrame > 40) return
    if (this.tick % 2) return
    this.rec.push(this.liveFrame(false))
    if (this.rec.length > 420) { const cut = this.rec.length - 260; this.rec.splice(0, cut); this.goalFrame -= cut }
  }

  private checkBounds() {
    const b = this.ball
    if (b.inNet) return
    if (b.owner && (b.x < 0 || b.x > L) && Math.abs(b.y - CY) < GOAL_HALF - 0.1) { b.owner = null; this.scoreGoal(b.x > L ? 0 : 1); return }
    if (b.x < -0.25 || b.x > L + 0.25) {
      const t: Side = b.x > L ? 0 : 1
      if (this.so) { this.soResult(false); return }
      const def = this.opp(t)
      const lastT = b.last?.team ?? t
      if (b.shot && b.shot.team === t) {
        const close = Math.abs(b.y - CY) < GOAL_HALF + 2.5 && b.z < GOAL_H + 1.5
        this.emit({ k: 'miss', v: close ? 1 : 0.5, side: t })
        this.say(b.z > GOAL_H ? 'shotOver' : 'shotWide', { name: b.shot.by.data.name })
      }
      if (lastT === def) this.stoppage('corner', t, b.x > L ? L - 0.3 : 0.3, b.y < CY ? 0.3 : W - 0.3)
      else this.stoppage('goalkick', def, def === 0 ? 5.5 : L - 5.5, CY + (b.y < CY ? -4 : 4))
      return
    }
    if (b.y < -0.2 || b.y > W + 0.2) {
      if (this.so) { this.soResult(false); return }
      const t: Side = b.last ? this.opp(b.last.team) : 0
      this.stoppage('throw', t, clamp(b.x, 1, L - 1), b.y < 0 ? 0 : W)
    }
  }

  private finish() {
    if (this.ended) return
    this.ended = true
    this.phase = 'end'
    this.setBanner(this.t('feed.fulltime'), 99)
    this.emit({ k: 'whistle', v: 3, say: this.t('lv.tts.fulltime', { a: this.names[0], b: this.names[1], x: this.score[0], y: this.score[1] }) })
    const tot = this.possT[0] + this.possT[1] || 1
    const possUser = Math.round((this.possT[0] / tot) * 100)
    const home = this.homeTeam, away = this.opp(home)
    const [scorers, assists] = this.goalLists()
    const o: MatchOutcome = {
      homeGoals: this.score[home], awayGoals: this.score[away], scorers, assists, subs: this.subs,
      possHome: home === 0 ? possUser : 100 - possUser, shotsHome: this.stats.shots[home], shotsAway: this.stats.shots[away],
    }
    if (this.extraTime) o.extraTime = true
    if (this.pensResult) o.pens = [this.pensResult[home], this.pensResult[away]]
    this.onEnd(o)
  }

  /** Scorers and assists the way the simulated matches report them (backend Simulate): one entry per goal, the
   *  home side's goals first and then the away side's, assists parallel (0 = none). An own goal has nobody to
   *  credit, so it is a 0 entry of the side it counts for: the list always adds up to the score. */
  goalLists(): [number[], number[]] {
    const scorers: number[] = [], assists: number[] = []
    for (const t of [this.homeTeam, this.opp(this.homeTeam)]) {
      let n = 0
      this.scorers.forEach((id, i) => {
        if (n >= this.score[t] || !id || this.pstats.get(id)?.team !== t) return
        scorers.push(id); assists.push(this.assists[i] ?? 0); n++
      })
      for (; n < this.score[t]; n++) { scorers.push(0); assists.push(0) }
    }
    return [scorers, assists]
  }

  // ------------------------------------------------------------------------------------------------ penalty shoot-out
  private penSkill(p: MP) { return p.s.shooting + (p.traits.has('big_game') ? 6 : 0) + (p.isGK ? -40 : 0) + p.stamina * 5 - (p.injured ? 20 : 0) }

  startShootout(snap: { k: [number[], number[]]; turn: Side; first: Side } | null) {
    this.resetMoment()
    this.half = 5
    this.extraTime = true
    const order = ([0, 1] as Side[]).map(t => [...this.teams[t]].sort((a, b) => this.penSkill(b) - this.penSkill(a)).map(p => p.data.id)) as [number[], number[]]
    const first: Side = snap?.first ?? (rnd() < 0.5 ? 0 : 1)
    const k: [number[], number[]] = snap ? [[...snap.k[0]], [...snap.k[1]]] : [[], []]
    this.so = { order, n: [k[0].length, k[1].length], k, turn: snap?.turn ?? first, first, wait: this.fast ? 0.05 : 3, live: false, t: 0, done: false }
    this.phase = 'shootout'
    this.setBanner(this.t('lv.b.shootout'), 3)
    this.say('shootout')
    this.emit({ k: 'so', s: 'start', say: this.t('lv.tts.shootout') })
    for (const side of [0, 1] as Side[]) this.teams[side].forEach((p, i) => {
      p.x = L / 2 + (side === 0 ? -1.2 : 1.2); p.y = CY - 9 + i * 1.8; p.vx = p.vy = 0; p.tx = p.x; p.ty = p.y; p.hold = true; p.spX = p.x; p.spY = p.y
      p.face = side === 0 ? 0 : Math.PI
    })
    this.ball.x = L / 2; this.ball.y = CY; this.ball.owner = null
  }

  private soTaker(a: Side): MP | undefined {
    const so = this.so!
    const alive = so.order[a].filter(id => this.teams[a].some(p => p.data.id === id))
    if (!alive.length) return this.teams[a][0]
    const id = alive[so.n[a] % alive.length]
    return this.teams[a].find(p => p.data.id === id)
  }

  private updShootout(dt: number) {
    const so = this.so!
    for (const p of this.players) { if (p.diveT > 0) this.updDive(p, dt); else this.accel(p, 0, 0, dt) }
    this.integrate(dt)
    this.ballPhysics(dt)
    this.updateCam(dt)
    so.wait -= dt
    if (so.wait > 0) return
    if (so.done) { this.finish(); return }
    so.live = true
    so.t = 0
    const a = so.turn
    this.restart('penalty', a, this.world(a, L - 11, CY)[0], CY)
  }

  private updSoKick(dt: number) {
    const so = this.so!
    so.t += dt
    for (const p of this.players) { if (p.diveT > 0) this.updDive(p, dt); else if (!p.isGK) this.accel(p, 0, 0, dt); else this.keeperAI(p) }
    const gk = this.gk(this.opp(so.turn))
    if (gk && gk.diveT <= 0) this.steer(gk, dt, false)
    this.integrate(dt)
    this.ballPhysics(dt)
    if (this.phase !== 'play') return
    this.checkBounds()
    if (this.phase !== 'play') return
    const b = this.ball
    if (so.t > 3.2 || (so.t > 0.8 && hyp(b.vx, b.vy) < 1 && !b.inNet)) this.soResult(false)
    this.updateCam(dt)
  }

  private soResult(scored: boolean, saved = false) {
    const so = this.so
    if (!so || !so.live) return
    so.live = false
    const a = so.turn
    so.k[a].push(scored ? 1 : 0)
    so.n[a]++
    this.setBanner(this.t(scored ? 'lv.b.soScored' : saved ? 'lv.b.soSaved' : 'lv.b.soMissed'), 1.8)
    const r: [number, number] = [0, 0]
    r[a] = scored ? 0.8 : 0.3
    this.emit({ k: 'so', s: scored ? 'goal' : 'miss', side: a, r })
    if (scored) { this.shake = 0.5; this.whiteFlash = 0.35; this.netT = 1 }
    const k0 = so.k[0], k1 = so.k[1]
    const s0 = k0.reduce((x, y) => x + y, 0), s1 = k1.reduce((x, y) => x + y, 0)
    const n0 = k0.length, n1 = k1.length
    let win: Side | null = null
    if (n0 <= 5 && n1 <= 5) { if (s0 > s1 + (5 - n1)) win = 0; else if (s1 > s0 + (5 - n0)) win = 1 }
    if (win == null && n0 === n1 && n0 >= 5 && s0 !== s1) win = s0 > s1 ? 0 : 1
    so.turn = this.opp(a)
    this.phase = 'shootout'
    so.wait = this.fast ? 0.05 : 2.4
    this.say(scored ? 'penScored' : saved ? 'penSaved' : 'penMissed', { name: this.setTaker?.data.name ?? '' })
    if (win != null) {
      so.done = true
      this.pensResult = [s0, s1]
      this.setBanner(this.t('lv.b.soWin', { team: this.names[win] }), 5)
      so.wait = this.fast ? 0.05 : 4
      this.celebT = 1; this.celebTeam = win
      const rr: [number, number] = [0, 0]
      rr[win] = 1
      this.emit({ k: 'goal', side: win, v: 1, r: rr, say: this.t('lv.tts.soWin', { team: this.names[win] }) })
      this.log(this.t('lv.c.soWin', { team: this.names[win], a: s0, b: s1 }))
    }
  }

  // ------------------------------------------------------------------------------------------------ team AI
  private teamAI(t: Side) {
    const b = this.ball
    const st = this.styles[t]
    const tac = this.tactics[t]
    const owner = b.owner
    const inPoss = owner ? owner.team === t : !!b.last && b.last.team === t && (!!b.pass || hyp(b.vx, b.vy) > 3)
    // the shape follows the ball with a short delay when defending: quick switches of play open gaps
    const lag = this.lagBall[t]
    const k = 1 - Math.exp(-(1 / 60) / (inPoss ? 0.12 : 0.45))
    lag.x += (b.x - lag.x) * k; lag.y += (b.y - lag.y) * k
    const bx = this.ownX(t, inPoss ? b.x : lag.x), by = this.ownY(t, inPoss ? b.y : lag.y)
    const ment = tac.mentality === 'attacking' ? 6 : tac.mentality === 'defensive' ? -6 : 0
    let D: number, F: number, width: number
    if (inPoss) { D = clamp(bx - 26, 14, 60) + ment + st.lineHeight * 0.5; F = clamp(D + 48, 46, 100); width = 66 * st.width }
    else { D = clamp(bx - 19, 13, 46) + ment + st.pressHeight * 0.8 + st.lineHeight * 0.6; F = D + 28; width = 44 * (0.85 + 0.15 * st.width) }
    const shiftY = (by - CY) * (inPoss ? 0.2 : 0.38)
    const team = this.teams[t]
    const user = this.ctrl[t]
    const restart = this.phase === 'restart' || this.phase === 'kickoff'
    const line = this.offsideLine(t)
    const onside = Math.max(line, L / 2) - 0.6
    if (inPoss && owner && !restart) this.updateSupport(t, owner, onside)
    if (!inPoss && this.clock >= this.markNext[t]) { this.markNext[t] = this.clock + 0.4; this.updateMarks(t) }
    // out of possession one striker (two for a counter-attacking side) stays up as an outlet for the break
    let outlets: MP[] | null = null
    if (!inPoss && !restart) {
      const fw = team.filter(p => p !== user && !p.isGK && (p.cat === 'FW' || p.role === 'AM')).sort((a, c) => this.ownX(t, c.x) - this.ownX(t, a.x))
      outlets = fw.slice(0, st.counter > 0.5 || tac.mentality === 'defensive' ? 2 : 1)
    }
    const outletX = Math.min(44 + st.counter * 10, line - 1)
    for (const p of team) {
      if (p === owner || p === user) continue
      if (p.hold) { p.tx = p.spX; p.ty = p.spY; continue }
      if (p.isGK) { this.keeperAI(p); continue }
      let [x, y] = this.formationSpot(p, D, F, width, shiftY)
      if (outlets?.includes(p) && this.ownX(t, x) < outletX) x = this.world(t, outletX, 0)[0]
      if (inPoss) {
        if (p.supT > 0) { x = p.supX; y = p.supY }
        if (p.runT > 0) { x = p.runX; y = p.runY }
        if (p.receiveT <= 0 && this.ownX(t, x) > onside) x = this.world(t, onside, 0)[0]
      } else if (p.mark && this.teams[this.opp(t)].includes(p.mark)) {
        const m = p.mark
        const a = Math.atan2(CY - m.y, this.ownGoalX(t) - m.x)
        const mx = m.x + Math.cos(a) * 1.6 + (b.x - m.x) * 0.06, my = m.y + Math.sin(a) * 1.6 + (b.y - m.y) * 0.06
        // tight marking near our box, looser further out (the zonal shape still matters)
        const mo = this.ownX(t, m.x)
        const w = mo < 25 ? 0.75 : mo < 40 ? 0.5 : 0.25
        x += (mx - x) * w; y += (my - y) * w
      }
      if (p.receiveT > 0 && !owner) [x, y] = this.interceptPoint(p)
      if (restart && this.restartTeam !== t && this.restartKind !== 'throw' && this.restartKind !== 'kickoff') {
        const dd = hyp(x - b.x, y - b.y)
        if (dd < 9.3) { const a = Math.atan2(y - b.y, x - b.x); x = b.x + Math.cos(a) * 9.3; y = b.y + Math.sin(a) * 9.3 }
      }
      if (this.phase === 'kickoff') {
        x = t === 0 ? Math.min(x, L / 2 - 1) : Math.max(x, L / 2 + 1)
        if (t !== this.restartTeam) [x, y] = this.outsideCircle(x, y, KO_WAIT)
      }
      p.tx = clamp(x, -1, L + 1); p.ty = clamp(y, 0.5, W - 0.5)
    }
    if (restart) return
    if (owner?.team === t && bx > 30) {
      // forward runs in behind (timed: the runner waits on the line until the pass is played)
      const room = L - line
      for (const p of team) {
        if (room < 16) break
        if (p === owner || p === user || p.isGK || p.runT > 0 || p.hold) continue
        const isAtt = p.cat === 'FW' || p.role === 'AM' || ((tac.mentality === 'attacking' || st.runs > 1.15) && (p.role === 'LM' || p.role === 'RM' || p.role.endsWith('WB')))
        if (isAtt && rnd() < (0.5 / 60) * st.runs * (this.clock - this.wonAt[t] < 4 ? 1 + st.counter * 1.5 : 1)) {
          const ox = clamp(line + 4 + rnd() * 6, 30, L - 8)
          const oy = clamp(this.ownY(t, p.y) + gauss() * 6, 6, W - 6)
          ;[p.runX, p.runY] = this.world(t, ox, oy)
          p.runT = 2.4
        }
      }
      // a teammate wide in the final third: attack the near post, the spot and the far post
      const oox = this.ownX(t, owner.x), ooy = this.ownY(t, owner.y)
      if (oox > 68 - Math.max(0, st.cross - 0.62) * 30 && Math.abs(ooy - CY) > 12 && this.tick % 20 === 0) {
        const s = ooy < CY ? -1 : 1
        const spots: [number, number][] = [[L - 6, CY + s * 3], [L - 11, CY - s * 0.5], [L - 7, CY - s * 5]]
        const runners = team.filter(p => p !== owner && p !== user && !p.isGK && (p.cat === 'FW' || ['AM', 'LW', 'RW', 'LM', 'RM', 'CM'].includes(p.role)))
          .sort((p, q) => this.ownX(t, q.x) - this.ownX(t, p.x)).slice(0, 3)
        runners.forEach((p, i) => { const [rx, ry] = this.world(t, spots[i][0], spots[i][1]); p.runX = rx; p.runY = ry; p.runT = 1.2 })
      }
    }
    const others = team.filter(p => !p.isGK && p !== user && p !== owner && !p.hold)
    for (const p of team) p.pressing = false
    if (!owner) {
      // loose ball: the quickest one goes for it
      const ix = b.x + b.vx * 0.45, iy = b.y + b.vy * 0.45
      let chaser: MP | null = null, ct = 1e9
      for (const p of others) { const tt = hyp(p.x - ix, p.y - iy) / p.maxSpeed(); if (tt < ct) { ct = tt; chaser = p } }
      const userT = user ? hyp(user.x - ix, user.y - iy) / user.maxSpeed() : 1e9
      if (chaser && userT > ct) { const [x, y] = this.interceptPoint(chaser); chaser.tx = x; chaser.ty = y }
    } else if (owner.team !== t) {
      const c = owner
      const zoneHigh = this.ownX(t, c.x) > 52
      const press = tac.pressing
      let n = press === 'high' ? (zoneHigh ? 2 : 3) : press === 'mid' ? (zoneHigh ? 1 : 2) : zoneHigh ? 0 : 1
      n += Math.round(st.pressMen * 0.5) + (this.human[t] ? 0 : this.ai[t].press)
      // a pressing side hunts the ball in packs for a few seconds after losing it (counter-press)
      if (st.pressMen >= 0.9 && this.clock - this.wonAt[this.opp(t)] < 3.5 && zoneHigh) n += 2
      // a side that sits deep lets them have it in their own half
      if (st.pressHeight <= -4 && zoneHigh) n = Math.min(n, 1)
      if (this.ownX(t, c.x) < 25) n = Math.max(n, 2)
      if (b.hands) n = 0
      const sorted = others.sort((a, d) => hyp(a.x - c.x, a.y - c.y) - hyp(d.x - c.x, d.y - c.y))
      if (user && sorted.length && hyp(user.x - c.x, user.y - c.y) < hyp(sorted[0].x - c.x, sorted[0].y - c.y) + 2) n -= 1
      const call = this.human[t] && this.ctl[t].pressCall && !b.hands
      const own = this.ownGoalX(t)
      // the first man closes the carrier down goal-side; the next ones cut off his easy passes instead of
      // piling in (a swarm of tacklers made the pressing side unbeatable)
      const outlets = this.teams[c.team].filter(q => q !== c && !q.isGK).sort((a, d) => hyp(a.x - c.x, a.y - c.y) - hyp(d.x - c.x, d.y - c.y))
      sorted.slice(0, Math.max(0, n) + (call ? 1 : 0)).forEach((p, i) => {
        p.pressing = true
        if (call && i === 0) { p.tx = c.x + c.vx * 0.2; p.ty = c.y + c.vy * 0.2; return }
        if (i === 0) {
          if (hyp(p.x - c.x, p.y - c.y) < 3.2 && hyp(c.vx, c.vy) < 3.5) { p.tx = b.x + c.vx * 0.15; p.ty = b.y + c.vy * 0.15; return } // he's standing on it: go for the ball
          const a = Math.atan2(CY - c.y, own - c.x)
          p.tx = c.x + Math.cos(a) * 1.4 + c.vx * 0.25; p.ty = c.y + Math.sin(a) * 1.4 + c.vy * 0.25
          return
        }
        const m = outlets[i - 1]
        if (m && hyp(m.x - c.x, m.y - c.y) < 22) { p.tx = c.x + (m.x - c.x) * 0.45 + c.vx * 0.2; p.ty = c.y + (m.y - c.y) * 0.45 + c.vy * 0.2 }
        else { p.tx = c.x + c.vx * 0.3; p.ty = c.y + c.vy * 0.3 }
      })
    }
  }

  private updateSupport(t: Side, owner: MP, onside: number) {
    if (this.clock < this.supNext[t]) return
    this.supNext[t] = this.clock + 0.3
    const st = this.styles[t]
    const user = this.ctrl[t]
    const cands = this.teams[t].filter(p => p !== owner && !p.isGK && p !== user && p.runT <= 0 && !p.hold)
      .sort((a, b) => hyp(a.x - owner.x, a.y - owner.y) - hyp(b.x - owner.x, b.y - owner.y)).slice(0, st.shortPass > 0.6 ? 3 : 2)
    const fwd = t === 0 ? 0 : Math.PI
    const taken: [number, number][] = [[owner.x, owner.y]]
    for (const p of cands) {
      let best: [number, number] = [p.x, p.y], bs = -1e9
      for (const R of [9, 14]) for (const da of [-1.75, -1.05, -0.5, 0, 0.5, 1.05, 1.75]) {
        const a = fwd + da
        const x = clamp(owner.x + Math.cos(a) * R, 2, L - 2), y = clamp(owner.y + Math.sin(a) * R, 2, W - 2)
        let s = (clamp(this.laneOpen(owner.x, owner.y, x, y, t) + 1, 0, 5) / 5) * 1.3 + (Math.min(this.nearestOpp(t, x, y), 8) / 8) * 0.9
        s += ((this.ownX(t, x) - this.ownX(t, owner.x)) / 22) * (0.6 + st.direct * 0.8)
        s -= hyp(x - p.x, y - p.y) / 28
        if (this.ownX(t, x) > onside) s -= 1.5
        for (const q of taken) if (hyp(q[0] - x, q[1] - y) < 7) s -= 0.8
        if (s > bs) { bs = s; best = [x, y] }
      }
      p.supX = best[0]; p.supY = best[1]; p.supT = 0.45
      taken.push(best)
    }
  }

  private updateMarks(t: Side) {
    const opp = this.teams[this.opp(t)].filter(o => !o.isGK && o !== this.ball.owner).sort((a, b) => this.ownX(t, a.x) - this.ownX(t, b.x))
    const mine = this.teams[t].filter(p => !p.isGK && p !== this.ctrl[t] && p.cat !== 'FW' && !p.pressing)
    for (const p of this.teams[t]) p.mark = null
    const used = new Set<MP>()
    for (const o of opp) {
      if (this.ownX(t, o.x) > 48) continue
      let best: MP | null = null, bd = 20
      for (const p of mine) { if (used.has(p)) continue; const d = hyp(p.x - o.x, p.y - o.y); if (d < bd) { bd = d; best = p } }
      if (best) { best.mark = o; used.add(best) }
    }
  }

  interceptPoint(p: MP): [number, number] {
    const b = this.ball
    if (b.owner) return [b.owner.x, b.owner.y]
    const sp = Math.max(1, p.maxSpeed())
    let x = b.x, y = b.y, z = b.z, vx = b.vx, vy = b.vy, vz = b.vz
    const step = 0.08, fr = Math.exp(-0.95 * step)
    for (let i = 1; i <= 25; i++) {
      if (z > 0 || vz > 0) { vz -= 9.8 * step; z = Math.max(0, z + vz * step); if (z === 0) vz = 0 } else { vx *= fr; vy *= fr }
      x += vx * step; y += vy * step
      if (z < 1.9 && hyp(x - p.x, y - p.y) <= sp * i * step + 0.6) break
    }
    return [clamp(x, -1, L + 1), clamp(y, -1, W + 1)]
  }

  private keeperAI(p: MP) {
    const b = this.ball, t = p.team
    const lineX = this.ownGoalX(t)
    const bxo = this.ownX(t, b.x)
    if (p.diveT > 0 || p.stun > 0.2) return
    if (this.human[t] && this.ctl[t].rush && this.ctrl[t] !== p) { p.tx = b.x; p.ty = b.y; return }
    const sh = b.shot
    if (sh && sh.team !== t && Math.sign(b.vx) === -this.dir(t) && Math.abs(b.vx) > 1) {
      const tt = (p.x - b.x) / b.vx
      if (tt > 0) {
        const cy = b.y + b.vy * tt
        // set feet: a small shuffle, then the dive does the rest
        p.tx = p.x
        p.ty = p.y + clamp(cy - p.y, -0.6, 0.6)
        const react = 0.08 + (1 - Math.min(p.s.goalkeeping, 110) / 110) * 0.25
        if (!this.so && this.clock - sh.t > react && Math.abs(cy - p.y) > 1.1 && tt < 0.6 && !sh.gkTried) this.dive(p, Math.sign(cy - p.y))
        return
      }
    }
    if (this.so) { p.tx = lineX + this.dir(t) * 0.3; p.ty = CY; return }
    const o = b.owner
    if (o && o.team !== t && bxo < 24 && Math.abs(b.y - CY) < 18) {
      const alone = this.teams[t].every(d => d === p || this.ownX(t, d.x) > this.ownX(t, o.x) - 1 || Math.abs(d.y - o.y) > 8)
      if (alone) {
        const a = Math.atan2(o.y - CY, o.x - lineX)
        const out = clamp(hyp(o.x - lineX, o.y - CY) * 0.45, 2, 10)
        p.tx = lineX + Math.cos(a) * out; p.ty = CY + Math.sin(a) * out
        return
      }
    }
    if (!o && bxo < 15 && Math.abs(b.y - CY) < 16 && this.nearestOpp(t, b.x, b.y) > hyp(b.x - p.x, b.y - p.y)) { p.tx = b.x; p.ty = b.y; return }
    let out = 1.4
    if (bxo < 32 && Math.abs(b.y - CY) < 26) out = clamp(1.4 + (32 - bxo) * 0.12, 1.4, 4.5)
    const a = Math.atan2(b.y - CY, b.x - lineX)
    p.tx = lineX + Math.cos(a) * out
    p.ty = clamp(CY + Math.sin(a) * out + (b.y - CY) * 0.05, CY - GOAL_HALF + 0.3, CY + GOAL_HALF - 0.3)
  }

  private aiCarriers(dt: number) {
    const b = this.ball
    const o = b.owner
    if (!o) return
    const t = o.team
    o.holdT += dt
    if (this.human[t] && this.ctrl[t] === o) {
      if (o.isGK && o.holdT > 6) this.carrierAI(o) // nobody distributing: the keeper does it himself
      return
    }
    if (o.skill) return
    if (o.isGK) { if (o.holdT > (b.hands ? 1.3 : 0.7)) this.carrierAI(o); return }
    this.decideT[t] -= dt
    if (this.decideT[t] <= 0) {
      const tight = this.pressure(o) < 2.4
      this.decideT[t] = (this.ai[t].decide / this.styles[t].tempo) * (0.7 + rnd() * 0.6) * (tight ? 0.6 : 1)
      this.carrierAI(o)
    }
  }

  carrierAI(p: MP, setPiece = false) {
    const b = this.ball
    if (b.owner !== p) return
    const t = p.team, tac = this.tactics[t], st = this.styles[t]
    const gx = this.goalX(t)
    const dGoal = hyp(gx - p.x, CY - p.y)
    const pressure = this.pressure(p)
    const errMul = this.ai[t].err
    const ox = this.ownX(t, p.x), oy = this.ownY(t, p.y)
    const line = this.offsideLine(t)
    const urge = this.urgency(t)
    const final = ox > 70
    // just won it back: a counter-attacking side looks forward at once
    const transition = this.clock - this.wonAt[t] < 4 ? st.counter : 0
    let bestS = -1e9
    let act: () => void = () => this.clearBall(p)
    const consider = (s: number, f: () => void) => { if (s > bestS) { bestS = s; act = f } }
    if (!p.isGK && dGoal < 34) {
      const xg = this.shotValue(p, dGoal, pressure)
      let s = 0.2 + xg * 6.5 + (dGoal > 18 ? st.longShot * 1.6 : 0) + urge * 0.45 + (tac.mentality === 'attacking' ? 0.08 : 0) + rnd() * 0.25
      if (setPiece) s -= 2
      consider(s, () => this.aiShoot(p, dGoal))
    }
    const star = st.star > 0 ? this.teams[t].reduce((m, q) => (q.data.overall > m.data.overall ? q : m), p) : null
    const behind = L - line // room behind their back line
    for (const m of this.teams[t]) {
      if (m === p || m.stun > 0.2 || m.hold || m.slideT > 0) continue
      const d = hyp(m.x - p.x, m.y - p.y)
      if (d < 4 || d > 55) continue
      const mox = this.ownX(t, m.x)
      const progress = (mox - ox) / 30
      if (mox > L / 2 && mox > line + 0.25 && rnd() > 0.06 * errMul) continue // spots the offside
      const laneM = this.laneOpen(p.x, p.y, m.x, m.y, t)
      if (laneM < 0 && d < 15) continue // will be cut out, and too short to chip
      const lane = clamp(laneM + 1, 0, 5) / 5
      const space = Math.min(this.pressure(m), 8) / 8
      // a direct side lofts the long ones forward even when the grass is open
      let kind: PassKind = (lane < 0.3 && d > 14) || d > 34 || (st.direct > 0.62 && d > 22 && progress > 0.35) ? 'lofted' : 'ground'
      // a passing side values a safe lane more than a risky gain
      let s = progress * (0.85 + st.direct * 0.6 + transition * 0.6 + urge * 0.4) + lane * (0.8 + Math.max(0, st.shortPass - 0.5) * 0.7) + space * 0.55 - Math.max(0, 1.2 - laneM) * 0.35
      // a passing side plays forward into feet and keeps moving
      if (progress > 0.05 && d < 18 && laneM > 0.3) s += st.shortPass * 0.3
      if (progress < 0 && ox > 55) s += progress * (0.6 - st.shortPass * 0.35) // don't keep recycling backwards in their half (tiki-taka minds less)
      s -= d > 30 ? (d - 30) / (22 + st.direct * 22) : 0
      if (st.shortPass > 0.6 && d > 22) s -= 0.4 * st.shortPass
      if (st.shortPass > 0.6 && d < 15) s += 0.15 + (st.shortPass - 0.6) * 0.5
      if (m.isGK) s -= 0.9
      if (p.isGK && m.cat === 'DF') s += 0.25 * (st.shortPass + 0.3)
      if (star && m === star) s += st.star * 0.4
      if (m.runT > 0 && progress > 0 && behind > 14) { s += 0.4 + st.direct * 0.2 + transition * 0.3; kind = laneM < 0.2 && behind > 22 ? 'loftThrough' : 'through' }
      if (kind === 'lofted') s -= 0.25 - st.direct * 0.15 + Math.max(0, st.shortPass - 0.6) * 1.4
      if (kind === 'lofted' && st.direct > 0.6 && progress > 0.35 && (m.cat === 'FW' || m.role === 'AM')) s += (st.direct - 0.55) * 1.6 // the long ball up to the front men
      if (st.cross > 0.68 && Math.abs(this.ownY(t, m.y) - CY) > 17 && progress > -0.15 && mox > 45) s += (st.cross - 0.6) * 1.1 // get it out wide
      if (p.holdT < 1 && progress > 0.5 && st.counter > 0.5) s += 0.2
      const k = kind
      consider(s, () => this.passTo(p, m, k, errMul))
    }
    if (!p.isGK && !setPiece && ox > 70 - Math.max(0, st.cross - 0.62) * 30 && Math.abs(oy - CY) > 11) {
      // wide in the final third (a wing side from deeper: early crosses): whip it in to whoever is waiting in the box
      const tgt = this.crossTarget(p, null)
      if (tgt) {
        let n = 0
        for (const m of this.teams[t]) if (m !== p && this.ownX(t, m.x) > L - 20 && Math.abs(m.y - CY) < 12) n++
        const s = 0.5 + st.cross * 0.8 + st.direct * 0.25 + Math.min(n, 3) * 0.14 + (ox > 88 ? 0.22 : 0) + (this.aerial(tgt) > 80 ? 0.12 : 0) - (pressure < 1.4 ? 0.25 : 0) + rnd() * 0.2
        const kind: PassKind = ox < 84 ? 'earlyCross' : this.pressure(tgt) > 3.2 && rnd() < 0.5 ? 'lowCross' : 'cross'
        consider(s, () => { const [tx, ty] = this.crossPoint(tgt); this.pass(p, tx, ty, kind, { target: tgt, err: errMul }) })
      }
      // at the byline: pull it back for a runner arriving at the edge of the box
      if (ox > 93) {
        for (const m of this.teams[t]) {
          if (m === p || m.isGK) continue
          const mox = this.ownX(t, m.x), moy = this.ownY(t, m.y)
          if (mox < L - 22 || mox > L - 7 || Math.abs(moy - CY) > 11) continue
          const lane = this.laneOpen(p.x, p.y, m.x, m.y, t)
          if (lane < 0.2) continue
          consider(1.15 + Math.min(lane, 3) * 0.15 + Math.min(this.pressure(m), 5) * 0.06, () => this.passTo(p, m, 'ground', errMul))
        }
      }
    }
    if (!p.isGK && !setPiece) {
      let s = 0.55 + (p.s.dribbling - 60) / 90 + (pressure > 4 ? 0.45 : pressure < 2 ? -0.45 : 0) - p.holdT * 0.12 + st.dribble + rnd() * 0.25
      let crowd = 0
      for (const o of this.teams[this.opp(t)]) if (hyp(o.x - p.x, o.y - p.y) < 4.5) crowd++
      if (crowd >= 2) s -= 0.3 * (crowd - 1) // two men closing in: lay it off
      const room = this.spaceAhead(p)
      if (room > 7) s += 0.35 + transition * 0.3 // open grass in front: run at them
      else if (room < 2.6) s -= 0.35 // a defender squared up in front: move it on (or take him on, see aiDribble)
      if (ox > 85) s -= 0.2
      if (dGoal < 22) s -= 0.4 // in range: look for the shot or the final pass
      if (final) s -= 0.12 + p.holdT * 0.1 // don't run around in their third: make something happen
      if (st.shortPass > 0.7) s -= (st.shortPass - 0.7) * 1.8 // a passing side gives it and goes
      consider(s, () => this.aiDribble(p))
    }
    if (!setPiece && !p.isGK && ox < 22 && pressure < 1.8) consider(0.45, () => this.clearBall(p))
    if (!setPiece && !p.isGK && ox < 40 && Math.abs(oy - CY) > 14 && pressure < 3.2) {
      consider(0.5 + (3.2 - pressure) * 0.3 + (tac.mentality === 'defensive' ? 0.15 : 0) - st.shortPass * 0.25 + rnd() * 0.2, () => this.kickToTouch(p))
    }
    act()
  }

  /** Safety first: knock it out of play over the near touchline (a throw for them, but no danger). */
  private kickToTouch(p: MP) {
    const t = p.team
    const a = Math.atan2(p.y < CY ? -1 : 1, this.dir(t) * (0.5 + rnd() * 0.9)) + gauss() * 0.1
    this.kick(p, Math.cos(a) * 15, Math.sin(a) * 15, 3.5)
    this.emit({ k: 'kick', v: 0.6 })
  }

  /** Roughly the chance a shot from here goes in (0..0.6): distance, angle, a clear sight of goal and time on the ball. */
  private shotValue(p: MP, d: number, pressure: number) {
    const t = p.team, gx = this.goalX(t)
    const angle = Math.abs(CY - p.y) / Math.max(d, 1)
    let xg = 0.8 * Math.exp(-d / 7.2) * clamp(1.15 - angle * 0.9, 0.12, 1) * (0.6 + Math.min(p.s.shooting, 110) / 180)
    const lane = Math.max(this.laneOpen(p.x, p.y, gx, CY - 2.4, t, 26, true), this.laneOpen(p.x, p.y, gx, CY, t, 26, true), this.laneOpen(p.x, p.y, gx, CY + 2.4, t, 26, true))
    if (lane < -0.4) xg *= 0.4
    else if (lane < 0.5) xg *= 0.75
    if (pressure < 1.4) xg *= 0.75
    return xg
  }

  /** 0..1: a side that is behind late in the match goes for it (more direct, shoots on sight). */
  urgency(t: Side) {
    const diff = this.score[t] - this.score[this.opp(t)]
    if (diff >= 0 || this.half === 1 || this.half === 3 || this.half >= 5) return 0
    const left = 1 - this.elapsed / this.halfLen()
    return clamp((0.55 - left) / 0.55, 0, 1) * Math.min(1, -diff * 0.7)
  }

  /** Distance to the nearest opponent in a cone towards goal (how much room there is to run into). */
  private spaceAhead(p: MP) {
    const t = p.team
    const fx = this.dir(t)
    let m = 20
    for (const o of this.teams[this.opp(t)]) {
      const dx = (o.x - p.x) * fx, dy = o.y - p.y
      if (dx < -1) continue
      if (Math.abs(dy) > dx * 0.9 + 2) continue
      m = Math.min(m, hyp(dx, dy))
    }
    return m
  }

  private aiShoot(p: MP, dGoal: number) {
    const t = p.team
    const gk = this.gk(this.opp(t))
    let kind: ShotKind = 'normal'
    const gkOut = gk ? hyp(gk.x - this.goalX(t), gk.y - CY) : 0
    if (gkOut > 6 && dGoal < 24 && rnd() < 0.55) kind = 'chip'
    else if (p.s.shooting > 70 && dGoal > 14 && rnd() < 0.3) kind = 'finesse'
    else if (dGoal < 14 && rnd() < 0.3) kind = 'driven'
    this.shoot(p, clamp(0.55 + rnd() * 0.4 + (dGoal > 20 ? 0.1 : 0), 0, 1), kind === 'finesse' ? CY + (p.y < CY ? 1 : -1) * 2.8 : this.aiAimY(t), kind)
  }

  private aiDribble(p: MP) {
    const t = p.team, gx = this.goalX(t)
    const fx = Math.cos(p.face), fy = Math.sin(p.face)
    const dribs = Math.min(p.s.dribbling, 110)
    for (const o of this.teams[this.opp(t)]) {
      const dx = o.x - p.x, dy = o.y - p.y, d = hyp(dx, dy)
      if (d < 3 && (dx * fx + dy * fy) / (d || 1) > 0.3 && dribs > 60 && rnd() < (dribs - 52) / 80 + this.styles[t].dribble) {
        const pool: SkillId[] = dribs >= 88 ? ['elastico', 'roulette', 'rainbow', 'mcgeady', 'stepover', 'ballroll'] : dribs >= 76 ? ['roulette', 'mcgeady', 'stepover', 'ballroll', 'feint'] : ['feint', 'dragback', 'stepover']
        // an icon reaches for his trademark move half the time
        const id = p.sig && rnd() < 0.4 ? p.sig : pool[Math.floor(rnd() * pool.length)]
        this.startSkill(p, id, angDiff(Math.atan2(dy, dx), p.face) > 0 ? -1 : 1)
        return
      }
    }
    let dx = gx - p.x, dy = CY - p.y
    const n = hyp(dx, dy) || 1
    dx /= n; dy /= n
    for (const o of this.teams[this.opp(t)]) {
      const ox = p.x - o.x, oy = p.y - o.y, od = hyp(ox, oy)
      if (od < 7 && od > 0) { dx += ((ox / od) * (7 - od)) / 5; dy += ((oy / od) * (7 - od)) / 5 }
    }
    let m = hyp(dx, dy) || 1
    // keep driving forward: avoidance may bend the run, but not turn it into sideways wandering
    const fwd = (dx / m) * this.dir(t)
    if (fwd < 0.35 && this.pressure(p) > 1.5) { dx += this.dir(t) * (0.35 - fwd) * m * 1.4; m = hyp(dx, dy) || 1 }
    p.tx = clamp(p.x + (dx / m) * 6, 1, L - 1)
    p.ty = clamp(p.y + (dy / m) * 6, 1.5, W - 1.5)
  }

  private clearBall(p: MP) {
    const t = p.team
    // deep in our own box under pressure: sometimes it just goes behind for a corner
    if (!p.isGK && this.ownX(t, p.x) < 13 && this.pressure(p) < 2.2 && rnd() < 0.45) {
      const gy = p.y < CY ? -6 : W + 6
      const a = Math.atan2(gy - p.y, this.ownGoalX(t) - p.x) + gauss() * 0.2
      this.kick(p, Math.cos(a) * 16, Math.sin(a) * 16, 3)
      this.emit({ k: 'kick', v: 0.6 })
      return
    }
    // wide in our own third under pressure: safety first, put it out for a throw
    if (!p.isGK && this.ownX(t, p.x) < 38 && Math.abs(p.y - CY) > 15 && this.pressure(p) < 3 && rnd() < 0.45) { this.kickToTouch(p); return }
    const a = (t === 0 ? 0 : Math.PI) + (p.y < CY ? -0.35 : 0.35) * rnd() + gauss() * 0.25
    const ax = clamp(p.x + Math.cos(a) * 40, 2, L - 2), ay = clamp(p.y + Math.sin(a) * 40, 2, W - 2)
    let best: MP | null = null, bd = 18
    for (const m of this.teams[t]) { if (m === p) continue; const d = hyp(m.x - ax, m.y - ay); if (d < bd) { bd = d; best = m } }
    this.pass(p, ax, ay, p.isGK ? 'goalkick' : 'clear', { target: best })
  }

  private cpuSetPiece() {
    const p = this.setTaker, a = this.restartTeam, kind = this.restartKind
    const b = this.ball
    const release = () => { if (this.phase === 'restart' || this.phase === 'kickoff') { this.phase = 'play'; b.fixed = false; if (!this.so) for (const q of this.players) q.hold = false } }
    if (!p || b.owner !== p) { release(); return }
    const err = this.ai[a].err
    const st = this.styles[a]
    const mates = this.teams[a].filter(m => m !== p)
    switch (kind) {
      case 'kickoff': {
        const m = mates.filter(q => !q.isGK).sort((x, y) => hyp(x.x - p.x, x.y - p.y) - hyp(y.x - p.x, y.y - p.y))[0]
        if (m) this.passTo(p, m, 'ground', err)
        else this.kick(p, -this.dir(a) * 8, 0, 0)
        break
      }
      case 'penalty': {
        const r = rnd()
        const side = r < 0.44 ? -1 : r < 0.88 ? 1 : 0
        const chip = side === 0 && rnd() < 0.4 && p.s.shooting > 72
        this.penaltyKick(p, chip ? 0.5 : 0.5 + rnd() * 0.35, CY + side * (2.0 + rnd() * 1.3), chip)
        break
      }
      case 'corner': {
        const box = mates.filter(m => this.ownX(a, m.x) > L - 17 && Math.abs(m.y - CY) < 13)
        if (!box.length || rnd() < 0.1) {
          const m = mates.filter(q => !q.isGK).sort((x, y) => hyp(x.x - p.x, x.y - p.y) - hyp(y.x - p.x, y.y - p.y))[0]
          if (m) this.passTo(p, m, 'ground', err)
          break
        }
        const tgt = box.map(m => [m, this.aerial(m) + rnd() * 25] as const).sort((x, y) => y[1] - x[1])[0][0]
        const [ax, ay] = this.crossPoint(tgt)
        const curl = curlToward(b.x, b.y, ax, ay, this.goalX(a), CY) * (0.012 + rnd() * 0.014)
        this.pass(p, ax, ay, 'cross', { target: tgt, err, curl, power: 0.4 + rnd() * 0.5, exempt: true })
        break
      }
      case 'free': {
        if (this.direct && rnd() < 0.72) {
          const gk = this.gk(this.opp(a))
          const side = gk && gk.y < CY ? 1 : -1
          const aimY = CY + side * (2.3 + rnd() * 0.9)
          this.spShot(p, aimY, 0.45 + rnd() * 0.35, finesseSpin(b.x, b.y, this.goalX(a), aimY, 0.6))
        } else if (this.ownX(a, p.x) > 60) {
          const box = mates.filter(m => this.ownX(a, m.x) > L - 20 && Math.abs(m.y - CY) < 14)
          if (box.length) { const tgt = box[Math.floor(rnd() * box.length)]; const [ax, ay] = this.crossPoint(tgt); this.pass(p, ax, ay, 'cross', { target: tgt, err, power: 0.6 }) }
          else this.carrierAI(p, true)
        } else this.carrierAI(p, true)
        break
      }
      case 'throw': {
        let best: MP | null = null, bs = -1e9
        for (const m of mates) {
          if (m.isGK) continue
          const d = hyp(m.x - p.x, m.y - p.y)
          if (d > 22) continue
          const s = Math.min(this.pressure(m), 6) - d / 6 + (this.ownX(a, m.x) - this.ownX(a, p.x)) / 15
          if (s > bs) { bs = s; best = m }
        }
        if (best) this.pass(p, best.x, best.y, hyp(best.x - p.x, best.y - p.y) > 14 ? 'longThrow' : 'throw', { target: best, err, exempt: true })
        else { const [ax, ay] = this.world(a, this.ownX(a, p.x) + 10, CY); this.pass(p, ax, ay, 'longThrow', { err, exempt: true }) }
        break
      }
      case 'goalkick': {
        const cbs = mates.filter(m => m.cat === 'DF' && !m.isGK && this.pressure(m) > 6)
        if (cbs.length && rnd() < 0.3 + st.shortPass * 0.6) this.passTo(p, cbs[Math.floor(rnd() * cbs.length)], 'ground', err)
        else {
          const fw = mates.filter(m => m.cat === 'FW' || m.role === 'AM' || m.cat === 'MF')
          const m = fw[Math.floor(rnd() * fw.length)]
          if (m) this.pass(p, m.x, m.y, 'goalkick', { target: m, err, exempt: true })
          else this.clearBall(p)
        }
        break
      }
    }
    release()
  }

  private aiTackles(dt: number) {
    const c = this.ball.owner
    if (!c || this.ball.hands) return
    for (const p of this.teams[this.opp(c.team)]) {
      if (p === this.ctrl[p.team] || p.isGK || p.tackleCd > 0 || p.stun > 0 || p.beatenT > 0 || p.slideT > 0) continue
      const d = hyp(p.x - c.x, p.y - c.y)
      const st = this.styles[p.team]
      if (d < 1.5) {
        const behind = Math.cos(c.face - Math.atan2(c.y - p.y, c.x - p.x)) > 0.35
        const rate = this.ai[p.team].tackleRate * st.tackle * (p.pressing && this.human[p.team] && this.ctl[p.team].pressCall ? 1.5 : 1) * (behind ? 0.35 : 1)
        if (rnd() < rate * dt) this.tackle(p)
      } else if (d < 3 && p.s.defending > 55 && hyp(c.vx, c.vy) > 4.5 && rnd() < 0.12 * dt * st.tackle * (p.traits.has('hard_tackler') ? 2 : 1)) {
        this.startSlide(p, Math.atan2(c.y + c.vy * 0.25 - p.y, c.x + c.vx * 0.25 - p.x))
      }
      if (this.phase !== 'play' || !this.ball.owner) return
    }
  }

  // ------------------------------------------------------------------------------------------------ movement
  accel(p: MP, dvx: number, dvy: number, dt: number, mul = 1) {
    const a = 13 * (0.75 + Math.min(p.s.physical, 110) / 400) * dt * mul * (this.weather === 'snow' ? 0.85 : 1)
    const ex = dvx - p.vx, ey = dvy - p.vy, e = hyp(ex, ey)
    if (e <= a) { p.vx = dvx; p.vy = dvy } else { p.vx += (ex / e) * a; p.vy += (ey / e) * a }
  }

  steer(p: MP, dt: number, hasBall: boolean) {
    const dx = p.tx - p.x, dy = p.ty - p.y, d = hyp(dx, dy)
    if (d < 0.25) { this.accel(p, 0, 0, dt); p.sprint = false; return }
    p.sprint = d > 7 || p.receiveT > 0 || (p.pressing && d > 3) || p.celebrate
    const ms = p.maxSpeed() * (p.sprint ? 1 : 0.68) * (hasBall ? Math.min(1, 0.82 + p.s.dribbling * 0.0012) : 1)
    const sp = Math.min(ms, d * 2.2)
    this.accel(p, (dx / d) * sp, (dy / d) * sp, dt)
  }

  integrate(dt: number) {
    const b = this.ball
    const tire = dt * (300 / (this.opts.halfSeconds * 2)) * (this.half > 2 ? 1.25 : 1)
    for (const p of this.players) {
      p.x += p.vx * dt; p.y += p.vy * dt
      p.x = clamp(p.x, -2, L + 2); p.y = clamp(p.y, -2, W + 2)
      const sp = hyp(p.vx, p.vy)
      if (p.skill) { if (p.faceLock != null) p.face = p.faceLock }
      else if (p.diveT <= 0) {
        const target = p.faceLock ?? (sp > 0.4 ? Math.atan2(p.vy, p.vx) : p.face)
        const rate = (b.owner === p ? 7 + Math.min(p.s.dribbling, 110) / 14 - sp * 0.25 : 12) * dt
        const dd = angDiff(target, p.face)
        p.face += Math.abs(dd) <= rate ? dd : Math.sign(dd) * rate
      }
      p.faceLock = null
      p.anim += sp * dt * 1.6
      const f = sp / p.baseSpeed()
      const drain = f > 0.8 ? 0.0068 : f > 0.5 ? 0.0021 : -0.0006
      p.stamina = clamp(p.stamina - drain * p.ageTire * (1.25 - Math.min(p.s.physical, 110) / 200) * (p.traits.has('tireless') && drain > 0 ? 0.7 : 1) * tire, 0.2, 1)
      p.stun = Math.max(0, p.stun - dt); p.tackleCd = Math.max(0, p.tackleCd - dt); p.beatenT = Math.max(0, p.beatenT - dt)
      p.runT = Math.max(0, p.runT - dt); p.receiveT = Math.max(0, p.receiveT - dt); p.jumpT = Math.max(0, p.jumpT - dt)
      p.burstT = Math.max(0, p.burstT - dt); p.kickT = Math.max(0, p.kickT - dt); p.supT = Math.max(0, p.supT - dt)
    }
    const ps = this.players
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], c = ps[j]
      const dx = c.x - a.x, dy = c.y - a.y
      if (dx > 1.05 || dx < -1.05 || dy > 1.05 || dy < -1.05) continue
      const d = hyp(dx, dy)
      if (d > 0 && d < 1.05) {
        const push = (1.05 - d) / 2
        a.x -= (dx / d) * push; a.y -= (dy / d) * push
        c.x += (dx / d) * push; c.y += (dy / d) * push
      }
    }
    if (b.owner && !b.fixed) this.attachBall(b.owner)
  }

  attachBall(p: MP) {
    const b = this.ball
    let ax: number, ay: number
    if (p.skill) [ax, ay] = this.skillBall(p)
    else if (b.hands) { ax = Math.cos(p.face) * 0.3; ay = Math.sin(p.face) * 0.3 }
    else {
      const sp = hyp(p.vx, p.vy)
      const off = p.shield ? 0.42 : 0.5 + sp * 0.06 * (1.25 - Math.min(p.s.dribbling, 110) / 100)
      ax = Math.cos(p.face) * off; ay = Math.sin(p.face) * off
    }
    b.x = p.x + ax; b.y = p.y + ay; b.vx = p.vx; b.vy = p.vy
    b.z = b.hands ? 1.0 : 0; b.vz = 0
  }

  private updateCam(dt: number) {
    const b = this.ball
    let tx = b.x + b.vx * 0.35, ty = b.y + b.vy * 0.35
    if (this.phase === 'goal' && this.celebLeader) { tx = this.celebLeader.x; ty = this.celebLeader.y }
    const k = 1 - Math.exp(-3.2 * dt)
    this.cam.x += (clamp(tx, -2, L + 2) - this.cam.x) * k
    this.cam.y += (clamp(ty, -2, W + 2) - this.cam.y) * k
  }

  // ------------------------------------------------------------------------------------------------ output
  /** 0..1 how exciting the moment is, and whether the home side is the one attacking (crowd noise). */
  excitement(): [number, boolean] {
    const b = this.ball
    if (this.phase === 'goal') return [1, this.celebTeam === this.homeTeam]
    if (this.so) return [0.75, this.so.turn === this.homeTeam]
    const t = b.owner?.team ?? b.last?.team
    if (t == null) return [0.2, false]
    let e = clamp((this.ownX(t, b.x) - 55) / 45, 0, 1) * 0.8
    if (b.shot) e = Math.max(e, 0.9)
    if (this.phase === 'restart' && (this.restartKind === 'penalty' || this.restartKind === 'corner' || this.direct)) e = Math.max(e, 0.6)
    return [e, t === this.homeTeam]
  }

  private hudCtx(s: Side): HudCtx {
    if (!this.human[s]) return 'none'
    const p = this.ctrl[s]
    if (this.phase === 'restart') {
      if (this.restartKind === 'penalty') return this.restartTeam === s ? (p === this.setTaker ? 'pen' : 'none') : 'keeper'
      if (this.restartTeam === s && p === this.setTaker) return 'set'
      return 'def'
    }
    if (this.phase === 'kickoff') return this.restartTeam === s ? 'kickoff' : 'def'
    if (p && this.ball.owner === p && p.isGK) return 'gk'
    return this.contextOf(s) === 'att' ? 'att' : 'def'
  }

  private prompt(s: Side): string {
    if (!this.human[s]) return ''
    const p = this.ctrl[s]
    if (this.phase === 'restart') {
      const k = this.restartKind
      if (k === 'penalty') return this.restartTeam === s ? (p === this.setTaker ? 'penTake' : '') : 'penKeep'
      if (this.restartTeam !== s || p !== this.setTaker) return ''
      if (k === 'free') return this.direct ? 'freeDirect' : 'free'
      return k
    }
    if (this.phase === 'kickoff' && this.restartTeam === s && p === this.setTaker) return 'kickoff'
    if (p && this.ball.owner === p && p.isGK) return 'gk'
    return ''
  }

  hud(): HudState {
    const tot = this.possT[0] + this.possT[1] || 1
    const side = (s: Side): SideHud => {
      const p = this.ctrl[s]
      const inj = this.human[s] ? this.teams[s].find(q => q.injured) : undefined
      return {
        name: p ? `${p.data.shirt}. ${p.data.name}` : '', stamina: p?.stamina ?? 1, power: this.ctl[s].charge ? this.chargePower(this.ctl[s]) : 0,
        ctx: this.hudCtx(s), prompt: this.prompt(s), injured: inj ? inj.data.name : '', sig: p?.sig ?? '',
      }
    }
    const showBanner = this.bannerT > 0 || this.phase === 'goal' || this.phase === 'half' || this.phase === 'end'
    return {
      score: [...this.score] as [number, number], minute: this.minute(), half: this.half, phase: this.phase,
      banner: this.paused ? this.t('paused') : this.phase === 'replay' ? '' : showBanner ? this.banner : '',
      paused: this.paused, pauseReason: this.pauseReason, feed: [...this.feed], colors: [this.colors[0][0], this.colors[1][0]],
      mentality: [this.tactics[0].mentality, this.tactics[1].mentality], sides: [side(0), side(1)], human: [...this.human] as [boolean, boolean],
      stats: JSON.parse(JSON.stringify(this.stats)) as Stats, poss: Math.round((this.possT[0] / tot) * 100), subsLeft: [this.subsLeft(0), this.subsLeft(1)],
      cards: [...this.cards], extraTime: this.extraTime,
      so: this.so ? { k: [[...this.so.k[0]], [...this.so.k[1]]], turn: this.so.turn, first: this.so.first } : null, ended: this.ended,
      intro: this.intro, celebPick: this.celebPick(), goals: this.goalLog.map(g => ({ ...g })),
    }
  }

  statics(): Statics { return this.statics_ }

  private buildStatics(): Statics {
    const pl: Statics['pl'] = {}
    for (const t of [0, 1] as Side[]) {
      for (const p of this.teams[t]) pl[p.data.id] = { n: p.data.name, s: p.data.shirt, t }
      for (const p of this.bench[t]) pl[p.id] = { n: p.name, s: p.shirt, t }
    }
    return {
      kit: [0, 1].map(t => ({ c1: this.kits[t].shirt, c2: this.kits[t].trim, gk: this.gkKits[t], pat: this.kits[t].pattern,
        sh: this.kits[t].shorts, so: this.kits[t].socks })) as Statics['kit'],
      names: [...this.names] as [string, string], shorts: [...this.shorts] as [string, string], pl, weather: this.weather, home: this.homeTeam,
      night: this.setup.fixture?.comp === 'cl',
    }
  }

  /** The current picture: positions, ball, score and overlays (a replay frame during replays). */
  frameState(): FrameState {
    if (this.phase === 'replay' && this.rp) {
      const f = this.rp.frames[Math.min(this.rp.frames.length - 1, Math.floor(this.rp.i))]
      return { ...f, rp: true, ph: 'replay', bn: '', sl: Math.abs(this.rp.i - this.rp.goalAt) < 24 }
    }
    return this.liveFrame(true)
  }

  private liveFrame(withOv: boolean): FrameState {
    const b = this.ball
    const pl: number[] = []
    for (const p of this.players) {
      let fl = 0
      if (p.isGK) fl |= F_GK
      if (p.stun > 0.25 && p.slideT <= 0) fl |= F_DOWN
      if (p.slideT > 0) fl |= F_SLIDE
      if (p.diveT > 0) fl |= F_DIVE
      if (p.jumpT > 0) fl |= F_JUMP
      if (p.skill) fl |= F_SKILL
      if (p.yellow) fl |= F_YELLOW
      if (p.sprint) fl |= F_SPRINT
      if (p === this.ctrl[0]) fl |= F_CTRL0
      if (p === this.ctrl[1]) fl |= F_CTRL1
      if (p.beatenT > 0) fl |= F_BEATEN
      if (p.celebrate && this.phase === 'goal') fl |= F_CELEB
      if (b.owner === p && b.hands) fl |= F_HANDS
      if (p.kickT > 0) fl |= F_KICK
      pl.push(p.data.id, r2(p.x), r2(p.y), r2(p.face), r2(hyp(p.vx, p.vy)), fl, r2(p.anim % 1000))
    }
    const f: FrameState = {
      t: r2(this.clock), ph: this.phase, half: this.half, min: this.minute(), sc: [this.score[0], this.score[1]],
      bn: this.bannerT > 0 || this.phase === 'goal' || this.phase === 'half' || this.phase === 'end' ? this.banner : '',
      cam: [r2(this.cam.x), r2(this.cam.y)], ball: [r2(b.x), r2(b.y), r2(b.z)], bs: Math.round(b.spin * 1000) / 1000, owner: b.owner ? b.owner.data.id : -1, pl,
      sk: r2(this.shake), wf: r2(this.whiteFlash), nr: r2(this.netT), celeb: r2(this.celebT), ct: this.celebTeam,
    }
    if (this.so) f.so = { k: [[...this.so.k[0]], [...this.so.k[1]]], turn: this.so.turn }
    if (this.slowmo > 0) f.sl = true
    if (this.intro) f.wo = r2(Math.min(1, this.introT / 6))
    if (this.phase === 'goal' && this.celebKind && this.celebLeader) f.cel = [this.celebLeader.data.id, this.celebKind, r2(this.clock - this.celebAt)]
    f.ex = r2(this.excitement()[0])
    if (withOv) f.ov = this.overlay()
    return f
  }

  private overlay(): Overlay {
    const ov: Overlay = { pw: [0, 0], aim: [null, null], tgt: [-1, -1], off: -1, fl: this.flashT > 0 ? this.flash : '', fx: r2(this.flashX), fy: r2(this.flashY), fa: r2(Math.min(1, this.flashT * 2)) }
    for (const s of [0, 1] as Side[]) {
      if (!this.human[s]) continue
      const c = this.ctl[s]
      ov.pw[s] = c.charge ? r2(this.chargePower(c)) : 0
      if (c.tgt) ov.tgt[s] = c.tgt.data.id
      if (this.phase === 'restart' && this.restartTeam === s && c.aim && this.ctrl[s] === this.setTaker) {
        const kind = this.restartKind
        const shot = kind === 'penalty' || c.charge?.kind === 'spShot' || (this.direct && !c.charge)
        const mode = shot ? 2 : 1
        const peak = shot ? 0 : kind === 'throw' ? 2.2 : 2.5 + (c.charge ? (1 - this.chargePower(c)) * 3 : 1.5)
        ov.aim[s] = [r2(c.aim.x), r2(c.aim.y), Math.round(c.aim.curl * 45) / 1000, mode, r2(peak)]
      }
      const own = this.ball.owner
      if (this.phase === 'play' && own && own.team === s && this.ownX(s, own.x) > L / 2 - 8) {
        const line = this.offsideLine(s)
        ov.off = r2(this.world(s, Math.max(line, L / 2), 0)[0])
      }
    }
    return ov
  }

  /** Watch mode "skip to end": run the rest of the match through the engine without drawing. */
  fastForward(steps: number) {
    this.fast = true
    for (let i = 0; i < steps && this.phase !== 'end'; i++) this.update(1 / 60)
  }
}

// ------------------------------------------------------------------------------------------------ module helpers
function matchCombo(seq: string[], toks: Flick[]): number | null {
  if (seq.length !== toks.length) return null
  let lastS = 0
  for (let i = 0; i < seq.length; i++) {
    const q = seq[i], k = toks[i]
    if (q === 'F' || q === 'B') { if (k.d !== q) return null; continue }
    if (k.d !== 'S') return null
    if (q === 'S') { if (lastS !== 0 && k.s !== lastS) return null; lastS = k.s }
    else { if (lastS === 0 || k.s !== -lastS) return null; lastS = k.s }
  }
  return lastS
}

function comboPending(toks: Flick[]): boolean {
  for (const k of SKILLS) for (let n = 1; n <= toks.length; n++) {
    if (k.seq.length <= n) continue
    if (matchCombo(k.seq.slice(0, n), toks.slice(toks.length - n)) !== null) return true
  }
  return false
}

/** Curvature sign (1/m) that bends a ball travelling s → a towards point p at the end. */
function curlToward(sx: number, sy: number, ax: number, ay: number, px: number, py: number) {
  const hx = ax - sx, hy = ay - sy
  const cr = hx * (py - ay) - hy * (px - ax)
  return cr === 0 ? 1 : Math.sign(cr)
}

/** Finesse: aimed inside the far post, starting wide and curling back in. */
function finesseSpin(sx: number, sy: number, gx: number, aimY: number, power: number) {
  return curlToward(sx, sy, gx, aimY, gx, CY) * (0.024 + power * 0.008)
}

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
/** Perceptual colour distance ("redmean" weighting: green differences show most, then red, then blue). 0..~765 */
export function colorDist(a: string, b: string) {
  const [r1, g1, b1] = rgb(a), [r2_, g2, b2] = rgb(b)
  const rm = (r1 + r2_) / 2, dr = r1 - r2_, dg = g1 - g2, db = b1 - b2
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db)
}
const KIT_CLASH = 200
/** How much of the shirt each pattern paints in the trim colour (to judge how a kit looks from afar). */
const TRIM_SHARE: Record<string, number> = { plain: 0.05, stripes: 0.5, pinstripes: 0.15, hoops: 0.5, halves: 0.5, quarters: 0.5,
  sash: 0.25, chevron: 0.15, sleeves: 0.3, centre: 0.25, band: 0.2 }
function mix(a: string, b: string, t: number) {
  const [r1, g1, b1] = rgb(a), [r2_, g2, b2] = rgb(b)
  const h = (v: number) => Math.round(v).toString(16).padStart(2, '0')
  return '#' + h(r1 + (r2_ - r1) * t) + h(g1 + (g2 - g1) * t) + h(b1 + (b2 - b1) * t)
}
/** The colour a kit reads as from a distance. */
export function kitTone(k: KitDef) { return mix(k.shirt, k.trim, TRIM_SHARE[k.pattern] ?? 0.1) }
/** The colours a kit shows, with their share of the shirt (a plain kit's trim is only its collar). */
function kitColours(k: KitDef): { c: string; w: number }[] {
  const s = TRIM_SHARE[k.pattern] ?? 0.1
  return s < 0.15 ? [{ c: k.shirt, w: 1 }] : [{ c: k.shirt, w: 1 - s }, { c: k.trim, w: s }]
}
/** The cheapest way to turn one colour mix into the other (earth mover's distance, at most two colours each). */
function emd2(a: { c: string; w: number }[], b: { c: string; w: number }[]) {
  if (a.length === 1 || b.length === 1) {
    const [one, other] = a.length === 1 ? [a, b] : [b, a]
    return other.reduce((sum, x) => sum + x.w * colorDist(one[0].c, x.c), 0)
  }
  const cost = (f11: number) => {
    const f12 = a[0].w - f11, f21 = b[0].w - f11, f22 = 1 - a[0].w - b[0].w + f11
    return f11 * colorDist(a[0].c, b[0].c) + f12 * colorDist(a[0].c, b[1].c) + f21 * colorDist(a[1].c, b[0].c) + f22 * colorDist(a[1].c, b[1].c)
  }
  return Math.min(cost(Math.min(a[0].w, b[0].w)), cost(Math.max(0, a[0].w + b[0].w - 1)))
}
/** How different two kits look, 0 for identical (backend kits.go kitLook): they clash when they share a
 *  main colour (half of a striped shirt counts as main) or their colours, share for share, are close. */
export function kitDistance(a: KitDef, b: KitDef) {
  const A = kitColours(a), B = kitColours(b)
  let dom = Infinity
  for (const x of A) for (const y of B) if (x.w >= 0.45 && y.w >= 0.45) dom = Math.min(dom, colorDist(x.c, y.c))
  return Math.min(dom * KIT_CLASH / 150, emd2(A, B) * KIT_CLASH / 180)
}
/** Two kits look alike when one is made of the other's colours, or their colours are close overall. */
export function kitsClash(a: KitDef, b: KitDef) { return kitDistance(a, b) < KIT_CLASH }
function luma(hex: string) { const [r, g, b] = rgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255 }
/** A club's kits: its own set, or made from its two colours (white or a dark kit as the change kit). */
export function kitSetOf(club: { color: string; color2: string; kits?: KitSet | null }): KitSet {
  if (club.kits?.home && club.kits.away && club.kits.third) return club.kits
  const home: KitDef = { pattern: 'plain', shirt: club.color, trim: club.color2, shorts: luma(club.color) > 0.62 ? club.color2 : club.color, socks: club.color }
  const dark = luma(club.color) < 0.62
  const away: KitDef = dark ? { pattern: 'plain', shirt: '#f4f4f4', trim: club.color, shorts: club.color, socks: '#f4f4f4' }
    : { pattern: 'plain', shirt: '#1b2a4a', trim: club.color, shorts: '#1b2a4a', socks: '#1b2a4a' }
  const third: KitDef = { pattern: 'plain', shirt: '#111111', trim: club.color, shorts: '#111111', socks: '#111111' }
  return { home, away, third }
}
/** Kits for both teams. The home side wears its home kit unless the players picked another; an
 *  'auto' side takes the first of home, away, third that doesn't clash with the other side (or the
 *  one that stands out most). When both sides pick, both choices stand. */
export function chooseKits(sets: [KitSet, KitSet], home: Side, pick: [KitChoice, KitChoice]): [{ kit: KitDef; which: KitChoice }, { kit: KitDef; which: KitChoice }] {
  const order: KitChoice[] = ['home', 'away', 'third']
  const out: ({ kit: KitDef; which: KitChoice } | null)[] = [null, null]
  for (const t of [0, 1] as Side[]) if (pick[t] && pick[t] !== 'auto') out[t] = { kit: sets[t][pick[t] as 'home'], which: pick[t] }
  const away: Side = home === 0 ? 1 : 0
  // a side the players left on auto: the home side first (so the away side adapts), unless only it is free
  for (const t of (out[home] ? [away, home] : [home, away]) as Side[]) {
    if (out[t]) continue
    const other = out[t === 0 ? 1 : 0]
    if (!other) { out[t] = { kit: sets[t].home, which: 'home' }; continue }
    let best: { kit: KitDef; which: KitChoice } | null = null, bs = -1
    for (const w of order) {
      const k = sets[t][w as 'home']
      if (!kitsClash(k, other.kit)) { best = { kit: k, which: w }; break }
      const s = kitDistance(k, other.kit)
      if (s > bs) { bs = s; best = { kit: k, which: w } }
    }
    out[t] = best
  }
  return out as [{ kit: KitDef; which: KitChoice }, { kit: KitDef; which: KitChoice }]
}
/** Keeper shirts: from a few classic colours, the one furthest from both outfield kits (different for each side). */
function pickKeeperKits(k: [[string, string], [string, string]]): [string, string] {
  const pool = ['#2fd0c4', '#c8e04a', '#ff7a1a', '#b05cff', '#1c1c1c', '#ff4fa3', '#9be15d']
  const score = (c: string) => Math.min(colorDist(c, k[0][0]), colorDist(c, k[1][0]), colorDist(c, '#3a7d3c'))
  const sorted = [...pool].sort((x, y) => score(y) - score(x))
  const g0 = sorted[0]
  const g1 = sorted.find(c => colorDist(c, g0) > 160) ?? sorted[1]
  return [g0, g1]
}

export function takeSnapshot(e: Engine, fixtureId: number, mode?: Snapshot['mode']): Snapshot {
  const stamina: Record<number, number> = {}
  for (const p of e.players) stamina[p.data.id] = p.stamina
  return {
    fixtureId, score: [...e.score] as [number, number], shots: [...e.stats.shots] as [number, number], possT: [...e.possT] as [number, number],
    scorers: [...e.scorers], assists: [...e.assists], elapsed: e.elapsed, half: e.half, minute: e.minute(),
    mentality: e.tactics[0].mentality, mentality1: e.tactics[1].mentality, stamina, subs: [...e.subs], halfSeconds: e.opts.halfSeconds, difficulty: e.opts.difficulty,
    cards: [...e.cards], stats: JSON.parse(JSON.stringify(e.stats)), extraTime: e.extraTime, mode, pstats: e.playerStats(), goals: e.goalLog.map(g => ({ ...g })),
    so: e.so ? { k: [[...e.so.k[0]], [...e.so.k[1]]], turn: e.so.turn, first: e.so.first } : undefined,
  }
}
