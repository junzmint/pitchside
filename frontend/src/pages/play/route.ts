// Routes of the play modes. They live in the address so a link can open them from anywhere:
//   #play/quick  #play/lan  #play/training     the play hub (logged in; inside a career too)
//   /join  /join/ABCD  #join  #join/ABCD        the Wi-Fi guest page (no account needed)
// Any page can link to them with <a href="#play/training"> or goPlay('training').

export type PlayTab = 'quick' | 'lan' | 'training'
export type PlayRoute = { view: 'join'; code: string } | { view: 'hub'; tab: PlayTab } | null

const CODE = /^[A-Z0-9]{0,4}$/

export function parsePlayRoute(): PlayRoute {
  if (typeof location === 'undefined') return null
  const path = location.pathname.replace(/\/+$/, '')
  const hash = location.hash.replace(/^#\/?/, '')
  const code = (s: string) => { const c = decodeURIComponent(s || '').toUpperCase().slice(0, 4); return CODE.test(c) ? c : '' }
  const jp = path.match(/^\/join(?:\/([^/]*))?$/i)
  if (jp) return { view: 'join', code: code(jp[1] ?? new URLSearchParams(location.search).get('c') ?? '') }
  const jh = hash.match(/^join(?:[/=]([^/]*))?$/i)
  if (jh) return { view: 'join', code: code(jh[1] ?? '') }
  const ph = hash.match(/^play(?:\/(quick|lan|training))?$/i)
  if (ph) return { view: 'hub', tab: ((ph[1] ?? 'quick').toLowerCase()) as PlayTab }
  return null
}

const EVT = 'pitchside:route'

/** Open the play hub on a tab. */
export function goPlay(tab: PlayTab = 'quick') {
  location.hash = 'play/' + tab
}

/** Open the Wi-Fi guest page (optionally with a code). */
export function goJoin(code = '') {
  location.hash = 'join' + (code ? '/' + code : '')
}

/** Leave the play screens: back to the page underneath (a career tab, or the title screen). */
export function leavePlay(hash = '') {
  const path = /^\/join/i.test(location.pathname) ? '/' : location.pathname
  history.replaceState(null, '', path + location.search.replace(/[?&]c=[^&]*/, '') + (hash ? '#' + hash : ''))
  window.dispatchEvent(new Event(EVT))
  if (hash) window.dispatchEvent(new HashChangeEvent('hashchange'))
}

export function onRouteChange(fn: () => void) {
  window.addEventListener('hashchange', fn)
  window.addEventListener('popstate', fn)
  window.addEventListener(EVT, fn)
  return () => {
    window.removeEventListener('hashchange', fn)
    window.removeEventListener('popstate', fn)
    window.removeEventListener(EVT, fn)
  }
}
