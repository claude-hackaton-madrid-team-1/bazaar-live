import { describe, expect, it } from 'vitest'
import { poolOptions, readShowDatabase, secretsOf } from './pg.ts'

const URL_OK = 'postgresql://bazaar_live_reader:s3cr3t-pw@db.example.internal:5432/railway'

describe('readShowDatabase', () => {
  it('is off when the variable is absent or blank', () => {
    expect(readShowDatabase({})).toEqual({ enabled: false, reason: 'absent' })
    expect(readShowDatabase({ SHOW_DATABASE_URL: '   ' })).toEqual({ enabled: false, reason: 'absent' })
  })
  it('is off, without echoing the value, when it is not a postgres url', () => {
    const out = readShowDatabase({ SHOW_DATABASE_URL: 'mysql://user:pw@host/db' })
    expect(out).toEqual({ enabled: false, reason: 'not_postgres' })
    expect(JSON.stringify(readShowDatabase({ SHOW_DATABASE_URL: 'garbage with a-secret' }))).not.toContain('a-secret')
  })
  it('accepts postgres:// and postgresql://', () => {
    expect(readShowDatabase({ SHOW_DATABASE_URL: URL_OK })).toMatchObject({ enabled: true, url: URL_OK })
    expect(readShowDatabase({ SHOW_DATABASE_URL: URL_OK.replace('postgresql', 'postgres') }).enabled).toBe(true)
  })
})

describe('poolOptions', () => {
  it('is a tiny pool with a 2 s statement timeout', () => {
    const o = poolOptions(URL_OK)
    expect(o).toMatchObject({ max: 2, statement_timeout: 2000, connectionString: URL_OK })
    expect(o.query_timeout).toBeLessThanOrEqual(5000)
    expect(o.connectionTimeoutMillis).toBeLessThanOrEqual(10_000)
  })
})

describe('secretsOf', () => {
  it('lists what must never be logged: the url, host, user and password', () => {
    const secrets = secretsOf(URL_OK)
    expect(secrets).toEqual(expect.arrayContaining([URL_OK, 'db.example.internal', 's3cr3t-pw', 'bazaar_live_reader']))
  })
  it('survives an unparseable url', () => {
    expect(secretsOf('nonsense')).toEqual(['nonsense'])
  })
})
