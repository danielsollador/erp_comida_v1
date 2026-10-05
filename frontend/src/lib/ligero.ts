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
 * animaciones de entrada. Los datos, los colores y los botones son los
 * mismos; el circulo al cambiar de tema tambien se queda, que es puntual.
 *
 * Se enciende solo en un aparato tactil (puntero grueso), y SIEMPRE en
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
  // SOLO POR EL TIPO DE APARATO: un puntero grueso (dedo) es una tablet o un
  // telefono. Antes tambien se miraba `navigator.deviceMemory` ("4 GB o menos
  // = tablet"), pero Chrome lo redondea hacia abajo por privacidad: la laptop
  // de Leider, con 16 GB, reporta 4, y la portada le salia sin llama ni luz
  // (5-oct, en la VM de Google; en local su Chrome hacia lo mismo). La tablet
  // del mostrador es tactil, asi que la cubre la regla del puntero.
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
