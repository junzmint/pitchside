import {
  CY, F_BEATEN, F_CELEB, F_CTRL0, F_CTRL1, F_DIVE, F_DOWN, F_GK, F_HANDS, F_JUMP, F_KICK, F_SKILL, F_SLIDE, F_YELLOW, GOAL_H, GOAL_HALF, L, PL, W,
  type FrameState, type Statics,
} from './frame'

// Draws a FrameState (from Engine.frameState(), or received over the network) with one of four
// cameras. Stateless apart from camera smoothing, so a second device can render the same frames.
//   tv        pseudo-3D broadcast camera from the stand, tilted, following the ball
//   broadcast top-down, following the ball (the classic view)
//   close     top-down, zoomed in on the ball
//   wide      top-down, the whole pitch (tactical)

export type CamMode = 'tv' | 'broadcast' | 'close' | 'wide'
export const CAMS: CamMode[] = ['tv', 'broadcast', 'close', 'wide']

type Pt = [number, number, number] // screen x, y, pixels per metre there

export interface DrawOpts {
  labels: { replay: string; skip: string }; names: boolean
  /** the minimap at the bottom of the picture (default on; on a narrow screen it is small and sits in a corner) */
  mini?: boolean
}

const P1 = '#ffe14d', P2 = '#4dd2ff'
const SKIN = ['#f1c9a5', '#e0ac69', '#c68642', '#8d5524', '#5c3a1e', '#ffdbac']
const HAIR = ['#2b1d12', '#14100c', '#4a2f1b', '#7a5230', '#c9a36b', '#1d1d1d']

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function textOn(hex: string) {
  const [r, g, b] = rgb(hex)
  return r * 0.299 + g * 0.587 + b * 0.114 > 150 ? '#111' : '#fff'
}
function shade(hex: string, f: number) {
  const [r, g, b] = rgb(hex)
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f))))
  return `rgb(${c(r)},${c(g)},${c(b)})`
}
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x) }

export class View {
  mode: CamMode
  private cx = L / 2
  private cy = CY
  private zoom = 1
  private last = 0
  private roll = 0
  private lastBall: [number, number] = [L / 2, CY]
  private proj: (x: number, y: number, z: number) => Pt = () => [0, 0, 1]
  private persp = false
  private s = 10 // px per metre (top-down) / at the camera target (tv)

  constructor(mode: CamMode = 'tv') { this.mode = mode }

  next(d: number) {
    const i = CAMS.indexOf(this.mode)
    this.mode = CAMS[(i + d + CAMS.length) % CAMS.length]
  }

  draw(ctx: CanvasRenderingContext2D, cw: number, ch: number, f: FrameState, st: Statics, now: number, o: DrawOpts) {
    const dt = this.last ? Math.max(0, Math.min(0.1, (now - this.last) / 1000)) : 0.016
    this.last = now
    // shoot-outs and the walk-up to a penalty: a tighter camera on the spot
    const tension = !!f.so || (f.ph === 'restart' && f.pl.length > 0 && !!f.ov?.aim.some(a => a && a[3] === 2 && Math.abs(a[0] - f.ball[0]) < 14))
    const k = 1 - Math.exp(-(this.mode === 'close' ? 5 : 3.5) * dt)
    let tx = f.cam[0], ty = f.cam[1]
    if (tension) { tx = f.ball[0] > L / 2 ? L - 8 : 8; ty = CY }
    if (f.wo != null) { tx = L / 2; ty = CY + 4 }
    this.cx += (tx - this.cx) * k
    this.cy += (ty - this.cy) * k
    const zt = f.wo != null ? 1.75 - f.wo * 0.25 : tension ? 1.45 : f.ph === 'goal' && f.cel ? 1.5 : 1
    this.zoom += (zt - this.zoom) * (1 - Math.exp(-2 * dt))
    const bs = Math.hypot(f.ball[0] - this.lastBall[0], f.ball[1] - this.lastBall[1])
    this.roll += bs * 4
    this.lastBall = [f.ball[0], f.ball[1]]

    ctx.save()
    if (f.sk > 0.01) ctx.translate(Math.sin(now * 0.053) * f.sk * 7, Math.cos(now * 0.047) * f.sk * 7)
    this.setup(cw, ch)
    this.background(ctx, cw, ch, st, f, now)
    this.pitch(ctx, f, st)
    this.goals(ctx, f)
    this.overlaysGround(ctx, f, st)
    this.actors(ctx, f, st, now, o)
    this.overlaysTop(ctx, f, st, now)
    ctx.restore()
    this.weather(ctx, cw, ch, st, now)
    if (st.night) this.nightGrade(ctx, cw, ch)
    this.effects(ctx, cw, ch, f, st, now, o)
    if (this.mode !== 'wide' && !f.rp && f.wo == null && o.mini !== false) this.minimap(ctx, cw, ch, f, st)
  }

  // ------------------------------------------------------------------------------------------------ projection
  private setup(cw: number, ch: number) {
    if (this.mode === 'tv') {
      this.persp = true
      const phi = 0.46, cosP = Math.cos(phi), sinP = Math.sin(phi)
      const dist = 95
      const viewW = Math.max(34, Math.min(72, (cw / Math.max(1, ch)) * 30)) / this.zoom
      const lookY = CY + (this.cy - CY) * 0.64
      const lookX = Math.max(viewW * 0.3, Math.min(L - viewW * 0.3, this.cx))
      const Cx = lookX, Cy = lookY + dist * cosP, Cz = dist * sinP
      const F = (cw * dist) / viewW
      this.s = F / dist
      const hy = ch * 0.54
      this.proj = (x, y, z) => {
        const dy = y - Cy, dz = z - Cz
        const zc = Math.max(1, -dy * cosP - dz * sinP)
        const yc = -dy * sinP + dz * cosP
        const kk = F / zc
        return [cw / 2 + (x - Cx) * kk, hy - yc * kk, kk]
      }
      return
    }
    this.persp = false
    let s: number, cx: number, cy: number
    if (this.mode === 'wide') {
      s = Math.min(cw / (L + 10), ch / (W + 12))
      cx = L / 2; cy = CY
    } else {
      const base = this.mode === 'close' ? 30 : 44
      const viewW = Math.min(L + 8, Math.max(this.mode === 'close' ? 30 : 52, (ch > 0 ? cw / ch : 1.6) * base)) / this.zoom
      s = cw / viewW
      const viewH = ch / s
      cx = Math.max(viewW / 2 - 4, Math.min(L - viewW / 2 + 4, this.cx))
      cy = viewH >= W + 8 ? CY : Math.max(viewH / 2 - 4, Math.min(W - viewH / 2 + 4, this.cy))
    }
    this.s = s
    const ox = cw / 2 - cx * s, oy = ch / 2 - cy * s
    this.proj = (x, y, z) => [ox + x * s, oy + y * s - z * s * 0.55, s]
  }

  private path(ctx: CanvasRenderingContext2D, pts: [number, number, number][], close = false) {
    ctx.beginPath()
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = this.proj(pts[i][0], pts[i][1], pts[i][2])
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
    }
    if (close) ctx.closePath()
  }
  private ring(cx: number, cy: number, r: number, a0 = 0, a1 = Math.PI * 2, n = 40): [number, number, number][] {
    const out: [number, number, number][] = []
    for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0]) }
    return out
  }

  // ------------------------------------------------------------------------------------------------ scene
  private background(ctx: CanvasRenderingContext2D, cw: number, ch: number, st: Statics, f: FrameState, now: number) {
    const snow = st.weather === 'snow'
    ctx.fillStyle = snow ? '#5b7a5e' : st.night ? '#1f4a24' : '#2f6b33'
    ctx.fillRect(-20, -20, cw + 40, ch + 40)
    if (!this.persp) return
    // stands behind the far touchline, with a crowd
    const [, yTop] = this.proj(L / 2, -22, 14)
    const [, yBoard] = this.proj(L / 2, -3, 1)
    const g = ctx.createLinearGradient(0, Math.min(yTop, yBoard - 1), 0, yBoard)
    if (st.night) { g.addColorStop(0, '#03060c'); g.addColorStop(1, '#141c2a') } else { g.addColorStop(0, '#0d1420'); g.addColorStop(1, '#1d2735') }
    ctx.fillStyle = g
    ctx.fillRect(-20, -20, cw + 40, yBoard + 20)
    if (st.night) this.floodlights(ctx, cw, yBoard, now)
    // the crowd: the home end in the home colours, a pocket of away fans, scarves held up; it jumps when it gets loud
    const home = st.kit[st.home], away = st.kit[st.home === 0 ? 1 : 0]
    const ex = Math.max(f.ex ?? 0, f.celeb ?? 0)
    const t = now / 1000
    for (let i = 0; i < 300; i++) {
      const x = hash(i) * (L + 40) - 20, y = -5 - hash(i + 500) * 16, z = 1.2 + (-(y + 5) / 16) * 11
      const awayEnd = x > L * 0.78
      const r = hash(i + 900)
      const fan = awayEnd ? r < 0.7 : r < 0.78
      const kit = awayEnd ? away : home
      const jump = fan && ex > 0.45 ? Math.max(0, Math.sin(t * 9 + i * 1.7)) * (ex - 0.4) * 0.9 : 0
      const [sx, sy, kk] = this.proj(x, y, z + jump)
      if (sx < -10 || sx > cw + 10) continue
      ctx.fillStyle = fan ? (hash(i + 77) < 0.62 ? kit.c1 : kit.c2) : hash(i + 77) < 0.3 ? '#ddd' : '#556'
      const sz = Math.max(1.5, kk * 0.35)
      if (fan && hash(i + 33) < 0.12) ctx.fillRect(sx - sz, sy - sz * 0.6 + Math.sin(t * 6 + i) * sz * 0.3, sz * 3, sz * 0.7) // a scarf held up
      else ctx.fillRect(sx, sy, sz, sz)
    }
    // advertising boards
    const boards = 14
    for (let i = 0; i < boards; i++) {
      const x0 = -6 + i * ((L + 12) / boards), x1 = x0 + (L + 12) / boards - 0.3
      this.path(ctx, [[x0, -3, 0], [x1, -3, 0], [x1, -3, 1], [x0, -3, 1]], true)
      ctx.fillStyle = i % 2 ? shade(st.kit[0].c1, -0.25) : shade(st.kit[1].c1, -0.25)
      ctx.fill()
      const [sx, sy, kk] = this.proj((x0 + x1) / 2, -3, 0.5)
      if (kk > 9) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)'
        ctx.font = `700 ${Math.round(kk * 0.55)}px "Saira Condensed", sans-serif`
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText(i % 3 === 0 ? 'PITCHSIDE' : st.shorts[i % 2], sx, sy)
      }
    }
  }

  /** Four floodlight pylons glowing above the stand, with soft beams. */
  private floodlights(ctx: CanvasRenderingContext2D, cw: number, yBoard: number, now: number) {
    for (const fx of [-14, L * 0.3, L * 0.7, L + 14]) {
      const [sx, sy0, kk] = this.proj(fx, -24, 26)
      if (sx < -200 || sx > cw + 200) continue
      // keep the lamps in the picture even when the camera is low over the pitch
      const sy = Math.max(10, Math.min(sy0, yBoard - 24))
      const [bx, by] = this.proj(fx, -24, 0)
      ctx.strokeStyle = '#1b2230'; ctx.lineWidth = Math.max(2, kk * 0.4)
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(sx, sy); ctx.stroke()
      const r = Math.max(26, kk * 9)
      const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, r)
      glow.addColorStop(0, 'rgba(255,252,230,0.95)'); glow.addColorStop(0.18, 'rgba(255,248,210,0.55)'); glow.addColorStop(1, 'rgba(255,248,210,0)')
      ctx.fillStyle = glow
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#fffbea'
      const w = Math.max(6, kk * 2.2), h = Math.max(3, kk * 0.9)
      ctx.fillRect(sx - w / 2, sy - h / 2, w, h)
      // a faint beam down onto the pitch
      const [px, py] = this.proj(fx < L / 2 ? fx + 30 : fx - 30, 20, 0)
      const beam = ctx.createLinearGradient(sx, sy, px, py)
      beam.addColorStop(0, 'rgba(255,250,220,0.10)'); beam.addColorStop(1, 'rgba(255,250,220,0)')
      ctx.fillStyle = beam
      ctx.beginPath(); ctx.moveTo(sx - w, sy); ctx.lineTo(sx + w, sy); ctx.lineTo(px + 60, py); ctx.lineTo(px - 60, py); ctx.closePath(); ctx.fill()
    }
    void now
  }
  /** Night grade: a cool vignette over everything except the floodlit pitch. */
  private nightGrade(ctx: CanvasRenderingContext2D, cw: number, ch: number) {
    const g = ctx.createRadialGradient(cw / 2, ch * 0.62, Math.min(cw, ch) * 0.3, cw / 2, ch * 0.6, Math.max(cw, ch) * 0.8)
    g.addColorStop(0, 'rgba(10,20,40,0)'); g.addColorStop(1, 'rgba(4,8,20,0.42)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, cw, ch)
  }

  private pitch(ctx: CanvasRenderingContext2D, f: FrameState, st: Statics) {
    void f
    const n = 14
    for (let i = 0; i < n; i++) {
      const x0 = (i * L) / n, x1 = ((i + 1) * L) / n
      this.path(ctx, [[x0, -2.5, 0], [x1, -2.5, 0], [x1, W + 2.5, 0], [x0, W + 2.5, 0]], true)
      ctx.fillStyle = st.night ? (i % 2 ? '#357a39' : '#2f7034') : i % 2 ? '#3a7d3c' : '#34743a'
      ctx.fill()
    }
    if (st.night) {
      // pools of light from the four corners
      for (const [lx, ly] of [[0, 0], [L, 0], [0, W], [L, W]]) {
        const [sx, sy, kk] = this.proj(lx + (lx ? -14 : 14), ly + (ly ? -10 : 10), 0)
        const r = Math.max(80, kk * 36)
        const pool = ctx.createRadialGradient(sx, sy, 0, sx, sy, r)
        pool.addColorStop(0, 'rgba(255,255,230,0.10)'); pool.addColorStop(1, 'rgba(255,255,230,0)')
        ctx.fillStyle = pool
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill()
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'
    ctx.lineWidth = Math.max(1.2, this.s * 0.11)
    ctx.lineJoin = 'round'
    const stroke = (pts: [number, number, number][], close = false) => { this.path(ctx, pts, close); ctx.stroke() }
    stroke([[0, 0, 0], [L, 0, 0], [L, W, 0], [0, W, 0]], true)
    stroke([[L / 2, 0, 0], [L / 2, W, 0]])
    stroke(this.ring(L / 2, CY, 9.15))
    for (const side of [0, 1]) {
      const x0 = side ? L : 0, d = side ? -1 : 1
      stroke([[x0, CY - 20.16, 0], [x0 + d * 16.5, CY - 20.16, 0], [x0 + d * 16.5, CY + 20.16, 0], [x0, CY + 20.16, 0]])
      stroke([[x0, CY - 9.16, 0], [x0 + d * 5.5, CY - 9.16, 0], [x0 + d * 5.5, CY + 9.16, 0], [x0, CY + 9.16, 0]])
      const spot = x0 + d * 11
      const a0 = Math.acos(5.5 / 9.15)
      stroke(side ? this.ring(spot, CY, 9.15, Math.PI - a0, Math.PI + a0, 16) : this.ring(spot, CY, 9.15, -a0, a0, 16))
      this.path(ctx, this.ring(spot, CY, 0.22, 0, Math.PI * 2, 10), true)
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.fill()
      for (const cy of [0, W]) stroke(this.ring(x0, cy, 1, side ? (cy ? Math.PI : Math.PI / 2) : cy ? -Math.PI / 2 : 0, side ? (cy ? Math.PI * 1.5 : Math.PI) : cy ? 0 : Math.PI / 2, 6))
    }
    this.path(ctx, this.ring(L / 2, CY, 0.25, 0, Math.PI * 2, 10), true)
    ctx.fill()
  }

  private goals(ctx: CanvasRenderingContext2D, f: FrameState) {
    const [bx, by, bz] = f.ball
    for (const side of [0, 1]) {
      const gx = side ? L : 0, d = side ? 1 : -1
      const depth = 2
      const ripple = f.nr > 0 && (side ? bx > L : bx < 0) ? f.nr : 0
      const bulge = (y: number, z: number) => ripple ? ripple * 0.6 * Math.exp(-((y - by) ** 2 + (z - bz) ** 2) / 1.2) * Math.sin((1 - ripple) * 18) : 0
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'
      ctx.lineWidth = Math.max(0.8, this.s * 0.04)
      // net: back plane and roof, a few strands each way
      for (let i = 0; i <= 8; i++) {
        const y = CY - GOAL_HALF + (i * GOAL_HALF * 2) / 8
        const pts: [number, number, number][] = []
        for (let j = 0; j <= 4; j++) { const z = (GOAL_H * 0.85 * j) / 4; pts.push([gx + d * (depth + bulge(y, z)), y, z]) }
        pts.push([gx, y, GOAL_H])
        this.path(ctx, pts); ctx.stroke()
      }
      for (let j = 0; j <= 4; j++) {
        const z = (GOAL_H * 0.85 * j) / 4
        const pts: [number, number, number][] = []
        for (let i = 0; i <= 8; i++) { const y = CY - GOAL_HALF + (i * GOAL_HALF * 2) / 8; pts.push([gx + d * (depth + bulge(y, z)), y, z]) }
        this.path(ctx, pts); ctx.stroke()
      }
      for (const sy of [-1, 1]) {
        const y = CY + sy * GOAL_HALF
        this.path(ctx, [[gx, y, GOAL_H], [gx + d * depth, y, GOAL_H * 0.85], [gx + d * depth, y, 0]]); ctx.stroke()
      }
      // frame
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = Math.max(2, this.s * 0.13)
      this.path(ctx, [[gx, CY - GOAL_HALF, 0], [gx, CY - GOAL_HALF, GOAL_H], [gx, CY + GOAL_HALF, GOAL_H], [gx, CY + GOAL_HALF, 0]])
      ctx.stroke()
    }
  }

  // ------------------------------------------------------------------------------------------------ players & ball
  private actors(ctx: CanvasRenderingContext2D, f: FrameState, st: Statics, now: number, o: DrawOpts) {
    const pl = f.pl
    const n = pl.length / PL
    const order: number[] = []
    for (let i = 0; i < n; i++) order.push(i)
    if (this.persp) order.sort((a, b) => pl[a * PL + 2] - pl[b * PL + 2])
    const [bx, by, bz] = f.ball
    // shadows first (under floodlights: four faint ones, one from each pylon)
    const night = !!st.night
    ctx.fillStyle = night ? 'rgba(0,0,0,0.13)' : 'rgba(0,0,0,0.28)'
    const offs: [number, number][] = night ? [[0.45, 0.35], [-0.45, 0.35], [0.45, -0.35], [-0.45, -0.35]] : [[this.persp ? 0 : 0.18, this.persp ? 0 : 0.28]]
    for (const i of order) {
      const x = pl[i * PL + 1], y = pl[i * PL + 2]
      for (const [ox, oy] of offs) { this.groundEllipse(ctx, x + ox, y + oy, night ? 0.7 : 0.55, night ? 0.3 : 0.38); ctx.fill() }
    }
    // the ball's shadow stays on the grass: smaller and sharper when the ball is low, wide and faint when it's high
    this.groundEllipse(ctx, bx + (this.persp ? 0 : bz * 0.25), by + (this.persp ? 0 : bz * 0.25), 0.18 + bz * 0.035, 0.13 + bz * 0.025)
    ctx.fillStyle = `rgba(0,0,0,${Math.max(0.12, 0.36 - bz * 0.04)})`
    ctx.fill()
    if (this.persp && bz > 0.9) {
      // a faint drop line from the ball to its shadow, so a cross's height reads at a glance
      const [gx, gy] = this.proj(bx, by, 0), [hx, hy] = this.proj(bx, by, bz)
      ctx.strokeStyle = `rgba(255,255,255,${Math.min(0.28, bz * 0.06)})`
      ctx.lineWidth = 1
      ctx.setLineDash([3, 4])
      ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(hx, hy); ctx.stroke()
      ctx.setLineDash([])
    }
    // controlled rings under the feet
    for (const i of order) {
      if (f.wo != null) break
      const fl = pl[i * PL + 5]
      if (!(fl & (F_CTRL0 | F_CTRL1))) continue
      const x = pl[i * PL + 1], y = pl[i * PL + 2]
      ctx.strokeStyle = fl & F_CTRL0 ? P1 : P2
      ctx.lineWidth = Math.max(2, this.s * 0.14)
      this.path(ctx, this.ring(x, y, 1.05, 0, Math.PI * 2, 24), true)
      ctx.stroke()
      const face = pl[i * PL + 3]
      const [fx, fy] = this.proj(x + Math.cos(face) * 1.6, y + Math.sin(face) * 1.6, 0)
      ctx.fillStyle = fl & F_CTRL0 ? P1 : P2
      ctx.beginPath(); ctx.arc(fx, fy, Math.max(2.5, this.s * 0.2), 0, Math.PI * 2); ctx.fill()
    }
    let ballDrawn = false
    const drawBall = () => {
      if (ballDrawn) return
      ballDrawn = true
      const [sx, sy, kk] = this.proj(bx, by, bz + 0.11)
      const r = Math.max(3.2, kk * (this.persp ? 0.2 : 0.24 + bz * 0.04))
      const g = ctx.createRadialGradient(sx - r * 0.35, sy - r * 0.35, r * 0.1, sx, sy, r)
      g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#c9cdd3')
      ctx.fillStyle = g
      ctx.strokeStyle = '#1a1a1a'
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
      // panels rolling with the ball
      ctx.fillStyle = '#222'
      for (let k = 0; k < 3; k++) {
        const a = this.roll + (k * Math.PI * 2) / 3
        const px = sx + Math.cos(a) * r * 0.5, py = sy + Math.sin(a) * r * 0.5 * (this.persp ? 0.7 : 1)
        ctx.beginPath(); ctx.arc(px, py, r * 0.22, 0, Math.PI * 2); ctx.fill()
      }
      if (f.bs && Math.abs(f.bs) > 0.01 && bz > 0.3) {
        ctx.strokeStyle = 'rgba(255,225,77,0.6)'
        ctx.lineWidth = 1.5
        ctx.beginPath(); ctx.arc(sx, sy, r + 3, this.roll, this.roll + Math.PI * 1.2 * Math.sign(f.bs)); ctx.stroke()
      }
    }
    for (const i of order) {
      if (this.persp && !ballDrawn && pl[i * PL + 2] > by) drawBall()
      this.player(ctx, f, st, i, now, o)
    }
    drawBall()
  }

  private groundEllipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number) {
    if (!this.persp) {
      const [sx, sy, s] = this.proj(x, y, 0)
      ctx.beginPath(); ctx.ellipse(sx, sy, rx * s, ry * s, 0, 0, Math.PI * 2)
      return
    }
    this.path(ctx, this.ring(x, y, rx, 0, Math.PI * 2, 14), true)
  }

  private player(ctx: CanvasRenderingContext2D, f: FrameState, st: Statics, i: number, now: number, o: DrawOpts) {
    const pl = f.pl
    const id = pl[i * PL], x = pl[i * PL + 1], y = pl[i * PL + 2], face = pl[i * PL + 3], speed = pl[i * PL + 4], fl = pl[i * PL + 5], anim = pl[i * PL + 6]
    const info = st.pl[id]
    const team = info?.t ?? 0
    const kit = st.kit[team]
    const body = fl & F_GK ? kit.gk : kit.c1
    const trim = fl & F_GK ? '#111' : kit.c2
    // the scorer's chosen celebration: 1 knee slide, 2 aeroplane, 3 backflip, 4 point to the sky
    const cel = f.cel && f.cel[0] === id ? f.cel : null
    const pose = cel ? cel[1] : 0, pu = cel ? cel[2] : 0
    const flip = pose === 3 ? Math.max(0, Math.min(1, (pu - 0.15) / 0.75)) : 0
    const lift = pose === 3 ? Math.sin(flip * Math.PI) * 1.1 : pose ? 0 : fl & F_JUMP ? 0.38 : fl & F_CELEB ? 0.15 + Math.abs(Math.sin(now / 140 + id)) * 0.25 : 0
    ctx.globalAlpha = fl & F_DOWN ? 0.7 : 1
    if (!this.persp) {
      const [sx, sy, s] = this.proj(x, y, lift)
      const r = s * 0.62 * (fl & F_JUMP ? 1.15 : 1) * (pose === 3 ? 1 + Math.sin(flip * Math.PI) * 0.35 : 1)
      if (pose === 2) {
        // aeroplane: arms out wide
        ctx.strokeStyle = body; ctx.lineWidth = Math.max(3, s * 0.3); ctx.lineCap = 'round'
        const a = face + Math.PI / 2
        ctx.beginPath(); ctx.moveTo(sx - Math.cos(a) * r * 2.4, sy - Math.sin(a) * r * 2.4); ctx.lineTo(sx + Math.cos(a) * r * 2.4, sy + Math.sin(a) * r * 2.4); ctx.stroke()
      }
      if (pose === 1 || pose === 4) {
        ctx.strokeStyle = 'rgba(255,225,77,0.85)'; ctx.lineWidth = 2
        for (let k = 0; k < 6; k++) { const a = now / 300 + k; ctx.beginPath(); ctx.moveTo(sx + Math.cos(a) * r * 1.5, sy + Math.sin(a) * r * 1.5); ctx.lineTo(sx + Math.cos(a) * r * 2.1, sy + Math.sin(a) * r * 2.1); ctx.stroke() }
      }
      ctx.fillStyle = body
      ctx.strokeStyle = trim
      ctx.lineWidth = Math.max(1.5, s * 0.1)
      ctx.beginPath()
      const flat = fl & (F_SLIDE | F_DIVE)
      if (flat) ctx.ellipse(sx, sy, r * 1.5, r * 0.75, face, 0, Math.PI * 2)
      else ctx.arc(sx, sy, r, 0, Math.PI * 2)
      ctx.fill()
      if (!flat && !(fl & F_GK) && kit.pat && kit.pat !== 'plain' && kit.pat !== 'sleeves' && r > 4) {
        ctx.save(); ctx.clip(); paintPattern(ctx, kit.pat, kit.c2, sx - r, sy - r, r * 2, r * 2); ctx.restore()
      }
      ctx.stroke()
      if (fl & F_SKILL) { ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.beginPath(); ctx.arc(sx, sy, r * 1.35, now / 90, now / 90 + 4); ctx.stroke() }
      if (fl & F_CELEB) { ctx.strokeStyle = kit.c2; ctx.beginPath(); ctx.arc(sx, sy, r * (1.3 + Math.sin(now / 120) * 0.15), 0, Math.PI * 2); ctx.stroke() }
      ctx.fillStyle = textOn(body)
      ctx.font = `700 ${Math.max(9, s * 0.62)}px "Saira Condensed", sans-serif`
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(String(info?.s ?? ''), sx, sy + 0.5)
      if (fl & F_YELLOW) { ctx.fillStyle = '#ffd400'; ctx.fillRect(sx + r * 0.55, sy - r * 1.05, Math.max(3, s * 0.22), Math.max(4, s * 0.3)) }
      ctx.globalAlpha = 1
      if ((fl & (F_CTRL0 | F_CTRL1)) || (o.names && f.owner === id)) this.nameTag(ctx, sx, sy - s * 1.6, info?.n ?? '', fl, s)
      return
    }
    // ---- tv: a little figure standing on the grass
    const [fx, fy, k] = this.proj(x, y, lift)
    const [, hy] = this.proj(x, y, lift + 1.8)
    const H = Math.max(8, fy - hy)
    const w = H * 0.26
    const skin = SKIN[id % SKIN.length], hair = HAIR[(id >> 2) % HAIR.length]
    ctx.save()
    ctx.translate(fx, fy)
    if (pose === 3 && flip > 0) {
      // backflip: rotate the whole figure about its middle while it's in the air
      ctx.translate(0, -H * 0.5); ctx.rotate(flip * Math.PI * 2 * (Math.cos(face) >= 0 ? -1 : 1)); ctx.translate(0, H * 0.5)
    } else if (pose === 1) { ctx.translate(0, H * 0.24); ctx.rotate(Math.cos(face) >= 0 ? -0.22 : 0.22) } // on his knees, leaning back
    else if (pose === 2) ctx.rotate(Math.sin(now / 260) * 0.28) // banking like a plane
    if (fl & F_SLIDE) ctx.rotate(Math.cos(face) >= 0 ? -1.25 : 1.25)
    else if (fl & F_DIVE) ctx.rotate(Math.sin(face) >= 0 ? 1.1 : -1.1)
    else if (fl & F_DOWN) ctx.rotate(0.35)
    else if (fl & F_BEATEN) ctx.rotate(Math.sin(now / 60) * 0.12)
    const run = speed > 0.6 ? Math.sin(anim * 2.2) : 0
    const amp = Math.min(1, speed / 7)
    const side = Math.cos(face) // walking left/right on screen
    const kick = fl & F_KICK ? 0.5 : 0
    // legs (socks)
    ctx.lineCap = 'round'
    ctx.strokeStyle = fl & F_GK ? trim : kit.so ?? trim
    ctx.lineWidth = Math.max(2, w * 0.36)
    const hipY = -H * 0.46
    const leg = (ph: number) => {
      if (pose === 1) { ctx.beginPath(); ctx.moveTo(ph * w * 0.18, hipY); ctx.lineTo(ph * w * 0.3 - side * H * 0.08, -H * 0.24); ctx.lineTo(ph * w * 0.3 - side * H * 0.34, -H * 0.2); ctx.stroke(); return }
      const sw = (run * ph * amp * 0.38 + (ph > 0 ? kick : 0)) * H * 0.5
      ctx.beginPath(); ctx.moveTo(ph * w * 0.18, hipY); ctx.lineTo(ph * w * 0.18 + sw * side, -H * 0.02 - Math.abs(sw) * 0.15); ctx.stroke()
    }
    leg(1); leg(-1)
    // shorts
    ctx.fillStyle = fl & F_GK ? '#222' : kit.sh ?? shade(kit.c2, -0.1)
    ctx.fillRect(-w * 0.5, hipY - H * 0.04, w, H * 0.16)
    // shirt
    const tw = w * (0.85 + 0.25 * Math.abs(Math.sin(face)))
    ctx.fillStyle = body
    ctx.beginPath()
    if (ctx.roundRect) ctx.roundRect(-tw / 2, -H * 0.83, tw, H * 0.4, w * 0.25); else ctx.rect(-tw / 2, -H * 0.83, tw, H * 0.4)
    ctx.fill()
    if (!(fl & F_GK) && kit.pat && kit.pat !== 'plain' && kit.pat !== 'sleeves' && H > 14) {
      ctx.save(); ctx.clip(); paintPattern(ctx, kit.pat, kit.c2, -tw / 2, -H * 0.83, tw, H * 0.4); ctx.restore()
    }
    ctx.fillStyle = trim
    ctx.fillRect(-tw / 2, -H * 0.83, tw, H * 0.05)
    // arms (in the trim colour for a sleeves kit)
    ctx.strokeStyle = !(fl & F_GK) && kit.pat === 'sleeves' ? kit.c2 : body
    ctx.lineWidth = Math.max(1.6, w * 0.28)
    const up = fl & (F_CELEB | F_HANDS) ? 1 : 0
    for (const ph of [1, -1]) {
      ctx.beginPath()
      ctx.moveTo(ph * tw * 0.48, -H * 0.78)
      if (pose === 2) ctx.lineTo(ph * tw * 1.9, -H * 0.8) // aeroplane wings
      else if (pose === 4) ctx.lineTo(ph * tw * 0.45, -H * 1.22) // both hands to the sky
      else if (pose === 1) ctx.lineTo(ph * tw * 1.15, -H * 1.02)
      else if (up) ctx.lineTo(ph * tw * 0.8, -H * (fl & F_HANDS ? 0.62 : 1.05))
      else ctx.lineTo(ph * tw * 0.62 - run * ph * amp * side * H * 0.12, -H * 0.5)
      ctx.stroke()
    }
    // number on the back when running away from the camera
    if (H > 30 && Math.sin(face) < -0.2) {
      ctx.fillStyle = textOn(body)
      ctx.font = `700 ${Math.round(H * 0.16)}px "Saira Condensed", sans-serif`
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(String(info?.s ?? ''), 0, -H * 0.64)
    }
    // head
    ctx.fillStyle = skin
    ctx.beginPath(); ctx.arc(0, -H * 0.91, H * 0.085, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = hair
    ctx.beginPath(); ctx.arc(0, -H * 0.93, H * 0.085, Math.PI, Math.PI * 2); ctx.fill()
    if (fl & F_YELLOW && H > 24) { ctx.fillStyle = '#ffd400'; ctx.fillRect(tw * 0.5, -H * 1.02, H * 0.06, H * 0.09) }
    ctx.restore()
    ctx.globalAlpha = 1
    if (f.wo == null && ((fl & (F_CTRL0 | F_CTRL1)) || (o.names && f.owner === id))) this.nameTag(ctx, fx, fy - H - 6, info?.n ?? '', fl, k)
  }

  private nameTag(ctx: CanvasRenderingContext2D, x: number, y: number, name: string, fl: number, s: number) {
    ctx.font = `600 ${Math.max(11, Math.min(15, s * 0.55))}px "Be Vietnam Pro", sans-serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(0,0,0,0.65)'
    ctx.strokeText(name, x, y)
    ctx.fillStyle = fl & F_CTRL0 ? '#fff6c2' : fl & F_CTRL1 ? '#d2f3ff' : '#fff'
    ctx.fillText(name, x, y)
    if (fl & (F_CTRL0 | F_CTRL1)) {
      ctx.fillStyle = fl & F_CTRL0 ? P1 : P2
      ctx.beginPath(); ctx.moveTo(x - 5, y + 3); ctx.lineTo(x + 5, y + 3); ctx.lineTo(x, y + 9); ctx.closePath(); ctx.fill()
    }
  }

  // ------------------------------------------------------------------------------------------------ overlays
  private overlaysGround(ctx: CanvasRenderingContext2D, f: FrameState, st: Statics) {
    void st
    const ov = f.ov
    if (!ov || f.rp) return
    if (ov.off >= 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.32)'
      ctx.lineWidth = Math.max(1, this.s * 0.07)
      ctx.setLineDash([8, 8])
      this.path(ctx, [[ov.off, 0, 0], [ov.off, W, 0]]); ctx.stroke()
      ctx.setLineDash([])
    }
    for (const side of [0, 1] as const) {
      const id = ov.tgt[side]
      if (id < 0) continue
      const i = this.find(f, id)
      if (i < 0) continue
      ctx.strokeStyle = side === 0 ? 'rgba(255,225,77,0.75)' : 'rgba(77,210,255,0.75)'
      ctx.lineWidth = Math.max(1.5, this.s * 0.09)
      ctx.setLineDash([5, 4])
      this.path(ctx, this.ring(f.pl[i * PL + 1], f.pl[i * PL + 2], 0.85, 0, Math.PI * 2, 20), true)
      ctx.stroke()
      ctx.setLineDash([])
    }
    for (const side of [0, 1] as const) {
      const a = ov.aim[side]
      if (!a) continue
      const [ax, ay, curl, mode, peak] = a
      const col = side === 0 ? P1 : P2
      const [bx, by] = f.ball
      ctx.strokeStyle = col
      ctx.fillStyle = col
      ctx.lineWidth = Math.max(2, this.s * 0.1)
      if (mode === 2) {
        // aiming at the goal mouth: a mark on the goal plane
        const z = 1.0
        this.path(ctx, [[ax, ay, 0], [ax, ay, GOAL_H]]); ctx.stroke()
        const [sx, sy, kk] = this.proj(ax, ay, z)
        ctx.beginPath(); ctx.arc(sx, sy, Math.max(6, kk * 0.45), 0, Math.PI * 2); ctx.stroke()
      } else {
        this.path(ctx, this.ring(ax, ay, 0.9, 0, Math.PI * 2, 18), true); ctx.stroke()
      }
      // the flight path, curl included
      const dx = ax - bx, dy = ay - by, d = Math.hypot(dx, dy)
      if (d < 1) continue
      const base = Math.atan2(dy, dx)
      const th0 = base - (curl * d) / 2
      const N = 22
      for (let i = 1; i < N; i++) {
        const s = (d * i) / N
        let px: number, py: number
        if (Math.abs(curl) < 1e-4) { px = bx + Math.cos(th0) * s; py = by + Math.sin(th0) * s }
        else { px = bx + (Math.sin(th0 + curl * s) - Math.sin(th0)) / curl; py = by - (Math.cos(th0 + curl * s) - Math.cos(th0)) / curl }
        const u = s / d
        const pz = mode === 2 ? u * 1.2 + 4 * 0.6 * u * (1 - u) : 4 * peak * u * (1 - u)
        const [sx, sy, kk] = this.proj(px, py, pz)
        ctx.globalAlpha = 0.35 + 0.6 * (1 - u)
        ctx.beginPath(); ctx.arc(sx, sy, Math.max(1.6, kk * 0.11), 0, Math.PI * 2); ctx.fill()
      }
      ctx.globalAlpha = 1
    }
  }

  private find(f: FrameState, id: number) {
    for (let i = 0; i < f.pl.length / PL; i++) if (f.pl[i * PL] === id) return i
    return -1
  }

  private overlaysTop(ctx: CanvasRenderingContext2D, f: FrameState, st: Statics, now: number) {
    void st; void now
    const ov = f.ov
    if (!ov || f.rp) return
    // power bars by the controlled players
    for (const side of [0, 1] as const) {
      const pw = ov.pw[side]
      if (!pw) continue
      let i = -1
      for (let j = 0; j < f.pl.length / PL; j++) if (f.pl[j * PL + 5] & (side === 0 ? F_CTRL0 : F_CTRL1)) { i = j; break }
      if (i < 0) continue
      const [sx, sy, kk] = this.proj(f.pl[i * PL + 1], f.pl[i * PL + 2], 0)
      const w = Math.max(70, kk * 4), h = Math.max(8, kk * 0.42)
      const x0 = sx - w / 2, y0 = sy + Math.max(10, kk * 1.0)
      ctx.fillStyle = 'rgba(0,0,0,0.65)'
      ctx.fillRect(x0 - 2, y0 - 2, w + 4, h + 4)
      const g = ctx.createLinearGradient(x0, 0, x0 + w, 0)
      g.addColorStop(0, '#4fd07a'); g.addColorStop(0.7, '#ffe14d'); g.addColorStop(1, '#ff5a3c')
      ctx.fillStyle = g
      ctx.fillRect(x0, y0, w * pw, h)
      ctx.strokeStyle = side === 0 ? P1 : P2
      ctx.lineWidth = 1
      ctx.strokeRect(x0, y0, w, h)
      // the red zone: too much and it flies over
      ctx.fillStyle = 'rgba(255,255,255,0.5)'
      ctx.fillRect(x0 + w * 0.92, y0, 1.5, h)
    }
    if (ov.fl && ov.fa > 0) {
      const [sx, sy, kk] = this.proj(ov.fx, ov.fy, 2.6)
      ctx.save()
      ctx.globalAlpha = Math.min(1, ov.fa)
      ctx.font = `italic 800 ${Math.round(Math.max(18, Math.min(34, kk * 1.3)))}px "Saira Condensed", sans-serif`
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.lineWidth = 4
      ctx.strokeStyle = 'rgba(0,0,0,0.7)'
      ctx.strokeText(ov.fl, sx, sy - (1 - ov.fa) * 20)
      ctx.fillStyle = '#ffe14d'
      ctx.fillText(ov.fl, sx, sy - (1 - ov.fa) * 20)
      ctx.restore()
    }
  }

  // ------------------------------------------------------------------------------------------------ screen effects
  private weather(ctx: CanvasRenderingContext2D, cw: number, ch: number, st: Statics, now: number) {
    if (st.weather === 'rain') {
      ctx.fillStyle = 'rgba(20,30,50,0.16)'
      ctx.fillRect(0, 0, cw, ch)
      ctx.strokeStyle = 'rgba(200,215,255,0.35)'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let i = 0; i < 140; i++) {
        const sp = 0.9 + hash(i) * 0.6
        const x = (hash(i + 1) * cw + now * 0.15 * sp) % cw
        const y = (hash(i + 2) * ch + now * 0.9 * sp) % ch
        ctx.moveTo(x, y); ctx.lineTo(x - 4, y + 14)
      }
      ctx.stroke()
    } else if (st.weather === 'snow') {
      ctx.fillStyle = 'rgba(255,255,255,0.75)'
      for (let i = 0; i < 110; i++) {
        const sp = 0.5 + hash(i) * 0.7
        const x = (hash(i + 3) * cw + Math.sin(now / 900 + i) * 20 + cw) % cw
        const y = (hash(i + 4) * ch + now * 0.06 * sp) % ch
        ctx.beginPath(); ctx.arc(x, y, 1 + hash(i + 5) * 1.8, 0, Math.PI * 2); ctx.fill()
      }
    }
  }

  private effects(ctx: CanvasRenderingContext2D, cw: number, ch: number, f: FrameState, st: Statics, now: number, o: DrawOpts) {
    if (f.celeb > 0.02) {
      const cols = [st.kit[f.ct].c1, st.kit[f.ct].c2, '#ffe14d']
      for (let i = 0; i < 90; i++) {
        const t0 = hash(i) * 1.2
        const age = (1 - f.celeb) * 4 + t0
        const x = hash(i + 10) * cw + Math.sin(now / 300 + i) * 18
        const y = -20 + ((age * (90 + hash(i + 20) * 120)) % (ch + 40))
        ctx.fillStyle = cols[i % 3]
        ctx.globalAlpha = Math.min(1, f.celeb * 1.5)
        ctx.save(); ctx.translate(x, y); ctx.rotate(now / 200 + i)
        ctx.fillRect(-3, -1.5, 6, 3)
        ctx.restore()
      }
      ctx.globalAlpha = 1
    }
    if (f.sl) {
      const g = ctx.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.35, cw / 2, ch / 2, Math.max(cw, ch) * 0.75)
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.45)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, cw, ch)
    }
    if (f.wf > 0.01) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.55, f.wf * 0.6)})`
      ctx.fillRect(0, 0, cw, ch)
    }
    if (f.rp) {
      const bar = ch * 0.07
      ctx.fillStyle = 'rgba(0,0,0,0.85)'
      ctx.fillRect(0, 0, cw, bar)
      ctx.fillRect(0, ch - bar, cw, bar)
      ctx.font = '800 20px "Saira Condensed", sans-serif'
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
      ctx.fillStyle = Math.floor(now / 500) % 2 ? '#ff4d4d' : '#ff9999'
      ctx.beginPath(); ctx.arc(22, bar / 2, 6, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.fillText(o.labels.replay, 36, bar / 2)
      ctx.textAlign = 'right'
      ctx.font = '600 13px "Be Vietnam Pro", sans-serif'
      ctx.fillStyle = 'rgba(255,255,255,0.75)'
      ctx.fillText(o.labels.skip, cw - 16, ch - bar / 2)
    }
  }

  private minimap(ctx: CanvasRenderingContext2D, cw: number, ch: number, f: FrameState, st: Statics) {
    // a small share of the picture: on a phone (narrow canvas) it shrinks further and moves to the bottom-right corner
    const narrow = cw < 640
    const ms = Math.min(1.7, cw / 330, (ch * (narrow ? 0.13 : 0.2)) / W, (cw * (narrow ? 0.24 : 0.3)) / L)
    const mw = L * ms, mh = W * ms
    const mx = narrow ? cw - mw - 8 : cw / 2 - mw / 2, my = ch - mh - (narrow ? 8 : 10)
    const dot = Math.max(0.6, Math.min(1, ms / 1.2))
    ctx.fillStyle = 'rgba(10,30,14,0.72)'
    ctx.fillRect(mx - 3, my - 3, mw + 6, mh + 6)
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'
    ctx.lineWidth = 1
    ctx.strokeRect(mx, my, mw, mh)
    ctx.beginPath(); ctx.moveTo(mx + mw / 2, my); ctx.lineTo(mx + mw / 2, my + mh); ctx.stroke()
    for (let i = 0; i < f.pl.length / PL; i++) {
      const id = f.pl[i * PL], fl = f.pl[i * PL + 5]
      const t = st.pl[id]?.t ?? 0
      ctx.fillStyle = fl & F_CTRL0 ? P1 : fl & F_CTRL1 ? P2 : st.kit[t].c1
      ctx.beginPath(); ctx.arc(mx + f.pl[i * PL + 1] * ms, my + f.pl[i * PL + 2] * ms, (fl & (F_CTRL0 | F_CTRL1) ? 3 : 2.2) * dot, 0, Math.PI * 2); ctx.fill()
    }
    ctx.fillStyle = '#fff'
    ctx.beginPath(); ctx.arc(mx + f.ball[0] * ms, my + f.ball[1] * ms, 2 * dot, 0, Math.PI * 2); ctx.fill()
  }
}

/** Paints a shirt pattern in the trim colour over a shirt already filled with its main colour. The
 *  caller clips to the shirt; (x, y, w, h) is the shirt's box. Same designs as the kit designer (kit.tsx). */
export function paintPattern(ctx: CanvasRenderingContext2D, pat: string, trim: string, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = trim
  switch (pat) {
    case 'stripes': { const n = 5, sw = w / n; for (let i = 1; i < n; i += 2) ctx.fillRect(x + i * sw, y, sw, h); break }
    case 'pinstripes': { const n = 7, lw = Math.max(1, w * 0.035); for (let i = 1; i < n; i++) ctx.fillRect(x + (i * w) / n - lw / 2, y, lw, h); break }
    case 'hoops': { const n = 5, hh = h / n; for (let i = 1; i < n; i += 2) ctx.fillRect(x, y + i * hh, w, hh); break }
    case 'halves': ctx.fillRect(x + w / 2, y, w / 2, h); break
    case 'quarters': ctx.fillRect(x + w / 2, y, w / 2, h / 2); ctx.fillRect(x, y + h / 2, w / 2, h / 2); break
    case 'sash':
      ctx.beginPath(); ctx.moveTo(x + w * 0.05, y); ctx.lineTo(x + w * 0.4, y); ctx.lineTo(x + w * 0.95, y + h); ctx.lineTo(x + w * 0.6, y + h)
      ctx.closePath(); ctx.fill(); break
    case 'chevron':
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w / 2, y + h * 0.48); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h * 0.2)
      ctx.lineTo(x + w / 2, y + h * 0.7); ctx.lineTo(x, y + h * 0.2); ctx.closePath(); ctx.fill(); break
    case 'centre': ctx.fillRect(x + w * 0.36, y, w * 0.28, h); break
    case 'band': ctx.fillRect(x, y + h * 0.3, w, h * 0.22); break
  }
}
