import { createContext, useContext } from 'react'
import { DEFAULT_LANG, type Lang } from '../../shared/lang.ts'
import { STRINGS, type Strings } from './strings'

export const LangContext = createContext<Lang>(DEFAULT_LANG)

export function useLang(): Lang {
  return useContext(LangContext)
}

export function useStrings(): Strings {
  return STRINGS[useContext(LangContext)]
}
