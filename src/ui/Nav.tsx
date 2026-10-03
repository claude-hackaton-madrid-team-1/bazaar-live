import { motion, useReducedMotion } from 'motion/react'
import type { MouseEvent } from 'react'
import { GAME_STRINGS } from '../game/strings'
import { useLang } from './lang'
import { hrefOf, navigate, ROUTES, useRoute, type Route } from './route'
import './nav.css'

/** The screens, as a segmented control inside the header: the show, then the game screens. */
export function Nav() {
  const route = useRoute()
  const t = GAME_STRINGS[useLang()]
  const reduce = useReducedMotion()
  const go = (r: Route) => (e: MouseEvent<HTMLAnchorElement>) => {
    // a new tab or window keeps the browser's own behaviour
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    e.preventDefault()
    navigate(r)
  }
  return (
    <nav className="nav" aria-label={t.navLabel}>
      {ROUTES.map((r) => (
        <a key={r} href={hrefOf(r, window.location.search)} title={t.navHint[r]} aria-current={r === route ? 'page' : undefined} onClick={go(r)}>
          {r === route && <motion.span layoutId="nav-thumb" className="nav-thumb" transition={reduce ? { duration: 0 } : { type: 'spring', bounce: 0, duration: 0.36 }} />}
          <span className="nav-label">{t.nav[r]}</span>
        </a>
      ))}
    </nav>
  )
}
