import { useEffect, useRef, useState } from 'react'
import type { Engine, HudState, HumanActs } from './engine'
import type { Glyphs } from './frame'
import { glyphParams } from './controls'
import { touchParams } from './touch'
import { useI18n } from '../i18n'

// First-match tutorial: six small steps, each waiting for the action before moving on. It sits at the top of the
// pitch while the match plays as usual (a career result counts: the other side doesn't ease off), can be skipped,
// and comes back from the pause menu. "Seen" is remembered in localStorage.

const KEY = 'pitchside.tutorial'
export function tutorialSeen(): boolean { try { return localStorage.getItem(KEY) === 'done' } catch { return false } }
export function markTutorialSeen() { try { localStorage.setItem(KEY, 'done') } catch { /* storage unavailable */ } }

interface Step { k: string; act: keyof HumanActs; need: number; ctx: 'any' | 'att' | 'def' }
const STEPS: Step[] = [
  { k: 'move', act: 'moved', need: 14, ctx: 'any' },
  { k: 'pass', act: 'passes', need: 1, ctx: 'att' },
  { k: 'through', act: 'through', need: 1, ctx: 'att' },
  { k: 'shoot', act: 'shots', need: 1, ctx: 'att' },
  { k: 'tackle', act: 'tackles', need: 1, ctx: 'def' },
  { k: 'switch', act: 'switches', need: 1, ctx: 'def' },
]

export function Tutorial({ eng, hud, g, onClose }: { eng: Engine; hud: HudState; g: Glyphs; onClose: () => void }) {
  const { t } = useI18n()
  const [i, setI] = useState(0)
  const [state, setState] = useState<'do' | 'good' | 'done'>('do')
  const base = useRef(eng.acts[STEPS[0].act])
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const step = STEPS[Math.min(i, STEPS.length - 1)]
  const progress = Math.max(0, eng.acts[step.act] - base.current)
  // the step is done: say so, then (separately, so the timer survives the state change) move on
  useEffect(() => { if (state === 'do' && progress >= step.need) setState('good') }, [progress, state, i])
  useEffect(() => {
    if (state !== 'good') return
    const tm = window.setTimeout(() => {
      if (i + 1 >= STEPS.length) { setState('done'); return }
      base.current = eng.acts[STEPS[i + 1].act]
      setI(i + 1)
      setState('do')
    }, 1300)
    return () => window.clearTimeout(tm)
  }, [state, i])
  useEffect(() => {
    if (state !== 'done') return
    const tm = window.setTimeout(() => closeRef.current(), 2600)
    return () => window.clearTimeout(tm)
  }, [state])
  const ctxNow = hud.sides[0].ctx
  const def = step.ctx === 'def'
  const waiting = state === 'do' && ((step.ctx === 'att' && ctxNow !== 'att') || (step.ctx === 'def' && ctxNow !== 'def'))
  return (
    <div className={'lv-tut' + (state === 'good' ? ' good' : '') + (state === 'done' ? ' done' : '')} role="status" aria-live="polite">
      <div className="lv-tut-head">
        <span className="lv-tut-n">{t('lv.tut.title', { i: Math.min(i + 1, STEPS.length), n: STEPS.length })}</span>
        <span className="lv-tut-dots">{STEPS.map((_, k) => <i key={k} className={k < i || (k === i && state !== 'do') ? 'on' : k === i ? 'cur' : ''} />)}</span>
        <button onClick={() => closeRef.current()}>{t('lv.tut.skip')}</button>
      </div>
      {state === 'done' ? <b className="lv-tut-text">{t('lv.tut.done')}</b> : (
        <>
          <b className="lv-tut-step">{state === 'good' ? `✓ ${t('lv.tut.good')}` : t('lv.tut.' + step.k + '.t')}</b>
          <span className="lv-tut-text">{t('lv.tut.' + step.k, g === 'touch' ? touchParams(t, def) : glyphParams(g, def))}</span>
          {waiting && <small className="lv-tut-wait">{t(step.ctx === 'att' ? 'lv.tut.waitAtt' : 'lv.tut.waitDef')}</small>}
        </>
      )}
    </div>
  )
}
