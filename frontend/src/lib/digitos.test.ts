import { expect, test } from 'vitest'
import { agregarDigito } from './digitos'

test('referencia, banco, teléfono y PIN conservan todos los ceros iniciales', () => {
  for (const esperado of ['001234', '0102', '04141234567', '0000']) {
    expect([...esperado].reduce((valor, d) => agregarDigito(valor, d, true), '')).toBe(esperado)
  }
})

test('una cantidad sigue reemplazando el cero inicial', () => {
  expect(agregarDigito('0', '5', false)).toBe('5')
  expect(agregarDigito('10', '5', false)).toBe('105')
})
