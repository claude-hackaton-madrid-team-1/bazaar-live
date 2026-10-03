import { describe, expect, it } from 'vitest'
import { nameOfRef } from './cards.ts'
import { GAME_STRINGS } from './strings.ts'
import { ago, itemOf, labelOf, parseDenial, percent, rarityOfRule, whoOf } from './humanize.ts'

describe('parseDenial', () => {
  it('reads the three shapes guardrails.check() prints', () => {
    expect(parseDenial('price 27 > max_price_uncommon 26')).toEqual({ shape: 'price', rule: 'max_price_uncommon', price: 27, cap: 26 })
    expect(parseDenial('cash 81 - 79 < cash_floor 50')).toEqual({ shape: 'cash', cash: 81, cost: 79, floor: 50 })
    expect(parseDenial('spend 128 + 24 > max_spend_per_game_hour 150')).toEqual({ shape: 'spend', rule: 'max_spend_per_game_hour', spent: 128, cost: 24, cap: 150 })
  })
  it('reads a dealer cap that lifted the rule', () => {
    expect(parseDenial('price 97 > dealer final cap 96 (max_price_rare 80 lifted)')).toEqual({ shape: 'price', rule: 'max_price_rare', price: 97, cap: 96 })
  })
  it('keeps decimals and gives up on anything else', () => {
    expect(parseDenial('cash 81.5 - 2.5 < cash_floor 50')).toMatchObject({ cash: 81.5, cost: 2.5 })
    expect(parseDenial('pause file present')).toBeNull()
    expect(parseDenial(null)).toBeNull()
  })
})

describe('whoOf', () => {
  it('names dealers, rivals, teams and venues', () => {
    expect(whoOf('abuela')).toEqual({ kind: 'dealer', name: 'Abuela Carmen' })
    expect(whoOf('chato')).toEqual({ kind: 'dealer', name: 'El Chato' })
    expect(whoOf('pilar')).toEqual({ kind: 'dealer', name: 'Doña Pilar' })
    expect(whoOf('rival_sol')).toEqual({ kind: 'rival', name: 'Rival Sol' })
    expect(whoOf('Rival Verde')).toEqual({ kind: 'rival', name: 'Rival Verde' })
    expect(whoOf('t06')).toEqual({ kind: 'team', n: 6 })
    expect(whoOf('v03')).toEqual({ kind: 'venue', n: 3 })
    expect(whoOf('meeddb221')).toEqual({ kind: 'other', name: 'meeddb221' })
  })
})

describe('itemOf', () => {
  it('names a card, a duel with its rival, a pack', () => {
    expect(itemOf('SAL-01')).toEqual({ kind: 'card', ref: 'SAL-01', name: 'Escaparate de Serrano' })
    expect(itemOf('duel:2513', (id) => (id === 2513 ? 'Rival Sol' : null))).toEqual({ kind: 'duel', id: 2513, rival: 'Rival Sol' })
    expect(itemOf('duel:9')).toEqual({ kind: 'duel', id: 9, rival: null })
    expect(itemOf('sobre_plata')).toEqual({ kind: 'pack', pack: 'plata' })
    expect(itemOf('rare')).toEqual({ kind: 'other', text: 'rare' })
  })
})

describe('nameOfRef', () => {
  it('knows every set of the catalog', () => {
    expect(['LAV-09', 'MAL-10', 'LAT-03', 'SAL-12', 'RET-11', 'CHA-06'].map(nameOfRef)).toEqual([
      'Cine Doré', 'Noche de Movida', 'Huevos Rotos', 'La Dama de Serrano', 'Palacio de Cristal', 'Estación de Chamberí',
    ])
    expect(nameOfRef('XYZ-01')).toBeNull()
    expect(nameOfRef('SAL-13')).toBeNull()
  })
})

describe('ago, percent, labels', () => {
  it('counts back from the newest tick, in seconds when a tick has a length', () => {
    expect(ago(630, 624, 30)).toEqual({ ticks: 6, seconds: 180 })
    expect(ago(630, 624, null)).toEqual({ ticks: 6, seconds: null })
    expect(ago(620, 624, 30)).toEqual({ ticks: 0, seconds: 0 })
  })
  it('turns shares into percentages and unknown ids into words', () => {
    expect(percent(0.29)).toBe(29)
    expect(percent(null)).toBeNull()
    expect(labelOf({ cash_floor: 'cash floor' }, 'cash_floor')).toBe('cash floor')
    expect(labelOf({}, 'max_counterparty_share')).toBe('max counterparty share')
    expect(rarityOfRule('max_price_uncommon')).toBe('uncommon')
    expect(rarityOfRule('cash_floor')).toBeNull()
  })
})

describe('the words in both languages', () => {
  const es = GAME_STRINGS.es.hum
  const en = GAME_STRINGS.en.hum
  it('says a denial as one sentence', () => {
    const cash = parseDenial('cash 81 - 79 < cash_floor 50')!
    expect(es.denial(cash)).toBe('nos dejaría con 2 P, por debajo del suelo de 50 P')
    expect(en.denial(cash)).toBe('would leave us 2 P, under the 50 P floor')
    expect(es.denial(parseDenial('price 27 > max_price_uncommon 26')!)).toBe('cuesta 27 P; nuestro tope para poco comunes es 26 P')
    expect(en.denial(parseDenial('spend 128 + 24 > max_spend_per_game_hour 150')!)).toBe('we would spend 152 P this game hour; the cap is 150 P')
  })
  it('names every agent, and says time as minutes', () => {
    expect([es.agents.taker, es.agents.maker, es.agents.duels]).toEqual(['Comprador', 'Vendedor', 'Duelos'])
    expect(es.ago(6, 180)).toBe('hace 3 min')
    expect(en.ago(1, 30)).toBe('30 s ago')
    expect(es.ago(0, 0)).toBe('ahora')
    expect(es.ago(4, null)).toBe('hace 4 turnos')
    expect(es.within(16, 480)).toBe('en ~8 min')
  })
  it('names who and what', () => {
    expect(es.who(whoOf('t06'))).toBe('Equipo 6')
    expect(en.who(whoOf('chato'))).toBe('El Chato')
    expect(es.item(itemOf('duel:2513', () => 'Rival Sol'))).toBe('duelo con Rival Sol')
    expect(es.item(itemOf('sobre_plata'))).toBe('sobre de plata')
    expect(es.jev('undecided', percent(0.29))).toBe('Jev: no lo ve claro (29 %)')
  })
})
