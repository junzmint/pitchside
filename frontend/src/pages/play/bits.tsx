import { useMemo } from 'react'
import type { Glyphs } from '../../match/frame'
import { ROWS, glyph, type CtlGroup } from '../../match/controls'
import { qrMatrix } from '../../lan/qr'
import { Badge } from '../../ui'
import { useI18n, type TFn } from '../../i18n'

// Small pieces shared by the play-mode screens.

/** Input device of a player: a keyboard, a PlayStation or Xbox pad, or the on-screen touch pad. */
export type Device = Glyphs | 'touch'

/** Touch-pad button names for a pad button (the touch pad labels buttons by what they do when attacking). */
const TOUCH_ATT: Record<string, string> = { A: 'pass', B: 'shoot', Y: 'through', X: 'lob', RT: 'sprint', LS: 'stick', RS: 'skill', START: 'pause' }
const TOUCH_DEF: Record<string, string> = { LB: 'pass', B: 'shoot', X: 'through', RB: 'lob', RT: 'sprint', LS: 'stick', START: 'pause' }

/** A button expression ("LB+A", "B") in the words or glyphs of a device. */
export function devGlyph(t: TFn, expr: string, d: Device, def = false): string {
  if (d !== 'touch') return glyph(expr, d, def)
  const map = def ? TOUCH_DEF : TOUCH_ATT
  return expr.replace(/\b(LB|RB|LT|RT|LS|RS|START|SELECT|UD|LR|A|B|X|Y)\b/g, m => (map[m] ? t('pl.tp.' + map[m]) : m))
}

/** Prompt parameters ({A}, {B} …) for the strings lv.p.* in a device's words. */
export function devParams(t: TFn, d: Device, def = false): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'START', 'LS', 'RS', 'UD', 'LR']) out[k] = devGlyph(t, k, d, def)
  return out
}

/** Rows of "button → what it does" for a control group (the same lists as the live match HUD). */
export function KeyRows({ group, d, max, only }: { group: CtlGroup; d: Device; max?: number; only?: string[] }) {
  const { t } = useI18n()
  let rows = ROWS[group]
  if (only) rows = rows.filter(r => only.includes(r.k))
  rows = rows.slice(0, max ?? 99)
  const def = group === 'def'
  return <>{rows.map(r => <span key={r.k} className="lv-row"><b>{devGlyph(t, r.b, d, def)}</b><span>{t('lv.k.' + r.k)}</span></span>)}</>
}

export function WifiIcon({ size = 18 }: { size?: number }) {
  return (
    <span className="ico" aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 8.8a15 15 0 0 1 20 0" /><path d="M5.2 12.4a10.5 10.5 0 0 1 13.6 0" /><path d="M8.6 15.9a5.6 5.6 0 0 1 6.8 0" /><circle cx="12" cy="19.4" r="1.2" fill="currentColor" />
      </svg>
    </span>
  )
}

/** A QR code as an SVG (dark modules on a white card with the quiet zone). */
export function QrCode({ text, size = 168, label }: { text: string; size?: number; label?: string }) {
  const m = useMemo(() => { try { return qrMatrix(text) } catch { return null } }, [text])
  if (!m) return null
  const n = m.length + 8
  let d = ''
  m.forEach((row, y) => row.forEach((dark, x) => { if (dark) d += `M${x + 4} ${y + 4}h1v1h-1z` }))
  return (
    <svg className="pl-qr" width={size} height={size} viewBox={`0 0 ${n} ${n}`} role="img" aria-label={label ?? text} shapeRendering="crispEdges">
      <rect width={n} height={n} fill="#fff" />
      <path d={d} fill="#0b1118" />
    </svg>
  )
}

/** Crest + name of a team, for lobby cards. */
export function TeamTag({ name, short, color, color2, size = 44, sub }: { name: string; short: string; color: string; color2: string; size?: number; sub?: string }) {
  return (
    <span className="pl-team">
      <Badge short={short} color={color} color2={color2} size={size} />
      <span><b>{name}</b>{sub && <small className="muted">{sub}</small>}</span>
    </span>
  )
}

// ---------------------------------------------------------------- local quick-match record

export type QuickMode = 'cpu' | 'duo' | 'lan'
export interface QuickResult { home: string; away: string; hs: number; as: number; pens?: [number, number] | null; mode: QuickMode; at: number }
export interface QuickRecord { w: number; d: number; l: number; p1: number; p2: number; draws2: number; last: QuickResult[] }

const REC_KEY = 'pitchside.quick.record'

export function loadRecord(): QuickRecord {
  const empty: QuickRecord = { w: 0, d: 0, l: 0, p1: 0, p2: 0, draws2: 0, last: [] }
  try {
    const raw = localStorage.getItem(REC_KEY)
    if (!raw) return empty
    const r = JSON.parse(raw) as Partial<QuickRecord>
    return { ...empty, ...r, last: Array.isArray(r.last) ? r.last.slice(0, 12) : [] }
  } catch { return empty }
}

/** Who won: 1 = player 1 (home side), 2 = the other side, 0 = a draw (a shoot-out decides it). */
export function winnerOf(r: Pick<QuickResult, 'hs' | 'as' | 'pens'>): 0 | 1 | 2 {
  if (r.hs !== r.as) return r.hs > r.as ? 1 : 2
  if (r.pens && r.pens[0] !== r.pens[1]) return r.pens[0] > r.pens[1] ? 1 : 2
  return 0
}

export function addResult(res: QuickResult): QuickRecord {
  const r = loadRecord()
  const w = winnerOf(res)
  if (res.mode === 'cpu') { if (w === 1) r.w++; else if (w === 2) r.l++; else r.d++ }
  else { if (w === 1) r.p1++; else if (w === 2) r.p2++; else r.draws2++ }
  r.last = [res, ...r.last].slice(0, 12)
  try { localStorage.setItem(REC_KEY, JSON.stringify(r)) } catch { /* storage unavailable */ }
  return r
}
