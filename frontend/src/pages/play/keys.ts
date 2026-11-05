import { KB_CODES } from '../../match/input'

// Keyboard helpers for the play modes (quick match, Wi-Fi guest, training ground).
// Keyboard layouts and Vietnamese input methods (Telex/VNI, EVKey, OpenKey…) don't always send a
// usable KeyboardEvent.code, so fall back to the character and then the legacy keyCode
// (the same rule as the live match screen).

const BY_CHAR: Record<string, string> = {
  w: 'KeyW', 'ư': 'KeyW', a: 'KeyA', s: 'KeyS', d: 'KeyD', 'đ': 'KeyD', j: 'KeyJ', k: 'KeyK', l: 'KeyL', i: 'KeyI', p: 'KeyP', q: 'KeyQ', e: 'KeyE',
  u: 'KeyU', c: 'KeyC', h: 'KeyH', m: 'KeyM', r: 'KeyR', '1': 'Digit1', '2': 'Digit2', '3': 'Digit3', ' ': 'Space', arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight', shift: 'ShiftLeft', escape: 'Escape', enter: 'Enter', tab: 'Tab',
}
const BY_KEYCODE: Record<number, string> = {
  87: 'KeyW', 65: 'KeyA', 83: 'KeyS', 68: 'KeyD', 74: 'KeyJ', 75: 'KeyK', 76: 'KeyL', 73: 'KeyI', 80: 'KeyP', 81: 'KeyQ', 69: 'KeyE', 85: 'KeyU',
  67: 'KeyC', 72: 'KeyH', 77: 'KeyM', 82: 'KeyR', 49: 'Digit1', 50: 'Digit2', 51: 'Digit3', 37: 'ArrowLeft', 38: 'ArrowUp',
  39: 'ArrowRight', 40: 'ArrowDown', 16: 'ShiftLeft', 32: 'Space', 27: 'Escape', 13: 'Enter', 9: 'Tab',
}
const UI_KEYS = new Set(['Digit1', 'Digit2', 'Digit3', 'KeyC', 'KeyH', 'KeyM', 'KeyR', 'Enter'])

/** The game key for a keyboard event, or null when the key means nothing to the game. */
export function gameKey(e: KeyboardEvent): string | null {
  if (KB_CODES.has(e.code) || UI_KEYS.has(e.code)) return e.code
  const byChar = BY_CHAR[(e.key ?? '').toLowerCase()]
  if (byChar) return byChar
  return BY_KEYCODE[e.keyCode] ?? null
}

/** Typing in a field: leave the keys alone. */
export function typing(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null
  return !!el && (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) || el.isContentEditable)
}

/** A phone or tablet (the main pointer is a finger): show the on-screen touch pad. Touch-screen laptops keep their keyboard. */
export const isTouchDevice = () => {
  if (typeof window === 'undefined') return false
  const mq = (q: string) => { try { return window.matchMedia(q).matches } catch { return false } }
  return mq('(pointer: coarse)') || ((navigator.maxTouchPoints > 0 || 'ontouchstart' in window) && !mq('(pointer: fine)'))
}
