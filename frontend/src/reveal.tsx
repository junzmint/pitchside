import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Player } from './types'
import { Icon, PlayerCard, Portal, tierOf } from './ui'
import { useI18n } from './i18n'
import { sfx } from './sfx'

// Pack-style reveals: face-down cards flip over with a glow in the colour of the rating tier
// (bronze, silver, gold, rare, elite, icon). Short (about 1.3 s), skippable with a click or a key,
// and instant for players who prefer reduced motion.
//
//   revealSigning(player)                        // "Welcome to the club" after a purchase
//   showReveal({ kind: 'icon', players: [p] })   // any reveal; one host is mounted in App.tsx

export type RevealKind = 'signing' | 'icon' | 'youth'
export interface RevealReq { kind: RevealKind; players: Player[]; foot?: (p: Player) => ReactNode }

const listeners = new Set<(r: RevealReq) => void>()

/** Show a reveal over everything (no-op when no host is mounted). */
export function showReveal(r: RevealReq) {
  if (!r.players.length) return
  listeners.forEach(fn => fn(r))
}

/** The "Welcome to the club" card for a new signing (purchase, deal or icon pick). */
export function revealSigning(p: Player, kind: 'signing' | 'icon' = 'signing') {
  sfx('cash')
  showReveal({ kind, players: [p] })
}

export function prefersReducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

/** Mount once (App.tsx): renders the reveal overlay when one is requested. */
export function RevealHost() {
  const [req, setReq] = useState<RevealReq | null>(null)
  const [n, setN] = useState(0)
  useEffect(() => {
    const fn = (r: RevealReq) => { setReq(r); setN(x => x + 1) }
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  }, [])
  if (!req) return null
  return <RevealOverlay key={n} req={req} onClose={() => setReq(null)} />
}

const BEST_FIRST = (a: Player, b: Player) => b.overall - a.overall

function RevealOverlay({ req, onClose }: { req: RevealReq; onClose: () => void }) {
  const { t } = useI18n()
  const reduce = prefersReducedMotion()
  const players = req.players.slice(0, 6)
  const best = [...players].sort(BEST_FIRST)[0]
  const tier = tierOf(best.overall)
  const big = tier === 'elite' || tier === 'icon' || tier === 'rare'
  // 0: face down · 1: flipping · 2: done (title and buttons)
  const [phase, setPhase] = useState(reduce ? 2 : 0)
  const timers = useRef<number[]>([])
  const closeBtn = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (reduce) { sfx(big ? 'levelup' : 'reveal'); return }
    const flipAt = 380
    const doneAt = flipAt + 560 + (players.length - 1) * 120
    timers.current.push(window.setTimeout(() => { setPhase(1); sfx('reveal') }, flipAt))
    timers.current.push(window.setTimeout(() => { setPhase(2); if (big) sfx('levelup') }, doneAt))
    return () => { timers.current.forEach(clearTimeout); timers.current = [] }
  }, [])
  useEffect(() => { if (phase === 2) closeBtn.current?.focus() }, [phase])
  function skipOrClose() {
    if (phase < 2) { timers.current.forEach(clearTimeout); timers.current = []; setPhase(2); return }
    onClose()
  }
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopImmediatePropagation(); skipOrClose() }
    }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  })
  const title = req.kind === 'icon' ? t('rv.icon') : req.kind === 'youth' ? t('rv.youth') : t('rv.welcome')
  const sub = players.length === 1 ? players[0].name : t('rv.count', { n: players.length })
  return (
    <Portal>
      <div className={'reveal t-' + tier + ' ph' + phase + (players.length > 1 ? ' multi' : '')} role="dialog" aria-modal="true" aria-label={title} onClick={skipOrClose}>
        <div className="rv-rays" aria-hidden="true" />
        <div className="rv-stage">
        <div className="rv-head">
          <span className="eyebrow"><Icon name={req.kind === 'youth' ? 'youth' : req.kind === 'icon' ? 'icon' : 'sign'} size={14} /> {title}</span>
          <h2 className="rv-title">{phase === 2 ? sub : ' '}</h2>
        </div>
        <div className="rv-cards">
          {players.map((p, i) => (
            <div key={p.id} className={'rv-card t-' + tierOf(p.overall)} style={{ ['--i' as string]: i } as React.CSSProperties}>
              <div className="rv-inner">
                <div className="rv-back" aria-hidden="true">
                  <span className="rv-logo"><Icon name="play" size={46} strokeWidth={1.4} /></span>
                  <b>PITCHSIDE</b>
                </div>
                <div className="rv-front">
                  <PlayerCard p={p} foot={req.foot?.(p)} />
                </div>
              </div>
              <i className="rv-burst" aria-hidden="true" />
            </div>
          ))}
        </div>
        <div className="rv-foot">
          {phase === 2
            ? <button ref={closeBtn} className="primary big" onClick={e => { e.stopPropagation(); onClose() }}><Icon name="check" size={18} /> {t('continue')}</button>
            : <span className="muted rv-skip"><Icon name="skip" size={14} /> {t('rv.skip')}</span>}
        </div>
        </div>
      </div>
    </Portal>
  )
}

/** True the first time a card grid is shown (per key), so it can flip its cards in once (class "flipin"). */
export function useFlipIn(key: string, active = true): boolean {
  const [fresh] = useState(() => {
    if (!active || prefersReducedMotion()) return false
    try { if (localStorage.getItem(key)) return false; localStorage.setItem(key, '1') } catch { return false }
    return true
  })
  return fresh
}
