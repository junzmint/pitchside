import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon, Portal, type IconName } from '../../ui'
import { useI18n } from '../../i18n'

// First-run tour: five coach marks over the HUD, the menu, the inbox, tactics and finance.
// Seen once per browser (localStorage); Settings → Help can replay it with startTour().

const KEY = 'pitchside.tour.v1'
const EVT = 'pitchside:tour'

interface Step { key: string; sel: string; icon: IconName; ping?: string }
const STEPS: Step[] = [
  { key: 'hud', sel: '.hud', icon: 'playNow', ping: '[data-tour="play"]' },
  { key: 'menu', sel: '.rail .tabs', icon: 'menu' },
  { key: 'inbox', sel: '.rail .tabs [data-grp="inbox"]', icon: 'inbox' },
  { key: 'team', sel: '.rail .tabs [data-grp="team"]', icon: 'tactics' },
  { key: 'club', sel: '.rail .tabs [data-grp="club"]', icon: 'finance' },
]

let hosts = 0
/** True while a career is open (the tour has something to point at). */
export function tourAvailable() { return hosts > 0 }
/** Replay the tour from the first step. */
export function startTour() { window.dispatchEvent(new Event(EVT)) }
function seen() { try { return localStorage.getItem(KEY) === 'done' } catch { return true } }
function markSeen() { try { localStorage.setItem(KEY, 'done') } catch { /* storage unavailable: it shows again next time */ } }

type Box = { left: number; top: number; width: number; height: number }
const boxOf = (el: Element | null): Box | null => {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return r.width || r.height ? { left: r.left, top: r.top, width: r.width, height: r.height } : null
}

/** Mount in the game shell. `ready`: the shell is idle (no live match, career open). */
export function Tour({ ready }: { ready: boolean }) {
  const { t, lang } = useI18n()
  const [step, setStep] = useState(-1)
  const [box, setBox] = useState<Box | null>(null)
  const [ping, setPing] = useState<Box | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number; place: string; ax: number; ay: number } | null>(null)
  const card = useRef<HTMLDivElement>(null)
  const nextBtn = useRef<HTMLButtonElement>(null)

  useEffect(() => { hosts++; return () => { hosts-- } }, [])
  // first run: start once nothing else is on screen (no dialog, celebration, reveal or match)
  useEffect(() => {
    if (!ready || seen()) return
    let tries = 0
    const id = window.setInterval(() => {
      if (document.querySelector('.modal, .busy, .reveal, .matchwrap')) { if (++tries > 200) window.clearInterval(id); return }
      window.clearInterval(id)
      setStep(0)
    }, 900)
    return () => window.clearInterval(id)
  }, [ready])
  useEffect(() => {
    const go = () => setStep(0)
    window.addEventListener(EVT, go)
    return () => window.removeEventListener(EVT, go)
  }, [])

  const end = () => { markSeen(); setStep(-1); setBox(null); setPos(null) }
  const next = () => (step >= STEPS.length - 1 ? end() : setStep(step + 1))
  const back = () => setStep(Math.max(0, step - 1))

  // follow the highlighted element (scrolling, resizing, the menu folding on phones)
  useLayoutEffect(() => {
    if (step < 0) return
    const s = STEPS[step]
    const el = document.querySelector(s.sel)
    if (!el) { next(); return }
    const r0 = el.getBoundingClientRect()
    if (r0.top < 0 || r0.bottom > window.innerHeight) el.scrollIntoView({ block: window.innerWidth < 900 ? 'center' : 'nearest', behavior: 'auto' })
    const measure = () => { setBox(boxOf(el)); setPing(s.ping ? boxOf(document.querySelector(s.ping)) : null) }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => { window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); ro.disconnect() }
  }, [step])

  // place the card beside the highlight (right of the menu, under the HUD; a bottom sheet on phones)
  useLayoutEffect(() => {
    if (!box || !card.current) return
    const vw = window.innerWidth, vh = window.innerHeight
    const cw = card.current.offsetWidth, ch = card.current.offsetHeight
    const m = 16
    const cx = box.left + box.width / 2, cy = box.top + box.height / 2
    let place: string, left: number, top: number
    if (vw < 700) { place = 'sheet'; left = 12; top = vh - ch - 12 }
    else if (box.left + box.width + m + cw < vw - 8) { place = 'right'; left = box.left + box.width + m; top = cy - ch / 2 }
    else if (box.top + box.height + m + ch < vh - 8) { place = 'bottom'; left = cx - cw / 2; top = box.top + box.height + m }
    else { place = 'top'; left = cx - cw / 2; top = box.top - m - ch }
    left = Math.max(8, Math.min(left, vw - cw - 8))
    top = Math.max(8, Math.min(top, vh - ch - 8))
    setPos({ left, top, place, ax: Math.max(18, Math.min(cw - 18, cx - left)), ay: Math.max(18, Math.min(ch - 18, cy - top)) })
  }, [box, step, lang])

  useEffect(() => { if (step >= 0) nextBtn.current?.focus({ preventScroll: true }) }, [step, pos?.place])
  useEffect(() => {
    if (step < 0) return
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); end() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); next() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); back() }
    }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  })

  if (step < 0) return null
  const s = STEPS[step]
  const last = step === STEPS.length - 1
  const pad = 6
  return (
    <Portal>
      <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
        <div className="tour-block" onClick={e => e.stopPropagation()} />
        {box && <div className="tour-spot" style={{ left: box.left - pad, top: box.top - pad, width: box.width + pad * 2, height: box.height + pad * 2 }} />}
        {ping && <div className="tour-ping" style={{ left: ping.left - 4, top: ping.top - 4, width: ping.width + 8, height: ping.height + 8 }} />}
        <div ref={card} className={'tour-card ' + (pos?.place ?? 'measure')} key={step}
          style={pos ? { left: pos.left, top: pos.top, ['--ax' as string]: pos.ax + 'px', ['--ay' as string]: pos.ay + 'px' } as React.CSSProperties : undefined}>
          <div className="tour-head">
            <span className="tour-ico"><Icon name={s.icon} size={22} /></span>
            <span className="eyebrow">{t('tour.step', { n: step + 1, m: STEPS.length })}</span>
          </div>
          <h3 id="tour-title">{t('tour.' + s.key + '.t')}</h3>
          <p>{t('tour.' + s.key + '.b', { sw: t('tac.autoXi') })}</p>
          <div className="tour-dots" aria-hidden="true">{STEPS.map((x, i) => <i key={x.key} className={i === step ? 'on' : i < step ? 'done' : ''} />)}</div>
          <div className="tour-actions">
            <button className="link" onClick={end}>{t('tour.skip')}</button>
            <span className="row" style={{ gap: 6 }}>
              {step > 0 && <button onClick={back}><Icon name="prev" size={16} /> {t('tour.back')}</button>}
              <button ref={nextBtn} className="primary" data-sfx={last ? 'levelup' : undefined} onClick={next}>{last ? t('tour.done') : t('tour.next')} <Icon name={last ? 'playNow' : 'next'} size={16} /></button>
            </span>
          </div>
        </div>
      </div>
    </Portal>
  )
}
