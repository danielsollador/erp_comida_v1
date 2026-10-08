import { describe, expect, it } from 'vitest'
import { unidadDe } from './inventario'

describe('unidadDe', () => {
  it('pone la unidad en plural cuando no es una', () => {
    expect(unidadDe(1, 'unidad')).toBe('unidad')
    expect(unidadDe(18, 'unidad')).toBe('unidades')
    expect(unidadDe(0.5, 'unidad')).toBe('unidades')
    expect(unidadDe(0, 'unidad')).toBe('unidades')
    expect(unidadDe(-1, 'unidad')).toBe('unidad')
    expect(unidadDe(2, 'paquete')).toBe('paquetes')
  })

  it('deja los símbolos como están', () => {
    expect(unidadDe(10, 'kg')).toBe('kg')
    expect(unidadDe(2, 'lt')).toBe('lt')
    expect(unidadDe(500, 'g')).toBe('g')
  })
})
