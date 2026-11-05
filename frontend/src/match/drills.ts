import type { Player, Pos, Tactic } from '../types'
import type { IconName } from '../icons'
import { Engine, type EngineEvent, type EngineSide, type MP } from './engine'
import { CY, GOAL_H, GOAL_HALF, L, W, type FrameState } from './frame'
import type { CtlGroup } from './controls'

// ------------------------------------------------------------------------------------------------
// Training ground: short skill challenges played on the live-match engine (modes stream).
// A DrillRun owns an Engine with a tiny line-up (you, a keeper, maybe a wall or two teammates) and
// steps it like a match, but takes over the flow: after every attempt it puts players and ball back
// itself, so the engine's goal kicks, kick-offs and half time never happen. Hooks used, all public or
// read through the engine's own fields: restart() for free kicks and penalties, giveBall(), the
// private resetMoment() (bracket access, no engine change), phase/phaseT, ball, ctrl.
//
//   const run = new DrillRun('penalty', { name: 'You', t })
//   run.start()                          // 3-2-1, then the first attempt
//   every 1/60 s: run.eng.setInput(0, frame); run.step(1/60)
//   draw run.frame() with View, plus run.marks (gates, targets) through the view's projection
// ------------------------------------------------------------------------------------------------

export type DrillId = 'free' | 'slalom' | 'targets' | 'freekick' | 'penalty' | 'cross'

export interface DrillDef {
  id: DrillId
  icon: IconName
  /** time limit in seconds (0 = none) */
  secs: number
  /** number of attempts (0 = as many as fit in the time) */
  tries: number
  /** score needed for bronze, silver, gold (null: free practice) */
  medals: [number, number, number] | null
  /** the controls this challenge teaches: a group of controls.ts ROWS and the rows to show */
  keys: { group: CtlGroup; only: string[] }[]
}

export const DRILLS: DrillDef[] = [
  { id: 'slalom', icon: 'dribbling', secs: 60, tries: 0, medals: [10, 20, 28], keys: [{ group: 'att', only: ['move', 'sprint', 'skills', 'knock', 'shoot'] }] },
  { id: 'targets', icon: 'quest', secs: 60, tries: 0, medals: [6, 12, 18], keys: [{ group: 'att', only: ['move', 'shoot', 'finesse', 'chip', 'low'] }] },
  { id: 'freekick', icon: 'goal', secs: 0, tries: 5, medals: [1, 2, 3], keys: [{ group: 'set', only: ['aim', 'curl', 'spShot'] }] },
  { id: 'penalty', icon: 'cup', secs: 0, tries: 5, medals: [3, 4, 5], keys: [{ group: 'pen', only: ['penAim', 'penShoot', 'panenka', 'stutter'] }] },
  { id: 'cross', icon: 'assist', secs: 0, tries: 6, medals: [3, 6, 9], keys: [{ group: 'att', only: ['move', 'sprint', 'lob', 'lowCross', 'earlyCross', 'shoot'] }] },
  { id: 'free', icon: 'training', secs: 0, tries: 0, medals: null, keys: [{ group: 'att', only: ['move', 'sprint', 'shoot', 'finesse', 'chip', 'skills', 'knock', 'shield'] }] },
]

export const drillDef = (id: DrillId) => DRILLS.find(d => d.id === id)!

/** Medal for a score: 0 none, 1 bronze, 2 silver, 3 gold. */
export function medalOf(def: DrillDef, score: number): 0 | 1 | 2 | 3 {
  const m = def.medals
  if (!m) return 0
  return score >= m[2] ? 3 : score >= m[1] ? 2 : score >= m[0] ? 1 : 0
}

/** Things drawn on top of the pitch: slalom gates (two cones) and target boards in the goal mouth. */
export type Mark =
  | { k: 'gate'; x: number; y: number; half: number; state: 'todo' | 'next' | 'done' | 'missed' }
  | { k: 'target'; y0: number; y1: number; z0: number; z1: number; pts: number; hit: number }

export type DrillPhase = 'ready' | 'count' | 'run' | 'done'
/** What just happened, for the HUD (strings pl.dr.note.<note>). */
export type DrillNote = '' | 'goal' | 'header' | 'target' | 'saved' | 'miss' | 'post' | 'wall' | 'gate' | 'gateMiss' | 'lost' | 'bonus' | 'run' | 'time'

const TACTIC: Tactic = { mentality: 'balanced', pressing: 'mid', passing: 'mixed', width: 'normal' }
const r2 = (v: number) => Math.round(v * 100) / 100

function mkPlayer(id: number, name: string, pos: Pos, a: Partial<Record<'pace' | 'shooting' | 'passing' | 'dribbling' | 'defending' | 'physical' | 'goalkeeping', number>>, shirt: number, traits: string[] = []): Player {
  const s = { pace: 72, shooting: 70, passing: 70, dribbling: 72, defending: 45, physical: 70, goalkeeping: 15, ...a }
  const overall = pos === 'GK' ? s.goalkeeping : pos === 'DF' ? s.defending : Math.round((s.shooting + s.dribbling + s.pace) / 3)
  return {
    id, clubId: null, templateId: null, name, nation: 'VN', age: 25, position: pos, ...s, potential: overall, fitness: 100, morale: 80, focus: 'balanced',
    injury: 0, unrest: 0, traits, traitsKnown: true, hiddenTraits: 0, tenure: 60, history: [], shirt, retired: false, tag: '', role: '', version: '',
    overall, value: 0, wage: 0,
  }
}

/** A side whose players sit in chosen formation slots (other slots stay empty). */
function side(name: string, short: string, color: string, color2: string, formation: string, slots: [number, Player, string][]): EngineSide {
  const n = Math.max(...slots.map(s => s[0])) + 1
  const starters: (Player | null)[] = new Array(n).fill(null)
  const roles: string[] = new Array(n).fill('CM')
  for (const [i, p, role] of slots) { starters[i] = p; roles[i] = role }
  return {
    club: { name, short, color, color2, formation, tactic: { ...TACTIC } },
    starters: starters as Player[], roles, bench: [], headCoach: 10, chemistry: { team: 70 }, coachFit: { score: 60 }, perks: [],
  }
}

export interface DrillOpts {
  /** the player's name over his head */
  name: string
  /** kit (club colours in a career) */
  color?: [string, string]
  /** club code for the advertising boards (a career's club; default the game's own brand) */
  short?: string
  t: (key: string, params?: Record<string, string | number>) => string
  onEvent?: (e: EngineEvent) => void
}

const ME = 1, GK = 101

export class DrillRun {
  readonly def: DrillDef
  readonly eng: Engine
  marks: Mark[] = []
  phase: DrillPhase = 'ready'
  count = 0
  score = 0
  goals = 0
  tries = 0
  left: number
  note: DrillNote = ''
  noteT = 0
  /** last points won (for the "+3" pop) */
  gain = 0
  /** where the last shot crossed the goal line (y, height) and when (performance.now): the goal-board inset */
  shotAt: { y: number; z: number; on: boolean; at: number } | null = null
  private me: MP
  private gk: MP | null
  private wait = -1 // seconds until the next attempt (-1: an attempt is running)
  private resolved = false
  private kicked = false
  private kickT = 0
  private lastShot = ''
  private gate = 0
  private crossed = false
  private prevBall: [number, number, number] = [0, 0, 0]
  private side = 1 // free kicks / crosses alternate sides
  private target: MP | null = null // the striker a cross was meant for
  private refill = 0 // seconds until the four targets come back (all hit: bonus)

  constructor(readonly id: DrillId, private o: DrillOpts) {
    this.def = drillDef(id)
    this.left = this.def.secs || Infinity
    const [c1, c2] = o.color ?? ['#ffd23f', '#1a1300']
    const short = o.short || 'PITCHSIDE'
    const keeperLvl = id === 'penalty' ? 74 : id === 'freekick' ? 70 : 64
    const keeper = mkPlayer(GK, o.t('pl.dr.keeper'), 'GK', { goalkeeping: keeperLvl, physical: 70, pace: 55 }, 1)
    let home: EngineSide, away: EngineSide
    const me = (pos: Pos, extra = {}) => mkPlayer(ME, o.name, pos, { pace: 80, shooting: 80, passing: 78, dribbling: 82, physical: 74, ...extra }, 10, ['flair'])
    switch (id) {
      case 'cross': {
        home = side(o.name, short, c1, c2, '4-3-3', [[10, me('MF', { passing: 84 }), 'RW'], [9, mkPlayer(2, o.t('pl.dr.striker', { n: 9 }), 'FW', { physical: 84, shooting: 80 }, 9, ['aerial']), 'ST'],
          [8, mkPlayer(3, o.t('pl.dr.striker', { n: 11 }), 'FW', { physical: 78, shooting: 78 }, 11), 'LW']])
        away = side(o.t('pl.dr.keeper'), 'PITCHSIDE', '#e9eef5', '#3a4a5a', '4-4-2', [[0, keeper, 'GK'], [2, mkPlayer(102, o.t('pl.dr.defender', { n: 4 }), 'DF', { defending: 62, physical: 70 }, 4), 'CB'],
          [3, mkPlayer(103, o.t('pl.dr.defender', { n: 5 }), 'DF', { defending: 60, physical: 68 }, 5), 'CB']])
        break
      }
      case 'freekick': {
        home = side(o.name, short, c1, c2, '4-4-2', [[9, me('FW', { shooting: 84 }), 'ST']])
        const wall: [number, Player, string][] = [1, 2, 3, 4].map(i => [i, mkPlayer(101 + i, o.t('pl.dr.wall'), 'DF', { defending: 60, physical: 76 }, 1 + i), 'CB'])
        away = side(o.t('pl.dr.keeper'), 'PITCHSIDE', '#e9eef5', '#3a4a5a', '4-4-2', [[0, keeper, 'GK'], ...wall])
        break
      }
      default: {
        home = side(o.name, short, c1, c2, '4-4-2', [[9, me('FW'), 'ST']])
        away = side(o.t('pl.dr.keeper'), 'PITCHSIDE', '#e9eef5', '#3a4a5a', '4-4-2', [[0, keeper, 'GK']])
      }
    }
    this.eng = new Engine({ home, away, userIsHome: true, fixture: { comp: 'friendly' } }, {
      halfSeconds: 1e6, difficulty: 'normal', replays: false, humans: [true, false], t: o.t,
      onEvent: e => this.event(e),
    }, () => {})
    this.me = this.eng.teams[0].find(p => p.data.id === ME)!
    this.gk = this.eng.teams[1].find(p => p.isGK) ?? null
    this.setupMarks()
    this.place()
  }

  private event(e: EngineEvent) {
    if (e.k === 'head') this.lastShot = 'header'
    else if (e.k === 'shot') this.lastShot = e.s ?? 'normal'
    else if (e.k === 'post' && this.kicked && !this.resolved) this.flash('post')
    if (this.phase === 'run' || e.k === 'whistle') this.o.onEvent?.(e)
  }

  /** Start the countdown (also used for "try again"). */
  start() {
    this.score = 0; this.goals = 0; this.tries = 0; this.left = this.def.secs || Infinity
    this.note = ''; this.noteT = 0; this.gain = 0; this.gate = 0; this.side = 1
    this.setupMarks()
    this.place()
    this.phase = this.def.medals ? 'count' : 'run'
    this.count = this.def.medals ? 3 : 0
    if (!this.def.medals) this.next(true)
  }

  get done() { return this.phase === 'done' }

  frame(): FrameState { return this.eng.frameState() }

  // ---------------------------------------------------------------- setup
  private setupMarks() {
    this.marks = []
    if (this.id === 'slalom') {
      for (let i = 0; i < 5; i++) this.marks.push({ k: 'gate', x: L - 56 + i * 8, y: CY + (i % 2 ? 4.5 : -4.5), half: 2.1, state: i === 0 ? 'next' : 'todo' })
    } else if (this.id === 'targets') {
      const g = GOAL_HALF, h = GOAL_H
      // the four corners of the goal: 1.15 m wide, the top ones 0.95 m deep and worth more
      this.marks.push({ k: 'target', y0: CY - g, y1: CY - g + 1.15, z0: h - 0.95, z1: h, pts: 5, hit: 0 })
      this.marks.push({ k: 'target', y0: CY + g - 1.15, y1: CY + g, z0: h - 0.95, z1: h, pts: 5, hit: 0 })
      this.marks.push({ k: 'target', y0: CY - g, y1: CY - g + 1.15, z0: 0, z1: 0.8, pts: 3, hit: 0 })
      this.marks.push({ k: 'target', y0: CY + g - 1.15, y1: CY + g, z0: 0, z1: 0.8, pts: 3, hit: 0 })
    }
  }

  /** Put a player somewhere, standing still. */
  private put(p: MP, x: number, y: number, face = 0) {
    p.x = x; p.y = y; p.vx = p.vy = 0; p.tx = x; p.ty = y; p.spX = x; p.spY = y; p.face = face; p.hold = false
    p.stun = 0; p.slideT = 0; p.diveT = 0; p.skill = null; p.celebrate = false; p.runT = 0; p.receiveT = 0; p.holdT = 0
  }

  /** Clear the engine's moment: no goal celebration, kick-off or restart pending. */
  private calm() {
    const e = this.eng
    e['resetMoment']()
    e.pending = null
    e.phase = 'play'
    e.phaseT = 0
    e.banner = ''; e.bannerT = 0; e.celebT = 0; e.shake = 0; e.whiteFlash = 0; e.slowmo = 0
    for (const p of e.players) p.stamina = 1
  }

  /** Players to their starting spots for the next attempt (the ball at your feet, or a set piece). */
  private place() {
    const e = this.eng, me = this.me
    this.calm()
    if (this.gk) this.put(this.gk, L - 1.2, CY, Math.PI)
    const at = (x: number, y: number) => {
      this.put(me, x, y, Math.atan2(CY - y, L - x))
      e.ball.x = x + 0.5; e.ball.y = y
      e.giveBall(me, 'set')
    }
    switch (this.id) {
      case 'slalom': at(L - 64, CY); break
      case 'targets': {
        const a = (Math.random() - 0.5) * 0.9
        const d = 19 + Math.random() * 5
        at(L - Math.cos(a) * d, CY + Math.sin(a) * d)
        break
      }
      case 'free': at(L - 28 + (Math.random() - 0.5) * 6, CY + (Math.random() - 0.5) * 20); break
      case 'cross': {
        const s = this.side
        const [st1, st2] = e.teams[0].filter(p => p !== me)
        const defs = e.teams[1].filter(p => !p.isGK)
        if (st1) this.put(st1, L - 19, CY + s * 2, 0)
        if (st2) this.put(st2, L - 23, CY - s * 5, 0)
        // the defenders hold their marks until the ball is crossed (otherwise both rush the winger)
        if (defs[0]) { this.put(defs[0], L - 9.5, CY + s * 0.5, Math.PI); defs[0].hold = true }
        if (defs[1]) { this.put(defs[1], L - 11, CY - s * 5.5, Math.PI); defs[1].hold = true }
        at(L - 36, s > 0 ? W - 6 : 6)
        me.face = 0
        break
      }
      case 'freekick': {
        const s = this.side
        const d = 21 + Math.random() * 5
        const ang = s * (0.15 + Math.random() * 0.35)
        e.restart('free', 0, L - Math.cos(ang) * d, CY + Math.sin(ang) * d)
        break
      }
      case 'penalty': e.restart('penalty', 0, L - 11, CY); break
    }
    e.ctrl[0] = me
    if (this.id === 'cross' && e.ball.owner !== me) e.giveBall(me, 'set')
    this.prevBall = [e.ball.x, e.ball.y, e.ball.z]
    this.kicked = false; this.kickT = 0; this.resolved = false; this.lastShot = ''; this.crossed = false; this.target = null
  }

  /** Begin the next attempt (or finish when the attempts are used up). */
  private next(first = false) {
    if (!first && this.def.tries && this.tries >= this.def.tries) { this.finish(); return }
    if (this.id === 'freekick' || this.id === 'cross') this.side = first ? 1 : -this.side
    if (this.id === 'slalom') { this.gate = 0; this.marks.forEach((m, i) => { if (m.k === 'gate') m.state = i === 0 ? 'next' : 'todo' }) }
    this.place()
    this.wait = -1
  }

  private finish() {
    this.phase = 'done'
    this.wait = -1
    this.eng.pause('menu')
  }

  private flash(n: DrillNote, gain = 0) {
    this.note = n; this.noteT = 1.6
    if (gain) { this.gain = gain; this.score += gain }
    const b = this.eng.ball
    if (n) this.eng.setFlash(this.o.t('pl.dr.note.' + n) + (gain ? ` +${gain}` : ''), b.x, b.y, 1.2)
  }

  /** The attempt is over: show the outcome, then the next one after a short breather. */
  private resolve(n: DrillNote, gain = 0, pause = 1.4) {
    if (this.resolved) return
    this.resolved = true
    if (this.def.tries) this.tries++
    if (n === 'goal' || n === 'header' || n === 'target' || n === 'bonus') this.goals++
    this.flash(n, gain)
    this.wait = pause
    // freeze the engine's own follow-up (kick-off after a goal, the restart after the ball went out)
    const e = this.eng
    if (e.phase === 'goal' || e.phase === 'dead') e.phaseT = 99
  }

  // ---------------------------------------------------------------- the loop
  step(dt: number) {
    const e = this.eng
    this.noteT = Math.max(0, this.noteT - dt)
    for (const m of this.marks) if (m.k === 'target' && m.hit > 0) m.hit += dt
    if (this.refill > 0 && (this.refill -= dt) <= 0) for (const m of this.marks) if (m.k === 'target') m.hit = 0
    if (this.phase === 'ready' || this.phase === 'done') return
    if (this.phase === 'count') {
      this.count -= dt
      if (this.count <= 0) { this.phase = 'run'; this.next(true) }
      return
    }
    if (e.paused) { e.update(dt); return } // Start on the pad resumes
    if (this.def.secs) {
      this.left = Math.max(0, this.left - dt)
      if (this.left <= 0) { this.flash('time'); this.finish(); return }
    }
    const b = e.ball
    this.prevBall = [b.x, b.y, b.z]
    e.update(dt)
    if (e.phase === 'end') return
    if (this.wait >= 0) {
      // keep the keeper from punting it upfield while we wait
      if (this.gk && b.owner === this.gk) this.gk.holdT = -99
      this.wait -= dt
      if (this.wait < 0) this.next()
      return
    }
    switch (this.id) {
      case 'slalom': this.rulesSlalom(); break
      case 'targets': this.rulesShot(true); break
      case 'freekick': case 'penalty': this.rulesShot(false); break
      case 'cross': this.rulesCross(dt); break
      case 'free': this.rulesFree(); break
    }
  }

  /** Has the ball crossed the goal line inside the posts since the last step? Returns the crossing point. */
  private crossing(): [number, number] | null {
    const [px, py, pz] = this.prevBall
    const b = this.eng.ball
    if (!(px <= L && b.x > L)) return null
    const f = (L - px) / (b.x - px || 1e-6)
    return [py + (b.y - py) * f, pz + (b.z - pz) * f]
  }

  private gkHas() { const o = this.eng.ball.owner; return !!o && o.team === 1 }

  /** Targets, free kicks, penalties: one strike, then goal / save / miss. */
  private rulesShot(targets: boolean) {
    const e = this.eng, b = e.ball
    if (!this.kicked) {
      if (b.owner === this.me || e.phase === 'restart') return
      this.kicked = true
      this.kickT = 0
    }
    this.kickT += 1 / 60
    const cross = this.crossing()
    if (cross) this.shotAt = { y: cross[0], z: cross[1], on: Math.abs(cross[0] - CY) < GOAL_HALF && cross[1] < GOAL_H, at: performance.now() }
    if (targets && cross) {
      const [y, z] = cross
      const t = this.marks.find(m => m.k === 'target' && m.hit === 0 && y >= m.y0 - 0.05 && y <= m.y1 + 0.05 && z >= m.z0 - 0.05 && z <= m.z1 + 0.05)
      if (t && t.k === 'target') {
        t.hit = 0.001
        const all = this.marks.every(m => m.k !== 'target' || m.hit > 0)
        this.resolve('target', t.pts + (all ? 5 : 0))
        if (all) { this.note = 'bonus'; this.refill = 1.2 }
        return
      }
    }
    if (e.phase === 'goal') { this.resolve('goal', 1); return }
    if (e.phase === 'dead') { this.resolve('miss'); return }
    if (this.gkHas() || (b.last === this.gk && !b.shot)) { this.resolve('saved'); return }
    const sp = Math.hypot(b.vx, b.vy)
    if (b.last && b.last.team === 1 && !b.last.isGK && this.id === 'freekick') { this.resolve('wall'); return }
    if ((this.kickT > 0.8 && sp < 1.2 && !b.inNet) || this.kickT > 4.5) this.resolve('miss')
  }

  private rulesSlalom() {
    const e = this.eng, b = e.ball
    const [px, py] = this.prevBall
    const g = this.marks[this.gate]
    if (g && g.k === 'gate' && px < g.x && b.x >= g.x) {
      const f = (g.x - px) / (b.x - px || 1e-6)
      const y = py + (b.y - py) * f
      if (Math.abs(y - g.y) <= g.half) { g.state = 'done'; this.flash('gate', 1) } else { g.state = 'missed'; this.flash('gateMiss') }
      this.gate++
      const nx = this.marks[this.gate]
      if (nx && nx.k === 'gate') nx.state = 'next'
    }
    if (e.phase === 'goal') {
      const all = this.marks.every(m => m.k !== 'gate' || m.state === 'done')
      this.resolve(all ? 'bonus' : 'goal', all ? 5 : 3, 1.0)
      return
    }
    if (e.phase === 'dead' || this.gkHas()) { this.resolve(this.gate >= this.marks.length ? 'saved' : 'lost', 0, 0.9); return }
    // a shot that rolled to a stop past the gates: start again
    if (this.gate >= this.marks.length && !b.owner && Math.hypot(b.vx, b.vy) < 0.8 && b.x > L - 20) this.resolve('miss', 0, 0.9)
  }

  private rulesCross(dt: number) {
    const e = this.eng, b = e.ball
    if (!this.crossed) {
      // the cross: a lofted ball (or a low cross) leaves your winger
      if ((b.pass && b.pass.from === this.me) || (b.shot && b.shot.by === this.me)) {
        this.crossed = true
        this.kickT = 0
        this.target = b.pass?.to ?? null
        for (const p of e.teams[1]) p.hold = false
      } else {
        if (e.phase === 'dead' || this.gkHas() || (b.owner && b.owner.team === 1)) this.resolve('lost')
        return
      }
    }
    this.kickT += dt
    // while the cross is in the air you keep the striker it was meant for (the match's auto-switch
    // would hand you back the winger, who is nearer the ball at first)
    if (this.target && !b.owner && b.z > 0.25 && this.kickT < 2.5) {
      e.ctrl[0] = this.target
      e.ctl[0].switchCd = 0.5
    }
    if (e.phase === 'goal') {
      const by = b.kicker
      const headed = this.lastShot === 'header' || this.lastShot === 'volley'
      this.resolve(headed && by !== this.me ? 'header' : 'goal', headed && by !== this.me ? 3 : 1)
      return
    }
    if (e.phase === 'dead' || this.gkHas() || (b.owner && b.owner.team === 1)) { this.resolve(this.gkHas() && b.shot === null && this.lastShot ? 'saved' : 'miss'); return }
    if (b.owner && b.owner.team === 0 && this.kickT > 1.2 && !b.shot) {
      // a teammate controlled it instead of finishing: a few seconds to make something of it
      if (this.kickT > 6) this.resolve('miss')
      return
    }
    if (this.kickT > 7) this.resolve('miss')
  }

  private rulesFree() {
    const e = this.eng
    if (e.phase === 'goal') { this.resolve('goal', 1, 1.2); return }
    if (e.phase === 'dead' || this.gkHas()) this.resolve(this.gkHas() ? 'saved' : 'miss', 0, 0.9)
  }

  /** Text the HUD shows for the score (points, goals or kicks). */
  progress(): { score: number; tries: number; max: number; left: number } {
    return { score: this.score, tries: this.tries, max: this.def.tries, left: r2(this.left) }
  }
}
