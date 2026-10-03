/**
 * The show's language, as one small shared module: the current language, a way to change it, and a way
 * to listen. The selector in the header sets it; the engine, the voices and the labels follow it (and so
 * does anything else that reads the show's language, such as the real-transcript path).
 *
 * Order of precedence at start: `?lang=es|en`, then what the visitor chose last time (localStorage), then
 * castellano. Choosing in the selector writes both back (the URL without a reload, and the storage), and
 * every storage access is guarded: private windows and blocked storage must not break the page.
 */
import { useSyncExternalStore } from 'react'
import { DEFAULT_LANG, isLang, parseLang, type Lang } from '../../shared/lang.ts'
import { STRINGS, type Strings } from './strings'

export const LANG_STORAGE_KEY = 'bazaar-live.lang'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface LangStore {
  get(): Lang
  /** Changes the language (and remembers it); every subscriber is told once, only when it really changed. */
  set(lang: Lang): void
  subscribe(listener: (lang: Lang) => void): () => void
}

export interface LangEnv {
  /** `location.search`, e.g. `?mock=1&lang=en`. */
  readonly search?: string
  readonly storage?: StorageLike | null
  /** Called with the search string to show after a change (the page replaces the URL without a reload). */
  readonly writeSearch?: (search: string) => void
}

/** The language a visit starts in: the URL, then the stored choice, then the default. */
export function startLang(env: LangEnv): Lang {
  const fromUrl = new URLSearchParams(env.search ?? '').get('lang')
  if (fromUrl !== null && isLang(fromUrl.trim().toLowerCase().slice(0, 2))) return parseLang(fromUrl)
  try {
    const stored = env.storage?.getItem(LANG_STORAGE_KEY)
    if (stored && isLang(stored)) return stored
  } catch {
    // blocked storage: fall through to the default
  }
  return DEFAULT_LANG
}

export function createLangStore(env: LangEnv = {}): LangStore {
  let current = startLang(env)
  const listeners = new Set<(lang: Lang) => void>()
  return {
    get: () => current,
    set(lang) {
      if (!isLang(lang) || lang === current) return
      current = lang
      try {
        env.storage?.setItem(LANG_STORAGE_KEY, lang)
      } catch {
        // blocked storage: the choice just is not remembered
      }
      if (env.writeSearch) {
        const params = new URLSearchParams(env.search ?? '')
        params.set('lang', lang)
        env.writeSearch(`?${params.toString()}`)
      }
      listeners.forEach((l) => l(lang))
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

function safeStorage(): StorageLike | null {
  try {
    return window.localStorage
  } catch {
    return null // a blocked or sandboxed storage throws on access
  }
}

function browserEnv(): LangEnv {
  if (typeof window === 'undefined') return {}
  return {
    search: window.location.search,
    storage: safeStorage(),
    writeSearch: (search) => {
      try {
        window.history.replaceState(null, '', `${window.location.pathname}${search}${window.location.hash}`)
      } catch {
        // a sandboxed frame may refuse: the language still changes
      }
    },
  }
}

let shared: LangStore | null = null

/** The page's one language store (created on first use from the real URL and storage). */
export function langStore(): LangStore {
  shared ??= createLangStore(browserEnv())
  return shared
}

export const getLang = (): Lang => langStore().get()
export const setLang = (lang: Lang): void => langStore().set(lang)
export const subscribeLang = (listener: (lang: Lang) => void): (() => void) => langStore().subscribe(listener)

/** The current language; the component re-renders when the selector changes it. */
export function useLang(): Lang {
  return useSyncExternalStore((cb) => subscribeLang(cb), getLang, () => DEFAULT_LANG)
}

export function useStrings(): Strings {
  return STRINGS[useLang()]
}
