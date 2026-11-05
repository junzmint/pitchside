import { useEffect, useRef, useState } from 'react'

// Driving the menus with a PlayStation / Xbox controller (Gamepad API, "standard" mapping).
//   D-pad / left stick  move between buttons, links, rows and fields (spatial navigation)
//   ✕ (A)               press · on a slider or dropdown, left/right changes the value
//   ○ (B)               back: close the open dialog or cancel a confirmation
//   L1 / R1             previous / next page in the side menu
//   right stick         scroll
//   Share / View        during a live match: open substitutions
// During live play the match engine owns the controller (see match/gamepad.ts); menus inside the
// match (substitutions, full time) are navigable again.
const B = { CROSS: 0, CIRCLE: 1, L1: 4, R1: 5, SHARE: 8, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 }

const FOCUSABLE = [
  'button:not([disabled])', 'a[href]', 'input:not([disabled]):not([type=hidden])', 'select:not([disabled])', 'textarea',
  '[role=button]', 'tr.click', '.savecard', '[tabindex]:not([tabindex="-1"])',
].join(',')

type Dir = 'up' | 'down' | 'left' | 'right'

function visible(el: Element) {
  const r = el.getBoundingClientRect()
  if (r.width < 2 || r.height < 2) return false
  const s = getComputedStyle(el)
  return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05
}

/** Where the controller acts right now: the top dialog, the match screen, or the whole page. */
function scope(): Element | null {
  if (document.querySelector('.busy')) return null
  const live = document.querySelector('.mcanvas')
  if (live) return live.querySelector('.overlay') // null while playing: the engine has the pad
  const tops = [...document.querySelectorAll('.modal, .matchwrap')].filter(visible)
  return tops[tops.length - 1] ?? document.body
}

function candidates(root: Element) {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => visible(el) && !el.closest('[aria-hidden=true]'))
}

function center(r: DOMRect) { return { x: r.left + r.width / 2, y: r.top + r.height / 2 } }

/** Nearest element in a direction: distance along it plus a penalty for drifting sideways. */
function pickNext(cur: HTMLElement, list: HTMLElement[], dir: Dir) {
  const a = cur.getBoundingClientRect(), ca = center(a)
  let best: HTMLElement | null = null, bestS = Infinity
  for (const el of list) {
    if (el === cur) continue // a card and the buttons inside it are both reachable: centres decide
    const b = el.getBoundingClientRect(), cb = center(b)
    let main = 0, side = 0
    switch (dir) {
      case 'down': main = b.top - a.bottom + 1; side = Math.abs(cb.x - ca.x); if (cb.y <= ca.y + 2) continue; break
      case 'up': main = a.top - b.bottom + 1; side = Math.abs(cb.x - ca.x); if (cb.y >= ca.y - 2) continue; break
      case 'right': main = b.left - a.right + 1; side = Math.abs(cb.y - ca.y); if (cb.x <= ca.x + 2) continue; break
      case 'left': main = a.left - b.right + 1; side = Math.abs(cb.y - ca.y); if (cb.x >= ca.x - 2) continue; break
    }
    const s = Math.max(0, main) + side * (dir === 'left' || dir === 'right' ? 3 : 1.5)
    if (s < bestS) { bestS = s; best = el }
  }
  return best
}

/** Change a slider or dropdown the way React expects (native setter + input/change event). */
function nudge(el: HTMLElement, delta: number): boolean {
  if (el instanceof HTMLInputElement && el.type === 'range') {
    const step = Number(el.step) || 1
    const v = Math.min(Number(el.max || 100), Math.max(Number(el.min || 0), Number(el.value) + delta * step))
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, String(v))
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  }
  if (el instanceof HTMLSelectElement) {
    const i = Math.min(el.options.length - 1, Math.max(0, el.selectedIndex + delta))
    if (i === el.selectedIndex) return true
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(el, el.options[i].value)
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }
  return false
}

export function useGamepadNav() {
  const [connected, setConnected] = useState(false)
  const cur = useRef<HTMLElement | null>(null)
  useEffect(() => {
    let timer = 0
    const prev: boolean[] = []
    const held: Record<string, number> = {} // direction → next repeat time
    let wasConnected = false

    const mark = (el: HTMLElement | null) => {
      cur.current?.classList.remove('padfocus')
      cur.current = el
      if (!el) return
      el.classList.add('padfocus')
      if (el.tabIndex >= 0 || /^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) el.focus({ preventScroll: true })
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
    const ensure = (root: Element) => {
      const list = candidates(root)
      if (cur.current && root.contains(cur.current) && list.includes(cur.current)) return list
      const first = list.find(el => el.matches('.primary')) ?? list[0] ?? null
      mark(first)
      return list
    }
    const move = (dir: Dir) => {
      const root = scope()
      if (!root) return
      const list = ensure(root)
      const c = cur.current
      if (!c) return
      if ((dir === 'left' || dir === 'right') && nudge(c, dir === 'left' ? -1 : 1)) return
      const next = pickNext(c, list, dir)
      if (next) mark(next)
    }
    const press = () => {
      const root = scope()
      if (!root) return
      ensure(root)
      const c = cur.current
      if (!c) return
      if (c instanceof HTMLInputElement && (c.type === 'text' || c.type === 'search' || c.type === 'password' || c.type === 'number')) { c.focus(); return }
      if (c instanceof HTMLSelectElement || (c instanceof HTMLInputElement && c.type === 'range')) return
      c.click()
      // the clicked control may have been replaced (e.g. a confirm button): keep focus nearby
      requestAnimationFrame(() => { if (cur.current && !document.contains(cur.current)) { cur.current = null; const r = scope(); if (r) ensure(r) } })
    }
    const back = () => {
      const root = scope()
      if (!root) return
      // a pending confirmation: its cancel button sits right after the confirm button
      const confirmRow = cur.current?.closest('span.row')
      const cancel = confirmRow?.querySelector<HTMLButtonElement>('button:last-child')
      if (cancel && confirmRow!.querySelectorAll('button').length === 2) { cancel.click(); return }
      if (root.classList.contains('modal')) { (root as HTMLElement).click(); return }
      const closer = [...root.querySelectorAll<HTMLButtonElement>('button')].find(b => /^(back|quay lại|huỷ|cancel|×|✕|continue|tiếp tục|quay lại trận|back to the match)$/i.test(b.textContent?.trim() ?? ''))
      closer?.click()
    }
    const page = (step: number) => {
      if (scope() !== document.body) return
      const tabs = [...document.querySelectorAll<HTMLButtonElement>('nav.tabs button')]
      if (!tabs.length) return
      const i = tabs.findIndex(b => b.getAttribute('aria-current') === 'true')
      tabs[(i + step + tabs.length) % tabs.length].click()
      mark(null)
    }

    const loop = () => {
      const now = performance.now()
      const pad = [...(navigator.getGamepads?.() ?? [])].find(p => p && p.connected) ?? null
      if (!pad) {
        if (wasConnected) { wasConnected = false; setConnected(false); document.body.classList.remove('padnav'); mark(null) }
        return
      }
      if (!wasConnected) { wasConnected = true; setConnected(true); document.body.classList.add('padnav') }
      const on = (i: number) => !!pad.buttons[i]?.pressed
      const edge = (i: number) => { const p = on(i) && !prev[i]; return p }
      // live play: only Share opens substitutions; everything else belongs to the match engine
      const live = document.querySelector('.mcanvas')
      if (live && !live.querySelector('.overlay')) {
        if (edge(B.SHARE)) document.querySelector<HTMLButtonElement>('.mbar button')?.click()
      } else {
        const ax = pad.axes[0] ?? 0, ay = pad.axes[1] ?? 0
        const dirs: [Dir, boolean][] = [
          ['up', on(B.UP) || ay < -0.6], ['down', on(B.DOWN) || ay > 0.6],
          ['left', on(B.LEFT) || ax < -0.6], ['right', on(B.RIGHT) || ax > 0.6],
        ]
        for (const [d, down] of dirs) {
          if (!down) { delete held[d]; continue }
          if (held[d] === undefined) { held[d] = now + 320; move(d) }
          else if (now >= held[d]) { held[d] = now + 110; move(d) }
        }
        if (edge(B.CROSS)) press()
        if (edge(B.CIRCLE)) back()
        if (edge(B.L1)) page(-1)
        if (edge(B.R1)) page(1)
        const sy = pad.axes[3] ?? 0
        if (Math.abs(sy) > 0.2) {
          const box = (cur.current?.closest('.scroll, .overlay, .modal .card') as HTMLElement | null) ?? document.scrollingElement as HTMLElement
          box.scrollBy(0, sy * 18)
        }
      }
      for (let i = 0; i < pad.buttons.length; i++) prev[i] = on(i)
    }
    // poll at ~60 Hz with a timer: unlike animation frames it keeps going when the page isn't painting
    timer = window.setInterval(loop, 16)
    // a mouse click or key press takes over again
    const off = () => { cur.current?.classList.remove('padfocus') }
    window.addEventListener('mousedown', off)
    return () => { clearInterval(timer); window.removeEventListener('mousedown', off); document.body.classList.remove('padnav') }
  }, [])
  return connected
}
