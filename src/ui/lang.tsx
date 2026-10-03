import type { ReactNode } from 'react'
import type { Lang } from '../../shared/lang.ts'
import { LangContext } from './langContext'

/** The show's language for every label below it (the dialogue itself comes from the engine). */
export function LangProvider({ lang, children }: { readonly lang: Lang; readonly children: ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>
}
