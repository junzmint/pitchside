import type { TFn } from '../../i18n'
import { STRINGS, type Lang } from '../../strings'
import type { LossNote, MedLine } from '../../api_medical'
import { injKey } from './kinds'

// Small shared pieces of the medical room.

/** t() with a singular form: key + '#1' when n is 1 and the language has one (English). */
export function tn(t: TFn, lang: string, key: string, n: number, params: Record<string, string | number> = {}) {
  const one = n === 1 && STRINGS[lang as Lang]?.[key + '#1'] !== undefined
  return t(one ? key + '#1' : key, { ...params, n })
}

/** A share as a percentage in the UI language (one decimal below 10%). */
export function pct(lang: string, p: number | undefined | null) {
  const v = Math.max(0, p ?? 0)
  return new Intl.NumberFormat(lang, { style: 'percent', maximumFractionDigits: v > 0 && v < 0.1 ? 1 : 0 }).format(v)
}

/** A number with one decimal in the UI language. */
export function dec(lang: string, v: number) {
  return new Intl.NumberFormat(lang, { maximumFractionDigits: 1, minimumFractionDigits: 0 }).format(v)
}

/** "Pace −3, Potential −2" */
export function lossText(t: TFn, loss?: LossNote[] | null) {
  return (loss ?? []).map(l => `${l.attr === 'potential' ? t('med.pot') : t('attr.' + l.attr)} −${l.n}`).join(', ')
}

/** One line of the medical report. */
export function lineText(t: TFn, lang: string, l: MedLine) {
  return tn(t, lang, 'med.l.' + l.key, l.n ?? 0, {
    name: l.name ?? '', kind: t(injKey(l.kind)), was: t(injKey(l.was)), treat: l.treat ? t('med.opt.' + l.treat) : '', loss: lossText(t, l.loss),
  })
}

/** Report lines that are bad news, good news or a decision. */
export function lineTone(key: string): 'bad' | 'good' | 'warn' | '' {
  if (['setback', 'misdiag', 'lasting', 'worn', 'prone', 'complication', 'scan_found', 'flu_spread', 'new'].includes(key)) return 'bad'
  if (['back', 'scan_ok', 'rest', 'ease', 'rehab', 'flu_home'].includes(key)) return 'good'
  if (['knock', 'flu', 'flu_train', 'play', 'carry', 'inject', 'auto'].includes(key)) return 'warn'
  return ''
}

/** The tier of an injury as a coloured chip. */
export function TierChip({ t, tier }: { t: TFn; tier: number }) {
  return <span className={'md-tier t' + tier}>{t('injt.' + tier)}</span>
}

/** A thin meter (0..1) coloured by how bad it is. */
export function Meter({ v, tone, tip }: { v: number; tone: 'good' | 'warn' | 'bad' | 'hot' | 'cyan'; tip?: string }) {
  return <span className={'md-meter ' + tone} data-tip={tip}><i style={{ width: Math.round(Math.max(0, Math.min(1, v)) * 100) + '%' }} /></span>
}

/** How worried to be about an injury risk compared with a fresh, sound player. */
export function riskLevel(risk: number, base: number): 0 | 1 | 2 | 3 {
  const x = base > 0 ? risk / base : 1
  if (x >= 3) return 3
  if (x >= 2) return 2
  if (x >= 1.35) return 1
  return 0
}
export const LEVEL_KEY = ['med.lvl.low', 'med.lvl.mid', 'med.lvl.high', 'med.lvl.vhigh']
export const LEVEL_TONE = ['good', 'warn', 'bad', 'hot'] as const

/** Body wear level (0–3) from the wear points. */
export function wearLevel(w: number): 0 | 1 | 2 | 3 {
  if (w >= 14) return 3
  if (w >= 10) return 2
  if (w >= 6) return 1
  return 0
}
