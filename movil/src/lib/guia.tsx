import { createContext, use, useEffect, useRef, useSyncExternalStore, type ReactNode, type RefObject } from 'react'
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native'
import type { PasoGuia } from './api-ia'

/**
 * GUÍAS PASO A PASO en el teléfono (lo mismo que `components/Guia.tsx` de
 * la web, 22-oct-2026). El asistente devuelve pasos (ruta + ancla + qué
 * hacer) y la app los recorre sobre la pantalla DE VERDAD: se oscurece todo
 * menos el elemento del paso, y el dueño lo toca él mismo.
 *
 * Tres piezas:
 *   - este almacén: qué guía va y en qué paso (vive fuera de React para que
 *     sobreviva a cambiar de pantalla);
 *   - `Ancla`: marca un elemento con el nombre que usa el servidor
 *     (`data-guia` en la web). Un paso de "tocar" avanza solo cuando se toca
 *     lo marcado;
 *   - `CapaGuia` (componentes/guia/Capa.tsx): la capa que oscurece, resalta
 *     y muestra la tarjeta del paso. Va en el Stack y DENTRO de cada hoja
 *     (Modal), porque un Modal se dibuja encima de todo lo demás.
 */

type Estado = { pasos: PasoGuia[]; i: number }

let estado: Estado = { pasos: [], i: 0 }
const oyentes = new Set<() => void>()
const poner = (e: Estado) => {
  estado = e
  oyentes.forEach((f) => f())
}
const suscribir = (f: () => void) => {
  oyentes.add(f)
  return () => {
    oyentes.delete(f)
  }
}

export function iniciarGuia(pasos: PasoGuia[]) {
  poner({ pasos: pasos.filter((p) => p.ancla), i: 0 })
}
export function cerrarGuia() {
  poner({ pasos: [], i: 0 })
}
export function siguientePaso() {
  const { pasos, i } = estado
  if (i + 1 >= pasos.length) cerrarGuia()
  else poner({ pasos, i: i + 1 })
}
export function pasoAtras() {
  poner({ ...estado, i: Math.max(0, estado.i - 1) })
}
export function useGuia(): Estado {
  return useSyncExternalStore(suscribir, () => estado, () => estado)
}

/**
 * Las rutas del servidor son las de la web. Casi todas existen igual en la
 * app; las que no, se traducen aquí.
 */
const RUTA_APP: Record<string, string> = {}
export const rutaApp = (ruta: string) => RUTA_APP[ruta] ?? ruta

// ── Anclas ──────────────────────────────────────────────────────────────────

/** En qué hoja (Modal) está montada cada ancla; `null` = la pantalla de fondo. */
export const HojaCtx = createContext<string | null>(null)

type Registro = { ref: RefObject<View | null>; hoja: string | null }
const anclas = new Map<string, Set<Registro>>()

export const registrosDe = (ancla: string): Registro[] => Array.from(anclas.get(ancla) ?? [])

let avance: ReturnType<typeof setTimeout> | undefined
/** Se tocó un elemento marcado: si es el del paso y el paso es de tocar, avanza un instante después. */
function tocada(nombre: string) {
  const paso = estado.pasos[estado.i]
  if (!paso || paso.ancla !== nombre || (paso.accion ?? 'tocar') !== 'tocar') return
  clearTimeout(avance)
  avance = setTimeout(siguientePaso, 450)
}

/**
 * Marca un elemento para la guía. Envuelve en un View (no se colapsa, para
 * poder medirlo) y escucha el toque sin frenarlo: el botón de adentro hace
 * lo suyo y la guía pasa al siguiente paso. Un arrastre (desplazar la lista
 * empezando sobre el botón) no cuenta como toque.
 */
export function Ancla({
  nombre,
  children,
  style,
  onLayout,
}: {
  nombre: string
  children: ReactNode
  style?: StyleProp<ViewStyle>
  onLayout?: (e: LayoutChangeEvent) => void
}) {
  const hoja = use(HojaCtx)
  const ref = useRef<View>(null)
  const inicio = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => {
    const r: Registro = { ref, hoja }
    const lista = anclas.get(nombre) ?? new Set<Registro>()
    lista.add(r)
    anclas.set(nombre, lista)
    return () => {
      lista.delete(r)
      if (!lista.size) anclas.delete(nombre)
    }
  }, [nombre, hoja])
  return (
    <View
      ref={ref}
      collapsable={false}
      style={style}
      onLayout={onLayout}
      onTouchStart={(e) => {
        inicio.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }
      }}
      onTouchEnd={(e) => {
        const s = inicio.current
        inicio.current = null
        if (s && Math.hypot(e.nativeEvent.pageX - s.x, e.nativeEvent.pageY - s.y) < 12) tocada(nombre)
      }}
    >
      {children}
    </View>
  )
}
