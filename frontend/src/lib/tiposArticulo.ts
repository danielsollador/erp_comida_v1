import type { TipoArticulo } from './types'

/**
 * Qué es cada mercancía, en palabras de quien la compra. El tipo decide su
 * camino: si lleva stock, a qué cuenta va al comprarla y dónde se puede usar
 * (ver docs/plan-compras-inventario-produccion.md).
 *
 * "insumo" es el valor guardado de siempre; en pantalla se lee "Materia prima".
 */
export const TIPOS_ARTICULO: { valor: TipoArticulo; texto: string; detalle: string }[] = [
  { valor: 'insumo', texto: 'Materia prima', detalle: 'se cocina o prepara: carne, pollo, harina' },
  { valor: 'reventa', texto: 'Se vende tal cual', detalle: 'refresco, jugo de caja, chuchería' },
  { valor: 'consumible', texto: 'Empaque de la receta', detalle: 'vaso y pitillo del jugo: va al costo' },
  { valor: 'desechable', texto: 'Desechable', detalle: 'servilletas, bolsas: sin stock, va a gasto' },
]

/** Los que se pueden elegir al crear una mercancía (la preparación nace en Preparaciones). */
export const TIPOS_DE_COMPRA = TIPOS_ARTICULO

export const TEXTO_TIPO: Record<TipoArticulo, string> = {
  insumo: 'Materia prima',
  reventa: 'Reventa',
  consumible: 'Empaque',
  desechable: 'Desechable',
  preparacion: 'Preparación',
}

/** Lo que puede ir en la receta de un producto del menú. */
export function vaEnReceta(i: { tipo: TipoArticulo; es_indirecto?: boolean; activo?: boolean }): boolean {
  return i.tipo !== 'desechable' && !i.es_indirecto && i.activo !== false
}

/** Lo que puede ir dentro de una preparación. */
export function vaEnPreparacion(i: { tipo: TipoArticulo; es_indirecto?: boolean; activo?: boolean }): boolean {
  return (i.tipo === 'insumo' || i.tipo === 'consumible' || i.tipo === 'preparacion') && !i.es_indirecto && i.activo !== false
}
