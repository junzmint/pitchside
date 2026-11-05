/**
 * Menu sounds, synthesised with WebAudio (no audio files): a few milliseconds of oscillators and
 * filtered noise per sound, so they cost nothing to load.
 *
 *   import { sfx, installSfx } from './sfx'
 *   sfx('cash')        // play one sound (silently ignored when sound is off in Settings)
 *   installSfx()       // once, at start-up: clicks and hover ticks on every button, via one listener
 *
 * Buttons can pick their own sound with data-sfx="confirm" (or "none" for silence).
 * Respects settings.ts: `sound` (on/off) and `volume` (0..1), read at the moment a sound plays.
 * The audio context is created on the first click (browsers only allow sound after a user gesture).
 */
import { getSettings } from './settings'

export type SfxName = 'click' | 'hover' | 'confirm' | 'error' | 'cash' | 'levelup' | 'reveal' | 'flip' | 'whistle' | 'trophy' | 'open' | 'tick'

let ac: AudioContext | null = null
let out: GainNode | null = null
let noiseBuf: AudioBuffer | null = null

function audio(): AudioContext | null {
  const s = getSettings()
  if (!s.sound || s.volume <= 0) return null
  try {
    if (!ac) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) return null
      ac = new AC()
      out = ac.createGain()
      const comp = ac.createDynamicsCompressor()
      comp.threshold.value = -14; comp.ratio.value = 4
      out.connect(comp).connect(ac.destination)
      const len = Math.floor(ac.sampleRate * 0.6)
      noiseBuf = ac.createBuffer(1, len, ac.sampleRate)
      const d = noiseBuf.getChannelData(0)
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    }
    if (ac.state === 'suspended') void ac.resume()
    // UI sounds sit a little under the match audio at the same volume setting
    out!.gain.setValueAtTime(s.volume * 0.55, ac.currentTime)
    return ac
  } catch {
    return null
  }
}

interface ToneOpts { f: number; f2?: number; type?: OscillatorType; at?: number; dur?: number; vol?: number; attack?: number; vib?: number }
function tone(a: AudioContext, { f, f2, type = 'sine', at = 0, dur = 0.12, vol = 0.25, attack = 0.005, vib = 0 }: ToneOpts) {
  const t = a.currentTime + at
  const o = a.createOscillator()
  const g = a.createGain()
  o.type = type
  o.frequency.setValueAtTime(f, t)
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur)
  if (vib) {
    const l = a.createOscillator(), lg = a.createGain()
    l.frequency.value = 28; lg.gain.value = vib
    l.connect(lg).connect(o.frequency)
    l.start(t); l.stop(t + dur + 0.05)
  }
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(vol, t + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g).connect(out!)
  o.start(t)
  o.stop(t + dur + 0.03)
}

interface NoiseOpts { at?: number; dur?: number; vol?: number; f?: number; f2?: number; q?: number; kind?: BiquadFilterType }
function noise(a: AudioContext, { at = 0, dur = 0.08, vol = 0.12, f = 3000, f2, q = 0.8, kind = 'bandpass' }: NoiseOpts) {
  if (!noiseBuf) return
  const t = a.currentTime + at
  const src = a.createBufferSource()
  src.buffer = noiseBuf
  const flt = a.createBiquadFilter()
  flt.type = kind; flt.Q.value = q
  flt.frequency.setValueAtTime(f, t)
  if (f2) flt.frequency.exponentialRampToValueAtTime(f2, t + dur)
  const g = a.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.02, dur / 3))
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  src.connect(flt).connect(g).connect(out!)
  src.start(t, Math.random() * 0.3)
  src.stop(t + dur + 0.02)
}

const SOUNDS: Record<SfxName, (a: AudioContext) => void> = {
  click: a => { tone(a, { f: 1250, f2: 820, type: 'triangle', dur: 0.05, vol: 0.2 }); noise(a, { dur: 0.025, vol: 0.05, f: 5200, kind: 'highpass' }) },
  hover: a => tone(a, { f: 2350, f2: 2150, dur: 0.028, vol: 0.035 }),
  tick: a => tone(a, { f: 1800, dur: 0.03, vol: 0.06, type: 'triangle' }),
  confirm: a => { tone(a, { f: 740, type: 'triangle', dur: 0.08, vol: 0.2 }); tone(a, { f: 1110, type: 'triangle', at: 0.06, dur: 0.16, vol: 0.2 }); noise(a, { dur: 0.03, vol: 0.04, f: 6000, kind: 'highpass' }) },
  error: a => { tone(a, { f: 210, f2: 150, type: 'square', dur: 0.11, vol: 0.09 }); tone(a, { f: 190, f2: 120, type: 'square', at: 0.12, dur: 0.16, vol: 0.09 }) },
  cash: a => {
    noise(a, { dur: 0.06, vol: 0.14, f: 4200, kind: 'highpass' })
    tone(a, { f: 1568, at: 0.03, dur: 0.22, vol: 0.2 })
    tone(a, { f: 2093, at: 0.1, dur: 0.42, vol: 0.22 })
    tone(a, { f: 4186, at: 0.1, dur: 0.3, vol: 0.05, type: 'triangle' })
  },
  levelup: a => {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(a, { f, type: 'triangle', at: i * 0.075, dur: i === 3 ? 0.45 : 0.12, vol: 0.18 }))
    tone(a, { f: 2093, at: 0.3, dur: 0.4, vol: 0.05 })
    noise(a, { at: 0.28, dur: 0.35, vol: 0.04, f: 8000, kind: 'highpass' })
  },
  reveal: a => {
    noise(a, { dur: 0.42, vol: 0.12, f: 380, f2: 3600, q: 1.4 })
    ;[1760, 2637, 3520].forEach((f, i) => tone(a, { f, at: 0.34 + i * 0.07, dur: 0.22, vol: 0.07 }))
    tone(a, { f: 880, at: 0.34, dur: 0.5, vol: 0.08, type: 'triangle' })
  },
  flip: a => noise(a, { dur: 0.07, vol: 0.1, f: 2400, f2: 900, q: 1.2 }),
  whistle: a => { tone(a, { f: 2950, type: 'sine', dur: 0.16, vol: 0.12, vib: 90 }); tone(a, { f: 2950, type: 'sine', at: 0.2, dur: 0.38, vol: 0.12, vib: 90 }) },
  trophy: a => {
    const brass = (f: number, at: number, dur: number) => { tone(a, { f, type: 'sawtooth', at, dur, vol: 0.07, attack: 0.03 }); tone(a, { f: f * 2, type: 'triangle', at, dur, vol: 0.05, attack: 0.03 }) }
    brass(392, 0, 0.16); brass(523.25, 0.16, 0.16); brass(659.25, 0.32, 0.16)
    brass(783.99, 0.48, 0.7); brass(523.25, 0.48, 0.7); brass(659.25, 0.48, 0.7)
    noise(a, { at: 0.48, dur: 0.8, vol: 0.05, f: 7000, kind: 'highpass' })
  },
  open: a => tone(a, { f: 320, f2: 560, dur: 0.09, vol: 0.08, type: 'triangle' }),
}

let lastPlay: Partial<Record<SfxName, number>> = {}

/** Play one menu sound (nothing happens when sound is turned off). */
export function sfx(name: SfxName) {
  const now = performance.now()
  if (now - (lastPlay[name] ?? 0) < (name === 'hover' ? 45 : 30)) return // no machine-gun stacking
  lastPlay[name] = now
  const a = audio()
  if (!a || !out) return
  try { SOUNDS[name](a) } catch { /* audio not available */ }
}

const CLICKABLE = 'button, [role="button"], [role="tab"], [role="switch"], summary, a[href], input[type="checkbox"], select'

let installed = false
/** Hook clicks and hover ticks into every button with a single document listener. Returns an uninstaller. */
export function installSfx(): () => void {
  if (installed || typeof document === 'undefined') return () => {}
  installed = true
  let hovered: Element | null = null
  const target = (e: Event) => {
    const el = (e.target as Element | null)?.closest?.(CLICKABLE) as HTMLElement | null
    if (!el || (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return null
    // the live match has its own sound; on-screen pads would click on every touch
    if (el.closest('.touchpad, .mcanvas')) return null
    return el
  }
  const down = (e: PointerEvent) => {
    if (e.button !== 0) return
    const el = target(e)
    if (!el) return
    const own = el.dataset.sfx as SfxName | 'none' | undefined
    if (own === 'none') return
    sfx(own ?? (el.classList.contains('primary') ? 'confirm' : 'click'))
  }
  // Enter / Space on a focused button: a click without a pointer (detail 0)
  const key = (e: MouseEvent) => {
    if (e.detail !== 0) return
    const el = target(e)
    if (el && el.dataset.sfx !== 'none') sfx((el.dataset.sfx as SfxName) ?? 'click')
  }
  const over = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return
    const el = target(e)
    if (el === hovered) return
    hovered = el
    if (el && el.tagName === 'BUTTON' && el.dataset.sfx !== 'none') sfx('hover')
  }
  document.addEventListener('pointerdown', down, true)
  document.addEventListener('click', key, true)
  document.addEventListener('pointerover', over, true)
  return () => {
    installed = false
    lastPlay = {}
    document.removeEventListener('pointerdown', down, true)
    document.removeEventListener('click', key, true)
    document.removeEventListener('pointerover', over, true)
  }
}
