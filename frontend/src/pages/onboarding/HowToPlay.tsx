import { useEffect, useState } from 'react'
import { Icon, Modal, Seg, type IconName } from '../../ui'
import { useI18n } from '../../i18n'
import { startTour, tourAvailable } from './Tour'

// "How to play": the game loop in three steps, the live-match controls (keyboard and controller,
// matching match/input.ts and match/gamepad.ts) and five short tips. Opened from Settings → Help
// and from the "?" button in the menu, through openHowTo(); one HelpHost is mounted in App.tsx.

const EVT = 'pitchside:howto'
export function openHowTo() { window.dispatchEvent(new Event(EVT)) }

export function HelpHost() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const f = () => setOpen(true)
    window.addEventListener(EVT, f)
    return () => window.removeEventListener(EVT, f)
  }, [])
  return open ? <HowToPlay onClose={() => setOpen(false)} /> : null
}

const LOOP: [IconName, string][] = [['playNow', '1'], ['squad', '2'], ['stadiumArt', '3']]

// keyboard: what each key does with the ball and when defending (input.ts K_ATT / K_DEF)
const KB_ATT: [string, string][] = [
  ['W A S D', 'hc.move'], ['Shift', 'hc.sprint'], ['J', 'hc.pass'], ['L', 'hc.through'], ['I', 'hc.lob'],
  ['K', 'hc.shoot'], ['Space', 'hc.shield'], ['U + W A S D', 'hc.skills'], ['Q / E', 'hc.mod'],
]
const KB_DEF: [string, string][] = [
  ['J', 'hc.switch'], ['K', 'hc.tackle'], ['L', 'hc.slide'], ['Q', 'hc.contain'], ['I', 'hc.press'], ['E', 'hc.rush'], ['Space', 'hc.jockey'], ['Shift', 'hc.sprint'],
]
const KB_GEN: [string, string][] = [['P / Esc', 'hc.pause'], ['1 2 3', 'hc.mentality']]

// controller: marker number, PlayStation / Xbox names, with the ball, defending
const PAD: [number, string, string, string][] = [
  [1, 'L · LS', 'hc.move', 'hc.move'], [2, 'R2 · RT', 'hc.sprint', 'hc.sprint'], [3, '✕ · A', 'hc.pass', 'hc.contain'],
  [4, '○ · B', 'hc.shoot', 'hc.tackle'], [5, '□ · X', 'hc.lob', 'hc.slide'], [6, '△ · Y', 'hc.through', 'hc.rush'],
  [7, 'L1 · LB', 'hc.mod', 'hc.switch'], [8, 'R1 · RB', 'hc.mod', 'hc.press'], [9, 'L2 · LT', 'hc.shield', 'hc.jockey'],
  [10, 'R · RS', 'hc.skills', 'hc.switchDir'], [11, 'Options · ☰', 'hc.pause', 'hc.pause'], [12, '✚ ↑ ↓', 'hc.mentality', 'hc.mentality'],
]

function padConnected() {
  try { return [...(navigator.getGamepads?.() ?? [])].some(p => p?.connected) } catch { return false }
}

export function HowToPlay({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const [dev, setDev] = useState<'kb' | 'pad'>(() => (padConnected() ? 'pad' : 'kb'))
  return (
    <Modal onClose={onClose} className="howto" label={t('ht.title')}>
      <div className="row spread" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <div className="headline"><Icon name="help" size={28} className="pagehead-ico" /><div><span className="eyebrow">{t('ht.eyebrow')}</span><h2>{t('ht.title')}</h2></div></div>
        <button onClick={onClose} aria-label={t('close')}><Icon name="close" size={18} /></button>
      </div>

      <section className="ht-sec">
        <h3 className="ttl"><Icon name="replay" size={16} />{t('ht.loop')}</h3>
        <ol className="ht-loop">
          {LOOP.map(([icon, n]) => (
            <li key={n}>
              <span className="ht-n num">{n}</span>
              <span className="ht-ico"><Icon name={icon} size={30} strokeWidth={1.7} /></span>
              <b>{t('ht.loop' + n + '.t')}</b>
              <span>{t('ht.loop' + n + '.b')}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="ht-sec">
        <div className="row spread">
          <h3 className="ttl"><Icon name="gamepad" size={16} />{t('ht.controls')}</h3>
          <Seg value={dev} onChange={setDev} label={t('ht.controls')}
            options={[['kb', <><Icon name="keyboard" size={15} /> {t('ht.kb')}</>], ['pad', <><Icon name="gamepad" size={15} /> {t('ht.pad')}</>]]} />
        </div>
        {dev === 'kb' ? (
          <div className="ht-keys">
            <KeyList title={t('ctl.attack')} icon="attack" rows={KB_ATT} />
            <KeyList title={t('ctl.defend')} icon="defense" rows={KB_DEF} />
            <KeyList title={t('ht.always')} icon="clock" rows={KB_GEN} />
          </div>
        ) : (
          <div className="ht-pad">
            <PadDiagram />
            <table className="compact ht-padtable">
              <thead><tr><th>#</th><th>{t('ht.button')}</th><th><Icon name="attack" size={13} /> {t('ctl.attack')}</th><th><Icon name="defense" size={13} /> {t('ctl.defend')}</th></tr></thead>
              <tbody>
                {PAD.map(([n, b, a, d]) => (
                  <tr key={n}><td><span className="ht-mk num">{n}</span></td><td><kbd>{b}</kbd></td><td>{t(a)}</td><td className={a === d ? 'muted' : ''}>{t(d)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="hint"><Icon name="info" size={14} className="i" /><span>{t('ht.controlsNote')}</span></p>
      </section>

      <section className="ht-sec">
        <h3 className="ttl"><Icon name="tip" size={16} />{t('ht.tips')}</h3>
        <ol className="ht-tips">{[1, 2, 3, 4, 5].map(i => <li key={i}><span className="num">{i}</span><span>{t('ht.tip' + i)}</span></li>)}</ol>
      </section>

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        {tourAvailable() && <button onClick={() => { onClose(); window.setTimeout(startTour, 60) }}><Icon name="replay" size={16} /> {t('set.tour')}</button>}
        <button className="primary" onClick={onClose}><Icon name="check" size={16} /> {t('ht.gotIt')}</button>
      </div>
    </Modal>
  )
}

function KeyList({ title, icon, rows }: { title: string; icon: IconName; rows: [string, string][] }) {
  const { t } = useI18n()
  return (
    <div className="ht-keylist">
      <span className="eyebrow"><Icon name={icon} size={13} /> {title}</span>
      <ul>{rows.map(([k, v]) => <li key={k + v}><kbd>{k}</kbd><span>{t(v)}</span></li>)}</ul>
    </div>
  )
}

/** A simple controller drawing with numbered markers that match the table. */
function PadDiagram() {
  const mk = (n: number, x: number, y: number) => (
    <g key={n} className="ht-pmk"><circle cx={x} cy={y} r={9} /><text x={x} y={y + 0.5} textAnchor="middle" dominantBaseline="central">{n}</text></g>
  )
  return (
    <svg className="ht-svg" viewBox="0 0 360 230" role="img" aria-label="Controller">
      <defs>
        <linearGradient id="htpad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3a4a5c" /><stop offset="1" stopColor="#141c26" /></linearGradient>
      </defs>
      {/* shoulders */}
      <rect x="52" y="30" width="78" height="16" rx="8" className="ht-sh" /><rect x="230" y="30" width="78" height="16" rx="8" className="ht-sh" />
      <rect x="60" y="14" width="62" height="14" rx="7" className="ht-sh trig" /><rect x="238" y="14" width="62" height="14" rx="7" className="ht-sh trig" />
      {/* body */}
      <path d="M72 44H288C326 44 348 70 354 108C360 150 352 198 324 208C302 216 286 202 274 182L256 156H104L86 182C74 202 58 216 36 208C8 198 0 150 6 108C12 70 34 44 72 44Z" fill="url(#htpad)" stroke="rgba(160,200,240,0.4)" strokeWidth="2" />
      {/* d-pad */}
      <path d="M80 92h16v-16h14v16h16v14h-16v16h-14v-16h-16z" fill="#0b1118" stroke="rgba(160,200,240,0.35)" />
      {/* sticks */}
      <circle cx="132" cy="146" r="21" fill="#0b1118" stroke="rgba(160,200,240,0.35)" strokeWidth="2" /><circle cx="132" cy="146" r="12" fill="#1f2b38" />
      <circle cx="228" cy="146" r="21" fill="#0b1118" stroke="rgba(160,200,240,0.35)" strokeWidth="2" /><circle cx="228" cy="146" r="12" fill="#1f2b38" />
      {/* options */}
      <rect x="232" y="62" width="18" height="9" rx="4.5" fill="#0b1118" stroke="rgba(160,200,240,0.4)" />
      {/* face buttons */}
      <g className="ht-face">
        <circle cx="280" cy="76" r="12" /><path d="M280 69l6.5 11h-13z" fill="none" stroke="#40e0a0" strokeWidth="2" />
        <circle cx="304" cy="100" r="12" /><circle cx="304" cy="100" r="6" fill="none" stroke="#ff5a6e" strokeWidth="2" />
        <circle cx="280" cy="124" r="12" /><path d="M275 119l10 10M285 119l-10 10" stroke="#5aa8ff" strokeWidth="2" />
        <circle cx="256" cy="100" r="12" /><rect x="251" y="95" width="10" height="10" fill="none" stroke="#ff8ad8" strokeWidth="2" />
      </g>
      {mk(1, 104, 170)}{mk(2, 314, 10)}{mk(3, 264, 140)}{mk(4, 324, 116)}{mk(5, 236, 112)}{mk(6, 300, 64)}
      {mk(7, 40, 38)}{mk(8, 320, 38)}{mk(9, 46, 12)}{mk(10, 256, 172)}{mk(11, 241, 50)}{mk(12, 103, 66)}
    </svg>
  )
}
