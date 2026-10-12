import { describe, expect, it } from 'vitest'
import { MUY_PARECIDO, PARECIDO_MINIMO, parecido, parecidos } from './parecidos'
import type { Ingrediente } from './types'

// Los nombres reales que convivían en producción (7-oct).
const PRODUCCION = [
  'Aceite Vatel Cocina', 'Carne Mechar', 'Crema de Leche Lata', 'Crema de Leche Liquida Apoyo', 'Crema de leche',
  'Disco (Masa)', 'Harina PAN', 'Harina de Trigo Leudante', 'MASA', 'Pollo', 'Refresco Pepsi Lata', 'Malta Lata 330ml',
]
const ings = PRODUCCION.map((nombre, id) => ({ id, nombre, unidad: 'kg', activo: true }) as Ingrediente)

describe('parecido', () => {
  it('los duplicados de producción se reconocen', () => {
    expect(parecido('crema de leche lata grande', 'Crema de Leche Lata')).toBeGreaterThanOrEqual(MUY_PARECIDO)
    expect(parecido('MASA', 'Disco (Masa)')).toBeGreaterThanOrEqual(MUY_PARECIDO)
    expect(parecido('Crema de leche', 'Crema de Leche Liquida Apoyo')).toBeGreaterThanOrEqual(MUY_PARECIDO)
  })

  it('tolera tildes, plurales y una letra de más', () => {
    expect(parecido('azúcar', 'Azucar')).toBe(1)
    expect(parecido('tomates', 'Tomate')).toBe(1)
    expect(parecido('tocinetta', 'Tocineta')).toBe(1)
  })

  it('lo que no tiene que ver no aparece', () => {
    expect(parecido('Pollo', 'Carne Mechar')).toBe(0)
    // "Lata" sola no hace a la Pepsi parecida a la Malta.
    expect(parecido('Refresco Pepsi Lata', 'Malta Lata 330ml')).toBeLessThan(PARECIDO_MINIMO)
  })
})

describe('parecidos', () => {
  it('trae los más parecidos primero', () => {
    const r = parecidos('crema leche', ings).map((x) => x.ing.nombre)
    expect(r[0]).toBe('Crema de leche')
    expect(r).toContain('Crema de Leche Lata')
    expect(r).not.toContain('Pollo')
  })

  it('las archivadas no cuentan', () => {
    expect(parecidos('pollo', [{ ...ings[9], activo: false }])).toEqual([])
  })
})
