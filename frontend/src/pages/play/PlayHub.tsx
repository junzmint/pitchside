import { useState } from 'react'
import type { User } from '../../types'
import { Icon, PageHead, TabBar, Title } from '../../ui'
import { useI18n } from '../../i18n'
import { QuickMatch } from './QuickMatch'
import { Training } from './Training'
import { WifiIcon } from './bits'
import { goJoin, type PlayTab } from './route'
import type { QuickMode } from './bits'

// The play hub: quick match, Wi-Fi two-player and the training ground, on one screen with tabs.
// Opened from the title screen card (or any link to #play/…); careerId is set when it is opened
// from inside a career (training rewards go to that career).

export default function PlayHub({ user, careerId, tab, onExit }: { user: User; careerId: number | null; tab: PlayTab; onExit: () => void }) {
  const { t } = useI18n()
  const [quickMode, setQuickMode] = useState<QuickMode | undefined>(undefined)
  const [n, setN] = useState(0) // remount the quick match when the Wi-Fi tab sends us there
  const setTab = (v: PlayTab) => {
    history.replaceState(null, '', location.pathname + location.search + '#play/' + v)
    window.dispatchEvent(new Event('pitchside:route'))
  }
  return (
    <div className="center hero pl-hub" style={{ alignItems: 'start' }}>
      <div className="stack" style={{ width: 'min(1040px, 100%)', gap: 16 }}>
        <div className="row spread">
          <button onClick={onExit}><Icon name="prev" size={16} /> {careerId ? t('pl.hub.backCareer') : t('pl.hub.backTitle')}</button>
          <span className="muted">{user.username}</span>
        </div>
        <PageHead icon="play" eyebrow={t('pl.hub.eyebrow')} title={t('pl.hub.title')} />
        <TabBar value={tab} onChange={setTab} label={t('pl.hub.title')} options={[
          ['quick', 'match', t('pl.tab.quick'), t('pl.tab.quickSub')],
          ['lan', 'broadcast', t('pl.tab.lan'), t('pl.tab.lanSub')],
          ['training', 'training', t('pl.tab.training'), t('pl.tab.trainingSub')],
        ]} />
        {tab === 'quick' && <QuickMatch key={n} user={user} startMode={quickMode} />}
        {tab === 'lan' && <LanTab onHost={() => { setQuickMode('lan'); setN(x => x + 1); setTab('quick') }} />}
        {tab === 'training' && <Training careerId={careerId} />}
      </div>
    </div>
  )
}

function LanTab({ onHost }: { onHost: () => void }) {
  const { t } = useI18n()
  const [code, setCode] = useState('')
  return (
    <div className="grid g2 pl-lantab">
      <section className="panel stack">
        <Title icon="broadcast">{t('pl.lantab.hostTitle')}</Title>
        <p className="muted" style={{ margin: 0 }}>{t('pl.lantab.hostBody')}</p>
        <ol className="pl-steps">
          <li>{t('pl.lantab.h1')}</li>
          <li>{t('pl.lantab.h2')}</li>
          <li>{t('pl.lantab.h3')}</li>
        </ol>
        <button className="primary big" onClick={onHost}><WifiIcon /> {t('pl.lantab.host')}</button>
      </section>
      <section className="panel stack">
        <Title icon="gamepad">{t('pl.lantab.joinTitle')}</Title>
        <p className="muted" style={{ margin: 0 }}>{t('pl.lantab.joinBody')}</p>
        <form className="pl-codeform" onSubmit={e => { e.preventDefault(); if (code.length === 4) goJoin(code) }}>
          <label htmlFor="pl-hubcode">{t('pl.join.code')}</label>
          <input id="pl-hubcode" className="pl-codein num" value={code} maxLength={4} placeholder="ABCD" autoComplete="off" spellCheck={false}
            onChange={e => setCode(e.target.value.toUpperCase().replace(/[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/g, '').slice(0, 4))} />
          <button className="primary" disabled={code.length !== 4}><Icon name="playNow" size={16} /> {t('pl.join.go')}</button>
        </form>
        <p className="muted" style={{ margin: 0 }}>{t('pl.lantab.bt')}</p>
      </section>
    </div>
  )
}
