import type { EngineEvent } from './engine'

// Match sound, generated with WebAudio (no audio files): a crowd made of filtered noise layers that
// murmurs, swells near the box, groans at near misses, roars at goals (the home end louder),
// boos fouls on the home side and now and then claps and chants; referee whistles, kicks with
// different timbres, the post, the net, tackles, cards, a hush before penalties and a heartbeat
// during shoot-outs. Optional spoken commentary uses the browser's speechSynthesis.
// Everything starts only after a user gesture (wake()) and is cheap: two looping noise sources plus
// short one-shot nodes.

type Layer = { g: GainNode; f: BiquadFilterNode }

export class MatchAudio {
  private ac: AudioContext | null = null
  private master: GainNode | null = null
  private noise: AudioBuffer | null = null
  private bed: Layer | null = null
  private roar: Layer | null = null
  private level = 0 // smoothed excitement
  private boost = 0 // goal roar left (s)
  private boostAmt = 0
  private groan = 0
  private hush = 0
  private tension = false
  private beat = 0
  private chantT = 20
  private lastSay = 0
  volume = 0.6
  enabled = true
  tts = false
  lang = 'en'

  constructor(private derby = false, private home: 0 | 1 = 0) {}

  /** Create or resume the audio context. Call from a user gesture (click, key press). */
  wake() {
    if (!this.enabled) return
    try {
      if (!this.ac) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!AC) return
        const ac = new AC()
        this.ac = ac
        this.master = ac.createGain()
        this.master.gain.value = this.volume
        this.master.connect(ac.destination)
        const len = ac.sampleRate * 2
        const buf = ac.createBuffer(1, len, ac.sampleRate)
        const d = buf.getChannelData(0)
        let b0 = 0, b1 = 0, b2 = 0
        for (let i = 0; i < len; i++) {
          const w = Math.random() * 2 - 1
          b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526
          d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2
        }
        this.noise = buf
        this.bed = this.layer(480, 0.55)
        this.roar = this.layer(950, 0.8)
      }
      if (this.ac.state === 'suspended') void this.ac.resume()
    } catch { this.ac = null }
  }

  private layer(freq: number, q: number): Layer | null {
    const ac = this.ac!, src = ac.createBufferSource()
    src.buffer = this.noise; src.loop = true
    src.playbackRate.value = 0.9 + Math.random() * 0.2
    const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q
    const g = ac.createGain(); g.gain.value = 0
    src.connect(f); f.connect(g); g.connect(this.master!)
    src.start(0, Math.random() * 1.5)
    return { g, f }
  }

  setVolume(v: number, on: boolean) {
    this.volume = v
    this.enabled = on
    if (this.master && this.ac) this.master.gain.setTargetAtTime(on ? v : 0, this.ac.currentTime, 0.05)
    if (on) this.wake()
  }
  suspend() { try { void this.ac?.suspend() } catch { /* ignore */ } ; this.stopSpeech() }
  resume() { if (this.enabled) try { void this.ac?.resume() } catch { /* ignore */ } }
  close() { this.stopSpeech(); try { void this.ac?.close() } catch { /* ignore */ } ; this.ac = null }

  /** Every frame: crowd level follows the danger; chants now and then. */
  tick(dt: number, excite: number, homeAttacking: boolean) {
    const ac = this.ac
    if (!ac || !this.bed || !this.roar || ac.state !== 'running') return
    const t = ac.currentTime
    const target = excite * (homeAttacking ? 1 : 0.55)
    this.level += (target - this.level) * Math.min(1, dt * 1.4)
    this.boost = Math.max(0, this.boost - dt)
    this.groan = Math.max(0, this.groan - dt)
    this.hush = Math.max(0, this.hush - dt)
    const duck = this.hush > 0 ? 0.35 : 1
    const derby = this.derby ? 1.25 : 1
    this.bed.g.gain.setTargetAtTime((0.05 + this.level * 0.05) * duck * derby, t, 0.3)
    let roar = this.level * 0.13 * duck
    if (this.boost > 0) roar = Math.max(roar, this.boostAmt * Math.min(1, this.boost / 1.5))
    if (this.groan > 0) roar = Math.max(roar, 0.16 * Math.sin((this.groan / 1.3) * Math.PI))
    this.roar.g.gain.setTargetAtTime(roar * derby, t, this.boost > 0 ? 0.08 : 0.25)
    this.roar.f.frequency.setTargetAtTime(this.groan > 0 ? 420 + this.groan * 300 : 800 + this.level * 450 + (this.boost > 0 ? 450 : 0), t, 0.2)
    if (this.tension) {
      this.beat -= dt
      if (this.beat <= 0) { this.beat = 0.85; this.thump(55, 0.18); setTimeout(() => this.thump(50, 0.12), 180) }
    }
    this.chantT -= dt * (this.derby ? 1.6 : 1)
    if (this.chantT <= 0 && this.boost <= 0) {
      this.chantT = 22 + Math.random() * 30
      if (Math.random() < 0.5) this.claps(); else this.chant()
    }
  }

  event(e: EngineEvent) {
    if (!this.ac || this.ac.state !== 'running') return
    const homeSide = e.side === this.home
    switch (e.k) {
      case 'pass': this.kick(e.s === 'long' ? 0.55 : 0.3 + (e.v ?? 0.4) * 0.25, e.s === 'long' ? 'long' : 'pass'); break
      case 'kick': this.kick(0.3 + (e.v ?? 0.3) * 0.4, 'pass'); break
      case 'shot': this.kick(0.75 + (e.v ?? 0.5) * 0.25, 'shot'); this.level = Math.max(this.level, 0.7); break
      case 'head': this.kick(0.35, 'head'); break
      case 'tackle': this.thump(85, 0.15 + (e.v ?? 0.5) * 0.25); break
      case 'post': this.ping(); this.groan = 1.3; break
      case 'save': this.groan = 1.1; setTimeout(() => this.claps(0.6), 700); break
      case 'miss': this.groan = (e.v ?? 0.5) > 0.7 ? 1.3 : 0.8; break
      case 'chance': this.level = Math.max(this.level, 0.85); break
      case 'goal':
        this.boost = homeSide ? 5 : 2.5
        this.boostAmt = homeSide ? 0.55 : 0.22
        this.swish()
        if (!homeSide) this.groan = 1.2
        this.tension = false
        break
      case 'foul': if (homeSide) this.boo(); break
      case 'card': this.sting(e.s === 'r'); if (e.s === 'r' && e.side === this.home) this.boo(); break
      case 'whistle': this.whistle(e.v ?? 1); break
      case 'hush': this.hush = 2.6; break
      case 'skill':
        this.groan = 0; this.level = Math.max(this.level, 0.5)
        if (e.s === 'sig') { this.boost = 1.8; this.boostAmt = 0.32; this.swish() } // a legend's trademark: the crowd roars
        break
      case 'so':
        if (e.s === 'start') this.tension = true
        else if (e.s === 'goal') { this.boost = homeSide ? 2 : 1.2; this.boostAmt = homeSide ? 0.42 : 0.2; this.swish() }
        else this.groan = 1.2
        break
      default: break
    }
    if (e.say) this.speak(e.say, e.k === 'goal' || e.k === 'so')
  }

  // ------------------------------------------------------------------------------------------------ voices
  private env(g: GainNode, t: number, a: number, peak: number, d: number) {
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a)
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d)
  }
  private noiseShot(type: BiquadFilterType, freq: number, q: number, peak: number, dur: number, at = 0) {
    const ac = this.ac!, t = ac.currentTime + at
    const s = ac.createBufferSource(); s.buffer = this.noise
    const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q
    const g = ac.createGain()
    this.env(g, t, 0.004, peak, dur)
    s.connect(f); f.connect(g); g.connect(this.master!)
    s.start(t, Math.random() * 1.5, dur + 0.05)
    return f
  }
  private tone(type: OscillatorType, f0: number, f1: number, peak: number, dur: number, at = 0) {
    const ac = this.ac!, t = ac.currentTime + at
    const o = ac.createOscillator(); o.type = type
    o.frequency.setValueAtTime(f0, t)
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur)
    const g = ac.createGain()
    this.env(g, t, 0.005, peak, dur)
    o.connect(g); g.connect(this.master!)
    o.start(t); o.stop(t + dur + 0.05)
  }

  private kick(power: number, kind: 'pass' | 'shot' | 'head' | 'long') {
    if (kind === 'head') { this.tone('sine', 230, 120, 0.22, 0.09); this.noiseShot('bandpass', 1200, 1, 0.05, 0.04); return }
    const p = Math.min(1, power)
    this.tone('sine', kind === 'shot' ? 150 : 120, kind === 'shot' ? 42 : 60, 0.18 + p * 0.35, kind === 'shot' ? 0.16 : 0.09)
    this.noiseShot('highpass', kind === 'shot' ? 1600 : 2400, 0.7, 0.05 + p * 0.1, 0.03)
    if (kind === 'shot' || kind === 'long') {
      const f = this.noiseShot('bandpass', 600, 1.4, kind === 'shot' ? 0.07 : 0.04, 0.35, 0.02)
      f.frequency.exponentialRampToValueAtTime(2400, this.ac!.currentTime + 0.35)
    }
  }
  private thump(freq: number, peak: number) {
    if (!this.ac || this.ac.state !== 'running') return
    this.tone('sine', freq, freq * 0.5, peak, 0.16)
    this.noiseShot('lowpass', 300, 0.7, peak * 0.3, 0.08)
  }
  private ping() {
    for (const [f, a] of [[860, 0.16], [1350, 0.1], [2150, 0.06]] as const) this.tone('sine', f, f * 0.995, a, 0.7)
  }
  private swish() { this.noiseShot('bandpass', 2600, 1.8, 0.12, 0.45) }
  private whistle(n: number) {
    const blast = (at: number, dur: number) => {
      const ac = this.ac!, t = ac.currentTime + at
      const o = ac.createOscillator(); o.type = 'square'; o.frequency.value = 2900
      const lfo = ac.createOscillator(); lfo.frequency.value = 28
      const lg = ac.createGain(); lg.gain.value = 220
      lfo.connect(lg); lg.connect(o.frequency)
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3000; bp.Q.value = 3
      const g = ac.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.09, t + 0.02)
      g.gain.setValueAtTime(0.09, t + dur - 0.05)
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
      o.connect(bp); bp.connect(g); g.connect(this.master!)
      o.start(t); lfo.start(t); o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05)
    }
    if (n >= 3) { blast(0, 0.32); blast(0.45, 0.32); blast(0.9, 1.0) }
    else if (n === 2) { blast(0, 0.3); blast(0.42, 0.75) }
    else blast(0, 0.28)
  }
  private boo() {
    for (const f of [110, 131, 147, 165]) {
      const ac = this.ac!, t = ac.currentTime
      const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f * (0.97 + Math.random() * 0.06), t)
      o.frequency.linearRampToValueAtTime(f * 0.92, t + 1.4)
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500
      const g = ac.createGain()
      this.env(g, t, 0.25, 0.025, 1.3)
      o.connect(lp); lp.connect(g); g.connect(this.master!)
      o.start(t); o.stop(t + 1.7)
    }
    for (let i = 0; i < 4; i++) this.tone('sine', 2200 + Math.random() * 1000, 1800 + Math.random() * 1400, 0.012, 0.5 + Math.random() * 0.5, Math.random() * 0.4)
  }
  private sting(red: boolean) {
    this.tone('sawtooth', red ? 196 : 233, red ? 185 : 233, 0.05, 0.45)
    this.tone('sawtooth', red ? 207 : 247, red ? 196 : 247, 0.05, 0.45)
  }
  private claps(gain = 1) {
    if (!this.ac) return
    // "clap clap, clap-clap-clap" from a few thousand hands
    const pattern = [0, 0.42, 0.84, 1.05, 1.26]
    for (let r = 0; r < 2; r++) for (const at of pattern) this.noiseShot('bandpass', 1500 + Math.random() * 400, 0.9, 0.05 * gain * (this.derby ? 1.4 : 1), 0.07, r * 1.7 + at)
  }
  private chant() {
    if (!this.ac) return
    const ac = this.ac, t0 = ac.currentTime
    const notes = [220, 277, 330, 277, 220]
    notes.forEach((f, i) => {
      for (const det of [0.99, 1, 1.012]) {
        const t = t0 + i * 0.42
        const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f * det
        const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 750; bp.Q.value = 1.2
        const g = ac.createGain()
        this.env(g, t, 0.06, 0.012 * (this.derby ? 1.5 : 1), 0.38)
        o.connect(bp); bp.connect(g); g.connect(this.master!)
        o.start(t); o.stop(t + 0.5)
      }
    })
  }

  // ------------------------------------------------------------------------------------------------ commentary
  speak(text: string, urgent = false) {
    if (!this.tts || !this.enabled || !text || typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const now = performance.now()
    if (!urgent && now - this.lastSay < 3500) return
    this.lastSay = now
    try {
      const ss = window.speechSynthesis
      if (urgent) ss.cancel()
      const u = new SpeechSynthesisUtterance(text)
      const tag = this.lang === 'vi' ? 'vi-VN' : this.lang === 'ja' ? 'ja-JP' : 'en-GB'
      u.lang = tag
      const v = ss.getVoices().find(x => x.lang.toLowerCase().startsWith(this.lang))
      if (v) u.voice = v
      u.rate = urgent ? 1.12 : 1.05
      u.volume = Math.min(1, this.volume + 0.2)
      ss.speak(u)
    } catch { /* not available */ }
  }
  private stopSpeech() { try { window.speechSynthesis?.cancel() } catch { /* ignore */ } }
}
