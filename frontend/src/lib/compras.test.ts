import { describe, expect, it } from 'vitest'
import { conversion, diasDesde, nombreDesdePapel, sugerirMercancia, unidadDistinta, unidadNuestra } from './compras'
import type { Ingrediente } from './types'

// Solo importa el nombre para sugerir: el resto de la ficha da igual.
const mercancia = (id: number, nombre: string) => ({ id, nombre }) as Ingrediente

const inventario = [
  mercancia(1, 'Refresco concentrado'),
  mercancia(2, 'Harina de trigo'),
  mercancia(3, 'Queso blanco'),
  mercancia(4, 'Queso amarillo'),
]

describe('sugerirMercancia', () => {
  it('propone la que se parece al renglón del papel', () => {
    expect(sugerirMercancia('HARINA TRIGO 1KG', inventario)?.id).toBe(2)
    expect(sugerirMercancia('QUESO BLANCO DURO', inventario)?.id).toBe(3)
  })

  it('no confunde "con" con "concentrado" (pasó con un suéter)', () => {
    expect(sugerirMercancia('621200004633 SUETER CON TEXTURA UNICOLOR 04633', inventario)).toBeNull()
  })

  it('con un empate no adivina', () => {
    expect(sugerirMercancia('QUESO', inventario)).toBeNull()
  })

  it('compara sin tildes ni mayúsculas, y por prefijo entre palabras largas', () => {
    expect(sugerirMercancia('HARIN TRIGÓ', inventario)?.id).toBe(2)
  })
})

describe('nombreDesdePapel', () => {
  it('quita el código de artículo y la marca de exento', () => {
    expect(nombreDesdePapel('GASNK0040172 NARU MANI MIXTO 0,090 KG. (E)')).toBe('Naru mani mixto 0,090 kg.')
  })

  it('deja el nombre tal cual si no trae código', () => {
    expect(nombreDesdePapel('HARINA PAN 1KG')).toBe('Harina pan 1kg')
  })
})

describe('unidades', () => {
  it('traduce la unidad del papel a la nuestra', () => {
    expect(unidadNuestra('KGS')).toBe('kg')
    expect(unidadNuestra('UND.')).toBe('unidad')
    expect(unidadNuestra('BULTO')).toBe('')
  })

  it('avisa cuando la unidad del papel no es la de la mercancía', () => {
    expect(unidadDistinta('UND', 'unidad')).toBe(false)
    expect(unidadDistinta('BULTO', 'kg')).toBe(true)
    expect(unidadDistinta('', 'kg')).toBe(false)
  })

  it('dice la conversión solo si no es uno a uno', () => {
    expect(conversion(20, 'BULTO', 'kg')).toBe('1 BULTO = 20 kg')
    expect(conversion(1, 'KG', 'kg')).toBe('')
  })
})

describe('diasDesde', () => {
  it('cuenta días enteros, sin correrse por la hora', () => {
    expect(diasDesde('2026-09-28', '2026-10-01')).toBe(3)
    expect(diasDesde('2026-10-02', '2026-10-01')).toBe(-1)
  })
})
