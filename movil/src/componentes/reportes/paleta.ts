import { useMemo } from 'react'
import { useModo, useTema, type Paleta } from '../../lib/tema'

/**
 * LA PALETA DE DATOS de la web (frontend/src/lib/paleta.ts y los
 * `--vp-dato-*` de index.css): de aqui sale el color de todo lo que se dibuja
 * en un grafico de Reportes y de Tasa. Los mismos nombres y los mismos tonos.
 *
 * La regla es la de la web: las series salen del acento de la MARCA (cobre
 * en Savora, grafito o perla en Vertigo: `ACENTOS` de lib/tema.tsx) y de los
 * neutros calidos; verde, ambar y rojo solo cuando el color DICE algo
 * (ganancia, aviso, perdida). Por eso las series no son hex fijos: se arman
 * con el acento que este puesto.
 */
type Semaforo = {
  /** neutral 700: la octava serie. */
  neutro700: string
  bien: string
  ojo: string
  mal: string
  /** Lo que todavia no se sabe (sin receta). */
  incierto: string
  /** El ambar de la tasa (euro y brecha), `--color-aviso-500`. */
  aviso: string
}

const SEMAFORO_CLARO: Semaforo = { neutro700: '#3e3d3a', bien: '#239852', ojo: '#cf8b21', mal: '#da4245', incierto: '#e4af6c', aviso: '#b96c00' }
const SEMAFORO_OSCURO: Semaforo = { neutro700: '#d1d5dd', bien: '#4fb772', ojo: '#b67703', mal: '#fb6765', incierto: '#7c5004', aviso: '#d88c00' }

function armar(t: Paleta, s: Semaforo) {
  return {
    /** Las series, en orden: acento 500, 800, 300, neutro 500, acento 200, neutro 300, acento 700, neutro 700. */
    serie: [t.dato.s500, t.dato.s800, t.dato.s300, t.suave, t.dato.s200, t.barra, t.dato.s700, s.neutro700],
    /** La barra que se destaca (la mayor, la de hoy). */
    fuerte: t.dato.s700,
    /** El periodo anterior, detras: una sombra, no una serie. */
    anterior: t.barra,
    /** Una linea de referencia (el promedio). */
    referencia: t.tenue,
    /** El fondo de una barra o de una casilla vacia. */
    vacio: t.gris100,
    bien: s.bien,
    ojo: s.ojo,
    mal: s.mal,
    /** Lo que no es ni bueno ni malo: la mercancia, el IVA. */
    neutro: t.barra,
    incierto: s.incierto,
    aviso: s.aviso,
  }
}

export type PaletaDatos = ReturnType<typeof armar>

export function usePaletaDatos(): PaletaDatos {
  const t = useTema()
  const { modo } = useModo()
  return useMemo(() => armar(t, modo === 'oscuro' ? SEMAFORO_OSCURO : SEMAFORO_CLARO), [t, modo])
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
