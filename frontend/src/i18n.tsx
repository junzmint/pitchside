import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { STRINGS, type Lang } from './strings'

export type TFn = (key: string, params?: Record<string, string | number>) => string

interface I18n { lang: Lang; setLang: (l: Lang) => void; t: TFn }

const Ctx = createContext<I18n | null>(null)
const KEY = 'pitchside.lang'

function initial(): Lang {
  try {
    const s = localStorage.getItem(KEY)
    if (s === 'vi' || s === 'en' || s === 'ja') return s
  } catch { /* ignore */ }
  const nav = navigator.language?.toLowerCase() ?? ''
  return nav.startsWith('vi') ? 'vi' : nav.startsWith('ja') ? 'ja' : 'en'
}

export function makeT(lang: Lang): TFn {
  return (key, params) => {
    let s = STRINGS[lang][key] ?? STRINGS.en[key] ?? key
    // a "zero" wording when one exists ("còn 0 ngày" reads "hạn chót hôm nay"): key + '#0'
    if (params?.n === 0 && STRINGS[lang][key + '#0']) s = STRINGS[lang][key + '#0']
    if (params) for (const k in params) s = s.split(`{${k}}`).join(String(params[k]))
    return s
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial)
  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    try { localStorage.setItem(KEY, l) } catch { /* ignore */ }
  }, [])
  useEffect(() => { document.documentElement.lang = lang }, [lang])
  const value = useMemo(() => ({ lang, setLang, t: makeT(lang) }), [lang, setLang])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useI18n() {
  const v = useContext(Ctx)
  if (!v) throw new Error('I18nProvider missing')
  return v
}

/** Translate an API error by its code, falling back to the server message. */
export function errText(t: TFn, e: unknown): string {
  const code = (e as { code?: string })?.code
  if (code) {
    const k = 'err.' + code
    const s = t(k)
    if (s !== k) return s
  }
  return (e as Error)?.message ?? String(e)
}

export function LangSwitch({ className }: { className?: string }) {
  const { lang, setLang } = useI18n()
  return (
    <div className={'seg ' + (className ?? '')} role="group" aria-label="Language">
      <button aria-pressed={lang === 'vi'} onClick={() => setLang('vi')}>VI</button>
      <button aria-pressed={lang === 'en'} onClick={() => setLang('en')}>EN</button>
      <button aria-pressed={lang === 'ja'} onClick={() => setLang('ja')}>JA</button>
    </div>
  )
}
