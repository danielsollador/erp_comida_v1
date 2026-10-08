import type { DatosIngrediente, Ingrediente, MovimientoInventario, CompraDeInsumo } from './types'

/** Lo que comparten las pantallas de Inventario: formatos, estados y la ficha mínima. */

export const cantidad = (n: number) => String(Number(n.toFixed(2)))

/**
 * La unidad en concordancia con la cantidad: "1 unidad", "18 unidades",
 * "2 paquetes". Kilos y litros van en su simbolo y no cambian (Leider, 8-oct:
 * "si es mas de 1 unidad, tienes que poner unidades").
 */
export function unidadDe(n: number, unidad: string): string {
  const uno = Math.abs(n) === 1
  if (unidad === 'unidad') return uno ? 'unidad' : 'unidades'
  if (unidad === 'paquete') return uno ? 'paquete' : 'paquetes'
  return unidad
}

export type CompraConVariacion = CompraDeInsumo & { cambio: number | null }

/**
 * Cuanto subio o bajo el costo respecto a la compra ANTERIOR EN EL TIEMPO.
 *
 * Antes se calculaba contra la fila de al lado en la pantalla, que solo era la
 * compra anterior mientras la tabla estuviera en orden de fecha. Ahora que se
 * puede ordenar por costo o por cantidad, esa cuenta habria dado porcentajes
 * inventados: el cambio pertenece a la compra, no a la posicion en la lista.
 */
export function conVariacion(compras: CompraDeInsumo[]): CompraConVariacion[] {
  const cronologico = [...compras].sort(
    (a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime(),
  )
  const cambios = new Map<CompraDeInsumo, number | null>()
  for (const [i, c] of cronologico.entries()) {
    const previa = cronologico[i - 1]
    cambios.set(
      c,
      previa && previa.costo_unitario ? (c.costo_unitario / previa.costo_unitario - 1) * 100 : null,
    )
  }
  return compras.map((c) => ({ ...c, cambio: cambios.get(c) ?? null }))
}

export function estadoStock(ing: Ingrediente): { texto: string; tono: 'mal' | 'ojo' } | null {
  if (ing.stock_actual <= 0) return { texto: 'Agotado', tono: 'mal' }
  if (ing.stock_actual <= ing.stock_minimo) return { texto: 'Bajo', tono: 'ojo' }
  return null
}

export function datosDe(ing: Ingrediente): DatosIngrediente {
  return {
    nombre: ing.nombre,
    unidad: ing.unidad,
    stock_minimo: ing.stock_minimo,
    stock_objetivo: ing.stock_objetivo,
    costo_unitario: ing.costo_unitario,
    rendimiento_pct: ing.rendimiento_pct,
    tipo: ing.tipo ?? 'insumo',
    categoria_id: ing.categoria_id ?? null,
    activo: ing.activo !== false,
    exento: ing.exento ?? false,
  }
}

// El movimiento del libro, dicho como lo diria el dueño.
export function queLePaso(m: MovimientoInventario): string {
  switch (m.tipo) {
    case 'compra':
      return 'Llegó mercancía'
    case 'venta':
      return 'Se vendió'
    case 'merma':
      return 'Se dañó o se botó'
    case 'consumo_personal':
      return 'La usó el personal'
    case 'reverso':
      return 'Se deshizo un movimiento'
    case 'ajuste':
      if (/existencia al empezar/i.test(m.nota)) return 'Lo que había al empezar'
      return m.cantidad >= 0 ? 'Al contar, había de más' : 'Al contar, faltaba'
    default:
      return m.etiqueta
  }
}

// La unidad chica de una grande, para decir el rendimiento en algo que se ve.
export const CHICA: Record<string, { nombre: string; factor: number }> = {
  kg: { nombre: 'g', factor: 1000 },
  lt: { nombre: 'ml', factor: 1000 },
}

/** "de 1 kg comprado quedan 920 g para usar", con el rendimiento que se escribe. */
export function ejemploRendimiento(unidad: string, pct: number): string {
  if (!Number.isFinite(pct) || pct <= 0) return ''
  const chica = CHICA[unidad]
  if (chica) return `De 1 ${unidad} que compras quedan ${Math.round(chica.factor * (pct / 100))} ${chica.nombre} para usar.`
  const base = unidad === 'g' || unidad === 'ml' ? 100 : 10
  const queda = Number(((base * pct) / 100).toFixed(1))
  return `De ${base} ${unidad} que compras quedan ${String(queda).replace('.', ',')} ${unidad} para usar.`
}

/** Lo poco, en la unidad chica: "43 g" y no "0.043 kg", "70 g al día". */
export function legible(n: number, unidad: string): string {
  const chica = CHICA[unidad]
  if (chica && Math.abs(n) < 1 && n !== 0) return `${Math.round(Math.abs(n) * chica.factor)} ${chica.nombre}`
  return `${cantidad(Math.abs(n))} ${unidad}`
}

/** "4 días", "3 meses", "más de un año": lo que dura, en lo que se entiende. */
export function cuantoDura(dias: number): string {
  if (dias > 365) return 'más de un año'
  if (dias > 60) return `${Math.round(dias / 30)} meses`
  const d = Math.max(Math.round(dias), 0)
  return `${d} ${d === 1 ? 'día' : 'días'}`
}

/** "Hoy tienes 10 kg: se te sugeriría comprar 5 kg", con lo que se escribe. */
export function ejemploIdeal(ideal: number, hay: number, unidad: string): string {
  if (!Number.isFinite(ideal) || ideal <= 0) return 'Al sugerir compras, se pide lo que falte para llegar a esto.'
  const falta = ideal - (Number.isFinite(hay) ? hay : 0)
  return falta > 0
    ? `Hoy hay ${cantidad(hay)} ${unidad}: se sugeriría comprar ${cantidad(falta)} ${unidad} para llegar.`
    : `Hoy hay ${cantidad(hay)} ${unidad}: ya estás en lo ideal.`
}

export const fechaCorta = (iso: string) =>
  new Date(iso).toLocaleDateString('es-VE', { day: 'numeric', month: 'short' }).replace('.', '')
