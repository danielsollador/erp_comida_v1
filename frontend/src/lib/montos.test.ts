import { describe, expect, it } from 'vitest'
import { leerMonto, montoO0, normalizarTecleo } from './montos'

describe('leerMonto (QA de noviembre, R1)', () => {
  it('lee como en Venezuela: «17.922» Bs en Compras es diecisiete mil, no 17,92', () => {
    expect(leerMonto('17.922')).toBe(17922)
    expect(leerMonto('17.922,45')).toBe(17922.45)
    expect(leerMonto('17922,45')).toBe(17922.45)
    expect(leerMonto('17922.45')).toBe(17922.45)
  })

  it('«5.000» Bs contados en el cierre son cinco mil', () => {
    expect(leerMonto('5.000')).toBe(5000)
    expect(leerMonto('1.250.000')).toBe(1250000)
    expect(leerMonto('Bs 2.240,31')).toBe(2240.31)
    expect(leerMonto('$ 3,08')).toBe(3.08)
  })

  it('lo que el sistema prellena con punto decimal se sigue leyendo bien', () => {
    expect(leerMonto('2240.31')).toBe(2240.31)
    expect(leerMonto('896.1225')).toBe(896.1225)
    expect(leerMonto('0.500')).toBe(0.5)
    expect(leerMonto(12.5)).toBe(12.5)
  })

  it('en una cantidad, un punto con tres digitos es decimal', () => {
    expect(leerMonto('1.250', { miles: false })).toBe(1.25)
    expect(leerMonto('1.234,5', { miles: false })).toBe(1234.5)
  })

  it('lo ilegible no es cero escondido', () => {
    expect(leerMonto('')).toBeNaN()
    expect(leerMonto('abc')).toBeNaN()
    expect(montoO0('abc')).toBe(0)
    expect(leerMonto('-5,5')).toBe(-5.5)
  })
})

describe('normalizarTecleo', () => {
  it('reescribe mientras se teclea sin perder lo que falta por escribir', () => {
    expect(normalizarTecleo('5.000')).toBe('5000')
    expect(normalizarTecleo('5.00')).toBe('5.00')
    expect(normalizarTecleo('17,')).toBe('17.')
    expect(normalizarTecleo('2.240,31')).toBe('2240.31')
    expect(normalizarTecleo('20,5')).toBe('20.5')
    expect(normalizarTecleo('150')).toBe('150')
  })
})
