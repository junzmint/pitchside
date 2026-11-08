// Development rotation (backend devRotate): before each match the bench players who have waited longest for a
// game start in place of the most tired starter of their line, so the whole squad plays and improves. The
// level is set here; the changes for the next match come with the career state (CareerState.rotated, why 'dev').
// Strings: strings_bench.ts.
import { useState } from 'react'
import type { Ctx } from '../App'
import { api } from '../api'
import { errText, useI18n } from '../i18n'
import { Hint, Icon, Seg } from '../ui'

type Level = '0' | '1' | '2' | '3'
const LEVELS: Level[] = ['0', '1', '2', '3']

export function DevRotation({ ctx }: { ctx: Ctx }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const level = String(ctx.st.career.care?.develop ?? 0) as Level
  const today = ctx.st.rotated ?? []
  const dev = today.filter(x => x.why === 'dev')
  const tired = today.filter(x => x.why !== 'dev')
  async function set(v: Level) {
    if (busy || v === level) return
    setBusy(true)
    try {
      await api.setDevelop(ctx.id, Number(v))
      await ctx.reload()
      ctx.toast(t('dev.set', { level: t('dev.' + v) }))
    } catch (e) { ctx.toast(errText(t, e), true) } finally { setBusy(false) }
  }
  return (
    <section className={'panel stack devrot' + (level !== '0' ? ' on' : '')}>
      <div className="row spread">
        <b className="row" style={{ gap: 6 }}><Icon name="rotate" size={17} /> {t('dev.label')}</b>
        <Seg value={level} label={t('dev.label')} options={LEVELS.map(v => [v, t('dev.' + v)] as [Level, string])} onChange={set} />
      </div>
      <Hint text={t('dev.help')} />
      {(level !== '0' || tired.length > 0) && (
        <div className="devrot-next">
          <span className="muted">{t('dev.next')}</span>
          {level !== '0' && dev.length === 0 && <span className="muted"> {t('dev.nextNone')}</span>}
          <ul className="notes">
            {dev.map(x => <li key={'d' + x.out} className="good">↻ {t('dev.item', { in: x.in, out: x.out })}</li>)}
            {tired.map(x => <li key={'t' + x.out}>↻ {t('dev.itemFit', { in: x.in, out: x.out })}</li>)}
          </ul>
        </div>
      )}
    </section>
  )
}
