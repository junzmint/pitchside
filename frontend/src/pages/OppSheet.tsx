import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { MatchSetup, Player, Pos, SideSetup } from '../types'
import { ROLE_CAT, SLOTS, keyPlayers, roleFits } from '../formations'
import { Badge, Hint, Icon, Modal, Ovr, PosTag, tierOf } from '../ui'
import { useI18n } from '../i18n'
import { chooseKits, kitSetOf, type KitChoice, type KitDef } from '../match/engine'
import { inkOn } from '../kit'
import { styleFor, styleLine } from '../match/style'
import { injKey } from './medical/kinds'

// The opponent's team sheet before a match, opened from the Match Centre's versus card and from the live
// match's pre-match card: formation, the expected XI on a pitch (shirt number, short name, position and
// overall; their three best starred), the bench and whoever is out injured. All of it comes from the match
// setup (GET /api/careers/{id}/match): the computer's eleven there is exactly the one the engine plays.
// Pitch geometry (token sizes, the 16% name width, the pitch's aspect ratios, the keeper's name beside him) was
// checked box by box for all five formations: one-line names never touch down to a 272 px pitch, two-line names
// from about 360 px. Keep it in step with the "opponent's team sheet" block in live.css.

/** The side the user plays against. */
export function oppOf(setup: MatchSetup): SideSetup {
  return setup.userIsHome ? setup.away : setup.home
}

/** The kit the opponent wears: whichever of theirs doesn't clash with the user's (pick = the user's kit choice). */
function oppKit(setup: MatchSetup, pick: KitChoice): KitDef {
  const me = setup.userIsHome ? setup.home : setup.away
  return chooseKits([kitSetOf(me.club), kitSetOf(oppOf(setup).club)], setup.userIsHome ? 0 : 1, [pick, 'auto'])[1].kit
}

function luma(hex: string) {
  const n = parseInt((hex || '#000').replace('#', '').slice(0, 6), 16)
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114
}
/** A club colour that still glows on the dark sheet (near-black kits use their second colour). */
function glowOf(c1: string, c2?: string) {
  if (luma(c1) >= 45) return c1
  if (c2 && luma(c2) >= 45) return c2
  return '#9aa7b4'
}

const LINE: Record<Pos, number> = { GK: 0, DF: 1, MF: 2, FW: 3 }
/** Team-sheet order: goalkeepers, defenders, midfielders, forwards; the best first within a line. */
const byLine = (a: Player, b: Player) => LINE[a.position] - LINE[b.position] || b.overall - a.overall || a.id - b.id

/** Shirt names for the pitch: the surname ("Lucas Silva" → "Silva", "Daan de Jong" → "de Jong",
 *  "Nguyễn Quang Hải" → "Quang Hải"); when two players share it, an initial tells them apart ("L. Silva"),
 *  and if that is shared too, the full name. */
function shirtNames(ps: Player[]): Map<number, string> {
  const tally = (names: string[]) => {
    const c = new Map<string, number>()
    for (const n of names) c.set(n.toLowerCase(), (c.get(n.toLowerCase()) ?? 0) + 1)
    return (n: string) => c.get(n.toLowerCase()) ?? 0
  }
  const parts = ps.map(p => {
    const w = p.name.trim().split(/\s+/)
    return { first: w[0] ?? '', last: w.length > 1 ? w.slice(1).join(' ') : (w[0] ?? '') }
  })
  const lasts = tally(parts.map(x => x.last))
  const short = parts.map(({ first, last }) => (lasts(last) > 1 && first !== last ? `${Array.from(first)[0]}. ${last}` : last))
  const shorts = tally(short)
  return new Map(ps.map((p, i) => [p.id, shorts(short[i]) > 1 ? p.name : short[i]]))
}

// ---------------------------------------------------------------- a shirt in the club's kit, with the number

const SHIRT = 'M14.5 3.5 Q20 9 25.5 3.5 L32.5 6 L39 14.5 L34.5 19.5 L31 16.5 L31 37 L9 37 L9 16.5 L5.5 19.5 L1 14.5 L7.5 6 Z'

/** The kit's pattern in the 40 × 40 shirt box (the same patterns as kit.tsx, simplified for a small shirt). */
function Pattern({ pat, trim }: { pat: string; trim: string }) {
  switch (pat) {
    case 'stripes': return <>{[13.4, 22.2].map(x => <rect key={x} x={x} y={0} width={4.4} height={40} fill={trim} />)}</>
    case 'pinstripes': return <>{[1, 2, 3, 4, 5, 6].map(i => <rect key={i} x={9 + (i * 22) / 7 - 0.35} y={0} width={0.7} height={40} fill={trim} />)}</>
    case 'hoops': return <>{[11, 24].map(y => <rect key={y} x={0} y={y} width={40} height={6.5} fill={trim} />)}</>
    case 'halves': return <rect x={20} y={0} width={20} height={40} fill={trim} />
    case 'quarters': return <><rect x={20} y={0} width={20} height={20} fill={trim} /><rect x={0} y={20} width={20} height={20} fill={trim} /></>
    case 'sash': return <polygon points="9,3 16,3 32,38 25,38" fill={trim} />
    case 'chevron': return <polygon points="7,4 20,17 33,4 33,10 20,23 7,10" fill={trim} />
    case 'sleeves': return <><rect x={0} y={0} width={9} height={22} fill={trim} /><rect x={31} y={0} width={9} height={22} fill={trim} /></>
    case 'centre': return <rect x={17} y={0} width={6} height={40} fill={trim} />
    case 'band': return <rect x={0} y={13} width={40} height={7} fill={trim} />
  }
  return null
}

function Jersey({ kit, n }: { kit: KitDef; n: string }) {
  const clip = 'osj' + useId().replace(/[^a-zA-Z0-9]/g, '')
  const ink = inkOn(kit.shirt)
  return (
    <svg viewBox="0 0 40 40" className="osh-jersey" aria-hidden="true" focusable="false">
      <defs><clipPath id={clip}><path d={SHIRT} /></clipPath></defs>
      <path d={SHIRT} fill={kit.shirt} />
      <g clipPath={`url(#${clip})`}><Pattern pat={kit.pattern} trim={kit.trim} /></g>
      <path d={SHIRT} fill="none" stroke="rgba(0,0,0,.5)" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M14.5 3.5 Q20 9 25.5 3.5" fill="none" stroke={kit.trim} strokeWidth="2.2" strokeLinecap="round" />
      <path d="M1.6 15.2 L5.4 19.4 M38.4 15.2 L34.6 19.4" stroke={kit.trim} strokeWidth="2" strokeLinecap="round" />
      {n && <text x="20" y="29" textAnchor="middle" className="osh-no" fill={ink} stroke={ink === '#ffffff' ? 'rgba(0,0,0,.6)' : 'rgba(255,255,255,.6)'} strokeWidth="2.2">{n}</text>}
    </svg>
  )
}

// ---------------------------------------------------------------- one starter on the pitch

function Token({ p, role, slot, kit, name, star, gk }: {
  p: Player | null; role: string; slot: [number, number]; kit: KitDef; name: string; star: boolean; gk: boolean
}) {
  const { t } = useI18n()
  const [x, y] = slot
  // the Tactics board's layout (own goal at the bottom), a little higher; the keeper sits deeper with his name beside him
  const style: CSSProperties = { left: `${+(8 + y * 84).toFixed(2)}%`, top: `${gk ? 91 : +(86 - (x - 0.04) * 100).toFixed(2)}%` }
  const line = ROLE_CAT[role] ?? 'MF'
  if (!p) {
    return (
      <li className={'osh-tok empty' + (gk ? ' gk' : '')} style={style}>
        <span className="osh-shirt"><span className="osh-ghost" aria-hidden="true">?</span><i className={'osh-role ' + line}>{role}</i></span>
        <span className="osh-nm">{t('empty')}</span>
      </li>
    )
  }
  const off = !roleFits(p.role, role)
  const ovr = Math.round(p.overall)
  const info = [
    p.name,
    `${role}: ${t('role.' + role)}${off ? ` · ${t('lv.opp.offRole', { r: p.role })}` : ''}`,
    `${t('lbl.ovr')} ${ovr} · ${t('nation.' + p.nation)} · ${p.age} ${t('yrs')}`,
    `${t('fitness')} ${Math.round(p.fitness)}%`,
    ...(star ? [`★ ${t('lv.opp.key')}`] : []),
  ]
  return (
    <li className={'osh-tok' + (star ? ' key' : '') + (gk ? ' gk' : '')} style={style} tabIndex={0} data-tip={info.join('\n')}
      aria-label={[...(p.shirt > 0 ? [t('lv.opp.shirt', { n: p.shirt })] : []), ...info].join(', ')}>
      <span className="osh-shirt">
        <Jersey kit={kit} n={p.shirt > 0 ? String(p.shirt) : ''} />
        <b className={'osh-ovr num t-' + tierOf(p.overall)}>{ovr}</b>
        <i className={'osh-role ' + line + (off ? ' off' : '')}>{role}</i>
        {star && <em className="osh-star"><Icon name="star" size={10} strokeWidth={2.6} /></em>}
      </span>
      <span className="osh-nm">{name}</span>
    </li>
  )
}

// ---------------------------------------------------------------- the dialog

/** The opponent's team sheet as a dialog (Escape, the backdrop, ○/B or either close button closes it). */
export function OppSheet({ setup, kitPick = 'auto', onClose }: { setup: MatchSetup; kitPick?: KitChoice; onClose: () => void }) {
  const { t } = useI18n()
  const box = useRef<HTMLDivElement>(null)
  const them = oppOf(setup)
  const club = them.club
  const kit = oppKit(setup, kitPick)
  const roles = them.roles ?? []
  const starters = roles.map((_, i) => (them.starters?.[i] as Player | null | undefined) ?? null)
  const xi = starters.filter((p): p is Player => !!p)
  const stars = new Set(keyPlayers(starters, roles).map(p => p.id)) // the same three as the pre-match "Stars"
  const names = shirtNames(xi)
  const bench = [...(them.bench ?? [])].sort(byLine)
  const out = them.unavailable ?? []
  const avg = xi.length ? Math.round(xi.reduce((s, p) => s + p.overall, 0) / xi.length) : 0
  const slots = SLOTS[club.formation] ?? SLOTS['4-4-2']
  const coach = them.coachFit?.coach

  // keyboard users start on the close button and Tab stays inside the dialog
  useEffect(() => { box.current?.querySelector<HTMLElement>('.osh-x')?.focus({ preventScroll: true }) }, [])
  function trap(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Tab') return
    const els = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]')]
    if (!els.length) return
    const first = els[0], last = els[els.length - 1]
    if (e.shiftKey && (document.activeElement === first || !e.currentTarget.contains(document.activeElement))) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  return (
    <Modal onClose={onClose} className="osh" label={`${t('lv.opp.open')}: ${club.name}`} style={{ ['--oc' as string]: glowOf(club.color, club.color2) } as CSSProperties}>
      <div ref={box} className="osh-in" onKeyDown={trap}>
        <div className="osh-head">
          <span className="osh-crest"><Badge short={club.short} color={club.color} color2={club.color2} size={64} /></span>
          <div className="osh-title">
            <span className="eyebrow"><Icon name="scout" size={14} /> {t('lv.opp.open')}</span>
            <h3 className="osh-name">{club.name}</h3>
            <div className="osh-chips">
              <span className="osh-chip f"><Icon name="tactics" size={14} /> {t('tac.formation')} {club.formation}</span>
              {avg > 0 && <span className="osh-chip"><Icon name="rating" size={13} /> {t('lv.opp.avg', { n: avg })}</span>}
              <span className="osh-chip"><Icon name="chemistry" size={13} /> {t('chemistry')} {them.chemistry?.team ?? 0}</span>
              {coach && <span className="osh-chip"><Icon name="head" size={13} /> {t('lv.opp.coach', { name: coach })}{them.coachFit?.style ? ` · ${t('style.' + them.coachFit.style)}` : ''}</span>}
            </div>
          </div>
          <button className="osh-x" onClick={onClose} aria-label={t('close')}><Icon name="close" size={18} /></button>
        </div>
        <div className="osh-body">
          <section className="osh-sec osh-xi">
            <h4><Icon name="team" size={16} /> {t('lv.opp.xi')}</h4>
            <div className="osh-pitchwrap">
              <div className="osh-pitch">
                <i className="osh-mk half" aria-hidden="true" /><i className="osh-mk circle" aria-hidden="true" />
                <i className="osh-mk box t" aria-hidden="true" /><i className="osh-mk box b" aria-hidden="true" />
                <i className="osh-mk six t" aria-hidden="true" /><i className="osh-mk six b" aria-hidden="true" />
                <ol className="osh-toks" aria-label={t('lv.opp.xi')}>
                  {roles.map((role, i) => {
                    const p = starters[i]
                    return <Token key={p?.id ?? 'e' + i} p={p} role={role} slot={slots[i] ?? [0.5, 0.5]} kit={kit} name={p ? names.get(p.id) ?? p.name : ''} star={!!p && stars.has(p.id)} gk={i === 0} />
                  })}
                </ol>
              </div>
            </div>
            <p className="osh-legend"><em className="osh-star inline"><Icon name="star" size={10} strokeWidth={2.6} /></em> {t('lv.opp.keyLegend')}</p>
          </section>

          <div className="osh-side">
            <p className="osh-style"><b>{t('lv.m.oppStyle')}</b><br />{styleLine(t, styleFor(club.tactic, them.coachFit?.style), club.tactic)}</p>
            <Hint text={t('lv.opp.xiHint')} />
            <section className="osh-sec">
              <h4><Icon name="users" size={16} /> {t('mp.bench')} <b className="num">{bench.length}</b></h4>
              {bench.length ? (
                <ul className="osh-list">
                  {bench.map(p => (
                    <li key={p.id} className="osh-row" data-tip={`${p.name}\n${t('nation.' + p.nation)} · ${p.age} ${t('yrs')}\n${t('fitness')} ${Math.round(p.fitness)}%`}>
                      <span className="no num">{p.shirt > 0 ? p.shirt : ''}</span>
                      <PosTag p={p.position} role={p.role} />
                      <span className="nm">{p.name}</span>
                      <Ovr v={p.overall} />
                    </li>
                  ))}
                </ul>
              ) : <p className="osh-none muted">{t('mp.noBench')}</p>}
            </section>
            <section className="osh-sec">
              <h4><Icon name="injury" size={16} /> {t('lv.opp.out')} <b className="num">{out.length}</b></h4>
              {out.length ? (
                <ul className="osh-list">
                  {out.map(p => (
                    <li key={p.id} className="osh-row out">
                      <span className="no num">{p.shirt > 0 ? p.shirt : ''}</span>
                      <PosTag p={p.position} role={p.role} />
                      <span className="nm">{p.name}<small><Icon name="injury" size={12} /> {t(injKey(p.injKind) + '.s')} · {t('lv.opp.weeks', { n: p.injury })}</small></span>
                      <Ovr v={p.overall} />
                    </li>
                  ))}
                </ul>
              ) : <p className="osh-none"><Icon name="check" size={16} /> {t('lv.opp.noOut')}</p>}
            </section>
          </div>
        </div>

        <div className="osh-foot"><button onClick={onClose}><Icon name="close" size={15} /> {t('close')}</button></div>
      </div>
    </Modal>
  )
}

/** The button that opens the sheet: a big one for the versus card, `small` for the live match's pre-match card
 *  (pass the user's kit choice there, so the opponent shows in the kit they will really wear). */
export function OppSheetButton({ setup, kitPick, small }: { setup: MatchSetup; kitPick?: KitChoice; small?: boolean }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  const them = oppOf(setup)
  const out = them.unavailable?.length ?? 0
  const sub = [them.club.formation, t('lv.opp.benchN', { n: them.bench?.length ?? 0 }), out ? t('lv.opp.outN', { n: out }) : ''].filter(Boolean).join(' · ')
  const close = () => { setOpen(false); requestAnimationFrame(() => ref.current?.focus({ preventScroll: true })) }
  return (
    <>
      <button ref={ref} className={small ? 'small osh-open' : 'vsx-sheetbtn'} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        {small ? <><Icon name="tactics" size={15} /> <span>{t('lv.opp.open')} · {sub}</span></> : <>
          <Icon name="tactics" size={22} />
          <span><b>{t('lv.opp.open')}</b><small>{sub}</small></span>
          <Icon name="next" size={18} />
        </>}
      </button>
      {open && <OppSheet setup={setup} kitPick={kitPick} onClose={close} />}
    </>
  )
}
