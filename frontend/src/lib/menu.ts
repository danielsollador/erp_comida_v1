import type { Producto, Variante } from './types'

/**
 * Producto y subseccion: como se muestran y cuales se venden.
 *
 * POR QUE EXISTE ESTE ARCHIVO. Las dos reglas de abajo estaban escritas a
 * mano en seis sitios (POS dos veces, Recetas, Menu, y el backend en
 * combos.py), cada una comparando contra el texto "Regular". Dos problemas:
 * se desincronizaban, y sobre todo el nombre de una subseccion lo escribe el
 * dueño y puede ser cualquier cosa.
 */

/**
 * El nombre que se le pone a la subseccion que nace con el producto.
 *
 * Al crear un producto desde el menu se le crea UNA subseccion "Regular" a
 * precio 0, para que haya algo que vender desde el primer momento. No es una
 * marca del sistema: es texto, y el dueño puede renombrarla, ponerle precio o
 * agregarle hermanas.
 */
export const SUBSECCION_INICIAL = 'Regular'

/**
 * La subseccion inicial que nadie llego a tocar.
 *
 * Se pide que coincidan LAS DOS COSAS --el nombre Y el precio en cero-- a
 * proposito. Solo por el nombre se rompia al reves: un local que vende "Cafe
 * Regular $1,00" y "Cafe Grande $1,50" perdia el Regular del punto de venta,
 * porque el filtro lo confundia con el marcador de posicion y la cajera no
 * tenia como cobrar un cafe normal.
 *
 * Y solo por el precio tampoco: una subseccion de verdad a la que todavia no
 * le pusieron precio --un "Queso" que quedo en 0 por olvido-- desapareceria
 * del mostrador sin que nadie se entere. Asi, en cambio, se queda a la vista
 * en $0,00, que es feo pero se nota y se corrige.
 */
export function esSubseccionSinEstrenar(v: Variante): boolean {
  return v.nombre === SUBSECCION_INICIAL && v.precio === 0
}

/**
 * Lo que se le ofrece al cliente en el mostrador.
 *
 * Si el producto ya tiene subsecciones de verdad, la inicial sin estrenar
 * sobra: mostrarla ponia un "Pastelito" a $0 al lado de "Pastelito - Pollo",
 * como si el producto padre tambien se vendiera suelto.
 *
 * Si al quitarla no queda nada --el caso normal de un producto sin
 * subsecciones, como un jugo embotellado-- se devuelven las activas tal cual:
 * quedarse sin nada que vender seria peor que mostrar la inicial.
 */
export function variantesParaVender(producto: Producto): Variante[] {
  const activas = producto.variantes.filter((v) => v.activo)
  const reales = activas.filter((v) => !esSubseccionSinEstrenar(v))
  return reales.length > 0 ? reales : activas
}

/**
 * Como se llama esto en pantalla.
 *
 * La regla es CUANTAS subsecciones tiene el producto, no como se llaman: con
 * una sola, el nombre de la subseccion no aporta nada ("Jugo Yukery", no
 * "Jugo Yukery - Regular"); con varias, hace falta para distinguirlas.
 *
 * Se cuentan las activas y no las que se muestran: si el producto tiene la
 * inicial sin estrenar y ademas "Pollo", en el mostrador solo se ve Pollo,
 * pero el nombre tiene que seguir siendo "Pastelito - Pollo". Con el conteo
 * de las mostradas diria "Pastelito" a secas y se perderia cual es.
 */
export function etiquetaVariante(
  producto: { nombre: string; variantes: Variante[] },
  variante: Variante,
): string {
  const activas = producto.variantes.filter((v) => v.activo)
  return activas.length <= 1 ? producto.nombre : `${producto.nombre} - ${variante.nombre}`
}
