import { useEffect, useState } from 'react'

/**
 * Con qué palabras habla el sistema: las del negocio o las de siempre.
 *
 *   sencillo   "Te quedó", "Hay", "Gasta en promedio cada cliente". Es como
 *              lo diría el dueño de una arepera. La ayuda de cada título
 *              explica qué es y dice cómo se le suele llamar ("A esto se le
 *              suele llamar ticket promedio").
 *   tecnico    "Ganancia neta", "Stock", "Ticket promedio": todo como estaba
 *              antes, para quien viene de otro sistema o le pasa los números
 *              al contador. La ayuda, como estaba antes.
 *
 * Es la misma información en los dos: cambia la palabra que se ve (Leider,
 * 30-sep: "no me quites esa parte de información porque me parece
 * valiosa"). Se elige SOLO en Configuración › Lenguaje (Leider, 30-sep: nada
 * de botones en la barra) y vale para este equipo, como el tema.
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
  if (nuevo === modoActual) return
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
 * Cada número que tiene dos nombres, con lo que es en una línea (para la
 * lista de Configuración › Lenguaje). La clave es la del glosario cuando la
 * hay: así la ayuda sabe cuál es el otro nombre.
 */
export const TERMINOS: Record<string, { tecnico: string; sencillo: string; donde: string }> = {
  'kpi.ganancia_neta': { tecnico: 'Ganancia neta', sencillo: 'Te quedó', donde: 'Reportes' },
  'kpi.ticket_promedio': { tecnico: 'Ticket promedio', sencillo: 'Gasta en promedio cada cliente', donde: 'Reportes y Ventas' },
  'kpi.fiado_pendiente': { tecnico: 'A crédito por cobrar', sencillo: 'Te deben', donde: 'Ventas' },
  'kpi.valor_deposito': { tecnico: 'Valor en inventario', sencillo: 'Plata en mercancía', donde: 'Inventario y Reportes' },
  'kpi.bajo_minimo': { tecnico: 'Bajo mínimo', sencillo: 'Por debajo del mínimo', donde: 'Inventario' },
  'kpi.bajo_minimo_agotadas': { tecnico: 'Bajo mínimo o agotadas', sencillo: 'Por debajo del mínimo o agotadas', donde: 'Reportes' },
  'inventario.stock': { tecnico: 'Stock', sencillo: 'Hay', donde: 'Inventario' },
  'inventario.costo': { tecnico: 'Costo compra', sencillo: 'Costo promedio', donde: 'Inventario' },
  'inventario.reponer': { tecnico: 'Costo última compra', sencillo: 'Costo última compra', donde: 'Inventario' },
  'inventario.rendimiento': { tecnico: 'Rendimiento', sencillo: 'Aprovechable', donde: 'Inventario' },
  'productos.uds': { tecnico: 'Uds', sencillo: 'Vendidos', donde: 'Reportes' },
  'compras.base': { tecnico: 'Base', sencillo: 'Sin IVA', donde: 'Compras' },
}

/** El nombre que toca según el modo. Si la clave no tiene dos nombres, el que se pase. */
export function nombre(clave: string, porDefecto = ''): string {
  const t = TERMINOS[clave]
  if (!t) return porDefecto
  return modoActual === 'tecnico' ? t.tecnico : t.sencillo
}

/**
 * La línea de la ayuda con el otro nombre. Solo en modo sencillo: es donde
 * hace falta saber "cómo se le suele llamar". En modo técnico la ayuda queda
 * como estaba antes.
 */
export function otroNombre(clave: string): string | undefined {
  const t = TERMINOS[clave]
  if (!t || modoActual === 'tecnico') return undefined
  return `A esto se le suele llamar «${t.tecnico}».`
}

/** Un texto con sus dos versiones: `segun({ sencillo, tecnico })`. */
export function segun(t: { sencillo: string; tecnico: string }): string {
  return modoActual === 'tecnico' ? t.tecnico : t.sencillo
}
