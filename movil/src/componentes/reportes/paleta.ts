import { useModo } from '../../lib/tema'

/**
 * LA PALETA DE DATOS de la web (frontend/src/lib/paleta.ts y los
 * `--vp-dato-*` de index.css): de aqui sale el color de todo lo que se dibuja
 * en un grafico de Reportes y de Tasa. Los mismos nombres y los mismos tonos;
 * la web los escribe en oklch y React Native no los entiende, asi que van ya
 * pasados a hex, como hace lib/tema.tsx con los demas colores.
 *
 * La regla es la de la web: las series salen del cobre de la marca y de los
 * neutros calidos; verde, ambar y rojo solo cuando el color DICE algo
 * (ganancia, aviso, perdida).
 *
 * Vive aqui y no en lib/tema.tsx porque ese archivo es compartido; cuando
 * otro modulo dibuje graficos, conviene subirla alla (ver el informe).
 */
const CLARO = {
  /** Las series, en orden: acento 500, 800, 300, neutro 500, acento 200, neutro 300, acento 700, neutro 700. */
  serie: ['#bc6541', '#642e18', '#e8aa92', '#6d6b66', '#f6cdbe', '#cdc7bc', '#803c20', '#3e3d3a'],
  /** La barra que se destaca (la mayor, la de hoy). */
  fuerte: '#803c20',
  /** El periodo anterior, detras: una sombra, no una serie. */
  anterior: '#cdc7bc',
  /** Una linea de referencia (el promedio). */
  referencia: '#98948b',
  /** El fondo de una barra o de una casilla vacia. */
  vacio: '#eeebe4',
  bien: '#239852',
  ojo: '#cf8b21',
  mal: '#da4245',
  /** Lo que no es ni bueno ni malo: la mercancia, el IVA. */
  neutro: '#cdc7bc',
  /** Lo que todavia no se sabe (sin receta). */
  incierto: '#e4af6c',
  /** El ambar de la tasa (euro y brecha), `--color-aviso-500`. */
  aviso: '#b96c00',
}

const OSCURO: typeof CLARO = {
  serie: ['#dc8462', '#ffc5ad', '#7f4c38', '#a1a7b4', '#543427', '#333844', '#f8b095', '#d1d5dd'],
  fuerte: '#f8b095',
  anterior: '#333844',
  referencia: '#7c8290',
  vacio: '#1b1e26',
  bien: '#4fb772',
  ojo: '#b67703',
  mal: '#fb6765',
  neutro: '#333844',
  incierto: '#7c5004',
  aviso: '#d88c00',
}

export type PaletaDatos = typeof CLARO

export function usePaletaDatos(): PaletaDatos {
  const { modo } = useModo()
  return modo === 'oscuro' ? OSCURO : CLARO
}

/** El color de la serie `i`, dando la vuelta si hay mas series que colores. */
export function colorSerie(p: PaletaDatos, i: number): string {
  return p.serie[i % p.serie.length]
}

/**
 * Un color con transparencia: lo que en la web es `color-mix(… X%,
 * transparent)` (la intensidad del mapa de calor).
 */
export function conAlfa(hex: string, alfa: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alfa)) * 255)
  return `${hex.slice(0, 7)}${a.toString(16).padStart(2, '0')}`
}
