import type { Engine, EngineEvent, MatchOutcome } from '../match/engine'
import { RemoteSource, type InputHub } from '../match/input'
import { LanLink, type LanAddress, type LanMessage, type LanState } from './client'
import { GUEST_SIDE, guestHud, type GuestDevice, type InfoMsg } from './protocol'

/**
 * The host side of a Wi-Fi match. Create one in the lobby (it opens a room and gets the code),
 * keep it for rematches, and while a match runs:
 *
 *   host.bind(engine, hub)   // P2's input arrives through a RemoteSource attached to side 1
 *   host.tick(now)           // every animation frame: streams the picture (~30 Hz) and the HUD
 *   host.event(e)            // from EngineOpts.onEvent: sounds and rumble for the guest
 *   host.end(outcome)        // full time
 *   host.unbind()            // the match screen closes
 *
 * onGuest(here) fires when the second device arrives or drops out (pause / hand side 1 to the CPU).
 * Any screen can host: MatchPage could use it exactly like the quick match does.
 */
export class LanHost {
  readonly link: LanLink
  code = ''
  address: LanAddress | null = null
  state: LanState = 'connecting'
  /** a guest device is connected */
  guest = false
  guestDev: GuestDevice | '' = ''
  /** round trip host ↔ guest in ms, as the guest measured it */
  rtt = 0
  onGuest: (here: boolean) => void = () => {}
  private eng: Engine | null = null
  private hub: InputHub | null = null
  private src: RemoteSource | null = null
  private info: InfoMsg | null = null
  private lastF = 0
  private n = 0
  private subs = new Set<() => void>()

  constructor() {
    this.link = new LanLink('host', {
      state: s => { this.state = s; this.changed() },
      room: (code, address) => {
        this.code = code
        this.address = address
        if (this.info) this.link.send(this.info as unknown as LanMessage)
        this.changed()
      },
      peer: here => {
        const was = this.guest
        this.guest = here
        if (here) this.welcome()
        else { this.detach(); this.rtt = 0 }
        if (was !== here) this.onGuest(here)
        this.changed()
      },
      message: m => this.onMessage(m),
    })
  }

  /** Re-render hook for lobby screens: returns the unsubscribe function. */
  subscribe(fn: () => void) { this.subs.add(fn); return () => { this.subs.delete(fn) } }
  private changed() { for (const f of this.subs) f() }

  /** The lobby card the guest sees (teams, state). Kept by the relay for guests who join later. */
  setInfo(info: Omit<InfoMsg, 'type'>) {
    this.info = { type: 'info', ...info }
    this.link.send(this.info as unknown as LanMessage)
  }

  bind(eng: Engine, hub: InputHub) {
    this.unbind()
    this.eng = eng
    this.hub = hub
    this.src = new RemoteSource('net:guest', 'Wi-Fi', 'xbox', s => eng.contextOf(s), GUEST_SIDE)
    this.lastF = 0
    if (this.guest) this.welcome()
  }

  unbind() {
    this.detach()
    this.eng = null
    this.hub = null
    this.src = null
  }

  private detach() { if (this.hub && this.src) this.hub.detach(this.src) }

  /** A guest arrived or asked for a fresh start: the lobby card, then statics and the current picture. */
  private welcome() {
    if (this.info) this.link.send(this.info as unknown as LanMessage)
    const eng = this.eng
    if (!eng) return
    if (this.hub && this.src && !this.hub.slots[GUEST_SIDE].includes(this.src)) this.hub.attach(GUEST_SIDE, this.src)
    this.link.send({ type: 'st', st: eng.statics() })
    this.sendFrame()
    this.sendHud()
  }

  private onMessage(m: LanMessage) {
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0)
    switch (m.type) {
      case 'hello':
        this.guestDev = (['touch', 'kb', 'ps', 'xbox'].includes(String(m.dev)) ? m.dev : '') as GuestDevice | ''
        this.welcome()
        this.changed()
        break
      case 'in':
        this.src?.set({ x: num(m.x), y: num(m.y), rx: num(m.rx), ry: num(m.ry), b: Number(m.b) | 0 })
        break
      case 'tp':
        this.src?.setNamed(num(m.x), num(m.y), Array.isArray(m.h) ? m.h.map(String).slice(0, 8) : [])
        break
      case 'ping':
        this.link.send({ type: 'pong', t: Number(m.t) || 0 })
        break
      case 'away': // the guest's screen went off or it switched apps: pause rather than play on without them
        if (this.eng && !this.eng.paused && this.eng.phase !== 'end' && this.eng.human[GUEST_SIDE]) this.eng.pause('user')
        break
      case 'rtt':
        this.rtt = Math.max(0, Math.round(Number(m.ms) || 0))
        this.changed()
        break
    }
  }

  private sendFrame() {
    const eng = this.eng
    if (!eng) return
    const [ex, homeAtt] = eng.excitement()
    this.link.send({ type: 'f', f: eng.frameState(), ex: Math.round(ex * 100) / 100, ha: homeAtt })
  }

  private sendHud() {
    if (this.eng) this.link.send({ type: 'hud', h: guestHud(this.eng.hud()) })
  }

  /** Call once per animation frame while the match screen is up. */
  tick(now: number) {
    if (!this.guest || !this.eng) return
    if (now - this.lastF < 1000 / 30 - 3) return
    // a slow phone or Wi-Fi: skip frames rather than queue them up (the picture would lag behind)
    if (this.link.backlog > 64 * 1024) return
    this.lastF = now
    this.sendFrame()
    if (++this.n % 5 === 0) this.sendHud()
  }

  /** Match sounds for the guest's speaker and rumble for its controller. */
  event(e: EngineEvent) {
    if (this.guest && e.k !== 'cam') this.link.send({ type: 'ev', e })
  }

  end(o: MatchOutcome, homeIsP1 = true) {
    const sc: [number, number] = homeIsP1 ? [o.homeGoals, o.awayGoals] : [o.awayGoals, o.homeGoals]
    const pens = o.pens ? (homeIsP1 ? o.pens : [o.pens[1], o.pens[0]] as [number, number]) : null
    this.link.send({ type: 'end', sc, pens, et: !!o.extraTime })
    this.sendHud()
  }

  /** Leave for good: the guest is told the match is over. */
  close() {
    this.unbind()
    this.link.close()
  }
}
