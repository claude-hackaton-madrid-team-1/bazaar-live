import { useEffect, useState, type RefObject } from 'react'

/** A chart's own width in CSS pixels, so its labels stay readable from a phone to a wide screen. */
export function useWidth(ref: RefObject<HTMLElement | null>, fallback: number): number {
  const [w, setW] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => e && setW(Math.max(240, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return w
}
