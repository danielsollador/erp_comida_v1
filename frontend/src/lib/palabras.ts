import { useEffect, useState } from 'react'

/**
 * Con qué palabras habla el sistema: las del negocio o las de contabilidad.
 *
 *   sencillo   "Te quedó", "Hay", "Gasta en promedio cada cliente". Es como
 *              lo diría el dueño de una arepera. Al pasar el cursor, la ayuda
 *              dice cómo se le suele llamar en contabilidad.
 *   tecnico    "Ganancia neta", "Stock", "Ticket promedio": las palabras de
 *              siempre, para quien viene de otro sistema o le pasa los
 *              números al contador. Al pasar el cursor, la ayuda lo explica
 *              en palabras simples.
 *
 * Es la misma información en los dos: cambia la palabra que se ve y la que
 * se explica (Leider, 30-sep: "no me quites esa parte de información porque
 * me parece valiosa"). Se elige en Configuración › Apariencia y vale para
 * este equipo, como el tema.
 *
 * LITERALIDAD. La palabra sencilla dice EXACTAMENTE lo que es el número, no
 * una lectura: "ticket promedio" es lo que gasta EN PROMEDIO cada cliente,
 * no "lo que gasta cada cliente" (Leider, 30-sep).
 */
export type ModoPalabras = 'sencillo' | 'tecnico'

const CLAVE = 'vertigo_palabras'
const EVENTO = 'vertigo:palabras'

let modoActual: ModoPalabras = leerGuardado()

function leerGuardado(): ModoPalabras {
  try {
    return localStorage.getItem(CLAVE) === 'tecnico' ? 'tecnico' : 'sencillo'
  } catch {
    return 'sencillo'
  }
}

export function leerModo(): ModoPalabras {
  return modoActual
}

export function cambiarModo(nuevo: ModoPalabras) {
  modoActual = nuevo
  try {
    localStorage.setItem(CLAVE, nuevo)
  } catch {
    // sin almacenamiento vale solo esta visita
  }
  window.dispatchEvent(new Event(EVENTO))
}

export function usePalabras() {
  const [modo, setModo] = useState<ModoPalabras>(modoActual)
  useEffect(() => {
    const sync = () => setModo(modoActual)
    window.addEventListener(EVENTO, sync)
    return () => window.removeEventListener(EVENTO, sync)
  }, [])
  return { modo, cambiar: cambiarModo }
}

/**
 * Cada número que tiene dos nombres. La clave es la del glosario cuando la
 * hay (así la ayuda sabe cuál es el otro nombre); si no, una propia.
 */
export const TERMINOS: Record<string, { tecnico: string; sencillo: string }> = {
  'inventario.stock': { tecnico: 'Stock', sencillo: 'Hay' },
  'inventario.costo': { tecnico: 'Costo compra', sencillo: 'Costo promedio' },
  'inventario.reponer': { tecnico: 'Reponer', sencillo: 'Última compra' },
  'inventario.rendimiento': { tecnico: 'Rendimiento', sencillo: 'Aprovechable' },
  'productos.uds': { tecnico: 'Uds', sencillo: 'Vendidos' },
  'compras.base': { tecnico: 'Base', sencillo: 'Sin IVA' },
  'kpi.ganancia_neta': { tecnico: 'Ganancia neta', sencillo: 'Te quedó' },
  'kpi.ticket_promedio': { tecnico: 'Ticket promedio', sencillo: 'Gasta en promedio cada cliente' },
  'kpi.fiado_pendiente': { tecnico: 'A crédito por cobrar', sencillo: 'Te deben' },
  'kpi.bajo_minimo': { tecnico: 'Bajo mínimo', sencillo: 'Por debajo del mínimo' },
  'kpi.bajo_minimo_agotadas': { tecnico: 'Bajo mínimo o agotadas', sencillo: 'Por debajo del mínimo o agotadas' },
  'kpi.valor_deposito': { tecnico: 'Valor en depósito', sencillo: 'Plata en mercancía' },
}

/** El nombre que toca según el modo. Si la clave no tiene dos nombres, el que se pase. */
export function nombre(clave: string, porDefecto = ''): string {
  const t = TERMINOS[clave]
  if (!t) return porDefecto
  return modoActual === 'tecnico' ? t.tecnico : t.sencillo
}

/** La línea de la ayuda que dice el OTRO nombre: la información no se pierde, se invierte. */
export function otroNombre(clave: string): string | undefined {
  const t = TERMINOS[clave]
  if (!t) return undefined
  return modoActual === 'tecnico'
    ? `En palabras simples: ${t.sencillo.charAt(0).toLowerCase()}${t.sencillo.slice(1)}.`
    : `A esto se le suele llamar «${t.tecnico}».`
}
