// LAN play transport: a thin WebSocket client for the relay in backend/lan.go.
// The host (the computer running the match) opens a room and gets a 4-letter code; a second
// device joins with the code. Messages are plain JSON objects with a "type" field (always the first
// key); the relay passes them through untouched.
//
// Both sides reconnect on their own after a dropped connection: the host comes back to its room
// with the room key, the guest with its own random key (so the relay replaces its stale socket).
// Only when the room is gone (host left for good) does the link give up with state 'gone'.

export type LanRole = 'host' | 'guest'
/** connecting → open (our socket is up) · retrying (dropped, trying again) · gone (room closed) · closed (by us) */
export type LanState = 'connecting' | 'open' | 'retrying' | 'gone' | 'closed'

export interface LanAddress { ip: string; port: string; url: string }

export interface LanMessage { type: string; [k: string]: unknown }

export interface LanEvents {
  /** our own connection changed */
  state?: (s: LanState, detail?: string) => void
  /** host: the room is open (again) */
  room?: (code: string, address: LanAddress, resumed: boolean) => void
  /** the other device arrived (true) or left (false); info = the host's lobby info for a guest that just joined */
  peer?: (here: boolean, info?: LanMessage | null) => void
  message?: (m: LanMessage) => void
}

export interface LanOptions {
  code?: string
  /** origin of the server, e.g. http://192.168.1.20:5195 (default: this page's) */
  base?: string
}

function wsURL(base: string, path: string) {
  const u = new URL(path, base)
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  return u.toString()
}

const pageBase = () => (typeof location !== 'undefined' ? location.origin : 'http://localhost:5195')

/** What other devices should open (falls back to this page's own address). */
export async function lanAddress(): Promise<LanAddress> {
  try {
    const r = await fetch('/api/lan/info')
    const a = await r.json() as LanAddress
    if (a.url) return a
  } catch { /* ignore */ }
  const local = /^(localhost|127\.|\[::1\])/.test(location.hostname)
  return { ip: local ? '' : location.hostname, port: location.port, url: local ? '' : location.origin }
}

/** Does a room with this code exist? null = the server could not be reached. */
export async function lanRoomExists(code: string, base = pageBase()): Promise<boolean | null> {
  try {
    const r = await fetch(new URL(`/api/lan/room?code=${encodeURIComponent(code)}`, base))
    if (r.status === 404) return false
    return r.ok
  } catch {
    return null
  }
}

/** A random id of this browser tab, so the relay knows a returning guest. */
function guestKey(): string {
  const make = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10)
  try {
    let k = sessionStorage.getItem('pitchside.lan.guest')
    if (!k) { k = make(); sessionStorage.setItem('pitchside.lan.guest', k) }
    return k
  } catch {
    return make()
  }
}

export class LanLink {
  private ws: WebSocket | null = null
  private closedByUs = false
  private retryT = 0
  private tries = 0
  private base: string
  code = ''
  /** host: the room key that lets us come back after a dropped connection */
  key = ''
  state: LanState = 'connecting'
  /** the other device is connected right now */
  peer = false
  address: LanAddress | null = null

  constructor(readonly role: LanRole, private on: LanEvents, opts: LanOptions = {}) {
    this.code = (opts.code ?? '').trim().toUpperCase()
    this.base = opts.base ?? pageBase()
    if (role === 'guest') this.key = guestKey()
    this.open()
  }

  private set(s: LanState, detail?: string) {
    this.state = s
    this.on.state?.(s, detail)
  }

  private setPeer(here: boolean, info?: LanMessage | null) {
    this.peer = here
    this.on.peer?.(here, info)
  }

  private open() {
    let q: string
    if (this.role === 'host') q = this.code && this.key ? `role=host&code=${encodeURIComponent(this.code)}&key=${encodeURIComponent(this.key)}` : 'role=host'
    else q = `role=guest&code=${encodeURIComponent(this.code)}&key=${encodeURIComponent(this.key)}`
    let ws: WebSocket
    try { ws = new WebSocket(wsURL(this.base, `/api/lan/ws?${q}`)) } catch { this.retry(); return }
    this.ws = ws
    if (this.state !== 'retrying') this.set('connecting')
    let opened = false
    ws.onopen = () => { opened = true; this.tries = 0; this.set('open') }
    ws.onmessage = e => {
      let m: LanMessage
      try { m = JSON.parse(String(e.data)) } catch { return }
      switch (m.type) {
        case 'room':
          this.code = String(m.code ?? '')
          this.key = String(m.key ?? this.key)
          this.address = (m.address ?? null) as LanAddress | null
          this.on.room?.(this.code, this.address ?? { ip: '', port: '', url: '' }, !!m.resumed)
          if (!m.guest && this.peer) this.setPeer(false)
          return
        case 'joined': // guest: we are in; info = the host's lobby details
          this.setPeer(!!m.host, (m.info ?? null) as LanMessage | null)
          return
        case 'peer-joined':
          this.setPeer(true)
          return
        case 'peer-left':
          this.setPeer(false)
          return
      }
      this.on.message?.(m)
    }
    ws.onerror = () => { /* onclose follows */ }
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null
      if (this.closedByUs) { this.set('closed'); return }
      if (this.peer) this.setPeer(false)
      // a socket that never opened: the code may be wrong or the room gone; check before retrying
      this.retry(opened)
    }
  }

  private async retry(wasOpen = false) {
    if (this.closedByUs) return
    this.tries++
    if (this.code) {
      const ok = await lanRoomExists(this.code, this.base)
      if (ok === false) { this.set('gone'); return }
    }
    if (this.closedByUs) return
    // a host that could not even open a room (logged out, server down) keeps trying, a little slower
    this.set('retrying', wasOpen ? 'dropped' : this.tries > 2 ? 'unreachable' : undefined)
    globalThis.clearTimeout(this.retryT)
    this.retryT = globalThis.setTimeout(() => this.open(), Math.min(4000, 600 + this.tries * 500)) as unknown as number
  }

  /** Send a JSON message to the other device (dropped while not connected). */
  send(m: LanMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m))
  }

  /** Bytes waiting in the socket buffer: senders of frequent frames should skip a frame when this grows. */
  get backlog() { return this.ws?.bufferedAmount ?? 0 }

  get connected() { return this.ws?.readyState === WebSocket.OPEN }

  /** Leave for good (a host closing ends the room for the guest too). */
  close() {
    this.closedByUs = true
    globalThis.clearTimeout(this.retryT)
    try { this.ws?.close(1000) } catch { /* ignore */ }
    this.ws = null
    this.peer = false
  }
}
