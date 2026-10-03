/**
 * The game screens: our agent, our strategy, negotiations, duels, album, the rivals' albums, market, our cash's movements, what our agents learned and
 * the raw stream, fed by the server's relay of the game (or the mock game with `?mock=1`). Loaded on demand: the
 * show never pays for it.
 */
import { MotionConfig } from 'motion/react'
import { useEffect, useState, type ReactElement } from 'react'
import { readConfig } from '../../config'
import type { Route } from '../../ui/route'
import { GameContext, GameStore } from '../store.ts'
import { AgentScreen } from './AgentScreen.tsx'
import { AlbumScreen } from './AlbumScreen.tsx'
import { DebugScreen } from './DebugScreen.tsx'
import { DuelsScreen } from './DuelsScreen.tsx'
import { CashDock, GameHeader, GameNotice } from './GameHeader.tsx'
import { HistoryScreen } from './HistoryScreen.tsx'
import { Inspector } from './Inspector.tsx'
import { LearnScreen } from './LearnScreen.tsx'
import { MarketScreen } from './MarketScreen.tsx'
import { OurMarketScreen } from './OurMarketScreen.tsx'
import { NegotiationsScreen } from './NegotiationsScreen.tsx'
import { RivalsScreen } from './RivalsScreen.tsx'
import { StrategyScreen } from './StrategyScreen.tsx'
import './game.css'

const SCREENS: Readonly<Record<Exclude<Route, 'show'>, () => ReactElement>> = {
  agent: () => <AgentScreen />,
  strategy: () => <StrategyScreen />,
  negotiations: () => <NegotiationsScreen />,
  duels: () => <DuelsScreen />,
  album: () => <AlbumScreen />,
  rivals: () => <RivalsScreen />,
  market: () => <MarketScreen />,
  ourmarket: () => <OurMarketScreen />,
  history: () => <HistoryScreen />,
  learn: () => <LearnScreen />,
  debug: () => <DebugScreen />,
}

export default function GameApp({ route }: { route: Exclude<Route, 'show'> }) {
  const [store] = useState(() => new GameStore())
  useEffect(() => {
    const config = readConfig(window.location.search)
    store.start({ mock: config.mock, speed: config.speed, token: new URLSearchParams(window.location.search).get('token') })
    return () => store.stop()
  }, [store])
  return (
    <GameContext.Provider value={store}>
      <MotionConfig reducedMotion="user">
        <div className="app gm-app">
          <GameHeader />
          <CashDock />
          <GameNotice />
          <main className="gm-main">{SCREENS[route]()}</main>
          <Inspector />
        </div>
      </MotionConfig>
    </GameContext.Provider>
  )
}
