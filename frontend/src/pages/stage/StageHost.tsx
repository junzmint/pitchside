import { useEffect, useMemo, useState } from 'react'
import type { Ctx } from '../../App'
import { openStage, STAGE_SEEN_EVENT, stageApi, type StagePending } from '../../api_stage'
import { Ceremony } from './Ceremony'
import { DrawReveal } from './DrawReveal'
import { IntlPopup } from './IntlPopup'

type Kind = 'ceremony' | 'tournament' | 'draw'
const GONE_KEY = 'pitchside.stageSeen'

function loadGone(): string[] {
  try { return JSON.parse(sessionStorage.getItem(GONE_KEY) ?? '[]') as string[] } catch { return [] }
}
function saveGone(v: string[]) {
  try { sessionStorage.setItem(GONE_KEY, JSON.stringify(v.slice(-40))) } catch { /* ignore */ }
}

/**
 * The world stage's pop-ups, one at a time and only on a quiet screen (no other dialog, match report
 * or busy overlay): Golden Ball night after the last matchday, the summer tournament when a new
 * season starts, and cup draws. Mounted once in App.tsx.
 */
export function StageHost({ ctx }: { ctx: Ctx }) {
  const { id } = ctx
  const { day, season } = ctx.st.career
  const [p, setP] = useState<StagePending | null>(null)
  const [open, setOpen] = useState<Kind | null>(null)
  const [gone, setGone] = useState<string[]>(loadGone)

  const load = () => stageApi.pending(id).then(setP).catch(() => { /* the pop-ups can wait */ })
  useEffect(() => { setP(null); load() }, [id, day, season])

  const key = (k: Kind, ref: number) => `${id}:${k}:${ref}`
  const want = useMemo<Kind | null>(() => {
    if (!p) return null
    if (p.ceremony && !gone.includes(key('ceremony', p.ceremony.season))) return 'ceremony'
    if (p.tournament && !gone.includes(key('tournament', p.tournament.season))) return 'tournament'
    if (p.draw && !gone.includes(key('draw', p.draw.id))) return 'draw'
    return null
  }, [p, gone, id])

  // wait for a quiet screen
  useEffect(() => {
    if (!want || open) return
    const check = () => {
      if (document.querySelector('.modal, .matchwrap, .mcanvas, .busy, .tour, .reveal')) return
      setOpen(want)
    }
    const first = window.setTimeout(check, 350)
    const timer = window.setInterval(check, 800)
    return () => { window.clearTimeout(first); window.clearInterval(timer) }
  }, [want, open])

  function done(k: Kind, ref: number, then?: () => void) {
    setGone(g => { const n = [...g, key(k, ref)]; saveGone(n); return n })
    setOpen(null)
    stageApi.ack(id, k, ref).then(() => { window.dispatchEvent(new Event(STAGE_SEEN_EVENT)); return load() }).catch(() => { /* a read-only career: dismissed here */ })
    then?.()
  }

  if (!p || !open) return null
  if (open === 'ceremony' && p.ceremony) {
    const s = p.ceremony.season
    return <Ceremony night={p.ceremony} onClose={() => done('ceremony', s)} onHistory={() => done('ceremony', s, () => openStage(ctx.go, 'awards'))} />
  }
  if (open === 'tournament' && p.tournament) {
    const s = p.tournament.season
    return <IntlPopup tour={p.tournament} onClose={() => done('tournament', s)} onOpen={() => done('tournament', s, () => openStage(ctx.go, 'intl'))} />
  }
  if (open === 'draw' && p.draw) {
    const d = p.draw
    return <DrawReveal d={d} day={day} onClose={() => done('draw', d.id)} />
  }
  return null
}

export default StageHost
