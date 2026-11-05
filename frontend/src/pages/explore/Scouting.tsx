import { useEffect, useMemo, useRef, useState } from 'react'
import { api, money } from '../../api'
import { exploreApi, type Find } from '../../api_explore'
import type { DealQuote } from '../../types'
import { ConfirmButton, Hint, Ovr, PosTag, TraitChips } from '../../ui'
import { errText, useI18n } from '../../i18n'
import type { XCtx } from '../Explore'
import { MAP_POS, flag } from './common'
import { mergeText } from '../../LegendBits'

const POSES = ['', 'GK', 'DF', 'MF', 'FW'] as const

export default function Scouting({ ctx, x, refresh }: XCtx) {
  const { t } = useI18n()
  const home = x.regions.find(r => r.home)?.code ?? x.regions[0]?.code
  const [sel, setSel] = useState<string>(home)
  const [pos, setPos] = useState<string>('')
  const [focus, setFocus] = useState<string>('any')
  const [scout, setScout] = useState<number>(0)
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState<'all' | 'star'>('all')
  const [deal, setDeal] = useState<Find | null>(null)
  // reports that were unread when the page opened keep their "new" glow for this visit
  const fresh = useRef<Set<number>>(new Set(x.missions.filter(m => m.left <= 0 && !m.seen).map(m => m.id)))
  useEffect(() => {
    if (x.missions.some(m => m.left <= 0 && !m.seen)) exploreApi.seen(ctx.id).then(() => ctx.reload()).catch(() => {})
  }, [x.missions])

  const region = x.regions.find(r => r.code === sel)
  const free = x.scouts.filter(s => !s.busy)
  const scoutId = free.some(s => s.id === scout) ? scout : free[0]?.id ?? 0
  const outIn = useMemo(() => new Set(x.missions.filter(m => m.left > 0).map(m => m.region)), [x.missions])

  async function send() {
    if (!region) return
    setBusy(true)
    try {
      await exploreApi.mission(ctx.id, { region: region.code, pos, focus, scoutId })
      ctx.toast(t('ex.started', { r: t('ex.rg.' + region.code) }))
      await refresh()
    } catch (e) { ctx.toast(errText(t, e), true) } finally { setBusy(false) }
  }
  async function star(f: Find) {
    try { await exploreApi.star(ctx.id, f.playerId); await refresh(false) } catch (e) { ctx.toast(errText(t, e), true) }
  }
  async function sign(f: Find) {
    try {
      const r = await ctx.run(t('wait'), () => api.buy(ctx.id, f.playerId))
      // legend versions: a card that merged with his modern self says so
      ctx.toast(r?.merged ? mergeText(t, r.merged) : t('deal.accepted', { name: f.name }))
      await refresh()
    } catch (e) { ctx.toast(errText(t, e), true) }
  }

  // the server sends only the reports on show: signed players and faded reports are gone already
  const finds = x.finds.filter(f => filter === 'all' || f.star)
  const days = x.findDays || 5
  const out = x.missions.filter(m => m.left > 0)
  const back = x.missions.filter(m => m.left <= 0).slice().reverse()

  return (
    <>
      <div className="ex-scoutgrid">
        <section className="panel ex-mappanel">
          <h3>{t('ex.map')}</h3>
          <div className="ex-map" role="listbox" aria-label={t('ex.map')}>
            <svg className="ex-land" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <path d="M6 22 C14 12 28 14 30 24 C32 34 26 44 18 46 C10 46 4 34 6 22 Z" />
              <path d="M26 54 C34 52 40 60 38 72 C36 86 30 96 26 94 C22 86 22 64 26 54 Z" />
              <path d="M40 18 C48 8 62 10 70 16 C78 24 76 40 66 46 C56 50 44 48 40 40 C38 32 38 24 40 18 Z" />
              <path d="M44 50 C52 48 60 54 58 66 C56 80 50 84 46 78 C42 70 42 58 44 50 Z" />
              <path d="M70 18 C82 14 96 20 96 32 C96 44 86 50 76 46 C70 40 68 26 70 18 Z" />
            </svg>
            {x.regions.map(r => {
              const p = MAP_POS[r.code] ?? [50, 50]
              const lvl = Math.min(5, r.visits)
              return (
                <button key={r.code} role="option" aria-selected={sel === r.code} className={'ex-pin' + (sel === r.code ? ' on' : '') + (r.home ? ' home' : '') + (r.visits ? ' seen' : ' fog') + (outIn.has(r.code) ? ' out' : '')}
                  style={{ left: p[0] + '%', top: p[1] + '%' }} onClick={() => setSel(r.code)} data-tip={`${t('ex.rg.' + r.code)} · ${r.name}\n${t('ex.visits', { n: r.visits })} · ${t('ex.findsN', { n: r.finds })}`}>
                  <span className="ex-flag">{flag(r.code)}</span>
                  <span className="ex-lvl" aria-hidden="true">{'★'.repeat(lvl)}{'☆'.repeat(5 - lvl)}</span>
                </button>
              )
            })}
          </div>
          <Hint text={t('ex.mapHint')} />
        </section>

        <section className="panel stack ex-launch">
          <h3>{t('ex.launch')}</h3>
          {region && (
            <div className="ex-regionhead">
              <span className="ex-bigflag">{flag(region.code)}</span>
              <div className="stack" style={{ gap: 2 }}>
                <b>{t('ex.rg.' + region.code)}{region.home && <span className="chip">{t('ex.home')}</span>}</b>
                <span className="muted small">{region.name} · {t('ex.clubsN', { n: region.clubs })}</span>
                <span className="small">⏱ {t('ex.days', { n: region.days })} · 💶 {money(region.cost)}</span>
              </div>
            </div>
          )}
          <div className="field">
            <label htmlFor="ex-scout">{t('ex.scout')}</label>
            <select id="ex-scout" value={scoutId} onChange={e => setScout(Number(e.target.value))}>
              {x.scouts.map(s => (
                <option key={s.id} value={s.id} disabled={s.busy}>
                  {s.id === -1 ? t('ex.self') : s.name} · {t('ex.skill', { n: s.skill })}{s.eye ? ' · ' + t('ex.eye') : ''}{s.busy ? ` (${t('ex.busy')})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="ex-pos">{t('ex.pos')}</label>
            <select id="ex-pos" value={pos} onChange={e => setPos(e.target.value)}>
              {POSES.map(p => <option key={p} value={p}>{p ? t('posL.' + p) : t('ex.anyPos')}</option>)}
            </select>
          </div>
          <div className="ex-focus" role="radiogroup" aria-label={t('ex.focus')}>
            {x.focus.map(f => (
              <button key={f} role="radio" aria-checked={focus === f} className={focus === f ? 'on' : ''} onClick={() => setFocus(f)}>
                <b>{t('ex.focus.' + f)}</b><span className="muted small">{t('ex.focus.' + f + '.d')}</span>
              </button>
            ))}
          </div>
          <button className="primary ex-send" disabled={busy || !region || free.length === 0 || x.budget < (region?.cost ?? 0)} onClick={send}>
            🧭 {free.length === 0 ? t('err.scouts_busy') : t('ex.send', { v: money(region?.cost ?? 0) })}
          </button>
          <Hint text={t('ex.sendHint')} />
        </section>
      </div>

      <section className="panel">
        <h3>{t('ex.missions')}</h3>
        {x.missions.length === 0 && <p className="muted" style={{ margin: 0 }}>{t('ex.noMissions')}</p>}
        <div className="ex-missions">
          {out.map(m => (
            <div key={m.id} className="ex-mission out">
              <span className="ex-bigflag">{flag(m.region)}</span>
              <div className="stack" style={{ gap: 4, flex: 1 }}>
                <b>{t('ex.out', { r: t('ex.rg.' + m.region), n: m.left })}</b>
                <span className="muted small">{m.scoutId === -1 ? t('ex.self') : m.scout} · {t('ex.focus.' + m.focus)}{m.pos ? ' · ' + t('posL.' + m.pos) : ''}</span>
                <div className="ex-trip"><i style={{ width: `${Math.round(100 * (m.days - m.left) / Math.max(1, m.days))}%` }} /></div>
              </div>
            </div>
          ))}
          {back.map(m => (
            <div key={m.id} className={'ex-mission back r-' + (m.best || 'common') + (fresh.current.has(m.id) ? ' fresh' : '')}>
              <span className="ex-bigflag">{flag(m.region)}</span>
              <div className="stack" style={{ gap: 2, flex: 1 }}>
                <b>{t('ex.back', { r: t('ex.rg.' + m.region), n: m.finds?.length ?? 0 })}</b>
                <span className="muted small">{t('seasonN', { n: m.season })} · {m.scoutId === -1 ? t('ex.self') : m.scout} · {t('ex.focus.' + m.focus)}</span>
              </div>
              {m.best && <span className={'ex-rar r-' + m.best}>{t('ex.r.' + m.best)}</span>}
              {fresh.current.has(m.id) && <span className="ex-new">{t('ex.new')}</span>}
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>{t('ex.log')}</h3>
          <div className="seg" role="group">
            <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>{t('ex.all')} ({x.finds.length})</button>
            <button aria-pressed={filter === 'star'} onClick={() => setFilter('star')}>★ {t('ex.shortlist')} ({x.finds.filter(f => f.star).length})</button>
          </div>
        </div>
        <div style={{ marginBottom: 10 }}><Hint text={t('ex.logHint', { n: days })} /></div>
        {finds.length === 0 && <p className="muted" style={{ margin: 0 }}>{filter === 'star' ? t('ex.shortEmpty') : t('ex.logEmpty')}</p>}
        <div className="ex-finds">
          {finds.map((f, i) => <FindCard key={i + ':' + f.playerId} f={f} days={days} fresh={fresh.current.has(f.mission)} onStar={() => star(f)} onDeal={() => setDeal(f)} onSign={() => sign(f)} />)}
        </div>
      </section>

      {deal && <FindDeal xc={{ ctx, x, refresh }} f={deal} onClose={() => setDeal(null)} />}
    </>
  )
}

function FindCard({ f, days, fresh, onStar, onDeal, onSign }: { f: Find; days: number; fresh: boolean; onStar: () => void; onDeal: () => void; onSign: () => void }) {
  const { t } = useI18n()
  const p = f.player
  const rar = f.golden ? 'golden' : f.rarity
  const canBuy = f.status === 'club' || (f.status === 'free' && !!p)
  return (
    <article className={`ex-find r-${f.rarity}${f.golden ? ' golden' : ''}${fresh ? ' fresh' : ''}${f.status === 'gone' || f.status === 'retired' ? ' dim' : ''}`}>
      <header>
        <Ovr v={p?.overall ?? f.ovr} />
        <div className="stack" style={{ gap: 1, minWidth: 0, flex: 1 }}>
          <b className="ex-findname">{flag(f.nation)} {f.name}</b>
          <span className="muted small">
            <PosTag p={f.pos} role={p?.role || f.role} /> {t('ex.age', { n: p?.age ?? f.age })} · {t('ex.pot', { n: p?.potential ?? f.pot })}
          </span>
        </div>
        <button className={'ex-starbtn' + (f.star ? ' on' : '')} aria-pressed={f.star} aria-label={t('ex.star')} title={f.star ? t('ex.unstar') : t('ex.star')} onClick={onStar}>★</button>
      </header>
      <div className="ex-findtags">
        <span className={'ex-rar r-' + rar}>{t('ex.r.' + rar)}</span>
        {f.dev && <span className={'chip dev-' + f.dev}>{t('devc.' + f.dev)}</span>}
        {(f.tags ?? []).filter(g => g !== f.dev && g !== 'golden').map(g => <span key={g} className={'chip ex-tag tg-' + g}>{t('ex.tag.' + g)}</span>)}
      </div>
      {p && <TraitChips p={p} small />}
      <div className="ex-findfoot">
        <span className="small">{t('ex.st.' + f.status, { c: f.nowClub || f.club })}</span>
        {p && f.status === 'club' && <span className="small num">{t('ex.ask', { v: money(p.price || p.value) })} · <span className="muted">{t('ex.value', { v: money(p.value) })}</span></span>}
        <span className="muted tiny">{flag(f.region)} {t('ex.foundAt', { s: f.season, d: f.day })}</span>
      </div>
      {canBuy && (
        <div className="row" style={{ gap: 6 }}>
          {f.status === 'club' && <button className="primary small" onClick={onDeal}>{t('ex.offer')}</button>}
          {f.status === 'free' && p && <ConfirmButton className="primary small" label={t('ex.sign', { v: money(p.price || p.value) })} confirm={t('confirm')} onConfirm={onSign} />}
        </div>
      )}
      {!f.star && f.left > 0 && <FadeStrip left={f.left} total={days} onKeep={f.status === 'gone' || f.status === 'retired' ? undefined : onStar} />}
    </article>
  )
}

/** The countdown on a report that is not on the shortlist: when the pips run out, it leaves the log.
 *  onKeep: the shortlist button (none for a player who retired or was lost track of). */
function FadeStrip({ left, total, onKeep }: { left: number; total: number; onKeep?: () => void }) {
  const { t } = useI18n()
  const last = left <= 1
  const tone = last ? 'var(--warn)' : 'var(--cyan)'
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 10px', paddingTop: 8, borderTop: '1px dashed var(--line)' }}>
      <div style={{ display: 'grid', gap: 4, flex: '1 1 96px', minWidth: 0 }}>
        <span className="small" style={{ color: tone, fontWeight: 700, lineHeight: 1.45, overflowWrap: 'anywhere' }}>
          <span aria-hidden="true">⏳ </span>{last ? t('ex.fade1') : t('ex.fade', { n: left })}
        </span>
        <span aria-hidden="true" style={{ display: 'flex', gap: 3 }}>
          {Array.from({ length: Math.max(total, left) }, (_, i) => (
            <i key={i} style={{ width: 14, height: 5, borderRadius: 2, background: i < left ? tone : 'rgba(140, 180, 220, 0.18)', boxShadow: i < left && last ? '0 0 8px var(--warn)' : undefined }} />
          ))}
        </span>
      </div>
      {onKeep && (
        <button className="small" onClick={onKeep} style={{ flex: '0 1 auto', maxWidth: '100%', whiteSpace: 'normal', lineHeight: 1.45, color: 'var(--hot)', borderColor: 'rgba(255, 210, 63, 0.55)', background: 'rgba(255, 210, 63, 0.1)' }}>
          ★ {t('ex.keep')}
        </button>
      )}
    </div>
  )
}

/** A buy offer for a discovered player, through the normal deal endpoints. */
function FindDeal({ xc, f, onClose }: { xc: XCtx; f: Find; onClose: () => void }) {
  const { t } = useI18n()
  const { ctx, refresh } = xc
  const p = f.player!
  const [pct, setPct] = useState(100)
  const [agent, setAgent] = useState(false)
  const [promise, setPromise] = useState(false)
  const [sellOn, setSellOn] = useState(false)
  const [q, setQ] = useState<DealQuote | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<boolean | null>(null)
  const base = p.price || p.value
  const price = Math.round(base * pct / 100 / 1e4) * 1e4
  const body = { type: 'buy', playerId: p.id, price, agent, promise, sellOn, scout: false }
  const key = JSON.stringify(body)
  useEffect(() => {
    const h = setTimeout(() => api.quote(ctx.id, body).then(setQ).catch(() => setQ(null)), 220)
    return () => clearTimeout(h)
  }, [key])
  async function go() {
    setBusy(true)
    try {
      const r = await ctx.run(t('wait.deal'), () => api.deal(ctx.id, body))
      setResult(r.accepted)
      await refresh()
    } catch (e) { ctx.toast(errText(t, e), true) } finally { setBusy(false) }
  }
  const chance = q ? Math.round(q.chance * 100) : 0
  return (
    <div className="modal" role="dialog" aria-modal="true" onClick={onClose}>
      <div className={'card ex-dealcard r-' + f.rarity} onClick={e => e.stopPropagation()} style={{ width: 'min(520px, 100%)', maxHeight: '92vh', overflow: 'auto' }}>
        <span className="eyebrow">{f.nowClub || f.club}</span>
        <h2 style={{ fontSize: 30 }}>{p.name} <Ovr v={p.overall} /></h2>
        {result !== null ? (
          <>
            <p className={result ? 'good big' : 'error big'}>{result ? t('deal.accepted', { name: p.name }) : t('deal.rejected', { club: f.nowClub || f.club })}</p>
            <button className="primary" onClick={onClose}>{t('close')}</button>
          </>
        ) : (
          <div className="stack">
            <div className="field">
              <label htmlFor="exd-pr">{t('deal.offer')}: <b className="num">{money(price)}</b> <span className="muted">({pct}% {t('deal.ofAsk')} {money(base)})</span></label>
              <input id="exd-pr" type="range" min={60} max={180} step={5} value={pct} onChange={e => setPct(Number(e.target.value))} />
            </div>
            <div className="dealopts">
              <b>{t('deal.boost')}</b>
              <label><input type="checkbox" checked={promise} onChange={e => setPromise(e.target.checked)} /> {t('deal.promise')}</label>
              <label><input type="checkbox" checked={sellOn} onChange={e => setSellOn(e.target.checked)} /> {t('deal.sellOn')}</label>
              <label><input type="checkbox" checked={agent} onChange={e => setAgent(e.target.checked)} /> {t('deal.agent')}</label>
            </div>
            {!q ? <p className="muted">{t('deal.calc')}</p> : (
              <div className="stack" style={{ gap: 6 }}>
                <div className="odds"><i style={{ width: chance + '%', background: chance >= 60 ? 'var(--good)' : chance >= 30 ? 'var(--warn)' : 'var(--bad)' }} /><b className="num">{chance}%</b></div>
                <div className="row" style={{ gap: 6 }}>{q.factors.map(fc => <span key={fc} className={'chip f-' + fc}>{t('deal.f.' + fc)}</span>)}</div>
                {q.fee > 0 && <span className="muted">{t('deal.fee', { v: money(q.fee) })}</span>}
                {q.blocked && <p className="error">{t('err.' + q.blocked)}</p>}
              </div>
            )}
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>{t('ex.dealHint')}</p>
            <div className="row">
              <button className="primary" disabled={busy || !q || !!q.blocked} onClick={go}>{busy ? t('wait') : t('deal.submit')}</button>
              <button onClick={onClose}>{t('cancel')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

