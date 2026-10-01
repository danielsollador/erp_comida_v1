/**
 * LA PALETA DE DATOS: de donde sale el color de TODO lo que se dibuja en un
 * grafico. Una sola, por nombre de lo que significa, nunca un color suelto
 * dentro de un componente.
 *
 * POR QUE EXISTE. Cada grafico se escribia su color: barras negras, una linea
 * verde encima de barras cobre, categorias que salian del hex que tocara.
 * Leider (30-sep): "no me puedes poner anaranjado con verde... hay que tener
 * una paleta de colores central y de ahi salen todos los colores de todas
 * las cosas del modulo".
 *
 * LA REGLA. Las series (lo que se mide: la plata, las unidades, una
 * categoria) salen de la familia del cobre de la marca y de los neutros
 * calidos: tonos de UN color, que siempre combinan entre si. Los colores
 * con significado --verde, ambar, rojo-- se guardan para cuando el color
 * DICE algo (ganancia, aviso, perdida) y nunca para distinguir una serie
 * de otra.
 *
 * SON VARIABLES DE CSS (`--vp-dato-*`, en `index.css`), no valores: asi el
 * modo oscuro las ajusta solo (un cobre oscuro no se ve sobre fondo negro)
 * y, cuando el dueño pueda elegir el color de su marca, cambiar la familia
 * del acento cambia todos los graficos a la vez sin tocar un componente.
 */
export const PALETA = {
  /** Las series, en orden: la principal, la segunda (contrasta con la
      primera), la tercera, y asi. Para una medida junto a otra, o para las
      partes de un todo. */
  serie: [
    'var(--vp-dato-1)',
    'var(--vp-dato-2)',
    'var(--vp-dato-3)',
    'var(--vp-dato-4)',
    'var(--vp-dato-5)',
    'var(--vp-dato-6)',
    'var(--vp-dato-7)',
    'var(--vp-dato-8)',
  ],
  /** La barra que se destaca (la mayor, la de hoy). */
  fuerte: 'var(--vp-dato-fuerte)',
  /** El periodo anterior, detras: una sombra, no una serie. */
  anterior: 'var(--vp-dato-anterior)',
  /** Una linea de referencia (el promedio, la meta). */
  referencia: 'var(--vp-dato-referencia)',
  /** El relleno de una celda vacia o el fondo de una barra. */
  vacio: 'var(--vp-dato-vacio)',

  // Con significado. Solo cuando el color dice algo.
  bien: 'var(--vp-dato-bien)',
  ojo: 'var(--vp-dato-ojo)',
  mal: 'var(--vp-dato-mal)',
  /** Lo que no es ni bueno ni malo: la mercancia, el IVA, lo neutro. */
  neutro: 'var(--vp-dato-neutro)',
  /** Lo que todavia no se sabe (sin receta). */
  incierto: 'var(--vp-dato-incierto)',
} as const

/** El color de la serie `i`, dando la vuelta si hay mas series que colores. */
export function colorSerie(i: number): string {
  return PALETA.serie[i % PALETA.serie.length]
}
