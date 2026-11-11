import { describe, expect, it } from 'vitest'
import { porCategoria } from './comandas'

describe('porCategoria', () => {
  // Cafes = 1, Pastelitos = 2, Jugos = 3, en ese orden en el menu.
  const categoria = new Map([[10, 1], [11, 1], [20, 2], [21, 2], [30, 3]])
  const de = (v: number) => categoria.get(v)
  const r = (variante_id: number | null, nombre: string) => ({ variante_id, nombre })

  it('junta los cafes y los pastelitos aunque se hayan pedido mezclados', () => {
    const pedido = [r(10, 'Cafe con leche'), r(20, 'Pastelito Granjero'), r(30, 'Fresa'), r(11, 'Marron'), r(21, 'Pastelito Pollo'), r(10, 'Cafe grande')]
    expect(porCategoria(pedido, de, [1, 2, 3]).map((i) => i.nombre)).toEqual([
      'Cafe con leche', 'Marron', 'Cafe grande', 'Pastelito Granjero', 'Pastelito Pollo', 'Fresa',
    ])
  })

  it('sigue el orden del menu y deja al final lo que no esta en el', () => {
    const pedido = [r(null, 'Delivery'), r(30, 'Fresa'), r(99, 'Retirado'), r(20, 'Pastelito')]
    expect(porCategoria(pedido, de, [3, 2, 1]).map((i) => i.nombre)).toEqual(['Fresa', 'Pastelito', 'Delivery', 'Retirado'])
  })

  it('no cambia el pedido original', () => {
    const pedido = [r(20, 'Pastelito'), r(10, 'Cafe')]
    porCategoria(pedido, de, [1, 2])
    expect(pedido[0].nombre).toBe('Pastelito')
  })
})
