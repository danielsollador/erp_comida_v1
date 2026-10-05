/**
 * EL TAMAÑO DEL TEXTO EN COCINA, elegido por la propia gente de cocina.
 *
 * Leider (5-oct): "me piden muchos cambios del tamaño del texto en cocina;
 * que la misma gente se lo cambie". Se elige en Configuración > Apariencia y
 * vale para ESTE equipo (la tablet de la cocina), igual que el tema y el
 * teclado: cada pantalla de cocina tiene su distancia y sus ojos.
 *
 * Se aplica con `zoom` sobre el tablero de comandas, no con font-size: asi
 * crecen a la vez las letras, los espacios y las tarjetas, y la rejilla
 * reparte las columnas de nuevo. La barra de arriba no cambia.
 */
import { useEffect, useState } from 'react'

const CLAVE = 'vp-cocina-texto'
const EVENTO = 'vp-cocina-texto'

export const TAMANOS = [
  { id: 'pequeno', zoom: 0.85, titulo: 'Pequeño', detalle: 'Caben más comandas a la vez.' },
  { id: 'normal', zoom: 1, titulo: 'Normal', detalle: 'Como viene de fábrica.' },
  { id: 'grande', zoom: 1.2, titulo: 'Grande', detalle: 'Se lee desde el fogón.' },
  { id: 'enorme', zoom: 1.45, titulo: 'Enorme', detalle: 'Para una pantalla lejos o alta.' },
] as const

export type TamanoCocina = (typeof TAMANOS)[number]['id']

export function leerTamano(): TamanoCocina {
  try {
    const v = localStorage.getItem(CLAVE)
    if (TAMANOS.some((t) => t.id === v)) return v as TamanoCocina
  } catch {
    // sin almacenamiento: el de fabrica
  }
  return 'normal'
}

export function guardarTamano(t: TamanoCocina) {
  try {
    localStorage.setItem(CLAVE, t)
  } catch {
    // sin almacenamiento: vale solo esta visita
  }
  window.dispatchEvent(new Event(EVENTO))
}

export function zoomDe(t: TamanoCocina): number {
  return TAMANOS.find((x) => x.id === t)?.zoom ?? 1
}

export function useTamanoCocina() {
  const [tamano, setTamano] = useState<TamanoCocina>(leerTamano)
  useEffect(() => {
    const sync = () => setTamano(leerTamano())
    window.addEventListener(EVENTO, sync)
    return () => window.removeEventListener(EVENTO, sync)
  }, [])
  return { tamano, zoom: zoomDe(tamano), cambiar: guardarTamano }
}
