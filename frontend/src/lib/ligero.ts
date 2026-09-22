/**
 * Modo ligero: la misma pantalla sin lo que le pesa a una tablet barata.
 *
 * POR QUE EXISTE. La tablet del mostrador se quedaba "pegada" (Leider,
 * 22-sep, dos videos): con 2-3 GB de RAM y Chrome con dos pestañas, cada
 * desenfoque de fondo (`backdrop-filter`) obliga al navegador a volver a
 * pintar y componer la capa completa en cada desplazamiento, y las
 * animaciones de entrada hacen lo mismo al abrir cada pantalla. En un
 * computador ni se nota; en la tablet es la diferencia entre fluido y
 * trabado.
 *
 * Con `html.vp-ligero` (ver index.css) se quitan los desenfoques y las
 * animaciones. Los datos, los colores y los botones son los mismos.
 *
 * Se enciende solo en un aparato tactil o con poca memoria, y SIEMPRE en
 * Punto de venta y Cocina, que son las pantallas que viven horas abiertas.
 * Para probarlo o forzarlo: localStorage.setItem('vp-ligero', 'siempre' | 'nunca').
 */
import { useEffect } from 'react'

const CLASE = 'vp-ligero'

/** Si ESTE aparato pide el modo ligero para todas las pantallas. */
export function esAparatoLigero(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const forzado = window.localStorage.getItem('vp-ligero')
    if (forzado === 'siempre') return true
    if (forzado === 'nunca') return false
  } catch {
    // sin almacenamiento: se decide por el aparato
  }
  // `deviceMemory` solo existe en Chrome (que es lo que corre la tablet):
  // 4 GB o menos es una tablet o un telefono, no una laptop.
  const memoria = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  if (memoria !== undefined && memoria <= 4) return true
  return Boolean(window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
}

/** Al arrancar: si el aparato es flojo, toda la aplicacion va ligera. */
export function activarModoLigeroSiHaceFalta() {
  if (esAparatoLigero()) document.documentElement.classList.add(CLASE)
}

/**
 * La pantalla que lo usa va ligera aunque el aparato no lo pida: son las
 * que se quedan abiertas todo el turno. Al salir se vuelve a lo de antes,
 * salvo que el aparato ya lo tuviera puesto.
 */
export function useModoLigero() {
  useEffect(() => {
    const raiz = document.documentElement
    const yaEstaba = raiz.classList.contains(CLASE)
    raiz.classList.add(CLASE)
    return () => {
      if (!yaEstaba) raiz.classList.remove(CLASE)
    }
  }, [])
}
