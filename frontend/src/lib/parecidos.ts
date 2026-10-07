import type { Ingrediente } from './types'

/**
 * Las mercancías que se PARECEN a un nombre, para avisar antes de crear otra.
 *
 * En producción convivían "Crema de Leche Lata", "Crema de Leche Liquida
 * Apoyo" y "Crema de leche"; "MASA" al lado de "Disco (Masa)". El servidor
 * ya rechaza los nombres IGUALES; esto atrapa los parecidos mientras se
 * escribe, que es donde se decide.
 *
 * Por palabras y no por letras: "crema de leche lata grande" y "Crema de
 * Leche Lata" comparten tres de cuatro palabras y son lo mismo, aunque letra
 * a letra difieran bastante. Una palabra empata con otra si es igual, si una
 * empieza por la otra (4+ letras: "harin" con "harina"), si es su plural, o si
 * difiere en una letra (6+ letras: el dedo en el teléfono).
 */

// Palabras que no dicen qué es la cosa.
const VACIAS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'con', 'sin', 'en', 'y', 'x', 'para', 'a'])

export function palabrasDe(texto: string): string[] {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .split(' ')
    .filter((p) => p && !VACIAS.has(p))
}

function unaLetra(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  let j = 0
  let cambios = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++
      j++
      continue
    }
    if (++cambios > 1) return false
    if (a.length > b.length) i++
    else if (b.length > a.length) j++
    else {
      i++
      j++
    }
  }
  return cambios + (a.length - i) + (b.length - j) <= 1
}

function empatan(a: string, b: string): boolean {
  if (a === b) return true
  if (a + 's' === b || b + 's' === a || a + 'es' === b || b + 'es' === a) return true
  if (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a))) return true
  return Math.min(a.length, b.length) >= 6 && unaLetra(a, b)
}

/** De 0 a 1: cuánto se parecen dos nombres. */
export function parecido(a: string, b: string): number {
  const pa = palabrasDe(a)
  const pb = palabrasDe(b)
  if (pa.length === 0 || pb.length === 0) return 0
  const comunesA = pa.filter((x) => pb.some((y) => empatan(x, y))).length
  const comunesB = pb.filter((y) => pa.some((x) => empatan(x, y))).length
  // Dice: las palabras en común sobre todas.
  const dice = (comunesA + comunesB) / (pa.length + pb.length)
  // Uno contenido entero en el otro ("Masa" en "Disco (Masa)") es casi
  // siempre la misma cosa con más detalle.
  const contenido = comunesA === pa.length || comunesB === pb.length
  return contenido ? Math.max(dice, 0.75) : dice
}

export const PARECIDO_MINIMO = 0.4
/** Desde aquí se pide confirmar antes de crear: casi seguro es la misma. */
export const MUY_PARECIDO = 0.75

export function parecidos(nombre: string, ingredientes: Ingrediente[], max = 4): { ing: Ingrediente; puntos: number }[] {
  if (palabrasDe(nombre).length === 0) return []
  return ingredientes
    .filter((i) => i.activo !== false)
    .map((ing) => ({ ing, puntos: parecido(nombre, ing.nombre) }))
    .filter((x) => x.puntos >= PARECIDO_MINIMO)
    .sort((a, b) => b.puntos - a.puntos)
    .slice(0, max)
}
