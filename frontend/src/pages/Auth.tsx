import { useState } from 'react'
import { api } from '../api'
import type { User } from '../types'
import { errText, useI18n } from '../i18n'
import { SettingsButton } from './Settings'
import { Icon } from '../ui'

export default function Auth({ onLogin }: { onLogin: (u: User) => void }) {
  const { t } = useI18n()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      onLogin(mode === 'login' ? await api.login(username, password) : await api.register(username, password))
    } catch (e) {
      setErr(errText(t, e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="center hero">
      <form className="card authcard" onSubmit={submit}>
        <div className="row spread" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
          <div className="authbrand"><span className="authball"><Icon name="play" size={34} strokeWidth={1.6} /></span><h1 className="logo">Pitchside</h1></div>
          <SettingsButton />
        </div>
        <p className="muted" style={{ margin: 0 }}>{t('auth.tagline')}</p>
        <div className="modetabs" style={{ ['--n' as string]: 2 } as React.CSSProperties} role="group">
          <button type="button" aria-pressed={mode === 'login'} onClick={() => setMode('login')}><Icon name="login" size={20} /><span><b>{t('auth.login')}</b></span></button>
          <button type="button" aria-pressed={mode === 'register'} onClick={() => setMode('register')}><Icon name="hire" size={20} /><span><b>{t('auth.register')}</b></span></button>
        </div>
        <div className="field">
          <label htmlFor="u"><Icon name="user" size={13} /> {t('auth.username')}</label>
          <input id="u" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} required minLength={3} maxLength={24} />
        </div>
        <div className="field">
          <label htmlFor="p"><Icon name="key" size={13} /> {t('auth.password')}</label>
          <input id="p" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={e => setPassword(e.target.value)} required minLength={6} />
        </div>
        {mode === 'register' && <p className="muted" style={{ margin: 0, fontSize: 12 }}>{t('auth.rules')}</p>}
        {err && <p className="error">{err}</p>}
        <button className="primary big" disabled={busy}><Icon name={mode === 'login' ? 'login' : 'plus'} size={18} /> {busy ? t('wait') : mode === 'login' ? t('auth.login') : t('auth.create')}</button>
        {/* a friend joining a Wi-Fi match needs no account */}
        <a className="authjoin" href="#join"><Icon name="gamepad" size={16} /> {t('auth.joinWifi')}</a>
      </form>
    </div>
  )
}
