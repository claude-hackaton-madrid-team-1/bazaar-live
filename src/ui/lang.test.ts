import { describe, expect, it, vi } from 'vitest'
import { createLangStore, LANG_STORAGE_KEY, startLang, type StorageLike } from './lang'

const memoryStorage = (initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } => {
  const data = { ...initial }
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) }
}

const brokenStorage: StorageLike = {
  getItem: () => {
    throw new Error('SecurityError')
  },
  setItem: () => {
    throw new Error('QuotaExceededError')
  },
}

describe('startLang: URL, then the stored choice, then castellano', () => {
  it('prefers ?lang= over what was stored', () => {
    expect(startLang({ search: '?lang=en', storage: memoryStorage({ [LANG_STORAGE_KEY]: 'es' }) })).toBe('en')
    expect(startLang({ search: '?mock=1&lang=ES-es', storage: memoryStorage({ [LANG_STORAGE_KEY]: 'en' }) })).toBe('es')
  })

  it('uses the stored choice when the URL says nothing, and ignores an unknown language in either place', () => {
    expect(startLang({ search: '', storage: memoryStorage({ [LANG_STORAGE_KEY]: 'en' }) })).toBe('en')
    expect(startLang({ search: '?lang=fr', storage: memoryStorage({ [LANG_STORAGE_KEY]: 'en' }) })).toBe('en')
    expect(startLang({ search: '', storage: memoryStorage({ [LANG_STORAGE_KEY]: 'klingon' }) })).toBe('es')
  })

  it('defaults to castellano, also with no storage at all or with storage that throws', () => {
    expect(startLang({})).toBe('es')
    expect(startLang({ storage: null })).toBe('es')
    expect(startLang({ storage: brokenStorage })).toBe('es')
  })
})

describe('createLangStore', () => {
  it('changes the language once, remembers it, and tells every subscriber', () => {
    const storage = memoryStorage()
    const store = createLangStore({ search: '?mock=1', storage })
    const heard: string[] = []
    const stop = store.subscribe((l) => heard.push(l))
    expect(store.get()).toBe('es')
    store.set('en')
    store.set('en') // no change: nobody is told twice
    expect(store.get()).toBe('en')
    expect(heard).toEqual(['en'])
    expect(storage.data[LANG_STORAGE_KEY]).toBe('en')
    stop()
    store.set('es')
    expect(heard).toEqual(['en'])
  })

  it('writes the language back to the URL without losing the other parameters', () => {
    const writes: string[] = []
    const store = createLangStore({ search: '?mock=1&speed=2', storage: memoryStorage(), writeSearch: (s) => writes.push(s) })
    store.set('en')
    expect(writes).toEqual(['?mock=1&speed=2&lang=en'])
    store.set('es')
    expect(writes.at(-1)).toBe('?mock=1&speed=2&lang=es')
  })

  it('still switches when storage throws (a private window)', () => {
    const store = createLangStore({ storage: brokenStorage })
    const listener = vi.fn()
    store.subscribe(listener)
    expect(() => store.set('en')).not.toThrow()
    expect(store.get()).toBe('en')
    expect(listener).toHaveBeenCalledWith('en')
  })

  it('refuses a language that does not exist', () => {
    const store = createLangStore({})
    store.set('fr' as never)
    expect(store.get()).toBe('es')
  })

  it('the next visit starts in the language the visitor chose', () => {
    const storage = memoryStorage()
    createLangStore({ search: '', storage }).set('en')
    expect(createLangStore({ search: '', storage }).get()).toBe('en')
  })
})
