import { useEffect, useState } from 'react'
import { api, money } from '../api'
import type { CareerSummary, LeagueInfo, User } from '../types'
import { Badge, BusyOverlay, ConfirmButton, Icon, Empty, Title } from '../ui'
import { errText, useI18n } from '../i18n'
import { SettingsButton } from './Settings'
import { PlayCard } from './play/PlayCard'

const PALETTE: [string, string][] = [
  ['#e2523f', '#ffffff'], ['#1f6fd1', '#ffe14d'], ['#151515', '#f2c230'], ['#1a8f4c', '#ffffff'],
  ['#7a2bb8', '#ffffff'], ['#f08a24', '#13202b'], ['#e9e9e9', '#c8202f'], ['#0f3d6e', '#7fd3ff'],
]

export default function Saves({ user, onOpen, onLogout }: { user: User; onOpen: (id: number) => void; onLogout: () => void }) {
  const { t } = useI18n()
  const [saves, setSaves] = useState<CareerSummary[] | null>(null)
  const [leagues, setLeagues] = useState<LeagueInfo[]>([])
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState('')

  const load = () => api.careers().then(setSaves).catch(e => setErr(errText(t, e)))
  useEffect(() => {
    load()
    api.leagues().then(setLeagues).catch(() => {})
  }, [])

  return (
    <div className="center hero" style={{ alignItems: 'start' }}>
      <div className="stack" style={{ width: 'min(980px, 100%)', gap: 18 }}>
        <div className="row spread">
          <div>
            <span className="eyebrow">{t('saves.hello', { name: user.username })}</span>
            <h1 className="logo">Pitchside</h1>
          </div>
          <div className="row"><SettingsButton label account={{ username: user.username, onLogout }} /></div>
        </div>
        {err && <p className="error">{err}</p>}
        {!creating && (
          <section className="panel stack">
            <div className="row spread">
              <Title icon="saves">{t('saves.title')}</Title>
              <button className="primary" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> {t('saves.new')}</button>
            </div>
            {saves && saves.length === 0 && <Empty icon="saves">{t('saves.empty')}</Empty>}
            <div className="grid savegrid cards">
              {saves?.map(s => (
                <div key={s.id} className={'savecard' + (s.ended ? ' ended' : '')} role="button" tabIndex={0} onClick={() => onOpen(s.id)} onKeyDown={e => e.key === 'Enter' && e.target === e.currentTarget && onOpen(s.id)}
                  style={{ ['--kit' as string]: s.color }}>
                  <Badge short={s.short} color={s.color} color2={s.color2} size={58} />
                  <div className="save-id">
                    <b>{s.clubName}</b>
                    <span className="muted"><Icon name="calendar" size={13} /> {t('seasonN', { n: s.season })} · {s.day > 54 ? t('offseason') : t('dayOf', { d: s.day, n: 54 })}</span>
                    <span className="muted num">{s.ended ? <b className="overtag"><Icon name="lock" size={13} /> {t('over.tag')}</b> : <><Icon name="budget" size={13} /> {money(s.budget)}</>} · <Icon name="clock" size={13} /> {new Date(s.updatedAt).toLocaleDateString()}</span>
                  </div>
                  <span className="save-go" aria-hidden="true"><Icon name="playNow" size={20} /></span>
                  {/* the corner holds the button and, when asked, "Delete" and "Cancel" side by side */}
                  <span className="save-del" onClick={e => e.stopPropagation()}>
                    <ConfirmButton className="danger small" label={<Icon name="trash" size={15} title={t('delete')} />} confirm={t('delete')} onConfirm={async () => { await api.deleteCareer(s.id); load() }} />
                  </span>
                </div>
              ))}
              <button className="savecard newsave" onClick={() => setCreating(true)}>
                <span className="plusbig"><Icon name="plus" size={30} /></span>
                <b>{t('saves.new')}</b>
              </button>
            </div>
          </section>
        )}
        {creating && <NewCareer leagues={leagues} onCancel={() => setCreating(false)} onCreated={onOpen} />}
        {!creating && <PlayCard />}
      </div>
    </div>
  )
}

function NewCareer({ leagues, onCancel, onCreated }: { leagues: LeagueInfo[]; onCancel: () => void; onCreated: (id: number) => void }) {
  const { t } = useI18n()
  const [league, setLeague] = useState('EN')
  const [pick, setPick] = useState<number | 'custom'>(0)
  const [div, setDiv] = useState(1)
  const [name, setName] = useState('')
  const [short, setShort] = useState('')
  const [col, setCol] = useState(0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const lg = leagues.find(l => l.code === league)
  const divClubs = lg?.divisions?.find(d => d.division === div)?.clubs ?? []

  async function create() {
    setBusy(true)
    setErr('')
    try {
      const body = pick === 'custom'
        ? { league, clubIndex: 0, division: div, custom: { name, short, color: PALETTE[col][0], color2: PALETTE[col][1] } }
        : { league, clubIndex: pick }
      const { id } = await api.newCareer(body)
      onCreated(id)
    } catch (e) {
      setErr(errText(t, e))
      setBusy(false)
    }
  }

  return (
    <section className="panel stack">
      <div className="row spread"><Title icon="plus">{t('new.title')}</Title><button onClick={onCancel}><Icon name="prev" size={15} /> {t('cancel')}</button></div>
      <div className="stack" style={{ gap: 6 }}>
        <b className="stephead"><Icon name="league" size={16} /> {t('new.league')}</b>
        <div className="row">
          {leagues.filter(l => !l.world).map(l => (
            <button key={l.code} className={'leaguebtn' + (league === l.code ? ' on' : '')} onClick={() => { setLeague(l.code); setPick((div - 1) * 20) }}>
              <span className="lgcode">{l.code}</span><b>{l.name}</b><small>{t('country.' + l.code)}</small>
            </button>
          ))}
        </div>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <div className="row spread">
          <b className="stephead"><Icon name="club" size={16} /> {t('new.club')}</b>
          <div className="seg" role="group">
            {(lg?.divisions ?? []).map(d => (
              <button key={d.division} aria-pressed={div === d.division} onClick={() => { setDiv(d.division); setPick((d.division - 1) * 20) }}>
                {t('divN', { n: d.division })} · {d.name}
              </button>
            ))}
          </div>
        </div>
        <div className="grid g3">
          {divClubs.map(c => (
            <button key={c.index} className={'clubpick' + (pick === c.index ? ' on' : '')} onClick={() => setPick(c.index)}>
              <Badge short={c.short} color={c.color} color2={c.color2} size={38} />
              <span style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                <b>{c.name}</b>
                <small className="muted clubstats"><span><Icon name="strength" size={12} /> {c.strength}</span><span><Icon name="budget" size={12} /> {money(c.budget)}</span><span><Icon name="tactics" size={12} /> {c.formation}</span></small>
                <small className="muted wrap">{c.stars?.slice(0, 3).join(', ')}</small>
              </span>
            </button>
          ))}
          <button className={'clubpick' + (pick === 'custom' ? ' on' : '')} onClick={() => setPick('custom')}>
            <Badge short={short || '+'} color={PALETTE[col][0]} color2={PALETTE[col][1]} size={38} />
            <span style={{ textAlign: 'left' }}><b>{t('new.custom')}</b><small className="muted">{t('new.customHint')}</small></span>
          </button>
        </div>
      </div>
      {pick === 'custom' && (
        <div className="grid g3">
          <div className="field"><label htmlFor="cn">{t('new.clubName')}</label><input id="cn" value={name} maxLength={30} onChange={e => setName(e.target.value)} /></div>
          <div className="field"><label htmlFor="cs">{t('new.short')}</label><input id="cs" value={short} maxLength={4} onChange={e => setShort(e.target.value.toUpperCase())} /></div>
          <div className="field">
            <label>{t('new.kit')}</label>
            <div className="row">
              {PALETTE.map(([a, b], i) => (
                <button type="button" key={a} aria-label={`${i + 1}`} aria-pressed={i === col} onClick={() => setCol(i)}
                  style={{ width: 30, height: 30, padding: 0, background: `linear-gradient(135deg, ${a} 55%, ${b} 55%)`, outline: i === col ? '3px solid var(--ink)' : undefined }} />
              ))}
            </div>
          </div>
        </div>
      )}
      {err && <p className="error">{err}</p>}
      {busy && <BusyOverlay message={t('wait.create')} />}
      <div className="row">
        <button className="primary big" disabled={busy || (pick === 'custom' && (!name.trim() || !short.trim()))} onClick={create}>
          <Icon name="playNow" size={18} /> {busy ? t('new.creating') : t('new.start')}
        </button>
        <span className="muted" style={{ fontSize: 13 }}>{t('new.note')}</span>
      </div>
    </section>
  )
}
