/**
 * The page's screens, by path: the show at `/`, and the game screens (our agent, our strategy, negotiations, duels, album,
 * market, our cash's movements, what our agents learned, the raw stream) beside it. The server answers every path with the
 * same page (SPA fallback), so this only reads and writes `location`. Moving between screens keeps the
 * query (`?mock=1`, `?lang=`, `?theme=`, `?token=`) and drops what belongs to one screen (`?id=`, the
 * selected thread).
 */
import { useSyncExternalStore } from 'react'

export type Route = 'show' | 'agent' | 'strategy' | 'negotiations' | 'duels' | 'album' | 'market' | 'history' | 'learn' | 'debug'

export const ROUTES: readonly Route[] = ['show', 'agent', 'strategy', 'negotiations', 'duels', 'album', 'market', 'history', 'learn', 'debug']

export const PATHS: Readonly<Record<Route, string>> = {
  show: '/',
  agent: '/agent',
  strategy: '/strategy',
  negotiations: '/negotiations',
  duels: '/duels',
  album: '/album',
  market: '/market',
  history: '/history',
  learn: '/learn',
  debug: '/debug',
}

/** Query parameters that belong to one screen and are dropped when moving to another. */
const LOCAL_PARAMS = ['id']

const CHANGE = 'bazaar:route'

/** The screen for a path: trailing slashes do not matter, an unknown path is the show. */
export function routeOf(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/'
  return ROUTES.find((r) => PATHS[r] === path) ?? 'show'
}

/** The href of a screen from the current search: the shared parameters kept, the screen's own dropped. */
export function hrefOf(route: Route, search: string): string {
  const params = new URLSearchParams(search)
  LOCAL_PARAMS.forEach((p) => params.delete(p))
  const query = params.toString()
  return `${PATHS[route]}${query ? `?${query}` : ''}`
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('popstate', listener)
  window.addEventListener(CHANGE, listener)
  return () => {
    window.removeEventListener('popstate', listener)
    window.removeEventListener(CHANGE, listener)
  }
}

export function navigate(route: Route): void {
  const href = hrefOf(route, window.location.search)
  if (href === `${window.location.pathname}${window.location.search}`) return
  window.history.pushState(null, '', href)
  window.dispatchEvent(new Event(CHANGE))
  window.scrollTo({ top: 0 })
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, () => routeOf(window.location.pathname), () => 'show' as Route)
}

/** One query parameter, live. */
export function useParam(name: string): string | null {
  return useSyncExternalStore(subscribe, () => new URLSearchParams(window.location.search).get(name), () => null)
}

/** Sets (or, with null, removes) a query parameter in place, without a new history entry. */
export function setParam(name: string, value: string | null): void {
  const url = new URL(window.location.href)
  if (value === null) url.searchParams.delete(name)
  else url.searchParams.set(name, value)
  window.history.replaceState(null, '', url)
  window.dispatchEvent(new Event(CHANGE))
}
