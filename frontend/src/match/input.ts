import { BTN, type Ctx, type Glyphs, type InputFrame, type InputSource } from './frame'
import { listPads, PadSource, rawPad } from './gamepad'

// Input for the live match. Each side (team) is driven by zero or more InputSources whose frames are
// merged; the engine only ever sees one InputFrame per side (Engine.setInput). Sources:
//   KeyboardSource  – WASD/arrows + J K L I Q E U Space Shift (keys are mapped by context, see below)
//   PadSource       – any USB/Bluetooth controller (gamepad.ts)
//   RemoteSource    – a frame pushed from another device (LAN guest, touch pad): call set() on every message
// InputHub owns the assignment of sources to sides, lets free controllers join with Start/Options,
// and reports controllers that disconnect so the match can pause.

const K_MOVE: Record<string, [number, number]> = {
  KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
}
const COMMON: Record<string, number> = { ShiftLeft: BTN.RT, ShiftRight: BTN.RT, KeyU: BTN.SKILL, KeyP: BTN.START, Escape: BTN.START, Space: BTN.LT, Tab: BTN.SELECT }
// attack / set piece: J pass · K shoot · L through · I lob/cross · Q, E modifiers (= L1/R1)
const K_ATT: Record<string, number> = { ...COMMON, KeyJ: BTN.A, KeyK: BTN.B, KeyL: BTN.Y, KeyI: BTN.X, KeyQ: BTN.LB, KeyE: BTN.RB }
// defence: J switch · K tackle · L slide · I call a teammate to press · Q contain · E keeper rush
const K_DEF: Record<string, number> = { ...COMMON, KeyJ: BTN.LB, KeyK: BTN.B, KeyL: BTN.X, KeyI: BTN.RB, KeyQ: BTN.A, KeyE: BTN.Y }
export const KB_CODES = new Set([...Object.keys(K_MOVE), ...Object.keys(K_ATT), ...Object.keys(K_DEF)])

/** Map a context-dependent named button (touch pads label buttons by their attacking meaning) to BTN. */
const NAMED_ATT: Record<string, number> = { pass: BTN.A, shoot: BTN.B, through: BTN.Y, lob: BTN.X, sprint: BTN.RT, skill: BTN.SKILL, mod1: BTN.LB, mod2: BTN.RB, shield: BTN.LT, pause: BTN.START }
const NAMED_DEF: Record<string, number> = { pass: BTN.LB, shoot: BTN.B, through: BTN.X, lob: BTN.RB, sprint: BTN.RT, skill: BTN.SKILL, mod1: BTN.A, mod2: BTN.Y, shield: BTN.LT, pause: BTN.START }

export class KeyboardSource implements InputSource {
  readonly key = 'kb'
  readonly label = 'Keyboard'
  readonly glyphs: Glyphs = 'kb'
  active = 0
  side: 0 | 1 = 0
  private down = new Set<string>()
  private held = new Map<string, number>() // key → button it holds (decided when pressed)
  private latch = 0

  constructor(private ctx: (side: 0 | 1) => Ctx) {}

  keyDown(code: string) {
    if (this.down.has(code)) return
    this.down.add(code)
    this.active = performance.now()
    if (K_MOVE[code]) return
    const btn = (this.ctx(this.side) === 'def' ? K_DEF : K_ATT)[code]
    if (btn) { this.held.set(code, btn); this.latch |= btn }
  }
  keyUp(code: string) { this.down.delete(code); this.held.delete(code) }
  clear() { this.down.clear(); this.held.clear(); this.latch = 0 }

  poll(): InputFrame {
    let x = 0, y = 0
    for (const c of this.down) { const m = K_MOVE[c]; if (m) { x += m[0]; y += m[1] } }
    x = Math.sign(x); y = Math.sign(y)
    const n = Math.hypot(x, y)
    if (n > 1) { x /= n; y /= n }
    let b = this.latch
    for (const v of this.held.values()) b |= v
    this.latch = 0
    return { x, y, rx: 0, ry: 0, b }
  }
}

/** A remote player (LAN guest / phone): push frames with set(); poll() replays the latest one. */
export class RemoteSource implements InputSource {
  readonly glyphs: Glyphs
  active = 0
  alive = true
  private f: InputFrame = { x: 0, y: 0, rx: 0, ry: 0, b: 0 }
  private latch = 0
  private held = new Map<string, number>()

  constructor(readonly key: string, readonly label: string, glyphs: Glyphs = 'xbox', private ctx?: (side: 0 | 1) => Ctx, public side: 0 | 1 = 1) {
    this.glyphs = glyphs
  }
  /** Raw frame (a remote gamepad or keyboard already mapped to BTN). */
  set(f: InputFrame) {
    this.latch |= f.b & ~this.f.b
    this.f = { ...f }
    this.active = performance.now()
  }
  /** Named buttons as the touch pad sends them ({x, y, held: ['pass', 'sprint']}); mapped by context like keys. */
  setNamed(x: number, y: number, held: string[]) {
    const map = this.ctx?.(this.side) === 'def' ? NAMED_DEF : NAMED_ATT
    const now = new Set(held)
    for (const k of [...this.held.keys()]) if (!now.has(k)) this.held.delete(k)
    let b = 0
    for (const k of held) {
      if (!this.held.has(k)) { const v = map[k] ?? 0; this.held.set(k, v); this.latch |= v }
      b |= this.held.get(k) ?? 0
    }
    this.f = { x, y, rx: 0, ry: 0, b }
    this.active = performance.now()
  }
  poll(): InputFrame | null {
    if (!this.alive) return null
    const out = { ...this.f, b: this.f.b | this.latch }
    this.latch = 0
    return out
  }
}

export type DeviceRef = { kind: 'kb' } | { kind: 'pad'; id: string; index: number }

function merge(a: InputFrame | null, f: InputFrame): InputFrame {
  if (!a) return { ...f }
  const o = { ...a }
  if (Math.hypot(f.x, f.y) > Math.hypot(a.x, a.y)) { o.x = f.x; o.y = f.y }
  if (Math.hypot(f.rx, f.ry) > Math.hypot(a.rx, a.ry)) { o.rx = f.rx; o.ry = f.ry }
  o.b |= f.b
  return o
}

export class InputHub {
  readonly kb: KeyboardSource
  slots: [InputSource[], InputSource[]] = [[], []]
  /** id of a controller that dropped out of a side, so it can re-attach on its own */
  lost: [string | null, string | null] = [null, null]
  onDisconnect: (side: 0 | 1, label: string) => void = () => {}
  onJoin: (side: 0 | 1, label: string) => void = () => {}
  rumbleOn = true
  private startPrev = new Map<number, boolean>()

  /** duo: two local players (P2 = team 1). Otherwise every device drives team 0. */
  constructor(public duo: boolean, assign: [DeviceRef[], DeviceRef[]], ctx: (side: 0 | 1) => Ctx) {
    this.kb = new KeyboardSource(ctx)
    const pads = listPads()
    for (const side of [0, 1] as const) {
      for (const d of assign[side]) {
        if (d.kind === 'kb') { this.kb.side = side; this.slots[side].push(this.kb); continue }
        const p = pads.find(q => q.index === d.index && q.id === d.id) ?? pads.find(q => q.id === d.id && this.owner(q.index) == null)
        if (p && this.owner(p.index) == null) this.slots[side].push(new PadSource(p.index, p.id))
        else this.lost[side] = d.id
      }
    }
    if (!duo && !this.slots[0].includes(this.kb)) this.slots[0].unshift(this.kb)
  }

  owner(index: number): 0 | 1 | null {
    for (const side of [0, 1] as const) if (this.slots[side].some(s => s instanceof PadSource && s.index === index)) return side
    return null
  }

  /** Switch between one player (every device on team 0) and two players. */
  setDuo(duo: boolean) {
    this.duo = duo
    if (!duo) {
      for (const s of this.slots[1]) if (!this.slots[0].includes(s)) this.slots[0].push(s)
      this.slots[1] = []
      this.kb.side = 0
      this.lost = [null, null]
    }
  }

  attach(side: 0 | 1, src: InputSource) {
    this.detach(src)
    this.slots[side].push(src)
    if (src instanceof KeyboardSource) src.side = side
    if (src instanceof RemoteSource) src.side = side
  }
  detach(src: InputSource) {
    for (const side of [0, 1] as const) this.slots[side] = this.slots[side].filter(s => s !== src)
  }
  has(side: 0 | 1) { return this.slots[side].length > 0 }

  poll(): [InputFrame | null, InputFrame | null] {
    for (const p of listPads()) {
      if (this.owner(p.index) != null) continue
      if (!this.duo) { this.slots[0].push(new PadSource(p.index, p.id)); continue }
      // two players: a controller that dropped out comes back to its side; a new one joins with Start
      const back = this.lost[0] === p.id ? 0 : this.lost[1] === p.id ? 1 : null
      const pad = rawPad(p.index)
      const st = !!pad?.buttons[9]?.pressed
      const was = this.startPrev.get(p.index) ?? false
      this.startPrev.set(p.index, st)
      let side: 0 | 1 | null = back
      if (side == null && st && !was) side = this.slots[1].length === 0 ? 1 : this.slots[0].length === 0 ? 0 : this.lost[0] ? 0 : this.lost[1] ? 1 : null
      if (side != null) {
        const src = new PadSource(p.index, p.id)
        this.slots[side].push(src)
        this.lost[side] = null
        this.onJoin(side, src.label)
      }
    }
    const out: [InputFrame | null, InputFrame | null] = [null, null]
    for (const side of [0, 1] as const) {
      for (const src of [...this.slots[side]]) {
        const f = src.poll()
        if (!f) {
          this.detach(src)
          if (src instanceof PadSource) {
            const recent = performance.now() - src.active < 20000
            if (this.duo || recent) { this.lost[side] = src.id; this.onDisconnect(side, src.label) }
          } else this.onDisconnect(side, src.label)
          continue
        }
        out[side] = merge(out[side], f)
      }
    }
    return out
  }

  /** Only what other devices pushed (a Wi-Fi guest): all there is to read while this page is hidden, and reading the
   *  controllers then could take one for unplugged. */
  pollRemote(): [InputFrame | null, InputFrame | null] {
    const out: [InputFrame | null, InputFrame | null] = [null, null]
    for (const side of [0, 1] as const) {
      for (const src of this.slots[side]) {
        if (!(src instanceof RemoteSource) || src.key === 'touch') continue
        const f = src.poll()
        if (f) out[side] = merge(out[side], f)
      }
    }
    return out
  }

  /** Button glyphs for a side: the device used most recently. */
  glyphs(side: 0 | 1): Glyphs {
    let best: InputSource | null = null
    for (const s of this.slots[side]) if (!best || s.active > best.active) best = s
    return best?.glyphs ?? 'kb'
  }
  labels(side: 0 | 1): string[] { return this.slots[side].map(s => s.label) }

  rumble(side: 0 | 1, strong: number, weak: number, ms: number) {
    if (!this.rumbleOn) return
    for (const s of this.slots[side]) s.rumble?.(strong, weak, ms)
  }
}
