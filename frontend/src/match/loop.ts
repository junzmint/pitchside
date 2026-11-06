import type { Engine, Side } from './engine'
import type { InputHub } from './input'

// A live match runs on the wall clock. Browsers stop animation frames for a page nobody can see (another tab, a
// minimised window, another desktop, a locked screen) and slow its timers down, so a match that only moved on
// animation frames stood still the moment you looked away. Here real time moves the match:
// - animation frames step and draw it while the page shows;
// - a worker timer steps it while they don't come (a worker's timer is not slowed down like the page's own; where
//   workers are blocked, a page timer stands in and the clock makes up the rest on each tick);
// - time the page could not use at all (a phone or a browser that froze the tab) is run through as soon as it can,
//   a slice at a time so the page stays responsive, without the sound or the replays nobody saw.
// Only the pause button (or the menu) stops the clock.

const STEP = 1 / 60
/** a gap between two frames longer than this is time the page missed: it is run through, not dropped */
const GAP = 0.25
/** (a function, so a check made before update() isn't taken to still hold after it) */
const over = (eng: Engine) => eng.phase === 'end'

/** Steps an engine through real time. */
export class MatchClock {
  private acc = 0
  private owed = 0
  private last = performance.now()
  /** true while the clock runs through time the page missed: events then play no sound */
  quiet = false

  /** Real seconds since the previous call. */
  delta(now = performance.now()): number {
    if (now <= this.last) return 0
    const d = (now - this.last) / 1000
    this.last = now
    return d
  }

  /**
   * Step the engine through dt real seconds at the given speed.
   * seen: somebody is looking (a replay is shown in full; unseen, it is skipped).
   * budgetMs: how long time the page missed may take now; what is left goes on at the next call.
   */
  run(eng: Engine, dt: number, speed: number, seen: boolean, budgetMs: number) {
    if (over(eng)) { this.acc = this.owed = 0; return }
    if (eng.paused) { eng.update(STEP); this.acc = this.owed = 0; return } // (Start on a pad resumes in there)
    if (dt > GAP) this.owed += dt * speed
    else this.acc += dt * speed
    // this frame's time, as before: a device too slow for 4× runs the match a little slower instead of freezing
    let n = 0
    while (this.acc >= STEP && n < 8 * speed && !over(eng) && !eng.paused) {
      if (!seen && eng.phase === 'replay') eng.skipReplay()
      eng.update(STEP); this.acc -= STEP; n++
    }
    if (n >= 8 * speed) this.acc = 0
    if (this.owed < STEP) return
    // time the page missed, as fast as the budget allows
    const t0 = performance.now()
    this.quiet = true
    try {
      let k = 0
      while (this.owed >= STEP && !over(eng) && !eng.paused) {
        if (eng.phase === 'replay') eng.skipReplay()
        eng.update(STEP); this.owed -= STEP
        if (++k % 30 === 0 && performance.now() - t0 > budgetMs) break
      }
    } finally { this.quiet = false }
    if (over(eng) || eng.paused) this.owed = 0
  }

  /** More than a second of missed time is still to run (the picture is fast-forwarding to the present). */
  get catchingUp() { return this.owed > 1 }
}

/**
 * Call frame() on every animation frame and, whenever animation frames stop coming (the page is hidden, its window
 * minimised or covered), idle() about every `idleMs` from a worker timer. Returns stop().
 */
export function keepRunning(frame: (now: number) => void, idle: (now: number) => void, idleMs = 50): () => void {
  let raf = 0, stopped = false, lastFrame = performance.now()
  const onFrame = (now: number) => {
    if (stopped) return
    lastFrame = performance.now()
    frame(now)
    raf = requestAnimationFrame(onFrame)
  }
  raf = requestAnimationFrame(onFrame)
  const beat = () => {
    if (stopped) return
    const now = performance.now()
    if (now - lastFrame > 200) idle(now)
  }
  let worker: Worker | null = null, url = '', iv = 0
  try {
    url = URL.createObjectURL(new Blob([`setInterval(function () { postMessage(0) }, ${idleMs})`], { type: 'text/javascript' }))
    worker = new Worker(url)
    worker.onmessage = beat
    worker.onerror = () => { worker?.terminate(); worker = null; if (!iv) iv = window.setInterval(beat, idleMs) }
  } catch { worker = null }
  if (!worker) iv = window.setInterval(beat, idleMs)
  return () => {
    stopped = true
    cancelAnimationFrame(raf)
    worker?.terminate()
    if (url) URL.revokeObjectURL(url)
    if (iv) window.clearInterval(iv)
  }
}

/**
 * Nobody can play on this device while its page is hidden or its window has lost focus. Meanwhile the computer plays
 * the sides people control here, so a match that keeps running doesn't leave their players standing still; a key, a
 * button or a touch from one of that side's devices hands the side back.
 */
export class AwayWatch {
  readonly sides: [boolean, boolean] = [false, false]
  private since = 0
  /** local(side): the side is played on this device (not a Wi-Fi guest's) */
  constructor(private eng: Engine, private hub: InputHub, private local: (s: Side) => boolean = () => true) {}

  /** Hand this device's players to the computer. */
  leave() {
    if (this.eng.phase === 'end') return
    this.since = performance.now()
    for (const s of [0, 1] as Side[]) {
      if (this.sides[s] || !this.eng.human[s] || !this.local(s)) continue
      this.sides[s] = true
      this.eng.setHuman(s, false)
    }
  }

  /** On every frame the page shows: a side whose devices were used since it was handed over plays again. */
  check() {
    for (const s of [0, 1] as Side[]) {
      if (!this.sides[s]) continue
      if (this.eng.human[s]) { this.sides[s] = false; continue } // given back some other way (a controller joined)
      if (this.hub.slots[s].some(d => d.active > this.since)) this.back(s)
    }
  }

  back(s: Side) {
    if (!this.sides[s]) return
    this.sides[s] = false
    if (this.eng.phase !== 'end') this.eng.setHuman(s, true)
  }

  get any() { return this.sides[0] || this.sides[1] }
}
