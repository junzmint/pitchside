import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { I18nProvider } from './i18n'
import './styles.css'
import './game.css'
import './live.css'
import './events.css'
import './explore.css'
import './stage.css'
import './club.css'
import './play.css'
import './kits.css'
import './staff.css'
import './medical.css'

// After a rebuild, a page that was already open asks for code chunks that no longer exist.
// Reload once to pick up the new build (at most once a minute, so it can never loop).
window.addEventListener('vite:preloadError', () => {
  try {
    const last = Number(sessionStorage.getItem('pitchside.reloadedAt') || 0)
    if (Date.now() - last < 60_000) return
    sessionStorage.setItem('pitchside.reloadedAt', String(Date.now()))
  } catch { /* storage unavailable: reload anyway */ }
  location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
)
