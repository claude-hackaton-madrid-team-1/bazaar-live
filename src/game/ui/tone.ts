/** The class for a signed number: good above zero, bad below, muted at zero or unknown. */
export const toneOf = (v: number | null | undefined): string => (v == null || v === 0 ? 'gm-muted' : v > 0 ? 'gm-good' : 'gm-bad')
