import { useState, type ReactNode } from 'react'
import { useI18n } from '../i18n'
import type { Lang } from '../strings'
import { CAMERAS, DIFFICULTIES, MATCH_LENGTHS, useSettings } from '../settings'
import { Icon, Portal, Seg, rangeFill, useEscape, type IconName } from '../ui'
import { sfx } from '../sfx'
import { openHowTo } from './onboarding/HowToPlay'
import { startTour, tourAvailable } from './onboarding/Tour'

type Section = 'lang' | 'audio' | 'pad' | 'match' | 'help' | 'account'
const SECTIONS: [Section, IconName][] = [['lang', 'language'], ['audio', 'volume'], ['pad', 'gamepad'], ['match', 'match'], ['help', 'help'], ['account', 'user']]
const LANGS: [Lang, string, string][] = [['vi', 'VI', 'Tiếng Việt'], ['en', 'EN', 'English'], ['ja', 'JA', '日本語']]
const CAM_ICON: Record<string, IconName> = { tv: 'tv', broadcast: 'broadcast', wide: 'zoomOut', close: 'zoomIn' }

/** Gear button that opens the settings screen. `account` adds the account section (username, saves, log out). */
export function SettingsButton({ account, className, label }: {
  account?: { username: string; onSaves?: () => void; onLogout: () => void }; className?: string; label?: boolean
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className={'gearbtn' + (className ? ' ' + className : '')} onClick={() => setOpen(true)} aria-label={t('set.title')} data-tip={label ? undefined : t('set.title')}>
        <Icon name="settings" size={18} />{label && <span>{t('set.title')}</span>}
      </button>
      {open && <Portal><SettingsModal account={account} onClose={() => setOpen(false)} /></Portal>}
    </>
  )
}

export function SettingsModal({ account, onClose }: { account?: { username: string; onSaves?: () => void; onLogout: () => void }; onClose: () => void }) {
  const { t, lang, setLang } = useI18n()
  const [s, set] = useSettings()
  const [sec, setSec] = useState<Section>('lang')
  const [layout, setLayout] = useState(false)
  // spoken commentary in live matches (the match page reads the same key)
  const [tts, setTts] = useState(() => { try { return localStorage.getItem('pitchside.tts') === '1' } catch { return false } })
  const sections = SECTIONS.filter(([k]) => k !== 'account' || account)
  useEscape(onClose)
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={t('set.title')} onClick={onClose}>
      <div className="card settings" onClick={e => e.stopPropagation()}>
        <div className="row spread" style={{ flexWrap: 'nowrap' }}>
          <div className="headline"><Icon name="settings" size={26} className="pagehead-ico" /><h2>{t('set.title')}</h2></div>
          <button onClick={onClose} aria-label={t('close')}><Icon name="close" size={18} /></button>
        </div>
        <div className="set-body">
          <nav className="set-nav" aria-label={t('set.title')}>
            {sections.map(([k, ic]) => (
              <button key={k} aria-current={sec === k} onClick={() => setSec(k)}><Icon name={ic} size={18} /> <span>{t('set.' + k)}</span></button>
            ))}
          </nav>
          <div className="set-pane">
            {sec === 'lang' && (
              <Group icon="language" title={t('set.lang')}>
                <div className="langcards">
                  {LANGS.map(([l, code, name]) => (
                    <button key={l} className="langcard" aria-pressed={lang === l} onClick={() => setLang(l)} lang={l}>
                      <b>{code}</b><span>{name}</span>{lang === l && <Icon name="check" size={16} />}
                    </button>
                  ))}
                </div>
              </Group>
            )}
            {sec === 'audio' && (
              <Group icon="volume" title={t('set.audio')}>
                <Toggle icon={s.sound ? 'volume' : 'mute'} label={t('set.sound')} on={s.sound} onChange={v => { set({ sound: v }); if (v) window.setTimeout(() => sfx('confirm'), 30) }} />
                <div className={'setrow' + (s.sound ? '' : ' off')}>
                  <label htmlFor="vol"><Icon name="volume" size={16} /> {t('set.volume')}</label>
                  <input id="vol" type="range" min={0} max={100} step={5} value={Math.round(s.volume * 100)} disabled={!s.sound}
                    style={rangeFill(s.volume * 100, 0, 100)} onChange={e => { set({ volume: Number(e.target.value) / 100 }); sfx('tick') }} />
                  <b className="valbadge num">{Math.round(s.volume * 100)}</b>
                </div>
                <Toggle icon="mic" label={t('set.tts')} on={tts} onChange={v => { setTts(v); try { localStorage.setItem('pitchside.tts', v ? '1' : '0') } catch { /* storage unavailable */ } }} />
                <p className="hint"><Icon name="info" size={14} className="i" /><span>{t('set.ttsNote')}</span></p>
              </Group>
            )}
            {sec === 'pad' && (
              <Group icon="gamepad" title={t('set.pad')}>
                <Toggle icon="vibrate" label={t('set.rumble')} on={s.rumble} onChange={v => set({ rumble: v })} />
                <button className="setlink" onClick={() => setLayout(!layout)} aria-expanded={layout}>
                  <Icon name="gamepad" size={16} /> {layout ? t('set.hideLayout') : t('set.layout')} <Icon name={layout ? 'prev' : 'next'} size={14} />
                </button>
                {layout && <PadLayout />}
              </Group>
            )}
            {sec === 'match' && (
              <Group icon="match" title={t('set.match')} note={t('set.matchNote')}>
                <span className="eyebrow"><Icon name="camera" size={13} /> {t('set.camera')}</span>
                <div className="optcards">
                  {CAMERAS.map(c => (
                    <button key={c} className="optcard" aria-pressed={s.camera === c} onClick={() => set({ camera: c })}>
                      <Icon name={CAM_ICON[c]} size={24} strokeWidth={1.7} /><b>{t('cam.' + c)}</b><small>{t('cam.' + c + '.d')}</small>
                    </button>
                  ))}
                </div>
                <div className="setrow wide">
                  <span><Icon name="difficulty" size={16} /> {t('mp.difficulty')}</span>
                  <Seg value={s.difficulty} options={DIFFICULTIES.map(d => [d, t('mp.' + d)] as [typeof d, string])} onChange={v => set({ difficulty: v })} label={t('mp.difficulty')} />
                </div>
                <div className="setrow wide">
                  <span><Icon name="timer" size={16} /> {t('mp.length')}</span>
                  <Seg value={String(s.matchLength)} options={MATCH_LENGTHS.map(n => [String(n), t('mp.min', { n: Math.round((n * 2) / 60) })] as [string, string])}
                    onChange={v => set({ matchLength: Number(v) as typeof s.matchLength })} label={t('mp.length')} />
                </div>
              </Group>
            )}
            {sec === 'help' && (
              <Group icon="help" title={t('set.help')} note={t('set.helpNote')}>
                <div className="optcards">
                  <button className="optcard" onClick={() => { onClose(); openHowTo() }}>
                    <Icon name="help" size={24} strokeWidth={1.7} /><b>{t('ht.title')}</b><small>{t('ht.what')}</small>
                  </button>
                  <button className="optcard" disabled={!tourAvailable()} onClick={() => { onClose(); window.setTimeout(startTour, 60) }}>
                    <Icon name="replay" size={24} strokeWidth={1.7} /><b>{t('set.tour')}</b><small>{t('set.tourNote')}</small>
                  </button>
                </div>
              </Group>
            )}
            {sec === 'account' && account && (
              <Group icon="user" title={t('set.account')}>
                <div className="acct"><span className="avatar r-head" aria-hidden="true">{account.username.slice(0, 2).toUpperCase()}</span><div><small className="muted">{t('set.signedIn')}</small><b>{account.username}</b></div></div>
                <div className="row">
                  {account.onSaves && <button onClick={() => { onClose(); account.onSaves!() }}><Icon name="saves" size={16} /> {t('saves')}</button>}
                  <button className="danger" onClick={() => { onClose(); account.onLogout() }}><Icon name="logout" size={16} /> {t('logout')}</button>
                </div>
              </Group>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Group({ icon, title, note, children }: { icon: IconName; title: string; note?: string; children: ReactNode }) {
  return (
    <section className="set-group">
      <h3 className="ttl"><Icon name={icon} size={16} />{title}</h3>
      {note && <p className="hint"><Icon name="info" size={14} className="i" /><span>{note}</span></p>}
      {children}
    </section>
  )
}

function Toggle({ icon, label, on, onChange }: { icon: IconName; label: string; on: boolean; onChange: (v: boolean) => void }) {
  const { t } = useI18n()
  return (
    <button className={'toggle' + (on ? ' on' : '')} role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      <Icon name={icon} size={18} /><span>{label}</span>
      <i className="sw" aria-hidden="true"><b /></i><small>{on ? t('set.on') : t('set.off')}</small>
    </button>
  )
}

/** Controller and keyboard layout, for menus and for the live match. */
function PadLayout() {
  const { t } = useI18n()
  const rows: [string, string][] = [
    ['L / D-pad', t('ctl.p.stick')], ['✕', t('ctl.p.cross')], ['○', t('ctl.p.circle')], ['△', t('ctl.through')], ['□', t('ctl.lob')],
    ['L1', t('ctl.switch')], ['R1 / R2', t('ctl.sprint')], ['Options', t('ctl.pause')], ['Share', t('mp.subs')],
  ]
  return (
    <div className="padlayout">
      <div>
        <span className="eyebrow">{t('set.inMenus')}</span>
        <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>{t('pad.hint').replace(/^🎮\s*/, '')}</p>
      </div>
      <div>
        <span className="eyebrow">{t('set.inMatch')}</span>
        <ul className="keys2">
          {rows.map(([k, v]) => <li key={k}><kbd>{k}</kbd><span>{v}</span></li>)}
        </ul>
      </div>
    </div>
  )
}
