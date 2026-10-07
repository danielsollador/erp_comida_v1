import type { NombreIcono } from '../components/Icono'
import type { TipoArticulo } from './types'

/**
 * Los cuatro almacenes de Compras (pizarra de Leider y Daniel, 7-oct) y el
 * quinto tipo que no se compra. Qué es cada mercancía decide su camino:
 *
 *   Reventa        compra → depósito → menú → venta        (la Coca-Cola)
 *   Materia prima  compra → crudo → preparado → menú       (el pollo del guiso)
 *   Consumible     compra → depósito → receta              (el vaso del jugo)
 *   Desechable     compra → gasto, sin stock               (las servilletas)
 *   Preparación    no se compra: nace en Preparaciones      (el guiso)
 *
 * "insumo" es el valor guardado de siempre; en pantalla se lee "Materia
 * prima". El tono es el color con que cada tipo aparece en toda Compras: el
 * punto del renglón, la barra de "a dónde va la plata", el sello de la ficha.
 */

export type Almacen = {
  valor: TipoArticulo
  texto: string
  /** Una línea en palabras de quien compra. */
  detalle: string
  /** Un ejemplo que se entiende sin leer el detalle. */
  ejemplo: string
  /** A dónde va la plata al comprarlo. */
  destino: 'deposito' | 'gasto'
  icono: NombreIcono
  /** Clases del color del tipo, para el punto, el sello y la barra. */
  punto: string
  sello: string
}

export const ALMACENES: Almacen[] = [
  {
    valor: 'insumo',
    texto: 'Materia prima',
    detalle: 'Se cocina o se prepara antes de venderse.',
    ejemplo: 'carne, pollo, harina, queso',
    destino: 'deposito',
    icono: 'olla',
    punto: 'bg-acento-500',
    sello: 'bg-acento-50 text-acento-700',
  },
  {
    valor: 'reventa',
    texto: 'Reventa',
    detalle: 'Se compra y se vende tal cual, sin tocarla.',
    ejemplo: 'refresco, malta, agua, chuchería',
    destino: 'deposito',
    icono: 'botella',
    punto: 'bg-exito-500',
    sello: 'bg-exito-50 text-exito-700',
  },
  {
    valor: 'consumible',
    texto: 'Consumible',
    detalle: 'Acompaña la receta sin cocinarse: se cuenta por venta.',
    ejemplo: 'vaso, pitillo, caja del pastelito',
    destino: 'deposito',
    icono: 'vaso',
    punto: 'bg-neutral-500',
    sello: 'bg-neutral-100 text-neutral-600',
  },
  {
    valor: 'desechable',
    texto: 'Desechable',
    detalle: 'No se puede contar por venta: va directo a gasto.',
    ejemplo: 'servilletas, bolsas, cloro, papel',
    destino: 'gasto',
    icono: 'servilleta',
    punto: 'bg-aviso-500',
    sello: 'bg-aviso-50 text-aviso-700',
  },
]

const PREPARACION: Almacen = {
  valor: 'preparacion',
  texto: 'Preparación',
  detalle: 'Se hace en la cocina con materia prima.',
  ejemplo: 'guiso, mechada, salsa',
  destino: 'deposito',
  icono: 'cocina',
  punto: 'bg-acento-800',
  sello: 'bg-acento-100 text-acento-800',
}

/** Todos los tipos, incluida la preparación, por su valor. */
export const ALMACEN_DE: Record<TipoArticulo, Almacen> = Object.fromEntries(
  [...ALMACENES, PREPARACION].map((a) => [a.valor, a]),
) as Record<TipoArticulo, Almacen>

/** Los que se pueden elegir al crear una mercancía (la preparación nace en Preparaciones). */
export const TIPOS_DE_COMPRA = ALMACENES

/** Compatibilidad con las pantallas que ya usaban el catálogo plano. */
export const TIPOS_ARTICULO: { valor: TipoArticulo; texto: string; detalle: string }[] = ALMACENES.map((a) => ({
  valor: a.valor,
  texto: a.texto,
  detalle: a.detalle,
}))

export const TEXTO_TIPO: Record<TipoArticulo, string> = {
  insumo: 'Materia prima',
  reventa: 'Reventa',
  consumible: 'Consumible',
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
