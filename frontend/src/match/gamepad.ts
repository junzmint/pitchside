import { BTN, type Glyphs, type InputFrame, type InputSource } from './frame'

// PlayStation / Xbox / generic controllers (USB or Bluetooth) through the browser Gamepad API.
// The "standard" mapping puts the face buttons, bumpers, triggers, sticks and D-pad at fixed
// indices, so one table covers DualShock 4, DualSense, Xbox One/Series and most generic pads.
const STD = [BTN.A, BTN.B, BTN.X, BTN.Y, BTN.LB, BTN.RB, BTN.LT, BTN.RT, BTN.SELECT, BTN.START, BTN.L3, BTN.R3, BTN.UP, BTN.DOWN, BTN.LEFT, BTN.RIGHT]

export function padGlyphs(id: string): Glyphs {
  return /054c|playstation|dualshock|dualsense|wireless controller|ps[345]/i.test(id) ? 'ps' : 'xbox'
}

export function padLabel(id: string): string {
  const name = id.replace(/\s*\((?:STANDARD GAMEPAD|Vendor)[^)]*\)\s*/gi, ' ').replace(/[0-9a-f]{4}-[0-9a-f]{4}-/i, '').trim()
  if (/dualsense/i.test(id)) return 'DualSense'
  if (/054c/i.test(id) || /wireless controller/i.test(id)) return 'DualShock'
  if (/xbox|045e|xinput/i.test(id)) return 'Xbox'
  return (name || id).slice(0, 32)
}

export interface PadInfo { index: number; id: string; glyphs: Glyphs; label: string }

export function listPads(): PadInfo[] {
  const out: PadInfo[] = []
  let pads: (Gamepad | null)[] = []
  try { pads = [...(navigator.getGamepads?.() ?? [])] } catch { /* blocked by permissions policy */ }
  for (const p of pads) if (p && p.connected) out.push({ index: p.index, id: p.id, glyphs: padGlyphs(p.id), label: padLabel(p.id) })
  return out
}

export function rawPad(index: number): Gamepad | null {
  try {
    const p = navigator.getGamepads?.()[index]
    return p && p.connected ? p : null
  } catch { return null }
}

/** Radial dead zone, rescaled so a small push still gives fine control. */
function dz(x: number, y: number, d: number): [number, number] {
  const m = Math.hypot(x, y)
  if (m < d) return [0, 0]
  const k = Math.min(1, (m - d) / (1 - d)) / m
  return [x * k, y * k]
}

export function readPad(p: Gamepad): InputFrame {
  let b = 0
  for (let i = 0; i < STD.length; i++) {
    const btn = p.buttons[i]
    if (!btn) continue
    if (btn.pressed || btn.value > (i === 6 || i === 7 ? 0.3 : 0.5)) b |= STD[i]
  }
  const [x, y] = dz(p.axes[0] ?? 0, p.axes[1] ?? 0, 0.18)
  const [rx, ry] = dz(p.axes[2] ?? 0, p.axes[3] ?? 0, 0.22)
  return { x, y, rx, ry, b }
}

type Rumbler = { vibrationActuator?: { playEffect?: (type: string, o: object) => Promise<unknown> } }

export class PadSource implements InputSource {
  readonly key: string
  readonly label: string
  readonly glyphs: Glyphs
  active = 0
  rumbleOn = true
  private ignore = 0
  private lastB = 0

  constructor(readonly index: number, readonly id: string) {
    this.key = `pad:${index}`
    this.label = padLabel(id)
    this.glyphs = padGlyphs(id)
    // buttons already held when the pad is taken over (e.g. the Start press that claimed it) are
    // ignored until released, so joining never also pauses the match
    const p = this.get()
    this.ignore = p ? readPad(p).b : 0
  }

  private get(): Gamepad | null {
    const p = rawPad(this.index)
    return p && p.id === this.id ? p : null
  }

  poll(): InputFrame | null {
    const p = this.get()
    if (!p) return null
    const f = readPad(p)
    this.ignore &= f.b
    f.b &= ~this.ignore
    if (f.b !== this.lastB || Math.hypot(f.x, f.y) > 0.3 || Math.hypot(f.rx, f.ry) > 0.3) this.active = performance.now()
    this.lastB = f.b
    return f
  }

  rumble(strong: number, weak: number, ms: number) {
    if (!this.rumbleOn) return
    const p = this.get() as (Gamepad & Rumbler) | null
    try {
      const r = p?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) })
      r?.catch(() => { /* not supported */ })
    } catch { /* not supported */ }
  }
}
