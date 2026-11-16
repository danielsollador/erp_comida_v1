import { describe, expect, it } from 'vitest'
import { tasaDeConteo } from './tasaCobro'

describe('tasaDeConteo', () => {
  it('con dos tasas el mismo dia usa la de los cobros y la gaveta exacta cuadra', () => {
    // $2,90 a 914,0218 + $2,90 a 1.010,56 = 5.581,28 Bs en la gaveta; esperado $5,80
    const tasa = tasaDeConteo({ tasa_cobros: 5581.2872 / 5.8 }, 1010.56)
    expect(Math.round((5581.28 / tasa) * 100) / 100).toBe(5.8)
  })

  it('con una sola tasa todo el dia es esa tasa', () => {
    expect(tasaDeConteo({ tasa_cobros: 1010.56 }, 914.0218)).toBe(1010.56)
  })

  it('sin cobros del dia usa la tasa de cobro de hoy', () => {
    expect(tasaDeConteo({ tasa_cobros: null }, 1010.56)).toBe(1010.56)
    expect(tasaDeConteo({}, 914.0218)).toBe(914.0218)
  })

  it('sin ninguna tasa devuelve cero para que esa forma no viaje', () => {
    expect(tasaDeConteo({ tasa_cobros: null }, null)).toBe(0)
  })
})
