import { useEffect, useMemo, useRef, useState } from 'react'
import { RemoteSource, type InputHub } from './input'
import type { Ctx as InCtx } from './frame'
import { TouchPad } from '../lan/TouchPad'
import { useI18n, type TFn } from '../i18n'

// Playing on a phone or a tablet: the on-screen pad (the same one a Wi-Fi guest uses) drives your
// team through the input hub, a "turn your phone" screen covers the match while the device is held
// upright, and full screen in landscape is asked for where the browser allows it (Android, iPad;
// on an iPhone, adding the game to the home screen gives the full screen).

/** A phone or tablet without a mouse: show touch controls. */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false
  const mm = (q: string) => window.matchMedia?.(q).matches ?? false
  return mm('(pointer: coarse)') || ((navigator.maxTouchPoints ?? 0) > 1 && !mm('(any-pointer: fine)'))
}

/** Held upright (taller than wide). */
export function usePortrait(): boolean {
  const get = () => typeof window !== 'undefined' && window.innerHeight > window.innerWidth * 1.05
  const [p, setP] = useState(get)
  useEffect(() => {
    const on = () => setP(get())
    window.addEventListener('resize', on)
    window.addEventListener('orientationchange', on)
    return () => { window.removeEventListener('resize', on); window.removeEventListener('orientationchange', on) }
  }, [])
  return p
}

type LockableOrientation = ScreenOrientation & { lock?: (o: string) => Promise<void>; unlock?: () => void }

/** Full screen and landscape, where allowed. Call it from a tap (browsers only allow it then). */
export async function enterGameScreen() {
  if (!isTouchDevice()) return
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void }
  try {
    if (!document.fullscreenElement) {
      if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' })
      else el.webkitRequestFullscreen?.()
    }
  } catch { /* not allowed here (an iPhone): the rotate screen still guides the player */ }
  try { await (screen.orientation as LockableOrientation | undefined)?.lock?.('landscape') } catch { /* not supported */ }
}

export function leaveGameScreen() {
  try { (screen.orientation as LockableOrientation | undefined)?.unlock?.() } catch { /* ignore */ }
  try { if (document.fullscreenElement) void document.exitFullscreen() } catch { /* ignore */ }
}

/** What the touch buttons are called in prompts ("press {B} to shoot" → [Shoot]). */
export function touchParams(t: TFn, def: boolean): Record<string, string> {
  const b = (k: string) => '[' + t('pl.tp.' + k) + ']'
  const base: Record<string, string> = { A: '', B: '', X: '', Y: '', LB: '', RB: '', LT: '', RT: b('sprint'), START: b('pause'), LS: b('stick'), RS: b('skill'), UD: '', LR: '' }
  return def
    ? { ...base, LB: b('switch'), B: b('tackle'), X: b('slide'), RB: b('press') }
    : { ...base, A: b('pass'), B: b('shoot'), X: b('lob'), Y: b('through') }
}

/** The on-screen pad for the player on this device: it drives team `side` through the hub. */
export function MatchTouch({ hub, side, ctxOf, def, hidden }: { hub: InputHub | null; side: 0 | 1; ctxOf: (s: 0 | 1) => InCtx; def: boolean; hidden?: boolean }) {
  const { t } = useI18n()
  const ctxRef = useRef(ctxOf)
  ctxRef.current = ctxOf
  const src = useMemo(() => new RemoteSource('touch', 'Touch', 'touch', s => ctxRef.current(s), side), [side])
  useEffect(() => {
    if (!hub) return
    hub.attach(side, src)
    src.active = performance.now() // prompts speak of the touch buttons from the start
    return () => { src.setNamed(0, 0, []); hub.detach(src) }
  }, [hub, src, side])
  const labels: Record<string, string> = def
    ? { pass: t('pl.tp.switch'), shoot: t('pl.tp.tackle'), through: t('pl.tp.slide'), lob: t('pl.tp.press'), sprint: t('pl.tp.sprint'), skill: t('pl.tp.skill') }
    : { pass: t('pl.tp.pass'), shoot: t('pl.tp.shoot'), through: t('pl.tp.through'), lob: t('pl.tp.lob'), sprint: t('pl.tp.sprint'), skill: t('pl.tp.skill') }
  return (
    <div className={'lv-touch' + (hidden ? ' off' : '')}>
      <TouchPad onChange={s => src.setNamed(s.x, s.y, s.held)} labels={labels} hidden={hidden} />
    </div>
  )
}

/** Covers the match while a phone is held upright: turn it to play. */
export function RotateHint({ onLeave }: { onLeave?: () => void }) {
  const { t } = useI18n()
  return (
    <div className="rotatehint" role="dialog" aria-modal="true" aria-label={t('touch.rotate')}>
      <div className="rh-phone" aria-hidden="true"><i /></div>
      <b>{t('touch.rotate')}</b>
      <span>{t('touch.rotateBody')}</span>
      {onLeave && <button className="small" onClick={onLeave}>{t('touch.rotateLeave')}</button>}
    </div>
  )
}
