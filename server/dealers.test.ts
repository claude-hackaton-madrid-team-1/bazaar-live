import { describe, expect, it } from 'vitest'
import { createDealerNames, dealersUrl, parseDealerNames } from './dealers.ts'
import { REAL_URL, SIM_URL } from './game/config.ts'

const BODY = {
  personas: [
    { id: 'abuela', name: 'Abuela Carmen', status: 'active' },
    { id: 'pilar', name: 'Doña Pilar', status: 'active' },
    { id: 'duquesa', name: 'La Duquesa', status: 'announced', level: null },
    { id: 'Bad Id', name: 'x' },
    { id: 'evil', name: '<script>alert(1)</script>' },
  ],
}

const answer = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

describe('dealer names', () => {
  it('reads id → name from the game, dropping anything that is not a plain id and name', () => {
    expect(parseDealerNames(BODY)).toEqual({ abuela: 'Abuela Carmen', pilar: 'Doña Pilar', duquesa: 'La Duquesa' })
    expect(parseDealerNames({ personas: 'no' })).toEqual({})
    expect(parseDealerNames(null)).toEqual({})
  })

  it('reads the game with no key, at most once per TTL, and keeps the last list when a read fails', async () => {
    const calls: { url: string; headers: unknown }[] = []
    let now = 0
    let fail = false
    const fetchImpl = ((url: string, init?: RequestInit) => {
      calls.push({ url, headers: init?.headers })
      return fail ? answer({ error: 'down' }, 503) : answer(BODY)
    }) as typeof fetch
    const names = createDealerNames({ url: REAL_URL, fetchImpl, now: () => now })
    expect(await names()).toMatchObject({ pilar: 'Doña Pilar' })
    expect(await names()).toMatchObject({ pilar: 'Doña Pilar' })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(`${REAL_URL}/api/dealers`)
    expect(JSON.stringify(calls[0]?.headers)).not.toMatch(/team-key/i)
    now += 6 * 60_000
    fail = true
    await names()
    await new Promise((r) => setTimeout(r, 0))
    expect(calls).toHaveLength(2)
    expect(await names()).toMatchObject({ pilar: 'Doña Pilar' })
  })

  it('reads the simulator only with BAZAAR_SIM=1', () => {
    expect(dealersUrl({})).toBe(REAL_URL)
    expect(dealersUrl({ BAZAAR_SIM: '1' })).toBe(SIM_URL)
    expect(dealersUrl({ BAZAAR_SIM: '0' })).toBe(REAL_URL)
  })
})
