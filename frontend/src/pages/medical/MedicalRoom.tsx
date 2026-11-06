import { useCallback, useEffect, useRef, useState } from 'react'
import type { Ctx } from '../../App'
import { medBadge, medicalApi, type MedCard, type MedicalView, type MedReq } from '../../api_medical'
import { errText, useI18n } from '../../i18n'
import { Badge, Icon, Loading, PageHead, Pips, TabBar } from '../../ui'
import { DecisionCard } from './Cards'
import { TreatmentRoom } from './Room'
import { RiskBoard } from './Risk'
import { TeamPanel } from './Team'
import { FilesPanel } from './Files'
import { Handbook } from './Book'
import { plannedKind } from './kinds'
import { lineText, riskLevel, tn } from './parts'

type MedTab = 'room' | 'risk' | 'team' | 'files' | 'book'
const TAB_KEY = 'pitchside.medical.tab'

// The medical room (medical work stream): decisions waiting, the treatment room, the risk board,
// the medical team and centre, the case files and the injury handbook.
export default function MedicalRoom({ ctx }: { ctx: Ctx }) {
  const { t, lang } = useI18n()
  const [v, setV] = useState<MedicalView | null>(null)
  const [busy, setBusy] = useState(false)
  const [tab, setTabState] = useState<MedTab>(() => {
    try { const s = localStorage.getItem(TAB_KEY); if (s === 'room' || s === 'risk' || s === 'team' || s === 'files' || s === 'book') return s } catch { /* ignore */ }
    return 'room'
  })
  const setTab = (x: MedTab) => { setTabState(x); try { localStorage.setItem(TAB_KEY, x) } catch { /* ignore */ } }
  const st = ctx.st
  const key = `${st.career.id}:${st.career.season}:${st.career.day}:${medBadge(st)?.tick ?? 0}:${st.club.budget}:${st.club.medical}`
  const shown = useRef('')
  const load = useCallback(() => {
    medicalApi.get(ctx.id).then(x => { setV(x) }).catch(e => ctx.toast(errText(t, e), true))
  }, [ctx.id])
  useEffect(() => {
    if (shown.current === key) return
    shown.current = key
    load()
  }, [key, load])

  async function act(body: MedReq) {
    setBusy(true)
    try {
      const r = await medicalApi.act(ctx.id, body)
      setV(r.view)
      if (r.line) ctx.toast(lineText(t, lang, r.line), ['setback', 'misdiag', 'complication', 'scan_found', 'flu_spread'].includes(r.line.key))
      await ctx.reload()
    } catch (e) { ctx.toast(errText(t, e), true) } finally { setBusy(false) }
  }
  const pick = (cd: MedCard, choice: string) => act({ action: 'card', id: cd.id, choice })

  if (!v) return <><PageHead icon="injury" eyebrow={t('med.eyebrow', { n: st.career.season })} title={t('tab.medical')} /><Loading text={t('med.loading')} /></>

  const hurt = v.injured.filter(x => !plannedKind(x.kind))
  const worried = v.squad.filter(x => riskLevel(x.risk, x.base) >= 2).length
  const mood = v.waiting > 0 ? 'alert' : hurt.length > 0 ? 'busy' : 'calm'
  const opp = v.next ? (v.next.homeId === st.club.id ? { name: v.next.away, short: v.next.awayShort, c1: v.next.awayColor, c2: v.next.awayColor2 } : { name: v.next.home, short: v.next.homeShort, c1: v.next.homeColor, c2: v.next.homeColor2 }) : null
  return (
    <div className="medroom">
      <PageHead icon="injury" eyebrow={t('med.eyebrow', { n: v.season })} title={t('tab.medical')}>
        <div className="row">
          <span className={'chip num' + (hurt.length ? ' md-chip-bad' : '')}><Icon name="injury" size={14} /> {hurt.length ? t('med.chip.out', { n: hurt.length }) : t('med.allFit')}</span>
          {v.waiting > 0 && <span className="chip md-chip-wait md-blink"><Icon name="hourglass" size={14} /> {t('med.chip.wait', { n: v.waiting })}</span>}
          <span className="chip" data-tip={t('med.chip.centre', { n: v.team.centre })}><Icon name="medical" size={14} /> <Pips n={v.team.centre} max={5} /></span>
        </div>
      </PageHead>

      <section className={'md-hero ' + mood}>
        <svg className="md-ecg" viewBox="0 0 600 60" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 32 H90 l8 -6 l8 6 H150 l6 -24 l8 46 l7 -32 l5 10 H260 l8 -6 l8 6 H320 l6 -24 l8 46 l7 -32 l5 10 H430 l8 -6 l8 6 H490 l6 -24 l8 46 l7 -32 l5 10 H600" />
        </svg>
        <div className="md-hero-row">
          <div className={'md-hero-stat' + (hurt.length ? ' bad' : '')}><b className="num">{hurt.length}</b><span>{t('med.hero.out')}</span></div>
          <div className={'md-hero-stat' + (v.waiting ? ' wait' : '')}><b className="num">{v.waiting}</b><span>{t('med.hero.wait')}</span></div>
          <div className={'md-hero-stat' + (worried ? ' warn' : '')}><b className="num">{worried}</b><span>{t('med.hero.risky')}</span></div>
          <div className="md-hero-next">
            {opp ? <><Badge short={opp.short} color={opp.c1} color2={opp.c2} size={36} /><span>{t('med.next', { name: opp.name })}</span></>
              : <span className="muted">{t('med.offseason')}</span>}
          </div>
        </div>
      </section>

      {v.cards.length > 0 && (
        <section className="md-cards">
          {v.cards.map(cd => <DecisionCard key={cd.id} cd={cd} v={v} busy={busy} onPick={pick} />)}
        </section>
      )}

      <TabBar value={tab} onChange={setTab} label={t('tab.medical')} options={[
        ['room', 'injury', t('med.tab.room'), tn(t, lang, 'med.tab.room.s', v.injured.length)],
        ['risk', 'warn', t('med.tab.risk'), t('med.tab.risk.s')],
        ['team', 'physio', t('med.tab.team'), t('med.tab.team.s')],
        ['files', 'history2', t('med.tab.files'), t('med.tab.files.s')],
        ['book', 'board', t('med.tab.book'), t('med.tab.book.s')],
      ]} />

      <div className="md-pane" key={tab}>
        {tab === 'room' && <TreatmentRoom v={v} busy={busy} onInject={id => act({ action: 'inject', playerId: id })} onElite={id => act({ action: 'elite', playerId: id })} />}
        {tab === 'risk' && <RiskBoard v={v} />}
        {tab === 'team' && <TeamPanel ctx={ctx} team={v.team} onChange={load} />}
        {tab === 'files' && <FilesPanel v={v} />}
        {tab === 'book' && <Handbook v={v} />}
      </div>

      <details className="panel md-rules">
        <summary><Icon name="help" size={16} /> {t('med.rules.t')}</summary>
        <ul>{[1, 2, 3, 4, 5, 6, 7].map(i => <li key={i}>{t('med.rules.' + i)}</li>)}</ul>
      </details>
    </div>
  )
}
