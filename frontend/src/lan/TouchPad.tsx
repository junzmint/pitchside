import { useEffect, useRef, useState } from 'react'

// On-screen controller for a phone or tablet joining a LAN match: a floating stick on the left
// half of the screen and action buttons on the right. It reports a stick vector and the set of
// held buttons by name (the host maps them by context, see RemoteSource.setNamed), so the host
// treats it like any other pad. Pointer events: fingers, a mouse or a pen all work, several at once.

export interface PadState { x: number; y: number; held: string[] }

export const TOUCH_BUTTONS: { id: string; cls: string }[] = [
  { id: 'shoot', cls: 'b-shoot' },
  { id: 'pass', cls: 'b-pass' },
  { id: 'through', cls: 'b-through' },
  { id: 'lob', cls: 'b-lob' },
  { id: 'sprint', cls: 'b-sprint' },
  { id: 'skill', cls: 'b-skill' },
]

/** labels: button id → text (what the button does right now, e.g. "Shoot" or "Tackle"). */
export function TouchPad({ onChange, labels, hidden }: { onChange: (s: PadState) => void; labels: Record<string, string>; hidden?: boolean }) {
  const [knob, setKnob] = useState<{ ox: number; oy: number; x: number; y: number } | null>(null)
  const [held, setHeld] = useState<string[]>([])
  const heldRef = useRef(new Map<number, string>()) // pointer id → button
  const stick = useRef({ x: 0, y: 0 })
  const stickPtr = useRef<number | null>(null)
  const zone = useRef<HTMLDivElement>(null)
  const cb = useRef(onChange)
  cb.current = onChange

  const emit = () => {
    const h = [...new Set(heldRef.current.values())]
    setHeld(h)
    cb.current({ x: stick.current.x, y: stick.current.y, held: h })
  }
  // release everything if the pad disappears mid-press
  useEffect(() => () => { heldRef.current.clear(); stick.current = { x: 0, y: 0 }; cb.current({ x: 0, y: 0, held: [] }) }, [])

  const R = 54
  const local = (e: React.PointerEvent) => {
    const r = zone.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const stickDown = (e: React.PointerEvent) => {
    if (stickPtr.current != null) return
    e.preventDefault()
    stickPtr.current = e.pointerId
    try { (e.target as Element).setPointerCapture(e.pointerId) } catch { /* ignore */ }
    const p = local(e)
    setKnob({ ox: p.x, oy: p.y, x: p.x, y: p.y })
  }
  const stickMove = (e: React.PointerEvent) => {
    if (e.pointerId !== stickPtr.current || !knob) return
    const p = local(e)
    let dx = p.x - knob.ox, dy = p.y - knob.oy
    const d = Math.hypot(dx, dy)
    if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R }
    const len = Math.hypot(dx, dy)
    // a small dead zone, then the full range
    const m = Math.min(1, len / R)
    const mm = m < 0.12 ? 0 : (m - 0.12) / 0.88
    const r2 = (v: number) => Math.round(v * 100) / 100
    stick.current = len > 0 ? { x: r2((dx / len) * mm), y: r2((dy / len) * mm) } : { x: 0, y: 0 }
    setKnob({ ...knob, x: knob.ox + dx, y: knob.oy + dy })
    emit()
  }
  const stickUp = (e: React.PointerEvent) => {
    if (e.pointerId !== stickPtr.current) return
    stickPtr.current = null
    stick.current = { x: 0, y: 0 }
    setKnob(null)
    emit()
  }
  const press = (id: string, e: React.PointerEvent, down: boolean) => {
    e.preventDefault()
    if (down) {
      try { (e.target as Element).setPointerCapture(e.pointerId) } catch { /* ignore */ }
      heldRef.current.set(e.pointerId, id)
      if (navigator.vibrate) try { navigator.vibrate(12) } catch { /* ignore */ }
    } else heldRef.current.delete(e.pointerId)
    emit()
  }

  return (
    <div className={'touchpad' + (hidden ? ' tp-hidden' : '')} onContextMenu={e => e.preventDefault()}>
      <div ref={zone} className="tp-stickzone" onPointerDown={stickDown} onPointerMove={stickMove} onPointerUp={stickUp} onPointerCancel={stickUp}>
        {knob ? (
          <>
            <span className="tp-base" style={{ left: knob.ox, top: knob.oy }} />
            <span className="tp-knob" style={{ left: knob.x, top: knob.y }} />
          </>
        ) : <span className="tp-hint" aria-hidden="true"><i /></span>}
      </div>
      <div className="tp-buttons">
        {TOUCH_BUTTONS.map(b => (
          <button key={b.id} type="button" className={'tp-btn ' + b.cls + (held.includes(b.id) ? ' on' : '')}
            onPointerDown={e => press(b.id, e, true)} onPointerUp={e => press(b.id, e, false)} onPointerCancel={e => press(b.id, e, false)}>
            {labels[b.id] ?? b.id}
          </button>
        ))}
      </div>
    </div>
  )
}
