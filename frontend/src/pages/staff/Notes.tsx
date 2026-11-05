// Side panels of the staff room: the assistant's notes (the head coach's verdict and four short
// lists), what is in effect (boosts and promises), mentoring at a glance and the staff room's news.
import type { StaffRoomView } from '../../api_staff'
import { useI18n } from '../../i18n'
import { Icon, Title } from '../../ui'
import { happeningText, happeningTone } from '../EventsInbox'
import { Portrait, tn } from './parts'

export function StaffNotes({ room }: { room: StaffRoomView }) {
  const { t } = useI18n()
  const rp = room.report
  const v = rp.verdict
  const head = room.slots.find(s => s.role === 'head')?.coach
  const res = v ? (v.gf > v.ga || v.key === 'pens_win' ? 'W' : v.gf < v.ga || v.key === 'pens_loss' ? 'L' : 'D') : ''
  const block = (cls: string, icon: string, title: string, lines: React.ReactNode[]) => (
    <div className={'sr-noteblock ' + cls}>
      <b><span aria-hidden="true">{icon}</span> {title}</b>
      {lines.length ? lines : <span className="muted">{t('sr.notes.empty')}</span>}
    </div>
  )
  return (
    <section className="panel sr-notes">
      <div className="row spread">
        <Title icon="board">{t('sr.notes.title')}</Title>
        {v && <span className="eyebrow">{t('sr.notes.after', { d: v.day })}</span>}
      </div>
      {v ? (
        <div className="sr-quote">
          <Portrait name={v.coach || head?.name || '?'} role="head" morale={head?.morale} />
          <div className="sr-bubble">
            <span className={'sr-res ' + res} data-tip={t(res === 'W' ? 'rep.win' : res === 'L' ? 'rep.loss' : 'rep.draw')}>{t('res.' + res)}</span>
            <q>{t('sr.v.' + v.key, { gf: v.gf, ga: v.ga, opp: v.opp })}</q>
            <span className="tip"><Icon name="tip" size={12} /> {t('sr.tip.' + v.tip)}</span>
            {v.best && <span className="best">★ {t('sr.notes.best', { name: v.best, v: (v.bestScore ?? 0).toFixed(1) })}</span>}
          </div>
        </div>
      ) : <p className="muted" style={{ margin: 0 }}>{t('sr.notes.none')}</p>}
      <div className="sr-notegrid">
        {block('form', '🔥', t('sr.notes.form'), rp.inForm.map(l => <span key={l.id}><b>{l.name}</b><em>{t('sr.notes.formLine', { v: l.v.toFixed(1) })}</em></span>))}
        {block('rest', '💤', t('sr.notes.rest'), rp.rest.map(l => <span key={l.id}><b>{l.name}</b><em>{t('sr.notes.restLine', { n: Math.round(l.v) })}</em></span>))}
        {block('minutes', '🌱', t('sr.notes.minutes'), rp.minutes.map(l => <span key={l.id}><b>{l.name}</b><em>{t('sr.notes.minutesLine', { age: l.age ?? 0, n: l.n })}</em></span>))}
        {block('improved', '📈', t('sr.notes.improved', { d: rp.since || 1 }), rp.improved.map(l => <span key={l.id}><b>{l.name}</b><em className="num">+{l.n} → {l.v}</em></span>))}
      </div>
      {rp.minutes.length > 0 && <span className="muted" style={{ fontSize: 12 }}><Icon name="youth" size={12} /> {t('sr.notes.growHint')}</span>}
    </section>
  )
}

export function EffectsPanel({ room }: { room: StaffRoomView }) {
  const { t } = useI18n()
  if (room.boosts.length === 0 && room.promises.length === 0) return null
  return (
    <section className="panel stack">
      <Title icon="flame">{t('sr.fx.title')}</Title>
      <ul className="sr-list">
        {room.boosts.map((b, i) => (
          <li key={'b' + i} className="good"><span aria-hidden="true">📈</span>
            <span>{tn(t, 'sr.boost.line', b.left, { v: b.v, who: b.player ?? t('sr.who.' + (b.pos || 'all')) })}</span></li>
        ))}
        {room.promises.map((p, i) => (
          <li key={'p' + i} className="warn"><span aria-hidden="true">🤝</span>
            <span>{p.kind === 'signing'
              ? tn(t, 'sr.promise.signing', p.left, { coach: p.coach, pos: t('posL.' + (p.pos ?? 'MF')) })
              : tn(t, 'sr.promise.minutes', p.left, { player: p.player ?? '', got: p.got ?? 0, need: p.need ?? 0 })}</span></li>
        ))}
      </ul>
    </section>
  )
}

export function MentoringPanel({ room }: { room: StaffRoomView }) {
  const { t } = useI18n()
  const free = room.youngsters.filter(y => !y.mentor)
  const pairs = room.slots.flatMap(s => (s.coach?.mentees ?? []).map(m => ({ coach: s.coach!, m })))
  return (
    <section className="panel stack">
      <Title icon="youth">{t('sr.mentor.title')}</Title>
      <p className="hint" style={{ margin: 0 }}><Icon name="info" size={14} className="i" /><span>{t('sr.mentor.help')}</span></p>
      {pairs.length > 0 && (
        <ul className="sr-list">
          {pairs.map(({ coach, m }) => (
            <li key={m.playerId} className="good"><b>{m.name}</b><small>{t('sr.age', { n: m.age })} · {m.overall} → {m.potential}</small>
              <span style={{ marginLeft: 'auto' }} className="muted">{coach.name} · <b style={{ color: 'var(--good)' }}>+{m.boost}%</b></span></li>
          ))}
        </ul>
      )}
      <span className="muted" style={{ fontSize: 12 }}>
        <Icon name="users" size={12} /> {tn(t, 'sr.mentor.count', free.length)}{free.length > 0 ? ': ' + free.slice(0, 4).map(y => y.name).join(', ') + (free.length > 4 ? ` +${free.length - 4}` : '') : ''}
      </span>
    </section>
  )
}

export function StaffLogPanel({ room }: { room: StaffRoomView }) {
  const { t } = useI18n()
  return (
    <section className="panel stack">
      <Title icon="news">{t('sr.log.title')}</Title>
      {room.log.length === 0 ? <span className="muted">{t('sr.log.empty')}</span> : (
        <ul className="sr-list">
          {room.log.slice(0, 10).map((l, i) => (
            <li key={i} className={happeningTone(l.key)}>
              <small>{t('sr.log.day', { s: l.season, d: l.day })}</small>
              <span>{happeningText(t, l)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
