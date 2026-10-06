import { describe, expect, it } from 'vitest'
import { diagnosticar, LADO_CORTO_MINIMO, medir, NITIDEZ_MINIMA, tamanoDeSubida } from './foto'

// Una "factura" de prueba: papel blanco con rayas negras de 2 px cada 7
// (letras). El ancho es multiplo de 7 para que el patron de la vuelta.
const PERIODO = 7
function rayas(ancho: number, alto: number): Float32Array {
  const g = new Float32Array(ancho * alto)
  for (let y = 0; y < alto; y++) for (let x = 0; x < ancho; x++) g[y * ancho + x] = x % PERIODO < 2 ? 20 : 245
  return g
}

// La misma imagen, movida de lado: cada pixel promedia `2 * radio + 1`
// vecinos de su fila (dando la vuelta en los bordes).
function mover(g: Float32Array, ancho: number, radio: number): Float32Array {
  const s = new Float32Array(g.length)
  for (let i = 0; i < g.length; i++) {
    const fila = i - (i % ancho)
    let suma = 0
    for (let d = -radio; d <= radio; d++) suma += g[fila + ((((i % ancho) + d) % ancho) + ancho) % ancho]
    s[i] = suma / (2 * radio + 1)
  }
  return s
}

describe('tamanoDeSubida', () => {
  it('una hoja de telefono queda en ~4 MP, con la misma forma', () => {
    const t = tamanoDeSubida(3000, 4000)
    expect(t.ancho * t.alto).toBeLessThanOrEqual(4_200_000)
    expect(t.ancho * t.alto).toBeGreaterThan(4_000_000)
    expect(t.alto / t.ancho).toBeCloseTo(4 / 3, 2)
  })

  it('un ticket largo conserva su ancho (antes quedaba en 540 px)', () => {
    expect(tamanoDeSubida(1080, 3800)).toEqual({ ancho: 1080, alto: 3800 })
  })

  it('nunca agranda una foto chica', () => {
    expect(tamanoDeSubida(800, 600)).toEqual({ ancho: 800, alto: 600 })
  })
})

describe('revisar la foto', () => {
  const ancho = 126
  const alto = 80
  const nitida = rayas(ancho, alto)

  it('una foto nitida y con luz no tiene problemas', () => {
    expect(diagnosticar(medir(nitida, ancho, alto, 3000))).toEqual([])
  })

  it('movida: la nitidez se desploma por debajo del umbral', () => {
    const m = medir(mover(nitida, ancho, 3), ancho, alto, 3000)
    expect(m.nitidez).toBeLessThan(NITIDEZ_MINIMA)
    expect(diagnosticar(m)).toEqual(['movida'])
  })

  it('oscura', () => {
    const oscura = nitida.map((v) => v * 0.25)
    expect(diagnosticar(medir(oscura, ancho, alto, 3000))).toContain('oscura')
  })

  it('pequeña: una foto de WhatsApp (485 px) se avisa sin mirar la nitidez', () => {
    expect(diagnosticar(medir(nitida, ancho, alto, 485))).toEqual(['pequena'])
    expect(diagnosticar(medir(nitida, ancho, alto, LADO_CORTO_MINIMO))).toEqual([])
  })
})
