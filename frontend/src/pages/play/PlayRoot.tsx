import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import type { User } from '../../types'
import { Loading } from '../../ui'
import { leavePlay, onRouteChange, parsePlayRoute, type PlayRoute } from './route'

// Entry point of the play modes, mounted by App with one line:
//   const playView = usePlayView(user, id); if (playView) return playView
// It shows the Wi-Fi guest page to anybody (no account needed) and the play hub to logged-in
// players, on top of the title screen or a career. The screens load on first use.

const PlayHub = lazy(() => import('./PlayHub'))
const JoinPage = lazy(() => import('./JoinPage'))

function useRoute(): PlayRoute {
  const [r, setR] = useState<PlayRoute>(parsePlayRoute)
  useEffect(() => onRouteChange(() => setR(parsePlayRoute())), [])
  return r
}

/** The play screen to show instead of the app, or null. user: undefined while loading, null when logged out. */
export function usePlayView(user: User | null | undefined, careerId: number | null): ReactNode {
  const r = useRoute()
  if (!r) return null
  const wrap = (n: ReactNode) => <Suspense fallback={<div className="center"><Loading /></div>}>{n}</Suspense>
  if (r.view === 'join') return wrap(<JoinPage initialCode={r.code} onExit={() => leavePlay(careerId ? 'match' : '')} />)
  if (!user) return null // log in first: the app shows the login page, then comes back here
  return wrap(<PlayHub user={user} careerId={careerId} tab={r.tab} onExit={() => leavePlay(careerId ? 'match' : '')} />)
}
