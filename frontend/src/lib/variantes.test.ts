import { describe, expect, it } from 'vitest'
import { esVarianteSinNombre } from './variantes'

describe('esVarianteSinNombre', () => {
  it('la Regular que nace con el producto no tiene nombre propio', () => {
    expect(esVarianteSinNombre('Regular', 'Agua sparkling 500ml')).toBe(true)
    expect(esVarianteSinNombre(' regular ', 'Agua')).toBe(true)
    expect(esVarianteSinNombre('', 'Agua')).toBe(true)
    expect(esVarianteSinNombre('Agua sparkling 500ml', 'Agua sparkling 500ml')).toBe(true)
  })
  it('un sabor que queda solo se sigue viendo', () => {
    expect(esVarianteSinNombre('toronja', 'Agua sparkling 500ml')).toBe(false)
    expect(esVarianteSinNombre('Sabor Limon', 'Agua sparkling 500ml')).toBe(false)
  })
})
